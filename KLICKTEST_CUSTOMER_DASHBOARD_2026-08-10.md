# Klick-Test Customer Dashboard — vollständige Bestandsaufnahme

**Datum:** 10.08.2026 · **Modus:** Diagnose, keine Änderung am Produktcode
**Umfang:** neun Etappen, zwei Breakpoints (1280 px / 390 px), echter Browser (Chromium),
echte Produktionsdaten (Lese-Snapshot), echte Netlify-Funktionen, unveränderte Repo-Dateien.

---

## 0. Antwort in fünf Sätzen

Eine der neun Etappen — **„Aktuelle Infos"** — ist im Browser **überhaupt nicht erreichbar**: die Seite
existiert, lädt echte Daten und rendert korrekt, aber es gibt weder auf Desktop noch auf Mobile ein
klickbares Element, das dorthin führt; zwei andere Screens verweisen im Fliesstext auf sie. Der zweite
belegte Fehler mit Datenfolge steckt in der **Kalenderintegration**: sobald eine Verbindung
`reauthorization_required` meldet, verliert das Feld „Aktiver Anbieter" den gespeicherten Wert und ein
Klick auf „Einstellungen speichern" schreibt `active_provider = null` zurück. Darunter liegen vier
Befunde der Kategorie „sollte", darunter zwei sichtbare Widersprüche (nachts „Guten Morgen", und
Öffnungszeiten, die im Geschäftsprofil „geschlossen" und im Kalender „Mo–Fr 08:00–17:00" lauten).
Vieles funktionierte dagegen sauber — Stimmenwechsel, Onboarding, Filter, Leerzustände, Mobile-Layout,
Fehlermeldungen — das ist in Abschnitt 4 einzeln aufgeführt, weil es für die Abnahme genauso zählt.
Was **nicht** beurteilt werden konnte, steht in Abschnitt 5; die Sandbox hat keinen Netzzugang ausser
GitHub, damit fielen ElevenLabs, Google und Supabase-Realtime aus.

---

## 1. Wie getestet wurde (und was das für die Aussagekraft heisst)

Die Sandbox erreicht weder `voxera-dashboard.netlify.app` noch `*.supabase.co` — der Proxy beantwortet
jedes CONNECT mit 403. Ein Klick-Test gegen die Live-Umgebung war deshalb ausgeschlossen. Statt am Code
zu lesen, wurde die Anwendung lokal in einen Zustand gebracht, der dem echten so nah wie möglich kommt:

| Bestandteil | Im Test |
|---|---|
| `index.html`, `shared/*.js`, `shared/*.css` | **unverändert** aus dem Repo ausgeliefert |
| Netlify-Funktionen | **die echten Module** des Repos, in einem lokalen Node-Server ausgeführt |
| Datenbank | **Lese-Snapshot der Produktion** (nur `SELECT`): Kunde `E2E Test AG`, 18 Anrufe, 16 Benachrichtigungen, Vertrag, Abo, Kalendereinstellungen, `plan_config`, `industry_templates`, `system_config.core_field_steps` |
| Supabase-API | lokaler Nachbau von `/auth/v1` und `/rest/v1` (PostgREST-Teilmenge) über diesem Snapshot |
| Schriften und Icons | lokal ausgeliefert statt CDN — sonst hätten die Icons null Grösse und der Test würde Klickziele fälschlich als „nicht vorhanden" melden |
| Leerzustand | zweiter echter Auth-Nutzer auf den leeren Kunden `E2E 2 Test AG` gezeigt (nur lokal, DB unberührt) |

An der Produktionsdatenbank wurde **nichts geschrieben**. Alle Screenshots stammen aus diesem Aufbau.
Wo ein Befund von der Umgebung abhängt, steht das beim Befund dabei.

**Zwei Fehlalarme wurden vor der Aufnahme in diese Liste ausgeräumt** und sind hier nur erwähnt, damit sie
nicht erneut gemeldet werden: das Anfragen-Detail wirkte auf Mobile so, als liefe die Liste darunter
weiter (Artefakt der `fullPage`-Aufnahme; es ist ein korrektes Vollbild-Overlay), und das Geschäftsprofil
wirkte leer (fehlende `system_config`/`industry_templates` in der Testumgebung, nicht im Produkt).

---

## 2. Kritisch

### K1 · Etappe 8 „Aktuelle Infos" hat keinen Einstieg — Desktop wie Mobile

**Beobachtung.** Nach dem Besuch aller fünf Hauptbereiche enthält das gesamte Dokument **kein einziges
klickbares Element** mit dem Text „Aktuelle Infos" oder „Betriebsinfo" — geprüft auf 1280 px und 390 px.
Gleichzeitig gilt:

- Die Seite existiert im DOM (`#mehr-sub-betriebsinfos`) und die Öffner-Funktion ist geladen
  (`window.vxOperationalUpdatesOpen` ist eine Funktion).
- Ruft man sie von Hand auf, lädt sie die echten Daten und rendert korrekt — der reale Eintrag
  „Geänderte Öffnungszeiten / Zurückgezogen" erscheint mit allen Regelzeilen. Sichtbar wird die Seite
  trotzdem nicht: sie wird nur über `applyAssistantView('updates')` eingeblendet, und diesen Weg löst
  nichts aus.
- `shared/customer-runtime-unified-navigation.js:35` führt sie als dritte Assistent-Ansicht
  (`{ key: 'updates', pageId: 'mehr-sub-betriebsinfos', label: 'Aktuelle Infos' }`),
  `triggerViewLoad()` (`:239`) kennt den Fall — aufgerufen wird er nie.

**Warum das mehr als ein fehlender Knopf ist.** Zwei andere Screens schicken den Kunden aktiv dorthin:

- Assistent → Geschäftsprofil, Einleitungstext: *„Ferien und kurzfristige Änderungen gehören in
  ‚Aktuelle Infos'."* — und zweimal derselbe Hinweis an den Öffnungszeiten.
- Einstellungen → Hilfe, FAQ: *„Was passiert bei Ferien? Feiertage & Ferien-Modus kommt bald —
  kontaktieren Sie uns für eine manuelle Anpassung."* Die Funktion ist gebaut, die Hilfe kündigt sie als
  Zukunft an, und der Weg dorthin fehlt.

**Einschätzung.** Funktional, nicht kosmetisch. Eine fertige Etappe ist für den Kunden nicht vorhanden.
Muster: wie der ehemals unerreichbare Hilfe-Screen — gebaut, verdrahtet, nicht verlinkt.
*Screenshot: `e8-aktuelle-infos-direkt-desktop.png` (Seite von Hand geöffnet).*

---

### K2 · Kalender: „Aktiver Anbieter" fällt auf „Nicht aktiv" und wird beim Speichern genullt

**Beobachtung.** In der Datenbank steht `calendar_settings.active_provider = 'google'`, und die Funktion
`calendar-connections` liefert diesen Wert auch aus. Die Oberfläche zeigt trotzdem **„Nicht aktiv"**, und
die Auswahlliste enthält *nur* diesen einen Eintrag:

```
<select id="vx-cal-active-provider"><option value="">Nicht aktiv</option></select>   // value = ""
```

**Ursache, im Code belegt.** `shared/customer-runtime-calendar-settings.js:135` baut die Optionen
ausschliesslich aus Verbindungen mit `status === 'connected'`:

```js
const connectedProviders = (state.connections || []).filter((item) => item.status === 'connected');
const activeOptions = connectedProviders.map(item => '<option …' + (settings.active_provider === item.provider ? ' selected' : '') …);
```

Meldet die Verbindung `reauthorization_required`, ist die Liste leer — der gespeicherte Wert hat keine
Option mehr, in der er stehen könnte. Und `:240` liest beim Speichern genau dieses Feld:

```js
active_provider: document.getElementById('vx-cal-active-provider')?.value || null,
```

**Folge.** Ein Kunde, dessen Google-Autorisierung erneuert werden muss, öffnet die Kalenderseite, ändert
dort irgendetwas Harmloses (Termindauer, Puffer) und schaltet mit „Einstellungen speichern" unbemerkt den
aktiven Anbieter ab. Das ist ein stiller Schreibvorgang gegen den gespeicherten Zustand.

**Ehrliche Einordnung des Auslösers.** Im Testlauf entstand `reauthorization_required`, weil Google aus
der Sandbox nicht erreichbar ist. Der Zustand selbst ist aber ein regulärer Produktionszustand (abgelaufenes
oder entzogenes Refresh-Token), und der beschriebene Code-Pfad hängt nicht von der Sandbox ab.
*Screenshot: `e6-kalender-desktop.png`.*

---

## 3. Sollte

### S1 · Zwei Begrüssungen, die sichtbare ist nachts falsch
Um 01:39 Uhr (Europe/Zurich) steht auf „Heute" **„Guten Morgen, Umut"**. Es gibt zwei Berechnungen:

| Ort | Regel | Ergebnis 01:39 |
|---|---|---|
| `getTimeBasedGreeting()` — `index.html:15935` | 5–12 Morgen · 12–14 Mittag · 14–18 Nachmittag · sonst Abend | „Guten Abend" ✔ |
| inline in `renderDashboard()` — `index.html:21241` | `hour < 12 ? 'Guten Morgen' : hour < 18 ? 'Guten Nachmittag' : 'Guten Abend'` | „Guten Morgen" ✘ |

Die **falsche** Variante ist die sichtbare (`span.vx-greeting-lead`). Das Element mit der richtigen
(`#greeting-main`) wird weiterhin befüllt, ist aber unsichtbar — eine Leiche mit gepflegtem Inhalt.
Nebeneffekt: „Guten Mittag" existiert nur in der unsichtbaren Variante und erreicht nie einen Kunden.
Muster: zwei Handler für dieselbe Entscheidung. *Screenshot: `e1-heute-desktop.png`.*

### S2 · Bericht zeigt Kategorien als Rohwerte aus der Datenbank
Im Abschnitt „Kategorien" stehen `inbound`, `rueckrufanfrage`, `sonstiges`, `informationsanfrage`,
`terminanfrage` — kleingeschrieben, technisch. Zwei Karten darüber ist dieselbe Information sauber
beschriftet: „Top Kategorie · Eingehender Anruf". Es gibt also eine Beschriftungsfunktion, die an einer
von zwei Stellen nicht angewendet wird. *Screenshot: `e4-bericht-Gesamt-desktop.png`.*

### S3 · Öffnungszeiten werden an zwei Stellen geführt und widersprechen sich
| Ort | Inhalt |
|---|---|
| Assistent → Geschäftsprofil, „Reguläre Öffnungszeiten" (`customers.ai_opening_hours` = NULL) | Montag bis Freitag **geschlossen**, Samstag geschlossen, Sonntag geschlossen |
| Einstellungen → Kalender, Buchungsregeln (`calendar_settings.business_hours`) | **Mo–Fr 08:00–17:00**, Sa/So leer |

Beide Screens gehören demselben Kunden und demselben Assistenten. In der Konsequenz nennt der Assistent
am Telefon „geschlossen" und bucht gleichzeitig Termine Mo–Fr 08–17. Ob die Trennung fachlich gewollt ist
(Auskunft vs. Buchungsfenster), ist von aussen nicht entscheidbar — dass beide Werte unabgeglichen
nebeneinanderstehen und einander widersprechen, ist es. *Screenshots: `e5-geschaeftsprofil2-desktop.png`,
`e6-kalender-desktop.png`.*

### S4 · Wochenraster: vier Zeitfelder pro Zeile ohne erkennbare Gruppierung
Jede Zeile des Öffnungszeiten-Rasters enthält vier Zeitfelder und zwei Bindestriche in gleichmässigem
Abstand: `[--:--] – [--:--]   [--:--] – [--:--]`. Dass es sich um **zwei** Zeitfenster handelt (etwa
vormittags/nachmittags), sagt weder eine Beschriftung noch ein Abstand noch ein Trenner. Das Statuswort
„geschlossen" sitzt zudem ganz am rechten Rand, weit von den Feldern entfernt. Genau dieses Raster ist
schon einmal auffällig geworden. *Screenshot: `e5-geschaeftsprofil2-desktop.png`.*

### S5 · Anfragen: Leermeldung widerspricht dem Filter direkt daneben
Filter „Nur ungelesene" bei 12 offenen, aber gelesenen Anfragen: die Liste meldet **„Keine offenen
Anfragen. Neue Anfragen erscheinen hier automatisch, sobald ein Anruf eingeht."** — während der Chip
zwei Zentimeter darüber „Offen (12)" anzeigt und ein Filterband korrekt „Filter: Nur ungelesene ·
0 Einträge" meldet. Der Leertext gehört zum Filter, nicht zum Grundbestand.
*Screenshot: `e2-nur-ungelesene-desktop.png`.*

### S6 · Anfragen-Detail: Badge „Rückruf" steht zweimal nebeneinander
Der Kopf zeigt `Offen | Rückruf | ● Warm | Rückruf`. Zwei identisch beschriftete Chips, nur unterschiedlich
hergeleitet (Kategorie `rueckrufanfrage` und Flag `callback_requested`). Auf Desktop und Mobile gleich.
Muster: wie der dreifach gerenderte Regelvorschlag. *Screenshots: `e2-detail-desktop.png`,
`m-detail-gescrollt-mobile.png`.*

---

## 4. Kosmetisch

| # | Etappe | Befund |
|---|---|---|
| Ko1 | Bericht | „1 offene Rückruf-Anfrage — **älteste ist 0 Tage alt**." |
| Ko2 | Anfragen | Drei Filter-Chips tragen einen Zähler, „Archiv" nicht |
| Ko3 | Anfragen-Detail | Bei fehlgeschlagener Audio-Ladung bleiben die grauen Ladebalken über der Meldung „Die Audioaufnahme konnte nicht geladen werden." stehen |
| Ko4 | alle, Mobile | Klickziele unter der 44-px-Empfehlung: Glocke 34×34, Filter-Chips 32 hoch, Zeilenaktionen 28 breit, „Schliessen" 22 breit |
| Ko5 | Anfragen-Detail, Mobile | Zurück-Pfeil links **und** X rechts im selben Kopfband — zwei Schliesswege nebeneinander |
| Ko6 | Bericht | „Anrufe diese Woche" zeigt ein rollierendes 7-Tage-Fenster (Di–Mo), nicht die Kalenderwoche |

---

## 5. Hier bin ich mir nicht sicher, ob es Absicht ist

1. **`follow_up_at` wird bewusst als lokale Zeit gelesen.** `parseFollowUpDate()` (`index.html:13954`)
   entfernt den Zeitzonen-Suffix; „09:00+00" wird als 09:00 Ortszeit angezeigt. `created_at` dagegen wird
   regulär nach Europe/Zurich umgerechnet (21:49 UTC → „23:49"). Zwei Zeitkonventionen in derselben Liste.
   Die Absicht ist im Code dokumentiert; das Risiko (timestamptz-Spalte, die keine ist) bleibt.
2. **„Fällig sind drei Folgeaktionen aus den letzten Tagen"** auf Heute, während zwei der drei Karten
   „Heute, 09:00" bzw. „Heute, 15:10" tragen und zum Lesezeitpunkt (01:39) noch nicht fällig sind.
   Die Formulierung bezieht sich auf die Herkunft des Anrufs, liest sich aber als Fälligkeit.
3. **„Zurückrufen" auf den Heute-Karten** löst `tel:` aus. Auf Mobile richtig; auf Desktop passiert
   sichtbar nichts. Ob das für den Desktop so gewollt ist, ist eine Produktfrage.
4. **„Verbindung prüfen" im Kalender** blieb nach einem Fehlschlag ohne sichtbare Rückmeldung. Der
   Fehlschlag selbst war umgebungsbedingt (Google nicht erreichbar); dass keine Meldung erschien, konnte
   ich nicht sauber nachmessen — bitte bei Gelegenheit live gegenprüfen.

---

## 6. Geprüft und in Ordnung

Damit die Abnahme weiss, was nicht mehr angefasst werden muss — jeweils im Browser ausgeführt, nicht gelesen:

- **Login/Onboarding:** leeres Formular, fehlendes Passwort, unbekannte Adresse → jeweils klare Meldung,
  Knopf wird korrekt wieder freigegeben. „Passwort vergessen" wechselt sauber auf die Reset-Karte und
  zurück. Willkommens-Karte erscheint beim Kunden ohne Onboarding **einmalig**, „Später" schliesst sie,
  `onboarding_completed` wird geschrieben, nach Reload kommt sie nicht wieder.
- **Anfragen:** alle fünf Filter (Archiv 1 · Offen 12 · Geplant 3 · Erledigt 2 · Nur ungelesene 0) liefern
  die richtigen Mengen; Suche mit Treffer und ohne Treffer; „Erledigen" öffnet eine Bestätigung;
  Overflow-Menü enthält Anrufen / Folgeaktion planen / Archivieren; Detail öffnet mit Zusammenfassung,
  nächstem Schritt, Audio & Transkript, Notiz, Verlauf.
- **Assistent:** Stimmenwechsel vollständig durchgespielt — „Auswählen" öffnet „Stimme übernehmen?",
  Bestätigen schreibt über `customer-update-assistant`, `customers.voice_id` wechselt tatsächlich
  (`1iF3vHdwHKuVKSPDK23Z` → `uvysWDLbKpA4XvpD3GI6`), die Karte trägt danach „Aktuell", und die Oberfläche
  meldet ehrlich „Gespeichert, aber noch nicht mit dem Assistenten synchronisiert."
- **Bericht:** 7 Tage / 30 Tage / Gesamt schalten; Kennzahlen stimmen gegen die Rohdaten
  (18 Anrufe, Ø 29 s, 1 Hot Lead, 3 erledigt = 17 %; Kategorien 14+1+1+1+1; Lead-Qualität 1/4/9/4 = 100 %).
- **Einstellungen:** alle sechs Einträge öffnen ihre Unterseite und kehren zurück; Kalenderformular ist
  korrekt aus der Datenbank vorbelegt (30 Min., 24 Stunden Vorlauf, Puffer 0/10, Horizont 60, Buchungen
  erlaubt).
- **Mobile (390 px):** **kein horizontaler Überlauf** auf irgendeinem Screen; Detail öffnet als echtes
  Vollbild-Overlay; Bottom-Navigation, Glocke und Zurück funktionieren.
- **Fehlerverhalten:** ausgefallene Sprachvorschau, ausgefallene Audioaufnahme und ein abgestürzter
  Realtime-Kanal führen jeweils zu einer verständlichen Meldung bzw. einem stillen Polling-Fallback —
  keine weisse Seite, kein `pageerror` im gesamten Durchlauf.

---

## 7. Nicht beurteilbar in dieser Umgebung

| Bereich | Grund |
|---|---|
| Supabase-Realtime | WebSocket nur als Stub; die App fällt korrekt auf Polling zurück, der Live-Pfad blieb ungetestet |
| ElevenLabs (Sprachvorschau, Aufnahme, Prompt-Sync) | kein Netzzugang, kein API-Schlüssel |
| Google-Kalender (Verbinden, Verbindung prüfen, Trennen) | kein Netzzugang — nur die Oberfläche davor wurde geprüft |
| Echter Anruf über die ganze Kette | ausserhalb dieser Umgebung |
| Toast-System, Benachrichtigungseinstellungen, Migrations-/Aufräumarbeit | laufende Baustellen, laut Auftrag nur zu vermerken |
| Admin Portal | ausdrücklich nicht Teil des Auftrags |

---

## 8. Vorschlag zur Reihenfolge

1. **K1** — grösster Hebel, vermutlich kleinster Eingriff (ein Einstiegspunkt auf den Assistenten-Screen).
2. **K2** — stiller Datenverlust; Fix betrifft zwei Zeilen in einer Datei.
3. **S1**, **S6**, **S5** — sichtbare Widersprüche, alle drei eng begrenzt.
4. **S3** — vorher eine fachliche Entscheidung nötig: eine Quelle oder zwei mit klarer Beschriftung.
5. **S2**, **S4**, danach die kosmetische Liste.

Keine dieser Stellen wurde angefasst. Für die Umsetzung braucht es je eine eigene Freigabe.
