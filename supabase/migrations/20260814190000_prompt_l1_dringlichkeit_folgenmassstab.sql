-- L1-Master-Prompt: Dringlichkeit vom Signal auf die Folge umstellen.
--
-- AUSGANGSLAGE (gemessen, nicht vermutet)
--
-- Auf 58 % der Anrufe blieb `calls.urgency` leer. Ursache ist weder ein
-- fehlendes Feld noch ein fehlendes Kriterium: Die Einstufung steht an DREI
-- Stellen, und alle drei binden sie an ein Signal des Anrufers.
--
--   L1, OPTIONAL-Block   "- Dringlichkeit (wenn Anrufer Hinweise gibt)"
--   L1, PRIORISIERUNG    "Bei Dringlichkeits-Signalen:"
--   Feldbeschreibung     "Nur aus Anrufer-Aussagen ableiten."
--                        (elevenlabs-agent-config.js, eigene Aenderung)
--
-- Das Modell tut exakt, was dasteht. Wer nicht sagt "es ist dringend", bekommt
-- keine Einstufung. Das war folgenlos, solange die Dringlichkeit ein Zusatz
-- war -- seit die Team-SMS kein Anliegen mehr traegt (Datenresidenz, siehe
-- docs/BEFUND_TWILIO_DATENRESIDENZ_2026-08-11.md), ist sie die einzige Angabe,
-- die "jetzt oder morgen" beantwortet.
--
-- Diese Migration ersetzt die Signalbedingung durch einen Folgen-Massstab.
-- Sie tritt AN DIE STELLE der alten Regel, sie steht nicht daneben.
--
--
-- WARUM CHIRURGISCH UND NICHT ALS GANZES
--
-- `system_config.prompt_master_l1` hat keine Oberflaeche, keine Versionierung
-- und keine Vorschau (offener Punkt #929). Der Text wird direkt auf der
-- Datenbank gepflegt, und keine Migration dieses Repositories hat je seinen
-- INHALT geaendert -- nur Rechte und Fingerprint.
--
-- Ein vollstaendiges Ueberschreiben wuerde deshalb jede Aenderung verwerfen,
-- die seit dem Schreiben dieser Datei von Hand gemacht wurde. Stattdessen drei
-- gezielte Ersetzungen mit Ankerpruefung: Fehlt ein Anker, bricht die Migration
-- ab, statt still nichts zu tun. Eine Migration, die bei "schon angewandt" und
-- bei "Anker nicht gefunden" gleich aussieht, ist kein Ergebnis.
--
--
-- WAS DIESE MIGRATION NICHT LEISTET
--
-- Die Feldbeschreibung der strukturierten Auswertung liegt NICHT hier und
-- nicht im Prompt, sondern in `platform_settings.data_collection`. Der Sync
-- sendet sie nicht (buildSyncPatch in elevenlabs-agent-config.js sendet
-- Prompt, Werkzeuge, Begruessung, Stimme, Datenschutz -- sonst nichts). Sie
-- wirkt nur beim ANLEGEN eines Agenten.
--
-- Fuer bestehende Agenten braucht es also zusaetzlich einen Handgriff in der
-- ElevenLabs-Oberflaeche oder eine Erweiterung des Syncs. Diese Migration
-- allein aendert die Quote auf einem bestehenden Agenten nicht -- sie sorgt
-- dafuer, dass der Assistent die noetigen Angaben ERFRAGT, damit die
-- Auswertung ueberhaupt etwas zu bewerten hat.

begin;

-- ── Sicherung ───────────────────────────────────────────────────────────────
-- Gleiches Muster wie prompt_master_l1__sicherung_2026-08-10_vor_c25_nachzug.
-- Ohne Oberflaeche und ohne Versionierung ist die Kopie der einzige Rueckweg.
insert into public.system_config (key, value)
select 'prompt_master_l1__sicherung_2026-08-14_vor_folgenmassstab', value
from public.system_config
where key = 'prompt_master_l1'
on conflict (key) do nothing;


-- ── Ankerpruefung vor der Aenderung ─────────────────────────────────────────
do $$
declare
  v text;
begin
  select value into v from public.system_config where key = 'prompt_master_l1';
  if v is null then
    raise exception 'Abbruch: system_config.prompt_master_l1 existiert nicht.';
  end if;

  if position(E'- Dringlichkeit (wenn Anrufer Hinweise gibt)\r\n' in v) = 0 then
    raise exception 'Abbruch: Anker 1 (OPTIONAL-Zeile) nicht gefunden. L1 wurde seit dem 14.08. veraendert -- bitte von Hand pruefen.';
  end if;
  if position(E'Bei Dringlichkeits-Signalen:\r\n' in v) = 0 then
    raise exception 'Abbruch: Anker 2 (PRIORISIERUNG) nicht gefunden. L1 wurde seit dem 14.08. veraendert -- bitte von Hand pruefen.';
  end if;
  if position(E'Was als Notfall gilt definiert der Branchen-Layer.' in v) = 0 then
    raise exception 'Abbruch: Anker 3 (Branchen-Layer-Verweis) nicht gefunden. L1 wurde seit dem 14.08. veraendert -- bitte von Hand pruefen.';
  end if;
end $$;


-- ── 1. Dringlichkeit raus aus dem OPTIONAL-Block ────────────────────────────
-- Sie war dort als "wenn Anrufer Hinweise gibt" gefuehrt, also ausdruecklich
-- als Kuer. Sie ist jetzt Pflicht und steht unter PRIORISIERUNG.
update public.system_config
   set value = replace(value, E'- Dringlichkeit (wenn Anrufer Hinweise gibt)\r\n', '')
 where key = 'prompt_master_l1';


-- ── 2. PRIORISIERUNG: Folgen-Massstab statt Signalreaktion ──────────────────
-- Die beiden Grenzfaelle stehen bewusst im Text und nicht nur die Definition:
-- Sie sind die einzige Stelle, an der der Massstab vorgefuehrt statt behauptet
-- wird. Ohne sie bleibt eine Definition ohne Beispiel.
--
-- Die Nachfrage-Anweisung ist der Teil, den nur der Prompt leisten kann: Die
-- Auswertung kann nur bewerten, was im Transkript steht. Beim Abschleppdienst
-- entscheidet der Standort ueber die Stufe -- wird er nicht erfragt, ist die
-- Frage nicht entscheidbar.
update public.system_config
   set value = replace(
     value,
     E'Bei Dringlichkeits-Signalen:\r\n',
     E'Stufe JEDES Anliegen ein — nach der Folge des Wartens, nicht danach, ob der Anrufer Eile äussert.\r\n'
     || E'\r\n'
     || E'- hoch: Warten verursacht Schaden, der später nicht mehr behebbar ist, oder Menschen sind gefährdet.\r\n'
     || E'- mittel: Warten kostet Geld, Termine oder Komfort, ohne bleibenden Schaden.\r\n'
     || E'- niedrig: Warten kostet nichts ausser Zeit.\r\n'
     || E'\r\n'
     || E'Nicht das Thema entscheidet, sondern die Lage. Dasselbe Fahrzeug mit demselben Defekt ist hoch auf der Autobahn und niedrig in der eigenen Garage. Dieselbe Menge Wasser ist mittel mit einem Eimer darunter und hoch ohne Auffangmöglichkeit auf Parkett.\r\n'
     || E'\r\n'
     || E'Frage aktiv nach, was du für die Einstufung brauchst — beim Fahrzeug den Standort, beim Wasserschaden, ob es aufgefangen wird. Ohne diese Angabe ist die Stufe nicht bestimmbar.\r\n'
     || E'\r\n'
     || E'Bei hoher Dringlichkeit:\r\n'
   )
 where key = 'prompt_master_l1';


-- ── 3. Branchen-Layer bleibt ergaenzend, nicht ersetzend ────────────────────
-- Vorher las sich die Zeile so, als definiere der Branchen-Layer die
-- Dringlichkeit ueberhaupt. Er definiert jetzt nur noch, was ZUSAETZLICH als
-- Notfall gilt -- der Massstab steht in L1 und gilt fuer alle 19 Vorlagen,
-- auch fuer `generic`, das heute keinen Notfallbegriff fuehrt.
update public.system_config
   set value = replace(
     value,
     'Was als Notfall gilt definiert der Branchen-Layer.',
     'Was darüber hinaus als Notfall gilt, definiert der Branchen-Layer.'
   )
 where key = 'prompt_master_l1';


-- ── Nachweis ────────────────────────────────────────────────────────────────
do $$
declare
  v text;
begin
  select value into v from public.system_config where key = 'prompt_master_l1';

  if position(E'- Dringlichkeit (wenn Anrufer Hinweise gibt)' in v) > 0 then
    raise exception 'Nachweis fehlgeschlagen: die OPTIONAL-Zeile steht noch.';
  end if;
  if position('Bei Dringlichkeits-Signalen:' in v) > 0 then
    raise exception 'Nachweis fehlgeschlagen: die Signalbedingung steht noch.';
  end if;
  if position('Stufe JEDES Anliegen ein' in v) = 0 then
    raise exception 'Nachweis fehlgeschlagen: der Folgen-Massstab fehlt.';
  end if;
  if position('hoch auf der Autobahn und niedrig in der eigenen Garage' in v) = 0
     or position('mittel mit einem Eimer darunter und hoch' in v) = 0 then
    raise exception 'Nachweis fehlgeschlagen: mindestens ein Grenzfall fehlt.';
  end if;
  if position('Frage aktiv nach' in v) = 0 then
    raise exception 'Nachweis fehlgeschlagen: die Nachfrage-Anweisung fehlt.';
  end if;
  if not exists (select 1 from public.system_config
                 where key = 'prompt_master_l1__sicherung_2026-08-14_vor_folgenmassstab') then
    raise exception 'Nachweis fehlgeschlagen: keine Sicherung angelegt.';
  end if;

  raise notice 'L1: Dringlichkeit auf Folgen-Massstab umgestellt, Sicherung liegt vor.';
end $$;

commit;

-- Ruecknahme:
--
--   update public.system_config
--      set value = (select value from public.system_config
--                   where key = 'prompt_master_l1__sicherung_2026-08-14_vor_folgenmassstab')
--    where key = 'prompt_master_l1';
--
-- Achtung: Das nimmt auch jede Aenderung zurueck, die nach dieser Migration
-- von Hand am Prompt gemacht wurde. Ohne Versionierung (#929) laesst sich das
-- nicht feiner aufloesen.
