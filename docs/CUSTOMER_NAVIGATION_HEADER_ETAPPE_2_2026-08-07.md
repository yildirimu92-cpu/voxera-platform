# Navigation & Header — Etappe 2

Date: 2026-08-07
Branch: `claude/navigation-header-component-ffihu8`
Scope: authenticated customer dashboard (`customer-dashboard/`)

## Goal

One minimal header on every screen, so the dashboard reads as a single
product instead of a set of screens that each invented their own bar.

## What changed

### 1. One header component

`.vx-appbar` in `shared/customer-navigation-components.css`, with markup
from `VoxeraUI.appBar()` in `shared/customer-ui-components.js` and its
visual contract in `--vx-ui-appbar-*` tokens.

- white surface, `0.5px` divider `#E5E8EE` at the bottom, no radius, no
  shadow;
- one title, 17px / 600 in the display face, Night `#0D1F3C`;
- optional back arrow to the left of the title;
- nothing else, identical on every screen.

It replaced four separate header systems, all of which were deleted rather
than layered over:

| Replaced owner | Was | Where it lived |
| --- | --- | --- |
| `.vx-page-header` / `.vx-page-header-title` / `-subtitle` / `-action` | Night bar, 16px radius, 25px white title | `index.html`, `customer-design-system.css` |
| `.vx-back-btn` | round translucent-on-dark icon button | `index.html` |
| `.vx-assistant-root-header` / `-title` / `-subtitle` | dark brand panel, 30px title + subline | `customer-assistant-components.css` |
| `.vx-settings-subpage-header`, `.vx-settings-header-copy`, `.vx-cal-page-header`, `.vx-cal-header-copy`, `.vx-cal-header-subtitle`, `.vx-cal-back` | settings/calendar header row | `customer-settings-components.css` |
| `.vx-notif-mobile-head` / `-back` / `-title` / `-markall` | Night bar on the notifications page | `index.html` (5 duplicated media blocks) |
| dark `.vxdr-header` surface | Night panel of the request detail | `index.html` |

The `#mehr-sub-profil` / `#tab-hilfe` page-header rules injected at runtime
by `customer-runtime-settings-polish.js` were deleted from its style string.

### 2. Header meta moved into the content

Everything the old headers carried beyond the screen name is now the first
card of the content area — plain `.vx-ui-card`, laid out by
`.vx-screen-meta`, no special treatment:

| Screen | Moved out of the header |
| --- | --- |
| Heute | greeting (`#dash-greeting-title`), open-items line (`#dash-greeting-sub`), date/time (`#dash-datetime-label`) |
| Anfragen | "0 offen · 1 geplant · 0 erledigt" (`#anrufe-split-count`) |
| Bericht | period switch 7 Tage / 30 Tage / Gesamt (`#au-period-row`) |
| Benachrichtigungen | "Alle gelesen" action |
| Anfrage-Detail | avatar, contact meta, status pills and the header actions |

The period switch used to carry translucent-on-dark colors for the Night
bar; on a card it inherits the canonical pill tab (`.vx-ui-tab`) instead, so
those three overrides are gone too.

Static sublines that only repeated the settings list entry ("Persönliche
Daten und Zugang verwalten.", "Plan, Nutzung und Vertragsdetails.", …) were
dropped rather than moved — they were decoration, not information.

### 3. Back navigation

`shared/customer-runtime-screen-navigation.js` (new) owns the contract:

- a sub-screen pushes a history entry when it opens, so the arrow is a plain
  `history.back()` — the arrow, the browser button and the back gesture are
  the same operation and cannot drift apart;
- a sub-screen closed by anything else (a root tab switch, for instance)
  strips the marker from the current entry, so a stale entry can never
  reopen it;
- `vxMehrShow` / `vxMehrBack` keep being the entry points every settings
  screen already called; they only gained the history entry around them.
  The calendar page owns its own show/hide and registers through
  `vxScreenNav.enter/exit`.

Back arrows are on: Profil, Benachrichtigungen, Abonnement, Darstellung,
Rufumleitung, Kalender, Hilfe & Support, the notifications page and the
request detail. The five top-level screens (Heute, Anfragen, Assistent,
Bericht, Einstellungen) have none.

The request detail keeps `vxHandleDetailBack`, which already resolves the
real origin — Heute, Anfragen or a previous detail — from the detail nav
stack. Inside the Anfragen split the detail is a pane of the Anfragen
screen, not a screen of its own, so its bar is suppressed there; that is
expressed in CSS rather than at render time, so it follows
`#call-detail-page` as it moves between the split pane and full screen
without needing a re-render.

## Side effect worth calling out

`#anrufe-split` was bound to the viewport with a hard-coded `100vh - 130.5px`
offset measured against the old Night header. Etappe 2 changes what sits
above it, so the constant was replaced instead of re-measured: `#tab-anrufe`
is a flex column of viewport height minus the content inset and the split
takes the rest. Same definite height for `#anrufe-split-right`, no magic
number to maintain.

## Deviation from the brief

The brief specified 14px radius for the meta card. The card component
shipped in Design-System Etappe 1 resolves at 12px
(`--vx-ui-card-radius`), and the brief's own instruction for these cards is
"normale Card-Logik … keine Sonderbehandlung". They use the canonical card
unchanged; forcing 14px would have made them the one card in the product
with its own radius.

The brief names "Assistent-Unterseiten" as an example of screens that get a
back arrow. In the shipped build those three areas (Assistent,
Geschäftsprofil, Aktuelle Infos) are a visible tab switch directly under the
Assistent header, not a drill-in — the switch stays on screen the whole
time. A back arrow next to a visible tab bar would be wrong, so the
Assistent root keeps the arrow-free bar and the switch below it. Turning
those tabs into real sub-screens is a navigation change, not a header
change.

## Verification

- `scripts/verify-customer-design-foundation.mjs` — extended with the header
  contract: no module outside the navigation component may declare a screen
  header; the five top-level screens carry an arrow-free bar; every static
  back arrow routes through `vxScreenBack`; the request detail routes
  through `vxHandleDetailBack`.
- `scripts/verify-calendar-integrations.mjs` — the calendar page uses the
  shared bar and the settings module no longer owns a page header.
- `scripts/verify-customer-actions.mjs`,
  `scripts/verify-customer-navigation-unified.mjs`,
  `scripts/verify-customer-assistant-profile.mjs`,
  `scripts/verify-customer-operational-updates.mjs`,
  `scripts/audit-customer-runtime-reachability.mjs` — pass.
- `customer-dashboard/tests/*.test.cjs` — pass.
- Rendered in headless Chromium at 1360×900 and 430×900: Heute, Anfragen,
  Bericht, Assistent, Einstellungen, Profil, Abonnement, Kalender,
  Benachrichtigungen and the request detail in split and full-screen mode.
  Back arrow, browser back and browser forward verified against the settings
  sub-screens, including the tab-switch case.

Auth, API, data loading and routing behaviour were not changed. Asset cache
versions were bumped for every file touched (`20260807-2`, then
`20260807-3` for the review round below).

## Nachbesserung nach Preview-Review (2026-08-07)

Vier Punkte aus dem Review vor dem Merge:

1. **Header-Titel wirkte ungestaltet.** 17px/500 in der Body-Schrift las sich
   wie unformatierter Text. Der Titel trägt jetzt die Display-Schrift,
   Gewicht 600 und `-0.02em` Tracking; die Leiste wuchs auf 56px Höhe und
   16px Innenabstand. Die Grösse bleibt bei 17px.

2. **Meta-Card auf Anfragen las sich nicht als Card.** Die Card-Hülle war
   technisch korrekt — kanonische `.vx-ui-card`, 0.5px Rahmen, 12px Radius —
   aber der Inhalt war eine einzelne 13px-Zeile in gedämpftem Grau im
   kompakten Inset, und damit ohne Präsenz. Die Meta-Cards nutzen jetzt das
   normale Card-Inset statt `--compact`, und der Zähler ist die
   Inhaltszeile der Card (`.vx-screen-meta-title`, Display-Schrift, Ink)
   statt eine gedämpfte Nebenzeile. Die Hülle selbst bleibt unverändert die
   kanonische Card.

3. **Profil: dunkles Night-Band unter dem hellen Header.** Die
   Identitäts-Zeile (`.vx-settings-identity`) war eine zweite, dunkle
   Kopfzeile direkt unter der neuen Leiste. Sie ist jetzt ein Card-Head wie
   jeder andere; der Avatar bleibt in Brand-Blau. Die `#10213f`-Überschreibung
   aus `customer-runtime-settings-polish.js` wurde entfernt.

4. **Radio-Buttons und Checkboxen waren native Controls.** Etappe 1 hatte
   sie bewusst aus dem Formularfeld-Vertrag ausgenommen und nur mit
   `accent-color` eingefärbt — Box, Haken, Fokusring und Disabled-Zustand
   blieben damit browserabhängig. Sie bekommen jetzt einen eigenen
   kanonischen Vertrag in `customer-ui-components.css` (Block 8,
   `--vx-ui-choice-*`): eine Box für beide, nur Radius und Marke
   unterscheiden sich, gleicher Akzent und gleicher Fokusring wie überall
   sonst. Die Grössen- und `accent-color`-Deklarationen für
   `.vx-settings-choice input[type="radio"]` und
   `.vx-settings-switch-row input` wurden aus
   `customer-settings-components.css` gelöscht.

   Beim Aufbau ist die `:where()`-Falle aufgetreten und wurde behoben:
   `:where()` trägt keine Spezifität bei, deshalb verlor die
   `:checked::before { opacity: 1 }`-Regel in ihrer `:where()`-Form gegen die
   Basisregel — die Marke blieb unsichtbar. Die Checked-Regel ist bewusst
   ohne `:where()` geschrieben.

Erweiterte Prüfungen in `scripts/verify-customer-design-foundation.mjs`:
Choice-Control-Tokens vorhanden, `appearance: none` für Checkbox und Radio,
und das Settings-Modul darf kein `accent-color` mehr enthalten.

## Audio-Player-Bug: "Audio wird sicher abgerufen…" hängt in Heute-Vollbild (2026-08-07)

Gemeldet als vermutlich derselbe Scoping-Fehler wie PR #819 (der damals nur
den Split-View-Pfad erreichte, nicht den Vollbild-Pfad). Die Live-Preview
war aus dieser Sandbox nicht erreichbar (kein Netzwerkzugriff auf
netlify.app), daher wurde per statischer Analyse plus Headless-Chromium-
Reproduktion mehrerer realistischer Szenarien untersucht (Auto-Load mit
reiner `conversation_id`, „geschützte" absolute Audio-URL mit manuellem
Klick, jeweils Split und Vollbild) — alle liefen in dieser Umgebung
fehlerfrei durch. Das exakte Live-Symptom liess sich damit nicht
reproduzieren.

Bei der Untersuchung wurden zwei konkrete, für sich genommen echte Bugs
gefunden, die genau zur beschriebenen Fehlerklasse passen — etwas, das den
Split-Pfad korrekt erreicht, aber im Vollbild-Pfad brüchig wird, weil
`id="vx-call-audio-card"` **nicht eindeutig** ist: Split-Panel
(`#requests-detail-v2`), Legacy-Vollseite (`#call-detail-content`) und
v2-Vollbild-Shell (`#vx-detail-v2-full-content`) können alle gleichzeitig
eine eigene Karte mit dieser ID rendern.

1. **`hideLegacyDetail()` hat nie aufgeräumt.** `closeSplitV2()` leert
   `#requests-detail-v2` beim Schliessen (`innerHTML = ''`);
   `hideLegacyDetail()` (aufgerufen von sowohl `openFullscreenV2()` als auch
   `openSplitV2()`) hat die Legacy-Seite nur per `display:none` versteckt,
   `#call-detail-content` aber nie geleert. Sobald der Legacy-Pfad einmal in
   einer Session gerendert hat (z.B. wenn `resolveEntryRecord()` eine ID
   nicht auflösen kann und auf `forceLegacy` zurückfällt), blieb eine
   möglicherweise noch ladende Audio-Karte dauerhaft im DOM — unsichtbar,
   aber vorhanden. `hideLegacyDetail()` leert jetzt `#call-detail-content`
   beim Verstecken, symmetrisch zu `closeSplitV2()`.

2. **Die "sichere" Audio-Bridge hatte keine Reentrancy-Sperre.** Der Loader
   in `index.html` selbst schützt sich mit `data-vx-audio-loading` gegen
   überlappende Aufrufe für dieselbe Karte; die Bridge in
   `shared/offer-brand.js`/`offer-brand-core.js` (die den eigentlich
   laufenden Loader ersetzt — daher der Text "Audio wird sicher
   abgerufen…") hatte diese Sperre nicht. Ein zweiter, sich überschneidender
   Trigger auf derselben Karte (z.B. durch den globalen MutationObserver,
   der bei jeder DOM-Änderung neu scannt) konnte einen zweiten,
   redundanten Fetch auslösen. Per Headless-Test bestätigt: eine
   liegengebliebene Karte löste real einen zweiten Fetch aus. Die Sperre
   ist jetzt auch dort vorhanden.

3. **Die Bridge suchte die fertig geladene Karte nach dem Fetch erneut per
   `document.getElementById('vx-call-audio-card')`.** Bei einer
   liegengebliebenen Dublette (Punkt 1) landet dieser globale, ungescopte
   Lookup potenziell auf der FALSCHEN, alten Karte statt der gerade
   geladenen — mit der Folge, dass `vxHydrateModernAudioPlayers()` das
   falsche Element hydriert. Der Ersatz der Lade-Skeleton-Karte läuft jetzt
   über einen direkten Node-Bau plus `Element.replaceWith()`, sodass die
   Referenz auf die richtige Karte durchgehend erhalten bleibt und kein
   Codepfad mehr per ID danach suchen muss.

Regressionstest: `customer-dashboard/tests/audio-bridge-dom-safety.test.cjs`
baut ein minimales Fake-DOM mit genau der Dubletten-Situation (Stale-Karte
vor der echten Karte in Dokumentreihenfolge) und installiert die echte
Bridge dagegen — bestätigt fehlschlagend gegen den unveränderten Code
(zweiter Fetch feuert) und grün gegen den Fix.

**Offen:** Da sich das exakte Live-Symptom nicht reproduzieren liess, ist
nicht zu 100 % gesichert, dass dies die alleinige Ursache war. Sollte das
Verhalten auf der aktualisierten Preview weiterhin auftreten, braucht es
für die weitere Eingrenzung konkretere Reproduktionsdaten (Konsole/Network-
Tab beim Auftreten, oder ob vorher eine Legacy-Detailansicht geöffnet
war).
