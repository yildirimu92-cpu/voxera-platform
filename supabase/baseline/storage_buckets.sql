-- Storage-Buckets — NICHT Teil von `supabase db dump --schema public`.
--
-- Buckets liegen in `storage.buckets`, nicht im public-Schema. Ein Schema-Dump
-- von public erfasst sie deshalb nicht. Ohne diese Datei hat Staging zwar ein
-- vollstaendiges Datenmodell, aber keinen einzigen Bucket — und jeder Upload-
-- Pfad (Avatare, Rechnungs-PDFs, Sprachvorschauen, Anruf-Aufzeichnungen)
-- scheitert dort mit einem Fehler, der wie ein Rechteproblem aussieht.
--
-- Stand Produktion (ulcofbgrovgcvowdjrge), ausgelesen 2026-08-08.
-- Idempotent: mehrfaches Ausfuehren ist unschaedlich.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars',         'avatars',         true,  null,     null),
  ('call-recordings', 'call-recordings', false, null,     null),
  ('e-mail-asset',    'e-mail-asset',    true,  null,     null),
  ('invoice-pdfs',    'invoice-pdfs',    true,  10485760, null),
  ('legal',           'legal',           false, null,     null),
  ('Public',          'Public',          true,  null,     null),
  ('voice-previews',  'voice-previews',  true,  5242880,  array['audio/mpeg'])
on conflict (id) do update set
  name              = excluded.name,
  public            = excluded.public,
  file_size_limit   = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Kontrolle: muss 7 Zeilen liefern, `Public` mit grossem P.
-- select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id;

-- HINWEIS: Die RLS-Policies auf storage.objects sind hier bewusst NICHT
-- enthalten. Sie liegen im storage-Schema und muessen separat verglichen
-- werden:
--   select policyname, cmd, qual, with_check from pg_policies
--   where schemaname='storage' and tablename='objects' order by policyname;
-- Auf beiden Projekten ausfuehren und die Ergebnisse gegenueberstellen.
