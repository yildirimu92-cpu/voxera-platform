# Voxera Product-Readiness Audit (2026-04-02)

## 1. Executive Summary
- **Gesamturteil:** Das Produkt ist in einem **funktional nutzbaren, aber nicht launchreifen** Zustand. Das Customer Dashboard arbeitet direkt auf Supabase-Tabellen (`users`, `customers`, `calls`), während das Admin Portal weiterhin primär Airtable als operative Datenquelle verwendet.
- **Reifegrad:** **MVP-/Pre-Beta**. Für einen verlässlichen SaaS-Launch fehlen konsistente Datenquellen, gehärtete Security-Patterns und robuste End-to-End-Observability.
- **Größte Risiken:**
  1) Data split-brain (Dashboard auf Supabase, Admin auf Airtable),
  2) Service-Role-Key im Frontend,
  3) fehlender verifizierbarer Make/Ingress-Flow im Repo,
  4) unsaubere ID-Semantik (`id`, `customer_id`, `dashboard_id`, `Voxera_Nummer`).
- **Größte Stärken:**
  - Dashboard hat solide UX-Basis (KPI, Status, Follow-up, Recovery-Flows),
  - role-gesteuerte Admin-UI vorhanden,
  - klare Nutzerführung in Teilen (Setup-Wizard, Loading/Empty/Error States).

## 2. System Map
### Ist-Zustand
- **Customer Dashboard**
  - Auth + Datenzugriff direkt via Supabase JS Client.
  - Nutzt Tabellen: `users`, `customers`, `calls`.
  - Query-Kette: `auth.user.id` → `users.customer_id` (optional URL-Fallback) → `customers` → `calls`.
- **Admin Portal**
  - Auth (Session/Role-Check) über Supabase (`admins`).
  - Business-Daten (Kunden/Calls/Stats) kommen aus Airtable API (`AT_BASE`, `AT_KUND`, `AT_CALL`).
  - Zusätzlich lokale Vertragsspeicherung im Browser (`localStorage`), nicht serverseitig.
- **Make / Inbound Call Flow**
  - Im Repo keine Make-Szenarien, Webhook-Spezifikationen oder Event-Retry-Strategien vorhanden.
  - Es ist nicht belegbar, ob Calls zuerst in Airtable oder Supabase landen (oder doppelt/inkonsistent).

### Kritische Abhängigkeiten
1. Supabase Auth + RLS für Dashboard.
2. Airtable API + Token-Verfügbarkeit für Admin Operatives.
3. Konsistente ID-Mappings zwischen Airtable-Feldern und Supabase-Feldern.
4. Netlify Routing-Konfiguration für Admin muss korrekt sein.

## 3. Kritische Probleme (P1)
1. **Service-Role-Key im Client-seitigen Admin-Code**
   - Root Cause: `SB_SVC` ist direkt in `admin-panel/index.html` hinterlegt und wird im Browser initialisiert.
   - Risiko: Vollzugriff auf Supabase (Bypass RLS) bei Key-Leak (in diesem Modell praktisch public).
   - Fix: Sofort auf serverseitige Functions/API umstellen (Netlify Functions/Edge Functions), alle privilegierten Aktionen dort kapseln; Key rotieren.

2. **Split-Brain Datenmodell (Supabase vs Airtable)**
   - Root Cause: Dashboard liest `customers`/`calls` aus Supabase, Admin liest Kunden/Calls aus Airtable.
   - Risiko: Lead/Call-Verlust, inkonsistente Kennzahlen, Support-Inkonsistenzen, fehlendes Single Source of Truth.
   - Fix: Eine primäre Datenquelle definieren (empfohlen Supabase), Admin-Datenzugriffe vollständig migrieren.

3. **Admin-Neukundenanlage erzeugt inkonsistente Identitäten**
   - Root Cause: `user_metadata.customer_id` wird mit Telefonnummer (`nr`) gesetzt, Airtable `customer_id` separat generiert (`cid`).
   - Risiko: Dashboard-Context-Auflösung kann am falschen Schlüssel hängen; falsche Kundenzuordnung möglich.
   - Fix: Canonical key einführen (`customers.id` UUID), `users.customer_id` als FK nur auf diesen Wert.

4. **Netlify Redirect im Admin Portal wirkt fehlerhaft**
   - Root Cause: `_redirects` enthält `/* /admin 200` statt `/* /index.html 200`.
   - Risiko: Deep Links/Reloads brechen, Login-/Session-Flow instabil.
   - Fix: Redirect auf `index.html` korrigieren und Deploy prüfen.

5. **Keine nachweisbare E2E-Call-Persistenz im Repo**
   - Root Cause: Keine Make-Workflow-Definitionen, keine Ingest-Contracts, keine Replay/Retry-Prozesse versioniert.
   - Risiko: Calls können verloren gehen, ohne forensische Nachverfolgbarkeit.
   - Fix: Ingest-Vertrag (Schema + idempotency key + retry policy + DLQ) dokumentieren und versionieren.

## 4. Wichtige Probleme (P2)
1. **Admin-Portal speichert Verträge nur in `localStorage`** → nicht teamfähig, nicht revisionssicher.
2. **Rollenkontrolle überwiegend UI-basiert** (Tabs/Buttons verstecken), kein expliziter serverseitiger Capability-Layer sichtbar.
3. **Unklare Tabellen-Nomenklatur** (`calls` im Dashboard, `call_logs` im README erwähnt).
4. **Fehlende Nutzung von `admin_emails` und `feature_flags` im Frontend** (keine sichtbare Produktlogik daran gekoppelt).
5. **Auto-Refresh nur polling-basiert (120s)** ohne Realtime-Subscriptions.
6. **Fehlende robust dokumentierte Fehlerbehandlung bei Write-Fails** (z. B. Retry/Backoff/User-Hinweise standardisiert).

## 5. Verbesserungen (P3)
1. Einheitliches Domain-Modell inkl. Typdefinitionen und Feld-Glossar.
2. Event-Timeline pro Call (ingested → enriched → assigned → closed).
3. Striktere Phone-Normalisierung (E.164-only, canonical storage + display formatter).
4. SLA-Monitoring (ingest lag, processing lag, sync lag).
5. Feature Flags für progressive Rollouts (derzeit im UI nicht integriert).
6. Accessibility + mobile UX Feinschliff im Admin (derzeit stark Desktop-first).

## 6. Customer Dashboard Audit
### Funktionsprüfung
- Login, Passwort-Reset, Session-Recovery sind vorhanden.
- Kundenkontext wird via `users.customer_id` aufgelöst; optional URL-Fallback `?customer=`.
- Calls werden auf `calls.customer_id` gefiltert.
- Dashboard bietet KPI/Filter/Follow-up/Archiv/Settings/Setup-Wizard.

### Datenprüfung
- Abhängigkeit: `users.customer_id` muss konsistent auf `customers.id` oder `customers.dashboard_id` zeigen.
- Fallback auf URL-Parameter ist praktisch für Debug, aber produktiv missbrauchbar, falls RLS nicht strikt ist.

### UX/UI-Beurteilung
- Positiv: gute visuelle Struktur, brauchbare Empty/Error States, klare CTA im Alltag.
- Schwächen: Keine harte Transparenz zu „letztes erfolgreiches Sync-Event“, keine ingest health indicators.

### Konkrete Schwächen
- Keine Realtime-Subscription, nur Polling.
- Potenzieller Overfetch/Limits (`limit(500)`), kein Paging.
- Uneinheitliche Feldnamen zwischen Quellen erschweren verlässliche UI-Interpretation.

## 7. Admin Portal Audit
### Funktionsprüfung
- Login + Admin-Check via `admins` vorhanden.
- Kundenverwaltung, Stats, Call Log, Admin-Verwaltung grundsätzlich vorhanden.
- Kunden- und Call-Daten jedoch aus Airtable, nicht Supabase.

### Datenprüfung
- Neukundenprozess erstellt Supabase Auth User, aber Kundenstammdaten in Airtable.
- Verträge werden lokal im Browser gespeichert.

### UX/UI-Beurteilung
- Positiv: strukturierte Sektionen, brauchbare Tabellen-/Kartenansicht.
- Schwächen: Informationsarchitektur vermischt operative Kernprozesse mit lokalen Mock-artigen Teilen (Verträge localStorage).

### Konkrete Schwächen
- Security-Architektur nicht launchfähig (Service-Key im Client).
- Data source mismatch gegenüber Dashboard.
- Support-Role Restriction primär visuell, nicht hart durch Backend-Aktionen sichtbar.

## 8. Datenmodell- und Sync-Audit
### Beobachtete Tabellen-/Objekt-Nutzung
- Aktiv genutzt im Dashboard: `users`, `customers`, `calls`.
- Aktiv genutzt im Admin (Supabase): `admins`.
- Aktiv genutzt im Admin (Airtable): Kunden/Calls.
- Nicht sichtbar genutzt: `admin_emails`, `feature_flags`.

### Customer-Auflösung
- `auth.user.id` → `users.customer_id`.
- Danach Lookup in `customers` zuerst über `id`, fallback über `dashboard_id`.
- Hohe Fragilität bei gemischten ID-Typen (UUID vs Nummer vs Telefon).

### Call-Synchronisierung
- Dashboard: `calls` nach `customer_id`.
- Admin: Airtable `called_number`/Kundenfelder.
- Ergebnis: Keine garantierte synchrone Datenrealität.

### Konsistenzprobleme
- Feldbenennung (`Voxera_Nummer`, `Dashboard_id`, `customer_id`, `id`) ist inkonsistent.
- README nennt `call_logs`, Dashboard-Code nutzt `calls`.

## 9. End-to-End Testplan
1. **Auth segregation test**: Customer-User darf keine Admin-Routen/Actions ausführen.
2. **Customer mapping test**: `users.customer_id` absichtlich falsch setzen → Dashboard muss klaren Fehler + Recovery zeigen.
3. **Call ingest happy path**: Synthetic call event erzeugen, Persistenz in primärer DB verifizieren, Sichtbarkeit in Dashboard + Admin vergleichen.
4. **Call ingest failure**: Make-Webhook 500 simulieren, retry + alerting prüfen.
5. **Duplicate event test**: identische Event-ID zweimal senden, genau 1 Datensatz erwarten.
6. **Phone normalization test**: gleiche Nummer in Varianten (+41…, 0041…, mit Leerzeichen) muss 1 Kunde bleiben.
7. **Session expiry test**: Token-Ablauf während Update, erwartete Re-Auth + keine stillen Datenverluste.
8. **Role mutation test**: Admin-Rolle zur Laufzeit ändern, UI und Berechtigungen sofort konsistent.
9. **Load test read path**: >10k Calls Kunde, Paging/Filter/Latency verifizieren.
10. **Cross-surface consistency**: 20 zufällige Calls stichprobenartig zwischen Admin und Dashboard 1:1 matchen.

## 10. Launch Checklist
### Sofort
1. Service-Role-Key aus Frontend entfernen und rotieren.
2. SSOT festlegen (Supabase empfohlen), Admin von Airtable entkoppeln oder sauber synchronisieren.
3. Canonical IDs/FKs definieren und migrieren.
4. Admin Redirect fixen.
5. Ingest-Vertrag + Monitoring + Alerting einführen.

### Vor Beta
6. Realtime- oder kurzzyklische eventbasierte Sync-Strategie einführen.
7. Verträge serverseitig persistieren.
8. Fehler- und Recovery-Patterns vereinheitlichen.
9. QA-Testmatrix automatisieren (smoke + E2E).

### Vor Public Launch
10. Vollständiges Security Hardening (Secrets, CSP, Audit Logs, RBAC Enforcement, Incident Runbooks).

## 11. Empfohlene Produktverbesserungen
1. **Trust Layer:** „Systemzustand/letzter Sync/letzte erfolgreiche Ingestion“ prominent zeigen.
2. **Operational Clarity:** Einheitliches Statusmodell für Calls (neu, in Bearbeitung, callback due, done).
3. **Guided UX:** In-App Playbooks für Rückrufbearbeitung und Lead-Qualifizierung.
4. **Admin Intelligence:** Team-KPIs, SLA-Verletzungen, Queue-Warnungen.
5. **Growth Hooks:** Upgrade-Flows mit messbarer Conversion statt reinem Mailto.
6. **Retention:** Wöchentliche automatisch generierte Value Reports für Kunden.
7. **Professionalität:** Einheitliche Terminologie zwischen Dashboard/Admin (Feldnamen, Labels, Status).
8. **Auditability:** Jede kritische Änderung mit Actor + Timestamp + Before/After loggen.
9. **Scalability:** Serverseitiges Pagination/Search/Indexing für Calls.
10. **Reliability:** Dead-letter Queue + Replay Tooling für fehlerhafte Inbound-Events.

---

## Top-10 Must-Fix vor Launch (kompakt)
1. Service key exposure entfernen.
2. SSOT durchsetzen (kein Split Brain).
3. ID/FK-Modell vereinheitlichen.
4. End-to-end Ingest Monitoring + Alerts.
5. Make Retry/Idempotency/DLQ.
6. Admin Redirect reparieren.
7. Verträge aus localStorage herauslösen.
8. Role Enforcement serverseitig härten.
9. Realtime/Sync-Lag Sichtbarkeit ergänzen.
10. Konsistente Feld-/Tabellennamen im gesamten Produkt.
