import fs from 'node:fs';

const source = fs.readFileSync('customer-dashboard/index.html', 'utf8');

function printSlice(label, start, end) {
  console.log(`\n===== ${label} =====`);
  if (start < 0) {
    console.log('NOT FOUND');
    return;
  }
  console.log(source.slice(start, end));
}

function functionRange(name) {
  const start = source.indexOf(`function ${name}(`);
  console.log(`\n===== FUNCTION ${name} =====`);
  if (start < 0) {
    console.log('NOT FOUND');
    return;
  }
  const next = source.indexOf('\nfunction ', start + 20);
  console.log(source.slice(start, next > start ? next : start + 18000));
}

const hostId = source.indexOf('id="tab-auswertung"');
const hostStart = hostId < 0 ? -1 : source.lastIndexOf('<', hostId);
const nextTab = hostId < 0 ? -1 : source.indexOf('class="tab-page', hostId + 20);
printSlice('REPORT HOST', hostStart, nextTab > hostStart ? nextTab : hostStart + 26000);

if (hostStart >= 0) {
  const hostEnd = nextTab > hostStart ? nextTab : hostStart + 26000;
  const host = source.slice(hostStart, hostEnd);
  const ids = [...host.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  const classes = [...host.matchAll(/class="([^"]+)"/g)]
    .flatMap((m) => m[1].split(/\s+/))
    .filter(Boolean);
  console.log('\n===== REPORT HOST IDS =====');
  console.log([...new Set(ids)].join('\n'));
  console.log('\n===== REPORT HOST CLASSES =====');
  console.log([...new Set(classes)].sort().join('\n'));
}

const functionNames = [...source.matchAll(/function\s+((?:_au|au|vxAu|renderAuswertung)[A-Za-z0-9_$]*)\s*\(/g)]
  .map((m) => m[1]);
console.log('\n===== REPORT FUNCTIONS =====');
console.log([...new Set(functionNames)].sort().join('\n'));
for (const name of [...new Set(functionNames)].sort()) functionRange(name);

const styleBlocks = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
let reportRuleCount = 0;
console.log('\n===== REPORT-ONLY STYLE BLOCKS =====');
for (let i = 0; i < styleBlocks.length; i += 1) {
  const body = styleBlocks[i][1];
  const rules = [...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => ({ selector: m[1].trim(), body: m[2].trim() }))
    .filter((rule) => /#tab-auswertung|\.au2-|\.au-|\.vx-report/.test(rule.selector));
  if (!rules.length) continue;
  reportRuleCount += rules.length;
  console.log(`\n--- STYLE BLOCK ${i + 1}: ${rules.length} matching rules ---`);
  for (const rule of rules) console.log(`${rule.selector}{${rule.body}}`);
}
console.log('\n===== REPORT RULE COUNT =====');
console.log(reportRuleCount);

const scriptStart = source.indexOf('function renderAuswertung(');
const scriptEnd = scriptStart < 0 ? -1 : source.indexOf('\n</script>', scriptStart);
if (scriptStart >= 0) {
  const reportScript = source.slice(scriptStart, scriptEnd > scriptStart ? scriptEnd : scriptStart + 90000);
  console.log('\n===== REPORT DIRECT STYLE WRITES =====');
  console.log([...reportScript.matchAll(/[^\n]*(?:\.style\.|style\.cssText|style=")[^\n]*/g)].map((m) => m[0]).slice(0, 240).join('\n'));
}
