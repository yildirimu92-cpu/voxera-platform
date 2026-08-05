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
assert.equal(model.lifecycle({ dashboard_status: 'closed' }), 'done');
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

// Legacy rows store an offsetless Europe/Zurich wall-clock start. Its qualified
// instant agrees with the UTC creation time and must stay at 09:44 local.
const localSummerStart = model.timestamp({
  fields: {
    started_at: '2026-08-05 09:44:00',
    created_at: '2026-08-05T07:44:10Z'
  }
});
assert.match(localSummerStart, /\+02:00$/);
assert.match(model.formatZurichDateTime(localSummerStart), /09:44/);

const localWinterStart = model.timestamp({
  fields: {
    started_at: '2026-01-05 09:44:00',
    created_at: '2026-01-05T08:44:10Z'
  }
});
assert.match(localWinterStart, /\+01:00$/);
assert.match(model.formatZurichDateTime(localWinterStart), /09:44/);

// New provider snapshots can expose the UTC wall-clock without a trailing Z.
// When interpreting it as Zurich time would conflict with the UTC row creation,
// created_at is canonical and 12:07 UTC must display as 14:07 in Zurich.
const providerUtcWithoutOffset = model.timestamp({
  fields: {
    started_at: '2026-08-05 12:07:00',
    created_at: '2026-08-05T12:07:05Z'
  }
});
assert.equal(providerUtcWithoutOffset, '2026-08-05T12:07:05Z');
assert.match(model.formatZurichDateTime(providerUtcWithoutOffset), /14:07/);

// Legacy Today wrappers can contain shifted top-level timestamps. Persisted
// nested call fields remain the source of truth for both old and new rows.
const wrappedLegacyCall = model.timestamp({
  started_at: '2026-08-05 09:44:00',
  created_at: '2026-08-05T09:44:00Z',
  fields: {
    started_at: '2026-08-05 09:44:00',
    created_at: '2026-08-05T07:44:05Z'
  }
});
assert.match(model.formatZurichDateTime(wrappedLegacyCall), /09:44/);

const wrappedProviderCall = model.timestamp({
  started_at: '2026-08-05 12:07:00',
  created_at: '2026-08-05T10:07:00Z',
  fields: {
    started_at: '2026-08-05 12:07:00',
    created_at: '2026-08-05T12:07:04Z'
  }
});
assert.equal(wrappedProviderCall, '2026-08-05T12:07:04Z');
assert.match(model.formatZurichDateTime(wrappedProviderCall), /14:07/);

// Today/detail can receive a flattened wrapper without nested fields. Resolve
// the persisted Anfragen row by stable ID before choosing the timestamp.
globalThis.allRecords = [{
  id: 'call_current',
  fields: {
    id: 'call_current',
    call_id: 'CA_CURRENT',
    started_at: '2026-08-05 12:07:00',
    created_at: '2026-08-05T12:07:04Z'
  }
}];
const flattenedTodayWrapper = {
  id: 'call_current',
  call_id: 'CA_CURRENT',
  started_at: '2026-08-05 12:07:00',
  created_at: '2026-08-05T10:07:00Z'
};
const resolvedWrapperTimestamp = model.timestamp(flattenedTodayWrapper);
assert.equal(resolvedWrapperTimestamp, '2026-08-05T12:07:04Z');
assert.match(model.formatZurichDateTime(resolvedWrapperTimestamp), /14:07/);
delete globalThis.allRecords;

const explicitStartStillWins = model.timestamp({
  fields: {
    started_at: '2026-08-05T12:07:00Z',
    created_at: '2026-08-05T12:08:00Z'
  }
});
assert.equal(explicitStartStillWins, '2026-08-05T12:07:00Z');
assert.match(model.formatZurichDateTime(explicitStartStillWins), /14:07/);

const zurich = model.formatZurichDateTime('2026-08-05T09:00:00Z');
assert.match(zurich, /11:00/);

console.log('customer-call-view-model: ok');
