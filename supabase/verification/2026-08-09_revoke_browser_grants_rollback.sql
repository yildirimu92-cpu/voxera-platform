-- Rueckbau zu 2026-08-09_revoke_browser_grants_rls_no_policy.sql.
--
-- Stellt die Default-Privileges wieder her, die Supabase neuen Tabellen in
-- public ohnehin gibt. Nur sinnvoll, wenn sich herausstellt, dass eine dieser
-- Tabellen doch ueber den Browser gelesen werden soll -- dann gehoert
-- allerdings eine Policy dazu, nicht nur der Grant.

begin;

grant select, insert, update, delete on public.credit_note_sequences             to anon, authenticated;
grant select, insert, update, delete on public.elevenlabs_sync_log               to anon, authenticated;
grant select, insert, update, delete on public.invoice_financial_actions         to anon, authenticated;
grant select, insert, update, delete on public.invoice_refunds                   to anon, authenticated;
grant select, insert, update, delete on public.telephony_number_assignment_audit to anon, authenticated;
grant select, insert, update, delete on public.telephony_numbers                 to anon, authenticated;
grant select, insert, update, delete on public.voxera_addons                     to anon, authenticated;
grant select, insert, update, delete on public.voxera_voices                     to anon, authenticated;

commit;
