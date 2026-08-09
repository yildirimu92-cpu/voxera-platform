// Abmelden: ein Weg, eine Bestaetigung, eine Farbe.
//
// Hintergrund: es gab zwei Wege mit unterschiedlichem Verhalten. Das mobile
// Menue fragte nach, die Seitenleiste am Desktop meldete ohne Rueckfrage
// sofort ab — dieselbe verlierbare Aktion mit zwei verschiedenen Zusagen. Der
// mobile Weg ging ausserdem an handleLogout vorbei und damit an dessen
// Fehlerbehandlung. Diese Tests halten den zusammengefuehrten Weg fest.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dashboard = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const settingsCss = fs.readFileSync(
  path.join(__dirname, '..', 'shared', 'customer-settings-components.css'), 'utf8'
);

function fn(name) {
  const start = dashboard.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'Funktion ' + name + ' nicht gefunden');
  const next = dashboard.indexOf('\nfunction ', start + 1);
  return dashboard.slice(start, next === -1 ? start + 6000 : next);
}

test('kein Bedienelement meldet ohne Rueckfrage ab', () => {
  // Die Bestaetigung ist nicht optional: kein Knopf im Markup darf an
  // vxLogoutAction vorbei direkt abmelden.
  for (const direct of [/onclick="handleLogout\(/, /onclick="doLogout\(/]) {
    assert.doesNotMatch(dashboard, direct,
      'ein Bedienelement meldet ohne Bestaetigung ab');
  }
  // Der erzwungene Abgang (abgelaufener oder entzogener Zugriff) ist bewusst
  // ausgenommen — er ist keine Nutzerhandlung und darf nicht nachfragen. Er
  // ist der einzige weitere Aufrufer von doLogout.
  assert.match(fn('ensureActiveCustomerOrLogout'), /await doLogout\(\)/,
    'der erzwungene Abgang bleibt der dokumentierte zweite Aufrufer');
});

test('alle drei Einstiege laufen ueber dieselbe Funktion', () => {
  const entries = dashboard.match(/onclick="vxLogoutAction\(/g) || [];
  assert.equal(entries.length, 3,
    'erwartet: Seitenleiste, mobiles Menue, Einstellungen — gefunden: ' + entries.length);
  const action = fn('vxLogoutAction');
  assert.match(action, /openConfirmModal\(/, 'der Einstieg muss bestaetigen lassen');
  assert.match(action, /handleLogout\(/,
    'bestaetigt wird ueber handleLogout, damit Fehlerpfad und Ladezustand greifen');
});

test('der Dialog traegt den bestaetigenden Ton, nicht Rot', () => {
  const action = fn('vxLogoutAction');
  assert.match(action, /tone: 'primary'/,
    'Rot ist Dringlichkeit/Ungelesenes — Abmelden ist eine gewoehnliche Handlung');
  assert.doesNotMatch(action, /tone: 'danger'/);
});

test('Abmelden ist auch ueber die Einstellungen erreichbar', () => {
  assert.match(dashboard, /class="vx-settings-entry vx-settings-entry--action"[^>]*onclick="vxLogoutAction\(/,
    'der Eintrag in der Einstellungsliste fehlt');
  // Der Eintrag fuehrt nicht weiter, also traegt er keinen Chevron.
  const entryStart = dashboard.indexOf('vx-settings-entry--action');
  const entry = dashboard.slice(entryStart, dashboard.indexOf('</button>', entryStart));
  assert.doesNotMatch(entry, /vx-settings-entry-caret/,
    'ein Eintrag, der einen Dialog oeffnet, darf kein "hier geht es weiter" versprechen');
  assert.match(settingsCss, /\.vx-settings-list--actions/,
    'die abgesetzte Handlungsliste braucht ihre Regel im Komponentenmodul');
});

test('der mobile Abmelden-Knopf bestimmt sein Aussehen nicht mehr selbst', () => {
  // Vorher: eigener Night-Knopf mit hartkodierter Farbe und eigener Geometrie
  // im mobilen Menue — dieselbe Handlung sah dort schwerer aus als am Desktop.
  const menuStart = dashboard.indexOf('id="mobile-user-menu"');
  const menu = dashboard.slice(menuStart, dashboard.indexOf('</div>\n\n<!--', menuStart) + 200);
  assert.doesNotMatch(menu, /background:#0D1F3C/,
    'der mobile Abmelden-Knopf traegt keine eigene hartkodierte Flaeche mehr');
});

test('der Ladezustand findet seine Knoepfe ueber ein Attribut', () => {
  const loading = fn('setLogoutButtonsLoading');
  assert.match(loading, /\[data-vx-logout-button\]/,
    'der frueher benutzte onclick-Selektor traf nach der Zusammenfuehrung nichts mehr');
  assert.doesNotMatch(loading, /onclick\*="handleLogout"/);
  // Genau die beiden Menue-Eintraege tragen das Attribut — der
  // Einstellungs-Eintrag nicht, weil ein innerHTML-Austausch seine
  // Zeilenstruktur zerstoeren wuerde.
  const marked = dashboard.match(/<button[^>]*\sdata-vx-logout-button[\s>]/g) || [];
  assert.equal(marked.length, 2, 'erwartet genau die beiden Menue-Eintraege');
});
