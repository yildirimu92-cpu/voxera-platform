'use strict';

/**
 * Regression coverage for shared/customer-runtime-inline-save-status.js.
 *
 * This is the mechanism the four save flows (Assistentenname,
 * Geschäftsprofil, Aktuelle Infos, Kalendereinstellungen) were switched to,
 * replacing a full-section re-render + intrusive loading banner + forced
 * scrollIntoView with a button-label swap (Speichert … -> Gespeichert ✓ ->
 * original label). These tests exercise the helper directly against a
 * minimal fake button, without needing the full dashboard DOM.
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');

function loadHelper() {
  const filePath = path.join(__dirname, '..', 'shared', 'customer-runtime-inline-save-status.js');
  const code = fs.readFileSync(filePath, 'utf8');
  const timers = [];
  const sandbox = {
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    console
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: filePath });
  return { root: sandbox, timers };
}

function fakeButton(label) {
  return {
    textContent: label,
    disabled: false,
    _attrs: new Map(),
    setAttribute(name, value) { this._attrs.set(name, value); },
    removeAttribute(name) { this._attrs.delete(name); }
  };
}

// Runs all pending fake timers immediately, in FIFO order, including any
// newly queued while running earlier ones (mirrors real setTimeout draining).
function flushTimers(timers) {
  while (timers.length) {
    const next = timers.shift();
    next.fn();
  }
}

test('vxInlineSaveStatus: success swaps label, then restores after hold, without touching any other node', async () => {
  const { root, timers } = loadHelper();
  const button = fakeButton('Name speichern');
  let ranDuringSavingLabel = null;

  const promise = root.vxInlineSaveStatus(button, async () => {
    // The request must fire while the button still reads the saving label —
    // i.e. no section re-render has swapped it out from under us.
    ranDuringSavingLabel = button.textContent;
    return { ok: true };
  }, { savingLabel: 'Speichert …', doneLabel: 'Gespeichert ✓', holdMs: 50 });

  assert.equal(button.textContent, 'Speichert …');
  assert.equal(button.disabled, true);

  // Let the microtask queue drain so the async run() and the post-success
  // "doneLabel" assignment happen, then flush the hold-timer.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(ranDuringSavingLabel, 'Speichert …');
  assert.equal(button.textContent, 'Gespeichert ✓');
  assert.equal(button.disabled, true, 'still disabled while the confirmation is showing');

  flushTimers(timers);
  const result = await promise;

  assert.deepEqual(result, { ok: true });
  assert.equal(button.textContent, 'Name speichern', 'label reverts to whatever the button said before the save');
  assert.equal(button.disabled, false);
  assert.equal(button._attrs.has('aria-disabled'), false);
});

test('vxInlineSaveStatus: failure restores the button immediately and rethrows', async () => {
  const { root } = loadHelper();
  const button = fakeButton('Einstellungen speichern');

  await assert.rejects(
    root.vxInlineSaveStatus(button, async () => { throw new Error('Netzwerkfehler'); }, { savingLabel: 'Speichert …' }),
    /Netzwerkfehler/
  );

  assert.equal(button.textContent, 'Einstellungen speichern');
  assert.equal(button.disabled, false);
});

test('vxInlineSaveStatus: works with button = null (no element to animate)', async () => {
  const { root } = loadHelper();
  const result = await root.vxInlineSaveStatus(null, async () => 'done', { savingLabel: 'x' });
  assert.equal(result, 'done');
});

test('vxInlineSaveStatus: never calls scrollIntoView (helper has no scroll dependency at all)', () => {
  const filePath = path.join(__dirname, '..', 'shared', 'customer-runtime-inline-save-status.js');
  const code = fs.readFileSync(filePath, 'utf8');
  assert.ok(!/scrollIntoView/.test(code), 'inline save helper must not reintroduce forced scrolling');
});

test('customer-runtime-assistant-profile.js: setStatus no longer force-scrolls', () => {
  const filePath = path.join(__dirname, '..', 'shared', 'customer-runtime-assistant-profile.js');
  const code = fs.readFileSync(filePath, 'utf8');
  assert.ok(!/scrollIntoView/.test(code), 'the explicit scrollIntoView call reported by the user must be removed');
  assert.ok(/vxInlineSaveStatus/.test(code), 'save flow must route through the shared inline-save helper');
});

test('customer-runtime-calendar-settings.js and customer-runtime-operational-updates.js route saves through the shared helper', () => {
  for (const name of ['customer-runtime-calendar-settings.js', 'customer-runtime-operational-updates.js']) {
    const code = fs.readFileSync(path.join(__dirname, '..', 'shared', name), 'utf8');
    assert.ok(/vxInlineSaveStatus/.test(code), name + ' must use the shared inline-save helper');
    assert.ok(!/scrollIntoView/.test(code), name + ' must not force-scroll');
  }
});
