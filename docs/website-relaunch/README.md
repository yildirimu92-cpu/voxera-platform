# Website-Neukonzeption voxera.ch — Rückmeldung Schritt 1–3

**Datum:** 10.08.2026 · **Status:** Zielbild zur Besprechung. **Es wurde nichts gebaut.**

Grundlage: `briefing-website-neukonzeption.md` und der Nachtrag
`briefing-website-seo-addendum.md`.

| Dokument | Inhalt | Status |
|---|---|---|
| [`01_IST_AUFNAHME_2026-08-10.md`](01_IST_AUFNAHME_2026-08-10.md) | Schritt 1 — Sicherung der Live-Seite | ⚠️ **blockiert**, rekonstruierter Teilstand + Beschaffungsweg |
| [`02_CONTENT_AUDIT_2026-08-10.md`](02_CONTENT_AUDIT_2026-08-10.md) | Schritt 2 — 15 Befunde, gegen den echten Stack geprüft | vollständig für die bekannten Aussagen |
| [`03_ZIELBILD_2026-08-10.md`](03_ZIELBILD_2026-08-10.md) | Schritt 3 — Sitemap, SEO & Content-Struktur, 3 Design-Optionen, Stack | vollständig |

## Die drei Dinge, die sofort zählen

1. **Schritt 1 ist nicht erledigt.** `voxera.ch` ist für diese Umgebung per Egress-Policy
   gesperrt (403 auf CONNECT). Ein Umweg über Archivdienste wäre eine Umgehung der
   Richtlinie und wurde bewusst nicht gemacht. **Es existiert weiterhin keine versionierte
   Kopie der alten Seite.** Schnellster Weg: im Netlify-Projekt `Deploys → Download deploy`
   und das ZIP hier ablegen. Details in Dokument 01.
2. **Die Datenresidenz-Aussage ist nicht mehr nur „möglicherweise falsch", sondern belegt
   widerlegt** — der US-Endpunkt `api.us.elevenlabs.io` ist im Code fest verdrahtet, während
   die Supabase-Datenbank tatsächlich in Zürich steht. Die Entscheidung, was daraus für den
   Text folgt, liegt beim Betreiber (Content-Audit C2), nicht bei mir.
3. **`/agb`, `/datenschutz` und `/contract-signed.html` dürfen sich nicht ändern.** Sie
   stehen in unterzeichneten Verträgen bzw. werden aus dem Produkt heraus deeplinkt
   (Content-Audit C15).

## Ablage

Diese Dokumente liegen in `voxera-platform`, weil diese Session nur dort Schreibrechte hat.
`voxera-website` enthält bisher ausschliesslich eine `README.md`. Der Ordner ist bewusst
in sich geschlossen, damit er beim Baustart als Ganzes nach `voxera-website` umziehen kann.
