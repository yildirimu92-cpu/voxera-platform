# Diagnose: Lesebreite des Heute-Screens bei grossen Desktop-Breiten

**Datum:** 2026-08-09 · **Branch:** `claude/heut-lesebreite-4g9c05` · **Status: Diagnose. Umsetzung erst nach Freigabe.**

Auftragsgrundlage: `briefing-heute-lesebreite.md`. Nebenfund aus der Toast-Diagnose (2G):
`#tab-dashboard` nutzt `.vx-page-wrap` (`max-width:860px`) nicht; die Karten laufen bei 1440 px
über die volle Inhaltsbreite. Offene Frage dort: bewusste Ausnahme oder übersehener Screen?

Kennzeichnung: **Fakt** = im Code belegt oder gemessen · **Bewertung** = Einschätzung ·
**Unverifiziert** = nicht geprüft.

Messgrundlage: Playwright gegen einen echten HTTP-Server mit `customer-dashboard/` als Wurzel,
echtes `index.html`, echte Stylesheets (dieselbe Methode wie in der Toast-Diagnose — Skripte
entfernt, `#app` und `#dash-content` manuell sichtbar geschaltet, weil sonst der Auth-Boot
blockiert). Breakpoints 1280×900, 1440×900, 1920×1080.

---

## Kurzfassung — Antwort auf die Kernfrage des Briefings

**Weder noch. Die Prämisse der Frage stimmt nicht.** `.vx-page-wrap` ist keine Komponente, die
„anderswo verwendet wird und auf Heute vergessen wurde" — sie wird **nirgends im Produkt auf ein
Element angewendet**, auch nicht dort, wo sie ursprünglich gedacht war. Es gibt also keinen
etablierten Screen, an dem Heute sich hätte orientieren müssen. Und: Heute ist **kein
mehrspaltiges Kartenraster**, das eine bewusst grössere Breite bräuchte — es ist ein
einspaltiger, vertikaler Block-Stack, strukturell derselbe Aufbau wie z. B. der Bericht-Tab. Die
Vermutung aus dem Briefing, Heute könne mit Live-Karte/Begrüssung/„Braucht dich" absichtlich
breiter angelegt sein, trägt nicht — dafür gibt es keine mehrspaltige Anordnung, die das
begründen würde.

---

## 1. `.vx-page-wrap` wird auf keinem Element im Produkt verwendet

**Fakt.** Grep über `customer-dashboard/index.html` nach `class="..vx-page-wrap"` (Markup, nicht
Selektor): **keine Treffer.** Die einzigen drei Vorkommen sind:

| Zeile | Was |
|---|---|
| `1326–1327` | die Basisdefinition `.vx-page-wrap{max-width:860px;width:100%;}` + Mobil-Override |
| `4921` | `#anrufe-split-right #call-detail-scroll-wrap .vx-page-wrap{padding:0;max-width:none;}` |
| `35632` | `body.vx-requests-focus-mode … #call-detail-scroll-wrap .vx-page-wrap{width:100%!important;max-width:1080px!important;…}` |

Beide Override-Regeln zielen auf ein `.vx-page-wrap`-Kind **innerhalb** von
`#call-detail-scroll-wrap` (Anfragen-Detailbereich) — dort wird aber ebenfalls kein Element mit
dieser Klasse gerendert (`grep` über alle `.js`-Dateien und `index.html`: keine
`classList.add`/`className`-Zuweisung, kein weiteres Markup-Vorkommen im ganzen Repo). Die drei
Regeln kamen alle **am selben Tag** in die Codebasis (`git log -S vx-page-wrap`: erster Commit
Sa. 08.08., 15:09 Uhr — derselbe Tag wie die Toast-Arbeit aus PR #902/#908) und sind seither
unverändert mitgeführt worden, ohne dass ihr Ziel-Element je entstanden ist.

**Bewertung.** Das ist keine Design-Entscheidung „Heute ist die Ausnahme" — `.vx-page-wrap` ist
**verwaistes Gerüst**: eine am 08.08. begonnene, nie fertig verdrahtete Lesebreiten-Komponente.
Die Override-Regeln bei `4921` und `35632` deuten darauf hin, dass sie ursprünglich für den
Anfragen-Detailbereich gedacht war, dort aber ebenfalls nie ankam. Der Heute-Screen wurde also
nicht „vergessen", während andere Screens die Komponente bereits nutzen — die Komponente wird
schlicht von niemandem genutzt.

## 2. Heute-Screen ist einspaltig, kein Kartenraster

**Fakt.** `#dash-content` trägt `class="vx-ap-stack vx-report-stack"`.
`.vx-report-stack{display:grid;gap:16px;min-width:0;}` — eine implizite Ein-Spalten-Grid (kein
`grid-template-columns`). Alle sichtbaren Blöcke sind Vollbreite-Sections in dieser einen Spur:
Begrüssungszeile (`#dash-personal-greeting`), Live-Ambient-Hinweis, Lara-Zusammenfassung
(`.vx-lara-message`, `display:flex` — Avatar + Text, keine Mehrspaltigkeit), „Braucht dich"
(`.vx-handover-rail{display:flex;flex-direction:column}`) und „Hat sich erledigt"
(`.vx-handover-cards{display:flex;flex-direction:column}`). Das früher vorhandene KPI-Kachel-Grid
(`#dash-kpi-strip`, `.vx-ap-grid`, das einzige tatsächliche Mehrspalten-Element im Screen) ist seit
der Lara-Übergabe fest `display:none!important` — **abgeschaltet, nicht mehr Teil des
Screens.**

**Bewertung.** Die im Briefing erwogene Möglichkeit — Heute mehrspaltig gedacht, daher bewusst
breiter — trifft nicht zu. Der einzige Screen-Bereich, der je mehrspaltig war, ist stillgelegt.
Was heute läuft, ist strukturell derselbe einspaltige Card-Stack wie `tab-auswertung`
(`.vx-report-stack`, dieselbe Klasse, dasselbe `display:grid;gap:16px`) — der aber ebenso wenig
`.vx-page-wrap` trägt. Es gibt in der laufenden Anwendung **keinen Screen**, der die Komponente
aktiv nutzt und als Vergleichsmassstab dienen könnte.

## 3. Gemessen: die Breite wächst linear mit dem Viewport, ungebremst

**Fakt, live gemessen** (Inhaltsspalte, `#dash-content`, Sidebar-Kante bei x=260):

| Viewport | linke Kante | rechte Kante | Breite |
|---|---|---|---|
| 1280 px | 260 | 1252 | **992 px** |
| 1440 px | 260 | 1412 | **1152 px** |
| 1920 px | 260 | 1892 | **1632 px** |

Bei 1920 px — heute nicht Teil der Beschwerde, aber ein gängiger Desktop-Wert — ist die Spalte
**1632 px** breit, fast doppelt so breit wie bei 1280 px. Kein Block auf dem Screen setzt einen
eigenen `max-width` (geprüft: `.vx-lara-message`, `.vx-handover-section`, `.vx-heute-greeting` —
keine der Regeln enthält `max-width`). Laras Zusammenfassungstext, die Zeilen unter „Braucht
dich"/„Hat sich erledigt" und die Begrüssungszeile laufen alle auf die volle gemessene Breite.

**Bewertung.** Es betrifft nicht nur „Laras Zusammenfassungstext" isoliert — jede Zeile auf dem
Screen ist gleichermassen ungebremst, weil keine von ihnen einen eigenen Deckel hat. Eine
Lösung, die nur den Lara-Text einfasst, würde die Begrüssungszeile, die Handover-Zeilen und den
Ambient-Hinweis unbehandelt lassen, obwohl sie identisch betroffen sind.

---

## 4. Zielbild-Vorschlag

**Vorschlag: `.vx-page-wrap` auf `#dash-content` selbst anwenden** — der ganze Screen bekommt die
Lesebreite, nicht einzelne Textblöcke.

Begründung:
- Heute ist ein einspaltiger Stack aus Zeilen/Karten mit Avatar+Text+Badge-Mustern
  (Handover-Rail-Einträge), keine Fläche mit unabhängigen Spalten, die unterschiedliche Breiten
  bräuchten. Eine screenweite Kapselung ist daher die einfachste Regel, die konsistent mit dem
  Aufbau ist — kein Flickenteppich aus Einzelblock-Ausnahmen.
- Es gibt keinen Gegenbeweis in Form eines anderen Screens, der die volle Breite bewusst nutzt:
  `.vx-page-wrap` wird aktuell nirgends genutzt, also entscheidet dieser Auftrag de facto die
  erste tatsächliche Anwendung der Komponente — nicht eine Abweichung von etwas Etabliertem.
- Damit die Komponente das leistet, muss sie zuerst tatsächlich verdrahtet werden: ein
  `vx-page-wrap`-Div um `#dash-content` (oder die Klasse direkt auf `#dash-content`, falls das
  Grid-`display` sich mit der Wrap-Klasse verträgt — das würde ich beim Bauen gegen die
  bestehende CSS-Kaskade prüfen, insbesondere gegen `.vx-report-stack{display:grid}`, das nicht
  überschrieben werden darf).

**Alternative, falls nicht gewünscht:** keine Änderung — die volle Breite bleibt, mit der
Begründung, dass ein Dashboard-Screen traditionell die Breite ausnutzen darf, auch ohne
Mehrspaltigkeit. Dagegen spricht das Mass: 1632 px Zeilenlänge bei 1920 px ist weit ausserhalb
dessen, was fürs Lesen von Fliesstext (Lara, Begrüssung) noch sinnvoll ist, und auch
Avatar-Text-Badge-Zeilen wirken bei dieser Breite auseinandergerissen — genau das Muster, das die
Toast-Diagnose beim Live-Abzeichen schon einmal als Problem benannt hat (2G).

**Nicht vorgeschlagen:** nur einzelne Blöcke (z. B. nur `.vx-lara-message`) einfassen. Das würde
eine inkonsistente Breite pro Zeile erzeugen, obwohl der Screen strukturell einheitlich
einspaltig ist — siehe Abschnitt 3.

**Skalenfrage, unabhängig von dieser Diagnose:** falls `.vx-page-wrap` auf Heute gewirkt wird,
stellt sich dieselbe Frage für den `tab-auswertung`-Screen (identischer `.vx-report-stack`-Aufbau,
ebenfalls ohne Deckel) und für den nie fertig verdrahteten Anfragen-Detailbereich (Abschnitt 1).
**Bewusst nicht mitentschieden** — das wäre Scope-Erweiterung über den Auftrag hinaus; Rückfrage
an den Auftraggeber, ob das ein Folgeauftrag werden soll.

---

## 5. Nicht angefasst

Make, E-Mail-Vorlagen, Szenario 09, sowie alles, was laut Briefing parallel in anderen Chats
läuft (Aufräumen, Dashboard-Klicktest, kleinere Restfunde).

## 6. Nicht verifiziert

- Visuelles Erscheinungsbild nach einer Umsetzung (nicht gebaut, wie im Briefing verlangt).
- Verträglichkeit von `.vx-page-wrap` mit `.vx-report-stack{display:grid}` im Detail — nur
  benannt, nicht gegen echtes CSS getestet, weil noch keine Umsetzung freigegeben ist.
- Mobil-Verhalten unter 768 px war nicht Gegenstand der Messung (das Briefing verlangt nur
  Desktop-Breiten); die bestehende `@media(max-width:768px){.vx-page-wrap{max-width:100%}}`-Regel
  legt aber nahe, dass dort ohnehin keine Kappung gewünscht ist.
