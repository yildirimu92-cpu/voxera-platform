import fs from 'node:fs';

const runtime = fs.readFileSync('admin-panel/shared/admin-runtime-payment-account.js', 'utf8');
const endpoint = fs.readFileSync('admin-panel/netlify/functions/admin-payment-account.js', 'utf8');
const migration = fs.readFileSync('supabase/migrations/2026-08-01_payment_accounts_qr_billing.sql', 'utf8');
const loader = fs.readFileSync('admin-panel/shared/offer-brand.js', 'utf8');

// Jeder zugewiesene Wert von stripe_link_enabled, egal ob als Objekt-Eigenschaft
// oder als Zuweisung geschrieben. Der Wert wird ausgelesen statt per Lookahead
// ausgeschlossen: ein \s* vor dem Lookahead faellt auf Nullbreite zurueck und
// laesst " false" faelschlich als Treffer durch.
const stripeValues = runtime
  .split('\n')
  .map((line) => line.match(/stripe_link_enabled\s*[:=]\s*([^;,\s)]+)/))
  .filter(Boolean)
  .map((match) => match[1]);

const checks = [
  ['payment account table', migration.includes('CREATE TABLE IF NOT EXISTS public.payment_accounts')],
  ['invoice snapshot', migration.includes('payment_account_snapshot jsonb')],
  ['RLS enabled', migration.includes('ENABLE ROW LEVEL SECURITY')],
  ['IBAN validation', endpoint.includes('function validIban') && endpoint.includes('mod97')],
  ['QR IBAN validation', endpoint.includes('function isQrIban') && endpoint.includes('30000')],
  ['QRR pairing enforced', endpoint.includes("reference_type === 'QRR'")],
  ['secured admin caller', endpoint.includes('requireAdminCaller')],
  ['audit entry', endpoint.includes("payment_account.update")],
  ['settings UI', runtime.includes('Zahlungskonto & QR-Rechnung')],
  ['masked IBAN', runtime.includes('maskIban')],
  // Frueher wurde hier das Objekt-Literal 'stripe_link_enabled:false' gesucht --
  // ein ueberschreibbarer Default. Den gibt es seit dem Entfernen der
  // Stripe-Bedienelemente (2026-08-01) nicht mehr: die Einstellung wird beim
  // Speichern unbedingt auf false gesetzt, egal was im Formular steht. Geprueft
  // wird deshalb die staerkere Zusage -- erzwungenes Aus, und kein Pfad, der es
  // wieder einschaltet.
  // Beide Zusagen gelten fuer die Admin-OBERFLAECHE, nicht fuer den Endpunkt --
  // gelesen wird ausschliesslich admin-runtime-payment-account.js. Der Name
  // sagt das jetzt, denn die erste Fassung dieser Pruefung hiess "kein Pfad
  // aktiviert Stripe" und behauptete damit mehr, als sie misst:
  // admin-payment-account.js:62 uebernimmt stripe_link_enabled === true aus dem
  // Request-Body und persistiert es. Ein Admin, der direkt gegen den Endpunkt
  // postet, kann die Einstellung also einschalten.
  //
  // Wirksam wird das heute nirgends: der Wert landet nur im
  // payment_account_snapshot der Rechnung (_lib/invoice-payment-context.js:40),
  // kein Pfad erzeugt daraus einen Zahlungslink, und invoice-mail-dispatch.js
  // setzt has_payment_link fest auf false. Der Endpunkt gehoert trotzdem
  // nachgezogen -- das waere eine Aenderung an Produktivcode und keine an
  // dieser Pruefung, deshalb hier nur festgehalten.
  ['Admin-Oberflaeche deaktiviert Stripe unbedingt', stripeValues.includes('false')],
  ['Admin-Oberflaeche hat keinen aktivierenden Pfad', stripeValues.length > 0 && stripeValues.every((value) => value === 'false')],
  ['runtime loaded', loader.includes('admin-runtime-payment-account.js')]
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error('Payment account verification failed:', failed.map(([name]) => name).join(', '));
  process.exit(1);
}
console.log(`Payment account verification passed (${checks.length} checks).`);
