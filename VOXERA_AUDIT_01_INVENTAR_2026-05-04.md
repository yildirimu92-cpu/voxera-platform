# 1) INVENTAR

## Netlify Functions (customer-dashboard/netlify/functions)
- `activation-start-system-test-call.js`: Startet systemischen Testanruf via Twilio und persistiert Call/Activation-Kontext. Liest `customers`; schreibt `calls`, `customers`; externe API: Twilio REST.
- `call-intake-webhook.js`: Nimmt Intake-Webhooks entgegen und mappt sie auf Call-Datensätze. Liest `customers`; schreibt `calls`; externe API: keine direkte (Webhook-Ingress).
- `call-save-followup.js`: Setzt Follow-up-Daten für Call-Fälle. Liest/Schreibt `calls`; externe API: keine.
- `call-update-status.js`: Aktualisiert Dashboard-Status von Calls. Liest/Schreibt `calls`; externe API: keine.
- `cases-create.js`: Erstellt Case/Task-Einträge. Schreibt `customer_tasks`; externe API: keine.
- `cases-update.js`: Aktualisiert Case/Task-Einträge. Liest/Schreibt `customer_tasks`; externe API: keine.
- `cleanup-stale-calls.js`: Markiert/bereinigt veraltete Calls per Batch-Job. Liest/Schreibt `calls`; externe API: keine.
- `customer-contract-state.js`: Liefert Contract/Plan-Zustand für Kundensicht. Liest `offers`, `plan_config`; externe API: keine.
- `customer-update-settings.js`: Persistiert Kunden-Settings. Liest/Schreibt `customers`; externe API: keine.
- `elevenlabs-post-call.js`: Verarbeitet ElevenLabs-Konversations-Ende, holt Konversationsdaten und persistiert Ergebnis; optional Make-Webhook. Liest `customers`; schreibt `calls`; externe APIs: ElevenLabs ConvAI, Make Webhook.
- `twilio-inbound-router.js`: Routed Inbound-Twilio-Call Richtung ElevenLabs inbound endpoint. Liest `customers`; schreibt `calls`; externe API: ElevenLabs Twilio inbound URL.

## Frontend-Files (produktive Oberflächen)
- `customer-dashboard/index.html`: Haupt-Customer-Dashboard (Auth, Tabs, Calls/Cases/Settings). Nutzt Netlify-Functions über generischen `/.netlify/functions/${name}`-Client; direkte Supabase-Tabellenzugriffe: `users`, `contracts`, `plan_config`, `avatars`; LocalStorage: `voxera_theme`, `voxera_sound_off`, `voxera_sound_type`, `voxera_browser_notif_off`; SessionStorage: `voxera_tab`, `voxera_last_non_setup_tab`, `voxera_just_activated`.
- `customer-dashboard/activate.html`: Aktivierungs-Entry-Page, primär Redirect/Setup-Hülle; keine direkten Supabase-Tabellenzugriffe gefunden.
- `customer-dashboard/shared/offer-brand.js`: Shared Branding/Offer-UI-Helfer (kein direkter DB-Zugriff).

## DB-Schema (aus SQL-Migrationen)
- Kern-Tabellen (mind.): `customers`, `users`, `calls`, `cases`, `onboarding`, `admins`.
- Erweiterungen/weitere Domains in Migrationen: `subscriptions`, `offers`, `plan_config`, `outbox_events`, invoice-/billing-nahe Tabellen, lifecycle-/rbac-nahe Policies/Trigger.
- Indizes/Trigger/RLS-Policies sind über mehrere dated migration files verteilt (`supabase/sql/*.sql`), inkl. RLS-Hardening (`2026-04-06_rls_access_hardening.sql`) und Notification-Mode-SSOT (`2026-04-07_notification_mode_single_source.sql`).
