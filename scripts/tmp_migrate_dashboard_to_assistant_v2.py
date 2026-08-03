from __future__ import annotations

from pathlib import Path
import hashlib
import re

SOURCE_PATH = Path('customer-dashboard/index.html')
REPORT_ROOT = Path('tmp/dashboard-migration-v2')
source = SOURCE_PATH.read_text(encoding='utf-8')
original = source


def read_report_body(path: Path) -> str:
    text = path.read_text(encoding='utf-8')
    if '\n\n' not in text:
        raise AssertionError(f'Missing report header separator: {path}')
    return text.split('\n\n', 1)[1].rstrip('\n')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise AssertionError(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


def shared_fingerprints(text: str) -> dict[str, str]:
    style_pattern = re.compile(r'<style\b[^>]*>(.*?)</style>', re.S | re.I)
    rule_pattern = re.compile(r'([^{}]+)\{([^{}]*)\}', re.S)
    groups = {
        'login': ('login', 'auth-card', 'login-card'),
        'loading': ('loading', 'splash', 'boot'),
        'sidebar': ('sidebar', 'side-nav'),
        'mobile_navigation': ('mobile-nav', 'bottom-nav', 'mobile-bottom'),
        'tour': ('tour', 'onboarding-modal', 'tour-modal'),
    }
    result: dict[str, str] = {}
    for name, needles in groups.items():
        relevant: list[str] = []
        for style in style_pattern.finditer(text):
            for rule in rule_pattern.finditer(style.group(1)):
                selector = ' '.join(rule.group(1).split())
                if any(needle in selector.lower() for needle in needles):
                    relevant.append(selector + '{' + rule.group(2) + '}')
        payload = '\n'.join(relevant)
        result[name] = f'{len(relevant)}:{hashlib.sha256(payload.encode()).hexdigest()}'
    return result


shared_before = shared_fingerprints(source)
expected_shared = {
    'login': '35:f376b50f6f91100569ba5c4039aa4ec3e0fa28c5940c372678c8d744b70dff20',
    'loading': '23:02024221cbbf18fc06763f4c113b81333b6293d7c946adf25e8de973d294e86e',
    'sidebar': '40:302f2da02dea215e26666c5d05b1e3346296e35f504bcf889ae62c0e65f44003',
    'mobile_navigation': '34:f26f59c4e814972e5f592e376b2d1646cabf22a209dc95bd66843f3fba240783',
    'tour': '1:75850564de748ce391ca5095f2280d0eecf421de32cb869353ebe916adc24128',
}
if shared_before != expected_shared:
    raise AssertionError(f'Shared surface baseline changed before migration: {shared_before}')


old_host = read_report_body(REPORT_ROOT / 'host.txt')
new_host = '''<div class="tab-page active" id="tab-dashboard">
          <!-- FSE card removed – first-login goes directly to Einrichtung tab -->
          <div id="dashboard-fse" style="display:none!important;">
            <div id="dashboard-fse-note"></div>
            <button id="dashboard-fse-primary" style="display:none;"></button>
            <button id="dashboard-fse-secondary" style="display:none;"></button>
            <li id="fse-progress-forwarding" style="display:none;"></li>
            <li id="fse-progress-testcall" style="display:none;"></li>
            <li id="fse-progress-ready" style="display:none;"></li>
          </div>
          <div id="dash-loading" class="loading-wrap">
            <div class="loading-card">
              <div class="skel-wrap" style="padding:0;">
                <div class="skel skel-hero" style="border-radius:20px 20px 0 0;"></div>
                <div class="skel-kpi-row" style="padding:14px 14px 0;">
                  <div class="skel skel-kpi"></div>
                  <div class="skel skel-kpi"></div>
                  <div class="skel skel-kpi"></div>
                  <div class="skel skel-kpi"></div>
                </div>
                <div class="skel-glass skel-rows" style="margin:14px 14px 14px;border-radius:var(--r-lg);">
                  <div class="skel-hd"><div class="skel skel-hd-title"></div><div class="skel skel-hd-link"></div></div>
                  <div class="skel-row"><div class="skel skel-avatar"></div><div class="skel-body"><div class="skel skel-line-a"></div><div class="skel skel-line-b"></div></div><div class="skel skel-badge"></div></div>
                  <div class="skel-row"><div class="skel skel-avatar"></div><div class="skel-body"><div class="skel skel-line-a" style="width:42%;"></div><div class="skel skel-line-b" style="width:28%;"></div></div><div class="skel skel-badge"></div></div>
                  <div class="skel-row"><div class="skel skel-avatar"></div><div class="skel-body"><div class="skel skel-line-a" style="width:63%;"></div><div class="skel skel-line-b" style="width:38%;"></div></div><div class="skel skel-badge"></div></div>
                </div>
              </div>
            </div>
          </div>
          <div id="dash-content" class="vx-ap-stack" style="display:none">
            <div id="live-hero" data-state="" hidden style="display:none!important;" aria-hidden="true">
              <span id="live-hero-state-label"></span><span id="live-hero-title"></span><span id="live-hero-sub"></span><span id="live-hero-counter"></span><span id="live-hero-counter-label"></span>
            </div>
            <div id="dash-activation-card" hidden style="display:none!important;" aria-hidden="true">
              <div id="dash-activation-title"></div><div id="dash-activation-text"></div><div><a id="dash-activation-primary" style="display:none;"></a></div>
            </div>

            <section id="dash-greeting-block" class="vx-page-header">
              <div class="vx-ap-head">
                <div>
                  <div id="dash-greeting-title" class="vx-page-header-title"></div>
                  <div id="dash-greeting-sub" class="vx-page-header-subtitle"></div>
                </div>
                <div id="dash-datetime-label" class="vx-page-header-subtitle"></div>
              </div>
            </section>

            <div id="dash-reach-warning" class="vx-ops-status warning" hidden></div>

            <div id="dash-kpi-strip" class="vx-ap-grid">
              <div class="vx-ap-card" id="kpi-cell-callbacks">
                <div id="kpi-callbacks-label" class="vx-ap-meta">Anrufe heute</div>
                <div id="kpi-callbacks-new" class="vx-ap-title">–</div>
                <div id="kpi-callbacks-note" class="vx-ap-meta">Eingänge seit Tagesbeginn</div>
              </div>
              <div class="vx-ap-card" id="kpi-cell-today">
                <div id="kpi-today-label" class="vx-ap-meta">Offene Anfragen</div>
                <div id="kpi-today-new" class="vx-ap-title">–</div>
                <div id="kpi-today-note" class="vx-ap-meta">Nicht bearbeitet</div>
              </div>
              <div class="vx-ap-card" id="kpi-cell-due">
                <div id="kpi-due-bar-new" hidden></div>
                <div id="kpi-done-label" class="vx-ap-meta">Wichtig jetzt</div>
                <div id="kpi-done-new" class="vx-ap-title">–</div>
                <div id="kpi-done-note" class="vx-ap-meta">Priorisiert oder überfällig</div>
              </div>
              <div class="vx-ap-card" id="kpi-cell-completed">
                <div id="kpi-reach-bar-new" hidden></div>
                <div id="kpi-completed-label" class="vx-ap-meta">Erledigt heute</div>
                <div id="kpi-reach-val" class="vx-ap-title">–</div>
                <div id="kpi-reach-label" class="vx-ap-meta">Heute abgeschlossen</div>
              </div>
            </div>

            <div id="dash-daily-report" hidden style="display:none!important;" aria-hidden="true"><div id="dash-daily-report-text"></div></div>
            <div id="dash-focus-zone" hidden style="display:none;" aria-hidden="true"></div>

            <section id="dash-priority-section" class="vx-ops-card">
              <div class="vx-ap-head">
                <div>
                  <div class="vx-ops-title">Aufmerksamkeit</div>
                  <div class="vx-ops-sub">Einmalig priorisierte Anfragen und Aufgaben.</div>
                </div>
                <button type="button" class="vx-ap-btn secondary" onclick="vxDashShowAllImportant(event);">Alle anzeigen</button>
              </div>
              <div id="dash-priority-list" class="vx-ops-list"></div>
              <div class="vx-ap-actions">
                <button id="dash-recent-more" type="button" onclick="vxDashShowAllImportant(event);" class="vx-ap-btn secondary" hidden>Alle offenen Punkte anzeigen</button>
              </div>
            </section>

            <section id="dash-activity-section" class="vx-ops-card">
              <div class="vx-ap-head">
                <div>
                  <div class="vx-ops-title">Heute passiert</div>
                  <div class="vx-ops-sub">Chronologischer Verlauf der heutigen Anfragen und Abschlüsse.</div>
                </div>
                <span id="dash-activity-count" class="vx-ops-pill">0</span>
              </div>
              <div id="dash-activity-list" class="vx-ops-list"></div>
              <div class="vx-ops-note">Die nächste Arbeitsentscheidung befindet sich oben unter Aufmerksamkeit.</div>
            </section>

            <section id="dash-today-calls-section" class="vx-ops-card" style="display:none;">
              <div class="vx-ap-head"><div class="vx-ops-title">Anrufe heute</div><span id="dash-today-calls-count" class="vx-ops-pill">0</span></div>
              <div id="dash-today-calls-list" class="vx-ops-list"></div>
            </section>

            <section id="dash-today-done-section" class="vx-ops-card" style="display:none;">
              <div class="vx-ap-head"><div class="vx-ops-title">Heute erledigt</div><span id="dash-today-done-count" class="vx-ops-pill active">0</span></div>
              <div id="dash-today-done-list" class="vx-ops-list"></div>
            </section>

            <div id="dash-sparkline-section" hidden aria-hidden="true"><div id="dash-sparkline"></div><div id="dash-sparkline-labels"></div><div id="dash-sparkline-block"></div></div>
            <div hidden aria-hidden="true"><div id="dash-callback-list"></div><div id="dash-recent-list"></div></div>
            <div hidden aria-hidden="true">
              <div id="dash-status-hero"><div id="dash-status-title"></div><div id="dash-status-text"></div><span id="dash-status-chip-primary"></span><span id="dash-status-chip-secondary"></span></div>
              <div id="dash-focus-card"><div id="dash-focus-label"></div><div id="dash-focus-datetime"></div><div id="dash-focus-number"></div><div id="dash-focus-hint"></div><div id="dash-focus-text"></div><div id="dash-focus-next"></div><div id="dash-focus-status"></div></div>
            </div>
          </div>
        </div>

        '''
source = replace_once(source, old_host, new_host, 'dashboard host')


old_priority = read_report_body(REPORT_ROOT / 'functions' / 'renderDashPriorityList-1.txt')
new_priority = r'''function renderDashPriorityList() {
  var el = document.getElementById('dash-priority-list');
  if (!el) return;

  var records = (_dashPriorityAllRecords || []).filter(function(rec){ return isManualTaskRecord(rec) || isCustomerVisibleCall(rec); });
  var tempRecords = [];

  if (records.length === 0 && tempRecords.length === 0) {
    vxSetHtmlIfChanged(el, '<div class="vx-ops-empty">Alles erledigt &mdash; ' + getAssistantName() + ' nimmt neue Anrufe entgegen.</div>');
    refreshLucideIcons();
    return;
  }

  var limit = dashPriorityExpanded ? 999 : 5;
  var visible = records.slice(0, limit);
  var tempKeys = new Set();
  tempRecords.forEach(function(rec){
    var f = (rec && rec.fields) || {};
    var recIdKey = String((rec && rec.id) || '').trim();
    var callIdKey = String(f.call_id || '').trim();
    if (recIdKey) tempKeys.add(recIdKey);
    if (callIdKey) tempKeys.add(callIdKey);
  });
  var groups = { overdue: [], today: [], planned: [], calls: [] };
  var groupOrder = ['overdue', 'today', 'planned', 'calls'];

  visible.forEach(function(rec) {
    var keyF = (rec && rec.fields) || {};
    var recIdKey = String(rec.id || '').trim();
    var callIdKey = String(keyF.call_id || '').trim();
    if ((recIdKey && tempKeys.has(recIdKey)) || (callIdKey && tempKeys.has(callIdKey))) return;
    var typeMeta = vxDashGetCommandTypeMeta(rec);
    var dueMeta = vxDashGetDueMeta(rec, typeMeta);
    var key = groups[dueMeta.group] ? dueMeta.group : 'today';
    groups[key].push({ record: rec, typeMeta: typeMeta, dueMeta: dueMeta });
  });

  var html = '';

  if (tempRecords.length) {
    html += '<section class="vx-ap-stack" data-dashboard-group="calls">';
    html += '<div class="vx-ap-head"><div class="vx-ops-title">Laufende Anrufe</div><span class="vx-ops-pill active">' + tempRecords.length + '</span></div>';
    tempRecords.slice(0, 3).forEach(function(rec){
      var f = rec.fields || {};
      var st = (typeof vxGetCallDisplayState === 'function' ? vxGetCallDisplayState(rec) : null) || (typeof vxGetDefaultCallDisplayState === 'function' ? vxGetDefaultCallDisplayState() : { state:'ready', label:'Neu', isTemporary:false });
      var name = vxDashResolveWorkTitle(rec);
      var phone = String(f.caller_phone || f.phone_number || f.phone || '').trim();
      var summaryText = st.state === 'live' ? 'Der Assistent nimmt den Anruf gerade entgegen.' : 'Zusammenfassung wird erstellt.';
      html += '<article class="vx-ops-item" data-id="'+_esc(rec.id)+'" data-phone="'+_esc(phone)+'" data-kind="incoming">';
      html += '<div class="vx-ops-head" onclick="dprToggleClick(event,this)" ontouchstart="dprToggleTouchStart(event,this)" ontouchmove="dprToggleTouchMove(event)" ontouchend="dprToggleTouchEnd(event,this)" data-id="'+_esc(rec.id)+'" data-record-id="'+_esc(rec.id)+'">';
      html += '<div><div class="vx-ops-title">'+_esc(name)+'</div><div class="vx-ops-meta">'+_esc(summaryText)+'</div></div>';
      html += '<span class="vx-ops-pill active">'+_esc(st.label)+'</span></div></article>';
    });
    html += '</section>';
  }

  var visibleActionIndex = 0;
  groupOrder.forEach(function(groupKey) {
    var items = groups[groupKey] || [];
    if (!items.length) return;
    html += '<section class="vx-ap-stack" data-dashboard-group="' + groupKey + '">';
    html += '<div class="vx-ap-head"><div class="vx-ops-title">' + _esc(vxDashGroupLabel(groupKey)) + '</div><span class="vx-ops-pill">' + items.length + '</span></div>';

    items.forEach(function(item) {
      var rec = item.record;
      var f = rec.fields || {};
      var typeMeta = item.typeMeta;
      var dueMeta = item.dueMeta;
      var phone = String(f.caller_phone || f.phone_number || f.phone || '').trim();
      var name = vxDashResolveWorkTitle(rec);
      var company = (f.company_name && f.caller_name && f.company_name !== f.caller_name) ? f.company_name : '';
      var rawSummary = String(f.call_summary || f.summary || f.note || f.notes || '').trim();
      var summary = rawSummary && !vxDashIsGenericLabel(rawSummary)
        ? (rawSummary.length > 120 ? rawSummary.slice(0, 117).trim() + '…' : rawSummary)
        : '';
      var metaParts = [];
      if (company) metaParts.push(company);
      if (phone && name !== phone) metaParts.push(phone);
      if (dueMeta && dueMeta.value) metaParts.push(dueMeta.value);
      var isUnreadCall = (typeof vxIsUnreadRecord === 'function') ? vxIsUnreadRecord(rec) : (!isManualTaskRecord(rec) && !f.read_at);

      var isTopAttention = visibleActionIndex === 0;
      visibleActionIndex += 1;
      var primary = (typeof vxTodayGetPrimaryAction === 'function')
        ? vxTodayGetPrimaryAction(rec, typeMeta, phone)
        : { action:(phone ? 'call' : 'open'), title:(phone ? 'Anrufen' : 'Öffnen'), icon:(phone ? 'phone-call' : 'arrow-square-out') };
      var primaryClass = 'vx-ops-btn' + ((primary.action === 'call' && isTopAttention) ? '' : ' secondary');

      html += '<article class="vx-ops-item" data-id="'+_esc(rec.id)+'" data-phone="'+_esc(phone)+'" data-kind="'+_esc(typeMeta.kind)+'">';
      html += '<div class="vx-ops-head" onclick="dprToggleClick(event,this)" ontouchstart="dprToggleTouchStart(event,this)" ontouchmove="dprToggleTouchMove(event)" ontouchend="dprToggleTouchEnd(event,this)" data-id="'+_esc(rec.id)+'" data-record-id="'+_esc(rec.id)+'">';
      html += '<div><div class="vx-ops-title">'+_esc(name)+'</div>';
      if (metaParts.length) html += '<div class="vx-ops-meta">'+metaParts.map(_esc).join(' · ')+'</div>';
      html += '</div><span class="vx-ops-pill'+(isUnreadCall?' active':'')+'">'+_esc(typeMeta.label)+'</span></div>';
      if (summary) html += '<div class="vx-ops-message">'+_esc(summary)+'</div>';
      html += '<div class="vx-ops-actions vx-row-btns">';
      html += '<button type="button" class="'+primaryClass+'" data-action="'+_esc(primary.action)+'" data-rec-id="'+_esc(rec.id)+'" data-phone="'+_esc(phone)+'"><i class="ph-bold ph-'+_esc(primary.icon)+'"></i><span>'+_esc(primary.title)+'</span></button>';
      html += '<button type="button" class="vx-ops-btn secondary" data-action="overflow" data-rec-id="'+_esc(rec.id)+'" data-phone="'+_esc(phone)+'" aria-label="Mehr Aktionen"><i class="ph-bold ph-dots-three"></i></button>';
      html += '<div class="vx-row-menu" id="vx-row-menu-'+_esc(rec.id)+'">';
      html += (typeof vxTodayBuildRowMenuHtml === 'function')
        ? vxTodayBuildRowMenuHtml(rec, phone, typeMeta)
        : '<button type="button" data-action="fulldetail" data-rec-id="'+_esc(rec.id)+'">Details öffnen</button>';
      html += '</div></div></article>';
    });
    html += '</section>';
  });

  vxSetHtmlIfChanged(el, html);

  el.querySelectorAll('.vx-ops-item[data-id]').forEach(function(item) {
    item.addEventListener('click', function(e) {
      if (e.target.closest('button, .vx-row-menu')) return;
      var recId = item.dataset.id;
      if (!recId) return;
      var rec = typeof vxResolveDprRecord === 'function' ? vxResolveDprRecord(recId) : null;
      if (rec && isManualTaskRecord(rec)) {
        if (typeof showTaskDetail === 'function') { e.stopPropagation(); showTaskDetail(recId); }
      } else if (typeof showCallDetail === 'function') {
        e.stopPropagation();
        showCallDetail(recId);
      }
    });
  });

  vxUpdateAnfragenCount();
  var existingLive = document.getElementById('live-call-row');
  if (existingLive && existingLive.parentNode === el) el.insertBefore(existingLive, el.firstChild);
  refreshLucideIcons();
}'''
source = replace_once(source, old_priority, new_priority, 'priority renderer')


old_activity = read_report_body(REPORT_ROOT / 'functions' / 'vxHeuteRenderActivityList-1.txt')
new_activity = r'''function vxHeuteRenderActivityList(records) {
  var section = document.getElementById('dash-activity-section');
  var list = document.getElementById('dash-activity-list');
  var countEl = document.getElementById('dash-activity-count');
  if (!section || !list) return;
  var rows = vxHeuteDedupeByStableId(records || []).filter(Boolean).sort(function(a,b){
    return (new Date(vxHeuteActivityTimestamp(b) || 0).getTime() || 0) - (new Date(vxHeuteActivityTimestamp(a) || 0).getTime() || 0);
  }).slice(0, 25);
  section.style.display = '';
  if (countEl) countEl.textContent = String(rows.length || 0);
  if (!rows.length) {
    vxSetHtmlIfChanged(list, '<div class="vx-ops-empty">Heute gibt es noch keinen Verlauf.</div>');
    return;
  }
  var html = rows.map(function(rec){
    var id = String((rec && rec.id) || vxHeuteGetRecordValue(rec, ['id','call_id']) || '');
    var label = vxHeuteActivityLabel(rec);
    var title = vxHeuteRecordTitle(rec);
    var summary = vxHeuteRecordSummary(rec);
    var time = vxHeuteActivityTime(rec);
    var isDone = label === 'Erledigt';
    return '<article class="vx-ops-item" data-id="'+_esc(id)+'" data-record-id="'+_esc(id)+'">'
      + '<div class="vx-ops-head"><div><div class="vx-ops-title">'+_esc(title)+'</div>'
      + '<div class="vx-ops-meta">'+_esc(time || '–')+'</div></div>'
      + '<span class="vx-ops-pill'+(isDone?' active':'')+'">'+_esc(label)+'</span></div>'
      + (summary ? '<div class="vx-ops-message">'+_esc(summary)+'</div>' : '')
      + '</article>';
  }).join('');
  vxSetHtmlIfChanged(list, html);
  list.querySelectorAll('.vx-ops-item[data-record-id]').forEach(function(row){
    row.addEventListener('click', function(){
      var recId = row.dataset.recordId || row.dataset.id;
      var rec = typeof vxResolveDprRecord === 'function' ? vxResolveDprRecord(recId) : null;
      if (rec && isManualTaskRecord(rec)) { if (typeof showTaskDetail === 'function') showTaskDetail(recId); }
      else if (typeof showCallDetail === 'function') showCallDetail(recId);
    });
  });
  refreshLucideIcons();
}'''
source = replace_once(source, old_activity, new_activity, 'activity renderer')


old_active_row = read_report_body(REPORT_ROOT / 'functions' / 'vxSetActiveRequestRow-1.txt')
new_active_row = old_active_row.replace(
    "    '#dash-priority-list .dpr-card'",
    "    '#dash-priority-list .vx-ops-item'"
).replace(
    "var card = el.closest('.dpr-card');",
    "var card = el.closest('.dpr-card, .vx-ops-item');"
)
if new_active_row == old_active_row:
    raise AssertionError('active row selector was not updated')
source = replace_once(source, old_active_row, new_active_row, 'active row selector')
source = replace_once(source, "rowEl.closest('.dpr-card')", "rowEl.closest('.dpr-card, .vx-ops-item')", 'click card lookup')
source = replace_once(source, "rowEl.closest('.dpr-card')", "rowEl.closest('.dpr-card, .vx-ops-item')", 'touch card lookup')


old_dashboard = read_report_body(REPORT_ROOT / 'functions' / 'renderDashboard-1.txt')
new_dashboard = old_dashboard
new_dashboard = replace_once(new_dashboard, "var kpiCellCompleted = kpiReachVal ? kpiReachVal.closest('.vx-kpi-cell') : null;", "var kpiCellCompleted = document.getElementById('kpi-cell-completed');", 'completed KPI lookup')
new_dashboard = replace_once(new_dashboard, "  if (kpiCellCallbacks) kpiCellCallbacks.style.borderTop = heuteTodayCallRecords.length > 0 ? '2px solid var(--vx-blue)' : '2px solid rgba(148,163,184,.45)';\n  if (kpiCb) { kpiCb.textContent = String(heuteTodayCallRecords.length || 0); kpiCb.style.color = heuteTodayCallRecords.length > 0 ? '#1A6FE8' : '#94A3B8'; }", "  if (kpiCb) kpiCb.textContent = String(heuteTodayCallRecords.length || 0);", 'calls KPI presentation')
new_dashboard = replace_once(new_dashboard, "  if (kpiCellToday) kpiCellToday.style.borderTop = heuteKpis.callbacksOpen > 0 ? '2px solid var(--vx-red)' : '2px solid rgba(148,163,184,.45)';\n  if (kpiTd) { kpiTd.textContent = String(heuteKpis.callbacksOpen || 0); kpiTd.style.color = heuteKpis.callbacksOpen > 0 ? '#DC2626' : '#94A3B8'; }", "  if (kpiTd) kpiTd.textContent = String(heuteKpis.callbacksOpen || 0);", 'open KPI presentation')
new_dashboard = replace_once(new_dashboard, "  if (kpiCellDue) kpiCellDue.style.borderTop = heuteKpis.importantNow > 0 ? '2px solid var(--vx-gold)' : '2px solid rgba(148,163,184,.45)';\n  if (kpiDueBar) kpiDueBar.style.background = heuteKpis.importantNow > 0 ? 'linear-gradient(90deg,#FCD34D,#D97706)' : 'linear-gradient(90deg,#CBD5E1,#94A3B8)';\n  if (kpiDn) { kpiDn.textContent = String(heuteKpis.importantNow || 0); kpiDn.style.color = heuteKpis.importantNow > 0 ? '#D97706' : '#94A3B8'; }", "  if (kpiDn) kpiDn.textContent = String(heuteKpis.importantNow || 0);", 'important KPI presentation')
new_dashboard = replace_once(new_dashboard, "  var kpiCompletedLabel = kpiCellCompleted ? kpiCellCompleted.querySelector('.vx-kpi-label') : null;", "  var kpiCompletedLabel = document.getElementById('kpi-completed-label');", 'completed KPI label')
new_dashboard = replace_once(new_dashboard, "  if (kpiReachVal) {\n    kpiReachVal.textContent = String(heuteDoneRecords.length || 0);\n    kpiReachVal.style.fontSize = '';\n    kpiReachVal.style.marginTop = '';\n    kpiReachVal.style.color = heuteDoneRecords.length > 0 ? '#059669' : '#94A3B8';\n  }\n  if (kpiReachLabel) kpiReachLabel.textContent = 'Heute abgeschlossen';\n  if (kpiCellCompleted) kpiCellCompleted.style.borderTop = heuteDoneRecords.length > 0 ? '2px solid #059669' : '2px solid rgba(148,163,184,.45)';\n  if (kpiReachBarNew) kpiReachBarNew.style.background = heuteDoneRecords.length > 0 ? 'linear-gradient(90deg,#34D399,#059669)' : 'linear-gradient(90deg,#CBD5E1,#94A3B8)';", "  if (kpiReachVal) kpiReachVal.textContent = String(heuteDoneRecords.length || 0);\n  if (kpiReachLabel) kpiReachLabel.textContent = 'Heute abgeschlossen';", 'completed KPI presentation')

reach_start = new_dashboard.index('  // Reachability warning banner')
reach_end = new_dashboard.index('  // Sparkline — last 7 days call volume', reach_start)
new_reach = '''  // Reachability warning banner — existing assistant status component.
  var warnBanner = document.getElementById('dash-reach-warning');
  if (warnBanner) {
    var showReachWarning = reach.daysSince !== null && reach.daysSince >= 7;
    warnBanner.hidden = !showReachWarning;
    warnBanner.textContent = showReachWarning
      ? 'Seit ' + reach.daysSince + ' Tagen ist kein Anruf eingegangen. Bitte prüfen Sie die Weiterleitung.'
      : '';
  }

'''
new_dashboard = new_dashboard[:reach_start] + new_reach + new_dashboard[reach_end:]

spark_start = new_dashboard.index('  // Sparkline — last 7 days call volume')
spark_end = new_dashboard.index('  // ── Recent Calls', spark_start)
new_dashboard = new_dashboard[:spark_start] + new_dashboard[spark_end:]

new_dashboard = replace_once(new_dashboard, "  if (kpiDn) {\n    kpiDn.textContent = String(visibleImportantCount || 0);\n    kpiDn.style.color = visibleImportantCount > 0 ? '#D97706' : '#94A3B8';\n  }\n  if (kpiCellDue) kpiCellDue.style.borderTop = visibleImportantCount > 0 ? '2px solid var(--vx-gold)' : '2px solid rgba(148,163,184,.45)';\n  if (kpiDueBar) kpiDueBar.style.background = visibleImportantCount > 0 ? 'linear-gradient(90deg,#FCD34D,#D97706)' : 'linear-gradient(90deg,#CBD5E1,#94A3B8)';", "  if (kpiDn) kpiDn.textContent = String(visibleImportantCount || 0);", 'visible important KPI presentation')
new_dashboard = replace_once(new_dashboard, "      moreBtn.style.display = 'block';\n      moreBtn.textContent = 'Alle ' + _dashPriorityAllRecords.length + ' offenen Punkte anzeigen';\n    } else {\n      moreBtn.style.display = 'none';", "      moreBtn.hidden = false;\n      moreBtn.textContent = 'Alle ' + _dashPriorityAllRecords.length + ' offenen Punkte anzeigen';\n    } else {\n      moreBtn.hidden = true;", 'more button visibility')

spark_visibility_start = new_dashboard.index('  // Sparkline section visibility')
spark_visibility_end = new_dashboard.index('  // ── Badges', spark_visibility_start)
new_dashboard = new_dashboard[:spark_visibility_start] + new_dashboard[spark_visibility_end:]

source = replace_once(source, old_dashboard, new_dashboard, 'dashboard renderer')


TARGET_SELECTOR_TOKENS = (
    '.vx-greeting-',
    '.vx-kpi-',
    '.vx-jetzt-',
    '.vx-activity-',
    '.vx-group-',
    '.vx-work-section',
    '.dash-glass',
    '.dash-empty',
)


def matching_brace(text: str, opening: int, limit: int) -> int:
    depth = 0
    quote = ''
    in_comment = False
    i = opening
    while i < limit:
        if in_comment:
            if text.startswith('*/', i):
                in_comment = False
                i += 2
                continue
            i += 1
            continue
        if quote:
            if text[i] == '\\':
                i += 2
                continue
            if text[i] == quote:
                quote = ''
            i += 1
            continue
        if text.startswith('/*', i):
            in_comment = True
            i += 2
            continue
        if text[i] in ('"', "'"):
            quote = text[i]
        elif text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise AssertionError('Unbalanced CSS braces while removing dashboard-only rules')


def split_selectors(value: str) -> list[str]:
    selectors: list[str] = []
    start = 0
    round_depth = 0
    square_depth = 0
    quote = ''
    i = 0
    while i < len(value):
        ch = value[i]
        if quote:
            if ch == '\\':
                i += 2
                continue
            if ch == quote:
                quote = ''
        elif ch in ('"', "'"):
            quote = ch
        elif ch == '(':
            round_depth += 1
        elif ch == ')':
            round_depth = max(0, round_depth - 1)
        elif ch == '[':
            square_depth += 1
        elif ch == ']':
            square_depth = max(0, square_depth - 1)
        elif ch == ',' and round_depth == 0 and square_depth == 0:
            selectors.append(value[start:i].strip())
            start = i + 1
        i += 1
    selectors.append(value[start:].strip())
    return [selector for selector in selectors if selector]


def collect_css_removals(css: str, start: int, end: int, removals: list[tuple[int, int]]) -> None:
    i = start
    while i < end:
        while i < end:
            if css[i].isspace():
                i += 1
                continue
            if css.startswith('/*', i):
                close_comment = css.find('*/', i + 2, end)
                if close_comment < 0:
                    return
                i = close_comment + 2
                continue
            break
        if i >= end:
            return
        prelude_start = i
        quote = ''
        paren = 0
        bracket = 0
        in_comment = False
        terminator = ''
        while i < end:
            if in_comment:
                if css.startswith('*/', i):
                    in_comment = False
                    i += 2
                    continue
                i += 1
                continue
            ch = css[i]
            if quote:
                if ch == '\\':
                    i += 2
                    continue
                if ch == quote:
                    quote = ''
                i += 1
                continue
            if css.startswith('/*', i):
                in_comment = True
                i += 2
                continue
            if ch in ('"', "'"):
                quote = ch
            elif ch == '(':
                paren += 1
            elif ch == ')':
                paren = max(0, paren - 1)
            elif ch == '[':
                bracket += 1
            elif ch == ']':
                bracket = max(0, bracket - 1)
            elif paren == 0 and bracket == 0 and ch in '{;':
                terminator = ch
                break
            i += 1
        if not terminator:
            return
        if terminator == ';':
            i += 1
            continue
        opening = i
        closing = matching_brace(css, opening, end)
        prelude = css[prelude_start:opening].strip()
        lower = prelude.lower()
        if lower.startswith(('@media', '@supports', '@container', '@layer', '@document')):
            collect_css_removals(css, opening + 1, closing, removals)
        elif not lower.startswith('@'):
            selectors = split_selectors(prelude)
            if selectors and all(any(token in selector for token in TARGET_SELECTOR_TOKENS) for selector in selectors):
                removals.append((prelude_start, closing + 1))
        i = closing + 1


def remove_dashboard_rules(style_match: re.Match[str]) -> str:
    global removed_rule_count
    opening, css, closing = style_match.groups()
    removals: list[tuple[int, int]] = []
    collect_css_removals(css, 0, len(css), removals)
    for start, end in sorted(removals, reverse=True):
        css = css[:start] + css[end:]
    removed_rule_count += len(removals)
    return opening + css + closing


removed_rule_count = 0
source = re.sub(r'(<style\b[^>]*>)(.*?)(</style>)', remove_dashboard_rules, source, flags=re.S | re.I)
if removed_rule_count < 40:
    raise AssertionError(f'Expected substantial dashboard-only CSS removal, removed only {removed_rule_count} rules')

shared_after = shared_fingerprints(source)
if shared_after != shared_before:
    raise AssertionError(f'Shared surface CSS changed: before={shared_before}, after={shared_after}')

for required in (
    'id="dash-greeting-block" class="vx-page-header"',
    'id="dash-kpi-strip" class="vx-ap-grid"',
    'id="dash-priority-section" class="vx-ops-card"',
    'id="dash-activity-section" class="vx-ops-card"',
    "el.querySelectorAll('.vx-ops-item[data-id]')",
    "list.querySelectorAll('.vx-ops-item[data-record-id]')",
):
    if required not in source:
        raise AssertionError(f'Missing migrated dashboard hook: {required}')

for forbidden in (
    'class="vx-greeting-block"',
    'class="vx-kpi-strip"',
    'class="vx-jetzt-section',
    'class="vx-activity-row"',
    "el.classList.add('dpr-command-center')",
    "warnBanner.style.cssText",
):
    if forbidden in source:
        raise AssertionError(f'Legacy dashboard presentation remains: {forbidden}')

if source == original:
    raise AssertionError('Migration produced no changes')

SOURCE_PATH.write_text(source, encoding='utf-8')
print(f'Removed {removed_rule_count} dashboard-only CSS rules.')
print(f'index.html bytes: {len(original.encode())} -> {len(source.encode())}')
print('Shared surface fingerprints unchanged:', shared_after)
