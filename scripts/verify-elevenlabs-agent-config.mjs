// Guard fuer den Agenten-Sollzustand (#932 und seine Rücknahme #955).
//
// ── Was hier geprueft wird, und warum ────────────────────────────────────────
//
// #932 nahm an, ElevenLabs ersetze `conversation_config.agent.prompt`. Diese
// Annahme wurde am 11.08. WIDERLEGT: Die Rueckleseprüfung hat am laufenden
// Agenten `timezone: "Europe/Zurich"` gemessen -- ein Feld in `agent.prompt`,
// das der Sync nie sendet und das neun Syncs ueberlebt hat.
//
// Daraus folgen die zwei Trennungen, die dieser Guard festhaelt:
//
//   1. Der SYNC sendet nur den Ausschnitt (`buildSyncPatch`). Er darf keines
//      der Felder senden, die am 10.08. von Hand abgestimmt wurden -- sonst
//      stellt eine Kundenaenderung sie zurueck. Namentlich geprueft.
//
//   2. Die PROVISIONIERUNG sendet den vollen Startzustand
//      (`buildAgentConfig`). Der muss die abgestimmten Werte tragen, sonst
//      startet jeder neue Kunde mit dem Stand von vor dem 10.08.
//
// Dazu die Herkunftsunterscheidung [A] abgestimmt / [B] vorgefunden: Ohne sie
// wird in drei Monaten ein Messwert fuer eine Entscheidung gehalten.
//
// Der Test fuehrt die echten Funktionen aus (nicht nachgebaut).

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

// Die Felder duerfen nicht nur vorhanden, sondern muessen auch die Werte der
// urspruenglichen Provisionierung sein -- sonst waere der Umstieg fuer
// bestehende Agenten eine stille Umstellung.
// Die fuenf am 10.08. abgestimmten Werte, am 11.08. gemessen und hier
// festgeschrieben. Ein neu angelegter Agent muss mit dem Stand starten, der
// gegen Testanrufe geprueft wurde -- nicht mit dem davor.
const ABGESTIMMT = [
  ['thinking_budget aus (0, nicht null, nicht fehlend)', sent.conversation_config.agent.prompt.thinking_budget === 0],
  ['Turn V3', sent.conversation_config.turn.turn_model === 'turn_v3'],
  ['Nach Stille uebernehmen 5 s', sent.conversation_config.turn.turn_timeout === 5],
  ['Wartefloskel aus (timeout_seconds -1)', sent.conversation_config.turn.soft_timeout_config.timeout_seconds === -1],
  ['expressiver Modus aus', sent.conversation_config.tts.expressive_mode === false],
  ['keine Audio-Tags', Array.isArray(sent.conversation_config.tts.suggested_audio_tags) && sent.conversation_config.tts.suggested_audio_tags.length === 0]
];
for (const [name, ok] of ABGESTIMMT) check(`Abgestimmt 10.08.: ${name}`, ok);

// Vorgefunden: gemessen, nicht entschieden. Steht hier, damit ein neuer Agent
// dem bestehenden gleicht.
check('Vorgefunden: temperature 0.19', sent.conversation_config.agent.prompt.temperature === 0.19);
check('Vorgefunden: max_tokens 1200', sent.conversation_config.agent.prompt.max_tokens === 1200);
check('Vorgefunden: timezone Europe/Zurich', sent.conversation_config.agent.prompt.timezone === 'Europe/Zurich');

// Der Herkunftsvermerk selbst ist die Zusicherung: ohne ihn wird ein Messwert
// fuer eine Entscheidung gehalten.
const configSource = fs.readFileSync(configPath, 'utf8');
check('Dateikopf unterscheidet [A] abgestimmt von [B] vorgefunden',
  /\[A\] ABGESTIMMT/.test(configSource) && /\[B\] VORGEFUNDEN/.test(configSource));
check('Der widerlegte Ersetzungs-Befund steht nicht mehr als Tatsache im Kopf',
  /WIDERLEGT/.test(configSource) && /Europe\/Zurich/.test(configSource));
check('Die unerklaerte Beobachtung vom 10.08. ist als offen vermerkt',
  /UNGEKLAERT/.test(configSource));

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

// Seit dem 11.08. ist 0 der Sollwert. Die Abweichung, die zaehlt, ist die
// Gegenrichtung: das Denkbudget kommt zurueck.
const realMismatch = JSON.parse(JSON.stringify(sent));
realMismatch.conversation_config.agent.prompt.thinking_budget = 1024;
const mismatch = compareAgentState(sent, realMismatch);
check(
  'wieder eingeschaltetes Denkbudget wird als Abweichung erkannt',
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
check(
  'Der Sync-Koerper enthaelt genau die Felder von vor #932',
  (() => {
    const body = buildSyncPatch({ customer: { voice_id: 'v' }, prompt: 'P', firstMessage: 'G', toolIds: ['t'] });
    const paths = [...expectedLeaves(body).keys()].sort();
    return JSON.stringify(paths) === JSON.stringify([
      'conversation_config.agent.first_message',
      'conversation_config.agent.prompt.prompt',
      'conversation_config.agent.prompt.tool_ids',
      'conversation_config.tts.voice_id',
      'platform_settings.privacy.record_voice',
      'platform_settings.privacy.retention_days',
      'platform_settings.privacy.zero_retention_mode'
    ].sort());
  })()
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
