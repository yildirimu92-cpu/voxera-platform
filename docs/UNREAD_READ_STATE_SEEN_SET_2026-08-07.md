# „Nur ungelesene" wirkungslos: Seen-Set überstimmte read_at

Datum: 2026-08-07
Branch: `claude/unread-filter-seen-set-fix`
Basis: `ff9a829`
Gefunden im Live-Test von PR #824 (dort nicht verursacht — siehe 3.)

---

## 1. Beobachtetes Problem

Der Filter „Nur ungelesene" im Anfragen-Screen bleibt leer. Einträge gelten
sofort als gelesen, ohne dass sie geöffnet wurden. Die Sidebar-Badge auf
„Anfragen" bleibt aus demselben Grund auf 0.

## 2. Reproduktion

Zwei Anrufe mit `read_at: null`, offener Status, leeres Seen-Set. Dann **nur**
den Anfragen-Tab betreten — kein Klick auf eine Zeile, kein Detail geöffnet:

```
vorher:  unread = [u1, u2]   seen = []
nachher: unread = []          seen = [u1, u2]
read_at: u1 → null, u2 → null
```

Der Datenstatus ist korrekt. Nur die auswertende Funktion kippt.

## 3. Ursache (bewiesen)

Es existieren **zwei parallele Gelesen-Systeme**:

| System | Speicher | Wird gesetzt von | Zweck |
|---|---|---|---|
| `read_at` | DB-Spalte `calls.read_at` | `vxMarkCallAsRead()` — nur beim Öffnen der Detailansicht | echter Gelesen-Status |
| Seen-Set | `localStorage: voxera_seen_calls_<customerId>` | `markVisibleCallsAsSeen()` — beim Betreten des Anfragen-Tabs | Zähler „neu seit letztem Blick" |

`vxIsUnreadRecord()` fragte beide ab:

```js
if (readAt != null && str(readAt) !== '') return false;          // korrekt
if (id && getSeenCallIdsFromStorage().has(id)) return false;     // ← hier kippt es
return true;
```

Befüllt wird das Set in `showTab()`, Zweig `name === 'anrufe'`:

```js
markVisibleCallsAsSeen((allRecords || []).filter(r => !isClosedStatus(r.fields.dashboard_status)));
```

Ein einziger Klick auf „Anfragen" schreibt damit jeden offenen Eintrag ins Set.
Persistiert im localStorage, überlebt Reload.

**Nicht die Ursache:** `vxRenderEntryDetail()` und `releaseAllHostsExcept()` aus
PR #824 schreiben keinen Lesestatus. `vxMarkCallAsRead()` hat genau zwei
Aufrufer, beide in den Öffnungspfaden. `git diff origin/main...` von PR #824
fasst weder `markVisibleCallsAsSeen`, `getSeenCallIdsFromStorage`,
`vxIsUnreadRecord`, `vxIsUnreadEligibleRecord` noch `showTab` an. Der Bug ist
älter und fiel im Live-Test nur auf, weil gezielt hingeschaut wurde.

## 4. Zweiter betroffener Verbraucher: die Sidebar-Badge

Die Badge `#badge-anrufe` hat zwei Schreiber:

1. `renderDashboard()` berechnet `newCount` aus Status `new` + Seen-Set.
2. Der PR-I2-Block überschreibt `vxUpdateAnfragenNavBadges()` und rechnet über
   `unreadInboxCount()` → `vxIsUnreadRecord()`. Aufruf erfolgt direkt nach 1.

Wirksam ist 2. Damit hing auch die Badge am Seen-Set und stand dauerhaft auf 0.
Der Fix repariert sie mit — belegt im Vorher/Nachher-Vergleich unter 6.

## 5. Fix

Die Seen-Set-Abfrage entfällt in beiden Fassungen von `vxIsUnreadRecord()`:
in der zur Laufzeit aktiven (PR-I2-Block) und in der davon überschriebenen
Funktionsdeklaration weiter oben, damit beide dieselbe Regel abbilden.

`read_at` ist danach die alleinige Quelle für „gelesen", gesetzt allein von
`vxMarkCallAsRead()` beim tatsächlichen Öffnen.

**Unverändert:** `markVisibleCallsAsSeen()`, `getSeenCallIdsFromStorage()` und
die Verwendung des Seen-Sets in `renderDashboard()`. Das Set wird weiter
befüllt und gelesen — es beeinflusst nur den Lesestatus nicht mehr.

**Bestandsdaten werden bewusst nicht migriert.** Einträge, die bisher nur über
das Seen-Set als gelesen galten, erscheinen wieder als ungelesen. Zum Zeitpunkt
der Änderung existieren keine Pilotkunden, das Set enthält nur Testdaten.
Vor dem Pilotstart ist erneut zu prüfen, ob eine einmalige Migration
(Seen-Set → `read_at`) nötig wird.

## 6. Verifikation

### Regressionstest — `customer-dashboard/tests/unread-read-state.test.cjs` (CI)

Zehn Tests. Der Verhaltensteil lädt den zur Laufzeit gewinnenden PR-I2-Block in
eine VM und ruft die echte Funktion auf; das Seen-Set wird bewusst gefüllt
gestubbt, statt es wegzulassen.

Gegen den **ungefixten** Stand fallen genau die drei Tests durch, die den Bug
adressieren (`7 pass / 3 fail`) — gegen den Fix laufen alle zehn grün. Ein
Regressionstest, der nicht fehlschlagen kann, wäre wertlos; das ist geprüft.

### Headless-Browser, Vorher/Nachher gegen dieselben synthetischen Daten

Drei Anrufe: `u1`, `u2` ungelesen (`read_at: null`), `r1` gelesen.

| | vorher (`main`) | nachher (Fix) |
|---|---|---|
| Liste ungefiltert | `r1, u2, u1` | `r1, u2, u1` |
| „Nur ungelesene" | **leer** | `u2, u1` |
| nach Öffnen von `u1` | leer | `u2` |
| Badge nach Tabwechsel | `0`, ausgeblendet | `2`, sichtbar |
| Badge nach Öffnen von `u1` | `0` | `1` |
| Seen-Set | `u1, u2, r1` | `u1, u2, r1` (unverändert) |

Keine JS-Fehler in beiden Läufen.

### Bestehende Prüfungen

Alle acht bisherigen `customer-dashboard/tests/*.cjs` grün, ebenso
`verify-customer-design-foundation`, `verify-customer-navigation-unified`,
`verify-customer-actions`, `audit-customer-runtime-reachability`,
`verify-p0-security-foundation`.

## 7. Was offen bleibt

**Nicht live getestet.** Verhalten gegen echte Supabase-Daten ist im
Deploy-Preview zu prüfen. Besonders: schlägt der `read_at`-Write fehl (RLS,
Netzwerk), rollt `vxMarkCallAsRead()` auf `null` zurück und der Eintrag bleibt
ungelesen. Bisher maskierte das Seen-Set diesen Fall — jetzt wird er sichtbar.
Das ist gewollt ehrlicher, aber eine Verhaltensänderung.

**Zwei parallele Gelesen-Systeme bleiben bestehen.** Ob es sie überhaupt geben
soll, ist eine Produktentscheidung und bewusst auf nach dem Pilot vertagt. Die
Badge müsste dann anders zählen.

**Separater Fund, hier nicht behoben:** Das Filter-Banner über der Liste
(`#anrufe-active-filter-banner`) zählt per `qsa('#anrufe-list .dpr-card')`.
Die Inbox-Zeilen tragen aber `vx-ops-item vx-requests-item`; `.dpr-card` trifft
dort nichts. Das Banner zeigt deshalb unabhängig vom Inhalt „· 0 Einträge" —
auch schon auf `main`, ohne Zusammenhang mit dem Seen-Set. Eigene Ursache,
eigener Fix (ein Selektor), bewusst nicht in diesen Commit gemischt.
