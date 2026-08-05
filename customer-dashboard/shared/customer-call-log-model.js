(function initCustomerCallLogModel(root, factory) {
  'use strict';
  const api = factory(root && root.VoxeraCustomerCallViewModel);
  if (typeof module === 'object' && module.exports) {
    module.exports = Object.assign({}, api, { withViewModel: factory });
  }
  if (root) root.VoxeraCustomerCallLogModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCustomerCallLogModel(viewModel) {
  'use strict';

  const text = (value) => String(value == null ? '' : value).trim();
  const FOLLOW_UP_LIFECYCLES = new Set(['new', 'working', 'planned']);

  function fields(record) {
    return record && record.fields && typeof record.fields === 'object' ? record.fields : {};
  }

  function read(record, key) {
    if (record && record[key] !== undefined && record[key] !== null && text(record[key]) !== '') return record[key];
    const nested = fields(record);
    if (nested[key] !== undefined && nested[key] !== null && text(nested[key]) !== '') return nested[key];
    return '';
  }

  function first(record, keys) {
    for (const key of keys) {
      const value = read(record, key);
      if (value !== '') return value;
    }
    return '';
  }

  function requireViewModel() {
    if (!viewModel || typeof viewModel.build !== 'function') {
      throw new Error('VoxeraCustomerCallViewModel is required.');
    }
  }

  function canonicalId(record) {
    return text(first(record, [
      'elevenlabs_conversation_id',
      'conversation_id',
      'call_id',
      'id'
    ]));
  }

  function timestamp(record) {
    const value = first(record, [
      'started_at',
      'call_started_at',
      'created_at',
      'updated_at'
    ]);
    const time = value ? new Date(value).getTime() : 0;
    return Number.isFinite(time) ? time : 0;
  }

  function dedupe(records) {
    const byId = new Map();
    const withoutId = [];

    (Array.isArray(records) ? records : []).forEach((record) => {
      if (!record || typeof record !== 'object') return;
      const id = canonicalId(record);
      if (!id) {
        withoutId.push(record);
        return;
      }
      const current = byId.get(id);
      if (!current || timestamp(record) >= timestamp(current)) byId.set(id, record);
    });

    return [...byId.values(), ...withoutId];
  }

  function entries(records) {
    requireViewModel();
    return dedupe(records)
      .map((record) => ({ record, model: viewModel.build(record) }))
      .sort((a, b) => timestamp(b.record) - timestamp(a.record));
  }

  function hasAction(entry) {
    if (!entry || !entry.model) return false;
    if (!FOLLOW_UP_LIFECYCLES.has(entry.model.lifecycle)) return false;
    return Boolean(
      entry.model.outcome ||
      text(first(entry.record, ['next_action', 'action_required'])) ||
      text(first(entry.record, ['follow_up_at', 'callback_at', 'due_at'])) ||
      read(entry.record, 'callback_requested') === true ||
      String(read(entry.record, 'callback_requested')).toLowerCase() === 'true'
    );
  }

  function build(records) {
    const all = entries(records);
    const active = all.find((entry) => entry.model.lifecycle === 'live') || null;
    const analysing = active ? null : all.find((entry) => entry.model.lifecycle === 'analysing') || null;
    const excludedId = canonicalId((active || analysing || {}).record);

    const remaining = all.filter((entry) => {
      if (!excludedId) return true;
      return canonicalId(entry.record) !== excludedId;
    });

    const tasks = remaining.filter(hasAction);
    const taskIds = new Set(tasks.map((entry) => canonicalId(entry.record)).filter(Boolean));
    const history = remaining.filter((entry) => {
      const id = canonicalId(entry.record);
      return !id || !taskIds.has(id);
    });

    return {
      active,
      analysing,
      tasks,
      history,
      counts: {
        active: active ? 1 : 0,
        analysing: analysing ? 1 : 0,
        tasks: tasks.length,
        history: history.length,
        total: all.length
      }
    };
  }

  function entrySignature(entry) {
    if (!entry || !entry.model) return '';
    const model = entry.model;
    return [
      canonicalId(entry.record) || model.id || '',
      model.lifecycle || '',
      model.name || '',
      model.phone || '',
      model.summary || '',
      model.outcome || '',
      model.category || '',
      model.leadQuality || '',
      model.timestamp || ''
    ].join('|');
  }

  function signature(state) {
    const source = state || {};
    const items = (entriesList) => (entriesList || []).map(entrySignature).join(',');
    return JSON.stringify({
      active: entrySignature(source.active),
      analysing: entrySignature(source.analysing),
      tasks: items(source.tasks),
      history: items(source.history)
    });
  }

  function createStableStore(options) {
    const config = options || {};
    const liveGraceMs = Number.isFinite(config.liveGraceMs) ? Math.max(0, config.liveGraceMs) : 12000;
    let lastState = null;
    let lastSignature = '';
    let liveSeenAt = 0;

    function update(records, now) {
      const at = Number.isFinite(now) ? now : Date.now();
      let next = build(records);

      if (next.active) liveSeenAt = at;
      else if (!next.analysing && lastState && lastState.active && at - liveSeenAt <= liveGraceMs) {
        next = {
          ...next,
          active: lastState.active,
          analysing: null,
          tasks: next.tasks.filter((entry) => canonicalId(entry.record) !== canonicalId(lastState.active.record)),
          history: next.history.filter((entry) => canonicalId(entry.record) !== canonicalId(lastState.active.record))
        };
        next.counts = {
          ...next.counts,
          active: 1,
          analysing: 0,
          tasks: next.tasks.length,
          history: next.history.length
        };
      }

      const nextSignature = signature(next);
      const changed = nextSignature !== lastSignature;
      if (changed) {
        lastState = next;
        lastSignature = nextSignature;
      }
      return { state: lastState || next, changed, signature: lastSignature || nextSignature };
    }

    return Object.freeze({ update, current: () => lastState, signature: () => lastSignature });
  }

  return Object.freeze({ canonicalId, dedupe, build, signature, createStableStore });
});
