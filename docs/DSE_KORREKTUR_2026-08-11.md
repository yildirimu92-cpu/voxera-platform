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
| 1 | §7, Zeile „Audio-Aufzeichnungen" | sagt 30 Tage, tatsächlich 90 | 🔴 **Zusage wird heute gebrochen** |
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

### 2.1 Zeile „Audio-Aufzeichnungen von Anrufen"

**Heute:**

> | Audio-Aufzeichnungen von Anrufen | 30 Tage nach Anruf, danach automatische Löschung |

**Vorschlag:**

> | Audio-Aufzeichnungen von Anrufen | 90 Tage nach dem Anruf. Die Aufzeichnung wird nicht bei Voxera, sondern beim KI-Sprachdienstleister gespeichert und dort automatisch gelöscht. |

**Warum der Zusatz:** Die heutige Zeile erweckt den Eindruck, Voxera halte die Aufnahme selbst. Das
ist nachweislich nicht so — `recording_url` und `recording_storage_path` sind bei allen Anrufen
leer, die einzige Kopie liegt beim Sprachdienstleister (Diagnose B.3). Wer nach Art. 25 revDSG
Auskunft verlangt, muss wissen, wo er sie bekommt.

> **Alternative, falls Sie die Richtung umdrehen wollen:** Statt die Erklärung auf 90 Tage zu
> heben, lässt sich ElevenLabs auf **30 Tage** stellen — dann bleibt die heutige Zeile wörtlich
> richtig und es ist nur eine Konsolen-Einstellung nötig. Das ist die datenschutzfreundlichere
> Variante und kostet nichts ausser einem kürzeren Fenster, in dem ein Gespräch im Dashboard
> anhörbar ist. **Diese Wahl gehört zusammen mit Ticket
> `TICKET_TRANSKRIPT_AUFBEWAHRUNG_2026-08-11.md` entschieden**, weil beide dieselbe Frage stellen:
> Wie lange ist ein Gespräch im Produkt noch etwas wert?

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

> **Empfehlung: Variante A, mit dem Einzeiler als Sofortmassnahme.** Der Filter in
> `findStaleCustomers()` sollte ohnehin gesetzt werden — er verhindert, dass gekündigte Kunden
> nachts weiter synchronisiert werden, und kostet eine Zeile. Der Löschprozess kann danach folgen;
> bis er steht, gilt Variante B als Zwischenstand.
>
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

1. **Ticket `TICKET_TRANSKRIPT_AUFBEWAHRUNG_2026-08-11.md` entscheiden** — bestimmt die Zahl in 2.2
   und die Richtung in 2.1
2. Einzeiler-Filter in `findStaleCustomers()` setzen (unabhängig, sofort)
3. §7 (2.1–2.3), §5 (4.1) und §6 (4.2) **gemeinsam mit dem neuen Startseiten-Text** veröffentlichen
4. Version auf **2.1** heben, Stand-Datum aktualisieren, wesentliche Änderung den Vertragskunden
   mitteilen — §13 sieht das vor
5. **Nach** der Netlify-Umstellung: §5 Web-Hosting auf „EU" (4.3)
6. Sobald der Offboarding-Löschprozess steht: Variante B → Variante A (Abschnitt 3)
