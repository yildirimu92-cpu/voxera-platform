'use strict';

const assert = require('node:assert/strict');

global.VoxeraCustomerCallViewModel = require('../shared/customer-call-view-model.js');
global.isManualTaskRecord = (record) => Boolean(record && record.kind === 'manual');
global.vxIsUnreadRecord = (record) => !((record.fields || {}).read_at);

const owner = require('../shared/customer-runtime-requests-list-owner.js');

const visible = {
  id: 'call-visible',
  fields: {
    live_status: 'completed',
    dashboard_status: 'new',
    caller_name: 'Anna Muster',
    caller_phone: '+41440000000',
    call_summary: 'Möchte einen Beratungstermin vereinbaren.',
    created_at: '2026-08-05T13:00:00Z'
  }
};
const live = {
  id: 'call-live',
  fields: {
    live_status: 'incoming',
    caller_name: 'Live Anrufer',
    created_at: '2026-08-05T13:10:00Z'
  }
};
const analysing = {
  id: 'call-analysis',
  fields: {
    live_status: 'analyzing',
    caller_name: 'Analyse Anrufer',
    updated_at: '2026-08-05T13:12:00Z'
  }
};
const duplicate = {
  id: 'duplicate-row',
  fields: {
    conversation_id: 'shared-conversation',
    live_status: 'completed',
    caller_name: 'Doppelt',
    call_summary: 'Abgeschlossen',
    created_at: '2026-08-05T12:00:00Z'
  }
};
const duplicateAlias = {
  id: 'other-row',
  fields: {
    source_call_id: 'shared-conversation',
    live_status: 'completed',
    caller_name: 'Doppelt',
    call_summary: 'Abgeschlossen',
    created_at: '2026-08-05T12:00:00Z'
  }
};
const manual = {
  id: 'task-1',
  kind: 'manual',
  fields: {
    title: 'Unterlagen senden',
    note: 'Dokumente per E-Mail zustellen.',
    status: 'new',
    created_at: '2026-08-05T11:00:00Z'
  }
};

const entries = owner.entries([visible, live, analysing, duplicate, duplicateAlias, manual]);
assert.equal(entries.length, 3);
assert.equal(entries.some((entry) => entry.model.id === 'call-live'), false);
assert.equal(entries.some((entry) => entry.model.id === 'call-analysis'), false);
assert.equal(entries.filter((entry) => entry.model.name === 'Doppelt').length, 1);

assert.deepEqual(owner.canonicalCounts([visible, live, analysing, duplicate, duplicateAlias, manual]), {
  new: 3,
  planned: 0,
  done: 0,
  archived: 0,
  unreadNew: 2,
  total: 3,
  all: 3
});

const visibleModel = owner.buildModel(visible);
assert.equal(visibleModel.name, 'Anna Muster');
assert.equal(visibleModel.phone, '+41440000000');
assert.equal(visibleModel.lifecycle, 'new');

const callMarkup = owner.rowMarkup({ record: visible, model: visibleModel });
assert.match(callMarkup, /data-vx-call-id="call-visible"/);
assert.match(callMarkup, /Möchte einen Beratungstermin/);
assert.doesNotMatch(callMarkup, /<button/i);
assert.doesNotMatch(callMarkup, /data-action=/i);

const manualModel = owner.buildModel(manual);
const manualMarkup = owner.rowMarkup({ record: manual, model: manualModel });
assert.match(manualMarkup, /ph-clipboard-text/);
assert.doesNotMatch(manualMarkup, /data-vx-call-id=/);

console.log('customer-runtime-requests-list-owner: ok');