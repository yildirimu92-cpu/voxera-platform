-- Nachpruefung nach 2026-08-08_call_summary_correction.sql
-- (Etappe 4 Teil B / Feature 3, Ledger-Eintrag: call_summary_correction).
--
-- Ausgefuehrt am 08.08.2026 gegen Produktion (ulcofbgrovgcvowdjrge).
-- Ergebnisse siehe docs/ANFRAGEN_DETAIL_TEIL_B_BESTANDSAUFNAHME_2026-08-08.md,
-- Abschnitt "Abnahme Feature 3".

-- ── 1. Spalten vorhanden, Typen korrekt ─────────────────────────────────────
-- Erwartet: call_summary_corrected text, _at timestamptz, _by text.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'calls'
  and column_name like 'call_summary%'
order by column_name;

-- ── 2. Das spaltengenaue UPDATE-Recht wurde NICHT erweitert ─────────────────
-- Erwartet: exakt dashboard_status, notes_customer_voxera, read_at, updated_at.
-- Die drei Korrekturspalten duerfen hier nicht auftauchen: geschrieben wird
-- nur ueber call-save-summary-correction mit Service-Role.
select string_agg(column_name, ', ' order by column_name) as authenticated_update_cols
from information_schema.column_privileges
where table_schema = 'public'
  and table_name = 'calls'
  and grantee = 'authenticated'
  and privilege_type = 'UPDATE';

-- ── 3. Rechte punktgenau ────────────────────────────────────────────────────
-- Die Korrektur ist fuer den Browser lesbar, aber nicht schreibbar.
select
  has_column_privilege('authenticated','public.calls','call_summary_corrected','UPDATE')    as korrektur_update_erwartet_false,
  has_column_privilege('authenticated','public.calls','call_summary_corrected_at','UPDATE') as korrektur_at_update_erwartet_false,
  has_column_privilege('authenticated','public.calls','call_summary_corrected_by','UPDATE') as korrektur_by_update_erwartet_false,
  has_column_privilege('authenticated','public.calls','call_summary','UPDATE')              as ki_fassung_update_erwartet_false,
  has_column_privilege('authenticated','public.calls','notes_customer_voxera','UPDATE')     as notiz_update_erwartet_true,
  has_column_privilege('authenticated','public.calls','call_summary_corrected','SELECT')    as korrektur_select_erwartet_true;

-- ── 4. Verhaltenstest: ueberlebt die Korrektur einen zweiten Webhook? ───────
--
-- Die Testzeile traegt customer_id = NULL und ist damit ueber RLS
-- (customer_id = public.current_customer_id()) fuer keinen Kunden sichtbar.
-- Der Block laeuft in einer Transaktion und wird zurueckgerollt.
--
-- Schritt B schreibt exakt den Patch aus call-save-summary-correction.js,
-- Schritt C exakt den updatePayload aus buildUpdatePayloadFromData()
-- (elevenlabs-post-call.js:193-283) — also das, was ein erneut gefeuerter
-- Post-Call-Webhook auf dem gematchten Datensatz schreibt.

begin;

-- A: Anruf, von der KI ausgewertet und vom Kunden abgeschlossen.
insert into public.calls (
  id, customer_id, direction, caller_phone, called_number,
  call_summary, call_summary_short, next_action,
  dashboard_status, live_status, elevenlabs_conversation_id, created_at, updated_at
) values (
  'vxtest-summary-correction-001', null, 'inbound', '+41000000000', '+41000000001',
  'KI-Fassung: Anrufer will einen Termin am Montag.',
  'KI-Fassung: Termin Montag.',
  'Rueckruf',
  'closed', 'completed', 'conv_vxtest_summary_correction_001',
  now(), now()
);

-- B: Der Kunde korrigiert. Erwartet: dashboard_status bleibt 'closed'.
update public.calls set
  call_summary_corrected    = 'Korrektur: Anrufer will Termin am Dienstag, 14 Uhr.',
  call_summary_corrected_at = now(),
  call_summary_corrected_by = '00000000-0000-0000-0000-0000000000aa',
  updated_at                = now()
where id = 'vxtest-summary-correction-001';

select 'nach Korrektur' as phase, dashboard_status, call_summary, call_summary_corrected
from public.calls where id = 'vxtest-summary-correction-001';

-- C: Der Post-Call-Webhook feuert erneut.
update public.calls set
  caller_name                = 'Frau Muster',
  call_summary               = 'KI-Fassung ZWEITER LAUF: Anrufer will einen Termin am Montag.',
  call_summary_short         = 'KI-Fassung ZWEITER LAUF: Termin Montag.',
  duration_seconds           = 92,
  callback_requested         = false,
  lead_quality               = 'warm',
  next_action                = 'Rueckruf',
  priority                   = 'medium',
  intent                     = 'termin',
  urgency                    = 'normal',
  transcript                 = 'agent: Guten Tag',
  elevenlabs_conversation_id = 'conv_vxtest_summary_correction_001',
  dashboard_status           = 'new',
  live_status                = 'completed',
  updated_at                 = now()
where id = 'vxtest-summary-correction-001';

-- Erwartet: call_summary ueberschrieben, call_summary_corrected UNVERAENDERT.
-- dashboard_status steht danach auf 'new' — das ist Bestandsverhalten des
-- Webhooks (elevenlabs-post-call.js:266 und :365 setzen es bedingungslos) und
-- passiert mit wie ohne Korrektur. Siehe offener Punkt im Plandokument.
select 'nach zweitem Webhook' as phase, dashboard_status, call_summary, call_summary_corrected
from public.calls where id = 'vxtest-summary-correction-001';

rollback;

-- ── 5. Kein Rueckstand ──────────────────────────────────────────────────────
select count(*) as testzeilen_erwartet_0
from public.calls
where id like 'vxtest%' or elevenlabs_conversation_id like 'conv_vxtest%';
