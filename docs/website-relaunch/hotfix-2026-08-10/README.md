# Hotfix 10.08.2026 — vier Content-Korrekturen an der Live-Seite

**Status:** vorbereitet, **noch nicht gepusht.** Wartet auf das Repo `voxera-website-live`.

## Warum das hier liegt

Der Auftrag war: gesicherten Stand als ersten Commit in ein neues Repo
`voxera-website-live`, danach die vier Korrekturen als Hotfix-PR dagegen.

**Die Repo-Erstellung ist der GitHub-Integration dieser Session nicht erlaubt:**

```
POST https://api.github.com/user/repos
→ 403 Resource not accessible by integration
```

Das ist eine Berechtigungsgrenze der GitHub-App, kein vorübergehender Fehler — GitHub-Apps
können auf persönlichen Konten keine Repos anlegen. Deshalb liegen die beiden fertigen
Commits als Patch hier, damit nichts verlorengeht, wenn die Session endet.

## Was vorbereitet ist

| Commit | Inhalt |
|---|---|
| 1 — Basis | Der gesicherte Produktivstand, **unverändert**. Die bekannten Fehler bleiben absichtlich drin, damit der Ausgangszustand nachvollziehbar bleibt. |
| 2 — Hotfix | Die vier Korrekturen. Liegt als [`0001-vier-content-korrekturen.patch`](0001-vier-content-korrekturen.patch) vor. |

`REPO_README.md` ist die README, die in das neue Repo gehört — inklusive der Warnung zu den
fehlenden Assets.

## Was zu tun ist

1. **Leeres Repo `voxera-website-live` anlegen** (GitHub-Weboberfläche, wie damals bei
   `voxera-website`). **Ohne** README/`.gitignore`-Initialisierung — der erste Commit soll der
   Produktivstand sein. Empfehlung: **privat**; öffentlich machen geht später jederzeit,
   umgekehrt nicht.
2. Bescheid geben — dann pushe ich Basis-Commit und Hotfix-Branch und eröffne den PR.

## ⚠️ Vor dem Verknüpfen mit der produktiven Netlify-Seite

**Der vorbereitete Stand ist keine vollständige Kopie des Deploys.** Es fehlen alle
Bild-Assets:

```
favicon.svg  favicon.ico  favicon.png  favicon_16.png  favicon_32.png
apple-touch-icon.png      og-image.png
```

Alle sieben werden von den HTML-Dateien referenziert. Da `netlify.toml` mit `publish = "."`
das Repo-Verzeichnis ausliefert, würde ein Deploy aus diesem Stand die Seite **ohne Favicon
und ohne Social-Preview-Bild** veröffentlichen — eine sichtbare Verschlechterung gegenüber
heute.

Dazu fehlt weiterhin die **vollständige Dateiliste** des Deploys. `offer-accept.html` war der
Beleg dafür, dass das kein theoretisches Risiko ist: die Seite tauchte in keiner
Dokumentation auf und wurde erst bei der Sicherung entdeckt.

**Reihenfolge deshalb:** Repo anlegen → Commits pushen → **Assets und Dateiliste ergänzen** →
erst dann verknüpfen → ersten Deploy als Preview prüfen, nicht direkt auf Produktion.

## Was die vier Korrekturen ändern

| # | Datei | Änderung |
|---|---|---|
| 1 | `index.html` | Drei Testimonials und „Über 20 Schweizer KMU" entfernt. Überschrift „Was unsere Kunden sagen" → „Worauf Sie sich verlassen können", weil die Kennzahlen darunter bleiben. |
| 2 | `offer-accept.html`, `index.html` | Datenresidenz an die Datenschutzerklärung angeglichen — Badges über dem Signaturfeld zuerst, dann Hero-Badge, Feature-Karte und FAQ-Antwort. |
| 3 | `agb.html`, `offer-accept.html` | Arbeitsversions-Hinweis entfernt, Version sichtbar gemacht, Zustimmungsstempel auf `v2.0-2026-07-03`. |
| 4 | `datenschutz.html` | §7: Audio und Transkripte 90 Tage, Anrufdaten 180 Tage. |

**Mitgezogen:** Weil (4) den Text der Datenschutzerklärung ändert, wurde sie von v2.0
(01.05.) auf **v2.1 (10.08.)** gehoben, samt Stempel und Beschriftungen in
`offer-accept.html`. Ohne diesen Schritt hätte (4) genau den Fehler neu erzeugt, den (3)
behebt — einen Versionsstempel, der nicht zum ausgelieferten Text passt.

## Was bewusst nicht geändert wurde

- **„99 % Verfügbarkeit" und „<10 s Reaktionszeit"** (Befund C18) stehen weiter auf der Seite.
  Sie waren nicht Teil der vier Entscheidungen. Sie bleiben unbelegt, und die AGB §3 schliessen
  ausdrücklich jede Verfügbarkeitsgarantie aus — der Widerspruch besteht also fort.
- **Der abgelaufene Aktionspreis** „bis 31. Mai 2026" (C1, vier Fundstellen) — wartet auf die
  Margen-Rechnung.
- **Die Vergleichszahlen** 62 % / 3.4 h / CHF 4'500 / 72 % (C4) — warten auf die Quellen.
- **Rechtliche Prüfung der AGB** — holt der Betreiber separat ein, ausdrücklich nicht Teil
  dieses Hotfixes. Entfernt wurde nur der öffentliche Hinweis darauf, nicht die Notwendigkeit.

## Nachgelagert, ausserhalb dieses Repos

Die Dokumentenliste im Kunden-Dashboard führt die Datenschutzerklärung als **v2.0**
(`customer-dashboard/index.html`). Nach dem Sprung auf v2.1 stimmt das nicht mehr. Kleine
Änderung in `voxera-platform`, gehört aber nicht in diesen Hotfix.
