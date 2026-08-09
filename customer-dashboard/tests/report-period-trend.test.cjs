// Bericht: die Zeitraum-Tabs und die Trendzeile darunter.
//
// Hintergrund: "Gesamt" hat per Definition keine Vorperiode. Trotzdem wurde
// gerechnet, und die fehlende Bezugsgroesse war nur daran zu erkennen, dass
// der Zusatz "vs. Vorperiode" weggelassen wurde — sichtbar als gruener
// Aufwaertspfeil mit der vollen Gesamtzahl daneben. Diese Tests halten den
// reparierten Vertrag fest.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dashboard = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function fn(name) {
  const start = dashboard.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'Funktion ' + name + ' nicht gefunden');
  const next = dashboard.indexOf('\nfunction ', start + 1);
  return dashboard.slice(start, next === -1 ? start + 6000 : next);
}

test('der Zeitraum entscheidet, OB verglichen wird — nicht die Zahl der Vorperiode', () => {
  const render = fn('renderAuswertung');
  assert.match(render, /var hasPrevPeriod = _auPeriod !== 'all';/,
    '"Gesamt" muss ausdruecklich als Zeitraum ohne Vorperiode erkannt werden');

  for (const id of ['au2-calls-trend', 'au2-hot-trend', 'au2-rate-trend']) {
    const call = new RegExp("_auTrend\\('" + id + "',\\s*hasPrevPeriod \\?[^,]+:\\s*null,");
    assert.match(render, call, id + ' muss auf "Gesamt" leer bleiben statt gegen nichts zu rechnen');
  }

  // Der Zusatz darf nicht mehr davon abhaengen, ob die Vorperiode Eintraege
  // hatte — genau diese Konstruktion hat den fehlenden Bezug verdeckt.
  assert.doesNotMatch(render, /prevTotal \? 'vs\. Vorperiode' : ''/,
    'die Bezugsgroesse darf nicht ueber einen leeren Zusatz angedeutet werden');
});

test('eine leere Vorperiode ist eine Aussage und behaelt ihren Zusatz', () => {
  const render = fn('renderAuswertung');
  // Bei "7 Tage"/"30 Tage" wird immer verglichen, auch wenn die Vorperiode
  // leer war: "+12 vs. Vorperiode" ist dann faktisch richtig.
  assert.match(render, /_auTrend\('au2-calls-trend', hasPrevPeriod \? total - prevTotal : null, 'vs\. Vorperiode'\)/);
});

test('alle vier Kennzahlen verhalten sich gleich — auch Ø Dauer', () => {
  const render = fn('renderAuswertung');
  assert.match(render, /_auTrend\('au2-dur-trend'/,
    '#au2-dur-trend hielt seinen Platz frei, wurde aber nie beschrieben');
  assert.match(render, /var canCompareDur = hasPrevPeriod && prevTotal > 0 && total > 0;/,
    'ohne Anrufe in einer der beiden Perioden gibt es keinen Mittelwert zu vergleichen');
});

test('_auTrend unterscheidet "nichts zu vergleichen" von "unveraendert"', () => {
  const trend = fn('_auTrend');
  assert.match(trend, /if \(diff === null \|\| diff === undefined\)/,
    'null muss die Zeile leeren');
  assert.match(trend, /if \(diff === 0\) \{ el\.textContent = '→ unverändert'/,
    '0 heisst verglichen und unveraendert, nicht "kein Vergleich"');
  // Die frühere Bedingung hat 0 und null gleich behandelt.
  assert.doesNotMatch(trend, /if \(!diff && diff !== 0\)/);
});

test('der Aktiv-Zustand der Zeitraum-Tabs hat genau einen Schreiber', () => {
  const setPeriod = fn('auSetPeriod');
  assert.match(setPeriod, /button\.classList\.toggle\('active', active\)/,
    'die Schleife leitet den Zustand aus data-report-period ab');
  assert.doesNotMatch(setPeriod, /btn\.classList\.add\('active'\)/,
    'ein zweiter Schreiber konnte einen zusaetzlichen Eintrag aktiv setzen');
});

test('die Kennzahl traegt nur Farbe, wenn sie zu einer Bedeutungsfamilie gehoert', () => {
  // Blau ist seit F7 "interaktiv". Eine Zahl, die man nicht anfassen kann,
  // darf sie nicht tragen.
  assert.match(
    dashboard,
    /\.vx-report-value\{margin-top:10px;color:var\(--vx-color-text\)/,
    'die Grundfarbe der Kennzahl ist Night, nicht Brand-Blau'
  );
  assert.doesNotMatch(
    dashboard,
    /<div class="vx-report-value tone-green" id="au2-dur">/,
    'eine Gespraechsdauer ist kein Abschluss und traegt kein Gruen'
  );
  // Was zu einer Familie gehoert, behaelt seine Farbe.
  assert.match(dashboard, /<div class="vx-report-value tone-gold" id="au2-hot">/);
  assert.match(dashboard, /<div class="vx-report-value tone-green" id="au2-rate">/);
});

test('die Icon-Kachel des Berichts steht auf der gemeinsamen Leiter', () => {
  assert.match(
    dashboard,
    /\.vx-report-insight-icon\{[^}]*width:var\(--vx-ui-icon-tile-md\)[^}]*border-radius:var\(--vx-ui-icon-tile-md-radius\)/,
    'die Hinweis-Kachel darf ihre Groesse nicht selbst waehlen'
  );
});

test('die Bericht-Regeln aus der Zeit vor dem Design-Pass sind weg', () => {
  for (const dead of ['.vx-report-card{', '.vx-report-head{', '.vx-report-ki{', '.vx-report-body{', '.vx-report-text{']) {
    assert.ok(!dashboard.includes(dead), 'tote Regel noch vorhanden: ' + dead);
  }
});
