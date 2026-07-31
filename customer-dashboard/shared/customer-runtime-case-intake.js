(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  const ready = fn => document.readyState === 'complete' ? setTimeout(fn, 0) : w.addEventListener('load', fn, { once: true });

  async function authPost(endpoint, payload) {
    const client = typeof _sb !== 'undefined' ? _sb : w._sb;
    if (!client?.auth?.getSession) throw new Error('Sitzung nicht verfügbar.');
    const { data, error } = await client.auth.getSession();
    if (error || !data?.session?.access_token) throw new Error('Ihre Sitzung ist abgelaufen.');
    const response = await fetch(`/.netlify/functions/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${data.session.access_token}`
      },
      body: JSON.stringify(payload)
    });
    let json = {};
    try { json = await response.json(); } catch (_) {}
    if (!response.ok || !json.success) throw new Error(json.error || `Anfrage fehlgeschlagen (${response.status}).`);
    return json;
  }

  function ensureSupportModal() {
    let overlay = document.getElementById('vox-support-request-overlay');
    if (overlay) return overlay;
    const style = document.createElement('style');
    style.textContent = `
      #vox-support-request-overlay{position:fixed;inset:0;z-index:100000;background:rgba(8,24,48,.55);display:none;align-items:center;justify-content:center;padding:18px;backdrop-filter:blur(5px)}
      #vox-support-request-overlay.open{display:flex}
      .vox-support-modal{width:min(560px,100%);max-height:calc(100dvh - 36px);overflow:auto;background:#fff;border-radius:18px;box-shadow:0 28px 80px rgba(15,23,42,.28)}
      .vox-support-head{padding:22px 24px;background:#0D2A52;color:#fff;display:flex;justify-content:space-between;gap:16px;align-items:flex-start}
      .vox-support-head h2{margin:0;font-size:21px;color:#fff}.vox-support-head p{margin:5px 0 0;color:rgba(255,255,255,.7);font-size:13px}
      .vox-support-close{border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.1);color:#fff;border-radius:10px;width:36px;height:36px;font-size:20px;cursor:pointer}
      .vox-support-body{padding:22px 24px}.vox-support-field{margin-bottom:15px}.vox-support-field label{display:block;font-size:12px;font-weight:700;color:#64748B;margin-bottom:6px}
      .vox-support-field input,.vox-support-field textarea{width:100%;box-sizing:border-box;border:1px solid #DCE4F0;border-radius:11px;padding:11px 12px;font:inherit;color:#0D1F3C;background:#fff}.vox-support-field textarea{min-height:150px;resize:vertical}
      .vox-support-feedback{font-size:12px;min-height:18px;margin-top:6px}.vox-support-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
    `;
    document.head.appendChild(style);
    overlay = document.createElement('div');
    overlay.id = 'vox-support-request-overlay';
    overlay.innerHTML = `<div class="vox-support-modal" role="dialog" aria-modal="true" aria-labelledby="vox-support-title">
      <div class="vox-support-head"><div><h2 id="vox-support-title">Support-Anfrage</h2><p>Die Anfrage wird direkt als interner Voxera-Case erfasst.</p></div><button class="vox-support-close" type="button" aria-label="Schliessen">×</button></div>
      <div class="vox-support-body">
        <div class="vox-support-field"><label for="vox-support-subject">Betreff</label><input id="vox-support-subject" maxlength="160" value="Support-Anfrage"></div>
        <div class="vox-support-field"><label for="vox-support-message">Was sollen wir erledigen?</label><textarea id="vox-support-message" maxlength="6000" placeholder="Beschreiben Sie das Anliegen möglichst konkret."></textarea></div>
        <div class="vox-support-feedback" id="vox-support-feedback"></div>
        <div class="vox-support-actions"><button class="btn btn--secondary" type="button" data-close>Abbrechen</button><button class="btn btn--primary" type="button" id="vox-support-submit">Anfrage senden</button></div>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const close = () => { overlay.classList.remove('open'); document.documentElement.style.overflow = ''; };
    overlay.querySelector('.vox-support-close').onclick = close;
    overlay.querySelector('[data-close]').onclick = close;
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    overlay.querySelector('#vox-support-submit').onclick = async () => {
      const button = overlay.querySelector('#vox-support-submit');
      const feedback = overlay.querySelector('#vox-support-feedback');
      const subject = overlay.querySelector('#vox-support-subject').value.trim();
      const message = overlay.querySelector('#vox-support-message').value.trim();
      if (!message) { feedback.style.color = '#B42318'; feedback.textContent = 'Bitte beschreiben Sie Ihr Anliegen.'; return; }
      button.disabled = true; button.textContent = 'Wird gesendet…'; feedback.textContent = '';
      try {
        await authPost('support-request-create', {
          subject: subject || 'Support-Anfrage',
          message,
          request_id: w.crypto?.randomUUID?.() || `support-${Date.now()}`
        });
        feedback.style.color = '#067647'; feedback.textContent = '✓ Anfrage wurde als Support-Case erfasst.';
        overlay.querySelector('#vox-support-message').value = '';
        if (typeof w.toast === 'function') w.toast('Support-Anfrage erfasst');
        setTimeout(close, 1100);
      } catch (error) {
        feedback.style.color = '#B42318'; feedback.textContent = `Fehler: ${error.message}`;
      } finally { button.disabled = false; button.textContent = 'Anfrage senden'; }
    };
    return overlay;
  }

  ready(() => {
    // Customer follow-ups remain in customer_tasks. Only explicit support and
    // assistant-change requests enter the internal admin case queue.
    w.requestSupport = function () {
      const overlay = ensureSupportModal();
      overlay.classList.add('open');
      document.documentElement.style.overflow = 'hidden';
      setTimeout(() => overlay.querySelector('#vox-support-message')?.focus(), 0);
    };

    w.submitAssistentChange = async function () {
      const msg = (document.getElementById('assistent-change-msg')?.value || '').trim();
      const btn = document.getElementById('assistent-change-btn');
      const fb = document.getElementById('assistent-change-feedback');
      if (!msg) {
        if (fb) { fb.style.display = ''; fb.style.color = 'var(--red,#DC2626)'; fb.textContent = 'Bitte zuerst eine Beschreibung eingeben.'; }
        return;
      }
      if (btn) { btn.disabled = true; btn.textContent = 'Wird gesendet…'; }
      if (fb) fb.style.display = 'none';
      try {
        await authPost('ai-change-request-create', { message: msg });
        const input = document.getElementById('assistent-change-msg'); if (input) input.value = '';
        if (fb) { fb.style.display = ''; fb.style.color = 'var(--green-dark,#059669)'; fb.textContent = '✓ Anfrage gesendet — sie wurde als interner Case erfasst.'; }
        if (typeof w.loadAssistentRequests === 'function') w.loadAssistentRequests();
      } catch (error) {
        if (fb) { fb.style.display = ''; fb.style.color = 'var(--red,#DC2626)'; fb.textContent = `Fehler: ${error.message}`; }
      } finally { if (btn) { btn.disabled = false; btn.textContent = 'Anfrage senden'; } }
    };
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
