# Sans-Stimmenrolle — Rücknahme der Serifen-Regel

**Datum:** 2026-08-08
**Betrifft:** Kunden-Dashboard (Heute, Anfrage-Detail, Bericht, Assistent)
**Löst ab:** „Serife = Stimme/Inhalt, Sans = Bedienelemente" aus
`CUSTOMER_REQUEST_DETAIL_CONSOLIDATION_2026-08-07`, `ETAPPE_6_BRIEFINGS_2026-08-08`,
`ASSISTENT_TAB_NORTH_STAR_2026-08-08`, `LISTEN_ANGLEICHUNG_DIAGNOSE_2026-08-08`

---

## Entscheidung

Das Kunden-Produkt ist **durchgehend Sans-Serif**. Die Newsreader-Serife entfällt
ersatzlos, inklusive Webfont-Ladung.

Was die Serife leistete, bleibt: die Stimme der Assistentin hebt sich weiterhin
vom übrigen UI-Text ab. Sie tut es ab jetzt über **Grösse, Gewicht und
Weissraum** statt über einen Schriftwechsel.

## Was vorgefunden wurde

Die Regel stand an sechs Stellen, nicht an den drei bekannten:

| Ort | Selektor | Vorher |
|---|---|---|
| Heute — Lara-Karte | `.vx-lara-text` | Serif 18px/400, LH 1.48 |
| Anfrage-Detail — Anliegen + Aufgabe (#848) | `.vx-dv2-concern`, `.vx-dv2-task-summary` | Serif 19px/400, LH 1.55, mobil 17px |
| Bericht — Laras Zusammenfassung (#851) | `.vx-report-voice .vx-ops-message` | Serif 19px/400, LH 1.55, mobil 17px |
| Assistent — Begrüssungssatz | `.vx-ap-hero-greeting` | Serif 20px/400, LH 1.55, mobil 18px |
| Heute — Leerzustand-Titel | `.vx-all-clear-title` | Serif 25px/600 |
| Heute — Avatar-Initiale „L" | `.vx-lara-avatar` | Serif 16px/600 |

Die letzten beiden waren keine Stimme, sondern Reste derselben Schrift an
Orten ohne eigene Aussage: eine Überschrift und ein einzelner Buchstabe.

Getragen wurde die Schrift von `--vx-font-serif`, doppelt definiert
(`customer-design-tokens.css` und lokal in `#dash-content`), plus vier
Newsreader-Schnitte im render-blockierenden Google-Fonts-Request.

## Die neue Rolle

`--vx-ui-voice-*` in `customer-design-tokens.css`, gezogen von allen vier
Stimmen-Orten:

| Token | Wert |
|---|---|
| `--vx-ui-voice-font` | `var(--vx-font-display)` — Plus Jakarta Sans |
| `--vx-ui-voice-size` | `20px` |
| `--vx-ui-voice-size-sm` | `18px` (≤560px) |
| `--vx-ui-voice-weight` | `500` |
| `--vx-ui-voice-leading` | `1.5` |
| `--vx-ui-voice-tracking` | `-.01em` |
| `--vx-ui-voice-color` | `var(--vx-ui-row-title-color)` |
| `--vx-ui-voice-measure` | `62ch` |

**20px** ist 1.54× Fliesstext (13px) — dieselbe Sprungweite, die die Serife
optisch hatte, und weit genug über der 15px-Titelstufe, dass keine vierte
Grösse zwischen 15 und 20 nötig wird. 22px wurde verworfen: auf 390px bleiben
in der Anliegen-Karte rund 30 Zeichen pro Zeile.

**Gewicht 500** trägt im ganzen Produkt sonst kein Element — Titel stehen auf
700, Karten- und Abschnittsköpfe auf 600, Fliesstext auf 400. Die Stimme
bekommt damit ein eigenes Gewicht statt eines geliehenen. Plus Jakarta Sans
auf 400 wirkt bei 20px auf Weiss dünn und verliert genau die Präsenz, für die
die Serife da war.

**Zeilenhöhe 1.5** statt 1.55: Sans braucht bei gleicher Grösse etwas weniger
Durchschuss als Newsreader.

**`measure`** begrenzt die Zeilenlänge. Im breiten Detail-Panel und im Bericht
liefe der Text sonst randlos durch — der Weissraum ist der Teil, der die
Abhebung nach dem Wegfall der Serife mitträgt.

Die Rolle stuft produktweit an derselben Stelle ab (560px), damit Lara-Karte,
Panel, Bericht und Assistent-Hero auf einem Gerät nie in zwei verschiedenen
Stimmengrössen stehen. Die übrige Leiter des Detail-Panels stuft weiterhin
erst auf 430px.

## Die beiden Nicht-Stimmen

- `.vx-all-clear-title` → `var(--vx-font-display)` 22px/700, `-.01em`. Der
  Leerzustand ist ein Satz der Oberfläche über sich selbst, keiner von Lara.
  25 → 22px, weil Sans bei gleicher Punktzahl grösser wirkt als die Serife.
- `.vx-lara-avatar` → Sans 15px/700, damit identisch mit `.vx-dv2-avatar` im
  Detail-Panel.

## Wächter

`verify-customer-design-foundation.mjs` prüft ab jetzt drei Dinge:

1. Der Token-Satz enthält die Rolle vollständig, inklusive `weight: 500`.
2. Keine der fünf Kunden-Dateien enthält eine Serifen-**Deklaration**:
   `--vx-font-serif` (Definition oder `var()`), `'Newsreader'` in
   Anführungszeichen, `family=Newsreader` im Webfont-Request oder eine
   `font-family`, die auf `serif` endet (`sans-serif` ausgenommen).
   Geprüft wird die Deklaration, nicht das Wort — die Kommentare, die den
   Wechsel erklären, dürfen die abgelöste Serife im Fliesstext nennen.
3. Jeder der vier Stimmen-Orte zieht Schrift, Grösse, Gewicht **und**
   Zeilenhöhe aus der Rolle. Ein Ort, der nur die Grösse übernimmt und den
   Rest selbst setzt, driftet als erster wieder heraus.

## Nebeneffekt

Der Google-Fonts-Request lädt vier Schnitte weniger. Newsreader war die
einzige Schriftfamilie im kritischen Pfad, die nur an sechs Textstellen
gebraucht wurde.
