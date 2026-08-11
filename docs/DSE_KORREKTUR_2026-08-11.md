# Datenschutzerklärung — Korrekturvorschlag §5, §6, §7

**Datum:** 11.08.2026 · **Status:** Vorschlag, **nicht umgesetzt** · **Grundlage:**
`DATENRESIDENZ_DIAGNOSE_2026-08-11.md`, Abschnitte F.1, F.2, F.3 ·
**Bezugsdokument:** `docs/website-relaunch/ist-stand-2026-08-10/datenschutz.html`, Version 2.0,
Stand 01.05.2026

**Auftrag:** §7 gehört in denselben Arbeitsgang wie der neue Startseiten-Text, beide Zeilen auf
90/180 Tage. Dieses Dokument liefert den Wortlaut — dazu die zwei weiteren Stellen, die im selben
Zug fallen sollten, weil sie dieselbe Ursache haben.

> **Eine Einschränkung vorweg:** Der Vorschlag in Abschnitt 2 (Transkripte auf 90 Tage) beschreibt
> die Technik von heute. Wird Ticket
> `docs/TICKET_TRANSKRIPT_AUFBEWAHRUNG_2026-08-11.md` zugunsten einer längeren Frist entschieden,
> ändert sich diese Zeile mit. **Die Entscheidung sollte deshalb vor der Textänderung fallen** —
> sonst wird §7 zweimal angefasst.

---

## 1. Was geändert wird — Überblick

| # | Stelle | Problem | Dringlichkeit |
|---|---|---|---|
| 1 | §7, Zeile „Audio-Aufzeichnungen" | sagt 30 Tage, tatsächlich 90 — ✅ **entschieden: ElevenLabs wird auf 30 Tage gestellt, die Zeile bleibt.** Nur eine Klarstellung kommt hinzu. **Bis 03.09. folgenlos, siehe 2.1** | 🔴 **Zusage wird bis zur Umstellung gebrochen** |
| 2 | §7, Zeile „Transkripte" | sagt Vertragsdauer, tatsächlich 90 Tage | 🔴 **ab Anfang November wirksam** |
| 3 | §7 | Zeile für Konfigurationsdaten **fehlt ganz** | 🟠 Lücke |
| 4 | §5, Zeile „KI-Sprachdienste" | Zweck nennt nur Anrufinhalte, nicht die Konfiguration | 🟠 Lücke |
| 5 | §5, Zeile „Web-Hosting" | „EU / USA" — wird nach Frankfurt-Umstellung zu „EU" | 🔵 erst danach |
| 6 | §6 | nennt nur Sprachverarbeitung und Telefonie als Übermittlungsgrund | 🟠 Lücke |

Die Punkte 1 und 2 sind der Auftrag. Die Punkte 3, 4 und 6 sind dieselbe Lücke aus drei Blickwinkeln
und sollten mit, weil sie sonst beim nächsten Durchgang wieder auffallen. Punkt 5 kommt **nach**
der Netlify-Umstellung, nicht vorher.

---

## 2. §7 Speicherdauer — neue Fassung

### 2.1 Zeile „Audio-Aufzeichnungen von Anrufen" — ✅ entschieden: Technik anpassen

**Entscheidung vom 11.08.2026:** Nicht die Erklärung auf 90 Tage heben, sondern **ElevenLabs auf
30 Tage stellen.** Begründung des Betreibers: datenschutzfreundlicher, und bei einem
Rückrufprodukt ist ein kürzeres Anhör-Fenster kein Verlust.

**Folge für den Text:** Die Zeile bleibt inhaltlich, wie sie ist. Es ändert sich **keine Zahl** —
nur eine Klarstellung kommt hinzu:

> | Audio-Aufzeichnungen von Anrufen | 30 Tage nach dem Anruf. Die Aufzeichnung wird nicht bei Voxera, sondern beim KI-Sprachdienstleister gespeichert und dort automatisch gelöscht. |

**Warum der Zusatz trotzdem nötig ist:** Die heutige Zeile erweckt den Eindruck, Voxera halte die
Aufnahme selbst. Das ist nachweislich nicht so — `recording_url` und `recording_storage_path` sind
bei allen Anrufen leer, die einzige Kopie liegt beim Sprachdienstleister (Diagnose B.3). Wer nach
Art. 25 revDSG Auskunft verlangt, muss wissen, wo er sie bekommt.

> ⚠️ **Diese Umstellung ist bis zum 3. September gratis — danach nicht mehr.**
>
> Wird die Aufbewahrung bei ElevenLabs von 90 auf 30 Tage gesenkt, fragt die Konsole, ob die neue
> Frist **auch auf bestehende Aufnahmen** angewendet werden soll. Der älteste Anruf stammt vom
> 04.08.2026 und erreicht am **03.09.2026** die 30-Tage-Grenze. **Bis dahin gibt es keine
> Aufnahme, die dadurch verlorenginge.** Danach löscht dieselbe Umstellung bestehende Aufnahmen
> sofort mit.
>
> Es ist also nicht nur billig, das jetzt zu tun — es ist der einzige Zeitpunkt, zu dem es
> folgenlos ist.

**Reihenfolge:** Erst umstellen, dann veröffentlichen. Solange ElevenLabs auf 90 Tage steht, ist
die 30-Tage-Zeile falsch — daran ändert die Entscheidung nichts, nur ihre Ausführung.

### 2.2 Zeile „Transkripte und Anruf-Metadaten"

**Heute:**

> | Transkripte und Anruf-Metadaten | Während der Vertragsdauer, danach 30 Tage Übergangsfrist |

**Vorschlag (Stand der heutigen Technik):**

> | Transkripte | 90 Tage nach dem Anruf, danach automatische Löschung |
> | Anrufprotokolle und Metadaten (Zeitpunkt, Nummer, Dauer, Zusammenfassung) | 180 Tage nach dem Anruf, danach automatische Löschung |

**Warum zwei Zeilen statt einer:** Die Technik behandelt beide unterschiedlich. Nach 90 Tagen werden
`transcript`, `transcript_json` und die Referenz auf das Gespräch beim Sprachdienstleister geleert;
der Anrufsatz mit Zusammenfassung bleibt weitere 90 Tage bestehen und wird erst nach 180 Tagen
gelöscht (`enforce-data-retention.js:12–13`). Eine gemeinsame Zeile könnte das nicht abbilden, ohne
wieder ungenau zu werden.

**Das deckt sich wörtlich mit dem neuen Startseiten-Text:** „Transkripte löschen wir nach 90 Tagen,
Anrufprotokolle nach 180 Tagen." Damit ist der Widerspruch in beide Richtungen aufgelöst.

### 2.3 Neue Zeile „Konfigurationsdaten"

In §7 fehlt diese Kategorie vollständig, obwohl §2 sie kennt. Der Wortlaut hängt an Abschnitt 3 —
**bitte dort weiterlesen, bevor eine der beiden Varianten übernommen wird.**

---

## 3. Konfigurationsdaten — die Zeile, die noch keine Deckung hat

Im letzten Durchgang war vorgeschlagen worden:

> „… und werden dort bei Vertragsende mit dem Assistenten gelöscht."

**Dieser Halbsatz darf so nicht ins Dokument.** Die Prüfung (Diagnose F.3) hat ergeben:

- Es gibt im gesamten Repository **keinen einzigen `DELETE`-Aufruf an ElevenLabs.**
- Beide Kündigungswege — `contract-terminate.js` und `lifecycle-runner.js` — fassen ausschliesslich
  Supabase an. Das Wort „elevenlabs" kommt in `contract-terminate.js` nicht vor.
- `elevenlabs_agent_id` bleibt am Kundensatz stehen. Der Agent lebt weiter.
- **Verschärfend:** Der nächtliche `fanout-sync-planner` wählt Kunden **allein** danach aus, ob eine
  `elevenlabs_agent_id` gesetzt ist (`_lib/elevenlabs-fanout.js:44`) — **ohne Filter auf
  `operational_status`.** Ein gekündigter Kunde mit Agent würde also weiterhin **jede Nacht neu in
  die USA synchronisiert.**
- **Noch ist nichts passiert:** Der eine gekündigte Kunde in der Produktionsdatenbank hat keine
  Agent-ID. Der Fehler ist latent und tritt beim ersten Kündigungsfall mit bereitgestelltem Agenten
  ein.

### Variante A — erst den Prozess bauen, dann die Zusage machen ⭐ empfohlen

> | Konfigurationsdaten (Begrüssung, KI-Anweisungen, Geschäftsprofil) | Für die Dauer des Vertrags. Diese Daten sind zur Erbringung der Leistung beim KI-Sprachdienstleister gespeichert und werden dort bei Vertragsende zusammen mit dem Assistenten gelöscht. |

**Voraussetzung:** Ein Offboarding-Schritt, der bei `operational_status = 'terminated'` den Agenten
bei ElevenLabs löscht, die Rufnummer freigibt und `elevenlabs_agent_id` auf `null` setzt. Solange
der fehlt, ist der Satz falsch.

**Aufwand:** überschaubar. Ein `DELETE` auf `/v1/convai/agents/{id}`, aufgerufen aus beiden
Kündigungswegen, plus ein `.neq('operational_status', 'terminated')` in `findStaleCustomers()`.
Der zweite Teil ist ein Einzeiler und behebt die nächtliche Wiederauffrischung **unabhängig** davon,
ob der Löschprozess kommt.

### Variante B — schreiben, was heute stimmt

> | Konfigurationsdaten (Begrüssung, KI-Anweisungen, Geschäftsprofil) | Für die Dauer des Vertrags. Diese Daten sind zur Erbringung der Leistung beim KI-Sprachdienstleister in den USA gespeichert. Die Löschung nach Vertragsende erfolgt auf Anfrage an info@voxera.ch. |

Ehrlich, aber schwach: Eine Löschung „auf Anfrage" ist bei Daten, die man ohnehin nicht mehr
braucht, schwer begründbar, und sie lädt zur Nachfrage ein, warum das nicht automatisch geschieht.

### ✅ Entschieden am 11.08.2026: **Variante B**, bis der Prozess steht

Der Betreiber hat festgelegt: Der Halbsatz „wird bei Vertragsende gelöscht" kommt **nicht** in die
Datenschutzerklärung, solange es keinen Löschprozess gibt. Was drinsteht, muss stattdessen die
Wahrheit beschreiben — **dass die Konfigurationsdaten dort liegen und wie lange.**

**Damit gilt für die Veröffentlichung der Wortlaut aus Variante B.** Er ist unbequem, aber er ist
richtig, und er ist der einzige, der ohne Bauarbeiten haltbar ist.

**Stand der beiden Teilmassnahmen:**

| Massnahme | Status |
|---|---|
| Filter in `findStaleCustomers()` — verhindert die nächtliche Wiederauffrischung | ✅ **umgesetzt**, PR `claude/fanout-terminierte-kunden-ausschliessen`, Merge offen |
| Löschprozess bei Vertragsende | ❌ offen — `docs/TICKET_OFFBOARDING_ELEVENLABS_2026-08-11.md` |

**Sobald das Offboarding-Ticket erledigt ist**, wird diese Zeile von Variante B auf **Variante A**
gehoben. Das ist der eigentliche Zielzustand; Variante B ist der ehrliche Zwischenstand.

> Was **nicht** geht, ist Variante A ohne den Prozess. Das wäre genau die Klasse von Zusage ohne
> Deckung, die dieser ganze Strang beseitigen soll.

---

## 4. §5 und §6 — die Standortlücke

### 4.1 §5, Zeile „KI-Sprachdienste"

**Heute:**

> | KI-Sprachdienste | Spracherkennung, Sprachverstehen, Sprachsynthese, Verarbeitung der Anrufinhalte | USA |

**Vorschlag:**

> | KI-Sprachdienste | Spracherkennung, Sprachverstehen, Sprachsynthese, Verarbeitung der Anrufinhalte **sowie Speicherung der Assistenten-Konfiguration (Begrüssung, KI-Anweisungen, Geschäftsprofil)** | USA |

### 4.2 §6, erster Absatz

**Heute:**

> „Bei der Verarbeitung Ihrer Daten kann eine Übermittlung in die USA erfolgen, insbesondere im
> Rahmen der KI-Sprachverarbeitung und Telefonie-Infrastruktur."

**Vorschlag:**

> „Bei der Verarbeitung Ihrer Daten kann eine Übermittlung in die USA erfolgen, insbesondere im
> Rahmen der KI-Sprachverarbeitung und Telefonie-Infrastruktur. **Dies betrifft neben den
> Gesprächsinhalten auch die Konfiguration Ihres Assistenten, die beim KI-Sprachdienstleister
> hinterlegt ist.**"

### 4.3 §5, Zeile „Web-Hosting" — erst nach Frankfurt

**Heute:** `EU / USA` → **nach der Umstellung:** `EU`

Diese Zeile **nicht vorab ändern.** Sie wird erst richtig, wenn beide Netlify-Projekte tatsächlich
auf `eu-central-1` stehen und die Prüfliste aus `docs/AUFTRAG_NETLIFY_FRANKFURT_2026-08-11.md`
durch ist.

---

## 5. Was **nicht** geändert werden muss

Zur Beruhigung — die Datenschutzerklärung ist in ihrer Substanz gut und war bereits vor diesem
Strang näher an der Wahrheit als die Startseite:

- **§5 Datenstandort-Tabelle** — Kategorienlogik und die übrigen Zeilen stimmen.
- **§6 Absicherung** — Standardvertragsklauseln, TLS, Datenminimierung, und der offene Hinweis auf
  den CLOUD Act. Letzterer ist selten und spricht für das Dokument.
- **§8 „Datenresidenz: Die Hauptdatenbank wird in der Schweiz (Zürich) betrieben"** — belegt richtig.
- **§11 KI-Telefonie**, Disclosure und EU AI Act Art. 50 — sauber.
- **§1 Rollenverteilung** Verantwortlicher / Auftragsverarbeiter — korrekt aufgeteilt.

Zu ändern sind sechs Zeilen, nicht das Dokument.

---

## 6. Reihenfolge

| # | Schritt | Status |
|---|---|---|
| 1 | Einzeiler-Filter in `findStaleCustomers()` | ✅ umgesetzt, **Merge offen** |
| 2 | **ElevenLabs auf 30 Tage Audio stellen** — ⏳ **bis 03.09. folgenlos** (2.1) | offen, Betreiber |
| 3 | Weg A aus dem Transkript-Ticket umsetzen: §7 auf 90/180 (2.2) | wartet auf Schritt 2 |
| 4 | **Transkript-Spalte in den CSV-Export** — `TICKET_DATENEXPORT_2026-08-11.md`, 4.1 | offen, unabhängig |
| 5 | §7 (2.1–2.3), §5 (4.1) und §6 (4.2) **gemeinsam mit dem neuen Startseiten-Text** veröffentlichen | wartet auf 2–4 |
| 6 | Version auf **2.1** heben, Stand-Datum aktualisieren, wesentliche Änderung den Vertragskunden mitteilen (§13 sieht das vor) | mit Schritt 5 |
| 7 | **Nach** der Netlify-Umstellung: §5 Web-Hosting auf „EU" (4.3) | wartet auf Website-Ausfall |
| 8 | Sobald der Offboarding-Löschprozess steht: Variante B → Variante A (Abschnitt 3) | wartet auf Ticket |

**Der kritische Pfad ist Schritt 2.** Er ist der einzige mit einem Datum, das nicht verschiebbar
ist: Ab dem 3. September kostet dieselbe Umstellung bestehende Aufnahmen. Alles andere in dieser
Liste kann warten, das nicht.
