# Geschäftsprofil entschlacken — Diagnose und Zielbild

**Datum:** 09.08.2026 · **Branch:** `claude/geschaeftsprofil-entschlacken-8xoebb` · **Diagnose zuerst, Umsetzung nach Freigabe von E1–E4 (Abschnitt 11).**

**Grundlage:** Auftrag „Geschäftsprofil-Seite entschlacken — Doppelerfassung auflösen" (09.08., nach dem
ersten Klick-Test), Grundsatz 15 im Fahrplan, `docs/GESCHAEFTSWISSEN_FREITEXTFELDER_DIAGNOSE_2026-08-09.md`
(Abschnitte 6.2, 11.15–11.19), gelesener Code: `customer-dashboard/shared/customer-runtime-assistant-profile.js`,
`customer-dashboard/netlify/functions/customer-assistant-profile.js`,
`customer-dashboard/netlify/functions/customer-update-assistant.js`,
`customer-dashboard/netlify/functions/_lib/service-faq.js`,
`admin-panel/netlify/functions/_lib/prompt-builder-v2.js`, die vier J-Migrationen unter `supabase/migrations/`.

---

## 0. Die Antwort in fünf Sätzen

Die Seite zeigt den **Übergangszustand als Endzustand**. Entscheid F3 lautet: „der Freitext führt, bis der
Kunde die Struktur bestätigt" — das ist eine Regel über die *Zeit*, die Oberfläche hat sie in eine Regel über
den *Platz* übersetzt und beide Zustände nebeneinandergestellt. Von den vier Doppelpaaren haben **drei kein
eigenes Thema mehr**, das nicht schon ein typisiertes Feld hätte; das vierte (Unternehmensbeschreibung) hat
zwei Felder, deren einziger Unterschied die Länge ist. Die zwei bzw. drei Speicher-Knöpfe sind nicht einmal
ein Implementierungsdetail — **alle drei rufen denselben Endpoint mit demselben Rumpf-Format auf**, sie liessen
sich ohne jede Serveränderung zu einem zusammenlegen. Und beim Nachrechnen der Vorrangregeln ist ein
inhaltlicher Fehler aufgefallen, der noch niemanden getroffen hat, aber den ersten treffen wird, der eine
FAQ-Liste bestätigt: **seine Terminregeln verschwinden dabei aus dem Prompt** (Abschnitt 3).

---

## 1. Was auf dem Screen steht, technisch

Die Seite `vx-assistant-view-business` rendert `renderBusiness()`
(`customer-runtime-assistant-profile.js:685`) drei bis vier Karten:

| Karte | Quelle | Felder | Speichern |
|---|---|---|---|
| „Dauerhaftes Geschäftswissen" | fest im Code (`:698`) | 4 Textareas | `Geschäftsprofil speichern` → `saveBusiness()` `:1352` |
| „Ihr Betrieb" | `system_config.core_field_steps` | 5 Abschnitte, 16 Felder | `Betriebsangaben speichern` → `saveCore()` `:1042` |
| „Für Ihre Branche" | `industry_templates.extra_steps` | 0–n Felder | `Branchenangaben speichern` → `saveBranch()` `:1088` |

**Es sind drei Knöpfe, nicht zwei.** Der Klick-Test sah zwei, weil dem geprüften Konto keine Branche
zugeordnet ist — das gilt für drei von vier Kunden. Beim vierten stehen drei.

---

## 2. Auftrag 1 — Hat der Freitext noch eine eigene Aufgabe? Pro Paar einzeln.

Die Frage ist nicht „ist der Text hübsch", sondern: **Trägt der Freitext eine Information, die kein
typisiertes Feld aufnehmen kann — und was macht der Prompt-Builder heute damit?** Beides zusammen ergibt
die Antwort, denn ein Feld, das der Prompt ohnehin verwirft, ist auf der Seite eine Lüge; und ein Feld, das
der Prompt weiterhin druckt, darf die Oberfläche nicht einfach verstecken.

### 2.1 Leistungen — `ai_services` gegen `ai_service_list`

**Prompt (`prompt-builder-v2.js:676`):**

```js
const serviceList = formatServiceList(core[CORE_KEY_SERVICE_LIST]);
add('LEISTUNGEN', serviceList || customer.ai_services);
```

Die bestätigte Liste **ersetzt** den Text vollständig — so in J7 ausdrücklich entschieden und im
Migrationskommentar begründet: „`ai_services` trägt nur Leistungen, zwei Fassungen desselben Inhalts wären
reine Doppelung".

**Trägt der Text sonst noch etwas?** Nein. `parseServiceList()` liest *jede* Zeile als Leistung; was es
nicht verwertet (zu lang, eckiger Platzhalter), meldet es namentlich an die Oberfläche, damit der Kunde es
von Hand nachträgt. Es gibt keine Zeilenart, die der Parser bewusst im Text lässt.

> **Befund: keine eigene Aufgabe.** Sobald eine Liste bestätigt ist, ist das Textfeld ein Eingabefeld ohne
> Wirkung. Der Hinweis „Dieser Text wird nicht mehr verwendet" (`:891`) ist die korrekte Aussage — und
> zugleich das Eingeständnis, dass das Feld dort nicht mehr hingehört.

### 2.2 Häufige Fragen — `ai_booking_faq` gegen `ai_faq_list`

**Prompt (`prompt-builder-v2.js:708`):** dieselbe Bauform, `faqList || customer.ai_booking_faq`.

**Trägt der Text sonst noch etwas? Ja — und das ist der Unterschied zu 2.1.** `parseFaqList()`
(`_lib/service-faq.js`) trennt den Text bewusst in **drei** Töpfe, nicht zwei:

| Topf | Inhalt | Ziel heute |
|---|---|---|
| `items` | echte Frage-Antwort-Paare | → `ai_faq_list` |
| `ignored` | nicht zuordenbare Zeilen | → wird dem Kunden zum Abtippen angezeigt |
| `rules` | **alles vor der Überschrift „Häufige Fragen:"** — Terminregeln | → **nirgendwohin** |

Die Oberfläche sagt dazu wörtlich (`:876`): *„Diese Zeilen sind keine Fragen, sondern Regeln. **Sie bleiben
im Text stehen**."* Das ist nach J8 auch inhaltlich richtig: J8 hat die *Aufnahme-Checkliste* aus
`default_booking_faq` entfernt und in `default_required_information` überführt, die **echten Terminregeln
aber ausdrücklich stehen gelassen** — „Absagen: mindestens 24 Stunden vorher", „Neue Patienten: bitte
Krankenkassenkarte mitbringen." (Kommentar in `2026-08-09_required_information_single_source.sql`).

> **Befund: der Text trägt heute noch etwas Eigenes — nämlich die Terminregeln — und der Prompt wirft es
> weg, sobald die Liste steht.** Siehe Abschnitt 3. Dieses Paar lässt sich nicht durch Umbauen der
> Oberfläche allein auflösen: „weg damit" hiesse hier, Inhalt still zu löschen.

### 2.3 Standort und Erreichbarkeit — `ai_location_hours` gegen Wochenraster + Adresse

Die Diagnose vom Morgen hat für dieses Feld **sechs** Informationstypen ausgezählt. Ihr Stand heute:

| Was im Text steht | Eigenes Feld seit | Spalte |
|---|---|---|
| Adresse (19/19 Vorlagen) | J6 | `ai_public_address` |
| Öffnungszeiten (19/19) | J5 | `ai_opening_hours` |
| Anfahrt / Parkieren / ÖV (5/19) | J6 | `ai_arrival_note` |
| Einsatzgebiet (2/19) | J6 | `ai_service_area` |
| Vorbereitung / Mitbringen (3/19) | J6 | `ai_visit_preparation` |
| Notfallnummer (7/19) | vorher schon | `ai_emergency_number` |

**Kein reserviertes Thema mehr.** Die Begründung aus J7 („bei den Öffnungszeiten mussten beide bleiben, weil
`ai_location_hours` neben den Zeiten auch Adresse und Anfahrt trägt") ist seit J6 abgelaufen — genau so steht
es im Auftrag, und der Code bestätigt es.

**Aber:** anders als bei 2.1/2.2 druckt der Prompt den Text weiterhin **immer**
(`prompt-builder-v2.js:682–692`) — Adresse und Wochenraster stehen davor und bekommen ausdrücklichen
Vorrang, der Text bleibt darunter stehen.

> **Befund: kein eigenes Thema mehr, aber der Text wirkt weiterhin.** Ihn nur auf der Seite zu verstecken
> wäre schlimmer als die heutige Doppelung: der Kunde hätte Inhalt im Mund seines Assistenten, den er nicht
> mehr sieht und nicht mehr entfernen kann. Der Rückzug des Textes muss hier ausdrücklich mitentschieden
> werden (Abschnitt 4.3, Entscheidung E2).

### 2.4 Unternehmensbeschreibung — `ai_business_description` gegen `ai_short_description` + zwei

**Prompt (`prompt-builder-v2.js:665–669`):**

```js
add('UNTERNEHMENSBESCHREIBUNG', shortDescription && shortDescription !== businessDescription
  ? [shortDescription, businessDescription].filter(Boolean).join('\n\n')
  : businessDescription || shortDescription);
```

Beide werden gedruckt, untereinander, mit einem Gleichheitstest gegen den Fall, dass die Website-Analyse
dieselbe Quelle in beide Spalten geschrieben hat.

Der historische Zusatzballast des Freitexts ist weg: „Zielgruppen" hat seit J6 `ai_target_groups`,
„Einsatzgebiet" `ai_service_area`, der Preisteil vier eigene Spalten, und die Zeilen „Lara nimmt …
entgegen" sind mit J8 aus den Vorlagen verschwunden.

**Was bleibt, ist kein Themen-, sondern ein Längenunterschied.** „Kurzbeschreibung" fragt nach ein bis zwei
Sätzen, „Unternehmensbeschreibung" nach demselben in länger. Zwei Felder, deren einziger Unterschied die
erwartete Länge ist, sind für die Zielgruppe aus Grundsatz 15 nicht unterscheidbar — das ist genau der Fall,
den die Testfrage („weiss sie ohne Hilfe, was wo hingehört?") ausschliessen soll.

> **Befund: eine Aufgabe, zwei Felder.** Hier ist die Antwort nicht „Text entfernen", sondern **eines der
> beiden Felder von der Kundenseite nehmen** — welches, ist Entscheidung E3.

### 2.5 Zusammenfassung

| Paar | Trägt der Text noch etwas Eigenes? | Prompt heute | Auflösbar durch Oberfläche allein? |
|---|---|---|---|
| Leistungen | **nein** | Liste ersetzt Text | **ja, sofort** |
| Häufige Fragen | **ja — Terminregeln** | Liste ersetzt Text (**Regeln gehen verloren**) | nein — braucht ein Feld für Regeln |
| Standort | **nein** | Text wirkt weiterhin | nein — braucht eine Rückzugsregel |
| Unternehmensbeschreibung | nein, nur länger | beide wirken | nein — braucht die Wahl, welches bleibt |

Die Annahme im Auftrag („die Prompt-Seite ist vermutlich schon korrekt, das Problem ist die Oberfläche")
stimmt für die zwei J7-Paare und stimmt für die anderen zwei nicht. Das ist keine Kleinigkeit, sondern der
Grund, warum die Seite nicht rein kosmetisch zu entschlacken ist.

---

## 3. Fund unterwegs: bestätigte FAQ-Liste löscht die Terminregeln aus dem Prompt

Nicht beauftragt, beim Nachrechnen der Vorrangregeln aufgefallen, und ernst genug für einen eigenen Abschnitt.

**Ablauf:** Ein Zahnarzt hat in `ai_booking_faq` (aus der Vorlage) unter anderem die Zeilen
„Absagen: mindestens 24 Stunden vorher — sonst ggf. Ausfallgebühr." und „Neue Patienten: bitte
Krankenkassenkarte mitbringen." Darunter, nach der Überschrift „Häufige Fragen:", die echten Paare.

1. Die Seite zeigt „6 Frage-Antwort-Paare gelesen" und darunter: *„Diese Zeilen sind keine Fragen, sondern
   Regeln. Sie bleiben im Text stehen."*
2. Er klickt „Vorschlag übernehmen", prüft, speichert. `ai_faq_list` ist gesetzt.
3. `add('TERMINREGELN & HÄUFIGE FRAGEN', faqList || customer.ai_booking_faq)` — ab jetzt gewinnt `faqList`,
   und `ai_booking_faq` erscheint **gar nicht mehr** im Prompt.
4. Die Ausfallgebühr-Regel und der Kartenhinweis sind weg. Die Oberfläche hat das Gegenteil versprochen.

**Warum es noch niemanden getroffen hat:** kein Kunde hat bisher eine Liste bestätigt (J7 ist seit heute
live, `ai_faq_list` ist bei allen vier Kunden `null`). Der Fehler ist latent, nicht wirksam — dieselbe Lage
wie beim Wochenraster-Feldtyp gestern, nur diesmal vor dem ersten Klick gefunden statt danach.

**Warum es nicht „nebenbei" zu beheben ist:** Es gibt heute keine Spalte für Terminregeln. J8 hat die
Checkliste in `default_required_information` überführt und dabei ausdrücklich festgehalten, dass die
Terminregeln **etwas anderes** sind und bleiben. Sie brauchen entweder ein eigenes Feld oder einen zweiten
Prompt-Abschnitt. Das ist Entscheidung E1 und der einzige Punkt, an dem dieser Auftrag über „Oberfläche"
hinausgeht.

---

## 4. Auftrag 2 — Zielbild

### 4.1 Das Ordnungsprinzip: ein Thema, ein Zustand, eine Stelle

Statt „Freitext oben, Struktur unten" gilt: **jedes Thema hat auf der Seite genau eine Stelle, und diese
Stelle zeigt den Zustand, in dem das Thema gerade ist.**

| Zustand | Was der Kunde sieht |
|---|---|
| **1 — nichts strukturiert, aber Text vorhanden** | Das strukturierte Feld, darüber das Vorschlagsbanner („Wir haben 8 Einträge gelesen"), darunter eingeklappt: *„Ihr bisheriger Text — wird verwendet, bis Sie oben etwas bestätigen"* |
| **2 — strukturiert bestätigt** | Nur das strukturierte Feld. Darunter eingeklappt: *„Ihr ursprünglicher Text — wird nicht mehr verwendet"*, mit der Möglichkeit, ihn zu löschen |
| **3 — nichts vorhanden** | Nur das strukturierte Feld, mit Beispieltext. Kein Textfeld, kein Banner, keine Erklärung |

Der Freitext ist damit nirgends mehr **Eingabe**, sondern Herkunft und Archiv. Er steht **direkt unter dem
Feld, das ihn ablöst** — nicht in einer eigenen Karte weiter oben und nicht in einem Sammelblock am
Seitenende. Nähe ist das, was die Vorrangregel erklärt; zwei Absätze Fliesstext sind es nicht.

### 4.2 Antwort auf die zwei Fragen aus dem Auftrag

**„Strukturierte Daten liegen vor — Textfeld entfernen, einklappen, oder etwas Drittes?"**
→ **Einklappen als „ursprünglicher Text", nicht ersatzlos entfernen.** Drei Gründe, in dieser Reihenfolge:
die Spalte lebt weiter (Website-Analyse und Admin-Wizard schreiben sie, `admin-panel/index.html:7845` und
`:8386`) — ein unsichtbares Feld, das von aussen wieder befüllt wird, ist genau die Klasse stiller Wirkung,
die dieses Projekt gerade dreimal gefangen hat; der Kunde muss sehen können, was er hatte (Kundenhoheit,
dieselbe Begründung wie bei F3); und beim Standort-Text **wirkt** der Inhalt weiterhin, dort wäre Verstecken
schlicht falsch. Eingeklappt heisst: eine Zeile mit Zustandswort, aufklappbar, als Text dargestellt statt als
Textarea, mit genau einer Aktion daneben — „Text löschen" (Zustand 2) bzw. „Text bearbeiten" (Zustand 1).

**„Noch nichts strukturiert erfasst — bleibt der Freitext der Einstieg?"**
→ **Nein. Die Seite führt direkt in die Struktur.** Der Freitext ist bei keinem Kunden ein Einstieg gewesen:
er stammt aus der Branchenvorlage oder aus der Website-Analyse, ein einziger von vier Kunden hat überhaupt
eigenen Inhalt, und auch der ist gescrapt. Ihn als Eingangstor darzustellen beschreibt einen Weg, den
niemand geht. Für den echten Neukunden ohne Vorlagentext ist ein leeres Listenfeld mit Beispiel ohnehin
einfacher als ein leeres Textfeld mit derselben Frage.

### 4.3 Die Seite danach

```
[ Band: Aktuell abweichend vom Normalbetrieb ]        ← unverändert

╔══ Ihr Betrieb ════════════════════════════════════╗
║  Erreichbarkeit und Termine                        ║
║    · Wann übernimmt der Assistent                  ║
║    · Reguläre Öffnungszeiten      ← kompakt, §5    ║
║    · Termine  /  Buchungslink                      ║
║                                                    ║
║  Was Sie anbieten                                  ║
║    · Beschreibung Ihres Betriebs   ← EIN Feld, E3  ║
║    · Für wen Sie da sind                           ║
║    · Einsatzgebiet                                 ║
║                                                    ║
║  Leistungen und häufige Fragen                     ║
║    · Leistungen            [Listeneditor]          ║
║        ▸ Ihr ursprünglicher Text                   ║
║    · Häufige Fragen        [Frage/Antwort]         ║
║    · Regeln rund um Termine   ← NEU, E1            ║
║        ▸ Ihr ursprünglicher Text                   ║
║                                                    ║
║  Anfahrt und Besuch                                ║
║    · Adresse für Anrufende                         ║
║    · Anfahrt und Parkieren                         ║
║    · Was mitgebracht werden soll                   ║
║        ▸ Ihr ursprünglicher Standort-Text          ║
║                                                    ║
║  Preisauskunft                                     ║
╚════════════════════════════════════════════════════╝

╔══ Für Ihre Branche ═══════════════════════════════╗   ← unverändert
╚════════════════════════════════════════════════════╝

              [ Angaben speichern ]                     ← EINER, §6
```

Aus vier gleich aussehenden Textareas plus 16 strukturierten Feldern plus drei Knöpfen wird: **eine
Bearbeitungsfläche, fünf benannte Abschnitte, ein Knopf** — und pro Thema höchstens eine eingeklappte
Herkunftszeile. Die Karte „Dauerhaftes Geschäftswissen" verschwindet als Formular; ihr Erklärsatz („Ferien
und kurzfristige Änderungen gehören in ‚Aktuelle Infos'") wandert in den Kopf der Karte „Ihr Betrieb".

**Kein Wizard.** Ausdrücklich nicht, und nach dem Zusammenlegen auch nicht mehr nötig: die Seite trägt dann
fünf benannte Abschnitte, von denen keiner mehr als vier Felder hat. Führung durch Zerlegen in Schritte
löst ein Problem, das die Entschlackung vorher wegnimmt.

---

## 5. Auftrag 4 — Öffnungszeiten kompakter

**Heute:** `hoursField()` rendert 7 Zeilen × 2 Zeitspannen × 2 Eingaben = **28 Zeitfelder**, immer alle
sichtbar. Für „Mo–Fr 8–12 und 13–17, Sa geschlossen" bedient der Kunde davon 4 und scrollt an 24 vorbei.

**Vorschlag — der Standardfall in drei Zeilen, die Ausnahme aufklappbar:**

```
Reguläre Öffnungszeiten
Ein leeres Feldpaar bedeutet geschlossen.

  Montag bis Freitag     [08:00]–[12:00]   und   [13:00]–[17:00]
  Samstag                [     ]–[     ]   und   [     ]–[     ]
  Sonntag                [     ]–[     ]   und   [     ]–[     ]

  ▸ Einzelne Wochentage weichen ab
```

Aufgeklappt erscheint darunter das heutige Sieben-Tage-Raster, vorbefüllt aus der kompakten Eingabe; die
kompakten Zeilen werden dabei durch eine Zusammenfassung ersetzt („Abweichende Zeiten hinterlegt: Mo–Do
8–12 und 13–17, Fr 8–12").

**Die Zuordnung ist verlustfrei und in beide Richtungen eindeutig:**

- *Schreiben:* „Montag bis Freitag" schreibt denselben Wert nach `mon`…`fri`. Die gespeicherte Struktur
  bleibt exakt `{"mon":[["08:30","12:00"]], …}` — **keine Migration, keine Prompt-Änderung, keine neue
  Spalte.** `collectHours()` liefert weiterhin dieselbe Form.
- *Lesen:* sind `mon`…`fri` identisch, zeigt die Seite kompakt; weichen sie ab, öffnet sie das Raster von
  selbst. Kein gespeicherter Zustand ist unerreichbar, und kein Zustand wird beim Umschalten verfälscht.

**Warum Mo–Fr und nicht „alle sieben zusammen":** Samstag und Sonntag sind bei Schweizer KMU fast immer
anders (meist geschlossen, oft Vormittag). Sie mit in die Sammelzeile zu nehmen zwänge fast jeden Betrieb
sofort ins Raster — der Standardfall wäre dann wieder die Ausnahme.

Für die Umsetzung mitzunehmen: das Raster ist der Grund, warum die Seite auf dem Telefon so lang ist. Die
kompakte Form ist deshalb der einzige Punkt dieses Auftrags, der auf beiden Breakpoints wirklich anders
aussieht — Screenshots also unbedingt an dieser Stelle.

---

## 6. Auftrag 3 — Die Speicher-Knöpfe zusammenführen

**Die Trennung ist nicht nötig, und sie ist nicht einmal ein Implementierungsdetail.** Alle drei Knöpfe rufen
`updateAssistant()` → `POST /.netlify/functions/customer-update-assistant` auf, nur mit unterschiedlichen
Schlüsseln im selben Rumpf:

| Knopf | Rumpf |
|---|---|
| Geschäftsprofil speichern | `{ ai_business_description, ai_services, ai_location_hours, ai_booking_faq }` |
| Betriebsangaben speichern | `{ core_fields: {…} }` |
| Branchenangaben speichern | `{ ai_branch_extra: {…} }` |

Der Endpoint verarbeitet **alle drei Schlüssel in einem Aufruf**: er baut ein einziges `patch`-Objekt,
validiert vollständig, bevor er schreibt, und schreibt dann einmal
(`customer-update-assistant.js:382–437`). Ein zusammengelegter Knopf ist damit *ein* Request mit einem
verschmolzenen Rumpf — **keine Serveränderung, kein neuer Endpoint.**

Und er ist sachlich besser als drei: heute lösen drei Klicks drei Schreibvorgänge, drei
ElevenLabs-Synchronisationen und drei Fingerprint-Berechnungen aus. Ein Klick löst eine aus.

**Zwei Dinge, die die Umsetzung beachten muss:**

1. `ai_branch_extra` darf nur mitgeschickt werden, **wenn eine Branche zugeordnet ist** — sonst antwortet der
   Endpoint mit `409 no_industry_template` und die Alles-oder-nichts-Prüfung lässt auch die übrigen Angaben
   scheitern. Gleiches gilt für `core_fields` bei fehlendem Schema (`409 core_fields_unavailable`). Beide
   Fälle sind heute dadurch verdeckt, dass die jeweilige Karte gar keinen Knopf rendert.
2. Der Rückmeldebereich (`vx-*-status`) existiert heute dreimal. Er wird einer — direkt beim Knopf, wo
   `vxInlineSaveStatus` ohnehin schon quittiert.

---

## 7. Was diese Umstellung anderswo sichtbar macht

Die vier Freitextspalten werden an vier weiteren Stellen als **Mass für „ist etwas hinterlegt"** gelesen.
Sobald ein Kunde nur noch strukturiert pflegt, messen alle vier das Falsche. Keine davon ist beauftragt,
alle vier gehören zum ehrlichen Bild:

| Stelle | Liest | Folge |
|---|---|---|
| Karte „Was Ihr Assistent weiss" (`:630`) | `business.services`, `location_hours`, `booking_faq` | Bestätigte Liste, leerer Text → Karte sagt „Noch ergänzen", obwohl alles hinterlegt ist |
| Zähler „x von 4 Bereichen" (`customer-assistant-profile.js:680`) | dieselben vier Spalten | zählt die abgelöste Schicht |
| `qualityReport()` (`prompt-builder-v2.js:577`) | `ai_business_description`, `ai_services` | Blocker „Leistungen erfasst" bleibt rot, `ready:false` — obwohl der Prompt die Liste enthält |
| Admin-Guard `isConfigured` (`admin-panel/index.html:7555`) | dieselben Spalten | Setup-Assistent hält den Kunden für unkonfiguriert |

Am schärfsten ist der dritte: der Qualitätscheck würde einen Kunden als nicht startbereit führen, dessen
Prompt vollständig ist. Heute ist das verdeckt, weil jeder Kunde Vorlagentext in `ai_services` trägt.

**Vorschlag:** alle vier auf „Struktur führt, Text ist Rückfall" umstellen — dieselbe Rangfolge, die der
Prompt-Builder schon anwendet. Das ist ein kleiner, aber eigener Schnitt; er gehört in dieselbe Auslieferung,
sonst widerspricht die Statuskarte der Seite direkt daneben.

---

## 8. Entscheidungen, die vor dem Bauen zu treffen sind

**E1 — Wohin mit den Terminregeln?** (blockiert Paar 2)

- **(a) Empfehlung: neues Feld „Regeln rund um Termine"** in Schicht A (`ai_appointment_rules`, `textarea`,
  Schema-Eintrag im Abschnitt „Leistungen und häufige Fragen", eigener Prompt-Abschnitt). Der Parser trennt
  die Regelzeilen bereits heute korrekt heraus — sie werden derselbe Vorschlag wie bei Leistungen und FAQ,
  ein Klick, bestätigen, fertig. Danach ist `ai_booking_faq` restlos abgelöst und verhält sich wie 2.1.
  Kosten: eine Spalte, ein Schema-Eintrag, ein `add()` im Builder.
- (b) Kleiner: Freitextfeld bleibt sichtbar, umbenannt in „Regeln rund um Termine", und der Builder druckt
  **beide** (`faqList` *und* `ai_booking_faq`). Kein Schema, keine Spalte — aber die Beschriftung sagt dann
  etwas anderes, als in der Spalte steht, und ein Freitextfeld bleibt stehen.
- (c) Nichts tun und den Verlust bewusst annehmen. **Rate ich ab** — die Oberfläche verspricht heute
  ausdrücklich das Gegenteil.

**E2 — Wann zieht sich der Standort-Text aus dem Prompt zurück?** (blockiert Paar 3)

- **(a) Empfehlung: automatisch**, sobald Wochenraster bestätigt **und** „Adresse für Anrufende" gefüllt ist
  — das sind genau die zwei Angaben, denen der Builder heute schon ausdrücklichen Vorrang gibt. Die Seite
  sagt es vorher an: „Sobald Öffnungszeiten und Adresse bestätigt sind, verwendet Ihr Assistent diesen Text
  nicht mehr."
- (b) Auf Klick: ein Knopf „Diesen Text nicht mehr verwenden". Mehr Kundenhoheit, aber ein Bedienschritt
  mehr auf einer Seite, die gerade weniger Bedienschritte bekommen soll.
- (c) Der Text bleibt dauerhaft im Prompt. Dann bleibt er auch dauerhaft ein sichtbares Bearbeitungsfeld,
  und Paar 3 ist nicht aufgelöst, nur einsortiert.

**E3 — Welches Beschreibungsfeld bleibt auf der Kundenseite?** (blockiert Paar 4)

- **(a) Empfehlung: `ai_business_description` bleibt**, bekommt Beschriftung, Hinweis und Beispiel der
  Kurzbeschreibung und rückt in den Abschnitt „Was Sie anbieten". `ai_short_description` verschwindet aus
  der Kundenoberfläche (bleibt im Admin-Wizard, Prompt-Logik unverändert). Grund: dort liegt bei allen vier
  Kunden der Inhalt, dorthin schreiben Website-Analyse und Admin-Wizard, und drei der vier Stellen aus
  Abschnitt 7 messen genau diese Spalte.
- (b) Umgekehrt: `ai_short_description` bleibt, der lange Text wandert ins Archiv. Sauberer im Sinne von
  „Schicht A führt", aber es entwertet den einzigen Inhalt, den die Kunden heute haben, und der Prompt
  müsste die Verkettung verlieren.

**E4 — Kommt Abschnitt 7 (die vier Fehlmessungen) in dieselbe Auslieferung?** Empfehlung: ja, mindestens die
Statuskarte und der Zähler — sie stehen direkt neben der umgebauten Seite und würden ihr sonst widersprechen.
`qualityReport()` und der Admin-Guard können ein eigener, kleiner Schnitt danach sein.

---

## 9. Umsetzung nach Freigabe (Reihenfolge, wenn E1–E4 wie empfohlen entschieden werden)

| # | Schnitt | Betrifft |
|---|---|---|
| 1 | Feld „Regeln rund um Termine" (Spalte, Schema, Vorschlag aus `rules`, Prompt-Abschnitt) | Migration, `service-faq.js`, `prompt-builder-v2.js`, Profil-Endpoint |
| 2 | Rückzugsregel für den Standort-Text im Builder | `prompt-builder-v2.js` |
| 3 | Karte „Dauerhaftes Geschäftswissen" auflösen: Beschreibung in „Was Sie anbieten", die drei übrigen Texte als eingeklappte Herkunftszeilen unter ihr jeweiliges Feld | `customer-runtime-assistant-profile.js`, CSS |
| 4 | Ein Speicher-Knopf, ein Statusbereich, ein Request | `customer-runtime-assistant-profile.js` |
| 5 | Öffnungszeiten kompakt mit Aufklapp-Raster | `customer-runtime-assistant-profile.js`, CSS |
| 6 | Die vier Fehlmessungen aus Abschnitt 7 auf „Struktur führt" umstellen | Profil-Endpoint, `prompt-builder-v2.js`, Admin |
| 7 | Screenshots auf beiden Breakpoints, Zustand 1 und Zustand 2 je Paar | — |

Schnitte 1 und 2 sind Prompt-Arbeit und wären für sich genommen ausserhalb des Auftrags — sie sind
Voraussetzung dafür, dass 3 die Felder überhaupt wegnehmen **darf**, ohne Inhalt still zu verlieren.

---

## 10. Was ungeprüft bleibt

- **Nichts davon ist im Browser bedient.** Diese Datei ist Quelltext- und Datenlage-Analyse. Die
  Screenshot-Pflicht aus dem Auftrag gilt für die Umsetzung, nicht für dieses Papier.
- **Der Fund aus Abschnitt 3 ist nicht am lebenden Objekt reproduziert** — kein Kunde hat eine bestätigte
  FAQ-Liste, an der sich der Verlust zeigen liesse. Er ist aus `service-faq.js`, dem Builder und der
  J8-Migration gelesen, alle drei Stellen sind eindeutig.
- **Die Zählungen (19/19, 5/19, …)** stammen aus der Morgen-Diagnose und sind hier nicht neu ausgezählt.
- **Ob die kompakte Öffnungszeiten-Form auf dem Telefon wirklich trägt**, ist eine begründete Annahme. Sie
  ist der einzige Vorschlag hier, der ein neues Bedienmuster einführt statt eines wegzunehmen.

---

## 11. Umsetzung (09.08., nach Freigabe von E1–E4)

Alle vier Entscheidungen wie empfohlen freigegeben und umgesetzt. Was dabei
zusätzlich zum Zielbild gefunden wurde, steht in 11.3 — es sind drei Fehler, die
**erst der Blick auf die gerenderte Seite** gezeigt hat, keiner davon aus diesem
Auftrag stammend.

### 11.1 Was gebaut wurde

| Entscheid | Umsetzung |
|---|---|
| **E1** | Spalte `ai_appointment_rules`, Schema-Feld „Regeln rund um Termine" im Schritt *Leistungen und häufige Fragen*, Vorschlag aus den bereits getrennt gemeldeten Regelzeilen, Prompt-Abschnitt `## REGELN RUND UM TERMINE`. `ai_booking_faq` weicht erst, wenn **beide** Nachfolger bestätigt sind; solange nur einer steht, bleibt der Text mit ausdrücklichem Vorrangsatz. Die Fragenliste bekommt den Abschnitt `## HÄUFIGE FRAGEN`, wenn nur noch Paare darin stehen. |
| **E2** | `ai_location_hours` verlässt den Prompt, sobald Wochenraster **und** Adresse bestätigt sind. Der Vorrangsatz im Öffnungszeiten-Abschnitt entfällt dann mit ihm — ein Hinweis auf einen Widerspruch, den es nicht mehr gibt, ist selbst eine Irreführung. |
| **E3** | `ai_business_description` führt, übernimmt Beschriftung, Hinweis und Beispiel der Kurzbeschreibung und steht im Abschnitt *Was Sie anbieten*. `short_description` ist über das neue Schema-Attribut `audience: "admin"` eine reine Admin-Frage geworden — gefiltert wird in **beiden** Richtungen, Darstellung und Schreibpfad. |
| **E4** | Vier Messstellen auf „Struktur führt, Text ist Rückfall": `qualityReport()`, der Zähler `completed_fields`, die Zeilen der Karte *Was Ihr Assistent weiss* (kommen jetzt fertig vom Server) und der Admin-Guard `isConfigured`. |
| **Oberfläche** | Karte *Dauerhaftes Geschäftswissen* aufgelöst; die drei abgelösten Texte stehen als eingeklappte Herkunftszeile unter dem Feld, das sie ersetzt, mit ihrem Zustand im Summary statt im zweiten Absatz eines Feldhinweises. |
| **Speichern** | Ein Knopf, ein Statusbereich, ein Request. `ai_branch_extra` und `core_fields` werden nur mitgeschickt, wenn es sie gibt — sonst liesse ein `409` die vollständige Vorprüfung auch alles andere scheitern. |
| **Öffnungszeiten** | Mo–Fr / Sa / So kompakt, Sieben-Tage-Raster aufklappbar. Gespeicherte Struktur unverändert (`{"mon":[["08:00","12:00"]], …}`), keine Migration. |

Zwei Schema-Attribute sind dazugekommen, beide additiv und von älteren Renderern
ignorierbar: `audience` (wer die Frage stellt) und `max` (Zeichenlimit, im Code
hart auf 2000 gedeckelt — eine Zeile in `system_config` soll kein unbegrenztes
Schreibrecht werden).

**`PROMPT_BUILDER_VERSION` auf 2.7.** Die Ausgabe ändert sich bei jedem Kunden,
dessen Freitext Regelzeilen trägt — also bei allen mit Vorlagentext. Folge wie
bei J9: jeder gespeicherte Fingerprint gilt ab dem Deploy als veraltet, der
nächste Fan-out fasst alle Agenten an.

### 11.2 Wie geprüft wurde

- **Migration und Rückbau gegen eine echte Postgres 16 gefahren**, nicht nur
  gelesen: Ausgangszustand aus J6 + J7 hergestellt, Migration angewandt
  (5 Schritte, `betrieb_angebot` von 2 auf 3 Felder, `short_description` auf
  `audience: admin`), **zweiter Lauf idempotent** (0 statt 1 betroffene Zeile),
  Rückbau stellt den Ausgangszustand exakt wieder her (Feld weg, Hinweis
  zurück, Spalte gelöscht).
- **Klick-Abnahme im Browser, beide Breakpoints, 58 Prüfungen grün.** Das echte
  Runtime-Skript mit dem echten CSS, nur der Endpoint gestubbt: Zustand 1 und
  Zustand 2 je Paar, ein Speicher-Knopf, ein Request mit allen drei Teilen,
  Vorschlag füllt ohne zu speichern, Auf- und Zuklappen des Rasters verlustfrei,
  kein horizontaler Überlauf, keine JS-Fehler.
- **58 von 59 `verify-*.mjs` grün**, 157/157 Tests. Der eine Fehlschlag ist der
  bekannte, dokumentierte Fall fehlender DB-Zugangsdaten.
- Ein bestehender Test wurde **umgeschrieben statt gelöscht**: „J7: questions and
  answers stay paired" prüfte, dass die bestätigte Liste den Freitext ersetzt —
  genau das Verhalten, das E1 zurücknimmt. Er heisst jetzt „E1: a confirmed FAQ
  list leads, but does not take the rules with it" und prüft die Paare weiterhin.

### 11.3 Drei Fehler, die erst der Screenshot gezeigt hat

Alle drei sind älter als dieser Auftrag und wären durch keine Quelltextprüfung
aufgefallen — sie sind der Beleg dafür, warum die Klick-Abnahme der grösste
verbliebene Risikoposten war.

1. **Das Wochenraster aus J5 hat nie als Raster gerendert.**
   `.vx-ap-field :where(input, textarea) { width: 100% }` trifft auch die
   Zeitfelder; ein Flex-Item mit voller Breite bekommt jede Zeile für sich.
   Der Klick-Test-Befund „pro Wochentag mehrere Zeitfelder untereinander mit
   Bindestrichen dazwischen" beschreibt genau das — er war nicht nur *zu viel
   Raster*, sondern ein Darstellungsfehler. `width: auto; flex: 0 0 auto` muss
   ausdrücklich dastehen, `min-width` allein genügt nicht.

2. **`vx-ap-btn--ghost` gibt es nicht.** Die Klasse heisst `.ghost`, wie
   `.secondary`. Seit J5 waren damit alle Nebenaktionen — Vorschlag übernehmen,
   Zeile hinzufügen, Raster aufklappen — als gefüllte Hauptaktion gerendert. Auf
   einem Screen mit vier Vorschlägen standen vier dunkle Balken, die alle
   aussahen wie „Speichern". Für Grundsatz 15 ist das die falsche Einladung.
   Alle acht Aufrufstellen auf die etablierte Schreibweise umgestellt; zusätzlich
   bleiben Vorschlagsknöpfe jetzt auf ihrer Textbreite statt sich über die volle
   Zeile zu strecken.

3. **Der Regelvorschlag stand zweimal untereinander.** Einmal als
   Schema-`suggestion` (die einzeilige Zeile „Aus Ihren Stammdaten: …
   [Übernehmen]", gedacht für die Adresse) und einmal als der neue Kasten mit
   vollem Wortlaut. Zusätzlich nannte der FAQ-Vorschlag die Regelzeilen weiterhin
   als Nebenbemerkung — mit dem Satz „Sie bleiben im Text stehen", also genau dem
   Versprechen, das E1 gerade erst eingelöst hat. Beides entfernt: die Regeln
   stehen an genau einer Stelle, bei ihrem Feld.

### 11.4 Was ungeprüft bleibt

- **Die Migration ist auf keiner echten Datenbank angewandt** — weder Staging
  noch Produktion. Das ist eine Freigabeentscheidung, wie bei J4/J5/J6. Die
  lokale Postgres beweist Syntax, Idempotenz und Rückbau, nicht den Zustand
  Ihrer Daten. Für den Staging-Lauf gilt die Lehre aus J6: **zuerst den
  Ausgangszustand herstellen**, Staging spiegelt Produktion nicht automatisch.
- **Kein Live-Anruf.** Der Prompt enthält die Terminregeln nachweislich; ob das
  Modell sie befolgt, ist damit nicht gezeigt. Unverändert offen seit J1.
- **Die Klick-Abnahme lief gegen einen gestubbten Endpoint.** Sie beweist, dass
  die Seite mit einem realistischen Profil korrekt rendert, bedient und den
  richtigen Rumpf schickt — nicht, dass der echte Endpoint diesen Rumpf
  akzeptiert. Der Weg dorthin ist durch die Verify-Skripte des Schreibpfads
  abgedeckt, aber nicht in einem Zug durchlaufen.
- **Kein Kunde hat bestätigte Terminregeln**, der Zustand 2 ist also nur an
  gesetzten Werten geprüft, nicht an gewachsenen Daten.
- **Der Fan-out nach dem Versionswechsel ist nicht gelaufen.**
