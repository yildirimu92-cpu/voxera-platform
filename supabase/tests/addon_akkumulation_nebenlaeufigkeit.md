# Nebenläufigkeitstest: Addon-Kontingente addieren

**Status: NICHT AUSGEFÜHRT.** Dieser Test ist der Beleg für die Begründung,
mit der die Akkumulationsregel aus dem JavaScript in
`activate_customer_addon_v1` verlagert wurde. Er konnte am 10.08. nicht
gefahren werden — siehe „Warum offen" unten. Bis er einmal grün lief, ist der
Nebenläufigkeitsguard konstruiert, aber ungeprüft.

## Was geprüft wird

`activate_customer_addon_v1` addiert Kontingente über
`INSERT ... ON CONFLICT (customer_id, addon_code) DO UPDATE SET quantity =
ca.quantity + excluded.quantity`. Die Addition liegt damit **innerhalb einer
einzigen Anweisung**, die eine Zeilensperre nimmt und den aktuellen Stand neu
liest. Zwei gleichzeitige Käufe müssen deshalb serialisieren: der zweite
blockiert auf der Sperre und sieht danach den festgeschriebenen Wert des
ersten.

Die Gegenthese ist die verworfene Variante — im Client lesen, rechnen,
schreiben. Dort läse der zweite Aufruf den alten Wert, bevor der erste
schreibt, und das Ergebnis wäre 3 statt 5. Genau diesen Unterschied prüft der
Test.

## Variante A — zwei psql-Sitzungen, kontrolliert

Zeigt die Blockade direkt. Zwei Terminals, gleiche Datenbank.

```sql
-- Vorbereitung (eine beliebige Sitzung)
delete from public.customer_addons
 where customer_id = '<KUNDE>' and addon_code = 'minutes_block';
```

```sql
-- Sitzung A
begin;
select * from public.activate_customer_addon_v1('<KUNDE>', 'minutes_block', 2);
-- Transaktion OFFEN lassen, Zeilensperre wird gehalten
```

```sql
-- Sitzung B (blockiert jetzt und kehrt nicht zurück)
select * from public.activate_customer_addon_v1('<KUNDE>', 'minutes_block', 3);
```

```sql
-- Sitzung C: Nachweis, dass B tatsächlich auf der Sperre wartet
select pid, state, wait_event_type, wait_event, left(query, 60) as anfrage
  from pg_stat_activity
 where query like '%activate_customer_addon_v1%'
   and pid <> pg_backend_pid();
-- Erwartet: eine Zeile mit wait_event_type = 'Lock'
```

```sql
-- Sitzung A
commit;   -- B läuft jetzt durch
```

```sql
-- Kontrolle
select quantity from public.customer_addons
 where customer_id = '<KUNDE>' and addon_code = 'minutes_block';
-- ERWARTET: 5     (bei einer Lese-dann-Schreib-Lösung stünde hier 3)
```

## Variante B — pgbench, echte Last

Prüft dieselbe Eigenschaft statistisch und erzeugt garantierte Überlappung.

`addon_akkumulation.bench`:

```sql
select public.activate_customer_addon_v1('<KUNDE>', 'minutes_block', 1);
```

```bash
psql "$DB_URL" -c "delete from public.customer_addons \
  where customer_id='<KUNDE>' and addon_code='minutes_block';"

pgbench "$DB_URL" -n -c 8 -j 4 -t 25 -f addon_akkumulation.bench

psql "$DB_URL" -c "select quantity from public.customer_addons \
  where customer_id='<KUNDE>' and addon_code='minutes_block';"
# ERWARTET: exakt 200  (8 Verbindungen x 25 Transaktionen)
```

Der Endstand muss **exakt** N sein, nicht ungefähr. Jeder Fehlbetrag ist ein
verlorener bezahlter Block.

## Warum offen

Am 10.08. auf Staging versucht, drei Wege, alle gescheitert:

1. **Parallele MCP-Aufrufe.** Vier Sitzungen à 25 Aktivierungen ergaben
   korrekt 100 in einer Zeile über vier verschiedene Backend-PIDs — aber die
   Zeitfenster überlappten sich zu **null Paaren**. Der Harness serialisiert
   die Aufrufe; die Akkumulation war damit geprüft, die Gleichzeitigkeit
   nicht.
2. **dblink.** Extension liess sich anlegen, aber `dblink_connect` scheitert
   an `2F003: password or GSSAPI delegated credentials required` — der
   Supabase-Rollenname `postgres` ist kein Superuser, und die
   DB-Zugangsdaten lagen nicht vor. Extension wurde wieder entfernt.
3. **pg_background.** Nicht installiert und auf Supabase nicht verfügbar.

Ausführbar ist der Test überall, wo eine direkte Postgres-Verbindung mit
Zugangsdaten besteht — lokale Entwicklungsumgebung, CI-Runner mit
`DATABASE_URL`, oder psql gegen Staging.

## Nachtrag zur Aufräumung

Der Versuch vom 10.08. hinterliess auf Staging nichts: Hilfstabelle
`_nebenlaeufigkeit_probe` gelöscht, Extension `dblink` entfernt, Testzeilen in
`customer_addons` gelöscht (Stand danach: 0 Zeilen).
