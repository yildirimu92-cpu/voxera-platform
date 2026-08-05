'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const model = require('../shared/customer-call-view-model.js');

const modelPath = path.join(__dirname, '../shared/customer-call-view-model.js');

test('contract remains DOM-, timer- and storage-independent', () => {
  const source = fs.readFileSync(modelPath, 'utf8');
  for (const forbidden of [
    'document.',
    'root.allRecords',
    'localStorage',
    'sessionStorage',
    'setTimeout(',
    'setInterval(',
    'MutationObserver',
    'requestAnimationFrame('
  ]) {
    assert.equal(source.includes(forbidden), false, `forbidden runtime dependency: ${forbidden}`);
  }
});

test('uses field-specific persisted-row precedence for wrapped dashboard records', () => {
  const record = {
    id: 'wrapper-id',
    caller_name: 'Stale top-level name',
    callback_requested: true,
    created_at: '2026-08-05T12:00:00Z',
    fields: {
      id: 'db-row-id',
      caller_name: 'Persisted caller',
      caller_phone: '+41790000000',
      call_summary_short: 'Persisted summary',
      dashboard_status: 'done',
      follow_up_at: '2026-08-06T08:00:00Z',
      callback_requested: false,
      next_action: 'Kein Handlungsbedarf',
      created_at: '2026-08-05T09:00:00',
      direction: 'inbound'
    }
  };

  const built = model.build(record);
  assert.equal(built.id, 'db-row-id');
  assert.equal(built.name, 'Persisted caller');
  assert.equal(built.phone, '+41790000000');
  assert.equal(built.summary, 'Persisted summary');
  assert.equal(built.lifecycle, 'done');
  assert.equal(built.outcome, null);
  assert.equal(built.timestamp, '2026-08-05T09:00:00Z');
  assert.equal(built.direction, 'inbound');
});

test('supports the flat merged ingest row as a fallback shape', () => {
  const built = model.build({
    id: 'call-row-1',
    external_call_id: 'CA123',
    conversation_provider_id: 'conv_123',
    caller_name: 'Flat caller',
    caller_phone: '+41791111111',
    call_summary_short: 'Termin gewünscht',
    dashboard_status: 'new',
    live_status: 'completed',
    created_at: '2026-08-05T09:00:00Z',
    direction: 'inbound'
  });

  assert.equal(built.id, 'call-row-1');
  assert.equal(built.name, 'Flat caller');
  assert.equal(built.lifecycle, 'new');
  assert.equal(built.timestamp, '2026-08-05T09:00:00Z');
});

test('identity keys are typed and retain proven provider namespaces', () => {
  assert.deepEqual(model.identityKeys({
    id: 'row-1',
    external_call_id: 'CA123',
    conversation_provider_id: 'conv-1',
    call_id: 'legacy-1'
  }), [
    { type: 'record_id', value: 'row-1' },
    { type: 'external_call_id', value: 'CA123' },
    { type: 'conversation_provider_id', value: 'conv-1' },
    { type: 'call_id', value: 'legacy-1' }
  ]);

  assert.deepEqual(model.identityKeys({ elevenlabs_conversation_id: 'legacy-conv' }), [
    { type: 'conversation_provider_id', value: 'legacy-conv' }
  ]);

  assert.deepEqual(model.identityKeys({ provider_call_id: 'unproven-alias' }), []);
});

test('same raw value in different identity namespaces does not dedupe', () => {
  const records = [
    { external_call_id: 'same-value', created_at: '2026-08-05T09:00:00Z' },
    { conversation_provider_id: 'same-value', created_at: '2026-08-05T09:01:00Z' }
  ];
  assert.equal(model.dedupe(records).length, 2);
});

test('matching typed identities dedupe and legacy conversation alias maps to canonical provider type', () => {
  const byExternalId = model.dedupe([
    { external_call_id: 'CA123', updated_at: '2026-08-05T09:00:00Z', caller_name: 'Old' },
    { external_call_id: 'CA123', updated_at: '2026-08-05T09:05:00Z', caller_name: 'Fresh' }
  ]);
  assert.equal(byExternalId.length, 1);
  assert.equal(byExternalId[0].caller_name, 'Fresh');

  const byConversationId = model.dedupe([
    { conversation_provider_id: 'conv-1', updated_at: '2026-08-05T09:00:00Z' },
    { elevenlabs_conversation_id: 'conv-1', updated_at: '2026-08-05T09:01:00Z' }
  ]);
  assert.equal(byConversationId.length, 1);
});

test('terminal workflow state cannot be downgraded by analysis, follow-up data or a fresher stale duplicate', () => {
  assert.equal(model.lifecycle({
    dashboard_status: 'done',
    follow_up_at: '2026-08-06T08:00:00Z'
  }), 'done');

  assert.equal(model.lifecycle({
    live_status: 'completed',
    conversation_provider_id: 'conv-1',
    dashboard_status: 'done',
    call_summary: ''
  }), 'done');

  assert.equal(model.lifecycle({
    live_status: 'completed',
    conversation_provider_id: 'conv-1',
    dashboard_status: 'archived',
    call_summary: ''
  }), 'archived');

  const selected = model.dedupe([
    {
      id: 'row-1',
      dashboard_status: 'done',
      call_summary: 'Fertig',
      updated_at: '2026-08-05T09:00:00Z'
    },
    {
      id: 'row-1',
      dashboard_status: 'open',
      updated_at: '2026-08-05T10:00:00Z'
    }
  ]);
  assert.equal(selected.length, 1);
  assert.equal(model.lifecycle(selected[0]), 'done');
});

test('lifecycle prioritizes active telephony, then terminal workflow, then analysis and open workflow states', () => {
  assert.equal(model.lifecycle({ live_status: 'started', dashboard_status: 'done' }), 'live');
  assert.equal(model.lifecycle({ live_status: 'in_progress' }), 'live');
  assert.equal(model.lifecycle({
    live_status: 'completed',
    conversation_provider_id: 'conv-1'
  }), 'analysing');
  assert.equal(model.lifecycle({
    live_status: 'completed',
    conversation_provider_id: 'conv-1',
    call_summary: 'Fertig',
    dashboard_status: 'new'
  }), 'new');
  assert.equal(model.lifecycle({ dashboard_status: 'open', read_at: '2026-08-05T10:00:00Z' }), 'working');
  assert.equal(model.lifecycle({ dashboard_status: 'planned' }), 'planned');
  assert.equal(model.lifecycle({ dashboard_status: 'archived' }), 'archived');
});

test('read and unread derive only from persisted read_at and lifecycle eligibility', () => {
  const finishedNew = model.build({
    live_status: 'completed',
    dashboard_status: 'new',
    call_summary: 'Fertig'
  });
  assert.equal(finishedNew.readAt, null);
  assert.equal(finishedNew.unreadEligible, true);
  assert.equal(finishedNew.isUnread, true);

  const finishedRead = model.build({
    live_status: 'completed',
    dashboard_status: 'new',
    call_summary: 'Fertig',
    read_at: '2026-08-05T10:00:00Z'
  });
  assert.equal(finishedRead.readAt, '2026-08-05T10:00:00Z');
  assert.equal(finishedRead.unreadEligible, true);
  assert.equal(finishedRead.isUnread, false);

  const wrappedPersistedUnread = model.build({
    read_at: '2026-08-05T08:00:00Z',
    fields: {
      live_status: 'completed',
      dashboard_status: 'new',
      call_summary: 'Fertig',
      read_at: null
    }
  });
  assert.equal(wrappedPersistedUnread.readAt, null);
  assert.equal(wrappedPersistedUnread.unreadEligible, true);
  assert.equal(wrappedPersistedUnread.isUnread, true);

  const live = model.build({ live_status: 'started' });
  assert.equal(live.readAt, null);
  assert.equal(live.unreadEligible, false);
  assert.equal(live.isUnread, false);

  const analysing = model.build({
    live_status: 'completed',
    conversation_provider_id: 'conv-1'
  });
  assert.equal(analysing.readAt, null);
  assert.equal(analysing.unreadEligible, false);
  assert.equal(analysing.isUnread, false);

  for (const status of ['done', 'archived']) {
    const terminalUnread = model.build({ dashboard_status: status });
    assert.equal(terminalUnread.unreadEligible, true);
    assert.equal(terminalUnread.isUnread, true);

    const terminalRead = model.build({
      dashboard_status: status,
      read_at: '2026-08-05T11:00:00Z'
    });
    assert.equal(terminalRead.readAt, '2026-08-05T11:00:00Z');
    assert.equal(terminalRead.unreadEligible, true);
    assert.equal(terminalRead.isUnread, false);
  }
});

test('category, lead quality and outcome remain semantic rather than raw provider labels', () => {
  assert.equal(model.category({ category: 'inbound' }), null);
  assert.equal(model.category({ category: 'appointment' }), 'Terminanfrage');
  assert.equal(model.leadQuality({ category: 'inbound', lead_quality: 'cold' }), null);
  assert.equal(model.leadQuality({ category: 'appointment', lead_quality: 'warm' }), 'Warm');
  assert.equal(model.outcome({ callback_requested: true }), 'Rückruf empfohlen');
  assert.equal(model.outcome({ next_action: 'Bitte Unterlagen per E-Mail senden' }), 'Information senden');
  assert.equal(model.outcome({ next_action: 'Kein nächster Schritt erforderlich' }), null);
});

test('database timestamp rule qualifies only known offsetless DB fields as UTC', () => {
  assert.equal(model.timestamp({
    fields: {
      created_at: '2026-08-05 09:00:00.123',
      updated_at: '2026-08-05T10:00:00Z'
    }
  }), '2026-08-05T09:00:00.123Z');

  assert.equal(model.timestamp({ updated_at: '2026-08-05T10:00:00' }), '2026-08-05T10:00:00Z');
  assert.equal(model.formatZurichDateTime('2026-08-05T09:00:00'), '');
  assert.match(model.formatZurichDateTime('2026-08-05T09:00:00Z'), /11:00/);
  assert.equal(model.formatZurichDateTime('not-a-date'), '');
});

test('normalization does not mutate source records', () => {
  const record = {
    id: 'wrapper-id',
    fields: {
      id: 'db-id',
      dashboard_status: 'new',
      created_at: '2026-08-05T09:00:00'
    }
  };
  const before = JSON.parse(JSON.stringify(record));
  model.build(record);
  model.dedupe([record]);
  assert.deepEqual(record, before);
});
