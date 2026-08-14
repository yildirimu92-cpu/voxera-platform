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

## Vorprüfung: Warum die Einstufung fehlt — beantwortet

**Weder noch.** Das Feld wird abgefragt. Es bleibt leer, weil die Anweisung dem Modell sagt, sich zu enthalten.

`admin-panel/netlify/functions/_lib/elevenlabs-agent-config.js:191`:

```js
urgency: {
  type: 'string',
  description: 'Dringlichkeit: hoch / mittel / niedrig. Nur aus Anrufer-Aussagen ableiten.'
}
```

Drei Dinge stehen da — und alle drei drücken die Quote:

1. **Kein `enum`.** `category` hat eine geschlossene Liste, `urgency` nicht.
2. **Keine Rückfallregel.** `callback_requested` sagt „Im Zweifel false", `lead_quality` sagt „Im Zweifel warm", `urgency` sagt nichts.
3. **Eine ausdrückliche Enthaltung:** *„Nur aus Anrufer-Aussagen ableiten."* Sagt der Anrufer nicht „es ist dringend", lässt das Modell das Feld leer — genau wie angewiesen.

### Der Beleg: die Quote folgt der Anweisungsform

| Feld | `enum` | Rückfallregel | Befüllt |
|---|---|---|---|
| `category` | **ja** | — | 33/33 — **100 %** |
| `callback_requested` | (boolean) | „Im Zweifel false" | 33/33 — **100 %** |
| `lead_quality` | nein | „Im Zweifel warm" | 29/33 — 88 % |
| **`urgency`** | **nein** | **keine, dafür Enthaltung** | **14/33 — 42 %** |
| `caller_name` | nein | „Niemals raten" | 5/33 — 15 % |
| `intent` | nicht konfiguriert | — | 0/33 — 0 % |

Felder mit geschlossener Liste oder Rückfallregel liegen bei 100 %. Felder mit Enthaltungsanweisung liegen bei 42 % und 15 %. `intent` zeigt zum Vergleich, wie ein *nicht* konfiguriertes Feld aussieht: null.

Ergänzend: Die 14 gesetzten Werte sind **ausnahmslos gültig** (`niedrig` 10, `mittel` 3, `hoch` 1). Wenn das Modell einstuft, stuft es sauber ein — es stuft nur zu selten ein.

### Der Prompt nennt Dringlichkeit überhaupt nicht

In `prompt-builder-v2.js` kommt weder „Dringlichkeit" noch „urgency" vor; der einzige Treffer ist `notfallnummer_dringend`, also eine Telefonnummer. **Die einzeilige Feldbeschreibung ist die vollständige Spezifikation.**

### Ist die Konfiguration live?

Ja. `buildAgentConfig()` liefert `platform_settings.data_collection`, der Sync PATCHt genau diesen Körper, und der Agent des Pilotkunden steht auf `elevenlabs_sync_status = 'success'`, zuletzt synchronisiert am 2026-08-11 20:36. Was im Repo steht, ist der Live-Stand.

### Folge für den Aufwand

**Zwei Stunden, nicht ein Tag** — für die Feldmechanik. Die Änderung liegt in einer Datei, in einem Objekt: `enum` ergänzen, den Enthaltungssatz durch Massstab und beide Grenzfälle ersetzen. Ausgerollt wird über den bestehenden Sync, keine Migration, kein neues Bauteil.

Was übrig bleibt, ist Textarbeit am Kriterienblock und die Nachmessung.

### Eine Spannung, die die Messung erzeugt hat

Die Daten zeigen: Ohne Rückfallregel bleibt ein Feld leer. Entschieden ist aber, **nicht** „im Zweifel mittel" vorzugeben — eine erfundene Einstufung wäre nicht als Lücke erkennbar.

Beides lässt sich vereinbaren, wenn man zwei Fälle trennt, die heute zusammenfallen:

- **Kein Eile-Signal** ist selbst ein Befund. „Der Anrufer hat nichts genannt, was auf Eile hindeutet" rechtfertigt `niedrig` — das ist ein Urteil, keine Erfindung.
- **Keine verwertbare Information** (Anrufer legt nach drei Sekunden auf) bleibt leer.

Vorschlag für die Anweisung: *„Stufe immer ein, sobald das Gespräch ein Anliegen enthält. Lass das Feld nur leer, wenn kein Anliegen erkennbar ist."* Damit fällt die Enthaltung weg, ohne dass etwas erfunden wird.

### Und eine Kopplung, die die Reihenfolge betrifft

Beim Abschleppdienst hängt die Einstufung am **Ort**: Dasselbe Fahrzeug ist *hoch* auf der Autobahn und *niedrig* im Hof. Fragt der Assistent den Standort nicht ab, kann er nach dem eigenen Massstab gar nicht einstufen — und ein Modell, das trotzdem einstufen soll, rät.

Das Ortsfeld (`TICKET_ORT_UND_RUECKRUFNUMMER_2026-08-11.md`) wurde hinter dieses Ticket gestellt. Für die *generische* Einstufung ist das richtig. Für die *Abschleppdienst-Liste* — den ersten Ausbau-Wurf — sind beide dasselbe Arbeitspaket: Ohne Standortabfrage trägt die beste Kriterienliste nicht.

*Zu entscheiden:* Ob die Standortabfrage in den Abschleppdienst-Ausbau vorgezogen wird. Das Minimum ist davon nicht betroffen.

---

## Isolierter Test — Stand 14.08., wartet auf Messung

Statt Minimum und Ausbau in einem Zug zu bauen, geht **eine einzige Änderung** voraus, die die offene Architekturfrage entscheidet.

**Geändert:** nur die Feldbeschreibung von `urgency` in `elevenlabs-agent-config.js`. Folgen-Massstab statt Signalbedingung, drei Stufen mit je einem Beispiel, beide Grenzfälle, Rückfallregel `Stufe IMMER ein. Ohne verwertbare Information: niedrig.`

**Nicht geändert:** der Prompt. Kein `enum`. Keine Struktur.

**Was der Test beantwortet:** Trägt eine Rückfallregel in der Feldbeschreibung — ohne `enum`, ohne Prompt-Eingriff? Steigt die Quote, ist der Hebel bewiesen und die Wahl zwischen „von Hand nachziehen" und „Sync erweitern" wird auf einer Messung getroffen statt auf einer Annahme. Bleibt sie, ist die Annahme falsch, dass die Auswertung nur dort liest.

Er läuft nicht in #965 hinein, weil er den Prompt nicht anfasst — eine Standardpersönlichkeit kann keine Feldbeschreibung überlagern.

### Warum `niedrig` und nicht „leer lassen"

Ich hatte „leer lassen" vorgeschlagen, weil eine erfundene Einstufung nicht als Lücke erkennbar wäre. Der Einwand ist gegenstandslos: **Die Rückfallregel richtet sich an das auswertende Modell, sie ist keine Vorgabe im Code.** Damit bleiben beide Fälle unterscheidbar:

| Fall | Feld | SMS zeigt |
|---|---|---|
| Modell hat bewertet, nichts deutet auf Eile | `niedrig` | „Dringlichkeit: niedrig" |
| Modell lief nicht oder scheiterte | leer | „Dringlichkeit: unbekannt" |

Und für die Wirkung auf die SMS ist `niedrig` das bessere: Die Nachricht trägt ohne Anliegen allein die Dringlichkeit — ein leeres Feld sagt dort nichts, `niedrig` ist eine Aussage.

### Grenze der Datenbasis

**Die Zahlen stammen aus 43 Testanrufen eines E2E-Kontos, nicht von echten Kunden.** Die Quoten der Felder sind untereinander vergleichbar, weil sie durch dieselben Gespräche liefen — die absoluten Werte sind nicht auf Echtbetrieb übertragbar. Bei den Selbstvorstellungen ist **n = 6**, davon 3 nicht extrahiert.

**Was den Befund trägt, ist nicht die Stichprobe, sondern die Übereinstimmung von Struktur und Daten:** zwei getrennte Modelle, `data_collection` beim Auswertungsmodell, und drei Felder, deren Quote der Beschreibungsform folgt statt dem Prompt. Fiele eines der beiden weg, wäre der Befund nicht belastbar.

*(Ein erster Suchausdruck traf 42 von 43 Transkripten und war wertlos — „hier ist" kommt überall vor. Erst die Positivkontrolle gegen die 7 befüllten Felder zeigte das; nachgeschärft auf 6.)*

### Zurückgestellt: der L1-Eingriff

Vorbereitet und bewusst **nicht** mitgeschickt, damit der Testanruf eine Änderung misst. Nach der Messung fällig, als chirurgische Migration mit Sicherung und Ankerprüfung (`prompt_master_l1` hat keine Versionierung, #929):

1. **`- Dringlichkeit (wenn Anrufer Hinweise gibt)`** aus dem OPTIONAL-Block entfernen.
2. **`Bei Dringlichkeits-Signalen:`** ersetzen durch den Folgen-Massstab mit den drei Stufen, beiden Grenzfällen und dem Satz: *„Frage aktiv nach, was du für die Einstufung brauchst — beim Fahrzeug den Standort, beim Wasserschaden, ob es aufgefangen wird. Ohne diese Angabe ist die Stufe nicht bestimmbar."*
3. **`Was als Notfall gilt definiert der Branchen-Layer.`** → *„Was darüber hinaus als Notfall gilt, definiert der Branchen-Layer."*

Der Trockenlauf gegen den Live-Text ist gelaufen (lesend): alle drei Anker gefunden, 9 787 → 10 516 Zeichen.

**Der Prompt-Teil bleibt nötig, auch wenn der Test gelingt** — aber für etwas anderes: Er sorgt dafür, dass der Assistent den Standort **erfragt**. Ohne die Angabe im Transkript kann auch die beste Feldbeschreibung nach dem Folgen-Massstab nicht einstufen. Prompt und Beschreibung sind arbeitsteilig, nicht alternativ.

---

## Der Schnitt: Minimum gegen Ausbau

Zwei Tage sind zu viel für einen Blocker. Der Auftrag zerfällt sauber, und der Grund dafür ist inhaltlich, nicht organisatorisch: **Der Massstab ist branchenunabhängig, nur die Beispiele sind es nicht.**

Die SMS trägt bereits, sobald der Assistent überhaupt zuverlässig einstuft. Branchenspezifische Listen machen die Einstufung *treffsicherer*, nicht erst *möglich*.

### Minimum — der Blocker (≈ 0,75 Tag)

| Schritt | Aufwand |
|---|---|
| `enum` ergänzen, Enthaltungssatz ersetzen (eine Datei, ein Objekt) | **~2 Stunden** |
| Kriterientext: Massstab + beide Grenzfälle, für alle Vorlagen gleich | ~2 Stunden |
| Ausrollen über den bestehenden Sync + Nachmessen | ~2 Stunden |

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
| **Minimum** — Feldmechanik, generischer Massstab, beide Grenzfälle, Nachmessung | **≈ 0,75 Tag** (nach Vorprüfung, war 1 Tag) | **ja** |
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
