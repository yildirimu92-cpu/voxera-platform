# Ticket — Waisen entstehen beim Anwenden, nicht beim Vergessen

**Datum:** 11.08.2026 · **Status:** offen · **Typ:** Werkzeugverhalten mit Folgefehler ·
**Gefunden bei:** Nachdokumentation der Waise `20260811190623`

---

## 1. Der Befund

`apply_migration` über MCP **vergibt eine eigene Ledger-Version** — den Zeitstempel der Anwendung.
Diese hat nichts mit dem Präfix zu tun, den man beim Schreiben der Repo-Datei gewählt hat.

Der Ledger-Check ordnet aber **genau über diesen Präfix** zu:

```js
// scripts/verify-db-security-invariants.mjs:268
const versionOf = (f) => (f.match(/^(\d{14})_/) || [])[1] || null;
```

**Jede über MCP angewandte Migration erzeugt damit zwangsläufig zwei Fehlmeldungen auf einmal:**
eine Waise auf der Datenbank (Ledger-Version ohne Repo-Datei) und eine scheinbar nie angewandte
Datei im Repo (Datei-Präfix nicht im Ledger).

> Das ist kein Versäumnis einzelner Sitzungen. Es ist eine Eigenschaft des Werkzeugs, und sie
> trifft jeden, der es benutzt — belegt an sechs Fällen eines einzigen Tages.

## 2. Der Bestand am 11.08.2026

| Ledger-Version | Name | Repo-Datei | |
|---|---|---|---|
| `20260811184916` | `default_privileges_dml_root` | hiess `…183000` | ✅ korrigiert |
| `20260811194700` | `calls_callback_requested_allowlist` | hiess `…200000` | ✅ korrigiert (PR #948) |
| `20260811184947` | `elevenlabs_sync_log_config_drift` | heisst `…183000` | offen |
| `20260811211011` | `standalone_credit_note_issued_at` | heisst `…210000` | offen |
| `20260811211535` | `revoke_calls_callback_requested_grant` | **keine** | offen |
| `20260811214237` | `restore_calls_callback_requested_grant` | **keine** | offen |

Die vier offenen stammen aus einer anderen Sitzung und werden hier **bewusst nicht
nachdokumentiert** — bei den beiden `callback_requested`-Migrationen wäre eine rekonstruierte
Begründung schlechter als keine. Die eigentliche Begründung wird dort eingeholt, wo sie entstanden
ist.

## 3. Die Regel, die das Nachwachsen stoppt

**Für `AGENTS.md`**, im Abschnitt zu Datenbank-Migrationen:

> **Nach `apply_migration` die Repo-Datei auf die vom Ledger vergebene Version umbenennen.**
> `apply_migration` vergibt eine eigene Version (den Zeitstempel der Anwendung), nicht den Präfix
> aus dem Dateinamen. Der Ledger-Check ordnet über den Dateinamen-Präfix zu — ohne die Umbenennung
> meldet er dieselbe Migration gleichzeitig als Waise auf der Datenbank und als nie angewandte
> Datei im Repo. Die vergebene Version steht in der Antwort des Aufrufs und in
> `supabase_migrations.schema_migrations.version`.

Eine Zeile Regel gegen eine Fehlerquelle, die bei jedem künftigen MCP-Aufruf erneut zuschlägt.

**Warum Regel und nicht Automatik:** Ein Skript, das Repo-Dateien nach dem Ledger umbenennt, müsste
raten, welche Datei zu welcher Ledger-Zeile gehört — der Name ist das einzige Bindeglied und er ist
nicht eindeutig. Die Zuordnung kennt nur, wer die Migration angewandt hat. Deshalb Regel.

## 4. Zweiter Fund: Präfix-Kollision

Zwei Repo-Dateien teilen sich einen Präfix:

```
20260811210000_sms_notification_recipients.sql
20260811210000_standalone_credit_note_issued_at.sql
```

`versionOf()` liefert für beide denselben Wert, und `repoVersions` ist ein `Set` — **der Check
sieht nur eine von beiden.** Die andere ist für ihn unsichtbar: Sie kann weder als Waise noch als
nicht angewandt auffallen.

Das ist ein anderer Fehler als Abschnitt 1, aber dieselbe Wurzel — der Präfix trägt eine Bedeutung,
die niemand erzwingt.

**Vorschlag:** Der Ledger-Check bekommt eine dritte Zeile, die doppelte Präfixe meldet. Zwei
Zeilen SQL-freies JavaScript, und sie schliesst eine Lücke, durch die eine Migration dauerhaft
unsichtbar bleiben kann.

> Ohne diesen Zusatz gilt für den Check dasselbe, was heute schon dreimal galt: Er ist grün, weil
> er nicht hinsieht.

## 5. Was zu tun ist

| # | Massnahme | Aufwand | Zuständig |
|---|---|---|---|
| 1 | Regel aus Abschnitt 3 in `AGENTS.md` | 1 Zeile | Betreiber (Datei nicht angefasst) |
| 2 | Doppelte Präfixe im Ledger-Check melden | ~20 Min. | offen |
| 3 | Die vier fremden Waisen | — | andere Sitzung, nur gemeldet |
| 4 | Kollision `20260811210000` auflösen | klein | wem die Dateien gehören |

**Massnahme 1 zuerst.** Sie ist die einzige, die verhindert, dass die Liste in Abschnitt 2 morgen
wieder wächst — alles andere räumt Bestand auf.
