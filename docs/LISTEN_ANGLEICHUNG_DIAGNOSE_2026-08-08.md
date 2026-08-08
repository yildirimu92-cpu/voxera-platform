# Listen an das modernisierte Detail-Panel angleichen — Diagnose + Umsetzung

**Datum:** 2026-08-08
**Basis:** `main` @ `2fba85f` (enthält #847 und #848)
**Auftrag:** Heute-Karten („Braucht dich" / „Hat sich erledigt") und Anfragen-Zeilen an
das in #848 modernisierte Detail-Panel angleichen.

**Stand:** Diagnose (Teil A–E) abgeschlossen und mit allen fünf Entscheidungen ohne
Abweichung freigegeben. Umsetzung (Teil F) ebenfalls abgeschlossen.

---

## Teil A — Wie viele Renderer?

Der Auftrag verweist auf die frühere „5 Hosts statt 3 Renderer"-Überraschung und bittet,
nicht anzunehmen, es sei nur einer. Die Zählung fällt anders aus als befürchtet — aber die
Überraschung liegt woanders.

**Gefunden: 10 Bauer für Anruf-/Anfrage-Zeilen. Davon sind 6 tot.**

| # | Bauer | Zielcontainer | Zustand |
|---|---|---|---|
| 1 | `vxHeuteHandoverCardHtml()` `:20050` | `#dash-needs-you-list`, `#dash-resolved-list` | **LIVE** — die Heute-Karten |
| 2 | `renderAnrufeInbox()` Zeilenblock `:21893`–`:21945` | `#anrufe-list` | **LIVE** — die Anfragen-Zeilen |
| 3 | `renderDashFocusCard()` `:9527` | `#dash-focus-zone` | tot |
| 4 | `renderDashPriorityList()` `:9635` | `#dash-priority-section` | tot |
| 5 | `vxHeuteRenderActivityList()` `:19855` | `#dash-activity-section` | tot |
| 6 | `vxHeuteRenderScopedList()` `:20166` | `#dash-today-calls/done-section` | tot |
| 7 | `renderList()` `:21313` | `rueckrufe-list` | tot — Container existiert nicht |
| 8 | `renderArchivInbox()` `:22299` | `archiv-list` | tot — Container existiert nicht, kein `tab-archiv` |
| 9 | `_vxBellBuildHTML()` `:10255` | Glocke / Mobil-Benachrichtigungen | live, **andere Fläche** — nicht im Auftrag |
| 10 | `renderTimelineHTML()` `:18807` | Kontakt-Historie **im Panel** | live, gehört zum Panel |

### Warum 3–6 tot sind — im Code ausdrücklich so gewollt

`index.html:7255`–`7273` trägt eine `display:none !important`-Regel auf
`#dash-focus-zone`, `#dash-priority-section`, `#dash-activity-section`,
`#dash-today-calls-section`, `#dash-today-done-section`. Der Kommentar dort erklärt auch
warum das `!important` nötig war:

> Mehrere Legacy-Renderfunktionen setzen bei jedem Re-Render `el.style.display = ''` auf
> einigen dieser Elemente (z.B. `vxHeuteRenderActivityList`, `vxHeuteRenderScopedList`) —
> ein reines inline `display:none` wird dadurch bei jedem Datenupdate wieder aufgehoben.

Das ist geprüft, nicht angenommen: `vxHeuteRenderScopedList` (`:20172`) setzt tatsächlich
`section.style.display = rows.length ? '' : 'none'`. Ohne die `!important`-Regel wären
diese Abschnitte sichtbar. Sie sind es nicht.

7 und 8 sind auf andere Art tot: ihre Container existieren im Markup überhaupt nicht mehr.
Beide Funktionen beginnen mit `if (!el) return;` und laufen ins Leere. Es gibt auch keinen
Archiv-Tab mehr — die vorhandenen `tab-page`-Elemente sind `dashboard`, `anrufe`,
`auswertung`, `assistent`, `mehr`, `einstellungen`, `hilfe`, `benachrichtigungen`.

**Konsequenz für den Auftrag:** angefasst werden müssen **genau zwei** Stellen. Die
sechs toten Bauer sind ein eigener Aufräum-Kandidat, kein Teil dieses Auftrags — sie
anzufassen kostet Diff ohne sichtbare Wirkung.

### Die eigentliche Überraschung: beide Listen hängen schon am selben Tokensatz

Die zwei lebenden Flächen benutzen **verschiedene Klassenfamilien** —
`.vx-handover-card-*` auf Heute, `.vx-requests-*` unter Anfragen — ziehen ihre
Typografie- und Farbwerte aber **beide aus `--vx-ui-row-*`**. Das steht im Heute-CSS sogar
so dran (`:7339`): „Kartenwerte aus demselben Token-Satz wie die Anfragen-Zeile".

Beide Listen sind also bereits untereinander konsistent. Sie hängen dem Panel nach, weil
#848 den `--vx-ui-row-*`-Satz nicht angefasst hat, nicht weil die Listen auseinanderlaufen.

---

## Teil B — Die Falle: `--vx-ui-row-*` ist kein Listen-Tokensatz

Das ist der Befund, der den Umsetzungsplan bestimmt. Ein naiver Token-Pass hätte
Rückwirkung auf genau das Panel, das #848 gerade festgezurrt hat.

Konsumenten der drei Rollen, die geändert werden müssten:

| Token | Listen (Ziel) | Kollateral |
|---|---|---|
| `--vx-ui-row-title-size` | `.vx-requests-title` `:6574`, `.vx-handover-card-title` `:7376` | **`.vx-dv2-action-title` `:36862` (im Panel)**, `.vx-requests-detail-empty::before` `:6706` |
| `--vx-ui-row-icon-bg` / `-icon-color` | `.vx-requests-icon` `:6538`/`:6548`, `.vx-handover-card-icon` `:7371` | **`.vx-dv2-action-icon` `:36861` (im Panel)**, `.vx-audio-modern__btn` `:39543`, `.vx-audio-modern__speed` `:39557` |

Der Audio-Player ist laut #848 ausdrücklich eigener Auftrag („Das Innenleben des
Audio-Players bleibt unangetastet"). Ihn über einen Token-Nebeneffekt umzufärben wäre
genau der Griff, den #848 vermieden hat.

Unkritisch bleiben `--vx-ui-row-title-weight`, `-title-color`, `-desc-*`, `-font`,
`-border-*`, `-radius`, `-padding`, `-gap`: die werden hier nicht verändert.

**Empfehlung:** die drei riskanten Rollen **nicht** am geteilten Satz ändern, sondern
listen-eigene Tokens einführen (`--vx-ui-list-title-size`, `--vx-ui-list-avatar-bg`,
`--vx-ui-list-avatar-color`), definiert im Token-Owner und ausschliesslich von den zwei
Listen-Familien gelesen. Ergebnis: weiterhin **eine** Quelle für beide Listen, Panel und
Audio-Player bleiben unberührt.

---

## Teil C — Was von #848 übertragbar ist, und was nicht

Zielsprache aus #848: Name 20px/700 (18px mobil), Stimme 19px Newsreader (seit
2026-08-08: 20px/500 Sans, siehe `SANS_STIMMENROLLE_2026-08-08.md`), Fliesstext 13px,
Label/Meta 12px/600; Gold-Verlaufsstreifen über der Kopfzeile, Gold-Initialen auf Night.

| Entscheidung | Liste heute | Übertragbar? |
|---|---|---|
| Fliesstext 13px | `--vx-ui-row-desc-size: 13px` | **bereits identisch** — nichts zu tun |
| Meta 12px | `--vx-ui-row-time-size: 12px`, Gewicht 400 | Grösse identisch; **Gewicht** auf 600 angleichbar |
| Name 20px/700 | 14px/700 | **nicht 1:1** — siehe unten |
| Stimme 19px Serife | existiert in Listen nicht | **nein** — siehe unten |
| Gold-Initialen auf Night | Listen haben **keine Initialen** | **nicht wie im Auftrag angenommen** — siehe unten |
| Gold-Verlaufsstreifen | nicht vorhanden | **nur einmal pro Abschnitt, nicht pro Zeile** |

### C1. Gold-Initialen — die Annahme im Auftrag stimmt nicht

Der Auftrag nennt „Avatar-Initialen Gold auf Night" als direkt übertragbar. **Beide
lebenden Listen rendern gar keine Initialen.** Sie rendern ein Phosphor-Icon, und dieses
Icon trägt Information: `typeMeta.icon` kodiert die Anfrageart (`phone-incoming`,
`callback`, `offer`, `appointment`, …).

Auf Initialen umzustellen würde diese Information aus der Zeile löschen — das wäre eine
IA-Änderung und ist im Auftrag ausgeschlossen.

*Vorschlag stattdessen:* Icon behalten, den Kreis auf Night mit goldenem Icon umstellen.
Das überträgt die Night-plus-Gold-Anmutung, ohne Information zu verlieren.

Zwei Einschränkungen, die vor der Umsetzung entschieden gehören:

1. **Es muss für jede Zeile gelten.** #848 hat festgelegt, dass ornamentales Gold nie vom
   Zustand eines Datensatzes abhängen darf — sonst trägt Gold wieder zwei Bedeutungen
   neben der Lead-Rampe. „Night+Gold nur für ungelesene Zeilen" ist daher **keine**
   zulässige Abschwächung.
2. **Dichte.** Ein Night-Kreis im Panelkopf ist eine Signatur; zwanzig davon
   untereinander sind eine dunkle Spalte. Das braucht einen Blick bei 390px, bevor es
   gesetzt wird — nicht nur eine Token-Änderung.

Die Heute-Karte hat hier zusätzlich eine **Asymmetrie**: die Variante `needs` rendert ein
Icon (`:20060`), die Variante `resolved` rendert **gar keines** (`:20070`–`:20075`). Jede
Avatar-Entscheidung muss sagen, was mit `resolved` passiert.

### C2. 20px-Titel — richtig erkannt, dass er nicht passt

Im Panel ist der 20px-Name der Einstiegspunkt des ganzen Screens. In einer Liste ist der
Einstiegspunkt der Abschnittskopf, nicht jede einzelne Zeile. 20px pro Zeile würde die
Liste in eine Kartenfolge verwandeln.

*Vorschlag:* 14px → **15px**. Klein, aber es entsteht eine Leiter 15/13/12 statt der
heutigen 14/13/12, in der der grösste Text zwei Pixel über dem kleinsten liegt — exakt die
Kritik, die #848 am Panel behoben hat.

### C3. Newsreader in der Liste — nicht empfohlen

Der Vorschautext der Zeile ist ein auf 110 Zeichen gekürzter Auszug, keine „Stimme". Die
Serife dort würde mit dem Panel konkurrieren, die Scanbarkeit der Liste senken und den
Effekt entwerten, der im Panel gerade erst entstanden ist. Die Stimme sollte bleiben, wo
der ganze Text steht.

> **Nachtrag 2026-08-08:** die Frage hat sich erledigt — Newsreader ist aus dem
> Produkt entfernt. Die Empfehlung gilt unverändert für die Nachfolgerin: die
> Stimmenrolle `--vx-ui-voice-*` gehört nicht in die Liste, sondern dorthin, wo
> der ganze Text steht. Siehe `SANS_STIMMENROLLE_2026-08-08.md`.

### C4. Gold-Verlaufsstreifen — einmal pro Abschnitt, nicht pro Zeile

Im Panel ist der Streifen einmal pro Fläche sichtbar und wirkt als Signatur. Pro Zeile
wären es zwanzig pro Screen — dann ist es Dekoration, und das Argument aus #848
(„Gold als sichtbare Signatur, ohne zwei Bedeutungen") kippt.

*Vorschlag:* höchstens einmal je Listenabschnitt, etwa über der „Braucht dich"-Kopfzeile —
oder in diesem Schritt gar nicht.

---

## Teil D — Vorgeschlagener Umfang für Schritt 2

Reiner Token-/CSS-Pass. Keine Änderung an Struktur, Spalten oder Interaktion.

1. Drei listen-eigene Tokens im Token-Owner ergänzen (Teil B).
2. `.vx-requests-title` und `.vx-handover-card-title` auf `--vx-ui-list-title-size` (15px).
3. Meta-Gewicht der beiden Familien auf 600 angleichen.
4. Avatar-Kreis beider Familien auf Night + Gold-Icon — **nur nach Freigabe von C1**,
   inklusive Entscheid zur `resolved`-Variante ohne Icon.
5. Gold-Streifen: nur nach Freigabe von C4.

Berührte Dateien: `customer-dashboard/index.html` (zwei CSS-Blöcke, kein JS),
`customer-dashboard/shared/customer-design-tokens.css`.

Nicht berührt: die sechs toten Bauer, der Audio-Player, das Panel, die Glocke.

---

## Teil E — Offene Entscheidungen vor der Umsetzung

| # | Frage | Empfehlung |
|---|---|---|
| 1 | Avatar: Icon behalten und Kreis auf Night+Gold, oder Avatar unangetastet lassen? | Night+Gold, aber erst nach Sichtprüfung bei 390px |
| 2 | Was passiert mit der `resolved`-Karte, die heute gar kein Icon hat? | Icon ergänzen, sonst bleibt die Asymmetrie sichtbar |
| 3 | Titelgrösse 15px, oder bei 14px bleiben? | 15px |
| 4 | Gold-Streifen pro Abschnitt, oder in diesem Schritt gar nicht? | in diesem Schritt gar nicht |
| 5 | Die sechs toten Bauer entfernen? | eigener Auftrag, nicht hier |

---

## Was zum Zeitpunkt der Diagnose unverifiziert war

* Die Diagnose war statisch am Quelltext geführt. Die Dichtewirkung von mehreren
  Night-Kreisen (C1) und die Wirkung von 15px gegenüber 14px (C2) waren Sichtfragen —
  inzwischen im Browser geprüft, siehe Teil F.
* Dass die sechs Bauer tot sind, ist über Container-Existenz und die
  `display:none !important`-Regel belegt. Nicht geprüft ist, ob eine andere Fläche
  (z.B. ein Deep-Link oder ein Debug-Schalter) einen dieser Abschnitte doch einblendet.

---

## Teil F — Umsetzung (2026-08-08, im Anschluss an die Freigabe)

Alle fünf Entscheidungen aus Teil E ohne Abweichung übernommen.

### F1. Token-Ebene (`customer-design-tokens.css`)

Drei neue, listen-eigene Tokens statt Änderung am geteilten `--vx-ui-row-*`-Satz
(Begründung: Teil B). `--vx-ui-list-title-size: 15px`, `--vx-ui-list-avatar-bg: var(--vx-color-night, #0D1F3C)`,
`--vx-ui-list-avatar-color: var(--vx-color-gold)`. Für das Meta-Gewicht war kein neues
Token nötig — `--vx-ui-section-label-weight: 600` existierte bereits und ist exakt die
Panel-Rolle „Label/Meta 12px/600".

### F2. Anfragen-Zeile (`.vx-requests-*`)

* `.vx-requests-icon` / `.vx-requests-icon.is-call`: Hintergrund/Farbe von
  `--vx-ui-row-icon-bg/-color` auf `--vx-ui-list-avatar-bg/-color` — Night-Kreis,
  Gold-Icon, unconditional (auch `is-call`).
* `.vx-requests-title`: `font-size` auf `--vx-ui-list-title-size`. Farbe und Gewicht
  bleiben am geteilten `--vx-ui-row-title-color/-weight`.
* `.vx-requests-time`, `.vx-requests-company`, `.vx-requests-meta`: `font-weight` neu
  auf `--vx-ui-section-label-weight` (vorher 400/unset). Grösse bleibt
  `--vx-ui-row-time-size`.

### F3. Heute-Karten (`.vx-handover-card-*`)

Dieselben drei Änderungen an `.vx-handover-card-icon`, `.vx-handover-card-title`,
`.vx-handover-card-time`. Zusätzlich (Entscheidung 2): die `resolved`-Variante von
`vxHeuteHandoverCardHtml()` bekam dieselbe `.vx-handover-card-body`/`.vx-handover-card-icon`-Struktur
wie `needs` — vorher hatte sie gar kein Icon-Element. Gleiches Icon (`ph-phone`) wie
bei `needs`: es benennt den Datensatztyp (Anruf), nicht den Status: der Status steht
bereits im Abschnittskopf und in der reduzierten Deckkraft der Karte
(`.vx-handover-card--resolved { opacity:.72; }`, unverändert).

### F4. Nicht angefasst (wie in Teil D/E festgelegt)

Kein Gold-Verlaufsstreifen pro Zeile/Abschnitt. Die sechs toten Renderer aus Teil A
unverändert. `.vx-dv2-action-icon`/`-title` im Panel und `.vx-audio-modern__*` bleiben
auf dem geteilten `--vx-ui-row-*`-Satz — verifiziert per Test (F6).

### F5. Sichtprüfung (offene Punkte aus Teil E jetzt geschlossen)

Playwright gegen die echte `index.html`, über einen lokalen Static-Server (Root-relative
Pfade wie `/shared/customer-design-tokens.css` brechen unter `file://`), mit
Preview-Overlay (`#vx-runtime-config-notice`) ausgeblendet und synthetischen Datensätzen
in `vxHeuteHandoverCardHtml()` / `renderAnrufeInbox()` gerendert, bei 390/520/880px:

* **C1 (Dichte):** drei bis vier Night-Kreise untereinander (Heute: 3 „Braucht dich" +
  1 „Hat sich erledigt"; Anfragen: 4 Zeilen) lesen sich als wiederkehrende Signatur, nicht
  als dunkle Spalte. Computed Style bestätigt an allen drei Zeilenarten identisch:
  `background-color: rgb(13, 31, 60)`, `color: rgb(232, 197, 71)`.
  Die `resolved`-Karte trägt jetzt denselben Kreis wie `needs` (vorher keiner).
* **C2 (15px-Titel):** kein Umbruch, keine abgeschnittenen Namen an keiner der drei
  Breiten.
* Das Phosphor-Icon-Glyph selbst (`ph-phone`) blieb in den Screenshots unsichtbar, weil
  diese Sandbox keinen Netzwerkzugriff auf `unpkg.com` (Icon-CDN) hat — Kreisfarbe und
  -form sind davon unabhängig und über `getComputedStyle` bestätigt. In einer echten
  Umgebung mit geladenem Icon-Font ist das Telefon-Symbol in Gold sichtbar.

### F6. Tests

* `customer-dashboard/tests/list-panel-token-alignment.test.cjs` (12 neue Fälle): Token-
  Existenz, beide Zeilenfamilien auf den neuen Tokens, **kein** Kollateralschaden am
  Panel (`.vx-dv2-action-*`) oder am Audio-Player (`.vx-audio-modern__*`), Kontrast
  Gold-auf-Night (≥3:1 für Nicht-Text), `resolved`-Karte trägt jetzt ein Icon, kein
  Gold-Verlaufsstreifen pro Zeile, Anfragen-Zeile behält ihr Typ-Icon (keine IA-Änderung).
* `scripts/verify-anfragen-list-row-polish.mjs` erweitert: die alte Invariante „Karten-Icon
  zieht die ruhige Icon-Farbe" (Abschnitt 5) war der direkte Gegensatz zur neuen
  Entscheidung und wurde durch die neue Invariante „Night+Gold, EIN Token-Paar,
  unconditional" ersetzt — nicht stillgelegt, sondern umgeschrieben. Neuer Abschnitt 6
  prüft Titelgrösse, Meta-Gewicht und die `resolved`-Icon-Ergänzung strukturell.
* Workflow `verify-anfragen-list-row-polish.yml`: Pfade um die Token-Datei und die neue
  Testdatei ergänzt, neuer `node --test`-Schritt.
* Vollständige Suite: 107/107 grün (vorher 95). Alle fünf zuvor geprüften Verifier
  weiterhin grün: `verify-anfragen-list-row-polish`, `verify-customer-detail-consolidation`,
  `verify-customer-design-foundation`, `verify-customer-actions`,
  `audit-customer-runtime-reachability`.

### F7. Geänderte Dateien

`customer-dashboard/index.html` (zwei CSS-Blöcke: `.vx-requests-*`, `.vx-handover-card-*`;
ein JS-Block: `resolved`-Variante von `vxHeuteHandoverCardHtml()`),
`customer-dashboard/shared/customer-design-tokens.css` (drei neue Tokens),
`scripts/verify-anfragen-list-row-polish.mjs` (Invariante ersetzt, neuer Abschnitt),
`customer-dashboard/tests/list-panel-token-alignment.test.cjs` (neu),
`.github/workflows/verify-anfragen-list-row-polish.yml` (Pfade + Testschritt).

Kein JS ausserhalb der `resolved`-Icon-Ergänzung, keine Struktur-/IA-Änderung, keine
Migration.
