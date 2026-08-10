#!/usr/bin/env node
/**
 * Browser-Prüfung für das Admin-Portal.
 *
 * Läuft NICHT in der Verify-Suite: braucht Playwright, und das ist wie beim
 * bestehenden `browser-check-notification-triggers.mjs` keine Repo-Abhängigkeit.
 * Die dauerhaften Wächter stehen statisch in
 * `scripts/verify-admin-portal-structure.mjs`; dieses Skript ist der Nachweis am
 * laufenden DOM und wird nach jeder Welle des Zielbilds von Hand wiederholt.
 *
 * Warum es das braucht
 * --------------------
 * Der teuerste Fehler des Portals war im Quelltext unsichtbar: 30 von 33
 * Kartenüberschriften standen als weisse Schrift auf weissem Grund, weil ein
 * Patch die Kopfzeile als „dunkel" vermessen und ein anderer sie danach hell
 * übermalt hatte. Beide Regeln sehen für sich korrekt aus. Erst das gerenderte
 * Dokument zeigt den Fehler — deshalb prüft dieses Skript Kontrast, nicht Code.
 *
 * Was geprüft wird
 * ----------------
 *   1. Startet das Portal ohne Konsolenfehler?
 *   2. Rendern alle Screens, und wie viele Bedienelemente hat jeder?
 *   3. Kontrast: nichts unter 3:1 (Fehler), Rückstand zwischen 3:1 und 4.5:1.
 *   4. Endpunkt-Auflösung: geht jeder Aufruf an den erwarteten Endpunkt?
 *   5. Stilschichten: sind die vier Stylesheets geladen — und stehen sie NACH
 *      den <style>-Blöcken, ohne die sie wirkungslos wären?
 *   6. Ablation: jeden Laufzeit-Patch einzeln blockieren — bricht etwas?
 *
 * Stand nach Welle 1: Punkt 3 schlägt fehl, und das ist beabsichtigt. Die 30
 * unlesbaren Kartenüberschriften sind Welle 2. Ein Skript, das ein kaputtes
 * Portal durchwinkt, wäre wertlos — dieses hier hält den Befund fest, bis er
 * behoben ist, und ist damit gleichzeitig das Abnahmekriterium für Welle 2.
 *
 * Die Datenverbindung wird durch einen Stub ersetzt. Der ausgelieferte Code
 * bleibt unverändert — nur `vx-runtime-config.js` und die Supabase-Bibliothek
 * werden abgefangen. Deshalb misst das Skript den echten Auslieferungsstand.
 *
 * Aufruf:
 *   PW_PATH="$(npm root -g)/playwright" node scripts/browser-check-admin-portal.mjs
 *   PW_PATH=... node scripts/browser-check-admin-portal.mjs --ablation   (langsamer)
 */

import { createRequire } from 'node:module';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const require_ = createRequire(import.meta.url);
const { chromium } = require_(process.env.PW_PATH || 'playwright');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN = join(ROOT, 'admin-panel');
const MIT_ABLATION = process.argv.includes('--ablation');

const ROUTEN = ['overview', 'offers', 'customers', 'onboarding', 'billing-finance', 'ai-setup', 'insights', 'settings'];

/* ── Testdaten ─────────────────────────────────────────────────────────────
   Knapp, aber nicht leer. Die Menge ist bewusst gewählt: mit leeren Case- und
   Änderungsanfragen-Listen rendern die zuständigen Screens gar nichts, und die
   Ablation in Punkt 5 verliert ihre Aussagekraft — ein Patch, dessen Bereich
   leer ist, kann beim Blockieren nichts kaputtmachen. Jede Tabelle, die einen
   Screen speist, bekommt deshalb mindestens eine Zeile. */
const ISO = '2026-08-01T10:00:00.000Z';
const FIXTURES = {
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

const SUPABASE_STUB = `(function(){
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

const CONFIG_STUB = `window.__VX_RUNTIME_CONFIG__ = { supabaseUrl:'https://stub.local', supabaseAnonKey:'stub',
  context:'browser-check', branch:'local', site:'admin-panel', configured:true };`;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };

async function starte(browser, blockiert = null) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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

/* ── Kontrastprüfung ──────────────────────────────────────────────────────── */

const KONTRAST_MESSUNG = `(() => {
  const relLum = (r,g,b) => {
    const f = v => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
    return 0.2126*f(r) + 0.7152*f(g) + 0.0722*f(b);
  };
  const parse = s => {
    const m = String(s).match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?/);
    return m ? { r:+m[1], g:+m[2], b:+m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
  };
  // Hintergrund: erste Vorfahrenfläche, die tatsächlich deckend malt.
  const grund = el => {
    let node = el;
    while (node && node !== document.documentElement) {
      const cs = getComputedStyle(node);
      const bild = cs.backgroundImage;
      if (bild && bild !== 'none') {
        const stops = [...bild.matchAll(/rgba?\\([^)]+\\)/g)].map(m => parse(m[0])).filter(Boolean);
        if (stops.length) return stops[0];   // Verlaufsstart als Naeherung
      }
      const farbe = parse(cs.backgroundColor);
      if (farbe && farbe.a > 0.5) return farbe;
      node = node.parentElement;
    }
    return { r:255, g:255, b:255, a:1 };
  };
  const sichtbar = el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.1) return false;
    const box = el.getBoundingClientRect();
    return box.width > 2 && box.height > 2;
  };
  const treffer = [];
  const kandidaten = document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,span,td,th,label,button,a,strong,b,li,div.list-main,div.kpi-value');
  for (const el of kandidaten) {
    const eigenerText = [...el.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim());
    if (!eigenerText || !sichtbar(el)) continue;
    const vg = parse(getComputedStyle(el).color);
    if (!vg || vg.a < 0.5) continue;
    const hg = grund(el);
    const l1 = relLum(vg.r, vg.g, vg.b), l2 = relLum(hg.r, hg.g, hg.b);
    const ratio = (Math.max(l1,l2) + 0.05) / (Math.min(l1,l2) + 0.05);
    if (ratio < 4.5) {
      treffer.push({
        text: el.textContent.trim().replace(/\\s+/g,' ').slice(0, 46),
        verhaeltnis: Math.round(ratio * 100) / 100,
        vordergrund: getComputedStyle(el).color,
        bereich: el.closest('.section')?.id || el.closest('.modal-overlay')?.id || '(ausserhalb)'
      });
    }
  }
  return treffer;
})()`;

/* ── Ablauf ───────────────────────────────────────────────────────────────── */

// In Umgebungen mit vorinstalliertem Chromium (CI-Container, Remote-Sitzungen)
// passt die Playwright-Build-Nummer selten zur ausgeliefertern. VOXERA_CHROMIUM
// zeigt dann direkt auf die vorhandene Binärdatei; ohne die Variable bleibt es
// beim normalen Verhalten.
const browser = await chromium.launch(
  process.env.VOXERA_CHROMIUM ? { executablePath: process.env.VOXERA_CHROMIUM } : {}
);
let fehlerhaft = 0;

console.log('Browser-Pruefung Admin-Portal\n');

/* 1 + 2 — Start und Screens */
const { ctx, page, fehler } = await starte(browser);
console.log('1) Start');
if (fehler.length) {
  fehlerhaft += 1;
  console.log(`   ✗ ${fehler.length} Konsolenfehler beim Start:`);
  fehler.slice(0, 8).forEach((f) => console.log('     ' + f));
} else {
  console.log('   ✓ keine Konsolenfehler');
}

console.log('\n2) Screens');
const screens = await page.evaluate((routen) => {
  const out = {};
  for (const r of routen) {
    try { window.setRoute(r); } catch (_e) { out[r] = 'FEHLER'; continue; }
    const sec = document.querySelector('.section.active');
    if (!sec) { out[r] = 'nicht gerendert'; continue; }
    const sichtbar = (el) => { const cs = getComputedStyle(el); const b = el.getBoundingClientRect(); return cs.display !== 'none' && b.width > 0 && b.height > 0; };
    out[r] = [...sec.querySelectorAll('button,a[href],input,select,textarea,[onclick]')].filter(sichtbar).length;
  }
  return out;
}, ROUTEN);
for (const [route, wert] of Object.entries(screens)) {
  const ok = typeof wert === 'number';
  if (!ok) fehlerhaft += 1;
  console.log(`   ${ok ? '✓' : '✗'} ${route.padEnd(18)} ${wert} Bedienelemente`);
}

/* 3 — Kontrast über alle Screens
   Zwei Stufen, und die Grenze dazwischen ist keine Geschmacksfrage:
   4.5:1 ist die Anforderung für normalen Text, 3:1 die für grossen Text.
   Alles unter 3:1 ist also bei JEDER Schriftgrösse zu wenig — das ist ein
   Fehler. Zwischen 3:1 und 4.5:1 hängt es an der Schriftgrösse; diese Stellen
   werden gelistet und in Welle 2 mit dem Design-System abgeräumt. */
console.log('\n3) Kontrast');
const kontrastTreffer = [];
for (const route of ROUTEN) {
  await page.evaluate((r) => window.setRoute(r), route);
  await page.waitForTimeout(300);
  const treffer = await page.evaluate(KONTRAST_MESSUNG);
  treffer.forEach((t) => kontrastTreffer.push({ ...t, route }));
}
const eindeutig = [];
const gesehen = new Set();
for (const t of kontrastTreffer) {
  const schluessel = t.bereich + '|' + t.text + '|' + t.vordergrund;
  if (gesehen.has(schluessel)) continue;
  gesehen.add(schluessel);
  eindeutig.push(t);
}
const unlesbar = eindeutig.filter((t) => t.verhaeltnis < 3);
const zuSchwach = eindeutig.filter((t) => t.verhaeltnis >= 3);

if (unlesbar.length) {
  fehlerhaft += 1;
  console.log(`   ✗ ${unlesbar.length} Textstelle(n) unter 3:1 — bei jeder Schriftgroesse zu wenig`);
  unlesbar.slice(0, 20).forEach((t) => {
    console.log(`     ${String(t.verhaeltnis).padStart(5)}:1  ${t.bereich.padEnd(24)} ${t.vordergrund.padEnd(22)} „${t.text}"`);
  });
  if (unlesbar.length > 20) console.log(`     … und ${unlesbar.length - 20} weitere`);
} else {
  console.log('   ✓ keine Textstelle unter 3:1');
}
if (zuSchwach.length) {
  console.log(`   · ${zuSchwach.length} Textstelle(n) zwischen 3:1 und 4.5:1 — abhaengig von der Schriftgroesse,`);
  console.log('     Rueckstand fuer Welle 2 (Design-System). Kein Fehler in dieser Welle.');
  zuSchwach.slice(0, 8).forEach((t) => {
    console.log(`     ${String(t.verhaeltnis).padStart(5)}:1  ${t.bereich.padEnd(24)} ${t.vordergrund.padEnd(22)} „${t.text}"`);
  });
  if (zuSchwach.length > 8) console.log(`     … und ${zuSchwach.length - 8} weitere`);
}

/* 4 — Endpunkt-Auflösung */
console.log('\n4) Endpunkt-Aufloesung');
const ERWARTET = [
  ['admin-mutate', { action: 'customers.update' }, 'admin-customer-update'],
  ['admin-mutate', { action: 'contracts.cancel', payload: {} }, 'contract-terminate'],
  ['trigger-elevenlabs-sync', {}, 'trigger-elevenlabs-sync-v2'],
  ['scrape-website', {}, 'scrape-website-v2'],
  ['customer-billing-update', { action: 'cancel_invoice' }, 'invoice-financial-action'],
  ['customer-billing-update', { action: 'create_credit_note' }, 'invoice-financial-action'],
  ['customer-billing-update', { action: 'create_overage_invoice' }, 'admin-overage-invoice'],
  ['customer-billing-update', { action: 'send_payment_link' }, 'REJECT'],
  ['mail-dispatch', { mail_type: 'invoice_email', invoice_id: 'i1' }, 'invoice-mail-dispatch'],
  ['mail-dispatch', { mail_type: 'invoice_email', invoice_id: 'i1', dry_run: true }, 'invoice-mail-preview'],
  ['mail-dispatch', { mail_type: 'offer_email', offer_id: 'o1' }, 'mail-dispatch'],
  ['admin-voices', { action: 'list' }, 'admin-voices']
];
const aufloesung = await page.evaluate((faelle) => faelle.map(([name, payload, erwartet]) => {
  const r = window.VoxeraAdminApi.resolve(name, payload);
  return { name, action: payload.action || payload.mail_type || '—', ist: r.reject ? 'REJECT' : r.name, erwartet };
}), ERWARTET);
for (const z of aufloesung) {
  const ok = z.ist === z.erwartet;
  if (!ok) fehlerhaft += 1;
  console.log(`   ${ok ? '✓' : '✗'} ${(z.name + ' / ' + z.action).padEnd(46)} → ${z.ist}${ok ? '' : `  (erwartet ${z.erwartet})`}`);
}

/* 5 — Stilschichten: geladen und an der richtigen Stelle

   Welle 2 hat vier Stylesheets aus den Laufzeit-Patches herausgeloest. Der
   ganze Grund, warum sie ohne !important auskommen, ist ihre Position: bei
   gleicher Spezifitaet gewinnt die spaetere Regel. Steht die Einbindung
   versehentlich VOR den <style>-Bloecken des Dokuments, sind die Dateien still
   unwirksam -- die Seite sieht funktionierend aus, waehrend die alte Regel
   gewinnt. Genau dieser Fehler ist beim Bauen passiert und ist einer Pruefung
   auf Dateiebene entgangen, weil dort beides vorhanden war.

   Deshalb wird hier im wirklich gebauten Dokument gemessen. */
console.log('\n5) Stilschichten');
const ERWARTETE_SCHICHTEN = ['admin-design-tokens.css', 'admin-components.css', 'admin-layout.css', 'admin-responsive.css'];

// Wieviele <style>-Bloecke bringt das Dokument selbst im <head> mit? Alles, was
// darueber hinaus zur Laufzeit im Kopf auftaucht, hat ein Patch per
// head.appendChild() nachgeschoben -- das landet zwangslaeufig hinter den
// <link>-Zeilen und ist deshalb eine andere Frage (Welle 2 Teil 3).
// HTML-Kommentare zuerst weg: der Kommentar ueber den <link>-Zeilen erwaehnt
// die <style>-Bloecke, und ohne diesen Schritt zaehlt die Erwaehnung mit.
const kopfQuelle = readFileSync(join(ADMIN, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const eigeneBloecke = (kopfQuelle.slice(0, kopfQuelle.indexOf('</head>')).match(/<style[\s>]/g) || []).length;

const schichten = await page.evaluate(() => {
  const blaetter = [...document.styleSheets].filter((s) => s.ownerNode && s.ownerNode.closest('head'));
  return blaetter.map((s) => ({
    name: s.href ? new URL(s.href).pathname.split('/').pop().split('?')[0] : '<inline>',
    regeln: (() => { try { return s.cssRules.length; } catch { return null; } })()
  }));
});

// Position des letzten dokumenteigenen <style>-Blocks.
let gezaehlt = 0;
let letzterEigener = -1;
schichten.forEach((s, i) => {
  if (s.name !== '<inline>') return;
  gezaehlt += 1;
  if (gezaehlt <= eigeneBloecke) letzterEigener = i;
});

for (const datei of ERWARTETE_SCHICHTEN) {
  const platz = schichten.findIndex((s) => s.name === datei);
  if (platz < 0) {
    fehlerhaft += 1;
    console.log(`   ✗ ${datei.padEnd(26)} nicht geladen`);
    continue;
  }
  const regeln = schichten[platz].regeln;
  if (!regeln) {
    fehlerhaft += 1;
    console.log(`   ✗ ${datei.padEnd(26)} geladen, aber ohne Regeln (404 oder falscher MIME-Typ?)`);
    continue;
  }
  if (platz < letzterEigener) {
    fehlerhaft += 1;
    console.log(`   ✗ ${datei.padEnd(26)} steht VOR den <style>-Bloecken des Dokuments und ist damit wirkungslos.`);
    console.log('     Die <link>-Zeilen gehoeren ans Ende des <head>, nach allen <style>-Bloecken.');
    continue;
  }
  console.log(`   ✓ ${datei.padEnd(26)} ${String(regeln).padStart(4)} Regeln, nach den ${eigeneBloecke} eigenen <style>-Bloecken`);
}

const nachgeschoben = schichten.slice(letzterEigener + 1).filter((s) => s.name === '<inline>');
if (nachgeschoben.length) {
  const regeln = nachgeschoben.reduce((summe, s) => summe + (s.regeln || 0), 0);
  console.log(`   · ${nachgeschoben.length} zur Laufzeit nachgeschobene <style>-Bloecke (${regeln} Regeln) stehen dahinter`);
  console.log('     und gewinnen deshalb weiter. Das ist der Rest von Welle 2 Teil 3, kein Fehler hier.');
}

await ctx.close();

/* 6 — Ablation */
if (MIT_ABLATION) {
  console.log('\n6) Ablation — jeden Laufzeit-Patch einzeln blockieren');
  const offerBrand = readFileSync(join(ADMIN, 'shared/offer-brand.js'), 'utf8');
  const patches = [...offerBrand.matchAll(/'\/shared\/(admin-runtime-[a-z0-9-]*\.js)/g)].map((m) => m[1]);
  for (const patch of patches) {
    const lauf = await starte(browser, patch);
    const abweichung = await lauf.page.evaluate((routen) => {
      const out = {};
      for (const r of routen) {
        try { window.setRoute(r); } catch (_e) { out[r] = -1; continue; }
        const sec = document.querySelector('.section.active');
        const sichtbar = (el) => { const cs = getComputedStyle(el); const b = el.getBoundingClientRect(); return cs.display !== 'none' && b.width > 0 && b.height > 0; };
        out[r] = sec ? [...sec.querySelectorAll('button,a[href],input,select,textarea,[onclick]')].filter(sichtbar).length : -1;
      }
      return out;
    }, ROUTEN);
    const diff = Object.entries(abweichung).filter(([k, v]) => v !== screens[k]).map(([k, v]) => `${k}:${screens[k]}→${v}`);
    const marke = lauf.fehler.length ? '✗' : (diff.length ? '·' : ' ');
    console.log(`   ${marke} ${patch.replace('admin-runtime-', '').replace('.js', '').padEnd(32)} Fehler:${String(lauf.fehler.length).padStart(2)}  ${diff.join('  ') || 'keine Abweichung'}`);
    await lauf.ctx.close();
  }
  console.log('   („·" heisst: der Patch veraendert die Oberflaeche sichtbar. „✗": ohne ihn bricht der Start.)');
} else {
  console.log('\n6) Ablation uebersprungen — mit --ablation einschalten.');
}

await browser.close();

if (fehlerhaft > 0) {
  console.error(`\n${fehlerhaft} Pruefung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('\nAlle Pruefungen bestanden.');
