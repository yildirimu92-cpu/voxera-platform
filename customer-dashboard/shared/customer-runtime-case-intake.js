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

  function setFeedback(node, message, tone) {
    if (!node) return;
    node.textContent = message || '';
    node.hidden = !message;
    node.classList.remove('vx-feedback-error', 'vx-feedback-success');
    if (message && tone === 'error') node.classList.add('vx-feedback-error');
    if (message && tone === 'success') node.classList.add('vx-feedback-success');
  }

  function ensureSupportModal() {
    let overlay = document.getElementById('vox-support-request-overlay');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'vox-support-request-overlay';
    overlay.innerHTML = `<div class="vox-support-modal" role="dialog" aria-modal="true" aria-labelledby="vox-support-title">
      <div class="vox-support-head"><div><h2 id="vox-support-title">Support-Anfrage</h2><p>Die Anfrage wird direkt als interner Voxera-Case erfasst.</p></div><button class="vox-support-close" type="button" aria-label="Schliessen">×</button></div>
      <div class="vox-support-body">
        <div class="vox-support-field"><label for="vox-support-subject">Betreff</label><input id="vox-support-subject" maxlength="160" value="Support-Anfrage"></div>
        <div class="vox-support-field"><label for="vox-support-message">Was sollen wir erledigen?</label><textarea id="vox-support-message" maxlength="6000" placeholder="Beschreiben Sie das Anliegen möglichst konkret."></textarea></div>
        <div class="vox-support-feedback" id="vox-support-feedback" hidden></div>
        <div class="vox-support-actions"><button class="btn btn--secondary" type="button" data-close>Abbrechen</button><button class="btn btn--primary" type="button" id="vox-support-submit">Anfrage senden</button></div>
      </div>
    </div>`;
    document.body.appendChild(overlay);

    let previousFocus = null;
    const close = () => {
      overlay.classList.remove('open');
      document.documentElement.classList.remove('vx-support-modal-open');
      previousFocus?.focus?.();
      previousFocus = null;
    };
    const open = () => {
      previousFocus = document.activeElement;
      overlay.classList.add('open');
      document.documentElement.classList.add('vx-support-modal-open');
      setTimeout(() => overlay.querySelector('#vox-support-message')?.focus(), 0);
    };

    overlay.querySelector('.vox-support-close').onclick = close;
    overlay.querySelector('[data-close]').onclick = close;
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    overlay.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
    overlay.querySelector('#vox-support-submit').onclick = async () => {
      const button = overlay.querySelector('#vox-support-submit');
      const feedback = overlay.querySelector('#vox-support-feedback');
      const subject = overlay.querySelector('#vox-support-subject').value.trim();
      const message = overlay.querySelector('#vox-support-message').value.trim();
      if (!message) {
        setFeedback(feedback, 'Bitte beschreiben Sie Ihr Anliegen.', 'error');
        return;
      }
      button.disabled = true;
      button.textContent = 'Wird gesendet…';
      setFeedback(feedback, '', '');
      try {
        await authPost('support-request-create', {
          subject: subject || 'Support-Anfrage',
          message,
          request_id: w.crypto?.randomUUID?.() || `support-${Date.now()}`
        });
        setFeedback(feedback, '✓ Anfrage wurde als Support-Case erfasst.', 'success');
        overlay.querySelector('#vox-support-message').value = '';
        if (typeof w.toast === 'function') w.toast('Support-Anfrage erfasst');
        setTimeout(close, 1100);
      } catch (error) {
        setFeedback(feedback, `Fehler: ${error.message}`, 'error');
      } finally {
        button.disabled = false;
        button.textContent = 'Anfrage senden';
      }
    };

    overlay.vxOpenSupportModal = open;
    return overlay;
  }

  ready(() => {
    // Customer follow-ups remain in customer_tasks. Only explicit support and
    // assistant-change requests enter the internal admin case queue.
    w.requestSupport = function () {
      const overlay = ensureSupportModal();
      overlay.vxOpenSupportModal();
    };

    w.submitAssistentChange = async function () {
      const msg = (document.getElementById('assistent-change-msg')?.value || '').trim();
      const btn = document.getElementById('assistent-change-btn');
      const fb = document.getElementById('assistent-change-feedback');
      if (!msg) {
        setFeedback(fb, 'Bitte zuerst eine Beschreibung eingeben.', 'error');
        return;
      }
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Wird gesendet…';
      }
      setFeedback(fb, '', '');
      try {
        await authPost('ai-change-request-create', { message: msg });
        const input = document.getElementById('assistent-change-msg');
        if (input) input.value = '';
        setFeedback(fb, '✓ Anfrage gesendet — sie wurde als interner Case erfasst.', 'success');
        if (typeof w.loadAssistentRequests === 'function') w.loadAssistentRequests();
      } catch (error) {
        setFeedback(fb, `Fehler: ${error.message}`, 'error');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Anfrage senden';
        }
      }
    };
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);