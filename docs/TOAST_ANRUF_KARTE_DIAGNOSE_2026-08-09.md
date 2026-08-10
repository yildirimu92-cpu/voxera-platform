# Diagnose: Toast-Erscheinungsbild dashboardweit + „Neuer Anruf"-Karte

**Datum:** 2026-08-09 · **Branch:** `claude/toast-ll32rf` · **Status: Diagnose (Teil 1) ·
Umsetzung (Teil 2, freigegeben).**

Auftragsgrundlage: `briefing-live-anruf-toast.md`. Punkt 1 verlangt ausdrücklich, vor jedem
Eingriff zu klären, ob ein Fix am zentralen Renderer aus PR #902 reicht oder ob eigenständige
Komponenten danebenstehen. Das ist dieses Dokument.

Kennzeichnung: **Fakt** = gemessen oder im Code belegt · **Bewertung** = Einschätzung ·
**Unverifiziert** = nicht geprüft.

Messgrundlage: Playwright gegen einen echten HTTP-Server mit `customer-dashboard/` als Wurzel,
echtes `index.html`, echte Stylesheets. Breakpoints 1440×900 (wie im User-Screenshot) und
390×844. Skripte entfernt, weil der Auth-Boot sonst auf den Login umleitet; die acht
Stylesheets aus `customer-runtime-design-foundation.js` werden dabei genauso nachgeladen, wie
die Laufzeit es tut.

> **Methodenhinweis, weil er ein Zwischenergebnis gekippt hat:** `index.html` hat **kein
> `</head>`**. Ein erster Messlauf, der die Stylesheets dort einhängen wollte, lief still ohne
> sie durch und meldete „0 px Abstand zwischen Gruss und erster Karte" — das wäre als Befund
> genau die Beobachtung des Users gewesen und war reiner Attrappen-Fehler. Mit den echten
> Stylesheets sind es 28 px. Alle Zahlen unten stammen aus dem korrigierten Lauf.

---

## Kurzfassung — Antwort auf die Kernfrage des Briefings

**Beides trifft zu, und die beobachtete Instanz gehört zur zweiten Gruppe.**

1. Es gibt **einen** generellen Fehler im zentralen Renderer, der sich über **alle 162
   Aufrufstellen** auswirkt: die Tonalitätskante ist als einseitiger 3-px-Rahmen auf einer
   12-px-Rundung gezeichnet und rendert deshalb als **abgelöste Sichel neben der Karte**, nicht
   als Kante. Eine Korrektur an einer Stelle deckt den dashboardweiten Fund.
2. **Daneben stehen zwei eigenständige Komponenten**, die nicht durch den zentralen Renderer
   laufen: der **`#incoming-banner`** (das ist die vom User beobachtete „Neuer Anruf"-Karte) und
   ein **zweiter, kompletter Toast-Renderer im Admin-Portal** mit 109 Aufrufstellen, den die
   Bestandsaufnahme vom 09.08. übersehen hat.

Die Positionsbeschwerde ist **nicht** dieselbe Ursache wie die Optikbeschwerde. Sie sitzt allein
im `#incoming-banner` und ist schlimmer als gemeldet: es ist kein zu kleiner Abstand, es ist
eine **Überlappung**.

---

## 1. Bestandsaufnahme — wer erzeugt etwas, das wie eine Meldung aussieht

Vorgehen: alle `position:fixed`-Regeln in `customer-dashboard/index.html` durchgesehen und die
Modal-/Overlay-/Navigations-/Menü-/Splash-Familien ausgeschieden; dazu Aufrufzählung über beide
Portale.

| # | Komponente | Renderer | Läuft über #902? | Aufrufstellen |
|---|---|---|---|---|
| 1 | **`.toast`** | `toast(msg,type)` + Adapter `showToast()` — `index.html:16256` | **Ja — er *ist* der zentrale Renderer** | 129 `toast(` + 33 `showToast(` in `index.html`, 3 über Shared-Module |
| 2 | **`#incoming-banner`** | `showIncomingBanner(count,newRecords)` — `index.html:20023` | **Nein** — eigenes Markup (`7395`), eigenes CSS (`1344–1379`), eigener 8-s-Timer, eigene z-Stufe | 1 (Realtime-Eingang) |
| 3 | **`#live-call-row`** | `updateLiveHero(records)` — `index.html:17408` | Nein, aber **kein Overlay** — Karte im Fluss in `#dash-live-ambient` | 1 |
| 4 | **`.vx-notif-panel`** | Glocken-Popover — `index.html:301` | Nein — eigene Fläche, eigener Schatten | – |
| 5 | **Admin-Portal `#toast`** | `showToast(msg,duration)` — `admin-panel/index.html:14342` | **Nein — zweiter, vollständig eigener Renderer** | **109** (83 in `index.html`, 26 in `admin-panel/shared/*.js`) |

**Fakt — die beobachtete Karte ist Nr. 2, nicht Nr. 1 und nicht Nr. 3.** Belegt, nicht
abgeleitet: `#incoming-banner` ist die einzige Fläche im Produkt, die wörtlich „Neuer Anruf"
schreibt (`index.html:20030`) **und** den **Namen des Anrufers** in die Unterzeile setzt
(`getCallDisplayName(f)`, `index.html:20037`). Der `toast()` zeigt nie einen Anrufernamen;
`#live-call-row` zeigt den **Assistenten**namen. Die Beschreibung des Users — oben, rot
markiert, mit Name des Anrufers — passt auf genau eine der fünf. Damit ist die im Inventar vom
09.08. offen gebliebene Zuordnung („bleibt eine Bewertung aus Positionsdaten") jetzt belegt.

**Fakt — Nr. 5 ist eine Lücke der letzten Bestandsaufnahme.** `ZUSTANDSANZEIGEN_INVENTAR`
schloss „Admin-Portal … kein einziger `toast(`-Aufruf, faktisch nicht betroffen". Das stimmt für
`toast(` — das Admin-Portal ruft aber `showToast(` auf. Dieselbe Fehlerklasse wie die Lücke, die
sich der Wächter in Teil 3 selbst nachgewiesen hat: die Suche war auf einen Namen geeicht, nicht
auf die Sache.

---

## 2. Belegte Abweichungen

### 2A. Die Tonalitätskante rendert als abgelöste Sichel — gilt für alle 162 Aufrufstellen

**Fakt.** `.toast` (`index.html:1978`) und `.incoming-banner` (`1350`) zeichnen die Rollenfarbe
als `border-left:3px solid …` auf einer Fläche mit `border-radius:12px` und `0.5px` an den
übrigen Kanten. Über den Rundungsbogen läuft die Randstärke von 3 px auf 0.5 px zusammen. Das
Ergebnis ist bei 4-facher Vergrösserung eindeutig: eine **farbige Klammer, die neben der weissen
Karte steht**, mit sichtbarem weissem Spalt dazwischen — kein Kantenakzent, sondern ein Gebilde,
das wie ein Renderfehler aussieht. Beide Flächen tragen es, in allen fünf Tonalitäten.

**Bewertung: das ist die Hauptursache des dashboardweiten „passt nicht zum Look".** Es ist die
einzige Abweichung, die an *jeder* der 162 Aufrufstellen sichtbar wird, und sie liegt in **einer**
CSS-Deklaration.

**Fakt — das Produkt hatte diese Frage schon entschieden, einen Tag vorher.** Der Kommentar bei
`index.html:30070` hält fest, dass die Anfragen-Karte ihre Auswahl seit 2026-08-08 über einen
**umlaufenden** Rahmen markiert und dass „eine zusätzliche 3px-Kante links genau das einseitige
Muster wäre, das dort aufgelöst wurde". `.vx-requests-item.sp-active` (`6638`) setzt entsprechend
`border-color` umlaufend plus getönte Fläche, keine Kante. PR #902 hat die einseitige Kante am
09.08. auf den Toast neu eingeführt — gegen eine Regel, die 24 Stunden alt war.

### 2B. Position der „Neuer Anruf"-Karte — Überlappung, nicht zu wenig Abstand

**Fakt, gemessen bei 1440×900** (y-Werte, Viewport-Koordinaten):

| Element | von | bis |
|---|---|---|
| Appbar „Heute" | 24 | 88 |
| **Gruss „Guten Abend, …"** | **104** | **132** |
| Live-Anruf-Karte | 160 | 222 |
| Lara-Übergabe | 238 | 324 |
| **`#incoming-banner` (fixed)** | **96** | **163** |

Der Banner beginnt **8 px über** dem Gruss und endet **3 px unter** dem Oberrand der
Live-Anruf-Karte. Er liegt also **vollständig über der Grussformel** und schneidet in die Karte
darunter. Horizontal: x 706–966, während die Inhaltsspalte bei x 260 beginnt — deshalb liest
sich die Karte als „oben rechts".

**Fakt, 390×844:** Banner 76–163, Appbar „Heute" 74–138. Der Banner **verdeckt den
Bildschirmtitel vollständig** (siehe Screenshot).

**Fakt — Ursache.** `top:96px` (`index.html:1345`) ist ein absoluter Literalwert, der auf kein
Element der heutigen Anordnung zeigt. Die `.topbar`, gegen die er einmal bemessen war, ist seit
dem Patch vom 2026-05-13 `display:none!important` (`index.html:1236`). Ein fixierter Pixelwert
kann nicht wissen, wo der Inhalt beginnt — jede Änderung an Appbar-Höhe oder Screen-Inset
verschiebt die Überlappung, ohne dass jemand den Banner angefasst hätte.

**Fakt — der Abstand *im Fluss* ist dagegen in Ordnung.** `#dash-content` ist ein Grid mit
`gap:16px` (12 px mobil), der Gruss trägt zusätzlich `margin-bottom:12px`. Gruss → Live-Karte
sind 28 px, Live-Karte → Lara 16 px. **Die Rhythmik des Screens stimmt; nur die schwebende
Fläche steht ausserhalb davon.**

### 2C. Zwei Achsen, zwei Elevationen, eine Familie

**Fakt — Achse.** `.toast` steht auf `left:50%` (Viewport-Mitte, x-Mitte 720 bei 1440),
`#incoming-banner` auf `left:calc(232px + (100vw - 232px)/2)` (Mitte der Inhaltsfläche, x-Mitte
836). Zwei Flächen derselben Familie, 116 px auseinander. Der Toast wird dabei über die
232-px-Sidebar mitzentriert, obwohl dort kein Inhalt liegt.

**Fakt — Elevation.** `.toast` und `.incoming-banner` nutzen `--vx-shadow-lg`
(`0 12px 32px rgba(13,31,60,.08)`) — das ist die **Karten**stufe der Leiter. Eine über dem
Inhalt schwebende Fläche ist damit exakt so hoch wie eine ruhende Karte. Das Glocken-Popover
daneben trägt einen handgeschriebenen Wert (`0 16px 48px rgba(13,31,60,.18)`), der in keinem
Token steht. Der Tokensatz hat `--vx-shadow-lg` (Karte) und `--vx-shadow-modal` (Dialog) —
**eine Stufe für „schwebt über dem Inhalt" fehlt**, und die drei Flächen haben sich je selbst
beholfen.

**Fakt — Abstände.** `bottom:100px` (Toast) und `top:96px` (Banner) sind Literale; die
Breakpoint-Overrides `top:76px` / `top:68px` (`2233`, `2577`) ebenfalls. Kein benannter Wert.

### 2D. Der Banner liegt unter der Vollansicht — dieselbe Fehlerklasse, die der Toast schon hatte

**Fakt.** `#incoming-banner{z-index:9990}` ist ein roher Literalwert, der in der z-Leiter
(`index.html:174–203`) nicht vorkommt. Er liegt unter `--z-detail-fullscreen:10040`, unter
`--z-overlay:10200` und unter `--z-above-mobile-nav:10000`.

**Bewertung — Folge:** Ist eine Anfrage in der Vollansicht geöffnet, wird ein eingehender Anruf
unsichtbar gemeldet. Das ist wortwörtlich der Fehler, den die z-Leiter beim Toast bereits
benennt und behoben hat („Vorher lag er auf 9000 und damit unter der Detail-Vollansicht … die
Bestätigung war dort unsichtbar", Kommentar bei `index.html:199`). Der Banner ist bei dieser
Korrektur nicht mitgezogen worden.

**Unverifiziert:** nicht in der laufenden Anwendung mit geöffneter Vollansicht nachgestellt; die
Ableitung ist Stapelreihenfolge zweier `position:fixed`-Elemente, beide direkt unter `body`.

### 2E. Admin-Portal — zweiter Renderer, Stand vor #902/#903

**Fakt, gemessen.** `admin-panel/index.html:15631`: dunkle Pille `rgb(15,23,42)`, weisse
13-px-Schrift, Radius 10 px, Schatten `0 8px 24px rgba(0,0,0,.15)`, **keine Tonalität, kein
Icon, keine Rolle** — die Signatur ist `showToast(msg, duration)`, eine Farbrolle ist gar nicht
vorgesehen. Die Tonalität tragen stattdessen `✓`- und `⚠`-Zeichen **im Meldungstext** — genau
das Muster, das PR #903 auf der Kundenseite an 23 Stellen entfernt hat.

**Bewertung:** Das ist die letzte dunkle Vollton-Meldefläche der Plattform und ein vollständiges
Zweitsystem. Ob es zu „dashboardweit" gehört, ist eine Scope-Frage an den Auftraggeber (siehe
offene Entscheidungen) — der User hat die Beobachtung auf dem Kunden-Dashboard gemacht.

### 2F. Kein Stapelmodell

**Fakt.** Ein `#toast`-Knoten, ein `#incoming-banner`-Knoten. Zwei Toasts kurz nacheinander:
der zweite überschreibt den Text des ersten und setzt den Timer zurück, ohne Aus-/Einblendung.
Zwei gleichzeitige Anrufe: der Banner fasst korrekt zu „2 neue Anrufe / Zum Anzeigen tippen"
zusammen, die Live-Karte zu „*[Name]* führt gerade 2 Gespräche". **Die Zusammenfassung ist
richtig und soll bleiben** — offen ist nur das harte Überschreiben im Toast.

**Fakt.** `#live-call-row` blendet über `liveRowEnter .3s` ein, wird beim Auflegen aber per
`existing.remove()` hart entfernt (`index.html:17417`) — Ein- und Ausblenden sind unsymmetrisch.

### 2G. Nebenbefund, nicht Teil dieses Auftrags

**Fakt.** `#tab-dashboard` nutzt `.vx-page-wrap` (`max-width:860px`) **nicht**; die Karten auf
Heute laufen bei 1440 px über die volle Inhaltsbreite von 1152 px. Das „Live"-Abzeichen der
Live-Karte steht dadurch rund 700 px von seinem Text entfernt am rechten Rand. **Bewertung:**
das betrifft jede Karte auf Heute gleichermassen, nicht die Live-Karte im Besonderen, und ist
eine Entscheidung über die Lesebreite des Screens — eigener Auftrag, nicht hier mitentscheiden.

---

## 3. Zielbild-Vorschlag

### 3.1 Grundform aller schwebenden Meldungen

- **Die einseitige Kante entfällt ersatzlos.** Die Tonalität bleibt auf **zwei** Trägern, wie
  #902 es verlangt — beide aber als geschlossene Form, ohne Rundungsartefakt:
  1. die Icon-Kachel (`--vx-toast-role-bg` / `--vx-toast-role`) — unverändert;
  2. der **umlaufende** Rahmen in der Rollenfarbe (`border:1px solid var(--vx-toast-role)`) —
     dieselbe Grammatik wie die ausgewählte Anfragen-Karte seit 2026-08-08.
  Fläche bleibt weiss (`--vx-ui-card-bg`), Text Night. Ohne Tonalität: Night-Rahmen, wie heute.
- **Neue Elevationsstufe `--vx-shadow-overlay`** zwischen Karte und Dialog. Genutzt von `.toast`,
  `#incoming-banner`, `.vx-notif-panel` und `.mobile-user-menu` — vier Flächen, die heute drei
  verschiedene Antworten geben.
- **Ein benanntes Abstandsmass `--vx-overlay-inset`** (16 px, mobil 12 px) statt `bottom:100px`
  / `top:96px` / `top:76px` / `top:68px`.
- **Der Banner zieht in die z-Leiter**, auf dieselbe Stufe wie der Toast. Damit ist ein
  eingehender Anruf auch über der Vollansicht sichtbar.

### 3.2 Eine einzige schwebende Meldungsspur

**Vorschlag:** Der „Neuer Anruf"-Hinweis hört auf, ein Sonderfall zu sein. Er ist inhaltlich ein
Toast mit Absenderzeile und Klickziel — er bekommt dieselbe Grundform, dieselbe Achse, dasselbe
Abstandsmass und dieselbe Elevation und zieht **nach unten in die Toast-Spur**. Sind beide
gleichzeitig sichtbar, stapeln sie mit `--vx-overlay-inset` Abstand.

Die Achse ist dabei die der **Inhaltsspalte** (der Wert, den der Banner heute schon richtig hat),
nicht die Viewport-Mitte; unter 768 px, wo die Sidebar entfällt, fallen beide zusammen.

Damit lösen sich in einem Zug: die Überlappung mit Gruss und Karte, der verdeckte Titel auf
Mobil, „oben rechts", die zwei Achsen, der Literalwert `top:96px` und die z-Stufe. Über dem
Lesebereich schwebt danach nichts mehr.

**Alternative, falls das nicht gewünscht ist:** Der Banner wird zum ersten Block **im Fluss** der
Inhaltsfläche (sein Markup liegt bereits dort, `index.html:7395` — nur `position:fixed` hebt ihn
heraus). Dann kann er nichts mehr überlappen und erbt die 16-px-Rhythmik. Preis: er schiebt den
Inhalt beim Erscheinen um ~67 px nach unten und steht über dem Bildschirmtitel. **Empfehlung:
Spur, nicht Fluss** — der Hinweis verschwindet nach 8 Sekunden von selbst, und was nach acht
Sekunden geht, sollte kein Layout verschieben. Die dauerhafte Aussage zum laufenden Gespräch
macht bereits die Live-Karte im Fluss.

### 3.3 Live-Anruf-Karte im Speziellen

- **Fläche, Abzeichen, Avatar und Abstand bleiben, wie sie sind** — geprüft, nicht angenommen:
  die Karte liegt in der Stack-Rhythmik (28 px zum Gruss, 16 px zur Lara-Übergabe), auf
  `--vx-ui-row-*`, Avatar Night, Abzeichen `--vx-color-danger`. **Kein Eingriff.** Was der User
  als „kein Abstand zur Begrüssungskarte" gesehen hat, war der darüberliegende Banner, nicht
  diese Karte.
- **Mehrere gleichzeitige Live-Anrufe:** Regel bleibt *zusammenfassen, nie stapeln* — eine Karte
  mit Zähler. Gilt gleichermassen für den Banner („2 neue Anrufe").
- **Ein-/Ausblenden wird symmetrisch:** Ausblenden mit derselben Dauer und Kurve wie
  `liveRowEnter`, statt den Knoten hart zu entfernen.
- **Toast-Ablösung:** ein neuer Toast, der einen sichtbaren ablöst, blendet den alten aus und den
  neuen ein, statt den Text unter dem Leser auszutauschen.

---

## 4. Offene Entscheidungen — Rückfrage statt Annahme

| # | Frage | Empfehlung |
|---|---|---|
| 1 | Spur oder Fluss für den „Neuer Anruf"-Hinweis (3.2)? | **Spur** |
| 2 | Rollenfarbe als umlaufender Rahmen — oder als getönte Fläche (`--vx-toast-role-bg` flächig, Rahmen neutral)? | **Rahmen.** Getönte Fläche würde fünf verschiedene Kartenfarben ins Produkt bringen. |
| 3 | Admin-Portal (109 Aufrufstellen, 2E) mitziehen? | **Eigener Folgeauftrag.** Gehört gemacht, aber es ist ein zweites Portal und verdoppelt Umfang und Prüffläche dieses Auftrags. |
| 4 | Lesebreite des Heute-Screens (2G)? | **Nicht hier.** Eigener Auftrag, betrifft alle Karten. |

---

## 5. Was diese Diagnose nicht belegt

- **Kein echter Anrufzustand.** Gemessen wurde gegen das echte `index.html` mit echten
  Stylesheets, die Zustände sind aber gesetzt, nicht durch einen echten Realtime-Eingang
  ausgelöst.
- **Der z-Index-Befund (2D) ist code-gelesen**, nicht mit geöffneter Vollansicht nachgestellt.
- **Der User-Screenshot liegt nicht vor.** Die Zuordnung auf `#incoming-banner` stützt sich auf
  drei zusammenpassende Merkmale (Wortlaut „Neuer Anruf", Anrufername in der Unterzeile,
  gemessene Position über dem Gruss) und auf die nachgestellte Ansicht — nicht auf einen
  Bildabgleich.
- **Nicht angefasst, wie im Briefing verlangt:** Make, die E-Mail-Vorlagen und Szenario 09.

---
---

# Teil 2 — Umsetzung

Freigabe vom 09.08.: Spur-Ansatz für den Anruf-Hinweis, Kante entfällt zugunsten der zwei
geschlossenen Träger, Admin-Portal bleibt draussen (eigener Folgeauftrag), beide Nebenfunde
mit abdecken.

## Was geändert wurde

### Grundform — die Kante entfällt

- **`.toast` und `.incoming-banner` tragen die Rollenfarbe jetzt umlaufend** (`border:1px solid`)
  statt als 3-px-Kante links. Zwei Träger bleiben es — Rahmen und Icon-Kachel —, beide jetzt
  geschlossene Formen. Damit ist die Klammer weg, und die Toasts folgen derselben Grammatik, auf
  die sich die Anfragen-Karte am 2026-08-08 festgelegt hat.
- **Neues Token `--vx-shadow-overlay`** (`customer-design-tokens.css`), Zwischenstufe zwischen
  Karte und Dialog. `.toast` und `.incoming-banner` liegen jetzt darauf statt auf der
  Kartenstufe `--vx-shadow-lg`.

### Eine Spur statt zwei schwebender Flächen

- **Neu: `#vx-overlay-lane`.** Trägt Position, Achse, Abstand, Stapelung und z-Stufe für alle
  Meldungen, die über dem Inhalt erscheinen. Die Mitglieder positionieren sich nicht mehr selbst
  — das ist die Zusicherung, dass sie nicht wieder auseinanderlaufen.
- **Vier Pixelliterale sind weg** (`bottom:100px`, `top:96px`, `top:76px`, `top:68px`) und durch
  drei benannte Werte ersetzt: `--vx-overlay-axis`, `--vx-overlay-inset`,
  `--vx-overlay-lane-bottom`, je mit Breakpoint für Mobil und Mobil-Querformat.
- **Der Anruf-Hinweis ist aus `.content` heraus in die Spur gezogen** und steht dort über dem
  Toast (längerer Atem, Klickziel). Beide Flächen sind unsichtbar `display:none`, damit eine
  nicht sichtbare Meldung der anderen nicht den Platz wegnimmt.
- **Ein- und Ausblenden sind symmetrisch** (`vxOverlayShow()` / `vxOverlayHide()`). Vorher
  verschwanden beide hart.

### Nebenfund 1 — der Hinweis lag unter der Vollansicht

Die Spur liegt auf `--z-toast` (13060) statt auf dem rohen Literal 9990. **Mit Gegenprobe im
Browser belegt:** bei geöffneter Detail-Vollansicht (`z-index:10040`) liefert
`elementFromPoint()` auf der Mitte des Hinweises jetzt `#incoming-banner-text`; mit dem alten
Wert 9990 an derselben Stelle `#vx-detail-v2-fullscreen` — der Hinweis war dort tatsächlich
unerreichbar.

### Nebenfund 2 — die Live-Anruf-Karte

**Fläche, Abzeichen, Avatar, Text und Abstand sind unverändert** — gemessen, nicht behauptet:
alle Kastenwerte auf Heute stehen vorher wie nachher bei y 24/104/160/238 (Desktop). Geändert
ist nur das Verschwinden: die Karte blendet symmetrisch zu `liveRowEnter` aus, statt hart aus
dem DOM zu fallen.

Dabei fiel eine Falle auf, in die die Sichtprüfung zu PR #902 schon einmal gelaufen war: das
Aussehen der Karte hing **allein am ID-Selektor** `#live-call-row`. Das Ausblenden nimmt der
Karte die ID ab (sonst fände ein sofort folgender Anruf die abtretende Karte und patchte ihren
Text, statt eine neue zu bauen) — ohne zweiten Träger hätte sie mitten in der Animation ihr
komplettes Styling verloren. Die Regel trägt jetzt `#live-call-row, .vx-live-row`. Die
abtretende Karte bekommt zusätzlich `aria-hidden`, weil der Host eine `aria-live`-Region ist.

## Messwerte vorher / nachher (1440×900)

| | vorher | nachher |
|---|---|---|
| Appbar „Heute" | 24–88 | 24–88 |
| Gruss | 104–132 | 104–132 |
| Live-Anruf-Karte | 160–222 | 160–222 |
| Lara-Übergabe | 238–324 | 238–324 |
| **Anruf-Hinweis** | **96–163, x 706–966 — quer über Gruss und Karte** | **802–868, in der Spur** |
| Toast | 756–800, x-Mitte 720 | 824–868, x-Mitte 836 |

Beide sichtbar: Hinweis 742–808, Toast 824–868 — 16 px Abstand, gemeinsame Achse.
Mobil 390×844: Spur 12 px randbündig, Unterkante 764, Bottom-Nav ab 776 → 12 px Luft. Der
Bildschirmtitel „Heute" ist nicht mehr verdeckt. Mobil-Querformat 844×390: 20 px über der Nav.
Tablet 1024×768: Achse 628 (Mitte der Inhaltsfläche, Sidebar sichtbar), Unterkante 736.

Fünf Tonalitäten, gemessene Rahmen- und Kachelfarben: success `rgb(5,150,105)`, info
`rgb(26,111,232)`, warning `rgb(217,119,6)`, error `rgb(220,38,38)`, neutral `rgb(13,31,60)` —
jeweils mit der zugehörigen Kachel.

## Prüfstand

- **160/160 Dashboard-Tests grün** (3 neue in `live-call-lifecycle.test.cjs`: Ausblendphase,
  ein während der Ausblendung eintreffender Anruf, Klassen-Träger des Aussehens).
- **Verifier-Sweep 59/61.** Die zwei Ausfälle sind umgebungsbedingt und auf dem `main`-Stand
  identisch rot: `verify-db-security-invariants` (keine DB-Zugangsdaten gesetzt) und
  `verify-prompt-builder-version-bump` (keine gemeinsame Basis mit `origin/main` im flachen
  Klon).
- **`verify-zustandsanzeigen.mjs` um sechs Prüfungen erweitert:** keine einseitige Kante mehr,
  Overlay-Elevation, Spur trägt Position/Achse/z-Stufe, Mitglieder positionieren sich nicht
  selbst, beide hängen in der Spur und in dieser Reihenfolge, `top:96px` kehrt nicht zurück,
  Ein-/Ausblendhelfer bleiben, Live-Karte blendet aus, Klassen-Träger bleibt.
- **Gegenprobe: 13 gezielte Mutationen, 13/13 gefangen**, jede mit einer Meldung, die den
  Fehler benennt.
- **Laufzeitprobe im Browser** mit den echten Renderern (`toast()`, `showToast()`,
  `showIncomingBanner()`, `vxOverlayShow/Hide()` aus `index.html` extrahiert, nicht nachgebaut):
  Einblenden, Tonalitätswechsel bei Ablösung, gleichzeitige Anzeige mit 16 px Abstand,
  Ausblenden mit gemessener Zwischenopazität, Aufräumen der Klassen.
- **`?v=`-Bump** auf `customer-design-tokens.css` (`20260809-2` → `-3`), weil eine gemeinsam
  genutzte CSS-Datei angefasst wurde.

## Bewusst nicht mitgemacht

- **Admin-Portal** (109 Aufrufstellen, dunkle Pille ohne Tonalität) — eigener Folgeauftrag,
  wie freigegeben.
- **Lesebreite des Heute-Screens** (Befund 2G) — betrifft alle Karten, eigene Entscheidung.
- **Ablösung eines sichtbaren Toasts** blendet die Fläche neu ein, statt den alten Toast erst
  vollständig auszublenden und den neuen danach zu zeigen. Der Textwechsel unter dem Leser ist
  damit weg; ein echtes Nacheinander würde jede Meldung um 200 ms verzögern und alle 162
  Aufrufstellen betreffen. Bewusst so gelassen.
- **Make, E-Mail-Vorlagen, Szenario 09** — unangetastet.

## Nicht verifiziert

- **Kein echter Anrufzustand.** Gemessen wurde gegen das echte `index.html` mit echten
  Stylesheets und echten Renderfunktionen; ein echter Realtime-Eingang wurde nicht hergestellt.
- **Kein Klicktest in der laufenden Anwendung** — `handleIncomingBannerClick()` (Navigation ins
  Anfragen-Detail) lief nicht gegen echte Daten.
