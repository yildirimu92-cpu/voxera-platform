# Stille Schreibfehler im Dashboard — Bestandsaufnahme

**Datum:** 11.08.2026 · **Status:** Befund, **keine Änderung** · **Anlass:** Frage aus dem
`callback_requested`-Fund — gibt es weitere Browser-Schreibzugriffe, deren Fehlschlag der Kunde
nicht bemerkt?

---

## 1. Die Antwort: fast alle

Gemessen über `customer-dashboard/index.html`, `admin-panel/index.html` und die `shared/`-Skripte.
Gezählt wurde je Schreibstelle (`.update`/`.insert`/`.upsert`/`.delete` auf einem
Supabase-Browser-Client), ob im umgebenden Code eine für den Nutzer sichtbare Reaktion vorkommt:

| Verhalten bei Fehlschlag | Stellen |
|---|---|
| **Sichtbar** — Toast oder `throw` | **1** |
| Nur `console.warn` / `console.error` | **9** |
| **Gar keine Fehlerbehandlung** | **7** |

**16 von 17 Schreibzugriffen scheitern für den Kunden unsichtbar.**

Die 7 ohne jede Behandlung sind der härtere Fall: Dort wird die Antwort nicht einmal angesehen. Ein
403 verhält sich für den Nutzer exakt wie ein Erfolg — die Oberfläche rendert häufig sogar den
gewünschten Zustand lokal weiter, weil der Code nach dem Absenden optimistisch aktualisiert.

### Die Stellen ohne jede Fehlerbehandlung

| Tabelle | Fundstelle |
|---|---|
| `customers` | `customer-dashboard/index.html:15083` |
| `calls` | `:19081`, `:20239` |
| `customer_tasks` | `:20284` |
| `ai_change_requests` | `admin-panel/index.html:16465`, `:16479`, `:16661` |

### Nur `console.warn`

`notifications` (`:10492`, `:10502`, `:10538`), `customers` (`:16055`), `calls` (`:19108`,
`:19127`, `:19718`, `:20308`), `invoices` (`:13384`).

> **Methodenhinweis:** Die Einordnung liest ein Fenster von 700 Zeichen nach der Schreibstelle und
> sucht nach `toast(`, `throw`, `console.warn|error`. Das ist eine Näherung — eine Fehlerbehandlung
> weiter unten in derselben Funktion wird nicht erkannt. Die Größenordnung trägt, die Einzelzeile
> gehört vor einer Korrektur angesehen.

---

## 2. Warum das mehr ist als fehlende Sorgfalt

Der `callback_requested`-Fall zeigt die Verkettung:

1. Ein Grant wird zurückgenommen — **richtig und begründet**.
2. Eine neue Aufrufstelle entsteht — **richtig und gewollt**.
3. Beide werden nie gegeneinander gehalten — **die Lücke**.
4. Der Fehlschlag ist unsichtbar — **deshalb fällt es fünf Tage nicht auf**.

**Punkt 4 ist der Multiplikator.** Ohne ihn wäre der Fehler am 08.08. beim ersten Klick aufgefallen.
Mit ihm brauchte es eine Grant-Auditierung, um ihn zu finden — und er betraf ein bezahltes Merkmal.

Jeder künftige Grant-Entzug, jede RLS-Verschärfung und jede Spaltenumbenennung trifft auf dieselbe
Lage: 16 Stellen, an denen ein Fehlschlag aussieht wie ein Erfolg.

---

## 3. Was zu tun wäre — nicht Teil dieses Befunds

| # | Massnahme | Aufwand |
|---|---|---|
| 1 | **Die 7 Stellen ohne Behandlung mit einer sichtbaren Rückmeldung versehen** — der Kunde muss merken, dass nicht gespeichert wurde | mittel |
| 2 | Einen gemeinsamen Helfer für Schreibzugriffe, der den Fehlerfall einmal richtig behandelt, statt ihn 17-mal einzeln | grösser, aber die eigentliche Lösung |
| 3 | Regel in `AGENTS.md`: Ein Schreibzugriff ohne sichtbare Fehlerbehandlung ist unvollständig | gering |

**Empfehlung: 3 sofort, 1 als eigener Auftrag, 2 wenn ohnehin an der Stelle gearbeitet wird.**

Massnahme 3 ist die billigste und verhindert das Nachwachsen — dieselbe Logik wie bei der Wurzel
gegenüber dem Bestand: Die 16 bestehenden Stellen aufzuräumen hilft nichts, wenn die 17. morgen
genauso entsteht.

---

## 4. Abgrenzung

`scripts/verify-browser-column-grants.mjs` fängt ab sofort den **Grant**-Teil der Verkettung
(Punkt 3 oben) — er meldet eine fehlende Spaltenberechtigung, bevor sie in Produktion auffällt.

Den **Sichtbarkeits**-Teil (Punkt 4) fängt er nicht. Ein Schreibzugriff kann aus vielen anderen
Gründen scheitern als einem fehlenden Grant — RLS-Prädikat, Constraint, Netzwerk. Für die ist die
stille Behandlung genauso schädlich, und dagegen hilft nur Massnahme 1 oder 2.
