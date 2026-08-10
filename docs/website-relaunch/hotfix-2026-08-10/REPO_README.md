# voxera-website-live

Produktivstand der Marketing-Website **voxera.ch**.

Dieses Repo ist bewusst **getrennt** vom Relaunch-Repo `voxera-website`:

| Repo | Zweck |
|---|---|
| **`voxera-website-live`** (dieses) | Die Seite, die **heute live ist**. Nur Korrekturen am Bestand. |
| `voxera-website` | Der **Neubau**. Neue Struktur, neues Design, eigener Zeitplan. |

Bis der Relaunch live geht, laufen Korrekturen ausschliesslich hier.

---

## ⚠️ Vor dem Verknüpfen mit Netlify lesen

**Dieses Repo ist noch keine vollständige Kopie des Deploys.** Der erste Commit enthält die
acht Dateien, die am 10.08.2026 gesichert wurden. Es fehlen mindestens:

```
favicon.svg   favicon.ico   favicon.png   favicon_16.png   favicon_32.png
apple-touch-icon.png        og-image.png
```

Alle sieben werden von den HTML-Dateien referenziert. Da `netlify.toml` mit `publish = "."`
schlicht das Repo-Verzeichnis ausliefert, würde ein Deploy aus dem jetzigen Stand die Seite
**ohne Favicon und ohne Social-Preview-Bild** veröffentlichen — eine sichtbare Verschlechterung
gegenüber heute.

**Deshalb vor dem Verknüpfen:**

1. Die fehlenden Assets aus dem aktuellen Netlify-Deploy hierher übernehmen
   (`Deploys → Download deploy`).
2. Die **vollständige Dateiliste** des Deploys mit diesem Repo abgleichen. Es kann weitere
   Dateien geben, die niemandem bekannt sind — `offer-accept.html` war genau so ein Fall:
   sie tauchte in keiner Dokumentation auf und wurde erst bei der Sicherung entdeckt.
3. Erst danach verknüpfen, und den ersten Deploy als **Deploy-Preview** prüfen, nicht direkt
   auf Produktion.

---

## Inhalt

| Datei | Was es ist |
|---|---|
| `index.html` | Startseite — One-Pager, alle Sektionen als Anker (`#wie`, `#features`, `#demo`, `#branchen`, `#preise`, `#beratung`, `#kontakt`) |
| `agb.html` | AGB — **in unterzeichneten Verträgen referenziert** |
| `datenschutz.html` | Datenschutzerklärung — **in unterzeichneten Verträgen referenziert** |
| `impressum.html` | Impressum |
| `offer-accept.html` | **Transaktionsseite:** Offerte lesen und digital unterzeichnen (`?token=…`) |
| `contract-signed.html` | **Transaktionsseite:** Ansicht des unterzeichneten Vertrags (`?token=…`) |
| `netlify.toml` | Deploy-Konfiguration: Header, Rewrites, Catch-all |
| `_redirects` | dupliziert die drei Rewrites aus `netlify.toml` — siehe unten |

## Was hier nicht kaputtgehen darf

- **`/agb` und `/datenschutz`** stehen im generierten Vertragstext und in der
  Dokumentenliste des Kunden-Dashboards. Die Pfade sind Teil unterzeichneter Verträge.
- **`offer-accept.html` und `contract-signed.html`** sind keine Marketing-Seiten. Das
  Kunden-Dashboard und der Offertenversand deeplinken mit Token hierher.
- **Netlify Forms** — `index.html` enthält zwei Formulare mit `data-netlify="true"`
  (`kontakt` und ein verstecktes `anfrage`). Verschwindet dieses Markup, kommen
  **stillschweigend keine Anfragen mehr an**: kein Fehler, keine Meldung, nur Stille.
- **Calendly** — die Terminbuchung für das Erstgespräch zeigt auf
  `calendly.com/voxera_ch/voxera-demo-ai-telefonassistent`.

## Bekannte Altlasten

Nicht dringend, aber dokumentiert, damit sie nicht wieder überraschen:

- **Die drei Rewrites stehen doppelt** — in `netlify.toml` *und* in `_redirects`. Netlify
  wertet `netlify.toml` zuerst aus, die Regeln in `_redirects` kommen nie zum Zug. Aktuell
  folgenlos, weil identisch. Bei der nächsten Änderung gilt: **`netlify.toml` ist die Quelle.**
- **Jeder Rechtstext ist unter zwei URLs erreichbar** (`/agb` und `/agb.html`), weil die
  Rewrites mit Status 200 statt 301 arbeiten. Ohne Canonical ist das Duplicate Content.
- **Die Catch-all-Regel** `/*` → `/index.html` mit Status 404 liefert die komplette Startseite
  als Fehlerseite aus. Der Status stimmt, der Inhalt nicht.

Diese drei Punkte werden im Relaunch gelöst, nicht hier — ein Umbau der Redirect-Logik am
Produktivstand hat ein schlechtes Aufwand-Risiko-Verhältnis.

## Herkunft

Die Seite lief bis zum 10.08.2026 **ohne Versionskontrolle**, direkt auf Netlify. Der erste
Commit dieses Repos ist der gesicherte Stand von diesem Tag — unverändert, so wie er live war.
Die vollständige Bestandsaufnahme, das Content-Audit und das Zielbild für den Relaunch liegen
in `voxera-platform` unter `docs/website-relaunch/`.
