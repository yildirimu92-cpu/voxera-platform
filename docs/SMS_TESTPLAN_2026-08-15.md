# SMS-Benachrichtigung — Testplan (Etappe C)

Stand 2026-08-15. Gilt für den ersten Piloten (Abschleppdienst, vier bis fünf Empfänger).

Der Plan prüft nicht, ob Code funktioniert — das tun 57 Tests in `customer-dashboard/tests/sms-notification.test.cjs`. Er prüft, was dort nicht prüfbar ist: dass die **Verkettung aus Anruf, Auswertung, Empfängerliste, Twilio und Netz** dasselbe tut wie die Einzelteile.

**Jeder Nachweis kommt aus dem Zielsystem** — `outbox_events`, die Function-Logs, das Twilio-Protokoll. Ein Blick aufs Empfangsgerät ist eine Beobachtung, kein Nachweis: er zeigt das Ergebnis, nicht den Weg dorthin, und unterscheidet nicht zwischen „hat funktioniert" und „hat zufällig gleich ausgesehen".

**Eine Änderung pro Testanruf.** Wer zwei Dinge gleichzeitig umstellt, kann das Ergebnis keinem von beiden zuordnen.

---

## Voraussetzungen

Ohne diese vier ist jedes Testergebnis unbrauchbar oder irreführend.

| # | Voraussetzung | Zustand | Warum |
|---|---|---|---|
| V1 | **`TWILIO_SMS_FROM` erreicht die Function** | eingetragen 2026-08-14 in beiden Netlify-Projekten, Wert `Voxera`; **Nachweis nach dem nächsten Deploy offen** | Der Code fällt bei fehlender Variable auf denselben Wert `Voxera` zurück. Ein erfolgreicher Versand belegt die Variable deshalb **nicht**. Prüfung über `payload->>'from_quelle'` (Erwartung `env`), Verfahren in `SMS_INBETRIEBNAHME_CHECKLISTE_2026-08-11.md`, Abschnitt *Die Prüfung, die ein erfolgreicher Versand nicht ersetzt*. **Auf beiden Sites zu führen** — der Retry-Worker läuft auf `voxera-admin` und käme sonst erst im Fehlerfall zum Vorschein. |
| V2 | **Twilio-Guthaben** | stand bei der Freigabe auf 3.67 USD | Bei sechs SMS je Anruf reicht das für den niedrigen zweistelligen Anrufbereich. Ein leeres Guthaben ist als *wiederholbarer* Fehler eingestuft — Test 4 und 6 würden dann `sms_send_failed` statt der erwarteten Codes zeigen und die Auswertung verfälschen. |
| V3 | **Empfängertabelle in der Zielumgebung** | Staging: ja (2026-08-14). Produktion: **wartet auf Freigabe** | Fehlt die Tabelle, protokolliert der Pfad `team_tabelle_fehlt` und unterdrückt die Anrufer-SMS — das sieht aus wie Test 3, hat aber eine andere Ursache. Die beiden Fälle sind nur am Grund in der Logzeile zu trennen. |
| V4 | **Genau ein Testkunde scharf** | offen (Etappe B) | `sms_notify_enabled = true` bei mehr als einem Kunden macht die Zuordnung der Outbox-Zeilen zum Testanruf unnötig mühsam. |

---

## Die Tests

**Test 3 zuerst.** Er prüft die einzige Zusage, deren Bruch schlimmer wäre als ein kompletter Ausfall: dass niemand eine Bestätigung bekommt, hinter der keiner steht. Alle übrigen Tests prüfen, ob etwas ankommt — dieser prüft, ob etwas **ausbleibt**, und das ist der Fall, den man im Betrieb nicht bemerkt.

### Test 3 — Team komplett unerreichbar, Anrufer darf nichts bekommen

**Aufbau.** Alle Empfänger des Testkunden auf eine bekannte **Festnetznummer** setzen (Twilio antwortet mit 21614, permanent). Kein Code, keine Simulation — eine echte Zurückweisung von Twilio.

**Anruf.** Von einer Mobilnummer, damit der Anrufer grundsätzlich erreichbar *wäre*. Genau darin liegt der Test: der Versand an ihn ist möglich und muss trotzdem unterbleiben.

**Erwartet:**

| Ort | Erwartung |
|---|---|
| Log | `sms_anrufer_unterdrueckt` mit `grund: "team_nicht_erreicht"` — **error**-Stufe |
| Log | je Empfänger `sms_skipped_permanent`, `code: 21614` — **info**, nicht error |
| `outbox_events` | je Team-Empfänger eine Zeile auf `dead` (nicht `failed`) |
| `outbox_events` | **keine** Zeile mit `event_type = 'sms_caller_confirmation'` |
| Gerät des Anrufers | keine SMS |

**Fehlschlag heisst:** Es kommt eine Anrufer-SMS an. Dann behauptet das System gegenüber jemandem am Strassenrand, sein Anliegen sei aufgenommen — während niemand im Team davon weiss. Der Kanal geht in diesem Fall **nicht** in Produktion.

**Zusatzprüfung.** Stehen die Team-Zeilen auf `failed` statt `dead`, sammelt der Retry-Worker sie im nächsten Lauf wieder ein und schickt vier weitere Requests an Twilio, die alle dasselbe Ergebnis bringen. Kein Zustellfehler, aber bezahlte Verschwendung.

*`outbox_events` führt in **keiner** der beiden Umgebungen eine Spalte `dead_lettered_at` (geprüft 2026-08-15). `markOutboxTerminal()` fällt deshalb planmässig auf seinen zweiten Weg zurück und schreibt `status = 'dead'` ohne Zeitstempel. Das ist das erwartete Verhalten, kein Befund — der Zeitpunkt steht in `last_attempt_at`.*

### Test 1 — Normalfall

Ein Anruf mit Rückrufwunsch von einer Mobilnummer, Empfängerliste korrekt.

Erwartet: je Empfänger eine Zeile `sent`, eine Anrufer-Zeile `sent`, `sms_call_notification_ergebnis` mit passenden Zählern. **Reihenfolge prüfen:** die Team-Zeilen tragen einen früheren `created_at` als die Anrufer-Zeile — der Anrufer wird erst benachrichtigt, wenn das Team es ist.

Gleichzeitig **V1 abhaken**: `payload->>'from_quelle'` muss auf allen Zeilen `env` sein.

### Test 2 — Unterdrückte Rufnummer

Anruf mit unterdrückter Nummer (`#31#` vorwählen).

Erwartet: Team-SMS gehen raus; für den Anrufer `sms_skipped` mit `reason: "keine_gueltige_nummer"` und **keine** Outbox-Zeile — es gibt nichts nachzuliefern. Kein `error` im Log; das ist ein Normalfall, keine Panne.

**Abgrenzung zu Test 3:** hier fehlt der Empfänger, dort fehlt der Grund zu senden. Beide enden ohne Anrufer-SMS, aber nur einer davon ist eine Meldung wert.

### Test 4 — Ein Empfänger von mehreren fällt aus

Eine Nummer der Liste auf Festnetz setzen, die übrigen mobil lassen.

Erwartet: die übrigen bekommen ihre SMS; die eine Zeile steht auf `dead`; die Anrufer-SMS geht raus, weil das Team **teilweise** erreicht wurde.

Das ist der Grund für die eigene Tabelle statt einer Kommaliste. Fällt hier der ganze Versand aus, ist die Empfänger-Unabhängigkeit nicht gegeben.

### Test 5 — Doppelte Zustellung

Denselben ElevenLabs-Webhook zweimal zustellen lassen (oder Tool-Call und Post-Call für dasselbe Gespräch).

Erwartet: beim zweiten Mal `sms_skipped` mit `reason: "already_queued"`, **keine** zweite SMS. Bei vier Empfängern mitten in der Nacht ist der Doppelversand nicht nur teuer, sondern der schnellste Weg, dem Team den Kanal zu verleiden.

### Test 6 — Auslöser `callback_only`

Kunde auf `callback_only`, dann ein Anruf **ohne** Rückrufwunsch.

Erwartet: kein Versand, keine Outbox-Zeile. Fällt hier trotzdem eine SMS an, greift der Auslöser nicht — und der Kunde zahlt für jeden Anruf statt für die, die er wollte.

*Dieser Test hängt am Rückruf-Pfad, der heute pauschal greift (`TICKET_RUECKRUF_PFAD_OHNE_AUSTRITT_2026-08-15.md`). Solange der offen ist, misst Test 6 den Fehler mit — das ist kein Grund, ihn wegzulassen, sondern der Anlass, das Ergebnis dem Ticket zuzuordnen statt dem SMS-Pfad.*

### Test 7 — Segmentlänge im Echtbetrieb

Kein eigener Anruf: über alle Testanrufe hinweg prüfen, ob `sms_mehrere_segmente` je auftritt.

Erwartet: nie. Das Budget liegt im ungünstigsten Fall bei acht Zeichen Luft (`Dringlichkeit: unbekannt` plus voller Link). Tritt die Warnung auf, kostet jede Nachricht bei fünf Empfängern das Doppelte — und zwar dauerhaft, nicht nur im Test.

---

## Auswertung

```sql
select o.event_type,
       o.status,
       o.payload->>'from_quelle' as herkunft,
       o.payload->>'to'          as empfaenger,
       o.last_error,
       o.created_at
from outbox_events o
where o.event_type in ('sms_team_notification', 'sms_caller_confirmation')
order by o.created_at;
```

Die Reihenfolge in dieser Ausgabe ist selbst ein Prüfergebnis: Team vor Anrufer, ausnahmslos.

---

## Was dieser Plan nicht prüft

**Zustellung.** `sent` heisst, Twilio hat die Nachricht angenommen und eingereiht — nicht, dass sie auf einem Gerät angekommen ist. Der Beleg dafür käme aus Status-Callbacks je Nachricht und ist bewusst nicht gebaut. Wer aus diesen Tests eine Zustellquote ableitet, liest mehr heraus, als drinsteht.

**Laufzeit unter Last.** Alle Tests sind Einzelanrufe. Ob fünf Empfänger bei gleichzeitigen Anrufen noch in der gemessenen Zeit bedient werden, sagt keiner von ihnen.

**Die Qualität der Dringlichkeit.** Ob die Einstufung *stimmt*, ist eine Frage an die Auswertung, nicht an den Versandweg — sie hängt an `TICKET_DRINGLICHKEIT_PFLICHTFELD_2026-08-11.md`. Dieser Plan prüft nur, dass der Wert, welcher auch immer, unverfälscht in der Nachricht landet.
