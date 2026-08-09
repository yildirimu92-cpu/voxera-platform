# Voxera Make-Szenarien

Produktive Make-Secrets und exportierte Szenarien mit Verbindungs-IDs werden nicht im Repository gespeichert.

## Anruf-Benachrichtigungen (Migration vom 09.08.2026)

Die Benachrichtigung an den Kunden nach einem Anruf lief bis zum 09.08.2026 über
Szenario `01 Call Intake Audited v4 Secure Resolver` und dessen eigenes
SMTP-Modul — komplett an `_lib/mail-delivery.js` und `outbox_events` vorbei. Sie
läuft jetzt über die zentrale Mail-Engine (Szenario 09) wie jeder andere
Mailtyp.

### Warum

Szenario 01 bestand aus genau drei Modulen: Webhook, ein HTTP-Aufruf auf
`call-intake-resolve-customer`, und ein Router mit zwei SMTP-Modulen. Es schrieb
nichts in die Datenbank und löste nichts weiter aus. Es war also reiner
Mailversand — nur eben ohne Versandprotokoll, ohne Retry und mit einem
zusätzlichen Netzwerk-Hop.

Dieser Hop war die Fehlerquelle. Der Resolver beantwortet einen leeren
`called_number` mit HTTP 400. Der Wert stammte aus `metadata.phone_call` des
ElevenLabs-Payloads — einem Feld, das dort fehlen kann und im Tool-Call-Pfad
(Laras `send_to_voxera`) praktisch immer fehlt, weil der Agent seine eigene
Nummer nicht kennt. Der `ifempty`-Rückfall auf `voxera_number` half nicht: dieses
Feld wurde nie mitgeschickt.

Belegt in der Datenbank: der Anruf vom 04.08.2026 13:18:21
(`conv_8801kz6ehxwhfw98w81hm73gjq4m`) steht mit `called_number = null` und
`customer_id = null` in `calls`; der zugehörige Make-Fehlschlag trägt den
Zeitstempel 13:18:37. Insgesamt 13 Fehlschläge, danach war das Szenario aus und
als ungültig markiert, mit 17 unverarbeiteten Einträgen in der Hook-Queue.

Der neue Pfad nimmt den Kunden aus der bereits gematchten `calls`-Zeile
(`customer_id`) statt aus der Telefonnummer im Webhook-Payload. Die Nummer ist
nur noch Rückfallweg. Damit ist diese Fehlerklasse strukturell erledigt, nicht
nur repariert.

### Was sich geändert hat

| | vorher | nachher |
|---|---|---|
| Auslöser | `MAKE_CALL_INTAKE_WEBHOOK` → Szenario 01 | `_lib/call-notification.js` → `deliverMail` → `MAKE_MAIL_WEBHOOK` → Szenario 09 |
| Kundenauflösung | HTTP-Aufruf auf `call-intake-resolve-customer` | in-process über `sbAdmin`, aus der `calls`-Zeile |
| Protokoll | keins | `outbox_events` |
| Retry | keiner | `outbox-retry-worker.js` (greift automatisch über `isMailEngineType`) |
| Doppelversand | ungeschützt | `dedupe_key` = `<mail_type>:<calls.id>` + Vorabprüfung + Unique-Index |

Zum Doppelversand: der Unique-Index `uq_outbox_events_type_dedupe_key` wurde am
09.08.2026 angewendet (`supabase/migrations/2026-08-09_outbox_dedupe_unique.sql`,
über PR #892 nachdokumentiert). Er
schliesst die Lücke nicht ganz — `deliverMail` wertet `outbox.duplicate` nicht
aus und verschickt auch bei einer Kollision. Bei zwei exakt gleichzeitigen
Läufen entsteht deshalb weiterhin eine zweite Mail, nur keine zweite
Outbox-Zeile. Der reale Fall, die erneute Zustellung Minuten später, wird von
der Vorabprüfung in `_lib/call-notification.js` abgefangen.

`invoice-mail-dispatch.js` macht es bereits richtig und verzweigt vollständig
auf `outbox.duplicate`. `deliverMail` auf dasselbe Verhalten zu bringen, wäre
der konsequente nächste Schritt — betrifft aber auch Vertrags- und
Lifecycle-Mails und gehört deshalb in einen eigenen Auftrag.

Abgelöst und damit ohne Aufgabe: Szenario 01, der Hook
`01_call_intake_webhook`, die Netlify-Variable `MAKE_CALL_INTAKE_WEBHOOK`, die
Function `call-intake-resolve-customer` und deren Secret
`CALL_INTAKE_RESOLVER_SECRET`.

### Stilllegung (Stand 09.08.2026)

Erledigt im Repository: `call-intake-resolve-customer.js` und
`call-intake-resolver-contract.test.cjs` sind gelöscht. Zwei Wächter halten das
fest — `verify-call-intake.yml` und `verify-mail-engine-contracts.mjs` —, und
beide listen die gelöschten Pfade weiterhin als Auslöser, damit ein
Wiederanlegen den Lauf überhaupt startet.

Offen und nur ausserhalb des Repositories erledigbar:

| Schritt | wo | Wirkung |
|---|---|---|
| `CALL_INTAKE_RESOLVER_SECRET` löschen | Netlify, Dashboard-Site | der Wert ist offengelegt und darf nirgends wiederverwendet werden |
| Szenario 01 löschen | Make | entfernt die letzte Klartext-Kopie des Secrets aus dem Blueprint |
| Hook `01_call_intake_webhook` löschen | Make | mit dem Szenario |

Reihenfolge ist unkritisch, sobald der Deploy dieses PRs durch ist: ohne die
Function läuft der Endpunkt nicht mehr, das Secret authentifiziert also nichts
mehr. Bis dahin ist er weiterhin erreichbar.

`MAKE_CALL_INTAKE_WEBHOOK` bleibt **gesetzt** — siehe den Kasten oben.

> `MAKE_CALL_INTAKE_WEBHOOK` sollte in Netlify **gesetzt bleiben**, obwohl sie
> niemand mehr liest. `resolveMailWebhook()` in `_lib/mail-delivery.js` weist
> den Versand ab, wenn `MAKE_MAIL_WEBHOOK` denselben Wert trägt — die Sperre
> gegen genau die Verwechslung, die in PR #857 die Admin-Benachrichtigungen
> gekostet hat. Ohne den Vergleichswert ist diese Sperre wirkungslos.

### Die beiden neuen Routen in Szenario 09

Zwei `mail_type`-Werte, passend zu den zwei Vorlagen aus Szenario 01:

| `mail_type` | Vorlage aus Szenario 01 | Wann sie rausgeht |
|---|---|---|
| `callback_request_email` | Modul 6, „Rückruf angefordert" (rot, `#DC2626`) | `notification_mode` ist `callback_only` oder `all_calls` |
| `call_notification_email` | Modul 14, „Neuer Anruf" (blau, `#1A6FE8`) | `notification_mode` ist `all_calls` |

Das Gating sitzt jetzt im Code (`decideMail()` in `_lib/call-notification.js`),
nicht mehr im Router-Filter. Die Make-Routen filtern nur noch auf den
`mail_type` — erreicht eine Mail Szenario 09, ist bereits entschieden, dass sie
raus darf.

> **Der Zwischenstand ist abgelöst.** Während der Migration gatete
> `decideMail()` bewusst auf die Legacy-Booleans `notification_active` /
> `new_log_email_active`, damit der Umzug das Verhalten nicht nebenbei
> mitändert. Der Auftrag „Benachrichtigungseinstellungen" hat die Funktion
> anschliessend wie abgestimmt auf `notification_mode` umgestellt — die
> einzige Spalte, die die Einstellungsseite des Kunden schreibt. Die
> Legacy-Booleans liest hier niemand mehr.
>
> Die Make-Routen waren davon **nicht** betroffen: sie filtern nur auf den
> `mail_type`, und beide Typen sind unverändert geblieben. Der Wechsel war
> reine Code-Sache, ohne erneute Make-Änderung.

> **Ein neuer `mail_type` braucht zwei Änderungen in Szenario 09, nicht eine.**
> Beim Rauchtest am 09.08.2026 lieferten beide Läufe Status „Erfolg" mit **drei**
> Operationen bei kleinem Transfer — eine korrekt geroutete Mail ohne Anhang
> kostet zwei (Webhook + ein E-Mail-Modul). Der Testkunde bekam die richtige
> Mail, info@voxera.ch zusätzlich die Alarmmail „unbekannter mail_type".
>
> Grund: der Make-Router schickt das Bundle durch *jede* Route, deren Filter
> zutrifft. Die Fallback-Route ist nicht als echte Make-Fallback-Route
> markiert, sondern über einen Filter gebaut, der die bekannten `mail_type`-Werte
> aufzählt. Ein neuer Typ hat also seine eigene Route **und** gilt weiterhin als
> unbekannt, bis er in der Fallback-Bedingung ausgenommen wird.
>
> Wer hier einen `mail_type` ergänzt: Route anlegen **und** den Typ in die
> Ausnahmeliste der Fallback-Route eintragen. Sonst geht pro Vorgang eine
> Alarmmail an info@voxera.ch — und ein Alarmkanal, der bei jedem normalen
> Vorgang anschlägt, wird nach kurzer Zeit ignoriert.
>
> Für die zwei Anruf-Typen ist beides erledigt und am 09.08.2026 verifiziert:
> nach dem gespeicherten Ausschluss fielen beide Läufe von drei auf **zwei**
> Operationen, der Transfer um exakt 67 Bytes je Lauf, keine Alarmmail mehr.

### Prüfen, ob eine Route greift — ohne Make-Oberfläche

Makes API liefert zu einer Ausführung nur `{"status":"SUCCESS"}`, keine
Modul-Details. Die Operationen-Zahl aus `executions_list` ersetzt sie:

| Operationen | Bedeutung |
|---|---|
| 1 | nur der Webhook — keine Route hat gegriffen |
| 2 | Webhook + ein E-Mail-Modul — **richtig** für Mails ohne Anhang |
| 3, kleiner Transfer | Webhook + zwei E-Mail-Module — eine Route *und* der Fallback |
| 3, Transfer ~54 KB | Webhook + PDF-Abruf + E-Mail — richtig für Rechnungen/Offerten |

Ebenso nützlich: die `modify`-Einträge in derselben Liste. Fehlt zwischen zwei
Testläufen ein `modify`, wurde die Änderung in Make nicht gespeichert — genau
das war am 09.08.2026 die Ursache dafür, dass eine korrekt gebaute
Fallback-Bedingung scheinbar wirkungslos blieb. Erst der Blick auf die
Ereignisliste hat es gezeigt; aus der Operationen-Zahl allein sah es wie ein
Filterproblem aus.

Mapping der Routen:

- Filter: `{{1.mail_type}}` gleich `call_notification_email` bzw.
  `callback_request_email`
- `to`: `{{1.recipient.email}}` (vorher `{{2.data.customer_email}}`) — verschachtelt wie bei allen anderen Mailtypen
- `subject`: `Neuer Anruf – Voxera` bzw. `Rückruf angefordert – Voxera`
- Verbindung: `Voxeraa SMTP V2`, `Reply-To: info@voxera.ch` — wie in Szenario 01
- HTML: unverändert aus Szenario 01 übernommen

Die Vorlagen können unverändert bleiben, weil der Payload dieselben Feldnamen
trägt wie das Webhook-Bundle von Szenario 01: `caller_name`, `caller_phone`,
`call_summary`, `call_summary_short`, `category`, `lead_quality`, `next_action`,
`priority`, `duration_seconds`, `callback_requested`. Ergänzt um
`recipient.email` / `recipient.name` (verschachtelt, Hausregel der Mail-Engine),
`customer_id`, `customer_name`, `contact_name`,
`called_number`, `call_id`, `elevenlabs_conversation_id`, `dashboard_url`.

`scripts/verify-call-notification-migration.mjs` friert diese Feldnamen ein —
ändert sich einer, rendern die Vorlagen leere Felder, und das fällt sonst erst
beim Kunden auf.

**Vorlagen-Fund beim Übertragen:** beide HTML-Blöcke vergleichen
`{{if(1.lead_quality = "Hot"; ...)}}` gross geschrieben, während die Datenbank
`hot` / `warm` / `cold` klein schreibt. Das Lead-Qualitäts-Abzeichen fiel damit
in Szenario 01 immer in den blauen Zweig. Beim Anlegen der neuen Routen auf
Kleinschreibung korrigieren.

## Call Intake – Secure Resolver (abgelöst)

Historisch, für die Nachvollziehbarkeit der Fehlschläge oben.

Das Szenario `01 Call Intake Audited v4 Secure Resolver` sendete im HTTP-Modul 2
einen JSON-Body an `call-intake-resolve-customer`:

```json
{
  "called_number": "{{ifempty(1.called_number; 1.voxera_number)}}"
}
```

Der exportierte Secret-Wert galt bereits als offengelegt und musste rotiert
werden. Die Rotation erklärt die `Unauthorized`-Fehlschläge vom 05.08.2026,
08:55 und 08:59 — eine von den späteren `Bad Request`-Fehlschlägen unabhängige
Ursache, die mit der Blueprint-Änderung um 08:59:38 behoben war. Mit der
Migration entfällt der Aufruf ganz; das Secret kann ersatzlos zurückgezogen
werden.
