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
  expectedLeaves,
  compareAgentState
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
check(
  'thinking_budget bleibt 1024',
  sent.conversation_config.agent.prompt.thinking_budget === 1024
);
check(
  'temperature bleibt 0.19',
  sent.conversation_config.agent.prompt.temperature === 0.19
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
realMismatch.conversation_config.agent.prompt.thinking_budget = 0;
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

check(
  'Sync benutzt buildAgentConfig',
  /require\('\.\/elevenlabs-agent-config'\)/.test(syncSource) && /buildAgentConfig\(/.test(syncSource)
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
  'Sync baut kein Teil-prompt-Objekt mehr',
  !/const\s+promptPatch\s*=/.test(syncSource)
);
check(
  'Rollback sendet nicht mehr nur den Prompt',
  !/conversation_config:\s*\{\s*agent:\s*\{\s*prompt:\s*\{\s*prompt\s*\}\s*\}\s*\}/.test(syncSource)
);

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

console.log(failed ? `\n${failed} Pruefung(en) fehlgeschlagen.` : '\nelevenlabs agent config (#932) verified.');
assert.equal(failed, 0);
