# STOP — vor `supabase link` oder `supabase db push` lesen

**80 der 105 Dateien in diesem Verzeichnis haben kein Versionspräfix. Die
Supabase-CLI würde sie deshalb für nicht angewandt halten und beim nächsten
`db push` gegen die Produktionsdatenbank erneut ausführen wollen.**

Die betroffenen Dateien heissen `2026-04-02_user_profile_provisioning.sql`
statt `20260402090000_user_profile_provisioning.sql`. Die CLI liest den
Dateinamen bis zum ersten `_` als Version und gleicht ihn gegen
`supabase_migrations.schema_migrations` ab. Ein Name ohne 14-stelligen
Zeitstempel findet dort keinen Eintrag — er gilt als offen, egal ob das DDL
längst in der Datenbank steht.

Stand 2026-08-10: 25 Dateien mit Präfix, 80 ohne. 67 der 80 sind per
`git mv` aus `supabase/sql/` hierher gewandert und waren nie als
CLI-Migrationen gedacht.

## Warum heute trotzdem nichts brennt

Es gibt aktuell keinen Weg, auf dem diese Dateien automatisch laufen:

- kein Workflow in `.github/workflows/`, der `supabase db push` aufruft
- keine `supabase/config.toml`, also kein verknüpftes Projekt
- der Netlify-Build führt nur `build-runtime-config.mjs` aus

Migrationen werden hier von Hand angewandt und danach im Ledger vermerkt.
Solange das so bleibt, ist die Namensgebung kosmetisch.

## Wann es brennt

In dem Moment, in dem jemand dieses Repo zum ersten Mal per
`supabase link` mit der Produktionsdatenbank verbindet und `db push`
tippt. Dann bietet die CLI 80 Migrationen zur Ausführung an, die
grösstenteils bereits angewandt sind. Was dabei passiert, hängt am
einzelnen Skript: `create table` ohne `if not exists` bricht ab,
`drop policy` gefolgt von `create policy` läuft durch und ist harmlos,
ein `update`- oder `delete`-Statement in einer Datenmigration läuft
ebenfalls durch und ist es nicht.

Niemand liest ein Issue, während er `supabase link` tippt. Deshalb steht
der Hinweis hier und in `AGENTS.md`.

## Vorher tun

1. `AGENTS.md`, Abschnitt *Database / Supabase / RLS Rules* lesen.
2. Issue #924 lesen — dort stehen drei skizzierte Auflösungen (Präfixe
   nachrüsten, Altbestand bewusst als nicht-CLI-verwaltet markieren, oder
   nur die Zukunft regeln). Keine davon ist entschieden.
3. Vor dem ersten `db push` einen `--dry-run` machen und die angebotene
   Liste tatsächlich lesen. Sind es ~80 Einträge, ist genau dieser Fall
   eingetreten.

## Für neue Migrationen

Immer mit 14-stelligem Zeitstempel anlegen:

```
supabase migration new beschreibender_name
```

Das erzeugt `20260810143000_beschreibender_name.sql`. Von Hand angelegte
Dateien bitte demselben Muster folgen lassen — sonst wächst der Altbestand
weiter.
