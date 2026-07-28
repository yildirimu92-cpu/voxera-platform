# Voxera – Baseline Architecture Map

**Repository-Baseline:** `main@682b88cbc16deb259f6f513de02b7bdc9fc255ab`

## Statusdefinitionen

- **VERIFIZIERT** – direkt anhand des GitHub-Repository-Zustands oder eines konkret gelesenen Repository-Artefakts bestätigt.
- **AUS REPOSITORY ABGELEITET** – aus Code, Konfiguration oder Dokumentation ableitbar, aber nicht als produktiver Laufzeitstatus bestätigt.
- **NICHT VERIFIZIERT** – mit den verfügbaren Zugängen nicht technisch bestätigt.
- **LIVE-ZUGRIFF ERFORDERLICH** – kann nur über das jeweilige Netlify- oder Supabase-Dashboard beziehungsweise dessen API/CLI verifiziert werden.

Repository-Funde sind ausdrücklich **kein Nachweis**, dass eine Komponente aktuell produktiv deployt, konfiguriert oder ausgeführt wird.

## 1. Architekturübersicht

```text
Admin Browser ───────┐
                     ├─ Supabase Auth / Database
Customer Browser ────┘
        │
        ├─ Customer Netlify Functions ── Twilio / ElevenLabs / Make
        │
        └─ Admin Netlify Functions ───── ElevenLabs / SMTP / AI Provider
                                      │
                                      └─ Supabase Database / Storage
```

Das Diagramm ist **AUS REPOSITORY ABGELEITET** und kein produktiver Deployment-Nachweis.

## 2. Komponentenmatrix

| Komponente | Repository-Speicherort / Einstieg | Hauptverantwortung | erwartete Tabellen | externe Dienste | Environment-Abhängigkeiten | Status / offene Punkte |
|---|---|---|---|---|---|---|
| Admin Portal | `admin-panel/index.html` | Kunden, Onboarding, AI, Finance, Offerten, Verträge, Cases, Einstellungen | `customers`, `onboarding`, `subscriptions`, `offers`, `contracts`, `invoices`, `cases`, `admins` | Supabase | Client-Supabase-Konfiguration | Repository-Einstieg VERIFIZIERT; Live-Site NICHT VERIFIZIERT |
| Admin Login | `admin-panel/login.html` | Supabase Login und Admin-Rollenprüfung | `admins` | Supabase Auth | Client-Supabase-Konfiguration | Code VERIFIZIERT; Live Auth NICHT VERIFIZIERT |
| Customer Dashboard | `customer-dashboard/index.html` | Calls, Anfragen, Cases, Einstellungen, Assistant-Konfiguration | `customers`, `calls`, `cases`, `notifications`, Konfigurationstabellen | Supabase | Client-Konfiguration; Functions | Code VERIFIZIERT; Live-Site/RLS NICHT VERIFIZIERT |
| Aktivierung | `customer-dashboard/activate.html` | Invite-/Recovery-Session und Passwortsetzung | Auth, indirekt User-Zuordnung | Supabase Auth | Client-Konfiguration; Redirect-URL | Code VERIFIZIERT; Redirects NICHT VERIFIZIERT |
| Öffentliche Offerte | `admin-panel/offer-pdf.html`, Acceptance-Functions | tokenbasierte Offertendarstellung und Annahme | `offers`, `offer_events`, ggf. `contracts` | SMTP, Supabase | öffentliche Base-URLs, SMTP, Supabase | Repository-Pfade VERIFIZIERT; Domain NICHT VERIFIZIERT |
| Öffentlicher Vertrag | `contract-signed.html`, Contract-Functions | Signatur-/Bestätigungsflow | `contracts`, ggf. Billing-/Eventtabellen | Supabase | öffentliche Base-URLs, Supabase | Repository-Pfade VERIFIZIERT; Live-Flow NICHT VERIFIZIERT |
| Admin Functions | `admin-panel/netlify/functions/` | privilegierte Mutationen, Billing, Mail, Provisioning, Sync | breite operative Tabellen | Supabase, ElevenLabs, SMTP, Anthropic | Service Role, API-/Mail-Keys | Repository VERIFIZIERT; Deployment NICHT VERIFIZIERT |
| Customer Functions | `customer-dashboard/netlify/functions/` | kundenseitige Mutationen, Calls, Webhooks, Telefonie | `customers`, `calls`, `cases`, `notifications`, `plan_config` | Supabase, Twilio, ElevenLabs, Make | Service Role, Webhook-/Provider-Secrets | Repository VERIFIZIERT; Deployment NICHT VERIFIZIERT |
| Supabase Database | extern | zentrale operative Datenhaltung gemäss SSOT-Policy | alle genannten Tabellen | – | Projekt/Keys | Policy VERIFIZIERT; Live-Schema NICHT VERIFIZIERT |
| Supabase Auth | extern | Admin-/Kundenanmeldung, Invite/Recovery | `auth.users`, `users`, `admins`, `customers` | – | URL, Anon Key, Redirects | Code-Nutzung VERIFIZIERT; Live-Konfiguration NICHT VERIFIZIERT |
| Supabase Storage | extern | AVV-PDF und möglicherweise weitere Dateien | `storage.objects` | – | Service Role, Bucket/Path | AVV-Codepfad VERIFIZIERT; Buckets/Policies NICHT VERIFIZIERT |
| ElevenLabs | Functions | Agenten, Voice Preview, Prompt Sync, Post-Call-Daten | `customers`, `calls`, `voxera_voices`, `elevenlabs_sync_log` | ElevenLabs API/Webhooks | API Key, Webhook Secret | Integration im Code VERIFIZIERT; aktive Konfiguration NICHT VERIFIZIERT |
| Twilio | Customer Functions | Inbound Routing, Status Callback, Testcalls | `customers`, `calls` | Twilio API | Account SID, Auth Token, Callback Base URL | Integration im Code VERIFIZIERT; aktive Nummern/Webhooks NICHT VERIFIZIERT |
| E-Mail | Admin Functions | Offerten, Zugänge, Benachrichtigungen | `offers`, Outbox/Eventtabellen | SMTP | SMTP-Variablen | Code VERIFIZIERT; Konto/Versand NICHT VERIFIZIERT |
| Make / Webhooks | Customer Functions | optionale Mail-/Automationsweitergabe | Call-/Eventdaten | Make | `MAKE_MAIL_WEBHOOK` | Env-Nutzung VERIFIZIERT; Szenario NICHT VERIFIZIERT |
| Billing | `daily-billing-runner`, Billing-Functions und `_lib` | Rechnungsläufe, Subscription-/Contract-Orchestrierung | `subscriptions`, `contracts`, `invoices`, `invoice_items`, Outbox | SMTP/Supabase | Supabase, Mail | Code/Schedule VERIFIZIERT; produktive Ausführung NICHT VERIFIZIERT |
| Call Ingest | `twilio-inbound-router`, `elevenlabs-post-call`, Status-Callback | Call-Stub, Status, Transkript, Analyse | `customers`, `calls`, `notifications` | Twilio, ElevenLabs | Provider-/Supabase-Secrets | Code VERIFIZIERT; Webhook-Ziele NICHT VERIFIZIERT |
| Onboarding | Admin Portal + `onboarding-update` | Fortschritt und Lifecycle | `onboarding`, `customers` | Supabase | Supabase | Codepfad VERIFIZIERT; Live-Daten NICHT VERIFIZIERT |
| Cases | Admin/Customer Frontend + Functions | Aufgaben/Fälle | `cases`, `customers` | Supabase | Supabase | parallele Pfade VERIFIZIERT; Parität NICHT VERIFIZIERT |
| Outbox | Admin `_lib/webhook-outbox`, Retry Worker | zuverlässige externe Zustellung | Outbox-/Eventtabellen | SMTP/Webhooks | Supabase, Provider | Code und Scheduler VERIFIZIERT; Live-Verarbeitung NICHT VERIFIZIERT |
| Audit-/Sync-Logs | Offer Events, `elevenlabs_sync_log`, App-Logs | Nachvollziehbarkeit | Event-/Logtabellen | Supabase/Netlify Logs | Supabase | erwartete Pfade AUS REPOSITORY ABGELEITET; Vollständigkeit NICHT VERIFIZIERT |
| Scheduler | beide `netlify.toml` | Cleanup, Outbox Retry, Billing | abhängig von Function | Netlify | Site-Konfiguration | Schedules im Repo VERIFIZIERT; Aktivität NICHT VERIFIZIERT |

## 3. Bekannte Überschneidungen

**VERIFIZIERT als Repository-Struktur**

- Admin und Customer besitzen eigene Functions-Verzeichnisse.
- Cases-Funktionen existieren in beiden Bereichen.
- AI-Änderungspfade existieren in beiden Bereichen.
- Customer-Assistant-Update delegiert ElevenLabs-Sync an eine Admin-URL.
- öffentliche kommerzielle Seiten sind teilweise an den Admin-Deployment-Kontext gekoppelt.
- Browser und Functions verwenden unterschiedliche Konfigurationsformen.

## 4. Hintergrundprozesse

| Prozess | Repository-Konfiguration | Live-Status |
|---|---|---|
| Outbox Retry | alle 5 Minuten | NICHT VERIFIZIERT |
| Daily Billing | täglich 06:00 gemäss Cron | NICHT VERIFIZIERT |
| Cleanup stale calls | alle 5 Minuten | NICHT VERIFIZIERT |
| ElevenLabs Post-Call Polling | innerhalb der Webhook-Function | NICHT VERIFIZIERT |
| Supabase Cron | kein Live-Nachweis | NICHT VERIFIZIERT |

## 5. Architektururteil

**AUS REPOSITORY ABGELEITET:** Das System ist ein zweiteiliges statisches Frontend mit umfangreichen Netlify Functions, Supabase als beabsichtigtem SSOT und mehreren externen Providerintegrationen.

**NICHT VERIFIZIERT:** Die produktive Topologie, konkrete Site-Zuordnung, Live-Schema-Übereinstimmung und ausschliessliche Nutzung von Supabase.
