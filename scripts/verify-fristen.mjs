// Waechter fuer datierte Zusagen (config/fristen.json).
//
// Warum es das gibt: Im Datenresidenz-Strang (11.08.2026) sind mehrere Zusagen
// aufgefallen, die daran gescheitert sind, dass niemand am richtigen Tag daran
// dachte -- eine Loeschfrist ohne Prozess, eine Aufbewahrungszusage, die die
// Technik nicht einhielt, ein Datenexport, den es nie gab. Ein Datum in einem
// Dokument ist keine Wiedervorlage.
//
// Dieselbe Bauform wie der Ablaufwaechter fuer AKTION.gueltigBis in
// verify-seo.mjs, nur allgemein: ein Datum, das ohne Deploy still verstreicht,
// darf es nicht geben.
//
// ZWEI STUFEN, und der Unterschied ist der Sinn der Sache:
//
//   erinnernAb   Der TAEGLICHE Lauf wird rot. Das ist die Wiedervorlage: ein
//                fehlgeschlagener geplanter Lauf benachrichtigt den Besitzer,
//                ohne dass jemand ein Dokument oeffnen oder einen PR stellen
//                muss. Genau das haengt an keinem Gedaechtnis.
//
//   faelligAm    ZUSAETZLICH wird jeder Pull Request rot. Ab hier ist die
//                Zusage gebrochen, und das soll nicht mehr uebersehbar sein.
//
// Pull Requests laufen deshalb mit --nur-fristen: Ein verstrichener Starttermin
// soll an eine offene Aufgabe erinnern, aber nicht wochenlang jede unbeteiligte
// Aenderung blockieren. Wer beides gleich behandelt, bekommt einen Waechter,
// den man wegklickt -- und das ist schlimmer als keiner.
//
// Aufruf:
//   node scripts/verify-fristen.mjs                (taeglich: beide Stufen)
//   node scripts/verify-fristen.mjs --nur-fristen  (PR: nur harte Fristen)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const hier = dirname(fileURLToPath(import.meta.url));
const datei = join(hier, '..', 'config', 'fristen.json');

const nurFristen = process.argv.includes('--nur-fristen');
const modus = nurFristen ? 'nur harte Fristen (Pull Request)' : 'Fristen und Starttermine (taeglicher Lauf)';

// Datum ohne Uhrzeit. Die Zeitzone des Laufs soll das Ergebnis nicht um einen
// Tag verschieben -- deshalb wird durchweg in UTC-Datumsteilen verglichen.
const heute = new Date().toISOString().slice(0, 10);

function ladeFristen() {
  let roh;
  try {
    roh = readFileSync(datei, 'utf8');
  } catch (fehler) {
    console.error(`FEHLER: ${datei} nicht lesbar -- ${fehler.message}`);
    process.exit(1);
  }
  try {
    const daten = JSON.parse(roh);
    if (!Array.isArray(daten.fristen)) throw new Error('Feld "fristen" fehlt oder ist kein Array');
    return daten.fristen;
  } catch (fehler) {
    console.error(`FEHLER: ${datei} ist kein gueltiges Frist-Register -- ${fehler.message}`);
    process.exit(1);
  }
}

// Ein Tippfehler im Datum darf nicht dazu fuehren, dass ein Eintrag stillschweigend
// nie faellig wird. Das waere dieselbe Klasse von Fehler, die der Waechter
// verhindern soll -- nur eine Ebene tiefer.
function pruefeDatum(wert, feld, id) {
  if (wert === null || wert === undefined) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(wert) || Number.isNaN(Date.parse(wert))) {
    console.error(`FEHLER: ${id}: ${feld} ist kein Datum im Format JJJJ-MM-TT (steht: ${JSON.stringify(wert)})`);
    process.exit(1);
  }
  return wert;
}

const fristen = ladeFristen();
const offen = [];
const erinnerungen = [];
const erledigt = [];

for (const eintrag of fristen) {
  const id = eintrag.id || '<ohne id>';
  const erinnernAb = pruefeDatum(eintrag.erinnernAb, 'erinnernAb', id);
  const faelligAm = pruefeDatum(eintrag.faelligAm, 'faelligAm', id);
  const erledigtAm = pruefeDatum(eintrag.erledigtAm, 'erledigtAm', id);

  if (!faelligAm) {
    console.error(`FEHLER: ${id}: faelligAm fehlt. Ein Eintrag ohne harte Frist kann nie rot werden.`);
    process.exit(1);
  }
  if (erinnernAb && erinnernAb > faelligAm) {
    console.error(`FEHLER: ${id}: erinnernAb (${erinnernAb}) liegt nach faelligAm (${faelligAm}).`);
    process.exit(1);
  }

  if (erledigtAm) { erledigt.push({ ...eintrag, erledigtAm }); continue; }

  if (heute >= faelligAm) offen.push({ ...eintrag, stufe: 'FRIST', datum: faelligAm });
  else if (erinnernAb && heute >= erinnernAb) erinnerungen.push({ ...eintrag, stufe: 'START', datum: erinnernAb });
}

function tageSeit(datum) {
  return Math.floor((Date.parse(heute) - Date.parse(datum)) / 86400000);
}

function ausgeben(eintrag) {
  const tage = tageSeit(eintrag.datum);
  console.log(`  [${eintrag.stufe}] ${eintrag.id}`);
  console.log(`         ${eintrag.was}`);
  console.log(`         seit ${eintrag.datum} (${tage} Tag${tage === 1 ? '' : 'e'}) -- Quelle: ${eintrag.quelle}`);
  if (Array.isArray(eintrag.warumHart)) {
    for (const zeile of eintrag.warumHart) console.log(`         ${zeile}`);
  }
  console.log('');
}

console.log(`Frist-Register: ${fristen.length} Eintraege, Stichtag ${heute}, Modus: ${modus}\n`);

let rot = false;

if (offen.length) {
  rot = true;
  console.log(`FRIST VERSTRICHEN (${offen.length}) -- die Zusage ist ab jetzt gebrochen:\n`);
  offen.forEach(ausgeben);
}

if (erinnerungen.length) {
  if (nurFristen) {
    console.log(`Starttermin erreicht (${erinnerungen.length}) -- im PR-Modus nur als Hinweis:\n`);
    erinnerungen.forEach(ausgeben);
  } else {
    rot = true;
    console.log(`STARTTERMIN ERREICHT (${erinnerungen.length}) -- Arbeitsbeginn war vorgesehen:\n`);
    erinnerungen.forEach(ausgeben);
  }
}

if (!rot) {
  const naechste = fristen
    .filter((e) => !e.erledigtAm)
    .map((e) => ({ id: e.id, datum: e.erinnernAb || e.faelligAm }))
    .sort((a, b) => a.datum.localeCompare(b.datum))[0];
  console.log(`OK -- nichts faellig. ${erledigt.length} erledigt, ${fristen.length - erledigt.length} offen.`);
  if (naechste) console.log(`Naechster Termin: ${naechste.id} am ${naechste.datum}.`);
  process.exit(0);
}

console.log('Was jetzt zu tun ist: die Aufgabe erledigen und in config/fristen.json');
console.log('"erledigtAm" auf das Datum setzen. Ein Eintrag, der ohne erledigte Arbeit');
console.log('abgehakt wird, ist genau die Zusage ohne Deckung, gegen die dieses Register');
console.log('gebaut wurde -- dann lieber das Datum verschieben und den Grund vermerken.');
process.exit(1);
