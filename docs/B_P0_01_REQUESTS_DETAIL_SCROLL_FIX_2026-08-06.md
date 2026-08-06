# B-P0-01: Anfragen-Tab Desktop-Detailbereich nicht bis unten scrollbar — 2026-08-06

**Baseline:** `origin/codex/restore-customer-launch-checks` (enthält die gemergten PRs #805, #806, #807)
**Source finding:** Design-Audit PR #804, B-P0-01
**Datei:** `customer-dashboard/index.html`, Regel `body.vx-customer-design-foundation #anrufe-split.vx-requests-layout` und `#anrufe-split-right` innerhalb `@media (min-width: 769px)` (Zeilen ~6450–6486)

Kein Deploy durchgeführt. Alle Zahlen unten stammen aus echten Chromium/Playwright-Messungen gegen die tatsächliche `index.html`, lokal über einen Static-Server ausgeliefert (kein Supabase, keine echten Daten) — Details unter „Verifikationsmethode".

## Zusammenfassung: zwei Ursachen, nicht eine

Die vorgegebene Root-Cause-Analyse benannte `#call-detail-page`s `position:absolute` als Ursache. Die Messung zeigt: **dieser konkrete Code-Pfad ist auf jeder „Desktop"-Breite bereits tot** — unten mehr dazu. Der tatsächlich aktive Bug bei typischen Desktop-Breiten (≥1100px, `#requests-detail-v2` / `.vx-dv2-shell`) hat zwei eigenständige, voneinander unabhängige Ursachen, beide in derselben Regel wie vom Auftrag vermutet:

1. **Fehlender Viewport-Bezug bei `.vx-requests-layout`** — wie vorgegeben vermutet, aber nicht ganz in der beschriebenen Form: Der Container hatte schon *vorher* eine reale, gebundene Höhe (geerbt von der Basisregel `.vx-split{height:calc(100vh - 118px)}`), aber mit einem **um 12,5px zu kleinen Offset** (118px statt der tatsächlich benötigten 130,5px) — der Block ragte dadurch permanent 12,5px unter den Viewport-Rand hinaus.
2. **`#anrufe-split-right` war `display:block`, nicht `display:flex`** — dies ist die eigentlich entscheidende, vorher nicht dokumentierte Ursache. `#requests-detail-v2` hat inline `flex:1;overflow:auto`, das nur wirkt, wenn der Elternknoten ein Flex-Container ist. Mit `display:block` war `flex:1` wirkungslos, `#requests-detail-v2` wuchs auf seine eigene Inhaltshöhe, und `.vx-dv2-shell{height:100%}` darin hatte dadurch nie eine begrenzte Bezugshöhe — es wuchs ebenfalls unbegrenzt mit dem Inhalt statt zu scrollen.

Beide Fixes stehen in derselben Regel, die der Auftrag als Ziel genannt hat (`@media (min-width: 769px) { body.vx-customer-design-foundation #anrufe-split... }`) — es handelt sich nicht um eine neue, zusätzliche Regel an anderer Stelle.

## Warum `#call-detail-page` (die vorgegebene Root Cause) nicht der aktive Pfad ist

Per Playwright-Messung gegen die echte Datei, mit dem exakten JS-Ablauf aus `index.html:19087` (`.is-open`) und `index.html:19118-19146` (`useSplitDetail`-Branch) nachgebaut:

- **≥1100px Breite:** JS wählt `useDetailV2` (`index.html:19100`: `window.innerWidth >= 1100`). `#call-detail-page` wird dabei explizit `style.display='none'` gesetzt (`index.html:19104`) — nie sichtbar.
- **769–1099px Breite:** JS würde `useSplitDetail` wählen und `#call-detail-page` in `#anrufe-split-right` einbetten — aber `#anrufe-split-right` selbst ist in genau diesem Breitenbereich durch eine **separate, höher-spezifische Regel** unsichtbar:
  ```css
  @media(max-width:1099px){
    #tab-anrufe #anrufe-split-right,
    #anrufe-split-right{ display:none !important; width:0 !important; ... }
  }
  ```
  (`index.html:41725-41742`, Style-Block `id="..."` im Bereich der 2026-05-23-Patches). Der erste Selektor-Zweig (`#tab-anrufe #anrufe-split-right`, zwei IDs) hat höhere Spezifität als jede sonstige `!important`-Regel für dieses Element und gewinnt unabhängig vom Rest — bestätigt via Chrome DevTools Protocol (`CSS.getMatchedStylesForNode`), nicht nur durch Lesen des Quelltexts.
- **<769px Breite:** ohnehin separates Mobile-Layout (`display:block`), nicht Teil dieser Untersuchung.

Ergebnis: `#call-detail-page` wird im Anfragen-Tab auf **keiner** Breite jemals sichtbar in `#anrufe-split-right` eingebettet gerendert. Der Code-Pfad existiert, ist aber durch eine andere, offenbar spätere CSS-Patch-Schicht stillgelegt worden — ein separater, hier **nicht behobener** Befund, siehe „Nicht in diesem PR" unten.

## Die tatsächlich aktive Ursache, mit Zahlen

Playwright-Messung gegen die echte Seite bei 1440×900, `#requests-detail-v2` mit realistischem Langinhalt (Zusammenfassung/Kontakt/Audio/Verlauf/Notizen) befüllt, exakt wie `vxRenderRequestsDetailV2` es tut (`index.html:19108-19116`):

| Messung | Vorher | Nachher |
|---|---|---|
| `#anrufe-split-right` computed `display` | `block` | `flex` |
| `.vx-dv2-shell` computed height | **1278,89px** (ungebunden) | **685,5px** (an Panel gebunden) |
| `.vx-dv2-shell` scrollHeight vs. clientHeight | 1279 vs. 1279 (gleich → **kein Scroll möglich**) | 1279 vs. 686 (**scrollbar**) |
| Letzte Sektion („Notizen") `bottom` nach Scroll-Versuch | y=1437 (537px unterhalb des 900px-Viewports, **unerreichbar**) | y=844 (**innerhalb des Viewports**) |
| `#anrufe-split` Bottom-Überstand über Viewport | 12,5px (konstant, unabhängig von Viewport-Höhe: bei 800/900/1024px identisch gemessen) | 0px |

## Warum 130,5px und nicht 118px

Die Anfragen-Seite hat oberhalb von `.vx-split` einen eigenen `<section class="vx-page-header">` (`index.html:7486-7493`, Titel „Anfragen"). Playwright misst `#anrufe-split.getBoundingClientRect().top` als **konstant 130,5px**, unabhängig von der Viewport-Höhe (getestet bei 800px, 900px, 1024px — exakt gleicher Wert). Die Archiv-Referenzformel (118px) stammt vermutlich von einer Seite mit etwas kompakterem Header — und ist ohnehin nicht am echten `#tab-archiv` nachprüfbar, siehe unten. `calc(100vh - 130.5px)` liefert bei allen drei getesteten Höhen `bottom === viewportHeight` exakt (0px Abweichung), `calc(100vh - 118px)` lag konstant 12,5px daneben.

## Wichtiger Nebenbefund: die Archiv-Referenz ist selbst totes Markup

Beim Versuch, das Archiv-Layout als Live-Vergleich zu rendern: **`#tab-archiv` und `#archiv-split*` existieren nirgends als tatsächliches HTML-Markup** in `customer-dashboard/index.html` oder sonst im Repository — nur als CSS-Selektoren und `getElementById`-Aufrufe, die technisch nie ein Element finden (einziger Treffer für den String `'tab-archiv'` im gesamten Code: eine `getElementById('tab-archiv') && ...`-Prüfung, die durch das fehlende Element immer `null` liefert und still nichts tut). Das „Archiv" scheint an einem früheren Punkt zum `archiv`-Filter-Chip innerhalb des Anfragen-Tabs verschmolzen worden zu sein (`data-filter="archiv"`, `index.html:7501`), ohne die zugehörige Split-Layout-CSS/JS zu entfernen. Die `calc(100vh - 118px) !important`-Regel, auf die sich der Auftrag bezieht, ist also nicht an einer live erreichbaren Seite nachprüfbar — was auch erklärt, warum sie nicht automatisch den richtigen Wert für den Anfragen-Tab geliefert hat.

## Verifikationsmethode

Kein Zugriff auf die deployte Seite oder Supabase in dieser Session. Stattdessen: `customer-dashboard/` lokal über `python3 -m http.server` ausgeliefert (macht `/shared/*.css`- und `/shared/*.js`-Pfade unter `file://` überhaupt erst auflösbar), echte `index.html` unverändert in echtem, per Playwright gesteuertem Chromium geladen, alle Netzwerkaufrufe außer zum lokalen Server per `page.route()` geblockt (kein Supabase-Fetch, kein Hängenbleiben, keine echten Daten nötig). Splash-/Login-Screen entfernt, `#app` sichtbar erzwungen, `#tab-anrufe` aktiviert — alles synchron in einem einzigen `page.evaluate()`, da eine (nicht weiter untersuchte) asynchrone App-Init-Logik `#app` sonst zwischen zwei `evaluate()`-Aufrufen wieder versteckt.

Geprüft:
1. **Offset-Konstanz**: `#anrufe-split.getBoundingClientRect()` bei Viewport-Höhen 800/900/1024px — Top-Offset exakt 130,5px in allen drei Fällen, Bottom-Überstand vor dem Fix konstant 12,5px, danach 0px.
2. **Der eigentliche gemeldete Bug, reproduziert mit echtem Ablauf**: `#requests-detail-v2` mit langem Inhalt (Zusammenfassung/Kontakt/Audio/Verlauf/Notizen) exakt wie `useDetailV2`-Zweig es tut befüllt; `.vx-dv2-shell` vorher 1278,89px (kein Scroll möglich, letzte Sektion 537px unterhalb des Viewports unerreichbar), nachher 685,5px mit funktionierendem `scrollTop`/`scrollHeight` (letzte Sektion nach Scroll bei y=844, innerhalb des 900px-Viewports).
3. **Linkes Listen-Panel unverändert**: `#anrufe-split-left` misst vorher/nachher identisch (380×767,5px, korrekt gebunden) — durch den Fix nicht berührt, da `#anrufe-split-left`s `display:flex` aus einer eigenen, unveränderten Regel (`vx-requests-panel`, Zeile 6562) kommt.
4. **1100px-Breakpoint-Umschaltung**: `#anrufe-split-right` computed `display` und `getBoundingClientRect()` bei 1000px, 1099px, 1100px, 1200px gemessen — 1000/1099px weiterhin `display:none` (unverändert, die separate Dead-Code-Regel gewinnt weiterhin unabhängig vom Fix), 1100/1200px `display:flex` mit korrekt gebundener Höhe (767,5px, exakt am Viewport). JS-seitige Schwelle (`window.innerWidth>=1100`) bleibt unverändert und deckt sich weiterhin exakt mit dem CSS-Umschaltpunkt.
5. **Kein `!important`-Kollisions-Risiko**: Chrome DevTools Protocol (`CSS.getMatchedStylesForNode`) direkt abgefragt, um die *tatsächlich gewinnende* Regel zu bestätigen statt nur den Quelltext zu lesen — deckte die separate `display:none`-Regel (769–1099px) auf, die bei reiner Text-Suche im Quelltext leicht übersehen worden wäre.

Alle Testskripte liefen im Scratchpad der Sandbox und wurden nach Abschluss entfernt; der lokale HTTP-Server wurde gestoppt.

## Nicht in diesem PR

- **`#call-detail-page`/`useSplitDetail` bei 769–1099px Breite ist komplett unsichtbar** (`display:none !important` auf `#anrufe-split-right`, `index.html:41733-41740`) — ein eigenständiger, wahrscheinlich schwerwiegenderer Bug (der gesamte rechte Bereich verschwindet, nicht nur eingeschränktes Scrollen), aber nicht Teil der vorgegebenen Root Cause und nicht das hier gemeldete Symptom. Separater Fix nötig, inklusive Klärung, ob dieser Breitenbereich überhaupt noch unterstützt werden soll oder der `useDetailV2`-Schwellenwert einfach auf 769px abgesenkt gehört.
- **`#anrufe-split-right` fehlt `position:relative`**, was `#call-detail-page`s absolute Positionierung (`top:0;left:0;right:0;bottom:0`) betreffen würde, sollte der `useSplitDetail`-Pfad je reaktiviert werden — aktuell folgenlos, da der Pfad ohnehin unsichtbar ist.
- **Die tote `#tab-archiv`/`#archiv-split*`-Markup-Referenz** — Aufräumen oder Wiederherstellen ist eine separate Entscheidung, nicht Teil dieses Fixes.
- P0-1 bis P0-4 sowie A-P0-01 — bereits in gemergten PRs #805, #806, #807.

## Rollback

Reine CSS-Änderung in `customer-dashboard/index.html`, keine Migration, kein Schema. Revert des Commits und Redeploy des vorherigen Builds ist ein vollständiger Rollback.
