import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  REGELBESTANDTEILE,
  ABRECHNUNGSPFADE,
  pruefeRegel,
  pruefePfad,
  ohneKommentare
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

// ── Codex-Fund auf #982 (P2): der Waechter darf nicht auf Kommentaren
// zuenden. Sonst haette er eine Blindstelle in genau der Form des Problems,
// das er loesen soll -- die geloeschte Regel wuerde durch ihre eigene
// Dokumentation bestaetigt.

test('Blindstelle geschlossen: eine SQL-Datei, in der die Regel NUR im Kommentar steht, faellt durch', () => {
  // Genau das Szenario aus dem Review: die ausfuehrbare Regel ist entfernt,
  // die erklaerenden Kommentare stehen noch da.
  const nurKommentare = `
    -- Die Regel lautet: nur live_status = 'completed' zaehlt,
    -- und zwar ab duration_seconds >= 10 Sekunden.
    -- Gerundet wird einmal am Ende: ceil(g.sek / 60.0)
    create or replace function public.customer_usage_for_period(...)
    returns table (used_minutes integer)
    language sql as $$
      select count(*)::integer from public.calls;
    $$;
  `;
  const bereinigt = ohneKommentare(nurKommentare);
  for (const teil of pruefeRegel(bereinigt)) {
    assert.equal(teil.ok, false,
      `"${teil.name}" darf nicht allein durch einen Kommentar als erfuellt gelten`);
  }
});

test('Blindstelle geschlossen: ein Abrechnungspfad, der die Zaehlfunktion nur im JSDoc nennt, faellt durch', () => {
  const nurImKommentar = `
    /**
     * Zaehlt ueber rpc('customer_usage_for_period') -- so stand es hier mal.
     */
    async function loadCustomerMinutesForPeriod(sbAdmin, customerId, von, bis) {
      const { data } = await sbAdmin.from('calls').select('duration_seconds');
      return { ok: true, usedMinutes: data.length };
    }
  `;
  const bereinigt = ohneKommentare(nurImKommentar);
  for (const p of ABRECHNUNGSPFADE) {
    const e = pruefePfad(bereinigt, p);
    assert.equal(e.nutztZaehlfunktion, false,
      `${p.zweck}: ein JSDoc-Hinweis darf nicht als Aufruf zaehlen`);
  }
});

test('ohneKommentare entfernt Zeilen- und Blockkommentare, laesst Code stehen', () => {
  const gemischt = [
    "-- live_status = 'completed'",
    "select 1 where live_status = 'completed';",
    '/* duration_seconds >= 10 */',
    'and duration_seconds >= 10',
    "// rpc('customer_usage_for_period')",
    "await sbAdmin.rpc('customer_usage_for_period', {});"
  ].join('\n');
  const bereinigt = ohneKommentare(gemischt);

  // Je einmal -- der Code bleibt, der Kommentar ist weg.
  assert.equal((bereinigt.match(/live_status = 'completed'/g) || []).length, 1);
  assert.equal((bereinigt.match(/duration_seconds >= 10/g) || []).length, 1);
  assert.equal((bereinigt.match(/customer_usage_for_period/g) || []).length, 1);
});
