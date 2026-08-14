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

// Die Wartefloskel in den vier unterstuetzten Sprachen.
//
// Codex-Befund vom 14.08. (P1): solange `soft_timeout_config` nur beim Anlegen
// gesetzt wurde, war der fest verdrahtete deutsche Text harmlos -- er erreichte
// keinen bestehenden Agenten. Seit der Sync ihn mitsendet, ist er es nicht
// mehr: ein franzoesisch- oder italienischsprachiger Agent wuerde bei jedem
// langsamen Zug hoerbar auf Deutsch wechseln. Die Sprache selbst ist ein
// kundenspezifischer Pfad (CUSTOMER_SPECIFIC_PATHS) und wird bewusst nicht
// synchronisiert -- der Text darf sie also nicht ueberfahren.
//
// Es ist eine Reparatur an einer Regression, die diese Aenderung selbst
// erzeugt hat: vorher stand derselbe deutsche Text da und richtete keinen
// Schaden an.
//
// Der Wortlaut ist bewusst knapp und in allen vier Sprachen dasselbe Register.
// Er ist von mir gesetzt und sollte von jemandem gegengelesen werden, der die
// Sprache spricht -- es sind zwei Woerter, aber sie fallen im Gespraech auf.
const SOFT_TIMEOUT_MESSAGES = Object.freeze({
  de: 'Einen Moment',
  fr: 'Un instant',
  it: 'Un momento',
  en: 'One moment'
});

// Die Floskel fuer die Sprache des Kunden -- oder `null`, wenn wir die
// gesprochene Sprache nicht mit Sicherheit benennen koennen.
//
// Codex-Befund vom 14.08. (P1): `ai_language` kennt neben den vier Einzel-
// sprachen auch MISCHWERTE -- `de_en`, `de_en_fr`, `de_fr_it_en`. Der
// Prompt-Bauer definiert sie ausdruecklich als Agenten mit automatischem
// Sprachwechsel ("Deutsch (Standard), Englisch und Franzoesisch mit
// automatischem Wechsel", prompt-builder-v2.js). Ein Rueckfall auf Deutsch
// behandelt sie wie unbekannte Werte -- und unterbraeche ein englisch
// gefuehrtes Gespraech ab Sekunde vier auf Deutsch.
//
// Fuer diese Werte wird die Floskel deshalb GAR NICHT gesetzt. Eine Zuordnung,
// die falsch raten kann, ist schlechter als keine: beim Sync bleibt der
// Ist-Zustand des Agenten stehen, beim Anlegen bleibt die Floskel aus. Das
// kostet einen mehrsprachigen Agenten die Ueberbrueckung langer Zuege -- die
// ehrlichere Kosten, verglichen mit einer Unterbrechung in der falschen
// Sprache.
//
// Die saubere Loesung waere eine Floskel, die der AKTIVEN Gespraechssprache
// folgt. Die ginge nur ueber `use_llm_generated_message` -- am 10.08.
// verworfen, weil sie zwei Aufgaben in ein Feld legt -- oder ueber
// `additional_soft_timeout_messages`, dessen Semantik wir nicht belegen
// koennen. Eigenes Ticket, nicht dieser PR.
//
// Ein leerer oder fehlender Wert ist KEIN Mischwert: `agent.language` faellt
// dort selbst auf DEFAULT_LANGUAGE zurueck, der Agent spricht also nachweislich
// Deutsch, und die deutsche Floskel ist richtig.
//
// OFFENE UNSTIMMIGKEIT, damit sie nicht unbemerkt bleibt: `agent.language`
// selbst wird vom Sync NICHT gesendet (siehe die Anmerkung an
// CUSTOMER_SPECIFIC_PATHS -- bewusst zurueckgestellt). Wechselt ein Kunde nach
// dem Anlegen seine Sprache, spricht der Agent also weiter Deutsch, waehrend
// diese Floskel ab dem naechsten Sync franzoesisch waere. Die saubere Loesung
// ist die dort beschriebene -- `language` in die Nutzlast aufnehmen, zusammen
// mit einer Pruefung, die CUSTOMER_SPECIFIC_PATHS gegen die Pfade der Nutzlast
// haelt. Dieser PR nimmt sie nicht vorweg.
function softTimeoutConfigFor(language) {
  const sprache = String(language || '').trim().toLowerCase();
  if (sprache && !SOFT_TIMEOUT_MESSAGES[sprache]) return null;
  return {
    timeout_seconds: AGENT_DEFINITION.conversation_config.turn.soft_timeout_config.timeout_seconds,
    message: SOFT_TIMEOUT_MESSAGES[sprache] || SOFT_TIMEOUT_MESSAGES[DEFAULT_LANGUAGE],
    use_llm_generated_message: false
  };
}

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

      // [E] WIEDER AN, mit Verzoegerung. 14.08. — vorher -1 (aus), davor 3.
      //
      // Die Entscheidung vom 10.08. bleibt hier stehen, weil sie richtig
      // begruendet war und die Umkehr nur mit ihr zusammen lesbar ist:
      //
      //   Die Floskel sprang nach drei Sekunden an und sagte "Einen Moment".
      //   Das klang nach einer Reaktion, war aber eine Ansage darueber, dass
      //   keine kommt: sie hat ein Latenzproblem kaschiert, statt es zu
      //   loesen. Wer sie hoert, wartet danach genauso lange -- nur mit dem
      //   Eindruck, es liege an ihm. Ein Fuellsatz mit immer demselben
      //   Wortlaut wird ausserdem beim zweiten Mal im selben Gespraech als
      //   Defekt gehoert.
      //
      //   Was beim Abschalten sichtbar wurde: die Floskel war zugleich ein
      //   Zughaltesignal. Solange sie sprach, wusste die anrufende Person,
      //   dass die Leitung steht. Zwei Aufgaben staken in einem Feld.
      //
      // Was sich seither geaendert hat, und warum die Umkehr keine Ruecknahme
      // der damaligen Begruendung ist:
      //
      // 1. Die Latenz ist nicht mehr unbekannt, sondern GEMESSEN. Testanruf
      //    vom 14.08.: der Absage-Einstieg dauerte 15 Sekunden, die
      //    Verfuegbarkeitspruefung 8,6. Unsere eigene Seite ist daran mit
      //    912 ms beteiligt (sechs Supabase-Abfragen, aus den Zugriffs-
      //    protokollen abgelesen); Buchung 1,7 s und Absage 1,3 s je
      //    einschliesslich des Google-Aufrufs. Es bleiben rund 14 Sekunden
      //    beim Agenten. Die Floskel verdeckt also nichts mehr, was wir
      //    beheben koennten -- der Rest liegt bei ElevenLabs (siehe die
      //    offene Frage zu cascade_timeout_seconds).
      //
      // 2. Der Einwand "kaschiert statt loest" galt einer Floskel, die bei
      //    JEDEM Zug ansprang. Bei 4 Sekunden spricht sie nur noch auf den
      //    pathologischen Zuegen. Ein schneller Zug bleibt still.
      //
      // 3. Der Massstab kommt aus dem Prompt selbst: er verbietet, laenger
      //    als 15 Sekunden Stille zu tolerieren -- fuer den Fall, dass die
      //    ANRUFENDE Person schweigt. Fuer den umgekehrten Fall stand nichts
      //    da, und genau den haben wir gemessen.
      //
      // Ehrlich dazu: der Einwand aus dem 10.08.-Text, ein Ersatz fuer das
      // Zughaltesignal gehoere NICHT in dieses Feld, ist damit nicht
      // ausgeraeumt, sondern zurueckgestellt. Dieses Feld ist das einzige, das
      // wir ohne ElevenLabs-Aenderung erreichen; ein eigener Mechanismus waere
      // die sauberere Loesung und bleibt offen.
      soft_timeout_config: {
        // Vier Sekunden: oberhalb eines normalen Zuges, unterhalb der
        // Kaskadenschwelle von 8. Wer sie hoert, wartet wirklich.
        timeout_seconds: 4,               // [E] 14.08. — vorher -1, davor 3
        // Vorgabewert. Die tatsaechlich gesendete Fassung richtet sich nach
        // `customers.ai_language` -- siehe softTimeoutConfigFor().
        message: SOFT_TIMEOUT_MESSAGES[DEFAULT_LANGUAGE],
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
      // Der Massstab steht hier und nicht nur im Prompt, weil die strukturierte
      // Auswertung ein EIGENES Modell ist (platform_settings.analysis_llm,
      // weiter unten) und den Gespraechsprompt nicht liest. Gemessen an
      // caller_name: L1 macht den Namen zur Pflicht, die Beschreibung sagt
      // "Niemals raten" -- befuellt sind 7 von 43. Eine Regel wirkt dort, wo
      // das auswertende Modell liest, also hier.
      //
      // Bewusst OHNE `enum`: lead_quality hat keines und erreicht 29 von 33.
      // Der Hebel ist die Rueckfallregel, nicht die geschlossene Liste.
      //
      // "Ohne verwertbare Information: niedrig" statt leer lassen ist eine
      // Entscheidung vom 14.08. Sie kostet den ehrlichen Lueckenfall NICHT:
      // Die Regel richtet sich an das auswertende Modell, sie ist keine
      // Vorgabe im Code. Hat das Modell bewertet und nichts Eiliges gefunden,
      // steht `niedrig`. Lief es gar nicht oder scheiterte es, bleibt das Feld
      // leer und die SMS schreibt weiterhin "Dringlichkeit: unbekannt". Beide
      // Faelle bleiben unterscheidbar.
      //
      // ── Isolierter Test, Stand 14.08. ──────────────────────────────────────
      // Diese Aenderung geht BEWUSST ALLEIN. Der Prompt bleibt unangetastet,
      // damit ein Testanruf genau eine Aenderung misst.
      //
      // Sie entscheidet die offene Architekturfrage: Traegt eine Rueckfallregel
      // in der Feldbeschreibung, ohne `enum` und ohne Prompt-Eingriff? Steigt
      // die Quote, ist der Hebel bewiesen. Bleibt sie, ist die Annahme falsch,
      // dass die Auswertung nur hier liest.
      //
      // Der vorbereitete L1-Prompt-Eingriff (Signalbedingung raus,
      // Nachfrage-Anweisung rein) liegt in
      // docs/TICKET_DRINGLICHKEIT_PFLICHTFELD_2026-08-11.md und folgt erst
      // nach der Messung.
      urgency: {
        type: 'string',
        description: 'Dringlichkeit: hoch / mittel / niedrig. Massstab ist die FOLGE DES WARTENS — '
          + 'was passiert, wenn das Anliegen bis morgen liegen bleibt — und NICHT, ob der Anrufer Eile geäussert hat. '
          + 'hoch = Warten verursacht Schaden, der später nicht mehr behebbar ist, oder Menschen sind gefährdet. '
          + 'Beispiel: Fahrzeug steht auf der Autobahn, Personen daneben. '
          + 'mittel = Warten kostet Geld, Termine oder Komfort, aber ohne bleibenden Schaden. '
          + 'Beispiel: Fahrzeug steht verkehrssicher auf einem Parkplatz, ein Anschlusstermin ist in Gefahr. '
          + 'niedrig = Warten kostet nichts ausser Zeit. '
          + 'Beispiel: Terminvereinbarung, Preisanfrage, Rückfrage zu einer Rechnung. '
          + 'Nicht das Thema entscheidet, sondern die Lage: dasselbe Fahrzeug mit demselben Defekt ist hoch '
          + 'auf der Autobahn und niedrig in der eigenen Garage; dieselbe Menge Wasser ist mittel mit einem '
          + 'Eimer darunter und hoch ohne Auffangmöglichkeit auf Parkett. '
          + 'Stufe IMMER ein. Ohne verwertbare Information: niedrig.'
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
  // Dieselbe Sprache wie der Agent -- sonst bekaeme ein neu angelegter
  // franzoesischsprachiger Agent eine deutsche Wartefloskel.
  //
  // Bei einem Mischwert (`de_en_fr` und Geschwister) liefert die Funktion
  // `null`: die Gespraechssprache steht dann erst zur Laufzeit fest. Weglassen
  // koennen wir das Feld hier nicht -- AGENT_DEFINITION traegt es bereits, und
  // ein geklontes Objekt haette sonst die deutsche Vorgabe. Also wird die
  // Floskel ausdruecklich AUSGESCHALTET. Das ist der Zustand von vor dem
  // 14.08., und er ist fuer diesen Fall der richtige: lieber keine Floskel als
  // eine in der falschen Sprache.
  const wartefloskel = softTimeoutConfigFor(customer.ai_language);
  body.conversation_config.turn.soft_timeout_config = wartefloskel
    || { ...body.conversation_config.turn.soft_timeout_config, timeout_seconds: -1 };
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

  // Bei einem Mischwert bleibt `turn` ganz weg -- siehe softTimeoutConfigFor().
  // Weglassen heisst hier: der Agent behaelt, was er hat. Das ist die einzige
  // Aussage, die wir fuer einen sprachwechselnden Agenten verantworten koennen.
  const wartefloskel = softTimeoutConfigFor(customer.ai_language);

  return {
    conversation_config: {
      agent,
      tts: customer.voice_id ? { voice_id: customer.voice_id } : undefined,
      // Die Wartefloskel MUSS mitgesendet werden, sonst erreicht sie niemanden.
      //
      // Codex-Befund vom 14.08. (P1): AGENT_DEFINITION beschreibt den
      // Sollzustand, angewandt wird sie aber nur beim ANLEGEN --
      // elevenlabs-provision-agent lehnt einen bestehenden Agenten mit 409 ab.
      // Der laufende Sync schickt diesen Ausschnitt hier, und `turn` stand
      // nicht darin. Die Aenderung von -1 auf 4 haette damit ausschliesslich
      // kuenftige Agenten erreicht -- kein einziger Bestandskunde, auch nicht
      // der Testagent, an dem die 15 Sekunden Stille gemessen wurden.
      //
      // Gesendet wird das GANZE soft_timeout_config-Objekt, nicht nur das
      // geaenderte Feld: ob ElevenLabs innerhalb eines Teilbaums zusammenfuehrt
      // oder ersetzt, ist fuer diese Ebene nicht belegt. Bei Ersatz fielen
      // `message` und `use_llm_generated_message` sonst weg.
      //
      // Bewusst NUR dieses eine Feld aus `turn`. Die uebrigen Werte dort
      // (turn_timeout, turn_model, turn_eagerness) haben dasselbe Problem --
      // auch sie gelten nur fuer neue Agenten. Das ist ein eigener Befund und
      // gehoert nicht in einen PR, der die Wartefloskel behebt: sie hier
      // mitzusenden hiesse, sie von einer BEOBACHTUNG zu einer ZUSICHERUNG zu
      // machen, und diese Unterscheidung ist weiter unten ausdruecklich
      // begruendet.
      turn: wartefloskel ? { soft_timeout_config: wartefloskel } : undefined
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
