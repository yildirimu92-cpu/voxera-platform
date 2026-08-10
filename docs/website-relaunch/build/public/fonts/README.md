# Schriften

Selbst ausgeliefert statt über das Google-Fonts-CDN. Grund: eine Verbindung weniger im
kritischen Renderpfad, und die Besucher-IP geht nicht bei jedem Seitenaufruf an Google —
auf einer Seite, die mit Datenschutz wirbt, ein unnötiger Widerspruch (Content-Audit C12).

| Datei | Schrift | Schnitt | Lizenz |
|---|---|---|---|
| `plus-jakarta-sans-700.woff2` | Plus Jakarta Sans | 700 (Display, h1–h3) | SIL Open Font License 1.1 |
| `dm-sans-400.woff2` | DM Sans | 400 (Fliesstext) | SIL Open Font License 1.1 |

Beide sind unter der **SIL Open Font License 1.1** veröffentlicht. Die erlaubt das
Mitliefern und Weiterverbreiten ausdrücklich, auch kommerziell — Bedingung ist, dass die
Schriften nicht als eigenes Produkt verkauft werden und der Lizenztext beiliegt:

- Plus Jakarta Sans — <https://github.com/tokotype/PlusJakartaSans> (Tokotype)
- DM Sans — <https://github.com/googlefonts/dm-fonts> (Colophon Foundry, Jonny Pinhorn)
- Lizenztext — <https://openfontlicense.org>

Bezogen am 10.08.2026 aus dem Google-Fonts-Bestand (latin-Subset).

## Warum nur zwei Schnitte

Jeder zusätzliche Schnitt kostet Ladezeit im kritischen Pfad. Die Seite braucht genau zwei:
Display in 700 für Überschriften, Fliesstext in 400. Halbfette Textstellen entstehen über
`font-weight: 700` auf der Display-Familie, nicht über einen dritten Schnitt.

Wer einen weiteren Schnitt ergänzt, muss ihn auch in `src/styles/fonts.css` deklarieren und
in `src/layouts/Base.astro` vorladen — sonst lädt er nach und erzeugt einen sichtbaren
Schriftwechsel beim Rendern.
