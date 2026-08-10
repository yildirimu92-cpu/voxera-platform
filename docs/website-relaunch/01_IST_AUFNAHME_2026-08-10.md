# Schritt 1 — Ist-Aufnahme voxera.ch (Sicherung)

**Datum:** 10.08.2026
**Status:** ⚠️ **Unvollständig — die Vollsicherung ist technisch blockiert.** Was rekonstruierbar
war, steht unten. Was nur von der Live-Seite kommen kann, ist am Ende als Beschaffungsliste
aufgeführt.

> **Nachtrag 10.08.2026 — Auflösung zugesagt.** Umut lädt das Netlify-Deploy-ZIP hoch (Weg 2
> unten), zunächst getrieben von der Datenresidenz-Frage, die unabhängig vom Relaunch akut
> behandelt wird. Dasselbe ZIP wird anschliessend als Schritt-1-Sicherungskopie nachgereicht.
> **Sobald es vorliegt:** Inhalt hier ablegen, dieses Dokument von „rekonstruiert" auf
> „gesichert" umstellen, das Content-Audit auf den Volltext ausweiten und die Redirect-Karte
> alt→neu erstellen. Bis dahin bleibt der Schritt formal offen.

---

## 1. Warum die Vollsicherung nicht durchgeführt werden konnte

Die Session hat **keinen Netzwerkzugang zu voxera.ch**. Die Egress-Policy dieser
Ausführungsumgebung lehnt die Verbindung auf Gateway-Ebene ab:

```
$ curl https://voxera.ch          → CONNECT tunnel failed, response 403
$ curl https://www.voxera.ch      → CONNECT tunnel failed, response 403

Proxy-Log:
  { "kind": "connect_rejected",
    "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
    "host": "voxera.ch:443" }
  { … "host": "www.voxera.ch:443" }
```

Das ist eine **Richtlinien-Ablehnung, kein Fehler und kein Timeout**. Die Betriebsanleitung
der Umgebung ist an dieser Stelle eindeutig: blockierte Hosts werden gemeldet, nicht umgangen.
Ein Umweg über Archiv-/Spiegel-Dienste (Wayback, Cache) wäre genau diese Umgehung und wurde
deshalb bewusst **nicht** gemacht.

**Konsequenz:** Der im Auftrag geforderte Schritt 1 („alle Unterseiten, Texte, Bilder,
Struktur/Sitemap vollständig erfassen") ist von hier aus nicht leistbar. Er ist damit
**noch offen**, nicht erledigt. Solange er offen ist, gibt es weiterhin **keine
versionierte Kopie der alten Seite** — das Risiko, gegen das der Schritt gerichtet war,
besteht unverändert fort.

### Drei Wege, das aufzulösen (nach Aufwand sortiert)

| # | Weg | Aufwand | Ergebnis |
|---|-----|---------|----------|
| 1 | **voxera.ch für diese Umgebung freischalten** (Egress-Allowlist der Claude-Code-Umgebung ergänzen). | klein, einmalig | Vollständige, automatisierte Sicherung inkl. aller Unterseiten und Assets — der ursprünglich geplante Schritt 1. |
| 2 | **Netlify-Deploy herunterladen.** Im Netlify-Projekt der Marketing-Seite: `Deploys → aktueller Deploy → Download deploy`. Das ZIP enthält die ausgelieferten Dateien 1:1. ZIP oder entpackten Ordner hier ablegen. | klein | Vollständig und exakt — sogar besser als ein Crawl, weil Quelldateien statt gerendertes HTML. **Empfohlen.** |
| 3 | **Manueller Mirror.** Auf einem Rechner mit Zugang: `wget --mirror --page-requisites --convert-links --no-parent https://voxera.ch/` und das Ergebnis übergeben. | mittel | Vollständig, aber gerendertes HTML mit Crawl-Artefakten. |

Weg 2 ist der beste: er liefert zusätzlich die tatsächliche Dateistruktur, `_redirects`,
`netlify.toml` und eventuelle Build-Artefakte — also genau die Informationen, die für die
Redirect-Karte des Relaunchs gebraucht werden.

---

## 2. Was trotzdem gesichert werden konnte

Die folgende Rekonstruktion stammt **nicht** von der Live-Seite, sondern aus zwei
belastbaren Zweitquellen:

- **Fahrplan-Dokument** (`voxera-fahrplan.html`, Stand 10.08.2026) — enthält Inhalte, die in
  früheren Sessions am **07.08.2026** und in der **Nacht des 10.08.2026** direkt per WebFetch
  von voxera.ch gelesen und dort protokolliert wurden. Preise und FAQ-Zitate sind dort
  wörtlich festgehalten.
- **Repository `voxera-platform`** — Produkt-Code, der auf voxera.ch verlinkt, daraus zitiert
  oder dessen URLs vertraglich referenziert.

Alles unten ist entsprechend als **Zweitquelle** zu lesen: gut genug als inhaltliche
Arbeitsgrundlage, **nicht** gut genug als Archivkopie.

### 2.1 Bekannte URL-Struktur

Aus dem Produkt-Code belegte, real existierende Pfade auf voxera.ch:

| URL | Belegstelle | Art |
|-----|-------------|-----|
| `https://voxera.ch/` | mehrfach | Startseite |
| `https://voxera.ch/agb` | `admin-panel/index.html:3915`, `:10330`; `customer-dashboard/index.html:26166` | Rechtstext, **vertraglich referenziert** |
| `https://voxera.ch/datenschutz` | `customer-dashboard/index.html:26168` | Rechtstext, **vertraglich referenziert** |
| `https://voxera.ch/contract-signed.html?token=…` | `customer-dashboard/index.html:26186` | **Transaktionsseite**, kein Marketing |
| `https://voxera.ch/favicon.svg` | `contract-signed.html:6` | Asset |
| `https://voxera.ch/favicon.ico` | `contract-signed.html:7` | Asset |

Zusätzlich im Fahrplan als „direkt auf voxera.ch geprüft (07.08.2026)" bestätigt:
**Datenschutzerklärung, AGB, Impressum sind live**, dazu eine **FAQ** auf der Seite.
Der Impressum-Pfad ist nicht belegt (vermutlich `/impressum`) — muss aus der Sicherung kommen.

> **Strukturell wichtigster Fund dieses Schritts.**
> `/agb` und `/datenschutz` werden **aus dem Produkt heraus verlinkt** — in der
> Dokumentenliste des Kunden-Dashboards, im Signatur-Dialog des Admin-Portals und im
> **generierten Vertragstext** („Die vollständigen AGB sind integraler Bestandteil dieses
> Vertrags und auf voxera.ch/agb einsehbar"). Diese URLs stehen damit in unterzeichneten
> Verträgen. **Sie dürfen sich beim Relaunch nicht ändern** — auch nicht per Redirect
> „schön genug".
>
> Ebenso: **`/contract-signed.html` ist keine Marketing-Seite**, sondern die
> Vertrags-Ansicht, in die das Kunden-Dashboard mit einem Token deeplinkt. Ein Relaunch,
> der voxera.ch als „reine Marketing-Seite" neu baut, zerschiesst diese Funktion still.
> Die Datei liegt als `contract-signed.html` im Repo `voxera-platform` (Root) — der
> Zusammenhang, wie sie auf die Marketing-Domain kommt, ist nirgends dokumentiert und
> muss beim Relaunch geklärt werden.

### 2.2 Gesicherte Inhalte — Preise (wörtlich, Stand 07.08.2026)

**Starter — CHF 99/Monat**
- Einrichtungsgebühr CHF 490 (Aktionspreis CHF 390)
- Inklusiv-Minuten: 20 Min/Monat · Zusatzminute CHF 0.75
- Enthält: 24/7 KI-Assistent, Dashboard, E-Mail-Benachrichtigungen, 1 Schweizer Nummer
- Nicht enthalten: Rückruf-Management

**Business — CHF 199/Monat** *(als „beliebtester Plan" ausgezeichnet)*
- Einrichtungsgebühr CHF 690 (Aktionspreis CHF 540)
- Inklusiv-Minuten: 100 Min/Monat · Zusatzminute CHF 0.70
- Enthält: alles aus Starter + Rückruf-Management, Priority Support

**Professional — CHF 299/Monat**
- Einrichtungsgebühr CHF 990 (Aktionspreis CHF 790)
- Inklusiv-Minuten: 200 Min/Monat · Zusatzminute CHF 0.65
- Enthält: alles aus Business + Erweiterte Auswertungen (bald), Individuelle Konfiguration

**Konditionen**
- Alle Preise in CHF, exkl. MwSt.
- Keine Mindestlaufzeit bei Monatsplänen, 30 Tage Kündigungsfrist
- Jahrespläne: 12 Monate Laufzeit, automatische Verlängerung ohne Kündigung 30 Tage vor
  Ablauf, 10 % Rabatt (bis zu CHF 240/Jahr Ersparnis)
- **Aktionspreise galten bis 31. Mai 2026** → siehe Content-Audit, Befund C1

### 2.3 Gesicherte Inhalte — Kernaussagen und Zahlen

| Aussage | Fundort |
|---------|---------|
| Kernversprechen „Kein Anruf mehr verpasst" | Auftragsbriefing, als bestehendes Messaging bestätigt |
| Vergleichszahlen **62 %**, **3.4 h**, **CHF 4'500** | Fahrplan; Grundlage des Sales-One-Pagers |
| „Swiss Hosted · DSGVO-konform" | Fahrplan (Badge/Claim auf der Seite) |
| FAQ wörtlich: „Alle Daten werden ausschliesslich in der Schweiz verarbeitet und gespeichert." | Fahrplan, Zitat aus der Website-FAQ |
| „Einrichtung in unter 24h" | Fahrplan („wie auf der Website versprochen") |
| Rufumleitung „funktioniert bei allen Anbietern" | Fahrplan („Website verspricht …") |
| FAQ nennt eine Aufbewahrungsfrist-Regelung für Gespräche | Fahrplan |
| Acht Zielgruppen/Branchen | Auftragsbriefing + SEO-Nachtrag |
| Produkt-Demo/Feature-Darstellung (u. a. Rufumleitung in „Einstellungen" verortet) | Fahrplan („laut Website-Demo") |

### 2.4 Gesicherte Gestaltungs-Spuren

Die einzige im Repo vorhandene Datei, die auf voxera.ch ausgeliefert wird
(`contract-signed.html`), zeigt die dort verwendete Formsprache:

- Farben: Night `#0D1F3C`, Gold `#E8C547`, Canvas `#F1F5F9`, Text `#0F172A`
- Schrift: **Plus Jakarta Sans** (400/500/600/700/800), **von Google Fonts geladen**
- Radien 14–16 px, Karten auf hellem Grund, dunkler Topbar/Header-Block
- `<html lang="de-CH">`, `theme-color #0D1F3C`

Das deckt sich mit den Design-Tokens des Customer-Dashboards
(`customer-dashboard/shared/customer-design-tokens.css`: `--vx-color-night: #0D1F3C`,
`--vx-color-gold: #E8C547`, Display-Schrift Plus Jakarta Sans, Body DM Sans). Die
Marketing-Seite und das Produkt teilen also bereits heute eine Farbwelt.

> Nebenbefund für den Relaunch: **Google Fonts wird per CDN eingebunden.** Das kostet
> Ladezeit (zusätzlicher Verbindungsaufbau im kritischen Pfad, Core Web Vitals) und ist bei
> einer Seite, die mit „Daten ausschliesslich in der Schweiz" wirbt, auch inhaltlich
> unglücklich, weil jeder Seitenaufruf die Besucher-IP an Google überträgt. Beim Relaunch:
> Schriften selbst ausliefern.

---

## 3. Was definitiv fehlt und nur von der Live-Seite kommen kann

Diese Punkte sind **nicht** rekonstruierbar und blockieren Teile des Relaunchs:

1. **Vollständige Seitenliste** inkl. aller Unterseiten, die im Produkt-Code nicht vorkommen
   (Leistungen, Über uns, Kontakt, Demo, Branchenseiten, Landingpages aus Kampagnen …).
2. **Volltext aller Seiten** — insbesondere der **Rechtstexte** (AGB, Datenschutz, Impressum).
   Die dürfen beim Relaunch nicht neu getextet, sondern müssen **unverändert übernommen**
   werden, weil sie in unterzeichneten Verträgen referenziert sind.
3. **FAQ-Volltext** — bisher nur zwei Aussagen daraus bekannt (Datenresidenz,
   Aufbewahrungsfrist).
4. **Bilder, Screenshots, Logo-Varianten, Favicon-Quelldateien.**
5. **Bestehende Meta-Titel/-Descriptions, `sitemap.xml`, `robots.txt`** — Ausgangsbasis für
   die SEO-Arbeit und für die Frage, welche URLs Google heute überhaupt kennt.
6. **`_redirects` / `netlify.toml` der Marketing-Seite** — ohne die lässt sich keine
   verlustfreie Redirect-Karte alt→neu bauen.
7. **Formular-/Tracking-Einbindungen** (Kontaktformular-Ziel, Analytics, Cookie-Banner) —
   sonst gehen beim Relaunch stillschweigend Funktionen und Messreihen verloren.
8. **Ob es weitere transaktionale Seiten gibt** wie `/contract-signed.html`. Eine ist
   belegt; ob es die einzige ist, weiss hier niemand.

**Empfehlung:** Punkt 2 der Tabelle in Abschnitt 1 (Netlify-Deploy-Download) ausführen und
das Ergebnis hier ablegen — dann wird aus diesem Dokument in einem Durchgang die echte
Archivkopie, und die Redirect-Karte lässt sich sauber erstellen.

---

## 4. Ablage

Dieses Dokument liegt in `voxera-platform`, weil diese Session **Schreibrechte nur auf
`yildirimu92-cpu/voxera-platform`** hat; auf `yildirimu92-cpu/voxera-website` besteht nur
Lesezugriff (Stand jetzt: das Repo enthält ausschliesslich eine 17 Byte grosse `README.md`).
Sobald der Bau startet, gehören diese drei Dokumente in `voxera-website` — sie sind bewusst
in einem eigenen Ordner (`docs/website-relaunch/`) gehalten, damit sie in einem Stück
umziehen können.
