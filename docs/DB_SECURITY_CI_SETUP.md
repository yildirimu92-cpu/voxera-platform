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
supabase/migrations/20260808114412_ci_security_verifier_role.sql
supabase/migrations/20260808122741_ci_security_verifier_role_census_v2.sql
```

Legt an:

- die Rolle `voxera_ci_verifier` — **ohne Passwort**, `NOINHERIT`, ohne eigene
  Tabellenrechte, Mitglied von `anon` und `authenticated` (nur per `SET ROLE`
  wirksam);
- `public.ci_security_probe_census(text)` — liefert je Tabelle die Zeilenzahl und,
  bezogen auf einen Mandanten, die Zahl der *fremden* Zeilen. Ohne die erste wäre
  „0 sichtbare Zeilen" bei einer leeren Tabelle ein falsches PASS, ohne die zweite
  wäre „0 fremde Zeilen getroffen" in einer Tabelle ohne fremde Zeilen dasselbe;
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

**Kein `openssl rand -base64 32`**, wenn der Connection-String-Weg genutzt wird:
Base64 erzeugt `/`, `+` und `=`, und `/` oder `@` in einem Passwort zerlegen den
URI falsch. Stattdessen ein URL-sicheres Alphabet:

```bash
LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 40
```

Beim empfohlenen Weg über Einzelfelder (siehe unten) spielt das keine Rolle —
dort wird das Passwort nie geparst.

### 3. Connection-String als GitHub-Secret hinterlegen

**Der Session-Pooler ist Pflicht, nicht Geschmackssache.** `db.<ref>.supabase.co`
ist nur über IPv6 erreichbar, GitHub-Runner sprechen IPv4 — eine Direktverbindung
läuft in einen Timeout. Und es muss der **Session**-Modus (Port 5432) sein, nicht
der Transaction-Modus (6543): die Proben brauchen `SET LOCAL ROLE` innerhalb
einer Transaktion.

Den Host im Supabase-Dashboard unter **Connect → Session pooler** ablesen. Der
Benutzername braucht dort zwingend die Projekt-Referenz: `<rolle>.<projekt-ref>`,
also z. B. `voxera_ci_verifier.abcdefghijklmnop`. Der bloße Rollenname reicht
nicht — der Pooler kann die Verbindung sonst keinem Projekt zuordnen.

**Empfohlen: Einzelfelder.** Damit entfällt jede URL-Kodierung, und Sonderzeichen
im Passwort können nichts kaputt machen. Im Environment `production-db-readonly`
anlegen:

| Secret | Wert |
| --- | --- |
| `SUPABASE_DB_HOST` | der Session-Pooler-Host aus dem Dashboard |
| `SUPABASE_DB_PORT` | `5432` |
| `SUPABASE_DB_USER` | `voxera_ci_verifier.<projekt-ref>` |
| `SUPABASE_DB_PASSWORD` | das gesetzte Passwort, unverändert |

**Alternativ: Connection-String** als `SUPABASE_DB_URL_CI_VERIFIER` im selben
Environment. Dann müssen `/`, `@`, `%`, `:` und `#` im Passwort prozent-kodiert
werden:

```
postgresql://voxera_ci_verifier.<projekt-ref>:<passwort>@<pooler-host>:5432/postgres?sslmode=require
```

Sind beide gesetzt, gewinnen die Einzelfelder.

Das eigene Environment sorgt dafür, dass jeder Zugriff auf die Produktions-
Zugangsdaten einzeln auditierbar ist und unabhängig entzogen werden kann.

### Verbindung außerhalb von CI prüfen

Wenn der Check `password authentication failed` meldet, ist meist der
Connection-String schuld und nicht die Datenbank. Direkt nachprüfbar mit:

```bash
PGPASSWORD='<passwort>' psql -h <pooler-host> -p 5432 \
  -U voxera_ci_verifier.<projekt-ref> -d postgres -c 'select current_user'
```

Klappt das und CI nicht, liegt es an der Kodierung im Secret — dann auf die
Einzelfelder wechseln.

### 4. Probelauf

Actions → *DB Security Invariants (Produktion)* → **Run workflow**. Das Ergebnis
steht als Tabelle in der Step Summary.

Erster erfolgreicher Lauf am 2026-08-08 gegen die Produktions-DB:
**210 Invarianten bestanden, 0 verletzt, 50 übersprungen** (übersprungen sind
leere Tabellen, Tabellen ohne fremde Mandantenzeilen, die anon-INSERT-Pfade und
die elf Migrationen ohne Ledger-Eintrag — jeweils mit Begründung im Bericht).

## Was geprüft wird

| Gruppe | Prüft | Art |
| --- | --- | --- |
| A | `authenticated` mit fremdem Subject sieht in keiner Mandantentabelle eine Zeile | Verhalten |
| B | `anon` sieht nichts und darf nichts | Verhalten |
| C | ein echter Mandant sieht **genau** seine eigenen Zeilen — und sieht überhaupt welche | Verhalten |
| D | verbotene Schreibpfade enden in `42501` | Verhalten |
| B2 | jeder tatsächlich gehaltene anon-Schreibpfad (UPDATE/DELETE) trifft null Zeilen | Verhalten |
| D2 | ein Nicht-Admin ändert keine fremden Zeilen (RLS auf UPDATE und DELETE) | Verhalten |
| E | `is_admin()` löst eindeutig auf, `current_customer_id()` löst korrekt auf, `anon` kommt an keine der Funktionen | Verhalten |
| F | Policies, Grants, Spalten-Allowlists, `search_path`-Pinning, Funktionssignaturen | Katalog |
| G | Migrations-Ledger ↔ Repo in beide Richtungen (Richtung „angewandt?" nur für Migrationen ab dem Ledger, Richtung „Repo-Datei vorhanden?" gegen den gesamten Bestand in `supabase/migrations/`) | Katalog |
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

### Warum der Check nicht auf Pull Requests läuft

Bei einem PR checkt `actions/checkout` den PR-Stand aus, und *danach* bekommt der
Job das Produktions-Secret. Der PR könnte also den Runner oder eine SQL-Datei so
ändern, dass sie den Connection-String ausgibt oder DML außerhalb des Rollbacks
ausführt. Der Fork-Filter half dagegen nicht — bei Same-Repo-PRs greift er nicht,
und genau die sind der Fall. Review-CI darf kein Weg zu Produktionszugriff sein.

Zweiter Grund: der Ledger-Check würde jeden Migrations-PR rot färben. Die
Migration liegt im PR-Baum, ist auf Produktion aber korrekt noch nicht angewandt
— grün zu bekommen wäre er nur, indem man ungemergten Code vorab einspielt.

Getriggert wird deshalb auf `push` nach `main`, alle 6 h per Cron und manuell.
Der Verlust ist gering: ein PR-Lauf hätte ohnehin nur bereits bestehenden Drift
gefunden, und den findet der 6-Stunden-Lauf auch.

### Warum keine Standard-Sichten für Grants

Die Grant-Sichten des Informationsschemas filtern auf `enabled_roles`. Die
CI-Rolle ist `NOINHERIT`, also sind `anon` und `authenticated` dort **nicht**
enthalten — jede Grant-Abfrage darüber liefert unter dieser Rolle null Zeilen.
Die erste Fassung lief genau in diese Falle: „0 statt 4 Spalten" und ein leerer
Baseline-Diff, in dem keine Ausweitung mehr aufgefallen wäre. Aufgefallen ist es
nur, weil sich die Rolle per `set role` nachstellen lässt.

Alle Grant-Abfragen gehen deshalb über `pg_catalog` (`has_table_privilege`,
`has_column_privilege`, `aclexplode`) — die kennen die Filterung nicht. Der
Runner hat zusätzlich einen Wachhund: eine Enumeration, die *nichts* liefert,
obwohl die Baseline Tabellen kennt, wird als kaputte Abfrage gemeldet und nicht
als Rechteabbau durchgewinkt.

### Warum die Proben produktionssicher sind

- Alles läuft in **einer** Transaktion, die zurückgerollt wird. Die
  Verhaltensdatei enthält kein einziges `commit`.
- Schreibproben tragen `where false` und berühren garantiert null Zeilen —
  selbst dann, wenn die Rechteprüfung fälschlich durchließe.
- Die Transaktion ist bewusst **nicht** read-only: dort schlägt jeder
  Schreibversuch mit `25006` fehl, **bevor** Postgres die Rechte prüft. Die
  Probe könnte „durch Rechte verweigert" nicht von „durch read-only verweigert"
  unterscheiden und würde eine kaputte Berechtigung als bestanden melden.
- Ausnahme sind die Proben B2 und D2: ob eine Policy hält, lässt sich nur durch
  echtes DML feststellen — eine nie zutreffende Bedingung würde nur den Grant
  prüfen, und der ist hier bekanntermaßen vorhanden. Greift RLS wie vorgesehen,
  trifft die Anweisung null Zeilen und es feuert kein Trigger. `customers` und
  `users` sind wegen ihrer Kaskaden ausgenommen, Tabellen über 50 000 Zeilen
  werden übersprungen statt still riskant ausgeführt.
- Beide Proben sind auf den Zensus gegatet: eine Tabelle ohne fremde Zeilen kann
  die Probe nicht bestehen, sie kann sie nur nicht widerlegen — das ist ein
  **SKIP**, kein PASS. Ohne dieses Gate meldeten `ai_change_requests` und
  `voxera_cases` PASS, ohne je etwas gemessen zu haben.
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
Änderung als SQL-Datei in `supabase/migrations/` nachdokumentieren, damit sie
reproduzierbar wird. Der Dateiname trägt dabei die Version aus dem Ledger:
`<14-stellige Version>_<name>.sql`. Wurde dieselbe Datei in mehreren Schritten
angewandt, kommen die übrigen Versionen als `ledgerAliases` in
`supabase/verification/db-security-baseline.json`.

Häufigster Auslöser ist nicht der böse Eingriff, sondern **Anwenden vor dem
Merge**: eine Migration wird auf einem Feature-Branch auf Produktion
eingespielt und der Branch merged erst später. Bis dahin kennt `main` die
Datei nicht, und der Check meldet zutreffend eine Waise — die Datenbank trägt
Schema, das aus `main` nicht reproduzierbar ist. Auflösung ist entweder der
Merge oder, wenn der Feature-Code noch nicht so weit ist, die SQL-Datei allein
unter demselben Pfad nach `main` zu ziehen. Der Ledger bildet den Stand der
Produktions-Datenbank ab, nicht den Fortschritt eines Branches.

**Gruppe H** — `anon` oder `authenticated` hat neue Tabellenrechte bekommen.
Meist ein Supabase-Default auf einer neu angelegten Tabelle. Entweder zurück-
nehmen oder, wenn beabsichtigt, in `db-security-baseline.json` aufnehmen — mit
Begründung im Commit.

**Bekannte Lücke:** anon-INSERT wird *nicht* behavioral geprüft. Der
WITH-CHECK-Zweig einer INSERT-Policy läuft nur für eine tatsächlich eingefügte
Zeile; dafür müsste die Probe je Tabelle eine gültige Zeile konstruieren (NOT
NULL, Fremdschlüssel, Constraints) und echt auf Produktion schreiben. Der Check
weist das als SKIP mit Begründung aus, statt ein PASS zu melden, das nichts
gemessen hat. Überwacht ist dort nur der Grant über die Baseline.

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
