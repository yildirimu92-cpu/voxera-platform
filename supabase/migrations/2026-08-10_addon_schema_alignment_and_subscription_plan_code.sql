-- Paket A + B1 -- Addon-Schema angleichen, `subscriptions.plan_code` nachziehen.
--
-- Ausgangslage: Schema-Audit vom 10.08. (Paket 0). Von 76 Strich-Migrationen
-- sind 42 vollstaendig live, 18 leben unter abweichenden Namen, 8 sind nie
-- angekommen. Zwei der acht blockieren die gestaffelte Paketstruktur:
--
-- A -- `2026-05-09_plan_config_addons_provisioning.sql` lief nie durch. Ihr
--   `CREATE TABLE IF NOT EXISTS public.customer_addons` war ein No-op, weil
--   eine aeltere Tabelle gleichen Namens bereits stand -- mit einem anderen
--   Spaltensatz (`active`, `quantity`, `valid_until`). Danach scheiterte die
--   Migration an `ADD COLUMN subscription_plan_code ... REFERENCES
--   plan_config(plan_code)`: `plan_config` hat als Primaerschluessel `id`,
--   keine Spalte `plan_code`. Wegen `BEGIN/COMMIT` rollte alles zurueck.
--
--   Folge: beide Schreibpfade (`customer-manage-addon.js`,
--   `admin-mutate.js` -> `addons.activate`) schreiben gegen das Schema der
--   Migration -- `status`, `billing_cycle`, `price_chf`, `starts_at`,
--   `updated_at`. Fuenf Spalten, die live nicht existieren. Jede Aktivierung
--   scheitert still an PostgREST; `customer_addons` hat null Zeilen. Der
--   Leser im Dashboard (`customer-dashboard/index.html:16862`) liest dagegen
--   das alte Schema. Schreiber und Leser waren nie verbunden.
--
-- B1 -- `2026-04-10_subscriptions_v1_admin_fields.sql` ist ebenfalls nicht
--   live: `subscriptions.plan_code` fehlt. `activate-subscription.js:82`
--   schreibt die Spalte im Upsert und bricht deshalb mit 500 ab, bevor
--   Zeile 104 `customers.plan_code` setzen koennte. Das ist der Grund, warum
--   `plan_code` bei allen vier Kunden NULL ist -- nicht fehlende Logik,
--   sondern eine Funktion, die nie durchlaeuft.
--
-- Richtung der Angleichung (Entscheid vom 10.08.): die Live-Tabelle wird
-- ERWEITERT, nicht ersetzt. `quantity` und `valid_until` tragen Semantik, die
-- das Migrationsschema nicht kennt -- das Dashboard rechnet Zusatzminuten als
-- `quantity x 50`, gueltig bis `valid_until` (index.html:16878). Ein Austausch
-- des Schemas haette diese Felder verloren.
--
-- `active` bleibt als Spalte bestehen, wird aber von `status` abgeleitet:
-- GENERATED ALWAYS AS (status = 'active') STORED. Damit lesen die bestehenden
-- Konsumenten unveraendert weiter, ohne dass zwei unabhaengige Wahrheiten
-- ueber denselben Sachverhalt entstehen. Eine bestehende Spalte laesst sich
-- nicht nachtraeglich in eine generierte umwandeln, sie muss ersetzt werden --
-- geprueft: keine View, kein Trigger und keine der drei RLS-Policies auf
-- `customer_addons` referenziert `active`, und kein Codepfad schreibt sie.
--
-- Bewusst NICHT Teil dieser Migration:
--   * Das Plan-Gate auf `available_from_plan` (Paket C1). Es waere hier nicht
--     testbar, weil der Aktivierungspfad bis zu dieser Migration ohnehin bei
--     jedem Aufruf scheitert -- ein gruener Test haette nichts bewiesen.
--   * `plan_code` vs. `plan` zusammenfuehren (Paket B2). `plan_code` bleibt
--     hier nullable; welche der beiden Spalten fuehrend wird, ist eine eigene
--     Entscheidung mit eigener Migration.
--   * Die drei uebrigen Bruchstellen aus dem Audit (#48 Go-Live-Gate,
--     #42 Admin-Audit, #14 Auto-Live). Siehe
--     docs/TICKETS_SCHEMA_DRIFT_2026-08-10.md.

begin;

-- ---------------------------------------------------------------------------
-- A1. Statusspalten ergaenzen.
-- ---------------------------------------------------------------------------
-- Additiv. Die Defaults sind so gewaehlt, dass eine bestehende Zeile ohne
-- weitere Angabe denselben Zustand behaelt, den sie unter dem alten Schema
-- hatte (aktiv, monatlich).
alter table public.customer_addons
  add column if not exists status        text        not null default 'active',
  add column if not exists billing_cycle text        not null default 'monthly',
  add column if not exists price_chf     numeric(10,2),
  add column if not exists starts_at     timestamptz not null default now(),
  add column if not exists ends_at       timestamptz,
  add column if not exists cancelled_at  timestamptz,
  add column if not exists updated_at    timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- A2. Bestand uebertragen, solange `active` noch existiert.
-- ---------------------------------------------------------------------------
-- Heute ein No-op: die Tabelle ist leer. Die Anweisungen stehen trotzdem, weil
-- diese Migration auf einer Umgebung mit Bestand dieselbe Bedeutung haben muss
-- wie hier -- ein Default alleine wuerde eine deaktivierte Zeile stillschweigend
-- auf 'active' heben.
update public.customer_addons
   set status = case when coalesce(active, true) then 'active' else 'cancelled' end
 where status is distinct from
       (case when coalesce(active, true) then 'active' else 'cancelled' end);

-- `activated_at` ist die alte Entsprechung von `starts_at`.
update public.customer_addons
   set starts_at = coalesce(activated_at, created_at, starts_at)
 where activated_at is not null or created_at is not null;

-- ---------------------------------------------------------------------------
-- A3. Wertebereiche festschreiben.
-- ---------------------------------------------------------------------------
-- `billing_cycle` wird aus `voxera_addons.billing_type` gespeist; dort kommen
-- heute 'monthly' und 'onetime' vor. 'yearly' ist zugelassen, damit ein
-- Jahres-Addon spaeter keine Migration braucht.
alter table public.customer_addons
  drop constraint if exists customer_addons_status_check;
alter table public.customer_addons
  add constraint customer_addons_status_check
  check (status in ('active', 'cancelled', 'expired'));

alter table public.customer_addons
  drop constraint if exists customer_addons_billing_cycle_check;
alter table public.customer_addons
  add constraint customer_addons_billing_cycle_check
  check (billing_cycle in ('monthly', 'yearly', 'onetime'));

-- ---------------------------------------------------------------------------
-- A4. `active` von `status` ableiten.
-- ---------------------------------------------------------------------------
-- Reihenfolge ist wesentlich: A2 hat den Inhalt bereits nach `status` gerettet,
-- erst danach darf die Quellspalte fallen.
alter table public.customer_addons drop column if exists active;
alter table public.customer_addons
  add column active boolean generated always as (status = 'active') stored;

comment on column public.customer_addons.active is
  'Abgeleitet aus status. Nicht beschreibbar -- status ist die Wahrheit.';

-- ---------------------------------------------------------------------------
-- A5. Indizes und Abfragefunktion aus der nie gelaufenen Migration nachziehen.
-- ---------------------------------------------------------------------------
create index if not exists idx_customer_addons_customer on public.customer_addons(customer_id);
create index if not exists idx_customer_addons_status   on public.customer_addons(status);

-- Signatur weicht bewusst von der Vorlage ab: dort stand `p_customer_id UUID`,
-- live ist `customer_addons.customer_id` aber `text`. Dieselbe Drift ist im
-- Kommentar von 2026-08-06_p0_rls_tenant_isolation_hardening.sql bereits
-- vermerkt; hier gewinnt der tatsaechliche Spaltentyp.
--
-- Die Vorlage pruefte nur `status = 'active'`. Diese Fassung beruecksichtigt
-- zusaetzlich `valid_until` -- genau so, wie es der einzige bestehende Leser
-- tut (index.html:16869). Sonst haetten Funktion und Dashboard bei
-- abgelaufenen Minutenpaketen unterschiedliche Antworten gegeben.
create or replace function public.customer_has_addon(p_customer_id text, p_addon_code text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.customer_addons
    where customer_id = p_customer_id
      and addon_code = p_addon_code
      and status = 'active'
      and (valid_until is null or valid_until >= current_date)
  );
$$;

-- Rechte: einzeln von public, anon und authenticated widerrufen, dann gezielt
-- an service_role zurueckgeben. `revoke ... from public` alleine genuegt NICHT
-- -- Supabase vergibt in `public` per ALTER DEFAULT PRIVILEGES namentliche
-- EXECUTE-Grants an anon, authenticated und service_role, und die ueberleben
-- ein PUBLIC-Revoke. Idiom nach 2026-07-28_p0_security_foundation.sql:14-17.
revoke all privileges on function public.customer_has_addon(text, text) from public;
revoke all privileges on function public.customer_has_addon(text, text) from anon;
revoke all privileges on function public.customer_has_addon(text, text) from authenticated;
grant execute on function public.customer_has_addon(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- B1. `subscriptions.plan_code`.
-- ---------------------------------------------------------------------------
-- Nur die Spalte, die `activate-subscription.js` im Upsert erwartet. Die
-- beiden CHECK-Constraints derselben Vorlage (`billing_cycle`,
-- `subscription_status`) bleiben aussen vor: sie gehoeren zum Lebenszyklus der
-- Subscription, nicht zur Paketstruktur, und wuerden den Scope hier ausweiten.
alter table public.subscriptions
  add column if not exists plan_code text;

update public.subscriptions
   set plan_code = lower(trim(plan))
 where plan_code is null
   and plan is not null
   and trim(plan) <> '';

-- Alle vier Bestandszeilen tragen 'starter' | 'business' | 'professional' --
-- samtliche Werte existieren in plan_config.id. Der Fremdschluessel kann
-- deshalb ohne Bereinigung greifen.
alter table public.subscriptions
  drop constraint if exists subscriptions_plan_code_fkey;
alter table public.subscriptions
  add constraint subscriptions_plan_code_fkey
  foreign key (plan_code) references public.plan_config(id);

-- Bewusst nullable: NOT NULL waere die Aussage "jede Subscription hat einen
-- Plan", und die gehoert zu B2 -- zusammen mit der Entscheidung, ob `plan`
-- oder `plan_code` fuehrend wird. Zwei Spalten mit NOT NULL zu belegen, bevor
-- klar ist welche gewinnt, macht die Zusammenfuehrung nur teurer.

commit;
