# Voxera – Baseline Unverified Items and Live Verification Checklist

**Repository-Baseline:** `main@682b88cbc16deb259f6f513de02b7bdc9fc255ab`

## Statusdefinitionen

- **VERIFIZIERT** – direkt anhand des GitHub-Repository-Zustands oder eines konkret gelesenen Repository-Artefakts bestätigt.
- **AUS REPOSITORY ABGELEITET** – aus Code, Konfiguration oder Dokumentation ableitbar, aber nicht als produktiver Laufzeitstatus bestätigt.
- **NICHT VERIFIZIERT** – mit den verfügbaren Zugängen nicht technisch bestätigt.
- **LIVE-ZUGRIFF ERFORDERLICH** – kann nur über das jeweilige Netlify- oder Supabase-Dashboard beziehungsweise dessen API/CLI verifiziert werden.

Repository-Funde sind ausdrücklich **kein Nachweis**, dass eine Komponente aktuell produktiv deployt, konfiguriert oder ausgeführt wird.

## 1. Offene Kernfragen

- Welche Netlify-Projekte sind aktuell vorhanden?
- Welche davon sind produktiv oder noch öffentlich erreichbar?
- Welcher Commit ist tatsächlich veröffentlicht?
- Welche Domains zeigen auf welche Site?
- Welche Environment-Variable-Namen sind je Site gesetzt?
- Welches Supabase-Projekt ist produktiv?
- Wie sieht das tatsächliche Live-Schema aus?
- Welche Migrationen wurden tatsächlich ausgeführt?
- Welche RLS-, Storage- und Auth-Regeln sind aktiv?
- Existieren Edge Functions oder Supabase Cron Jobs?
- Sind Legacy-Sites oder Legacy-Secrets weiterhin aktiv?

## 2. Umgang mit Screenshots und Secrets

- Werte von Secrets vollständig schwärzen.
- Nur Variablennamen, Scope und Deploy Context sichtbar lassen.
- Supabase Service Role, Secret Keys, JWTs, SMTP-Passwörter, API Keys, Auth Tokens und Webhook-Tokens nie zeigen.
- Public Anon Key nach Möglichkeit ebenfalls schwärzen; für den Audit genügt der Key-Name.
- Personenbezogene Kunden-, Benutzer-, Call- und Rechnungsdaten schwärzen.
- Screenshots im Ergebnisprotokoll mit Datum, Plattform, Projekt/Site und Prüfer versehen.

## 3. Netlify-Checkliste

Die Navigation basiert auf der aktuellen Netlify-Bezeichnung **Projects / Project configuration**. Falls das Konto noch „Sites“ anzeigt, ist der entsprechende Eintrag zu verwenden.

| Prüfpunkt | Plattform | genaue Navigation | benötigte Information | Screenshot genügt | zu schwärzen | Dokumentation |
|---|---|---|---|---|---|---|
| vorhandene Voxera-Sites | Netlify | Team dashboard → **Projects** | vollständige Liste aller Projekte mit `voxera`-Bezug | ja | fremde Projekte, falls nötig | Tabelle: Project name, Project ID, URL, Status |
| verbundenes GitHub-Repository | Netlify | Project → **Project configuration** → **Build & deploy** → **Repository** / Continuous Deployment | Repository-Name und Provider | ja | Tokens, Installationsdetails | je Site `repository` und `verified_at` |
| Production Branch | Netlify | Project → Project configuration → Build & deploy → **Continuous Deployment** → **Branches and deploy contexts** | Production branch | ja | nichts Geheimes | `production_branch` |
| letzter Production Deploy | Netlify | Project → **Deploys** → neuester **Published/Production** Deploy | Datum, Status, Deploy ID | ja | Logdaten mit Secrets | `last_production_deploy` |
| Commit-SHA | Netlify | Deploys → Production Deploy öffnen → Deploy details / Commit | vollständige Commit-SHA | ja | Commit-Autor-E-Mail optional | `production_commit_sha` |
| Deploy-Ursprung | Netlify | Deploy details | Git-triggered, manual, API, drag-and-drop oder rollback | ja | nichts Geheimes | `deploy_origin` |
| Domains/Subdomains | Netlify | Project → **Domain management** | Primary domain, aliases, Netlify subdomain, branch/deploy domains | ja | DNS-Verifikationswerte | Domain-Mapping-Tabelle |
| Build Command | Netlify | Project configuration → Build & deploy → **Build settings** | effektiver Build Command | ja | eingebettete Secret-Werte | `build_command` |
| Base Directory | Netlify | Project configuration → Build & deploy → Build settings | Base directory / Package directory | ja | – | `base_directory` |
| Publish Directory | Netlify | Project configuration → Build & deploy → Build settings | Publish directory | ja | – | `publish_directory` |
| Functions Directory | Netlify | Project configuration → Build & deploy → Build settings / Functions | Functions directory | ja | – | `functions_directory` |
| Deploy Previews | Netlify | Project configuration → Build & deploy → Continuous Deployment → Branches and deploy contexts | aktiv/deaktiviert, Zugriffsschutz | ja | Passwortwerte | `deploy_previews_enabled` |
| Environment-Variable-Namen | Netlify | Project configuration → **Environment variables** | Keys, Scope, Deploy Context; keine Werte | ja | alle Werte vollständig | Schlüsselmatrix pro Site |
| Scheduled Functions | Netlify | Project → **Functions** | Function-Namen mit `Scheduled`-Badge, nächster Lauf | ja | Request-/Logdaten | Schedule-Matrix |
| Function-Status | Netlify | Project → Functions → Function öffnen | vorhanden, letzter Lauf, Fehlerstatus | ja | Payloads/PII | `function_status` |
| alte Voxera-Admin-/Dashboard-Sites | Netlify | Team dashboard → Projects; Suche `voxera`, `admin`, `dashboard` | alte Projekte und Repository-Verknüpfung | ja | ENV-Werte | Legacy-Site-Tabelle |
| Domainkonflikte | Netlify | Domain management jeder Voxera-Site | gleiche Domain/Alias auf mehreren Sites | ja | DNS-Tokens | Konfliktliste |
| manuelle Deployments | Netlify | Deploys → Filter/Deploy details | Deploys ohne eindeutige Git-SHA | ja | Upload-Namen bei Bedarf | Liste `manual_or_unmapped_deploys` |

### Netlify-Ergebnisformat

Für jede Site:

```yaml
site_name:
site_id:
repository:
production_branch:
last_production_deploy:
production_commit_sha:
production_commit_verified: true|false
deploy_origin:
base_directory:
build_command:
publish_directory:
functions_directory:
deploy_previews_enabled:
domains: []
environment_variable_names: []
scheduled_functions: []
legacy_status:
evidence_date:
```

## 4. Supabase-Checkliste

| Prüfpunkt | Plattform | genaue Navigation | benötigte Information | Screenshot genügt | zu schwärzen | Dokumentation |
|---|---|---|---|---|---|---|
| produktives Projekt | Supabase | Organization → **Projects** → Projekt öffnen | Projektname, Region, Project Ref | ja | Kosten-/Teamdetails optional | `production_project` mit Begründung |
| Project Ref | Supabase | Projekt-URL oder **Project Settings** → General | Project Ref | ja | Keys | `project_ref` |
| Tabellen | Supabase | Projekt → **Table Editor** | Tabellen je Schema | ja, mehrere Screenshots | Row-Inhalte/PII | Tabelle: schema, table, RLS |
| Views | Supabase | Table Editor / Database → Schema Visualizer oder SQL Editor-Abfrage | Views je Schema | Screenshot oder CSV | Dateninhalte | View-Liste |
| Database Functions | Supabase | Projekt → **Database** → **Functions** | Funktionsname, Schema, Argumente, Security Definer | ja | Funktionsbody, falls Secrets | Function-Inventar |
| Trigger | Supabase | Projekt → Database → **Triggers** oder SQL Editor-Abfrage | Trigger, Tabelle, Event, Function | ja | keine Datenwerte | Trigger-Inventar |
| Migration History | Supabase | Projekt → **Database** → **Migrations**; falls nicht sichtbar SQL/CLI `supabase_migrations.schema_migrations` | ausgeführte Versionen | ja/Export | DB-URL, Credentials | Abgleich mit Repository-Dateien |
| RLS-Status | Supabase | Table Editor → Tabelle → RLS/Policies | RLS enabled/disabled je Tabelle | ja | Datenzeilen | RLS-Matrix |
| Policies | Supabase | Table Editor → Tabelle → **Policies** | Policy-Name, Operation, Rollen, Ausdruck | ja | sensitive Policy-Ausdrücke nur falls nötig | Policy-Inventar |
| Storage Buckets | Supabase | Projekt → **Storage** | Bucket-Namen, public/private | ja | Objekt-/Kundennamen | Bucket-Matrix |
| Storage Policies | Supabase | Storage → Policies oder Table Editor → `storage.objects` Policies | Rollen und Operationen | ja | sensible Ausdrücke | Storage-Policy-Matrix |
| Auth URL Configuration | Supabase | Projekt → **Authentication** → **URL Configuration** | Site URL | ja | keine Tokens | `auth_site_url` |
| Redirect URLs | Supabase | Authentication → URL Configuration → Redirect URLs | vollständige Allowlist | ja | interne nichtöffentliche Hosts bei Bedarf | Redirect-Liste |
| Auth Provider/Session Settings | Supabase | Authentication → Providers / Settings | aktivierte Provider, Confirmation, Session-Optionen | ja | Provider-Secrets | Auth-Konfigurationsübersicht |
| Benutzer-Zuordnung | Supabase | Authentication → Users plus Table Editor `users`/`admins` | Stichproben-/Count-Abgleich ohne PII-Export | Screenshots mit Schwärzung | E-Mail, UUIDs, Metadaten | Counts und Integritätsfehler |
| Edge Functions | Supabase | Projekt → **Edge Functions** | Function-Namen, Status, letzte Deployments, JWT-Verifikation | ja | Secrets/Logs | Edge-Function-Liste |
| Cron Jobs | Supabase | Projekt → **Integrations** → **Cron** oder Database/Cron UI | Jobname, Schedule, Command/Function | ja | SQL mit Secrets | Cron-Inventar |
| Extensions | Supabase | Projekt → **Database** → **Extensions** | aktivierte Extensions | ja | – | Extension-Liste |
| Realtime | Supabase | Projekt → Database/Realtime settings / Publications | Tabellen in Realtime-Publication | ja | – | Realtime-Matrix |
| alte Tabellen | Supabase | Table Editor + Abhängigkeits-/Nutzungsprüfung | Tabellen ohne Codebezug, Owner, letzte Nutzung soweit verfügbar | Screenshot allein nicht ausreichend | Daten | als Kandidat, nicht direkt löschen |

### Supabase-Ergebnisformat

```yaml
project_name:
project_ref:
production_project_verified: true|false
schemas:
tables: []
views: []
database_functions: []
triggers: []
migration_history: []
rls:
policies: []
storage_buckets: []
storage_policies: []
auth_site_url:
auth_redirect_urls: []
edge_functions: []
cron_jobs: []
extensions: []
realtime_tables: []
evidence_date:
```

## 5. Erforderlicher Schema-Abgleich

Nach Erhalt der Live-Informationen:

1. Repository-Migrationsdateien inventarisieren.
2. Live Migration History exportieren.
3. Tabellen/Spalten aus dem Code mit Live-Schema vergleichen.
4. fehlende Live-Spalten und nur im Live-System vorhandene Spalten getrennt dokumentieren.
5. RLS/Policies pro browserseitig angesprochener Tabelle prüfen.
6. Auth- und Customer-Zuordnungen über Counts und verwaiste Referenzen prüfen.
7. keine Migration ausführen, bevor der Abgleich freigegeben ist.

## 6. Aktueller Abschlussstatus

- Repository-Baseline: **VERIFIZIERT**
- Netlify Live-Mapping: **NICHT VERIFIZIERT**
- Supabase Live-Schema: **NICHT VERIFIZIERT**
- Build-Reproduzierbarkeit: **NICHT VERIFIZIERT**
- aktive Airtable-Abhängigkeit: **NICHT BESTÄTIGT**
- technische Ausgangslage für produktive Stabilisierung: **TEILWEISE VERIFIZIERT**
