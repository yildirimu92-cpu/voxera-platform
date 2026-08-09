# Voxera E-Mail-Vorlagen

Quelltext der Vorlagen, die im Make-Szenario **09 „Voxera Central Mail Engine“** (Scenario-ID `5239089`)
im Feld `html` der jeweiligen E-Mail-Module stehen.

Konzept, Inventar des Bestands und Begründung der Design-Entscheidungen:
[`../EMAIL_VORLAGEN_NEUBAU_KONZEPT_2026-08-09.md`](../EMAIL_VORLAGEN_NEUBAU_KONZEPT_2026-08-09.md)

## Arbeitsweise

**Das Repo ist die Quelle, Make ist der Versandweg.** Änderungen laufen über eine Datei hier, nie direkt
im Make-Editor — sonst driften beide Seiten auseinander und der Bestand ist in zwölf Monaten wieder da,
wo er vor diesem Neubau war.

Änderung einspielen:

1. Datei hier ändern, Vorschau neu erzeugen, im Browser prüfen (Desktop und ~390 px).
2. Vollständigen Dateiinhalt kopieren.
3. In Make: Szenario 09 → betreffendes E-Mail-Modul → Feld **Content** (`html`) → Inhalt ersetzen.
4. Szenario speichern. Testlauf mit echtem Payload, damit die `{{…}}`-Ausdrücke einmal wirklich laufen.

## Dateien → Route → Modul

| Datei | `mail_type` | Route | Modul-ID | Status |
|---|---|---|---|---|
| `offer_email.html` | `offer_email` | 0 | 10 | **gebaut (Referenz)** |
| — | `invoice_email`, `reminder_email`, `reminder_final_email` | 1 | 21 | offen |
| — | `contract_expired_email` | 2 | 18 | offen |
| — | `password_changed_email` | 3 | 40 | offen |
| — | `assistant_updated_email` | 4 | 41 | offen |
| — | `welcome` | 5 | 50 | offen |
| — | `password_reset` | 6 | 51 | offen |
| — | `ai_change_request` | 7 | 52 | offen |
| — | `contract_signed_email` (mit PDF) | 8 | 54 | offen |
| — | `contract_signed_email` (ohne PDF) | 9 | 55 | offen, identischer Code wie Modul 54 |
| — | Fallback, unbekannter `mail_type` | 10 | 99 | offen |
| — | `callback_request_email` | 11 | 101 | offen, siehe Entscheidung E1 im Konzept |
| — | `call_notification_email` | 12 | 100 | offen, siehe Entscheidung E1 im Konzept |

Die Module 54 und 55 tragen denselben Code — derselbe Dateiinhalt wird zweimal eingefügt. Modul 55
bedient zusätzlich den zurückgezogenen Alias `countersign_email`.

## Weitere Dateien

| Datei | Zweck |
|---|---|
| `bausteine.html` | Musterseite mit allen sieben Bausteinen und allen Tonalitäten. Keine versendbare Mail — Vorlage zum Kopieren und zum Freigeben des Vokabulars. |
| `vorschau/*.vorschau.html` | Dieselbe Vorlage mit eingesetzten Beispieldaten statt `{{…}}`-Ausdrücken. Im Browser zu öffnen. Wird von Hand erzeugt und mitversioniert. |

## Regeln, an die sich jede Datei hier hält

Vollständige Begründung in Abschnitt 5 des Konzepts. Kurzfassung:

- Tabellen-Layout, **kein** `display:flex`, **kein** `display:grid`
- Inline-Styles für alles, was trägt; der `<style>`-Block enthält nur mobile Polsterung und darf
  ersatzlos entfallen, ohne dass das Layout kippt
- keine Web-Fonts, keine `rgba()`, keine Verläufe, keine `box-shadow`, kein `::before`/`::after`
- `width="600"` als Attribut **und** `width:100%;max-width:600px` im Style
- Flächenfarben doppelt: `bgcolor`-Attribut und `background-color` im Style
- unter jedem Knopf steht der Klartext-Link
- Preheader-Zeile als erstes Element im `<body>`
- nur Farben aus der Palette in Abschnitt 4 des Konzepts
- `lead_quality` wird ausschliesslich kleingeschrieben verglichen (`lower(1.lead_quality) = "hot"`)
