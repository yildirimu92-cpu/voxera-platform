import fs from 'node:fs';

const source = fs.readFileSync('customer-dashboard/index.html', 'utf8');

function printBlock(label, startToken, length = 12000) {
  const start = source.indexOf(startToken);
  console.log(`\n===== ${label} =====`);
  if (start < 0) {
    console.log('NOT FOUND:', startToken);
    return;
  }
  console.log(source.slice(start, start + length));
}

function functionRange(name) {
  const start = source.indexOf(`function ${name}(`);
  console.log(`\n===== FUNCTION ${name} =====`);
  if (start < 0) {
    console.log('NOT FOUND');
    return;
  }
  const next = source.indexOf('\nfunction ', start + 20);
  console.log(source.slice(start, next > start ? next : start + 16000));
}

printBlock('REPORT HOST', '<div id="tab-auswertung"', 18000);

const functionNames = [...source.matchAll(/function\s+([A-Za-z0-9_$]*(?:Auswertung|Report|Bericht|Analytics)[A-Za-z0-9_$]*)\s*\(/g)]
  .map((m) => m[1]);
console.log('\n===== REPORT FUNCTIONS =====');
console.log([...new Set(functionNames)].sort().join('\n'));

for (const name of [...new Set(functionNames)].sort()) functionRange(name);

const reportSelectors = [...source.matchAll(/([^{}]*?(?:#tab-auswertung|\.report-|\.auswertung-|\.vx-report|\.analytics-|\.reporting-)[^{}]*)\{/g)]
  .map((m) => m[1].trim())
  .filter(Boolean);
console.log('\n===== REPORT SELECTOR COUNT =====');
console.log(reportSelectors.length);
console.log(reportSelectors.slice(0, 300).join('\n'));

const inlineReportStyles = [...source.matchAll(/<[^>]+style="[^"]+"[^>]*>/g)]
  .map((m) => m[0])
  .filter((html) => /report|auswertung|analytics|kpi|summary|action/i.test(html));
console.log('\n===== REPORT INLINE STYLE SAMPLE =====');
console.log(inlineReportStyles.slice(0, 120).join('\n'));
