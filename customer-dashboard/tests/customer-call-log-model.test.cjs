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
const information = {
  id: 'call-information',
  fields: {
    live_status: 'completed',
    call_summary: 'Unterlagen gewünscht',
    next_action: 'Unterlagen per E-Mail senden',
    dashboard_status: 'working',
    created_at: '2026-08-05T08:45:00Z'
  }
};
const genericWorking = {
  id: 'call-generic-working',
  fields: {
    live_status: 'completed',
    call_summary: 'Kein konkreter nächster Schritt',
    next_action: 'Bearbeitung erforderlich',
    dashboard_status: 'working',
    created_at: '2026-08-05T08:40:00Z'
  }
};
const negativeAction = {
  id: 'call-negative-action',
  fields: {
    live_status: 'completed',
    call_summary: 'Kein Handlungsbedarf',
    next_action: 'Keine Aktion erforderlich',
    dashboard_status: 'new',
    created_at: '2026-08-05T08:35:00Z'
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

const state = log.build([
  duplicateCompleted,
  callback,
  information,
  genericWorking,
  negativeAction,
  live,
  noAction,
  completed
]);
assert.equal(state.active.model.lifecycle, 'live');
assert.equal(state.active.model.name, 'Anna Muster');
assert.equal(state.tasks.length, 2);
assert.deepEqual(state.tasks.map((entry) => entry.record.id), ['call-callback', 'call-information']);
assert.equal(state.history.length, 4);
assert.deepEqual(
  state.history.map((entry) => entry.record.id),
  ['call-generic-working', 'call-negative-action', 'call-no-action', 'call-history']
);
assert.equal(state.counts.total, 7);

// A stale duplicate must not downgrade a completed call back to working.
const completedCanonical = {
  id: 'call-status-conflict',
  fields: {
    live_status: 'completed',
    dashboard_status: 'done',
    call_summary: 'Abgeschlossen',
    started_at: '2026-08-05T07:44:00Z',
    updated_at: '2026-08-05T08:10:00Z'
  }
};
const staleWorkingDuplicate = {
  id: 'call-status-conflict',
  fields: {
    live_status: 'completed',
    dashboard_status: 'working',
    call_summary: 'Abgeschlossen',
    started_at: '2026-08-05T07:44:00Z',
    updated_at: '2026-08-05T08:20:00Z'
  }
};
const conflictState = log.build([completedCanonical, staleWorkingDuplicate]);
assert.equal(conflictState.history.length, 1);
assert.equal(conflictState.history[0].model.lifecycle, 'done');
assert.equal(conflictState.history[0].record.fields.dashboard_status, 'done');

// The same call can arrive through different providers with different primary IDs.
// Any shared identity alias must collapse the snapshots and preserve the terminal state.
const workingByConversation = {
  id: 'row-working',
  fields: {
    conversation_id: 'conv-shared',
    live_status: 'completed',
    dashboard_status: 'working',
    call_summary: 'Testanruf',
    started_at: '2026-08-05 09:44:00',
    updated_at: '2026-08-05T10:00:00Z'
  }
};
const doneBySourceAlias = {
  id: 'row-done',
  fields: {
    source_call_id: 'conv-shared',
    live_status: 'completed',
    dashboard_status: 'closed',
    call_summary: 'Testanruf',
    started_at: '2026-08-05 09:44:00',
    updated_at: '2026-08-05T09:55:00Z'
  }
};
const aliasState = log.build([workingByConversation, doneBySourceAlias]);
assert.equal(aliasState.counts.total, 1);
assert.equal(aliasState.history.length, 1);
assert.equal(aliasState.history[0].model.lifecycle, 'done');
assert.match(aliasState.history[0].model.timestamp, /\+02:00$/);

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
