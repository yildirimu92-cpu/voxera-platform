# Stille Schreibfehler im Dashboard — Bestandsaufnahme

> **Zahlen am 11.08.2026 korrigiert** — die erste Messung hatte `showToast(` uebersehen. Siehe Abschnitt 1.

**Datum:** 11.08.2026 · **Status:** Befund, **keine Änderung** · **Anlass:** Frage aus dem
`callback_requested`-Fund — gibt es weitere Browser-Schreibzugriffe, deren Fehlschlag der Kunde
nicht bemerkt?

---

## 1. Korrektur der ersten Messung

> **Die erste Fassung dieses Dokuments nannte „16 von 17 unsichtbar, 7 ohne jede
> Fehlerbehandlung". Beides war falsch.** Die Heuristik suchte case-sensitiv nach `toast(` und
> uebersah damit `showToast(` — den Aufruf, den der Code tatsaechlich verwendet. Die Zahlen sind
> hier korrigiert. Der Befund wird dadurch kleiner, aber praeziser — und ein Fall wird deutlich
> schlimmer.

**Korrigierte Messung, 17 Schreibstellen:**

| Verhalten bei Fehlschlag | Stellen |
|---|---|
| **Sichtbar** — Fehlerpruefung und Toast bzw. Inline-Status | **8** |
| Fehler wird geprueft oder geloggt, aber nicht angezeigt | **9** |
| Gar keine Fehlerbehandlung | **0** |

Die urspruengliche Aussage „16 von 17 scheitern unsichtbar" traf also nicht zu. **9 von 17** melden
den Fehlschlag nicht an die Oberflaeche.

### Die neun stillen Stellen, nach Ausloeser

| Auslaesende Funktion | Fundstelle | Ausloeser |
|---|---|---|
| `vxNotifMarkRead` | `index.html:10492` | Klick auf eine Benachrichtigung |
| `vxNotifPersistReadIds` | `:10502` | Hintergrund |
| `vxNotifMarkAllRead` | `:10538` | **Klick** — „alle als gelesen" |
| `vxSaveProfile` (Profil speichern) | `:15083` | **Klick — siehe Abschnitt 2** |
| `vxOnboardingMarkComplete` | `:16055` | Abschluss des Onboardings |
| *(Detailansicht oeffnen)* | `:19081` | Hintergrund — im Code als „non-blocking, kein Toast" vermerkt |
| `vxMarkRequestAsRead` | `:19108` | **Klick** |
| `vxMarkRequestAsUnread` | `:19127` | **Klick** |
| *(Anrufliste)* | `:20308` | unklar |

**Vor den ersten Piloten gehoeren die Klick-Stellen** — `:15083`, `:10538`, `:19108`, `:19127`,
`:10492`. Bei ihnen erwartet der Kunde eine Reaktion auf seine Handlung. Die Hintergrund-Stellen
(`:10502`, `:19081`) koennen warten; dort ist Stille vertretbar, weil der Kunde nichts angestossen
hat.

---

## 2. Der eine Fall, der nicht schweigt, sondern Erfolg meldet

`customer-dashboard/index.html:15069–15084`, Profil speichern:

```js
await vxInlineSaveStatus(btn, async function() {
  const { error } = await _sb.auth.updateUser({ email });
  if (error) throw new Error(error.message);          // Auth-Fehler: geprueft

  await _sb.from('customers')                          // DB-Fehler: NICHT geprueft
    .update({ contact_first_name: name, updated_at: ... })
    .eq('id', customerMeta.customerId);
}, { savingLabel: 'Speichert …', doneLabel: 'Gespeichert ✓' });
```

**Derselbe Block prueft den Auth-Fehler und wirft — den Datenbankfehler nicht.**

Der Supabase-Client wirft bei einem Fehler nicht, er gibt `{ data, error }` zurueck. Ein
fehlgeschlagener Schreibvorgang loest also keine Ausnahme aus, `vxInlineSaveStatus` sieht einen
Erfolg und setzt den Knopf auf **„Gespeichert ✓"**. Unmittelbar danach aktualisiert der Code die
Anzeige lokal (Zeilen 15086–15089): Name, E-Mail und Avatar zeigen den neuen Wert.

> **Das ist nicht Stille, das ist eine Falschmeldung.** Der Kunde sieht eine Erfolgsquittung und
> seinen neuen Namen auf dem Bildschirm. Gespeichert wurde nichts. Auffallen kann es erst beim
> naechsten Laden der Seite — und dann sieht es aus, als haette das Dashboard die Aenderung
> „vergessen".

**Heute tritt der Fall nicht ein:** `customers.contact_first_name` und `updated_at` haben das
Spaltenrecht. Der Defekt ist latent — er wird wirksam, sobald irgendetwas diesen Schreibvorgang
scheitern laesst: eine Rechteaenderung, ein verschaerftes RLS-Praedikat, ein Constraint, ein
Netzwerkfehler.

**Genau das ist die Verbindung zum `callback_requested`-Fund.** Dort war die Ursache ein fehlendes
Grant, und der Waechter faengt sie ab sofort. Hier ist die Ursache offen — und die Falschmeldung
wuerde jede davon verdecken.

## 3. Warum das mehr ist als fehlende Sorgfalt

Der `callback_requested`-Fall zeigt die Verkettung:

1. Ein Grant wird zurückgenommen — **richtig und begründet**.
2. Eine neue Aufrufstelle entsteht — **richtig und gewollt**.
3. Beide werden nie gegeneinander gehalten — **die Lücke**.
4. Der Fehlschlag ist unsichtbar — **deshalb fällt es fünf Tage nicht auf**.

**Punkt 4 ist der Multiplikator.** Ohne ihn wäre der Fehler am 08.08. beim ersten Klick aufgefallen.
Mit ihm brauchte es eine Grant-Auditierung, um ihn zu finden — und er betraf ein bezahltes Merkmal.

Jeder künftige Grant-Entzug, jede RLS-Verschärfung und jede Spaltenumbenennung trifft auf dieselbe
Lage: neun Stellen, an denen ein Fehlschlag nicht gemeldet wird -- und eine, an der er als
Erfolg gemeldet wird.

---

## 4. Was zu tun wäre — nicht Teil dieses Befunds

| # | Massnahme | Aufwand |
|---|---|---|
| 0 | **`:15083` das Ergebnis prüfen lassen** — zwei Zeilen. Solange es fehlt, meldet das Profil-Speichern Erfolg, wenn es keinen gab. **Vor allem anderen** | sehr gering |
| 1 | **Die fünf Klick-Stellen mit sichtbarer Rückmeldung versehen** (`:10492`, `:10538`, `:19108`, `:19127`) — der Kunde muss merken, dass nicht gespeichert wurde | gering |
| 2 | Einen gemeinsamen Helfer für Schreibzugriffe, der den Fehlerfall einmal richtig behandelt, statt ihn 17-mal einzeln | grösser, aber die eigentliche Lösung |
| 3 | Regel in `AGENTS.md`: Ein Schreibzugriff ohne sichtbare Fehlerbehandlung ist unvollständig | gering |

**Empfehlung: 0 sofort, dann 3, dann 1 vor den ersten Piloten. 2 wenn ohnehin an der Stelle gearbeitet wird.**

Massnahme 3 ist die billigste und verhindert das Nachwachsen — dieselbe Logik wie bei der Wurzel
gegenüber dem Bestand: Die neun bestehenden Stellen aufzuräumen hilft nichts, wenn die zehnte morgen
genauso entsteht.

---

## 5. Abgrenzung

`scripts/verify-browser-column-grants.mjs` fängt ab sofort den **Grant**-Teil der Verkettung
(Punkt 3 oben) — er meldet eine fehlende Spaltenberechtigung, bevor sie in Produktion auffällt.

Den **Sichtbarkeits**-Teil (Punkt 4) fängt er nicht. Ein Schreibzugriff kann aus vielen anderen
Gründen scheitern als einem fehlenden Grant — RLS-Prädikat, Constraint, Netzwerk. Für die ist die
stille Behandlung genauso schädlich, und dagegen hilft nur Massnahme 1 oder 2.
