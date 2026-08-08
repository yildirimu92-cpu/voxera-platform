# Etappe 6 — Umsetzungs-Briefings (S2, S3, S4, S1)

**Datum:** 08.08.2026
**Grundlage:** `docs/ASSISTENT_TAB_NORTH_STAR_2026-08-08.md` — dort steht das Zielbild und der
vollständige Ist-Zustand. Dieses Dokument enthält nur die ausführbaren Aufträge.
**Entscheidungen E1–E5:** getroffen (Abschnitt 1).
**Geltung:** jedes Briefing ist ein eigenes Claude-Code-Fenster. Max. 2 parallel.

---

## 1. Protokollierte Entscheidungen

| # | Entscheidung |
|---|---|
| **E1** | Blau `#1A6FE8` wird aufgenommen — **nicht** als fünfte Bedeutungsfamilie, sondern als eigene Kategorie **„interaktiv"** (Links, Fokusring, Toggles, Hover). Begründung: Night/Rot/Gold/Grün tragen je eine geschäftliche Bedeutung, Blau ist rein funktional. |
| **E2** | Alt-Block wird **gelöscht**, nicht weiter versteckt. |
| **E3** | Umschalter 3 → 2 als **S6**, nach den launch-kritischen Schritten. |
| **E4** | Layer 1 im Kunden-UI: **nur Kategorien** („Immer gültig", „Ihre Branche", „Von Ihnen gesetzt"), kein Prompt-Wortlaut. |
| **E5** | Ton/Anrede bleiben vorläufig **ab Business**. Preisstrategie nicht final → die Sperre muss **leicht aufhebbar** gebaut sein, nicht hart verdrahtet. |
| **E6** | Begrüssungsquelle für S2: **Weg (a)** — die effektive Begrüssung wird beim Sync zurückgeschrieben. `buildGreeting()` wird **nicht** ins Dashboard kopiert. |
| **E7** | **A1 (serverseitige Durchsetzung der Ton-Sperre) wird in S3 mitgenommen**, nicht separat ausgelagert — der Endpoint wird ohnehin angefasst. E5 bleibt davon unberührt: die Sperre bleibt über `plan_config` steuerbar. |

**Fensterzuteilung (User, 08.08.):** Fenster A startet mit **S2**, Fenster B startet mit **S4**.

---

## 2. Neue Befunde aus dem Live-Abgleich (08.08.), die die Briefings verändern

Alle vier per Datenbank- und Code-Prüfung verifiziert, nicht aus der Kommandozentrale übernommen.

**N1 — E5 ist ohne Migration und ohne Hartverdrahtung lösbar.**
`plan_config.allow_custom_tone` **existiert bereits** und steht auf `true` für Business und
Professional, `false` für Starter — also exakt die gewünschte Sperre. **Kein Code liest die
Spalte.** S3 muss sie deshalb nur auslesen, nicht erfinden. Aufheben der Sperre später =
ein `update plan_config set allow_custom_tone = true where id = 'starter'`, kein Deploy.
Ebenfalls vorhanden und ungenutzt: `allow_custom_greeting` (nur Professional),
`allow_custom_language` (nur Professional), `allow_custom_customer_type`,
`allow_personality_wizard`.

**N2 — Die Begrüssung ist bei den meisten Kunden gar nicht gespeichert.**
3 von 4 Kunden haben ein leeres `ai_greeting`; der tatsächlich verwendete Satz entsteht erst
im Prompt-Builder über `buildGreeting()`. S2 darf deshalb **nicht** einfach die Spalte
ausgeben — sonst ist das Kernelement des neuen Kopfbereichs bei drei von vier Kunden leer.
Lösungsweg siehe Briefing S2, Abschnitt „Die Begrüssungsquelle".

**N3 — Layer 2 ist befüllt, nicht leer.**
`industry_templates` enthält **19 Vorlagen**, alle mit `prompt_block`,
`default_instructions`, `default_services`, `default_booking_faq`. Der Eintrag „0 Zeilen —
grösste konkrete Lücke" im Tab „Masterassistent" ist überholt. Die echte Lücke: nur 1 von 4
Kunden hat `industry_template_id` gesetzt. Betrifft S5 (Formulierung) und den separaten
Auftrag A3.

**N4 — Der Master-Prompt enthält keine Layer-Platzhalter.**
`system_config.prompt_master_l1` ist 9'140 Zeichen lang, enthält aber weder
`{{INDUSTRY_LAYER}}` noch `{{CUSTOMER_LAYER}}`. Der Builder hängt beide Layer deshalb
**hinten an**. Ergebnis: Kundeneingaben stehen am Ende des Prompts, in der Rezenz-Position —
genau umgekehrt zur Absicht des „kritischen Prinzips" (Layer-1-Leitplanken dürfen von
Layer 3 nicht unterlaufen werden). Direkter Bezug zu P2-11. **Nicht Teil von Etappe 6**,
siehe separater Auftrag A2.

**N5 — S1 löscht den einzigen Einreichpfad für KI-Änderungsanfragen.**
`customer-runtime-case-intake.js:112` überschreibt `window.submitAssistentChange` mit einer
sauberen Variante über `ai-change-request-create`, bindet aber an `#assistent-change-msg`
und `#assistent-change-btn` — beide liegen **im Alt-Block**. Wird der Block gelöscht, gibt
es keinen Kunden-Einstieg mehr in `ai_change_requests`, und das KI-Änderungsanfragen-Panel
im Admin-Portal bekommt keine Eingänge mehr. **S4 muss diesen Pfad neu verankern, bevor S1
läuft.** (Die direkte `_sb.from('ai_change_requests').insert(...)`-Variante in `index.html`
ist durch die Überschreibung totes Recht und verschwindet mit S1 ersatzlos — gut so.)

**N6 — Die Weiterleitungs-Selbstbearbeitung ist heute schon halb wirkungslos.**
`canEditForwarding = planCode === 'professional'` ist serverseitig durchgesetzt. Gespeicherte
Weiterleitungsänderungen landen aber nur in der Datenbank: `sync_status` wird
`skipped_forwarding_only`, der Prompt wird nicht neu gebaut. Der Agent erfährt die Änderung
erst beim nächsten, unabhängig ausgelösten Sync — also zu einem nicht vorhersagbaren
Zeitpunkt. Das entwertet die Funktion, die S1 löschen würde, erheblich und stützt die
Entscheidung, in S4 auf **read-only + Änderung melden** zu gehen.

**N7 — Eine gespeicherte Begrüssung überlebt die Umbenennung des Assistenten.**
Aufgefallen bei der Vorbereitung der S2-Verifikation am einzigen Kunden mit Agent
(`E2E Test AG`): `assistant_name` ist **Umut**, die gespeicherte `ai_greeting` lautet aber
weiterhin „Grüezi, hier ist **Lara** von E2E Test AG. …". `buildPromptV2` bevorzugt
`ai_greeting` gegenüber `buildGreeting()` — der Agent begrüsst Anrufende also mit einem
Namen, den der Assistent nicht mehr trägt. Mit dem echten Builder gegen die echten Felder
nachgerechnet: gespeichert ergibt „Lara", neu erzeugt würde „Umut" herauskommen.

Das ist **dieselbe Fehlerklasse wie der Avatar-Initialen-Fund auf dem Heute-Screen**: eine
Umbenennung zieht in den lebenden Pfaden mit, nicht aber in einem eingefrorenen, früher
erzeugten Wert — hier allerdings an der Stelle, die Anrufende tatsächlich hören.

**Auswirkung auf S2:** keine Korrektur nötig, im Gegenteil. Der Kopfbereich wird nach dem
Deploy genau diesen Satz zeigen, prominent und in Serife. Das ist die Funktion, die
arbeitet — sie macht eine bislang unsichtbare Dateninkonsistenz sichtbar. Wer den Screen
prüft, sollte es aber wissen, sonst wirkt es wie ein Fehler in S2. Behebung siehe A4.

---

## 3. Reihenfolge und Fensterplanung

Aus E5 und N5 ergibt sich eine strengere Abhängigkeitskette als im Konzept angenommen.
**Die S-Nummern bleiben unverändert** (sie sind im Konzept und in der Kommandozentrale
referenziert) — nur die Ausführungsreihenfolge weicht ab:

```
Fenster A:   S2  ──→  S3            (S3 setzt den Kopfbereich aus S2 voraus)
Fenster B:   S4                     (unabhängig, parallel zu A)
                  ↓        ↓
             beide gemergt
                  ↓
Danach:      S1                     (allein, zuletzt)
```

**Warum S1 zuletzt:** S1 löscht in einem Zug die Ton/Anrede-Editoren (braucht S3 als Ersatz),
den Weiterleitungs- und Notfall-Block (braucht S4) und den Einreichpfad für
KI-Änderungsanfragen (braucht S4, siehe N5). Läuft S1 früher, entstehen drei gleichzeitige
Funktionslücken im Produktivsystem.

**S5–S7 folgen nach dem Launch** und sind hier nur als Kurzfassung enthalten (Abschnitt 8).

---

## 4. Briefing S2 — Kopfbereich „So meldet sich Ihr Assistent"

**Modell/Effort:** Sonnet 5, Medium. Die Architekturfrage ist mit E6 entschieden.
**Vorbedingung:** keine. **Fenster A — kann sofort starten.**
**Behebt:** F1 (Begrüssung unsichtbar), F8 (keine Serifen-Typografie), und nimmt der
verwaisten Karte inhaltlich den Platz weg.

### Auftrag

Baue in der Assistent-Ansicht (`vx-assistant-profile-body`, gerendert von
`shared/customer-runtime-assistant-profile.js` → `renderAssistant()`) einen neuen
**ersten Block** oberhalb der Stimme-Karte:

1. **Begrüssungssatz** — der Satz, mit dem sich der Assistent bei Anrufenden meldet, gesetzt
   in der Stimmenrolle. Das ist das visuelle Zentrum des Screens.
   Kein Avatar-Kreis, keine Initiale — bewusst nicht.
   > **Zurückgenommen am 2026-08-08:** hier stand ursprünglich `var(--vx-font-serif)`
   > (Newsreader). Das Produkt ist jetzt durchgehend Sans; die Stimme trägt
   > `--vx-ui-voice-*` (20px/500). Siehe `SANS_STIMMENROLLE_2026-08-08.md`.
2. **Meta-Zeile** in Sans: `Stimme <Name> · <Sie-/Du-Form> · <Ton in Klartext>` plus
   Button „Anhören" (die bestehende `data-vx-preview`-Verdrahtung wiederverwenden, nicht
   neu bauen).
3. **Eine Statuszeile** im Executive-Brief-Ton. Normalfall: ein ruhiger Satz. Bei Abweichung:
   die Abweichung im Klartext. Datenquelle bleibt `technical_status` aus
   `customer-assistant-profile`. „Technische Details" erscheint **nur bei Abweichung**.

### Die Begrüssungsquelle — entschieden (E6): Rückschreiben beim Sync

`buildGreeting()` wird **nicht** ins Dashboard kopiert. Stattdessen persistiert der Sync den
Satz, den der Agent tatsächlich bekommen hat, und das Dashboard liest genau dieses Feld.
Damit ist Drift per Konstruktion ausgeschlossen.

**Umsetzung in drei Teilen:**

1. **Neue Spalte** `customers.ai_effective_greeting` (text, nullable). Migrationsdatei unter
   `supabase/sql/` anlegen, Namensschema der bestehenden Dateien übernehmen. Die Spalte ist
   **abgeleitet, nie vom Menschen editiert** — das gehört als Kommentar in die Migration.
   `customers.ai_greeting` (die frei gewählte Begrüssung des Kunden) bleibt unverändert und
   wird **nicht** überschrieben.
2. **Rückschreiben im Sync.** `admin-panel/netlify/functions/trigger-elevenlabs-sync.js`
   erhält `firstMessage` bereits aus `buildPromptV2()`. Nach **erfolgreichem** Sync den Wert
   in `ai_effective_greeting` schreiben. Zwei Regeln: nur bei Erfolg schreiben (ein
   fehlgeschlagener Sync darf keinen Satz behaupten, den der Agent nie erhalten hat), und
   das Rückschreiben darf den Sync nicht zum Scheitern bringen — Fehler beim Persistieren
   protokollieren, nicht werfen. `prompt-preview.js` schreibt **nichts** zurück, das ist
   eine Vorschau.
3. **Anzeige-Reihenfolge im Dashboard:**
   `ai_effective_greeting` → sonst `ai_greeting` → sonst Platzhalter.

**Der Platzhalterfall ist heute der Normalfall und muss ordentlich aussehen:** Nur 1 von 4
Kunden hat überhaupt einen `elevenlabs_agent_id`, bei den übrigen lief nie ein Sync. Für sie
bleibt `ai_effective_greeting` leer. Der Kopfbereich sagt dann ehrlich, dass der Satz
entsteht, sobald der Assistent aktiviert ist — kein leerer Kasten, kein erfundener
Beispielsatz. `technical_status.assistant` liefert die Information, ob ein Agent existiert.

`customer-assistant-profile.js` liefert entsprechend
`greeting: { text, source: 'effective' | 'custom' | 'none' }` — die UI trifft keine eigene
Herleitung.

### Akzeptanzkriterien

- Der Begrüssungssatz ist auf dem Assistent-Screen sichtbar, in Serife, und stimmt mit dem
  überein, was der Agent tatsächlich verwendet.
- Nach einem erfolgreichen Sync steht der Satz in `ai_effective_greeting` und erscheint im
  Dashboard. **End-to-End geprüft** am einzigen Kunden mit Agent, nicht nur unit-getestet.
- Ein fehlgeschlagener Sync hinterlässt **keinen** Wert in `ai_effective_greeting`.
- Für Kunden ohne Agent zeigt der Kopfbereich den ehrlichen Platzhalter, keinen Beispielsatz.
- Genau **eine** Statuszeile auf dem Screen. Die alte Betriebsstatus-Zusammenfassung ist in
  den Kopfbereich aufgegangen, nicht dupliziert.
- „Anhören" funktioniert wie vorher; keine zweite Preview-Implementierung.
- Keine linken Akzentkanten (Heute-Screen-Layoutkritik nicht wiederholen).
- Kanonische Card-Tokens, kein Sonderradius.
- Mobil geprüft: Der Begrüssungssatz darf nicht abgeschnitten werden.

### Nicht-Ziele

Begrüssung editierbar machen (`allow_custom_greeting` ist Professional-only und ungenutzt —
eigenes Thema). Avatar oder Initiale in irgendeiner Form. Alt-Block anfassen — das ist S1.

### Dateien

`shared/customer-runtime-assistant-profile.js` (`renderAssistant`),
`shared/customer-assistant-components.css`,
`netlify/functions/customer-assistant-profile.js` (Feld `greeting` ergänzen),
`admin-panel/netlify/functions/trigger-elevenlabs-sync.js` (Rückschreiben),
neue Migrationsdatei unter `supabase/sql/`.

---

## 5. Briefing S3 — Ton & Anrede wieder editierbar

**Modell/Effort:** Sonnet 5, Medium.
**Vorbedingung:** S2 gemergt (der Editor sitzt im Kopfbereich). **Fenster A, direkt nach S2.**
**Behebt:** F2 (Funktionsverlust), setzt E5 um, **enthält A1** (E7).

### Auftrag

Mache **Anrede** (`ai_address_form`: Sie/Du) und **Tonalität** (`ai_tone`:
warm-professionell / konservativ-formell / locker und direkt) im Kopfbereich aus S2 wieder
bearbeitbar.

**Plan-Sperre gemäss E5 — so und nicht anders:**

1. `netlify/functions/customer-assistant-profile.js` liefert in `permissions` ein neues Feld
   `can_change_tone`, gespeist **ausschliesslich** aus `plan_config.allow_custom_tone`
   (Spalte existiert bereits, siehe N1 — nicht neu anlegen, nicht aus `plan_code` ableiten).
2. Das Frontend liest **nur** `permissions.can_change_tone`. Kein Plan-Name irgendwo im
   UI-Code. Kein `planCode === 'business'`-Vergleich.
3. Ist die Sperre aktiv: Werte weiterhin lesbar anzeigen + Gold-Hinweis „ab Business"
   (Gold ist laut Tokenset die Plan-/Badge-Farbe, konsistent mit dem bestehenden
   `.plan-badge`). Nicht ausgrauen und nicht verstecken.

Damit ist das Aufheben der Sperre später ein einzelnes DB-Update ohne Deploy — genau die
Anforderung aus E5.

**Serverseitige Durchsetzung (A1, per E7 hier integriert):**

4. `netlify/functions/customer-update-assistant.js` weist `ai_tone` zurück, wenn
   `plan_config.allow_custom_tone` für den Plan des Aufrufers `false` ist — **exakt nach dem
   Muster der bestehenden Prüfungen** für `assistant_name` (`allow_custom_assistant_name`)
   und `voice_id` (`voice_selection_enabled`), inklusive derselben Fehlerstruktur:
   `403` mit `errors: ['tone_not_allowed_on_plan']` über `buildContractPayload`.
   Der Plan-Code wird dort bereits geladen — es kommt keine zusätzliche Abfrage dazu.

**Wichtig:** `ai_address_form` (Sie/Du) ist von der Sperre **nicht** betroffen. E5 spricht von
Ton/Anrede als Paket, aber `allow_custom_tone` meint die Tonalität. Die Anrede bleibt für alle
Pläne frei — sie ist eine Grundhöflichkeitsentscheidung, kein Premium-Merkmal. Falls das
anders gewollt ist: vor Start des Fensters sagen, es wäre eine zweite `plan_config`-Spalte.

**Bestätigungsschleife:** Nach erfolgreichem Speichern spiegelt der Kopfbereich das Ergebnis
zurück — der Begrüssungs- bzw. Auftrittsblock aktualisiert sich sichtbar („so klingt Ihr
Assistent jetzt"). Keine Erfolgsmeldung ohne sichtbare Wirkung.

**Speicherverhalten** nach den Interaktions-Richtlinien aus Etappe 3: optimistisches Update,
Button während der Aktion deaktivieren statt ausblenden, bei Fehler Zustand zurückrollen +
Toast im Klartext.

### Akzeptanzkriterien

- Business-/Professional-Konto kann Anrede und Ton ändern; die Änderung ist nach dem
  Speichern im Kopfbereich sichtbar.
- Starter-Konto sieht beide Werte, kann sie nicht ändern, und sieht den Gold-Hinweis.
- Ein Umstellen von `plan_config.allow_custom_tone` auf `true` für `starter` schaltet die
  Bearbeitung frei — **ohne Code-Änderung**. Ist explizit zu testen, und zwar auf beiden
  Ebenen: UI **und** Endpoint.
- Im gesamten neuen UI-Code kommt kein Plan-Name als String vor.
- **A1:** Ein direkter POST auf `customer-update-assistant` mit `ai_tone` von einem
  Starter-Konto wird mit `403` und `tone_not_allowed_on_plan` abgewiesen. Ohne diesen Test
  gilt A1 als nicht erledigt — genau das war der Mangel am bisherigen Zustand.
- `ai_address_form` bleibt für alle Pläne änderbar, auch per direktem POST.

### Nicht-Ziele

Begrüssung editierbar machen. Weitere ungenutzte `plan_config`-Spalten
(`allow_custom_language`, `allow_personality_wizard`, `allow_custom_customer_type`)
verdrahten — die haben eigene Produktfragen und gehören nicht in dieses Fenster.

### Dateien

`netlify/functions/customer-assistant-profile.js`,
`netlify/functions/customer-update-assistant.js` (A1),
`shared/customer-runtime-assistant-profile.js`,
`shared/customer-assistant-components.css`.

---

## 6. Briefing S4 — „Wenn es dringend wird" + Änderungsanfrage-Kanal

**Modell/Effort:** Sonnet 5, Medium.
**Vorbedingung:** keine. **Fenster B — kann sofort starten**, parallel zu Fenster A; berührt
andere Karten. Einzige Überschneidung mit S2/S3: `customer-assistant-profile.js` und
`customer-runtime-assistant-profile.js` werden von beiden Fenstern erweitert — beim Rebasen
mit Konflikten in diesen zwei Dateien rechnen und sie bewusst auflösen, nicht blind
übernehmen (dasselbe Vorgehen wie beim Rebase-Konflikt-Check von PR #826 auf #827).
**Behebt:** F3 (Weiterleitung/Notfall unsichtbar) und sichert N5 (Einreichpfad) ab.
**Kritisch:** Dieses Briefing ist die Voraussetzung dafür, dass S1 überhaupt laufen darf.

### Auftrag, Teil 1 — Dringlichkeits-Block

Neue Karte in der Assistent-Ansicht, unterhalb der Fähigkeiten: **read-only** für alle Pläne.

- Notfallnummer (`ai_emergency_number`, Default 144) — in Rot, das ist die einzige
  legitime Rot-Verwendung auf diesem Screen.
- Weiterleitungsziel 1 und 2 mit Bezeichnung, Nummer und Auslöser, sofern konfiguriert.
- Ein Satz, der die tatsächliche Regel erklärt: Änderungen an Weiterleitung und Notfall
  bestätigt Voxera vor der Aktivierung.
- Ist nichts konfiguriert: Empty-State aus dem Etappe-1-Bausteinsatz, kein leerer Kasten.

Die nötigen Felder liefert `customer-assistant-profile` heute **nicht** — sie sind zu
ergänzen (`ai_forwarding_1/2_name|number|trigger`, `ai_emergency_number`).

**Bewusst read-only, auch für Professional.** Begründung in N6: Die heutige
Selbstbearbeitung schreibt in die Datenbank, synchronisiert den Prompt aber nicht — die
Änderung erreicht den Agenten erst bei einem späteren, unabhängigen Sync. Eine Funktion, die
scheinbar sofort wirkt und es nicht tut, ist schlechter als ein sauberer Meldeweg. Ein
verlässlicher Selbstbedienungs-Pfad wäre ein eigener Auftrag inklusive Sync-Auslösung.

### Auftrag, Teil 2 — Änderungsanfrage-Kanal neu verankern

Der Kanal in `ai_change_requests` muss den Löschvorgang in S1 überleben (N5).

- Button „Änderung melden" im Dringlichkeits-Block **und** ein allgemeiner Einstieg für die
  vier bekannten Anliegen (Branche wechseln, Weiterleitung einrichten, Individuelle
  Anpassung, Sonstiges).
- Absenden **ausschliesslich** über `authPost('ai-change-request-create', { message })` —
  also über den bestehenden, authentifizierten Pfad in
  `shared/customer-runtime-case-intake.js`. **Kein** direkter Supabase-Insert aus dem
  Browser; die alte Variante in `index.html` wird nicht mitgenommen.
- `customer-runtime-case-intake.js` bindet heute an `#assistent-change-msg` /
  `#assistent-change-btn`. Entweder die neuen Elemente tragen dieselben IDs, oder die
  Bindung wird sauber auf die neuen Knoten umgezogen. Beides ist zulässig — aber es muss
  **eine** Bindung sein, keine zweite parallele Implementierung.

### Akzeptanzkriterien

- Notfallnummer und beide Weiterleitungsziele sind auf dem Assistent-Screen sichtbar,
  in allen Plänen, ohne Bearbeitungsmöglichkeit.
- Eine Änderungsanfrage aus dem neuen UI erzeugt eine Zeile in `ai_change_requests` mit
  korrekter `customer_id` und erscheint im Admin-Portal. **End-to-End getestet, nicht nur
  „Request ging raus".**
- `ai-change-notify` wird weiterhin ausgelöst (Make-Benachrichtigung bricht nicht ab).
- Rot erscheint auf diesem Screen ausschliesslich an der Notfallnummer.

### Nicht-Ziele

Weiterleitungen editierbar machen. Rufumleitung anfassen — die lebt in den Einstellungen
(`mehr-sub-rufumleitung`) und bleibt dort.

### Dateien

`netlify/functions/customer-assistant-profile.js`,
`shared/customer-runtime-assistant-profile.js`,
`shared/customer-runtime-case-intake.js`,
`shared/customer-assistant-components.css`.

---

## 7. Briefing S1 — Alt-Block löschen

**Modell/Effort:** Sonnet 5, Medium — **aber mit eigenem Abgrenzungs-Pass vorab**, nach dem
Muster der Etappe-4-Legacy-Löschung (`docs/CUSTOMER_REQUEST_DETAIL_CONSOLIDATION_2026-08-07.md`).
**Vorbedingung: S2, S3 und S4 sind gemergt und live verifiziert.** Ohne das nicht starten.
**Behebt:** die verwaiste Karte an der Wurzel, plus die Ausblendregel, die sie nicht erwischt hat.

### Auftrag

Entferne den Alt-Screen aus `#tab-assistent` vollständig — Markup, CSS und die nur von dort
erreichbaren Funktionen.

**Bekannter Umfang** (Grössenordnung; die exakte Abgrenzung ist Teil des Auftrags, nicht
Vorgabe):

| Was | Wo |
|---|---|
| Markup Alt-Screen inkl. verwaister Karte | `customer-dashboard/index.html:7978–8303` |
| CSS Alt-Screen | `customer-dashboard/index.html:~5656–5901` |
| Toter Name/Avatar-Updater | `customer-dashboard/index.html:14505–14516` (bricht an `assistent-requests-list` ab, Element existiert nicht mehr) |
| Alt-Funktionen | `index.html:14884–16660`, verstreut: `vxToggleAcc`, `vxiEdit/Cancel/Save`, `vxrEdit/Cancel/Save`, `vxFillAccordionRead`, `vxPendingPreview`, `vxPendingGoLive`, `vxSaveSection`, `prefillAssistentChange`, `submitAssistentChange` (die `index.html`-Variante), `vxInitRufumleitung_old` |
| Ausblendregel, danach überflüssig | `shared/customer-assistant-components.css:829` |

**Vorgehen — verbindlich:**

1. **Erst Abgrenzung, dann Löschung.** Für jede Funktion und jede CSS-Regel nachweisen, dass
   sie ausserhalb des Alt-Blocks keinen Aufrufer mehr hat. Ergebnis vorlegen, bevor gelöscht
   wird. Mehrere dieser Funktionen werden auch von anderen Screens verwendet
   (`vxInitRufumleitung` z.B. dient auch `mehr-sub-rufumleitung`) — diese bleiben.
2. **Die Ausblendregel entfernen.** Nach der Löschung hat `#tab-assistent` nur noch die drei
   verwalteten Kinder; die `:not()`-Kette ist wirkungslos und tarnt künftige Fehler.
3. **Nach der Löschung prüfen, ob `#tab-assistent` überhaupt noch statisches Markup
   braucht** — der Screen wird vollständig zur Laufzeit zusammengesetzt.

### Akzeptanzkriterien

- Keine verwaiste Karte mehr vor der Fusszeile — und zwar weil das Element weg ist, nicht
  weil es versteckt wird.
- Kein Verlust: Ton/Anrede (S3), Weiterleitung/Notfall (S4), Änderungsanfragen (S4) und
  Rufumleitung (Einstellungen) funktionieren nachweislich weiter. **Auf der Produktions-Domain
  verifiziert, nicht nur lokal.**
- Keine Konsolenfehler beim Öffnen des Assistent-Tabs und beim Wechsel zwischen allen
  Unterbereichen.
- Der Abgrenzungs-Nachweis aus Schritt 1 liegt dem PR bei.

### Nicht-Ziele

Neue Funktionalität. Wenn beim Löschen etwas fehlt, ist das ein Fund für ein Folge-Briefing —
nicht Anlass, im Lösch-PR nachzubauen.

---

## 8. S5–S7 — Kurzfassung, nach dem Launch

| Schritt | Auftrag in einem Satz | Anpassung aus dem Live-Abgleich |
|---|---|---|
| **S5** | Layer-Sichtbarkeit: „Immer gültig — von Voxera gesetzt" / „Ihre Branche" / „Von Ihnen gesetzt", nur Kategorien (E4). | **Wichtig:** 19 befüllte Branchenvorlagen existieren (N3). Der Text lautet also nicht „keine Vorlage vorhanden", sondern nennt die zugeordnete Branche — und sagt bei fehlender `industry_template_id` genau das. |
| **S6** | Aktuelle Infos als Band unter dem Kopfbereich, Umschalter 3 → 2 (E3). | — |
| **S7** | Doppelte Karten-Logik entwirren (F5): eine Stelle rendert Fähigkeiten und Betriebsstatus. `simplifyTechnicalStatus()` ist bereits wirkungslos, `simplifyCapabilities()` entfernt per MutationObserver einen Umschalter, den das Nachbarmodul gerade erzeugt hat. | S2 fasst den Betriebsstatus ohnehin an — prüfen, ob S7 dadurch kleiner wird. |

---

## 9. Ausserhalb Etappe 6 — drei separate Aufträge

Diese gehören **nicht** in die Design-Etappe, sind aber während der Bestandsaufnahme
aufgefallen und sollten eigene Einträge bekommen.

| # | Auftrag | Dringlichkeit |
|---|---|---|
| ~~A1~~ | **In S3 aufgegangen** (E7). Nummer bleibt vergeben, damit Querverweise gültig bleiben. | erledigt mit S3 |
| **A2** | **Layer-Reihenfolge im Master-Prompt (N4).** `prompt_master_l1` enthält keine Platzhalter, deshalb landen Kundeneingaben am Prompt-Ende — gegenteilig zur Absicht der Leitplanken-Priorität. Entweder Platzhalter in Layer 1 ergänzen oder den Builder die Position erzwingen lassen. **Direkter Bezug zu Sicherheitspunkt P2-11.** | Hoch — Sicherheitsthema, Opus 5 / Hoch |
| **A4** | **Eingefrorene Begrüssung nach Umbenennung (N7).** `ai_greeting` behält den alten Assistentennamen und schlägt `buildGreeting()`. Zu entscheiden: automatisch neu erzeugen, sobald `assistant_name` sich ändert und die Begrüssung nie manuell bearbeitet wurde — oder dem Kunden die Abweichung anzeigen und die Neuerzeugung anbieten. Gehört fachlich zum Avatar-Initialen-Fix, der bereits als eigenes Briefing wartet. | Mittel — betrifft, was Anrufende hören |
| **A3** | **Branchenzuordnung nachziehen (N3).** 19 fertige Vorlagen, aber nur 1 von 4 Kunden hat `industry_template_id`. Die übrigen laufen ohne Branchen-Layer, obwohl eine passende Vorlage bereitliegt. Betriebs-, kein Code-Thema. | Mittel — schneller Qualitätsgewinn ohne Entwicklung |

---

## 10. Nachträge für die Kommandozentrale

- **Tab „Masterassistent"** — zwei Korrekturen: Prompt-Architektur ist geklärt (Funktionsnamen
  `buildPromptV2()`/`buildGreeting()`, Layer-Quellen); **und `industry_templates` hat 19
  befüllte Vorlagen, nicht 0** — der Satz „grösste konkrete Lücke in diesem Bereich" gilt so
  nicht mehr, die Lücke ist die Zuordnung.
- **Tab „Sicherheit"/P2-11** — A2 als verknüpften Punkt aufnehmen.
- **Tab „Design-System"** — E1 nachtragen: vier Bedeutungsfamilien plus eine funktionale
  Kategorie „interaktiv" (Blau).
- **Tab „Fahrplan"/Etappe 6** — Status auf „Konzept entschieden, Briefings geschnitten",
  Ausführungsreihenfolge S2 → S3 → S4 → S1 vermerken.
- **Tab „Offene Entscheidungen"** — E1–E7 nach „entschieden" verschieben. Für Etappe 6 ist
  damit **keine Konzeptfrage mehr offen**; beide Fenster können ohne Rückfragen starten.
- **Tab „Datenbank & Architektur"** — neue Spalte `customers.ai_effective_greeting`
  (abgeleitet, wird vom Sync geschrieben, nie manuell gepflegt) nachtragen, sobald S2 gemergt
  ist. Ebenso vermerken, dass `plan_config.allow_custom_tone` ab S3 aktiv gelesen **und**
  serverseitig durchgesetzt wird — Freischalten für Starter ist danach ein reines DB-Update.
