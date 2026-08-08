# CI-Check gegen die Produktions-Datenbank — Einrichtung

## Warum es diesen Check gibt

Die P0-Security-Migration vom 2026-07-28 (`2026-07-28_p0_security_foundation.sql`)
galt wochenlang als „gemergt und live verifiziert". Auf der Produktions-Datenbank
war sie nie wirksam: die Funktionsebene existierte, **keine einzige der Policies
und Grants**. Der CI-Check `verify-p0-security-foundation` blieb die ganze Zeit
grün — er liest Repo-Dateien, und die Datei war ja korrekt.

Ein Check, der nur Code prüft, kann diese Fehlerklasse prinzipiell nicht sehen.
`verify-db-security-invariants.yml` schließt genau diese Lücke: er öffnet eine
echte Session gegen die Produktions-DB, impersoniert `anon` und `authenticated`
und misst nach, was sie tatsächlich dürfen.

Der bestehende `p0-security-verification.yml` bleibt unverändert. Die beiden
Checks prüfen verschiedene Dinge und ersetzen einander nicht.

## Einmalige Einrichtung

### 1. Migration anwenden

```
supabase/migrations/2026-08-08_ci_security_verifier_role.sql
```

Legt an:

- die Rolle `voxera_ci_verifier` — **ohne Passwort**, `NOINHERIT`, ohne eigene
  Tabellenrechte, Mitglied von `anon` und `authenticated` (nur per `SET ROLE`
  wirksam);
- `public.ci_security_probe_census()` — liefert je Tabelle nur die Zeilenzahl.
  Ohne sie wäre „0 sichtbare Zeilen" bei einer leeren Tabelle ein falsches PASS;
- `public.ci_security_probe_identity()` — liefert eine UUID und Mandanten-IDs,
  keine Namen, keine Inhalte. Nur damit lässt sich prüfen, dass ein Mandant
  **genau** seine eigenen Zeilen sieht — und nicht etwa alle oder gar keine.

`EXECUTE` auf beiden Helfern hat ausschließlich `voxera_ci_verifier`;
`anon`, `authenticated` und `service_role` sind ausdrücklich ausgeschlossen. Die
Migration prüft das am Ende selbst nach und bricht ab, wenn etwas davon nicht
stimmt.

### 2. Passwort setzen

Passwörter gehören nicht ins Repo, deshalb legt die Migration die Rolle ohne
Passwort an — sie kann sich damit nicht anmelden. Einmalig auf der Datenbank:

```sql
alter role voxera_ci_verifier password '<hier ein starkes Zufallspasswort>';
```

Zum Beispiel mit `openssl rand -base64 32`.

### 3. Connection-String als GitHub-Secret hinterlegen

**Der Session-Pooler ist Pflicht, nicht Geschmackssache.** `db.<ref>.supabase.co`
ist nur über IPv6 erreichbar, GitHub-Runner sprechen IPv4 — eine Direktverbindung
läuft in einen Timeout. Und es muss der **Session**-Modus (Port 5432) sein, nicht
der Transaction-Modus (6543): die Proben brauchen `SET LOCAL ROLE` innerhalb
einer Transaktion.

Den Host im Supabase-Dashboard unter **Connect → Session pooler** ablesen und
Benutzer sowie Passwort ersetzen (Pooler-Benutzerformat: `<rolle>.<projekt-ref>`):

```
postgresql://voxera_ci_verifier.<projekt-ref>:<passwort>@<pooler-host>:5432/postgres?sslmode=require
```

Diesen String anlegen als:

- **Environment:** `production-db-readonly`
- **Secret:** `SUPABASE_DB_URL_CI_VERIFIER`

Das eigene Environment sorgt dafür, dass jeder Zugriff auf die Produktions-
Zugangsdaten einzeln auditierbar ist und unabhängig entzogen werden kann.

### 4. Probelauf

Actions → *DB Security Invariants (Produktion)* → **Run workflow**. Das Ergebnis
steht als Tabelle in der Step Summary.

## Was geprüft wird

| Gruppe | Prüft | Art |
| --- | --- | --- |
| A | `authenticated` mit fremdem Subject sieht in keiner Mandantentabelle eine Zeile | Verhalten |
| B | `anon` sieht nichts und darf nichts | Verhalten |
| C | ein echter Mandant sieht **genau** seine eigenen Zeilen — und sieht überhaupt welche | Verhalten |
| D | verbotene Schreibpfade enden in `42501` | Verhalten |
| D2 | ein Nicht-Admin löscht keine fremden Zeilen (RLS auf DELETE) | Verhalten |
| E | `is_admin()` löst eindeutig auf, `current_customer_id()` löst korrekt auf, `anon` kommt an keine der Funktionen | Verhalten |
| F | Policies, Grants, Spalten-Allowlists, `search_path`-Pinning, Funktionssignaturen | Katalog |
| G | Migrations-Ledger ↔ `supabase/migrations/` in beide Richtungen | Katalog |
| H | keine neuen `anon`/`authenticated`-Grants, keine neue Tabelle ohne RLS | Baseline-Diff |

### Warum jede Probe eine Gegenkontrolle hat

Eine Datenbank, die **alles** verbietet, besteht die Proben A, B und D mühelos —
und wäre trotzdem kaputt. Deshalb prüft jede Sperre auch ihre Gegenrichtung:

- C stellt sicher, dass der Mandant überhaupt eigene Zeilen sieht (`own_total > 0`);
  wäre das 0, hätte A nichts gemessen.
- D versucht zusätzlich einen **erlaubten** Schreibpfad (`customers.updated_at`),
  der durchgehen **muss**.
- F prüft nicht nur zurückgenommene, sondern auch erhaltene Rechte — ohne
  `EXECUTE` auf `current_customer_id()` für `authenticated` brechen sämtliche
  RLS-Prädikate und der Login.

### Warum die Proben produktionssicher sind

- Alles läuft in **einer** Transaktion, die zurückgerollt wird. Die
  Verhaltensdatei enthält kein einziges `commit`.
- Schreibproben tragen `where false` und berühren garantiert null Zeilen —
  selbst dann, wenn die Rechteprüfung fälschlich durchließe.
- Die Transaktion ist bewusst **nicht** read-only: dort schlägt jeder
  Schreibversuch mit `25006` fehl, **bevor** Postgres die Rechte prüft. Die
  Probe könnte „durch Rechte verweigert" nicht von „durch read-only verweigert"
  unterscheiden und würde eine kaputte Berechtigung als bestanden melden.
- Einzige Ausnahme von `where false` ist Probe D2: RLS auf DELETE lässt sich nur
  durch ein echtes DELETE feststellen. Das Prädikat trifft ausschließlich Zeilen
  **fremder** Mandanten, und `customers`/`users` sind wegen ihrer Kaskaden
  ausgenommen.
- `statement_timeout`, `lock_timeout` und `idle_in_transaction_session_timeout`
  sind auf der Rolle gesetzt; ein hängender CI-Job kann nichts blockieren.

## Exit-Codes

| Code | Bedeutung |
| --- | --- |
| 0 | alle Invarianten halten |
| 1 | eine Invariante ist verletzt — Sicherheitsbefund |
| 2 | **nicht prüfbar**: Secret fehlt, DB nicht erreichbar, Migration nicht angewandt |

Exit 2 ist ebenfalls rot. Ein Check, der bei unerreichbarer Datenbank grün
meldet, wäre genau der Fehlermodus, den dieser Workflow abschafft. Vorübergehende
Verbindungsfehler werden dreimal mit Backoff (2 s / 4 s / 8 s) wiederholt, bevor
der Job aufgibt.

## Wenn der Check rot wird

**Gruppe G, „NICHT angewandt"** — eine Migration liegt im Repo, aber nicht auf
der Datenbank. Das ist der P0-Fehler in seiner Reinform. Migration anwenden.

**Gruppe G, „nur auf der DB"** — jemand hat am Repo vorbei geändert. Die
Änderung als Migrationsdatei nachdokumentieren, damit sie reproduzierbar wird.

**Gruppe H** — `anon` oder `authenticated` hat neue Tabellenrechte bekommen.
Meist ein Supabase-Default auf einer neu angelegten Tabelle. Entweder zurück-
nehmen oder, wenn beabsichtigt, in `db-security-baseline.json` aufnehmen — mit
Begründung im Commit.

**Gruppen A–E** — eine Isolationsgrenze hält nicht mehr. Das ist ein aktiver
Befund und kein Konfigurationsproblem: die Meldung nennt Tabelle und Zeilenzahl.

## Bekannte Alt-Schuld

`anon` hält auf 27 Tabellen weiterhin breite DML-Rechte aus Supabase-Defaults
(u. a. `admins`, `users`, `outbox_events`). Dass daraus kein Datenabfluss wird,
hängt **allein an RLS** — die Proben B und D messen das bei jedem Lauf nach.

Diese Rechte sind in `supabase/verification/db-security-baseline.json`
eingefroren, damit es nicht schlimmer wird. Ein Check, der am ersten Tag rot ist,
wird abgeschaltet und schützt dann gar nichts mehr. Die Baseline ersetzt kein
Aufräumen — sie hält den Stand fest, bis aufgeräumt wird.

Ebenso offen: die Migrationen **vor** dem 2026-08-08 haben keine Ledger-Zeile,
weil `supabase_migrations.schema_migrations` erst an diesem Tag entstand. Ob sie
angewandt wurden, ist damit nicht nachweisbar — genau die Ungewissheit, die den
Vorfall ermöglicht hat. Sie sind in der Baseline als „nicht nachweisbar" geführt
und bewusst **nicht** nachträglich als „applied" eingetragen: das wäre dieselbe
unbelegte Behauptung. Ab dem 2026-08-08 ist der Abgleich strikt.
