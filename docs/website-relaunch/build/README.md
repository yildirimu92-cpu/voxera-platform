# Relaunch-Gerüst voxera.ch

**Status:** Gerüst gebaut, **Seiteninhalte folgen.** Baustart freigegeben am 10.08.2026.

## Wo das hingehört

**In das Repo `voxera-website`** (der Neubau) — nicht in `voxera-platform` und nicht in
`voxera-website-live` (der Produktivstand). Es liegt hier nur, weil diese Session auf
`voxera-website` derzeit **keinen Schreibzugriff** hat: der Versuch, das Repo mit
Push-Rechten anzuhängen, verlangt eine Freigabe, die ich nicht selbst erteilen kann.

Sobald der Zugriff besteht, zieht der Ordner **als Ganzes** in das Wurzelverzeichnis von
`voxera-website` um. Er ist bewusst so gebaut, dass dabei nichts angepasst werden muss.

## Was steht

| | |
|---|---|
| `astro.config.mjs` | Statische Ausgabe, `trailingSlash: always`, Sitemap-Integration mit Ausschluss der Transaktionsseiten |
| `src/styles/tokens.css` | **Option B „Schweizer Werkbank"** — die Farbrollen aus Zielbild C.1, inklusive der Regeln, die sonst in der Umsetzung verrutschen (Sand nur als Sektionstrennung, Gold trägt nie Text, eine Schattenstufe) |
| `src/layouts/Base.astro` | Die gesamte SEO-Verdrahtung an einer Stelle: Titel und Description als **Pflichtparameter ohne Default**, Canonical, Open Graph, `hreflang`-Gerüst, `LocalBusiness`-Schema global, seitenspezifisches JSON-LD |
| `src/config/preise.ts` | **Einzige Preisquelle.** `AKTION` steht bewusst auf `null` statt auf einem alten Datum |
| `src/config/site.ts` | Navigation, die acht Branchen mit ihren Produkt-Vorlagen, Ratgeber-Kategorien |
| `scripts/verify-seo.mjs` | Build-Wächter — bricht ab bei fehlendem/doppeltem Titel, fehlender Description, fehlendem Canonical, `<img>` ohne Dimensionen, **abgelaufenem `priceValidUntil`** und Google-Fonts-CDN |

## Warum der Build-Wächter genau das prüft

Jede Regel darin ist ein Befund aus dem Content-Audit, technisch abgesichert:

- **`priceValidUntil` in der Vergangenheit → Build bricht ab.** Auf der alten Seite stand ein
  Aktionspreis „gültig bis 31. Mai 2026" über zwei Monate lang als aktuell (C1). Ein
  Ablaufdatum, das ohne Deploy still verstreicht, darf es nicht mehr geben.
- **Titel und Description Pflicht, Duplikate verboten.** Die alten Rechtstexte hatten weder
  Description noch Canonical (C19/C20).
- **`<img>` ohne `width`/`height` → Build bricht ab.** Layout-Shift, CLS-Ziel < 0.05.
- **Google-Fonts-CDN → Build bricht ab.** Ladezeit und Datenschutz (C12).

## Was noch fehlt

- **Seiteninhalte.** Die Routen und ihre Meta-Daten stehen; die Texte kommen als Nächstes.
- **Schriftdateien** in `public/fonts/` (`plus-jakarta-sans-700.woff2`, `dm-sans-400.woff2`)
  — selbst ausgeliefert, kein CDN.
- **Bild-Assets** (`og-image.png`, Favicons) — dieselben, die auch dem Produktivstand fehlen.
- **Redirect-Karte** in `netlify.toml`: die alten Anker (`/#preise`, `/#branchen` …) stehen in
  E-Mails und Offerten und brauchen eine Fragment-Weiterleitung auf die neuen Unterseiten.

## Gesperrt — darf nicht live gehen

| Route | Grund |
|---|---|
| `/preise/` | Endgültige Preise stehen aus (Margen-Rechnung läuft). Platzhalter freigegeben, Go-Live nicht. |
| `/branchen/detailhandel-logistik/` | Die zwei Produkt-Vorlagen (`detailhandel`, `logistik`) sind beschlossen, aber noch nicht gebaut. |
| Der Relaunch als Ganzes | Braucht die vollständige Redirect-Karte und damit die Dateiliste des alten Deploys. |

Die Sperre für die Branchenseite ist in `src/config/site.ts` als Feld `gesperrt` hinterlegt,
damit sie nicht nur in einem Dokument steht, sondern im Code sichtbar ist.
