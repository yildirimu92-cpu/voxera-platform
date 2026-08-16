// Guard fuer #1000, Schritt B: die Zusicherungen an den ausgelieferten Prompt.
//
// Geprueft wird `_lib/prompt-assurances.js` -- die Funktion, die spaeter am
// Auslieferungspfad haengt (Schritt C). Hier haengt sie noch nirgends; dieser
// PR baut die Aussage, nicht die Sperre.
//
// ── Die zwei Fallen, gegen die dieser Prueftstand selbst gebaut ist ──────────
//
// 1. VAKUUM-PASS. Eine Zusicherung, die ihre Erwartung aus derselben Quelle
//    liest, die sie pruefen soll, kann nicht fehlschlagen. Deshalb stehen die
//    Anker und Signaturen hier als EIGENE Aufzaehlung, nicht importiert. Wer
//    einen Anker aus dem Produktionsmodul entfernt, macht diesen Prueftstand
//    rot -- genau das ist der Zweck.
//
// 2. SIGNATUREN, DIE DIE WIRKLICHKEIT VERFEHLEN. Eine Zusicherung auf einen
//    Text, den es so nie gibt, meldet immer -- und wird nach der dritten
//    Meldung abgeschaltet. Deshalb pruefen die Begruessungsfaelle gegen die
//    ECHTEN Begruessungen aus `prompt-builder-v2.js`, in allen vier Sprachen
//    und beiden Bauformen, statt gegen nachgebaute Beispielsaetze.
//
// ── Was hier NICHT geprueft werden kann ──────────────────────────────────────
//
// Der echte `system_config.prompt_master_l1`. Er liegt in der Datenbank, nicht
// im Repo, und CI hat keinen Datenbankzugang -- das ist der Befund, aus dem
// #1000 ueberhaupt entstanden ist. Die Anker sind am 14.08. von Hand an der
// Produktionszeile gemessen worden (20 Abschnitte, Aufstellung in #1000); der
// Prueftstand haelt fest, dass der Waechter sie sucht, nicht dass die Zeile sie
// hat. Das Zweite kann erst Schritt C, am Auslieferungspfad.
//
// (`docs/prompts/` existiert nicht -- die Kommandozentrale verweist darauf,
// der Ordner ist im Repo nicht vorhanden. Sonst waere er die Quelle hier.)

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { promptAssurances } = require('../admin-panel/netlify/functions/_lib/prompt-assurances.js');
const { buildGreeting, mitOffenlegung } =
  require('../admin-panel/netlify/functions/_lib/prompt-builder-v2.js');

let failed = 0;
const check = (name, passed, detail) => {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!passed) failed += 1;
};

// ── Eigene Aufzaehlung, bewusst nicht importiert ─────────────────────────────
//
// Am 14.08. an `system_config.prompt_master_l1` gemessen.
const ERWARTETE_ANKER = [
  '## NAME UND IDENTITÄT',
  '## ERSTE NACHRICHT',
  '## ANTI-HALLUZINATION',
  '## RÜCKRUF-HANDLING',
  '## GESPRÄCHSENDE'
];

// Ein Prompt, der alles traegt. CRLF wie in der Produktionszeile -- der Text
// dort kommt aus einem Windows-Editor, und ein Waechter, der an
// Zeilenenden scheitert, faellt genau in der Produktion aus.
const GUTER_PROMPT = [
  '# Voxera Master Prompt — Layer 1',
  '',
  '## ROLLE',
  'Du bist Lara.',
  '',
  '## NAME UND IDENTITÄT',
  'Nein, ich bin kein Mensch. Ich bin Lara, die digitale Assistentin von E2E Test AG — ein KI-System.',
  '',
  '## ANTI-HALLUZINATION (KRITISCH)',
  'Du erfindest nichts.',
  '',
  '## ERSTE NACHRICHT',
  'Beim ersten Kontakt sagst du genau diesen Satz.',
  '',
  '## RÜCKRUF-HANDLING',
  'Nimm eine Rueckrufanfrage auf.',
  '',
  '## GESPRÄCHSENDE',
  'Genau ein Verabschiedungssatz.'
].join('\r\n');

const GUTE_BEGRUESSUNG = buildGreeting('Lara', 'company', null, 'E2E Test AG', 'de');

// ── 1. Der gute Fall meldet nichts ───────────────────────────────────────────
//
// Zuerst, und nicht nebenbei: ein Waechter, der auch bei korrektem Eingang
// meldet, wird abgeschaltet, und dann sichert er gar nichts mehr.
check(
  'Ein vollstaendiger Prompt mit gueltiger Begruessung meldet nichts',
  promptAssurances({ prompt: GUTER_PROMPT, firstMessage: GUTE_BEGRUESSUNG, language: 'de' }).length === 0,
  JSON.stringify(promptAssurances({ prompt: GUTER_PROMPT, firstMessage: GUTE_BEGRUESSUNG, language: 'de' }).map((v) => v.id))
);

// ── 2. Jeder Anker einzeln ───────────────────────────────────────────────────
//
// Die eigentliche Gegenprobe: einen Abschnitt entfernen, genau eine Meldung
// erwarten. Waere hier eine Schleife ueber die importierte Liste, pruefte sie
// die Liste gegen sich selbst.
for (const ueberschrift of ERWARTETE_ANKER) {
  const ohne = GUTER_PROMPT.replace(ueberschrift, '## IRGENDWAS ANDERES');
  const verletzungen = promptAssurances({ prompt: ohne, firstMessage: GUTE_BEGRUESSUNG, language: 'de' });
  check(
    `Fehlender Abschnitt ${ueberschrift} wird gemeldet`,
    verletzungen.length === 1,
    verletzungen.map((v) => v.id).join(', ') || 'keine Meldung'
  );
}

// ── 3. Die zwei rechtlichen Signaturen im Prompt ─────────────────────────────
//
// Der Fall, gegen den die Ueberschrift allein nicht traegt: der Abschnitt
// bleibt stehen, sein Inhalt verschwindet. Genau so sieht eine unbedachte
// Kuerzung aus.
const ohneFormel = GUTER_PROMPT.replace(
  'Nein, ich bin kein Mensch. Ich bin Lara, die digitale Assistentin von E2E Test AG — ein KI-System.',
  'Ich bin Lara.'
);
const formelVerletzungen = promptAssurances({ prompt: ohneFormel, firstMessage: GUTE_BEGRUESSUNG, language: 'de' });
check(
  'Ein geleerter Abschnitt NAME UND IDENTITÄT wird gemeldet, obwohl die Ueberschrift steht',
  formelVerletzungen.length === 2
    && formelVerletzungen.some((v) => v.id === 'offenlegung_ki_system')
    && formelVerletzungen.some((v) => v.id === 'offenlegung_kein_mensch'),
  formelVerletzungen.map((v) => v.id).join(', ')
);
// Und einzeln: "KI-System" allein genuegt nicht, sonst liesse eine ausweichende
// Umformulierung die Zusicherung bestehen.
check(
  'Nur "kein Mensch" entfernt wird einzeln gemeldet',
  (() => {
    const v = promptAssurances({
      prompt: GUTER_PROMPT.replace('Nein, ich bin kein Mensch. ', ''),
      firstMessage: GUTE_BEGRUESSUNG, language: 'de'
    });
    return v.length === 1 && v[0].id === 'offenlegung_kein_mensch';
  })()
);

// ── 4. Die Begruessung, gegen die ECHTEN Bauformen ───────────────────────────
//
// Vier Sprachen mal zwei Bauformen. `buildGreeting()` erzeugt die vorgegebene
// Begruessung, `mitOffenlegung()` stellt einer kundeneigenen die Offenlegung
// voran. Traefe eine Signatur nur die eine Form, meldete der Waechter bei jedem
// Kunden mit eigener Begruessung -- der haeufigere Fall im Betrieb.
for (const sprache of ['de', 'en', 'fr', 'it']) {
  for (const typ of ['company', 'consultant', 'private']) {
    const erzeugt = buildGreeting('Lara', typ, 'Muster', 'E2E Test AG', sprache);
    check(
      `Erzeugte Begruessung ${sprache}/${typ} besteht die Zusicherung`,
      promptAssurances({ prompt: GUTER_PROMPT, firstMessage: erzeugt, language: sprache }).length === 0,
      erzeugt.slice(0, 60)
    );
  }
  const eigen = mitOffenlegung('Hoi zäme, was darf es sein?', sprache);
  check(
    `Kundeneigene Begruessung ${sprache} besteht die Zusicherung`,
    promptAssurances({ prompt: GUTER_PROMPT, firstMessage: eigen, language: sprache }).length === 0,
    eigen.slice(0, 60)
  );
}

// Mischwerte und Unbekanntes fallen auf Deutsch -- dieselbe Regel wie im
// Prompt-Bauer (`OFFENLEGUNG[language] || OFFENLEGUNG.de`). Das ist bewusst
// NICHT dieselbe Antwort wie bei der Wartefloskel, die fuer Mischwerte gar
// nichts sendet: eine Begruessung MUSS es geben, eine Wartefloskel nicht.
for (const sprache of ['de_en', 'de_en_fr', 'de_fr_it_en', 'xx', '', null, undefined]) {
  check(
    `Sprache ${JSON.stringify(sprache)} prueft gegen die deutsche Fassung`,
    promptAssurances({
      prompt: GUTER_PROMPT,
      firstMessage: buildGreeting('Lara', 'company', null, 'E2E Test AG', 'de'),
      language: sprache
    }).length === 0
  );
}

// Die zwei Zusagen in der Begruessung sind ZWEI, nicht eine.
check(
  'Eine Begruessung ohne Maschinenhinweis wird gemeldet',
  (() => {
    const v = promptAssurances({
      prompt: GUTER_PROMPT,
      firstMessage: 'Grüezi, hier ist Lara von E2E Test AG, das Gespräch wird aufgezeichnet. Wie kann ich helfen?',
      language: 'de'
    });
    return v.length === 1 && v[0].id === 'begruessung_ohne_maschinenhinweis';
  })()
);
check(
  'Eine Begruessung ohne Aufzeichnungshinweis wird gemeldet',
  (() => {
    const v = promptAssurances({
      prompt: GUTER_PROMPT,
      firstMessage: 'Grüezi, hier spricht Lara, die digitale Assistentin von E2E Test AG. Wie kann ich helfen?',
      language: 'de'
    });
    return v.length === 1 && v[0].id === 'begruessung_ohne_aufzeichnungshinweis';
  })()
);
// Genau der Fall aus der Provisionierung (#1004): Aufzeichnung ja, Maschine
// nein. Er steht hier, damit der Waechter belegbar auf ihn anspricht -- der
// Fix dieses Pfads gehoert zu Schritt C.
check(
  'Die Begruessung aus buildDefaultGreeting() faellt durch (#1004)',
  promptAssurances({
    prompt: GUTER_PROMPT,
    firstMessage: 'Grüezi, hier ist Lara von E2E Test AG. Das Gespräch wird zur Bearbeitung aufgezeichnet. Wie kann ich Ihnen helfen?',
    language: 'de'
  }).some((v) => v.id === 'begruessung_ohne_maschinenhinweis')
);

// ── 5. Das Rollback sendet keine Begruessung ─────────────────────────────────
//
// `null` heisst "wird nicht angefasst", der leere String heisst "wird geleert".
// Die Unterscheidung ist der Unterschied zwischen einem Fehlalarm und einem
// echten Befund.
check(
  'Ohne Begruessung entfallen die Begruessungs-Zusicherungen',
  promptAssurances({ prompt: GUTER_PROMPT, firstMessage: null, language: 'de' }).length === 0
);
check(
  'Eine LEERE Begruessung ist dagegen eine Verletzung',
  (() => {
    const v = promptAssurances({ prompt: GUTER_PROMPT, firstMessage: '', language: 'de' });
    return v.length === 1 && v[0].id === 'begruessung_leer';
  })()
);

// ── 6. Der Waechter faellt geschlossen aus ───────────────────────────────────
//
// Der Fall, der jeden Waechter wertlos macht: bei fehlendem Eingang nichts
// melden. Ein Aufruf ohne Argumente muss die schwerste Meldung liefern, nicht
// die leere Liste.
for (const leer of [undefined, null, '', '   ']) {
  const v = promptAssurances({ prompt: leer, firstMessage: GUTE_BEGRUESSUNG, language: 'de' });
    check(
    `Leerer Prompt ${JSON.stringify(leer)} meldet, statt zu bestehen`,
    v.length === 1 && v[0].id === 'prompt_fehlt'
  );
}
check(
  'Ein Aufruf ganz ohne Argumente meldet',
  promptAssurances().length === 1
);

// ── 7. Der tote Einsetz-Zweig (#929) ─────────────────────────────────────────
//
// Zwei verschiedene Faelle, und der Unterschied ist der Grund, warum der
// Master-Prompt zusaetzlich geprueft wird:
//
//   falsch geschrieben -> ueberlebt bis in den ausgelieferten Text
//   richtig geschrieben -> wird verbraucht, im Ergebnis unsichtbar
check(
  'Ein unersetzter Layer-Platzhalter im Ergebnis wird gemeldet',
  (() => {
    const v = promptAssurances({
      prompt: GUTER_PROMPT + '\r\n{{ INDUSTRY_LAYER }}',
      firstMessage: GUTE_BEGRUESSUNG, language: 'de'
    });
    return v.length === 1 && v[0].id === 'layer_platzhalter_im_ergebnis';
  })()
);
check(
  'Ein Layer-Platzhalter im Master-Prompt wird gemeldet, obwohl das Ergebnis sauber ist',
  (() => {
    const v = promptAssurances({
      prompt: GUTER_PROMPT,
      firstMessage: GUTE_BEGRUESSUNG,
      language: 'de',
      masterPrompt: '# ROLLE\r\n{{INDUSTRY_LAYER}}\r\n{{CUSTOMER_LAYER}}'
    });
    return v.length === 1 && v[0].id === 'layer_platzhalter_im_master';
  })()
);
// Die Gegenprobe: der heutige Zustand -- Master-Prompt ohne Platzhalter --
// darf NICHT melden. Ohne sie waere die Regel "meldet immer, wenn ein
// masterPrompt mitgegeben wird".
check(
  'Ein Master-Prompt ohne Layer-Platzhalter meldet nichts',
  promptAssurances({
    prompt: GUTER_PROMPT, firstMessage: GUTE_BEGRUESSUNG, language: 'de',
    masterPrompt: '# ROLLE\r\nDu bist Lara.\r\n## GESPRÄCHSENDE\r\nEin Satz.'
  }).length === 0
);
// Und ein anderer Platzhalter darf nicht faelschlich anschlagen -- `{{TON}}`
// und Geschwister sind normale Variablen des Bauers.
check(
  'Andere Platzhalter loesen die Layer-Meldung nicht aus',
  promptAssurances({
    prompt: GUTER_PROMPT, firstMessage: GUTE_BEGRUESSUNG, language: 'de',
    masterPrompt: '# ROLLE\r\nDu bist {{ASSISTANT_NAME}}. Ton: {{TON}}'
  }).length === 0
);

// ── 8. Die Meldungen sind lesbar ─────────────────────────────────────────────
//
// Sie landen spaeter in `elevenlabs_sync_log.error_message`, und dort liest sie
// jemand, der den Code nicht offen hat. Eine Meldung ohne Grund waere eine
// Sperre ohne Erklaerung.
const alleMeldungen = promptAssurances({ prompt: 'leer aber nicht leer', firstMessage: 'x', language: 'de' });
check(
  'Jede Meldung traegt id, Zusicherung und Grund',
  alleMeldungen.length > 0 && alleMeldungen.every((v) =>
    typeof v.id === 'string' && v.id.length
    && typeof v.zusicherung === 'string' && v.zusicherung.length
    && typeof v.grund === 'string' && v.grund.length > 20)
);

// ── 9. Der Vorbehalt zu #965 steht im Code ───────────────────────────────────
//
// Er ist der wichtigste Satz dieser Datei und der einzige, der verhindert, dass
// jemand den gruenen Waechter fuer eine Zusage haelt, die er nicht gibt.
// Deshalb wird seine Anwesenheit geprueft, nicht nur sein Vorhandensein
// beabsichtigt.
const quelle = await import('node:fs').then((fs) =>
  fs.readFileSync('admin-panel/netlify/functions/_lib/prompt-assurances.js', 'utf8'));
check(
  'Der Vorbehalt zu #965 steht im Modulkopf',
  /HEISST NICHT, DASS SIE GESPROCHEN WIRD/.test(quelle)
    && /ignore_default_personality/.test(quelle)
);

console.log(`\n${failed ? `prompt assurances: ${failed} Fehlschlag/Fehlschlaege` : 'prompt assurances verifiziert.'}`);
process.exit(failed ? 1 : 0);
