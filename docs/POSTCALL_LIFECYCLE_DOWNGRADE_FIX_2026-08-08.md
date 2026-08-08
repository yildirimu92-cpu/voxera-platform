# Post-Call-Webhook dreht den Lebenszyklus zurück — Fix

**Datum:** 2026-08-08
**Betroffene Datei:** `customer-dashboard/netlify/functions/elevenlabs-post-call.js`
**Art:** Implementierung (Bugfix), kein Audit
**Gefunden bei:** Abnahme von Etappe 4 Teil B / Feature 3. Der Fehler ist davon
unabhängig und war zum Zeitpunkt des Funds bereits in Produktion aktiv.

---

## 1. Beobachtetes Problem

Ein Anruf, den jemand bereits bearbeitet, mit einem Rückruf verplant,
abgeschlossen oder archiviert hat, springt zurück auf `dashboard_status = 'new'`
und taucht wieder im Posteingang auf.

## 2. Reproduktionspfad

Nachgemessen am 08.08.2026 gegen die Produktions-DB (`ulcofbgrovgcvowdjrge`)
mit einer Testzeile ohne `customer_id`:

1. Anruf steht auf `dashboard_status = 'closed'`.
2. Der Spaltensatz, den `buildUpdatePayloadFromData()` schreibt, wird auf den
   Datensatz angewandt — also das, was ein erneut eintreffender Webhook tut.
3. Ergebnis: `dashboard_status = 'new'`.

## 3. Relevante Funktionen und Stellen

| Stelle | Rolle |
|---|---|
| `buildUpdatePayloadFromData()` (`:193`–`:283`) | Payload des Haupt-Webhook-Pfads, setzt `dashboard_status = 'new'` bei `:266` |
| `handleToolCall()` (`:312`ff.) | Payload des Tool-Call-Pfads, setzt ihn bei `:365` |
| Initial-Update Haupt-Pfad (`:760`) | schreibt den Payload auf den gematchten Datensatz |
| Polling-Schleife (`:886`) | schreibt bis zu fünfmal **im selben Lauf** nach |
| Update Tool-Call-Pfad (`:389`) | dritter Weg auf denselben Datensatz |

## 4. Ereignispfad

Der Status wird auf drei Wegen zurückgesetzt, nicht nur bei doppelter
Zustellung:

1. **Erneute Zustellung.** ElevenLabs stellt denselben Post-Call-Webhook
   nochmals zu (Retry, manuell ausgelöste Wiederholung). Match-Strategie 1
   findet den Datensatz über `elevenlabs_conversation_id` — genau der Zweck
   dieser Strategie — und überschreibt den Status.
2. **Polling innerhalb eines Laufs.** Nach dem Initial-Update fragt die
   Function die ElevenLabs-API bis zu fünfmal nach und schreibt nach jedem
   Treffer sofort. Jeder dieser Schreibvorgänge trug `dashboard_status = 'new'`
   mit. Eine Statusänderung, die der Kunde während der Auswertung vornimmt,
   wurde damit im selben Lauf wieder plattgemacht.
3. **Tool-Call auf bestehendem Datensatz.** Der Tool-Call-Pfad trifft einen
   Datensatz, den der Post-Call-Pfad bereits angelegt hat.

## 5. Source of Truth

`public.calls.dashboard_status`, CHECK-Constraint
`calls_dashboard_status_check`: `new`, `in_progress`, `follow_up_scheduled`,
`closed`, `archived`.

## 6. Konkurrierende Schreibpfade

`call-save-followup.js` führt eine Übergangstabelle und lehnt unerlaubte
Übergänge ab. Der Webhook kannte keine solche Prüfung und schrieb den Status
bedingungslos — die beiden Schreiber waren sich nicht einig.

## 7. Root Cause

`dashboard_status = 'new'` wurde im Payload gesetzt, ohne zwischen **Anlegen**
und **Aktualisieren** zu unterscheiden. Für einen neuen Datensatz ist `new`
richtig; auf einem bestehenden ist es ein Rückwärts-Sprung.

## 8. Was unverifiziert bleibt

* Der Webhook wurde nicht über HTTP gefeuert — `ELEVENLABS_WEBHOOK_SECRET`
  liegt nicht in der Entwicklungsumgebung. Nachgemessen wurde der
  Datenbank-Effekt des exakten Spaltensatzes.
* Wie häufig ElevenLabs in Produktion tatsächlich erneut zustellt, ist nicht
  erhoben. Der Polling-Pfad (Weg 2) läuft dagegen bei **jedem** Anruf.

## 9. Der Fix

Regel: **der Webhook bewegt den Lebenszyklus vorwärts oder gar nicht.**
Inhaltsfelder werden weiterhin unverändert nachgezogen.

* `LIFECYCLE_ADVANCED_STATUSES` = `in_progress`, `follow_up_scheduled`,
  `closed`, `archived` — alles ausser `new`.
* `withoutStatusDowngrade(payload, currentStatus)` entfernt `dashboard_status`
  aus dem Patch, wenn der Datensatz schon weiter ist. Angewandt auf die zwei
  Updates auf gematchten Datensätzen (Haupt-Pfad und Tool-Call-Pfad).
* `stripDashboardStatus(payload, reason)` entfernt ihn bedingungslos.
  Angewandt auf **alle** Polling-Updates: über den Status hat der Lauf beim
  Initial-Update bzw. beim Insert bereits entschieden.
* Die fünf Match-Selects lesen `dashboard_status` mit.
* Beide INSERT-Pfade bleiben unverändert — dort ist `new` korrekt.
* Unbekannter oder leerer Status gilt als „noch nicht weiter": das
  Bestandsverhalten bleibt, der Fix verengt nur den Schadensfall.

## 10. Warum minimal

Keine Migration, keine Änderung an der Übergangstabelle in
`call-save-followup.js`, keine Änderung am Dashboard. Nur der Webhook hört auf,
einen Status zu schreiben, über den er nichts weiss.

## 11. Netto-Diff

`elevenlabs-post-call.js`: +81/−11, davon rund 30 Zeilen Kommentar. Zwei neue
Helfer, fünf Selects um eine Spalte erweitert, drei Update-Aufrufe umgestellt.
Dazu `verify-call-intake.yml`: +4.

## 12. Tests

`customer-dashboard/tests/postcall-lifecycle-no-downgrade.test.cjs`, 13 Fälle:
Entscheidungslogik (inkl. Grossschreibung, Leerwerte, keine Mutation des
Patches) und Quelltext-Contract (jede Schreibstelle abgesichert, Polling
schreibt den Status gar nicht mehr, Inserts unverändert, geschützte Status
decken die CHECK-Constraint). Eingehängt in `verify-call-intake.yml`, das
ohnehin schon auf diese Datei triggert — dort lief bisher weder ein
`node --check` noch ein Test auf die Function.

Gesamtsuite: 95/95 grün.

## 13. Nicht möglich in dieser Umgebung

Ein echter HTTP-Durchlauf mit Signatur, ein echter ElevenLabs-Retry und ein
Polling-Lauf gegen die echte API. Das braucht ein Deployment und die Secrets.

## 13a. Offener Backlog-Punkt: Live-Verifikation nach dem Merge

**Status: offen, nicht erledigt.** Nachzuholen, sobald ein Rechner mit
Node/Terminal-Zugriff zur Verfügung steht — die Prüfumgebung dieser Session
selbst kann kein Node installieren.

**Werkzeug:** `scripts/live-check-postcall-webhook.mjs` (auf Branch
`claude/anfragen-detail-features-plan-nxal72`, noch nicht auf `main`).
Standard ist Trockenlauf, `--send` schickt tatsächlich ab. Secret kommt aus
der Umgebung, wird nie ausgegeben; Signaturformat bereits gegen die echte
`verifySignature()` geprüft.

**Testkandidat:** `conv_7001kzfdvxm3e92870jmbd41ds8v` — Anruf bei „E2E Test AG“
(`cust_1786034079785_z8voxt`), `dashboard_status = 'closed'` zum Zeitpunkt der
Auswahl. Geeignet, weil er genau den Fix-Fall prüft (Status bereits
fortgeschritten) und die einzige hinterlegte Benachrichtigungsadresse dieses
Testkunden `yildirim.u92@gmail.com` ist — im Fallback-Fall der Make-Mail-Engine
läuft es sonst auf `info@voxera.ch`. Keine echte Kundenadresse ist betroffen.

**Aufruf:**
```bash
SITE_URL=https://<customer-dashboard-site> \
ELEVENLABS_WEBHOOK_SECRET=<aus Netlify Env> \
CONVERSATION_ID=conv_7001kzfdvxm3e92870jmbd41ds8v \
node scripts/live-check-postcall-webhook.mjs --send
```

**Danach zu prüfen:**
1. `select dashboard_status, updated_at from calls where elevenlabs_conversation_id = 'conv_7001kzfdvxm3e92870jmbd41ds8v';` — erwartet: bleibt `closed`.
2. Make-Execution-Historie („09. Voxera Central Mail Engine“) bzw. Postfach
   `yildirim.u92@gmail.com` / `info@voxera.ch` — es darf keine Mail an eine
   andere Adresse als diese beiden gegangen sein.

**Nicht als erledigt markieren, bevor beide Punkte bestätigt sind.**

## 14. Restrisiken

* **Enges Rennen bleibt.** Der Status wird beim Match gelesen und beim
  Initial-Update verwendet. Ändert der Kunde ihn in genau diesem Fenster
  (Millisekunden), gewinnt der Webhook. Für die Polling-Updates ist das Rennen
  beseitigt, weil sie den Status gar nicht mehr schreiben.
* **`in_progress` ist mitgeschützt.** Falls irgendwo erwünscht sein sollte,
  dass ein zweiter Webhook einen angefangenen Eintrag wieder als neu markiert,
  wäre das jetzt unterbunden. Das ist beabsichtigt.
* Neue Hotfix-Blöcke: **nein**.
