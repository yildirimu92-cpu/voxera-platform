# Browser-Schreibzugriffe ohne sichtbare Fehlerbehandlung

Stand 2026-08-11. Korpus: `customer-dashboard/index.html`, alle Schreibzugriffe
über den `authenticated`-Client. Geprüft wurde jede Stelle einzeln im Quelltext,
nicht am laufenden Produkt.

## Kurzurteil

Es gibt **keinen gemeinsamen Schreibweg.** Vierzehn Stellen rufen
`.from().update()` direkt auf dem Client auf und werten das Ergebnis jede für
sich aus — oder eben nicht. Ein gemeinsamer Weg ist deshalb nicht die Ersparnis
gegenüber vierzehn Einzelfixes, **er ist der Vorschlag.**

Der eigentliche Fehler ist überall derselbe und liegt in einer Eigenschaft von
PostgREST: `.update()` **lehnt nicht ab, es liefert `{ error }` zurück.** Ein
`try/catch` um einen `await` fängt daher nichts. Drei Stellen haben genau dieses
`try/catch` — sie sehen behandelt aus und sind es nicht. Eine Stelle im Repo
kommentiert den Mechanismus bereits korrekt (`:31506`), aber die Erkenntnis ist
nie zu den anderen dreizehn gewandert.

Ein 403 ist dabei kein Wackler, sondern ein Dauerzustand: Das Recht fehlt, der
nächste Versuch scheitert genauso. Wiederholen ist sinnlos, Stillschweigen
falsch.

**Das ist keine Theorie.** Am 2026-08-08 fügte PR #847 den Schreibzugriff in
`saveFollowUpV2()` hinzu, ohne die Spalten-Allowlist nachzuziehen. Drei Tage
lang lief dieser Klick in einen 403; die Oberfläche meldete „Nachfassen
gespeichert", der Anruf blieb in Rückrufliste und KPI stehen. Aufgefallen ist es
nicht dem Dashboard, sondern erst einer Rechteprüfung an der Datenbank.

## A — Kundenaktion: ein Klick, der nichts tut (vor dem Piloten)

| # | Stelle | Was bei 403 passiert | Sieht die Kundin etwas? |
| --- | --- | --- | --- |
| A1 | `vxSaveProfil` `:15019` — `customers.contact_first_name` | Name wird nicht gespeichert | **Nein — sie sieht das Gegenteil.** Der Knopf zeigt „Gespeichert ✓". Nur die `auth.updateUser`-Hälfte wird geprüft, die `customers`-Hälfte nicht. Nach dem Neuladen steht der alte Name da |
| A2 | `saveFollowUpV2` `:19634` — `calls.callback_requested` | Folge-Aufgabe entsteht, Rückruf-Status bleibt stehen → Doppelzählung in Liste und KPI | **Nein.** Toast „Nachfassen gespeichert" in Grün, Fehler nur per `console.warn` |
| A3 | `vxMarkRequestAsRead/Unread` `:19023`/`:19042` | Lokal umgeschaltet, DB nicht | **Indirekt und verwirrend.** Der nächste Poll (9–12 s) macht es wortlos rückgängig — ein Flackern ohne Erklärung |
| A4 | `vxNotifMarkRead` `:10492`, `vxNotifMarkAllRead` `:10539` | Glocke wird lokal geleert, DB nicht | **Nein.** Badge geht auf 0, nach dem Neuladen sind alle Meldungen wieder ungelesen. `try/catch` fängt hier nichts |
| A5 | `vxOnboardingMarkComplete` `:15985` | Abschluss wird nicht vermerkt | **Nein**, heute abgefedert: `localStorage` hält die Wegklick-Entscheidung. Ohne diese Krücke öffnete sich das Modal bei jedem Poll erneut — der Fehler von 2026-08-07 |

`saveFollowUp` `:20224` gehört fachlich in diese Gruppe, ist aber **toter Code**:
`:20169` definiert die Funktion, aufgerufen wird sie nirgends. Gehört in die
Aufräum-Diagnose, nicht in diese Liste.

## B — Hintergrund: läuft ohne Zutun (nach dem Piloten)

| # | Stelle | Was bei 403 passiert | Sieht die Kundin etwas? |
| --- | --- | --- | --- |
| B1 | `vxNotifPersistReadIds` `:10502` | Gelesen-Status übersteht das Neuladen nicht | Nein. Läuft nach dem Speichern nebenher |
| B2 | `vxBestEffortPatchTaskLifecycle` `:17243` | Zeitstempel fehlt in der DB, lokal gesetzt → Anzeige und Datenbank driften auseinander | Nein, und das ist hier **bewusst** — die Funktion heisst so. Auf `customer_tasks` hat `authenticated` alle Spaltenrechte, der Schreibvorgang gelingt also normalerweise |
| B3 | `vxMarkCallAsRead` `:18997` | Nichts Bleibendes: die Stelle **nimmt den lokalen Zustand zurück** und zeichnet neu | Nein, aber konsistent. Der sauberste Umgang im ganzen Korpus |

## Was stattdessen passieren müsste

Getrennt nach dem, was der Fehler bedeutet — nicht nach Aufrufstelle:

- **Kundenaktion (Gruppe A).** Kein Erfolgssignal, bevor das Ergebnis geprüft
  ist. Bei einem Fehler: optimistisch gesetzten lokalen Zustand zurücknehmen,
  Klartext zeigen („Konnte nicht gespeichert werden"), Fehler melden. Ein Knopf,
  der „Gespeichert ✓" zeigt, obwohl nichts geschrieben wurde, ist schlimmer als
  einer, der gar nichts sagt — die Kundin hat keinen Anlass, es noch einmal zu
  versuchen.
- **Hintergrund (Gruppe B).** Die Kundin nicht mit etwas behelligen, das sie
  nicht ausgelöst hat. Aber: lokalen Zustand zurücknehmen statt Anzeige und
  Datenbank auseinanderlaufen zu lassen (B3 macht das vor), und den Fehler
  sichtbar melden — nicht nur auf eine Konsole, die niemand liest.
- **403 gesondert.** Ein fehlendes Recht ist ein Fehler an uns, nicht an der
  Kundin. Er gehört gemeldet, nicht wiederholt.

## Der Vorschlag: eine Stelle statt vierzehn

Zwei Bausteine, der zweite existiert schon:

1. **`vxDbWrite(builder, { kontext })`** — neu. Wartet das Ergebnis ab, prüft
   `result.error`, unterscheidet Rechte-Fehler (403/42501) von Netzfehler und
   liefert einheitlich `{ ok, kind, error }`. Das ist die eine Stelle. Die
   vierzehn Aufrufstellen werden zu Einzeilern, und ein `try/catch`, das nichts
   fängt, ist danach nicht mehr formulierbar.
2. **`vxInlineSaveStatus(btn, fn, opts)`** — vorhanden, deckt die Knopf-Hälfte
   ab. Bemerkenswert: die einzigen zwei Stellen im Korpus, die den Fehlerfall
   heute richtig behandeln (`:15006`, `:31504`), sind genau die zwei, die diesen
   Helfer benutzen. Der gemeinsame Weg ist also nicht bloss Theorie — wo es ihn
   gibt, stimmt das Verhalten.

Dazu gehört der Wächter, den die Allowlist-Migration von heute 19:47 bereits
ankündigt und der noch nicht existiert:
`scripts/verify-browser-column-grants.mjs`. Er liest die Schreibzugriffe aus dem
Browser-Code und vergleicht sie mit den tatsächlichen Spaltenrechten. Er hätte
den 403 aus PR #847 am selben Tag gefunden statt nach drei Tagen — und er hätte
meinen falschen Rechte-Entzug von heute gar nicht erst zugelassen.

**Reihenfolge:** Baustein 1 und die Gruppe A vor dem Piloten, Gruppe B danach,
der Wächter so früh wie möglich — er ist das einzige Stück, das verhindert, dass
dieselbe Lücke ein viertes Mal entsteht.

---

# C — Der Schreibvorgang, der nie gelingen konnte

Eigener Punkt, keine Fussnote der Ursachensuche unten. Er gehört zur selben
Klasse wie die Gruppen A und B — nur war er nicht übersehen, sondern so gebaut.

## Der Befund (Fakt, in Produktion gemessen)

`applyStatusTransition()` rief nach der autoritativen Function noch
`vxBestEffortPatchCallLifecycle(recordId, { updated_at, completed_at, archived_at })`
auf. `authenticated` darf auf `public.calls` schreiben: `callback_requested`,
`dashboard_status`, `notes_customer_voxera`, `read_at`, `updated_at`. **Nicht**
`completed_at`, **nicht** `archived_at`.

Der Aufruf schlug damit bei jedem einzelnen Mal fehl. Die Gegenprobe an den
Daten, unmittelbar vor der Korrektur:

| Messung | Ergebnis |
| --- | --- |
| Anrufe mit `dashboard_status = 'closed'` | 5 |
| davon mit `completed_at` | **0** |
| Anrufe mit `dashboard_status = 'archived'` | 1 |
| davon mit `archived_at` | **0** |

Keine der beiden Spalten wurde je aus dem Dashboard befüllt. Auch die beiden
Netlify Functions schrieben sie nicht — dieser Aufruf war der einzige Kandidat.

## Warum das schlimmer ist als ein gescheiterter Schreibvorgang

```js
} catch (err) {
  console.warn('[voxera] lifecycle timestamp update skipped', …);
  var local = (allRecords || []).find(…);
  if (local && local.fields) Object.assign(local.fields, fields);   // ← setzt lokal, was die DB abgelehnt hat
```

Der Fehlerzweig schrieb die **abgelehnten** Felder in den lokalen Datensatz.
Die Anzeige war damit nicht unvollständig, sondern nachweislich falsch: Sie
führte einen Zeitstempel, den die Datenbank zurückgewiesen hatte, bis der
nächste Poll ihn neun bis zwölf Sekunden später wieder entfernte. Zwei Stellen
werten dieses Feld mit aus — `vxTodayIsOpenCallForAttention()` (`:12451`) und
`vxRowActionLifecycle()` (`:12557`).

Das Wort „best effort" im Funktionsnamen hat den Zustand dreizehn Wochen lang
gedeckt. Es beschreibt einen Schreibvorgang, der gelingen darf oder auch nicht.
Dieser konnte nicht gelingen — der Name hat den Unterschied verdeckt.

## Behoben (2026-08-12)

- **`call-update-status.js`** setzt die Zeitstempel jetzt selbst:
  `completed_at` beim Schliessen, `archived_at` beim Archivieren, beide auf
  `null` beim Wiedereröffnen. Die Function läuft mit dem
  Service-Role-Schlüssel und kennt den Zielstatus ohnehin — sie ist die einzige
  Stelle, an der die Zeitstempel zuverlässig entstehen können.
- **`applyStatusTransition()`** trägt nichts mehr nach.
  `vxBestEffortPatchCallLifecycle()` ist damit ohne Aufrufer und entfernt,
  statt als toter Code liegenzubleiben.

Der Spaltenrecht-Wächter zählt danach 14 statt 15 Schreibstellen; auf `calls`
bleiben ausschliesslich Spalten, für die das Recht besteht.

**Die Regel dahinter:** Ein Schreibvorgang, der nicht gelingen kann, gehört
nicht abgesichert, sondern an die Stelle, die das Recht dazu hat. Und ein
Fehlerzweig darf den lokalen Zustand nie über das hinausschreiben, was die
Datenbank angenommen hat — sonst ist die Anzeige nicht bloss veraltet, sondern
unwahr.

---

# Nachtrag: „Braucht dich" — erledigt markieren, Eintrag kommt zurück

Gemeldet aus einem Test in der Nacht auf 2026-08-12. Erste Frage war, ob es
dieselbe Klasse ist wie die fünf Kundenaktionen oben und durch `vxDbWrite()`
bereits behoben.

## Nein — der Erledigt-Pfad berührt den Browser-Client gar nicht

| Eintragsart | Autoritativer Schreibweg | Fehlerverhalten |
| --- | --- | --- |
| Anfrage (Anruf) | `apiUpdateCallStatus()` → Netlify Function `call-update-status`, schreibt mit dem Service-Role-Schlüssel `dashboard_status` + `updated_at` | wirft; `doStatusChange()` fängt und meldet |
| Aufgabe | `updateManualTaskStatus()` → Function `cases-update` | wirft ausdrücklich bei `success !== true` |

Beide Wege laufen über Netlify Functions, nicht über den `authenticated`-Client,
und beide melden Fehler durch Werfen statt durch ein stilles `{ error }`. Der
gemeinsame Schreibweg hat diese Stellen deshalb weder berührt noch geheilt.
**Der Test von gestern lief nicht gegen einen veralteten Stand.** Eigener Befund.

## Der Nebenbefund ist ausgezogen

Auf demselben Pfad stand ein Schreibvorgang, der nie gelingen konnte. Er wird
jetzt als **Abschnitt C** eigenständig geführt und ist behoben — er war nicht
die Ursache des Wiederauftauchens, aber ein Fehler derselben Klasse.

## Was als Nächstes nötig ist

Anfragen und Aufgaben nehmen ab `doStatusChange()` **völlig getrennte Wege**.
Ohne zu wissen, welcher der beiden getestet wurde, hiesse Weitersuchen raten.
Konkret gebraucht: War der Eintrag eine **Anfrage (Anruf)** oder eine
**Aufgabe**? Dazu, falls vorhanden, die Konsolenausgabe — beide Pfade
protokollieren ausführlich (`logManualTaskDoneFlow`, `[voxera] lifecycle
timestamp update skipped`).
