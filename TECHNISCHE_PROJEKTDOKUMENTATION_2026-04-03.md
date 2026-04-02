# Voxera — Technische Projektdokumentation

**Stand:** 3. April 2026

---

## 1. Produktübersicht

Voxera ist ein SaaS-Produkt: ein KI-gestützter Telefonassistent für KMU in der Schweiz.

**System-Flow:**
Eingehender Anruf → ElevenLabs Voice Agent → Make (Webhook) → Supabase → E-Mail-Benachrichtigung → Dashboard/Admin

**Zwei Frontends:**
- **Customer Dashboard** (`dashboard.voxera.ch`) — Kunden sehen ihre Anrufe, Leads, Rückrufe, Einstellungen
- **Admin Portal** (`voxera-admin.netlify.app`) — Interne Verwaltung: Kunden, Calls, Statistiken, User-Erstellung

---

## 2. Tech Stack

| Komponente | Technologie | Zweck |
|---|---|---|
| Frontend (Dashboard) | Vanilla HTML/JS, Netlify | Kunden-Dashboard |
| Frontend (Admin) | Vanilla HTML/JS, Netlify | Admin-Verwaltung |
| Backend Functions | Netlify Functions (Node.js) | User-Erstellung, Kunden-Löschung |
| Datenbank | Supabase (PostgreSQL) | Single Source of Truth |
| Auth | Supabase Auth | Login für Dashboard + Admin |
| Voice AI | ElevenLabs V3 Conversational | Telefonassistent |
| Automation | Make (Integromat) | Call-Ingest, E-Mail-Versand |
| SMTP | Infomaniak (`mail.infomaniak.com:587`) | E-Mail-Versand via Make |

---

## 3. Supabase Schema

### `public.customers`

Kanonischer Kunden-Schlüssel: `id` (text)

| Spalte | Typ | Beschreibung |
|---|---|---|
| id | text, PK | Kunden-ID (z.B. "001", "002") |
| customer_name | text, not null | Name/Firma |
| plan | text | Pilot / Starter / Business / Professional |
| voxera_number | text | Zugewiesene Telefonnummer |
| dashboard_id | text, unique | Dashboard-Identifier |
| tel_nr | text | Telefonnummer des Kunden |
| email | text, unique | E-Mail |
| invite_status | text | default 'active' |
| welcome_sent | boolean | Wurde Welcome-Mail gesendet? |
| notification_active | boolean | Rückruf-Benachrichtigung aktiv |
| new_log_email_active | boolean | E-Mail bei neuem Anruf |
| missed_call_email_active | boolean | E-Mail bei verpasstem Anruf |
| phone_notification_to | text | Ziel-Nummer für Benachrichtigungen |
| status | text | 'active' / 'inaktiv' |
| start_date | date | Vertragsbeginn |
| created_at | timestamp | Erstellungsdatum |
| updated_at | timestamp | Letzte Änderung |

### `public.users`

Verknüpfung zwischen Auth und Customer.

| Spalte | Typ | Beschreibung |
|---|---|---|
| id | uuid, PK, FK → auth.users.id | Auth User ID |
| email | text, unique | E-Mail |
| customer_id | text, FK → customers.id | Zugehöriger Kunde |
| role | text | 'customer' / 'admin' |
| is_admin | boolean | Admin-Flag |
| created_at | timestamp | Erstellungsdatum |

### `public.calls`

Anruf-Daten, geschrieben von Make nach jedem Call.

| Spalte | Typ | Beschreibung |
|---|---|---|
| id | text, PK | Interner Call-ID |
| call_id | text, unique | ElevenLabs Call-ID |
| customer_id | text, FK → customers.id | Zugehöriger Kunde |
| caller_name | text | Name des Anrufers |
| caller_phone | text | Telefonnummer |
| called_number | text | Angerufene Voxera-Nummer |
| voxera_number | text | Voxera-Nummer |
| date | date | Anrufdatum |
| created_date_raw | date | Roh-Datum |
| duration_seconds | integer | Tatsächliche Gesprächsdauer |
| call_summary | text | KI-Zusammenfassung |
| call_summary_short | text | Kurze Zusammenfassung (Post-Processing) |
| category | text | Termin/Anfrage/Offerte/Notfall/Sonstiges |
| lead_quality | text | Hot/Warm/Cold |
| callback_requested | boolean | Rückruf gewünscht? |
| dashboard_status | text | 'Neu'/'In Bearbeitung'/'Erledigt' |
| next_action | text | Nächster Schritt (Post-Processing) |
| follow_up_at | date | Follow-Up Datum |
| transcript | text | Vollständiges Transkript |
| transcript_json | jsonb | Strukturiertes Transkript |
| assigned_to | uuid, FK → auth.users.id | Zugewiesener Bearbeiter |
| status | text | 'new' |
| notes | text | Interne Notizen |
| created_at / updated_at | timestamp | Zeitstempel |

### `public.admins`

Admin-User für das Admin Portal.

| Spalte | Typ | Beschreibung |
|---|---|---|
| id | uuid, PK | Muss mit auth.users.id übereinstimmen |
| name | text | Voller Name (ACHTUNG: `name`, nicht `full_name`) |
| email | text | E-Mail |
| role | text | 'super-admin' / 'admin' / 'support' |
| force_password_change | boolean | Passwort-Änderung erzwingen |
| created_at / updated_at | timestamp | Zeitstempel |

### Foreign Keys

```text
users.id → auth.users.id
users.customer_id → customers.id
calls.customer_id → customers.id
calls.assigned_to → auth.users.id
```

---

## 4. Row Level Security (RLS)

RLS ist aktiviert auf `admins`, `customers`, `calls`.

**Aktive Policies:**

- `admins`:
  - `admins_read_own` — Eingeloggte Admins können ihren eigenen Eintrag lesen

- `customers`:
  - `admins_read_customers` — Admins können alle Kunden lesen
  - `admins_update_customers` — Admins können Kunden bearbeiten
  - `admins_delete_customers` — Admins können Kunden löschen
  - `admins_insert_customers` — Admins können Kunden erstellen

- `calls`:
  - `admins_read_calls` — Admins können alle Calls lesen

**Fehlt noch:**
- Dashboard-User RLS: Kunden müssen ihre eigenen Daten lesen können
- Calls INSERT Policy für Make/Service-Role (Make nutzt Service Role Key, bypassed RLS)

---

## 5. Netlify Functions

### `create-customer.js`

**Pfad:** `admin-panel/netlify/functions/create-customer.js`

**Zweck:** Kunden + Auth User + `public.users` in einem Schritt erstellen, Welcome-Mail via Make triggern.

**Flow:**
1. Auth User in Supabase erstellen (via Service Role Key)
2. Customer in `public.customers` erstellen
3. User in `public.users` per UPSERT erstellen/updaten
4. Make Webhook aufrufen für Welcome-E-Mail
5. `welcome_sent = true` setzen

**Environment Variables (Netlify):**
- `SUPABASE_URL` = `https://ulcofbgrovgcvowdjrge.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` = [secret]
- `SMTP_USER` = `info@voxera.ch` (aktuell nicht genutzt, E-Mail läuft über Make)
- `SMTP_PASS` = [secret] (aktuell nicht genutzt)
- `MAKE_WELCOME_WEBHOOK` = `https://hook.eu1.make.com/3nqavrb751n3l1dd7qqib6ugp0pslxxj` (optional, Fallback ist hardcoded)

### `delete-customer.js`

**Pfad:** `admin-panel/netlify/functions/delete-customer.js`

**Zweck:** Kunden vollständig löschen inkl. Auth User.

**Flow:**
1. Auth User ID aus `public.users` finden
2. `public.users` löschen
3. `public.calls` des Kunden löschen
4. `public.customers` löschen
5. Auth User aus `auth.users` löschen

---

## 6. Was wurde gemacht (chronologisch)

### 6.1 Airtable → Supabase Migration (Admin Portal)
- Alle Airtable API-Calls im Admin Portal entfernt
- Generischer Airtable-Wrapper `atReq()` ersetzt durch `sbCustomers()` / `sbCalls()`
- Airtable-Feldnamen (`E-Mail`, `Plan`, `Voxera_Nummer`, `Dashboard_id`) gemappt auf Supabase-Spalten (`email`, `plan`, `voxera_number`, `dashboard_id`)
- Airtable Token und Credentials komplett aus dem Code entfernt
- Alle 14 produktiven Datenpfade migriert (Kunden laden, bearbeiten, löschen, Calls laden, Statistik, Profil, Verträge)

### 6.2 Admin Login
- `login.html` komplett neu gebaut mit identischem Design wie Dashboard Login
- Session-Check: Wenn bereits eingeloggt → direkt weiterleiten
- Admin-Check: Nicht-Admins werden nach Login abgewiesen
- Passwort-vergessen Funktion
- Enter-Taste Unterstützung

### 6.3 Auth Flow repariert
- Shadowed Variable in `initAuth()` behoben
- `showAuthRequired()` (undefinierte Funktion) ersetzt durch `alert()`
- Admin-Prüfung gegen `public.admins` Tabelle
- Feldname-Bug: `full_name` → `name` (Spalte in `admins` heißt `name`)

### 6.4 Kunden-Erstellung (Netlify Function)
- `createCustomer()` im Frontend ruft `/.netlify/functions/create-customer` auf
- Serverseitige Erstellung mit Service Role Key (nie im Browser)
- Auth User + Customer + Users in einer Transaktion mit Rollback bei Fehlern
- Welcome-E-Mail Trigger via Make Webhook

### 6.5 Kunden-Löschung (Netlify Function)
- `delCustomer()` ruft `/.netlify/functions/delete-customer` auf
- Löscht: users → calls → customers → auth user (korrekte Reihenfolge wegen FKs)

### 6.6 Trigger-Problem behoben
- Es existierte ein Trigger `on_auth_user_created_ensure_public_user` auf `auth.users`
- Dieser Trigger hat bei jedem neuen Auth User automatisch einen `public.users` Eintrag erstellt
- Das kollidierte mit der Netlify Function, die dasselbe tat → `users_pkey` Duplikat-Fehler
- Lösung: Trigger wurde entfernt (`DROP TRIGGER`)
- Function nutzt jetzt `UPSERT` mit `onConflict: 'id'` als Sicherheit

### 6.7 SyntaxError behoben
- Eine extra `}` auf Zeile ~1197 in `index.html` hat das gesamte JavaScript abgeschossen
- Wurde mehrfach reintroduziert durch verschiedene Edits
- JavaScript wird jetzt vor dem Deploy mit `node -c` syntax-geprüft

### 6.8 `_redirects` Fix
- `/.netlify/*` Requests wurden fälschlicherweise auf `index.html` umgeleitet
- Netlify Functions konnten nicht erreicht werden
- Fix: `/.netlify/*` aus der Redirect-Regel entfernt (Netlify routet Functions automatisch)

### 6.9 RLS Policies erstellt
- `admins`, `customers`, `calls` haben jetzt RLS aktiviert
- Policies für Admin-Zugriff auf alle drei Tabellen

### 6.10 UI Fixes (Admin Portal)
- Contract-Modal: `max-height: 85vh; overflow-y: auto` — scrollbar statt zu groß
- Echter Minuten-Verbrauch: `duration_seconds / 60` statt `AVG_CALL_DURATION` Schätzung

### 6.11 Dashboard Fix
- `estimateMinutesForRecord()` nutzt jetzt `duration_seconds`, wenn vorhanden
- Fallback auf `AVG_CALL_DURATION`, wenn kein Wert

### 6.12 Voice Agent Prompt (ElevenLabs)
- Prompt v4 erstellt: Hochdeutsch (kein Schweizerdeutsch, weil V3 es nicht sauber ausspricht)
- Schweizer Höflichkeitsformeln: "Grüezi", "Merci"
- Proaktive Gesprächsführung (nie passiv warten)
- Einmalige Verabschiedung (keine Doppel-Bestätigung)
- Stille-Handling: Nach 3-4 Sek freundlich nachfragen
- ElevenLabs: V3 Konversation + Expressiver Modus
- Audio-Tags aktiviert: Geduldig, Besorgt, Seufzt, Kichert, Ernst

### 6.13 Call Payload Design
- Finales JSON-Payload definiert für ElevenLabs → Make → Supabase
- `call_id` wird in Make generiert (nicht vom Voice Agent)
- `caller_name` / `company_name` sind Leerstrings, wenn unbekannt
- Post-Processing-Felder (`call_summary_short`, `next_action`, `follow_up_at`) werden nachgelagert berechnet

---

## 7. Bekannte Probleme

### `localStorage quota exceeded`
- Chrome zeigt regelmäßig `Resource::kQuotaBytes quota exceeded`
- Ursache: Supabase Sessions + möglicherweise Chrome Extensions füllen `localStorage`
- Workaround: `localStorage.clear(); sessionStorage.clear(); location.reload();`
- Langfristige Lösung: Supabase Auth Storage auf `sessionStorage` oder Cookie umstellen

### Dashboard-Admin Session-Konflikt
- Beide Apps nutzen denselben Supabase-Projekt und denselben `localStorage`-Key
- Wenn man im Dashboard eingeloggt ist, sieht das Admin Portal dieselbe Session
- Langfristige Lösung: Separate `storageKey`-Option beim Supabase Client im Admin

---

## 8. Was noch fehlt für Launch

| Priorität | Thema | Status |
|---|---|---|
| HOCH | Welcome-E-Mail via Make | Make Szenario erstellt, Webhook verknüpft, E-Mail-Template bereit — muss getestet werden |
| HOCH | Dashboard RLS für Customer-User | Fehlt — Kunden können eigene Daten noch nicht lesen |
| HOCH | Plan-Sync Admin → Dashboard | Funktioniert über Supabase (selbe Tabelle) — muss getestet werden |
| MITTEL | Admin-Erstellung im Admin Portal | `createAdminAccount()` noch blockiert |
| MITTEL | Call-Benachrichtigungen (E-Mail bei neuem Call, Rückruf, etc.) | Läuft über Make, muss geprüft werden |
| MITTEL | SMS-Benachrichtigungen | Geplant, noch nicht umgesetzt |
| NIEDRIG | Mobile Responsiveness Admin | Grundlegend vorhanden, nicht getestet |
| NIEDRIG | Favicon im Admin Portal | Dateien bereit, müssen in Repo gepusht werden |

---

## 9. Datei-Struktur

**Admin Panel** (GitHub: `voxera-platform/admin-panel/`)

```text
admin-panel/
├── index.html              # Haupt-Admin-Seite (Single Page App)
├── login.html              # Admin Login
├── netlify.toml            # Netlify Config mit Functions-Pfad
├── _redirects              # URL-Routing
├── package.json            # Dependencies (supabase-js, nodemailer)
├── readme.md
├── favicon.ico / favicon-*.png  # Favicons (noch nicht gepusht)
└── netlify/
    └── functions/
        ├── create-customer.js   # Kunden + Auth User erstellen
        └── delete-customer.js   # Kunden vollständig löschen
```

**Dashboard** (GitHub: `voxera-platform/customer-dashboard/`)

```text
customer-dashboard/
├── index.html              # Dashboard (Single Page App)
├── netlify.toml
├── _redirects
└── readme.md
```

---

## 10. Environment Variables (Netlify — Admin Panel)

| Variable | Wert | Scope |
|---|---|---|
| SUPABASE_URL | `https://ulcofbgrovgcvowdjrge.supabase.co` | All contexts |
| SUPABASE_SERVICE_ROLE_KEY | [secret] | Production (Secret) |
| SMTP_USER | `info@voxera.ch` | All contexts |
| SMTP_PASS | [secret] | All contexts (Secret) |
| MAKE_WELCOME_WEBHOOK | `https://hook.eu1.make.com/3nqavrb751n3l1dd7qqib6ugp0pslxxj` | Optional |

---

## 11. Make Szenarien

### 1) Integration Webhooks (Call-Ingest)
- **Trigger:** Webhook von ElevenLabs (nach jedem Call)
- **Flow:** Webhook → Supabase Search (Kunde finden) → Supabase Insert (Call) → Router → E-Mail bei Callback
- **Status:** Aktiv, funktioniert

### 2) Welcome-E-Mail (neu)
- **Trigger:** Webhook von Netlify Function `create-customer`
- **Flow:** Webhook → E-Mail senden (Infomaniak SMTP)
- **Payload:** `customer_name`, `email`, `password`, `plan`, `voxera_number`, `customer_id`, `dashboard_url`
- **Status:** Szenario erstellt, Template bereit, muss getestet werden

---

## 12. ElevenLabs Voice Agent

- **Modell:** V3 Konversation (Alpha)
- **Expressiver Modus:** An
- **Stimme:** Ramona - Professional and Calm
- **Audio-Tags:** Geduldig, Besorgt, Seufzt, Kichert, Ernst
- **Prompt:** v4 — Hochdeutsch mit Schweizer Höflichkeit, proaktive Gesprächsführung
- **Tool:** `send_to_voxera` — sendet Call-Daten an Make Webhook

---

## 13. Wichtige Hinweise für Entwickler

- Kein Service Role Key im Frontend — nur in Netlify Functions
- `admins.name`, nicht `admins.full_name` — die Spalte heißt `name`
- Trigger entfernt — `on_auth_user_created_ensure_public_user` wurde entfernt
- Die Netlify Function ist die einzige Quelle für `public.users`-Einträge bei Kunden-Erstellung
- JavaScript Syntax prüfen vor jedem Deploy: `node -c` auf den Script-Block
- `localStorage` leeren, wenn `quota exceeded` Fehler auftauchen
- Supabase ist Single Source of Truth — kein Airtable mehr
