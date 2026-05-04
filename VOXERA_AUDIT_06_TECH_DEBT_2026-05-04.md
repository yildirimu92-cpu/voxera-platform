# 6) TECHNISCHE SCHULDEN

- **Severity:** hoch  
  **Location:** `customer-dashboard/index.html`  
  **Beschreibung:** Große monolithische Datei mit viel Business-/UI-/Datenlogik; erschwert Testbarkeit und sichere Änderungen.  
  **Empfehlung:** Mittelfristig modulare Aufteilung (state, api, ui components) mit Contract-Tests.

- **Severity:** mittel  
  **Location:** `customer-dashboard/netlify/functions/_lib/*` vs einzelne Function-Dateien  
  **Beschreibung:** Teilweise vorhandene Shared-Libs, aber weiterhin verteilte Pattern für Fehlerbehandlung/Validierung/Auth-Guard.  
  **Empfehlung:** Gemeinsames Function-Middleware-Pattern für input/auth/error/response etablieren.

- **Severity:** mittel  
  **Location:** `supabase/sql/*.sql`  
  **Beschreibung:** Hohe Migrationsdichte in kurzer Zeit erhöht kognitive Last und Drift-Risiko.  
  **Empfehlung:** Regelmäßige schema snapshot + reconciliation pipeline.

- **Severity:** niedrig  
  **Location:** Repository-Root (zahlreiche historische Audit-Reports)  
  **Beschreibung:** Viele punktuelle Markdown-Audits; Wissensstand verteilt.  
  **Empfehlung:** Konsolidiertes „current architecture + runbook“ als lebendes Dokument.

- **Severity:** niedrig  
  **Location:** Dependencies (`customer-dashboard/package.json`)  
  **Beschreibung:** Dependency-Stand sollte regelmäßig auf CVEs/major updates geprüft werden (kein automatisierter Befund im Auditlauf).  
  **Empfehlung:** `npm audit` + Dependabot/renovate mit Review-Prozess.
