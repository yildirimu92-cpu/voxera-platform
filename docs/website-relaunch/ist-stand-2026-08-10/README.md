# Archivkopie voxera.ch — Stand 10.08.2026

Die Originaldateien der Live-Seite, unverändert wie geliefert. **Nichts hier wird bearbeitet.**
Dies ist die Sicherung aus Schritt 1 — sie existiert, damit die bisherige Arbeit nicht
verlorengeht, wenn Design und Struktur sich ändern.

| Datei | Was es ist | Grösse |
|---|---|---|
| `index.html` | Startseite — One-Pager mit allen Sektionen (Anker `#wie`, `#features`, `#demo`, `#branchen`, `#preise`, `#beratung`, `#kontakt`) | 252 KB |
| `impressum.html` | Impressum | 10 KB |
| `offer-accept.html` | **Transaktionsseite** — Offerte annehmen und digital unterzeichnen (`?token=…`) | 37 KB |
| `netlify.toml` | Deploy-Konfiguration: Header, Rewrites, Catch-all | 841 B |
| `agb.html` | AGB — **in unterzeichneten Verträgen referenziert** | 10 KB |
| `datenschutz.html` | Datenschutzerklärung v2.0 — **in Verträgen referenziert**, inhaltlich der wichtigste Text | 28 KB |
| `contract-signed.html` | **Transaktionsseite** — Ansicht des unterzeichneten Vertrags | 20 KB |
| `_redirects` | dupliziert wortgleich die drei Rewrites aus `netlify.toml` (siehe Befund C19) | 85 B |

## Beim Relaunch wortgleich zu übernehmen

`agb.html`, `datenschutz.html` und `impressum.html` sind in unterzeichneten Verträgen
referenziert. **Der Rechtstext wird nicht neu getextet** — nur die Hülle erneuert. Ausnahme:
die im Content-Audit benannten inhaltlichen Korrekturen (C23 Arbeitsversions-Hinweis,
C24 Löschfristen, C25 Zusagen, C26 UID) — das sind aber Änderungen am Text durch den
Betreiber, nicht durch den Relaunch.

## Noch nicht gesichert

- **Vollständige Dateiliste des Deploys** — ohne sie lässt sich nicht ausschliessen, dass
  weitere Seiten existieren. Bei `offer-accept.html` war genau das der Fall: sie war vorher
  nirgends dokumentiert. Blockiert die vollständige Redirect-Karte.
- Bild-Assets: `favicon.svg`, `favicon.ico`, `favicon_16/32.png`, `apple-touch-icon.png`,
  `og-image.png`
