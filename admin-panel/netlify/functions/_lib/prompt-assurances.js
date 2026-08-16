'use strict';

// Zusicherungen an den ausgelieferten Prompt (#1000, Schritt B).
//
// ── Warum es diese Datei gibt ────────────────────────────────────────────────
//
// Rund drei Viertel des Systemprompts stammen aus zwei Zeilen von
// `system_config`. Diese Zeilen werden per SQL geaendert -- ohne Commit, ohne
// Diff, ohne Review. Die vorhandenen Prompt-Waechter pruefen den BAUER
// (`verify-prompt-builder-v2.mjs`), nicht seine EINGABEN. Drei Viertel des
// Ergebnisses liegen damit ausserhalb ihrer Reichweite.
//
// Diese Datei prueft das ERGEBNIS: den zusammengesetzten Prompt und die
// Begruessung, so wie sie ausgeliefert werden.
//
// ── Was sie NICHT zusichert ──────────────────────────────────────────────────
//
// DASS DIE OFFENLEGUNG IM PROMPT STEHT, HEISST NICHT, DASS SIE GESPROCHEN WIRD.
//
// Auf dem Produktivagenten ist `ignore_default_personality: false` aktiv --
// gemessen am 11.08. Die Standardpersoenlichkeit von ElevenLabs bringt die
// Regel "Vermeiden Sie es, zu wiederholen, wer der Agent ist, es sei denn, es
// wird gefragt" mit, und die arbeitet gegen genau die Anweisung, die dieser
// Waechter sichert. Ob sie den Prompt ueberlagert oder nur ergaenzt, ist
// unverifiziert (#965).
//
// Beides zu verwechseln waere der Vakuum-Pass: ein gruener Waechter ueber
// einem Agenten, der die Offenlegung nie ausspricht. Diese Datei sichert die
// ANWEISUNG. Den AUSSPRUCH sichert nur ein Testanruf mit Transkript.
//
// ── Bauform: Anker gegen Signatur ────────────────────────────────────────────
//
// Ueberschriften sind ANKER -- sie sagen "der Abschnitt ist da". Wortlaut wird
// nur dort geprueft, wo er rechtlich ist. Der Grund ist praktisch: der
// Abschnitt GESPRAECHSENDE hat den Befund vom 14.08. verursacht ("wir melden
// uns bei Ihnen" nach einer erfolgreichen Buchung), und wir wollen ihn aendern
// koennen. Ein Waechter, der seinen Wortlaut festschreibt, zementiert einen
// Text, den wir loswerden wollen.
//
// Umgekehrt genuegt bei den zwei rechtlichen Ankern die Ueberschrift NICHT:
// ein Abschnitt laesst sich leeren, ohne dass die Ueberschrift verschwindet.
// Dort steht Ueberschrift UND Inhaltssignatur.

// ── Die fuenf Anker ──────────────────────────────────────────────────────────
//
// Gemessen an `system_config.prompt_master_l1` am 14.08. (20 Abschnitte).
// Verglichen wird als Teilzeichenkette, NICHT zeilengenau: der Text traegt
// CRLF-Zeilenenden, und `## ANTI-HALLUZINATION` fuehrt den Zusatz
// "(KRITISCH)". Ein zeilengenauer Vergleich waere an beidem gescheitert --
// und zwar still, weil er dann IMMER meldet und niemand ihm noch glaubt.
const ANKER = Object.freeze([
  Object.freeze({
    id: 'name_und_identitaet',
    ueberschrift: '## NAME UND IDENTITÄT',
    grund: 'Traegt die Offenlegungsformel. Art. 50 EU AI Act.'
  }),
  Object.freeze({
    id: 'erste_nachricht',
    ueberschrift: '## ERSTE NACHRICHT',
    grund: 'Verpflichtet den Agenten auf die Begruessung als ersten Satz. '
      + 'Ohne diesen Abschnitt ist die Begruessung ein Vorschlag.'
  }),
  Object.freeze({
    id: 'anti_halluzination',
    ueberschrift: '## ANTI-HALLUZINATION',
    grund: 'Verbietet erfundene Termine, Preise, Verfuegbarkeiten und Fristen. '
      + 'Faellt der Abschnitt weg, erfindet der Agent -- der Schaden, der einen '
      + 'Kunden kostet.'
  }),
  Object.freeze({
    id: 'rueckruf_handling',
    ueberschrift: '## RÜCKRUF-HANDLING',
    grund: 'Der Auffangweg, auf den alle anderen Zweige zeigen, einschliesslich '
      + 'des Kalenderblocks.'
  }),
  Object.freeze({
    id: 'gespraechsende',
    ueberschrift: '## GESPRÄCHSENDE',
    grund: 'Ohne ihn endet das Gespraech unkontrolliert. Nur die Existenz wird '
      + 'geprueft, nicht der Wortlaut -- siehe Kopf dieser Datei.'
  })
]);

// ── Die zwei rechtlichen Signaturen im Prompt ────────────────────────────────
//
// Wortlaut in der Datenbank:
//   "Nein, ich bin kein Mensch. Ich bin {{ASSISTANT_NAME}}, {{ASSISTANT_ROLE}}
//    von {{CUSTOMER_DISPLAY_NAME}} — ein KI-System."
//
// Geprueft wird der AUFGELOESTE Prompt, also die Fassung nach dem Ersetzen der
// Platzhalter. Die Signatur darf deshalb nur auf den invarianten Teilen sitzen.
// Eine Signatur auf `{{ASSISTANT_NAME}}` waere im ausgelieferten Text nie zu
// finden -- ein Waechter, der immer meldet, ist so wertlos wie einer, der nie
// meldet.
const PROMPT_SIGNATUREN = Object.freeze([
  Object.freeze({
    id: 'offenlegung_ki_system',
    muster: /ein KI-System/,
    grund: 'Die reaktive Offenlegungsformel. Ohne sie beantwortet der Agent die '
      + 'Frage "sind Sie ein Bot?" nicht wahrheitsgemaess.'
  }),
  Object.freeze({
    id: 'offenlegung_kein_mensch',
    muster: /kein Mensch/,
    grund: 'Der eindeutige Teil derselben Formel. "KI-System" allein liesse eine '
      + 'ausweichende Umformulierung zu.'
  })
]);

// ── Die zwei rechtlichen Signaturen in der Begruessung ───────────────────────
//
// Sie sind ZWEI Zusagen, nicht eine, obwohl sie im selben Satz stehen:
//
//   Hinweis auf die Maschine  -> Art. 50 EU AI Act
//   Aufzeichnungshinweis      -> §11 Datenschutzerklaerung, DSG
//
// Sie koennen einzeln verschwinden, also werden sie einzeln geprueft.
//
// Die Begruessung entsteht in zwei Bauformen (prompt-builder-v2.js):
// `buildGreeting()` webt Rolle und Aufzeichnung in den Satz, `mitOffenlegung()`
// stellt einer kundeneigenen Begruessung die eigenstaendige Fassung voran. Die
// Muster unten treffen BEIDE -- deshalb "digitale[nr]? Assistentin" statt einer
// der zwei konkreten Wendungen.
//
// Sprache: dieselbe Regel wie im Prompt-Bauer (`text(customer.ai_language) ||
// 'de'` plus `OFFENLEGUNG[language] || OFFENLEGUNG.de`). Ein Mischwert wie
// `de_en_fr` faellt dort auf Deutsch, also faellt er hier auch auf Deutsch.
// Das ist bewusst NICHT dieselbe Antwort wie bei der Wartefloskel, die fuer
// Mischwerte gar nichts sendet: eine Begruessung MUSS es geben, eine
// Wartefloskel nicht.
const BEGRUESSUNG_SIGNATUREN = Object.freeze({
  de: Object.freeze({
    maschine: /digitale[nr]? Assistentin/i,
    aufzeichnung: /Gespräch wird aufgezeichnet/i
  }),
  en: Object.freeze({
    maschine: /digital assistant/i,
    aufzeichnung: /call is recorded/i
  }),
  fr: Object.freeze({
    maschine: /assistante numérique/i,
    aufzeichnung: /appel est enregistré/i
  }),
  it: Object.freeze({
    maschine: /assistente digitale/i,
    aufzeichnung: /chiamata viene registrata/i
  })
});

const SPRACHE_VORGABE = 'de';

// ── Der tote Einsetz-Zweig (#929, am 14.08. nachgeprueft) ────────────────────
//
// `buildPromptV2()` kennt zwei Wege, die Layer zusammenzufuegen: ersetzen, wenn
// der Master-Prompt einen Layer-Platzhalter enthaelt, sonst anhaengen. Die
// Produktionszeile enthaelt KEINEN der beiden Platzhalter -- es greift
// durchgehend das Anhaengen, der Einsetz-Zweig ist tot.
//
// Tot, aber scharf: schreibt jemand beim naechsten Umbau `{{INDUSTRY_LAYER}}`
// in die Mitte des Textes, wandert der Branchen-Layer dorthin und der
// Kunden-Layer bleibt hinten. Die Reihenfolge des GESAMTEN Prompts aendert
// sich, ohne dass eine Zeile Code angefasst wurde und ohne dass ein Test
// anschlaegt.
//
// GRENZE, damit dieser Waechter nicht mehr verspricht, als er haelt: ein
// KORREKT geschriebener Platzhalter wird beim Zusammensetzen verbraucht und ist
// im Ergebnis nicht mehr zu sehen. Am zusammengesetzten Prompt ist der Fall
// also NICHT zu erkennen -- deshalb prueft `promptAssurances()` zusaetzlich den
// Master-Prompt selbst, wenn der Aufrufer ihn mitgibt. Am Sync-Pfad ist er als
// `inputs.masterPrompt` vorhanden.
//
// Am zusammengesetzten Prompt bleibt eine schmalere, aber echte Aussage: ein
// FEHLERHAFT geschriebener Platzhalter (`{{INDUSTRY-LAYER}}`, `{{ INDUSTRY_LAYER }}`)
// wird nicht ersetzt und ueberlebt bis in den ausgelieferten Text -- wo der
// Agent ihn vorlesen wuerde.
const LAYER_PLATZHALTER = /\{\{\s*[A-Za-z_-]*LAYER[A-Za-z_-]*\s*\}\}/;

/**
 * Prueft den ausgelieferten Prompt gegen die Zusicherungen.
 *
 * Reine Funktion: kein Netz, kein Datenbankzugriff, keine Nebenwirkung. Damit
 * ist sie ohne Attrappen pruefbar.
 *
 * @param {string}  prompt         der zusammengesetzte Prompt, wie er gesendet wird
 * @param {string}  [firstMessage] die Begruessung. Fehlt sie, entfallen die
 *                                 Begruessungs-Zusicherungen -- das Rollback
 *                                 sendet sie bewusst nicht, und eine Pruefung
 *                                 auf ein nicht gesendetes Feld waere ein
 *                                 Fehlalarm.
 * @param {string}  [language]     `customers.ai_language`
 * @param {string}  [masterPrompt] die Rohfassung aus system_config, falls
 *                                 verfuegbar -- nur fuer die Platzhalterpruefung
 * @returns {Array<{id: string, zusicherung: string, grund: string}>} Verletzungen,
 *          leer wenn alles traegt
 */
function promptAssurances({ prompt, firstMessage, language, masterPrompt } = {}) {
  const verletzungen = [];
  const melde = (id, zusicherung, grund) => verletzungen.push({ id, zusicherung, grund });

  // Ein fehlender Prompt ist die schwerste Verletzung, nicht der Normalfall.
  // Ohne diesen Zweig lieferte ein Aufruf ohne Argumente eine leere Liste --
  // also "alles in Ordnung" fuer einen Prompt, den es nicht gibt.
  const text = typeof prompt === 'string' ? prompt : '';
  if (!text.trim()) {
    melde('prompt_fehlt', 'Der Prompt ist leer',
      'Ein leerer Prompt kann keine Zusicherung erfuellen. Ohne diese Pruefung '
      + 'waere ein fehlender Prompt der einzige Fall, der alle anderen besteht.');
    return verletzungen;
  }

  for (const anker of ANKER) {
    if (!text.includes(anker.ueberschrift)) {
      melde(anker.id, `Abschnitt ${anker.ueberschrift} fehlt`, anker.grund);
    }
  }

  for (const signatur of PROMPT_SIGNATUREN) {
    if (!signatur.muster.test(text)) {
      melde(signatur.id, `Der Prompt traegt "${signatur.muster.source}" nicht`, signatur.grund);
    }
  }

  if (LAYER_PLATZHALTER.test(text)) {
    melde('layer_platzhalter_im_ergebnis',
      'Im zusammengesetzten Prompt steht ein unersetzter Layer-Platzhalter',
      'Er wurde beim Zusammensetzen nicht ersetzt -- vermutlich falsch '
      + 'geschrieben -- und wuerde vom Agenten vorgelesen. Siehe #929.');
  }

  if (typeof masterPrompt === 'string' && LAYER_PLATZHALTER.test(masterPrompt)) {
    melde('layer_platzhalter_im_master',
      'Der Master-Prompt enthaelt einen Layer-Platzhalter',
      'Damit greift der Einsetz-Zweig statt des Anhaengens, und die Reihenfolge '
      + 'der Layer im gesamten Prompt aendert sich -- ohne Codeaenderung. Siehe #929.');
  }

  // Die Begruessung. `typeof`-Pruefung statt Wahrheitswert: ein LEERER String
  // ist eine gesendete, aber leere Begruessung und damit eine Verletzung --
  // waehrend `null` das Rollback bedeutet, das sie gar nicht anfasst.
  if (typeof firstMessage === 'string') {
    const sprache = String(language || '').trim().toLowerCase();
    const signaturen = BEGRUESSUNG_SIGNATUREN[sprache] || BEGRUESSUNG_SIGNATUREN[SPRACHE_VORGABE];

    if (!firstMessage.trim()) {
      melde('begruessung_leer', 'Die Begruessung ist leer',
        'Sie wird gesendet und ersetzt damit die bestehende. Eine leere '
        + 'Begruessung nimmt dem Anrufer jede Offenlegung zu Gespraechsbeginn.');
    } else {
      if (!signaturen.maschine.test(firstMessage)) {
        melde('begruessung_ohne_maschinenhinweis',
          'Die Begruessung nennt die maschinelle Natur nicht',
          'Art. 50 EU AI Act. Der Anrufer muss zu Gespraechsbeginn erfahren, dass '
          + 'er mit einer Maschine spricht -- nicht erst auf Nachfrage.');
      }
      if (!signaturen.aufzeichnung.test(firstMessage)) {
        melde('begruessung_ohne_aufzeichnungshinweis',
          'Die Begruessung nennt die Aufzeichnung nicht',
          '§11 der Datenschutzerklaerung. Eigene Zusage, unabhaengig vom Hinweis '
          + 'auf die Maschine -- beide stehen im selben Satz und koennen einzeln '
          + 'verschwinden.');
      }
    }
  }

  return verletzungen;
}

module.exports = {
  ANKER,
  PROMPT_SIGNATUREN,
  BEGRUESSUNG_SIGNATUREN,
  LAYER_PLATZHALTER,
  promptAssurances
};
