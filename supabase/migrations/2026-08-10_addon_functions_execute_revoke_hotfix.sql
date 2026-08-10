-- Hotfix: EXECUTE fuer anon/authenticated auf beiden Addon-Funktionen entziehen.
--
-- Angewendet auf Produktion am 10.08. um 14:0x UTC, auf ausdrueckliche
-- Freigabe und bewusst vor dem Repo-Commit -- ein Rechte-Entzug bringt nichts
-- Neues nach Produktion, er nimmt etwas weg, das offen stand. Diese Datei
-- zieht den Repo-Stand unmittelbar nach.
--
-- ZWEI URSACHEN, nicht eine:
--
--   1. `activate_customer_addon_v1` -- reines Default-Privilege-Erbe. Die
--      Migration widerrief nur von PUBLIC und grantete an `service_role`.
--      Supabase vergibt in `public` per ALTER DEFAULT PRIVILEGES aber
--      namentliche EXECUTE-Grants an `anon`, `authenticated` und
--      `service_role`. Ein PUBLIC-Revoke entfernt die nicht.
--
--   2. `customer_has_addon` -- zusaetzlich ein eigener Fehler: die Migration
--      grantete EXECUTE ausdruecklich an `authenticated`. Der `anon`-Zugriff
--      stammte auch hier aus den Default-Privilegien.
--
-- Beide Funktionen sind SECURITY DEFINER und umgehen damit die RLS-Policies
-- auf `customer_addons`. Fuer Nicht-Admins existieren auf dieser Tabelle nur
-- SELECT-Policies; vor der Einfuehrung von `activate_customer_addon_v1` gab es
-- fuer sie also gar keinen Schreibweg. Die Funktion oeffnete einen -- mit dem
-- oeffentlichen Anon-Key erreichbar, ohne Mandantenpruefung, auf beliebige
-- `customer_id`. Nachgewiesen per `set local role anon`: die Funktion lief bis
-- zur Fachlogik durch (`addon_not_available`) statt an der Berechtigung zu
-- scheitern.
--
-- Idiom nach dem Vorbild von 2026-07-28_p0_security_foundation.sql:14-17.

begin;

revoke all privileges on function public.activate_customer_addon_v1(text, text, integer) from public;
revoke all privileges on function public.activate_customer_addon_v1(text, text, integer) from anon;
revoke all privileges on function public.activate_customer_addon_v1(text, text, integer) from authenticated;
grant execute on function public.activate_customer_addon_v1(text, text, integer) to service_role;

revoke all privileges on function public.customer_has_addon(text, text) from public;
revoke all privileges on function public.customer_has_addon(text, text) from anon;
revoke all privileges on function public.customer_has_addon(text, text) from authenticated;
grant execute on function public.customer_has_addon(text, text) to service_role;

commit;

-- Gegenprobe nach dem Anwenden (erwartet: beide false):
--   select has_function_privilege('anon',
--     'public.activate_customer_addon_v1(text,text,integer)','EXECUTE');
--   select has_function_privilege('authenticated',
--     'public.customer_has_addon(text,text)','EXECUTE');
--
-- Und der Vollbeweis ueber den PostgREST-Pfad:
--   begin; set local role anon;
--   select public.activate_customer_addon_v1('x','y',1);
--   rollback;
-- Erwartet: ERROR 42501 permission denied for function.
