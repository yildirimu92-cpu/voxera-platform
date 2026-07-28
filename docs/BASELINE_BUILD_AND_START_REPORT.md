# Voxera – Baseline Build and Start Report

**Repository-Baseline:** `main@682b88cbc16deb259f6f513de02b7bdc9fc255ab`

## Statusdefinitionen

- **VERIFIZIERT** – direkt anhand des GitHub-Repository-Zustands oder eines konkret gelesenen Repository-Artefakts bestätigt.
- **AUS REPOSITORY ABGELEITET** – aus Code, Konfiguration oder Dokumentation ableitbar, aber nicht als produktiver Laufzeitstatus bestätigt.
- **NICHT VERIFIZIERT** – mit den verfügbaren Zugängen nicht technisch bestätigt.
- **LIVE-ZUGRIFF ERFORDERLICH** – kann nur über das jeweilige Netlify- oder Supabase-Dashboard beziehungsweise dessen API/CLI verifiziert werden.

Repository-Funde sind ausdrücklich **kein Nachweis**, dass eine Komponente aktuell produktiv deployt, konfiguriert oder ausgeführt wird.

## 1. Durchgeführte Verifikation

### Repository-Konfiguration

**VERIFIZIERT**

- getrennte `package.json`-Dateien für Admin und Customer
- getrennte `netlify.toml`-Dateien
- statische HTML-Einstiegspunkte
- Netlify Functions in beiden Oberflächen
- Supabase JS als Server-Dependency und Browser-CDN
- Nodemailer im Admin-Paket

### Nicht ausgeführt

**NICHT VERIFIZIERT**

- vollständiger Checkout
- `npm install` / `npm ci`
- Netlify CLI Start
- Function-Bundling
- Syntaxprüfung aller JavaScript-Dateien
- Browser-Smoke-Tests
- lokale Supabase-Verbindung
- Test mit produktionsnahen, aber isolierten Credentials

Es wurden keine externen Aktionen ausgelöst.

## 2. Dependency-Installation

| Bereich | Repository-Zustand | Ergebnis |
|---|---|---|
| Admin | `@supabase/supabase-js`, `nodemailer` definiert | Installation NICHT VERIFIZIERT |
| Customer | `@supabase/supabase-js` definiert | Installation NICHT VERIFIZIERT |
| Root | kein Root-`package.json` gefunden | einheitliche Root-Installation nicht vorhanden |
| Lockfiles | nicht vollständig geprüft | NICHT VERIFIZIERT |

## 3. Build-Verhalten

### Admin Portal

**AUS REPOSITORY ABGELEITET**

- statische Veröffentlichung des Verzeichnisses
- kein expliziter Build Command in `admin-panel/netlify.toml`
- Functions werden aus `netlify/functions` gebündelt

### Customer Dashboard

**AUS REPOSITORY ABGELEITET**

- Build Command führt nur `echo 'Deploy successful'` aus
- statische Veröffentlichung des Verzeichnisses
- Functions werden aus `netlify/functions` gebündelt

**Build erfolgreich/reproduzierbar:** **NICHT VERIFIZIERT**

Ein erfolgreicher Echo-Command bestätigt weder Function-Bundling noch Browser-Syntax.

## 4. Einstiegspunkte

| Oberfläche | Einstiegspunkt | Status |
|---|---|---|
| Admin Portal | `admin-panel/index.html` | VERIFIZIERT |
| Admin Login | `admin-panel/login.html` | VERIFIZIERT |
| Customer Dashboard | `customer-dashboard/index.html` | VERIFIZIERT |
| Customer Aktivierung | `customer-dashboard/activate.html` | VERIFIZIERT |
| Offertenansicht/PDF | `admin-panel/offer-pdf.html` | VERIFIZIERT |
| Vertragsbestätigung | `contract-signed.html` | VERIFIZIERT |
| weitere öffentliche Acceptance-Seiten | Repository-Funde vorhanden | AUS REPOSITORY ABGELEITET |

## 5. Konfigurationsnamen

### Konsistente Servernamen

**VERIFIZIERT als Codefund**

Viele Functions erwarten:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

### Frontend-Abweichung

**VERIFIZIERT als Codefund**

- Customer-Dokumentation nennt `window.VOXERA_SUPABASE_URL` und `window.VOXERA_SUPABASE_ANON_KEY`.
- gelesene HTML-Dateien enthalten statische Client-Konfiguration.

**AUS REPOSITORY ABGELEITET:** Es existiert kein einheitlicher zentraler Konfigurations-Layer für Browser und Functions.

## 6. Fehlerverhalten bei fehlender Konfiguration

**VERIFIZIERT als Codefund**

Mehrere Functions geben explizite Fehler wie `Supabase env missing` oder `Missing env vars` zurück.

**NICHT VERIFIZIERT**

- konsistentes Verhalten aller Functions
- ob Client-Oberflächen falsche oder fehlende Konfiguration verständlich anzeigen
- ob Start ohne produktive Credentials sicher möglich ist

## 7. Lokaler Start

### Dokumentierter Prozess

- Customer-Readme dokumentiert Client-Konfiguration.
- Ein vollständiger Root-Prozess für Admin + Customer + Functions wurde nicht gefunden.

**Dokumentierter lokaler Gesamtstart:** **NICHT VERIFIZIERT**

### Netlify-kompatibler Start

**AUS REPOSITORY ABGELEITET:** Die Verzeichnisstruktur ist grundsätzlich mit getrennten Netlify-Dev-Starts pro Unterverzeichnis vereinbar.

**NICHT VERIFIZIERT:** Tatsächlicher Start, Ports, Redirects, Function-Auflösung und Scheduler.

## 8. Sicherheit lokaler Tests

Produktive Aktionen können durch mehrere Functions ausgelöst werden, darunter:

- E-Mail-Versand
- ElevenLabs-Agent-Änderung
- Twilio-API-Aufruf
- Supabase-Schreibzugriffe
- Billing-/Outbox-Verarbeitung

**NICHT VERIFIZIERT:** Ob ein offizieller Dry-Run-, Sandbox- oder Mock-Modus existiert.

Vor lokalem Integrationstest sind getrennte Test-Credentials und ein separates Supabase-Projekt erforderlich. Diese Aussage ist eine Sicherheitsanforderung, kein Nachweis einer vorhandenen Staging-Umgebung.

## 9. Nicht ausgelöste Aktionen

- keine Kunden angelegt
- keine E-Mail versendet
- kein ElevenLabs-Agent erstellt oder geändert
- keine Twilio-Nummer oder Call-Konfiguration geändert
- keine Supabase-Daten verändert
- keine Migration ausgeführt
- kein Scheduler manuell gestartet

## 10. Ergebnis

| Frage | Ergebnis |
|---|---|
| Dependencies sauber installierbar | NICHT VERIFIZIERT |
| Build erfolgreich | NICHT VERIFIZIERT |
| Functions ladbar | NICHT VERIFIZIERT |
| Syntaxfehler ausgeschlossen | NICHT VERIFIZIERT |
| Admin lokal erreichbar | NICHT VERIFIZIERT |
| Customer lokal erreichbar | NICHT VERIFIZIERT |
| öffentliche Seiten lokal erreichbar | NICHT VERIFIZIERT |
| Supabase lokal initialisierbar | NICHT VERIFIZIERT |
| produktive Aktionen sicher blockierbar | NICHT VERIFIZIERT |
| Build reproduzierbar | NICHT VERIFIZIERT |
