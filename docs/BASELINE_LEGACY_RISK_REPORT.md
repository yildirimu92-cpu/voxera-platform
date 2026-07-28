# Voxera – Baseline Legacy Risk Report

**Aktives Repository laut Auftrag:** `yildirimu92-cpu/voxera-platform`  
**Historische Repositories laut Auftrag:** `yildirimu92-cpu/voxera-admin`, `yildirimu92-cpu/voxera-dashboard`

## Statusdefinitionen

- **VERIFIZIERT** – direkt anhand des GitHub-Repository-Zustands oder eines konkret gelesenen Repository-Artefakts bestätigt.
- **AUS REPOSITORY ABGELEITET** – aus Code, Konfiguration oder Dokumentation ableitbar, aber nicht als produktiver Laufzeitstatus bestätigt.
- **NICHT VERIFIZIERT** – mit den verfügbaren Zugängen nicht technisch bestätigt.
- **LIVE-ZUGRIFF ERFORDERLICH** – kann nur über das jeweilige Netlify- oder Supabase-Dashboard beziehungsweise dessen API/CLI verifiziert werden.

Repository-Funde sind ausdrücklich **kein Nachweis**, dass eine Komponente aktuell produktiv deployt, konfiguriert oder ausgeführt wird.

## 1. Prüfgrenze

Dieser Bericht verändert und entwickelt die historischen Repositories nicht weiter.

Die Legacy-Repositories wurden in diesem Dokumentationsauftrag nicht als Source of Truth verwendet. Ihr aktueller Deployment-, Secret- und Domainstatus ist **NICHT VERIFIZIERT**.

## 2. Risiken aus dem aktiven Repository

| Fund | Status | Risiko | spätere Klassifikation |
|---|---|---|---|
| Paketnamen `voxera-admin` und `voxera-dashboard` in Unterverzeichnissen | VERIFIZIERT | Namensverwechslung mit Legacy-Repositories | Code-Rest zu bereinigen, falls fachlich bestätigt |
| Redirect/Default-URLs zu Admin- und Dashboard-Domains | AUS REPOSITORY ABGELEITET | alte Site könnte weiterhin Ziel sein | live prüfen |
| doppelte/fachlich überlappende Functions in Admin und Customer | VERIFIZIERT | parallele Endpoints und uneinheitliche Logik möglich | Konsolidierung später prüfen |
| Customer-Function ruft Admin-Site für ElevenLabs-Sync auf | VERIFIZIERT als Codefund | Domain-/Site-Kopplung | live prüfen |
| Airtable-Abwehrprüfung im SSOT-Skript | VERIFIZIERT | zeigt historischen Risikokontext, keinen aktiven Pfad | bereits inaktiv oder Sicherheitsrest |
| öffentliche Supabase Client-Konfiguration | VERIFIZIERT als Codefund | bei Projektverwechslung oder unzureichender RLS kritisch | Konfiguration prüfen; Public Anon Key nicht automatisch Secret |

## 3. Aktive Airtable-Abhängigkeit

| Prüfpunkt | Ergebnis |
|---|---|
| bestätigter Airtable API-Aufruf im untersuchten aktiven Code | nicht gefunden |
| bestätigter Airtable Write in einer gelesenen Netlify Function | nicht gefunden |
| bestätigter Browser-Airtable-Aufruf | nicht gefunden |
| bestätigter produktiver Airtable-Webhook | NICHT VERIFIZIERT |
| Airtable-Konfiguration in Legacy-Sites | LIVE-ZUGRIFF ERFORDERLICH |

Aktive Airtable-Abhängigkeit: **NICHT BESTÄTIGT**.

Keine Airtable-Migration wird empfohlen.

## 4. Live-Risiken der historischen Repositories

Alle folgenden Punkte sind **LIVE-ZUGRIFF ERFORDERLICH**:

| Risiko | Nachweis | mögliche spätere Massnahme |
|---|---|---|
| aktive Netlify-Site aus `voxera-admin` | Netlify Repository-Verknüpfung | stillzulegen |
| aktive Netlify-Site aus `voxera-dashboard` | Netlify Repository-Verknüpfung | stillzulegen |
| alte Custom Domain | Netlify Domain management | Domain entfernen/umhängen |
| alte Supabase URL / Project Ref | Site ENV und Build-Artefakt | Projektzuordnung prüfen |
| alte Service-Role-Key-Konfiguration | ENV-Key vorhanden; Wert nicht offenlegen | Secret rotieren |
| alte Airtable-Tokens | ENV-Key-Namen | Secret rotieren |
| aktive Airtable-Base-Verbindung | Function-/Webhook-Konfiguration | stillzulegen |
| alte ElevenLabs-/Twilio-Keys | ENV-Key-Namen | Secret rotieren |
| öffentliche Legacy-Functions | Function-Liste und HTTP-Test ohne Mutation | stillzulegen oder schützen |
| alte Redirect-URLs | Supabase Auth und App-Code | entfernen |
| überschneidende Webhook-Ziele | Provider-Dashboards / Netlify | auf aktive Site konsolidieren |
| alte Benutzerzugänge | Supabase Auth / Admin-Tabelle | deaktivieren oder prüfen |

## 5. Codebasierte Sicherheitsrisiken mit möglichem Legacy-Effekt

### Ungeschützter ElevenLabs-Sync-Pfad

**AUS REPOSITORY ABGELEITET**

Die gelesene `trigger-elevenlabs-sync`-Function verwendet Service-Role-Zugriff, ohne im gelesenen Handler eine Caller-Authentisierung zu zeigen.

- Deploymentstatus: **NICHT VERIFIZIERT**
- Massnahme in diesem Auftrag: keine
- spätere Behandlung: Endpoint-Schutz verifizieren und gegebenenfalls härten

### Twilio Callback-/Inbound-Routen

**AUS REPOSITORY ABGELEITET**

In den gelesenen Routen wurde keine Twilio-Signaturprüfung festgestellt.

- Deploymentstatus: **NICHT VERIFIZIERT**
- vorgelagerter Schutz: **NICHT VERIFIZIERT**
- spätere Behandlung: Signatur-/Ingress-Schutz verifizieren

## 6. Klassifikationsregeln nach Live-Prüfung

- **stillzulegen:** aktive alte Site, Domain, Function oder Webhook ohne aktuelle fachliche Funktion
- **Secret zu rotieren:** geheimes Credential ist in Legacy-Site konfiguriert, geteilt, exponiert oder nicht mehr kontrolliert
- **Code-Rest zu entfernen:** nur noch historischer, nicht ausgeführter Code im aktiven Repository
- **bereits inaktiv:** Site/Endpoint ist deaktiviert und besitzt keine Domain/Secrets mehr
- **nicht verifizierbar:** Nachweis fehlt oder Zugang ist unvollständig

## 7. Aktuelles Urteil

- Alte Deployments noch aktiv: **NICHT VERIFIZIERT**
- Legacy-Secrets noch konfiguriert: **NICHT VERIFIZIERT**
- aktive Airtable-Verbindung: **NICHT BESTÄTIGT**
- unmittelbarer Rotationsbedarf: **NICHT BESTIMMBAR ohne Live-Zugriff**
