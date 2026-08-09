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

---

## Erledigt am 09.08.2026 — Variante 1, im Auftrag „Navigation Premium-Redesign"

Der `!important`-Block „7. FOCUS-RING EINHEITLICH" in `index.html` ist
aufgelöst. Zuständig ist wieder `shared/customer-design-system.css`.

Umgesetzt wurde Variante 1 mit der Ergänzung, die oben schon als
wahrscheinlich notwendig benannt war — **zwei Werte statt einem**:

```css
--vx-focus-ring: #1a6fe8;          /* helle Flächen */
--vx-focus-ring-on-dark: #ffffff;  /* Night-Flächen */
```

Der frühere Wert `rgba(26,111,232,.24)` ist gefallen: bei 24 % Deckkraft
war er auf Weiss eher zu ahnen als zu sehen und auf Night gar nicht.

Nur die **Farbe** kippt auf dunklen Flächen, nicht die Geometrie — der Ring
bleibt überall 3px mit 2px Abstand. Die dunklen Flächen sind namentlich
gelistet (`.sidebar`, `.mobile-nav`, `.vx-help-cta`,
`.activation-panel--night`), und für jede weitere gibt es
`[data-vx-surface="night"]` als vorgesehenen Weg. Damit braucht die nächste
dunkle Fläche keine eigene Ausnahme — genau die Vervielfachung, wegen der
dieser Punkt überhaupt als Backlog festgehalten wurde.

**Die Ausnahme aus PR #850 ist entfernt.** Sie war ausdrücklich als
Gegenmittel gegen den Reset kommentiert; mit dem Reset ist ihr Grund
weggefallen. Die drei Bedienelemente des Players tragen jetzt denselben Ring
wie jedes andere Bedienelement. *Ungeprüft:* der Player braucht Audiodaten
und liess sich in der Sandbox nicht rendern — die Sichtprüfung am Seek-Regler
steht aus.

**Nebenbefund erledigt:** `.call-row:focus,.call-row:focus-visible{outline:none}`
hatte im Fokus überhaupt keine Anzeige. Der Reset gilt jetzt nur noch für
`:focus` (Mausklick), `:focus-visible` bekommt den Ring des Systems.

### Was noch aussteht

Die Sichtprüfung über die Tastatur auf Heute, Anfragen, Detail-Panel,
Assistent und Einstellungen — hell und dunkel — ist **nicht** durchgeführt.
Gemessen sind bisher zwei Stellen im Browser: die Glocke in der Seitenleiste
und ein Eintrag der Tab-Leiste, beide mit weissem 3px-Ring auf Night. Die
Breite der Regel bleibt das Risiko, das oben beschrieben ist.
