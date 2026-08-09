'use strict';

// Wohin der Aktivierungslink aus der Willkommensmail zeigt.
//
// Eine Stelle, weil es zwei Aufrufer gibt (send-customer-access.js und
// outbox-retry-worker.js). Vorher hatte jeder seinen eigenen Fallback, und
// beide zeigten an der Aktivierungsseite vorbei.
//
// Hintergrund (ACTIVATION_ROUTING_AUDIT_2026-08-09.md): bis 09.08.2026 lautete
// der Default 'https://dashboard.voxera.ch' — die Dashboard-Wurzel. Ein
// eingeladener Kunde landete damit nie auf customer-dashboard/activate.html,
// sondern auf dem Recovery-Formular in index.html. Das fiel monatelang nicht
// auf, weil dieses Formular funktioniert; es verdeckte, dass activate.html seit
// dem ersten Commit abgeschnitten war und keine Zeile ausfuehrte.
//
// Der Passwort-vergessen-Weg bleibt bewusst auf der Dashboard-Wurzel: dort
// gehoert das Recovery-Formular aus index.html hin. Die beiden Faelle trennen
// sich damit am Link, nicht durch Verzweigungen in der Seite.

const DEFAULT_DASHBOARD_URL = 'https://dashboard.voxera.ch';
const ACTIVATION_PATH = '/activate';

/** Basis-URL des Kundendashboards, ohne Schraegstrich am Ende. */
function resolveDashboardUrl() {
  const raw = String(process.env.DASHBOARD_URL || '').trim() || DEFAULT_DASHBOARD_URL;
  return raw.replace(/\/+$/, '');
}

/**
 * Zieladresse des Aktivierungslinks.
 *
 * Ohne gesetztes ACTIVATE_URL wird sie aus der Dashboard-Adresse plus
 * Aktivierungspfad gebildet — dadurch ist der Default von sich aus richtig und
 * haengt nicht daran, dass jemand in Netlify eine zweite Variable pflegt.
 * ACTIVATE_URL bleibt als ausdruecklicher Vorrang bestehen (z.B. Staging).
 *
 * @returns {{url: string, source: string, pointsAtActivationPage: boolean}}
 */
function resolveActivationUrl() {
  const override = String(process.env.ACTIVATE_URL || '').trim();
  const url = override
    ? override.replace(/\/+$/, '')
    : `${resolveDashboardUrl()}${ACTIVATION_PATH}`;

  return {
    url,
    source: override ? 'ACTIVATE_URL' : 'DASHBOARD_URL+' + ACTIVATION_PATH,
    // Zeigt der Wert ueberhaupt auf die Aktivierungsseite? Ein ACTIVATE_URL auf
    // die Dashboard-Wurzel ist genau der Zustand, der den urspruenglichen
    // Fehler verdeckt hat — deshalb pruefbar statt still hingenommen.
    pointsAtActivationPage: /\/activate(\.html)?$/.test(url)
  };
}

/**
 * Loggt einmal pro Versand, wohin der Link zeigt. Zeigt er an der
 * Aktivierungsseite vorbei, wird das als Warnung sichtbar statt still zu
 * passieren.
 */
function logActivationTarget({ customerId, event }) {
  const resolved = resolveActivationUrl();
  const line = {
    level: resolved.pointsAtActivationPage ? 'info' : 'warn',
    event: event || 'activation_link_target',
    customer_id: customerId || null,
    activation_url: resolved.url,
    resolved_from: resolved.source,
    points_at_activation_page: resolved.pointsAtActivationPage
  };
  if (!resolved.pointsAtActivationPage) {
    line.hint = 'Der Link zeigt nicht auf die Aktivierungsseite. Der Kunde landet auf einer anderen Seite als vorgesehen — ACTIVATE_URL pruefen.';
  }
  console.log(JSON.stringify(line));
  return resolved;
}

module.exports = {
  DEFAULT_DASHBOARD_URL,
  ACTIVATION_PATH,
  resolveDashboardUrl,
  resolveActivationUrl,
  logActivationTarget
};
