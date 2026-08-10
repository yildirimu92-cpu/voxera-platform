-- „Anruf geprüft" als echter, gespeicherter Zustand.
--
-- Ausgangslage
-- ------------
-- markCallReviewed() im Admin-Portal schrieb ausschliesslich in den lokalen
-- Zustand des Browsers:
--
--     call.summary = `${call.summary} (reviewed)`;
--     call.callback = false;
--
-- Beim nächsten Laden war die Markierung weg -- und `summary` wäre bei jedem
-- Klick um „(reviewed)" gewachsen, ohne je gespeichert zu werden. Die Funktion
-- war von keiner Stelle aus erreichbar, sonst wäre das aufgefallen.
--
-- Warum eine eigene Spalte
-- ------------------------
-- `calls.read_at` existiert bereits, gehört aber dem Kunden-Dashboard
-- (Gelesen-Zustand der Anfragenliste). Ein Admin-„geprüft" darauf zu legen
-- würde zwei Bedeutungen in eine Spalte mischen: der Kunde könnte den Haken
-- des Admins setzen und umgekehrt.
--
-- reviewed_by ist bewusst uuid ohne Fremdschlüssel auf auth.users -- gleiche
-- Handhabung wie bei invoice_financial_actions.actor_user_id. Ein gelöschter
-- Admin soll die Prüfhistorie nicht mitnehmen.
--
-- Rechte: geschrieben wird ausschliesslich serverseitig über admin-mutate
-- (action "calls.setReviewed", Capability customer:write). Die Browser-Rollen
-- bekommen hier bewusst nichts dazu -- die bestehenden Policies auf `calls`
-- bleiben unberührt.

begin;

alter table public.calls
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid;

comment on column public.calls.reviewed_at is
  'Zeitpunkt, zu dem ein Admin den Anruf im Admin-Portal als geprueft markiert hat. NULL = ungeprueft. Nicht zu verwechseln mit read_at (Gelesen-Zustand des Kunden-Dashboards).';
comment on column public.calls.reviewed_by is
  'Admin-Benutzer, der den Anruf geprueft hat. Ohne Fremdschluessel, damit die Pruefhistorie einen geloeschten Admin ueberlebt.';

-- Die Admin-Ansicht filtert und zaehlt nach „offen zur Pruefung": ungeprueft
-- und nach Zeit sortiert. Der Teilindex deckt genau diesen Zugriff ab und
-- bleibt klein, weil gepruefte Anrufe herausfallen.
create index if not exists idx_calls_unreviewed
  on public.calls(created_at desc)
  where reviewed_at is null;

commit;
