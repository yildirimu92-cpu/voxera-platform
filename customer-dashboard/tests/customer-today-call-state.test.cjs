'use strict';

const assert = require('node:assert/strict');
const viewModel = require('../shared/customer-call-view-model.js');
const base = require('../shared/customer-today-call-state.js');
const today = base.withViewModel(viewModel);

const live = {
  id: 'call-live',
  live_status: 'in_progress',
  caller_name: 'Anna Muster',
  started_at: '2026-08-05T09:15:00Z'
};
const completedSameIdOld = {
  id: 'call-2',
  live_status: 'completed',
  call_summary: 'Alt',
  created_at: '2026-08-05T08:00:00Z'
};
const completedSameIdNew = {
  id: 'call-2',
  live_status: 'completed',
  call_summary: 'Neueste Fassung',
  created_at: '2026-08-05T08:10:00Z'
};

const attention = today.buildAttentionState([completedSameIdOld, live, completedSameIdNew], 'Lara');
assert.equal(attention.kind, 'live');
assert.equal(attention.badge, 'LIVE');
assert.equal(attention.title, 'Anna Muster');
assert.equal(attention.message, 'Lara spricht gerade mit dem Anrufer.');
assert.notMatch(attention.message, /Alles erledigt/);

const unique = today.uniqueCalls([completedSameIdOld, completedSameIdNew]);
assert.equal(unique.length, 1);
assert.equal(unique[0].call_summary, 'Neueste Fassung');

const timeline = today.buildTimeline([live, completedSameIdNew], live);
assert.equal(timeline.length, 1);
assert.equal(timeline[0].id, 'call-2');

const analysing = today.buildAttentionState([{
  id: 'call-analysis',
  live_status: 'completed',
  elevenlabs_conversation_id: 'conv-1',
  created_at: '2026-08-05T09:20:00Z'
}], 'Lara');
assert.equal(analysing.kind, 'analysing');
assert.equal(analysing.badge, 'Wird ausgewertet');

const empty = today.buildAttentionState([], 'Lara');
assert.equal(empty.kind, 'empty');
assert.equal(empty.title, 'Alles erledigt');
assert.equal(empty.message, 'Lara nimmt neue Anrufe entgegen.');

console.log('customer-today-call-state: ok');
