# Ticket — Dringlichkeit wird Pflichtfeld, mit branchenabhängigen Kriterien

**Datum:** 2026-08-11
**Art:** Bau (Data Collection + Prompt + Branchenvorlagen). Keine Migration.
**Vorrang:** **vor** Ortsfeld und gesprochener Rückrufnummer (`TICKET_ORT_UND_RUECKRUFNUMMER_2026-08-11.md`)
**Herkunft:** `docs/SMS_BENACHRICHTIGUNG_DIAGNOSE_2026-08-11.md` + `BEFUND_TWILIO_DATENRESIDENZ_2026-08-11.md`

---

## Warum das jetzt oben steht

Seit dem 2026-08-11 trägt die Team-SMS **kein Anliegen** mehr — Name, Zusammenfassung, Kategorie und Ort sind entfallen, damit bei Twilio (400 Tage, USA) kein Inhaltsdatum entsteht.

Damit ist die Dringlichkeit **die einzige Angabe in der Nachricht, die „jetzt oder morgen" beantwortet.** Alles andere ist Adressierung: dass ein Anruf da ist, unter welcher Nummer zurückzurufen ist, und wo die Details stehen.

Gemessen in Produktion über alle 33 Anrufe:

| Wert | Anrufe | Anteil |
|---|---|---|
| *(nicht eingestuft)* | 19 | **58 %** |
| niedrig | 10 | 30 % |
| mittel | 3 | 9 % |
| hoch | 1 | 3 % |

**Auf der Mehrheit der Anrufe stuft der Assistent nicht ein.** Die Vorlage schreibt dann `Dringlichkeit: unbekannt` — ehrlich, aber ohne Entscheidungswert. Die Nachricht zwingt in diesen Fällen zum Öffnen des Links, also genau zu dem Aufwand, den sie ersparen soll.

Das war folgenlos, solange die Dringlichkeit ein Zusatz war. Als alleiniger Träger ist es der Engpass.

## Warum es billig ist

`urgency` kommt aus derselben Quelle wie Ort und Rückrufnummer — `pickDC(dc, 'urgency')` in `elevenlabs-post-call.js:316`, also aus ElevenLabs' Data Collection.

Der Unterschied zu den beiden anderen Feldern: **Die Spalte `calls.urgency` existiert bereits.** Keine Migration, kein Datenmodell, kein Deploy-Reihenfolgeproblem. Es fehlt nur, dass der Assistent sie zuverlässig füllt.

---

## Was zu bauen ist

### 1. Data-Collection-Feld verpflichtend

Feld `urgency` im ElevenLabs-Agenten als Pflichtfeld mit geschlossener Werteliste: `hoch` | `mittel` | `niedrig`.

Geschlossen, nicht frei: `dringlichkeitAusAnruf()` in `_lib/call-sms.js` lässt heute schon nur diese drei Werte durch und verwirft Freitext — ein „Kunde will Termin" darf nicht als Dringlichkeitsstufe in der SMS landen. Ein offenes Feld würde also die Hälfte der Einstufungen still verlieren.

### 2. Prompt-Kriterien, branchenabhängig

Über `industry_templates`, nicht global. Die Kriterien stehen unten.

### 3. Rückfallregel

Kann der Assistent nicht einstufen — weil der Anrufer auflegt oder nichts Verwertbares sagt —, bleibt das Feld leer und die SMS schreibt `unbekannt`. Das ist bewusst so und soll **nicht** durch eine Vorgabe wie „im Zweifel mittel" ersetzt werden: Eine erfundene Einstufung ist schlechter als ein ehrliches „unbekannt", weil sie nicht als Lücke erkennbar wäre.

Ziel ist, den Anteil zu senken, nicht ihn wegzudefinieren.

---

## Die Kriterien: nicht das Thema, sondern die Folge des Wartens

Der übertragbare Massstab ist nicht, **worum** es geht, sondern **was passiert, wenn es bis morgen liegen bleibt**:

| Stufe | Massstab |
|---|---|
| **hoch** | Warten verursacht Schaden, der später nicht mehr behebbar ist — oder Menschen sind gefährdet. Der Anruf gehört jetzt bearbeitet, auch nachts. |
| **mittel** | Warten kostet Geld, Termine oder Komfort, ist aber ohne bleibenden Schaden. Am nächsten Morgen als Erstes. |
| **niedrig** | Warten kostet nichts ausser Zeit. Im normalen Tagesgeschäft. |

Dieser Massstab ist branchenunabhängig. Was sich unterscheidet, sind die **Beispiele**, an denen der Assistent ihn erkennt — und die müssen konkret genug sein, dass sie ohne Auslegung greifen.

### Abschleppdienst

| Stufe | Beispiele |
|---|---|
| **hoch** | • Fahrzeug steht auf Autobahn, Autobahnzubringer oder Schnellstrasse<br>• Fahrzeug steht in einer Kurve, auf einem Bahnübergang oder blockiert eine Fahrspur<br>• Personen befinden sich im oder neben dem Fahrzeug an der Strasse<br>• Unfall mit beteiligtem Fahrzeug, unabhängig vom Standort |
| **mittel** | • Fahrzeug steht verkehrssicher (Parkplatz, Quartierstrasse, Einstellhalle), niemand gefährdet<br>• Panne mit Termindruck („ich muss morgen um sieben auf der Baustelle sein")<br>• Fahrzeug blockiert eine fremde Einfahrt oder einen Kundenparkplatz |
| **niedrig** | • Geplanter Transport, Terminvereinbarung<br>• Fahrzeug steht auf eigenem Grundstück oder im Werkstatthof<br>• Preisanfrage, Rückfrage zu einer Rechnung, Frage zum Ablauf |

**Der Grenzfall, an dem sich die Regel zeigt:** Dasselbe Auto mit demselben Defekt ist *hoch* auf dem Pannenstreifen und *niedrig* in der eigenen Garage. Nicht der Defekt entscheidet, sondern der Standort — weil er über Gefahr und Behebbarkeit entscheidet.

### Handwerk (Sanitär / Heizung / Elektro)

| Stufe | Beispiele |
|---|---|
| **hoch** | • Austretendes Wasser, Rohrbruch, Wasser steht in Räumen<br>• Gasgeruch<br>• Stromausfall im ganzen Objekt, oder sichtbarer Schaden an der Elektroinstallation (Rauch, Funken, verschmorter Geruch)<br>• Heizungsausfall bei Frost, oder Ausfall der Warmwasserversorgung im Mehrfamilienhaus |
| **mittel** | • Heizung fällt teilweise aus, einzelne Räume kalt, keine Frostgefahr<br>• Ein Raum oder ein Stromkreis ohne Strom, Rest des Objekts versorgt<br>• Tropfender Boiler oder Anschluss mit Auffangmöglichkeit<br>• Einziges WC im Haushalt defekt |
| **niedrig** | • Offertanfrage, Umbau, geplante Sanierung<br>• Wartungstermin, Service-Intervall<br>• Ersatzteil- oder Materialfrage, Rückfrage zu einer Rechnung |

**Der Grenzfall:** Wasser ist nicht automatisch *hoch*. Ein tropfender Anschluss mit einem Eimer darunter ist *mittel*; dieselbe Menge Wasser ohne Auffangmöglichkeit auf einem Parkettboden ist *hoch* — weil der Schaden dann irreversibel wird.

### Was die Beispiele leisten müssen

Sie sind Erkennungsmerkmale, keine Aufzählung aller Fälle. Der Prompt sollte den Massstab („was passiert beim Warten") **vor** die Beispiele stellen, damit der Assistent auch Fälle einordnen kann, die nicht in der Liste stehen. Eine reine Liste ohne Massstab führt dazu, dass alles Unaufgeführte als *niedrig* durchfällt — und das ist bei einem Notdienst die gefährliche Richtung.

---

## Aufwand

| Schritt | Aufwand |
|---|---|
| Data-Collection-Feld verpflichtend, geschlossene Werteliste | ~0,5 Tag |
| Prompt-Baustein mit Massstab + Beispielen | ~0,5 Tag |
| Verankerung in `industry_templates` (zwei Branchen) | ~0,5 Tag |
| Nachmessen an echten Anrufen, Kriterien nachschärfen | ~0,5 Tag |
| **Summe** | **≈ 2 Tage** |

## Abnahme

Nicht „das Feld ist konfiguriert", sondern **der Anteil nicht eingestufter Anrufe ist gefallen**. Heutiger Stand: 58 %. Die Messung ist eine Zeile:

```sql
select coalesce(urgency,'(nicht eingestuft)') as urgency, count(*),
       round(100.0*count(*)/sum(count(*)) over (), 0) as prozent
from public.calls
where created_at > '<datum der umstellung>'
group by 1 order by 2 desc;
```

Ein zweiter Blick lohnt auf die Verteilung *innerhalb* der eingestuften Anrufe: Wenn nach der Umstellung fast alles *hoch* ist, sind die Kriterien zu weit — und eine Dringlichkeit, die immer „hoch" sagt, trägt so wenig wie eine, die fehlt.

## Zu entscheiden

| # | Frage |
|---|---|
| 1 | Branchen für den ersten Wurf: nur Abschleppdienst (Pilot), oder gleich Handwerk mit? |
| 2 | Bleibt es bei drei Stufen, oder braucht es eine vierte („Notfall") über *hoch*? |
| 3 | Soll die Stufe auch das E-Mail-Betreff und die Dashboard-Sortierung steuern, oder vorerst nur die SMS? |
| 4 | Wird `urgency` beim Anrufer sichtbar? *(Empfehlung: nein — der Anrufer soll nicht erfahren, dass sein Notfall als „niedrig" eingestuft wurde.)* |
