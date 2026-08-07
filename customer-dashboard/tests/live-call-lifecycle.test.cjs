'use strict';

/**
 * Regression test for the Anruf-Lebenszyklus (Definition 2026-08-07).
 *
 * Rule: while the line is open there is NO card entry anywhere — only the
 * ambient hint. The entry comes into existence on hangup.
 *
 * The visible flicker this replaced came from violating that rule:
 * #live-call-row lived inside #dash-priority-list, but was never part of the
 * HTML string renderDashPriorityList() generates. vxSetHtmlIfChanged() there-
 * fore saw a difference on *every* render tick, replaced the list, and took
 * the hint down with it; updateLiveHero() then rebuilt the node and replayed
 * its 0.3s liveRowEnter entrance. Once per poll, for the whole call.
 *
 * Two invariants keep that from coming back, and both are asserted here:
 *   1. no live-phase call reaches any entry list (pure-function checks), and
 *   2. the hint node is created once per call and survives repeated renders
 *      with mutating record data (DOM-identity checks).
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dashboard = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractFunction(name) {
  const start = dashboard.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, name + ' not found in index.html');
  let depth = 0;
  let seenBody = false;
  for (let i = start; i < dashboard.length; i += 1) {
    const char = dashboard[i];
    if (char === '{') { depth += 1; seenBody = true; }
    else if (char === '}') {
      depth -= 1;
      if (seenBody && depth === 0) return dashboard.slice(start, i + 1);
    }
  }
  throw new Error('unterminated function: ' + name);
}

// ── minimal DOM, enough for the ambient hint ────────────────────────────────
function createDom() {
  const byId = new Map();
  function makeEl(tag) {
    const el = {
      tagName: tag,
      id: '',
      children: [],
      parentNode: null,
      attributes: {},
      _html: '',
      _text: '',
      get innerHTML() { return this._html; },
      set innerHTML(v) {
        this._html = String(v);
        this.children.forEach((c) => { c.parentNode = null; });
        this.children = [];
      },
      setAttribute(k, v) { this.attributes[k] = String(v); },
      appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        if (child.id) byId.set(child.id, child);
        return child;
      },
      remove() {
        if (!this.parentNode) return;
        const i = this.parentNode.children.indexOf(this);
        if (i >= 0) this.parentNode.children.splice(i, 1);
        this.parentNode = null;
        if (this.id && byId.get(this.id) === this) byId.delete(this.id);
      },
      querySelector(sel) {
        // the hint only ever queries .vx-live-name / .vx-live-sub
        const cls = sel.replace(/^\./, '');
        if (!this._html.includes(cls)) return null;
        this._parts = this._parts || {};
        if (!this._parts[cls]) this._parts[cls] = { className: cls, textContent: '' };
        return this._parts[cls];
      },
    };
    return el;
  }
  const document = {
    createElement: makeEl,
    getElementById: (id) => byId.get(id) || null,
    _mount(id) {
      const el = makeEl('div');
      el.id = id;
      byId.set(id, el);
      return el;
    },
  };
  return document;
}

function buildSandbox() {
  const document = createDom();
  const ambientHost = document._mount('dash-live-ambient');
  const priorityList = document._mount('dash-priority-list');

  const sandbox = {
    console,
    document,
    window: {},
    allRecords: [],
    allManualTaskRecords: [],
    CALL_LIVE_TERMINAL_STATES: new Set(['completed', 'processing', 'failed', 'abandoned']),
    CALL_LIVE_PHASE_STATES: new Set(['incoming', 'ringing', 'active', 'live']),
    _liveHeroTimer: null,
    _liveHeroCurrentId: null,
    _liveHeroLastFingerprint: null,
    _liveHeroNotified: new Set(),
    announced: { toasts: 0, bells: 0, notifications: 0, sounds: 0 },

    isManualTaskRecord: () => false,
    isActivationCallCategory: (c) => String(c || '').indexOf('activation') === 0,
    parseCallTimestamp: (v) => (v ? new Date(v) : null),
    getCallDisplayName: (f) => f.caller_name || '',
    _esc: (s) => String(s == null ? '' : s),
    vxGetCallStableId: (rec) => String((rec && rec.id) || ''),
    clearInterval: () => {},

    // list-side stubs that are not about live status
    vxHeuteIsManualTask: () => false,
    vxHeuteRecordCreatedToday: () => true,
    vxHeuteRecordCompletedToday: () => false,
    vxHeuteIsOutboundOrTestRecord: () => false,
    vxHeuteGetRecordValue: () => '',
    vxTodayIsOpenCallForAttention: () => true,
    vxTodayIsIgnorableCall: () => false,
    vxTodayCallRelevanceReasons: () => ['callback_requested'],
    isClosedStatus: () => false,
    getDashboardBucketForCall: () => ['recent'],
    sortOpenCallbacksOldestFirst: (a) => a,
    compareFollowUpPriority: () => 0,
    getRecordTimestamp: (r) => (r.fields || {}).created_at,
  };
  sandbox.vxToast = () => { sandbox.announced.toasts += 1; };
  sandbox.vxBellAdd = () => { sandbox.announced.bells += 1; };
  sandbox.notifyLiveCall = () => { sandbox.announced.notifications += 1; };
  sandbox.vxMaybePlayLiveCallSound = () => { sandbox.announced.sounds += 1; return true; };

  vm.createContext(sandbox);
  vm.runInContext([
    'vxIsCallInLivePhase',
    'vxGetAnfragenSourceRecords',
    'vxGetHeuteTodayCallRecords',
    'vxTodayIsRelevantCallForAttention',
    'deriveDashboardCallBuckets',
    'isCustomerVisibleCall',
    'vxHeuteDedupeByStableId',
    'vxHeuteIsHandoverCall',
    'vxHeuteGetHandoverCalls',
    'vxGetLivePhaseCalls',
    'vxAnnounceLivePhaseCalls',
    'updateLiveHero',
  ].map(extractFunction).join('\n'), sandbox);

  return { sandbox, ambientHost, priorityList };
}

const call = (id, liveStatus, extra) => ({
  id,
  fields: Object.assign({
    live_status: liveStatus,
    created_at: '2026-08-07T10:00:00.000Z',
    callback_requested: true,
  }, extra || {}),
});

// ── 1. the lifecycle predicate ─────────────────────────────────────────────

test('live phase covers the states where the line is still open', () => {
  const { sandbox } = buildSandbox();
  for (const status of ['incoming', 'ringing', 'active', 'live']) {
    assert.equal(sandbox.vxIsCallInLivePhase(call('c', status)), true, status + ' must count as live phase');
  }
});

test('live phase ends at hangup — processing and later are entries', () => {
  const { sandbox } = buildSandbox();
  for (const status of ['processing', 'analyzing', 'completed', 'failed', 'abandoned', '']) {
    assert.equal(sandbox.vxIsCallInLivePhase(call('c', status)), false, status + ' must not count as live phase');
  }
});

test('manual tasks are never in a live phase', () => {
  const { sandbox } = buildSandbox();
  sandbox.isManualTaskRecord = () => true;
  assert.equal(sandbox.vxIsCallInLivePhase(call('t', 'active')), false);
});

// ── 2. no entry exists while the line is open ──────────────────────────────

test('no entry list contains a call that is still on the line', () => {
  const { sandbox } = buildSandbox();
  const records = [
    call('call-live', 'active'),
    call('call-ringing', 'incoming'),
    call('call-ended', 'processing'),
    call('call-done', 'completed'),
  ];
  sandbox.allRecords = records;

  const lists = {
    // feeds the Heute view source, the Anfragen inbox, every count and badge
    'vxGetAnfragenSourceRecords': sandbox.vxGetAnfragenSourceRecords(),
    // feeds "Anrufe heute" and the "Heute passiert" chronology
    'vxGetHeuteTodayCallRecords': sandbox.vxGetHeuteTodayCallRecords(records),
    // feeds the "Aufmerksamkeit" list
    'attention': records.filter(sandbox.vxTodayIsRelevantCallForAttention),
    // feeds the derived dashboard buckets
    'deriveDashboardCallBuckets.open': sandbox.deriveDashboardCallBuckets(records).open,
  };

  for (const [name, got] of Object.entries(lists)) {
    // Array.from re-homes the vm-realm arrays so deepEqual compares values.
    const ids = Array.from(got, (r) => r.id);
    assert.deepEqual(ids, ['call-ended', 'call-done'], name + ' must drop live-phase calls and keep ended ones');
  }
});

test('the Lara handover ("Braucht dich") shows no card while the line is open', () => {
  // PR #822 replaced the Heute screen with the Lara handover. vxHeuteIsHandoverCall()
  // has no live-phase check of its own — it relies entirely on being fed the already
  // filtered vxGetAnfragenSourceRecords(). This test pins that contract down: if the
  // handover is ever wired to a raw record source, a running call would surface as a
  // "Braucht dich" card and the lifecycle rule would silently break.
  const { sandbox } = buildSandbox();
  const records = [call('call-live', 'active'), call('call-ended', 'processing')];
  sandbox.allRecords = records;

  const handover = sandbox.vxHeuteGetHandoverCalls(sandbox.vxGetAnfragenSourceRecords());
  assert.deepEqual(
    Array.from(handover, (r) => r.id),
    ['call-ended'],
    'a call still on the line must not reach the handover cards'
  );
});

// ── 3. the ambient hint is stable for the whole call ───────────────────────

test('the hint node is created once and survives repeated renders', () => {
  const { sandbox, ambientHost } = buildSandbox();
  const live = call('call-1', 'active');

  sandbox.updateLiveHero([live]);
  assert.equal(ambientHost.children.length, 1, 'hint must be mounted in #dash-live-ambient');
  const node = ambientHost.children[0];
  assert.equal(node.id, 'live-call-row');

  // exactly the churn that used to rebuild the row: caller data resolving
  // mid-call plus repeated poll/realtime ticks.
  live.fields.caller_name = 'Anna Muster';
  sandbox.updateLiveHero([live]);
  live.fields.company_name = 'Muster AG';
  sandbox.updateLiveHero([live]);
  live.fields.updated_at = '2026-08-07T10:02:00.000Z';
  sandbox.updateLiveHero([live]);
  sandbox.updateLiveHero([live]);

  assert.equal(ambientHost.children.length, 1);
  assert.equal(ambientHost.children[0], node, 'the hint node must never be replaced while the call runs');
});

test('the hint never mounts inside the priority list', () => {
  const { sandbox, ambientHost, priorityList } = buildSandbox();
  sandbox.updateLiveHero([call('call-1', 'active')]);
  assert.equal(priorityList.children.length, 0, '#dash-priority-list must not host the hint — its innerHTML is replaced wholesale');
  assert.equal(ambientHost.children[0].parentNode, ambientHost);
});

test('the hint survives the priority list being rebuilt — the original flicker', () => {
  const { sandbox, ambientHost, priorityList } = buildSandbox();
  const live = call('call-1', 'active');

  // The exact production sequence, per poll tick and per realtime event:
  // loadData() -> renderDashboard() -> renderDashPriorityList() (which swaps
  // #dash-priority-list innerHTML wholesale) -> updateLiveHero().
  sandbox.updateLiveHero([live]);
  const node = ambientHost.children[0];

  for (let tick = 0; tick < 4; tick += 1) {
    priorityList.innerHTML = '<section class="vx-ap-stack">tick ' + tick + '</section>';
    sandbox.updateLiveHero([live]);
  }

  assert.equal(ambientHost.children.length, 1);
  assert.equal(
    ambientHost.children[0],
    node,
    'rebuilding the priority list must not take the hint down — that rebuild-per-tick was the flicker'
  );
});

test('the hint carries no per-call data', () => {
  const { sandbox, ambientHost } = buildSandbox();
  sandbox.updateLiveHero([call('call-1', 'active', { caller_name: 'Anna Muster', company_name: 'Muster AG', caller_phone: '+41791234567' })]);
  const html = ambientHost.children[0].innerHTML;
  for (const leak of ['Anna Muster', 'Muster AG', '+41791234567', 'call-1']) {
    assert.equal(html.includes(leak), false, 'ambient hint must not render ' + leak);
  }
  assert.equal(html.includes('Ein Anruf läuft gerade'), true);
});

test('a second live call patches the hint instead of rebuilding it', () => {
  const { sandbox, ambientHost } = buildSandbox();
  sandbox.updateLiveHero([call('call-1', 'active')]);
  const node = ambientHost.children[0];
  sandbox.updateLiveHero([call('call-1', 'active'), call('call-2', 'incoming')]);
  assert.equal(ambientHost.children[0], node, 'a joining call must not recreate the node');
  assert.equal(node.querySelector('.vx-live-name').textContent, '2 Anrufe laufen gerade');
});

test('the hint disappears on hangup', () => {
  const { sandbox, ambientHost } = buildSandbox();
  sandbox.updateLiveHero([call('call-1', 'active')]);
  assert.equal(ambientHost.children.length, 1);
  sandbox.updateLiveHero([call('call-1', 'processing')]);
  assert.equal(ambientHost.children.length, 0, 'hangup ends the ambient phase — the record becomes an entry');
});

test('the in-app incoming notice is left to #incoming-banner, not rebuilt here', () => {
  // flagIncomingRecords() already shows #incoming-banner ("Neuer Anruf" + caller
  // name + green pulsing dot + sound) the moment a new call record appears, which
  // during a live call is while the line is open. updateLiveHero() must not put a
  // second in-app notification on top of it. vxToast()/vxBellAdd() used to be
  // called here; vxToast() is implemented nowhere in the repo and vxBellAdd() only
  // forwards to it, so both threw — they are gone rather than reimplemented.
  const { sandbox } = buildSandbox();
  sandbox.updateLiveHero([call('call-1', 'active')]);
  assert.deepEqual(
    { toasts: sandbox.announced.toasts, bells: sandbox.announced.bells },
    { toasts: 0, bells: 0 },
    'no second in-app notification path may be introduced alongside #incoming-banner'
  );
});

test('a missing announcement channel does not stop the hint from rendering', () => {
  // Announcements are incidental — a broken one must never cost the user the hint.
  const { sandbox, ambientHost } = buildSandbox();
  delete sandbox.notifyLiveCall;
  vm.runInContext('notifyLiveCall = undefined;', sandbox);

  sandbox.updateLiveHero([call('call-1', 'active')]);
  assert.equal(ambientHost.children.length, 1, 'the hint must render even when an announcement channel is missing');
  assert.equal(sandbox.announced.notifications, 0, 'the missing channel is skipped');
  assert.equal(sandbox.announced.sounds, 1, 'the channels that do exist still fire');
});

test('each call is announced once, not once per render tick', () => {
  const { sandbox } = buildSandbox();
  const live = call('call-1', 'active');
  for (let i = 0; i < 5; i += 1) sandbox.updateLiveHero([live]);
  assert.deepEqual(sandbox.announced, { toasts: 0, bells: 0, notifications: 1, sounds: 1 });

  sandbox.updateLiveHero([live, call('call-2', 'incoming')]);
  assert.deepEqual(
    sandbox.announced,
    { toasts: 0, bells: 0, notifications: 2, sounds: 2 },
    'a second call gets its own announcement'
  );
});
