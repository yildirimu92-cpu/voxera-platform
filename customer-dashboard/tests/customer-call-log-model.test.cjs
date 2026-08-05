'use strict';

const assert = require('node:assert/strict');
const viewModel = require('../shared/customer-call-view-model.js');
const base = require('../shared/customer-call-log-model.js');
const log = base.withViewModel(viewModel);

const live = {
  elevenlabs_conversation_id: 'conv-live',
  live_status: 'in_progress',
  caller_name: 'Anna Muster',
  started_at: '2026-08-05T09:20:00Z'
};
const duplicateCompleted = {
  elevenlabs_conversation_id: 'conv-live',
  live_status: 'completed',
  call_summary: 'Veraltet',
  created_at: '2026-08-05T09:10:00Z'
};
const callback = {
  id: 'call-callback',
  live_status: 'completed',
  call_summary: 'Rückruf gewünscht',
  callback_requested: true,
  dashboard_status: 'new',
  created_at: '2026-08-05T09:00:00Z'
};
const completed = {
  id: 'call-history',
  live_status: 'completed',
  call_summary: 'Kein Handlungsbedarf',
  dashboard_status: 'done',
  created_at: '2026-08-05T08:00:00Z'
};

const state = log.build([duplicateCompleted, callback, live, completed]);
assert.equal(state.active.model.lifecycle, 'live');
assert.equal(state.active.model.name, 'Anna Muster');
assert.equal(state.tasks.length, 1);
assert.equal(state.tasks[0].record.id, 'call-callback');
assert.equal(state.history.length, 1);
assert.equal(state.history[0].record.id, 'call-history');
assert.equal(state.counts.total, 3);

const store = log.createStableStore({ liveGraceMs: 12000 });
const first = store.update([live], 1000);
assert.equal(first.changed, true);
assert.equal(first.state.active.model.lifecycle, 'live');

const emptyPoll = store.update([], 5000);
assert.equal(emptyPoll.changed, false);
assert.equal(emptyPoll.state.active.model.lifecycle, 'live');

const expired = store.update([], 14000);
assert.equal(expired.changed, true);
assert.equal(expired.state.active, null);

console.log('customer-call-log-model: ok');
