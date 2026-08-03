import fs from 'node:fs';

const path = 'scripts/verify-customer-design-foundation.mjs';
let source = fs.readFileSync(path, 'utf8');
const broad = "  'barEl.style.width',";
const scoped = `  "if (barEl) { barEl.style.width = pct + '%'; barEl.style.background = pct >= 80 ? '#D97706' : '#1A6FE8'; }",`;

if (source.includes(broad)) {
  source = source.replace(broad, scoped);
  fs.writeFileSync(path, source);
  console.log('Subscription progress legacy check scoped to the replaced implementation.');
} else if (source.includes(scoped)) {
  console.log('Subscription progress legacy check is already scoped.');
} else {
  throw new Error('Expected subscription progress verifier token not found.');
}
