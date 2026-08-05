(function initCustomerTodayCallState(root, factory) {
  'use strict';
  const api = factory(root && root.VoxeraCustomerCallViewModel);
  if (typeof module === 'object' && module.exports) {
    api.withViewModel = factory;
    module.exports = api;
  }
  if (root) root.VoxeraCustomerTodayCallState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCustomerTodayCallState(viewModel) {
  'use strict';

  const text = (value) => String(value == null ? '' : value).trim();

  function recordId(record) {
    return text(record && (record.id || record.call_id || record.elevenlabs_conversation_id || record.conversation_id));
  }

  function timestamp(record) {
    const value = record && (record.started_at || record.created_at || record.call_started_at || record.updated_at);
    const millis = value ? new Date(value).getTime() : 0;
    return Number.isFinite(millis) ? millis : 0;
  }

  function modelFor(record) {
    if (!viewModel || typeof viewModel.build !== 'function') {
      throw new Error('VoxeraCustomerCallViewModel is required.');
    }
    return viewModel.build(record || {});
  }

  function uniqueCalls(records) {
    const byId = new Map();
    const withoutId = [];

    (Array.isArray(records) ? records : []).forEach((record) => {
      if (!record || typeof record !== 'object') return;
      const id = recordId(record);
      if (!id) {
        withoutId.push(record);
        return;
      }
      const current = byId.get(id);
      if (!current || timestamp(record) >= timestamp(current)) byId.set(id, record);
    });

    return [...byId.values(), ...withoutId];
  }

  function sortedModels(records) {
    return uniqueCalls(records)
      .map((record) => ({ record, model: modelFor(record) }))
      .sort((a, b) => timestamp(b.record) - timestamp(a.record));
  }

  function selectAttention(records) {
    const models = sortedModels(records);
    const live = models.find((entry) => entry.model.lifecycle === 'live');
    if (live) return live;

    const analysing = models.find((entry) => entry.model.lifecycle === 'analysing');
    if (analysing) return analysing;

    return models.find((entry) => ['new', 'working', 'planned'].includes(entry.model.lifecycle)) || null;
  }

  function buildAttentionState(records, assistantName) {
    const selected = selectAttention(records);
    const name = text(assistantName) || 'Voxera';

    if (!selected) {
      return {
        kind: 'empty',
        title: 'Alles erledigt',
        message: `${name} nimmt neue Anrufe entgegen.`,
        record: null,
        model: null
      };
    }

    if (selected.model.lifecycle === 'live') {
      return {
        kind: 'live',
        title: selected.model.name,
        message: selected.model.lifecycleMeta.description,
        badge: 'LIVE',
        record: selected.record,
        model: selected.model
      };
    }

    if (selected.model.lifecycle === 'analysing') {
      return {
        kind: 'analysing',
        title: selected.model.name,
        message: selected.model.lifecycleMeta.description,
        badge: selected.model.lifecycleMeta.label,
        record: selected.record,
        model: selected.model
      };
    }

    return {
      kind: 'action',
      title: selected.model.name,
      message: selected.model.summary || selected.model.lifecycleMeta.description,
      badge: selected.model.lifecycleMeta.label,
      record: selected.record,
      model: selected.model
    };
  }

  function stateSignature(state) {
    if (!state) return '';
    const model = state.model || {};
    return [
      state.kind || '',
      recordId(state.record),
      state.title || '',
      state.message || '',
      state.badge || '',
      model.lifecycle || '',
      model.summary || '',
      model.phone || ''
    ].join('|');
  }

  function createStabilizer(options) {
    const config = options || {};
    const liveGraceMs = Number.isFinite(Number(config.liveGraceMs)) ? Number(config.liveGraceMs) : 4500;
    let current = null;
    let signature = '';
    let lastLiveSeenAt = 0;

    return function stabilise(nextState, nowValue) {
      const now = Number.isFinite(Number(nowValue)) ? Number(nowValue) : Date.now();
      const next = nextState || null;

      if (next && next.kind === 'live') lastLiveSeenAt = now;

      if (
        current && current.kind === 'live' &&
        (!next || next.kind === 'empty' || next.kind === 'action') &&
        now - lastLiveSeenAt < liveGraceMs
      ) {
        return { state: current, changed: false, held: true, signature };
      }

      const nextSignature = stateSignature(next);
      const changed = nextSignature !== signature;
      if (changed) {
        current = next;
        signature = nextSignature;
      }
      return { state: current, changed, held: false, signature };
    };
  }

  function buildTimeline(records, attentionRecord) {
    const attentionId = recordId(attentionRecord);
    return sortedModels(records)
      .filter((entry) => {
        if (!attentionId) return true;
        return recordId(entry.record) !== attentionId;
      })
      .map((entry) => entry.model);
  }

  return Object.freeze({
    recordId,
    uniqueCalls,
    selectAttention,
    buildAttentionState,
    stateSignature,
    createStabilizer,
    buildTimeline
  });
});
