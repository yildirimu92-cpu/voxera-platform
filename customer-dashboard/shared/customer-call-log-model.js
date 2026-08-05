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
  const LIFECYCLE_RANK = Object.freeze({
    live: 1,
    analysing: 2,
    new: 3,
    working: 4,
    planned: 5,
    done: 6,
    archived: 7
  });

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

  function identityKeys(record) {
    const nested = fields(record);
    const result = [];
    [
      'elevenlabs_conversation_id',
      'conversation_id',
      'call_id',
      'source_call_id',
      'provider_call_id',
      'external_call_id',
      'id'
    ].forEach((key) => {
      [record && record[key], nested[key]].forEach((value) => {
        const normalized = text(value);
        if (normalized && !result.includes(normalized)) result.push(normalized);
      });
    });
    return result;
  }

  function canonicalId(record) {
    return identityKeys(record)[0] || '';
  }

  function timestamp(record) {
    const value = viewModel && typeof viewModel.timestamp === 'function'
      ? viewModel.timestamp(record)
      : first(record, ['started_at', 'call_started_at', 'created_at', 'updated_at']);
    const time = value ? new Date(value).getTime() : 0;
    return Number.isFinite(time) ? time : 0;
  }

  function freshnessTimestamp(record) {
    const value = first(record, [
      'updated_at',
      'completed_at',
      'closed_at',
      'archived_at',
      'read_at',
      'created_at',
      'started_at',
      'call_started_at'
    ]);
    const time = value ? new Date(value).getTime() : 0;
    return Number.isFinite(time) ? time : 0;
  }

  function lifecycleRank(record) {
    requireViewModel();
    const state = viewModel.lifecycle(record);
    return LIFECYCLE_RANK[state] || 0;
  }

  function preferredRecord(current, candidate) {
    const currentRank = lifecycleRank(current);
    const candidateRank = lifecycleRank(candidate);
    const currentTerminal = currentRank >= LIFECYCLE_RANK.done;
    const candidateTerminal = candidateRank >= LIFECYCLE_RANK.done;

    // Completed or archived workflow states must not be downgraded by a stale
    // duplicate from another dashboard source.
    if (currentTerminal !== candidateTerminal) {
      return candidateTerminal ? candidate : current;
    }
    if (currentTerminal && candidateTerminal && candidateRank !== currentRank) {
      return candidateRank > currentRank ? candidate : current;
    }

    // During live/analysis/open progression, the freshest provider record wins.
    return freshnessTimestamp(candidate) >= freshnessTimestamp(current) ? candidate : current;
  }

  function dedupe(records) {
    const groups = [];
    const withoutId = [];

    (Array.isArray(records) ? records : []).forEach((record) => {
      if (!record || typeof record !== 'object') return;
      const aliases = identityKeys(record);
      if (!aliases.length) {
        withoutId.push(record);
        return;
      }

      const matching = groups.filter((group) => aliases.some((alias) => group.aliases.has(alias)));
      if (!matching.length) {
        groups.push({ record, aliases: new Set(aliases) });
        return;
      }

      const primary = matching[0];
      let chosen = preferredRecord(primary.record, record);
      aliases.forEach((alias) => primary.aliases.add(alias));

      matching.slice(1).forEach((group) => {
        chosen = preferredRecord(chosen, group.record);
        group.aliases.forEach((alias) => primary.aliases.add(alias));
        const index = groups.indexOf(group);
        if (index >= 0) groups.splice(index, 1);
      });

      primary.record = chosen;
    });

    return [...groups.map((group) => group.record), ...withoutId];
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
    const callbackRequested = read(entry.record, 'callback_requested') === true ||
      String(read(entry.record, 'callback_requested')).toLowerCase() === 'true';
    const scheduledAt = text(first(entry.record, ['follow_up_at', 'callback_at', 'due_at']));
    return Boolean(
      entry.model.lifecycle === 'planned' ||
      entry.model.outcome ||
      scheduledAt ||
      callbackRequested
    );
  }

  function build(records) {
    const all = entries(records);
    const active = all.find((entry) => entry.model.lifecycle === 'live') || null;
    const analysing = active ? null : all.find((entry) => entry.model.lifecycle === 'analysing') || null;
    const excludedAliases = new Set(identityKeys((active || analysing || {}).record));

    const remaining = all.filter((entry) => {
      if (!excludedAliases.size) return true;
      return !identityKeys(entry.record).some((alias) => excludedAliases.has(alias));
    });

    const tasks = remaining.filter(hasAction);
    const taskAliases = new Set();
    tasks.forEach((entry) => identityKeys(entry.record).forEach((alias) => taskAliases.add(alias)));
    const history = remaining.filter((entry) => {
      const aliases = identityKeys(entry.record);
      return !aliases.length || !aliases.some((alias) => taskAliases.has(alias));
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
      identityKeys(entry.record).join('~') || model.id || '',
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

    function sharesIdentity(left, right) {
      const leftAliases = new Set(identityKeys(left));
      return identityKeys(right).some((alias) => leftAliases.has(alias));
    }

    function update(records, now) {
      const at = Number.isFinite(now) ? now : Date.now();
      let next = build(records);

      if (next.active) liveSeenAt = at;
      else if (!next.analysing && lastState && lastState.active && at - liveSeenAt <= liveGraceMs) {
        next = {
          ...next,
          active: lastState.active,
          analysing: null,
          tasks: next.tasks.filter((entry) => !sharesIdentity(entry.record, lastState.active.record)),
          history: next.history.filter((entry) => !sharesIdentity(entry.record, lastState.active.record))
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

  return Object.freeze({ identityKeys, canonicalId, dedupe, build, signature, createStableStore });
});
