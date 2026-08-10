# Website-Neukonzeption voxera.ch — Rückmeldung Schritt 1–3

**Datum:** 10.08.2026 · **Status:** Zielbild besprochen, erste Entscheidungen getroffen.
**Es wurde nichts gebaut.**

Grundlage: `briefing-website-neukonzeption.md` und der Nachtrag
`briefing-website-seo-addendum.md`.

| Dokument | Inhalt | Status |
|---|---|---|
| [`01_IST_AUFNAHME_2026-08-10.md`](01_IST_AUFNAHME_2026-08-10.md) | Schritt 1 — Sicherung der Live-Seite | ⚠️ **blockiert**, Auflösung zugesagt (ZIP) |
| [`02_CONTENT_AUDIT_2026-08-10.md`](02_CONTENT_AUDIT_2026-08-10.md) | Schritt 2 — 15 Befunde, gegen den echten Stack geprüft | vollständig für die bekannten Aussagen |
| [`03_ZIELBILD_2026-08-10.md`](03_ZIELBILD_2026-08-10.md) | Schritt 3 — Sitemap, SEO & Content-Struktur, Design, Stack | vollständig, Design entschieden |
| [`04_PRODUKTPUNKT_BRANCHENVORLAGE_DETAILHANDEL.md`](04_PRODUKTPUNKT_BRANCHENVORLAGE_DETAILHANDEL.md) | Produktarbeit, kein Website-Text — abgegrenzt vorgemerkt | vorgemerkt, nicht begonnen |

## Entscheidungen vom 10.08.2026

- **Design: Option B — „Schweizer Werkbank."** Hell geführt, Night als Schrift- und
  Aktionsfarbe, Sand als einzige warme Fläche. Die daraus folgenden Bau-Vorgaben stehen in
  Zielbild, Abschnitt C.1.
- **Preise: mit den aktuellen Werten als Platzhalter weiterarbeiten.** Das Finale hängt an
  der laufenden Margen-Rechnung. Bedingung: der Platzhalter trägt **kein Ablaufdatum** —
  genau das ist der Fehler aus Befund C1.
- **`detailhandel-logistik`: Vorlage wird nachgebaut.** Als eigener Produktpunkt abgegrenzt
  (Dokument 04). Die Branchenseite darf erst live gehen, wenn die Vorlage steht.
- **Datenresidenz: läuft in einem separaten, sofortigen Strang** — unabhängig vom Relaunch,
  weil die Aussage heute live steht. Die neue Seite erbt das Ergebnis, statt die Frage ein
  zweites Mal aufzumachen.

## Was noch aussteht

Sicherung der Live-Seite (ZIP zugesagt) · Quellen für 62 % / 3.4 h / CHF 4'500 · getestete
Telefonanbieter · EU-/CH-Endpunkt-Frage bei ElevenLabs · finale Preise.

**Keiner dieser Punkte blockiert das Baugerüst** — sie betreffen einzelne Textstellen und
das Go-Live. Ausnahme: ohne die Sicherung gibt es keine Redirect-Karte, und ohne die darf der
Relaunch nicht live gehen.

## Was beim Eintreffen des ZIP zu tun ist

1. Inhalt in Dokument 01 ablegen, Status von „rekonstruiert" auf „gesichert" umstellen.
2. Content-Audit auf den Volltext ausweiten — insbesondere FAQ (C9) und eine mögliche
   Kalender-Bewerbung (C10), die bisher nicht prüfbar waren.
3. Rechtstexte (AGB, Datenschutz, Impressum) **unverändert** übernehmen.
4. Redirect-Karte alt→neu aus der bestehenden URL-Liste und `_redirects` erstellen.

## Ablage

Diese Dokumente liegen in `voxera-platform`, weil diese Session nur dort Schreibrechte hat.
`voxera-website` enthält bisher ausschliesslich eine `README.md`. Der Ordner ist bewusst
in sich geschlossen, damit er beim Baustart als Ganzes nach `voxera-website` umziehen kann —
mit Ausnahme von Dokument 04, das als Produktarbeit in `voxera-platform` bleibt.
