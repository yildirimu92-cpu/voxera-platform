# Voxera – Baseline Environment Inventory

**Repository-Baseline:** `main@682b88cbc16deb259f6f513de02b7bdc9fc255ab`  
**Grundsatz:** Dieses Dokument enthält ausschliesslich Variablennamen und keine Werte.

## Statusdefinitionen

- **VERIFIZIERT** – direkt anhand des GitHub-Repository-Zustands oder eines konkret gelesenen Repository-Artefakts bestätigt.
- **AUS REPOSITORY ABGELEITET** – aus Code, Konfiguration oder Dokumentation ableitbar, aber nicht als produktiver Laufzeitstatus bestätigt.
- **NICHT VERIFIZIERT** – mit den verfügbaren Zugängen nicht technisch bestätigt.
- **LIVE-ZUGRIFF ERFORDERLICH** – kann nur über das jeweilige Netlify- oder Supabase-Dashboard beziehungsweise dessen API/CLI verifiziert werden.

Repository-Funde sind ausdrücklich **kein Nachweis**, dass eine Komponente aktuell produktiv deployt, konfiguriert oder ausgeführt wird.

## 1. Supabase

| Name | Komponente | Client/Server | Bedarf | erwartete Site | lokal dokumentiert | Netlify verifiziert | Rotation | Risiko bei Fehler |
|---|---|---|---|---|---|---|---|---|
| `SUPABASE_URL` | Netlify Functions | Server | erforderlich | Admin + Customer | ja, im Code | nein | keine Secret-Rotation | DB-Verbindung fällt aus oder zeigt auf falsches Projekt |
| `SUPABASE_ANON_KEY` | JWT-/Caller-Prüfung in Functions | Server | erforderlich für betroffene Functions | Admin + Customer | ja | nein | bei Incident/Mismatch prüfen | Authentisierung schlägt fehl |
| `SUPABASE_SERVICE_ROLE_KEY` | privilegierte DB-Zugriffe | Server | erforderlich | Admin + Customer | ja | nein | hoch; nach Exposition sofort | vollständiger privilegierter DB-Zugriff |
| `window.VOXERA_SUPABASE_URL` | Customer Frontend-Konfiguration | Client | optionaler Injektionspfad | Customer | im Readme genannt | nein | keine | Frontend verbindet sich nicht |
| `window.VOXERA_SUPABASE_ANON_KEY` | Customer Frontend-Konfiguration | Client | optionaler Injektionspfad | Customer | im Readme genannt | nein | Public Key; bei Incident prüfen | Auth-/RLS-Zugriff schlägt fehl |

**VERIFIZIERT als Codefund:** Öffentliche Client-Konfiguration ist teilweise direkt in HTML enthalten. Werte werden hier nicht wiedergegeben.

## 2. Öffentliche URLs und Site-Routing

| Name | Komponente | Typ | Bedarf | Site | Netlify verifiziert | Risiko |
|---|---|---|---|---|---|---|
| `ADMIN_URL` | Customer → Admin ElevenLabs Sync | Server-URL | optional mit Code-Default | Customer | nein | Sync geht an falsche oder nicht erreichbare Admin-Site |
| `PUBLIC_APP_BASE_URL` | öffentliche Offerten-/Vertragslinks | Server-URL | optionaler Fallback | Admin | nein | falsche Links |
| `ADMIN_PANEL_BASE_URL` | öffentliche Linkableitung | Server-URL | optionaler Fallback | Admin | nein | falsche Links |
| `APP_BASE_URL` | öffentliche Linkableitung | Server-URL | optionaler Fallback | Admin | nein | falsche Links |
| `PUBLIC_SITE_BASE_URL` | öffentliche Offertenseiten | Server-URL | bevorzugt | Admin | nein | Kundenlinks zeigen auf falsche Domain |
| `PUBLIC_OFFER_BASE_URL` | öffentliche Offertenseiten | Server-URL | Fallback | Admin | nein | Kundenlinks zeigen auf falsche Domain |
| `TWILIO_STATUS_CALLBACK_BASE_URL` | Twilio Callback | Server-URL | empfohlen | Customer | nein | Status-Callbacks fehlen |
| `URL` | Netlify Built-in | Server/Build | Fallback | beide | nein | falsche automatisch abgeleitete URL |
| `DEPLOY_PRIME_URL` | Netlify Built-in | Server/Build | Fallback | Customer | nein | Preview-/Deploy-URL wird falsch abgeleitet |
| `DEPLOY_URL` | Netlify Built-in | Server/Build | Fallback | Customer | nein | Callback-URL kann falsch sein |

## 3. ElevenLabs und AI

| Name | Komponente | Client/Server | Bedarf | Site | Netlify verifiziert | Rotation | Risiko |
|---|---|---|---|---|---|---|---|
| `ELEVENLABS_API_KEY` | Voice Preview, Agent Provisioning, Sync, Post-Call-Enrichment | Server | erforderlich für jeweilige Funktion | Admin + Customer | nein | hoch | AI-/Telefonie-Funktionen fallen aus; Missbrauch möglich |
| `ELEVENLABS_WEBHOOK_SECRET` | Post-Call HMAC / Tool-Call Secret | Server | erforderlich | Customer | nein | hoch | Webhook-Manipulation oder Ablehnung legitimer Calls |
| `ANTHROPIC_API_KEY` | `ai-generate` | Server | erforderlich für AI-Generierung | Admin | nein | hoch | AI-Generierung fällt aus; Kosten-/Datenrisiko |
| `DEBUG_TWILIO_STATUS` | Twilio Status Logging | Server | optional | Customer | nein | keine | bei falscher Aktivierung unnötige Logdaten |

## 4. Twilio

| Name | Komponente | Client/Server | Bedarf | Site | Netlify verifiziert | Rotation | Risiko |
|---|---|---|---|---|---|---|---|
| `TWILIO_ACCOUNT_SID` | Callback-Anbindung / Testcalls | Server | erforderlich für betroffene Funktionen | Customer | nein | Identifikator; bei Incident prüfen | API-Aufrufe schlagen fehl |
| `TWILIO_AUTH_TOKEN` | Twilio API-Authentisierung | Server | erforderlich | Customer | nein | hoch | Telefonie-Missbrauch und Kostenrisiko |

## 5. E-Mail und Dokumente

| Name | Komponente | Bedarf | Site | Netlify verifiziert | Rotation | Risiko |
|---|---|---|---|---|---|---|
| `SMTP_HOST` | Nodemailer | erforderlich für E-Mail | Admin | nein | nein | Versand fällt aus |
| `SMTP_PORT` | Nodemailer | optional, Default 587 | Admin | nein | nein | Verbindungsfehler |
| `SMTP_USER` | Nodemailer | erforderlich | Admin | nein | bei Incident | Versand fällt aus |
| `SMTP_PASS` | Nodemailer | erforderlich | Admin | nein | hoch | Mailkonto-Missbrauch |
| `MAIL_FROM` | Absender | optional mit Default | Admin | nein | nein | falscher Absender / Zustellprobleme |
| `AVV_PDF_BUCKET` | Supabase Storage | optional, Default `legal` | Admin | nein | nein | Anhang fehlt |
| `AVV_PDF_PATH` | Supabase Storage | optional | Admin | nein | nein | Anhang fehlt |

## 6. Webhooks und Automatisierung

| Name | Komponente | Bedarf | Site | Netlify verifiziert | Rotation | Risiko |
|---|---|---|---|---|---|---|
| `MAKE_MAIL_WEBHOOK` | Call-/Mail-Automatisierung | optional | Customer | nein | bei geheimem Hook hoch | Benachrichtigungen fehlen oder Hook wird missbraucht |

Scheduler werden über `netlify.toml` konfiguriert und verwenden keine im Repository dokumentierten Cron-Secrets.

## 7. Nicht gefundene oder nicht bestätigte Konfiguration

| Erwartungsbereich | Status |
|---|---|
| separates `SUPABASE_JWT_SECRET` | NICHT VERIFIZIERT / im gelesenen Code nicht als Environment-Name bestätigt |
| allgemeines internes Admin-Secret | NICHT VERIFIZIERT |
| separates Cron-Secret | NICHT VERIFIZIERT |
| separates Signatur-Secret für Twilio | NICHT VERIFIZIERT |
| Supabase Auth URL-/Redirect-Konfiguration | LIVE-ZUGRIFF ERFORDERLICH |
| Netlify Site IDs / Account IDs | LIVE-ZUGRIFF ERFORDERLICH |

## 8. Rotationspriorität

### Unmittelbar nach Live-Prüfung rotieren, falls in Legacy-Sites, Logs oder Code exponiert

- `SUPABASE_SERVICE_ROLE_KEY`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_WEBHOOK_SECRET`
- `TWILIO_AUTH_TOKEN`
- `SMTP_PASS`
- `ANTHROPIC_API_KEY`
- geheime Make-Webhook-URLs

### Nicht pauschal als Secret behandeln

- Supabase Project Ref
- Supabase Public Anon Key
- öffentliche Site-URLs
- `TWILIO_ACCOUNT_SID`

Ob eine Rotation **unmittelbar erforderlich** ist, kann erst nach Netlify- und Legacy-Site-Prüfung entschieden werden.
