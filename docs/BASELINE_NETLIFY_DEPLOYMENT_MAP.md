# Voxera – Baseline Netlify Deployment Map

**Repository-Baseline:** `main@682b88cbc16deb259f6f513de02b7bdc9fc255ab`

## Statusdefinitionen

- **VERIFIZIERT** – direkt anhand des GitHub-Repository-Zustands oder eines konkret gelesenen Repository-Artefakts bestätigt.
- **AUS REPOSITORY ABGELEITET** – aus Code, Konfiguration oder Dokumentation ableitbar, aber nicht als produktiver Laufzeitstatus bestätigt.
- **NICHT VERIFIZIERT** – mit den verfügbaren Zugängen nicht technisch bestätigt.
- **LIVE-ZUGRIFF ERFORDERLICH** – kann nur über das jeweilige Netlify- oder Supabase-Dashboard beziehungsweise dessen API/CLI verifiziert werden.

Repository-Funde sind ausdrücklich **kein Nachweis**, dass eine Komponente aktuell produktiv deployt, konfiguriert oder ausgeführt wird.

## 1. Repository-seitig erkennbare Deployment-Kandidaten

| Kandidat | Repository-Pfad | Build Command | Publish Directory | Functions Directory | Status |
|---|---|---|---|---|---|
| Admin Portal | `admin-panel/` | kein Command in `admin-panel/netlify.toml` | `.` | `netlify/functions` | VERIFIZIERT als Repository-Konfiguration |
| Customer Dashboard | `customer-dashboard/` | `echo 'Deploy successful'` | `.` | `netlify/functions` | VERIFIZIERT als Repository-Konfiguration |

**AUS REPOSITORY ABGELEITET:** Wahrscheinlich existieren oder existierten getrennte Netlify-Sites für Admin Portal und Customer Dashboard.

**NICHT VERIFIZIERT:** Site-Namen, Site-IDs, Base Directories und tatsächliche Git-Verknüpfung.

## 2. Scheduled Functions

### Admin-Konfiguration

| Function | Repository-Schedule | Status |
|---|---|---|
| `outbox-retry-worker` | `*/5 * * * *` | VERIFIZIERT im `netlify.toml` |
| `daily-billing-runner` | `0 6 * * *` | VERIFIZIERT im `netlify.toml` |

### Customer-Konfiguration

| Function | Repository-Schedule | Status |
|---|---|---|
| `cleanup-stale-calls` | `*/5 * * * *` | VERIFIZIERT im `netlify.toml` |

**NICHT VERIFIZIERT:** Ob diese Functions aktuell auf einer veröffentlichten Site vorhanden sind, erfolgreich laufen oder in Netlify deaktiviert wurden.

## 3. Redirects und Header

### Admin

**VERIFIZIERT**

- Sicherheitsheader für alle Pfade
- `Cache-Control: no-store` für `index.html` und `login.html`

### Customer

**VERIFIZIERT**

- Sicherheitsheader für alle Pfade
- `Cache-Control: no-store` für `index.html`
- Redirect `/twilio/status-callback` → `/.netlify/functions/twilio-status-callback`
- SPA-Fallback `/*` → `/index.html`

## 4. Domains und URLs im Repository

| Referenz | Fundstelle / Verwendung | Klassifizierung |
|---|---|---|
| `admin.voxera.ch` | Default für Admin-URL in Customer-Function / Kommentare | AUS REPOSITORY ABGELEITET |
| `dashboard.voxera.ch` | Aktivierungs-Redirect und Dokumentation | AUS REPOSITORY ABGELEITET |
| öffentliche Site-Base-URL | über `PUBLIC_SITE_BASE_URL` / `PUBLIC_OFFER_BASE_URL` | AUS REPOSITORY ABGELEITET |
| Netlify-Standard-URL | über Netlify-Variable `URL` | AUS REPOSITORY ABGELEITET |

Keine dieser Referenzen bestätigt, dass die Domain aktuell zu einer produktiven Netlify-Site gehört.

## 5. Nicht verifizierte Site-Metadaten

| Information | Status | Erforderlicher Nachweis |
|---|---|---|
| vorhandene Voxera-Sites | LIVE-ZUGRIFF ERFORDERLICH | Netlify-Teamübersicht |
| Repository-Verknüpfung je Site | LIVE-ZUGRIFF ERFORDERLICH | Project configuration → Build & deploy → Repository |
| Production Branch | LIVE-ZUGRIFF ERFORDERLICH | Project configuration → Build & deploy → Branches and deploy contexts |
| letzter Production Deploy | LIVE-ZUGRIFF ERFORDERLICH | Deploys → Published / Production |
| Commit-SHA des Deployments | LIVE-ZUGRIFF ERFORDERLICH | Deploy detail |
| produktive Site | LIVE-ZUGRIFF ERFORDERLICH | Primary domain plus Published deploy |
| Domains/Subdomains | LIVE-ZUGRIFF ERFORDERLICH | Domain management |
| tatsächlicher Build Command | LIVE-ZUGRIFF ERFORDERLICH | Site UI und Deploy log |
| tatsächliches Publish Directory | LIVE-ZUGRIFF ERFORDERLICH | Site UI und Deploy log |
| tatsächliches Functions Directory | LIVE-ZUGRIFF ERFORDERLICH | Site UI und Deploy summary |
| Base Directory | LIVE-ZUGRIFF ERFORDERLICH | Project configuration |
| Deploy Previews | LIVE-ZUGRIFF ERFORDERLICH | Branches and deploy contexts |
| Environment-Variable-Namen | LIVE-ZUGRIFF ERFORDERLICH | Environment variables; nur Keys erfassen |
| Scheduled Functions aktiv | LIVE-ZUGRIFF ERFORDERLICH | Functions-Seite / Scheduled-Badge |
| manuelle Deployments | LIVE-ZUGRIFF ERFORDERLICH | Deploy-Historie und Deploy-Ursprung |
| alte Admin-/Dashboard-Sites | LIVE-ZUGRIFF ERFORDERLICH | vollständige Projektliste |
| Sites aus Legacy-Repositories | LIVE-ZUGRIFF ERFORDERLICH | Repository-Verknüpfung je Site |

## 6. Mögliche Überschneidungen

**AUS REPOSITORY ABGELEITET**

- Admin und Customer besitzen getrennte Functions-Verzeichnisse.
- Gleichnamige oder fachlich überlappende Functions existieren in beiden Bereichen, beispielsweise Cases- und AI-Änderungspfade.
- Das Customer Dashboard ruft für ElevenLabs-Synchronisierung eine Admin-URL auf.
- Öffentliche Offerten-/Vertragsseiten und Functions liegen teilweise im Admin-Verzeichnis.

**NICHT VERIFIZIERT**

- ob mehrere Sites dieselbe Domain beanspruchen
- ob mehrere Sites dieselbe Webhook-URL verwenden
- ob Funktionen aus unterschiedlichen Sites parallel erreichbar sind
- ob alte Deployments weiterhin öffentlich sind

## 7. Produktiver Status

- Produktive Netlify-Site: **NICHT VERIFIZIERT**
- Produktiver Deploy: **NICHT VERIFIZIERT**
- Produktiver Commit: **NICHT VERIFIZIERT**
- Produktive Domains: **NICHT VERIFIZIERT**
- Produktive Environment-Konfiguration: **NICHT VERIFIZIERT**
