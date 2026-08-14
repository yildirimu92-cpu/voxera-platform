-- READ ONLY: vor 20260814230000_system_config_historie.sql laufen lassen.
-- Haelt den Ist-Zustand als Rollback-Evidenz fest -- und belegt die zwei
-- Aussagen, auf denen die Migration beruht (#1000).

-- 1. Der Bestand. Fuenf Zeilen erwartet, zwei davon handgemachte Sicherungen.
select 'A_bestand' as sec,
  key as detail,
  'zeichen=' || length(value)::text
  || ' updated_at=' || coalesce(updated_at::text, 'NULL')
  || ' ist_sicherung=' || (key ~ '__(backup|sicherung)_')::text as info
from public.system_config

union all
-- 2. Die Begruendung fuer Trigger 1: `updated_at` der Live-Zeile behauptet
--    einen Zeitpunkt VOR der Sicherung, obwohl der Inhalt sich seither
--    unterscheidet. Erwartet: inhalt_gleich=false, live_aelter_als_sicherung=true.
--    Genau diese Kombination ist der Beweis, dass updated_at nicht nachgefuehrt
--    wird. Faellt sie anders aus, ist die Annahme der Migration widerlegt und
--    der Kommentar dort gehoert korrigiert, bevor sie laeuft.
select 'B_updated_at_luegt',
  'prompt_master_l1 gegen Sicherung 2026-08-10',
  'inhalt_gleich=' || (live.value = sicherung.value)::text
  || ' live_updated_at=' || live.updated_at::text
  || ' sicherung_updated_at=' || sicherung.updated_at::text
  || ' live_aelter_als_sicherung=' || (live.updated_at < sicherung.updated_at)::text
from public.system_config live
join public.system_config sicherung
  on sicherung.key = 'prompt_master_l1__sicherung_2026-08-10_vor_c25_nachzug'
where live.key = 'prompt_master_l1'

union all
-- 3. Es gibt heute keinen Trigger. Erwartet: keine Zeile ausser dieser.
select 'C_trigger_vorher',
  coalesce(t.tgname, '(keiner)'),
  coalesce(pg_get_triggerdef(t.oid), 'system_config traegt keinen eigenen Trigger')
from pg_catalog.pg_class c
left join pg_catalog.pg_trigger t
  on t.tgrelid = c.oid and not t.tgisinternal
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'system_config'

union all
-- 4. Die Historientabelle darf noch nicht existieren. Erwartet: vorhanden=false.
select 'D_zieltabelle',
  'system_config_history',
  'vorhanden=' || (to_regclass('public.system_config_history') is not null)::text

union all
-- 5. Rechtelage der Quelltabelle -- die Historie soll dieselbe Leseregel
--    bekommen. Erwartet: rls=true, authenticated darf SELECT und sonst nichts.
select 'E_rechte_quelle',
  'system_config',
  'rls=' || c.relrowsecurity::text
  || ' policies=' || (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'system_config')
  || ' authenticated_select=' || pg_catalog.has_table_privilege('authenticated', 'public.system_config', 'SELECT')::text
  || ' authenticated_update=' || pg_catalog.has_table_privilege('authenticated', 'public.system_config', 'UPDATE')::text
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'system_config'

order by 1, 2;
