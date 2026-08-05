'use strict';

const assert = require('node:assert/strict');
const model = require('../shared/customer-call-view-model.js');

assert.equal(model.lifecycle({ live_status: 'in_progress' }), 'live');
assert.equal(model.lifecycle({ fields: { live_status: 'incoming' } }), 'live');
assert.equal(model.lifecycle({ fields: { live_status: 'analyzing' } }), 'analysing');
assert.equal(model.lifecycle({ live_status: 'completed', elevenlabs_conversation_id: 'conv_1' }), 'analysing');
assert.equal(model.lifecycle({ live_status: 'completed', elevenlabs_conversation_id: 'conv_1', call_summary: 'Fertig' }), 'new');
assert.equal(model.lifecycle({ dashboard_status: 'open', call_summary: 'Fertig' }), 'new');
assert.equal(model.lifecycle({ dashboard_status: 'Offen', read_at: '2026-08-05T10:00:00Z' }), 'working');
assert.equal(model.lifecycle({ dashboard_status: 'Geplant' }), 'planned');
assert.equal(model.lifecycle({ dashboard_status: 'Abgeschlossen' }), 'done');
assert.equal(model.lifecycle({ dashboard_status: 'Archiviert' }), 'archived');

// Nested canonical state wins over stale top-level wrapper values.
assert.equal(model.lifecycle({
  dashboard_status: 'Offen',
  read_at: '2026-08-05T10:00:00Z',
  fields: { dashboard_status: 'Erledigt' }
}), 'done');
assert.equal(model.lifecycle({
  dashboard_status: 'In Bearbeitung',
  fields: { dashboard_status: 'Archiviert' }
}), 'archived');
assert.equal(model.lifecycle({
  fields: {
    dashboard_status: 'Erledigt',
    follow_up_at: '2026-08-10T10:00:00Z'
  }
}), 'done');
assert.equal(model.lifecycle({
  status: 'in_progress',
  fields: {
    live_status: 'completed',
    dashboard_status: 'Erledigt',
    call_summary: 'Fertig'
  }
}), 'done');

assert.equal(model.category({ category: 'inbound' }), null);
assert.equal(model.category({ fields: { category: 'inbound' } }), null);
assert.equal(model.category({ category: 'appointment' }), 'Terminanfrage');
assert.equal(model.leadQuality({ category: 'inbound', lead_quality: 'cold' }), null);
assert.equal(model.leadQuality({ category: 'appointment', lead_quality: 'warm' }), 'Warm');
assert.equal(model.outcome({ callback_requested: true }), 'Rückruf empfohlen');
assert.equal(model.outcome({ fields: { callback_requested: true } }), 'Rückruf empfohlen');
assert.equal(model.outcome({ next_action: 'Zurückrufen' }), 'Rückruf empfohlen');
assert.equal(model.outcome({ fields: { next_action: 'Information senden' } }), 'Information senden');
assert.equal(model.outcome({ fields: { next_action: 'Unterlagen per E-Mail senden' } }), 'Information senden');
assert.equal(model.outcome({ fields: { next_action: 'Keine Aktion erforderlich' } }), null);
assert.equal(model.outcome({ fields: { next_action: 'Bearbeitung erforderlich' } }), null);

const built = model.build({
  id: 'call_1',
  fields: {
    caller_phone: '+41763103313',
    category: 'appointment',
    lead_quality: 'warm',
    dashboard_status: 'new',
    call_summary_short: 'Termin gewünscht'
  }
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

const canonicalTimestamp = model.timestamp({
  fields: {
    started_at: '2026-08-05T07:44:00Z',
    created_at: '2026-08-05T09:44:00Z'
  }
});
assert.equal(canonicalTimestamp, '2026-08-05T07:44:00Z');
assert.match(model.formatZurichDateTime(canonicalTimestamp), /09:44/);

const zurich = model.formatZurichDateTime('2026-08-05T09:00:00Z');
assert.match(zurich, /11:00/);

console.log('customer-call-view-model: ok');
