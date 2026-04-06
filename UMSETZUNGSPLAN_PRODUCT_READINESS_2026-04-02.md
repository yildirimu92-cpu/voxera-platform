# Voxera – Technischer Umsetzungsplan (Execution Mode)

Stand: 2026-04-06  
Fokus: Launch-Stabilität, Security, belastbare Operations.

---

## 1) Top 10 Maßnahmen in exakter Reihenfolge

> Marker-Legende je Maßnahme:  
> **[SOFORT]** sofort umsetzbar  
> **[UMBAU]** braucht strukturellen Umbau  
> **[FUNCTION]** braucht/ändert Netlify Function  
> **[DB]** braucht Supabase DB/RLS/Migration

### 1. Lifecycle-Statusmodell vereinheitlichen (Code + DB + Flows)
**Marker:** [SOFORT] [UMBAU] [FUNCTION] [DB]

- **Ziel:** Ein einziges kanonisches Statusmodell in allen Schichten.
- **Warum jetzt:** Aktuell kollidieren `pending/active` mit `onboarding/ready/invited/activated/live/paused`; das blockiert Aktivierung/Zugriff.
- **Betroffene Dateien:**
  - `supabase/sql/2026-04-06_customer_lifecycle_status.sql`
  - `admin-panel/netlify/functions/activate-subscription.js`
  - `admin-panel/netlify/functions/send-customer-access.js`
  - `customer-dashboard/index.html`
  - `admin-panel/index.html`
- **Konkrete Änderung:**
  1. Canonical Customer-Lifecycle final festlegen (siehe Abschnitt Statusmodell unten).
  2. `activate-subscription` auf canonical Transitionen umbauen (kein `pending/active` mehr).
  3. Dashboard Access Guard von `status === 'active'` auf erlaubte Live-Status umstellen.
  4. Admin-UI Labels/Filter ausschließlich aus canonical Enum ableiten.
- **Risiko wenn nicht gemacht:** Aktivierungsfehler, Kunden-Lockout, inkonsistente Betriebszustände.

---

### 2. Harter Admin-Access-Gate im Admin-Portal
**Marker:** [SOFORT] [UMBAU]

- **Ziel:** `admin-panel/index.html` nur mit valider Session + Admin-Rolle nutzbar machen.
- **Warum jetzt:** Login prüft Admin-Rolle, aber Dashboard-Seite selbst erzwingt das aktuell nicht hart.
- **Betroffene Dateien:**
  - `admin-panel/index.html`
  - `admin-panel/login.html`
- **Konkrete Änderung:**
  1. In `init()` vor jedem Datenladen: Session holen, Rolle aus `admins` prüfen, sonst redirect `login.html`.
  2. Preview-/Fallback-Pfade entfernen, die ohne Session weiterlaufen.
  3. Logout erzwingen bei Role-Mismatch.
- **Risiko wenn nicht gemacht:** Unerlaubte Einsicht/Bedienung über direkte URL-Navigation.

---

### 3. Privilegierte Functions mit Caller-Auth absichern
**Marker:** [SOFORT] [FUNCTION] [DB]

- **Ziel:** Kritische Mutationen nur von authentifizierten Admins erlauben.
- **Warum jetzt:** Functions arbeiten mit Service Role, prüfen aber aktuell keinen Caller-Admin-Kontext.
- **Betroffene Dateien:**
  - `admin-panel/netlify/functions/create-customer.js`
  - `admin-panel/netlify/functions/send-customer-access.js`
  - `admin-panel/netlify/functions/activate-subscription.js`
  - `admin-panel/netlify/functions/delete-customer.js`
- **Konkrete Änderung:**
  1. Gemeinsames Guard-Modul bauen (`_lib/require-admin.js`):
     - Bearer JWT prüfen (`auth.getUser(jwt)`),
     - in `admins`-Tabelle Mitgliedschaft validieren,
     - bei Fail `401/403`.
  2. Guard in alle 4 Functions als erster Schritt integrieren.
  3. Optional: allowlist Origins statt `*` für CORS.
- **Risiko wenn nicht gemacht:** Kritische Aktionen (Delete/Invite/Create) sind potentiell missbrauchbar.

---

### 4. Cases-Flow serverseitig machen (kein UI-only Zustand)
**Marker:** [SOFORT] [UMBAU] [FUNCTION] [DB]

- **Ziel:** Case-Erstellung/-Updates robust in DB persistieren.
- **Warum jetzt:** Admin-Case-Aktionen mutieren aktuell primär Frontend-State.
- **Betroffene Dateien:**
  - `admin-panel/index.html`
  - **neu:** `admin-panel/netlify/functions/cases-create.js`
  - **neu:** `admin-panel/netlify/functions/cases-update.js`
- **Konkrete Änderung:**
  1. `createCaseForCustomer` auf Function-Call umstellen.
  2. `updateCase` auf Function-Call umstellen.
  3. Ergebnis danach aus DB reloaden, nicht lokal „vortäuschen“.
- **Risiko wenn nicht gemacht:** Ops arbeitet mit Phantom-Cases, Follow-up bricht im Betrieb.

---

### 5. Onboarding-Progress als Server-Source-of-Truth definieren
**Marker:** [SOFORT] [UMBAU] [FUNCTION] [DB]

- **Ziel:** Setup-/Onboarding-Zustand verlässlich in DB, nicht überwiegend localStorage/synthetisch.
- **Warum jetzt:** Support/Ops und Kunde sehen sonst unterschiedliche Realitäten.
- **Betroffene Dateien:**
  - `customer-dashboard/index.html`
  - `admin-panel/index.html`
  - **neu:** `supabase/sql/2026-04-06_onboarding_events.sql`
  - **neu:** `admin-panel/netlify/functions/onboarding-update.js`
- **Konkrete Änderung:**
  1. Tabelle `onboarding_events` einführen (step, action, actor, timestamp).
  2. `onboarding.progress/status/next_step` nur serverseitig berechnen/setzen.
  3. Dashboard Wizard-Completion in DB schreiben; localStorage nur als UI-Cache.
- **Risiko wenn nicht gemacht:** Unzuverlässige Go-Live-Freigaben und hoher Support-Aufwand.

---

### 6. Customer-Activation-Flow sauber trennen (Invite vs Activated vs Live)
**Marker:** [SOFORT] [FUNCTION] [DB]

- **Ziel:** Klarer, testbarer Ablauf von Zugang senden bis produktiv live.
- **Warum jetzt:** Derzeit vermischen sich Invite-, Passwort-, und Betriebsstatus.
- **Betroffene Dateien:**
  - `admin-panel/netlify/functions/send-customer-access.js`
  - `customer-dashboard/activate.html`
  - `customer-dashboard/index.html`
  - **neu:** `admin-panel/netlify/functions/customer-mark-live.js`
- **Konkrete Änderung:**
  1. `send-customer-access`: nur Invite erzeugen + `status='invited'`.
  2. Nach Passwort-Setzen Hook (`mark_activated`) robust idempotent lassen.
  3. `live` nur über explizite Freigabe (Onboarding complete + forwarding ready + optional test call).
- **Risiko wenn nicht gemacht:** Kunde hat Zugang, ist aber operativ nicht sauber „live“ (oder umgekehrt).

---

### 7. Delete-Flow transaktional härten + Soft-Delete-Fallback
**Marker:** [SOFORT] [FUNCTION] [DB]

- **Ziel:** Löschvorgang sicher, nachvollziehbar, rückverfolgbar.
- **Warum jetzt:** Hard Delete in vielen Schritten kann bei Teilfehlern inkonsistent bleiben.
- **Betroffene Dateien:**
  - `admin-panel/netlify/functions/delete-customer.js`
  - `supabase/sql/2026-04-03_delete_auth_user_data.sql`
  - **neu:** `supabase/sql/2026-04-06_customer_soft_delete.sql`
- **Konkrete Änderung:**
  1. Erst Soft-Delete (`customers.deleted_at`, `status='paused'`) als Standard.
  2. Hard-Delete nur Admin-Superrolle + explizites `confirm=true`.
  3. Audit-Event pro Löschschritt speichern.
- **Risiko wenn nicht gemacht:** Datenverlust ohne Recovery, inkonsistente Referenzen.

---

### 8. RLS- und Rollenmodell explizit fertigziehen
**Marker:** [SOFORT] [DB]

- **Ziel:** Zugriff sauber per Rolle und Beziehung kontrollieren.
- **Warum jetzt:** Frontends arbeiten direkt mit Anon-Key + RLS-Annahme.
- **Betroffene Dateien:**
  - **neu:** `supabase/sql/2026-04-06_rls_hardening.sql`
  - `supabase/sql/2026-04-02_user_profile_provisioning.sql`
- **Konkrete Änderung:**
  1. Policies für `customers`, `calls`, `cases`, `onboarding`, `users`, `admins` finalisieren.
  2. Customer darf nur eigenes `customer_id` sehen/schreiben (erlaubte Felder eingeschränkt).
  3. Admin-Rollen dürfen über Functions mutieren; direkte Table-Writes minimieren.
- **Risiko wenn nicht gemacht:** Datenzugriff hängt an impliziten Annahmen, Security-Risiko bleibt.

---

### 9. Dead Code/Artefakte entfernen und Verantwortlichkeiten klären
**Marker:** [SOFORT]

- **Ziel:** Verwirrung und Fehlbedienung im Team reduzieren.
- **Warum jetzt:** Root-Snippets (`activate-subscription.js`, `delete-customer.js`) sind keine produktive Laufzeit.
- **Betroffene Dateien:**
  - `activate-subscription.js`
  - `delete-customer.js`
  - `INTERNAL_SYSTEM_DOCUMENTATION_2026-04-06.md` (Doku ergänzen)
- **Konkrete Änderung:**
  1. Root-Snippets löschen oder in `docs/archive/` verschieben.
  2. „Source of runtime truth“ dokumentieren: nur `admin-panel/netlify/functions/*`.
- **Risiko wenn nicht gemacht:** Falsche Annahmen bei Hotfixes/Onboarding.

---

### 10. Minimaler Release-Gate mit technischen Checks
**Marker:** [SOFORT] [UMBAU]

- **Ziel:** Go-Live nur bei erfüllten Muss-Kriterien.
- **Warum jetzt:** Es fehlt eine harte technische „Ready/Not Ready“-Linie.
- **Betroffene Dateien:**
  - **neu:** `RELEASE_GATE_VOXERA.md`
  - **neu:** `scripts/release-smoke.sh`
- **Konkrete Änderung:**
  1. Smoke Checks: login admin/customer, invite flow, case create/update, delete dry-run.
  2. Stage/Prod-Konfigcheck (`SUPABASE_URL`, keys, webhook URLs).
  3. Abbruchkriterien definieren (z. B. Lifecycle mismatch, auth bypass, function auth fail).
- **Risiko wenn nicht gemacht:** Launch trotz bekannter Defekte.

---

## 2) Fehlende / unzureichende Netlify Functions (exakt)

### Muss neu bauen
1. **`cases-create`**
   - **Zweck:** Persistente Anlage von Cases (Rückruf/Follow-up).
   - **Verantwortlichkeit:** Validierung + Insert + Audit Event.
2. **`cases-update`**
   - **Zweck:** Status/Priority/Owner/Notes Updates.
   - **Verantwortlichkeit:** Transition-Checks + Update + Audit Event.
3. **`onboarding-update`**
   - **Zweck:** Step-Status & Onboarding next_step/progress serverseitig.
   - **Verantwortlichkeit:** Step-Input normalisieren, Aggregat aktualisieren.
4. **`customer-mark-live`**
   - **Zweck:** finaler Übergang `activated -> live`.
   - **Verantwortlichkeit:** Preconditions prüfen (Onboarding vollständig, notwendige Felder gesetzt).

### Muss nachschärfen (bestehende Functions)
1. `create-customer` → Caller-Admin-Auth + strictere Feldvalidierung + idempotency bei Retry.
2. `send-customer-access` → Caller-Admin-Auth + idempotent bei bereits `invited/activated`.
3. `activate-subscription` → auf canonical Statusmodell korrigieren.
4. `delete-customer` → Soft-delete default + audit + role gate.

---

## 3) Ziel-Statusmodell (klar und verbindlich)

## 3.1 Customer Lifecycle
`onboarding -> ready -> invited -> activated -> live -> paused`

- **onboarding:** Daten/Setup unvollständig
- **ready:** alle Voraussetzungen für Invite erfüllt
- **invited:** Zugang versendet
- **activated:** Passwort gesetzt, Zugang nutzbar
- **live:** operativ freigeschaltet
- **paused:** Betrieb pausiert

Verboten: direkte Sprünge ohne Preconditions (z. B. `onboarding -> live`).

## 3.2 Onboarding Lifecycle
`not_started -> in_progress -> blocked -> ready -> completed`

- `ready`: alle Pflichtschritte für Invite/Activation erfüllt
- `completed`: Go-Live-Voraussetzungen erfüllt

## 3.3 Access Lifecycle
`not_sent -> sent -> activated`

- Ableitung aus Invite + Auth-Status; muss mit Customer-Status synchron bleiben.

## 3.4 Case Lifecycle
`open -> in_progress -> waiting -> done`

- `done` ist terminal.
- Jede Änderung erzeugt `case_events` Eintrag.

## 3.5 Call Lifecycle
`new -> in_progress -> follow_up_scheduled -> closed`

- Mapping auf Dashboard-Labels bleibt möglich, DB-seitig aber canonical speichern.

---

## 4) Go-Live-Plan in 3 Stufen

## Stage 1 – Launch-kritisch (vor Go-Live, ohne Ausnahme)

**Enthaltene Maßnahmen:** 1, 2, 3, 4, 6, 8, 10  
**Dauer:** realistisch 7–10 Arbeitstage bei fokussierter Umsetzung.

- Lifecycle harmonisieren und produktive Guards reparieren.
- Admin-/Function-Auth hart machen.
- Cases serverseitig persistieren.
- RLS + Release-Gate finalisieren.

**Go/No-Go Kriterien:**
- Kein `pending/active` mehr in produktiver Laufzeitlogik.
- Alle privilegierten Functions verweigern ohne validen Admin.
- Case create/update in DB nachvollziehbar.

## Stage 2 – Kurz nach Launch (Stabilisierung)

**Enthaltene Maßnahmen:** 5, 7, 9  
**Dauer:** 1–2 Wochen nach Launch.

- Onboarding-SSOT und Event-Historie abschließen.
- Delete-Flow robust + recoverable machen.
- Artefakt-/Dokubereinigung.

## Stage 3 – Skalierung / Optimierung

**Enthaltene Maßnahmen:** Erweiterte Observability, Performance, Modularisierung.

- JS-Monolithen schrittweise in Module aufteilen.
- Realtime-/Ops-Metriken und SLOs ergänzen.
- Optional: weitere Domain-APIs bündeln (billing/reporting).

---

## 5) Direkt umsetzbare Arbeitspakete (Sprint-Start heute)

1. `customer-dashboard/index.html`: Access Guard auf canonical Status korrigieren.
2. `admin-panel/index.html`: harter Session/Admin Redirect vor `loadDataFromSupabase()`.
3. Shared Function-Guard (`require-admin`) erstellen und in 4 Functions integrieren.
4. `cases-create` + `cases-update` Functions scaffolden und Admin-UI umstellen.
5. SQL-Migration `rls_hardening` + Policy Tests gegen Stage-DB fahren.

