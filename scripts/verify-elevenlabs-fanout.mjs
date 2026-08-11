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
// Bildet die Kette from().select().eq()/.neq()/.in()/.lt()/.lte()/.not()/
// .order()/.limit()/.maybeSingle() ab und liefert je Tabelle eine vorbereitete
// Antwort.
function makeSb(tables, { onInsert, onUpdate } = {}) {
  // Die Filter werden wirklich angewandt, nicht ignoriert: master_prompt und
  // core_field_steps liegen beide in system_config und unterscheiden sich nur
  // durch .eq('key', ...). Ein Stub, der eq() verschluckt, wuerde beide gleich
  // beantworten und die neue Fingerprint-Eingabe faelschlich gruen melden.
  const matches = (row, filters) => filters.every(([kind, col, val]) => {
    if (kind === 'eq') return String(row[col]) === String(val);
    // Wie PostgREST auf einer NOT-NULL-Spalte: fehlt der Wert im Fixture,
    // gilt die Zeile als "nicht gleich" und bleibt drin.
    if (kind === 'neq') return String(row[col]) !== String(val);
    if (kind === 'in') return val.map(String).includes(String(row[col]));
    // wave/attempts sind Zahlen, ends_at/last_attempt_at Zeitstempel.
    const cmp = (a, b) => (typeof b === 'number'
      ? [Number(a), Number(b)]
      : [new Date(a).getTime(), new Date(b).getTime()]);
    if (kind === 'lte') { const [x, y] = cmp(row[col], val); return x <= y; }
    if (kind === 'lt') { const [x, y] = cmp(row[col], val); return x < y; }
    if (kind === 'gt') { const [x, y] = cmp(row[col], val); return x > y; }
    if (kind === 'notNull') return row[col] !== null && row[col] !== undefined;
    return true;
  });

  const builder = (table) => {
    const rows = tables[table] ?? [];
    const filters = [];
    const resolve = () => ({ data: (Array.isArray(rows) ? rows : [rows]).filter((r) => matches(r, filters)), error: null });
    const chain = {
      select: () => chain,
      eq: (col, val) => { filters.push(['eq', col, val]); return chain; },
      neq: (col, val) => { filters.push(['neq', col, val]); return chain; },
      in: (col, val) => { filters.push(['in', col, val]); return chain; },
      lt: (col, val) => { filters.push(['lt', col, val]); return chain; },
      lte: (col, val) => { filters.push(['lte', col, val]); return chain; },
      gt: (col, val) => { filters.push(['gt', col, val]); return chain; },
      not: (col) => { filters.push(['notNull', col]); return chain; },
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve({ data: resolve().data[0] ?? null, error: null }),
      insert: (row) => Promise.resolve(onInsert ? onInsert(table, row) : { error: null }),
      update: (patch) => {
        const upd = {
          eq: () => upd,
          in: () => upd,
          lt: () => upd,
          select: () => Promise.resolve(onUpdate ? onUpdate(table, patch) : { data: [], error: null }),
          then: (res) => res(onUpdate ? onUpdate(table, patch) : { data: [], error: null })
        };
        return upd;
      },
      then: (res) => res(resolve())
    };
    return chain;
  };
  return { from: builder };
}

const MASTER = '# Master\r\n\r\n---\r\n\r\n## ROLLE';
const INDUSTRY = '## BRANCHE';
const CORE = '[{"key":"oeffnungszeiten"}]';
const EXTRA = [{ key: 'notdienst', label: 'Notdienst' }];
const CURRENT = promptFingerprint({
  masterPrompt: MASTER, industryPrompt: INDUSTRY, coreFields: CORE, industryFields: EXTRA
});

// ── 1. Wen der Fan-out anfasst ──────────────────────────────────────────────
{
  const sb = makeSb({
    customers: [
      { id: 'c_current', customer_name: 'Aktuell AG', elevenlabs_agent_id: 'ag1', prompt_fingerprint: CURRENT, industry_template_id: 'it', elevenlabs_last_sync_at: '2026-08-09T10:00:00Z' },
      { id: 'c_stale', customer_name: 'Veraltet AG', elevenlabs_agent_id: 'ag2', prompt_fingerprint: 'v1.2.1.deadbeefdead.cafecafecafe', industry_template_id: 'it', elevenlabs_last_sync_at: '2026-08-01T10:00:00Z' },
      { id: 'c_unknown', customer_name: 'Unbekannt AG', elevenlabs_agent_id: 'ag3', prompt_fingerprint: null, industry_template_id: 'it', elevenlabs_last_sync_at: '2026-08-01T10:00:00Z' },
      { id: 'c_noagent', customer_name: 'Ohne Agent AG', elevenlabs_agent_id: '  ', prompt_fingerprint: null, industry_template_id: 'it', elevenlabs_last_sync_at: null }
    ],
    system_config: [
      { key: 'prompt_master_l1', value: MASTER },
      { key: 'core_field_steps', value: CORE }
    ],
    industry_templates: [{ id: 'it', prompt_block: INDUSTRY, extra_steps: EXTRA }],
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

// ── 1a. Gekuendigte Kunden bleiben aussen vor ───────────────────────────────
// Beide Kuendigungswege setzen nur `operational_status` und lassen die
// `elevenlabs_agent_id` stehen. Ohne den neq-Filter waere ein gekuendigter
// Kunde dauerhaft "veraltet" und sein Geschaeftsprofil wuerde jede Nacht neu
// zu ElevenLabs in die USA geschrieben.
{
  const sb = makeSb({
    customers: [
      { id: 'c_aktiv', customer_name: 'Aktiv AG', elevenlabs_agent_id: 'ag1', prompt_fingerprint: 'v1.2.1.deadbeefdead.cafecafecafe', industry_template_id: 'it', elevenlabs_last_sync_at: '2026-08-01T10:00:00Z', operational_status: 'active' },
      { id: 'c_gekuendigt', customer_name: 'Gekuendigt AG', elevenlabs_agent_id: 'ag2', prompt_fingerprint: 'v1.2.1.deadbeefdead.cafecafecafe', industry_template_id: 'it', elevenlabs_last_sync_at: '2026-08-01T10:00:00Z', operational_status: 'terminated' }
    ],
    system_config: [
      { key: 'prompt_master_l1', value: MASTER },
      { key: 'core_field_steps', value: CORE }
    ],
    industry_templates: [{ id: 'it', prompt_block: INDUSTRY, extra_steps: EXTRA }],
    customer_operational_updates: []
  });

  const stale = await fanout.findStaleCustomers(sb);
  const byId = new Map(stale.map((row) => [row.customer_id, row]));

  check('gekuendigter Kunde wird nicht eingeplant, obwohl sein Agent veraltet ist',
    !byId.has('c_gekuendigt'));
  check('aktiver Kunde mit identischem Stand wird weiterhin eingeplant',
    byId.get('c_aktiv')?.reason === 'fingerprint_stale');
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
    system_config: [
      { key: 'prompt_master_l1', value: MASTER },
      { key: 'core_field_steps', value: CORE }
    ],
    industry_templates: [{ id: 'it', prompt_block: INDUSTRY, extra_steps: EXTRA }],
    // Abgelaufen NACH dem letzten Sync -- steht also noch im Prompt.
    customer_operational_updates: [{ customer_id: 'c_ops', status: 'published', ends_at: '2026-08-08T00:00:00Z' }]
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
    system_config: [
      { key: 'prompt_master_l1', value: MASTER },
      { key: 'core_field_steps', value: CORE }
    ],
    industry_templates: [{ id: 'it', prompt_block: INDUSTRY, extra_steps: EXTRA }],
    // Abgelaufen VOR dem letzten Sync -- beim letzten Bauen war es schon
    // herausgefiltert, der Agent hat es also gar nicht bekommen.
    customer_operational_updates: [{ customer_id: 'c_ops', status: 'published', ends_at: '2026-08-05T00:00:00Z' }]
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
  const q = (rows) => makeSb({ elevenlabs_sync_queue: rows.map((r) => ({ run_id: 'run', wave: 1, ...r })) });
  const allDone = q([{ status: 'done' }]);
  const oneFailed = q([{ status: 'done' }, { status: 'failed' }]);
  const stillRunning = q([{ status: 'running' }]);

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
    { elevenlabs_sync_queue: [
      { run_id: 'run', status: 'failed' },
      { run_id: 'run', status: 'failed' },
      { run_id: 'run', status: 'done' }
    ] },
    { onUpdate: (_t, patch) => { cancelledPatch = patch; return { data: [{ id: 'x' }], error: null }; } }
  );
  const aborted = await fanout.abortIfFailing(failing, 'run', 0.5, 2);
  check('Lauf wird bei zu hoher Fehlerquote abgebrochen', aborted === true);
  check('wartende Zeilen werden dabei storniert', cancelledPatch?.status === 'cancelled');
}

{
  const healthy = makeSb({ elevenlabs_sync_queue: [
    { run_id: 'run', status: 'done' }, { run_id: 'run', status: 'done' }, { run_id: 'run', status: 'failed' }
  ] });
  check('ein einzelner Fehlschlag bricht den Lauf nicht ab',
    (await fanout.abortIfFailing(healthy, 'run', 0.5, 2)) === false);
}

// Zu kleine Stichprobe: der erste Fehlschlag darf nicht sofort alles abbrechen.
{
  const tiny = makeSb({ elevenlabs_sync_queue: [{ run_id: 'run', status: 'failed' }] });
  check('unter der Mindeststichprobe wird nicht abgebrochen',
    (await fanout.abortIfFailing(tiny, 'run', 0.5, 2)) === false);
}


// ── Codex-Befunde aus PR #881 ───────────────────────────────────────────────

// P1: Der Fingerprint muss ALLE gemeinsamen Eingaben abdecken. Seit J1/J4
// verarbeitet der Builder auch core_field_steps und extra_steps. Fehlten sie,
// koennte eine Aenderung daran den Prompt veraendern, waehrend jeder Agent
// weiter als aktuell gilt -- die Blindstelle, gegen die S4 gebaut wurde.
{
  const base = promptFingerprint({ masterPrompt: MASTER, industryPrompt: INDUSTRY, coreFields: CORE, industryFields: EXTRA });
  const coreChanged = promptFingerprint({ masterPrompt: MASTER, industryPrompt: INDUSTRY, coreFields: `${CORE} `, industryFields: EXTRA });
  const extraChanged = promptFingerprint({ masterPrompt: MASTER, industryPrompt: INDUSTRY, coreFields: CORE, industryFields: [...EXTRA, { key: 'neu' }] });
  check('Aenderung an core_field_steps aendert den Fingerprint', base !== coreChanged);
  check('Aenderung an extra_steps aendert den Fingerprint', base !== extraChanged);
  check('beide sind voneinander unterscheidbar', coreChanged !== extraChanged);
  // Objekte muessen serialisiert werden -- sonst waere jeder Wert
  // '[object Object]' und die Eingabe faktisch nicht im Fingerprint.
  check('Objekt-Eingaben werden serialisiert, nicht verschluckt',
    promptFingerprint({ industryFields: [{ a: 1 }] }) !== promptFingerprint({ industryFields: [{ a: 2 }] }));
}

// Und dieselbe Aenderung muss ueber den Kontextweg durchschlagen, nicht nur
// ueber den direkten Aufruf -- sonst rechnen Sync und Planer verschieden.
{
  const withExtra = makeSb({
    customers: [{ id: 'c', customer_name: 'C', elevenlabs_agent_id: 'ag', prompt_fingerprint: CURRENT, industry_template_id: 'it', elevenlabs_last_sync_at: '2026-08-09T10:00:00Z' }],
    system_config: [{ key: 'prompt_master_l1', value: MASTER }, { key: 'core_field_steps', value: CORE }],
    industry_templates: [{ id: 'it', prompt_block: INDUSTRY, extra_steps: [...EXTRA, { key: 'dazugekommen' }] }],
    customer_operational_updates: []
  });
  const stale = await fanout.findStaleCustomers(withExtra);
  check('geaenderte extra_steps machen den Kunden faellig',
    stale.length === 1 && stale[0].reason === 'fingerprint_stale');
}

// P1: Der Canary darf nicht verloren gehen, wenn der erste Insert am
// Unique-Index scheitert. Sonst hat der neue Lauf nur Welle-2-Zeilen,
// waveIsClear() haelt die leere Vorwelle fuer erledigt und gibt alles frei.
{
  const inserted = [];
  let first = true;
  const sb = makeSb({}, { onInsert: (_t, row) => {
    if (first) { first = false; return { error: { code: '23505', message: 'duplicate key value' } }; }
    inserted.push(row);
    return { error: null };
  } });
  const customers = ['a', 'b', 'c'].map((id) => ({ customer_id: id, agent_id: `ag_${id}` }));
  const result = await fanout.enqueueFanout(sb, { runId: 'run-canary', customers });

  check('uebersprungener erster Kunde kostet den Canary nicht',
    inserted.filter((row) => row.wave === 1).length === 1);
  check('der Canary ist der erste tatsaechlich eingeplante Kunde',
    inserted[0]?.wave === 1 && inserted[0]?.customer_id === 'b');
  check('Zaehlung stimmt trotz Ueberspringen', result.enqueued === 2 && result.skipped === 1);
}

// Werden ALLE uebersprungen, gibt es keinen Lauf -- und keine Wellenangabe,
// die etwas anderes behauptet.
{
  const sb = makeSb({}, { onInsert: () => ({ error: { code: '23505', message: 'duplicate key value' } }) });
  const result = await fanout.enqueueFanout(sb, { runId: 'run-leer', customers: [{ customer_id: 'a' }] });
  check('vollstaendig uebersprungener Lauf meldet null Wellen', result.waves === 0 && result.enqueued === 0);
}

// P2: Beim Abbruch muessen auch 'failed'-Zeilen storniert werden. Der Worker
// holt sie sonst beim naechsten Tick zum Wiederholen zurueck -- der Lauf gilt
// als abgebrochen und synchronisiert trotzdem weiter.
{
  let filters = null;
  const sb = {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: (col, val) => { if (col === 'status' && !filters) filters = val; return chain; },
        update: () => {
          const upd = {
            eq: () => upd,
            in: (col, val) => { if (col === 'status') filters = val; return upd; },
            select: () => Promise.resolve({ data: [{ id: 'x' }], error: null })
          };
          return upd;
        },
        then: (res) => res({ data: [{ status: 'failed' }, { status: 'failed' }, { status: 'done' }], error: null })
      };
      return chain;
    }
  };
  await fanout.abortIfFailing(sb, 'run', 0.5, 2);
  check('Abbruch storniert pending UND failed',
    Array.isArray(filters) && filters.includes('pending') && filters.includes('failed'));
}

if (failed) process.exit(1);
console.log('elevenlabs fan-out verified.');
