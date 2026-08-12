import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  REGELBESTANDTEILE,
  ABRECHNUNGSPFADE,
  pruefeRegel,
  pruefePfad
} from './verify-minuten-zaehlregel.mjs';

const SCRIPT = fileURLToPath(new URL('./verify-minuten-zaehlregel.mjs', import.meta.url));
const ROOT = join(dirname(SCRIPT), '..');

function pfad(datei) {
  const gefunden = ABRECHNUNGSPFADE.find((p) => p.datei === datei);
  assert.ok(gefunden, 'Registry-Eintrag fehlt: ' + datei);
  return gefunden;
}

// ── Gegenprobe: der Zustand VOR dem 12.08.2026 muss erkannt werden.
// Die Fixtures sind eingefroren, damit der Test aussagekraeftig bleibt,
// auch wenn der echte Quelltext sich weiterentwickelt.

test('Gegenprobe: eine Zaehlregel ohne live_status-Bedingung faellt auf', () => {
  const ohneDurchgestellt = `
    select coalesce(sum(f.duration_seconds) filter (where f.duration_seconds >= 10), 0) as sek
    from fenster f;
    select ceil(g.sek / 60.0)::integer from gezaehlt g;
  `;
  const ergebnis = pruefeRegel(ohneDurchgestellt);
  const teil = ergebnis.find((t) => t.name === 'nur durchgestellte Gespraeche');
  assert.equal(teil.ok, false, 'ohne live_status-Bedingung zaehlen auch nie durchgestellte Anrufe');
});

test('Gegenprobe: eine Zaehlregel ohne Mindestdauer faellt auf', () => {
  const ohneSchwelle = `
    select coalesce(sum(f.duration_seconds) filter (where f.live_status = 'completed'), 0) as sek
    from fenster f;
    select ceil(g.sek / 60.0)::integer from gezaehlt g;
  `;
  const teil = pruefeRegel(ohneSchwelle).find((t) => t.name === 'Mindestdauer 10 Sekunden');
  assert.equal(teil.ok, false);
});

test('Gegenprobe: Rundung je Anruf statt auf der Summe faellt auf', () => {
  // Das ist exakt die Variante aus daily-billing-runner.js vor der Umstellung,
  // nach SQL uebersetzt: erst je Anruf runden, dann summieren.
  const jeAnruf = `
    select sum(ceil(f.duration_seconds / 60.0)) as minuten
    from fenster f
    where f.live_status = 'completed' and f.duration_seconds >= 10;
  `;
  const teil = pruefeRegel(jeAnruf).find((t) => t.name === 'einmal runden auf der Summe');
  assert.equal(teil.ok, false, 'ceil je Anruf darf nicht als regelkonform durchgehen');
});

test('Positivkontrolle: die echte Zaehlfunktion erfuellt alle drei Bestandteile', () => {
  const sql = `
    coalesce(sum(f.duration_seconds) filter (
      where f.live_status = 'completed' and f.duration_seconds >= 10
    ), 0)::bigint as sek
    ...
    ceil(g.sek / 60.0)::integer
  `;
  for (const teil of pruefeRegel(sql)) {
    assert.equal(teil.ok, true, teil.name + ' muss erkannt werden');
  }
});

// ── Gegenprobe fuer die Abrechnungspfade.

test('Gegenprobe: daily-billing-runner mit eigener ceil-je-Anruf-Schleife faellt auf', () => {
  const alt = `
    let usedMinutes = 0;
    (data || []).forEach(row => {
      const sec = Number(row.duration_seconds);
      if (Number.isFinite(sec) && sec > 0) {
        totalSeconds += sec;
        usedMinutes  += Math.ceil(sec / 60);
      }
    });
  `;
  const e = pruefePfad(alt, pfad('admin-panel/netlify/functions/daily-billing-runner.js'));
  assert.equal(e.nutztZaehlfunktion, false);
  assert.equal(e.rechnetSelbst, true, 'die eigene Schleife muss als zweite Quelle erkannt werden');
});

test('Gegenprobe: invoice-service mit eigenem Math.ceil auf der Summe faellt auf', () => {
  const alt = `
    const usedSeconds = rows.reduce((s, r) => s + r.duration_seconds, 0);
    const usedMinutes = Math.ceil(usedSeconds / 60);
  `;
  const e = pruefePfad(alt, pfad('admin-panel/netlify/functions/_lib/invoice-service.js'));
  assert.equal(e.nutztZaehlfunktion, false);
  assert.equal(e.rechnetSelbst, true);
});

test('Positivkontrolle: ein Pfad ueber die Zaehlfunktion gilt als konform', () => {
  const neu = `
    const { data, error } = await sbAdmin.rpc('customer_usage_for_period', {
      p_customer_id: customerId, p_from: von, p_to: bis
    });
  `;
  for (const p of ABRECHNUNGSPFADE) {
    const e = pruefePfad(neu, p);
    assert.equal(e.nutztZaehlfunktion, true, p.zweck);
    assert.equal(e.rechnetSelbst, false, p.zweck);
  }
});

// ── Live-Smoke-Test.

test('Live-Smoke-Test: der Waechter laeuft heute PASS', () => {
  let exitCode = 0;
  let ausgabe = '';
  try {
    ausgabe = execFileSync('node', [SCRIPT], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    exitCode = e.status;
    ausgabe = (e.stdout || '') + (e.stderr || '');
  }
  assert.equal(exitCode, 0, 'Stand nach Etappe 3: alle Pfade lesen die Zaehlfunktion.');
  assert.match(ausgabe, /PASS: die Zaehlregel steht an einer Stelle/);
});

test('Registry ist nicht leer -- ein Waechter ohne Pruefobjekte prueft nichts', () => {
  assert.ok(REGELBESTANDTEILE.length >= 3);
  assert.ok(ABRECHNUNGSPFADE.length >= 2);
});
