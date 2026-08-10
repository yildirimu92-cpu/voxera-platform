/**
 * Bühne für Browser-Prüfungen des Admin-Portals.
 *
 * Warum es das gibt
 * -----------------
 * Der ausgelieferte Code soll unverändert laufen — nur die Datenverbindung
 * wird ersetzt. Dieser Aufbau (Testdaten, Supabase-Stub, Routing auf das
 * Dateisystem) war bis Welle 2 Teil 3 in `browser-check-admin-portal.mjs`
 * eingebaut. Er wird jetzt von mehreren Werkzeugen gebraucht, unter anderem
 * vom Stilvergleich, der vor und nach einer CSS-Verschiebung dieselbe Seite
 * aufbauen muss. Zwei Kopien derselben Bühne wären genau das Muster, das
 * dieser Umbau abschafft.
 *
 * `starte(browser, blockiert?)` liefert `{ ctx, page, fehler }`. `blockiert`
 * beantwortet den Pfad einer Laufzeit-Datei mit einer leeren Antwort — das ist
 * die Ablation.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// VX_ADMIN zeigt auf ein anderes admin-panel/ — gebraucht fuer Vorher/Nachher-
// Messungen, bei denen dasselbe Werkzeug einen aelteren Stand aufbauen soll.
export const ADMIN = process.env.VX_ADMIN || join(ROOT, 'admin-panel');

/** Die acht Bildschirme des Portals, in der Reihenfolge der Navigation. */
export const ROUTEN = ['overview', 'offers', 'customers', 'onboarding', 'billing-finance', 'ai-setup', 'insights', 'settings'];

/* ── Testdaten ─────────────────────────────────────────────────────────────
   Knapp, aber nicht leer. Die Menge ist bewusst gewählt: mit leeren Case- und
   Änderungsanfragen-Listen rendern die zuständigen Screens gar nichts, und die
   Ablation in Punkt 5 verliert ihre Aussagekraft — ein Patch, dessen Bereich
   leer ist, kann beim Blockieren nichts kaputtmachen. Jede Tabelle, die einen
   Screen speist, bekommt deshalb mindestens eine Zeile. */
const ISO = '2026-08-01T10:00:00.000Z';
export const FIXTURES = {
  customers: [1, 2, 3].map((i) => ({
    id: `cust_${i}`, customer_name: ['Sanitär Meier GmbH', 'Zahnarztpraxis Dr. Frei', 'Hotel Alpenblick'][i - 1],
    email: `kunde${i}@beispiel.ch`, tel_nr: `+41791234${i}${i}${i}`, plan: 'pro', plan_code: 'pro',
    status: ['live', 'onboarding', 'invited'][i - 1], created_at: ISO, updated_at: ISO,
    city: 'Zürich', zip: '8001', assistant_name: 'Lara', elevenlabs_agent_id: `agent_${i}`
  })),
  onboarding: [1, 2, 3].map((i) => ({ id: `ob_${i}`, customer_id: `cust_${i}`, status: 'in_progress', updated_at: ISO })),
  calls: [1, 2, 3, 4].map((i) => ({
    id: `call_${i}`, customer_id: `cust_${(i % 3) + 1}`, created_at: ISO, duration_seconds: 60 * i,
    status: 'completed', caller_number: `+4179000000${i}`
  })),
  voxera_cases: [1, 2, 3].map((i) => ({
    id: `case_${i}`, customer_id: `cust_${(i % 3) + 1}`, title: `Anliegen ${i}`, note: 'Testnotiz',
    status: ['open', 'in_progress', 'done'][i - 1], case_type: 'callback',
    created_at: ISO, updated_at: ISO, due_at: ISO
  })),
  subscriptions: [1, 2].map((i) => ({
    id: `sub_${i}`, customer_id: `cust_${i}`, status: 'active', plan_code: 'pro',
    billing_cycle: 'monthly', created_at: ISO
  })),
  invoices: [1, 2].map((i) => ({
    id: `inv_${i}`, customer_id: `cust_${i}`, status: ['open', 'paid'][i - 1], invoice_type: 'subscription',
    total_amount: 199, invoice_number: `2026-00${i}`, issued_at: '2026-08-01', created_at: ISO
  })),
  invoice_items: [{ id: 'item_1', invoice_id: 'inv_1', title: 'Abo August', total_amount: 199, tax_rate: 8.1 }],
  offers: [{
    id: 'off_1', customer_name: 'Garage Rüegg', email: 'garage@beispiel.ch', status: 'sent',
    plan_code: 'pro', created_at: ISO, updated_at: ISO
  }],
  offer_acceptances: [], offer_events: [],
  contracts: [{
    id: 'ctr_1', customer_id: 'cust_1', status: 'active', plan_code: 'pro',
    duration_months: 12, start_date: '2026-08-01', recurring_amount_monthly: 199, created_at: ISO
  }],
  plan_config: [{ id: 'plan_1', plan_code: 'pro', monthly_price: 199, included_minutes: 300, active: true }],
  industry_templates: [{ id: 'tpl_1', name: 'Allgemein', template_key: 'generic', extra_steps: '[]' }],
  ai_change_requests: [{
    id: 'chg_1', customer_id: 'cust_1', status: 'open', field: 'ai_greeting',
    requested_value: 'Guten Tag', created_at: ISO
  }],
  admins: [{ id: 'admin-user-1', role: 'owner', status: 'active', email: 'admin@voxera.ch', created_at: ISO }],
  system_config: [{ key: 'default_assistant_name', value: 'Lara' }, { key: 'core_field_steps', value: '[]' }]
};

export const SUPABASE_STUB = `(function(){
  var FIX = window.__VX_FIXTURES__ || {};
  var SESSION = { access_token:'stub', user:{ id:'admin-user-1', email:'admin@voxera.ch' } };
  function q(table){
    var rows = JSON.parse(JSON.stringify(FIX[table] || []));
    var api = { _rows: rows };
    ['select','order','range','gte','lte','gt','lt','neq','like','ilike','is','in','or','not','filter','insert','update','upsert','delete']
      .forEach(function(m){ api[m] = function(){ return api; }; });
    api.limit = function(n){ api._rows = api._rows.slice(0,n); return api; };
    api.eq = function(col,v){ api._rows = api._rows.filter(function(r){ return String(r[col]) === String(v); }); return api; };
    api.single = function(){ return Promise.resolve({ data: api._rows[0] || null, error: api._rows.length ? null : { message:'no rows' } }); };
    api.maybeSingle = function(){ return Promise.resolve({ data: api._rows[0] || null, error: null }); };
    api.then = function(res,rej){ return Promise.resolve({ data: api._rows, error:null, count: api._rows.length }).then(res,rej); };
    api.catch = function(f){ return Promise.resolve({ data: api._rows, error:null }).catch(f); };
    return api;
  }
  var client = {
    from: q,
    rpc: function(){ return Promise.resolve({ data:null, error:null }); },
    channel: function(){ return { on:function(){return this;}, subscribe:function(){return this;}, unsubscribe:function(){} }; },
    removeChannel: function(){},
    functions: { invoke: function(){ return Promise.resolve({ data:{}, error:null }); } },
    auth: {
      // Bewusst mit Verzoegerung: supabase-js loest getSession ueber eine
      // asynchrone Sperre auf. Ohne die Pause laeuft init() los, bevor der
      // Parser die spaeteren Skriptbloecke gelesen hat.
      getSession: function(){ return new Promise(function(r){ setTimeout(function(){ r({ data:{ session:SESSION }, error:null }); }, 40); }); },
      getUser: function(){ return Promise.resolve({ data:{ user:SESSION.user }, error:null }); },
      signOut: function(){ return Promise.resolve({ error:null }); },
      signInWithPassword: function(){ return Promise.resolve({ data:{ session:SESSION }, error:null }); },
      onAuthStateChange: function(){ return { data:{ subscription:{ unsubscribe:function(){} } } }; },
      refreshSession: function(){ return Promise.resolve({ data:{ session:SESSION }, error:null }); }
    }
  };
  window.supabase = { createClient: function(){ return client; } };
})();`;

export const CONFIG_STUB = `window.__VX_RUNTIME_CONFIG__ = { supabaseUrl:'https://stub.local', supabaseAnonKey:'stub',
  context:'browser-check', branch:'local', site:'admin-panel', configured:true };`;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };

export const FENSTER = {
  breit:  { width: 1440, height: 900 },   // Arbeitsplatz
  tablet: { width: 1024, height: 800 },   // Schublade beginnt
  handy:  { width:  390, height: 844 }    // 768er- und 480er-Bloecke
};

export async function starte(browser, blockiert = null, fenster = FENSTER.breit) {
  // Die Fenstergroesse ist einstellbar, weil ein Grossteil der Stilregeln in
  // @media-Bloecken steht. Wer nur bei 1440px misst, prueft sie nie.
  const ctx = await browser.newContext({ viewport: fenster });
  const page = await ctx.newPage();
  const fehler = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|404/.test(m.text())) fehler.push(m.text().slice(0, 140)); });
  page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message.slice(0, 140)));

  await ctx.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'admin.local') {
      const pfad = url.pathname === '/' ? '/index.html' : url.pathname;
      if (blockiert && pfad.includes(blockiert)) {
        return route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* fuer die Ablation blockiert */' });
      }
      if (pfad === '/vx-runtime-config.js') {
        return route.fulfill({ status: 200, contentType: 'text/javascript', body: `window.__VX_FIXTURES__=${JSON.stringify(FIXTURES)};\n${CONFIG_STUB}` });
      }
      const datei = join(ADMIN, pfad);
      if (existsSync(datei) && statSync(datei).isFile()) {
        return route.fulfill({ status: 200, contentType: MIME[extname(datei)] || 'text/plain', body: readFileSync(datei) });
      }
      return route.fulfill({ status: 404, body: 'nicht gefunden' });
    }
    if (url.href.includes('supabase-js')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: SUPABASE_STUB });
    if (url.href.includes('qrcode')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.QRCode=function(){};' });
    // Alles Uebrige (Schriften, Icons) wird leer beantwortet: kein Netz im Test.
    return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
  });

  await page.goto('http://admin.local/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  return { ctx, page, fehler };
}

