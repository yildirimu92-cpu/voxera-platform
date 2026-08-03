import assert from 'node:assert/strict';
import fs from 'node:fs';

const path = 'customer-dashboard/shared/customer-assistant-components.css';
let css = fs.readFileSync(path, 'utf8');
const marker = '/* Customer report mobile visual QA polish. */';
assert.ok(css.includes('/* Customer report: assistant-aligned canonical component owner. */'), 'Canonical report component owner missing');
assert.ok(!css.includes(marker), 'Mobile report polish already present');

css += `

${marker}
@media (max-width:520px){
  body.vx-customer-design-foundation .vx-report-stack{gap:12px;}
  body.vx-customer-design-foundation .vx-report-kpi{min-height:124px;}
  body.vx-customer-design-foundation .vx-report-section{gap:12px;padding:16px;}
  body.vx-customer-design-foundation .vx-report-section .vx-ops-head{gap:8px;}
  body.vx-customer-design-foundation .vx-report-section .vx-ops-title{font-size:17px;}
  body.vx-customer-design-foundation .vx-report-section .vx-ops-sub{font-size:13px;line-height:1.45;}
  body.vx-customer-design-foundation .vx-report-section .vx-ops-list{gap:8px;margin-top:2px;}
  body.vx-customer-design-foundation .vx-report-section .vx-ops-empty{padding:14px 8px;}
  body.vx-customer-design-foundation .vx-report-highlights{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}
  body.vx-customer-design-foundation .vx-report-highlight{padding:12px;}
  body.vx-customer-design-foundation .vx-report-highlight-value{font-size:17px;}
  body.vx-customer-design-foundation .vx-report-week-chart{min-height:88px;gap:5px;}
  body.vx-customer-design-foundation .vx-report-week-col{height:84px;gap:4px;}
  body.vx-customer-design-foundation .vx-report-week-bar{height:calc(4px + 48px * var(--vx-report-level));}
  body.vx-customer-design-foundation .vx-report-week-foot{padding-top:10px;}
  body.vx-customer-design-foundation .vx-report-bars{gap:9px;}
  body.vx-customer-design-foundation .vx-report-bar-row{grid-template-columns:58px minmax(0,1fr) 24px;gap:8px;}
  body.vx-customer-design-foundation .vx-report-leads{gap:0;}
  body.vx-customer-design-foundation .vx-report-lead-row{grid-template-columns:auto minmax(0,1fr) auto auto;column-gap:8px;row-gap:6px;padding:11px 0;border-bottom:1px solid var(--vx-line);}
  body.vx-customer-design-foundation .vx-report-lead-row:last-child{border-bottom:0;}
  body.vx-customer-design-foundation .vx-report-lead-row .vx-report-progress{grid-column:2/-1;height:6px;}
}
@media (max-width:360px){
  body.vx-customer-design-foundation .vx-report-highlights{grid-template-columns:1fr;}
}
`;

fs.writeFileSync(path, css);
console.log('Customer report mobile visual QA polish applied.');
