# Voxera Customer Dashboard – Stabilitätsaudit (Launch Readiness)

**Projekt:** Voxera Customer Dashboard  
**Datei geprüft:** `customer-dashboard/index.html`  
**Audit-Datum:** 2026-05-12  
**Scope:** Stabilität, Datenfluss, Detailmodul, Status-/Workflow-Logik, Notizen/Follow-ups, States, Mobile, Performance, Console-Risiken.  
**Nicht im Scope:** Feature-Ausbau, Redesign, DB-Schema-Änderungen, neue Libraries.

---

## A) Executive Summary

Der aktuelle Stand ist funktional, aber **nicht vollständig launch-stabil**, v. a. wegen inkonsistenter Status-/Datumsbehandlung, potenziell harten UI-Fehlern im Detailmodul und uneinheitlichem Datenfluss zwischen `window.allRecords`, lokalen Caches und Backend-Updates.

**Positiv:**
- Es gibt bereits Concurrency-Schutz für zentrale Datenladepfade (`loadDataInFlight`, `loadDataPending`).
- Detailmodul hat Fallback auf Legacy-Detail (`openDetail`) und aktuelle Detailseite (`showCallDetail`).
- Historie zeigt Fallback auf aktuellen Call, wenn keine Nummern-Matches gefunden werden.

**Blocker vor Admin-Standardisierung:**
1. **Notiz-Speichern kann im Fehlerfall ohne verständliches Nutzerfeedback hängen/inkonsistent bleiben** (Button-Status + fehlender Guard).  
2. **Telefon-/Zeitnormalisierung ist uneinheitlich und teilweise fehleranfällig** (Dublettenlogik, forcierte `Z`-Suffixe).  
3. **Statuslogik verwendet mehrere semantische Ebenen (Neu/In Bearbeitung/Erledigt/Abgeschlossen + interne Werte) ohne klaren Single Source of Truth.**  
4. **Detailmodul kann leer/unvollständig wirken**, wenn abhängige DOM-Elemente/Funktionen nicht vorhanden sind oder wenn History-Match scheitert.

---

## B) Kritische Bugs

1. **Fehlender sauberer Early-Exit im Note-Save bei fehlendem Supabase-Client**  
   In `vxDv2SaveNote()` wird bei fehlendem `sb` direkt `return` ausgeführt, **ohne** den zuvor gesetzten Button-Zustand (`Speichert…`, disabled) zuverlässig zurückzusetzen. Ergebnis: potenziell blockierter Speichern-Button ohne klare Fehlermeldung.  
   **Risiko:** Datenverlust-Wahrnehmung / User glaubt gespeichert zu haben.  
   **Bereich:** `vxDv2SaveNote`.

2. **Telefonnormalisierung mit redundanter/inkompletter Logik**  
   `vxNormalizePhone()` enthält doppelte `0041`-Prüfung und ist stark CH-spezifisch. Es fehlen robuste Fälle (z. B. Klammern, führendes `00` anderer Länder, Sonderzeichen jenseits Leerzeichen/`-`/`.`).  
   **Risiko:** Historie-Matching schlägt still fehl, obwohl Daten vorhanden sind.  
   **Bereich:** `vxNormalizePhone`, `vxDv2LoadHistory`.

3. **Datumskonvertierung mit harter `Z`-Anhängung in mehreren Pfaden**  
   Bei Follow-up/History werden Datumsstrings teils blind mit `Z` erweitert (`f.follow_up_at + 'Z'`, `f.created_at + 'Z'`). Falls bereits Zeitzone enthalten oder lokaler Zeitstring nicht ISO-konform ist, entstehen Verschiebungen oder Invalid Date.  
   **Risiko:** Falsche Zeiten im UI, inkonsistente Sortierung/Timeline.  
   **Bereich:** Detailmodul Timeline + Historie + Reminder.

4. **Globaler Click-Handler ohne Namespacing (einmalig, aber fragil)**  
   Das Detailmodul hängt einen globalen `document.addEventListener('click', ...)` ein. Bei späteren Script-Duplikaten/Partial-Reinjects drohen Doppel-Handler und Mehrfachaktionen.  
   **Risiko:** Doppelte Aktionen (Save/Done/Follow-up), schwer reproduzierbare Bugs.  
   **Bereich:** IIFE im Detailmodul.

---

## C) Mittlere Risiken

1. **Mehrere Datenquellen / Cache-Schichten**
- `window.allRecords`
- mögliches globales `allRecords`
- `allRecordsRaw` (Sidebar-Status)
- DB-Reads/Writes via Supabase

   Diese Quellen werden nicht überall konsistent synchronisiert. Beispiel: Notiz-Update patcht DB und nur selektiv `window.allRecords`.  
   **Risiko:** UI zeigt stale data je nach Tab/Funktion.

2. **Race Conditions trotz zentralem Guard weiterhin möglich in Nebenflüssen**
- `loadData()` ist guarded.
- Detail-Historie lädt via `setTimeout(...,50)` und liest globalen Zustand asynchron.
- Modals schließen/öffnen mit `setTimeout`-Ketten (100 ms) bei History-Navigation.

   **Risiko:** kurzer Leerzustand, falscher Datensatz im Overlay bei schnellen Klickfolgen.

3. **Status-Mischformen (Legacy + UI-Texte + interne Workflow-States)**
- `isClosedStatus(f.dashboard_status)` als zentrale Prüfstelle (implizit).
- Anzeigen „Erledigt/Offen“ im Detailmodul sind binär und vereinfachen evtl. komplexere States.
- Zusätzliche Workflow-States (`pending_test`, `active`, `inactive`, `not_started`) im Einrichtungsfluss.

   **Risiko:** Uneinheitliche Interpretation in Cards, Detail, Follow-up und KPI-Bereichen.

4. **Fehlende klare Error-States in mehreren Aktionen**
- Note Save: Fehlerfarbe ja, aber kein strukturierter Toast-/Retry-Hinweis im gleichen Muster wie andere Flows.
- Follow-up/Done hängen von externen Funktionen (`openFollowupDirect`, `confirmTaskDone`) ab; bei Fehlen kein expliziter User-Feedback-Path.

---

## D) Kleine UX-/Stabilitätsprobleme

1. **Leere/harte Zustände**
- History-Bereich bleibt ggf. leer, wenn kein DOM-Target oder keine Matches vorhanden sind (ohne explizite „keine Historie“-Message).
- `summary || 'Keine Zusammenfassung vorhanden.'` ist ok, aber bei teilweise defekten Datensätzen fehlt konsistenter Hinweis für alle Teilbereiche.

2. **Mobile Detailmodul**
- Viele Inline-Styles im v2-Overlay (fixe Paddings/Schriftgrößen) statt zentraler responsiver Klassen.
- In kleinen Höhen kann dichter Content mit mehreren Sektionen schnell gedrängt wirken; Touch-Ziele sind teils >=44px, teils darunter (z. B. einige kleine Aktionsbuttons).

3. **Konsistenz der Statuslabels**
- Im History-Snippet nur „Erledigt/Offen“, obwohl Gesamtsystem laut Anforderungen auch „Neu/In Bearbeitung/Abgeschlossen“ führen kann.

4. **Console Noise im Produktivpfad**
- `console.log('[vxDv2LoadHistory] ...')` verbleibt im laufenden UI-Pfad.

---

## E) Empfohlene Fix-Reihenfolge

1. **P0 – Datensicherheit/Feedback**
- `vxDv2SaveNote()` robust machen (immer finalen Button-State herstellen, klare Fehleranzeige/Toast, Guard bei fehlendem Client).

2. **P0 – Normalisierung/Datumslogik**
- Einheitliche Utility für Telefonnummern und Datumsparsing verwenden (ohne doppelte Prefix-Regeln, ohne blindes `+ 'Z'`).

3. **P1 – Statuskonsolidierung**
- Dokumentieren und zentralisieren, welche Rohwerte auf „Neu/In Bearbeitung/Erledigt/Abgeschlossen“ abgebildet werden.

4. **P1 – Detail-Historie Robustheit**
- Expliziter Empty-State („Keine weiteren Anrufe zu dieser Nummer“) statt stiller Leere.

5. **P2 – Event/Performance Hygiene**
- Sicherstellen, dass globale Event Listener nicht mehrfach registriert werden (Idempotenz-Guard analog zu `activationV2EventsBound`).

---

## F) Konkrete betroffene Funktionen/Codebereiche

- `vxOpenDetailV2(recordId)` – Einstieg, Routing alt/neu, Rendering, setTimeout-History-Ladung.
- `vxDv2SaveNote()` – DB-Write, lokales Cache-Update, Success/Error-Button-State.
- `vxNormalizePhone(p)` – Matching-Basis für Historie.
- `vxDv2LoadHistory(currentId, phone)` – Datenquelle, Filter, Sortierung, Fallback.
- globaler `document.addEventListener('click', ...)` im vx-v2-Block – Event-Delegation.
- `runInitialLoader(...)` / `loadData`-Guard-Variablen – zentrale Ladekonkurrenzabsicherung.
- Reminder-Block (`vxScheduleReminder`) – weitere Datums-Interpretation mit Zeitzonenannahmen.

---

## G) Unklare Punkte (explizit markiert, keine Annahmen)

1. **Finale Definition der fachlichen Statuswerte** (`dashboard_status`-Enum) ist im betrachteten Ausschnitt nicht vollständig sichtbar.  
2. **Supabase-Tabellen-/Constraint-Details** (z. B. `calls` Update-Policies) sind im Frontend-Code nicht eindeutig verifizierbar.  
3. **`showCallDetail`, `confirmTaskDone`, `openFollowupDirect`, `isClosedStatus`** sind referenziert, aber hier nicht vollständig verifiziert (Implementierungsdetails außerhalb des fokussierten Blocks möglich).  
4. **Realtime-Live-Update-Deduplizierung** ist im gesamten File nur teilweise nachvollziehbar; vollständige Garantie gegen Duplikate kann ohne End-to-End Lauf nicht bestätigt werden.

---

## H) Umsetzungsvorgaben bestätigt

- Keine neuen Features vorgeschlagen.  
- Kein Design-Redesign vorgeschlagen.  
- Keine neuen DB-Felder oder Schema-Annahmen.  
- Keine neuen Libraries vorgesehen.

---

## I) Kurzfazit für Launch-Stabilität

Vor einem breiteren Ausbau sollte ein **gezielter Hardening-Pass** auf das Detailmodul und den Call-Datenfluss erfolgen (Note Save + Statusmapping + Normalisierung + Empty/Error States). Danach kann das Admin Dashboard auf denselben Qualitätsstandard gehoben werden, mit deutlich geringerem Regressionsrisiko.
