'use strict';

// #932 — Eine Definition des Agenten-Sollzustands fuer beide Schreibpfade.
//
// Vorher gab es zwei Stellen, die einen ElevenLabs-Agenten beschrieben:
// `elevenlabs-provision-agent.js` (AGENT_TEMPLATE, vollstaendig, einmalig beim
// Anlegen) und `_lib/elevenlabs-sync.js` (ein Ausschnitt, bei jedem Sync). Der
// Ausschnitt gewann, weil er oefter laeuft.
//
// ── Der urspruengliche Befund, und was daraus geworden ist ───────────────────
//
// #932 ging von einer Annahme aus: ElevenLabs ERSETZE `agent.prompt`, statt es
// zusammenzufuehren, weshalb die sieben Nachbarfelder des Prompts (llm,
// thinking_budget, temperature, max_tokens, timezone, backup_llm_config,
// cascade_timeout_seconds) bei jedem Sync auf Anbieter-Standard zurueckfielen.
// Grundlage war eine einzelne Beobachtung vom 10.08.: ein von Hand
// ausgeschaltetes Denkbudget war nach dem Sync um 14:20 wieder an.
//
// ── Die Annahme ist widerlegt (11.08.) ───────────────────────────────────────
//
// ElevenLabs FUEHRT `conversation_config.agent.prompt` ZUSAMMEN. Beleg:
//
//   `timezone: Europe/Zurich` und `temperature: 0.19` liegen in `agent.prompt`
//   und werden ausschliesslich beim Anlegen gesetzt. Kein Sync hat sie je
//   gesendet -- #932 war produktiv nur zwischen 18:25 und 20:21 UTC am 11.08.,
//   und in diesem Fenster lief kein einziger Sync (`elevenlabs_sync_log`).
//   Beide Werte traegt der Agent nach 13 protokollierten Syncs unveraendert,
//   die beiden vom 10.08. 14:20 eingeschlossen. Bei Ersetzung waeren sie weg.
//   `0.19` ist dabei der belastbarere der beiden: bei `Europe/Zurich` liesse
//   sich noch ueber einen Arbeitsbereich-Standard streiten, bei 0.19 nicht.
//
// Damit scheidet der PATCH als Ursache aus. Die drei schreibenden Codepfade
// sind einzeln ausgeschlossen: Provisionierung (Agent aelter als der Vorfall),
// Rollback (`restoreAgentPrompt()` -- keine Zeile `triggered_by =
// 'fanout_rollback'`), Sync (siehe oben).
//
// WAS DAS DENKBUDGET AM 10.08. ZURUECKGESETZT HAT, IST WEITERHIN OFFEN.
// Widerlegt ist die Erklaerung, nicht die Beobachtung -- der Unterschied ist
// wichtig, sonst gilt der Vorfall faelschlich als abgeschlossen. Der
// wahrscheinlichste verbliebene Kandidat: die Einstellung war nie gesetzt. Die
// Oberflaeche zeigt bei fehlendem Feld moeglicherweise etwas anderes an als bei
// gesetztem, und was nach dem Sync sichtbar wurde, war der erste ehrliche
// Serverwert nach einem Neuladen. Nachweisbar ist das rueckwirkend nicht: die
// Rueckleseprüfung, die es festgehalten haette, gibt es erst seit dem 11.08.
// Siehe #932.
//
// ── Warum der Sync trotzdem nur den Ausschnitt sendet ────────────────────────
//
// Weil der Grund fuer #932 damit entfallen ist. Der vollstaendige Sollzustand
// waere jetzt ein Risiko ohne Gegenwert: er wuerde Handeinstellungen
// ueberschreiben, ausgeloest schon durch eine Kundenaenderung im Dashboard.
// Der Sync sendet deshalb wieder den Ausschnitt -- siehe buildSyncPatch().
//
// Das hat einen Preis, und der gehoert hierher: von 75 Blaettern, die die
// Provisionierung setzt, sendet der Sync 7. Die uebrigen 68 werden genau
// einmal geschrieben, beim Anlegen, und nie wieder geprueft. Fuer die
// kundenunabhaengigen Konstanten ist das gewollt. Fuer kundenABHAENGIGE Felder
// ist es ein Defekt: sie koennen sich nach dem Anlegen aendern, und nichts
// zieht sie nach. Genau ein solches Feld gibt es heute --
// `conversation_config.agent.language` aus `customers.ai_language`. Siehe die
// Anmerkung an CUSTOMER_SPECIFIC_PATHS.
//
// ── Was bleibt ───────────────────────────────────────────────────────────────
//
// Bewusst NICHT Read-Modify-Write. RMW haette den laufenden Agenten zur
// massgeblichen Quelle gemacht: eine falsche Handeinstellung bliebe dann fuer
// immer, stuende in keinem Repository und tauchte in keinem Diff auf -- ein
// sichtbarer Fehler waere gegen einen unsichtbaren getauscht.
//
// Und die Rueckleseprüfung. Sie ist der Teil von #932, der Bestand hat: sie
// hat die Frage entschieden, an der #932 gescheitert ist.

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
  // Provisionierung setzt es aus `customers.ai_language` (de/fr/it/en).
  //
  // ACHTUNG -- diese Liste ist eine Zusicherung, die der Sync heute NICHT
  // einloest. `buildSyncPatch()` sendet die vier anderen Pfade, `language`
  // nicht. Damit ist es das einzige kundenabhaengige Feld, das genau einmal
  // geschrieben wird: beim Anlegen. Aendert ein Kunde danach seine Sprache --
  // etwa beim Wechsel auf den Professional-Plan, der die Sprachwahl im Wizard
  // erst freischaltet --, spricht der Agent dauerhaft weiter Deutsch, ohne dass
  // irgendetwas es korrigiert oder meldet.
  //
  // Nicht in diesem Commit behoben, weil der Fix die Sync-Nutzlast aendert und
  // vor dem naechsten Testanruf nichts an ihr geaendert werden soll. Der Fix
  // hat zwei Teile und beide gehoeren zusammen: `language` in
  // `buildSyncPatch()` aufnehmen, UND eine Pruefung, die genau diese Liste
  // gegen die Pfade der Nutzlast haelt. Ohne den zweiten Teil faellt das
  // naechste kundenabhaengige Feld genauso lautlos heraus.
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
 * aendert es fuer alle Agenten beim naechsten Anlegen.
 *
 * ── Herkunft der Werte: [E] und [M] ─────────────────────────────────────────
 *
 * Diese Datei ist heute die einzige Stelle, an der der Sollzustand steht, und
 * sie mischt zwei voellig verschiedene Arten von Wert. Wer das nicht sieht,
 * haelt in drei Monaten einen Messwert fuer eine Entscheidung und dreht ihn
 * beim naechsten Aufraeumen zurueck.
 *
 *   [E]  ENTSCHIEDEN. Von Umut am 10./11.08.2026 nach Testanrufen abgestimmt.
 *        Diese Werte haben einen Grund, der nicht im Code steht, sondern in
 *        einem Anruf. Nicht ohne Ruecksprache aendern.
 *
 *   [M]  GEMESSEN. Am 11.08. aus dem laufenden Agenten zurueckgelesen
 *        (observeAgentState(), Sync 20:36 UTC) und uebernommen, damit
 *        Provisionierung und laufender Agent nicht auseinanderlaufen. Das ist
 *        eine Beschreibung des Ist-Zustands, keine Festlegung. Wer einen
 *        besseren Wert hat, darf ihn setzen.
 *
 * Ohne Markierung: unveraendert aus dem urspruenglichen AGENT_TEMPLATE, nie
 * bewusst entschieden und nie geprueft. Das ist die dritte Klasse, und sie ist
 * die groesste -- sie hier nicht als [E] auszuweisen ist Absicht.
 *
 * Warum die [E]-Werte ueberhaupt hier stehen muessen: Der Sync sendet sie nicht
 * (siehe buildSyncPatch()). Sie kommen also ausschliesslich beim Anlegen an.
 * Stuende hier weiter der Stand von vor dem 10.08., bekaeme jeder neu angelegte
 * Kunde einen Agenten mit Turn V2, drei Sekunden Wartefloskel und
 * eingeschaltetem Denkbudget -- also genau die Konfiguration, die wir an
 * unserem eigenen Agenten von Hand abgestellt haben.
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
      turn_timeout: 5,                    // [E] 10.08. — vorher 3
      silence_end_call_timeout: -1,
      mode: 'turn',
      turn_eagerness: 'eager',            // [M]
      spelling_patience: 'auto',
      speculative_turn: true,             // [M]
      retranscribe_on_turn_timeout: false,
      turn_model: 'turn_v3',              // [E] 10.08. — vorher turn_v2

      // [E] AUS. Die Wartefloskel ist abgeschaltet (-1), nicht verkuerzt.
      //
      // Sie sprang nach drei Sekunden an und sagte "Einen Moment". Das klang
      // nach einer Reaktion, war aber eine Ansage darueber, dass keine kommt:
      // sie hat ein Latenzproblem kaschiert, statt es zu loesen. Wer sie
      // hoert, wartet danach genauso lange -- nur mit dem Eindruck, es liege
      // an ihm. Ein Fuellsatz, der immer denselben Wortlaut hat, wird ausserdem
      // beim zweiten Mal im selben Gespraech als Defekt gehoert.
      //
      // Was beim Abschalten sichtbar wurde, gehoert dazu, sonst wird der
      // naechste Befund falsch gelesen: Die Floskel war zugleich ein
      // Zughaltesignal. Solange sie sprach, wusste die anrufende Person, dass
      // die Leitung steht und sie nicht dran ist. Ohne sie entstehen an
      // derselben Stelle drei Sekunden Stille -- und die Rueckmeldung darauf
      // war "das ist nervig". Das ist keine Gegenanzeige zum Abschalten,
      // sondern der Beleg, dass zwei Aufgaben in einem Feld staken.
      //
      // Die Latenz ist damit unverdeckt und weiterhin offen. Ein Ersatz fuer
      // das Zughaltesignal -- falls einer kommt -- gehoert nicht hierher,
      // sondern dorthin, wo er nicht zugleich eine Verzoegerung verschweigt.
      //
      // `message` bleibt stehen: bei timeout_seconds -1 ist sie wirkungslos,
      // und ein geleertes Feld saehe aus wie ein vergessener Wert.
      soft_timeout_config: {
        timeout_seconds: -1,              // [E] 10.08. — vorher 3
        message: 'Einen Moment',          // wirkungslos, solange -1
        use_llm_generated_message: false  // Statisch — nie LLM-generiert
      }
    },
    tts: {
      model_id: 'eleven_v3_conversational',
      // [E] Keine Audio-Tags. Der Agent sprach Klammerausdruecke wie
      // "[Geduldig]" laut mit, statt sie als Regieanweisung zu behandeln.
      expressive_mode: false,             // [E] 10.08. — vorher true
      suggested_audio_tags: [],           // [E] 10.08. — vorher Geduldig/Einfühlsam/Herzlich
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
        // Die sieben Felder, um die es in #932 ging. Dass sie ein Sync je
        // verloren haette, ist inzwischen widerlegt -- siehe Kopf der Datei.
        llm: 'gemini-2.5-flash',
        thinking_budget: 0,               // [E] 10.08. — vorher 1024
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
