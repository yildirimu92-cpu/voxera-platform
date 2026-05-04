# 2) KONSISTENZ-CHECK

- **Severity:** hoch  
  **Location:** `customer-dashboard/netlify/functions/cases-create.js`, `cases-update.js`, `supabase/sql/2026-04-08_core_tables_schema_sot.sql`  
  **Beschreibung:** Functions arbeiten auf `customer_tasks`, Core-SoT dokumentiert jedoch `cases` als primäre Falltabelle — möglicher Drift/Bridge-Layer.  
  **Empfehlung:** Eindeutige SSOT-Entscheidung (nur `cases` oder bewusstes Compatibility-View/Sync), inklusive Datenflussdoku.

- **Severity:** mittel  
  **Location:** `supabase/sql/2026-04-08_core_tables_schema_sot.sql`  
  **Beschreibung:** Viele Felder sind als „inferred“ markiert; erschwert sichere Aussage zu read/write-Vollständigkeit.  
  **Empfehlung:** Runtime-Schema-Export (information_schema) gegen Migrations-Repo diffen und Lücken schließen.

- **Severity:** mittel  
  **Location:** `customer-dashboard/index.html`  
  **Beschreibung:** Frontend enthält umfangreiche Status-/Entitlement-Logik zusätzlich zu Backend-Libraries (`status-model`, `contract-state`), potenziell redundante Business-Regeln.  
  **Empfehlung:** Verantwortlichkeiten pro Regelklasse definieren (Backend authoritative, Frontend display-only).

- **Severity:** mittel  
  **Location:** `customers.customer_name` (Schema + Runtime)  
  **Beschreibung:** Altes Namensfeld bleibt zentral; Migration zu `customer_display_name` + `customer_legal_name` noch nicht sichtbar durchgängig umgesetzt.  
  **Empfehlung:** Migrationsmatrix Read/Write pro Stelle erstellen und in 2-Phasen-Cutover umsetzen.

- **Severity:** niedrig  
  **Location:** `customer-dashboard/index.html` storage keys  
  **Beschreibung:** Storage-Key-Namensgebung konsistent prefixed, aber ohne versionierten Namespace (z. B. `v2`).  
  **Empfehlung:** Versionssuffix für zukünftig breaking UI-State-Changes einführen.
