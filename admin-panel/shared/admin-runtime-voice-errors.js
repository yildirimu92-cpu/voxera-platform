(function installAdminVoiceErrorMessages(root) {
  'use strict';
  if (!root || root.__voxeraAdminVoiceErrorMessagesInstalled) return;

  let attempts = 0;

  function friendlyMessage(code) {
    const normalized = String(code || '').trim().toLowerCase();
    if (normalized === 'payment_required') {
      return 'Für individuelle Sprachvorschauen ist ein aktives ElevenLabs-Abonnement oder ausreichendes Guthaben erforderlich.';
    }
    if (normalized === 'missing_permissions') {
      return 'Der ElevenLabs-API-Schlüssel benötigt Zugriff auf Text zu Sprache und Leserechte für Stimmen.';
    }
    if (normalized === 'quota_exceeded' || normalized === 'credits_exhausted') {
      return 'Das ElevenLabs-Guthaben ist aufgebraucht. Bitte Credits oder Abonnement prüfen.';
    }
    return '';
  }

  function install() {
    if (root.__voxeraAdminVoiceErrorMessagesInstalled) return true;
    const original = root.callAdminFunction;
    if (typeof original !== 'function') return false;

    root.callAdminFunction = async function callAdminFunctionWithVoiceErrors(name, payload) {
      try {
        return await original.apply(this, arguments);
      } catch (error) {
        if (name === 'admin-voices') {
          const code = error?.payload?.provider_code || error?.payload?.code || error?.provider_code || '';
          const message = friendlyMessage(code);
          if (message) {
            if (error && typeof error === 'object') {
              error.message = message;
              if (error.payload && typeof error.payload === 'object') error.payload.error = message;
            }
          }
        }
        throw error;
      }
    };

    root.__voxeraAdminVoiceErrorMessagesInstalled = true;
    return true;
  }

  function boot() {
    attempts += 1;
    if (!install() && attempts < 80) root.setTimeout(boot, 100);
  }

  boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
