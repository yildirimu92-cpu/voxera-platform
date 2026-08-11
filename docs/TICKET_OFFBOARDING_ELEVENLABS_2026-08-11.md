# Ticket — Offboarding: Agent bei Vertragsende löschen

**Datum:** 11.08.2026 · **Status:** offen · **Typ:** Datenschutz-Pflicht mit Codeanteil ·
**Grundlage:** `DATENRESIDENZ_DIAGNOSE_2026-08-11.md`, F.3 ·
**Teilweise vorweggenommen:** PR „Gekündigte Kunden nicht weiter zu ElevenLabs synchronisieren"
(Branch `claude/fanout-terminierte-kunden-ausschliessen`)

---

## 1. Der Befund

**Es gibt im gesamten Repository keinen einzigen `DELETE`-Aufruf an ElevenLabs.** Der einzige
`DELETE` überhaupt geht an einen Kalenderanbieter (`_lib/calendar-providers.js:285`).

`contract-terminate.js` **enthält das Wort „elevenlabs" nicht ein einziges Mal.**

Beide Wege, auf denen ein Vertrag endet, fassen ausschliesslich Supabase an:

| Weg | Datei | Was passiert | ElevenLabs |
|---|---|---|---|
| manuell | `contract-terminate.js:125` | `operational_status = 'terminated'` | ❌ unberührt |
| zeitgesteuert | `lifecycle-runner.js:138` | dito, plus Vertrags-/Abostatus, Mail, Audit | ❌ unberührt |

`elevenlabs_agent_id` bleibt am Kundensatz stehen. Der Agent existiert bei ElevenLabs weiter — mit
Firmenname, öffentlicher Adresse, Öffnungszeiten, Leistungskatalog, Begrüssungstext und
Notfallnummer. **Unbefristet, in den USA.**

Dasselbe gilt für die **Rufnummer**: `_lib/elevenlabs-phone-number.js` legt an, gibt aber nichts
frei.

## 2. Was bereits erledigt ist — und was nicht

Der oben genannte PR setzt einen Filter, damit gekündigte Kunden nicht **zusätzlich** noch jede
Nacht neu synchronisiert werden. **Das ist die Blutung, nicht die Wunde.**

| | Status |
|---|---|
| Gekündigter Kunde wird nicht mehr nachts neu in die USA geschrieben | ✅ im PR |
| Agent wird bei Vertragsende gelöscht | ❌ **dieses Ticket** |
| Rufnummer wird freigegeben | ❌ dieses Ticket |
| `elevenlabs_agent_id` wird geleert | ❌ dieses Ticket |

## 3. Warum es zählt

- **Zweckbindung.** Die Daten wurden zur Erbringung der Leistung übermittelt. Die Leistung ist
  beendet, der Zweck entfallen — die Grundlage für die weitere Speicherung damit auch.
- **Es blockiert die Datenschutzerklärung.** Der Halbsatz „… und werden dort bei Vertragsende mit
  dem Assistenten gelöscht" darf erst hinein, wenn dieses Ticket erledigt ist. Solange es offen ist,
  muss dort die schwächere Variante B aus `DSE_KORREKTUR_2026-08-11.md` stehen. **Dieses Ticket ist
  die Voraussetzung für den besseren Wortlaut.**
- **Es ist ein Auskunftsrisiko.** Ein ehemaliger Kunde, der nach Art. 25 revDSG fragt, was noch
  gespeichert ist, bekommt heute eine unangenehme Antwort — oder eine falsche.
- **Kostenseite, nebenbei:** Ein Agent, der nicht gelöscht wird, kann je nach Plan weiterzählen.

## 4. Was zu bauen ist

| # | Schritt | Anmerkung |
|---|---|---|
| 1 | `DELETE /v1/convai/agents/{agent_id}` | in `_lib/elevenlabs-sync.js` oder einem neuen `_lib/elevenlabs-offboarding.js` |
| 2 | Rufnummer bei ElevenLabs lösen | `_lib/elevenlabs-phone-number.js` erweitern. **Reihenfolge beachten:** erst Nummer lösen, dann Agent löschen |
| 3 | `elevenlabs_agent_id = null` am Kundensatz | erst **nach** erfolgreichem Löschen — sonst verliert man die Referenz auf einen Agenten, der noch existiert, und er ist nicht mehr auffindbar |
| 4 | Aus **beiden** Kündigungswegen aufrufen | `contract-terminate.js` **und** `lifecycle-runner.js`. Nur einer davon reicht nicht |
| 5 | Mehrvertragsfall respektieren | beide Wege prüfen bereits `hasOtherActiveContract()` bzw. `otherActive`. Der Löschschritt gehört **in denselben `if`-Zweig**, der `operational_status` setzt — sonst verliert ein Kunde mit zweitem aktivem Vertrag seinen Assistenten |
| 6 | Audit-Eintrag | beide Wege schreiben bereits `commercial_lifecycle_audit`. Das Löschergebnis gehört in die Metadaten — es ist der Nachweis gegenüber einer Auskunftsanfrage |
| 7 | Fehlerfall | Schlägt der `DELETE` fehl, darf die Kündigung **nicht** scheitern. Fehler protokollieren, Agent-ID stehen lassen, erneut versuchen — das Muster dafür existiert bereits in `outbox_events` / `outbox-retry-worker` |

**Nicht vergessen:** Twilio. Die Rufnummer ist dort weiterhin gebucht und kostet. Ob sie freigegeben
oder in einen Pool zurückgeführt wird, ist eine Produktentscheidung
(`admin-twilio-number-assignment.js` verwaltet die Zuordnung heute).

## 5. Offene Fragen vor dem Bau

- **Aufschubfrist?** Sofort löschen oder 30 Tage nach Vertragsende, passend zur Übergangsfrist in
  §7? Ein sofortiges Löschen macht eine Reaktivierung („der Kunde kommt im nächsten Monat zurück")
  teuer, weil der Agent neu aufgebaut werden muss.
  **Empfehlung: 30 Tage**, konsistent mit der Übergangsfrist, die die Datenschutzerklärung ohnehin
  nennt — und der Aufhänger für einen zeitgesteuerten Lauf statt eines Aufrufs im Kündigungspfad.
- **Löscht der `DELETE` auch die Gesprächshistorie** beim Anbieter, oder bleiben Konversationen
  unabhängig vom Agenten bestehen? Das entscheidet, ob zusätzlich Konversationen gelöscht werden
  müssen. **Vor dem Bau in der Anbieter-Dokumentation prüfen** — die Annahme „Agent weg = alles weg"
  ist nicht belegt.
- **Prüfpunkt G.1** (Aufbewahrungsfrist Gesprächsdaten, Default 2 Jahre) hängt mit drin: Steht dort
  der Default, überleben Transkripte beim Anbieter die Kündigung um bis zu zwei Jahre — unabhängig
  davon, ob der Agent gelöscht wird.

## 6. Aufwand und Dringlichkeit

**Aufwand:** ein knapper Tag, wenn Schritt 5 und 7 ernst genommen werden. Der reine `DELETE`-Aufruf
ist eine halbe Stunde — die Sorgfalt liegt im Mehrvertragsfall und im Fehlerpfad.

**Dringlichkeit: mittel, aber mit einem harten Auslöser.** Solange kein Kunde mit bereitgestelltem
Agenten kündigt, passiert nichts. **Der erste solche Fall macht es sofort dringend** — und ab dann
ist es ein bestehender Zustand, der aufgeräumt werden muss, statt einer Vorkehrung.

Beim aktuellen Stand — 3 aktive Kunden, davon 1 mit Agent — ist der Bau **jetzt am billigsten**.

## 7. Erledigt, wenn

- [ ] Ein gekündigter Kunde hat nach dem Offboarding-Lauf keinen Agenten mehr bei ElevenLabs
- [ ] `elevenlabs_agent_id` ist geleert, die Rufnummer gelöst
- [ ] Ein Kunde mit zweitem aktivem Vertrag behält seinen Assistenten
- [ ] Ein fehlgeschlagener Löschversuch lässt die Kündigung durchlaufen und wird wiederholt
- [ ] Das Ergebnis steht im Audit-Eintrag
- [ ] `DSE_KORREKTUR_2026-08-11.md` Abschnitt 3 wird von Variante B auf **Variante A** gehoben
