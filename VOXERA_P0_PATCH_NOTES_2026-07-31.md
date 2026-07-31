# Voxera P0 Patch Notes — 31.07.2026

## Behobene Punkte

1. **Kunden-/Onboarding-Ladevorgang entkoppelt**
   - Fehler beim Laden von `onboarding`, `calls` oder `voxera_cases` brechen die komplette Kundenansicht nicht mehr ab.
   - Kunden bleiben sichtbar, während fehlgeschlagene Teilbereiche in der Browser-Konsole protokolliert werden.

2. **Billing → Kunden öffnen**
   - Der Billing-Button führt nun in den bestehenden Kunden-Workspace statt in das fragile grosse Kundenprofil-Modal.

3. **Mahnungs- und Rechnungsdialoge**
   - Dialoge verwenden eine begrenzte Viewport-Höhe.
   - Der Inhaltsbereich ist vertikal scrollbar.
   - Header und Aktionsbereich bleiben erreichbar.
   - Zusätzliche Anpassungen für kleine Laptop-Höhen und Mobile.

4. **Kundenprofil-Modal**
   - Das Profil erhält einen eigenen scrollbaren Inhaltsbereich, damit lange Inhalte auf Laptop und Mobile bedienbar bleiben.

## Technische Prüfung

- Inline-JavaScript aus `admin-panel/index.html`: Syntaxprüfung mit `node --check` bestanden.
- Sämtliche Netlify-Functions in Admin- und Customer-Portal: Syntaxprüfung bestanden.
- Das Repository enthält keine konfigurierten npm-Testskripte; automatisierte End-to-End-Tests waren daher nicht ausführbar.

## Noch offen / nicht als gelöst markiert

- Verlässliche Zustellbestätigung und Idempotenz für Billing-E-Mails.
- Ursache des wiederkehrenden Dashboard-Reloads im Produktivbetrieb.
- Graue Vertragsseite unter realen Datenbedingungen.
- End-to-End-Test mit echter Supabase-Session, Make-Webhook und Mailzustellung.

## P0.1 Fortsetzung

5. **Doppelte Vollreloads verhindert**
   - `loadDataFromSupabase()` verwendet jetzt einen Single-Flight-Mechanismus.
   - Parallel ausgelöste Ladevorgänge teilen denselben Request statt das komplette Portal mehrfach neu aufzubauen.
   - Nach dem ersten erfolgreichen Laden wird bei Folgeaktualisierungen kein blockierendes Vollbild-Ladeoverlay mehr eingeblendet.

6. **Vertragsansicht gehärtet**
   - IDs und Beträge werden defensiv normalisiert.
   - Ein Darstellungsfehler führt nicht mehr zu einer unbedienbaren grauen Seite, sondern zu einer sichtbaren Fehlermeldung mit «Erneut laden».

7. **Billing-Mailversand idempotent vorbereitet**
   - Jeder bewusste Versand erhält eine eindeutige `request_id`.
   - Browser-/Netzwerk-Retries mit derselben Request-ID lösen keinen zweiten Make-Webhook aus.
   - Neue SQL-Migration: `supabase/sql/2026-07-31_mail_dispatch_idempotency.sql`.
   - Duplikate werden anhand `event_type + dedupe_key` erkannt und unterdrückt.

8. **Versandstatus fachlich korrigiert**
   - HTTP 200 von Make wird nicht mehr als bestätigte E-Mail-Zustellung bezeichnet.
   - Die UI meldet nun korrekt «an die E-Mail-Automation übergeben».
   - Die API liefert zusätzlich `accepted: true` und `delivery_confirmed: false`.
   - Für eine echte Zustellbestätigung ist weiterhin ein Make-/Mailprovider-Callback erforderlich.

## Zusätzliche Prüfung

- Billing-Mail-Control-Verifikation: 14/14 Checks bestanden.
- Inline-JavaScript Admin-Portal: Syntaxprüfung bestanden.
- Alle Netlify Functions: Syntaxprüfung bestanden.
