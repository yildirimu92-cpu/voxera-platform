-- Rollback zu 20260811094500_default_privileges_root_and_dead_grants.sql
--
-- Stellt den am 2026-08-11 gemessenen Zustand der Produktions-DB wieder her.
-- Nur fuer den Fall, dass eine Ansicht nach der Anwendung hoerbar bricht --
-- gerechnet wird damit nicht: geschnitten wurden ausschliesslich Rechte, die
-- keine permissive Policy bedienen kann, die also heute schon nicht
-- durchkommen. Was sich aendern kann, ist die Fehlerform (leere Liste ->
-- "permission denied"), nicht das Ergebnis.
--
-- WARNUNG: dieses Skript holt bewusst einen unsicheren Zustand zurueck. Die
-- Default-Privilegien in Teil 1 sind die Wurzel, aus der der ganze Bestand
-- entstanden ist. Wer das hier ausfuehrt, sollte danach einen Termin fuer
-- den zweiten Anlauf haben, keinen Haken.

begin;

-- Teil 1 zurueck: die Default-Privilegien wieder aufweiten.
alter default privileges for role postgres in schema public
  grant insert, update, delete, truncate, references, trigger, maintain
  on tables to anon, authenticated;

-- Achtung, kein exakter Spiegel: vor dieser Migration vergab die Regel KEIN
-- TRUNCATE an anon/authenticated (das fiel am 2026-08-09 im Truncate-Sweep).
-- Das `truncate` oben stellt also mehr wieder her als weggenommen wurde. Wer
-- exakt den Stand vom 2026-08-11 will, laesst `truncate` in der Zeile oben
-- weg -- und sollte das auch tun. Es steht nur deshalb drin, weil ein
-- Rollback, der die Zeile stillschweigend anders schreibt als das Original,
-- schlimmer ist als einer, der die Abweichung benennt.

-- Teil 2 zurueck: der Bestand.
grant insert, update, delete, references, trigger, maintain
  on public.admins to anon, authenticated;
grant references, trigger, maintain
  on public.admin_emails to anon, authenticated;

grant select, insert, update, delete, references, trigger, maintain
  on public.industry_templates to anon;
grant select, insert, update, delete, references, trigger, maintain
  on public.outbox_events to anon;
grant select, insert, update, delete, references, trigger, maintain
  on public.plan_config to anon;

grant insert, update, delete, references, trigger, maintain
  on public.minutes_topups to anon, authenticated;
grant insert, delete, references, trigger, maintain
  on public.users to anon, authenticated;
grant delete, references, trigger, maintain
  on public.calls to authenticated;
grant references, trigger, maintain
  on public.customers to authenticated;

grant references, trigger, maintain on public.customer_tasks     to anon, authenticated;
grant references, trigger, maintain on public.feature_flags      to anon, authenticated;
grant references, trigger, maintain on public.invoice_items      to anon, authenticated;
grant references, trigger, maintain on public.invoice_sequences  to anon, authenticated;
grant references, trigger, maintain on public.offer_acceptances  to anon, authenticated;
grant references, trigger, maintain on public.offer_events       to anon, authenticated;
grant references, trigger, maintain on public.offer_sequences    to anon, authenticated;
grant references, trigger, maintain on public.onboarding         to anon, authenticated;
grant references, trigger, maintain on public.push_subscriptions to anon, authenticated;
grant references, trigger, maintain on public.voxera_cases       to anon, authenticated;

commit;
