# Ticket — Warum der Ledger-Check dieselbe Migration zweimal meldet

**Datum:** 11.08.2026, **korrigiert 12.08.2026** · **Status:** offen · **Typ:** Werkzeugverhalten mit Folgefehler ·
**Gefunden bei:** Nachdokumentation der Waise `20260811190623`

---

## 0. Korrektur — die erste Fassung nannte die falsche Ursache

> **Die erste Fassung dieses Tickets behauptete: `apply_migration` vergebe eine eigene
> Ledger-Version, der Check ordne über den Dateinamen-Präfix zu, und deshalb erzeuge **jede** über
> MCP angewandte Migration zwangsläufig zwei Fehlmeldungen. Das ist falsch.**
>
> Der Check hat einen zweiten Weg, den ich übersehen hatte:
>
> ```js
> // scripts/verify-db-security-invariants.mjs:290-292
> const isApplied = (f) => (versionOf(f) && ledgerVersions.has(versionOf(f)))
>   || info.ledger.has(nameOf(f))                       // <── dieser hier
>   || (aliasMap[f] || []).some((n) => info.ledger.has(n));
> ```
>
> Stimmt der **Name** überein, ist der Präfix gleichgültig. Dieselbe Rückfallebene gibt es in
> Richtung 2 (`repoNames.has(n)`, Zeile 315–316). Ein abweichender Zeitstempel allein löst also
> **keine** der beiden Meldungen aus.
>
> **Damit ist auch die Regel hinfällig, die in der ersten Fassung für `AGENTS.md` vorgeschlagen
> war** („nach `apply_migration` die Repo-Datei umbenennen"). Sie hätte einen Aufwand gegen eine
> Ursache verordnet, die es nicht gibt — und Dateinamen an den Zeitstempel *einer* Umgebung
> gebunden, obwohl Produktion und Staging nachweislich keine gemeinsamen Versionen führen
> (`docs/TICKET_STAGING_LEDGER_DIVERGENZ_2026-08-11.md`). **Diese Regel bitte nicht übernehmen.**
>
> Gefunden im Review von PR #978. Die beiden Umbenennungen, die ich auf Basis der falschen Annahme
> vorgenommen habe, waren folgenlos, aber unnötig.

---

## 1. Die tatsächliche Ursache

**Der Ledger speichert das Datum mit Unterstrichen, die Repo-Datei mit Bindestrichen — und
`nameOf()` entfernt nur die zweite Form.**

```js
// scripts/verify-db-security-invariants.mjs:264-267
const nameOf = (f) => f
  .replace(/^\d{14}_/, '')          // 20260811190623_foo.sql   -> foo
  .replace(/^\d{4}-\d{2}-\d{2}_/, '')  // 2026-08-10_foo.sql    -> foo
  .replace(/\.sql$/, '');
```

Der Ledger-Name lautet aber `2026_08_10_foo` — mit Unterstrichen. Nach dem Abstreifen steht auf
der einen Seite `foo`, auf der anderen `2026_08_10_foo`. Sie treffen sich nie.

Nachgemessen gegen den Produktions-Ledger, 12.08.:

| Repo-Datei | `nameOf()` | Ledger-Name | trifft? |
|---|---|---|---|
| `20260811183000_default_privileges_dml_root.sql` | `default_privileges_dml_root` | `default_privileges_dml_root` | ✅ |
| `20260811200000_calls_callback_requested_allowlist.sql` | `calls_callback_requested_allowlist` | `calls_callback_requested_allowlist` | ✅ |
| `20260811210000_standalone_credit_note_issued_at.sql` | `standalone_credit_note_issued_at` | `standalone_credit_note_issued_at` | ✅ |
| `2026-08-10_calls_admin_review.sql` | `calls_admin_review` | `2026_08_10_calls_admin_review` | ❌ |
| `2026-08-10_invoice_items_credit_note_sign.sql` | `invoice_items_credit_note_sign` | `2026_08_10_invoice_items_credit_note_sign` | ❌ |
| `2026-08-10_standalone_credit_notes.sql` | `standalone_credit_notes` | `2026_08_10_standalone_credit_notes` | ❌ |

**Die drei oberen sind genau die Fälle, für die ich einen falschen Zeitstempel verantwortlich
gemacht hatte. Sie treffen sich problemlos.** Die drei unteren sind die echten Doppelmeldungen —
und die haben nichts mit `apply_migration` zu tun, sondern mit dem Trennzeichen im Datum.

Belegt am Produktionslauf 31571552658 (12.08. 06:50): Genau diese drei stehen **gleichzeitig** in
beiden Listen — als „NICHT angewandt" *und* als Waise.

## 2. Der Bestand am 12.08.2026

| Ledger-Name | Repo-Datei | Bewertung |
|---|---|---|
| `2026_08_10_calls_admin_review` | `2026-08-10_calls_admin_review.sql` | **Doppelmeldung**, Ursache Abschnitt 1 |
| `2026_08_10_invoice_items_credit_note_sign` | `2026-08-10_invoice_items_credit_note_sign.sql` | **Doppelmeldung** |
| `2026_08_10_standalone_credit_notes` | `2026-08-10_standalone_credit_notes.sql` | **Doppelmeldung** |
| `default_privileges_root_and_dead_grants` | fehlte | ✅ mit dieser PR nachgetragen |
| `calls_rls_policy_hygiene_ensure_canonical` | keine | echte Waise, andere Sitzung |
| `addon_schema_alignment_and_subscription_plan_code` | keine | echte Waise, andere Sitzung |
| `addon_activation_accumulation` | keine | echte Waise, andere Sitzung |
| `addon_functions_execute_revoke_hotfix` | keine | echte Waise, andere Sitzung |
| `revoke_calls_callback_requested_grant` | keine | echte Waise, andere Sitzung |
| `restore_calls_callback_requested_grant` | keine | echte Waise, andere Sitzung |

Die echten Waisen werden hier **bewusst nicht** nachdokumentiert — bei den beiden
`callback_requested`-Migrationen wäre eine rekonstruierte Begründung schlechter als keine. Die
eigentliche Begründung wird dort eingeholt, wo sie entstanden ist.

## 3. Was zu tun ist

| # | Massnahme | Aufwand | Stand |
|---|---|---|---|
| 1 | `nameOf()` normalisiert das Datum auf **beiden** Seiten, statt nur eine Schreibweise zu kennen | klein | **in dieser PR** |
| 2 | Doppelte Dateinamen-Präfixe melden (Abschnitt 4) | ~20 Min. | offen |
| 3 | Die sechs echten Waisen | — | andere Sitzung, nur gemeldet |
| 4 | Kollision `20260811210000` auflösen | klein | wem die Dateien gehören |

**Keine `AGENTS.md`-Regel.** Die erste Fassung schlug eine vor; sie wäre gegen eine Ursache
gerichtet gewesen, die es nicht gibt. Der Ledger-Check kann das selbst, und ein Check, der es
selbst kann, ist einer Regel vorzuziehen, an die sich jemand erinnern muss.

## 4. Zweiter Fund: Präfix-Kollision — unverändert gültig

Zwei Repo-Dateien teilen sich einen Präfix:

```
20260811210000_sms_notification_recipients.sql
20260811210000_standalone_credit_note_issued_at.sql
```

`versionOf()` liefert für beide denselben Wert, und `repoVersions` ist ein `Set` — **der Check
sieht über diesen Weg nur eine von beiden.**

Dieser Fund hängt nicht an Abschnitt 0: Er betrifft `repoVersions`, also Richtung 2, und dort gibt
es die Namens-Rückfallebene ebenfalls (`repoNames`). Die Kollision entschärft sich dadurch in der
Praxis — bleibt aber ein Fallstrick, sobald sich zwei Dateien Präfix *und* Namensmuster teilen.

**Vorschlag:** Der Ledger-Check bekommt eine dritte Zeile, die doppelte Präfixe meldet. Zwei Zeilen
SQL-freies JavaScript.

## 5. Was die Episode wert war

Die falsche Ursache war plausibel, sie erklärte die beobachteten Zahlen, und sie hätte zu einer
Regel geführt, die jeder künftigen Sitzung Aufwand aufgeladen hätte — gegen ein Problem, das nicht
existiert. Aufgefallen ist sie, weil jemand den Code gelesen hat, den ich zitiert hatte, statt das
Zitat zu glauben.

> Das ist derselbe Fehlermodus, gegen den die Wächter in diesem Repo gebaut sind, nur eine Ebene
> höher: Eine Diagnose, die nicht gegengeprüft wird, ist grün, weil niemand hinsieht.
