import fs from 'node:fs';

const path = 'scripts/verify-customer-design-foundation.mjs';
let source = fs.readFileSync(path, 'utf8');
const malformed = `  "onclick="vxMehrShow('abonnement')"",`;
const corrected = `  "onclick=\\"vxMehrShow('abonnement')\\"",`;

if (source.includes(malformed)) {
  source = source.replace(malformed, corrected);
  fs.writeFileSync(path, source);
  console.log('Settings verifier quoting fixed.');
} else if (source.includes(corrected)) {
  console.log('Settings verifier quoting already fixed.');
} else {
  throw new Error('Expected settings verifier token not found.');
}
