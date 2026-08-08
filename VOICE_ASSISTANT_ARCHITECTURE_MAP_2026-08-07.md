# Sprachassistent — System-Kartierung Name / Stimme / Geschäftsinfo

**Datum:** 2026-08-07
**Typ:** Audit-only. Keine Codeänderung, kein Fix.
**Ziel:** Ist-Zustand der Schreibwege, des Sync-Mechanismus, der Prompt-Architektur und des Sprach-Handlings als Grundlage für die anschliessende Bug-Diagnose.
**Projekt (Supabase):** `ulcofbgrovgcvowdjrge`

Alle Aussagen sind nach AGENTS.md markiert:
**[FAKT]** = durch Code, Schema oder Produktionsdaten belegt ·
**[WAHRSCHEINLICH]** = durch Evidenz gestützt, nicht vollständig bewiesen ·
**[UNVERIFIZIERT]** = offen, benötigt Live-Test oder externen Zugriff.

---

## 0. Kernbefund vorab

Zwei der gemeldeten Symptome lassen sich bereits jetzt einem Mechanismus zuordnen — der Namenskonflikt ist an Produktionsdaten **bewiesen**, nicht nur plausibel.

| Symptom | Status | Mechanismus |
|---|---|---|
| Assistent nennt inkonsistent unterschiedliche Namen | **[FAKT]** — an Live-Daten reproduziert | `ai_greeting` ist ein **eingefrorener Literal-String**. Er wird bei einer Namensänderung von keinem Schreibweg aktualisiert und im Prompt-Builder nicht über die Variablenauflösung geschickt. |
| Stimme wechselt männlich/weiblich | **[WAHRSCHEINLICH]** | `voice_id = NULL` ⇒ der Sync sendet **gar keinen** TTS-Patch an ElevenLabs. Die DB ist dann nicht die Quelle der Wahrheit; es gilt, was zuletzt im ElevenLabs-Agent stand. |

Beides sind **keine** Race-Conditions zwischen Admin und Customer. Die vermutete Sync-/Caching-Kollision ist nach aktueller Aktenlage nicht die Ursache. Details in §5.

---

## 1. Datenmodell (Ist)

`public.customers` — verifiziert gegen `information_schema` **[FAKT]**:

| Feld | Typ | DB-Default |
|---|---|---|
| `assistant_name` | text | *kein Default* (NULL) |
| `ai_person_name` | text | NULL |
| `ai_customer_type` | text | `'company'` |
| `ai_address_form` | text | `'sie'` |
| `ai_tone` | text | `'professional'` |
| `ai_language` | text | `'de'` |
| `selected_languages` | text[] | NULL |
| `voice_id` | text | NULL |
| `ai_greeting` | text | NULL |
| `ai_business_description`, `ai_services`, `ai_location_hours`, `ai_booking_faq` | text | NULL |
| `ai_instructions`, `ai_fallback_escalation`, `ai_response_constraints` | text | NULL |
| `ai_internal_notes` | text | NULL |
| `customer_display_name`, `customer_legal_name` | text | NULL |
| `elevenlabs_agent_id`, `elevenlabs_sync_status`, `elevenlabs_last_sync_at` | text/ts | NULL |

`public.voxera_voices` — Stimmenkatalog, aktueller Live-Stand **[FAKT]**:

| voice_id | Anzeige | Gender | Ab Plan | Default |
|---|---|---|---|---|
| `1iF3vHdwHKuVKSPDK23Z` | Freundlich | female | starter | **ja** |
| `uvysWDLbKpA4XvpD3GI6` | Natürlich | female | business | nein |
| `elrPOnQZaau5IoISMrJe` | Seriös | **male** | business | nein |
| `FTNCalFNG5bRnkkaP5Ug` | Entspannt | **male** | business | nein |

`public.plan_config` — Feature-Gates, Live-Stand **[FAKT]**:

| Plan | `allow_custom_assistant_name` | `voice_selection_enabled` | `allow_personality_wizard` |
|---|---|---|---|
| starter | false | false | false |
| business | true | true | false |
| professional | true | true | true |
| kein_plan | false | false | false |

---

## 2. Schreibwege — vollständige Karte

Es gibt **sechs** aktive Schreibwege in die Identitätsfelder, plus einen stillgelegten.

### 2.1 Übersicht

| # | Einstieg | Endpoint | Server-Datei | Schreibt |
|---|---|---|---|---|
| **A** | Customer Dashboard, Assistent-Tab (inline) | `customer-update-assistant` | `customer-dashboard/netlify/functions/customer-update-assistant.js` | `assistant_name`, `voice_id`, `ai_greeting`, `ai_tone`, `ai_address_form`, Geschäftsinfo, Weiterleitungen, SMS |
| **B** | Customer Dashboard, Runtime-Modul `customer-runtime-assistant-profile.js` | `customer-update-assistant` | *(identisch A)* | `assistant_name`, `voice_id` |
| **C** | Customer Dashboard, „Live schalten"-Sammelspeicher (`vxPendingGoLive`) | `customer-update-assistant` | *(identisch A)* | Geschäftsinfo, `ai_tone`, `ai_address_form` |
| **D** | Admin-Portal, Setup-Wizard | `admin-mutate` → `customers.update` | `admin-panel/netlify/functions/admin-mutate.js` | **alle** Identitäts-, Persönlichkeits- und Geschäftsfelder + `voice_id` + `selected_languages` + `ai_internal_notes` |
| **E** | Admin-Portal, Panel „AI Konfiguration" (`saveCustomerAiConfig`) | `admin-mutate` → `customers.update` | *(identisch D)* | Geschäftsinfo **und** `assistant_name`, `ai_customer_type`, `ai_address_form`, `ai_tone`, `ai_language`, `ai_greeting` |
| **F** | Admin-Portal, allgemeine Kundenbearbeitung | `admin-customer-update` | `admin-panel/netlify/functions/admin-customer-update.js` | beliebige nicht-geschützte Spalten, inkl. aller `ai_*` |
| — | Customer `ai-apply-change` | — | `customer-dashboard/netlify/functions/ai-apply-change.js` | **stillgelegt**, gibt HTTP 410 zurück **[FAKT]** |

`admin-panel/netlify/functions/ai-apply-change.js` (Weg **G**) ist ein reiner **Vorschlags-Generator**: er ruft Claude Haiku, validiert gegen eine Feld-Whitelist und gibt `changes` + `preview` zurück — **er schreibt selbst nichts in die DB** (`admin-panel/netlify/functions/ai-apply-change.js:217-226`) **[FAKT]**. Der eigentliche Schreibvorgang läuft danach über D/E/F. Der historische AI-Governance-Befund „paralleler Schreibweg" trifft für diese Datei damit **nicht** zu.

### 2.2 Governance-Asymmetrie zwischen den Wegen — **[FAKT]**

| Schutzmechanismus | A/B/C (Customer) | D/E (`admin-mutate`) | F (`admin-customer-update`) |
|---|---|---|---|
| Feld-Whitelist | **ja**, explizite Destrukturierung | **nein** | nein (nur Blacklist) |
| Plan-Gate serverseitig | **ja** (`allow_custom_assistant_name`, `voice_selection_enabled`) | **nein** | nein |
| Validierung `voice_id` gegen Katalog + Plan-Tier | **ja** | **nein** | nein |
| Längenbegrenzung | **ja** (`text(value, maxLength)`) | nein | nein |
| Gesperrte Felder | `ai_instructions`, `ai_fallback_escalation`, `ai_response_constraints` | — | Lifecycle/Billing/`elevenlabs_agent_id` |
| Patch-Sanitizing | — | `sanitizePatch()` ist ein **flacher Spread ohne jede Filterung** (`admin-mutate.js:57-60`) | `cleanPatch()` mit `PROTECTED_FIELDS` |

Der Customer-Weg ist der **strengste** Weg ins System. Die Admin-Wege haben faktisch keine Feldvalidierung.

### 2.3 Konkreter Konflikt in Weg E — **[FAKT]**

`saveCustomerAiConfig()` (`admin-panel/index.html:8223-8243`) baut den Patch aus dem lokalen Objekt `cfg = state.aiConfigs[id]`:

```js
assistant_name:   cfg.assistantName||null,
ai_customer_type: cfg.customerType||null,
ai_address_form:  cfg.addressForm||null,
ai_tone:          cfg.tone||null,
ai_language:      cfg.language||null,
ai_greeting:      cfg.greeting||null,
```

`state.aiConfigs` wird beim Laden (`admin-panel/index.html:15181-15204`) aber **ausschliesslich** mit diesen Schlüsseln befüllt:
`businessDescription`, `services`, `locationHours`, `bookingFaq`, `instructions`, `fallbackEscalation`, `responseConstraints`, `internalNotes`, `summary`, `industryTemplateId`, `custom`, `status`, `lastUpdate`.

`cfg.assistantName`, `cfg.customerType`, `cfg.addressForm`, `cfg.tone`, `cfg.language`, `cfg.greeting` existieren dort **nie**. Sie sind bei jedem Aufruf `undefined`.

Konsequenz, Kette vollständig codebelegt:
`undefined || null` → `null` → `sanitizePatch()` reicht `null` unverändert durch → `customers.update` schreibt **NULL** in sechs Identitätsfelder → direkt danach wird `trigger-elevenlabs-sync` aufgerufen (`admin-panel/index.html:8257`) → `buildPromptV2` fällt auf die Defaults zurück: `assistant_name → 'Lara'`, `ai_language → 'de'`, `ai_greeting → neu generiert`.

**Ein Klick auf „AI Konfiguration speichern" im Admin-Portal setzt einen kundenseitig gewählten Assistenznamen auf NULL zurück und pusht denselben Zustand sofort zu ElevenLabs.**

**[UNVERIFIZIERT]** — ob dieser Pfad in der Praxis von euch benutzt wird, geht aus den Daten nicht hervor: im aktuellen `elevenlabs_sync_log` steht kein Eintrag mit `triggered_by = 'admin_save'` (§5.3). Der Defekt ist im Code bewiesen, sein Auftreten in der Produktion nicht.

### 2.4 Weg D (Wizard) — Bewertung

Der Wizard schreibt zwar **alle** Felder in einem einzigen Patch, seedet `data` aber vollständig aus dem Kundendatensatz (`admin-panel/index.html:7476-7515`), z. B. `assistantName: c?.assistant_name || 'Lara'`, `voiceId: c?.voice_id || ''`. Der Voice-Collect überschreibt nur bei nicht-leerer Auswahl (`admin-panel/index.html:7857-7858`). **[FAKT]** Der Wizard ist damit im Normalfall werterhaltend und **nicht** der Stimmen-Löscher.

Zwei Nebenwirkungen bleiben **[FAKT]**:
- `ai_person_name` wird bei `ai_customer_type === 'company'` hart auf `null` gesetzt (`index.html:7720`).
- `customer_display_name` wird bei jedem Wizard-Durchlauf aus `c.name` + Typ neu berechnet (`index.html:7713-7718`).

### 2.5 Doppelte Customer-UI

Die Wege **A** und **B** sind zwei unabhängige Implementierungen derselben Funktion (Name ändern, Stimme wählen) im selben Dashboard — inline in `customer-dashboard/index.html` und im Runtime-Modul `customer-runtime-assistant-profile.js`. Beide POSTen auf denselben Endpoint. **[FAKT]** Da der Endpoint serverseitig validiert, ist das kein Datenrisiko, aber ein Wartungs- und Zustandsrisiko (zwei getrennte lokale States: `customerMeta.voiceId` / `window.assistantSelectedVoiceId` vs. `profile.assistant.voice_id`).

Kleinere Inkonsistenz **[FAKT]**: die Plan-Ermittlung im Inline-Pfad ist uneinheitlich — `customerMeta.planCode || customerMeta.plan` in Zeile 15104, aber nur `customerMeta.plan` in Zeile 15111. Serverseitig wird ohnehin korrekt geprüft; betrifft nur die UI-Sichtbarkeit.

---

## 3. Prompt-Architektur

### 3.1 Das 3-Layer-System existiert — aber anders als angenommen

**[FAKT]** Es gibt drei Layer, jedoch **nicht** „Identität / Ton / Wissensbasis". Die tatsächliche Achse ist **Geltungsbereich**:

| Layer | Quelle | Inhalt |
|---|---|---|
| **L1 Master** | `system_config.value` bei `key = 'prompt_master_l1'` | globale Rolle, Verhalten, Variablen-Slots. Aktuell 9 140 Zeichen. |
| **L2 Branche** | `industry_templates.prompt_block` über `customers.industry_template_id` | branchenspezifische Regeln |
| **L3 Kunde** | die `ai_*`-Spalten + `customer_operational_updates` + Kalender-Block | Wissensbasis, Regeln, Weiterleitungen |

Identität und Ton sind **keine eigene Ebene**, sondern **Variablen**, die in L1 hineinaufgelöst werden.

Kanonischer Builder: `admin-panel/netlify/functions/_lib/prompt-builder-v2.js`, Version `2.1`.

### 3.2 Variablen-Auflösung

`buildPromptV2()` (`prompt-builder-v2.js:203-219`) belegt u. a.:
`ASSISTANT_NAME`, `ASSISTANT_ROLE`, `CUSTOMER_DISPLAY_NAME`, `CUSTOMER_LEGAL_NAME`, `WIR_ODER_ICH`, `WIR_MELDET_SICH`, `TON`, `ANREDE`, `SPRACHE`, `BEGRUESSUNG` sowie die Kleinschreib-Varianten.

Der Live-Master-Prompt enthält `{{ASSISTANT_NAME}}`, `{{BEGRUESSUNG}}` und `{{SPRACHE}}` **[FAKT]**.

### 3.3 Der Master-Prompt hat keine Layer-Slots — **[FAKT]**

Direkt gegen die Produktionsdatenbank geprüft: `prompt_master_l1` enthält **weder** `{{INDUSTRY_LAYER}}` **noch** `{{CUSTOMER_LAYER}}`.

Der Builder fällt damit in den Anhänge-Zweig (`prompt-builder-v2.js:252-256`):

```js
if (prompt.includes('{{INDUSTRY_LAYER}}')) prompt = prompt.replace(...);
else prompt += `\n\n${industryLayer}`;
if (prompt.includes('{{CUSTOMER_LAYER}}')) prompt = prompt.replace(...);
else prompt += `\n\n${customerLayer}`;
```

Branchen- und Kundenlayer werden also **hinten angehängt**, nicht an einer bewusst gewählten Position eingesetzt. Die Layer-Reihenfolge im finalen Prompt ist eine Folge des Fallbacks, keine Designentscheidung. **[WAHRSCHEINLICH]** relevant für Weisungshierarchie und Konfliktauflösung im Modell.

### 3.4 Kernbefund Name: `ai_greeting` friert den Namen ein — **[FAKT]**

`prompt-builder-v2.js:190`:

```js
const firstMessage = text(customer.ai_greeting) || buildGreeting(assistantName, customerType, personName, firmName, language);
```

Der gespeicherte `ai_greeting` wird **roh** verwendet. Er läuft **nicht** durch `resolve()`. Er enthält den Namen als Literal, der zum Generierungszeitpunkt aktuell war. Kein Schreibweg (A–F) aktualisiert `ai_greeting`, wenn `assistant_name` geändert wird.

`firstMessage` wird dann an **zwei** Stellen verwendet:
1. als `conversation_config.agent.first_message` an ElevenLabs (`trigger-elevenlabs-sync.js:178`),
2. als Variable `BEGRUESSUNG` **im Prompt-Body selbst** (`prompt-builder-v2.js:213`).

**Produktionsbeleg, Kunde `cust_1786034079785_z8voxt` („E2E Test AG"):**

| Quelle | Wert |
|---|---|
| `customers.assistant_name` | `Umuttt` |
| `customers.ai_greeting` | `Grüezi, hier ist **Lara** von E2E Test AG. Das Gespräch wird zur Bearbeitung aufgezeichnet. Wie kann ich Ihnen helfen?` |
| Prompt-Snapshot vom 2026-08-07 13:38:50, Rollenzeile | `Du bist Umuttt, die Assistentin von E2E Test AG` |
| Vorkommen im selben Snapshot | **7× „Umuttt", 3× „Lara"** |

Der Assistent **stellt sich als Lara vor** und **bezeichnet sich im weiteren Gespräch als Umuttt**. Das ist exakt das gemeldete Symptom, an Produktionsdaten belegt.

Die Historie zeigt zusätzlich, dass der Name im Body korrekt mitwandert (`Umut` → `Umuttt` zwischen 12:59 und 13:14 Uhr), die Begrüssung aber über alle 17 Sync-Läufe hinweg unverändert bei „Lara" bleibt. **[FAKT]**

### 3.5 Rolle/Geschlecht der Assistenz

`loadPromptInputs()` (`trigger-elevenlabs-sync.js:61-69`) leitet `assistantRole` aus `voxera_voices.gender` ab:

```js
let assistantRole = 'die Assistentin';
if (customer.voice_id) {
  ... if (data?.gender === 'male') assistantRole = 'der Assistent';
}
```

Bei `voice_id = NULL` erfolgt **kein Lookup** → die Rolle bleibt weiblich, unabhängig von der tatsächlich im Agent aktiven Stimme. **[FAKT]**

Zusätzlich ist `buildGreeting()` (`prompt-builder-v2.js:80-100`) **geschlechtsblind**: „die Assistentin", „l'assistante", „assistant to" sind hartcodiert und erhalten `assistantRole` nicht. Eine automatisch generierte Begrüssung sagt also auch bei männlicher Stimme „die Assistentin". **[FAKT]**

### 3.6 Zweiter, divergenter Builder im Admin-Frontend — **[FAKT]**

`resolvePromptVariables()` (`admin-panel/index.html:15903`) + `buildCustomerLayer()` + `buildAiPrompt()` sind eine **eigene, clientseitige Neuimplementierung** des Prompt-Builders für die Vorschau. Sie weicht vom Server ab:

- `admin-panel/index.html:15925`:
  ```js
  const voiceGender = customer?.voice_id ? 'female' : 'female'; // default female (Lara)
  ```
  Beide Zweige liefern `'female'`. Die Vorschau zeigt **immer** „die Assistentin", auch bei männlicher Stimme.
- Kein `operationalUpdates`-Block, kein Kalender-Block, kein `[PROMPT_V2]`-Profil, keine Sicherheitsregeln, andere `tonMap`-Texte.

Die Admin-Vorschau bildet den real gepushten Prompt damit nicht zuverlässig ab. Es existiert mit `admin-panel/netlify/functions/prompt-preview.js` bereits ein serverseitiger Vorschau-Endpoint, der den kanonischen Builder verwendet — das Runtime-Modul `admin-runtime-prompt-builder-v2.js` bindet ihn an („exact preview"). Zwei Vorschau-Pfade koexistieren. **[WAHRSCHEINLICH]** Ursache dafür, dass Abweichungen im Admin nicht auffallen.

`buildAutoGreeting()` (`admin-panel/index.html:7401`) ist eine **dritte** Greeting-Implementierung, `buildDefaultGreeting()` in `elevenlabs-provision-agent.js:271` eine **vierte**. Alle vier weichen in Wortlaut und Typ-Behandlung voneinander ab (z. B. behandelt nur `prompt-builder-v2.js` den Typ `consultant` in allen vier Sprachen). **[FAKT]**

---

## 4. ElevenLabs-Sync-Mechanismus

### 4.1 Auslöser

| Auslöser | Ruft auf | `triggered_by` |
|---|---|---|
| Customer speichert Assistent-Änderung (A/B/C) | `customer-update-assistant` → `trigger-elevenlabs-sync` | `customer_self_edit` |
| Admin speichert AI-Konfiguration (E) | Frontend → `trigger-elevenlabs-sync` | `admin_save` |
| Admin speichert Wizard (D) | Frontend → `trigger-elevenlabs-sync` | `wizard` |
| Neuanlage Agent | `elevenlabs-provision-agent` → `trigger-elevenlabs-sync` | `provision_<x>` |
| Betriebsinfo veröffentlicht/beendet | `customer-operational-updates` | `customer_operational_update` |
| Admin manuell | `trigger-elevenlabs-sync-v2` → `trigger-elevenlabs-sync` | `admin_manual` |

**Kein Cronjob, kein Polling, kein Scheduler.** Der Sync ist rein ereignisgetrieben. **[FAKT]**

### 4.2 Topologie

`trigger-elevenlabs-sync.js` ist die **einzige** Stelle, die gegen die ElevenLabs-Agent-API PATCHt. **[FAKT]** Alle anderen Wege sind Proxys:

- `customer-dashboard/.../elevenlabs-sync-prompt.js` — reiner Weiterleitungs-Proxy, enthält bewusst keinen Builder.
- `admin-panel/.../trigger-elevenlabs-sync-v2.js` — Wrapper mit 24-s-Timeout, setzt vorab `elevenlabs_sync_status = 'syncing'`.

Das ist sauber; ein zweiter, divergenter Sync-Pfad zu ElevenLabs existiert **nicht**.

### 4.3 Was tatsächlich gepusht wird

`trigger-elevenlabs-sync.js:168-190`:

```js
conversation_config: {
  agent: { prompt: promptPatch, first_message: compiled.firstMessage },
  tts: customer.voice_id ? { voice_id: customer.voice_id } : undefined
},
platform_settings: { privacy: {...} }
```

**[FAKT]** Kritische Eigenschaften dieses Patches:

1. **`tts` wird bei `voice_id = NULL` komplett weggelassen.** `JSON.stringify` entfernt `undefined`-Properties. Es wird also *nichts* gesendet — nicht etwa ein Default. Der Agent behält, was auch immer zuletzt in ElevenLabs gesetzt war.
2. **`conversation_config.agent.language` wird nie gepatcht.** Es wird ausschliesslich bei der Erstprovisionierung gesetzt (`elevenlabs-provision-agent.js:197`). Spätere Änderungen an `ai_language` erreichen ElevenLabs **nie**.
3. Der Agent-Name (`Voxera – <Kunde>`) wird ebenfalls nur bei Provisionierung gesetzt.

### 4.4 Verhalten bei gleichzeitigen Änderungen

**[FAKT]** Es gibt **keinerlei** Nebenläufigkeitsschutz:

- kein Lock, keine Version, kein ETag, kein `updated_at`-Vergleich, kein optimistic concurrency;
- der Sync lädt beim Aufruf `select('*')` **den kompletten aktuellen Kundendatensatz** und baut den Prompt daraus neu;
- die einzige Konsistenzprüfung ist `agent_customer_mapping_mismatch` (Zeile 129-131), also ob Agent-ID und Kunde zusammenpassen.

Daraus folgt ein wichtiges Diagnose-Argument: Bei zwei zeitversetzten Syncs gewinnt schlicht der **letzte** — und dieser liest den *dann gültigen* DB-Zustand. Ein „veralteter" Prompt kann so nicht entstehen. **Ein Sync-Race erklärt die gemeldeten Symptome nicht.** Die Ursache liegt darin, *welche Werte in der DB stehen* (§2.3) bzw. *welche Werte gar nicht gepusht werden* (§4.3), nicht in der Reihenfolge der Syncs. **[WAHRSCHEINLICH]**

Einzige echte Race-Fläche: `trigger-elevenlabs-sync-v2` setzt vorab `elevenlabs_sync_status = 'syncing'`, während der aufgerufene `trigger-elevenlabs-sync` denselben Wert am Ende überschreibt. Bei parallelen Läufen kann der Statuswert falsch stehenbleiben. Betrifft nur die Statusanzeige, nicht den Prompt. **[FAKT]**

### 4.5 `elevenlabs_sync_log` — was tatsächlich drinsteht

Schema **[FAKT]**: `id`, `customer_id`, `agent_id`, `status`, `prompt_length`, `error_message`, `triggered_by`, `created_at`, `changed_fields` (jsonb), `prompt_snapshot` (text).

**Zwei Einschränkungen, die die geplante Diagnose direkt betreffen:**

1. **`changed_fields` ist immer NULL.** Die Spalte existiert, aber der `INSERT` in `trigger-elevenlabs-sync.js:210-219` schreibt sie nicht. Live geprüft: 17 von 17 Zeilen ohne Wert. Das Frontend sendet zwar `prev_values` mit (`admin-panel/index.html:8250-8261`), der Handler verwirft sie explizit — `void prev_values;` (Zeile 102). **[FAKT]** Ein Feld-Diff ist aus dem Log **nicht** rekonstruierbar; es muss aus aufeinanderfolgenden `prompt_snapshot`-Werten abgeleitet werden.

2. **Das Log wird auf 10 Zeilen pro Kunde beschnitten.** `trimSyncLogs()` (Zeile 80-87) löscht nach jedem Sync alles ausser den 10 neuesten Einträgen. **[FAKT]** Für die Korrelation eines konkreten Anrufs mit dem damals aktiven Prompt heisst das: **die Beweislage verfällt nach 10 Syncs.** Bei `customer_self_edit`-Frequenz kann das wenige Tage bedeuten. Wenn ein konkretes Bug-Beispiel untersucht werden soll, sollte der Snapshot vorher gesichert werden.

3. `prompt_snapshot` wird nur bei `status = 'success'` geschrieben, bei Fehlern `null`. **[FAKT]**

Aktueller Live-Stand des Logs (17 Zeilen, 2026-08-02 bis 2026-08-07) **[FAKT]**:

| `triggered_by` | Anzahl | Status |
|---|---|---|
| `customer_self_edit` | 11 | success |
| `admin_manual` | 3 | success |
| `customer_operational_update` | 2 | success |
| `provision_wizard` | 1 | success |

Bemerkenswert: **kein einziger `admin_save`- oder `wizard`-Eintrag.** Kein Fehlschlag. Das Log ist allerdings durch `trimSyncLogs` beschnitten und deckt nur einen Kunden mit Agent ab.

### 4.6 Weitere Nebeneffekte des Syncs

`trigger-elevenlabs-sync` macht mehr als Prompt-Übertragung **[FAKT]**: er provisioniert das Kalender-Werkzeug (`ensureWorkspaceTool`, `mergedAgentToolIds`), weist die Telefonnummer zu (`ensureAgentPhoneNumber`) und setzt die Aufzeichnungs-Retention auf 90 Tage. Ein Fehler in einem dieser Schritte lässt den **gesamten** Sync fehlschlagen (gemeinsamer `try`-Block), inklusive Prompt und Stimme. Umgekehrt: ist `calendarBlock` gesetzt, aber die Tool-Provisionierung nicht konfiguriert, wirft der Sync hart (`calendar_tool_provisioning_configuration_missing`, Zeile 162).

---

## 5. Bewertung der Ausgangshypothesen

| Hypothese aus dem Auftrag | Befund |
|---|---|
| „Stimmenwechsel deutet auf Sync-/Caching-Fehler zwischen Supabase und ElevenLabs" | **Teilweise bestätigt, Mechanismus anders.** Kein Caching-Fehler. Der Sync sendet bei `voice_id = NULL` schlicht **keinen** TTS-Patch (§4.3). Die DB ist dann nicht die Quelle der Wahrheit. Beim einzigen live-synchronisierten Kunden ist `voice_id` tatsächlich NULL. **[FAKT]** |
| „Parallele Schreibwege von Wizard, Admin und Customer überschreiben sich" | **Bestätigt, aber nicht als Race.** Es sind sechs Wege (§2.1) mit stark asymmetrischer Governance (§2.2). Der belegte Defekt ist ein **deterministischer Null-Überschreiber** im Admin-Panel (§2.3), keine Zeitkollision. **[FAKT]** |
| „`elevenlabs_sync_log` inkl. `prompt_snapshot`, `changed_fields` ist der beste Startpunkt" | **Nur halb tragfähig.** `prompt_snapshot` ist exzellent und hat den Namensbug bewiesen. `changed_fields` ist durchgehend NULL und als Diagnosemittel unbrauchbar (§4.5). Zusätzlich verfällt das Log nach 10 Einträgen pro Kunde. **[FAKT]** |
| „3-Layer-System Identität/Ton/Wissensbasis" | **Layer existieren, Achse ist eine andere:** Master / Branche / Kunde. Identität und Ton sind Variablen, keine Ebene. Zusätzlich fehlen im Live-Master-Prompt beide Layer-Slots, sodass L2/L3 angehängt statt eingesetzt werden (§3.3). **[FAKT]** |

---

## 6. Sprach-Handling — die offene Frage aus dem Auftrag

**Kurzantwort: Nein. Ein automatischer Sprachwechsel ist derzeit nicht konfiguriert.** **[FAKT]**

### 6.1 Was der Code tut

- Der ElevenLabs-Agent wird bei der Erstellung fest auf `conversation_config.agent.language = customer.ai_language || 'de'` gesetzt (`elevenlabs-provision-agent.js:197`).
- **Der Sync patcht dieses Feld nie wieder** (§4.3). Eine spätere Änderung von `ai_language` erreicht ElevenLabs nicht.
- Es gibt **nirgends** im Repository eine Nutzung von `language_presets` oder `additional_languages` — den ElevenLabs-Mechanismen für Mehrsprachigkeit. Verifiziert per Volltextsuche über beide Netlify-Funktionsbäume. **[FAKT]**
- Die einzige „Mehrsprachigkeit" ist ein Prosa-Satz im Prompt über die Variable `SPRACHE`.

### 6.2 Die `languageMap` passt nicht zu den gespeicherten Werten — **[FAKT]**

`prompt-builder-v2.js:197-202` kennt nur diese Schlüssel:

```js
de, de_en, de_en_fr, de_fr_it_en
```

Geschrieben werden aber **einzelne Sprachcodes**: die Admin-Wizard-Auswahl bietet `de | fr | it | en` (`admin-panel/index.html:8082-8085`), und `ai-apply-change.js:125` erlaubt Claude ebenfalls nur `de, fr, it, en`.

Folge über `languageMap[language] || language`:

| `ai_language` | Ergebnis für `{{SPRACHE}}` |
|---|---|
| `de` | „Deutsch (Standard)" |
| `fr` | wörtlich **„fr"** |
| `it` | wörtlich **„it"** |
| `en` | wörtlich **„en"** |

Bei jeder Nicht-Deutsch-Konfiguration landet ein blosser Sprachcode im Prompt statt einer Anweisung. Die Werte, die überhaupt einen automatischen Wechsel beschreiben würden (`de_en_fr`, `de_fr_it_en`), können über die UI gar nicht gesetzt werden.

### 6.3 `selected_languages` ist ein toter Pfad — **[FAKT]**

Das Feld wird geschrieben (Wizard, `admin-panel/index.html:7726-7730`: starter → `['de']`, business → `['de', <2. Sprache>]`, professional → `['de','fr','it','en']`) und im Customer-Dashboard nur **angezeigt** (`index.html:17013`).

Es wird von **keinem** Sync-, Prompt- oder Provisionierungs-Pfad gelesen. Verifiziert per Volltextsuche. Der beim Live-Kunden gesetzte Wert `['de','fr','it','en']` hat auf den Agent **keinerlei Wirkung**.

Es gibt zusätzlich einen dritten, unabhängigen Sprachbegriff: `wizard.sprachen` aus dem `[WIZARD]`-JSON in `ai_internal_notes`, der über `operationalLines()` (`prompt-builder-v2.js:133`) als Prosazeile in den Prompt gelangt. Drei parallele Sprachrepräsentationen ohne gemeinsame Quelle der Wahrheit. **[FAKT]**

### 6.4 Was daraus folgt

**[WAHRSCHEINLICH]** Erkennt der Agent heute überhaupt eine fremde Sprache, dann als reines Modellverhalten von `gemini-2.5-flash` unter einem deutschen Prompt — nicht durch Konfiguration. Ob und wie zuverlässig das geschieht, ist **[UNVERIFIZIERT]** und nur per Live-Testanruf klärbar.

Ebenfalls **[UNVERIFIZIERT]**: ob ASR (`scribe_realtime`, fest auf `pcm_16000`) und die auf Deutsch gepinnten `data_collection`-Beschreibungen (`summary_language: 'de'`) bei fremdsprachigen Anrufen sinnvoll arbeiten.

---

## 7. Korrelation eines konkreten Anrufs (Vorbereitung)

Sobald ein Beispiel vorliegt (Testkunde + Zeitpunkt), ist dies der belastbare Weg:

```sql
-- 1) Anruf identifizieren
select id, customer_id, elevenlabs_conversation_id, created_at, started_at
from calls
where customer_id = :customer_id
  and created_at between :von and :bis
order by created_at desc;

-- 2) Der zum Anrufzeitpunkt zuletzt erfolgreich gepushte Prompt
select created_at, triggered_by, status, prompt_length, prompt_snapshot
from elevenlabs_sync_log
where customer_id = :customer_id
  and created_at <= :anruf_zeitpunkt
  and status = 'success'
order by created_at desc
limit 1;

-- 3) Namens-Divergenz im Snapshot sichtbar machen
select created_at,
       substring(prompt_snapshot from 'Du bist [^\n,]{1,40}')      as rollen_name,
       substring(prompt_snapshot from 'hier ist ([^,.]{1,40})')    as begruessungs_name
from elevenlabs_sync_log
where customer_id = :customer_id
order by created_at desc;
```

**Grenzen dieser Methode, vorab benannt** **[FAKT]**:

- `changed_fields` liefert nichts (§4.5) — der Diff muss aus zwei aufeinanderfolgenden Snapshots gebildet werden.
- **Die tatsächlich verwendete Stimme lässt sich aus diesen Daten nicht rekonstruieren.** `prompt_snapshot` enthält nur den Prompt, nicht `voice_id`. Bei `voice_id = NULL` wurde ohnehin nie eine Stimme gepusht. Der Ist-Zustand ist ausschliesslich über die ElevenLabs-API (`GET /v1/convai/agents/{agent_id}`) bzw. die Conversation-Details zu ermitteln — dafür wird der `ELEVENLABS_API_KEY` benötigt, der in dieser Umgebung nicht vorliegt. **[UNVERIFIZIERT]**
- Wegen `trimSyncLogs` (10 Zeilen/Kunde) sollte der relevante Snapshot **vor** weiteren Syncs gesichert werden.

---

## 8. Offene Punkte für die anschliessende Diagnose

**[UNVERIFIZIERT]** — jeweils mit dem, was zur Klärung nötig ist:

1. **Welche Stimme ist im ElevenLabs-Agent aktuell wirklich gesetzt?** → ElevenLabs-API-Abfrage. Entscheidet, ob der Stimmenwechsel aus manuellen Eingriffen in der ElevenLabs-UI stammt oder aus einem anderen Pfad.
2. **Wie wurde `voice_id` auf NULL gesetzt?** Der Kunde hat laut `assistant_name` aktiv konfiguriert. Da `customer-update-assistant` `voice_id` nie auf NULL setzen kann (Zeile 121-122 lehnt Leerwerte ab) und der Wizard werterhaltend ist, bleiben `admin-mutate`/`admin-customer-update` oder ein direkter DB-Eingriff. → Audit-Log bzw. Rückfrage.
3. **Wird das Admin-Panel „AI Konfiguration speichern" in der Praxis genutzt?** Der Defekt aus §2.3 ist im Code bewiesen; im Log fehlen `admin_save`-Einträge. → Rückfrage an das Team.
4. **Wechselt der Agent live die Sprache?** → Testanruf auf Französisch/Englisch.
5. **Verhalten bei Plan-Downgrade:** `voice_id` und `assistant_name` bleiben nach einem Downgrade in der DB stehen und werden weiter gepusht, obwohl die Bearbeitung dann gesperrt ist. → Prüfen, ob gewollt.

---

## 9. Zusammenfassung in einem Satz

Die Symptome stammen **nicht** aus einer Sync-Kollision, sondern aus drei strukturellen Eigenschaften des Ist-Zustands: `ai_greeting` friert den Assistenznamen als Literal ein und wird von keinem Schreibweg nachgeführt (Namensbug, bewiesen); `voice_id = NULL` führt dazu, dass Stimme und abgeleitetes Geschlecht überhaupt nicht mehr synchronisiert werden (Stimmenbug, wahrscheinlich); und die Admin-Schreibwege besitzen im Gegensatz zum Customer-Weg keinerlei Feldvalidierung, sodass ein einzelner Panel-Klick sechs Identitätsfelder auf NULL setzen kann.

---

*Erstellt als Audit ohne Codeänderung gemäss AGENTS.md. Es wurden keine Produktionsdaten verändert; alle SQL-Zugriffe waren lesend.*
