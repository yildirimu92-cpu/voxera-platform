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

// Wer darf MAKE_MAIL_WEBHOOK ueberhaupt lesen.
//
// Hintergrund: auf der Dashboard-Site trug diese Variable den Call-Intake-Hook,
// weil elevenlabs-post-call.js sie fuer Gespraechsdaten mitbenutzte. Make
// quittiert solche Requests mit HTTP 200 und legt sie in die Queue eines
// abgeschalteten Szenarios - jede Admin-Benachrichtigung verschwand dort
// spurlos, waehrend Code und UI Erfolg meldeten.
//
// Auf der Dashboard-Site darf die Variable deshalb nur noch in der gemeinsamen
// Versand-Bibliothek vorkommen. Auf der Admin-Site steht sie zusaetzlich in
// Sendern, die noch nicht migriert sind; diese Liste ist Restschuld und soll
// schrumpfen, nicht wachsen.
const mailWebhookAllowlist = new Set([
  'admin-panel/netlify/functions/_lib/mail-delivery.js',
  'admin-panel/netlify/functions/outbox-retry-worker.js',
  'admin-panel/netlify/functions/mail-dispatch.js',
  'admin-panel/netlify/functions/invoice-mail-dispatch.js',
  'customer-dashboard/netlify/functions/_lib/mail-delivery.js'
]);

for (const file of scanRoots.flatMap(directory => walk(directory))) {
  const relativePath = relative(file);
  if (!fs.readFileSync(file, 'utf8').includes('process.env.MAKE_MAIL_WEBHOOK')) continue;
  if (mailWebhookAllowlist.has(relativePath)) continue;
  failures.push(
    `${relativePath} reads MAKE_MAIL_WEBHOOK directly. Send through _lib/mail-delivery.js instead, `
    + 'or add the file to the allowlist in this script if that is genuinely intended.'
  );
}

// Die Typliste in _lib/mail-delivery.js muss dem Manifest entsprechen. Sie
// steht dort als Literal, weil Netlify jede Funktion einzeln bundelt und
// config/ ausserhalb des Funktionsverzeichnisses liegt - ohne diese Pruefung
// koennten beide Listen unbemerkt auseinanderlaufen. countersign_email ist der
// zurueckgezogene Alias und darf in keiner der beiden stehen.
const expectedEngineTypes = [...knownTypes].filter(type => type !== 'countersign_email').sort();
for (const site of ['admin-panel', 'customer-dashboard']) {
  const libPath = path.join(root, site, 'netlify', 'functions', '_lib', 'mail-delivery.js');
  if (!fs.existsSync(libPath)) {
    failures.push(`${site}/netlify/functions/_lib/mail-delivery.js is missing.`);
    continue;
  }
  const libSource = fs.readFileSync(libPath, 'utf8');
  const listMatch = libSource.match(/const MAIL_ENGINE_TYPES = Object\.freeze\(\[([\s\S]*?)\]\);/);
  if (!listMatch) {
    failures.push(`${site}/netlify/functions/_lib/mail-delivery.js: MAIL_ENGINE_TYPES not found.`);
    continue;
  }
  const declared = [...listMatch[1].matchAll(/'([a-z0-9_]+)'/g)].map(entry => entry[1]).sort();
  const missing = expectedEngineTypes.filter(type => !declared.includes(type));
  const extra = declared.filter(type => !expectedEngineTypes.includes(type));
  if (missing.length || extra.length) {
    failures.push(
      `${site}/netlify/functions/_lib/mail-delivery.js MAIL_ENGINE_TYPES drifted from the manifest.`
      + (missing.length ? `\n  missing: ${missing.join(', ')}` : '')
      + (extra.length ? `\n  unexpected: ${extra.join(', ')}` : '')
    );
  }
}

// Der konkrete Rueckfall, der das Admin-Benachrichtigungssystem lahmgelegt hat:
// Gespraechsdaten und Mailversand teilen sich wieder eine Variable.
const postCallPath = path.join(
  root,
  'customer-dashboard',
  'netlify',
  'functions',
  'elevenlabs-post-call.js'
);
const postCallSource = fs.readFileSync(postCallPath, 'utf8');
if (!postCallSource.includes('process.env.MAKE_CALL_INTAKE_WEBHOOK')) {
  failures.push('elevenlabs-post-call.js must post call-intake payloads to MAKE_CALL_INTAKE_WEBHOOK.');
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

// Diese Pruefung hing frueher an ai-change-notify.js. Diese Datei war zu dem
// Zeitpunkt bereits tot - sie wurde von keinem Aufrufer mehr erreicht, waehrend
// der Waechter sie als Emitter festschrieb. Jetzt haengt sie am lebenden Pfad.
const aiChangeCreatePath = path.join(
  root,
  'customer-dashboard',
  'netlify',
  'functions',
  'ai-change-request-create.js'
);
const aiChangeCreateSource = fs.readFileSync(aiChangeCreatePath, 'utf8');
if (!/mailType\s*:\s*['"]ai_change_request['"]/m.test(aiChangeCreateSource)) {
  failures.push('ai-change-request-create.js must send the ai_change_request notification.');
}
if (fs.existsSync(path.join(root, 'customer-dashboard', 'netlify', 'functions', 'ai-change-notify.js'))) {
  failures.push('ai-change-notify.js is retired — the change-request mail goes through ai-change-request-create.js.');
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
