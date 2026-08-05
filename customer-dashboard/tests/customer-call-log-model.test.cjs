'use strict';

const assert = require('node:assert/strict');
const viewModel = require('../shared/customer-call-view-model.js');
const base = require('../shared/customer-call-log-model.js');
const log = base.withViewModel(viewModel);

const live = {
  elevenlabs_conversation_id: 'conv-live',
  fields: {
    live_status: 'incoming',
    caller_name: 'Anna Muster',
    started_at: '2026-08-05T09:20:00Z'
  }
};
const duplicateCompleted = {
  elevenlabs_conversation_id: 'conv-live',
  fields: {
    live_status: 'completed',
    call_summary: 'Veraltet',
    created_at: '2026-08-05T09:10:00Z'
  }
};
const callback = {
  id: 'call-callback',
  fields: {
    live_status: 'completed',
    call_summary: 'Rückruf gewünscht',
    callback_requested: true,
    dashboard_status: 'new',
    created_at: '2026-08-05T09:00:00Z'
  }
};
const noAction = {
  id: 'call-no-action',
  fields: {
    live_status: 'completed',
    call_summary: 'Kein Handlungsbedarf',
    dashboard_status: 'new',
    created_at: '2026-08-05T08:30:00Z'
  }
};
const completed = {
  id: 'call-history',
  fields: {
    live_status: 'completed',
    call_summary: 'Abgeschlossen',
    dashboard_status: 'done',
    created_at: '2026-08-05T08:00:00Z'
  }
};

const state = log.build([duplicateCompleted, callback, live, noAction, completed]);
assert.equal(state.active.model.lifecycle, 'live');
assert.equal(state.active.model.name, 'Anna Muster');
assert.equal(state.tasks.length, 1);
assert.equal(state.tasks[0].record.id, 'call-callback');
assert.equal(state.history.length, 2);
assert.deepEqual(state.history.map((entry) => entry.record.id), ['call-no-action', 'call-history']);
assert.equal(state.counts.total, 4);

const store = log.createStableStore({ liveGraceMs: 12000 });
const first = store.update([live], 1000);
assert.equal(first.changed, true);
assert.equal(first.state.active.model.lifecycle, 'live');

const emptyPoll = store.update([], 5000);
assert.equal(emptyPoll.changed, false);
assert.equal(emptyPoll.state.active.model.lifecycle, 'live');

const analysing = {
  elevenlabs_conversation_id: 'conv-live',
  fields: {
    live_status: 'analyzing',
    caller_name: 'Anna Muster',
    updated_at: '2026-08-05T09:21:00Z'
  }
};
const analysingUpdate = store.update([analysing], 6000);
assert.equal(analysingUpdate.changed, true);
assert.equal(analysingUpdate.state.active, null);
assert.equal(analysingUpdate.state.analysing.model.lifecycle, 'analysing');

const ready = {
  elevenlabs_conversation_id: 'conv-live',
  fields: {
    live_status: 'completed',
    caller_name: 'Anna Muster',
    call_summary: 'Fertige Zusammenfassung',
    updated_at: '2026-08-05T09:22:00Z'
  }
};
const readyUpdate = store.update([ready], 7000);
assert.equal(readyUpdate.changed, true);
assert.equal(readyUpdate.state.analysing, null);
assert.equal(readyUpdate.state.history[0].model.summary, 'Fertige Zusammenfassung');

const changedSummary = {
  ...ready,
  fields: { ...ready.fields, call_summary: 'Aktualisierte Zusammenfassung' }
};
const summaryUpdate = store.update([changedSummary], 8000);
assert.equal(summaryUpdate.changed, true);
assert.equal(summaryUpdate.state.history[0].model.summary, 'Aktualisierte Zusammenfassung');

console.log('customer-call-log-model: ok');
