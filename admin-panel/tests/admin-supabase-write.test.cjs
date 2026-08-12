'use strict';

/**
 * Regression coverage for shared/core/admin-supabase-write.js (adminSbWrite).
 *
 * Two checks, found on the same day for two different reasons:
 *   1. {error} must be read and thrown -- Supabase resolves a failed write
 *      with {error} instead of rejecting.
 *   2. a query returning an empty array after .select() must also throw --
 *      RLS can filter a row out of an update()/delete() without producing
 *      an error at all (Codex-Fund auf #971, siehe Kommentar in der Datei).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Das Modul haengt sich an globalThis und braucht beim Laden kein document.
require(path.join(__dirname, '..', 'shared', 'core', 'admin-supabase-write.js'));
const adminSbWrite = globalThis.adminSbWrite;

test('adminSbWrite: throws on {error}, does not return data', async () => {
  await assert.rejects(
    adminSbWrite(Promise.resolve({ data: null, error: { message: 'permission denied' } })),
    /permission denied/
  );
});

test('adminSbWrite: resolves with data on success (no .select(), data is null)', async () => {
  const result = await adminSbWrite(Promise.resolve({ data: null, error: null }));
  assert.equal(result, null);
});

test('adminSbWrite: an empty array after .select() throws (RLS filtered the row, error was null)', async () => {
  await assert.rejects(
    adminSbWrite(Promise.resolve({ data: [], error: null })),
    /Kein Datensatz betroffen/
  );
});

test('adminSbWrite: a non-empty array after .select() resolves normally', async () => {
  const result = await adminSbWrite(Promise.resolve({ data: [{ id: 'x' }], error: null }));
  assert.deepEqual(result, [{ id: 'x' }]);
});

test('adminSbWrite: { allowEmpty: true } opts out of the empty-array check', async () => {
  const result = await adminSbWrite(Promise.resolve({ data: [], error: null }), { allowEmpty: true });
  assert.deepEqual(result, []);
});
