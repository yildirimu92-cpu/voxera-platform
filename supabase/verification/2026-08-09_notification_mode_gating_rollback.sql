-- Rueckbau zu 2026-08-09_notification_mode_gating.sql.
--
-- Stellt Defaults und Spaltenwerte auf den Stand vor der Migration zurueck.
--
-- Die drei Booleans werden aus der Sicherung
-- public.customers_notification_backup_20260809 zurueckgespielt, nicht neu
-- berechnet: ihr Vorher-Stand war der Backfill von 2026-04-07 plus vier Monate
-- Drift und laesst sich aus notification_mode nicht ableiten. Fehlt die
-- Sicherungstabelle, bricht dieses Skript bewusst ab, statt zu raten.
--
-- Wichtig: das aendert am Versand nichts, solange call-notification.js auf
-- notification_mode gatet. Wer den alten Versandweg zurueck will, braucht
-- zusaetzlich einen Revert des Codes -- dieses Skript allein stellt nur die
-- Daten her, nicht das Verhalten.

begin;

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public'
      and table_name = 'customers_notification_backup_20260809'
  ) then
    raise exception
      'Sicherung customers_notification_backup_20260809 fehlt - Rueckbau abgebrochen, '
      'die Vorher-Werte sind ohne sie nicht rekonstruierbar.';
  end if;
end $$;

update public.customers c
set
  notification_active      = b.notification_active,
  new_log_email_active     = b.new_log_email_active,
  missed_call_email_active = b.missed_call_email_active,
  notification_mode        = b.notification_mode,
  updated_at               = now()
from public.customers_notification_backup_20260809 b
where b.id = c.id;

alter table public.customers alter column notification_mode        set default 'callback_only';
alter table public.customers alter column notification_active      set default true;
alter table public.customers alter column new_log_email_active     set default true;
alter table public.customers alter column missed_call_email_active set default false;

comment on column public.customers.notification_active is null;
comment on column public.customers.new_log_email_active is null;
comment on column public.customers.missed_call_email_active is null;
comment on column public.customers.notification_mode is null;
comment on column public.customers.in_app_notification_settings is null;

commit;
