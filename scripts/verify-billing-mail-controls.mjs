#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import process from 'node:process';

const paths = {
  mailDispatch: new URL('../admin-panel/netlify/functions/mail-dispatch.js', import.meta.url),
  billingRunner: new URL('../admin-panel/netlify/functions/daily-billing-runner.js', import.meta.url),
  adminIndex: new URL('../admin-panel/index.html', import.meta.url),
  netlifyConfig: new URL('../admin-panel/netlify.toml', import.meta.url)
};

const [mailDispatch, billingRunner, adminIndex, netlifyConfig] = await Promise.all(
  Object.values(paths).map(path => readFile(path, 'utf8'))
);

function section(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  if (start < 0 || end < 0) return '';
  return source.slice(start, end);
}

function syntaxValid(source) {
  try {
    new Function(source);
    return true;
  } catch {
    return false;
  }
}

function inlineScriptsValid(html) {
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)];
  return scripts
    .filter(match => !/\bsrc\s*=/.test(match[1] || ''))
    .every(match => syntaxValid(match[2] || ''));
}

const dryRunIndex = mailDispatch.indexOf('if (isDryRun)');
const outboxIndex = mailDispatch.indexOf('createOutboxEvent(sbAdmin', dryRunIndex);
const webhookIndex = mailDispatch.indexOf(
  "const webhookUrl = process.env.MAKE_MAIL_WEBHOOK",
  dryRunIndex
);
const invoiceSend = section(
  adminIndex,
  'async function sendInvoiceEmail(invoiceId, btnEl, options={}){',
  'async function markBillingPaid(customerId){'
);
const reminderSend = section(
  adminIndex,
  'async function submitReminderModal() {',
  '// Legacy entry point — öffnet jetzt das Voxera-Modal statt window.prompt'
);
const dunningSweep = section(
  billingRunner,
  'async function runDunningSweep({ sbAdmin, now }) {',
  '// ─────────────────────────────────────────────────────────────────────────────\n// Contract Expiry Sweep'
);

const checks = [
  [
    'mail-dispatch requires an authenticated admin',
    /requireAdminCaller/.test(mailDispatch)
  ],
  [
    'invoice and reminder dry-run is explicitly supported',
    /parsed\.body\.dry_run === true/.test(mailDispatch)
      && /previewableMailTypes/.test(mailDispatch)
      && /dry_run:\s*true/.test(mailDispatch)
  ],
  [
    'dry-run returns before outbox creation and Make webhook access',
    dryRunIndex >= 0
      && outboxIndex > dryRunIndex
      && webhookIndex > dryRunIndex
  ],
  [
    'mail-dispatch blocks paid and cancelled invoice mail',
    /function invoiceMailStateError/.test(mailDispatch)
      && /Bezahlte Rechnungen dürfen nicht als Zahlungsaufforderung versendet werden/.test(mailDispatch)
      && /Stornierte Rechnungen dürfen nicht versendet werden/.test(mailDispatch)
  ],
  [
    'reminders are limited to open, overdue or sent invoices',
    /Mahnungen dürfen nur für offene oder überfällige Rechnungen versendet werden/.test(mailDispatch)
  ],
  [
    'recipient email is validated server-side',
    /function isValidEmailAddress/.test(mailDispatch)
      && (mailDispatch.match(/Ungültige Empfänger-E-Mail/g) || []).length >= 2
  ],
  [
    'invoice send creates a server preview before manual confirmation',
    invoiceSend.indexOf("dry_run:true") >= 0
      && invoiceSend.indexOf("dry_run:true") < invoiceSend.indexOf('voxConfirm({')
      && /Geprüfte Versandvorschau/.test(invoiceSend)
      && /Zahlungslink/.test(invoiceSend)
  ],
  [
    'invoice send reuses the reviewed payload for the real dispatch',
    /callAdminFunction\('mail-dispatch',payload\)/.test(invoiceSend)
  ],
  [
    'reminder preview and dispatch use the canonical mail endpoint without a separate state write',
    reminderSend.indexOf('dry_run:true') >= 0
      && (reminderSend.match(/callAdminFunction\('mail-dispatch'/g) || []).length >= 2
      && !/record_invoice_reminder/.test(reminderSend)
  ],
  [
    'scheduled runner never calls Make or auto-sends invoice/reminder mail',
    !/MAKE_MAIL_WEBHOOK/.test(billingRunner.replace('therefore never calls MAKE_MAIL_WEBHOOK.', ''))
      && !/AUTO_SEND_DRAFTS/.test(billingRunner)
      && !/triggerInvoiceMails/.test(billingRunner)
      && !/source:\s*['"]auto_dunning['"]/.test(billingRunner)
  ],
  [
    'dunning sweep is read-only detection for manual reminders',
    /manual_reminder_required/.test(dunningSweep)
      && /reminder1_due/.test(dunningSweep)
      && /reminder2_due/.test(dunningSweep)
      && !/\.update\(/.test(dunningSweep)
      && !/fetch\(/.test(dunningSweep)
  ],
  [
    'contract expiry records a required notification instead of sending it',
    /notification_required:\s*notificationRequired/.test(billingRunner)
      && !/contract_expired_email/.test(billingRunner)
  ],
  [
    'billing runner remains registered as a Netlify scheduled function',
    /\[functions\."daily-billing-runner"\][\s\S]*?schedule\s*=\s*"0 6 \* \* \*"/.test(netlifyConfig)
  ],
  [
    'modified JavaScript parses successfully',
    syntaxValid(mailDispatch)
      && syntaxValid(billingRunner)
      && inlineScriptsValid(adminIndex)
  ]
];

let failed = 0;
for (const [name, passed] of checks) {
  if (passed) {
    console.log(`✓ ${name}`);
  } else {
    failed += 1;
    console.error(`✗ ${name}`);
  }
}

if (failed > 0) {
  console.error(`\nBilling mail control verification failed: ${failed} check(s).`);
  process.exit(1);
}

console.log(`\nBilling mail control verification passed: ${checks.length} checks.`);
