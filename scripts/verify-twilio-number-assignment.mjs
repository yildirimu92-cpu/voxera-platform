import fs from 'node:fs';import vm from 'node:vm';
const files={admin:'admin-panel/netlify/functions/admin-twilio-number-assignment.js',runtime:'admin-panel/shared/admin-runtime-twilio-number-assignment.js',router:'customer-dashboard/netlify/functions/twilio-inbound-router.js',migration:'supabase/migrations/2026-08-01_twilio_number_assignments.sql',correction:'supabase/migrations/2026-08-01_fix_twilio_assignment_customer_schema.sql',loader:'admin-panel/shared/offer-brand.js',customerUpdate:'admin-panel/netlify/functions/admin-customer-update.js'};
const source=Object.fromEntries(Object.entries(files).map(([key,path])=>[key,fs.readFileSync(path,'utf8')]));const failures=[];
for(const key of ['admin','runtime','router']){try{new vm.Script(source[key],{filename:files[key]});}catch(error){failures.push(error.message);}}
for(const token of ["requiredCapability:'customer:write'","action==='list'","action==='assign'","action==='verify'","rpc('assign_twilio_number'"])if(!source.admin.includes(token))failures.push('Admin workflow missing: '+token);
for(const forbidden of ['AvailablePhoneNumbers','IncomingPhoneNumbers.create',"action==='release'","action==='purchase'"])if(source.admin.includes(forbidden))failures.push('Provision/release capability found: '+forbidden);
for(const token of ['openTwilioNumberAssignment','nummer eintragen','data-assign','data-confirm-approve',"e.key==='Escape'"])if(!source.runtime.toLowerCase().includes(token.toLowerCase()))failures.push('Runtime missing: '+token);
if(source.runtime.includes('voxConfirm')||source.runtime.includes('root.confirm'))failures.push('Runtime still nests a second confirmation modal');
for(const token of ['X-Twilio-Signature','TWILIO_WEBHOOK_SIGNATURE_ENFORCEMENT_ENABLED','validateTwilioSignature'])if(!source.router.includes(token))failures.push('Webhook guard missing: '+token);
for(const token of ['telephony_numbers','telephony_number_assignment_audit','assign_twilio_number','grant execute'])if(!source.migration.includes(token))failures.push('Migration missing: '+token);
if(source.correction.includes('deleted_at')||source.correction.includes('uuid'))failures.push('Correction migration contains incompatible customer schema assumptions');
if(!source.loader.includes('/shared/admin-runtime-twilio-number-assignment.js'))failures.push('Runtime loader entry missing');
for(const token of ["'voxera_number'","'voxera'","'elevenlabs_agent_id'"])if(!source.customerUpdate.includes(token))failures.push('Protected field missing: '+token);
if(failures.length){console.error(failures.join('\n'));process.exit(1);}console.log('Twilio number assignment verification passed.');
