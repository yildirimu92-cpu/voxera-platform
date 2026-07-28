# Voxera – Baseline Repository State

**Audit-Branch:** `audit/technical-baseline-2026-07`  
**Repository:** `yildirimu92-cpu/voxera-platform`  
**Repository-Baseline:** `main@682b88cbc16deb259f6f513de02b7bdc9fc255ab`  
**Audit-Zweck:** Technischen Repository-Ausgangszustand dokumentieren; keine Produktivlogik verändern.

## Statusdefinitionen

- **VERIFIZIERT** – direkt anhand des GitHub-Repository-Zustands oder eines konkret gelesenen Repository-Artefakts bestätigt.
- **AUS REPOSITORY ABGELEITET** – aus Code, Konfiguration oder Dokumentation ableitbar, aber nicht als produktiver Laufzeitstatus bestätigt.
- **NICHT VERIFIZIERT** – mit den verfügbaren Zugängen nicht technisch bestätigt.
- **LIVE-ZUGRIFF ERFORDERLICH** – kann nur über das jeweilige Netlify- oder Supabase-Dashboard beziehungsweise dessen API/CLI verifiziert werden.

Repository-Funde sind ausdrücklich **kein Nachweis**, dass eine Komponente aktuell produktiv deployt, konfiguriert oder ausgeführt wird.

## 1. Referenzstand

| Punkt | Status | Ergebnis |
|---|---|---|
| Default Branch | VERIFIZIERT | `main` |
| Baseline-Commit | VERIFIZIERT | `682b88cbc16deb259f6f513de02b7bdc9fc255ab` |
| Verhältnis `main` zum Baseline-Commit | VERIFIZIERT | `main` war beim Audit identisch mit dem Baseline-Commit. |
| Audit-Branch | VERIFIZIERT | `audit/technical-baseline-2026-07`, ursprünglich vom Baseline-Commit erstellt |
| Empfohlener Stabilisierungsausgangspunkt | VERIFIZIERT | `main@682b88cbc16deb259f6f513de02b7bdc9fc255ab` |
| Vorgesehener Tag-Name | AUS REPOSITORY ABGELEITET | `legacy-baseline-2026-07` ist syntaktisch plausibel. Es wurde kein Tag erstellt. |
| Vorhandene Tags | NICHT VERIFIZIERT | Keine vollständige Tag-Abfrage verfügbar. |
| Vollständige Branch-Liste | NICHT VERIFIZIERT | Der Connector lieferte keine verlässliche vollständige Branch-Auflistung. |
| Offene Entwicklungsstände | VERIFIZIERT | Mehrere offene Pull Requests existieren; sie sind nicht Bestandteil der Baseline. |

## 2. Repository-Struktur

### 2.1 Admin Portal

**VERIFIZIERT**

- Einstiegspunkt: `admin-panel/index.html`
- Login: `admin-panel/login.html`
- Paketdefinition: `admin-panel/package.json`
- Netlify-Konfiguration: `admin-panel/netlify.toml`
- Functions: `admin-panel/netlify/functions/`
- Öffentliche Offertenansicht/PDF: unter anderem `admin-panel/offer-pdf.html`
- Supabase-SSOT-Dokument: `admin-panel/SUPABASE_SSOT.md`

### 2.2 Customer Dashboard

**VERIFIZIERT**

- Einstiegspunkt: `customer-dashboard/index.html`
- Aktivierungsseite: `customer-dashboard/activate.html`
- Paketdefinition: `customer-dashboard/package.json`
- Netlify-Konfiguration: `customer-dashboard/netlify.toml`
- Functions: `customer-dashboard/netlify/functions/`
- Lokale Dokumentation: `customer-dashboard/readme.md`

### 2.3 Öffentliche Seiten

**VERIFIZIERT**

Im Repository befinden sich statische oder tokenbasierte öffentliche Seiten und zugehörige Functions, darunter:

- `admin-panel/offer-pdf.html`
- `contract-signed.html`
- Functions wie `offer-public-get`, `offer-public-accept`, `contract-public-get` und `contract-countersign`

**NICHT VERIFIZIERT:** Welche dieser Seiten aktuell über welche produktive Domain ausgeliefert werden.

### 2.4 Supabase-Artefakte

**VERIFIZIERT**

- SQL-Dateien unter `supabase/sql/`
- Migrationen unter `supabase/migrations/`
- Beispiele:
  - `supabase/sql/2026-04-08_core_tables_schema_sot.sql`
  - `supabase/sql/2026-04-06_rls_access_hardening.sql`
  - `supabase/sql/2026-04-11_offer_system_v1.sql`
  - `supabase/sql/2026-04-11_invoice_system_v1.sql`
  - `supabase/migrations/2026-05-24_notifications_target_fields.sql`

**NICHT VERIFIZIERT:** Ob und in welcher Reihenfolge diese Dateien im Live-Projekt ausgeführt wurden.

### 2.5 Prüf- und Hilfsskripte

**VERIFIZIERT**

Unter `scripts/` existieren statische Verifikations- und Orchestrierungsprüfungen, unter anderem:

- `scripts/verify-supabase-ssot.mjs`
- `scripts/verify-commercial-orchestrator-p1_5.mjs`

Diese Skripte sind Repository-Artefakte. Ihre erfolgreiche Ausführung im Baseline-Audit wurde nicht bestätigt.

## 3. Build- und Netlify-Konfiguration

### Admin Portal

**VERIFIZIERT**

`admin-panel/netlify.toml` enthält:

- Publish Directory: `.`
- Functions Directory: `netlify/functions`
- keinen expliziten Build Command
- Scheduler:
  - `outbox-retry-worker`: `*/5 * * * *`
  - `daily-billing-runner`: `0 6 * * *`

### Customer Dashboard

**VERIFIZIERT**

`customer-dashboard/netlify.toml` enthält:

- Build Command: `echo 'Deploy successful'`
- Publish Directory: `.`
- Functions Directory: `netlify/functions`
- Scheduler:
  - `cleanup-stale-calls`: `*/5 * * * *`
- Redirect:
  - `/twilio/status-callback` auf die gleichnamige Netlify Function
- SPA-Fallback:
  - `/*` auf `/index.html`

**AUS REPOSITORY ABGELEITET:** Beide Oberflächen sind als weitgehend statische HTML-Anwendungen mit Netlify Functions aufgebaut.

**NICHT VERIFIZIERT:** Ob Netlify für die Sites tatsächlich `admin-panel` beziehungsweise `customer-dashboard` als Base Directory verwendet.

## 4. Package-Versionen

| Bereich | Paket | Repository-Angabe | Status |
|---|---|---:|---|
| Admin | `@supabase/supabase-js` | `^2.0.0` | VERIFIZIERT |
| Admin | `nodemailer` | `^6.9.0` | VERIFIZIERT |
| Customer | `@supabase/supabase-js` | `^2.0.0` | VERIFIZIERT |
| Browser-CDN | Supabase JS | Major Version 2 | VERIFIZIERT |
| Lockfiles / exakt installierte Versionen | – | nicht vollständig geprüft | NICHT VERIFIZIERT |

Die Paketnamen lauten weiterhin `voxera-admin` und `voxera-dashboard`. Das ist ein **Repository-Namensrest**, kein Nachweis für aktive Legacy-Repositories.

## 5. Tests und Dokumentation

### Tests

- **VERIFIZIERT:** Statische Prüfskripte sind vorhanden.
- **VERIFIZIERT:** In den beiden gelesenen `package.json`-Dateien sind keine Test- oder Build-Skripte definiert.
- **NICHT VERIFIZIERT:** Ob weitere Testframeworks, CI-Workflows oder externe Testläufe existieren.
- **NICHT VERIFIZIERT:** Ob sämtliche Functions syntaktisch ladbar sind.

### Dokumentation

**VERIFIZIERT:** Im Repository existieren mehrere technische, Readiness- und Architekturberichte, unter anderem:

- `TECHNISCHE_PROJEKTDOKUMENTATION_2026-04-03.md`
- `INTERNAL_SYSTEM_DOCUMENTATION_2026-04-06.md`
- `LAUNCH_READINESS_ANALYSE_2026-04-07.md`
- `admin-panel/SUPABASE_SSOT.md`

Diese Dokumente können veraltet sein und sind kein Ersatz für Live-Verifikation.

## 6. Unterschiede zwischen Repository-Struktur und dokumentierter Architektur

| Beobachtung | Status | Bedeutung |
|---|---|---|
| Kein Root-`package.json` gefunden | VERIFIZIERT | Kein einheitlicher Monorepo-Build an der Wurzel bestätigt |
| Kein Root-`netlify.toml` gefunden | VERIFIZIERT | Netlify-Konfiguration ist in die beiden Oberflächen aufgeteilt |
| Kein Root-`README.md` gefunden | VERIFIZIERT | Der zentrale Start- und Betriebsprozess ist nicht an der Wurzel dokumentiert |
| Sehr grosse HTML-Einstiegspunkte mit eingebettetem CSS/JS | VERIFIZIERT | Frontend-Logik ist stark monolithisch |
| Zwei getrennte Functions-Verzeichnisse | VERIFIZIERT | Funktionale Überschneidungen zwischen Admin und Customer sind möglich |
| Öffentliche Offerten-/Vertragslogik liegt teilweise im Admin-Bereich | VERIFIZIERT | Deployment-Zuordnung muss live bestätigt werden |
| Paketnamen tragen historische Namen | VERIFIZIERT | Namensinkonsistenz, aber kein Beweis für aktive Legacy-Systeme |

## 7. Baseline-Entscheid

**VERIFIZIERT:** Für die technische Stabilisierung soll verwendet werden:

- Branch: `main`
- Commit: `682b88cbc16deb259f6f513de02b7bdc9fc255ab`

Der Audit-Branch enthält nur Dokumentation und ist nicht die spätere Produktivbasis.

## 8. Nicht vorgenommene Aktionen

- kein Tag erstellt
- keine Produktivlogik verändert
- keine Migration ausgeführt
- keine Netlify-Konfiguration geändert
- kein Deployment ausgelöst
- kein Pull Request gemergt
