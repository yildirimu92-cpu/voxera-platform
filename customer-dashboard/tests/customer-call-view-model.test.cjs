'use strict';

const assert = require('node:assert/strict');
const model = require('../shared/customer-call-view-model.js');

assert.equal(model.lifecycle({ live_status: 'in_progress' }), 'live');
assert.equal(model.lifecycle({ live_status: 'completed', elevenlabs_conversation_id: 'conv_1' }), 'analysing');
assert.equal(model.lifecycle({ live_status: 'completed', elevenlabs_conversation_id: 'conv_1', call_summary: 'Fertig' }), 'new');
assert.equal(model.lifecycle({ dashboard_status: 'open', call_summary: 'Fertig' }), 'working');
assert.equal(model.lifecycle({ dashboard_status: 'planned', follow_up_at: '2026-08-06T08:00:00Z' }), 'planned');
assert.equal(model.lifecycle({ dashboard_status: 'done' }), 'done');
assert.equal(model.lifecycle({ dashboard_status: 'archived' }), 'archived');

assert.equal(model.category({ category: 'inbound' }), null);
assert.equal(model.category({ category: 'appointment' }), 'Terminanfrage');
assert.equal(model.leadQuality({ category: 'inbound', lead_quality: 'cold' }), null);
assert.equal(model.leadQuality({ category: 'appointment', lead_quality: 'warm' }), 'Warm');
assert.equal(model.outcome({ callback_requested: true }), 'Rückruf empfohlen');

const built = model.build({
  id: 'call_1',
  caller_phone: '+41763103313',
  category: 'appointment',
  lead_quality: 'warm',
  dashboard_status: 'new',
  call_summary_short: 'Termin gewünscht'
});
assert.deepEqual(
  {
    lifecycle: built.lifecycle,
    name: built.name,
    phone: built.phone,
    category: built.category,
    leadQuality: built.leadQuality,
    summary: built.summary
  },
  {
    lifecycle: 'new',
    name: 'Unbekannter Anrufer',
    phone: '+41763103313',
    category: 'Terminanfrage',
    leadQuality: 'Warm',
    summary: 'Termin gewünscht'
  }
);

const zurich = model.formatZurichDateTime('2026-08-05T09:00:00Z');
assert.match(zurich, /11:00/);

console.log('customer-call-view-model: ok');
