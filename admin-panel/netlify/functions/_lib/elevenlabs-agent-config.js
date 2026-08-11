'use strict';

// Der Sollzustand eines ElevenLabs-Agenten — fuer die PROVISIONIERUNG.
//
// ── Wofuer diese Datei gilt, und wofuer nicht ────────────────────────────────
//
// `buildAgentConfig()` beschreibt einen Agenten VOLLSTAENDIG und wird beim
// ANLEGEN benutzt (elevenlabs-provision-agent.js). Der Sync benutzt sie NICHT
// -- er sendet `buildSyncPatch()`, einen Ausschnitt. Die Trennung ist die
// Lehre aus #932; die Begruendung steht bei buildSyncPatch().
//
// ── Was #932 annahm, und was am 11.08. gemessen wurde ────────────────────────
//
// #932 nahm an, ElevenLabs ERSETZE `conversation_config.agent.prompt`, statt es
// zusammenzufuehren. Grundlage war eine Beobachtung vom 10.08.: Denkbudget von
// Hand ausgeschaltet, nach dem naechsten Sync wieder an.
//
// Diese Annahme ist WIDERLEGT. Am 11.08. um 20:36 UTC hat die Rueckleseprüfung
// den laufenden Produktivagenten gemessen (`elevenlabs_sync_log.config_drift`,
// `observed`). Befund:
//
//   conversation_config.agent.prompt.timezone = "Europe/Zurich"
//
// `timezone` liegt in `agent.prompt`, wird vom Sync nie gesendet, und
// `Europe/Zurich` ist kein plausibler Anbieter-Standard. Nach neun Syncs steht
// es unveraendert dort. Ebenso ueberlebt haben `temperature: 0.19`,
// `max_tokens: 1200`, `cascade_timeout_seconds: 8` -- und die Handeinstellungen
// vom 10.08. in `turn` und `tts`.
//
// **ElevenLabs fuehrt zusammen, auch auf der Ebene `agent.prompt`.** Ein Sync
// beschaedigt die Agentenkonfiguration nicht.
//
// ── Was damit OFFEN ist ──────────────────────────────────────────────────────
//
// Was am 10.08. das Denkbudget zurueckgesetzt hat, ist UNGEKLAERT. Wenn der
// PATCH es nicht war, hat ein anderer Pfad geschrieben -- oder die Beobachtung
// hat eine andere Erklaerung. Eine unerklaerte Beobachtung ist keine
// widerlegte. Sie wird als offener Punkt gefuehrt, nicht als erledigt.
//
// ── Warum die Werte hier trotzdem stimmen muessen ────────────────────────────
//
// Fuer bestehende Agenten ist diese Datei folgenlos. Fuer JEDEN NEU ANGELEGTEN
// Kunden ist sie der Startzustand -- und sie trug bis zum 11.08. die Werte von
// VOR der Abstimmung vom 10.08. Ein neuer Pilot waere mit Turn V2, laufendem
// Denkbudget, Audio-Tags und aktiver Wartefloskel gestartet.
//
// ── Herkunft der Werte: [A] und [B] ──────────────────────────────────────────
//
//   [A] ABGESTIMMT. Am 10.08. in der Oberflaeche eingestellt, gegen Testanrufe
//       geprueft, am 11.08. nach dem Sync bestaetigt. Das sind Entscheidungen.
//       Wer sie aendert, aendert ein Ergebnis -- und braucht einen Grund.
//
//   [B] VORGEFUNDEN. Am 11.08. am laufenden Agenten gemessen, aber von niemandem
//       bewusst gesetzt. Das sind Messwerte, keine Entscheidungen. Sie stehen
//       hier, damit ein neuer Agent dem bestehenden gleicht -- nicht, weil sie
//       geprueft waeren.
//
// Die Unterscheidung ist der Punkt: Ohne sie wird in drei Monaten ein Messwert
// fuer eine Entscheidung gehalten und mit derselben Ehrfurcht behandelt.
//
// Nicht markierte Felder sind [B].
//
// ── Bewusst NICHT Read-Modify-Write ──────────────────────────────────────────
//
// RMW haette den laufenden Agenten zur massgeblichen Quelle gemacht: eine
// falsche Handeinstellung bliebe fuer immer, stuende in keinem Repository und
// tauchte in keinem Diff auf. Beim Anlegen gilt diese Datei.

// Die Aufbewahrungsdauer fuer Audio und Transkript. Lag vorher doppelt vor
// (Provisionierung und Sync); hier ist sie einmal.
const AUDIO_TRANSCRIPT_RETENTION_DAYS = 90;

// Fallback-Stimme, wenn der Kunde keine hinterlegt hat (Lara).
const DEFAULT_VOICE_ID = '1iF3vHdwHKuVKSPDK23Z';

const DEFAULT_LANGUAGE = 'de';

// Kundenspezifisch — alles andere kommt unveraendert aus diesem Modul.
// Als dotted paths gefuehrt, damit die Rueckleseprüfung und der Test sie
// benennen koennen, ohne sie ein zweites Mal aufzuzaehlen.
const CUSTOMER_SPECIFIC_PATHS = Object.freeze([
  'conversation_config.agent.prompt.prompt',   // der gebaute Prompt
  'conversation_config.agent.first_message',   // die Begruessung
  'conversation_config.tts.voice_id',          // die Stimme
  // `language` steht nicht im urspruenglichen Auftragstext ("nur Prompt,
  // Begruessung und Stimme"), ist aber nachweislich kundenspezifisch: die
  // Provisionierung setzt es aus `customers.ai_language` (de/fr/it/en). Es hier
  // auf eine Konstante zu ziehen wuerde jeden fr/it/en-Agenten auf Deutsch
  // stellen -- genau die Klasse Schaden, die #932 abstellt.
  'conversation_config.agent.language',
  // Dynamisch aus der Kalender-Provisionierung, nicht aus dem Kundensatz.
  'conversation_config.agent.prompt.tool_ids'
]);

/**
 * Der Startzustand eines neu angelegten Agenten.
 *
 * Wer hier etwas aendert, aendert es fuer alle KUENFTIGEN Agenten. Bestehende
 * Agenten sind nicht betroffen -- der Sync sendet diese Datei nicht.
 *
 * Herkunft der Werte: [A] abgestimmt, [B] vorgefunden. Siehe Dateikopf.
 */
const AGENT_DEFINITION = Object.freeze({
  conversation_config: {
    asr: {
      quality: 'high',
      provider: 'scribe_realtime',
      user_input_audio_format: 'pcm_16000',
      keywords: []
    },
    turn: {
      // [A] Abgestimmt 10.08., am 11.08. nach dem Sync bestaetigt.
      turn_timeout: 5,
      // [A] Abgestimmt 10.08. In der Oberflaeche ueber "Zu Turn V3 wechseln";
      // der API-Wert `turn_v3` stammt aus der Messung vom 11.08., nicht aus
      // der Beschriftung.
      turn_model: 'turn_v3',
      // [B] Vorgefunden.
      silence_end_call_timeout: -1,
      mode: 'turn',
      turn_eagerness: 'eager',
      spelling_patience: 'auto',
      speculative_turn: true,
      retranscribe_on_turn_timeout: false,
      // [A] Abgestimmt 10.08. -- und der lehrreichste der fuenf Werte.
      //
      // Ausgeschaltet, weil "Einen Moment" vor jeder Antwort kam. Die
      // Aenderung war richtig, aber die Ursache lag woanders: Die Latenz kam
      // vom dynamisch rechnenden Denkbudget. Die Wartefloskel hat das
      // Latenzproblem KASCHIERT, nicht geloest -- sie war das Pflaster, das
      // erklaerte, warum es weh tut.
      //
      // Deshalb bleibt sie aus, auch nachdem das Denkbudget aus ist. Wer sie
      // wieder einschaltet, sollte das tun, weil eine gemessene Latenz es
      // rechtfertigt, nicht weil das Feld leer aussieht.
      //
      // "Aus" heisst `timeout_seconds: -1` (Messung 11.08.) -- das Objekt
      // bleibt bestehen, der Text ebenfalls, nur die Schwelle ist abgeschaltet.
      soft_timeout_config: {
        timeout_seconds: -1,
        message: 'Einen Moment',
        use_llm_generated_message: false  // Statisch — nie LLM-generiert
      }
    },
    tts: {
      // [B] Vorgefunden.
      model_id: 'eleven_v3_conversational',
      // [A] Abgestimmt 10.08. Die Tags erschienen als `[happy]` im Transkript;
      // nach dem Entfernen nicht mehr. Der expressive Modus ist aus -- die
      // Tags haengen daran und sind in der Oberflaeche seither nicht mehr
      // sichtbar.
      expressive_mode: false,
      suggested_audio_tags: [],
      agent_output_audio_format: 'pcm_16000',
      optimize_streaming_latency: 3,
      stability: 0.5,
      speed: 1,
      similarity_boost: 0.8,
      text_normalisation_type: 'system_prompt'
    },
    conversation: {
      text_only: false,
      max_duration_seconds: 600,
      client_events: ['audio', 'interruption', 'user_transcript', 'agent_response', 'agent_response_correction']
    },
    vad: { background_voice_detection: false },
    agent: {
      disable_first_message_interruptions: false,
      prompt: {
        // [A] Abgestimmt 10.08. "Aus" heisst `0` -- Messung vom 11.08., kein
        // `null` und kein Weglassen. Das dynamisch rechnende Denkbudget war
        // die Ursache der Latenzstreuung (756 ms / 1,8 s / 8,9 s im selben
        // Gespraech) und damit auch der Grund fuer die Wartefloskel oben.
        thinking_budget: 0,
        // [B] Vorgefunden -- alle fuenf am 11.08. am laufenden Agenten
        // gemessen, keine Entscheidung von uns.
        llm: 'gemini-2.5-flash',
        temperature: 0.19,
        max_tokens: 1200,
        timezone: 'Europe/Zurich',
        backup_llm_config: { preference: 'default' },
        cascade_timeout_seconds: 8
      }
    }
  },
  platform_settings: {
    data_collection: {
      caller_name: {
        type: 'string',
        description: 'Der vollständige Name der anrufenden Person, exakt wie sie sich selbst vorgestellt hat. Format: "Vorname Nachname". Nur eintragen wenn die Person ihren Namen explizit genannt hat. Niemals raten. Trage NIEMALS den Namen des Assistenten ein.'
      },
      caller_company: {
        type: 'string',
        description: 'Die Firma der anrufenden Person. Nur eintragen wenn explizit genannt. Trage NIEMALS die Firma des Assistenten ein.'
      },
      caller_email: {
        type: 'string',
        description: 'E-Mail-Adresse die der Anrufer mündlich angegeben hat. Nur eintragen wenn klar buchstabiert. Bei Unsicherheit leer lassen.'
      },
      call_summary: {
        type: 'string',
        description: 'Sachliche Zusammenfassung in 2-3 Sätzen auf Deutsch. IMMER auf Deutsch. Beginne mit dem Anliegen. Keine Floskeln.'
      },
      call_summary_short: {
        type: 'string',
        description: 'Kernanliegen in einem Satz auf Deutsch, max. 80 Zeichen. IMMER auf Deutsch. Keine Namen, keine Zeiten.'
      },
      callback_requested: {
        type: 'boolean',
        description: 'true wenn Anrufer Rückruf wünscht oder zugestimmt hat. false wenn kein Rückruf. Im Zweifel false.'
      },
      callback_time: {
        type: 'string',
        description: 'Gewünschter Rückruf-Zeitpunkt auf Deutsch. Leer wenn kein Zeitpunkt genannt.'
      },
      category: {
        type: 'string',
        description: 'Kategorie des Anliegens. Wähle einen der Enum-Werte.',
        enum: ['rueckrufanfrage', 'terminanfrage', 'informationsanfrage', 'offertenanfrage', 'beschwerde', 'aenderung_kuendigung', 'notfall', 'sonstiges']
      },
      lead_quality: {
        type: 'string',
        description: 'Geschäftspotenzial: hot = konkrete Handlungsabsicht. warm = allgemeines Interesse. cold = kein Geschäftsbezug. Im Zweifel warm.'
      },
      urgency: {
        type: 'string',
        description: 'Dringlichkeit: hoch / mittel / niedrig. Nur aus Anrufer-Aussagen ableiten.'
      },
      next_action: {
        type: 'string',
        description: 'Nächste konkrete Aktion auf Deutsch. "Keine Aktion nötig" wenn nichts zu tun.'
      }
    },
    summary_language: 'de',
    auth: { enable_auth: true, allowlist: [], require_origin_header: false },
    call_limits: { agent_concurrency_limit: 10, daily_limit: 500, bursting_enabled: true },
    privacy: { record_voice: true, retention_days: AUDIO_TRANSCRIPT_RETENTION_DAYS, zero_retention_mode: false },
    analysis_llm: 'gemini-2.5-flash'
  }
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Baut den vollstaendigen Sollzustand fuer einen Kunden.
 *
 * Dasselbe Ergebnis fuer beide Pfade: die Provisionierung schickt es an
 * `POST /create` (plus `name`), der Sync an `PATCH /{agent_id}`. Dass beide
 * denselben Koerper senden, ist der ganze Punkt von #932 -- ein Sync darf einen
 * Agenten nicht in einen Zustand bringen, den die Provisionierung nie erzeugt
 * haette.
 *
 * @param {object}   customer       Zeile aus `customers`
 * @param {string}   prompt         gebauter Prompt (Layer 1..n + Kalenderblock)
 * @param {string}   [firstMessage] Begruessung. `null`/`undefined` laesst das
 *                                  Feld weg, statt es zu leeren -- das Rollback
 *                                  braucht das, weil es den Prompt
 *                                  zurueckdreht, die Begruessung aber nicht
 *                                  anfassen soll.
 * @param {string[]} [toolIds]      Werkzeuge des Agenten; weggelassen, wenn die
 *                                  Kalender-Provisionierung nicht konfiguriert ist
 */
function buildAgentConfig({ customer = {}, prompt = '', firstMessage = null, toolIds = null } = {}) {
  const body = clone(AGENT_DEFINITION);

  body.conversation_config.agent.language = customer.ai_language || DEFAULT_LANGUAGE;
  if (firstMessage !== null && firstMessage !== undefined) {
    body.conversation_config.agent.first_message = firstMessage;
  }
  body.conversation_config.agent.prompt.prompt = prompt;
  body.conversation_config.tts.voice_id = customer.voice_id || DEFAULT_VOICE_ID;

  // `tool_ids` nur setzen, wenn wir sie kennen. Ein leeres Array waere die
  // Aussage "dieser Agent hat keine Werkzeuge" -- und wuerde dem Agenten das
  // Kalenderwerkzeug entziehen, sobald die Provisionierung einmal nicht
  // konfiguriert ist.
  if (Array.isArray(toolIds)) {
    body.conversation_config.agent.prompt.tool_ids = toolIds;
  }

  return body;
}

// ── Rueckleseprüfung ─────────────────────────────────────────────────────────
//
// Die Erwartung wird aus dem gesendeten Koerper abgeleitet, nicht aus einer
// zweiten Liste. Wer der Definition oben ein Feld hinzufuegt, bekommt die
// Pruefung dafuer ohne weiteres Zutun -- und genau deshalb faengt sie auch die
// naechste Auspraegung dieser Fehlerklasse, die wir heute noch nicht kennen.

const ARRAY_ORDER_IRRELEVANT = new Set([
  'conversation_config.agent.prompt.tool_ids'
]);

/**
 * Flacht den gesendeten Koerper zu `dotted.path -> Wert` ab.
 * Arrays gelten als Blatt (sie werden als Ganzes verglichen), `undefined`
 * faellt weg -- so, wie JSON.stringify es auch aus dem Koerper entfernt.
 */
function expectedLeaves(body, prefix = '', out = new Map()) {
  for (const [key, value] of Object.entries(body || {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value === undefined) continue;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      expectedLeaves(value, path, out);
    } else {
      out.set(path, value);
    }
  }
  return out;
}

function valueAtPath(source, path) {
  let cursor = source;
  for (const segment of path.split('.')) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

// Ein Gleitkommavergleich mit `!==` erzeugt Phantom-Abweichungen, sobald der
// Anbieter 0.19 als 0.19000000000000003 zurueckgibt. Dieselbe Falle wie in
// diffPrevValues(), dort fuer jsonb.
const FLOAT_EPSILON = 1e-9;

function valuesMatch(path, expected, actual) {
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) return false;
    const [a, b] = ARRAY_ORDER_IRRELEVANT.has(path)
      ? [[...expected].map(String).sort(), [...actual].map(String).sort()]
      : [expected, actual];
    return JSON.stringify(a) === JSON.stringify(b);
  }
  if (typeof expected === 'number' && typeof actual === 'number') {
    return Math.abs(expected - actual) <= FLOAT_EPSILON;
  }
  return JSON.stringify(expected) === JSON.stringify(actual);
}

// Der Prompt ist mehrere Kilobyte gross. Er gehoert in die Abweichungsmeldung
// nur so weit, dass man ihn wiedererkennt -- `prompt_snapshot` haelt ihn ohnehin
// vollstaendig, und ein Log, das in einer Zeile den halben Prompt zweimal
// traegt, liest niemand.
const VALUE_EXCERPT_LIMIT = 160;

function excerpt(value) {
  if (value === undefined) return null;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text === undefined) return null;
  return text.length > VALUE_EXCERPT_LIMIT
    ? `${text.slice(0, VALUE_EXCERPT_LIMIT)}… (${text.length} Zeichen)`
    : text;
}

/**
 * Vergleicht den zurueckgelesenen Agenten gegen den gesendeten Sollzustand.
 *
 * @returns {Array<{path:string, reason:'missing'|'mismatch', expected:*, actual:*}>}
 *          leer, wenn der Agent den Sollzustand traegt
 */
function compareAgentState(sentBody, agentState) {
  const deviations = [];
  for (const [path, expected] of expectedLeaves(sentBody)) {
    const actual = valueAtPath(agentState, path);
    if (actual === undefined) {
      deviations.push({ path, reason: 'missing', expected: excerpt(expected), actual: null });
      continue;
    }
    if (!valuesMatch(path, expected, actual)) {
      deviations.push({ path, reason: 'mismatch', expected: excerpt(expected), actual: excerpt(actual) });
    }
  }
  return deviations;
}

/**
 * Erkennt, ob eine Antwort bereits den vollstaendigen Agenten traegt.
 * Wenn ja, ist die Rueckleseprüfung kostenlos und ein GET entfaellt.
 */
function looksLikeAgentState(payload) {
  return Boolean(payload && typeof payload === 'object' && payload.conversation_config);
}

// ── Der Sync-Koerper ────────────────────────────────────────────────────────
//
// ACHTUNG: Der Sync sendet bewusst NICHT den vollstaendigen Sollzustand.
//
// #932 ging davon aus, ElevenLabs ersetze `conversation_config.agent.prompt`,
// statt es zusammenzufuehren. Diese Annahme stuetzte sich auf eine einzige
// Beobachtung vom 10.08. (Denkbudget von Hand aus, nach dem naechsten Sync
// wieder an). Am 11.08. standen ihr acht Gegenbeobachtungen gegenueber: acht
// nachweislich erfolgreich gepatchte Syncs, ueber die ein erneut
// ausgeschaltetes Denkbudget hinweg bestehen blieb.
//
// Solange das nicht entschieden ist, waere der vollstaendige Sollzustand ein
// Risiko ohne Gegenwert: Die Definition traegt Werte von VOR der Abstimmung vom
// 10.08. und wuerde Turn V3, das ausgeschaltete Denkbudget, die entfernten
// Audio-Tags und die Wartefloskel zurueckstellen -- ausgeloest schon durch eine
// Kundenaenderung im Dashboard (`customer_self_edit`).
//
// Deshalb sendet der Sync wieder genau das, was er vor #932 sendete. Was aus
// #932 BLEIBT, ist die Rueckleseprüfung: siehe observeAgentState() unten.
function buildSyncPatch({ customer = {}, prompt = '', firstMessage = null, toolIds = null } = {}) {
  const promptPatch = { prompt };
  if (Array.isArray(toolIds)) promptPatch.tool_ids = toolIds;

  const agent = { prompt: promptPatch };
  if (firstMessage !== null && firstMessage !== undefined) agent.first_message = firstMessage;

  return {
    conversation_config: {
      agent,
      tts: customer.voice_id ? { voice_id: customer.voice_id } : undefined
    },
    platform_settings: {
      privacy: {
        record_voice: true,
        retention_days: AUDIO_TRANSCRIPT_RETENTION_DAYS,
        zero_retention_mode: false
      }
    }
  };
}

// ── Beobachtung ohne Zusicherung ────────────────────────────────────────────
//
// Das ist der Teil von #932, der ueberlebt -- und der Grund, warum ein
// vollstaendiger Revert die schlechtere Wahl waere.
//
// Die Rueckleseprüfung vergleicht weiterhin, was wir GESENDET haben. Zusaetzlich
// haelt sie hier fest, was der Agent bei den Feldern traegt, die wir NICHT
// senden. Das ist keine Zusicherung: Weicht etwas ab, ist das kein Befund,
// sondern eine Messung.
//
// Zweck: Genau diese Felder entscheiden die offene Frage, ob ElevenLabs
// `agent.prompt` ersetzt oder zusammenfuehrt. `timezone` ist der sauberste
// Unterscheider -- es liegt in `agent.prompt`, wird vom Sync nie gesendet, und
// `Europe/Zurich` ist kein plausibler Anbieter-Standard. Traegt der Agent es
// nach einem Sync weiterhin, ist die Ersetzung widerlegt.
//
// Die Schluessellisten beantworten nebenbei eine zweite offene Frage: ob die
// neue Oberflaechen-Einstellung "Standardpersoenlichkeit" ueberhaupt ein Feld
// im Koerper ist. Steht sie in `_keys`, ist sie eins.
const OBSERVED_TURN_FIELDS = ['turn_model', 'turn_timeout', 'turn_eagerness', 'speculative_turn', 'soft_timeout_config'];
const OBSERVED_TTS_FIELDS = ['model_id', 'expressive_mode', 'suggested_audio_tags', 'stability', 'speed', 'similarity_boost', 'text_normalisation_type'];

function observeAgentState(agentState) {
  const cc = agentState?.conversation_config;
  if (!cc || typeof cc !== 'object') return null;

  const promptObj = cc.agent?.prompt || {};
  // Der Prompt selbst ist mehrere Kilobyte gross und steht ohnehin in
  // prompt_snapshot. Hier interessieren nur die Nachbarfelder.
  const promptFields = {};
  for (const [key, value] of Object.entries(promptObj)) {
    if (key === 'prompt' || key === 'tool_ids') continue;
    promptFields[key] = value;
  }

  const pick = (source, keys) => {
    const out = {};
    for (const key of keys) if (source && key in source) out[key] = source[key];
    return out;
  };

  return {
    agent_prompt: promptFields,
    agent_language: cc.agent?.language ?? null,
    turn: pick(cc.turn, OBSERVED_TURN_FIELDS),
    tts: pick(cc.tts, OBSERVED_TTS_FIELDS),
    asr_provider: cc.asr?.provider ?? null,
    // Schluesselinventar: zeigt Felder, die wir gar nicht kennen.
    _keys: {
      conversation_config: Object.keys(cc).sort(),
      agent: Object.keys(cc.agent || {}).sort(),
      platform_settings: Object.keys(agentState.platform_settings || {}).sort()
    }
  };
}

module.exports = {
  AGENT_DEFINITION,
  AUDIO_TRANSCRIPT_RETENTION_DAYS,
  DEFAULT_VOICE_ID,
  DEFAULT_LANGUAGE,
  CUSTOMER_SPECIFIC_PATHS,
  // Nur die Provisionierung: der vollstaendige Sollzustand beim ANLEGEN eines
  // Agenten. Der Sync benutzt buildSyncPatch() -- die Begruendung steht dort.
  buildAgentConfig,
  buildSyncPatch,
  expectedLeaves,
  compareAgentState,
  observeAgentState,
  looksLikeAgentState
};
