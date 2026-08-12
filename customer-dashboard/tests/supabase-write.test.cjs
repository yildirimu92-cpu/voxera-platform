'use strict';

/**
 * Regression coverage for shared/customer-runtime-supabase-write.js
 * (vxSbWrite).
 *
 * Two checks, found on the same day for two different reasons:
 *   1. {error} must be read and thrown -- Supabase resolves a failed write
 *      with {error} instead of rejecting (vxSaveProfil-Fund, #971).
 *   2. a query returning an empty array after .select() must also throw --
 *      RLS can filter a row out of an update()/delete() without producing
 *      an error at all (Codex-Fund auf #971, siehe Kommentar in der Datei).
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');

function loadHelper() {
  const filePath = path.join(__dirname, '..', 'shared', 'customer-runtime-supabase-write.js');
  const code = fs.readFileSync(filePath, 'utf8');
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: filePath });
  return sandbox;
}

test('vxSbWrite: throws on {error}, does not return data', async () => {
  const root = loadHelper();
  await assert.rejects(
    root.vxSbWrite(Promise.resolve({ data: null, error: { message: 'permission denied' } })),
    /permission denied/
  );
});

test('vxSbWrite: resolves with data on success (no .select(), data is null)', async () => {
  const root = loadHelper();
  const result = await root.vxSbWrite(Promise.resolve({ data: null, error: null }));
  assert.equal(result, null);
});

test('vxSbWrite: an empty array after .select() throws (RLS filtered the row, error was null)', async () => {
  const root = loadHelper();
  await assert.rejects(
    root.vxSbWrite(Promise.resolve({ data: [], error: null })),
    /Kein Datensatz betroffen/
  );
});

test('vxSbWrite: a non-empty array after .select() resolves normally', async () => {
  const root = loadHelper();
  const result = await root.vxSbWrite(Promise.resolve({ data: [{ id: 'x' }], error: null }));
  assert.deepEqual(result, [{ id: 'x' }]);
});

test('vxSbWrite: { allowEmpty: true } opts out of the empty-array check', async () => {
  const root = loadHelper();
  const result = await root.vxSbWrite(Promise.resolve({ data: [], error: null }), { allowEmpty: true });
  assert.deepEqual(result, []);
});
