(function installCustomerNotificationBridge(root) {
  'use strict';
  if (!root || !root.document || root.__vxCustomerNotificationBridgeInstalledV5) return;
  root.__vxCustomerNotificationBridgeInstalledV5 = true;

  const doc = root.document;
  let previousPageId = 'tab-dashboard';
  let lastActivationAt = 0;
  const ACTIVATION_DEDUPE_MS = 500;
  // Nur ausdruecklich gekennzeichnete Elemente gelten als Glocke.
  //
  // Bis 2026-08-09 stand hier zusaetzlich eine Glyphen- und Textheuristik:
  // jedes Element mit einer Glocken-Klasse (ph-bell, lucide bell, svg/i mit
  // "bell") oder mit "Benachrichtigung"/"notification" in aria-label bzw. title
  // galt als Ausloeser -- unabhaengig davon, wo im Dokument es stand. Da die
  // Listener in der Capture-Phase auf document haengen und mit
  // preventDefault() + stopImmediatePropagation() abschliessen, hat das jeden
  // korrekten Handler darunter ueberstimmt.
  //
  // Konkret getroffen hat es die Zeile "Benachrichtigungen" in der
  // Einstellungsliste (index.html): ihr Icon ist ein ph-bell, also oeffnete ein
  // Klick auf das Icon den globalen Feed, ein Klick auf den Titeltext daneben
  // dagegen korrekt die Einstellungsseite. Zwei Ergebnisse fuer dieselbe Zeile,
  // je nach Trefferpunkt.
  //
  // Ein erweiterter Schutz-Selektor haette nur die heute bekannten Stellen
  // abgedeckt und die naechste versehentlich eingebaute Glocke wieder
  // hineinlaufen lassen. Deshalb umgekehrt: die zwei echten Glocken tragen
  // data-notifications-trigger, alles andere ist keine.
  //
  // Die Heuristik war zusaetzlich selbstverstaerkend: bindTrigger() setzt
  // aria-label="Benachrichtigungen oeffnen" auf das, was es einmal erkannt hat
  // -- danach passte das Element auch ohne Glocken-Glyphe dauerhaft auf den
  // aria-label-Zweig.
  const EXPLICIT_SELECTOR = [
    '[data-notifications-trigger]', '[data-notification-trigger]',
    '#notification-button', '#notifications-button', '#notification-bell', '#notifications-bell'
  ].join(',');
  const BACK_ICON_SELECTOR = '[class*="ph-arrow-left" i],[data-lucide*="arrow-left" i],svg[class*="arrow-left" i],i[class*="arrow-left" i]';
  // Die Notifications-UI selbst (Popover, Backdrop, mobile Vollseite) enthaelt
  // Glocken-Icons und "Benachrichtigungen"-Beschriftungen. Ohne diesen Schutz
  // haerten prepareTriggers()/bindTrigger() das Panel gegen sich selbst --
  // position:relative!important ueber sein position:fixed -- und reissen es aus
  // seiner am Viewport verankerten Position in den Dokumentfluss.
  //
  // Der Schutz bleibt, obwohl die Glyphen-Erkennung weg ist: er kostet nichts
  // und deckt den Fall ab, dass jemand innerhalb des Panels versehentlich ein
  // data-notifications-trigger setzt.
  const NOTIFICATIONS_UI_SELECTOR = '#vx-notif-panel,#vx-notif-backdrop,#tab-benachrichtigungen';

  function getPath(event) {
    if (event && typeof event.composedPath === 'function') return event.composedPath();
    const path = [];
    let node = event && event.target;
    while (node) { path.push(node); node = node.parentNode; }
    return path;
  }

  function resolveTriggerFromNode(node) {
    if (!node || node.nodeType !== 1) return null;
    if (node.closest && node.closest(NOTIFICATIONS_UI_SELECTOR)) return null;
    const explicit = node.closest && node.closest(EXPLICIT_SELECTOR);
    if (!explicit) return null;
    // Das gekennzeichnete Element IST der Ausloeser. Frueher wurde von hier aus
    // noch nach oben zum naechsten button/a/[role]/[tabindex] gesucht -- das
    // ergab nur Sinn, solange die Kennzeichnung ein Icon tief im Markup treffen
    // konnte. Bei einer ausdruecklichen Auszeichnung waere es ein Weg, den
    // Ausloeser nachtraeglich wieder zu verschieben.
    return explicit;
  }

  function resolveTrigger(event) {
    const path = getPath(event);
    for (let i = 0; i < path.length; i += 1) {
      const trigger = resolveTriggerFromNode(path[i]);
      if (trigger) return trigger;
    }
    return null;
  }

  function clearLegacyVisibilityOverrides() {
    doc.querySelectorAll('.tab-page').forEach(function (page) {
      page.style.removeProperty('display');
      page.removeAttribute('hidden');
      page.removeAttribute('aria-hidden');
    });
  }

  function rememberCurrentPage() {
    const active = Array.from(doc.querySelectorAll('.tab-page.active')).find(function (page) {
      return page.id !== 'tab-benachrichtigungen';
    });
    if (active && active.id) previousPageId = active.id;
  }

  function prepareNativePage() {
    if (typeof root.vxBellUpdateBadge === 'function') root.vxBellUpdateBadge();
    if (typeof root.vxBellRender === 'function') root.vxBellRender();
    if (typeof root.vxBellPageRender === 'function') root.vxBellPageRender();
  }

  function navigateTo(tabName, trigger) {
    clearLegacyVisibilityOverrides();
    if (typeof root.showTab === 'function') {
      try {
        root.showTab(tabName, trigger || undefined);
        return true;
      } catch (error) {
        console.error('[customer-notifications] showTab failed', error);
      }
    }
    const page = doc.getElementById('tab-' + tabName);
    if (!page) return false;
    doc.querySelectorAll('.tab-page').forEach(function (item) { item.classList.toggle('active', item === page); });
    return true;
  }

  function openNativeNotifications(trigger) {
    rememberCurrentPage();
    prepareNativePage();
    if (!doc.getElementById('tab-benachrichtigungen')) return false;
    const opened = navigateTo('benachrichtigungen', trigger);
    if (typeof root.scrollTo === 'function') root.scrollTo({ top: 0, behavior: 'auto' });
    return opened;
  }

  function restorePreviousPage() {
    const candidates = [previousPageId, 'tab-dashboard', 'tab-heute', 'tab-home'];
    let page = null;
    for (let i = 0; i < candidates.length && !page; i += 1) page = candidates[i] && doc.getElementById(candidates[i]);
    if (!page) return false;
    const restored = navigateTo(String(page.id).replace(/^tab-/, ''));
    if (typeof root.scrollTo === 'function') root.scrollTo({ top: 0, behavior: 'auto' });
    return restored;
  }

  function isNotificationBackAction(event) {
    const page = doc.getElementById('tab-benachrichtigungen');
    const target = event && event.target;
    if (!page || !target || !page.contains(target)) return false;
    const control = target.closest && target.closest('button,a,[role="button"],[tabindex],div');
    if (!control || !page.contains(control)) return false;
    const label = String(control.getAttribute('aria-label') || control.getAttribute('title') || control.textContent || '').trim();
    return /zurück|back/i.test(label) || (control.matches && control.matches(BACK_ICON_SELECTOR)) || !!(control.querySelector && control.querySelector(BACK_ICON_SELECTOR));
  }

  // Ein Element, das bereits in einem Bedienelement liegt, darf nicht selbst zu
  // einem gemacht werden.
  //
  // Nebenfund derselben Ursache: das Icon-<span> der Einstellungszeile liegt in
  // einem <button> und bekam von bindTrigger() role="button", tabindex="0" und
  // aria-label="Benachrichtigungen oeffnen". Ergebnis: eine verschachtelte
  // interaktive Rolle (nach ARIA ungueltig), ein zusaetzlicher Tab-Stopp mitten
  // in der Liste, und eine Screenreader-Ansage, die das Gegenteil dessen sagt,
  // was die Zeile tut.
  //
  // Die Pruefung bleibt, obwohl die Glyphen-Erkennung weg ist: sie kostet
  // nichts und faengt den Fall ab, dass jemand data-notifications-trigger auf
  // ein Kind statt auf das Bedienelement setzt.
  const INTERACTIVE_SELECTOR = 'button,a[href],input,select,textarea,[role="button"],[role="link"],[role="menuitem"]';

  function isInsideInteractiveControl(element) {
    if (!element || !element.parentElement || !element.parentElement.closest) return false;
    return Boolean(element.parentElement.closest(INTERACTIVE_SELECTOR));
  }

  function bindTrigger(trigger) {
    if (!trigger || trigger.dataset.vxNotificationsBound === 'native-v5') return;
    if (isInsideInteractiveControl(trigger)) {
      console.warn(
        '[customer-notifications] Ausloeser liegt in einem Bedienelement und wird nicht gehaertet:',
        trigger
      );
      return;
    }
    trigger.dataset.vxNotificationsBound = 'native-v5';
    trigger.setAttribute('role', trigger.getAttribute('role') || 'button');
    trigger.setAttribute('tabindex', trigger.getAttribute('tabindex') || '0');
    trigger.setAttribute('aria-label', trigger.getAttribute('aria-label') || 'Benachrichtigungen öffnen');
    trigger.style.setProperty('pointer-events', 'auto', 'important');
    trigger.style.setProperty('cursor', 'pointer', 'important');
    trigger.style.setProperty('position', trigger.style.position || 'relative', 'important');
    trigger.style.setProperty('z-index', '1301', 'important');
  }

  function prepareTriggers() {
    const candidates = new Set();
    doc.querySelectorAll(EXPLICIT_SELECTOR).forEach(function (node) {
      if (node.closest && node.closest(NOTIFICATIONS_UI_SELECTOR)) return;
      candidates.add(node);
    });
    candidates.forEach(bindTrigger);
  }

  function handleActivation(event) {
    if (isNotificationBackAction(event)) {
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      restorePreviousPage();
      return;
    }
    const trigger = resolveTrigger(event);
    if (!trigger) return;
    bindTrigger(trigger);
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    // pointerdown/click/touchend fire in sequence for the same physical
    // click/tap — without this guard each one re-triggers activation and a
    // stateful toggle (vxBellToggle) opens then immediately closes again
    // within the same interaction, so nothing appears to happen.
    const now = Date.now();
    if (now - lastActivationAt < ACTIVATION_DEDUPE_MS) return;
    lastActivationAt = now;
    // IA-Entscheidung (Fahrplan 08.08.): Notifications als anchored Popover,
    // nicht als Vollseite. Die native Glocke rendert/öffnet #vx-notif-panel;
    // dieser Bridge-Handler bleibt nur für Keyboard-/ARIA-Härtung (bindTrigger)
    // und den Fallback zuständig, falls vxBellToggle einmal fehlt.
    if (typeof root.vxBellToggle === 'function') {
      prepareNativePage();
      root.vxBellToggle(event);
      return;
    }
    openNativeNotifications(trigger);
  }

  doc.addEventListener('pointerdown', handleActivation, true);
  doc.addEventListener('click', handleActivation, true);
  doc.addEventListener('touchend', handleActivation, true);
  doc.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ') handleActivation(event);
  }, true);

  root.vxOpenCustomerNotifications = openNativeNotifications;
  root.vxCloseCustomerNotifications = restorePreviousPage;

  function boot() {
    clearLegacyVisibilityOverrides();
    prepareTriggers();
    new MutationObserver(prepareTriggers).observe(doc.documentElement, { childList: true, subtree: true });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
