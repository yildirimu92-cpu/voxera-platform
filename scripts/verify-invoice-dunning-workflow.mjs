import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const {
  evaluateInvoiceDunning,
  dunningPatchForLevel
}=require('../admin-panel/netlify/functions/_lib/invoice-dunning.js');

const now=new Date('2026-08-01T12:00:00Z');
const scenarios=[
  ['future invoice is blocked',{status:'open',due_at:'2026-08-07',reminder_level:0},false,null,'invoice_not_overdue'],
  ['due today is blocked',{status:'open',due_at:'2026-08-01',reminder_level:0},false,null,'invoice_not_overdue'],
  ['grace period is blocked',{status:'open',due_at:'2026-07-30',reminder_level:0},false,null,'reminder_grace_period'],
  ['L1 opens after three days',{status:'open',due_at:'2026-07-29',reminder_level:0},true,1,'reminder_due'],
  ['L2 waits seven days',{status:'open',due_at:'2026-07-20',reminder_level:1,reminder_1_sent_at:'2026-07-28T10:00:00Z'},false,null,'final_reminder_wait'],
  ['L2 opens after seven days',{status:'open',due_at:'2026-07-20',reminder_level:1,reminder_1_sent_at:'2026-07-25T10:00:00Z'},true,2,'final_reminder_due'],
  ['paid invoice is blocked',{status:'paid',paid_at:'2026-07-30T10:00:00Z',due_at:'2026-07-20',reminder_level:0},false,null,'invoice_paid']
];

for(const [label,invoice,canRemind,level,reason] of scenarios){
  const result=evaluateInvoiceDunning(invoice,{now});
  if(result.can_remind!==canRemind||result.eligible_level!==level||result.reason_code!==reason){
    throw new Error(`${label}: unexpected result ${JSON.stringify(result)}`);
  }
  console.log(`PASS ${label}`);
}

const l1Patch=dunningPatchForLevel(1,{now,outboxId:'outbox-1'});
const l2Patch=dunningPatchForLevel(2,{now,outboxId:'outbox-2'});
if(l1Patch.reminder_level!==1||!l1Patch.reminder_1_sent_at||l1Patch.dunning_status!=='reminder_sent'){
  throw new Error('L1 patch is incomplete.');
}
if(l2Patch.reminder_level!==2||!l2Patch.final_reminder_sent_at||!l2Patch.suspension_review_at||l2Patch.dunning_status!=='final_sent'){
  throw new Error('L2 patch is incomplete.');
}

const files=[
  'admin-panel/netlify/functions/mail-dispatch.js',
  'admin-panel/netlify/functions/invoice-mail-preview.js',
  'admin-panel/netlify/functions/invoice-mail-dispatch.js',
  'admin-panel/netlify/functions/customer-billing-update.js',
  'admin-panel/netlify/functions/daily-billing-runner.js',
  'admin-panel/shared/admin-runtime-operations-v3.js',
  'admin-panel/shared/admin-runtime-billing-inline-qr.js'
];
for(const file of files){
  new vm.Script(fs.readFileSync(file,'utf8'),{filename:file});
}

const adminIndex=fs.readFileSync('admin-panel/index.html','utf8');
const inlineScripts=[...adminIndex.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(match=>!/\bsrc\s*=/.test(match[1]||''));
for(const script of inlineScripts)new vm.Script(script[2]||'',{filename:'admin-panel/index.html:inline'});

const preview=fs.readFileSync('admin-panel/netlify/functions/invoice-mail-preview.js','utf8');
const dispatch=fs.readFileSync('admin-panel/netlify/functions/invoice-mail-dispatch.js','utf8');
const genericDispatch=fs.readFileSync('admin-panel/netlify/functions/mail-dispatch.js','utf8');
const billingUpdate=fs.readFileSync('admin-panel/netlify/functions/customer-billing-update.js','utf8');
const runner=fs.readFileSync('admin-panel/netlify/functions/daily-billing-runner.js','utf8');
const operations=fs.readFileSync('admin-panel/shared/admin-runtime-operations-v3.js','utf8');
const migration=fs.readFileSync('supabase/sql/2026-08-01_invoice_dunning_state_machine.sql','utf8');

const checks=[
  ['preview enforces canonical eligibility',preview.includes('evaluateInvoiceDunning')&&preview.includes('step_failed:dunning.reason_code')],
  ['invoice dispatch uses deterministic level idempotency',dispatch.includes(':level:${requestedLevel}')&&dispatch.includes('persistDunningState')],
  ['generic dispatch enforces and persists dunning',genericDispatch.includes('evaluateInvoiceDunning')&&genericDispatch.includes('dunningContext')],
  ['direct reminder recording is blocked',billingUpdate.includes('canonical_dunning_dispatch_required')],
  ['scheduled sweep uses shared eligibility',runner.includes('evaluateInvoiceDunning')&&!runner.includes("notes.includes('[REMINDER")],
  ['operations escalation uses canonical stage',operations.includes("stage === 'suspension_review'")],
  ['table action uses canonical eligibility',adminIndex.includes('getInvoiceDunningEligibility')&&adminIndex.includes('const canRemind = Boolean')],
  ['migration creates canonical dunning columns',migration.includes('reminder_1_sent_at')&&migration.includes('final_reminder_sent_at')&&migration.includes('dunning_status')]
];
for(const [label,passed] of checks){
  if(!passed)throw new Error(`FAIL ${label}`);
  console.log(`PASS ${label}`);
}
console.log('Canonical invoice dunning workflow verified.');
