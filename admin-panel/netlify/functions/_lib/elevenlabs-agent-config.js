'use strict';

// #932 — Eine Definition des Agenten-Sollzustands fuer beide Schreibpfade.
//
// Vorher gab es zwei Stellen, die einen ElevenLabs-Agenten beschrieben:
// `elevenlabs-provision-agent.js` (AGENT_TEMPLATE, vollstaendig, einmalig beim
// Anlegen) und `_lib/elevenlabs-sync.js` (ein Ausschnitt, bei jedem Sync). Der
// Ausschnitt gewann, weil er oefter laeuft.
//
// ── Der Befund ────────────────────────────────────────────────────────────────
//
// Der Sync sendete `conversation_config.agent.prompt` als `{ prompt, tool_ids }`.
// Die Provisionierung setzt dort sieben weitere Felder: llm, thinking_budget,
// temperature, max_tokens, timezone, backup_llm_config, cascade_timeout_seconds.
// ElevenLabs ersetzt dieses Objekt, statt es zusammenzufuehren -- die sieben
// Felder fielen bei jedem Sync auf Anbieter-Standard zurueck. Belegt an einem
// von Hand ausgeschalteten Denkbudget, das nach dem naechsten Sync wieder an war.
//
// ── Warum nur `prompt` und nicht `agent` insgesamt ────────────────────────────
//
// Die Zusammenfuehrung greift auf der Ebene darueber sehr wohl. Zwei Belege:
//
//   1. `platform_settings`: der Sync sendete dort nur `privacy`, und
//      `data_collection` (die strukturierte Auswertung) ueberlebte das
//      nachweislich -- die Auswertung funktioniert weiterhin.
//
//   2. `conversation_config.agent`: der Sync sendete `{ prompt, first_message }`
//      -- ohne `language`. Gesetzt wird `agent.language` ausschliesslich beim
//      Anlegen (elevenlabs-provision-agent.js, aus `customers.ai_language`);
//      keine andere Codestelle im Repo schreibt es je nach, und ausser
//      Provisionierung und Sync ruehrt nichts den Endpunkt `convai/agents` an.
//      Wuerde `agent` genauso ersetzt wie `agent.prompt`, waeren saemtliche
//      fr/it/en-Agenten seit ihrem jeweils ersten Sync auf Standardsprache
//      gefallen. Das ist nicht eingetreten.
//
// Daraus folgt: die Zusammenfuehrung steigt in `agent` hinein und ersetzt erst
// auf der Ebene `agent.prompt`. `prompt` ist die Ausnahme, nicht die Regel --
// es liest sich wie ein eigenes typisiertes Teilmodell, dessen nicht gesendete
// Felder beim Deserialisieren auf Schema-Standard materialisiert werden.
//
// Belegstatus nach AGENTS.md: Punkt 1 ist Tatsache (beobachtet). Punkt 2 ist
// eine Ableitung aus einer Nicht-Beobachtung -- gut gestuetzt, aber nicht
// gemessen. Die Rueckleseprüfung in elevenlabs-sync.js misst beides ab dem
// ersten Produktivlauf und macht die Ableitung damit ueberpruefbar, statt sie
// als Annahme stehen zu lassen.
//
// ── Die Konsequenz, die gewollt ist ───────────────────────────────────────────
//
// Bewusst NICHT Read-Modify-Write. RMW haette den laufenden Agenten zur
// massgeblichen Quelle gemacht: eine falsche Handeinstellung bliebe dann fuer
// immer, stuende in keinem Repository und tauchte in keinem Diff auf -- ein
// sichtbarer Fehler waere gegen einen unsichtbaren getauscht.
//
// Stattdessen ist diese Datei der Sollzustand. Jeder Sync sendet ihn
// vollstaendig. Handeinstellungen in der ElevenLabs-Oberflaeche halten damit
// nicht mehr -- das ist die beabsichtigte Wirkung, nicht ein Nebeneffekt.
// Kundenspezifisch bleiben genau die Felder in CUSTOMER_SPECIFIC_PATHS.

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
 * Der geteilte Sollzustand. Alles hier ist anbieterunabhaengig vom Kunden --
 * zwei Kunden mit derselben Sprache und Stimme bekommen exakt diese Werte.
 *
 * Uebernommen aus AGENT_TEMPLATE in elevenlabs-provision-agent.js, damit der
 * Umstieg fuer bestehende Agenten wertidentisch ist. Wer hier etwas aendert,
 * aendert es fuer alle Agenten beim naechsten Sync.
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
      turn_timeout: 3,
      silence_end_call_timeout: -1,
      mode: 'turn',
      turn_eagerness: 'eager',
      spelling_patience: 'auto',
      speculative_turn: true,
      retranscribe_on_turn_timeout: false,
      turn_model: 'turn_v2',
      soft_timeout_config: {
        timeout_seconds: 3,
        message: 'Einen Moment',
        use_llm_generated_message: false  // Statisch — nie LLM-generiert
      }
    },
    tts: {
      model_id: 'eleven_v3_conversational',
      expressive_mode: true,
      suggested_audio_tags: [
        { tag: 'Geduldig',   description: '' },
        { tag: 'Einfühlsam', description: '' },
        { tag: 'Herzlich',   description: '' }
      ],
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
        // Genau die sieben Felder, die #932 verloren gingen.
        llm: 'gemini-2.5-flash',
        thinking_budget: 1024,
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
