# 5) INTEGRATION-PUNKTE (Layered-Prompt-System)

- **Severity:** hoch  
  **Location:** `customer-dashboard/netlify/functions/twilio-inbound-router.js`, `elevenlabs-post-call.js`  
  **Beschreibung:** ElevenLabs-Anbindung liegt verteilt in Routing + Post-Call-Verarbeitung; Provisioning/Update-Ownership ist nicht zentral in einem dedizierten Modul sichtbar.  
  **Empfehlung:** Einen klaren Agent-Lifecycle-Service definieren (create/update/version) und dort Layer-1/2/3 zusammenführen.

- **Severity:** hoch  
  **Location:** `customer-dashboard/netlify/functions/customer-contract-state.js` + `index.html` entitlement/state UI  
  **Beschreibung:** Plan-/Contract-State ist Integrationseinstieg für prompt-layer capability gating (welche Layer erlaubt).  
  **Empfehlung:** Layered-Prompt-Fähigkeiten an plan_config/offer Flags anbinden, server-authoritative ausliefern.

- **Severity:** mittel  
  **Location:** `customers.customer_name` (Schema + diverse Reads/Writes)  
  **Beschreibung:** Für Migration auf `customer_display_name` + `customer_legal_name` braucht es volle Fundstellenliste und Kompatibilitätsphase.  
  **Empfehlung:** Temporäre Dual-write/Dual-read-Strategie mit Backfill und finalem Cleanup.

- **Severity:** mittel  
  **Location:** `supabase/sql/2026-04-07_notification_mode_single_source.sql` + `customer-update-settings.js` + Frontend settings  
  **Beschreibung:** `notification_mode` wurde als SSOT gehärtet; tatsächliche Workflow-Kette (DB -> Make/Twilio/Email) muss End-to-End validiert werden.  
  **Empfehlung:** Contract-Test je notification_mode-Ausprägung (`none`,`callback_only`,`all_calls`) gegen reale Nebenwirkungen.

- **Severity:** mittel  
  **Location:** künftige Layer-2/3-Datenhaltung (nicht explizit vorhanden)  
  **Beschreibung:** Branche, Template-Auswahl und kundenindividuelle Datenstrukturen sind noch nicht als klares Schema/Versionierung sichtbar.  
  **Empfehlung:** Neue Tabellenstruktur mit prompt_versioning, template lineage und audit trail definieren.
