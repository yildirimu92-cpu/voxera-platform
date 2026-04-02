# Voxera Umsetzungsplan (3 Ebenen)

Basierend auf dem Audit wird hier ein konkreter Umsetzungsplan in 3 Ebenen definiert.

---

## 1) Sofortmaßnahmen (heute / diese Woche)

### 1.1 Service-Role aus Frontend entfernen
- **Ziel:** Kein privilegierter Supabase-Zugriff mehr aus Browser-Code.
- **Root Cause:** Service-Key wird im Admin-Frontend initialisiert.
- **Betroffene Bereiche:** `admin-panel/index.html`, Supabase Auth Admin APIs, Admin-Management-Flows.
- **Konkrete technische Schritte:**
  1. Neue Netlify Functions (oder Supabase Edge Functions) anlegen für:
     - `POST /admin/create-user`
     - `POST /admin/create-admin`
     - `DELETE /admin/delete-admin`
  2. Service-Key ausschließlich als Server-Secret hinterlegen.
  3. Frontend-Aufrufe auf die neuen serverseitigen Endpunkte umstellen.
  4. Supabase Service Key rotieren.
  5. Incident-Check: Logs auf missbräuchliche Nutzung der alten Keys prüfen.
- **Priorität:** **P1**
- **Abhängigkeiten:** Deploy-Pipeline für Functions, Secret-Management.
- **Definition of Done:**
  - Kein `service_role`/`SB_SVC` mehr im Client-Bundle.
  - Alle privilegierten Admin-Aktionen laufen serverseitig.
  - Rotierter Key produktiv, alter Key deaktiviert.

### 1.2 Single Source of Truth festlegen
- **Ziel:** Eine einzige verlässliche Datenquelle für Customers/Calls/Leads.
- **Root Cause:** Dashboard liest Supabase, Admin liest Airtable.
- **Betroffene Bereiche:** Customer Dashboard, Admin Portal, Datenkonsistenz, Reporting.
- **Konkrete technische Schritte:**
  1. Architekturentscheidung dokumentieren: **Supabase = SSOT**.
  2. Airtable als „read-only legacy source“ markieren (kurzfristig) oder direkt ablösen.
  3. Datenflüsse inventarisieren (Calls, Kunden, Statusupdates).
  4. Reconciliation-Skript bauen (Airtable ↔ Supabase Delta Check).
- **Priorität:** **P1**
- **Abhängigkeiten:** Stakeholder-Entscheid, Datenmodell-Freigabe.
- **Definition of Done:**
  - Dokumentierter SSOT-Entscheid.
  - Keine neuen Features mehr gegen Airtable.
  - Reconciliation-Report ohne kritische Deltas.

### 1.3 Admin von Airtable auf Supabase-Migrationspfad starten
- **Ziel:** Admin liest/schreibt Kernobjekte direkt in Supabase.
- **Root Cause:** Airtable API ist primärer Datenpfad im Admin.
- **Betroffene Bereiche:** Kundenliste, Call-Log, Stats, Customer CRUD im Admin.
- **Konkrete technische Schritte:**
  1. Supabase Views/RPCs für Admin-Listen anlegen (`admin_customers_v`, `admin_calls_v`).
  2. Admin-Frontend Query-Layer abstrahieren (`dataProvider`), Airtable-Implementierung ersetzen.
  3. Schrittweise Umschaltung per Feature Toggle (intern).
  4. Gleichlauf-Validierung über Stichproben (Top 100 Kunden, letzte 30 Tage Calls).
- **Priorität:** **P1**
- **Abhängigkeiten:** SSOT-Entscheid, Tabellen-/Index-Design.
- **Definition of Done:**
  - Admin-Listen/CRUD laufen auf Supabase.
  - Airtable-Token nicht mehr nötig für operative Kernflows.

### 1.4 ID-/Customer-Modell vereinheitlichen
- **Ziel:** Eindeutige, stabile Kundenzuordnung ohne Feld-Mismatch.
- **Root Cause:** Gemischte IDs (`id`, `customer_id`, `dashboard_id`, Telefonnummer).
- **Betroffene Bereiche:** Auth-Mapping, Calls-Zuordnung, Admin-Kundenanlage.
- **Konkrete technische Schritte:**
  1. Canonical Modell: `customers.id` (UUID) als primärer Schlüssel.
  2. `users.customer_id` als FK auf `customers.id`.
  3. Telefonnummer als normales Attribut (`voxera_number_e164`) statt Identifier.
  4. DB Constraints ergänzen (FK + unique index + not null wo sinnvoll).
  5. Migrationsskript + Backfill für Bestandsdaten.
- **Priorität:** **P1**
- **Abhängigkeiten:** SSOT, Migration-Window, QA-Testdaten.
- **Definition of Done:**
  - Alle produktiven Zuordnungen laufen über UUID-FK.
  - Keine Geschäftslogik mehr auf Basis von Telefonnummer als Schlüssel.

### 1.5 Make-Ingest auf robusten Supabase-Write standardisieren (v1)
- **Ziel:** Calls gehen zuverlässig und idempotent in Supabase ein.
- **Root Cause:** Kein versionierter Ingest-Contract/Retry/DLQ im Repo.
- **Betroffene Bereiche:** Make, Supabase `calls`, Dashboard/Admin Sichtbarkeit.
- **Konkrete technische Schritte:**
  1. Ingest-Endpoint definieren (signed webhook).
  2. Schema-Vertrag versionieren (`ingest_version`, required fields).
  3. Idempotency Key (`provider_call_id`) + unique constraint.
  4. Fehlerstrategie: Retry + Dead Letter Queue + Alerting.
  5. Ingest-Log-Tabelle (`call_ingest_events`) für Forensik.
- **Priorität:** **P1**
- **Abhängigkeiten:** Telefonie-Provider Felder, Make-Szenario-Anpassung.
- **Definition of Done:**
  - Duplicate Events erzeugen keine Duplikate.
  - Fehlgeschlagene Writes sind im DLQ sichtbar und replaybar.

### 1.6 `public.users` Provisionierung automatisieren
- **Ziel:** Jeder Auth-User hat deterministisch einen `public.users` Datensatz.
- **Root Cause:** Dashboard hängt von `users.customer_id` ab; fehlender Datensatz bricht Kontextauflösung.
- **Betroffene Bereiche:** Login, Customer-Kontext, Onboarding.
- **Konkrete technische Schritte:**
  1. DB Trigger auf `auth.users` (after insert) für `public.users` Upsert.
  2. Optional Queue/Job für Retry bei transienten Fehlern.
  3. Backfill-Skript für bestehende Auth-User ohne `public.users`.
  4. Monitoring-Metrik: `auth_users_without_public_users`.
- **Priorität:** **P1**
- **Abhängigkeiten:** Supabase DB Migration-Rechte.
- **Definition of Done:**
  - 0 fehlende `public.users` Datensätze für aktive Auth-User.
  - Neuer User erscheint automatisch korrekt verknüpft.

### 1.7 Admin Login UX/UI professionalisieren (Quick Wins)
- **Ziel:** Vertrauenswürdiges, konsistentes Login-Erlebnis.
- **Root Cause:** `admin-panel/login.html` ist visuell/strukturell abweichend und referenziert nicht vorhandene `styles.css`.
- **Betroffene Bereiche:** Admin Login, Markenwahrnehmung, Conversion.
- **Konkrete technische Schritte:**
  1. Login-Page auf denselben UI-Standard wie Dashboard/Admin bringen.
  2. Inline Validation, klare Error-Copy, Loading State, Passwort-Reset-Link.
  3. Konsistente Favicon/Branding/Typografie.
  4. A11y-Basics (Label-For, Fokus, Kontrast).
- **Priorität:** **P2**
- **Abhängigkeiten:** Design-System-Entscheid, Copy-Freigabe.
- **Definition of Done:**
  - Professionelles, markenkonsistentes Login.
  - Keine 404-Referenzen auf fehlende CSS-Dateien.

---

## 2) Beta-Readiness

### 2.1 Vollständige Admin-Migration (Airtable-off für Core-Flows)
- **Ziel:** Core-Bereiche im Admin vollständig auf Supabase.
- **Root Cause:** Historisch gewachsene Airtable-Kopplung.
- **Betroffene Bereiche:** Kundenverwaltung, Call-Log, Statistik, Statusupdates.
- **Konkrete technische Schritte:**
  1. Alle verbleibenden Airtable-Endpunkte entfernen.
  2. Supabase Indizes/Materialized Views für Reporting-Performance.
  3. RLS Policies für Admin-Rollen (`super-admin`, `admin`, `support`) finalisieren.
- **Priorität:** **P1**
- **Abhängigkeiten:** Abschluss Sofortmaßnahmen 1.2/1.3.
- **Definition of Done:**
  - Airtable wird für Core-Produktpfade nicht mehr aufgerufen.
  - Admin und Dashboard zeigen dieselbe Datenrealität.

### 2.2 End-to-End Sync & Realtime verbessern
- **Ziel:** Änderungen sind zeitnah und konsistent in beiden Oberflächen sichtbar.
- **Root Cause:** Polling-only und fehlende explizite Sync-Layer.
- **Betroffene Bereiche:** Dashboard Call-Liste, Admin Stats, Statuspropagation.
- **Konkrete technische Schritte:**
  1. Supabase Realtime Channels für Calls/Status nutzen.
  2. Polling als Fallback, nicht als Primärpfad.
  3. Last-Sync Indicator + stale-data warning in UI.
- **Priorität:** **P2**
- **Abhängigkeiten:** SSOT & stabile Tabellen.
- **Definition of Done:**
  - Neuer Call erscheint in definierter SLA (z. B. <10s) in beiden Flächen.
  - UI zeigt letzte erfolgreiche Aktualisierung.

### 2.3 Vertragsdaten von localStorage in Supabase
- **Ziel:** Teamfähig, revisionssicher, geräteunabhängig.
- **Root Cause:** Vertragsobjekte liegen nur lokal im Browser.
- **Betroffene Bereiche:** Admin Customer Profile / Verträge.
- **Konkrete technische Schritte:**
  1. Tabellen `contracts`, `contract_files`, `contract_audit_logs`.
  2. File Upload in Supabase Storage + Signed URLs.
  3. Migration bestehender lokaler Verträge (optional manueller Import).
- **Priorität:** **P2**
- **Abhängigkeiten:** Security/Storage Policies.
- **Definition of Done:**
  - Vertragsliste ist user-/device-übergreifend identisch.
  - Audit-Log pro Vertragsänderung vorhanden.

### 2.4 QA & Observability-Fundament
- **Ziel:** Verlässliche Releases ohne Regressionen.
- **Root Cause:** Fehlende automatisierte E2E-/Smoke-Absicherung.
- **Betroffene Bereiche:** Gesamtes Produkt.
- **Konkrete technische Schritte:**
  1. E2E-Test-Suite (Login, Call ingest, Statuswechsel, Role gating).
  2. Error tracking (Sentry o.ä.) + strukturierte Logs.
  3. Betriebsmetriken: ingest success rate, lag, failed writes, auth failures.
- **Priorität:** **P2**
- **Abhängigkeiten:** Stabile Endpunkte und Testdaten.
- **Definition of Done:**
  - CI blockiert bei kritischen E2E-Fehlern.
  - Dashboards/Alerts für Kernmetriken aktiv.

---

## 3) Public-Launch-Readiness

### 3.1 Security Hardening & Compliance
- **Ziel:** Produktionsreife Sicherheitsbasis für externen Launch.
- **Root Cause:** Historische MVP-Trade-offs in Key/Role/Data-Handling.
- **Betroffene Bereiche:** Auth, Datenzugriff, Admin-Aktionen, Secrets.
- **Konkrete technische Schritte:**
  1. Finales Secret-Management + regelmäßige Key-Rotation-Policy.
  2. Security Review aller RLS Policies.
  3. Audit-Logging für privilegierte Aktionen.
  4. Incident Runbook + Access Review Prozess.
- **Priorität:** **P1**
- **Abhängigkeiten:** Abschluss serverseitiger Admin-APIs.
- **Definition of Done:**
  - Security-Review ohne kritische Findings.
  - Vollständige Nachvollziehbarkeit privilegierter Aktionen.

### 3.2 Produktqualität & Vertrauen (UX, Copy, IA)
- **Ziel:** Professioneller Marktauftritt und hohe Nutzerakzeptanz.
- **Root Cause:** Uneinheitliche UX zwischen Admin und Dashboard.
- **Betroffene Bereiche:** Login, Navigation, States, Copy, CTA.
- **Konkrete technische Schritte:**
  1. Design-System konsolidieren (Tokens, Komponenten, State Patterns).
  2. Einheitliche Terminologie für Calls/Leads/Status.
  3. Error/Empty/Loading States standardisieren.
- **Priorität:** **P2**
- **Abhängigkeiten:** UX-Review, Content-Freigabe.
- **Definition of Done:**
  - Konsistente UI/UX über beide Portale.
  - Weniger Support-Tickets durch bessere Verständlichkeit.

### 3.3 Skalierungs- und Betriebsreife
- **Ziel:** Stabiler Betrieb bei wachsender Kundenbasis.
- **Root Cause:** Aktuell begrenzte Skalierungs-/Operability-Mechaniken.
- **Betroffene Bereiche:** Query-Performance, Ingest-Pipeline, On-Call.
- **Konkrete technische Schritte:**
  1. Query-Profiling + Indexing + Pagination überall.
  2. Replay-Tool für fehlgeschlagene Ingest Events.
  3. SLO/SLA Definition (z. B. ingest freshness, uptime).
- **Priorität:** **P2**
- **Abhängigkeiten:** Metrics/Observability stack.
- **Definition of Done:**
  - Lasttests innerhalb SLA.
  - Betriebsprozesse für Störungen dokumentiert und geübt.

---

## Fokus-Tracking (explizit angefragte Themen)

| Fokuspunkt | Ebene | Zielstatus |
|---|---|---|
| Service-Role aus Frontend entfernen | Sofortmaßnahmen | P1 / Muss vor Beta abgeschlossen |
| Single Source of Truth festlegen | Sofortmaßnahmen | P1 / Architekturentscheidung + Umsetzungspfad |
| Admin von Airtable auf Supabase migrieren | Sofortmaßnahmen + Beta | P1 / Core-Flows komplett auf Supabase |
| ID-/Customer-Modell vereinheitlichen | Sofortmaßnahmen | P1 / UUID-FK Modell produktiv |
| Make-Ingest robust auf Supabase standardisieren | Sofortmaßnahmen + Beta | P1 / idempotent, retry, DLQ |
| `public.users` Provisionierung automatisieren | Sofortmaßnahmen | P1 / 0 fehlende User-Zuordnungen |
| Admin Login UX/UI professionalisieren | Sofortmaßnahmen | P2 / visuell + funktional konsistent |

---

## Empfohlene Reihenfolge (konkret)
1. **Security Freeze:** Service-Key raus + Rotation (1.1)
2. **Data Governance:** SSOT-Entscheid + ID-Modell fixieren (1.2 + 1.4)
3. **Ingest Reliability:** Make→Supabase robust machen (1.5)
4. **Provisioning Safety:** `public.users` Automatisierung (1.6)
5. **Admin Data Migration:** Airtable Core-Flows ablösen (1.3, dann 2.1)
6. **UX Professionalisierung:** Admin Login & konsistente States (1.7, 3.2)
7. **Operational Excellence:** Tests, Monitoring, Realtime, SLA (2.2, 2.4, 3.3)
