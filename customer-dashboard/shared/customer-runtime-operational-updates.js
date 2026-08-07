(function initVoxeraOperationalUpdates(root) {
  'use strict';
  if (!root || !root.document || root.__vxOperationalUpdatesInstalled) return;
  root.__vxOperationalUpdatesInstalled = true;

  const labels = {
    closure: 'Ferien / geschlossen',
    special_hours: 'Geänderte Öffnungszeiten',
    absence: 'Abwesenheit',
    temporary_contact: 'Temporäre Kontaktperson',
    appointment_pause: 'Terminannahme pausieren',
    notice: 'Temporärer Hinweis'
  };

  const presets = {
    closure: {
      title: 'Betriebsferien / vorübergehend geschlossen',
      message: 'Unser Betrieb ist im angegebenen Zeitraum geschlossen. Danach sind wir wieder wie gewohnt erreichbar.',
      appointment: 'after_end', callback: 'after_end', general: 'normal',
      startLabel: 'Geschlossen ab', endLabel: 'Wieder geöffnet ab',
      summary: 'Voxera beantwortet allgemeine Fragen weiterhin, nimmt Rückrufwünsche auf und bietet Termine nach Ihrer Rückkehr an.',
      preview: 'Aktuell ist unser Betrieb geschlossen. Gerne kann ich Ihnen bereits einen Termin nach unserer Rückkehr anbieten.'
    },
    special_hours: {
      title: 'Geänderte Öffnungszeiten', message: 'Im angegebenen Zeitraum gelten abweichende Öffnungszeiten.',
      appointment: 'available_only', callback: 'normal', general: 'mention',
      startLabel: 'Sonderzeiten gelten ab', endLabel: 'Sonderzeiten gelten bis',
      summary: 'Voxera berücksichtigt die abweichenden Zeiten und beantwortet übrige Fragen normal.',
      preview: 'Im angegebenen Zeitraum gelten besondere Öffnungszeiten. Ich berücksichtige diese bei Ihrer Anfrage.'
    },
    absence: {
      title: 'Vorübergehende Abwesenheit', message: 'Die gewünschte Ansprechperson ist im angegebenen Zeitraum nicht erreichbar.',
      appointment: 'normal', callback: 'after_end', general: 'normal',
      startLabel: 'Abwesend ab', endLabel: 'Wieder erreichbar ab',
      summary: 'Voxera nimmt personenspezifische Anliegen auf und kündigt eine Rückmeldung nach der Abwesenheit an.',
      preview: 'Die gewünschte Ansprechperson ist momentan abwesend. Gerne nehme ich Ihre Kontaktdaten für eine spätere Rückmeldung auf.'
    },
    temporary_contact: {
      title: 'Temporäre Kontaktperson', message: 'Im angegebenen Zeitraum steht eine temporäre Kontaktperson zur Verfügung.',
      appointment: 'normal', callback: 'temporary_contact', general: 'normal',
      startLabel: 'Vertretung gilt ab', endLabel: 'Vertretung gilt bis',
      summary: 'Voxera verweist bei passenden Anliegen auf die temporäre Kontaktperson.',
      preview: 'Für Ihr Anliegen steht vorübergehend eine andere Kontaktperson zur Verfügung.'
    },
    appointment_pause: {
      title: 'Terminannahme vorübergehend eingeschränkt', message: 'Im angegebenen Zeitraum können keine Termine innerhalb dieses Zeitraums vereinbart werden.',
      appointment: 'after_end', callback: 'collect', general: 'normal',
      startLabel: 'Terminpause ab', endLabel: 'Terminannahme wieder ab',
      summary: 'Voxera bietet Termine nach der Pause an, nimmt Rückrufwünsche auf und beantwortet allgemeine Fragen normal.',
      preview: 'Innerhalb des angegebenen Zeitraums sind keine Termine möglich. Gerne kann ich Ihnen einen Termin danach anbieten.'
    },
    notice: {
      title: 'Temporärer Hinweis', message: 'Bitte beachten Sie den folgenden vorübergehenden Hinweis.',
      appointment: 'normal', callback: 'normal', general: 'mention',
      startLabel: 'Hinweis gilt ab', endLabel: 'Hinweis gilt bis',
      summary: 'Voxera erwähnt den Hinweis nur, wenn er für das Anliegen relevant ist.',
      preview: 'Gerne informiere ich Sie über einen aktuell geltenden Hinweis.'
    }
  };

  const appointmentLabels = { after_end:'Termine nach dem Zeitraum anbieten', available_only:'Nur verfügbare Zeiten berücksichtigen', collect:'Keine Termine buchen, Rückrufanfrage aufnehmen', blocked:'Keine Termine buchen und keine Rückrufzusage machen', normal:'Normale Terminlogik beibehalten' };
  const callbackLabels = { after_end:'Aufnehmen und Rückruf nach dem Zeitraum ankündigen', collect:'Kontaktdaten aufnehmen', normal:'Normal aufnehmen', temporary_contact:'An temporäre Kontaktperson verweisen', blocked:'Keine Rückrufzusage machen' };
  const generalLabels = { normal:'Normal beantworten', mention:'Zusätzlich kurz auf die aktuelle Änderung hinweisen', lead:'Aktuelle Änderung zuerst erwähnen' };

  let state = { updates: [], server_time: new Date().toISOString() };
  let editingId = '';
  let busy = false;
  let statusTimer = null;

  const skeleton = (options) => (root.VoxeraUI ? root.VoxeraUI.skeleton(options) : '');
  const badgeHtml = (label) => (root.VoxeraUI ? root.VoxeraUI.badge(label) : '<span class="vx-ui-badge">' + esc(label) + '</span>');
  const emptyStateHtml = (icon, title, text) => (root.VoxeraUI ? root.VoxeraUI.emptyState({ icon, title, text }) : '<div class="vx-ui-empty">' + esc(title) + '</div>');

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[char]));

  function inject() {
    const tab = document.getElementById('tab-mehr');
    if (!tab) return false;
    if (!document.getElementById('mehr-sub-betriebsinfos')) {
      const page = document.createElement('div');
      page.id = 'mehr-sub-betriebsinfos';
      page.hidden = true;
      page.innerHTML = '<div id="vx-operational-page-body"></div>';
      tab.appendChild(page);
    }
    return true;
  }

  function formatDate(value) { const date = new Date(value); if (!Number.isFinite(date.getTime())) return '–'; return new Intl.DateTimeFormat('de-CH',{timeZone:'Europe/Zurich',dateStyle:'medium',timeStyle:'short'}).format(date); }
  function localValue(value) { const date = value ? new Date(value) : new Date(); const shifted = new Date(date.getTime()-date.getTimezoneOffset()*60000); return shifted.toISOString().slice(0,16); }
  function phase(item) { if (item.status==='cancelled') return {key:'cancelled',label:'Zurückgezogen'}; const now=new Date(state.server_time||Date.now()).getTime(); if(new Date(item.ends_at).getTime()<=now) return {key:'expired',label:'Abgelaufen'}; if(new Date(item.starts_at).getTime()<=now) return {key:'active',label:'Aktiv'}; return {key:'scheduled',label:'Geplant'}; }
  function visibleItems(){ return [...(state.updates||[])].sort((a,b)=>{const rank={active:0,scheduled:1,expired:2,cancelled:3};return rank[phase(a).key]-rank[phase(b).key]||new Date(a.starts_at)-new Date(b.starts_at);}); }
  function parseBehavior(value){ const result={appointment:'',callback:'',general:''}; String(value||'').split(/\.\s*/).forEach((part)=>{ if(/^Neue Termine:/i.test(part)) result.appointment=part.replace(/^Neue Termine:\s*/i,'').trim(); if(/^Rückrufwünsche:/i.test(part)) result.callback=part.replace(/^Rückrufwünsche:\s*/i,'').trim(); if(/^Allgemeine Fragen:/i.test(part)) result.general=part.replace(/^Allgemeine Fragen:\s*/i,'').trim(); }); return result; }
  function itemHtml(item){ const status=phase(item); const canEdit=item.status!=='cancelled'&&status.key!=='expired'; const sync=item.sync_status==='failed'?' · Prompt-Sync ausstehend':''; const rules=parseBehavior(item.behavior); return '<div class="vx-ops-item '+esc(status.key)+'"><div class="vx-ops-head"><div><div class="vx-ops-title">'+esc(item.title)+'</div><div class="vx-ops-sub">'+esc(labels[item.type]||item.type)+'</div></div>'+badgeHtml(status.label)+'</div><div class="vx-ops-message">'+esc(item.message)+'</div><div class="vx-ops-rules"><div class="vx-ops-rule"><b>Neue Termine</b><span>'+esc(rules.appointment||'Gemäss Standardlogik')+'</span></div><div class="vx-ops-rule"><b>Rückrufwünsche</b><span>'+esc(rules.callback||'Gemäss Standardlogik')+'</span></div><div class="vx-ops-rule"><b>Allgemeine Fragen</b><span>'+esc(rules.general||'Normal beantworten')+'</span></div><div class="vx-ops-rule"><b>Bestehende Termine</b><span>Absagen und Verschiebungen weiterhin bearbeiten</span></div><div class="vx-ops-rule"><b>Notfälle</b><span>Bestehende Notfall- und Sicherheitsregeln verwenden</span></div></div><div class="vx-ops-meta">'+esc(formatDate(item.starts_at))+' – '+esc(formatDate(item.ends_at))+esc(sync)+'</div>'+(canEdit?'<div class="vx-ops-actions"><button type="button" class="vx-ops-btn secondary" data-ops-edit="'+esc(item.id)+'">Bearbeiten</button><button type="button" class="vx-ops-btn danger" data-ops-cancel="'+esc(item.id)+'">Zurückziehen</button></div>':'')+'</div>'; }
  function option(value,label){ return '<option value="'+esc(value)+'">'+esc(label)+'</option>'; }

  function formHtml(){ return '<div class="vx-ops-form"><div class="vx-ops-field"><label>Was ist passiert?</label><select id="vx-ops-type">'+Object.entries(labels).map(([value,label])=>option(value,label)).join('')+'</select></div><div class="vx-ops-grid"><div class="vx-ops-field"><label id="vx-ops-start-label">Gültig ab</label><input id="vx-ops-start" type="datetime-local"></div><div class="vx-ops-field"><label id="vx-ops-end-label">Gültig bis</label><input id="vx-ops-end" type="datetime-local"></div></div><div class="vx-ops-section"><div class="vx-ops-section-title">Empfohlene Gesprächslogik</div><div class="vx-ops-summary" id="vx-ops-summary"></div><details class="vx-ops-details" id="vx-ops-rule-details"><summary>Einstellungen anpassen</summary><div class="vx-ops-details-body"><div class="vx-ops-field"><label>Neue Termine</label><select id="vx-ops-appointment">'+option('after_end','Termine nach dem Zeitraum anbieten (empfohlen)')+option('available_only','Nur verfügbare Zeiten berücksichtigen')+option('collect','Keine Termine buchen, Rückrufanfrage aufnehmen')+option('blocked','Keine Termine buchen und keine Rückrufzusage machen')+option('normal','Normale Terminlogik beibehalten')+'</select></div><div class="vx-ops-field"><label>Rückrufwünsche</label><select id="vx-ops-callback">'+option('after_end','Aufnehmen und Rückruf nach dem Zeitraum ankündigen')+option('collect','Kontaktdaten aufnehmen')+option('normal','Normal aufnehmen')+option('temporary_contact','An temporäre Kontaktperson verweisen')+option('blocked','Keine Rückrufzusage machen')+'</select></div><div class="vx-ops-field"><label>Allgemeine Fragen</label><select id="vx-ops-general">'+option('normal','Normal beantworten')+option('mention','Zusätzlich kurz auf die aktuelle Änderung hinweisen')+option('lead','Aktuelle Änderung zuerst erwähnen')+'</select></div></div></details><div class="vx-ops-fixed"><div class="vx-ops-fixed-line"><i class="ph-bold ph-check-circle"></i><span><strong>Bestehende Termine:</strong> Absagen und Verschiebungen werden weiterhin bearbeitet.</span></div><div class="vx-ops-fixed-line"><i class="ph-bold ph-shield-check"></i><span><strong>Notfälle:</strong> Bestehende Notfall- und Sicherheitsregeln bleiben aktiv.</span></div></div></div><div class="vx-ops-preview"><strong>So informiert Voxera Anrufende</strong><p id="vx-ops-preview"></p></div><details class="vx-ops-details"><summary>Text und erweiterte Anweisung anpassen</summary><div class="vx-ops-details-body"><div class="vx-ops-field"><label>Information für Anrufende</label><textarea id="vx-ops-message" maxlength="500"></textarea></div><div class="vx-ops-field"><label>Zusätzliche KI-Anweisung (optional)</label><textarea id="vx-ops-extra" maxlength="300" placeholder="Nur für echte Ausnahmen verwenden."></textarea></div><div class="vx-ops-field"><label>Interner Titel</label><input id="vx-ops-title" maxlength="100"></div></div></details><div class="vx-ops-actions"><button type="button" class="vx-ops-btn" id="vx-ops-save"'+(busy?' disabled':'')+'>'+(editingId?'Änderung speichern':'Veröffentlichen')+'</button>'+(editingId?'<button type="button" class="vx-ops-btn secondary" id="vx-ops-reset">Abbrechen</button>':'')+'</div></div>'; }

  function render(){ const body=document.getElementById('vx-operational-page-body'); if(!body)return; const items=visibleItems(); body.innerHTML='<div id="vx-ops-status" class="vx-ops-status" role="status" aria-live="polite"></div><div class="vx-ops-layout"><section class="vx-ops-card"><div class="vx-ops-title">Aktiv und geplant</div><div class="vx-ops-sub">Temporäre Regeln gelten nur im gewählten Zeitraum. Dauerhafte Unternehmensdaten bleiben unverändert.</div><div class="vx-ops-list">'+(items.length?items.map(itemHtml).join(''):emptyStateHtml('ph-megaphone','Noch keine aktuelle Änderung','Ferien, Umzug oder eine kurzfristige Änderung? Erfassen Sie sie hier, damit Ihr Assistent Bescheid weiss.'))+'</div></section><section class="vx-ops-card"><div class="vx-ops-title" id="vx-ops-form-title">'+(editingId?'Aktuelle Änderung bearbeiten':'Neue aktuelle Änderung')+'</div><div class="vx-ops-sub">Wählen Sie die geschäftliche Situation. Voxera schlägt eine sichere Gesprächslogik vor.</div>'+formHtml()+'<div class="vx-ops-note">Temporäre Angaben dürfen keine dauerhaften Leistungen, Preise, Agenten-Funktionen oder Sicherheitsregeln überschreiben.</div></section></div>'; bind(); if(!editingId){setDefaults();applyPreset(document.getElementById('vx-ops-type')?.value||'closure',true);} }
  function setStatus(message,tone){ const node=document.getElementById('vx-ops-status'); if(!node)return; if(statusTimer)root.clearTimeout(statusTimer); node.textContent=message||''; node.className='vx-ops-status'+(message?' '+(tone||'loading'):''); if(message&&tone==='success'){statusTimer=root.setTimeout(()=>{node.textContent='';node.className='vx-ops-status';},4500);} }
  function setDefaults(){const start=document.getElementById('vx-ops-start');const end=document.getElementById('vx-ops-end');if(start&&!start.value)start.value=localValue(new Date());if(end&&!end.value)end.value=localValue(new Date(Date.now()+86400000));}
  function currentPreset(){return presets[document.getElementById('vx-ops-type')?.value||'closure']||presets.closure;}
  function applyPreset(type,overwriteText){const preset=presets[type]||presets.closure;const appointment=document.getElementById('vx-ops-appointment');const callback=document.getElementById('vx-ops-callback');const general=document.getElementById('vx-ops-general');if(appointment)appointment.value=preset.appointment;if(callback)callback.value=preset.callback;if(general)general.value=preset.general;const startLabel=document.getElementById('vx-ops-start-label');const endLabel=document.getElementById('vx-ops-end-label');if(startLabel)startLabel.textContent=preset.startLabel;if(endLabel)endLabel.textContent=preset.endLabel;if(overwriteText){const title=document.getElementById('vx-ops-title');const message=document.getElementById('vx-ops-message');if(title)title.value=preset.title;if(message)message.value=preset.message;}updateSummaryAndPreview();}
  function updateSummaryAndPreview(){const preset=currentPreset();const appointment=document.getElementById('vx-ops-appointment')?.value||preset.appointment;const summary=document.getElementById('vx-ops-summary');if(summary)summary.textContent=preset.summary;const preview=document.getElementById('vx-ops-preview');if(preview){const message=document.getElementById('vx-ops-message')?.value?.trim()||preset.message;const appointmentSentence=appointment==='after_end'?' Termine nach dem Zeitraum können bereits jetzt vereinbart werden.':appointment==='collect'?' Für Terminanfragen nehme ich gerne Ihre Kontaktdaten auf.':appointment==='blocked'?' Währenddessen können keine neuen Termine vereinbart werden.':'';preview.textContent=message+appointmentSentence;}}
  function bind(){document.getElementById('vx-ops-save')?.addEventListener('click',save);document.getElementById('vx-ops-reset')?.addEventListener('click',resetForm);document.getElementById('vx-ops-type')?.addEventListener('change',(event)=>applyPreset(event.target.value,true));['vx-ops-appointment','vx-ops-callback','vx-ops-general','vx-ops-message'].forEach((id)=>{const node=document.getElementById(id);node?.addEventListener(id==='vx-ops-message'?'input':'change',updateSummaryAndPreview);});document.querySelectorAll('[data-ops-edit]').forEach((node)=>node.addEventListener('click',()=>edit(node.dataset.opsEdit)));document.querySelectorAll('[data-ops-cancel]').forEach((node)=>node.addEventListener('click',()=>cancel(node.dataset.opsCancel)));}
  async function call(payload){if(typeof root.callDashboardFunction!=='function')throw new Error('Dashboard-Funktion ist nicht verfügbar.');return root.callDashboardFunction('customer-operational-updates',payload);}
  async function load(){showLoadingSkeleton();try{state=await call({action:'list'});render();}catch(error){setStatus(error?.message||'Aktuelle Änderungen konnten nicht geladen werden.','error');}}
  function edit(id){const item=(state.updates||[]).find((entry)=>entry.id===id);if(!item)return;editingId=id;render();document.getElementById('vx-ops-type').value=item.type;applyPreset(item.type,false);document.getElementById('vx-ops-title').value=item.title;document.getElementById('vx-ops-message').value=item.message;document.getElementById('vx-ops-start').value=localValue(item.starts_at);document.getElementById('vx-ops-end').value=localValue(item.ends_at);updateSummaryAndPreview();}
  function resetForm(){editingId='';render();}
  function buildBehavior(){const appointment=document.getElementById('vx-ops-appointment')?.value||'normal';const callback=document.getElementById('vx-ops-callback')?.value||'normal';const general=document.getElementById('vx-ops-general')?.value||'normal';const extra=document.getElementById('vx-ops-extra')?.value?.trim();const parts=['Neue Termine: '+appointmentLabels[appointment],'Rückrufwünsche: '+callbackLabels[callback],'Allgemeine Fragen: '+generalLabels[general],'Bestehende Terminabsagen und Verschiebungen weiterhin normal bearbeiten','Bestehende Notfall- und Sicherheitsregeln bleiben unverändert'];if(extra)parts.push('Zusätzliche Anweisung: '+extra);return parts.join('. ');}
  async function save(){if(busy)return;const startValue=document.getElementById('vx-ops-start')?.value||'';const endValue=document.getElementById('vx-ops-end')?.value||'';const startDate=new Date(startValue);const endDate=new Date(endValue);if(!Number.isFinite(startDate.getTime())||!Number.isFinite(endDate.getTime())||endDate<=startDate){setStatus('Bitte einen gültigen Zeitraum wählen. Das Ende muss nach dem Beginn liegen.','error');return;}const update={type:document.getElementById('vx-ops-type')?.value,title:document.getElementById('vx-ops-title')?.value,message:document.getElementById('vx-ops-message')?.value,behavior:buildBehavior(),starts_at:startDate.toISOString(),ends_at:endDate.toISOString()};if(!update.title.trim()||!update.message.trim()){setStatus('Bitte Information und Zeitraum vollständig angeben.','error');return;}busy=true;setStatus('Aktuelle Änderung und Agenten-Prompt werden aktualisiert …','loading');try{state=await call({action:editingId?'update':'create',id:editingId||undefined,update});editingId='';render();if(state.sync_status==='failed')setStatus('Aktuelle Änderung gespeichert. Der Prompt-Sync wird als ausstehend markiert.','warning');else setStatus('✓ Gespeichert und mit dem Assistenten synchronisiert.','success');}catch(error){setStatus(error?.message||'Aktuelle Änderung konnte nicht gespeichert werden.','error');}finally{busy=false;}}
  async function cancel(id){if(busy||!root.confirm('Diese aktuelle Änderung wirklich zurückziehen?'))return;busy=true;setStatus('Aktuelle Änderung wird zurückgezogen …','loading');try{state=await call({action:'cancel',id});editingId='';render();setStatus(state.sync_status==='failed'?'Aktuelle Änderung zurückgezogen. Prompt-Sync ist noch ausstehend.':'✓ Aktuelle Änderung wurde zurückgezogen.',state.sync_status==='failed'?'warning':'success');}catch(error){setStatus(error?.message||'Aktuelle Änderung konnte nicht zurückgezogen werden.','error');}finally{busy=false;}}
  function showLoadingSkeleton(){const body=document.getElementById('vx-operational-page-body');if(body)body.innerHTML=skeleton({lines:3,label:'Aktuelle Infos',inset:true,block:true});}
  function open(){if(!inject())return;showLoadingSkeleton();load();}
  root.vxOperationalUpdatesOpen=open;
  const install=()=>{if(!inject()){root.setTimeout(install,300);}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})(typeof globalThis !== 'undefined' ? globalThis : window);
