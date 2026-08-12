# Ticket — SMS-Addon: Preis trägt fünf Empfänger nicht

**Datum:** 2026-08-11
**Art:** Kaufmännischer Entscheid (kein Bau)
**Blockiert:** Verkauf von `sms_notify` an Kunden mit Team
**Hängt nicht ab von:** dem SMS-Bau — der Entscheid ist unabhängig fällig
**Herkunft:** `docs/SMS_BENACHRICHTIGUNG_DIAGNOSE_2026-08-11.md`, Abschnitt 5.3

---

## Das Problem in einem Satz

`sms_notify` ist mit CHF 9/Mt. als **Ein-Empfänger-Produkt** kalkuliert, aber die Kosten skalieren mit der Empfängerzahl, der Preis nicht.

Der erste Pilotkunde — ein Abschleppdienst — braucht **vier bis fünf** Empfänger. Das Team koordiniert sich heute über einen WhatsApp-Gruppenchat: wer frei ist, fährt. Ein Ein-Empfänger-Produkt bildet das nicht ab.

## Die Rechnung

Segmentpreis Twilio → Schweizer Mobilnummern: **an der aktuellen Preisliste zu verifizieren.** Hier als Spanne CHF 0.07–0.10 je Segment gerechnet; die Aussage kippt in der Spanne nicht.

### `sms_notify` — CHF 9/Mt., 5 Empfänger

| | |
|---|---|
| Segmente je Anruf | 5 |
| Kosten je Anruf | CHF 0.35 – 0.50 |
| **Break-even** | **≈ 18 – 26 Anrufe/Monat** |

Darüber zahlt Voxera drauf. Bei 10 Anrufen/Tag (≈ 300/Monat) entstehen **CHF 105 – 150/Monat** Kosten gegen **CHF 9** Erlös.

### `sms_endkunde` — CHF 19/Mt., 1 Empfänger

| | |
|---|---|
| Segmente je Anruf | 1 |
| Kosten je Anruf | CHF 0.07 – 0.10 |
| **Break-even** | **≈ 190 – 271 Anrufe/Monat** |

Dieses Addon ist **auskömmlich kalkuliert.** Das Problem liegt ausschliesslich beim Team-Addon.

### Beide zusammen, Pilotkunde

6 SMS je Anruf (5 Team + 1 Anrufer) → **CHF 0.42 – 0.60 je Anruf**. Bei 10 Anrufen/Tag ≈ **CHF 125 – 180/Monat** gegen **CHF 28** Erlös.

### Segment-Falle

Über 160 Zeichen = 2 Segmente = **doppelte Kosten**. Umlaute sind in GSM-7 enthalten, aber ein einziges typografisches Zeichen (`„` `"` `–` `…`) oder Emoji kippt die Nachricht auf UCS-2 — dann ist bei **70 Zeichen** Schluss.

Bei deutschem Text ist das kein Randfall, sondern ein Kostentreiber, der in der Vorlage abzufangen ist. Eine unbedachte Vorlage kann die obige Rechnung verdoppeln.

---

## Empfehlung: Empfängerzahl als Paketmerkmal

Heute staffeln die Pakete nach **Gesprächsminuten**. Für SMS ist das das falsche Mass — die Minuten eines Gesprächs sagen nichts über die Zahl der Leute, die davon erfahren müssen.

**Die Empfängerzahl ist das bessere Paketmerkmal**, aus drei Gründen:

1. **Sie ist der tatsächliche Kostentreiber.** Ein Anruf kostet im SMS-Kanal exakt `Empfänger × Segmente`. Minuten kommen darin nicht vor.
2. **Sie ist für den Kunden verständlich und selbst wählbar.** „Wie viele Leute sollen es erfahren?" ist eine Frage, die ein Abschleppdienst sofort beantwortet — im Gegensatz zu „wie viele Minuten telefonieren Sie im Monat?".
3. **Sie wächst mit dem Kundennutzen.** Ein Betrieb mit fünf Fahrern hat mehr Wert vom Produkt als einer mit einem — und zahlt entsprechend. Bei Minutenstaffelung zahlt der Einzelbetrieb mit langen Gesprächen mehr als das Team mit kurzen, was den Nutzen auf den Kopf stellt.

### Mögliche Ausgestaltung (zu entscheiden, nicht vorgegeben)

- Grundpreis für **1 Empfänger**, Staffel je weiterem Empfänger; oder
- Stufen (**bis 2 / bis 5 / bis 10 Empfänger**) mit Preissprüngen; oder
- Grundpreis plus **Verbrauchsanteil** ab einem Freikontingent.

Wichtig ist weniger, welche Form gewählt wird, als dass **der Preis auf die Empfängerzahl reagiert.**

---

## Zu entscheiden

| # | Frage |
|---|---|
| 1 | Wird `sms_notify` auf ein empfängerabhängiges Modell umgestellt — und in welcher Form? |
| 2 | Bleibt `sms_endkunde` bei CHF 19 (auskömmlich) oder wird es in dieselbe Systematik überführt? |
| 3 | Gilt für den Pilotkunden ein Sonderpreis, bis das Modell steht? |
| 4 | Gibt es ein Freikontingent oder eine Obergrenze je Monat, damit ein Ausreisser-Monat nicht ungedeckt durchschlägt? |
| 5 | Wird der verifizierte Twilio-Segmentpreis vor der Preisentscheidung eingeholt? (Empfehlung: ja — die Spanne oben ist eine Schätzung, der Entscheid sollte auf der echten Zahl stehen.) |

## Nicht Teil dieses Tickets

Der SMS-Bau selbst. Dieses Ticket entscheidet nur, **zu welchem Preis** verkauft wird — nicht, **ob** und **wie** gebaut wird.

## Abhängigkeit in die andere Richtung

Solange dieser Entscheid offen ist, sollte `sms_notify` **nicht an Kunden mit mehr als einem Empfänger verkauft** werden. Der Versand existiert derzeit ohnehin nicht (siehe Diagnose), die Frage wird also erst mit dem Bau akut — aber sie sollte vor dem Bau beantwortet sein, nicht danach.
