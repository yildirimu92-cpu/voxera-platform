import assert from 'node:assert/strict';
import fs from 'node:fs';

const path = 'customer-dashboard/index.html';
let source = fs.readFileSync(path, 'utf8');

function replaceRange(startToken, endToken, replacement, label) {
  const start = source.indexOf(startToken);
  assert.ok(start >= 0, `Missing cleanup start: ${label}`);
  const end = source.indexOf(endToken, start);
  assert.ok(end > start, `Missing cleanup end: ${label}`);
  source = source.slice(0, start) + replacement + source.slice(end);
}

replaceRange(
  '/* ══════════════════════════════════════════════\n   VOXERA TYPOGRAPHY SYSTEM',
  '/* Accordion header text */',
  `/* ══════════════════════════════════════════════
   VOXERA TYPOGRAPHY SYSTEM
   L1  Page header title:  17px 700  (vx-page-header-title)
   L2  Card/section head:  13px 700  (.vx-card-head, night card spans)
   L3  Label uppercase:    10px 700  uppercase .vx-label
   L4  List item title:    14px 600  (dpr-name, acc-header span)
   L5  Body text:          13px 400
   L6  Meta / sub:         12px 400
   L7  Micro:              11px 400
══════════════════════════════════════════════ */

`,
  'typography documentation'
);

replaceRange(
  '/* — 1. Token-Refinement: ink3 heller für bessere Lesbarkeit von Sub-Texten —',
  '/* — 3. Modale',
  `/* — 1. Token-Refinement: ink3 heller für bessere Lesbarkeit von Sub-Texten —
       Wirkt automatisch auf alle Stellen die var(--ink3) nutzen
       (call-meta, settings-card-lead, kpi-label, dash-side-meta, etc.) — */


/* — 3. Modale`,
  'token refinement documentation'
);

const emptyQueries = [
  '@media(max-width:900px){}\n@media(max-width:768px){}\n@media(max-width:480px){}\n',
  '@media(max-width:600px){\n}\n@media(max-width:400px){\n}\n',
  '@media(max-width:768px){\n}\n@media(max-width:360px){\n}\n'
];
for (const query of emptyQueries) source = source.replace(query, '');

assert.equal((source.match(/VOXERA TYPOGRAPHY SYSTEM/g) || []).length, 1, 'Typography documentation must have one owner');
assert.ok(source.includes('L7  Micro:              11px 400\n══════════════════════════════════════════════ */'), 'Typography comment is not closed');
assert.ok(!source.includes('@media(max-width:900px){}'), 'Empty report media query remains');

fs.writeFileSync(path, source);
console.log('Customer report migration cleanup passed.');
