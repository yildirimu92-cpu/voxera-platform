# Ticket — Dringlichkeit wird Pflichtfeld, mit branchenabhängigen Kriterien

**Datum:** 2026-08-11
**Art:** Bau (Data Collection + Prompt + Branchenvorlagen). Keine Migration.
**Vorrang:** **vor** Ortsfeld und gesprochener Rückrufnummer (`TICKET_ORT_UND_RUECKRUFNUMMER_2026-08-11.md`)
**Start:** nach dem Kalender-Testanruf. Danach nächster Auftrag im laufenden Fenster.
**Herkunft:** `docs/SMS_BENACHRICHTIGUNG_DIAGNOSE_2026-08-11.md` + `BEFUND_TWILIO_DATENRESIDENZ_2026-08-11.md`

---

## Entschieden am 2026-08-11

| Frage | Entscheid |
|---|---|
| Kriterien und Massstab | **Freigegeben, wörtlich** — inklusive beider Grenzfälle im Prompt |
| Vierte Stufe über *hoch* | **Nein.** Drei Stufen sind das, was ein Mensch um drei Uhr nachts noch unterscheidet. Eine vierte hiesse, dass *hoch* nicht mehr „jetzt aufstehen" bedeutet — dann trägt die Einstufung nichts mehr. |
| E-Mail-Betreff | **Ja.** Trägt die Dringlichkeit die SMS, muss sie auch in den Betreff — sonst hat der Kunde zwei Kanäle mit unterschiedlicher Aussage über denselben Anruf. |
| Dashboard-Sortierung | **Ja, aber als eigener Schritt.** Anzeigeentscheidung mit Folgen für den Heute-Screen; gehört zur Dashboard-Struktur, nicht zum Pflichtfeld. |

---

## Der Schnitt: Minimum gegen Ausbau

Zwei Tage sind zu viel für einen Blocker. Der Auftrag zerfällt sauber, und der Grund dafür ist inhaltlich, nicht organisatorisch: **Der Massstab ist branchenunabhängig, nur die Beispiele sind es nicht.**

Die SMS trägt bereits, sobald der Assistent überhaupt zuverlässig einstuft. Branchenspezifische Listen machen die Einstufung *treffsicherer*, nicht erst *möglich*.

### Minimum — der Blocker (≈ 1 Tag)

| Schritt | Aufwand |
|---|---|
| `urgency` als Pflichtfeld, geschlossene Werteliste `hoch\|mittel\|niedrig` | ~0,5 Tag |
| Generischer Prompt-Baustein: **Massstab + beide Grenzfälle**, für alle Vorlagen gleich | ~0,25 Tag |
| Nachmessen an echten Anrufen, Anteil „nicht eingestuft" prüfen | ~0,25 Tag |

Die beiden Grenzfälle gehören ausdrücklich ins Minimum, obwohl sie aus zwei konkreten Branchen stammen. Sie sind die einzige Stelle, an der der Massstab *vorgeführt* statt nur behauptet wird — dasselbe Auto ist *hoch* auf dem Pannenstreifen und *niedrig* in der Garage, dieselbe Menge Wasser ist *mittel* mit Eimer und *hoch* auf Parkett. Wer sie weglässt, behält eine Definition ohne Beispiel, und genau daran scheitern Einstufungen.

**Damit ist der SMS-Kanal entblockt.**

### Ausbau — kein Blocker

| Schritt | Aufwand | Anmerkung |
|---|---|---|
| Branchenlisten `handwerk` + Abschleppdienst | ~0,5 Tag | siehe Befund unten — für den Abschleppdienst gibt es noch keine Vorlage |
| Branchenlisten für die übrigen Vorlagen | nach Bedarf | **nicht alle 19 brauchen sie**, siehe unten |
| Dringlichkeit im E-Mail-Betreff | ~0,5 Tag | entschieden, aber unabhängig von der SMS |
| Dashboard-Sortierung | eigener Auftrag | gehört zur Dashboard-Struktur |

---

## Befund zum Ausbau: nicht alle 19 Vorlagen brauchen Listen

`industry_templates` führt 19 aktive Vorlagen. Für die Dringlichkeit zerfallen sie in drei Gruppen:

**(a) Notdienst-Charakter — Listen lohnen sich.** `handwerk`, `garage`, `it-support`, `immobilien`, `facharzt`, `zahnarzt`. Hier existiert *hoch* im Alltag und heisst tatsächlich „jetzt aufstehen".

**(b) Dringlichkeit existiert, aber selten.** `versicherung`, `anwalt`, `physiotherapie`, `reinigung`, `hotel`. Der generische Massstab dürfte reichen; Listen erst, wenn die Messung Fehleinstufungen zeigt.

**(c) *hoch* kommt praktisch nicht vor.** `coiffeur`, `kosmetik`, `restaurant`, `baeckerei`, `fitness`, `treuhand`, `digitalmarketing`, `generic`. Hier eine dreistufige Skala zu erzwingen erzeugt Rauschen — ein Coiffeur-Anruf um 22 Uhr ist keine Notlage, und ein Assistent, der unter Druck etwas einstufen *muss*, stuft zu hoch ein.

**Empfehlung:** Ausbau auf Gruppe (a) begrenzen, Gruppe (b) nach Messung, Gruppe (c) beim generischen Massstab belassen. Das sind sechs Listen statt neunzehn.

### Es gibt keine Vorlage für den Abschleppdienst

Die 19 Vorlagen enthalten `garage` („Garage / Autowerkstatt"), aber **keinen Abschleppdienst**. Der Pilotkunde bekäme heute `garage` oder `generic`.

Das betrifft das Minimum nicht — der generische Massstab greift unabhängig von der Vorlage. Für den Ausbau ist aber zu entscheiden, ob die Abschlepp-Kriterien

- in `garage` einfliessen (dann trägt sie auch jede Autowerkstatt, für die „Fahrzeug steht auf der Autobahn" nicht typisch ist), oder
- eine eigene Vorlage `abschleppdienst` bekommen (sauberer, aber eine neue Zeile in `industry_templates` und eine Zuordnung beim Pilotkunden).

Empfehlung: **eigene Vorlage.** Der Unterschied zwischen „Auto steht kaputt bei uns im Hof" und „Auto steht kaputt auf der A1" ist genau der Unterschied, den die Einstufung treffen soll — und er trennt Werkstatt von Abschleppdienst.

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

Aufgeteilt, siehe „Der Schnitt" oben. Kurzfassung:

| Teil | Aufwand | Blocker? |
|---|---|---|
| **Minimum** — Pflichtfeld, generischer Massstab, beide Grenzfälle, Nachmessung | **≈ 1 Tag** | **ja** |
| Ausbau — Branchenlisten Gruppe (a), E-Mail-Betreff | ≈ 1 Tag | nein |
| Dashboard-Sortierung | eigener Auftrag | nein |

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

| # | Frage | Stand |
|---|---|---|
| ~~2~~ | ~~Vierte Stufe über *hoch*?~~ | **Nein** (2026-08-11) |
| ~~3a~~ | ~~E-Mail-Betreff?~~ | **Ja** (2026-08-11), Ausbau |
| ~~3b~~ | ~~Dashboard-Sortierung?~~ | **Ja, eigener Schritt** (2026-08-11) |
| **1** | Branchen für den ersten Ausbau-Wurf: nur Abschleppdienst, oder `handwerk` gleich mit? Und: eigene Vorlage `abschleppdienst` oder in `garage` einbetten? | **offen** — Empfehlung: beide, und eigene Vorlage |
| **4** | Wird `urgency` beim Anrufer sichtbar? | **offen** — Empfehlung: **nein**. Der Anrufer soll nicht erfahren, dass seine Lage als „niedrig" eingestuft wurde. Betrifft die Anrufer-SMS und eine spätere Statusseite. |
