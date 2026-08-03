import fs from 'node:fs';

const source = fs.readFileSync('customer-dashboard/index.html', 'utf8');

function functionRange(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`missing ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = brace; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i += 1; } continue; }
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === '/' && next === '/') { lineComment = true; i += 1; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}') { depth -= 1; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`unterminated ${name}`);
}

for (const name of ['anrufeChipFilter', 'anrufeInboxSubFilter', 'renderAnrufe']) {
  console.log(`\n===== ${name} =====\n`);
  console.log(functionRange(name));
}

const terms = ['vx-chip--active', "classList.add('active')", "classList.remove('active')", '.vx-split-filters', '.vx-requests-filters'];
for (const term of terms) {
  console.log(`\n===== OCCURRENCES ${term} =====`);
  let pos = 0;
  let count = 0;
  while ((pos = source.indexOf(term, pos)) >= 0 && count < 30) {
    console.log(source.slice(Math.max(0, pos - 180), Math.min(source.length, pos + term.length + 220)).replace(/\n/g, ' '));
    pos += term.length;
    count += 1;
  }
  console.log(`count shown=${count}`);
}
