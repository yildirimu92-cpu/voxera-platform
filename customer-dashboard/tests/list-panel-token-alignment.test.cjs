'use strict';

/**
 * Etappe: Listen an das modernisierte Detail-Panel angleichen (#848 →
 * Heute-Karten + Anfragen-Zeilen), reiner Token-/CSS-Pass.
 * Siehe docs/LISTEN_ANGLEICHUNG_DIAGNOSE_2026-08-08.md.
 *
 * Die Regressionsgefahr ist zweigeteilt:
 *
 *   1. Ein naiver Token-Pass auf --vx-ui-row-title-size/-icon-bg/-icon-color
 *      träfe zusätzlich .vx-dv2-action-title/-icon im Detail-Panel und den
 *      Audio-Player (.vx-audio-modern__*) — beide lesen denselben Satz mit.
 *      Der Audio-Player ist laut #848 ausdrücklich eigener Auftrag. Diese
 *      Tests fixieren, dass die drei riskanten Rollen über eigene
 *      --vx-ui-list-* Tokens laufen und Panel/Audio-Player unberührt bleiben.
 *   2. Die "resolved"-Handover-Karte hatte bisher kein Avatar-Icon, während
 *      "needs" eines trug — eine Asymmetrie, die mit angeglichen wird.
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const dashboard = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const tokens = fs.readFileSync(path.join(ROOT, 'shared', 'customer-design-tokens.css'), 'utf8');

function rule(selector, source = dashboard) {
  const escaped = selector.replace(/[.#]/g, '\\$&');
  const m = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(source);
  assert.ok(m, `Regel nicht gefunden: ${selector}`);
  return m[1];
}

// ── 1. Die drei listen-eigenen Tokens existieren und hängen an der Basisfarbe ─

test('Listen-Tokens sind definiert und zeigen auf die Basisfarben', () => {
  assert.match(tokens, /--vx-ui-list-title-size:\s*15px;/);
  assert.match(tokens, /--vx-ui-list-avatar-bg:\s*var\(--vx-color-night,\s*#0D1F3C\);/);
  assert.match(tokens, /--vx-ui-list-avatar-color:\s*var\(--vx-color-gold\);/);
});

// ── 2. Beide Listenfamilien ziehen die neuen Tokens, nicht mehr die alten ────

test('Anfragen-Icon und Heute-Karten-Icon ziehen Night+Gold aus dem Listen-Token', () => {
  for (const selector of [
    'body.vx-customer-design-foundation .vx-requests-panel .vx-requests-icon',
    'body.vx-customer-design-foundation .vx-requests-panel .vx-requests-icon.is-call',
    '.vx-handover-card-icon'
  ]) {
    const decl = rule(selector);
    assert.match(decl, /background:var\(--vx-ui-list-avatar-bg\)/, selector);
    assert.match(decl, /color:var\(--vx-ui-list-avatar-color\)/, selector);
    assert.ok(!/var\(--vx-ui-row-icon-(?:bg|color)\)/.test(decl),
      `${selector} haengt noch am alten ruhigen Icon-Token`);
  }
});

test('Anfragen-Titel und Heute-Karten-Titel ziehen die Groesse aus dem Listen-Token', () => {
  for (const selector of [
    'body.vx-customer-design-foundation .vx-requests-panel .vx-requests-title',
    '.vx-handover-card-title'
  ]) {
    const decl = rule(selector);
    assert.match(decl, /font-size:var\(--vx-ui-list-title-size\)/, selector);
    // Farbe und Gewicht bleiben bewusst am geteilten Satz (unveraendert
    // uebertragbar, siehe Diagnose Teil B).
    assert.match(decl, /font-weight:var\(--vx-ui-row-title-weight\)/, selector);
    assert.match(decl, /color:var\(--vx-ui-row-title-color\)/, selector);
  }
});

test('Meta/Zeit-Text ist auf das Panel-Gewicht 600 gehoben, Groesse bleibt geteilt', () => {
  for (const selector of [
    'body.vx-customer-design-foundation .vx-requests-panel .vx-requests-time',
    'body.vx-customer-design-foundation .vx-requests-panel .vx-requests-company',
    'body.vx-customer-design-foundation .vx-requests-panel .vx-requests-meta',
    '.vx-handover-card-time'
  ]) {
    const decl = rule(selector);
    assert.match(decl, /font-weight:var\(--vx-ui-section-label-weight\)/, selector);
    assert.match(decl, /font-size:var\(--vx-ui-row-time-size\)/, selector);
  }
});

// ── 3. Kein Kollateralschaden: Panel und Audio-Player bleiben am alten Satz ──

test('das Detail-Panel bleibt auf dem geteilten --vx-ui-row-* Satz, nicht den Listen-Tokens', () => {
  for (const selector of ['.vx-dv2-action-icon', '.vx-dv2-action-title']) {
    const decl = rule(selector);
    assert.ok(!/--vx-ui-list-/.test(decl),
      `${selector} zieht faelschlich einen Listen-Token — das Panel darf vom Listen-Pass nicht betroffen sein`);
  }
  assert.match(rule('.vx-dv2-action-icon'), /background:var\(--vx-ui-row-icon-bg\)/);
  assert.match(rule('.vx-dv2-action-title'), /font-size:var\(--vx-ui-row-title-size\)/);
});

test('der Audio-Player bleibt unangetastet (eigener Auftrag laut #848)', () => {
  for (const selector of ['.vx-audio-modern__btn', '.vx-audio-modern__speed']) {
    const decl = rule(selector);
    assert.ok(!/--vx-ui-list-/.test(decl),
      `${selector} zieht faelschlich einen Listen-Token`);
    assert.match(decl, /var\(--vx-ui-row-icon-bg/, selector);
  }
});

test('--vx-ui-row-icon-bg/-color und --vx-ui-row-title-size bleiben im Token-Owner unveraendert', () => {
  // Diese drei Rollen duerfen sich nicht mitverschieben, sonst haette der
  // geteilte Satz sich doch geaendert und der Listen-Pass waere kein
  // Nebeneffekt-freier Zusatz mehr.
  assert.match(tokens, /--vx-ui-row-title-size:\s*14px;/);
  assert.match(tokens, /--vx-ui-row-icon-bg:\s*#F1F5F9;/);
  assert.match(tokens, /--vx-ui-row-icon-color:\s*var\(--vx-ui-icon-quiet\);/);
});

// ── 4. Kontrast Gold auf Night ───────────────────────────────────────────────

test('Gold-auf-Night erreicht die 3:1-Schwelle fuer Nicht-Text', () => {
  const luminance = (hex) => {
    const parts = hex.replace('#', '').match(/../g).map((p) => parseInt(p, 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
  };
  const ratio = (fg, bg) => {
    const [a, b] = [luminance(fg), luminance(bg)];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  const night = /--vx-color-night:\s*(#[0-9A-Fa-f]{6})/.exec(tokens)[1];
  const gold = /--vx-color-gold:\s*(#[0-9A-Fa-f]{6})/.exec(tokens)[1];
  const measured = ratio(gold, night);
  assert.ok(measured >= 3, `Gold auf Night erreicht nur ${measured.toFixed(2)}:1`);
});

// ── 5. Die "resolved"-Handover-Karte trägt jetzt ein Avatar-Icon ────────────

test('die "resolved"-Handover-Karte hat ein Avatar-Icon wie "needs"', () => {
  const start = dashboard.indexOf("vx-handover-card vx-handover-card--resolved");
  assert.ok(start > 0, '"resolved"-Kartenmarkup nicht gefunden');
  const region = dashboard.slice(start, start + 400);
  assert.match(region, /vx-handover-card-body/, 'Body-Wrapper fehlt in der resolved-Karte');
  assert.match(region, /vx-handover-card-icon/, 'Avatar-Icon fehlt in der resolved-Karte');
  assert.match(region, /ph-bold ph-phone/, 'Icon-Glyph fehlt in der resolved-Karte');
});

test('needs- und resolved-Variante teilen sich dieselbe Icon-Klasse (ein CSS-Ort)', () => {
  const needsStart = dashboard.indexOf("vx-handover-card vx-handover-card--needs");
  const resolvedStart = dashboard.indexOf("vx-handover-card vx-handover-card--resolved");
  assert.ok(needsStart > 0 && resolvedStart > 0);
  const needsRegion = dashboard.slice(needsStart, needsStart + 400);
  const resolvedRegion = dashboard.slice(resolvedStart, resolvedStart + 400);
  const iconClass = /class="(vx-handover-card-icon)"/;
  assert.equal(iconClass.exec(needsRegion)?.[1], 'vx-handover-card-icon');
  assert.equal(iconClass.exec(resolvedRegion)?.[1], 'vx-handover-card-icon');
});

// ── 6. Kein Gold-Verlaufsstreifen pro Zeile (Entscheidung: in diesem Schritt nicht) ─

test('die Listenzeilen bekommen keinen Gold-Verlaufsstreifen pro Zeile', () => {
  for (const selector of [
    'body.vx-customer-design-foundation .vx-requests-panel .vx-requests-icon',
    '.vx-handover-card-icon',
    '.vx-handover-card',
    'body.vx-customer-design-foundation .vx-requests-item'
  ]) {
    // rule() wirft, wenn die Regel fehlt — hier nur prüfen, wo sie existiert.
    let decl = '';
    try { decl = rule(selector); } catch (e) { continue; }
    assert.ok(!/--vx-ui-brand-rule\b/.test(decl),
      `${selector} traegt den Panel-Verlaufsstreifen — laut Entscheidung nicht Teil dieses Schritts`);
  }
});

// ── 7. Keine Struktur-/IA-Aenderung ──────────────────────────────────────────

test('die Anfragen-Zeile behaelt ihr Typ-Icon (keine Initialen, keine Informationsverlust)', () => {
  // Der Auftrag schliesst IA-Aenderungen aus. Ein Wechsel auf Initialen
  // wuerde den Anfrage-Typ (Anruf/Rueckruf/Offerte/Termin) aus der Zeile
  // entfernen.
  const rowBlockStart = dashboard.indexOf('function renderAnrufeInbox');
  const rowBlockEnd = dashboard.indexOf('function renderArchivInbox');
  assert.ok(rowBlockStart > 0 && rowBlockEnd > rowBlockStart, 'Funktionsgrenzen nicht gefunden');
  const rowBlock = dashboard.slice(rowBlockStart, rowBlockEnd);
  assert.match(rowBlock, /ph-bold ph-'\s*\+\s*_esc\(typeMeta\.icon/,
    'die Anfragen-Zeile rendert das Typ-Icon nicht mehr');
});
