'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const resolverPath = path.resolve(__dirname, '../netlify/functions/call-intake-resolve-customer.js');
const source = fs.readFileSync(resolverPath, 'utf8');

test('resolver requires a dedicated shared secret', () => {
  assert.match(source, /CALL_INTAKE_RESOLVER_SECRET/);
  assert.match(source, /timingSafeEqual/);
});

test('resolver returns all Make routing fields', () => {
  for (const field of [
    'customer_id',
    'customer_name',
    'contact_name',
    'customer_email',
    'notification_active',
    'notification_mode',
    'new_log_email_active',
    'missed_call_email_active'
  ]) {
    assert.match(source, new RegExp(`\\b${field}\\b`));
  }
});

test('resolver normalizes before comparing customer numbers', () => {
  assert.match(source, /normalizePhoneE164\(rawNumber\)/);
  assert.match(source, /normalizePhoneE164\(row\.voxera_number\)/);
});
