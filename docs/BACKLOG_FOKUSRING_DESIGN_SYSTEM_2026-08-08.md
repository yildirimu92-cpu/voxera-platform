# Backlog: der Fokusring des Design-Systems ist global ausgeschaltet

**Status:** vorgemerkt, bewusst nicht umgesetzt.
**Gefunden:** 08.08.2026, beim Codex-Review zu PR #850 (Etappe 5, Audio-Player).
**Warum nicht dort behoben:** die Regel trifft jeden Knopf und jedes Eingabefeld
im Customer Dashboard. Ob Fokus künftig wieder über eine `outline` angezeigt
wird, ist eine Entscheidung für das Design-System und keine, die an einer
einzelnen Komponente getroffen werden sollte.

---

## Der Befund

Das Design-System definiert einen eigenen Fokusring:

```css
/* shared/customer-design-system.css:30 */
--vx-focus-ring: rgba(26, 111, 232, 0.24);

/* shared/customer-design-system.css:73 */
body.vx-customer-design-foundation
:where(button, [role="button"], a, input, select, textarea):focus-visible {
  outline: 3px solid var(--vx-focus-ring);
  …
}
```

Dieser Ring kommt nie zur Anwendung. In `index.html` steht unter der
Überschrift „7. FOCUS-RING EINHEITLICH":

```css
/* customer-dashboard/index.html:32259 */
.btn:focus-visible,
button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible {
  outline: none !important;
  box-shadow: 0 0 0 3px rgba(26,111,232,.18) !important;
}
```

`!important` schlägt jede Spezifität. Die Fokusanzeige des ganzen Dashboards
ist damit **ein blauer Schein bei 18 % Deckkraft** — und `--vx-focus-ring`
ist toter Code.

## Warum das mehr ist als eine Stilfrage

Ein `box-shadow` in Blau bei 18 % Deckkraft setzt einen hellen Hintergrund
voraus. Auf jeder dunklen Fläche verschwindet er:

- der Night-Block des Audio-Players (Etappe 5),
- `.activation-panel--night` im Assistenten,
- die Night-Vollflächen, die als Abschluss-Aufrufe stehen,
- jede weitere dunkle Fläche, die noch dazukommt.

Gemessen im Browser (Chromium, 1280 px und 390 px) am Seek-Regler des
Players vor dem Gegenmittel: `:focus-visible` griff, `computed outline` stand
trotzdem auf `0px`. Tastaturbedienung war dort ohne sichtbare Position.

PR #850 hat sich für seine drei Bedienelemente einen weissen Ring
zurückgeholt (`outline: 2px solid #fff !important`, 15,3:1 auf Night). Das ist
ein örtliches Gegenmittel gegen einen globalen Reset — und genau die Art
Ausnahme, die sich vervielfacht, wenn die Ursache stehen bleibt. Jede weitere
dunkle Fläche bräuchte ihre eigene.

## Nebenbefund

`customer-dashboard/index.html:1466`

```css
.call-row:focus,.call-row:focus-visible{outline:none;}
```

Hier steht kein Ersatz daneben — die Zeile hat im Fokus überhaupt keine
Anzeige. Ob das noch eine aktive Fläche ist, wurde nicht geprüft.

## Was zu entscheiden wäre

1. **Zurück auf `outline`.** Den `!important`-Block auflösen und den Ring des
   Design-Systems wirken lassen. `--vx-focus-ring` bei `rgba(26,111,232,.24)`
   müsste auf Kontrast gegen alle Grundflächen geprüft werden — auf Night
   trägt er ebenso wenig wie der heutige Schein. Wahrscheinlich braucht es
   zwei Werte: einen für helle, einen für dunkle Flächen.
2. **Beim `box-shadow` bleiben,** aber deckend genug und mit einer benannten
   Variante für dunkle Flächen — dann ist das örtliche Gegenmittel aus PR #850
   durch eine Regel ersetzbar.
3. **Nichts tun** und pro dunkler Fläche eine Ausnahme schreiben. Für den
   Moment der Ist-Zustand; die Ausnahme aus PR #850 ist die erste.

Empfehlung: Variante 1 oder 2, zusammen mit einer Sichtprüfung über die
Tastatur auf Heute, Anfragen, Detail-Panel, Assistent, Einstellungen — hell
und dunkel. Der Umfang ist überschaubar, das Risiko liegt in der Breite: die
Regel greift überall.

## Nicht Teil dieses Auftrags

Die Ausnahme in PR #850 bleibt bestehen, bis hier entschieden ist. Sie ist im
Code als Ausnahme kommentiert und verweist auf den Reset.
