(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.VoxeraOfferBrand = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const OFFER_BRAND_ASSET_PATH = '/brand/05-app-icon-512px.svg';
  const OFFER_BRAND_ASSET_NAME = '05 App Icon 512px';
  const BRAND_LOGO_PATH = OFFER_BRAND_ASSET_PATH;
  const BRAND_FAVICON_PATH = OFFER_BRAND_ASSET_PATH;
  const CONVERSATION_AUDIO_ENDPOINT = '/.netlify/functions/elevenlabs-conversation-audio';

  class ConversationAudioError extends Error {
    constructor(code, status) {
      super(code);
      this.name = 'ConversationAudioError';
      this.code = code;
      this.status = status || 0;
    }
  }

  function isProtectedConversationAudioUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return false;
    try {
      const parsed = new URL(raw, 'https://dashboard.voxera.ch');
      return parsed.pathname === CONVERSATION_AUDIO_ENDPOINT;
    } catch {
      return false;
    }
  }

  function getAudioErrorMessage(error) {
    const code = error && error.code;
    const status = Number(error && error.status) || 0;
    if (code === 'session_missing' || code === 'access_token_missing' || status === 401) {
      return 'Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.';
    }
    if (status === 403) return 'Sie haben keinen Zugriff auf diese Audioaufnahme.';
    if (status === 404) return 'Für diesen Anruf wurde keine Audioaufnahme gefunden.';
    if (status === 502) return 'Die Audioaufnahme ist momentan nicht verfügbar. Bitte versuchen Sie es später erneut.';
    return 'Die Audioaufnahme konnte nicht geladen werden.';
  }

  function createConversationAudioClient(options) {
    const opts = options || {};
    const authClient = opts.authClient;
    const fetchFn = opts.fetchFn;
    const urlApi = opts.urlApi;

    if (typeof fetchFn !== 'function') throw new TypeError('fetchFn is required');
    if (!urlApi || typeof urlApi.createObjectURL !== 'function' || typeof urlApi.revokeObjectURL !== 'function') {
      throw new TypeError('urlApi with createObjectURL/revokeObjectURL is required');
    }

    async function getAccessToken() {
      if (!authClient || !authClient.auth || typeof authClient.auth.getSession !== 'function') {
        throw new ConversationAudioError('session_missing', 401);
      }
      const result = await authClient.auth.getSession();
      if (result && result.error) throw new ConversationAudioError('session_missing', 401);
      const session = result && result.data && result.data.session;
      if (!session) throw new ConversationAudioError('session_missing', 401);
      const accessToken = String(session.access_token || '').trim();
      if (!accessToken) throw new ConversationAudioError('access_token_missing', 401);
      return accessToken;
    }

    async function loadAudio(input) {
      const request = input || {};
      const conversationId = String(request.conversationId || '').trim();
      if (!conversationId) throw new ConversationAudioError('conversation_id_missing', 400);

      const accessToken = await getAccessToken();
      const response = await fetchFn(
        `${CONVERSATION_AUDIO_ENDPOINT}?conversation_id=${encodeURIComponent(conversationId)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'audio/mpeg, audio/*, application/octet-stream'
          }
        }
      );

      if (!response || !response.ok) {
        const status = Number(response && response.status) || 502;
        throw new ConversationAudioError(`audio_request_${status}`, status);
      }
      if (typeof response.blob !== 'function') throw new ConversationAudioError('audio_response_invalid', 502);

      const blob = await response.blob();
      const objectUrl = urlApi.createObjectURL(blob);
      const previousObjectUrl = String(request.previousObjectUrl || '').trim();
      if (previousObjectUrl && previousObjectUrl !== objectUrl) urlApi.revokeObjectURL(previousObjectUrl);
      return { objectUrl, blob };
    }

    return { loadAudio, getAccessToken };
  }

  function escapeAttr(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function installConversationAudioBridge(target) {
    const browser = target || root;
    if (!browser || !browser.document || browser.__vxSecureConversationAudioInstalled) return false;

    let activeObjectUrl = '';
    const documentRef = browser.document;

    function getAuthClient() {
      if (typeof browser.getSupabaseAuthClient === 'function') return browser.getSupabaseAuthClient();
      return browser._sb || null;
    }

    function renderProtectedAudioPlaceholder(callOrFields, protectedUrl) {
      let conversationId = typeof browser.vxGetElevenLabsConversationId === 'function'
        ? String(browser.vxGetElevenLabsConversationId(callOrFields) || '').trim()
        : '';
      if (!conversationId && protectedUrl) {
        try {
          const parsed = new URL(String(protectedUrl), browser.location && browser.location.origin || 'https://dashboard.voxera.ch');
          conversationId = String(parsed.searchParams.get('conversation_id') || parsed.searchParams.get('conversationId') || '').trim();
        } catch {
          conversationId = '';
        }
      }
      if (!conversationId) return '';
      return '<div class="vx-transcript-card" id="vx-call-audio-card" data-conversation-id="' + escapeAttr(conversationId) + '">' +
        '<div class="vx-transcript-head"><i class="ph-bold ph-waveform" aria-hidden="true"></i>' +
        '<div class="vx-transcript-title">Audioaufnahme</div><div class="vx-transcript-meta">ElevenLabs</div></div>' +
        '<div class="vx-transcript-empty">Audioaufnahme ist geschützt verfügbar.<br>' +
        '<button type="button" class="btn btn--secondary btn--sm" style="margin-top:10px;" onclick="vxTryLoadElevenLabsAudioFromDashboard(this)">Audio abrufen</button>' +
        '<div class="vx-audio-fetch-status" style="font-size:11px;color:var(--slate2);margin-top:8px;"></div></div></div>';
    }

    const originalRenderCallAudioCard = typeof browser.vxRenderCallAudioCardHtml === 'function'
      ? browser.vxRenderCallAudioCardHtml
      : null;

    if (originalRenderCallAudioCard) {
      browser.vxRenderCallAudioCardHtml = function secureRenderCallAudioCard(callOrFields) {
        const audioUrl = typeof browser.vxGetCallAudioUrl === 'function'
          ? browser.vxGetCallAudioUrl(callOrFields)
          : '';
        if (isProtectedConversationAudioUrl(audioUrl)) {
          const placeholder = renderProtectedAudioPlaceholder(callOrFields, audioUrl);
          if (placeholder) return placeholder;
        }
        return originalRenderCallAudioCard.call(this, callOrFields);
      };
    }

    browser.vxTryLoadElevenLabsAudioFromDashboard = async function secureConversationAudioLoad(btn) {
      const card = btn && typeof btn.closest === 'function'
        ? btn.closest('#vx-call-audio-card')
        : documentRef.getElementById('vx-call-audio-card');
      const status = card ? card.querySelector('.vx-audio-fetch-status') : null;
      const conversationId = card ? String(card.getAttribute('data-conversation-id') || '').trim() : '';
      if (!conversationId) return;

      if (btn) btn.disabled = true;
      if (status) status.textContent = 'Audio wird sicher abgerufen…';

      try {
        const client = createConversationAudioClient({
          authClient: getAuthClient(),
          fetchFn: browser.fetch.bind(browser),
          urlApi: browser.URL
        });
        const result = await client.loadAudio({
          conversationId,
          previousObjectUrl: activeObjectUrl
        });
        activeObjectUrl = result.objectUrl;

        if (!card || typeof browser.vxRenderModernAudioPlayerHtml !== 'function') {
          browser.URL.revokeObjectURL(activeObjectUrl);
          activeObjectUrl = '';
          throw new ConversationAudioError('audio_player_unavailable', 500);
        }

        card.outerHTML = '<div class="vx-transcript-card" id="vx-call-audio-card" data-vx-object-url="' +
          escapeAttr(activeObjectUrl) + '"><div style="padding:12px 14px;border-top:0.5px solid var(--line);">' +
          browser.vxRenderModernAudioPlayerHtml(activeObjectUrl, 'Gerade sicher abgerufen') + '</div></div>';

        const renderedCard = documentRef.getElementById('vx-call-audio-card');
        if (renderedCard && typeof browser.vxHydrateModernAudioPlayers === 'function') {
          browser.vxHydrateModernAudioPlayers(renderedCard);
        }
      } catch (error) {
        if (status) status.textContent = getAudioErrorMessage(error);
      } finally {
        if (btn) btn.disabled = false;
      }
    };

    if (typeof browser.addEventListener === 'function') {
      browser.addEventListener('beforeunload', function releaseConversationAudioUrl() {
        if (activeObjectUrl) {
          browser.URL.revokeObjectURL(activeObjectUrl);
          activeObjectUrl = '';
        }
      }, { once: true });
    }

    browser.__vxSecureConversationAudioInstalled = true;
    return true;
  }

  function scheduleConversationAudioBridge(target) {
    const browser = target || root;
    if (!browser || !browser.document) return;
    const install = function () { installConversationAudioBridge(browser); };
    if (browser.document.readyState === 'loading') {
      browser.document.addEventListener('DOMContentLoaded', install, { once: true });
    } else {
      install();
    }
  }

  scheduleConversationAudioBridge(root);

  return {
    OFFER_BRAND_ASSET_PATH,
    OFFER_BRAND_ASSET_NAME,
    BRAND_LOGO_PATH,
    BRAND_FAVICON_PATH,
    ConversationAudioClient: {
      CONVERSATION_AUDIO_ENDPOINT,
      ConversationAudioError,
      createConversationAudioClient,
      getAudioErrorMessage,
      isProtectedConversationAudioUrl,
      installConversationAudioBridge
    }
  };
});

(function loadCustomerCaseIntake(root) {
  if (!root || !root.document || root.__voxeraCustomerCaseIntakeLoaded) return;
  root.__voxeraCustomerCaseIntakeLoaded = true;
  const script = root.document.createElement('script');
  script.src = '/shared/customer-runtime-case-intake.js?v=20260731-1';
  script.async = false;
  root.document.head.appendChild(script);
})(typeof globalThis !== 'undefined' ? globalThis : this);


(function loadCustomerCalendarSettings(root) {
  if (!root || !root.document || root.__voxeraCustomerCalendarSettingsLoaded) return;
  root.__voxeraCustomerCalendarSettingsLoaded = true;
  const script = root.document.createElement('script');
  script.src = '/shared/customer-runtime-calendar-settings.js?v=20260801-1';
  script.async = false;
  root.document.head.appendChild(script);
})(typeof globalThis !== 'undefined' ? globalThis : this);


(function loadCustomerOperationalUpdates(root) {
  if (!root || !root.document || root.__voxeraCustomerOperationalUpdatesLoaded) return;
  root.__voxeraCustomerOperationalUpdatesLoaded = true;
  const script = root.document.createElement('script');
  script.src = '/shared/customer-runtime-operational-updates.js?v=20260801-1';
  script.async = false;
  root.document.head.appendChild(script);
})(typeof globalThis !== 'undefined' ? globalThis : this);


(function loadCustomerAssistantProfile(root) {
  if (!root || !root.document || root.__voxeraCustomerAssistantProfileLoaded) return;
  root.__voxeraCustomerAssistantProfileLoaded = true;
  const script = root.document.createElement('script');
  script.src = '/shared/customer-runtime-assistant-profile.js?v=20260802-1';
  script.async = false;
  root.document.head.appendChild(script);
})(typeof globalThis !== 'undefined' ? globalThis : this);


(function loadCustomerAssistantBusinessMenu(root) {
  if (!root || !root.document || root.__voxeraCustomerAssistantBusinessMenuLoaded) return;
  root.__voxeraCustomerAssistantBusinessMenuLoaded = true;
  const script = root.document.createElement('script');
  script.src = '/shared/customer-runtime-assistant-business-menu.js?v=20260802-1';
  script.async = false;
  root.document.head.appendChild(script);
})(typeof globalThis !== 'undefined' ? globalThis : this);


(function loadCustomerUnifiedNavigation(root) {
  if (!root || !root.document || root.__voxeraCustomerUnifiedNavigationLoaded) return;
  root.__voxeraCustomerUnifiedNavigationLoaded = true;
  const script = root.document.createElement('script');
  script.src = '/shared/customer-runtime-unified-navigation.js?v=20260802-2';
  script.async = false;
  root.document.head.appendChild(script);
})(typeof globalThis !== 'undefined' ? globalThis : this);
