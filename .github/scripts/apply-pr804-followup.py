from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, value: str) -> None:
    Path(path).write_text(value, encoding="utf-8")


# 1. Complete only the malformed mobile greeting fragment.
index_path = "customer-dashboard/index.html"
index = read(index_path)
old_comment = "/* Customer baseline ownership migration: legacy page-specific modules. */"
assert index.count(old_comment) == 1, "legacy ownership comment anchor changed"
comment_at = index.index(old_comment)
orphan_matches = list(re.finditer(r"(?m)^[ \t]*font-size:\s*24px;\s*$", index[:comment_at]))
assert orphan_matches, "orphaned mobile font-size fragment not found"
fragment_start = orphan_matches[-1].start()
fragment = index[fragment_start:comment_at]
for token in (
    "font-size: 24px;",
    "#dash-greeting-block > .vx-ap-head",
    "grid-template-columns: minmax(0, 1fr);",
    "font-size: 12px;",
    "text-align: left;",
):
    assert token in fragment, f"malformed greeting fragment missing: {token}"
assert "@media (max-width: 720px)" not in fragment
assert fragment.rstrip().endswith("text-align: left;")

greeting_block = """@media (max-width: 720px) {
  body.vx-customer-design-foundation
    #dash-greeting-block
    > .vx-ap-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 9px;
  }

  body.vx-customer-design-foundation
    #dash-greeting-block
    > .vx-ap-head
    > .vx-page-header-subtitle {
    margin-top: 0;
    font-size: 12px;
    text-align: left;
    white-space: nowrap;
  }
}

/* Customer baseline ownership migration:
   legacy page-specific modules. */"""
index = index[:fragment_start] + greeting_block + index[comment_at + len(old_comment) :]
assert index.count(greeting_block) == 1
assert old_comment not in index
write(index_path, index)


# 2. Restore the unique global mobile title declaration without changing line count.
foundation_path = "customer-dashboard/shared/customer-design-system.css"
foundation = read(foundation_path)
title_pattern = re.compile(
    r"(body\.vx-customer-design-foundation\s+\.vx-page-header-title\s*\{[^{}]*?)white-space:\s*nowrap;([^{}]*?\})",
    re.MULTILINE,
)
foundation, count = title_pattern.subn(r"\1font-size: 24px;\2", foundation, count=1)
assert count == 1, f"expected one stale mobile title declaration, got {count}"
assert re.search(
    r"@media\s*\(max-width:\s*720px\)[\s\S]*?body\.vx-customer-design-foundation\s+\.vx-page-header-title\s*\{[^{}]*font-size:\s*24px;[^{}]*\}",
    foundation,
), "corrected title rule is not inside the mobile media block"
write(foundation_path, foundation)


# 3. Harden the Design Foundation verifier at the existing ownership boundary.
design_path = "scripts/verify-customer-design-foundation.mjs"
design = read(design_path)
marker = """for (const token of [
  '.vx-ap-stack',"""
assert design.count(marker) == 1, "design verifier insertion marker changed"
assertions = r"""assert.match(
  foundationCss,
  /@media\s*\(max-width:\s*720px\)\s*\{[\s\S]*?body\.vx-customer-design-foundation\s+\.vx-page-header-title\s*\{\s*font-size:\s*24px;\s*\}/,
  'foundation mobile page-header title must use 24px'
);

assert.match(
  dashboard,
  /@media\s*\(max-width:\s*720px\)\s*\{\s*body\.vx-customer-design-foundation\s+#dash-greeting-block\s*>\s*\.vx-ap-head\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*minmax\(0,\s*1fr\);\s*gap:\s*9px;\s*\}\s*body\.vx-customer-design-foundation\s+#dash-greeting-block\s*>\s*\.vx-ap-head\s*>\s*\.vx-page-header-subtitle\s*\{\s*margin-top:\s*0;\s*font-size:\s*12px;\s*text-align:\s*left;\s*white-space:\s*nowrap;\s*\}\s*\}/,
  'dashboard mobile greeting block must be complete'
);

assert.doesNotMatch(
  dashboard,
  /(?:^|\n)\s*font-size:\s*24px;\s*\}\s*body\.vx-customer-design-foundation\s+#dash-greeting-block/,
  'dashboard must not contain an orphaned top-level mobile title fragment before the greeting block'
);

"""
design = design.replace(marker, assertions + marker, 1)
write(design_path, design)


# 4. Update only the stale Calendar UI visibility contract.
calendar_path = "scripts/verify-calendar-integrations.mjs"
calendar = read(calendar_path)
old_enabled = "  'state.enabled && providers.length',"
old_hidden = "  'entry.hidden = !(state.enabled && providers.length)'"
assert calendar.count(old_enabled) == 1, "calendar enabled-token anchor changed"
assert calendar.count(old_hidden) == 1, "calendar hidden-token anchor changed"
calendar = calendar.replace(old_enabled, "  'entry.hidden = false;',", 1)
calendar = calendar.replace(old_hidden, "  'if (entry) entry.hidden = false;'", 1)
ui_loop_boundary = """  if (!source.runtime.includes(token)) failures.push('Calendar UI missing: ' + token);
}
for (const token of [
  '.vx-settings-entry',"""
assert calendar.count(ui_loop_boundary) == 1, "calendar UI loop boundary changed"
negative_guard = """  if (!source.runtime.includes(token)) failures.push('Calendar UI missing: ' + token);
}
if (source.runtime.includes('entry.hidden = !(state.enabled && providers.length)')) {
  failures.push('Calendar UI contains stale conditional entry visibility');
}
for (const token of [
  '.vx-settings-entry',"""
calendar = calendar.replace(ui_loop_boundary, negative_guard, 1)
assert calendar.count("entry.hidden = !(state.enabled && providers.length)") == 1
write(calendar_path, calendar)
