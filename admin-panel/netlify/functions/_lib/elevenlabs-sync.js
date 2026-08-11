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
  findWorkspaceToolId,
  agentToolIds,
  calendarPromptBlock
} = require('./elevenlabs-calendar-tool');
const { ensureAgentPhoneNumber } = require('./elevenlabs-phone-number');
const { promptFingerprint } = require('./prompt-fingerprint');

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1/convai/agents';
const AUDIO_TRANSCRIPT_RETENTION_DAYS = 90;
const SYNC_LOG_KEEP_PER_CLASS = 10;

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

    // ── Welcher Schalter beantwortet welche Frage ───────────────────────────
    //
    // Festgelegt am 2026-08-10 (#930), nachdem vier Schalter unabhaengig
    // voneinander dieselbe Frage beantwortet hatten und keiner den anderen
    // kannte. Wer hier einen fuenften ergaenzen will, ordnet ihn bitte zuerst
    // in diese Liste ein:
    //
    //   customers.ai_appointment_mode   FACHLICH FUEHREND. "Was darf der
    //                                   Assistent bei Terminwuenschen tun?"
    //                                   none | request | direct. Steuert
    //                                   Kalenderblock und Werkzeugzuweisung.
    //   calendar_settings.feature_enabled
    //                                   Technischer Anschlussstatus. "Ist ein
    //                                   Kalender verbunden und nutzbar?" Sagt
    //                                   nichts darueber, ob gebucht werden darf.
    //   CALENDAR_ROLLOUT_CUSTOMER_IDS   Erprobungs-Allowlist. Entfaellt mit dem
    //                                   Ende der Erprobung.
    //   voxera_addons.coming_soon       Reine Preisangabe. Ohne Sperrwirkung --
    //                                   customer_addons ist systemweit leer, die
    //                                   Tabelle wirkt im Betrieb nicht.
    //
    // Der Modus kommt aus buildPromptV2() und wird hier NICHT neu abgeleitet:
    // die Rangfolge zwischen typisierter Spalte und Altbestand steht an genau
    // einer Stelle.
    const appointmentMode = compiled.appointmentMode || '';
    const calendarBlock = calendarPromptBlock(inputs.calendarSettings || {}, appointmentMode);
    fullPrompt = [compiled.prompt, calendarBlock].filter(Boolean).join('\n\n');

    // Nur bei `direct` gehoert das Werkzeug an den Agenten. Bei `none` und
    // `request` wird es aktiv ENTFERNT, nicht bloss nicht hinzugefuegt -- sonst
    // bliebe es haengen, sobald es einmal dran war, und der Modus waere ein
    // Schalter mit nur einer Richtung.
    let toolIds;
    if (calendarToolProvisioningConfigured()) {
      if (appointmentMode === 'direct') {
        calendarToolId = await ensureWorkspaceTool();
        toolIds = await agentToolIds(agentId, calendarToolId, { attach: true });
        calendarToolStatus = 'configured';
      } else {
        // findWorkspaceToolId() statt ensureWorkspaceTool(): zum Entfernen
        // genuegt die ID, und ein Kunde ohne Direktbuchung ist kein Anlass, das
        // Werkzeug im Arbeitsbereich anzulegen.
        calendarToolId = await findWorkspaceToolId();
        toolIds = await agentToolIds(agentId, calendarToolId, { attach: false });
        calendarToolStatus = 'detached';
      }
    } else if (calendarBlock) {
      throw new Error('calendar_tool_provisioning_configuration_missing');
    }

    const promptPatch = { prompt: fullPrompt };
    if (toolIds) promptPatch.tool_ids = toolIds;

    const elRes = await fetch(`${ELEVENLABS_BASE}/${encodeURIComponent(agentId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey
      },
      body: JSON.stringify({
        conversation_config: {
          agent: {
            prompt: promptPatch,
            first_message: compiled.firstMessage
          },
          tts: customer.voice_id ? { voice_id: customer.voice_id } : undefined
        },
        platform_settings: {
          privacy: {
            record_voice: true,
            retention_days: AUDIO_TRANSCRIPT_RETENTION_DAYS,
            zero_retention_mode: false
          }
        }
      })
    });

    if (!elRes.ok) {
      const errText = await elRes.text();
      throw new Error(`ElevenLabs ${elRes.status}: ${errText.substring(0, 300)}`);
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

  const changedFields = diffPrevValues(prevValues, customer);
  const syncLogRow = {
    customer_id: customerId,
    agent_id: agentId,
    status: syncStatus,
    triggered_by: triggeredBy,
    prompt_snapshot: syncStatus === 'success' ? fullPrompt : null,
    prompt_length: fullPrompt.length,
    error_message: syncError,
    changed_fields: Object.keys(changedFields).length ? changedFields : null,
    prev_values: Object.keys(prevValues || {}).length ? prevValues : null,
    prompt_fingerprint: fingerprint,
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
  // (Rohwert) vor changed_fields (abgeleitet) vor prompt_fingerprint (an dem
  // der ganze Fan-out haengt).
  const {
    prev_values: _prevColumn,
    changed_fields: _changedColumn,
    prompt_fingerprint: _fingerprintColumn,
    ...bareRow
  } = syncLogRow;
  const logAttempts = [
    syncLogRow,
    { ...bareRow, changed_fields: syncLogRow.changed_fields, prompt_fingerprint: syncLogRow.prompt_fingerprint },
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
  // Etappe 6 / S2: Das Kunden-Dashboard zeigt die Begruessung an. Damit dort nie
  // ein Satz steht, den der Agent nicht bekommen hat, wird die erste Nachricht
  // nur nach einem erfolgreichen Sync festgehalten.
  if (syncStatus === 'success' && compiled?.firstMessage) {
    customerPatch.ai_effective_greeting = compiled.firstMessage;
  }
  // S4 / Stufe 1: Der Ist-Fingerprint darf nur nach einem erfolgreichen Sync
  // fortgeschrieben werden -- sonst gaelte ein Kunde als aktuell, obwohl der
  // Agent den neuen Prompt nie bekommen hat, und der Fan-out uebersaehe ihn.
  if (syncStatus === 'success' && fingerprint) {
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
    ok: syncStatus === 'success',
    status: syncStatus,
    error: syncError,
    statePersisted: !customerPatchError,
    stateError: customerPatchError ? customerPatchError.message : null,
    promptLength: fullPrompt.length,
    promptVersion: compiled?.version,
    promptFingerprint: fingerprint,
    quality: compiled?.quality,
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
 * Bewusst minimal: nur der Prompt, keine tool_ids, keine Stimme, keine
 * Telefonnummer. Ein Rollback soll den Zustand herstellen, der nachweislich
 * einmal live war -- und der Snapshot belegt genau den Prompt, nichts sonst.
 * Alles Weitere zu "rekonstruieren" hiesse raten.
 *
 * Der Ist-Fingerprint wird dabei geleert, nicht zurueckgesetzt: nach einem
 * Rollback ist der Stand des Agenten definitionsgemaess nicht der aktuelle,
 * und "unbekannt" ist die ehrliche Aussage. Der naechste Sync setzt ihn neu.
 */
async function restoreAgentPrompt({ sb, apiKey, customerId, agentId, prompt }) {
  const elRes = await fetch(`${ELEVENLABS_BASE}/${encodeURIComponent(agentId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
    body: JSON.stringify({
      conversation_config: { agent: { prompt: { prompt } } }
    })
  });
  if (!elRes.ok) {
    const errText = await elRes.text();
    return { ok: false, error: `ElevenLabs ${elRes.status}: ${errText.substring(0, 300)}` };
  }

  await sb.from('elevenlabs_sync_log').insert({
    customer_id: customerId,
    agent_id: agentId,
    status: 'success',
    triggered_by: 'fanout_rollback',
    prompt_snapshot: prompt,
    prompt_length: String(prompt || '').length,
    created_at: new Date().toISOString()
  });

  await sb.from('customers')
    .update({
      prompt_fingerprint: null,
      elevenlabs_last_sync_at: new Date().toISOString(),
      elevenlabs_sync_status: 'success',
      updated_at: new Date().toISOString()
    })
    .eq('id', customerId);

  return { ok: true, promptLength: String(prompt || '').length };
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
