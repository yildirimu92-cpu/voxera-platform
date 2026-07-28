# Voxera – Baseline Supabase Schema State

**Repository-Baseline:** `main@682b88cbc16deb259f6f513de02b7bdc9fc255ab`

## Statusdefinitionen

- **VERIFIZIERT** – direkt anhand des GitHub-Repository-Zustands oder eines konkret gelesenen Repository-Artefakts bestätigt.
- **AUS REPOSITORY ABGELEITET** – aus Code, Konfiguration oder Dokumentation ableitbar, aber nicht als produktiver Laufzeitstatus bestätigt.
- **NICHT VERIFIZIERT** – mit den verfügbaren Zugängen nicht technisch bestätigt.
- **LIVE-ZUGRIFF ERFORDERLICH** – kann nur über das jeweilige Netlify- oder Supabase-Dashboard beziehungsweise dessen API/CLI verifiziert werden.

Repository-Funde sind ausdrücklich **kein Nachweis**, dass eine Komponente aktuell produktiv deployt, konfiguriert oder ausgeführt wird.

## 1. Projektidentifikation

| Punkt | Status | Ergebnis |
|---|---|---|
| im Frontend referenzierter Project Ref | AUS REPOSITORY ABGELEITET | `ulcofbgrovgcvowdjrge` |
| produktives Supabase-Projekt | NICHT VERIFIZIERT | Repository-Referenz ist kein Live-Nachweis |
| separate Development-/Staging-Projekte | NICHT VERIFIZIERT | LIVE-ZUGRIFF ERFORDERLICH |
| Project URL / Public Anon-Konfiguration im Browser | VERIFIZIERT als Codefund | Werte werden in dieser Dokumentation nicht wiedergegeben |

Der Project Ref ist öffentlich ableitbar. Secret-, Service-Role- oder Token-Werte wurden nicht dokumentiert.

## 2. Im Code erwartete Tabellen

Die folgende Liste ist **AUS REPOSITORY ABGELEITET**. Sie beschreibt Tabellen, die Code oder Repository-Dokumente ansprechen; sie bestätigt nicht deren Existenz im Live-Schema.

### Kern- und Auth-Zuordnung

- `customers`
- `users`
- `admins`
- `calls`
- `cases`
- `onboarding`

### Kommerzielle Domänen

- `subscriptions`
- `offers`
- `contracts`
- `invoices`
- `invoice_items`
- `offer_events`

### Konfiguration und AI

- `plan_config`
- `system_config`
- `industry_templates`
- `voxera_voices`
- `elevenlabs_sync_log`

### Benachrichtigung, Outbox und Betrieb

- `notifications`
- Outbox-/Webhook-Event-Tabellen gemäss Repository-SQL und `_lib/webhook-outbox`
- weitere Audit-/Timeline-Tabellen gemäss vorhandenen SQL-Dateien

## 3. Repository-Schema-Artefakte

**VERIFIZIERT**

Es existieren SQL-Dateien für unter anderem:

- Core Tabellen
- RLS-Härtung
- Admin-Rollen
- Vertrags- und Offertensystem
- Rechnungssystem und Compatibility Bridge
- Outbox Events und Retry-Support
- Cases
- Plan-/Addon-Konfiguration
- Notification-Zielfelder

Die Datei `2026-04-08_core_tables_schema_sot.sql` kennzeichnet selbst mehrere Felder als rekonstruiert oder „inferred“. Deshalb ist auch ihre DDL kein Beweis für das tatsächliche Live-Schema.

## 4. Migrationen

| Kategorie | Status |
|---|---|
| SQL-Dateien im Repository vorhanden | VERIFIZIERT |
| Dateien unter `supabase/migrations/` vorhanden | VERIFIZIERT |
| tatsächlich ausgeführte Migrationen | NICHT VERIFIZIERT |
| Reihenfolge der Ausführung | NICHT VERIFIZIERT |
| manuell im SQL Editor vorgenommene Änderungen | NICHT VERIFIZIERT |
| Abgleich Repository ↔ Live-Schema | LIVE-ZUGRIFF ERFORDERLICH |

Es wird ausdrücklich **nicht** angenommen, dass eine Migration ausgeführt wurde, nur weil eine SQL-Datei vorhanden ist.

## 5. RLS und Policies

**AUS REPOSITORY ABGELEITET**

- Repository-Dokumente definieren Supabase als SSOT.
- SQL-Dateien zur RLS-Härtung sind vorhanden.
- Browseranwendungen greifen direkt über Supabase JS zu und benötigen daher wirksame RLS-Policies.

**NICHT VERIFIZIERT**

- RLS-Status je Live-Tabelle
- konkrete Policies
- Rollen und Grants
- Policies für Views
- Policies für `storage.objects`
- Wirksamkeit der Tenant-Isolation

## 6. Auth-Zuordnung

**AUS REPOSITORY ABGELEITET**

Der Code beziehungsweise das Governance-DDL erwartet unter anderem:

- `users.id` ↔ `auth.users.id`
- `admins.id` ↔ `auth.users.id`
- `users.customer_id` ↔ `customers.id`
- optional `customers.auth_user_id` ↔ `auth.users.id`

**NICHT VERIFIZIERT**

- Vollständigkeit und Eindeutigkeit der Live-Zuordnungen
- verwaiste Auth-Benutzer
- verwaiste `users`-/`admins`-Rows
- Redirect- und Invite-Konfiguration
- Passwort-, Session- und JWT-Einstellungen

## 7. Storage

**AUS REPOSITORY ABGELEITET**

Die Offerten-Mail-Function lädt optional ein AVV-PDF aus Supabase Storage. Erwartet werden:

- Bucket über `AVV_PDF_BUCKET`, Defaultname `legal`
- Pfad über `AVV_PDF_PATH`, Default `documents/avv-voxera.pdf`

**NICHT VERIFIZIERT**

- ob der Bucket existiert
- ob das Objekt existiert
- Bucket-Sichtbarkeit
- Storage Policies
- weitere Buckets

## 8. Views, Database Functions, Trigger und Extensions

| Objektart | Status |
|---|---|
| Views | NICHT VERIFIZIERT |
| Database Functions / RPCs | NICHT VERIFIZIERT |
| Trigger | NICHT VERIFIZIERT |
| verwendete Extensions | NICHT VERIFIZIERT |
| Cron Jobs in Supabase | NICHT VERIFIZIERT |

Repository-SQL kann Definitionen enthalten; der Live-Status muss direkt im Projekt bestätigt werden.

## 9. Edge Functions

- Beobachtete Serverfunktionen im Repository laufen als Netlify Functions: **VERIFIZIERT als Repository-Struktur**.
- Aktive Supabase Edge Functions: **NICHT VERIFIZIERT**.
- Aussage „alle Serverfunktionen laufen ausschliesslich über Netlify“: **NICHT VERIFIZIERT**, bis das Supabase-Dashboard geprüft ist.

## 10. Alte oder nicht verwendete Tabellen

**NICHT VERIFIZIERT**

Ohne Live-Tabellenliste, Row Counts, Abhängigkeiten und Query-Telemetrie kann nicht bestimmt werden, welche Tabellen alt oder ungenutzt sind.
