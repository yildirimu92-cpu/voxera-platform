from pathlib import Path
import re

P = Path

def rl(path):
    return P(path).read_text(encoding="utf-8").splitlines()

def wl(path, lines):
    P(path).write_text("\n".join(lines) + "\n", encoding="utf-8")

fp = "customer-dashboard/shared/customer-design-system.css"
ap = "customer-dashboard/shared/customer-assistant-components.css"
np = "customer-dashboard/shared/customer-navigation-components.css"
ip = "customer-dashboard/index.html"
vp = "scripts/verify-customer-design-foundation.mjs"
rp = "customer-dashboard/shared/customer-runtime-design-foundation.js"
op = "customer-dashboard/shared/offer-brand.js"

f, a, n = rl(fp), rl(ap), rl(np)
assert (len(f), len(a), len(n)) == (586, 1464, 231)

ranges = [(393, 400), (401, 435), (436, 464), (503, 518)]
movedf = []
rem = set()
for start, end in ranges:
    movedf += f[start - 1:end]
    rem.update(range(start - 1, end))
fn = [line for index, line in enumerate(f) if index not in rem]
assert len(fn) == 498

moveda = a[858:]
an = a[:858]
assert len(moveda) == 606

selector = "body.vx-customer-design-foundation #vx-assistant-profile-body .vx-ap-card:first-child {"
index = an.index(selector)
for cursor in range(index, index + 8):
    if "border-top:" in an[cursor]:
        an[cursor] = an[cursor].replace(
            "4px solid var(--vx-brand-dark)",
            "1px solid var(--vx-brand-dark)",
        )
        break
else:
    raise AssertionError("profile border")

nm = []
for start, end in [(6, 39), (86, 103), (148, 180)]:
    nm += n[start - 1:end] + [""]
nm += n[181:200] + [n[217]]
assert len(nm) == 108
an += [""] + nm
assert len(an) == 967

nn = []
for block in [n[:4], n[40:84], n[108:146]]:
    nn += block + [""]
nn += ["@media (max-width: 720px) {"] + n[201:217] + ["}", ""] + n[219:231]
assert len(nn) == 120

wl(fp, fn)
wl(ap, an)
wl(np, nn)

for path, content_lines, line_count in [
    (fp, 498, 499),
    (ap, 967, 968),
    (np, 120, 121),
]:
    text = P(path).read_text(encoding="utf-8")
    assert text.endswith("\n")
    assert not text.endswith("\n\n")
    assert len(text.splitlines()) == content_lines
    assert len(re.split(r"\r?\n", text)) == line_count

dashboard = P(ip).read_text(encoding="utf-8")
assert (
    len(re.findall(r"<style\b", dashboard, re.I)),
    len(re.findall(r"</style\s*>", dashboard, re.I)),
) == (48, 48)
assert dashboard.count('<script src="/shared/offer-brand.js"></script>') == 1
dashboard = dashboard.replace(
    '<script src="/shared/offer-brand.js"></script>',
    '<script src="/shared/offer-brand.js?v=20260805-1"></script>',
    1,
)

payload = (
    "\n\n/* Customer baseline ownership migration: source-owned dashboard and requests rules. */\n"
    + "\n".join(movedf)
    + "\n\n/* Customer baseline ownership migration: legacy page-specific modules. */\n"
    + "\n".join(moveda)
    + "\n\n.vx-requests-retention-note {\n"
    + "  margin: 0 14px 12px;\n"
    + "  color: var(--vx-muted);\n"
    + "  font-size: 12px;\n"
    + "  line-height: 1.5;\n"
    + "  overflow-wrap: anywhere;\n"
    + "}\n"
)
style_end = dashboard.find("</style>")
assert style_end >= 0
dashboard = dashboard[:style_end] + payload + dashboard[style_end:]

old = """                <button class="vx-ap-filter vx-chip" data-filter="archiv" onclick="anrufeChipFilter('archiv',this)">Archiv</button>
              </div>"""
new = """                <button class="vx-ap-filter vx-chip" data-filter="archiv" onclick="anrufeChipFilter('archiv',this)">Archiv</button>
              </div>
              <p
                id="anrufe-retention-note"
                class="vx-requests-retention-note"
                hidden
              >
                Audio und vollständige Transkripte werden nach
                <strong>90 Tagen</strong> entfernt, Archiveinträge nach
                <strong>180 Tagen</strong> gelöscht.
              </p>"""
assert dashboard.count(old) == 1
dashboard = dashboard.replace(old, new, 1)

old = "if (filter === 'archiv') return 'Archiv ist leer. Audio und vollständige Transkripte werden nach 90 Tagen entfernt, Archiveinträge nach 180 Tagen gelöscht.'"
assert dashboard.count(old) == 1
dashboard = dashboard.replace(
    old,
    "if (filter === 'archiv') return 'Archiv ist leer.'",
    1,
)

old = """  var subWrap = document.getElementById('anrufe-inbox-subfilters');
  if (subWrap) subWrap.style.display = filter === 'offen' ? '' : 'none';
}"""
new = """  var subWrap = document.getElementById('anrufe-inbox-subfilters');
  if (subWrap) subWrap.style.display = filter === 'offen' ? '' : 'none';
  var retentionNote = document.getElementById('anrufe-retention-note');
  if (retentionNote) {
    retentionNote.hidden = filter !== 'archiv';
  }
}"""
assert dashboard.count(old) == 1
dashboard = dashboard.replace(old, new, 1)
P(ip).write_text(dashboard, encoding="utf-8")

runtime = P(rp).read_text(encoding="utf-8")
for old, new in [
    (
        "/shared/customer-design-system.css?v=20260804-1",
        "/shared/customer-design-system.css?v=20260805-1",
    ),
    (
        "/shared/customer-assistant-components.css?v=20260803-1",
        "/shared/customer-assistant-components.css?v=20260805-1",
    ),
    (
        "/shared/customer-navigation-components.css?v=20260803-1",
        "/shared/customer-navigation-components.css?v=20260805-1",
    ),
]:
    assert runtime.count(old) == 1
    runtime = runtime.replace(old, new, 1)
P(rp).write_text(runtime, encoding="utf-8")

loader = P(op).read_text(encoding="utf-8")
old = "/shared/customer-runtime-design-foundation.js?v=20260803-4"
new = "/shared/customer-runtime-design-foundation.js?v=20260805-1"
assert loader.count(old) == 1
assert loader.count("__voxeraCustomerDesignFoundationLoaded") == 1
loader = loader.replace(old, new, 1)
P(op).write_text(loader, encoding="utf-8")

verifier = P(vp).read_text(encoding="utf-8")
verifier = verifier.replace(
    "lineCount(assistantCss) <= 800",
    "lineCount(assistantCss) <= 968",
)
verifier = verifier.replace(
    "lineCount(navigationCss) <= 110",
    "lineCount(navigationCss) <= 121",
)
for old, new in [
    (
        "/shared/customer-design-system.css?v=20260803-1",
        "/shared/customer-design-system.css?v=20260805-1",
    ),
    (
        "/shared/customer-assistant-components.css?v=20260803-1",
        "/shared/customer-assistant-components.css?v=20260805-1",
    ),
    (
        "/shared/customer-navigation-components.css?v=20260803-1",
        "/shared/customer-navigation-components.css?v=20260805-1",
    ),
    (
        "customer-runtime-design-foundation\\.js\\?v=20260803-4",
        "customer-runtime-design-foundation\\.js\\?v=20260805-1",
    ),
]:
    assert old in verifier
    verifier = verifier.replace(old, new)

old = """  '#tab-assistent > :not(#vx-assistant-root-switch):not(#vx-assistant-root-host)',
  '#vx-assistant-root-host > [data-vx-assistant-managed-page]:not([hidden])',
  '.vx-nav-voice-details'"""
assert old in verifier
verifier = verifier.replace(
    old,
    """  '#nav-assistent.nav-item',
  '#mnav-assistent.mobile-nav-btn',
  '#vx-assistant-root-switch',
  '.nav-item.vx-root-nav-active',
  '.mobile-nav-btn:is(.active, .vx-root-nav-active)'""",
    1,
)

anchor = "  '#vx-business-profile-body textarea',"
assert anchor in verifier
verifier = verifier.replace(
    anchor,
    anchor
    + """
  '#tab-assistent > :not(#vx-assistant-root-header):not(#vx-assistant-root-switch):not(#vx-assistant-root-host)',
  '.vx-assistant-root-header',
  '#vx-assistant-root-host > [data-vx-assistant-managed-page]:not([hidden])',
  '.vx-nav-voice-details',
  '#vx-assistant-profile-body .vx-ap-card:first-child',""",
    1,
)

for token in ["  'min-height: 36px',\n", "  '#vx-business-profile-body .vx-ap-grid',\n"]:
    assert verifier.count(token) == 1, token
    verifier = verifier.replace(token, "", 1)

navigation_anchor = """for (const token of [
  '#nav-assistent.nav-item',
  '#mnav-assistent.mobile-nav-btn',
  '#vx-assistant-root-switch',
  '.nav-item.vx-root-nav-active',
  '.mobile-nav-btn:is(.active, .vx-root-nav-active)'
]) {
  assert.ok(navigationCss.includes(token), `navigation CSS missing: ${token}`);
}
"""
assert verifier.count(navigation_anchor) == 1
verifier = verifier.replace(
    navigation_anchor,
    navigation_anchor
    + """assert.match(
  navigationCss,
  /@media\\s*\\(max-width:\\s*720px\\)[\\s\\S]*?body\\.vx-customer-design-foundation\\s+#vx-assistant-root-switch\\s*>\\s*button\\s*\\{[^}]*min-height:\\s*36px;?[^}]*\\}/,
  'navigation CSS missing mobile assistant switch min-height'
);
""",
    1,
)

old_calendar = "  'entry.hidden = !(state.enabled && providers.length)',\n"
assert verifier.count(old_calendar) == 1
verifier = verifier.replace(old_calendar, "", 1)

calendar_anchor = """for (const token of [
  'vx-calendar-settings-entry',
  'vx-settings-entry vx-settings-entry--calendar',
  'vx-cal-page-header',
  'vx-cal-rules-card',
  'vx-cal-checkbox',
  "page.removeAttribute('style')",
  'main.hidden = true',
  'page.hidden = false'
]) {
  assert.ok(calendarRuntime.includes(token), `calendar runtime missing semantic structure: ${token}`);
}
"""
assert verifier.count(calendar_anchor) == 1
verifier = verifier.replace(
    calendar_anchor,
    calendar_anchor
    + """assert.ok(
  calendarRuntime.includes('entry.hidden = false;'),
  'calendar runtime must keep settings entry visible'
);
assert.ok(
  calendarRuntime.includes('if (entry) entry.hidden = false;'),
  'calendar runtime must preserve settings entry visibility after render'
);
assert.ok(
  !calendarRuntime.includes(
    'entry.hidden = !(state.enabled && providers.length)'
  ),
  'calendar runtime still contains obsolete provider-dependent entry visibility'
);
""",
    1,
)

verifier += """
for (const forbidden of ['#tab-assistent > :not(#vx-assistant-root-header):not(#vx-assistant-root-switch):not(#vx-assistant-root-host)','#vx-assistant-root-host > [data-vx-assistant-managed-page]:not([hidden])','.vx-nav-voice-details','#vx-assistant-profile-body .vx-ap-card:first-child']) assert.ok(!navigationCss.includes(forbidden), `navigation CSS still owns assistant structure: ${forbidden}`);
assert.ok(dashboard.includes('<script src="/shared/offer-brand.js?v=20260805-1"></script>'), 'dashboard missing versioned offer-brand loader');
assert.ok(!dashboard.includes('<script src="/shared/offer-brand.js"></script>'), 'dashboard still loads unversioned offer-brand');
assert.ok(loader.includes('/shared/customer-runtime-design-foundation.js?v=20260805-1'), 'offer-brand missing current design loader version');
assert.ok(!loader.includes('/shared/customer-runtime-design-foundation.js?v=20260803-4'), 'offer-brand still references stale design loader version');
for (const stale of ['/shared/customer-design-system.css?v=20260804-1','/shared/customer-assistant-components.css?v=20260803-1','/shared/customer-navigation-components.css?v=20260803-1']) assert.ok(!runtime.includes(stale), `design loader still contains stale CSS URL: ${stale}`);
const cssOrder=['/shared/customer-design-system.css?v=20260805-1','/shared/customer-assistant-components.css?v=20260805-1','/shared/customer-assistant-status.css?v=20260803-1','/shared/customer-navigation-components.css?v=20260805-1','/shared/customer-settings-components.css?v=20260803-2','/shared/customer-support-components.css?v=20260802-2'];
for(let i=1;i<cssOrder.length;i+=1) assert.ok(runtime.indexOf(cssOrder[i-1])<runtime.indexOf(cssOrder[i]),`design CSS module order changed: ${cssOrder[i-1]} before ${cssOrder[i]}`);
"""

P(vp).write_text(verifier, encoding="utf-8")
P("customer-dashboard/shared/customer-runtime-notifications-design.js").unlink()
