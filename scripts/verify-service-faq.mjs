import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  parseServiceList, sanitizeServiceList, formatServiceList,
  parseFaqList, sanitizeFaqList, formatFaqList
} = require('../customer-dashboard/netlify/functions/_lib/service-faq.js');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { failed += 1; console.error(`FAIL ${name}: ${error.message}`); }
}

// Die Texte stehen woertlich so in industry_templates (gelesen 09.08.),
// einschliesslich der Eigenheit, dass der Zeilenumbruch dort als zwei Zeichen
// gespeichert ist. Ein nachgebauter Text haette den Parser gegen meine
// Annahme geprueft statt gegen die Daten.
const ZAHNARZT_SERVICES = 'Zahnreinigung und Prophylaxe\\nFüllungen und Inlays\\nZahnersatz: Kronen, Brücken, Prothesen\\nImplantate\\nKieferorthopädie (Spangen, Aligner)\\nBleaching / Zahnaufhellung\\nWurzelbehandlungen\\nNotfallbehandlungen (Zahnschmerzen, abgebrochener Zahn)';
const COIFFEUR_SERVICES = 'Damen: Schnitt, Föhnen, Styling\\nColorationen: Tönung, Färbung, Strähnchen, Balayage\\nPflegebehandlungen: Keratin, Intensivpflege, Kopfhautbehandlung\\nHerren: Schnitt, Bart\\nKinder: Schnitt\\nHochsteckfrisuren für besondere Anlässe (Hochzeit, Abi etc.)\\nProduktverkauf: [Marken eintragen]';
const GENERIC_SERVICES = 'Bitte die wichtigsten Leistungen oder Produkte eintragen, die Lara erwähnen darf. Beispiel: Produkt A, Dienstleistung B, Beratung C. Wichtig: Lara darf nur Leistungen erwähnen, die hier explizit aufgeführt sind.';

const ZAHNARZT_FAQ = 'Terminanfrage aufnehmen: Name, Geburtsdatum, Anliegen (Kontrolle / Schmerzen / Behandlung), gewünschtes Datum. Neue Patienten: bitte Krankenkassenkarte mitbringen.\\nNotfall-Kriterien: Starke Zahnschmerzen, abgebrochener Zahn, Schwellung → als Notfall markieren, sofort weitergeben.\\nHäufige Fragen:\\n– Was kostet eine Zahnreinigung? → Ab CHF [Preis], genaue Auskunft durch Praxis.\\n– Übernimmt die Krankenkasse die Kosten? → Grundversicherung deckt wenig, Zusatzversicherung variiert — Praxis gibt Auskunft.\\n– Habt ihr Angst-Patienten-Angebote? → Ja, bitte beim Termin erwähnen.\\n– Wie schnell bekomme ich einen Notfall-Termin? → Bei akuten Schmerzen: heute noch, Rückruf durch Praxis.';
const COIFFEUR_FAQ = 'Termin aufnehmen: Dienstleistung (z.B. Schnitt + Föhnen, Coloration), gewünschte Stylistin/Stylisten, Datum und Uhrzeit, Name und Telefonnummer.\\nAbsagen: mindestens 24 Stunden vorher — sonst ggf. Ausfallgebühr.\\nColorationen und Strähnchen: 2–3 Stunden einplanen, früh genug buchen.\\nHäufige Fragen:\\n– Was kostet ein Damenschnitt? → Ab CHF [Preis] je nach Länge, genaue Auskunft beim Termin.\\n– Brauche ich einen Termin? → Ja, wir arbeiten ausschliesslich auf Termin.\\n– Kann ich eine bestimmte Stylistin wünschen? → Ja, bei der Terminbuchung angeben.\\n– Wie lange dauert eine Coloration? → Ca. 2–3 Stunden, je nach Technik.';

// Der einzige Kunde mit eigenen Texten (09.08.). Andere Schreibweise als die
// Vorlagen: echte Zeilenumbrueche, kein Aufzaehlungszeichen, keine
// Ueberschrift, Gedankenstrich statt Pfeil.
const KUNDE_SERVICES = 'KI-Gesprächsführung auf Deutsch\nAutomatische Zusammenfassung von Anrufen\nIntelligente Priorisierung von Anliegen\nRückruf-Management (ab Business+)';
const KUNDE_FAQ = 'Merken Kunden dass ein KI drangeht? – Voxera führt natürliche Gespräche auf Deutsch\nFunktioniert Voxera mit bestehender Nummer? – Ja, durch einfache Rufweiterleitung\nKann ich jederzeit kündigen? – Monatspläne monatlich kündbar mit 30 Tagen Frist';

check('services: the two-character line break of the templates is a line break', () => {
  const { items, ignored } = parseServiceList(ZAHNARZT_SERVICES);
  assert.equal(items.length, 8, `erwartet 8 Eintraege, erhalten ${items.length}`);
  assert.equal(items[0], 'Zahnreinigung und Prophylaxe');
  assert.equal(items[2], 'Zahnersatz: Kronen, Brücken, Prothesen');
  assert.equal(ignored.length, 0);
});

check('services: an unfilled marker is reported, not stripped to half a line', () => {
  const { items, ignored } = parseServiceList(COIFFEUR_SERVICES);
  assert.equal(items.length, 6);
  assert.ok(!items.some((entry) => entry.startsWith('Produktverkauf')), 'Die halbe Zeile wurde uebernommen');
  assert.equal(ignored.join(), 'Produktverkauf: [Marken eintragen]');
});

check('services: an instruction to the person filling it in is not a service', () => {
  const { items, ignored } = parseServiceList(GENERIC_SERVICES);
  assert.equal(items.length, 0, 'Die Ausfuellanweisung wurde als Leistung uebernommen');
  assert.equal(ignored.length, 1);
});

check('services: real line breaks and bullets work the same way', () => {
  assert.equal(parseServiceList(KUNDE_SERVICES).items.length, 4);
  const bulleted = parseServiceList('- Schnitt\n• Färbung\n2) Pflege\n– Styling');
  assert.deepEqual(bulleted.items, ['Schnitt', 'Färbung', 'Pflege', 'Styling']);
});

check('services: nothing in, nothing out', () => {
  assert.deepEqual(parseServiceList('').items, []);
  assert.deepEqual(parseServiceList(null).items, []);
});

check('faq: the arrow dialect of the templates is read as pairs', () => {
  const { items } = parseFaqList(ZAHNARZT_FAQ);
  assert.equal(items.length, 3, `erwartet 3 Paare, erhalten ${items.length}`);
  assert.equal(items[0].q, 'Übernimmt die Krankenkasse die Kosten?');
  assert.match(items[0].a, /^Grundversicherung deckt wenig/);
});

check('faq: a price marker makes the pair a report, not a half sentence', () => {
  const { items, ignored } = parseFaqList(ZAHNARZT_FAQ);
  assert.ok(!items.some((entry) => entry.q.includes('Zahnreinigung')), 'Die Zeile mit [Preis] wurde uebernommen');
  assert.ok(ignored.some((line) => line.includes('[Preis]')), 'Die Zeile mit [Preis] wurde stillschweigend verworfen');
});

check('faq: the intake checklist above the heading is reported separately (G6)', () => {
  const { rules } = parseFaqList(ZAHNARZT_FAQ);
  assert.equal(rules.length, 2, `erwartet 2 Regelzeilen, erhalten ${rules.length}`);
  assert.match(rules[0], /^Terminanfrage aufnehmen:/);
});

// Die Vorlage `zahnarzt` benutzt in einer Regelzeile denselben Pfeil wie in
// ihren Fragen. Ohne die Grenze an der Ueberschrift wuerde daraus die Frage
// "Notfall-Kriterien: ..." mit einer Anweisung an das Praxisteam als Antwort.
check('faq: an arrow in a rule line above the heading does not become a question', () => {
  const { items, rules } = parseFaqList(ZAHNARZT_FAQ);
  assert.ok(!items.some((entry) => entry.q.startsWith('Notfall-Kriterien')), 'Eine Regelzeile mit Pfeil wurde zur Frage');
  assert.ok(rules.some((line) => line.startsWith('Notfall-Kriterien:')), 'Die Regelzeile mit Pfeil fehlt in der Meldung');
});

check('faq: a rule with an em dash does not become a question', () => {
  const { items, rules } = parseFaqList(COIFFEUR_FAQ);
  assert.ok(!items.some((entry) => entry.q.startsWith('Absagen')), 'Eine Regelzeile wurde zur Frage');
  assert.ok(rules.some((line) => line.startsWith('Absagen:')), 'Die Regelzeile fehlt in der Meldung');
  assert.equal(rules.length, 3);
});

check('faq: the customer dialect without heading or arrow is read as pairs', () => {
  const { items, rules, ignored } = parseFaqList(KUNDE_FAQ);
  assert.equal(items.length, 3);
  assert.equal(items[2].q, 'Kann ich jederzeit kündigen?');
  assert.equal(items[2].a, 'Monatspläne monatlich kündbar mit 30 Tagen Frist');
  assert.equal(rules.length, 0);
  assert.equal(ignored.length, 0);
});

check('faq: nothing in, nothing out', () => {
  assert.deepEqual(parseFaqList('').items, []);
  assert.deepEqual(parseFaqList(undefined).rules, []);
});

// ── Schreibpfad: darf nicht raten ───────────────────────────────────────────

check('write path: a well-formed list is accepted and empty rows fall away', () => {
  const result = sanitizeServiceList(['Schnitt', '  ', 'Färbung', '']);
  assert.deepEqual(result.value, ['Schnitt', 'Färbung']);
  assert.equal(result.errors.length, 0);
});

check('write path: a list can be emptied again', () => {
  assert.equal(sanitizeServiceList([]).value, null);
  assert.equal(sanitizeServiceList(null).value, null);
  assert.equal(sanitizeServiceList('').value, null);
});

check('write path: braces cannot smuggle a placeholder into the prompt', () => {
  assert.deepEqual(sanitizeServiceList(['Schnitt {{ASSISTANT_NAME}}']).value, ['Schnitt ASSISTANT_NAME']);
  assert.deepEqual(sanitizeFaqList([{ q: 'Wie {{X}}?', a: 'So {{Y}}' }]).value, [{ q: 'Wie X?', a: 'So Y' }]);
});

check('write path: the wrong shape is rejected instead of bent into place', () => {
  assert.equal(sanitizeServiceList('Schnitt, Färbung').errors.join(), 'service_list_not_an_array');
  assert.equal(sanitizeServiceList([{ name: 'Schnitt' }]).errors.join(), 'service_entry_not_text');
  assert.equal(sanitizeFaqList([['Frage', 'Antwort']]).errors.join(), 'faq_entry_not_an_object');
  assert.equal(sanitizeFaqList([{ q: 'Frage?', a: 'Antwort', preis: '10' }]).errors.join(), 'faq_entry_unknown_key');
});

check('write path: half a pair is an error, an empty pair is a blank row', () => {
  assert.equal(sanitizeFaqList([{ q: 'Kostet das etwas?', a: '' }]).errors.join(), 'faq_entry_incomplete');
  assert.equal(sanitizeFaqList([{ q: '', a: 'Ja' }]).errors.join(), 'faq_entry_incomplete');
  assert.equal(sanitizeFaqList([{ q: '  ', a: '' }]).value, null);
});

check('write path: an error rejects the whole field, it does not save a part of it', () => {
  const result = sanitizeFaqList([{ q: 'Gut?', a: 'Ja' }, { q: 'Halb?', a: '' }]);
  assert.equal(result.value, null, 'Ein Teil der Liste wurde trotz Fehler gespeichert');
});

check('write path: length limits hold', () => {
  assert.equal(sanitizeServiceList(new Array(41).fill('x')).errors.join(), 'service_list_too_long');
  assert.equal(sanitizeFaqList(new Array(31).fill({ q: 'a?', a: 'b' })).errors.join(), 'faq_list_too_long');
  assert.equal(sanitizeServiceList(['x'.repeat(500)]).value[0].length, 200);
});

// ── Was der Parser vorschlaegt, muss der Schreibpfad annehmen ───────────────
// Laufen die beiden auseinander, schlaegt entweder ein Vorschlag beim Speichern
// fehl oder es landet etwas in der Datenbank, das niemand bestaetigt hat.

check('proposal and write path agree on all real template texts', () => {
  for (const text of [ZAHNARZT_SERVICES, COIFFEUR_SERVICES, GENERIC_SERVICES, KUNDE_SERVICES]) {
    const { items } = parseServiceList(text);
    const result = sanitizeServiceList(items);
    assert.equal(result.errors.length, 0, `Vorschlag abgewiesen: ${result.errors.join()}`);
    assert.equal(JSON.stringify(result.value), JSON.stringify(items.length ? items : null));
  }
  for (const text of [ZAHNARZT_FAQ, COIFFEUR_FAQ, KUNDE_FAQ]) {
    const { items } = parseFaqList(text);
    const result = sanitizeFaqList(items);
    assert.equal(result.errors.length, 0, `Vorschlag abgewiesen: ${result.errors.join()}`);
    assert.equal(JSON.stringify(result.value), JSON.stringify(items.length ? items : null));
  }
});

check('display: the prompt gets a list, not a block of text', () => {
  assert.equal(formatServiceList(['Schnitt', 'Färbung']), '- Schnitt\n- Färbung');
  assert.equal(formatServiceList([]), '');
  assert.equal(formatFaqList([{ q: 'Kostet das?', a: 'Ja' }]), '- Frage: Kostet das?\n  Antwort: Ja');
  assert.equal(formatFaqList(null), '');
});

if (failed) {
  console.error(`Service/FAQ verification failed: ${failed}`);
  process.exit(1);
}
console.log('Service/FAQ verification passed.');
