(function initVoxeraVoicePreviewFallback(root) {
  'use strict';
  if (!root || !root.document || root.__vxVoicePreviewFallbackInstalled) return;
  if (/\/activate(?:\.html)?$/i.test(String(root.location?.pathname || ''))) return;
  root.__vxVoicePreviewFallbackInstalled = true;

  let loading = false;
  let activeAudio = null;
  let activeObjectUrl = '';

  function stopAudio() {
    if (activeAudio) {
      activeAudio.pause();
      activeAudio = null;
    }
    if (activeObjectUrl) {
      root.URL.revokeObjectURL(activeObjectUrl);
      activeObjectUrl = '';
    }
  }

  function setStatus(message, tone) {
    const node = document.getElementById('vx-assistant-profile-status');
    if (!node) return;
    node.textContent = message || '';
    node.className = 'vx-ap-status' + (message ? ' ' + (tone || 'loading') : '');
  }

  async function accessToken() {
    const client = typeof root.getSupabaseAuthClient === 'function' ? root.getSupabaseAuthClient() : root._sb;
    if (!client?.auth?.getSession) throw new Error('Ihre Sitzung ist nicht verfügbar.');
    const result = await client.auth.getSession();
    const token = String(result?.data?.session?.access_token || '').trim();
    if (!token) throw new Error('Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.');
    return token;
  }

  function errorMessage(payload, status) {
    const code = String(payload?.provider_code || payload?.metadata_code || payload?.error || '').trim();
    const reason = String(payload?.reason || '').trim();
    if (['payment_required', 'quota_exceeded', 'credits_exhausted'].includes(code)) {
      return 'Für die individuelle Sprachvorschau ist ein aktives ElevenLabs-Abonnement oder Guthaben erforderlich.';
    }
    if (code === 'missing_permissions') {
      return 'Der ElevenLabs-Schlüssel benötigt Lesezugriff auf Stimmen.';
    }
    if (reason === 'managed_preview_not_generated') {
      return 'Die individuelle Vorschau wurde noch nicht erzeugt. Bis dahin ist keine Ersatzvorschau verfügbar.';
    }
    if (status === 401) return 'Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.';
    if (status === 403) return 'Diese Stimme ist in Ihrem Paket nicht verfügbar.';
    return 'Sprachvorschau konnte nicht geladen werden.';
  }

  async function loadPreview(voiceId) {
    const token = await accessToken();
    const response = await fetch('/.netlify/functions/preview-voice', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg, audio/*, application/octet-stream'
      },
      body: JSON.stringify({ voice_id: voiceId }),
      cache: 'no-store'
    });

    if (!response.ok) {
      let payload = {};
      try { payload = await response.json(); } catch (_error) {}
      throw new Error(errorMessage(payload, response.status));
    }

    return {
      blob: await response.blob(),
      source: String(response.headers.get('X-Voxera-Preview-Source') || ''),
      notice: String(response.headers.get('X-Voxera-Preview-Notice') || '')
    };
  }

  async function play(button, voiceId) {
    if (loading || !voiceId) return;
    loading = true;
    stopAudio();

    const original = button.innerHTML;
    document.querySelectorAll('[data-vx-preview]').forEach((node) => { node.disabled = true; });
    button.textContent = 'Wird geladen …';
    setStatus('', '');

    try {
      const result = await loadPreview(voiceId);
      activeObjectUrl = root.URL.createObjectURL(result.blob);
      activeAudio = new Audio(activeObjectUrl);
      activeAudio.addEventListener('ended', stopAudio, { once: true });
      await activeAudio.play();

      if (result.notice === 'custom-preview-pending') {
        setStatus('Vorläufige Standardvorschau. Der individuelle Voxera-Text wird verfügbar, sobald er im Admin erzeugt wurde.', 'warning');
      }
    } catch (error) {
      setStatus(error?.message || 'Sprachvorschau konnte nicht abgespielt werden.', 'error');
    } finally {
      loading = false;
      document.querySelectorAll('[data-vx-preview]').forEach((node) => { node.disabled = false; });
      button.innerHTML = original;
    }
  }

  function intercept(event) {
    const button = event.target?.closest?.('[data-vx-preview]');
    if (!button) return;
    const voiceId = String(button.dataset.vxPreview || '').trim();
    if (!voiceId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    play(button, voiceId);
  }

  document.addEventListener('click', intercept, true);
  root.addEventListener('beforeunload', stopAudio, { once: true });
})(typeof globalThis !== 'undefined' ? globalThis : this);
