import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

const indexPath = 'customer-dashboard/index.html';
const cssPath = 'customer-dashboard/shared/customer-assistant-components.css';
let source = fs.readFileSync(indexPath, 'utf8');
let css = fs.readFileSync(cssPath, 'utf8');

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const sliceBetween = (text, startToken, endToken) => {
  const start = text.indexOf(startToken);
  assert.ok(start >= 0, `Missing protected start token: ${startToken}`);
  const end = text.indexOf(endToken, start + startToken.length);
  assert.ok(end > start, `Missing protected end token: ${endToken}`);
  return text.slice(start, end);
};

const protectedRanges = [
  ['dashboard', 'id="tab-dashboard"', 'id="tab-anrufe"'],
  ['requests', 'id="tab-anrufe"', 'id="tab-assistent"'],
  ['assistant', 'id="tab-assistent"', 'id="tab-auswertung"'],
  ['settings-navigation', 'id="tab-mehr"', 'id="mobile-bottom-nav"'],
  ['login', 'id="login-screen"', 'id="app-shell"'],
  ['tour', 'id="vx-onboarding-tour"', '</body>']
];
const fingerprints = Object.fromEntries(protectedRanges.map(([name, start, end]) => [name, hash(sliceBetween(source, start, end))]));

const oldHostStart = source.indexOf('<div class="tab-page" id="tab-auswertung">');
assert.ok(oldHostStart >= 0, 'Report host start missing');
const oldHostEnd = source.indexOf('<!-- EINSTELLUNGEN TAB -->', oldHostStart);
assert.ok(oldHostEnd > oldHostStart, 'Report host end missing');

const reportHost = `<div class="tab-page" id="tab-auswertung">
          <div class="vx-report-stack">
            <section class="vx-page-header">
              <div class="vx-ap-head vx-report-header">
                <div>
                  <div class="vx-page-header-title">Bericht</div>
                  <div class="vx-page-header-subtitle">Anrufstatistiken und Entwicklungen</div>
                </div>
                <div class="vx-report-periods" id="au-period-row" role="tablist" aria-label="Berichtszeitraum">
                  <button type="button" class="vx-ap-filter vx-report-period" data-report-period="today" aria-selected="false" onclick="auSetPeriod('today',this)">Heute</button>
                  <button type="button" class="vx-ap-filter vx-report-period active" data-report-period="week" aria-selected="true" onclick="auSetPeriod('week',this)">Woche</button>
                  <button type="button" class="vx-ap-filter vx-report-period" data-report-period="month" aria-selected="false" onclick="auSetPeriod('month',this)">Monat</button>
                  <button type="button" class="vx-ap-filter vx-report-period" data-report-period="all" aria-selected="false" onclick="auSetPeriod('all',this)">Gesamt</button>
                </div>
              </div>
            </section>

            <section class="vx-ap-grid vx-report-kpis" aria-label="Kennzahlen">
              <article class="vx-ap-card vx-report-kpi">
                <div class="vx-report-label">Anrufe</div>
                <div class="vx-report-value" id="au2-calls">–</div>
                <div class="vx-report-trend" id="au2-calls-trend"></div>
                <div class="vx-report-spark" id="au2-spark-calls" aria-label="Anrufverlauf der letzten sieben Tage"></div>
              </article>
              <article class="vx-ap-card vx-report-kpi">
                <div class="vx-report-label">Ø Dauer</div>
                <div class="vx-report-value tone-green" id="au2-dur">–</div>
                <div class="vx-report-trend" id="au2-dur-trend"></div>
              </article>
              <article class="vx-ap-card vx-report-kpi">
                <div class="vx-report-label">Hot Leads</div>
                <div class="vx-report-value tone-gold" id="au2-hot">–</div>
                <div class="vx-report-trend" id="au2-hot-trend"></div>
              </article>
              <article class="vx-ap-card vx-report-kpi">
                <div class="vx-report-label">Erledigt</div>
                <div class="vx-report-value tone-green" id="au2-rate">–</div>
                <div class="vx-report-trend" id="au2-rate-trend"></div>
              </article>
            </section>

            <section class="vx-ops-card vx-report-section">
              <div class="vx-ops-head">
                <div>
                  <div class="vx-ops-title">Laras Zusammenfassung</div>
                  <div class="vx-ops-message" id="au2-ai-text">Daten werden geladen…</div>
                </div>
                <span class="vx-ops-pill">Automatisch erstellt</span>
              </div>
              <div class="vx-report-highlights">
                <div class="vx-ops-section vx-report-highlight">
                  <div class="vx-report-label">Top Kategorie</div>
                  <div class="vx-report-highlight-value" id="au2-top-cat">–</div>
                  <div class="vx-ops-meta" id="au2-top-cat-sub">–</div>
                </div>
                <div class="vx-ops-section vx-report-highlight">
                  <div class="vx-report-label">Stosszeit</div>
                  <div class="vx-report-highlight-value" id="au2-best-time">–</div>
                  <div class="vx-ops-meta" id="au2-best-time-sub">–</div>
                </div>
              </div>
            </section>

            <section class="vx-ops-card vx-report-section" id="au2-insights-card">
              <div class="vx-ops-head">
                <div>
                  <div class="vx-ops-title">Handlungsbedarf</div>
                  <div class="vx-ops-sub">Hinweise aus Anrufen, Rückrufen und Nachfrageverlauf.</div>
                </div>
                <span class="vx-ops-pill" id="au2-insight-badge">0 Hinweise</span>
              </div>
              <div class="vx-ops-list" id="au2-insights-list"><div class="vx-ops-empty">Keine offenen Hinweise.</div></div>
            </section>

            <section class="vx-ops-card vx-report-section">
              <div class="vx-ops-head"><div class="vx-ops-title" id="au2-chart-title">Anrufe diese Woche</div></div>
              <div class="vx-report-week-chart" id="au2-week-chart"></div>
              <div class="vx-report-week-foot"><span id="au2-chart-foot-l">–</span><span id="au2-chart-foot-r">–</span></div>
            </section>

            <div class="vx-report-breakdowns">
              <section class="vx-ops-card vx-report-section">
                <div class="vx-ops-head"><div class="vx-ops-title">Kategorien</div></div>
                <div class="vx-report-bars" id="au2-categories"></div>
              </section>
              <section class="vx-ops-card vx-report-section">
                <div class="vx-ops-head"><div class="vx-ops-title">Tageszeiten</div></div>
                <div class="vx-report-bars" id="au2-call-times"></div>
              </section>
            </div>

            <section class="vx-ops-card vx-report-section">
              <div class="vx-ops-head"><div class="vx-ops-title">Lead-Qualität</div></div>
              <div class="vx-report-leads" id="au2-lead-quality"></div>
            </section>
          </div>
        </div>`;
source = source.slice(0, oldHostStart) + reportHost + '\n        ' + source.slice(oldHostEnd);

function findFunctionRange(text, name) {
  const start = text.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Function missing: ${name}`);
  const open = text.indexOf('{', start);
  assert.ok(open > start, `Function body missing: ${name}`);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i += 1; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i += 1; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return [start, i + 1];
    }
  }
  throw new Error(`Unclosed function: ${name}`);
}

function replaceFunction(name, replacement) {
  const [start, end] = findFunctionRange(source, name);
  source = source.slice(0, start) + replacement.trim() + source.slice(end);
}

replaceFunction('auSetPeriod', `function auSetPeriod(period, btn) {
  _auPeriod = period;
  document.querySelectorAll('#au-period-row .vx-report-period').forEach(function(button) {
    var active = button.getAttribute('data-report-period') === period;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  if (btn && !btn.classList.contains('active')) {
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
  }
  renderAuswertung();
}`);

replaceFunction('_auTrend', `function _auTrend(id, diff, suffix) {
  var el = document.getElementById(id);
  if (!el) return;
  if (!diff && diff !== 0) { el.textContent = ''; el.className = 'vx-report-trend'; return; }
  el.className = 'vx-report-trend ' + (diff > 0 ? 'up' : diff < 0 ? 'down' : '');
  el.textContent = (diff > 0 ? '↑ +' : diff < 0 ? '↓ ' : '→ ') + (diff !== 0 ? Math.abs(diff) : '') + ' ' + (suffix || '');
}`);

replaceFunction('_auBuildSparkCalls', `function _auBuildSparkCalls(all) {
  var el = document.getElementById('au2-spark-calls');
  if (!el) return;
  var days = 7, now = new Date(), counts = [];
  for (var i = days - 1; i >= 0; i--) {
    var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    var nd = new Date(d.getTime() + 86400000);
    counts.push(all.filter(function(r) { var ts = getRecordTimestamp(r); if (!ts) return false; var rd = parseCallTimestamp(ts); return rd && rd >= d && rd < nd; }).length);
  }
  var max = Math.max.apply(null, counts) || 1;
  el.innerHTML = counts.map(function(count, index) {
    var level = Math.max(1, Math.min(10, Math.round(count / max * 10)));
    return '<span class="vx-report-level level-' + level + ' vx-report-spark-bar' + (index === counts.length - 1 ? ' current' : '') + '" aria-label="' + count + ' Anrufe"></span>';
  }).join('');
}`);

replaceFunction('_auAiSummary', `function _auAiSummary(records, total, hotCount, closed) {
  var el = document.getElementById('au2-ai-text');
  if (!el) return;
  var periodLabel = {today:'heute', week:'diese Woche', month:'diesen Monat', all:'insgesamt'}[_auPeriod] || '';
  if (!total) {
    el.textContent = 'Noch keine Anrufe ' + periodLabel + '.';
    _auEl('au2-top-cat', '–'); _auEl('au2-top-cat-sub', '–');
    _auEl('au2-best-time', '–'); _auEl('au2-best-time-sub', '–');
    return;
  }
  var cats = {};
  records.forEach(function(r) { var c = (r.fields || {}).category || 'Sonstiges'; cats[c] = (cats[c] || 0) + 1; });
  var topCatRaw = Object.keys(cats).sort(function(a,b) { return cats[b] - cats[a]; })[0] || '–';
  var topCat = (typeof getCallCategoryDisplayLabel === 'function' && topCatRaw !== '–') ? (getCallCategoryDisplayLabel({fields:{category:topCatRaw}}) || topCatRaw) : topCatRaw;
  var topCatCount = cats[topCatRaw] || 0;
  var timeBuckets = [{label:'6–9',r:[6,9],c:0},{label:'9–12',r:[9,12],c:0},{label:'12–14',r:[12,14],c:0},{label:'14–18',r:[14,18],c:0},{label:'18+',r:[18,30],c:0}];
  records.forEach(function(r) { var ts = getRecordTimestamp(r); if (!ts) return; var d = parseCallTimestamp(ts); if (!d) return; var h = d.getHours(); var ah = h < 6 ? h + 24 : h; for (var i = 0; i < timeBuckets.length; i++) { if (ah >= timeBuckets[i].r[0] && ah < timeBuckets[i].r[1]) { timeBuckets[i].c++; break; } } });
  var bestBucket = timeBuckets.reduce(function(best,b) { return b.c > best.c ? b : best; }, timeBuckets[0]);
  var bestTimePct = total ? Math.round(bestBucket.c / total * 100) : 0;
  _auEl('au2-top-cat', topCat); _auEl('au2-top-cat-sub', topCatCount + ' von ' + total + ' Anrufen');
  _auEl('au2-best-time', bestBucket.label + ' Uhr'); _auEl('au2-best-time-sub', bestTimePct + '% aller Anrufe');
  el.textContent = 'Lara hat ' + periodLabel + ' ' + total + ' Anruf' + (total !== 1 ? 'e' : '') + ' entgegengenommen' + (hotCount ? ' — ' + hotCount + ' Hot Lead' + (hotCount !== 1 ? 's' : '') : '') + (closed ? ' — ' + closed + ' erledigt' : '') + '. Top-Kategorie: ' + topCat + '. Stosszeit: ' + bestBucket.label + ' Uhr.';
}`);

replaceFunction('_auInsights', `function _auInsights(all, filtered) {
  var list = document.getElementById('au2-insights-list');
  var badge = document.getElementById('au2-insight-badge');
  if (!list) return;
  var insights = [];
  var openCallbacks = all.filter(function(r) { var f = r.fields || {}; return (f.callback_requested === true || f.callback_requested === 'true') && !isClosedStatus(f.dashboard_status); });
  if (openCallbacks.length > 0) {
    var oldest = openCallbacks.reduce(function(value, r) { var ts = getRecordTimestamp(r); return (!value || ts < getRecordTimestamp(value)) ? r : value; }, null);
    var daysOld = oldest ? Math.floor((Date.now() - parseCallTimestamp(getRecordTimestamp(oldest)).getTime()) / 86400000) : 0;
    insights.push({tone:'warning', icon:'phone-call', text:openCallbacks.length + ' offene Rückruf-Anfrage' + (openCallbacks.length !== 1 ? 'n' : '') + ' — älteste ist ' + daysOld + ' Tag' + (daysOld !== 1 ? 'e' : '') + ' alt.'});
  }
  var timeBuckets = [{label:'6–9',r:[6,9],c:0},{label:'9–12',r:[9,12],c:0},{label:'12–14',r:[12,14],c:0},{label:'14–18',r:[14,18],c:0},{label:'18+',r:[18,30],c:0}];
  filtered.forEach(function(r) { var ts = getRecordTimestamp(r); if (!ts) return; var d = parseCallTimestamp(ts); if (!d) return; var h = d.getHours(); var ah = h < 6 ? h + 24 : h; for (var i = 0; i < timeBuckets.length; i++) { if (ah >= timeBuckets[i].r[0] && ah < timeBuckets[i].r[1]) { timeBuckets[i].c++; break; } } });
  var best = timeBuckets.reduce(function(value, item) { return item.c > value.c ? item : value; }, timeBuckets[0]);
  var pct = filtered.length ? Math.round(best.c / filtered.length * 100) : 0;
  if (pct >= 30) insights.push({tone:'info', icon:'clock', text:'Stosszeit ' + best.label + ' Uhr — ' + pct + '% aller Anrufe kommen dann. Sicher erreichbar?'});
  var hotCount = filtered.filter(function(r) { return qualKey((r.fields || {}).lead_quality) === 'hot'; }).length;
  if (hotCount > 0) insights.push({tone:'success', icon:'trending-up', text:hotCount + ' Hot Lead' + (hotCount !== 1 ? 's' : '') + ' identifiziert — ' + Math.round(hotCount / Math.max(filtered.length, 1) * 100) + '% aller Anrufe.'});
  if (badge) badge.textContent = insights.length + ' Hinweis' + (insights.length !== 1 ? 'e' : '');
  if (!insights.length) { list.innerHTML = '<div class="vx-ops-empty">Keine offenen Hinweise.</div>'; return; }
  list.innerHTML = insights.map(function(insight) { return '<div class="vx-ops-item vx-report-insight tone-' + insight.tone + '"><span class="vx-report-insight-icon"><i class="ph-bold ph-' + insight.icon + '" aria-hidden="true"></i></span><span>' + insight.text + '</span></div>'; }).join('');
}`);

replaceFunction('_auWeekChart2', `function _auWeekChart2(records) {
  var el = document.getElementById('au2-week-chart');
  var footL = document.getElementById('au2-chart-foot-l');
  var footR = document.getElementById('au2-chart-foot-r');
  if (!el) return;
  var now = new Date(), dayNames = ['So','Mo','Di','Mi','Do','Fr','Sa'], days = [];
  for (var i = 6; i >= 0; i--) {
    var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    var nd = new Date(d.getTime() + 86400000);
    var count = records.filter(function(r) { var ts = getRecordTimestamp(r); if (!ts) return false; var rd = parseCallTimestamp(ts); return rd && rd >= d && rd < nd; }).length;
    days.push({label:dayNames[d.getDay()], count:count, today:i === 0});
  }
  var max = Math.max.apply(null, days.map(function(day) { return day.count; })) || 1;
  var total = days.reduce(function(sum, day) { return sum + day.count; }, 0);
  var avg = total ? (total / 7).toFixed(1) : '0';
  el.innerHTML = days.map(function(day) { var level = Math.max(1, Math.min(10, Math.round(day.count / max * 10))); return '<div class="vx-report-week-col"><div class="vx-report-week-count">' + (day.count || '') + '</div><div class="vx-report-level level-' + level + ' vx-report-week-bar' + (day.today ? ' current' : '') + '"></div><div class="vx-report-week-label' + (day.today ? ' current' : '') + '">' + day.label + '</div></div>'; }).join('');
  if (footL) footL.textContent = 'Total: ' + total + ' Anrufe';
  if (footR) footR.textContent = 'Ø ' + avg + ' / Tag';
}`);

replaceFunction('_auCategories2', `function _auCategories2(records, total) {
  var el = document.getElementById('au2-categories');
  if (!el) return;
  var counts = {};
  records.forEach(function(r) { var c = (r.fields || {}).category || 'Sonstiges'; counts[c] = (counts[c] || 0) + 1; });
  var sorted = Object.keys(counts).sort(function(a,b) { return counts[b] - counts[a]; }).slice(0,5);
  var max = sorted.length ? counts[sorted[0]] : 1;
  if (!sorted.length) { el.innerHTML = '<div class="vx-ops-empty">Keine Daten.</div>'; return; }
  el.innerHTML = sorted.map(function(category, index) { var count = counts[category], pct = Math.round(count / max * 100); var tone = index === 0 ? 'blue' : 'soft'; return '<div class="vx-report-bar-row"><div class="vx-report-bar-label">' + category + '</div><progress class="vx-report-progress tone-' + tone + '" max="100" value="' + pct + '" aria-label="' + category + ': ' + count + '"></progress><div class="vx-report-bar-count">' + count + '</div></div>'; }).join('');
}`);

replaceFunction('_auCallTimes2', `function _auCallTimes2(records, total) {
  var el = document.getElementById('au2-call-times');
  if (!el) return;
  var buckets = [{label:'6–9',r:[6,9],c:0},{label:'9–12',r:[9,12],c:0},{label:'12–14',r:[12,14],c:0},{label:'14–18',r:[14,18],c:0},{label:'18+',r:[18,30],c:0}];
  records.forEach(function(r) { var ts = getRecordTimestamp(r); if (!ts) return; var d = parseCallTimestamp(ts); if (!d) return; var h = d.getHours(); var ah = h < 6 ? h + 24 : h; for (var i = 0; i < buckets.length; i++) { if (ah >= buckets[i].r[0] && ah < buckets[i].r[1]) { buckets[i].c++; break; } } });
  var max = Math.max.apply(null, buckets.map(function(bucket) { return bucket.c; })) || 1;
  el.innerHTML = buckets.map(function(bucket) { var pct = Math.round(bucket.c / max * 100); return '<div class="vx-report-bar-row"><div class="vx-report-bar-label">' + bucket.label + '</div><progress class="vx-report-progress tone-blue" max="100" value="' + pct + '" aria-label="' + bucket.label + ' Uhr: ' + bucket.c + '"></progress><div class="vx-report-bar-count">' + bucket.c + '</div></div>'; }).join('');
}`);

replaceFunction('_auLeadQuality', `function _auLeadQuality(total, hot, warm, kalt, unknown) {
  var el = document.getElementById('au2-lead-quality');
  if (!el) return;
  var denominator = total || 1;
  var rows = [{label:'Hot',count:hot,tone:'hot'},{label:'Warm',count:warm,tone:'warm'},{label:'Kalt',count:kalt,tone:'cold'},{label:'Unbekannt',count:unknown,tone:'soft'}];
  var max = Math.max.apply(null, rows.map(function(row) { return row.count; })) || 1;
  el.innerHTML = rows.map(function(row) { var pct = Math.round(row.count / denominator * 100); var width = Math.round(row.count / max * 100); return '<div class="vx-report-lead-row"><span class="vx-report-dot tone-' + row.tone + '"></span><span class="vx-report-lead-label">' + row.label + '</span><progress class="vx-report-progress tone-' + row.tone + '" max="100" value="' + width + '" aria-label="' + row.label + ': ' + row.count + '"></progress><strong>' + row.count + '</strong><span>' + pct + '%</span></div>'; }).join('');
}`);

function isReportSelector(selector) {
  const clean = selector.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  return /(?:^|[\s>+~])#tab-auswertung\b|(?:^|[\s>+~])#au(?:2)?-[\w-]+\b|(?:^|[\s>+~])\.au(?:2)?-[\w-]+\b/.test(clean);
}

function stripReportRules(styleText) {
  let previous;
  let current = styleText;
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  do {
    previous = current;
    current = current.replace(rulePattern, function(full, selectorText, body) {
      if (selectorText.trim().startsWith('@')) return full;
      const selectors = selectorText.split(',');
      const kept = selectors.filter(function(selector) { return !isReportSelector(selector); });
      if (kept.length === selectors.length) return full;
      if (!kept.length) return '';
      return kept.join(',') + '{' + body + '}';
    });
  } while (current !== previous);
  return current;
}

source = source.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, function(full, attrs, body) {
  return '<style' + attrs + '>' + stripReportRules(body) + '</style>';
});

const reportCss = `
/* Customer report: assistant-aligned canonical component owner. */
body.vx-customer-design-foundation .vx-report-stack{display:grid;gap:16px;min-width:0;}
body.vx-customer-design-foundation .vx-report-header{align-items:center;}
body.vx-customer-design-foundation .vx-report-periods{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;min-width:min(400px,48vw);}
body.vx-customer-design-foundation .vx-report-period{min-width:0;border-color:rgba(255,255,255,.22);background:rgba(255,255,255,.08);color:rgba(255,255,255,.72);}
body.vx-customer-design-foundation .vx-report-period:hover{background:rgba(255,255,255,.14);color:#fff;}
body.vx-customer-design-foundation .vx-report-period.active{border-color:#fff;background:#fff;color:var(--vx-brand-dark);box-shadow:0 2px 8px rgba(0,0,0,.12);}
body.vx-customer-design-foundation .vx-report-kpis{grid-template-columns:repeat(4,minmax(0,1fr));}
body.vx-customer-design-foundation .vx-report-kpi{display:flex;flex-direction:column;min-height:148px;}
body.vx-customer-design-foundation .vx-report-label{color:var(--vx-subtle);font-size:11px;font-weight:750;letter-spacing:.08em;text-transform:uppercase;}
body.vx-customer-design-foundation .vx-report-value{margin-top:10px;color:var(--vx-brand);font-size:30px;font-weight:780;line-height:1;font-variant-numeric:tabular-nums;}
body.vx-customer-design-foundation .vx-report-value.tone-green{color:#047857;} body.vx-customer-design-foundation .vx-report-value.tone-gold{color:#b45309;}
body.vx-customer-design-foundation .vx-report-trend{min-height:18px;margin-top:8px;color:var(--vx-subtle);font-size:12px;font-weight:700;} body.vx-customer-design-foundation .vx-report-trend.up{color:#047857;} body.vx-customer-design-foundation .vx-report-trend.down{color:#b91c1c;}
body.vx-customer-design-foundation .vx-report-spark{display:flex;align-items:flex-end;gap:4px;height:26px;margin-top:auto;padding-top:8px;}
body.vx-customer-design-foundation .vx-report-spark-bar{flex:1;height:calc(3px + 21px * var(--vx-report-level));border-radius:4px 4px 1px 1px;background:#dbeafe;} body.vx-customer-design-foundation .vx-report-spark-bar.current{background:var(--vx-brand);}
.vx-report-level.level-0{--vx-report-level:0}.vx-report-level.level-1{--vx-report-level:.1}.vx-report-level.level-2{--vx-report-level:.2}.vx-report-level.level-3{--vx-report-level:.3}.vx-report-level.level-4{--vx-report-level:.4}.vx-report-level.level-5{--vx-report-level:.5}.vx-report-level.level-6{--vx-report-level:.6}.vx-report-level.level-7{--vx-report-level:.7}.vx-report-level.level-8{--vx-report-level:.8}.vx-report-level.level-9{--vx-report-level:.9}.vx-report-level.level-10{--vx-report-level:1}
body.vx-customer-design-foundation .vx-report-section{display:grid;gap:16px;}
body.vx-customer-design-foundation .vx-report-highlights,body.vx-customer-design-foundation .vx-report-breakdowns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;}
body.vx-customer-design-foundation .vx-report-highlight-value{margin-top:6px;color:var(--vx-ink);font-size:18px;font-weight:730;}
body.vx-customer-design-foundation .vx-report-insight{display:flex;align-items:flex-start;gap:12px;} body.vx-customer-design-foundation .vx-report-insight-icon{display:flex;align-items:center;justify-content:center;flex:0 0 auto;width:32px;height:32px;border-radius:10px;}
body.vx-customer-design-foundation .vx-report-insight.tone-warning{background:#fff7ed;color:#9a3412;} body.vx-customer-design-foundation .vx-report-insight.tone-warning .vx-report-insight-icon{background:#fed7aa;} body.vx-customer-design-foundation .vx-report-insight.tone-info{background:#eff6ff;color:#1d4ed8;} body.vx-customer-design-foundation .vx-report-insight.tone-info .vx-report-insight-icon{background:#dbeafe;} body.vx-customer-design-foundation .vx-report-insight.tone-success{background:#ecfdf5;color:#047857;} body.vx-customer-design-foundation .vx-report-insight.tone-success .vx-report-insight-icon{background:#d1fae5;}
body.vx-customer-design-foundation .vx-report-week-chart{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));align-items:end;gap:8px;min-height:120px;}
body.vx-customer-design-foundation .vx-report-week-col{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:5px;height:116px;} body.vx-customer-design-foundation .vx-report-week-count,body.vx-customer-design-foundation .vx-report-week-label{color:var(--vx-subtle);font-size:11px;font-weight:700;}
body.vx-customer-design-foundation .vx-report-week-bar{width:100%;height:calc(5px + 72px * var(--vx-report-level));border-radius:6px 6px 2px 2px;background:#e2e8f0;} body.vx-customer-design-foundation .vx-report-week-bar.current{background:var(--vx-brand);} body.vx-customer-design-foundation .vx-report-week-label.current{color:var(--vx-brand);}
body.vx-customer-design-foundation .vx-report-week-foot{display:flex;justify-content:space-between;gap:12px;padding-top:12px;border-top:1px solid var(--vx-line);color:var(--vx-muted);font-size:12px;}
body.vx-customer-design-foundation .vx-report-bars,body.vx-customer-design-foundation .vx-report-leads{display:grid;gap:12px;}
body.vx-customer-design-foundation .vx-report-bar-row{display:grid;grid-template-columns:minmax(74px,.55fr) minmax(100px,1fr) 32px;align-items:center;gap:10px;} body.vx-customer-design-foundation .vx-report-bar-label,body.vx-customer-design-foundation .vx-report-bar-count{color:var(--vx-muted);font-size:13px;} body.vx-customer-design-foundation .vx-report-bar-count{text-align:right;font-weight:700;color:var(--vx-ink);}
body.vx-customer-design-foundation .vx-report-progress{width:100%;height:8px;border:0;border-radius:999px;overflow:hidden;accent-color:var(--vx-report-accent,var(--vx-brand));} body.vx-customer-design-foundation .vx-report-progress.tone-blue{--vx-report-accent:var(--vx-brand);} body.vx-customer-design-foundation .vx-report-progress.tone-soft{--vx-report-accent:#94a3b8;} body.vx-customer-design-foundation .vx-report-progress.tone-hot{--vx-report-accent:#dc2626;} body.vx-customer-design-foundation .vx-report-progress.tone-warm{--vx-report-accent:#d97706;} body.vx-customer-design-foundation .vx-report-progress.tone-cold{--vx-report-accent:#64748b;}
body.vx-customer-design-foundation .vx-report-progress::-webkit-progress-bar{background:#f1f5f9;border-radius:999px;} body.vx-customer-design-foundation .vx-report-progress::-webkit-progress-value{background:var(--vx-report-accent,var(--vx-brand));border-radius:999px;} body.vx-customer-design-foundation .vx-report-progress::-moz-progress-bar{background:var(--vx-report-accent,var(--vx-brand));border-radius:999px;}
body.vx-customer-design-foundation .vx-report-lead-row{display:grid;grid-template-columns:auto minmax(72px,.4fr) minmax(100px,1fr) 28px 42px;align-items:center;gap:10px;color:var(--vx-muted);font-size:12px;} body.vx-customer-design-foundation .vx-report-lead-label{color:var(--vx-ink);font-size:13px;} body.vx-customer-design-foundation .vx-report-dot{width:9px;height:9px;border-radius:50%;background:var(--vx-report-accent,#94a3b8);} body.vx-customer-design-foundation .vx-report-dot.tone-hot{--vx-report-accent:#dc2626;} body.vx-customer-design-foundation .vx-report-dot.tone-warm{--vx-report-accent:#d97706;} body.vx-customer-design-foundation .vx-report-dot.tone-cold{--vx-report-accent:#64748b;}
@media (max-width:820px){body.vx-customer-design-foundation .vx-report-header{align-items:stretch;flex-direction:column;} body.vx-customer-design-foundation .vx-report-periods{width:100%;min-width:0;} body.vx-customer-design-foundation .vx-report-kpis{grid-template-columns:repeat(2,minmax(0,1fr));} body.vx-customer-design-foundation .vx-report-breakdowns{grid-template-columns:1fr;}}
@media (max-width:520px){body.vx-customer-design-foundation .vx-report-periods{grid-template-columns:repeat(2,minmax(0,1fr));} body.vx-customer-design-foundation .vx-report-highlights{grid-template-columns:1fr;} body.vx-customer-design-foundation .vx-report-lead-row{grid-template-columns:auto minmax(0,1fr) 28px 38px;} body.vx-customer-design-foundation .vx-report-lead-row .vx-report-progress{grid-column:2/-1;} body.vx-customer-design-foundation .vx-report-week-chart{gap:5px;}}
`;
assert.ok(!css.includes('Customer report: assistant-aligned canonical component owner.'), 'Report CSS already present');
css = css.trimEnd() + '\n' + reportCss.trim() + '\n';

for (const [name, start, end] of protectedRanges) {
  assert.equal(hash(sliceBetween(source, start, end)), fingerprints[name], `Protected surface changed: ${name}`);
}

const activeStyles = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]).join('\n');
assert.ok(!/(?:^|[\s>+~])#tab-auswertung\b|(?:^|[\s>+~])#au(?:2)?-[\w-]+\b|(?:^|[\s>+~])\.au(?:2)?-[\w-]+\b/m.test(activeStyles.replace(/\/\*[\s\S]*?\*\//g, '')), 'Legacy report selectors remain in index styles');
const reportMarkup = sliceBetween(source, '<div class="tab-page" id="tab-auswertung">', '<!-- EINSTELLUNGEN TAB -->');
assert.ok(!reportMarkup.includes('style="'), 'Inline style remains in report host');
for (const functionName of ['_auBuildSparkCalls','_auAiSummary','_auInsights','_auWeekChart2','_auCategories2','_auCallTimes2','_auLeadQuality']) {
  const [start, end] = findFunctionRange(source, functionName);
  assert.ok(!source.slice(start, end).includes('style="'), `Inline style remains in ${functionName}`);
}
for (const token of ['au2-calls','au2-dur','au2-hot','au2-rate','au2-ai-text','au2-insights-list','au2-week-chart','au2-categories','au2-call-times','au2-lead-quality']) {
  assert.equal((source.match(new RegExp(`id="${token}"`, 'g')) || []).length, 1, `Report ID count mismatch: ${token}`);
}
assert.ok(css.split(/\r?\n/).length <= 800, `Assistant component CSS exceeded budget: ${css.split(/\r?\n/).length}`);
assert.ok(source.length < fs.readFileSync(indexPath, 'utf8').length, 'Report migration did not reduce index size');

fs.writeFileSync(indexPath, source);
fs.writeFileSync(cssPath, css);
console.log('Customer report migration prepared.', { indexBytes: source.length, assistantCssLines: css.split(/\r?\n/).length });
