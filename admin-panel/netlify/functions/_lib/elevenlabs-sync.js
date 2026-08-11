'use strict';

// S4 / Stufe 2 — der Sync-Kern, aus dem Handler herausgeloest.
//
// Warum: `trigger-elevenlabs-sync.js` ist ueber requirePromptSyncCaller
// abgesichert; alle bisherigen internen Aufrufer reichen dafuer das JWT des
// Endnutzers weiter (elevenlabs-provision-agent, customer-operational-updates,
// customer-update-assistant, trigger-elevenlabs-sync-v2). Ein geplanter Job hat
// kein solches Token. Die Alternativen waeren ein Dienstkonto-Login als
// Umgebungsvariable oder ein zweiter Auth-Zweig im Guard gewesen -- beides
// haette die Angriffsflaeche genau des Endpunkts vergroessert, den S1 und S13
// gerade gehaertet haben.
//
// Stattdessen liegt die Logik jetzt hier und wird auf zwei Wegen aufgerufen:
//   - der Handler: Guard, Request-Parsing und HTTP-Antwort wie bisher
//   - der Fan-out-Worker: in-process mit Service-Role, ohne HTTP-Hop
//
// Das Verhalten der acht bestehenden Ausloeser aendert sich dabei nicht. Die
// Reihenfolge der Schritte, die Fehlerbehandlung, die Log-Zeile und der
// Kunden-Patch sind unveraendert aus dem Handler uebernommen.

const { buildPromptV2 } = require('./prompt-builder-v2');
const {
  configured: calendarToolProvisioningConfigured,
  ensureWorkspaceTool,
  mergedAgentToolIds,
  calendarPromptBlock
} = require('./elevenlabs-calendar-tool');
const { ensureAgentPhoneNumber } = require('./elevenlabs-phone-number');
const { promptFingerprint } = require('./prompt-fingerprint');
// #932: der Sollzustand liegt jetzt in einer Datei, die sich Provisionierung
// und Sync teilen. Vorher beschrieb der Sync nur einen Ausschnitt und ersetzte
// damit bei jedem Lauf `conversation_config.agent.prompt` -- die Herleitung
// steht ausfuehrlich in elevenlabs-agent-config.js.
const {
  buildAgentConfig,
  compareAgentState,
  looksLikeAgentState
} = require('./elevenlabs-agent-config');

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1/convai/agents';
const SYNC_LOG_KEEP_PER_CLASS = 10;

// Der Pfad, an dem der gebaute Prompt landet. Weicht ausgerechnet er ab, ist
// der Prompt NICHT live -- dann duerfen weder prompt_snapshot noch
// prompt_fingerprint fortgeschrieben werden, denn beide behaupten sonst einen
// Zustand, den der Agent nicht hat.
const PROMPT_PATH = 'conversation_config.agent.prompt.prompt';
const FIRST_MESSAGE_PATH = 'conversation_config.agent.first_message';

/**
 * #932 / Punkt 1 — Rueckleseprüfung.
 *
 * Nach dem PATCH wird der Agent zurueckgelesen und gegen genau den Koerper
 * verglichen, den wir gesendet haben. Liefert die PATCH-Antwort den
 * resultierenden Agenten bereits mit, ist die Pruefung kostenlos; sonst ein GET.
 *
 * Der Punkt steht vor allen anderen, weil er nicht an die sieben heute
 * bekannten Felder gebunden ist: die Erwartung wird aus dem gesendeten Koerper
 * abgeleitet. Kommt morgen ein Feld dazu, ist es mitgeprueft -- und damit faengt
 * die Pruefung auch die naechste Auspraegung dieser Fehlerklasse.
 */
async function readBackAgentState({ apiKey, agentId, patchPayload }) {
  if (looksLikeAgentState(patchPayload)) {
    return { state: patchPayload, source: 'patch_response' };
  }
  const res = await fetch(`${ELEVENLABS_BASE}/${encodeURIComponent(agentId)}`, {
    method: 'GET',
    headers: { 'xi-api-key': apiKey }
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ElevenLabs readback ${res.status}: ${errText.substring(0, 300)}`);
  }
  return { state: await res.json(), source: 'get' };
}

async function loadPromptInputs(sb, customerId, customer) {
  const nowIso = new Date().toISOString();
  const [masterResult, coreResult, operationalResult, calendarResult] = await Promise.all([
    sb.from('system_config').select('value').eq('key', 'prompt_master_l1').maybeSingle(),
    // J4: Schema der generischen Betriebsfelder. Eine Quelle fuer beide
    // Netlify-Sites — ein gemeinsames JS-Modul gibt es zwischen ihnen nicht.
    sb.from('system_config').select('value').eq('key', 'core_field_steps').maybeSingle(),
    sb.from('customer_operational_updates')
      .select('id,type,title,message,behavior,starts_at,ends_at,status')
      .eq('customer_id', customerId)
      .eq('status', 'published')
      .gt('ends_at', nowIso)
      .order('starts_at', { ascending: true })
      .limit(20),
    sb.from('calendar_settings').select('*').eq('customer_id', customerId).maybeSingle()
  ]);

  if (masterResult.error) throw masterResult.error;
  if (coreResult.error) throw coreResult.error;
  if (operationalResult.error) {
    const error = new Error('operational_updates_lookup_failed');
    error.cause = operationalResult.error;
    throw error;
  }
  if (calendarResult.error) throw calendarResult.error;

  let industryPrompt = '';
  // J1: extra_steps liefert Label und Optionstexte zu den Branchenantworten.
  // Ohne sie kann der Builder eine Antwort nur als rohen Schluesselwert
  // wiedergeben — und tat es deshalb bisher gar nicht.
  let industryFields = [];
  // J8 / G6: Die Aufnahme-Checkliste der Branche. Sie ist Rueckfall, nicht
  // Vorgabe -- die Antwort des Kunden fuehrt (buildPromptProfileSections).
  let industryRequiredInformation = '';
  if (customer.industry_template_id) {
    const { data, error } = await sb.from('industry_templates')
      .select('prompt_block,extra_steps,default_required_information')
      .eq('id', customer.industry_template_id)
      .maybeSingle();
    if (error) throw error;
    industryPrompt = data?.prompt_block || '';
    industryFields = Array.isArray(data?.extra_steps) ? data.extra_steps : [];
    industryRequiredInformation = data?.default_required_information || '';
  }

  let assistantRole = 'die Assistentin';
  if (customer.voice_id) {
    const { data, error } = await sb.from('voxera_voices')
      .select('gender')
      .eq('voice_id', customer.voice_id)
      .maybeSingle();
    if (error) throw error;
    if (data?.gender === 'male') assistantRole = 'der Assistent';
  }

  return {
    masterPrompt: masterResult.data?.value || '',
    coreFields: coreResult.data?.value || '',
    operationalUpdates: operationalResult.data || [],
    calendarSettings: calendarResult.data || null,
    industryPrompt,
    industryFields,
    industryRequiredInformation,
    assistantRole
  };
}

// S4 / Stufe 0: Die Aufbewahrung laeuft pro Kunde UND pro Herkunftsklasse.
//
// Vorher galten pauschal 10 Zeilen pro Kunde. Ein Fan-out schreibt eine Zeile
// pro Kunde und Durchlauf -- zwei, drei Durchlaeufe haetten damit die gesamte
// interaktive Historie verdraengt, inklusive der prompt_snapshot-Zeilen, die
// ein Rollback braucht. Genau die Daten waeren also im Fehlerfall weg, in dem
// man sie am dringendsten braucht.
function syncLogClass(triggeredBy) {
  return String(triggeredBy || '').startsWith('fanout') ? 'fanout' : 'interactive';
}

async function trimSyncLogs(sb, customerId) {
  const { data: allLogs, error } = await sb.from('elevenlabs_sync_log')
    .select('id, triggered_by')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });
  if (error || !allLogs) return;

  const kept = { fanout: 0, interactive: 0 };
  const doomed = [];
  for (const row of allLogs) {
    const cls = syncLogClass(row.triggered_by);
    if (kept[cls] < SYNC_LOG_KEEP_PER_CLASS) kept[cls] += 1;
    else doomed.push(row.id);
  }
  if (!doomed.length) return;
  await sb.from('elevenlabs_sync_log').delete().in('id', doomed);
}

// prev_values traegt den Stand VOR dem Patch, den der Aufrufer bereits in
// `customers` geschrieben hat; `customer` ist hier frisch aus der DB gelesen,
// spiegelt also den Stand NACH dem Patch. Nur Felder, die der Aufrufer
// mitschickt, werden verglichen -- fehlt prev_values (Wizard, customer_request),
// bleibt changed_fields leer statt geraten zu werden.
function diffPrevValues(prevValues, customer) {
  if (!prevValues || typeof prevValues !== 'object' || Array.isArray(prevValues)) return {};
  // jsonb-Spalten (ai_branch_extra) kaemen als Objekte an und waeren mit `!==`
  // immer verschieden — ein Phantom-Diff bei jedem Sync.
  const normalize = (value) => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return value;
  };
  const changed = {};
  for (const key of Object.keys(prevValues)) {
    const before = normalize(prevValues[key]);
    const after = normalize(customer?.[key]);
    if (before !== after) changed[key] = after;
  }
  return changed;
}

/**
 * Synchronisiert einen Kunden zu ElevenLabs.
 *
 * Gibt immer ein Ergebnisobjekt zurueck und wirft nur bei Programmierfehlern.
 * `code` ist gesetzt, wenn der Aufruf gar nicht erst zustande kam
 * (customer_not_found, agent_customer_mapping_mismatch) -- der Handler bildet
 * das auf 404/409 ab, wie vorher.
 */
async function syncCustomerToElevenLabs({
  sb,
  apiKey,
  customerId,
  agentId,
  triggeredBy = 'admin_save',
  prevValues = {}
}) {
  const { data: customer, error: customerError } = await sb.from('customers')
    .select('*')
    .eq('id', customerId)
    .maybeSingle();
  if (customerError || !customer) return { ok: false, code: 'customer_not_found' };
  if (String(customer.elevenlabs_agent_id || '').trim() && String(customer.elevenlabs_agent_id) !== String(agentId)) {
    return { ok: false, code: 'agent_customer_mapping_mismatch' };
  }

  let fullPrompt = '';
  let compiled = null;
  let syncStatus = 'success';
  let syncError = null;
  let calendarToolId = null;
  let calendarToolStatus = 'not_configured';
  let phoneNumberStatus = 'not_attempted';
  let phoneNumberId = null;
  let phoneNumber = null;
  let fingerprint = null;
  // #932 / Punkt 1: Ergebnis der Rueckleseprüfung.
  let configDrift = [];
  let readbackSource = 'not_attempted';
  let readbackFailure = null;
  let promptLanded = false;

  try {
    const inputs = await loadPromptInputs(sb, customerId, customer);
    // S4 / Stufe 1: aus genau den Eingaben berechnet, die gerade in den Prompt
    // gehen -- kein zweiter Ladeweg, der auseinanderlaufen koennte.
    fingerprint = promptFingerprint({
      masterPrompt: inputs.masterPrompt,
      industryPrompt: inputs.industryPrompt,
      coreFields: inputs.coreFields,
      industryFields: inputs.industryFields,
      // J8: Aendert eine Vorlage ihre Aufnahme-Checkliste, aendert sich der
      // Prompt jedes Kunden dieser Branche, der keine eigene hinterlegt hat.
      // Ohne diese Eingabe bliebe der Fingerprint gleich und der Planer
      // hielte die Agenten faelschlich fuer aktuell.
      industryRequiredInformation: inputs.industryRequiredInformation
    });
    compiled = buildPromptV2({
      customer,
      masterPrompt: inputs.masterPrompt,
      industryPrompt: inputs.industryPrompt,
      industryFields: inputs.industryFields,
      industryRequiredInformation: inputs.industryRequiredInformation,
      coreFields: inputs.coreFields,
      assistantRole: inputs.assistantRole,
      operationalUpdates: inputs.operationalUpdates
    });

    const calendarBlock = calendarPromptBlock(inputs.calendarSettings || {});
    fullPrompt = [compiled.prompt, calendarBlock].filter(Boolean).join('\n\n');

    let toolIds;
    if (calendarToolProvisioningConfigured()) {
      calendarToolId = await ensureWorkspaceTool();
      toolIds = await mergedAgentToolIds(agentId, calendarToolId);
      calendarToolStatus = 'configured';
    } else if (calendarBlock) {
      throw new Error('calendar_tool_provisioning_configuration_missing');
    }

    // #932: der vollstaendige Sollzustand, nicht mehr ein Ausschnitt davon.
    // `toolIds` bleibt weg, wenn die Kalender-Provisionierung nicht
    // konfiguriert ist -- siehe buildAgentConfig().
    const desiredState = buildAgentConfig({
      customer,
      prompt: fullPrompt,
      firstMessage: compiled.firstMessage,
      toolIds
    });

    const elRes = await fetch(`${ELEVENLABS_BASE}/${encodeURIComponent(agentId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey
      },
      body: JSON.stringify(desiredState)
    });

    if (!elRes.ok) {
      const errText = await elRes.text();
      throw new Error(`ElevenLabs ${elRes.status}: ${errText.substring(0, 300)}`);
    }

    // Ab hier ist der Agent aktualisiert. Alles Weitere darf den Sync nicht
    // mehr nachtraeglich zum Fehlschlag erklaeren.
    promptLanded = true;

    // Die Antwort wird tolerant gelesen: liefert sie den Agenten mit, sparen
    // wir den GET. Ein nicht lesbarer Koerper ist kein Fehlschlag des Syncs --
    // der PATCH hat bereits mit 2xx geantwortet.
    let patchPayload = null;
    try {
      patchPayload = await elRes.json();
    } catch (_parseError) {
      patchPayload = null;
    }

    // Die Rueckleseprüfung haengt an einem eigenen Netzaufruf. Faellt der aus,
    // ist das kein Fehlschlag des Syncs -- der PATCH steht bereits. Ihn
    // deswegen als 'failed' zu fuehren wuerde die Warteschlange denselben
    // Koerper erneut senden lassen und den prompt_snapshot verwerfen, an dem
    // das Rollback haengt. Dass die Pruefung nicht laufen konnte, wird aber
    // festgehalten statt verschwiegen.
    try {
      const readback = await readBackAgentState({ apiKey, agentId, patchPayload });
      readbackSource = readback.source;
      configDrift = compareAgentState(desiredState, readback.state);
      promptLanded = !configDrift.some((deviation) => deviation.path === PROMPT_PATH);
    } catch (error) {
      readbackSource = 'failed';
      readbackFailure = error?.message || String(error);
      console.warn('[elevenlabs-sync] readback_failed', {
        customer_id: customerId,
        agent_id: agentId,
        message: readbackFailure
      });
    }

    const phoneAssignment = await ensureAgentPhoneNumber({
      apiKey,
      agentId,
      customer
    });
    phoneNumberStatus = phoneAssignment.status;
    phoneNumberId = phoneAssignment.phone_number_id;
    phoneNumber = phoneAssignment.phone_number;
  } catch (error) {
    syncStatus = 'failed';
    syncError = error?.message || String(error);
  }

  // #932 / Punkt 1: Eine Abweichung darf 'success' nicht unwidersprochen lassen.
  //
  // Sie macht daraus aber auch keinen Fehlschlag. `ok: false` wuerde die
  // Warteschlange die Zeile wiederholen lassen, den Canary reissen und ueber
  // abortIfFailing() den ganzen Fan-out anhalten -- und der Wiederholungsversuch
  // sendet exakt denselben Koerper, kann also nichts reparieren. Das ist
  // dieselbe Ueberlegung, aus der weiter unten schon ein fehlgeschlagener
  // Kunden-Patch den Sync nicht umdeutet.
  //
  // Sichtbar ist die Abweichung trotzdem: eigener Status, die betroffenen
  // Feldnamen in `config_drift`, und `configDrift` im Rueckgabewert.
  if (syncStatus === 'success' && configDrift.length) {
    syncStatus = 'drift';
    syncError = `Agent weicht nach dem Sync in ${configDrift.length} Feld(ern) vom Sollzustand ab: ${configDrift.map((d) => d.path).join(', ')}`.slice(0, 500);
  }

  // 'success' und 'drift' heissen beide: der PATCH ist durch, der Agent traegt
  // den neuen Stand. 'failed' heisst das nicht -- ein Schritt NACH dem PATCH
  // (Telefonnummer) kann den Sync noch kippen, und dann darf keine Zeile
  // entstehen, die einen Stand belegt, den wir nicht mehr verantworten.
  const syncReachedAgent = syncStatus === 'success' || syncStatus === 'drift';

  const changedFields = diffPrevValues(prevValues, customer);
  const syncLogRow = {
    customer_id: customerId,
    agent_id: agentId,
    status: syncStatus,
    triggered_by: triggeredBy,
    // Der Snapshot belegt, welcher Prompt live ist. Bei einer Abweichung, die
    // den Prompt selbst betrifft, ist er das gerade nicht -- dann waere der
    // Snapshot eine Behauptung, und ein Rollback wuerde spaeter auf ihn
    // zurueckgreifen. Weicht nur ein Nebenfeld ab, ist der Prompt live und der
    // Snapshot bleibt gueltig.
    prompt_snapshot: (syncReachedAgent && promptLanded) ? fullPrompt : null,
    prompt_length: fullPrompt.length,
    error_message: syncError,
    changed_fields: Object.keys(changedFields).length ? changedFields : null,
    prev_values: Object.keys(prevValues || {}).length ? prevValues : null,
    prompt_fingerprint: fingerprint,
    // Auch eine Pruefung, die gar nicht laufen konnte, gehoert hier hin --
    // sonst ist eine ungeprueft gebliebene Zeile von einer geprueften ohne
    // Befund nicht zu unterscheiden.
    config_drift: (configDrift.length || readbackFailure)
      ? { source: readbackSource, deviations: configDrift, error: readbackFailure }
      : null,
    created_at: new Date().toISOString()
  };
  // Stufenweise, nicht alles-oder-nichts. Uebernommen aus N6 (#878) und um die
  // S4-Spalte erweitert.
  //
  // Die erste Fassung dieses Fallbacks warf bei einem beliebigen Insert-Fehler
  // `prev_values` UND `changed_fields` zusammen weg -- also auch die Spalte,
  // wegen der der S9-Fix ueberhaupt gebaut wurde. Am 09.08. war das keine
  // Theorie: `prev_values` fehlte in Produktion, der primaere Insert schlug bei
  // jedem Sync fehl, und der Fallback entsorgte den Diagnosewert des Logs
  // stillschweigend mit.
  //
  // Jede Stufe gibt nur auf, was die vorige nachweislich nicht aufnehmen
  // konnte, in der Reihenfolge "am wenigsten wertvoll zuerst": prev_values
  // (Rohwert) vor changed_fields (abgeleitet) vor config_drift (#932) vor
  // prompt_fingerprint (an dem der ganze Fan-out haengt).
  //
  // #932: `config_drift` steht bewusst in dieser Leiter. Waere die Spalte nur
  // in der ersten Stufe enthalten, wuerde ein Deployment ohne die zugehoerige
  // Migration jeden Sync-Log-Insert in Stufe 1 scheitern lassen -- genau der
  // Ablauf vom 09.08., als `prev_values` in Produktion fehlte.
  const {
    prev_values: _prevColumn,
    changed_fields: _changedColumn,
    config_drift: _driftColumn,
    prompt_fingerprint: _fingerprintColumn,
    ...bareRow
  } = syncLogRow;
  const logAttempts = [
    syncLogRow,
    { ...bareRow, changed_fields: syncLogRow.changed_fields, config_drift: syncLogRow.config_drift, prompt_fingerprint: syncLogRow.prompt_fingerprint },
    { ...bareRow, config_drift: syncLogRow.config_drift, prompt_fingerprint: syncLogRow.prompt_fingerprint },
    { ...bareRow, prompt_fingerprint: syncLogRow.prompt_fingerprint },
    bareRow
  ];
  for (let attempt = 0; attempt < logAttempts.length; attempt += 1) {
    const { error: syncLogError } = await sb.from('elevenlabs_sync_log').insert(logAttempts[attempt]);
    if (!syncLogError) break;
    console.warn(`[elevenlabs-sync] sync_log_insert_failed (Stufe ${attempt + 1})`, syncLogError.message);
  }
  await trimSyncLogs(sb, customerId);

  const customerPatch = {
    elevenlabs_last_sync_at: new Date().toISOString(),
    elevenlabs_sync_status: syncStatus,
    elevenlabs_sync_error: syncError || null,
    updated_at: new Date().toISOString()
  };
  // #932: 'drift' heisst, der Agent wurde aktualisiert, weicht aber in
  // mindestens einem Feld ab. Ob die beiden folgenden Werte fortgeschrieben
  // werden duerfen, haengt deshalb nicht mehr am Gesamtstatus, sondern daran,
  // ob GENAU das jeweilige Feld angekommen ist. Sonst haette eine Abweichung
  // in, sagen wir, `temperature` den Fingerprint blockiert und den Kunden in
  // eine endlose Neuplanung geschickt.
  const greetingLanded = syncReachedAgent
    && !configDrift.some((deviation) => deviation.path === FIRST_MESSAGE_PATH);

  // Etappe 6 / S2: Das Kunden-Dashboard zeigt die Begruessung an. Damit dort nie
  // ein Satz steht, den der Agent nicht bekommen hat, wird die erste Nachricht
  // nur nach einem erfolgreichen Sync festgehalten.
  if (greetingLanded && compiled?.firstMessage) {
    customerPatch.ai_effective_greeting = compiled.firstMessage;
  }
  // S4 / Stufe 1: Der Ist-Fingerprint darf nur nach einem erfolgreichen Sync
  // fortgeschrieben werden -- sonst gaelte ein Kunde als aktuell, obwohl der
  // Agent den neuen Prompt nie bekommen hat, und der Fan-out uebersaehe ihn.
  if (syncReachedAgent && promptLanded && fingerprint) {
    customerPatch.prompt_fingerprint = fingerprint;
  }
  const { error: customerPatchError } = await sb.from('customers')
    .update(customerPatch)
    .eq('id', customerId);
  // Der Sync selbst gilt weiterhin als erfolgreich: der Agent ist bereits
  // aktualisiert. Ein fehlgeschlagener Patch darf das nicht umdeuten -- ein
  // `ok: false` wuerde einen Wiederholungsversuch ausloesen, der denselben
  // Prompt ein zweites Mal an ElevenLabs schickt, ohne dass das irgendetwas
  // repariert.
  //
  // Verschwiegen wird er trotzdem nicht: statePersisted sagt dem Aufrufer, dass
  // der Agent zwar steht, der Ist-Fingerprint aber NICHT fortgeschrieben wurde.
  // Der Kunde bleibt damit 'unknown' und wird vom naechsten Planungslauf erneut
  // eingeplant -- die Schleife schliesst sich also von selbst, aber sichtbar
  // statt still.
  if (customerPatchError) {
    console.warn('[elevenlabs-sync] customer_patch_failed', {
      customer_id: customerId,
      message: customerPatchError.message
    });
  }

  return {
    // #932: 'drift' zaehlt hier als erfolgreich -- Begruendung oben, wo der
    // Status gesetzt wird. Der Aufrufer sieht die Abweichung an `configDrift`
    // und `status`, nicht an `ok`.
    ok: syncReachedAgent,
    status: syncStatus,
    error: syncError,
    statePersisted: !customerPatchError,
    stateError: customerPatchError ? customerPatchError.message : null,
    promptLength: fullPrompt.length,
    promptVersion: compiled?.version,
    promptFingerprint: fingerprint,
    quality: compiled?.quality,
    configDrift,
    readbackSource,
    readbackError: readbackFailure,
    calendarToolStatus,
    calendarToolId,
    phoneNumberStatus,
    phoneNumberId,
    phoneNumber
  };
}

/**
 * S4 / Stufe 3 — Rollback: schreibt einen frueheren prompt_snapshot zurueck.
 *
 * Der Snapshot belegt genau den Prompt, nichts sonst. Alles andere zu
 * "rekonstruieren" hiesse weiterhin raten -- deshalb kommt es aus derselben
 * geteilten Definition wie beim Sync, nicht aus dem Snapshot.
 *
 * ── #932: warum das hier nicht minimal bleiben durfte ─────────────────────────
 *
 * Vorher sendete diese Funktion `{ agent: { prompt: { prompt } } }` -- also die
 * gleiche Form, die im Sync der Befund von #932 war, sogar ohne `tool_ids`. Da
 * ElevenLabs `agent.prompt` ersetzt statt zusammenzufuehren, hatte das zwei
 * Folgen, die als "bewusst minimal" gelesen wurden, aber keine waren:
 *
 *   1. dieselben sieben Felder fielen auf Anbieter-Standard wie beim Sync;
 *   2. `tool_ids` fehlte im ersetzten Objekt -- ein Rollback nahm dem Agenten
 *      damit sein Kalenderwerkzeug.
 *
 * Ein Fix, der nur den Sync repariert, haette die gefaehrlichere der beiden
 * Quellen stehen lassen: diese hier laeuft im Fehlerfall, also genau dann, wenn
 * niemand hinschaut.
 *
 * Die Begruessung bleibt unangetastet (`firstMessage` wird nicht gesetzt) --
 * ein Rollback dreht den Prompt zurueck, nicht die Anrede.
 *
 * Der Ist-Fingerprint wird geleert, nicht zurueckgesetzt: nach einem Rollback
 * ist der Stand des Agenten definitionsgemaess nicht der aktuelle, und
 * "unbekannt" ist die ehrliche Aussage. Der naechste Sync setzt ihn neu.
 */
async function restoreAgentPrompt({ sb, apiKey, customerId, agentId, prompt }) {
  // Der Kundensatz liefert Stimme und Sprache. Ohne ihn koennten wir den
  // Sollzustand nur raten -- und ein geratener Rollback ist schlimmer als
  // keiner.
  const { data: customer, error: customerError } = await sb.from('customers')
    .select('*')
    .eq('id', customerId)
    .maybeSingle();
  if (customerError || !customer) {
    return { ok: false, error: 'customer_not_found' };
  }

  // `tool_ids` auf demselben Weg wie im Sync. Ist die Kalender-Provisionierung
  // nicht konfiguriert, bleibt das Feld weg statt leer -- buildAgentConfig()
  // erklaert, warum ein leeres Array hier die falsche Aussage waere.
  let toolIds = null;
  try {
    if (calendarToolProvisioningConfigured()) {
      toolIds = await mergedAgentToolIds(agentId, await ensureWorkspaceTool());
    }
  } catch (error) {
    return { ok: false, error: `tool_ids_lookup_failed: ${error?.message || String(error)}` };
  }

  const desiredState = buildAgentConfig({ customer, prompt, toolIds });

  const elRes = await fetch(`${ELEVENLABS_BASE}/${encodeURIComponent(agentId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
    body: JSON.stringify(desiredState)
  });
  if (!elRes.ok) {
    const errText = await elRes.text();
    return { ok: false, error: `ElevenLabs ${elRes.status}: ${errText.substring(0, 300)}` };
  }

  // Punkt 1 gilt auch hier -- siehe oben, warum gerade hier.
  let configDrift = [];
  let readbackSource = 'not_attempted';
  let readbackFailure = null;
  try {
    let patchPayload = null;
    try {
      patchPayload = await elRes.json();
    } catch (_parseError) {
      patchPayload = null;
    }
    const readback = await readBackAgentState({ apiKey, agentId, patchPayload });
    readbackSource = readback.source;
    configDrift = compareAgentState(desiredState, readback.state);
  } catch (error) {
    readbackSource = 'failed';
    readbackFailure = error?.message || String(error);
    console.warn('[elevenlabs-sync] rollback_readback_failed', {
      customer_id: customerId,
      agent_id: agentId,
      message: readbackFailure
    });
  }

  const promptLanded = !configDrift.some((deviation) => deviation.path === PROMPT_PATH);
  const rollbackStatus = configDrift.length ? 'drift' : 'success';

  const rollbackLogRow = {
    customer_id: customerId,
    agent_id: agentId,
    status: rollbackStatus,
    triggered_by: 'fanout_rollback',
    prompt_snapshot: promptLanded ? prompt : null,
    prompt_length: String(prompt || '').length,
    error_message: configDrift.length
      ? `Agent weicht nach dem Rollback in ${configDrift.length} Feld(ern) vom Sollzustand ab: ${configDrift.map((d) => d.path).join(', ')}`.slice(0, 500)
      : null,
    config_drift: (configDrift.length || readbackFailure)
      ? { source: readbackSource, deviations: configDrift, error: readbackFailure }
      : null,
    created_at: new Date().toISOString()
  };
  // Dieselbe Stufenleiter wie oben: fehlt die config_drift-Spalte, darf das
  // nicht die ganze Rollback-Zeile kosten.
  const { config_drift: _driftColumn, ...bareRollbackRow } = rollbackLogRow;
  for (const attempt of [rollbackLogRow, bareRollbackRow]) {
    const { error: insertError } = await sb.from('elevenlabs_sync_log').insert(attempt);
    if (!insertError) break;
    console.warn('[elevenlabs-sync] rollback_log_insert_failed', insertError.message);
  }

  await sb.from('customers')
    .update({
      prompt_fingerprint: null,
      elevenlabs_last_sync_at: new Date().toISOString(),
      elevenlabs_sync_status: rollbackStatus,
      updated_at: new Date().toISOString()
    })
    .eq('id', customerId);

  // #932: Hier gilt NICHT dieselbe Regel wie beim Sync.
  //
  // Beim Sync ist 'drift' ein Erfolg: der Sollzustand ging raus, ein
  // Wiederholungsversuch saende denselben Koerper. Beim Rollback ist der
  // zurueckgeschriebene Prompt der ganze Zweck des Aufrufs. Weicht ausgerechnet
  // er ab, wurde der alte Stand nicht wiederhergestellt -- und ein `ok: true`
  // liesse rollbackRun() die Zeile als 'cancelled' abhaken, `rolled_back`
  // hochzaehlen und dem Bedienenden einen Rollback melden, den es nicht gab.
  // Das waere eine falsche Erfolgsmeldung im Notfall.
  //
  // Eine Abweichung in einem Nebenfeld ist dagegen unschaedlich: der Prompt
  // steht, und der Rest ist ohnehin der geteilte Sollzustand.
  if (!promptLanded) {
    return {
      ok: false,
      error: `Rollback nicht wirksam: der Agent traegt den zurueckgeschriebenen Prompt nicht (${configDrift.map((d) => d.path).join(', ')})`.slice(0, 500),
      status: rollbackStatus,
      configDrift,
      readbackSource,
      readbackError: readbackFailure
    };
  }

  return {
    ok: true,
    promptLength: String(prompt || '').length,
    status: rollbackStatus,
    configDrift,
    readbackSource,
    readbackError: readbackFailure
  };
}

module.exports = {
  syncCustomerToElevenLabs,
  restoreAgentPrompt,
  diffPrevValues,
  loadPromptInputs,
  trimSyncLogs,
  syncLogClass,
  SYNC_LOG_KEEP_PER_CLASS
};
