# Voxera – Baseline Active Data Architecture

**Repository-Baseline:** `main@682b88cbc16deb259f6f513de02b7bdc9fc255ab`

## Statusdefinitionen

- **VERIFIZIERT** – direkt anhand des GitHub-Repository-Zustands oder eines konkret gelesenen Repository-Artefakts bestätigt.
- **AUS REPOSITORY ABGELEITET** – aus Code, Konfiguration oder Dokumentation ableitbar, aber nicht als produktiver Laufzeitstatus bestätigt.
- **NICHT VERIFIZIERT** – mit den verfügbaren Zugängen nicht technisch bestätigt.
- **LIVE-ZUGRIFF ERFORDERLICH** – kann nur über das jeweilige Netlify- oder Supabase-Dashboard beziehungsweise dessen API/CLI verifiziert werden.

Repository-Funde sind ausdrücklich **kein Nachweis**, dass eine Komponente aktuell produktiv deployt, konfiguriert oder ausgeführt wird.

## 1. Repository-Policy

**VERIFIZIERT**

`admin-panel/SUPABASE_SSOT.md` bezeichnet Supabase als autoritative Quelle für:

- `customers`
- `calls`
- `cases`
- `users`
- `admins`

Weitere Lifecycle- und kommerzielle Tabellen werden dort ebenfalls als Supabase-basiert dokumentiert.

**AUS REPOSITORY ABGELEITET:** Die beabsichtigte Zielarchitektur verwendet Supabase als zentrale operative Datenhaltung.

**NICHT VERIFIZIERT:** Dass jede produktive Laufzeitinstanz und jeder Webhook tatsächlich auf genau dieses Projekt schreibt.

## 2. Datenflüsse nach Domäne

| Domäne | Repository-belegter Pfad | Status des Laufzeitnachweises |
|---|---|---|
| Kunden | Admin-Frontend und Netlify Functions lesen/schreiben `customers` | AUS REPOSITORY ABGELEITET |
| Benutzer | Supabase Auth plus `users`/`admins` | AUS REPOSITORY ABGELEITET |
| Calls | Twilio-/ElevenLabs-Functions und Dashboards verwenden `calls` | AUS REPOSITORY ABGELEITET |
| Offerten | Admin Functions und öffentliche Token-Seiten verwenden `offers` | AUS REPOSITORY ABGELEITET |
| Verträge | öffentliche/administrative Contract-Functions verwenden `contracts` | AUS REPOSITORY ABGELEITET |
| Rechnungen | Billing-Functions verwenden `invoices`/`invoice_items` | AUS REPOSITORY ABGELEITET |
| Onboarding | Admin-Portal und Function `onboarding-update` verwenden `onboarding` | AUS REPOSITORY ABGELEITET |
| Cases | Admin und Customer Functions verwenden `cases` | AUS REPOSITORY ABGELEITET |
| Konfiguration | `plan_config`, `system_config`, `industry_templates`, `voxera_voices` | AUS REPOSITORY ABGELEITET |
| Benachrichtigungen | `notifications` und Outbox-/Event-Logik | AUS REPOSITORY ABGELEITET |

## 3. Browser- und Serverzugriff

### Browser

**VERIFIZIERT als Codefund**

- Admin und Customer laden Supabase JS v2.
- Admin Login verwendet Supabase Auth.
- Customer-Aktivierung verwendet Supabase Auth.
- Customer-Dokumentation beschreibt direkten Supabase-Zugriff mit RLS.

**AUS REPOSITORY ABGELEITET:** Browserzugriffe benötigen korrekt konfigurierte RLS-Policies.

### Server

**VERIFIZIERT als Codefund**

- Netlify Functions verwenden `@supabase/supabase-js`.
- privilegierte Functions erwarten `SUPABASE_SERVICE_ROLE_KEY`.
- Authentisierte Functions verwenden Supabase JWTs und Admin-/Customer-Zuordnungen.

**NICHT VERIFIZIERT:** Welche Functions tatsächlich deployed sind und welche Environment-Variablen live gesetzt sind.

## 4. Telefonie- und AI-Datenfluss

### Twilio

**AUS REPOSITORY ABGELEITET**

1. `twilio-inbound-router` erhält eingehende Twilio-Daten.
2. Die Function versucht den Kunden anhand der Voxera-Nummer in `customers` zu bestimmen.
3. Ein Call-Stub wird in `calls` geschrieben.
4. Der Anruf wird an ElevenLabs weitergeleitet.
5. `twilio-status-callback` aktualisiert den Live-Status in `calls`.

### ElevenLabs

**AUS REPOSITORY ABGELEITET**

1. `elevenlabs-post-call` nimmt Post-Call-Daten entgegen.
2. Die Function gleicht Call-ID, Conversation-ID oder Rufnummern ab.
3. Call-Daten, Transkript und Analyse werden in `calls` aktualisiert.
4. Notifications können in `notifications` geschrieben werden.
5. `trigger-elevenlabs-sync` liest Kunden- und Konfigurationsdaten aus Supabase und aktualisiert den ElevenLabs-Agenten.

**NICHT VERIFIZIERT:** Aktive Webhook-Ziele und produktive Provider-Konfiguration.

## 5. E-Mail, Make und Outbox

**AUS REPOSITORY ABGELEITET**

- E-Mail-Versand erfolgt über SMTP/Nodemailer.
- `MAKE_MAIL_WEBHOOK` wird im Call-/Benachrichtigungskontext erwartet.
- Outbox-Functions und Scheduler sind für Retry-Verarbeitung vorhanden.
- Offertenversand verwendet Outbox- und Event-Logging.

**NICHT VERIFIZIERT:** Aktive Make-Szenarien, Webhook-Ziele, SMTP-Konto und Retry-Laufzeit.

## 6. Airtable-Prüfung

### Gefundene Klassifizierung

| Fund | Klassifizierung |
|---|---|
| `scripts/verify-supabase-ssot.mjs` prüft explizit auf `api.airtable.com` und behandelt einen Fund als Fehler | historische/defensive Sicherheitsprüfung |
| `admin-panel/SUPABASE_SSOT.md` untersagt Airtable als autoritative operative Quelle | Architektur-/Policy-Dokumentation |
| bestätigter produktiver Browser-Aufruf zu Airtable | nicht gefunden |
| bestätigte Netlify Function mit produktivem Airtable-Write | nicht gefunden |
| bestätigter Airtable-Webhook als produktiver Zwischenspeicher | nicht gefunden |

### Bewertung

- Aktiver Airtable-Laufzeitpfad im untersuchten Repository: **NICHT BESTÄTIGT**
- Repository-weite lokale Volltextprüfung mit vollständigem Checkout: **NICHT VERIFIZIERT**
- Aktive Airtable-Konfiguration in Netlify oder externen Webhooks: **LIVE-ZUGRIFF ERFORDERLICH**

Es wird keine Airtable-Migration vorgeschlagen oder geplant.

## 7. Kritische Code-Risiken, ohne Laufzeitbehauptung

### ElevenLabs-Sync

**AUS REPOSITORY ABGELEITET**

`admin-panel/netlify/functions/trigger-elevenlabs-sync.js` verwendet Service-Role-Zugriff und zeigt im gelesenen Code keinen vorgelagerten Admin-/Webhook-Authentisierungscheck.

**NICHT VERIFIZIERT:** Ob die Function produktiv deployed oder anderweitig geschützt ist.

### Twilio-Routen

**AUS REPOSITORY ABGELEITET**

In den gelesenen Twilio-Routen wurde keine Twilio-Signaturverifikation festgestellt.

**NICHT VERIFIZIERT:** Ob Netlify, ein Proxy oder eine andere vorgelagerte Schicht Requests schützt.

Diese Befunde wurden nicht behoben.

## 8. Gesamtbewertung

- Supabase als beabsichtigte zentrale Datenbank: **VERIFIZIERT durch Repository-Policy**
- Supabase als nachweislich einzige produktive zentrale Datenbank: **NICHT VERIFIZIERT**
- aktiver Airtable-Pfad: **NICHT BESTÄTIGT**
- vollständige produktive Datenflussprüfung: **LIVE-ZUGRIFF ERFORDERLICH**
