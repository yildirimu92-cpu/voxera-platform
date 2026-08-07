import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'config', 'mail-engine-contracts.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const scanRoots = [
  path.join(root, 'admin-panel', 'netlify', 'functions'),
  path.join(root, 'customer-dashboard', 'netlify', 'functions'),
  path.join(root, 'admin-panel', 'shared')
];

const allowedExtensions = new Set(['.js', '.mjs', '.cjs', '.html']);
const ignoredDirectories = new Set(['node_modules', '.git', 'dist', 'build']);
const knownTypes = new Set([
  ...manifest.canonical_mail_types,
  ...manifest.accepted_aliases,
  ...manifest.legacy_invoice_only_types
]);
const legacyTypes = new Set(manifest.legacy_invoice_only_types);

function walk(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, files);
    else if (allowedExtensions.has(path.extname(entry.name))) files.push(absolute);
  }
  return files;
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

// Only mail_type is a Make routing contract. event_type is also used for
// internal audit events such as accepted/opened/send_failed and must not be
// treated as a mail-template identifier. The prefix guard prevents matching
// metadata keys such as legacy_mail_type.
const literalPattern = /(?:^|[^A-Za-z0-9_])mail_type\s*:\s*['"]([a-z0-9_]+)['"]/gm;
const occurrences = [];

for (const file of scanRoots.flatMap(directory => walk(directory))) {
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(literalPattern)) {
    occurrences.push({ type: match[1], file: relative(file) });
  }
}

const unknown = occurrences.filter(entry => !knownTypes.has(entry.type));
const legacy = occurrences.filter(entry => legacyTypes.has(entry.type));
const failures = [];

if (unknown.length) {
  failures.push(
    `Unknown literal mail types:\n${unknown.map(entry => `- ${entry.type} in ${entry.file}`).join('\n')}`
  );
}

const countersignServicePath = path.join(
  root,
  'admin-panel',
  'netlify',
  'functions',
  '_lib',
  'contract-countersign-service.js'
);
const countersignSource = fs.readFileSync(countersignServicePath, 'utf8');
const canonicalContractPattern = /(?:^|[^A-Za-z0-9_])mail_type\s*:\s*['"]contract_signed_email['"]/m;
const retiredContractPattern = /(?:^|[^A-Za-z0-9_])mail_type\s*:\s*['"]countersign_email['"]/m;
if (!canonicalContractPattern.test(countersignSource)) {
  failures.push('contract-countersign-service.js must emit contract_signed_email.');
}
if (retiredContractPattern.test(countersignSource)) {
  failures.push('contract-countersign-service.js still emits the retired countersign_email alias.');
}
if (!countersignSource.includes('process.env.MAKE_MAIL_WEBHOOK')) {
  failures.push('contract-countersign-service.js must prefer MAKE_MAIL_WEBHOOK.');
}

const accessPath = path.join(
  root,
  'admin-panel',
  'netlify',
  'functions',
  'send-customer-access.js'
);
const accessSource = fs.readFileSync(accessPath, 'utf8');
for (const alias of ['welcome', 'password_reset']) {
  if (!accessSource.includes(`'${alias}'`)) {
    failures.push(`send-customer-access.js must retain the supported ${alias} event.`);
  }
}

const aiNotifyPath = path.join(
  root,
  'customer-dashboard',
  'netlify',
  'functions',
  'ai-change-notify.js'
);
const aiNotifySource = fs.readFileSync(aiNotifyPath, 'utf8');
const aiChangePattern = /(?:^|[^A-Za-z0-9_])mail_type\s*:\s*['"]ai_change_request['"]/m;
if (!aiChangePattern.test(aiNotifySource)) {
  failures.push('ai-change-notify.js must emit ai_change_request.');
}

console.log(`Mail contract manifest v${manifest.version}`);
console.log(`Scanned ${occurrences.length} literal mail_type declarations.`);
console.log(`Recognized types: ${[...new Set(occurrences.map(entry => entry.type))].sort().join(', ') || 'none'}`);

if (legacy.length) {
  const uniqueLegacy = [...new Set(legacy.map(entry => `${entry.type} in ${entry.file}`))];
  console.warn('Legacy invoice-only compatibility declarations detected:');
  for (const entry of uniqueLegacy) console.warn(`- ${entry}`);
  console.warn('They must not be reintroduced as customer-facing payment-link routes in Make.');
}

if (failures.length) {
  console.error('\nMail engine contract verification failed:\n');
  for (const failure of failures) console.error(`${failure}\n`);
  process.exit(1);
}

console.log('Mail engine contract verification passed.');
