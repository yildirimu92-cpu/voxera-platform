# Voxera E-Mail-Vorlagen

Quelltext der Vorlagen, die im Make-Szenario **09 „Voxera Central Mail Engine“** (Scenario-ID `5239089`)
im Feld `html` der jeweiligen E-Mail-Module stehen. Die zwei Anruf-Vorlagen laufen zusätzlich in
Szenario **01 „Call Intake“** (Scenario-ID `5109958`).

Konzept, Inventar des Bestands und Begründung der Design-Entscheidungen:
[`../EMAIL_VORLAGEN_NEUBAU_KONZEPT_2026-08-09.md`](../EMAIL_VORLAGEN_NEUBAU_KONZEPT_2026-08-09.md)

## Arbeitsweise

**Das Repo ist die Quelle, Make ist der Versandweg.** Änderungen laufen über eine Datei hier, nie direkt
im Make-Editor — sonst driften beide Seiten auseinander und der Bestand ist in zwölf Monaten wieder da,
wo er vor diesem Neubau war. Der Wächter (`scripts/verify-mail-templates.mjs`, läuft in der CI) hält die
Regeln auf der Repo-Seite; die Gleichheit mit Make hält nur diese Regel.

Änderung einspielen:

1. Datei hier ändern, Vorschau erneuern, im Browser prüfen (Desktop und ~390 px).
2. `node scripts/verify-mail-templates.mjs` — muss grün sein.
3. Vollständigen Dateiinhalt kopieren.
4. In Make: Szenario → betreffendes E-Mail-Modul → Feld **Content** (`html`) → Inhalt ersetzen.
5. Szenario speichern, Testlauf mit echtem Payload, damit die `{{…}}`-Ausdrücke einmal wirklich laufen.

## Dateien → Route → Modul

| Datei | `mail_type` | Szenario · Route · Modul |
|---|---|---|
| `offer_email.html` | `offer_email` | 09 · Route 0 · Modul 10 |
| `invoice_email.html` | `invoice_email`, `reminder_email`, `reminder_final_email` | 09 · Route 1 · Modul 21 |
| `contract_expired_email.html` | `contract_expired_email` | 09 · Route 2 · Modul 18 |
| `password_changed_email.html` | `password_changed_email` | 09 · Route 3 · Modul 40 |
| `assistant_updated_email.html` | `assistant_updated_email` | 09 · Route 4 · Modul 41 |
| `welcome.html` | `welcome` | 09 · Route 5 · Modul 50 |
| `password_reset.html` | `password_reset` | 09 · Route 6 · Modul 51 |
| `ai_change_request.html` | `ai_change_request` (intern) | 09 · Route 7 · Modul 52 |
| `contract_signed_email.html` | `contract_signed_email` | 09 · Route 8 · Modul 54 **und** Route 9 · Modul 55 |
| `fallback_alarm.html` | — (Negativ-Filter, intern) | 09 · Route 10 · Modul 99 |
| `callback_request_email.html` | `callback_request_email` | 09 · Route 11 · Modul 101 **und** 01 · Route „Callback TRUE“ · Modul 6 |
| `call_notification_email.html` | `call_notification_email` | 09 · Route 12 · Modul 100 **und** 01 · Route „Normal Call“ · Modul 14 |

Zwei Dateien gehen an je zwei Stellen:

- **`contract_signed_email.html`** in Modul 54 (mit PDF-Anhang) und Modul 55 (ohne PDF; bedient
  zusätzlich den zurückgezogenen Alias `countersign_email`). Derselbe Inhalt, zweimal eingefügt.
- **Die beiden Anruf-Vorlagen** in Szenario 09 *und* Szenario 01. Modul 1 ist in beiden Szenarien der
  Webhook und die Feldnamen sind identisch (`caller_name`, `caller_phone`, `call_summary`, `category`,
  `lead_quality`, `duration_seconds`), deshalb läuft derselbe Inhalt an beiden Orten. Solange der
  Szenario-01-Migrations-Branch nicht gemergt und deployed ist, verschickt Szenario 01; danach
  Szenario 09.

## Betreffzeilen

Die Betreffe stehen in Make, nicht in den Dateien. Eine Änderung ist mitzunehmen:

| Modul | vorher | neu |
|---|---|---|
| 101 (Szenario 09) | `{{if(1.callback_requested = true; "Rückruf angefordert – Voxera"; "Neuer Anruf – Voxera")}}` | `Rückruf angefordert – Voxera` |
| 100 (Szenario 09) | `{{if(1.callback_requested; "Rückruf angefordert – Voxera"; "Neuer Anruf – Voxera")}}` | `Neuer Anruf – Voxera` |
| 6 (Szenario 01) | `{{if(1.callback_requested = true; …)}}` | `Rückruf angefordert – Voxera` |
| 14 (Szenario 01) | `{{if(1.callback_requested; …)}}` | `Neuer Anruf – Voxera` |

Die Route wählt bereits über `mail_type` (Szenario 09) beziehungsweise über den Router-Filter auf
`callback_requested` (Szenario 01) aus. Der zweite Test im Betreff konnte nur danebengreifen: fehlte das
Feld, trug die Rückruf-Mail den Betreff „Neuer Anruf“. Alle übrigen Betreffe bleiben unverändert.

## Beim ersten Einsetzen zu prüfen

`invoice_email.html` setzt die Absätze der Mahnungstexte über

```
{{replace(1.email.body_text; newline; "<br>")}}
```

`newline` ist Makes Systemvariable für den Zeilenumbruch. Falls der Make-Editor sie in diesem Feld nicht
auflöst, liefert die Regex-Fassung dasselbe Ergebnis:

```
{{replace(1.email.body_text; "/\n/g"; "<br>")}}
```

Kurz gegenprüfen: in der Testmail müssen zwischen den Absätzen der Mahnung Leerzeilen stehen. Steht dort
ein Block, hat der Ausdruck nicht gegriffen.

## Weitere Dateien

| Datei | Zweck |
|---|---|
| `bausteine.html` | Musterseite mit allen sieben Bausteinen und allen Tonalitäten. Keine versendbare Mail. |
| `vorschau/*.vorschau.html` | Dieselbe Vorlage mit Beispieldaten statt `{{…}}`. Im Browser zu öffnen. |
| `build-templates.py` | Hilfsmittel, mit dem die Vorlagen und Vorschauen erzeugt wurden: ein Gerüst, sieben Bausteine, jeder Wert einmal als Make-Ausdruck und als Beispielwert notiert. `python3 docs/email-templates/build-templates.py` schreibt alle Dateien neu. |

**Verbindlich sind die `.html`-Dateien** — sie sind das, was nach Make wandert. `build-templates.py` ist
das Werkzeug, mit dem sie entstanden sind, und der einzige Weg, Vorlage und Vorschau garantiert im
Gleichschritt zu halten. Wer eine `.html` von Hand ändert, ändert das Skript mit oder löscht es; der
Wächter prüft die Regeln, nicht die Herkunft.

## Regeln, die der Wächter prüft

`node scripts/verify-mail-templates.mjs` (CI: `.github/workflows/verify-mail-templates.yml`). Jede Regel
steht für einen Fund aus der Inventarisierung:

- kein `display:flex`, kein `display:grid`, kein `rgba()`, kein Verlauf, kein `box-shadow`, kein
  `::before`/`::after`, kein Web-Font
- kein `white-space:pre-line` — die Word-Engine hinter Outlook wertet es nicht aus
- höchstens ein `<style>`-Block, und darin ausschliesslich `@media`-Regeln
- `width="600"` **und** `max-width:600px`
- Preheader-Zeile, `color-scheme`- und `supported-color-schemes`-Meta
- jeder Hex-Wert liegt in der 31-Werte-Palette
- jede `<table>` trägt `role="presentation"`, jedes `<img>` hat `width`, `height` und `alt`
- unter jedem Knopf steht der Klartext-Link — geprüft wird die Adresse, nicht die Beschriftung:
  dieselbe `href` muss ein zweites Mal vorkommen. Wie der Link aussieht, ist frei; die Vorlagen
  zeigen die gekürzte Fassung (Schema weg, ab 34 Zeichen mit Auslassungszeichen)
- **Ausnahme `welcome.html` und `password_reset.html`:** dort muss die Adresse ungekürzt dastehen.
  Die Mail kommt aufs Telefon, aktiviert wird am Rechner — der Link ist dort kein blosser Rückfall,
  sondern ein zweiter Weg und muss abtippbar bleiben. Auch das prüft der Wächter.
- `lead_quality` wird nur über `lower()` und nur gegen kleingeschriebene Werte verglichen
- keine Bedingung auf `callback_requested`
- zu jeder Vorlage existiert eine Vorschau, und in der Vorschau steht kein `{{` mehr
