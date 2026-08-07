/* ============================================================
   Voxera Customer Dashboard — Unified UI Components (Etappe 1)
   ============================================================
   Markup factory for the five canonical building blocks. Pure
   string builders — no DOM mutation, no styling, no observers,
   no timers. Presentation lives exclusively in
   customer-ui-components.css.

   Usage from any screen or runtime module:

     VoxeraUI.skeleton({ lines: 3, label: 'Aktuelle Infos' })
     VoxeraUI.badge('Heiss')
     VoxeraUI.badge('Termin', 'info')
     VoxeraUI.emptyState({ icon: 'ph-tray', title: '…', text: '…' })
     VoxeraUI.card('<p>…</p>', { variant: 'compact' })
     VoxeraUI.appBar({ title: 'Anfragen' })
     VoxeraUI.appBar({ title: 'Profil', back: { label: 'Zurück zu Einstellungen', onclick: 'vxScreenBack()' } })
     VoxeraUI.tabs([{ key: 'offen', label: 'Offen' }], 'offen')
   ============================================================ */

(function defineVoxeraUiComponents(root) {
  'use strict';
  if (!root || root.VoxeraUI) return;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ---- Skeleton -------------------------------------------- */

  // Descending widths so a stack of lines reads as loading text.
  var SKELETON_WIDTHS = ['lg', 'md', 'sm'];

  function skeleton(options) {
    var config = options || {};
    var count = Math.max(1, Math.min(8, parseInt(config.lines, 10) || 3));
    var label = config.label ? String(config.label) : '';
    var classes = ['vx-ui-skeleton'];
    if (config.inset) classes.push('vx-ui-skeleton--inset');
    if (config.className) classes.push(String(config.className));

    var body = '';
    if (config.block) body += '<div class="vx-ui-skeleton-block"></div>';
    for (var i = 0; i < count; i += 1) {
      body += '<div class="vx-ui-skeleton-line vx-ui-skeleton-line--'
        + SKELETON_WIDTHS[i % SKELETON_WIDTHS.length] + '"></div>';
    }

    return '<div class="' + esc(classes.join(' ')) + '" role="status" aria-live="polite" aria-busy="true"'
      + (label ? ' aria-label="' + esc(label + ' wird geladen') + '"' : '')
      + '>' + body + '</div>';
  }

  /* ---- Status badge ----------------------------------------- */

  var BADGE_TONES = ['danger', 'info', 'neutral', 'success', 'warning'];

  // Maps the product's business labels onto the rot/blau/grau scheme.
  var BADGE_TONE_BY_LABEL = {
    'heiss': 'danger',
    'heiß': 'danger',
    'hot': 'danger',
    'dringend': 'danger',
    'überfällig': 'danger',
    'ueberfaellig': 'danger',
    'warm': 'warning',
    'termin': 'info',
    'geplant': 'info',
    'offen': 'info',
    'neu': 'info',
    'rückruf': 'info',
    'rueckruf': 'info',
    'erledigt': 'neutral',
    'abgeschlossen': 'neutral',
    'archiviert': 'neutral',
    'archiv': 'neutral',
    'zurückgezogen': 'neutral',
    'abgelaufen': 'neutral',
    'aktiv': 'success',
    'live': 'danger'
  };

  function badgeTone(label) {
    var key = String(label == null ? '' : label).trim().toLowerCase();
    return BADGE_TONE_BY_LABEL[key] || 'neutral';
  }

  function badge(label, tone, options) {
    var config = options || {};
    var resolved = tone && BADGE_TONES.indexOf(String(tone)) !== -1 ? String(tone) : badgeTone(label);
    var classes = ['vx-ui-badge', 'vx-ui-badge--' + resolved];
    if (config.className) classes.push(String(config.className));
    return '<span class="' + esc(classes.join(' ')) + '">'
      + (config.dot ? '<span class="vx-ui-badge-dot" aria-hidden="true"></span>' : '')
      + esc(label) + '</span>';
  }

  /* ---- Empty state ------------------------------------------ */

  function emptyState(options) {
    var config = options || {};
    var icon = config.icon ? String(config.icon) : 'ph-tray';
    var classes = ['vx-ui-empty'];
    if (config.variant === 'inline') classes.push('vx-ui-empty--inline');
    if (config.variant === 'fill') classes.push('vx-ui-empty--fill');
    if (config.className) classes.push(String(config.className));

    return '<div class="' + esc(classes.join(' ')) + '">'
      + '<i class="ph-bold ' + esc(icon) + '" aria-hidden="true"></i>'
      + (config.title ? '<div class="vx-ui-empty-title">' + esc(config.title) + '</div>' : '')
      + (config.text ? '<p class="vx-ui-empty-text">' + esc(config.text) + '</p>' : '')
      + (config.action ? String(config.action) : '')
      + '</div>';
  }

  /* ---- Card -------------------------------------------------- */

  var CARD_VARIANTS = ['compact', 'roomy', 'flush', 'stack', 'interactive'];

  function card(content, options) {
    var config = options || {};
    var classes = ['vx-ui-card'];
    var variants = config.variant
      ? (Array.isArray(config.variant) ? config.variant : [config.variant])
      : [];
    variants.forEach(function (variant) {
      if (CARD_VARIANTS.indexOf(String(variant)) !== -1) classes.push('vx-ui-card--' + variant);
    });
    if (config.className) classes.push(String(config.className));

    return '<' + (config.tag === 'article' ? 'article' : 'div')
      + ' class="' + esc(classes.join(' ')) + '"'
      + (config.id ? ' id="' + esc(config.id) + '"' : '')
      + '>' + String(content == null ? '' : content)
      + '</' + (config.tag === 'article' ? 'article' : 'div') + '>';
  }

  /* ---- Screen header (app bar) --------------------------------- */

  // One bar per screen: an optional back arrow, then the screen name.
  // Anything else a screen wants to show goes into the first card of
  // its content area — see customer-navigation-components.css.
  function appBar(options) {
    var config = options || {};
    var classes = ['vx-appbar'];
    if (config.className) classes.push(String(config.className));

    var back = '';
    if (config.back) {
      var backConfig = config.back === true ? {} : config.back;
      back = '<button type="button" class="vx-appbar-back"'
        + ' aria-label="' + esc(backConfig.label || 'Zurück') + '"'
        + (backConfig.onclick ? ' onclick="' + esc(backConfig.onclick) + '"' : '')
        + '><i class="ph-bold ph-arrow-left" aria-hidden="true"></i></button>';
    }

    return '<header class="' + esc(classes.join(' ')) + '"'
      + (config.id ? ' id="' + esc(config.id) + '"' : '')
      + '>' + back
      + '<h1 class="vx-appbar-title">' + esc(config.title) + '</h1>'
      + '</header>';
  }

  /* ---- Tabs --------------------------------------------------- */

  function tabs(items, activeKey, options) {
    var config = options || {};
    var list = Array.isArray(items) ? items : [];
    var buttons = list.map(function (item) {
      var key = String(item && item.key != null ? item.key : '');
      var isActive = key === String(activeKey == null ? '' : activeKey);
      return '<button type="button" role="tab"'
        + ' class="vx-ui-tab' + (isActive ? ' active' : '') + '"'
        + ' aria-selected="' + (isActive ? 'true' : 'false') + '"'
        + ' data-vx-tab="' + esc(key) + '">'
        + esc(item && item.label != null ? item.label : key)
        + '</button>';
    }).join('');

    return '<div class="vx-ui-tabs" role="tablist"'
      + (config.id ? ' id="' + esc(config.id) + '"' : '')
      + (config.label ? ' aria-label="' + esc(config.label) + '"' : '')
      + '>' + buttons + '</div>';
  }

  root.VoxeraUI = {
    escape: esc,
    skeleton: skeleton,
    badge: badge,
    badgeTone: badgeTone,
    emptyState: emptyState,
    card: card,
    appBar: appBar,
    tabs: tabs
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
