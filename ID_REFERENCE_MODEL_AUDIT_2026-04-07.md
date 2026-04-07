# Voxera ID- und Referenzmodell-Audit (Stand: 2026-04-07)

## 1) Executive Summary

Dieses Audit zeigt: Voxera hat bereits einen **klaren Kernpfad** für Tenant-Isolation über `users.id (auth.uid) -> users.customer_id -> customers.id`, aber weiterhin mehrere konkurrierende oder nicht vollständig gehärtete ID-Pfade.

**Positiv / stabil**
- Kundenzuordnung im Customer-Dashboard und in Customer-Functions basiert konsistent auf `users.customer_id`, abgesichert durch RLS-Hilfsfunktion `current_customer_id()`.  
- Neue Outbox-Infrastruktur ist vorhanden (`outbox_events` inkl. Retry, Dedupe für Contract-Webhook, RLS-Härtung).
- `create-customer` setzt inzwischen sowohl `customers.auth_user_id` als auch `users.id/customer_id` und rollt bei Fehlern zurück.

**Kritische Befunde (Launch-relevant)**
1. **Duale Identität bei Customer-Auflösung im Frontend**: Dashboard fällt von `users.customer_id` auf URL-Parameter und danach auf `customers.dashboard_id` zurück. Das ist ein konkurrierender Identitätsmechanismus.  
2. **Kein vollständiges kanonisches Schema im Repo** für Kern-Tabellen (`customers`, `users`, `calls`, `cases`, `onboarding`) – PK/FK-Vollständigkeit kann nur partiell verifiziert werden.  
3. **Referenzmodell outbox_events mit Legacy-Fallback im Runtime-Code** (`attempts`, `processed_at`) vs. modernes Schema (`retry_count`, `last_attempt_at`, `dead_lettered_at`, `dedupe_key`) → semantische Doppelspur.
4. **Namens-/Semantikdrift bei Case- und Contract-Feldern** (`title` vs `type`, `note` vs `notes`, `months`/`end_date` in UI-Mapping vs SQL `duration_months`).

**Empfohlene kanonische Linie (Zielmodell)**
- Interne technische PKs: `customers.id` (text), `users.id` (uuid=auth user id), fachliche Tabellen bevorzugt UUID-PKs (`calls.id`, `cases.id`, `contracts.id`, `subscriptions.id`, `onboarding.id`, `outbox_events.id`).
- Tenant-FK immer explizit `customer_id -> customers.id`.
- Public/Business IDs separat und niemals als FK: z. B. `dashboard_id`, `voxera_number`, externe `contract_id` aus Integrationen.
- Eindeutige Namenskonvention: `*_id` nur für tatsächliche IDs; externe IDs immer `external_*_id`.

---

## 2) Entitäten: IDs, Referenzen, Nutzung in Frontend/Functions/Webhooks

> Hinweis: Für mehrere Basistabellen fehlen CREATE-TABLE-Migrationen im Repo; Felder/PK/FK sind dort als **inferred** markiert, wenn aus Code/RLS eindeutig ableitbar, aber nicht formal im DDL sichtbar.

### 2.1 `customers`

- **PK**: `id` (inferred: `text`, genutzt als kanonische Customer-ID in nahezu allen Flows).
- **Alternative IDs**:
  - `dashboard_id` (Business-/UI-ID; kein nachweisbarer FK).
  - `voxera_number` (Business-Nummer).
- **Weitere ID-nahe Felder**:
  - `auth_user_id` (direkter Link auf Auth-User; technisch Redundanz zu `users.id`-Mapping).
  - `subscription_id` (`uuid` FK laut SQL auf `subscriptions.id`).
- **FKs**:
  - Nachgewiesen: `customers.subscription_id -> subscriptions.id`.
- **Frontend-Nutzung**:
  - Customer-Dashboard lädt Customer primär via `id`, fallback via `dashboard_id`.
  - Admin-Panel aktualisiert Customer über `.eq('id', customerId)`.
- **Netlify-Functions-Nutzung**:
  - Zentral in `create-customer`, `activate-subscription`, `send-customer-access`, `customer-status-update`, `customer-archive`, Delete-Flows.
- **Webhook-/Integrationsnutzung**:
  - `customer_id` wird in Welcome-/Reset-, Case- und Contract-Payloads in Outbox/Webhooks mitgegeben.

### 2.2 `users`

- **PK**: `id` (`uuid`, gespiegelt aus `auth.users.id`).
- **FK**:
  - `customer_id -> customers.id` (inferred, stark aus RLS/Funktionslogik abgeleitet).
- **Alternative IDs**: keine fachliche Business-ID.
- **Frontend-Nutzung**:
  - Customer-Dashboard resolved tenant via `users.id = auth user id`, liest `customer_id`.
- **Netlify-Functions-Nutzung**:
  - `requireCustomerCaller` erzwingt `users.customer_id` als Customer-Kontext.
  - `create-customer` legt `users`-Zeile aktiv an.
  - Hard-Delete-Funktionen nutzen `users` als primären Lookup für Auth-User.
- **Webhook-/Integrationsnutzung**:
  - indirekt (Kontextgeber), nicht direkt als Payload-ID.

### 2.3 `calls`

- **PK**: `id` (inferred; in Customer-Functions als `call_id` referenziert).
- **FK**:
  - `customer_id -> customers.id` (inferred + RLS-Predicate).
- **Alternative IDs**: keine dokumentierten externen IDs.
- **Frontend-Nutzung**:
  - Customer-Dashboard filtert strikt per `customer_id`.
  - Admin-Panel mappt `dbRow.id` + `dbRow.customer_id`.
- **Netlify-Functions-Nutzung**:
  - `call-update-status`/`call-save-followup` prüfen Besitz über `call.customer_id === caller.customerId`.
- **Webhook-/Integrationsnutzung**:
  - derzeit keine direkte Outbox-Nutzung für Calls.

### 2.4 `subscriptions`

- **PK**: `id` (`uuid`, SQL belegt).
- **FKs**:
  - `customer_id text NOT NULL UNIQUE -> customers(id)`.
- **Alternative IDs**: keine externen IDs.
- **Besonderheit**:
  - `customer_id` ist aktuell UNIQUE (1 aktive Subscription je Kunde).
- **Frontend-Nutzung**:
  - indirekt über `customers.subscription_id`.
- **Netlify-Functions-Nutzung**:
  - `activate-subscription` upsertet über `onConflict: 'customer_id'`.
  - Delete-Flows löschen über `customer_id`.

### 2.5 `contracts`

- **PK**: `id` (`uuid`, SQL belegt).
- **FKs**:
  - `customer_id -> customers(id)`.
  - `subscription_id -> subscriptions(id)`.
- **Alternative IDs / externe IDs**:
  - In Webhook-Flow existiert `contract_id` als Payload-Feld (externe/fachliche Referenz), nicht identisch mit notwendigerweise `contracts.id`.
- **Frontend-Nutzung**:
  - Admin-Panel schreibt/liest `contracts` per `id` + `customer_id`.
- **Netlify-Functions-Nutzung**:
  - Delete-Flows löschen nach `customer_id`.
  - `contract-signed` nutzt `contract_id` im Event-Dedupe (`dedupe_key = contract_signed:<contract_id>`), nicht FK-validiert gegen `contracts.id`.
- **Webhook-/Integrationsnutzung**:
  - Vertragssignatur läuft über Outbox-Event `contract_signed_notification`.

### 2.6 `cases`

- **PK**: `id` (inferred).
- **FK**:
  - `customer_id -> customers.id` (inferred + RLS-Predicate).
- **Alternative IDs**:
  - `case_id` als API-Eingabe in `cases-update` (entspricht `cases.id`).
- **Semantik-Drift**:
  - Legacy-Spalten/Felder `type`/`notes` vs. kanonisch `title`/`note`.
- **Frontend-Nutzung**:
  - Admin-Panel mappt `id`, `customer_id`, mit Fallback auf Legacy-Felder.
- **Netlify-Functions-Nutzung**:
  - `cases-create` (insert), `cases-update` (update per `case_id`).
- **Webhook-/Integrationsnutzung**:
  - optionales Case-Mail-Event via Outbox `case_mail_notification`.

### 2.7 `onboarding`

- **PK**: `id` (UUID in `create-customer` generiert; inferred).
- **FK**:
  - `customer_id -> customers.id` (inferred + RLS-Predicate).
- **Alternative IDs**: keine.
- **Frontend-Nutzung**:
  - Admin-Panel lädt onboarding rows und joint in-memory per `customer_id`.
- **Netlify-Functions-Nutzung**:
  - `create-customer` legt Row mit eigener `onboarding.id` an.
  - `onboarding-update` sucht per `customer_id` und updated per `id`.

### 2.8 `outbox_events`

- **PK**: `id` (`uuid`, SQL belegt).
- **FKs**: keine; nur payload-basierte Referenzen (`customer_id`, `contract_id` etc. in JSON).
- **Alternative IDs**:
  - `dedupe_key` (technischer Idempotenzschlüssel, z. B. für Contract-Signed).
- **Status-/Versuchsfelder**:
  - modern: `retry_count`, `last_attempt_at`, `dead_lettered_at`.
  - Legacy-Fallback im Code: `attempts`, `processed_at`.
- **Frontend-Nutzung**: keine.
- **Netlify-Functions-/Integrationsnutzung**:
  - `send-customer-access`, `cases-create`, `contract-signed`, Retry-Worker sowie `_lib/webhook-outbox`.

### 2.9 `admins`

- **PK**: `id` (inferred UUID auf Auth-User).
- **FKs**: nicht sichtbar im DDL-Ausschnitt.
- **Relevanz**:
  - dient für Admin-Authorisierung via `is_admin()`; damit indirekt sicherheitsrelevant für alle ID-bezogenen Admin-Schreibpfade.

---

## 3) Hauptprobleme / Inkonsistenzen

### A. Mehrere konkurrierende IDs für Customer-Kontext (hoch)
- Kanonischer Kontext ist `users.customer_id`.
- Dashboard enthält aber Fallback-Kette: `users.customer_id` -> URL-Parameter `?customer=` -> Lookup `customers.dashboard_id`.
- Ergebnis: Semantisch existieren mindestens zwei „entry IDs“ (`customers.id` und `dashboard_id`) für denselben Tenant-Kontext.

### B. `auth_user_id` doppelt zur `users`-Zuordnung (mittel)
- `customers.auth_user_id` wird gesetzt und im Hard-Delete als Fallback genutzt.
- Parallel bleibt `users.id` der eigentliche Auth-Link.
- Ohne klare Priorität drohen Drift-Fälle (z. B. wenn nur eine Seite aktualisiert wird).

### C. Outbox-Schema modern vs. Legacy-Fallback im Code (mittel-hoch)
- Tabelle ist modern definiert; Utility-Layer unterstützt aber Legacy-Spaltenpfad.
- Das erhöht Betriebskomplexität und macht Monitoring/Metriken semantisch unklar.

### D. Vertrags-ID-Semantik uneinheitlich (mittel)
- `contract-signed` dedupliziert auf externem `contract_id` aus Request-Payload.
- Keine harte Kopplung/Validierung, dass dieses `contract_id` tatsächlich `contracts.id` ist.
- Risiko für falsche Dedupe-Domäne bei Integrationsfehlern.

### E. Case-Feld-Duplikate (`title/note` vs. `type/notes`) (mittel)
- SQL-Backfill existiert, UI und Functions enthalten weiterhin Legacy-Fallbacks.
- Semantische Mehrdeutigkeit und unnötige Transformationslogik.

### F. Fehlende vollständige DDL-Quelle für Kerntabellen (hoch, governance)
- Im Repo fehlen CREATE TABLE-Definitionen für `customers/users/calls/cases/onboarding/admins`.
- Damit ist formale Verifikation von PK/FK/Unique/Not-Null nicht vollständig möglich.

### G. Dokumentationsmismatch Tabellenname (`call_logs` vs `calls`) (niedrig-mittel)
- `customer-dashboard/readme.md` nennt `call_logs`, Runtime-Code nutzt `calls`.

---

## 4) Empfohlenes Zielmodell (CTO-tauglich)

### 4.1 Kanonische ID-Typen
- `customers.id`: **Tenant Primary Key** (stabil, nicht sprechend, vorzugsweise UUID/ULID langfristig; kurzfristig Bestandsschutz möglich).
- `users.id`: **Auth Principal Key** = `auth.users.id` (uuid, 1:1).
- Fachtabellen-PKs: UUID (`calls.id`, `cases.id`, `contracts.id`, `subscriptions.id`, `onboarding.id`, `outbox_events.id`).

### 4.2 Referenzregeln
1. Jede Tenant-bezogene Tabelle hat `customer_id NOT NULL REFERENCES customers(id)`.
2. Kein Business-Identifier (`dashboard_id`, `voxera_number`, `contract_number`) darf FK-Ziel sein.
3. `customers.auth_user_id` nur erlaubt, wenn als **read-only mirror** mit Konsistenzgarantie; sonst entfernen und nur `users` nutzen.

### 4.3 Public Business Numbers vs. External IDs
- `dashboard_id`, `voxera_number`: öffentliche/fachliche IDs, eigene Unique-Constraints, aber nie Tenant-Ownership-Schlüssel.
- Externe IDs immer präfixen, z. B. `external_contract_id`, `external_case_id`, `provider_event_id`.
- Outbox-Payloads müssen `customer_id` (intern) plus optionale `external_*` Felder enthalten.

### 4.4 Namenskonventionen
- Interne PK: `id`.
- FK: `<entity>_id` (immer interner PK-Typ).
- Externe IDs: `external_<entity>_id`.
- Business-Nummern: `<domain>_number` oder `<domain>_code` (z. B. `voxera_number`).

### 4.5 RLS-/Security-Leitlinie
- Tenant-Zugriff immer über `current_customer_id()` und FK `customer_id`.
- Jegliche Kontext-Fallbacks im Browser (URL/dashboard_id) nur für Diagnose-Tools und in Produktion deaktiviert.

---

## 5) Sofortmaßnahmen vor Launch (priorisiert)

### P0 (echte Launch-Blocker)
1. **Customer-Context-Fallback im Dashboard entfernen/härten**
   - Kein produktiver Fallback von `users.customer_id` auf URL/dashboard_id.
   - Falls Debug nötig: strikt über Feature-Flag + nur Admin-Session.
2. **Schema-Source-of-Truth schließen**
   - Fehlende CREATE TABLE-Migrationen für `customers/users/calls/cases/onboarding/admins` ins Repo aufnehmen.
   - Danach FK/Unique/Not-Null automatisiert prüfen (CI-Check).

### P1 (sofort danach)
3. **Outbox Legacy-Fallback planvoll entfernen**
   - Nach verifiziertem Rollout aller DBs auf modernes Schema: `_lib/webhook-outbox` ohne `attempts/processed_at` fallback.
4. **Contract-ID-Kanonik klären**
   - `contract-signed` soll `contracts.id` explizit erwarten **oder** Feld in `external_contract_id` umbenennen und dokumentieren.

### P2 (Launch+)
5. **Case-Legacyfelder bereinigen** (`type/notes` deprecaten, nur `title/note`).
6. **Doku-Korrektur `call_logs` -> `calls`**.

---

## 6) Mittelfristige Bereinigung nach Launch

1. **ID-Registry-Dokument** (verbindliche interne Norm)
   - je Entität: PK, FK, Business-ID, External-ID, Ownership-Spalte, RLS-Regel.
2. **Schema-Drift-Tests in CI**
   - SQL-Assertions auf FK-Integrität, Unique von Business IDs, Nullability, Type-Checks.
3. **Migrationspfad für `customers.id` auf UUID/ULID (optional)**
   - nur wenn Partner-Integrationen nicht auf aktuelle `cust_*` Strings fixiert sind.
4. **Webhook-Verträge versionieren**
   - payload schema v1/v2, inklusive klarer Unterscheidung interner vs. externer IDs.
5. **Delete-/GDPR-Runbook**
   - harte Reihenfolge + Konsistenzcheck (users/auth/customers + abhängige Tabellen) als transaktionales oder kompensierbares Playbook.

---

## Belegstellen (Auszug aus Repo-Analyse)

- Provisionierungskette `auth.users.id -> users.id -> users.customer_id -> customers.id`: `2026-04-02_user_profile_provisioning.sql`.
- RLS-Ownership über `current_customer_id()` für `customers/calls/onboarding/cases`: `2026-04-06_rls_access_hardening.sql`.
- Subscriptions/Contracts FK-Modell inkl. `customers.subscription_id`: `2026-04-03_add_subscriptions_and_contracts.sql`.
- Outbox-Schema + Retry + Dedupe + Access-Hardening: `2026-04-07_webhook_outbox_events.sql`, `2026-04-07_outbox_retry_worker_support.sql`, `2026-04-07_contract_signed_idempotency.sql`, `2026-04-07_outbox_events_access_hardening.sql`.
- Customer-Kontext-Fallbacks im Dashboard (`users.customer_id`, URL, `dashboard_id`): `customer-dashboard/index.html`.
- Customer-/Case-/Contract-/Outbox-ID-Flows: Netlify Functions unter `admin-panel/netlify/functions/*` und `customer-dashboard/netlify/functions/*`.
