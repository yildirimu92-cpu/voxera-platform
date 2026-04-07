# Voxera Launch-Readiness Analyse (Codebasiert)

Datum: 2026-04-07  
Scope: `admin-panel`, `customer-dashboard`, `supabase/sql`

## Executive Summary

1. **No-Go in der aktuellen Form**: Es gibt mehrere High-Impact-Risiken in Security, Datenkonsistenz und Reliability.
2. **Outbox ist nicht launch-sicher**: Events werden zwar geschrieben, aber es gibt **keinen Retry-Worker** und **keine Dead-Letter-Strategie**.
3. **RLS-Lücke bei `outbox_events`**: Tabelle wird erstellt, aber ohne RLS/Policies – potenzieller Datenabfluss sensibler Payloads.
4. **Kritischer Aktivierungs-Flow-Bruch**: `create-customer` behandelt `users`-Insert als „non-fatal“, obwohl Customer-Funktionen diese Tabelle zwingend brauchen.
5. **Idempotenz fehlt bei kritischen Functions** (`send-customer-access`, `contract-signed`, `cases-create`) – Doppelklick/Retry erzeugt Duplikate.
6. **Teilweise stille Fehler in Kernflows**: z. B. `contract-signed` wird im UI „fire-and-forget“ ausgeführt und Fehler werden nur geloggt.
7. **Statuskonsistenz gefährdet**: Bei `send-customer-access` kann Mail erfolgreich sein, aber Statusupdate scheitern (inkonsistenter Lifecycle).
8. **Mehrere Funktionen erlauben Cross-Origin `*` mit Bearer-Auth** – unnötig große Angriffsfläche.
9. **Frontend enthält fest verdrahtete Supabase-URL + Anon-Key** (kein sauberes Env-Injection-Muster).
10. **Observability unzureichend**: JSON-Logs sind teilweise vorhanden, aber ohne zentrales Monitoring/Alerting.

---

## 1) Core User Flow (kritisch, End-to-End)

### Flow: Kunde erstellen → Onboarding → Zugang senden → Login → Calls

### Breakpoints

- **Kunde erstellt, aber kein `users`-Profil**: In `create-customer` ist `users`-Insert explizit „nicht fatal“. Gleichzeitig hängt `requireCustomerCaller` hart an `users.customer_id`. Ergebnis: Kunde kann später Dashboard-Functions nicht nutzen (403), obwohl Anlage „erfolgreich“ war.
- **Race auf E-Mail-Duplikat**: Duplikatcheck + danach Insert/Auth-Erstellung ist nicht transaktional. Bei parallelen Requests sind Kollisionen möglich.
- **Zugang gesendet, Status evtl. nicht aktualisiert**: Nach erfolgreichem Webhook wird `customers` aktualisiert; Fehler dort sind „nicht fatal“. System kann Mail versendet haben, aber UI/Lifecycle bleibt zurück.
- **Contract-Mail still fehlschlagend**: Vertragsanlage in UI ist erfolgreich, `contract-signed` läuft asynchron mit `.catch(console.warn)` ohne UX-Hinweis.

### Race Conditions

- Doppeltes Auslösen von `send-customer-access` erzeugt mehrere Recovery-Links/Mails.
- Doppeltes Auslösen von `cases-create` erzeugt Mehrfacheinträge + potenziell doppelte Mail-Trigger.
- `markOutboxFailed` erhöht Retry-Zähler Read-then-Write (nicht atomar), parallele Updates können inkonsistent zählen.

### Stille Fehler ohne UI-Feedback

- `contract-signed` Fehler werden in der UI nur `console.warn`-geloggt.
- `send-customer-access` kann „success=true“ liefern, obwohl Follow-up-Statusupdates scheitern.

---

## 2) Backend / Netlify Functions

## Gesamtbefund

- **Fehlerhandling**: besser als Durchschnitt, aber inkonsistent (teils strukturiert, teils plain console logs, teils non-fatal bei eigentlich fatalen Pfaden).
- **Logging**: Teilweise JSON-strukturiert (Outbox/Webhooks), viele Funktionen loggen unstrukturiert.
- **Rückgabewerte**: nicht überall konsistent (manchmal `success`, manchmal nur `error`; teils 200 trotz partieller Fehler).
- **Idempotenz**: bei den kritischen Launch-Pfaden nicht vorhanden.

### Spezifisch: `send-customer-access`

- Keine Idempotenz / kein dedupe-key (mehrfache Versand-Events möglich).
- `mark_activated` Action erlaubt direkten Statussprung ohne Verifikation eines echten Customer-Aktivierungsereignisses.
- `ACTIVATE_URL` Default auf `https://dashboard.voxera.ch` kann Aktivierungsroute verfehlen.

### Spezifisch: `contract-signed`

- Keine Idempotenz auf `contract_id`.
- Fehler werden serverseitig geloggt, aber im Frontend nicht blockierend behandelt.

### Spezifisch: `cases-create`

- Case-Insert und Mailversand sind nicht transaktional gekoppelt (bewusst), aber ohne dedupe/retry-Queue operational riskant.
- Bei fehlender `MAKE_CASE_WEBHOOK` wird Case trotzdem angelegt (geschäftlich evtl. okay, operativ riskant ohne Alert).

---

## 3) Database / Supabase

## RLS-Status

- RLS-Hardening existiert für `customers`, `users`, `calls`, `onboarding`, `cases`, `admins`.
- **Kritische Lücke**: `outbox_events` wird ohne RLS/Policies erstellt.

## Konsistenz Schema vs. Code

- Code nutzt `users.customer_id` als zentrale Zuordnung. Wenn der `users`-Insert scheitert, bricht Customer-Funktionalität.
- Outbox-Library enthält Legacy-Fallback (`attempts`, `processed_at`) und modernes Schema (`retry_count`, `last_error`) – robust gegen Drift, aber kompliziert.

## Foreign Keys

- `subscriptions.customer_id` und `contracts.customer_id` referenzieren `customers(id)`.
- Für Kern-Tabellen (`customers/users/calls`) sind im Repo keine vollständigen CREATE TABLE-Definitionen enthalten, daher kann FK-Vollständigkeit nur teilweise geprüft werden.

---

## 4) Outbox / Webhook-System

## Robustheit

- Positiv: Outbox-Write vor Webhook-Send in mehreren kritischen Flows.
- Negativ:
  - Kein automatischer Retry-Worker für `pending/failed` Events.
  - Keine Dead-Letter-Strategie.
  - Kein Exponential Backoff.
  - Kein dedupe-Key pro Business-Event.

**Ergebnis:** Gegen Netzwerkstörungen nur bedingt robust; Operational Recovery aktuell manuell.

---

## 5) Auth & Security

- **Hardcoded Supabase URL/Anon Key** in `admin-panel` und `customer-dashboard` HTML-Dateien.
- `SUPABASE_ANON_KEY` ist grundsätzlich public, aber Hardcoding erschwert Rotation, Stage/Prod-Trennung und Incident-Response.
- Viele Functions erlauben `Access-Control-Allow-Origin: *` bei Bearer-basierten Writes.
- Admin-Guard (`requireAdminCaller`) prüft JWT + `admins` Tabelle solide; Rollenmatrix wurde nachgezogen.

---

## 6) Environment / Deployment

- Wichtige Env-Variablen werden serverseitig meist geprüft (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`).
- Kritische Webhook-ENVs (`MAKE_WELCOME_WEBHOOK`, `MAKE_CONTRACT_WEBHOOK`, `MAKE_CASE_WEBHOOK`) sind optional behandelt, aber fehlende Werte führen teils nur zu Runtime-Fehlern statt Deploy-Block.
- `ACTIVATE_URL` hat einen generischen Fallback statt harter Pflichtkonfiguration.

---

## 7) Error Handling & Observability

- Es gibt strukturierte JSON-Logs in Webhook-Flows (gut).
- Es fehlt aber:
  - zentrales Error-Tracking (z. B. Sentry),
  - Alerting auf Outbox-Fehler,
  - Metriken (Success Rate, Retry Queue Age, P95 Function Latency).
- Mehrere Fehlerpfade sind „non-fatal“ und benötigen Alerting, aktuell nicht vorhanden.

---

## 8) UX / Activation Flow

- Positiv: Es gibt Frontend-Readiness-Prüfungen vor „Zugang senden“.
- Kritisch:
  - System erlaubt technisch trotzdem Mehrfachversand/Resets ohne dedupe.
  - Kein klarer hard-verified Aktivierungsnachweis (Admin kann Status manuell „mark_activated“ setzen).
  - Contract-Mail kann fehlschlagen ohne klare UI-Rückmeldung.
- Für „idiotensicher“ fehlt ein eindeutiger, auditierbarer Activation-State-Machine-Guard auf Backend-Ebene.

---

## 9) Performance & Scale (100+ Kunden)

- Aktuell wahrscheinlich funktional, aber Risiken steigen mit Volumen:
  - Outbox-Events akkumulieren ohne Worker.
  - Kein Batch-/Replay-Mechanismus für fehlgeschlagene Webhooks.
  - Mehrfacheinträge durch fehlende Idempotenz verursachen operative Last.

---

## 10) Top 10 Launch-Risiken (priorisiert)

| # | Risiko | Impact | Wahrscheinlichkeit | Konkrete Lösung |
|---|---|---|---|---|
| 1 | `users`-Insert ist „non-fatal“, bricht aber Customer-Funktionen | High | High | `create-customer` als Transaktion/Compensation härten; ohne `users` => hard fail + rollback |
| 2 | `outbox_events` ohne RLS | High | Medium | RLS aktivieren + nur service_role Zugriff |
| 3 | Kein Retry-Worker/Dead-Letter für Outbox | High | High | Scheduled Netlify Function/Cron + DLQ + Backoff |
| 4 | Keine Idempotenz bei `send-customer-access` | High | High | Idempotency-Key pro customer+action+timewindow; dedupe im DB-Layer |
| 5 | Keine Idempotenz bei `contract-signed` | High | Medium | Unique constraint/event key auf `contract_id` + dedupe |
| 6 | `cases-create` ohne dedupe | Medium | Medium | Client request-id + unique index + conflict-safe insert |
| 7 | Teilweise stille Fehler (contract webhook) | High | Medium | UI-Blocking/Error Toast + Retry CTA + Alerting |
| 8 | Lifecycle-Update nach Mailversand nicht atomar | Medium | Medium | Sende- und Statusänderungslogik mit Outbox-State koppeln |
| 9 | Hardcoded Supabase Keys/URLs im Frontend | Medium | High | Build-time/env injection + Rotation-Playbook |
|10| `Access-Control-Allow-Origin: *` auf Write-Functions | Medium | Medium | CORS auf eigene Domains einschränken |

---

## Critical Bugs (Must-Fix vor Launch)

1. `create-customer`: `users`-Insert als „non-fatal“ → führt zu Login-/Funktionsausfällen für Kunden.
2. `outbox_events` ohne RLS/Policies.
3. Kein Outbox-Retry-Worker und keine DLQ.
4. Fehlende Idempotenz für `send-customer-access` (Mehrfachversand möglich).
5. Fehlende Idempotenz für `contract-signed` (doppelte Notifications möglich).

---

## Nice-to-have Improvements

- Einheitliches Response-Schema für alle Functions (`success`, `error`, `details`, `correlation_id`).
- Konsistente strukturierte Logs in allen Functions.
- Contract- und Access-Flows mit correlation/event IDs.
- Dashboard/Admin: zentraler Error-Bus statt verstreuter `alert()`.
- Betriebsdashboard für Outbox KPIs.

---

## Go/No-Go Empfehlung

**Empfehlung: NO-GO**, bis die oben genannten Must-Fix-Punkte umgesetzt sind.

Minimaler Go-Layer:
1. `create-customer` Datenkonsistenz fixen (kein erfolgreicher Create ohne `users`-Profil).  
2. `outbox_events` absichern (RLS + Zugriffspolicies).  
3. Retry/DLQ für Outbox implementieren.  
4. Idempotenz für `send-customer-access` und `contract-signed` einführen.  
5. Stille Fehler im UI eliminieren (sichtbares Feedback + Retry-Pfad).
