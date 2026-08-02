import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('customer-dashboard');
const EXCLUDED_DIRS = new Set(['node_modules', '.netlify', 'netlify']);
const INCLUDED_EXTENSIONS = new Set(['.css', '.html', '.js', '.mjs']);
const CANONICAL_CSS = new Set([
  'shared/customer-design-system.css',
  'shared/customer-assistant-components.css',
  'shared/customer-assistant-status.css',
  'shared/customer-navigation-components.css',
  'shared/customer-support-components.css'
]);

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') && entry.name !== '.well-known') return [];
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) return [];
      return walk(absolute);
    }
    return INCLUDED_EXTENSIONS.has(path.extname(entry.name)) ? [absolute] : [];
  });
}

function count(source, pattern) {
  return (source.match(pattern) || []).length;
}

function relative(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, '/');
}

function inspect(file) {
  const source = fs.readFileSync(file, 'utf8');
  const rel = relative(file);
  const extension = path.extname(file);
  return {
    file: rel,
    type: extension.slice(1),
    lines: source.split(/\r?\n/).length,
    canonicalCss: CANONICAL_CSS.has(rel),
    fontFamily: count(source, /font-family\s*:/gi),
    fontSize: count(source, /font-size\s*:/gi),
    important: count(source, /!important/gi),
    styleTags: count(source, /<style\b/gi),
    styleElementCreation: count(source, /createElement\(\s*['"]style['"]\s*\)/gi),
    styleTextWrites: count(source, /\b(?:style|node)\.(?:textContent|innerHTML)\s*=/g),
    inlineStyleAttributes: count(source, /\bstyle\s*=\s*['"]/gi),
    directStyleWrites: count(source, /\.style\.(?:[a-zA-Z_$][\w$]*|setProperty|removeProperty)\s*(?:=|\()/g),
    buttonSelectors: extension === '.css' ? count(source, /(?:^|[,{\s])[^{}]*(?:\.btn\b|\.vx-[\w-]*btn\b|button\b)[^{]*\{/gim) : 0,
    cardSelectors: extension === '.css' ? count(source, /(?:^|[,{\s])[^{}]*\.vx-[\w-]*card\b[^{]*\{/gim) : 0
  };
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + row[field], 0);
}

function debt(row) {
  return row.styleElementCreation + row.styleTextWrites + row.inlineStyleAttributes + row.directStyleWrites + row.important;
}

function table(rows, fields) {
  if (!rows.length) return '_Keine Treffer._';
  const header = `| Datei | ${fields.map(([label]) => label).join(' | ')} |`;
  const divider = `|---|${fields.map(() => '---:').join('|')}|`;
  const body = rows.map((row) => `| \`${row.file}\` | ${fields.map(([, key]) => row[key]).join(' | ')} |`).join('\n');
  return `${header}\n${divider}\n${body}`;
}

if (!fs.existsSync(ROOT)) {
  console.error('customer-dashboard directory not found');
  process.exit(1);
}

const rows = walk(ROOT).map(inspect).sort((a, b) => a.file.localeCompare(b.file));
const cssRows = rows.filter((row) => row.type === 'css');
const runtimeStyling = rows.filter((row) => row.type === 'js' && (row.styleElementCreation || row.styleTextWrites || row.inlineStyleAttributes || row.directStyleWrites));
const typographyOwners = rows.filter((row) => row.fontFamily || row.fontSize);
const importantOwners = rows.filter((row) => row.important);
const inlineOwners = rows.filter((row) => row.inlineStyleAttributes || row.directStyleWrites);
const topDebt = [...rows]
  .filter((row) => debt(row))
  .map((row) => ({ ...row, debtScore: debt(row) }))
  .sort((a, b) => b.debtScore - a.debtScore)
  .slice(0, 20);

const output = `# Customer Dashboard Design Ownership Inventory\n\n` +
`Scope: frontend files below \`customer-dashboard\`; Netlify Functions and generated build directories are excluded.\n\n` +
`## Summary\n\n` +
`| Metric | Count |\n|---|---:|\n` +
`| Audited frontend files | ${rows.length} |\n` +
`| CSS files | ${cssRows.length} |\n` +
`| Canonical CSS modules | ${cssRows.filter((row) => row.canonicalCss).length} |\n` +
`| Font-family declarations | ${sum(rows, 'fontFamily')} |\n` +
`| Font-size declarations | ${sum(rows, 'fontSize')} |\n` +
`| JavaScript style-element creations | ${sum(rows, 'styleElementCreation')} |\n` +
`| JavaScript style text writes | ${sum(rows, 'styleTextWrites')} |\n` +
`| Inline style attributes | ${sum(rows, 'inlineStyleAttributes')} |\n` +
`| Direct .style writes | ${sum(rows, 'directStyleWrites')} |\n` +
`| !important uses | ${sum(rows, 'important')} |\n\n` +
`## Canonical CSS modules\n\n` +
`${table(cssRows.filter((row) => row.canonicalCss), [['Lines', 'lines'], ['font-size', 'fontSize'], ['button selectors', 'buttonSelectors'], ['card selectors', 'cardSelectors']])}\n\n` +
`## Runtime-owned presentation\n\n` +
`${table(runtimeStyling, [['style elements', 'styleElementCreation'], ['style text', 'styleTextWrites'], ['inline styles', 'inlineStyleAttributes'], ['.style writes', 'directStyleWrites']])}\n\n` +
`## Typography owners\n\n` +
`${table(typographyOwners, [['font-family', 'fontFamily'], ['font-size', 'fontSize']])}\n\n` +
`## Inline and direct styling owners\n\n` +
`${table(inlineOwners, [['inline styles', 'inlineStyleAttributes'], ['.style writes', 'directStyleWrites']])}\n\n` +
`## !important owners\n\n` +
`${table(importantOwners, [['uses', 'important']])}\n\n` +
`## Highest migration debt\n\n` +
`${table(topDebt, [['debt score', 'debtScore'], ['lines', 'lines']])}\n`;

console.log(output);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, output);

const outputArg = process.argv.indexOf('--write');
if (outputArg !== -1) {
  const target = process.argv[outputArg + 1];
  if (!target) throw new Error('--write requires a path');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, output);
}
