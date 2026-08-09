// Guard fuer S4 / Stufe 2+3 (Diagnose 2026-08-09): der Fan-out-Mechanismus.
//
// Geprueft werden die drei Eigenschaften, an denen sich entscheidet, ob ein
// Fan-out sicher ist oder gefaehrlich:
//
//   1. WEN er anfasst. Ein Kunde ohne gemessenen Prompt-Stand muss als faellig
//      gelten -- direkt nach der Einfuehrung stehen alle Bestandskunden so da.
//      Gaelte null als "aktuell", haette der Mechanismus am ersten Tag nichts
//      zu tun und die Kunden, fuer die er gebaut wurde, blieben unsichtbar.
//   2. CANARY. Welle 2 darf erst laufen, wenn Welle 1 vollstaendig erfolgreich
//      war. Ohne diese Eigenschaft erreicht ein kaputter Deploy alle Agenten.
//   3. ABBRUCH. Ueberschreitet die Fehlerquote die Schwelle, muessen die noch
//      wartenden Zeilen storniert werden, statt sich durch alle Kunden zu
//      arbeiten.
//
// Alle Pruefungen fuehren die echten Funktionen aus. Der Supabase-Client ist
// ein Stub, der die tatsaechlich benutzte Query-Kette nachbildet -- die Logik
// selbst ist nicht nachgebaut.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fanout = require('../admin-panel/netlify/functions/_lib/elevenlabs-fanout.js');
const { promptFingerprint } = require('../admin-panel/netlify/functions/_lib/prompt-fingerprint.js');

let failed = 0;
const check = (name, passed, detail) => {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!passed) failed += 1;
};

// ── Supabase-Stub ───────────────────────────────────────────────────────────
// Bildet die Kette from().select().eq()/.in()/.lt()/.lte()/.not()/.order()/
// .limit()/.maybeSingle() ab und liefert je Tabelle eine vorbereitete Antwort.
function makeSb(tables, { onInsert, onUpdate } = {}) {
  const builder = (table) => {
    const result = { data: tables[table] ?? [], error: null };
    const chain = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      lt: () => chain,
      lte: () => chain,
      gt: () => chain,
      not: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve({
        data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data,
        error: null
      }),
      insert: (row) => Promise.resolve(onInsert ? onInsert(table, row) : { error: null }),
      update: (patch) => {
        const upd = {
          eq: () => upd,
          in: () => upd,
          select: () => Promise.resolve(onUpdate ? onUpdate(table, patch) : { data: [], error: null }),
          then: (resolve) => resolve(onUpdate ? onUpdate(table, patch) : { data: [], error: null })
        };
        return upd;
      },
      then: (resolve) => resolve(result)
    };
    return chain;
  };
  return { from: builder };
}

const MASTER = '# Master\r\n\r\n---\r\n\r\n## ROLLE';
const INDUSTRY = '## BRANCHE';
const CURRENT = promptFingerprint({ masterPrompt: MASTER, industryPrompt: INDUSTRY });

// ── 1. Wen der Fan-out anfasst ──────────────────────────────────────────────
{
  const sb = makeSb({
    customers: [
      { id: 'c_current', customer_name: 'Aktuell AG', elevenlabs_agent_id: 'ag1', prompt_fingerprint: CURRENT, industry_template_id: 'it', elevenlabs_last_sync_at: '2026-08-09T10:00:00Z' },
      { id: 'c_stale', customer_name: 'Veraltet AG', elevenlabs_agent_id: 'ag2', prompt_fingerprint: 'v1.2.1.deadbeefdead.cafecafecafe', industry_template_id: 'it', elevenlabs_last_sync_at: '2026-08-01T10:00:00Z' },
      { id: 'c_unknown', customer_name: 'Unbekannt AG', elevenlabs_agent_id: 'ag3', prompt_fingerprint: null, industry_template_id: 'it', elevenlabs_last_sync_at: '2026-08-01T10:00:00Z' },
      { id: 'c_noagent', customer_name: 'Ohne Agent AG', elevenlabs_agent_id: '  ', prompt_fingerprint: null, industry_template_id: 'it', elevenlabs_last_sync_at: null }
    ],
    system_config: [{ value: MASTER }],
    industry_templates: [{ id: 'it', prompt_block: INDUSTRY }],
    customer_operational_updates: []
  });

  const stale = await fanout.findStaleCustomers(sb);
  const byId = new Map(stale.map((row) => [row.customer_id, row]));

  check('Kunde auf aktuellem Stand wird nicht eingeplant', !byId.has('c_current'));
  check('Kunde mit abweichendem Fingerprint wird eingeplant',
    byId.get('c_stale')?.reason === 'fingerprint_stale');
  check('Kunde ohne gemessenen Stand wird eingeplant',
    byId.get('c_unknown')?.reason === 'fingerprint_unknown');
  check('Kunde ohne Agent wird nicht eingeplant', !byId.has('c_noagent'));
  check('Soll-Fingerprint wird mitgeliefert',
    byId.get('c_stale')?.expected_fingerprint === CURRENT);
}

// ── 1b. S3: abgelaufene Betriebsinformationen ───────────────────────────────
// Der Fingerprint sieht Zeit nicht. "Ferien bis 8. August" bleibt nach dem
// 8. August im eingefrorenen Prompt stehen, obwohl Vorlagen und Builder
// unveraendert sind.
{
  const sb = makeSb({
    customers: [
      { id: 'c_ops', customer_name: 'Ferien AG', elevenlabs_agent_id: 'ag1', prompt_fingerprint: CURRENT, industry_template_id: 'it', elevenlabs_last_sync_at: '2026-08-01T10:00:00Z' }
    ],
    system_config: [{ value: MASTER }],
    industry_templates: [{ id: 'it', prompt_block: INDUSTRY }],
    // Abgelaufen NACH dem letzten Sync -- steht also noch im Prompt.
    customer_operational_updates: [{ customer_id: 'c_ops', ends_at: '2026-08-08T00:00:00Z' }]
  });
  const stale = await fanout.findStaleCustomers(sb);
  check('abgelaufene Betriebsinformation macht einen aktuellen Kunden faellig',
    stale.length === 1 && stale[0].reason === 'operational_expired');
}

{
  const sb = makeSb({
    customers: [
      { id: 'c_ops', customer_name: 'Ferien AG', elevenlabs_agent_id: 'ag1', prompt_fingerprint: CURRENT, industry_template_id: 'it', elevenlabs_last_sync_at: '2026-08-09T10:00:00Z' }
    ],
    system_config: [{ value: MASTER }],
    industry_templates: [{ id: 'it', prompt_block: INDUSTRY }],
    // Abgelaufen VOR dem letzten Sync -- beim letzten Bauen war es schon
    // herausgefiltert, der Agent hat es also gar nicht bekommen.
    customer_operational_updates: [{ customer_id: 'c_ops', ends_at: '2026-08-05T00:00:00Z' }]
  });
  const stale = await fanout.findStaleCustomers(sb);
  check('vor dem letzten Sync abgelaufene Information loest nichts aus', stale.length === 0);
}

// ── 2. Canary: Wellenaufteilung beim Einplanen ──────────────────────────────
{
  const inserted = [];
  const sb = makeSb({}, { onInsert: (_table, row) => { inserted.push(row); return { error: null }; } });
  const customers = ['a', 'b', 'c', 'd'].map((id) => ({ customer_id: id, agent_id: `ag_${id}`, reason: 'fingerprint_stale' }));
  const result = await fanout.enqueueFanout(sb, { runId: 'run-1', customers });

  check('genau ein Kunde in Welle 1', inserted.filter((row) => row.wave === 1).length === 1);
  check('alle uebrigen in Welle 2', inserted.filter((row) => row.wave === 2).length === 3);
  check('Einplanung meldet zwei Wellen', result.waves === 2 && result.enqueued === 4);
}

{
  const sb = makeSb({}, { onInsert: () => ({ error: null }) });
  const result = await fanout.enqueueFanout(sb, { runId: 'run-2', customers: [{ customer_id: 'a', agent_id: 'ag' }] });
  check('ein einzelner Kunde ergibt nur eine Welle', result.waves === 1);
}

// Ein Kunde, der schon offen in der Warteschlange steht, darf nicht doppelt
// eingeplant werden -- zwei PATCHes auf denselben Agenten, deren Reihenfolge
// niemand kontrolliert.
{
  const sb = makeSb({}, { onInsert: () => ({ error: { code: '23505', message: 'duplicate key value violates unique constraint' } }) });
  const result = await fanout.enqueueFanout(sb, { runId: 'run-3', customers: [{ customer_id: 'a' }, { customer_id: 'b' }] });
  check('bereits eingeplante Kunden werden uebersprungen statt zu scheitern',
    result.enqueued === 0 && result.skipped === 2);
}

// ── 2b. Canary: Freigabe der zweiten Welle ──────────────────────────────────
{
  const allDone = makeSb({ elevenlabs_sync_queue: [{ status: 'done' }] });
  const oneFailed = makeSb({ elevenlabs_sync_queue: [{ status: 'done' }, { status: 'failed' }] });
  const stillRunning = makeSb({ elevenlabs_sync_queue: [{ status: 'running' }] });

  check('Welle 1 laeuft immer sofort', await fanout.waveIsClear(allDone, 'run', 1));
  check('Welle 2 laeuft, wenn Welle 1 komplett erfolgreich war',
    await fanout.waveIsClear(allDone, 'run', 2));
  check('Welle 2 laeuft NICHT nach einem Fehlschlag in Welle 1',
    (await fanout.waveIsClear(oneFailed, 'run', 2)) === false);
  check('Welle 2 laeuft NICHT, solange Welle 1 noch laeuft',
    (await fanout.waveIsClear(stillRunning, 'run', 2)) === false);
}

// ── 3. Abbruch bei hoher Fehlerquote ────────────────────────────────────────
{
  let cancelledPatch = null;
  const failing = makeSb(
    { elevenlabs_sync_queue: [{ status: 'failed' }, { status: 'failed' }, { status: 'done' }] },
    { onUpdate: (_t, patch) => { cancelledPatch = patch; return { data: [{ id: 'x' }], error: null }; } }
  );
  const aborted = await fanout.abortIfFailing(failing, 'run', 0.5, 2);
  check('Lauf wird bei zu hoher Fehlerquote abgebrochen', aborted === true);
  check('wartende Zeilen werden dabei storniert', cancelledPatch?.status === 'cancelled');
}

{
  const healthy = makeSb({ elevenlabs_sync_queue: [{ status: 'done' }, { status: 'done' }, { status: 'failed' }] });
  check('ein einzelner Fehlschlag bricht den Lauf nicht ab',
    (await fanout.abortIfFailing(healthy, 'run', 0.5, 2)) === false);
}

// Zu kleine Stichprobe: der erste Fehlschlag darf nicht sofort alles abbrechen.
{
  const tiny = makeSb({ elevenlabs_sync_queue: [{ status: 'failed' }] });
  check('unter der Mindeststichprobe wird nicht abgebrochen',
    (await fanout.abortIfFailing(tiny, 'run', 0.5, 2)) === false);
}

if (failed) process.exit(1);
console.log('elevenlabs fan-out verified.');
