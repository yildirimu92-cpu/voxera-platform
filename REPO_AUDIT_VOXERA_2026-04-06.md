# Voxera Repo Audit (2026-04-06)

Diese Datei dokumentiert eine harte Launch-Readiness-Analyse auf Basis des aktuellen Repository-Stands.

## Wichtigste Kernrisiken (Kurzform)
- Statusmodell ist inkonsistent über SQL-Migrationen, Netlify Functions und Frontends (`pending/active` vs. `onboarding/ready/invited/activated/live/paused`).
- Admin-Operationen sind in Teilen nur Frontend-State ohne persistente DB-Write-Backs (z. B. Cases, AI-Setup).
- Admin-Portal schützt den Zugang im Login-Flow, erzwingt aber in `index.html` keine harte Session/Admin-Verifikation.
- Dashboard-Zugang erwartet `customers.status = active`, obwohl neuere Migrationen auf `live` normalisieren.
- Setup-Wizard-Fortschritt liegt zu großen Teilen in `localStorage` und nicht als serverseitige Source of Truth.

## Referenz
Die Detailanalyse wurde in der Chat-Antwort mit konkreten Fundstellen (Datei + Zeilen) geliefert.
