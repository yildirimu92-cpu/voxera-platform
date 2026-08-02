begin;

alter table public.voxera_voices
  add column if not exists preview_text text;

update public.voxera_voices
set preview_text = 'Grüezi, ich bin Ihre digitale Telefonassistenz von Voxera. Ich nehme Ihre Anrufe freundlich und zuverlässig entgegen. Wie kann ich Ihnen helfen?'
where preview_text is null or btrim(preview_text) = '';

do $voice_preview_constraint$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'voxera_voices_preview_text_length'
      and conrelid = 'public.voxera_voices'::regclass
  ) then
    alter table public.voxera_voices
      add constraint voxera_voices_preview_text_length
      check (preview_text is null or char_length(preview_text) between 20 and 500);
  end if;
end
$voice_preview_constraint$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'voice-previews',
  'voice-previews',
  true,
  5242880,
  array['audio/mpeg']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

commit;
