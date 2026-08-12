#!/usr/bin/env node
/**
 * Wächter für Browser-seitige Supabase-Schreibzugriffe ohne Fehlerbehandlung.
 *
 * Warum es das braucht
 * --------------------
 * Der Supabase-JS-Client loest insert()/update()/upsert()/delete() mit
 * { data, error } auf, statt bei einem Fehler auf Query-Ebene (RLS-Verweigerung,
 * Constraint-Verletzung) abzulehnen. Ein blosses `await` wirft dabei nichts von
 * selbst -- Code muss `.error` ausdruecklich lesen, sonst gilt ein
 * fehlgeschlagener Schreibvorgang stillschweigend als Erfolg.
 *
 * Fund vom 2026-08-11: vxSaveProfil() zeigte "Gespeichert ✓" und uebernahm den
 * neuen Namen lokal, obwohl _sb.from('customers').update(...) einen Fehler im
 * Ergebnis zurueckgab -- der Aufruf las das Ergebnis nie. Die Suche danach ergab
 * sieben Browser-Schreibzugriffe ohne diese Pruefung; vier kundenseitig
 * (customer-dashboard), drei adminseitig (admin-panel). vxSaveProfil ist seither
 * gefixt; sechs stehen noch aus.
 *
 * Zwei Helfer schliessen die Luecke fuer neue und bestehende Stellen:
 *   customer-dashboard/shared/customer-runtime-supabase-write.js  -> vxSbWrite()
 *   admin-panel/shared/core/admin-supabase-write.js               -> adminSbWrite()
 * Beide pruefen `.error` und werfen; eine damit umwickelte Schreibstelle kann
 * das Ergebnis nicht mehr ungeprueft lassen.
 *
 * Wie es prueft
 * -------------
 * Nach dem Vorbild von verify-invoice-tax-convention.mjs: NICHT nur gegen eine
 * gepflegte Liste, sondern gegen die Wirklichkeit. Das Skript sucht selbst alle
 * `.from(...).{insert,update,upsert,delete}(...)`-Stellen in beiden
 * index.html-Dateien (Browser-Code; netlify/functions/ laeuft serverseitig mit
 * service_role und ist eine andere Vertrauensgrenze, siehe verify-*-migration.mjs
 * dafuer) und vergleicht die gefundene Menge mit der bekannten. Fuer jede
 * bekannte Stelle wird zusaetzlich geprueft, ob sie ihre zugesagte Behandlung
 * (Helfer oder bereits vorhandene, explizite {error}-Pruefung) im Quelltext
 * noch traegt.
 *
 * Ratsche statt Dauerrot
 * ----------------------
 * Sechs der 19 Stellen sind am 2026-08-11 noch nicht auf einen Helfer
 * umgestellt (BASISLINIE_NICHT_KONFORM). Ein Wächter, der deshalb ab sofort
 * JEDEN Pull Request in diesem Repo rot markiert, bis alle sechs gefixt sind,
 * loest genau das Problem nicht, das er beheben soll: ein Dauerrot, das
 * niemand mehr liest, ist von "nichts wird geprueft" nicht zu unterscheiden
 * (P1-Fund aus dem Codex-Review auf PR #973). Die bekannte Restschuld zaehlt
 * deshalb nicht einzeln als Fehler, sondern wird gegen eine Basislinie
 * geprueft: PASS, solange die Zahl unveraendert bleibt; FAIL, wenn sie steigt
 * (Regression) oder sinkt, ohne dass die Basislinie im selben Commit
 * nachgezogen wurde (sonst koennte sie unbemerkt wieder steigen). Eine neue,
 * nicht eingetragene Stelle bleibt davon unberuehrt -- siehe Rohbefund unten.
 *
 * Dreiwertiges Ergebnis, kein Vakuum-Pass:
 *   PASS  -- Schreibstellen gefunden, alle bekannt, Restschuld = Basislinie.
 *   FAIL  -- ein Anker ist nicht mehr eindeutig auffindbar, die Restschuld
 *            weicht von der Basislinie ab (in beide Richtungen), es gibt
 *            unbekannte (nicht eingetragene) Stellen, oder ein
 *            Ausnahme-Eintrag hat keine echte Begruendung.
 *   SKIP  -- in einer der beiden Dateien wurde ueberhaupt keine Schreibstelle
 *            gefunden. Ein Regex, der nichts findet, ist verdaechtig, nicht
 *            bestanden -- das waere von einem echten Befund ununterscheidbar,
 *            wenn es als PASS zaehlte. SKIP zaehlt daher wie FAIL als rot.
 *
 * Aufruf:  node scripts/verify-supabase-write-error-check.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IS_MAIN = process.argv[1] === fileURLToPath(import.meta.url);

/**
 * Die bekannten Schreibstellen.
 *
 * `anker`   -- eindeutiger Text, der die Stelle im Quelltext lokalisiert. Muss
 *              genau einmal vorkommen; taucht er 0x oder >1x auf, ist der
 *              Eintrag nicht mehr verlaesslich einer Stelle zugeordnet und das
 *              Skript schlaegt fehl, statt zu raten.
 * `fenster` -- wie viele Zeichen nach dem Anker durchsucht werden.
 * `konform` -- Muster, das im Fenster die zugesagte Fehlerbehandlung belegt.
 * `status`  -- 'helfer' (nutzt vxSbWrite/adminSbWrite) oder 'explizit'
 *              (bereits vorhandene, korrekte {error}-Pruefung ohne Helfer --
 *              wird nicht angetastet, siehe vxDv2SaveNote).
 */
export const BEKANNTE_STELLEN = [
  // ── customer-dashboard/index.html ──────────────────────────────────────
  {
    datei: 'customer-dashboard/index.html',
    funktion: 'vxNotifMarkRead',
    status: 'helfer',
    anker: "async function vxNotifMarkRead(id) {",
    fenster: 500,
    konform: /vxSbWrite\(/
  },
  {
    datei: 'customer-dashboard/index.html',
    funktion: 'vxNotifPersistReadIds',
    status: 'helfer',
    anker: 'async function vxNotifPersistReadIds(ids) {',
    fenster: 500,
    konform: /vxSbWrite\(/
  },
  {
    datei: 'customer-dashboard/index.html',
    funktion: 'vxNotifMarkAllRead',
    status: 'helfer',
    anker: 'async function vxNotifMarkAllRead() {',
    fenster: 600,
    konform: /vxSbWrite\(/
  },
  {
    // #971-Nachschlag (Codex): {error}-Pruefung allein reicht nicht -- eine
    // durch RLS herausgefilterte Zeile meldet error:null bei 0 betroffenen
    // Zeilen. .select('id') plus Laengenpruefung auf die Rueckgabe noetig.
    datei: 'customer-dashboard/index.html',
    funktion: 'vxSaveProfil (Name-Update)',
    status: 'explizit',
    anker: "const { data: nameRows, error: nameError } = await _sb.from('customers').update({ contact_first_name: name,",
    fenster: 350,
    konform: /\.select\('id'\);\s*if \(nameError\) throw new Error\(nameError\.message\);\s*if \(!nameRows \|\| nameRows\.length === 0\) throw new Error\(/
  },
  {
    datei: 'customer-dashboard/index.html',
    funktion: 'vxOnboardingMarkComplete',
    status: 'explizit',
    anker: 'async function vxOnboardingMarkComplete() {',
    fenster: 400,
    konform: /const \{ error \} = await _sb\.from\('customers'\)[\s\S]{0,150}if \(error\) \{/
  },
  {
    datei: 'customer-dashboard/index.html',
    funktion: 'vxMarkCallAsRead',
    status: 'explizit',
    anker: 'function vxMarkCallAsRead(callId) {',
    fenster: 1100,
    konform: /\.then\(function\(res\) \{\s*if \(res && res\.error\) \{/
  },
  {
    datei: 'customer-dashboard/index.html',
    funktion: 'vxMarkRequestAsRead',
    status: 'explizit',
    anker: 'function vxMarkRequestAsRead(recordId) {',
    fenster: 700,
    konform: /\.then\(function\(res\)\{\s*if \(res && res\.error\) \{/
  },
  {
    datei: 'customer-dashboard/index.html',
    funktion: 'vxMarkRequestAsUnread',
    status: 'explizit',
    anker: 'function vxMarkRequestAsUnread(recordId) {',
    fenster: 700,
    konform: /\.then\(function\(res\)\{\s*if \(res && res\.error\) \{/
  },
  {
    datei: 'customer-dashboard/index.html',
    funktion: 'saveFollowUpV2 (callback_requested Reset)',
    status: 'explizit',
    anker: 'Wenn der Call callback_requested=true hatte UND die Folge-Aufgabe NICHT',
    fenster: 750,
    konform: /\.then\(function\(rr\) \{\s*if \(rr\.error\) \{/
  },
  {
    datei: 'customer-dashboard/index.html',
    funktion: 'vxCallDetailErledigt',
    status: 'explizit',
    anker: "sb.from('calls').update({ dashboard_status: 'closed',",
    fenster: 250,
    konform: /\.then\(function\(r\) \{\s*resetBtn\(\);\s*if \(r\.error\) \{/
  },
  {
    datei: 'customer-dashboard/index.html',
    funktion: 'saveFollowUp (customer_tasks insert)',
    status: 'explizit',
    anker: "sb.from('customer_tasks').insert([taskData])",
    fenster: 200,
    konform: /\.then\(function\(r\) \{\s*if \(r\.error\) \{/
  },
  {
    datei: 'customer-dashboard/index.html',
    funktion: 'saveFollowUp (callback_requested Reset)',
    status: 'explizit',
    anker: 'Wenn der ursprüngliche Anruf "callback_requested=true" hatte UND',
    fenster: 1000,
    konform: /\.then\(function\(rr\) \{\s*if \(rr\.error\) \{/
  },
  {
    datei: 'customer-dashboard/index.html',
    funktion: 'vxDv2SaveNote',
    status: 'explizit',
    anker: 'window.vxDv2SaveNote = function() {',
    fenster: 1050,
    konform: /if \(result && result\.error\) throw new Error\(/
  },

  // ── admin-panel/index.html ───────────────────────────────────────────────
  {
    datei: 'admin-panel/index.html',
    funktion: 'Rechnungsstatus nach Mailversand',
    status: 'explizit',
    anker: "const {error:updateError}=await authClient.from('invoices')",
    fenster: 250,
    konform: /if\(updateError\)\{/
  },
  {
    datei: 'admin-panel/index.html',
    funktion: 'updateChangeRequestStatus',
    status: 'helfer',
    anker: 'async function updateChangeRequestStatus(id, status) {',
    fenster: 350,
    konform: /adminSbWrite\(/
  },
  {
    datei: 'admin-panel/index.html',
    funktion: 'saveChangeRequestNote',
    status: 'helfer',
    anker: 'async function saveChangeRequestNote(id) {',
    fenster: 350,
    konform: /adminSbWrite\(/
  },
  {
    datei: 'admin-panel/index.html',
    funktion: 'Auto-Apply-Flow (admin_notes)',
    status: 'helfer',
    anker: '// 5. Save admin note',
    fenster: 300,
    konform: /adminSbWrite\(/
  },
  {
    datei: 'customer-dashboard/index.html',
    funktion: 'vxBestEffortPatchCallLifecycle',
    status: 'explizit',
    anker: 'async function vxBestEffortPatchCallLifecycle(recordId, fields) {',
    fenster: 500,
    konform: /var res = await sb\.from\(CALLS_TABLE\)\.update\(fields\)[\s\S]{0,150}if \(res && res\.error\) throw res\.error;/
  },
  {
    datei: 'customer-dashboard/index.html',
    funktion: 'vxBestEffortPatchTaskLifecycle',
    status: 'explizit',
    anker: 'async function vxBestEffortPatchTaskLifecycle(recordId, fields) {',
    fenster: 800,
    konform: /var res = await sb\.from\(CASES_TABLE\)\.update\(fields\)[\s\S]{0,150}if \(res && res\.error\) throw res\.error;/
  }
];

/**
 * Stellen, die wie ein Treffer aussehen, aber keiner sind. Jede braucht eine
 * echte Begruendung -- ein leeres oder vertroestendes Feld ("spaeter", "tbd")
 * ist keine.
 */
export const KEINE_SCHREIBSTELLEN = [];

export const PLATZHALTER_MUSTER = /^\s*(sp[aä]ter|tbd|todo|fixme|xxx|noch offen|folgt|k[uü]mmern wir uns)\.?\s*$/i;

export function pruefeBegruendung(eintrag) {
  const grund = String(eintrag.grund || '').trim();
  if (grund.length < 20 || PLATZHALTER_MUSTER.test(grund)) {
    return `Ausnahme "${eintrag.datei}" hat keine belastbare Begruendung ("${grund || '(leer)'}"). ` +
      'Ein Feld, in das man "spaeter" schreiben kann, fuellt sich von selbst.';
  }
  return null;
}

/**
 * Alle rohen `.from(...).{insert,update,upsert,delete}(...)`-Treffer in einer
 * Datei. Das Argument von `.from(` ist bewusst nicht auf String-Literale
 * eingeschraenkt (`[^)]*`) -- eine Stelle wie `sb.from(CALLS_TABLE).update(...)`
 * mit einer Konstante statt eines Literals waere sonst unsichtbar fuer die
 * Selbstsuche und koennte unbemerkt durchrutschen (siehe
 * vxBestEffortPatchCallLifecycle/-TaskLifecycle). Das Fenster schliesst dafuer
 * an der naechsten Anweisungsgrenze (`;`), damit `Array.from(x); ... .delete(y)`
 * an einer voellig anderen Stelle im Code nicht als Supabase-Schreibzugriff
 * missverstanden wird -- ein echter Fluent-Chain-Aufruf hat kein Semikolon
 * zwischen `.from(...)` und dem Schreibverb.
 */
export const SCHREIBMUSTER = /\.from\([^)]*\)[^;]{0,250}?\.(insert|update|upsert|delete)\(/g;

export function zaehleSchreibstellen(inhalt) {
  const treffer = inhalt.match(SCHREIBMUSTER) || [];
  return treffer.length;
}

/**
 * Prueft eine einzelne bekannte Stelle gegen den Dateiinhalt. Reine Funktion,
 * keine Ausgabe -- damit im Test unabhaengig vom Live-Stand der Dateien
 * pruefbar (Fixtures statt echter index.html).
 */
export function pruefeStelle(inhalt, stelle) {
  const ankerTreffer = inhalt.split(stelle.anker).length - 1;
  if (ankerTreffer !== 1) {
    return { ok: false, grund: ankerTreffer === 0 ? 'anker_fehlt' : 'anker_mehrdeutig', ankerTreffer };
  }
  const start = inhalt.indexOf(stelle.anker);
  const fenster = inhalt.slice(start, start + stelle.anker.length + stelle.fenster);
  return { ok: stelle.konform.test(fenster), grund: 'konform_pruefung', ankerTreffer };
}

/**
 * Dreiwertige Klassifikation des Rohbefunds einer Datei: 'skip' (nichts
 * gefunden -- verdaechtig, nicht bestanden), 'fail' (Zaehlung weicht von der
 * eingetragenen Menge ab), 'ok' (deckt sich).
 */
export function klassifiziereRohbefund(gefunden, eingetragen) {
  if (gefunden === 0) return 'skip';
  if (gefunden !== eingetragen) return 'fail';
  return 'ok';
}

/**
 * Ratsche statt Dauerrot: die sechs am 2026-08-11 gefundenen, noch offenen
 * Stellen (siehe Dateikopf) sind bekannte, dokumentierte Restschuld -- kein
 * Grund, ab sofort JEDEN Pull Request in diesem Repo rot zu markieren, bis
 * sie gefixt sind (das waere selbst ein Vakuum-Pass: ein Dauerrot, das
 * niemand mehr liest, ist von "nichts geprueft" nicht zu unterscheiden).
 * Stattdessen: PASS, solange die Zahl der nicht-konformen bekannten Stellen
 * GENAU dieser Basislinie entspricht. Steigt sie (Regression) oder sinkt sie
 * (Fix gelandet, Basislinie nicht nachgezogen), schlaegt die Pruefung fehl --
 * in beide Richtungen mit eigener, klarer Meldung. Eine neue, nicht
 * eingetragene Stelle (Rohbefund-Abweichung weiter unten) bleibt davon
 * unberuehrt und schlaegt immer hart fehl.
 *
 * Wer eine der sechs Stellen fixt, senkt diese Zahl im selben Commit --
 * sonst faengt das Skript das selbst ab.
 */
export const BASISLINIE_NICHT_KONFORM = 6;

/**
 * Vergleicht die tatsaechliche Restschuld mit der Basislinie. Reine Funktion,
 * damit alle drei Faelle unabhaengig vom Live-Stand der Dateien testbar sind.
 */
export function klassifiziereRestschuld(anzahl, basislinie) {
  if (anzahl === basislinie) return 'ok';
  if (anzahl > basislinie) return 'regression';
  return 'unaktualisiert';
}

const DATEIEN = ['customer-dashboard/index.html', 'admin-panel/index.html'];

function main() {
  let fehler = 0;
  let vakuum = false;
  console.log('Browser-Supabase-Schreibzugriffe: Fehlerbehandlung\n');

  const inhalte = {};
  for (const datei of DATEIEN) {
    try {
      inhalte[datei] = readFileSync(join(ROOT, datei), 'utf8');
    } catch {
      fehler += 1;
      console.log(`✗ ${datei} nicht lesbar.`);
    }
  }

  /* ── 1 · Jede bekannte Stelle: Anker eindeutig, Behandlung noch da ─────────── */
  console.log('  Bekannte Schreibstellen');
  console.log('  ' + '─'.repeat(76));
  const nichtKonformeStellen = [];
  for (const stelle of BEKANNTE_STELLEN) {
    const inhalt = inhalte[stelle.datei];
    if (inhalt === undefined) continue;

    const ergebnis = pruefeStelle(inhalt, stelle);
    if (ergebnis.grund === 'anker_fehlt' || ergebnis.grund === 'anker_mehrdeutig') {
      // Anker-Integritaet ist keine Ratsche: das Skript selbst kann hier
      // nicht mehr verlaesslich pruefen, das ist immer ein harter Fehler.
      fehler += 1;
      console.log(`  ✗ ${stelle.funktion.padEnd(42)} ${stelle.datei}`);
      console.log(`      Anker ${ergebnis.grund === 'anker_fehlt' ? 'nicht gefunden' : `${ergebnis.ankerTreffer}x gefunden (nicht eindeutig)`}: "${stelle.anker}"`);
      continue;
    }

    if (!ergebnis.ok) nichtKonformeStellen.push(stelle);
    console.log(`  ${ergebnis.ok ? '✓' : '✗'} ${stelle.funktion.padEnd(42)} ${stelle.status.padEnd(9)} ${stelle.datei}`);
    if (!ergebnis.ok) {
      console.log('      Bekannte, dokumentierte Restschuld (siehe BASISLINIE_NICHT_KONFORM unten) --');
      console.log('      zaehlt nicht einzeln als Fehler, aber in die Ratsche.');
    }
  }

  /* ── 1b · Ratsche: Restschuld darf sich nur mit nachgezogener Basislinie bewegen ── */
  console.log('\n  Bekannte Restschuld (Ratsche)');
  console.log('  ' + '─'.repeat(76));
  const restschuldKlasse = klassifiziereRestschuld(nichtKonformeStellen.length, BASISLINIE_NICHT_KONFORM);
  if (restschuldKlasse === 'ok') {
    console.log(`  ✓ ${nichtKonformeStellen.length} bekannte Stelle(n) ohne Helfer/Pruefung -- unveraendert gegenueber der Basislinie.`);
    nichtKonformeStellen.forEach((s) => console.log(`      · ${s.funktion} (${s.datei})`));
  } else if (restschuldKlasse === 'regression') {
    fehler += 1;
    console.log(`  ✗ ${nichtKonformeStellen.length} bekannte Stelle(n) ohne Behandlung, Basislinie war ${BASISLINIE_NICHT_KONFORM}.`);
    console.log('      Regression: eine zuvor konforme Stelle wurde ohne die Pruefung umgeschrieben.');
    nichtKonformeStellen.forEach((s) => console.log(`      · ${s.funktion} (${s.datei})`));
  } else {
    fehler += 1;
    console.log(`  ✗ Nur noch ${nichtKonformeStellen.length} bekannte Stelle(n) ohne Behandlung, Basislinie steht noch auf ${BASISLINIE_NICHT_KONFORM}.`);
    console.log('      Fortschritt gelandet, aber BASISLINIE_NICHT_KONFORM in diesem Skript nicht nachgezogen --');
    console.log('      sonst koennte die Zahl unbemerkt wieder bis zur alten Basislinie steigen. Bitte senken.');
  }

  /* ── 2 · Rohe Treffer je Datei vs. eingetragene Menge ───────────────────────── */
  console.log('\n  Rohbefund je Datei');
  console.log('  ' + '─'.repeat(76));
  for (const datei of DATEIEN) {
    const inhalt = inhalte[datei];
    if (inhalt === undefined) continue;
    const gefunden = zaehleSchreibstellen(inhalt);
    const eingetragen = BEKANNTE_STELLEN.filter((s) => s.datei === datei).length;
    const klasse = klassifiziereRohbefund(gefunden, eingetragen);
    if (klasse === 'skip') {
      vakuum = true;
      console.log(`  ⚠ ${datei}: 0 Schreibstellen gefunden -- SKIP, kein Befund.`);
      console.log('      Ein Regex, der in einer Datei mit bekannten Schreibzugriffen nichts findet,');
      console.log('      ist vermutlich kaputt, nicht Beleg fuer "nichts zu pruefen". Zaehlt als rot.');
    } else if (klasse === 'fail') {
      fehler += 1;
      console.log(`  ✗ ${datei}: ${gefunden} Stelle(n) gefunden, aber ${eingetragen} eingetragen.`);
      console.log('      Eine neue oder entfernte Schreibstelle ist nicht in BEKANNTE_STELLEN nachgezogen.');
    } else {
      console.log(`  ✓ ${datei}: ${gefunden} Stelle(n) gefunden, alle eingetragen.`);
    }
  }

  /* ── 3 · Ausnahmen brauchen eine echte Begruendung ──────────────────────────── */
  if (KEINE_SCHREIBSTELLEN.length) {
    console.log('\n  Ausnahmen');
    console.log('  ' + '─'.repeat(76));
    for (const eintrag of KEINE_SCHREIBSTELLEN) {
      const problem = pruefeBegruendung(eintrag);
      if (problem) {
        fehler += 1;
        console.log(`  ✗ ${problem}`);
      } else {
        console.log(`  · ${eintrag.datei}\n      ${eintrag.grund}`);
      }
    }
  }

  /* ── Dreiwertiges Ergebnis ───────────────────────────────────────────────────── */
  console.log('\n' + '─'.repeat(78));
  if (vakuum) {
    console.error(`SKIP: mindestens eine Datei lieferte keinen Befund. ${fehler} weitere Pruefung(en) fehlgeschlagen.`);
    process.exit(1);
  }
  if (fehler > 0) {
    console.error(`FAIL: ${fehler} Pruefung(en) fehlgeschlagen.`);
    process.exit(1);
  }
  console.log(`PASS: keine unbekannten Stellen, kein Vakuum, Restschuld = Basislinie (${BASISLINIE_NICHT_KONFORM}).`);
}

if (IS_MAIN) main();
