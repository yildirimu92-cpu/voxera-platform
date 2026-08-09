begin;

-- Stimmproben personalisiert — Briefing 2026-08-09.
--
-- "Anhören" bei der Stimmauswahl spielte bisher eine generische Demo-Aussage
-- ab. Kunden mit einem bereits konfigurierten Begruessungssatz (aus
-- buildGreetingView(), siehe customer-dashboard/netlify/functions/_lib/
-- assistant-greeting.js) sollen stattdessen genau diesen Satz hoeren, mit der
-- Stimme, die sie gerade anhoeren. ElevenLabs verrechnet TTS nach Zeichen, ein
-- Klick pro Stimmenkarte darf deshalb nicht bei jedem Aufruf neu erzeugen —
-- dieselbe Kombination aus Kunde, Stimme und Begruessungstext wird einmalig
-- generiert und danach aus Supabase Storage bedient. Aendert sich Text oder
-- Stimme, ist der Hash ein anderer, und die vorherige Datei wird einfach nicht
-- mehr getroffen (kein separater Loeschlauf noetig).
create table if not exists public.customer_voice_previews (
  id uuid primary key default gen_random_uuid(),
  customer_id text not null references public.customers(id) on delete cascade,
  voice_id text not null,
  text_hash text not null check (char_length(text_hash) = 32),
  storage_path text not null,
  char_count int not null check (char_count > 0),
  created_at timestamptz not null default now(),
  unique (customer_id, voice_id, text_hash)
);

alter table public.customer_voice_previews enable row level security;
revoke all on public.customer_voice_previews from anon, authenticated;

-- Privater Bucket: der Dateiname traegt keinen Klartext, aber der Pfad
-- (customer_id/voice_id/hash.mp3) und das Objekt selbst sind der tatsaechlich
-- gesprochene, personalisierte Begruessungssatz eines Kunden. Anders als der
-- oeffentliche Katalog-Bucket "voice-previews" (generische Stimmproben) gehoert
-- das nicht in einen public=true Bucket. Zugriff laeuft ausschliesslich ueber
-- den Service-Role-Key in preview-voice.js.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'customer-voice-previews',
  'customer-voice-previews',
  false,
  5242880,
  array['audio/mpeg']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

commit;
