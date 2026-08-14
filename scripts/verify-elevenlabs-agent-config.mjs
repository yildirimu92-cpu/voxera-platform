// Guard fuer #932: Der Sync ueberschrieb die Agentenkonfiguration.
//
// Befund: `_lib/elevenlabs-sync.js` sendete `conversation_config.agent.prompt`
// als `{ prompt, tool_ids }`. Die Provisionierung setzt dort sieben weitere
// Felder (llm, thinking_budget, temperature, max_tokens, timezone,
// backup_llm_config, cascade_timeout_seconds). ElevenLabs ersetzt dieses Objekt,
// statt es zusammenzufuehren -- die sieben fielen bei jedem Sync auf
// Anbieter-Standard.
//
// Dieser Test fuehrt die echten Funktionen aus _lib/elevenlabs-agent-config.js
// aus (nicht nachgebaut) und prueft die vier Eigenschaften, an denen der Fix
// haengt:
//
//   1. Jeder Sync sendet den vollstaendigen Sollzustand, nicht einen Ausschnitt.
//   2. Die Rueckleseprüfung deckt ALLE gesendeten Felder ab -- nicht nur die
//      sieben heute bekannten. Ein neues Feld in der Definition ist ohne
//      weiteres Zutun mitgeprueft.
//   3. Beide Schreibpfade benutzen dieselbe Definition -- auch das Rollback,
//      das sonst denselben Schaden angerichtet haette wie der Sync.
//   4. Der Vergleich meldet keine Phantom-Abweichungen bei Gleitkommazahlen
//      und bei umsortierten tool_ids.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const configPath = 'admin-panel/netlify/functions/_lib/elevenlabs-agent-config.js';
const syncPath = 'admin-panel/netlify/functions/_lib/elevenlabs-sync.js';
const provisionPath = 'admin-panel/netlify/functions/elevenlabs-provision-agent.js';

const {
  AGENT_DEFINITION,
  buildAgentConfig,
  buildSyncPatch,
  expectedLeaves,
  compareAgentState,
  observeAgentState
} = require(`../${configPath}`);

const syncSource = fs.readFileSync(syncPath, 'utf8');
const provisionSource = fs.readFileSync(provisionPath, 'utf8');

let failed = 0;
const check = (name, passed, detail) => {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!passed) failed += 1;
};

// ── 1. Die sieben Felder aus dem Befund ──────────────────────────────────────

const REGRESSION_FIELDS = [
  'llm',
  'thinking_budget',
  'temperature',
  'max_tokens',
  'timezone',
  'backup_llm_config',
  'cascade_timeout_seconds'
];

const customer = { ai_language: 'fr', voice_id: 'voice-xyz' };
const sent = buildAgentConfig({
  customer,
  prompt: 'PROMPT',
  firstMessage: 'Bonjour',
  toolIds: ['tool-a', 'tool-b']
});

for (const field of REGRESSION_FIELDS) {
  check(
    `Sollzustand traegt agent.prompt.${field}`,
    sent.conversation_config.agent.prompt[field] !== undefined,
    `Wert: ${JSON.stringify(sent.conversation_config.agent.prompt[field])}`
  );
}

// Die Felder duerfen nicht nur vorhanden sein, sondern muessen die abgestimmten
// Werte tragen -- sonst waere eine Aenderung an ihnen eine stille Umstellung.
//
// `thinking_budget` stand hier bis zum 11.08. auf 1024, dem Wert der
// urspruenglichen Provisionierung. Abgestimmt und am laufenden Agenten gemessen
// ist 0 (aus). Der Sync sendet das Feld nicht, es kommt also nur beim Anlegen
// an -- stuende hier weiter 1024, bekaeme jeder neue Kunde ein eingeschaltetes
// Denkbudget, das niemand entschieden hat.
check(
  'thinking_budget ist aus (0)',
  sent.conversation_config.agent.prompt.thinking_budget === 0
);
check(
  'temperature bleibt 0.19',
  sent.conversation_config.agent.prompt.temperature === 0.19
);

// Die vier am 10.08. abgestimmten Werte. Sie stehen hier, damit ein Aufraeumen
// an AGENT_DEFINITION nicht unbemerkt hinter die Entscheidung zurueckfaellt.
check('turn_model ist turn_v3',   sent.conversation_config.turn.turn_model === 'turn_v3');
check('turn_timeout ist 5',       sent.conversation_config.turn.turn_timeout === 5);
// 14.08.: die Wartefloskel ist wieder an, aber VERZOEGERT. Der Wert traegt die
// Aussage, nicht das blosse "an": bei 0 spraeche sie sofort und waere zurueck
// beim Befund vom 10.08., bei -1 waere sie aus und die 15 Sekunden Stille aus
// dem Testanruf blieben unkommentiert. Geprueft wird deshalb das Fenster
// zwischen normalem Zug und Kaskadenschwelle.
// Codex-Befund vom 14.08. (P2): die beiden Fenstergrenzen allein lassen auch 1
// oder 7 durch -- beides wuerde spuerbar aendern, wann die Floskel spricht,
// ohne dass CI etwas meldet. Das Fenster begruendet die Wahl, der feste Wert
// haelt sie fest; beides zusammen, wie bei den Nachbarwerten.
check('Wartefloskel steht auf vier Sekunden',
  sent.conversation_config.turn.soft_timeout_config.timeout_seconds === 4);
check('Wartefloskel spricht verzoegert, nicht sofort',
  sent.conversation_config.turn.soft_timeout_config.timeout_seconds > 0);
check('Wartefloskel bleibt unter der Kaskadenschwelle',
  sent.conversation_config.turn.soft_timeout_config.timeout_seconds
    < sent.conversation_config.agent.prompt.cascade_timeout_seconds);
check('keine Audio-Tags',
  sent.conversation_config.tts.expressive_mode === false
  && Array.isArray(sent.conversation_config.tts.suggested_audio_tags)
  && sent.conversation_config.tts.suggested_audio_tags.length === 0
);

// ── 2. Kundenspezifisch bleibt kundenspezifisch ──────────────────────────────

check('Prompt wird uebernommen', sent.conversation_config.agent.prompt.prompt === 'PROMPT');
check('Begruessung wird uebernommen', sent.conversation_config.agent.first_message === 'Bonjour');
check('Stimme wird uebernommen', sent.conversation_config.tts.voice_id === 'voice-xyz');
// Der language-Beleg: `agent.language` ist kundenspezifisch und darf nicht auf
// eine Konstante fallen -- sonst spraeche jeder fr/it/en-Agent Deutsch.
check('Sprache wird uebernommen', sent.conversation_config.agent.language === 'fr');

// Ohne Begruessung bleibt das Feld WEG statt leer -- das Rollback braucht das,
// weil es den Prompt zurueckdreht, die Anrede aber nicht anfassen soll.
const rollbackBody = buildAgentConfig({ customer, prompt: 'ALT', toolIds: ['tool-a'] });
check(
  'Rollback laesst first_message weg statt es zu leeren',
  !('first_message' in rollbackBody.conversation_config.agent)
);
check(
  'Rollback traegt die sieben Felder trotzdem',
  REGRESSION_FIELDS.every((f) => rollbackBody.conversation_config.agent.prompt[f] !== undefined)
);
// Der zweite Teil des Rollback-Befunds: ohne tool_ids im ersetzten
// prompt-Objekt verliert der Agent sein Kalenderwerkzeug.
check(
  'Rollback traegt tool_ids',
  Array.isArray(rollbackBody.conversation_config.agent.prompt.tool_ids)
);

// Ohne bekannte tool_ids bleibt das Feld weg — ein leeres Array waere die
// Aussage "dieser Agent hat keine Werkzeuge".
const withoutTools = buildAgentConfig({ customer, prompt: 'P', firstMessage: 'G' });
check(
  'ohne toolIds bleibt tool_ids weg statt leer',
  !('tool_ids' in withoutTools.conversation_config.agent.prompt)
);

// ── 3. Die Rueckleseprüfung deckt alles Gesendete ab ─────────────────────────

const leaves = [...expectedLeaves(sent).keys()];
for (const field of REGRESSION_FIELDS) {
  const path = `conversation_config.agent.prompt.${field}`;
  // backup_llm_config ist ein Objekt und erscheint als seine Blaetter.
  const covered = leaves.some((leaf) => leaf === path || leaf.startsWith(`${path}.`));
  check(`Rueckleseprüfung deckt ${field} ab`, covered);
}
check(
  'Rueckleseprüfung deckt auch tts ab (falls es derselben Mechanik unterliegt)',
  leaves.includes('conversation_config.tts.stability')
    && leaves.includes('conversation_config.tts.model_id')
);
check(
  'Rueckleseprüfung deckt agent.language ab',
  leaves.includes('conversation_config.agent.language')
);
check(
  'Rueckleseprüfung deckt platform_settings ab',
  leaves.some((leaf) => leaf.startsWith('platform_settings.'))
);

// Der eigentliche Regressionsfall: der Agent kommt ohne die sieben Felder
// zurueck. Genau das ist #932 -- und genau das muss die Pruefung melden.
const flattened = JSON.parse(JSON.stringify(sent));
for (const field of REGRESSION_FIELDS) {
  delete flattened.conversation_config.agent.prompt[field];
}
const drift = compareAgentState(sent, flattened);
const driftPaths = drift.map((d) => d.path);
for (const field of REGRESSION_FIELDS) {
  const path = `conversation_config.agent.prompt.${field}`;
  check(
    `Abweichung an ${field} wird gemeldet`,
    driftPaths.some((p) => p === path || p.startsWith(`${path}.`))
  );
}
check('Abweichungen tragen Feldnamen', drift.every((d) => typeof d.path === 'string' && d.path.length));

// Ein unveraenderter Agent darf KEINE Abweichung melden -- sonst waere jeder
// Sync ein Fehlalarm und die Meldung wertlos.
check('identischer Zustand meldet nichts', compareAgentState(sent, sent).length === 0);

// ── 4. Keine Phantom-Abweichungen ────────────────────────────────────────────

const floatNoise = JSON.parse(JSON.stringify(sent));
floatNoise.conversation_config.agent.prompt.temperature = 0.19000000000000003;
check(
  'Gleitkommarauschen ist keine Abweichung',
  compareAgentState(sent, floatNoise).length === 0
);

const reordered = JSON.parse(JSON.stringify(sent));
reordered.conversation_config.agent.prompt.tool_ids = ['tool-b', 'tool-a'];
check(
  'umsortierte tool_ids sind keine Abweichung',
  compareAgentState(sent, reordered).length === 0
);

const realMismatch = JSON.parse(JSON.stringify(sent));
// 1024 statt 0: der Sollzustand ist seit dem 11.08. selbst 0, ein
// zurueckgelesenes 0 waere also keine Abweichung mehr. 1024 ist hier genau der
// richtige Gegenwert -- es ist der Wert, auf den die alte Definition
// zurueckfaellt, wenn jemand sie unbedacht wiederherstellt.
realMismatch.conversation_config.agent.prompt.thinking_budget = 1024;
const mismatch = compareAgentState(sent, realMismatch);
check(
  'ausgeschaltetes Denkbudget wird als Abweichung erkannt',
  mismatch.length === 1 && mismatch[0].path === 'conversation_config.agent.prompt.thinking_budget',
  JSON.stringify(mismatch[0] || null)
);

// Der Prompt ist mehrere Kilobyte gross; er darf die Log-Zeile nicht sprengen.
const longPrompt = buildAgentConfig({ customer, prompt: 'x'.repeat(5000), firstMessage: 'G' });
const promptDrift = compareAgentState(longPrompt, buildAgentConfig({ customer, prompt: 'y', firstMessage: 'G' }));
check(
  'Prompt-Abweichung wird gekuerzt protokolliert',
  promptDrift.length === 1 && String(promptDrift[0].expected).length < 400,
  `Laenge: ${String(promptDrift[0]?.expected ?? '').length}`
);

// ── 5. Beide Schreibpfade benutzen die geteilte Definition ───────────────────

// Seit dem 11.08. sendet der Sync WIEDER den Ausschnitt, nicht den
// vollstaendigen Sollzustand -- die Ersetzungs-Semantik, auf der #932 beruhte,
// ist unbelegt (acht Gegenbeobachtungen), und die Definition traegt Werte von
// vor der Abstimmung vom 10.08. Der Guard haelt genau diese Trennung fest.
check(
  'Sync benutzt buildSyncPatch, nicht die volle Definition',
  /buildSyncPatch\(/.test(syncSource) && !/buildAgentConfig\(/.test(syncSource)
);
check(
  'Provisionierung benutzt buildAgentConfig',
  /require\('\.\/_lib\/elevenlabs-agent-config'\)/.test(provisionSource) && /buildAgentConfig\(/.test(provisionSource)
);
check(
  'kein zweites AGENT_TEMPLATE mehr in der Provisionierung',
  !/const\s+AGENT_TEMPLATE\s*=/.test(provisionSource)
);
// Der Kern des Befunds: der Sync darf nirgends mehr ein prompt-Objekt aus nur
// prompt/tool_ids bauen.
// 14.08.: EIN Feld ist dazugekommen, und zwar bewusst.
//
// Die Regel unten lautet: kein Feld aus der Definition, das die Handabstimmung
// vom 10.08. zuruecknehmen wuerde. `soft_timeout_config` nimmt nichts zurueck
// -- es TRAEGT die neueste Abstimmung (14.08., -1 auf 4). Ohne Mitsenden
// erreicht sie niemanden: AGENT_DEFINITION wird nur beim ANLEGEN angewandt,
// und die Provisionierung lehnt bestehende Agenten mit 409 ab. Codex-Befund
// (P1) auf #1002.
//
// Der Unterschied zu `turn_model` und den uebrigen Verbotenen ist nicht der
// Wert, sondern die Absicht: dort wollen wir NICHT ueberschreiben, hier ist das
// Ueberschreiben der ganze Zweck.
check(
  'Der Sync-Koerper enthaelt die Felder von vor #932 plus die Wartefloskel',
  (() => {
    const body = buildSyncPatch({ customer: { voice_id: 'v' }, prompt: 'P', firstMessage: 'G', toolIds: ['t'] });
    const paths = [...expectedLeaves(body).keys()].sort();
    return JSON.stringify(paths) === JSON.stringify([
      'conversation_config.agent.first_message',
      'conversation_config.agent.prompt.prompt',
      'conversation_config.agent.prompt.tool_ids',
      'conversation_config.tts.voice_id',
      'conversation_config.turn.soft_timeout_config.timeout_seconds',
      'conversation_config.turn.soft_timeout_config.message',
      'conversation_config.turn.soft_timeout_config.use_llm_generated_message',
      'platform_settings.privacy.record_voice',
      'platform_settings.privacy.retention_days',
      'platform_settings.privacy.zero_retention_mode'
    ].sort());
  })()
);

// Und der Punkt, an dem der Befund haengt: der laufende Sync muss die Floskel
// tatsaechlich mitschicken, nicht nur die Definition sie tragen. Ohne diese
// Zeile waere die Aenderung fuer jeden Bestandskunden wirkungslos -- und beim
// Testanruf haette es ausgesehen, als wirke die Einstellung nicht.
check(
  'Der Sync traegt die Wartefloskel zu bestehenden Agenten',
  buildSyncPatch({ customer: {}, prompt: 'P' })
    .conversation_config.turn.soft_timeout_config.timeout_seconds === 4
);

// Codex-Befund vom 14.08. (P1) -- eine Regression, die der Sync-Fix selbst
// erzeugt hat: die Floskel stand fest auf Deutsch. Solange sie nur beim
// Anlegen wirkte, fiel das nicht auf; seit sie zu JEDEM Bestandsagenten
// gesendet wird, spraeche ein franzoesischer Agent mitten im Gespraech ein
// deutsches Wort. Geprueft wird der Text pro Sprache, auf BEIDEN Schreibwegen.
const FLOSKELN = { de: 'Einen Moment', fr: 'Un instant', it: 'Un momento', en: 'One moment' };
for (const [sprache, floskel] of Object.entries(FLOSKELN)) {
  check(
    `Wartefloskel spricht ${sprache} im Sync`,
    buildSyncPatch({ customer: { ai_language: sprache }, prompt: 'P' })
      .conversation_config.turn.soft_timeout_config.message === floskel
  );
  check(
    `Wartefloskel spricht ${sprache} beim Anlegen`,
    buildAgentConfig({ customer: { ai_language: sprache }, prompt: 'P', firstMessage: 'G', toolIds: [] })
      .conversation_config.turn.soft_timeout_config.message === floskel
  );
}
// Eine FEHLENDE Sprache darf keinen leeren Text senden -- ElevenLabs spraeche
// dann gar nichts, und die 15 Sekunden Stille waeren zurueck, ohne dass
// irgendwo etwas fehlschlaegt. Sie ist auch kein Mischwert: `agent.language`
// faellt selbst auf Deutsch zurueck, der Agent spricht also Deutsch.
for (const fehlt of [null, undefined, '']) {
  check(
    `Fehlende Sprache ${JSON.stringify(fehlt)} faellt auf Deutsch zurueck`,
    buildSyncPatch({ customer: { ai_language: fehlt }, prompt: 'P' })
      .conversation_config.turn.soft_timeout_config.message === FLOSKELN.de
  );
}

// Codex-Befund vom 14.08. (P1): `ai_language` kennt Mischwerte, und der
// Prompt-Bauer definiert sie als Agenten mit automatischem Sprachwechsel. Ein
// Rueckfall auf Deutsch unterbraeche ein englisch gefuehrtes Gespraech auf
// Deutsch. Fuer diese Werte wird die Floskel GAR NICHT gesetzt.
//
// Die Liste steht hier bewusst als eigene Aufzaehlung und wird nicht aus dem
// Produktionscode gelesen: eine Zusicherung, die dieselbe Quelle liest, die
// sie pruefen soll, waere ein Vakuum-Pass. Sie stammt aus `languageMap` in
// prompt-builder-v2.js -- kommt dort ein Mischwert dazu, muss er auch hier
// stehen, und bis dahin faengt ihn die Regel fuer unbekannte Werte.
const MISCHSPRACHEN = ['de_en', 'de_en_fr', 'de_fr_it_en'];
for (const gemischt of MISCHSPRACHEN) {
  check(
    `Mischwert ${gemischt} bekommt vom Sync gar keine Floskel`,
    buildSyncPatch({ customer: { ai_language: gemischt }, prompt: 'P' })
      .conversation_config.turn === undefined
  );
  // Beim Anlegen laesst sich das Feld nicht weglassen -- AGENT_DEFINITION
  // traegt es bereits. Also ausdruecklich aus, statt still auf Deutsch.
  check(
    `Mischwert ${gemischt} bekommt beim Anlegen eine ausgeschaltete Floskel`,
    buildAgentConfig({ customer: { ai_language: gemischt }, prompt: 'P', firstMessage: 'G', toolIds: [] })
      .conversation_config.turn.soft_timeout_config.timeout_seconds === -1
  );
}
// Ein unbekannter Wert wird wie ein Mischwert behandelt, nicht wie eine
// fehlende Sprache: wir wissen dann nicht, was der Agent spricht, und raten
// nicht. Der Unterschied zu `''` ist der Kern der Regel.
check(
  'Unbekannte Sprache bekommt keine Floskel statt einer geratenen',
  buildSyncPatch({ customer: { ai_language: 'xx' }, prompt: 'P' })
    .conversation_config.turn === undefined
);
// Und die Sperre darf nicht mehr wegnehmen als die Floskel: Prompt und
// Begruessung muessen einen mehrsprachigen Agenten weiterhin erreichen.
check(
  'Der Mischwert-Fall sendet Prompt und Begruessung weiterhin',
  (() => {
    const body = buildSyncPatch({ customer: { ai_language: 'de_en_fr' }, prompt: 'P', firstMessage: 'G' });
    return body.conversation_config.agent.prompt.prompt === 'P'
      && body.conversation_config.agent.first_message === 'G';
  })()
);
// Und die Floskel bleibt gesprochener Text, kein Modellauftrag: mit
// use_llm_generated_message=true wuerde das Modell selbst formulieren -- genau
// die zweite Aufgabe im selben Feld, gegen die am 10.08. entschieden wurde.
check(
  'Die Wartefloskel wird nicht vom Modell erzeugt',
  buildSyncPatch({ customer: { ai_language: 'fr' }, prompt: 'P' })
    .conversation_config.turn.soft_timeout_config.use_llm_generated_message === false
);
// Der eigentliche Regressionsschutz dieses Umbaus: Kein Feld aus der
// Definition, das nicht schon vor #932 gesendet wurde, darf in den
// Sync-Koerper geraten -- sonst stellt der naechste Kundensync die
// Handabstimmung vom 10.08. zurueck.
for (const verboten of ['thinking_budget', 'turn_model', 'expressive_mode', 'suggested_audio_tags', 'temperature', 'timezone']) {
  const body = JSON.stringify(buildSyncPatch({ customer: { voice_id: 'v' }, prompt: 'P', firstMessage: 'G', toolIds: ['t'] }));
  check(`Sync sendet ${verboten} NICHT`, !body.includes(verboten));
}
check(
  'Rollback sendet nicht mehr nur den Prompt',
  !/conversation_config:\s*\{\s*agent:\s*\{\s*prompt:\s*\{\s*prompt\s*\}\s*\}\s*\}/.test(syncSource)
);

// ── Die Beobachtung: der Teil von #932, der Bestand hat ─────────────────────
const beobachtet = observeAgentState({
  conversation_config: {
    agent: { language: 'de', prompt: { prompt: 'x'.repeat(9000), tool_ids: ['t'], timezone: 'Europe/Zurich', thinking_budget: 0 } },
    turn: { turn_model: 'turn_v3', soft_timeout_config: null },
    tts: { expressive_mode: false, suggested_audio_tags: [] },
    asr: { provider: 'scribe_realtime' },
    default_personality: { enabled: true }
  },
  platform_settings: { privacy: {} }
});
check('Beobachtung erfasst timezone (der Unterscheider)',
  beobachtet.agent_prompt.timezone === 'Europe/Zurich');
check('Beobachtung erfasst thinking_budget',
  beobachtet.agent_prompt.thinking_budget === 0);
check('Beobachtung erfasst turn_model und soft_timeout_config',
  beobachtet.turn.turn_model === 'turn_v3' && 'soft_timeout_config' in beobachtet.turn);
check('Beobachtung erfasst tts-Felder',
  beobachtet.tts.expressive_mode === false && Array.isArray(beobachtet.tts.suggested_audio_tags));
check('Schluesselinventar macht unbekannte Felder sichtbar',
  beobachtet._keys.conversation_config.includes('default_personality'));
check('Beobachtung traegt den Prompt NICHT (Log-Groesse)',
  !JSON.stringify(beobachtet).includes('xxxxx') && JSON.stringify(beobachtet).length < 2000);
check('Beobachtung landet in der Log-Zeile',
  /observed: observedState/.test(syncSource));
check('Beobachtung loest KEIN drift aus',
  /if \(syncStatus === 'success' && configDrift\.length\)/.test(syncSource));

// ── 6. Die Abweichung laesst 'success' nicht unwidersprochen ─────────────────

check(
  "Abweichung setzt einen eigenen Status",
  /syncStatus\s*=\s*'drift'/.test(syncSource)
);
check(
  'Abweichung landet in config_drift',
  /config_drift:/.test(syncSource)
);
check(
  'config_drift steht in der Stufenleiter des Log-Inserts',
  /config_drift:\s*_driftColumn/.test(syncSource)
);
// Eine Abweichung darf den Sync NICHT zum Fehlschlag machen: die Warteschlange
// wuerde die Zeile wiederholen, der Canary reissen und der Fan-out anhalten --
// und der Wiederholungsversuch sendet exakt denselben Koerper.
check(
  "'drift' zaehlt als erreicht, nicht als Fehlschlag",
  /ok:\s*syncReachedAgent/.test(syncSource)
);
check(
  'Rueckleseprüfung kann den Sync nicht zum Fehlschlag machen',
  /readback_failed/.test(syncSource)
);

// ── 7. Die drei Befunde aus dem Review zu #938 ──────────────────────────────

const goLiveSource = fs.readFileSync('admin-panel/netlify/functions/customer-go-live.js', 'utf8');
const adminIndexSource = fs.readFileSync('admin-panel/index.html', 'utf8');
const adminSyncRuntime = fs.readFileSync('admin-panel/shared/admin-runtime-sync.js', 'utf8');

// (a) Der Lesepfad darf die neue Spalte NICHT auswaehlen. PostgREST weist eine
// Auswahl mit unbekannter Spalte komplett zurueck -- ein Deploy vor der
// Migration liesse damit jeden Go-Live scheitern. Die Stufenleiter beim
// Log-Insert schuetzt nur den Schreibpfad.
const goLiveSelects = goLiveSource.match(/\.select\('[^']*'\)/g) || [];
check(
  'Go-Live-Abfrage waehlt config_drift nicht aus (Deploy vor Migration)',
  goLiveSelects.every((select) => !select.includes('config_drift')),
  goLiveSelects.filter((s) => s.includes('config_drift')).join(' ') || 'keine Auswahl mit config_drift'
);
check(
  'Go-Live erkennt die Abweichung trotzdem',
  /SYNC_REACHED_AGENT/.test(goLiveSource) && /'drift'/.test(goLiveSource)
);

// (b) Beim Rollback ist der zurueckgeschriebene Prompt der ganze Zweck des
// Aufrufs. Kommt ausgerechnet er nicht an, darf die Funktion keinen Erfolg
// melden -- rollbackRun() haekte die Zeile sonst als 'cancelled' ab und meldete
// dem Bedienenden einen Rollback, den es nicht gab.
const restoreSource = syncSource.slice(syncSource.indexOf('async function restoreAgentPrompt'));
check(
  'Rollback meldet keinen Erfolg, wenn der Prompt nicht ankam',
  /if \(!promptLanded\) \{\s*return \{\s*ok: false/.test(restoreSource)
);
check(
  'Rollback meldet Erfolg, wenn nur ein Nebenfeld abweicht',
  /ok: true/.test(restoreSource)
);

// (c) Jeder Renderer, der den Sync-Status abbildet, muss 'drift' kennen. Sonst
// zeigt dieselbe Zeile an einer Stelle "Abweichung", an der naechsten
// "Noch nie synchronisiert" und an der dritten ein rotes "Fehler".
check(
  'Arbeitsbereich-Abzeichen kennt drift',
  /elevenlabs_sync_status === 'drift'/.test(adminIndexSource)
);
check(
  'Kundenkarte kennt drift',
  /elevenlabs_sync_status==='drift'/.test(adminIndexSource)
);
check(
  'Sync-Log-Renderer in index.html kennt drift',
  /const isDrift = r\.status === 'drift'/.test(adminIndexSource)
);
check(
  'statusBlock() in admin-runtime-sync.js kennt drift',
  /drift: \['Abweichung vom Sollzustand', 'amber'\]/.test(adminSyncRuntime)
);
check(
  'Log-Renderer in admin-runtime-sync.js kennt drift',
  /const drift = status === 'drift'/.test(adminSyncRuntime)
);

console.log(failed ? `\n${failed} Pruefung(en) fehlgeschlagen.` : '\nelevenlabs agent config (#932) verified.');
assert.equal(failed, 0);
