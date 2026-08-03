import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

const indexPath = 'customer-dashboard/index.html';
const assistantCssPath = 'customer-dashboard/shared/customer-assistant-components.css';

let dashboard = fs.readFileSync(indexPath, 'utf8');
let assistantCss = fs.readFileSync(assistantCssPath, 'utf8');
const originalDashboard = dashboard;
const originalAssistantCss = assistantCss;

const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

function functionRange(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `function missing: ${name}`);
  const brace = source.indexOf('{', start);
  assert.ok(brace >= 0, `function body missing: ${name}`);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = brace; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return { start, end: index + 1 };
    }
  }
  throw new Error(`function end missing: ${name}`);
}

function getFunction(source, name) {
  const range = functionRange(source, name);
  return source.slice(range.start, range.end);
}

function replaceFunction(source, name, replacement) {
  const range = functionRange(source, name);
  return source.slice(0, range.start) + replacement + source.slice(range.end);
}

function replaceInsideFunction(source, name, oldValue, newValue, expected = 1) {
  const range = functionRange(source, name);
  const body = source.slice(range.start, range.end);
  const count = body.split(oldValue).length - 1;
  assert.equal(count, expected, `${name}: expected ${expected} match(es) for ${oldValue}, found ${count}`);
  const updated = body.replace(oldValue, newValue);
  return source.slice(0, range.start) + updated + source.slice(range.end);
}

function replaceMarkedRegion(source, startMarker, endMarker, replacement) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `start marker missing: ${startMarker}`);
  assert.ok(end > start, `end marker missing: ${endMarker}`);
  assert.equal(source.indexOf(startMarker, start + 1), -1, `start marker is not unique: ${startMarker}`);
  return source.slice(0, start) + replacement + source.slice(end);
}

function windowAround(source, token, before = 1200, after = 7200) {
  const index = source.indexOf(token);
  assert.ok(index >= 0, `protected token missing: ${token}`);
  return source.slice(Math.max(0, index - before), Math.min(source.length, index + after));
}

const protectedWindows = new Map([
  ['loading', hash(windowAround(dashboard, 'Bitte einen Moment', 2200, 6200))],
  ['dashboard', hash(windowAround(dashboard, 'id="tab-dashboard"', 200, 9000))],
  ['report', hash(windowAround(dashboard, 'id="tab-auswertung"', 200, 12000))],
  ['settings', hash(windowAround(dashboard, 'id="tab-mehr"', 200, 10000))]
]);

const protectedFunctions = new Map([
  'vxRenderRequestsDetailV2',
  'vxRenderDetailV2Actions',
  'showCallDetail',
  'showTaskDetail',
  'vxForceCloseCallDetail'
].map((name) => [name, hash(getFunction(dashboard, name))]));

const requestsHost = `        <!-- ANFRAGEN TAB -->
        <div class="tab-page" id="tab-anrufe">
          <section class="vx-page-header">
            <div class="vx-ap-head">
              <div>
                <div class="vx-page-header-title">Anfragen</div>
                <div id="anrufe-split-count" class="vx-page-header-subtitle">–</div>
              </div>
            </div>
          </section>

          <div id="anrufe-split" class="vx-requests-layout">
            <section id="anrufe-split-left" class="vx-ops-card vx-requests-panel" aria-label="Anfragenliste">
              <div class="vx-ap-filters vx-requests-filters" role="tablist" aria-label="Anfragestatus">
                <button class="vx-ap-filter vx-chip vx-chip--active" data-filter="offen" onclick="anrufeChipFilter('offen',this)">Offen</button>
                <button class="vx-ap-filter vx-chip" data-filter="geplant" onclick="anrufeChipFilter('geplant',this)">Geplant</button>
                <button class="vx-ap-filter vx-chip" data-filter="abgeschlossen" onclick="anrufeChipFilter('abgeschlossen',this)">Erledigt</button>
              </div>

              <div class="vx-requests-subfilters" id="anrufe-inbox-subfilters">
                <button class="vx-ap-filter vx-chip" data-inbox-subfilter="unread" onclick="anrufeInboxSubFilter((_anrufeInboxSubfilter === 'unread' ? 'all' : 'unread'),this)">Nur ungelesene</button>
                <div class="vx-selection-controls" id="anrufe-selection-controls" hidden></div>
              </div>

              <div id="vx-inbox-selection-toolbar"></div>

              <div class="vx-requests-search">
                <div class="vx-requests-search-box vxfb-search-box" id="fb-anrufe-searchbox">
                  <i class="ph-bold ph-magnifying-glass vx-requests-search-icon" aria-hidden="true"></i>
                  <input class="vx-requests-search-input vxfb-search-input" id="fb-anrufe-input" placeholder="Suchen…" aria-label="Anfragen durchsuchen" oninput="vxFbSearch('anrufe',this.value)" onkeydown="if(event.key==='Escape'){vxFbClearSearch('anrufe');}">
                  <button class="vx-requests-search-clear vxfb-search-clear" id="fb-anrufe-clear" onclick="vxFbClearSearch('anrufe')" style="display:none;" aria-label="Suche leeren"><i class="ph-bold ph-x" aria-hidden="true"></i></button>
                </div>
              </div>

              <div id="anrufe-sub-offen" class="vx-requests-scroll">
                <div class="vx-ops-list vx-requests-list" id="anrufe-list"></div>
              </div>
            </section>

            <div id="anrufe-split-resizer" class="vx-requests-resizer" title="Ziehen zum Anpassen"></div>

            <aside id="anrufe-split-right" class="vx-ops-card vx-requests-detail-panel" aria-label="Anfragedetails">
              <div id="anrufe-split-empty" class="vx-ops-empty vx-requests-detail-empty">
                <i class="ph-bold ph-tray" aria-hidden="true"></i>
                <span>Wähle eine Anfrage aus, um Details zu sehen.</span>
              </div>
              <div id="requests-detail-v2" class="vx-requests-detail" style="display:none;flex:1;overflow:auto;"></div>
            </aside>
          </div>
        </div>

`;

dashboard = replaceMarkedRegion(
  dashboard,
  '        <!-- ANFRAGEN TAB -->',
  '        <!-- AUSWERTUNG TAB -->',
  requestsHost
);

const requestsRenderer = String.raw`function renderAnrufeInbox(containerId, records, activeFilter) {
  var el = document.getElementById(containerId);
  if (!el) return;

  el.classList.remove('dpr-command-center', 'call-list');
  el.classList.add('vx-ops-list', 'vx-requests-list');

  var filter = vxGetAnfragenActiveFilter(activeFilter);
  var sourceRecords = Array.isArray(records) ? records : [];
  var liveCallIds = vxGetLiveCallIdSet(allRecords || []);
  var visibleRecords = sourceRecords.filter(function(rec) {
    return !vxIsExcludedNormalCall(rec, liveCallIds);
  });

  function renderEmpty() {
    var emptyLabel = vxInquiryFilterEmptyText(filter);
    el.innerHTML = '<div class="vx-ops-empty vx-requests-empty">'
      + '<i class="ph-bold ph-tray" aria-hidden="true"></i>'
      + '<span>' + _esc(emptyLabel) + '</span>'
      + '</div>';
    vxRenderInboxSelectionToolbar();
    vxUpdateAnfragenCount();
  }

  if (!visibleRecords.length) {
    renderEmpty();
    return;
  }

  var groups = {};
  var groupOrder = [];
  var timezone = 'Europe/Zurich';
  var formatDayKey = function(value) {
    return new Intl.DateTimeFormat('de-CH', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(value));
  };
  var todayKey = formatDayKey(new Date());
  var yesterdayKey = formatDayKey(new Date(Date.now() - 86400000));

  visibleRecords.forEach(function(rec) {
    var fields = (rec && rec.fields) || {};
    var isDone = vxInquiryIsCompleted(rec) || vxInquiryIsArchived(rec);
    var timestamp = isDone
      ? (fields.completed_at || fields.closed_at || fields.done_at || fields.archived_at || getRecordTimestamp(rec))
      : getRecordTimestamp(rec);
    var date = timestamp ? parseCallTimestamp(timestamp) : null;
    var label = 'Unbekannt';
    if (date) {
      var dayKey = formatDayKey(date);
      if (dayKey === todayKey) label = 'Heute';
      else if (dayKey === yesterdayKey) label = 'Gestern';
      else label = date.toLocaleDateString('de-CH', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: timezone
      });
    }
    if (!groups[label]) {
      groups[label] = [];
      groupOrder.push(label);
    }
    groups[label].push(rec);
  });

  function resolveDueText(rec) {
    var fields = (rec && rec.fields) || {};
    if (vxInquiryIsArchived(rec) || vxInquiryIsCompleted(rec)) {
      var completedAt = fields.completed_at || fields.closed_at || fields.done_at || fields.archived_at || getRecordTimestamp(rec);
      return completedAt ? fmtExactDateTime(completedAt) : 'Erledigt';
    }
    if (vxInquiryIsPlanned(rec)) {
      var dueAt = fields.follow_up_at || fields.followup_at || fields.followUpAt || '';
      return dueAt ? fmtExactDateTime(dueAt) : 'Geplant';
    }
    var timestamp = getRecordTimestamp(rec);
    return timestamp ? _formatRelativeTime(timestamp) : '';
  }

  var html = '';
  groupOrder.forEach(function(label) {
    html += '<div class="vx-ops-meta vx-requests-date">'
      + '<i class="ph-bold ph-calendar-dots" aria-hidden="true"></i>'
      + _esc(label)
      + '</div>';

    groups[label].forEach(function(rec) {
      var fields = (rec && rec.fields) || {};
      var recordId = String((rec && rec.id) || '').trim();
      var phone = String(fields.caller_phone || fields.phone || fields.phone_number || fields.tel_link || '').trim();
      var linkedTasks = vxFindOpenManualTasksForPhone(phone);
      var name = vxDashResolveWorkTitle(rec);
      var company = (fields.company_name && fields.caller_name && fields.company_name !== fields.caller_name)
        ? String(fields.company_name).trim()
        : '';
      var typeMeta = vxDashGetCommandTypeMeta(rec);
      var stateMeta = (typeof vxGetCallDisplayState === 'function' ? vxGetCallDisplayState(rec) : null) || vxGetDefaultCallDisplayState();
      var isArchived = vxInquiryIsArchived(rec);
      var isDone = vxInquiryIsCompleted(rec);
      var isPlanned = vxInquiryIsPlanned(rec);
      var isUnread = typeof vxIsUnreadRecord === 'function'
        ? vxIsUnreadRecord(rec)
        : (!isManualTaskRecord(rec) && !fields.read_at);
      var isOnToday = typeof vxCallIsOnToday === 'function' && vxCallIsOnToday(rec);
      var urgency = String(fields.urgency || '').toLowerCase().trim();
      var rail = (isArchived || isDone) ? 'done'
        : urgency === 'sofort' ? 'urgent'
        : (isOnToday || isPlanned) ? 'planned'
        : (fields.callback_requested === true || fields.callback_requested === 'true') ? 'callback'
        : 'new';
      var preview = '';
      if (stateMeta.state === 'live') preview = 'Lara nimmt den Anruf gerade entgegen.';
      else if (stateMeta.state === 'processing' || stateMeta.state === 'checking') preview = 'Zusammenfassung wird erstellt.';
      else preview = String(fields.call_summary || fields.summary || fields.note || '').trim();
      if (!preview) preview = vxDashGetTaskDescription(rec, typeMeta, name);
      if (preview.length > 110) preview = preview.slice(0, 107) + '…';

      var statusLabel = isArchived ? 'Archiviert'
        : isDone ? 'Erledigt'
        : isPlanned ? 'Geplant'
        : stateMeta.state === 'live' ? 'Live'
        : stateMeta.state === 'processing' || stateMeta.state === 'checking' ? 'Wird verarbeitet'
        : isUnread ? 'Neu'
        : 'Offen';
      var statusClass = isArchived || isDone ? ' is-done'
        : isPlanned ? ' is-planned'
        : stateMeta.state === 'live' ? ' active'
        : isUnread ? ' is-new'
        : '';
      var leadQuality = String(fields.lead_quality || '').toLowerCase();
      var leadPill = leadQuality === 'hot'
        ? '<span class="vx-ops-pill vx-requests-pill is-hot">Hot</span>'
        : leadQuality === 'warm'
          ? '<span class="vx-ops-pill vx-requests-pill is-warm">Warm</span>'
          : '';
      var primary = typeof vxTodayGetPrimaryAction === 'function'
        ? vxTodayGetPrimaryAction(rec, typeMeta, phone)
        : { action: phone ? 'call' : 'open', title: phone ? 'Anrufen' : 'Öffnen', icon: phone ? 'phone-call' : 'arrow-square-out' };
      var primaryClass = primary.action === 'call' ? ' is-call' : primary.action === 'done' ? ' is-done' : '';
      var menuHtml = typeof vxAnfragenBuildRowMenuHtml === 'function'
        ? vxAnfragenBuildRowMenuHtml(rec, phone, typeMeta)
        : '<button type="button" data-action="fulldetail" data-rec-id="' + _esc(recordId) + '">Details öffnen</button>';
      var activeClass = String(window._vxActiveRecordId || window._vxLastAnfragenRecordId || '') === recordId ? ' sp-active' : '';
      var unreadClass = isUnread ? ' is-unread' : '';
      var dueText = resolveDueText(rec);
      var taskText = linkedTasks.length === 1 ? '1 offene Aufgabe' : linkedTasks.length > 1 ? linkedTasks.length + ' offene Aufgaben' : '';

      html += '<article class="vx-ops-item vx-requests-item' + activeClass + unreadClass + '"'
        + ' data-id="' + _esc(recordId) + '"'
        + ' data-record-id="' + _esc(recordId) + '"'
        + ' data-phone="' + _esc(phone) + '"'
        + ' data-kind="inquiry"'
        + ' data-rail="' + _esc(rail) + '"'
        + ' data-filter-new="' + (isUnread ? '1' : '0') + '"'
        + ' data-filter-task="' + (linkedTasks.length > 0 ? '1' : '0') + '"'
        + ' data-filter-planned="' + ((isOnToday || isPlanned) ? '1' : '0') + '"'
        + ' data-filter-checked="' + ((isDone || isArchived) ? '1' : '0') + '"'
        + ' data-filter-archived="' + (isArchived ? '1' : '0') + '">';
      html += '<div class="vx-requests-row" role="button" tabindex="0"'
        + ' data-id="' + _esc(recordId) + '" data-record-id="' + _esc(recordId) + '"'
        + ' onclick="dprToggleClick(event,this)"'
        + ' ontouchstart="dprToggleTouchStart(event,this)"'
        + ' ontouchmove="dprToggleTouchMove(event)"'
        + ' ontouchend="dprToggleTouchEnd(event,this)">';
      html += '<div class="vx-ap-avatar vx-requests-icon' + ((typeMeta.kind === 'callback' || typeMeta.kind === 'incoming') ? ' is-call' : '') + '">'
        + '<i class="ph-bold ph-' + _esc(typeMeta.icon || 'phone-incoming') + '" aria-hidden="true"></i>'
        + '</div>';
      html += '<div class="vx-requests-copy">';
      html += '<div class="vx-requests-title-line">'
        + '<div class="vx-ops-title vx-requests-title">' + _esc(name) + '</div>'
        + (dueText ? '<div class="vx-ops-meta vx-requests-time">' + _esc(dueText) + '</div>' : '')
        + '</div>';
      if (company) html += '<div class="vx-ops-meta vx-requests-company">' + _esc(company) + '</div>';
      html += '<div class="vx-requests-pills">'
        + '<span class="vx-ops-pill vx-requests-pill' + statusClass + '">' + _esc(statusLabel) + '</span>'
        + leadPill
        + '</div>';
      if (preview) html += '<div class="vx-ops-message vx-requests-preview">' + _esc(preview) + '</div>';
      var metaParts = [];
      if (phone && name !== phone) metaParts.push(phone);
      if (taskText) metaParts.push(taskText);
      if (metaParts.length) html += '<div class="vx-ops-meta vx-requests-meta">' + _esc(metaParts.join(' · ')) + '</div>';
      html += '</div>';
      html += '<div class="vx-requests-actions">';
      html += '<button type="button" class="vx-requests-icon-action' + primaryClass + '"'
        + ' data-action="' + _esc(primary.action) + '"'
        + ' data-rec-id="' + _esc(recordId) + '"'
        + ' data-phone="' + _esc(phone) + '"'
        + ' title="' + _esc(primary.title) + '" aria-label="' + _esc(primary.title) + '">'
        + '<i class="ph-bold ph-' + _esc(primary.icon) + '" aria-hidden="true"></i>'
        + '</button>';
      html += '<button type="button" class="vx-requests-icon-action is-overflow"'
        + ' data-action="overflow" data-rec-id="' + _esc(recordId) + '" data-phone="' + _esc(phone) + '"'
        + ' title="Mehr" aria-label="Weitere Aktionen">'
        + '<i class="ph-bold ph-dots-three" aria-hidden="true"></i>'
        + '</button>';
      html += '<div class="vx-row-menu" id="vx-row-menu-' + _esc(recordId) + '">' + menuHtml + '</div>';
      html += '</div>';
      html += '</div>';
      html += '</article>';
    });
  });

  el.innerHTML = html;

  if (!el.dataset.requestsKeyboardBound) {
    el.addEventListener('keydown', function(event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var row = event.target && event.target.closest ? event.target.closest('.vx-requests-row') : null;
      if (!row || event.target.closest('button, [data-action]')) return;
      event.preventDefault();
      dprToggleClick(event, row);
    });
    el.dataset.requestsKeyboardBound = '1';
  }

  vxRenderInboxSelectionToolbar();
  vxUpdateAnfragenCount();
  if (window._vxActiveRecordId && typeof vxSetActiveRequestRow === 'function') {
    vxSetActiveRequestRow(window._vxActiveRecordId);
  }
  vxApplyPendingRowHighlight();
}`;

dashboard = replaceFunction(dashboard, 'renderAnrufeInbox', requestsRenderer);

const activeRowFunction = String.raw`function vxSetActiveRequestRow(recordId) {
  var activeId = recordId == null ? '' : String(recordId).trim();
  window._vxActiveRecordId = activeId || null;
  var selectors = [
    '#anrufe-list .vx-requests-item',
    '#anrufe-list .vx-requests-row',
    '#dash-priority-list .vx-ops-item'
  ].join(',');
  document.querySelectorAll(selectors).forEach(function(el) {
    var id = '';
    if (el && el.dataset) id = String(el.dataset.id || el.dataset.recordId || '');
    if (!id && el && el.closest) {
      var card = el.closest('.vx-requests-item, .vx-ops-item');
      id = card && card.dataset ? String(card.dataset.id || card.dataset.recordId || '') : '';
    }
    el.classList.toggle('sp-active', !!activeId && id === activeId);
  });
}`;

dashboard = replaceFunction(dashboard, 'vxSetActiveRequestRow', activeRowFunction);

dashboard = replaceInsideFunction(
  dashboard,
  'dprOpenAnfragenDetailFromRow',
  "var card = rowEl.closest('.dpr-card');",
  "var card = rowEl.closest('.vx-requests-item, .vx-ops-item, .dpr-card');"
);

dashboard = replaceInsideFunction(
  dashboard,
  'vxInboxResolveRowRecordId',
  "if (!recNode) recNode = target.closest('.vx-heute-row, .dpr-card');",
  "if (!recNode) recNode = target.closest('.vx-requests-row, .vx-requests-item, .vx-ops-item, .vx-heute-row, .dpr-card');"
);

dashboard = replaceInsideFunction(
  dashboard,
  'vxMarkRowAsUnread',
  "var card = rowEl.closest('.dpr-card') || rowEl;",
  "var card = rowEl.closest('.vx-requests-item, .vx-ops-item, .dpr-card') || rowEl;"
);

dashboard = replaceInsideFunction(
  dashboard,
  'vxHandleDprButtonClick',
  "var card = btn.closest('.dpr-card');",
  "var card = btn.closest('.vx-requests-item, .vx-ops-item, .dpr-card');"
);

dashboard = replaceInsideFunction(
  dashboard,
  'vxHandleDprButtonClick',
  "var vxRow = btn.closest ? (btn.closest('.vx-heute-row') || btn.closest('.vx-anf-row')) : null;",
  "var vxRow = btn.closest ? (btn.closest('.vx-requests-row') || btn.closest('.vx-heute-row') || btn.closest('.vx-anf-row')) : null;"
);

let removedLegacyRules = 0;
function removeRequestsLegacyRules(css) {
  return css.replace(/([^{}]+)\{([^{}]*)\}/g, (full, rawSelector) => {
    const selector = rawSelector.replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
    if (!selector || selector.startsWith('@')) return full;
    const selectors = selector.split(',').map((part) => part.trim()).filter(Boolean);
    if (!selectors.length) return full;
    const forbidden = /#archiv|#dash-|#tab-dashboard|#requests-detail-v2|#call-detail|\.vxd-|\.vx-detail/;
    const isLegacyRequestSelector = (part) => {
      if (forbidden.test(part)) return false;
      if (part.includes('.dpr-command-center')) return true;
      if (part.includes('.vx-anf-')) return true;
      if (part.includes('#anrufe-list')) return true;
      if (part.includes('#anrufe-split-left')) return true;
      if (part.includes('#tab-anrufe') && /\.dpr-|\.vx-heute-row|\.vx-row-|\.vx-anf-/.test(part)) return true;
      return false;
    };
    if (!selectors.every(isLegacyRequestSelector)) return full;
    removedLegacyRules += 1;
    return '';
  });
}

dashboard = dashboard.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (full, attributes, css) => {
  const updatedCss = removeRequestsLegacyRules(css);
  return `<style${attributes}>${updatedCss}</style>`;
});

const requestsCss = String.raw`

/* Customer requests: assistant-aligned canonical component owner. */
body.vx-customer-design-foundation .vx-requests-layout {
  display: grid;
  grid-template-columns: minmax(360px, 0.92fr) minmax(0, 1.08fr);
  align-items: stretch;
  gap: 16px;
  min-width: 0;
  min-height: 560px;
}

body.vx-customer-design-foundation .vx-requests-panel,
body.vx-customer-design-foundation .vx-requests-detail-panel {
  min-width: 0;
  padding: 0;
  overflow: hidden;
}

body.vx-customer-design-foundation .vx-requests-filters {
  margin: 0;
  padding: 16px 16px 8px;
}

body.vx-customer-design-foundation #tab-anrufe .vx-ap-filter.vx-chip {
  flex: 1 1 0;
  min-width: 92px;
}

body.vx-customer-design-foundation #tab-anrufe .vx-ap-filter.vx-chip.vx-chip--active {
  border-color: var(--vx-brand);
  background: var(--vx-brand);
  color: #ffffff;
}

body.vx-customer-design-foundation .vx-requests-subfilters {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px 12px;
}

body.vx-customer-design-foundation .vx-requests-subfilters .vx-ap-filter {
  flex: 0 1 auto;
}

body.vx-customer-design-foundation .vx-requests-search {
  padding: 0 16px 16px;
}

body.vx-customer-design-foundation .vx-requests-search-box {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  box-sizing: border-box;
  min-height: 48px;
  padding: 0 12px;
  border: 1px solid var(--vx-line);
  border-radius: var(--vx-radius-control);
  background: #ffffff;
}

body.vx-customer-design-foundation .vx-requests-search-icon {
  color: var(--vx-subtle);
  font-size: 19px;
}

body.vx-customer-design-foundation .vx-requests-search-input {
  min-width: 0;
  min-height: 44px;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  box-shadow: none;
}

body.vx-customer-design-foundation .vx-requests-search-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  border-radius: 10px;
  background: #f1f5f9;
  color: var(--vx-muted);
  cursor: pointer;
}

body.vx-customer-design-foundation .vx-requests-scroll {
  min-height: 0;
  max-height: 720px;
  overflow: auto;
  border-top: 1px solid var(--vx-line);
  overscroll-behavior: contain;
}

body.vx-customer-design-foundation .vx-requests-list {
  gap: 0;
  margin-top: 0;
}

body.vx-customer-design-foundation .vx-requests-date {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  padding: 10px 16px;
  border-bottom: 1px solid var(--vx-line);
  background: #f8fafc;
  font-weight: 700;
}

body.vx-customer-design-foundation .vx-requests-item {
  padding: 0;
  border: 0;
  border-bottom: 1px solid var(--vx-line);
  border-radius: 0;
  background: #ffffff;
  box-shadow: none;
  transition: background 120ms ease, box-shadow 120ms ease;
}

body.vx-customer-design-foundation .vx-requests-item:last-child {
  border-bottom: 0;
}

body.vx-customer-design-foundation .vx-requests-item:hover,
body.vx-customer-design-foundation .vx-requests-item.sp-active {
  background: #f5f8ff;
}

body.vx-customer-design-foundation .vx-requests-item.sp-active {
  box-shadow: inset 3px 0 0 var(--vx-brand);
}

body.vx-customer-design-foundation .vx-requests-item.is-unread {
  background: #fbfdff;
}

body.vx-customer-design-foundation .vx-requests-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: flex-start;
  gap: 12px;
  min-width: 0;
  padding: 16px;
  cursor: pointer;
}

body.vx-customer-design-foundation .vx-requests-row:focus-visible {
  outline: 3px solid rgba(52, 120, 237, 0.24);
  outline-offset: -3px;
}

body.vx-customer-design-foundation .vx-requests-icon {
  width: 42px;
  height: 42px;
  margin-top: 1px;
}

body.vx-customer-design-foundation .vx-requests-icon.is-call {
  background: #eef4ff;
  color: var(--vx-brand);
}

body.vx-customer-design-foundation .vx-requests-copy {
  min-width: 0;
}

body.vx-customer-design-foundation .vx-requests-title-line {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

body.vx-customer-design-foundation .vx-requests-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

body.vx-customer-design-foundation .vx-requests-time {
  flex: 0 0 auto;
  margin-top: 1px;
  white-space: nowrap;
}

body.vx-customer-design-foundation .vx-requests-company {
  margin-top: 2px;
}

body.vx-customer-design-foundation .vx-requests-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

body.vx-customer-design-foundation .vx-requests-pill.is-new {
  background: #eff6ff;
  color: #1d4ed8;
}

body.vx-customer-design-foundation .vx-requests-pill.is-planned {
  background: #fff7ed;
  color: #9a3412;
}

body.vx-customer-design-foundation .vx-requests-pill.is-done {
  background: #ecfdf5;
  color: #047857;
}

body.vx-customer-design-foundation .vx-requests-pill.is-hot {
  background: #fef2f2;
  color: #b91c1c;
}

body.vx-customer-design-foundation .vx-requests-pill.is-warm {
  background: #fffbeb;
  color: #a16207;
}

body.vx-customer-design-foundation .vx-requests-preview {
  margin-top: 8px;
}

body.vx-customer-design-foundation .vx-requests-meta {
  margin-top: 7px;
}

body.vx-customer-design-foundation .vx-requests-actions {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding-top: 1px;
}

body.vx-customer-design-foundation .vx-requests-icon-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 0;
  border-radius: 12px;
  background: #eef4ff;
  color: var(--vx-brand);
  cursor: pointer;
}

body.vx-customer-design-foundation .vx-requests-icon-action.is-call {
  background: var(--vx-brand-dark);
  color: #ffffff;
}

body.vx-customer-design-foundation .vx-requests-icon-action.is-done {
  background: #ecfdf5;
  color: #047857;
}

body.vx-customer-design-foundation .vx-requests-icon-action.is-overflow {
  background: #f1f5f9;
  color: var(--vx-muted);
}

body.vx-customer-design-foundation .vx-requests-actions > .vx-row-menu {
  display: none;
}

body.vx-customer-design-foundation .vx-requests-empty,
body.vx-customer-design-foundation .vx-requests-detail-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 220px;
  border: 0;
}

body.vx-customer-design-foundation .vx-requests-empty i,
body.vx-customer-design-foundation .vx-requests-detail-empty i {
  color: var(--vx-brand);
  font-size: 28px;
}

body.vx-customer-design-foundation .vx-requests-detail-panel {
  display: flex;
  flex-direction: column;
}

body.vx-customer-design-foundation .vx-requests-detail {
  min-width: 0;
}

body.vx-customer-design-foundation .vx-requests-resizer {
  display: none;
}

@media (max-width: 980px) {
  body.vx-customer-design-foundation .vx-requests-layout {
    grid-template-columns: minmax(0, 1fr);
    min-height: 0;
  }

  body.vx-customer-design-foundation .vx-requests-detail-panel {
    display: none;
  }

  body.vx-customer-design-foundation .vx-requests-scroll {
    max-height: none;
  }
}

@media (max-width: 720px) {
  body.vx-customer-design-foundation .vx-requests-filters {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    padding: 14px 14px 8px;
  }

  body.vx-customer-design-foundation #tab-anrufe .vx-ap-filter.vx-chip {
    width: 100%;
    min-width: 0;
    padding-right: 8px;
    padding-left: 8px;
  }

  body.vx-customer-design-foundation .vx-requests-subfilters {
    padding: 0 14px 12px;
  }

  body.vx-customer-design-foundation .vx-requests-search {
    padding: 0 14px 14px;
  }

  body.vx-customer-design-foundation .vx-requests-row {
    grid-template-columns: auto minmax(0, 1fr);
    gap: 11px;
    padding: 15px 14px;
  }

  body.vx-customer-design-foundation .vx-requests-actions {
    grid-column: 2;
    justify-content: flex-end;
    padding-top: 2px;
  }

  body.vx-customer-design-foundation .vx-requests-title-line {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
  }

  body.vx-customer-design-foundation .vx-requests-time {
    white-space: normal;
  }
}

@media (max-width: 390px) {
  body.vx-customer-design-foundation .vx-requests-icon {
    width: 38px;
    height: 38px;
  }

  body.vx-customer-design-foundation .vx-requests-row {
    gap: 9px;
    padding-right: 12px;
    padding-left: 12px;
  }
}
`;

assert.ok(!assistantCss.includes('Customer requests: assistant-aligned canonical component owner.'), 'requests CSS already exists');
assistantCss = assistantCss.trimEnd() + requestsCss + '\n';

for (const [name, expectedHash] of protectedFunctions) {
  assert.equal(hash(getFunction(dashboard, name)), expectedHash, `protected detail function changed: ${name}`);
}
for (const [name, expectedHash] of protectedWindows) {
  const token = name === 'loading' ? 'Bitte einen Moment'
    : name === 'dashboard' ? 'id="tab-dashboard"'
    : name === 'report' ? 'id="tab-auswertung"'
    : 'id="tab-mehr"';
  const before = name === 'loading' ? 2200 : 200;
  const after = name === 'loading' ? 6200 : name === 'report' ? 12000 : name === 'settings' ? 10000 : 9000;
  assert.equal(hash(windowAround(dashboard, token, before, after)), expectedHash, `protected surface changed: ${name}`);
}

const migratedRenderer = getFunction(dashboard, 'renderAnrufeInbox');
for (const forbidden of [
  'dpr-command-center',
  'class="dpr-card',
  'vx-heute-row',
  'vx-anf-row',
  'vx-row-name',
  'vx-row-summary',
  'style="'
]) {
  assert.ok(!migratedRenderer.includes(forbidden), `requests renderer still contains legacy presentation: ${forbidden}`);
}
for (const required of [
  'vx-requests-item',
  'vx-requests-row',
  'vx-ops-title',
  'vx-ops-pill',
  'vx-requests-icon-action'
]) {
  assert.ok(migratedRenderer.includes(required), `requests renderer missing canonical token: ${required}`);
}
assert.ok(dashboard.includes('class="vx-requests-layout"'), 'requests host not migrated');
assert.ok(dashboard.includes('class="vx-ops-card vx-requests-panel"'), 'requests panel not migrated');
assert.ok(dashboard.includes('class="vx-ops-list vx-requests-list" id="anrufe-list"'), 'requests list host not migrated');
assert.ok(removedLegacyRules >= 5, `too few legacy requests rules removed: ${removedLegacyRules}`);
assert.ok(removedLegacyRules < 400, `legacy cleanup scope too broad: ${removedLegacyRules}`);
assert.equal((assistantCss.match(/!important/g) || []).length, 0, 'assistant CSS must not add !important');
assert.ok(assistantCss.length > originalAssistantCss.length, 'canonical requests CSS was not added');
assert.ok(dashboard.length < originalDashboard.length + 30000, 'requests migration unexpectedly increased index size');

fs.writeFileSync(indexPath, dashboard, 'utf8');
fs.writeFileSync(assistantCssPath, assistantCss, 'utf8');

console.log(JSON.stringify({
  removedLegacyRules,
  indexBytesBefore: originalDashboard.length,
  indexBytesAfter: dashboard.length,
  assistantCssBytesBefore: originalAssistantCss.length,
  assistantCssBytesAfter: assistantCss.length
}, null, 2));
