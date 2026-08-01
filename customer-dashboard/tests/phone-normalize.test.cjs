'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhoneE164 } = require('../netlify/functions/_lib/phone-normalize');

test('normalizes Swiss national mobile format', () => {
  assert.equal(normalizePhoneE164('079 123 45 67').normalized, '+41791234567');
});

test('normalizes 00 international prefix', () => {
  assert.equal(normalizePhoneE164('0041 44 123 45 67').normalized, '+41441234567');
});

test('keeps valid E.164 numbers', () => {
  assert.equal(normalizePhoneE164('+41 79 123 45 67').normalized, '+41791234567');
});

test('rejects implausibly short numbers', () => {
  assert.equal(normalizePhoneE164('1234').valid, false);
});

test('supports an overridable default country calling code', () => {
  assert.equal(normalizePhoneE164('030 123456', '49').normalized, '+4930123456');
});
