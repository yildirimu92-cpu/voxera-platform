# Wird bei JEDER Änderung wirklich mit ElevenLabs synchronisiert?

**Diagnose, Stand 2026-08-09. Nur Befund, keine Fixes** — so beauftragt.
Grundlage: `main` @ `40ba07e` plus PR #859 (offen, Draft, `claude/new-session-hakq8g`).

## Kurzantwort

Nein. Es gibt fünf Klassen von Änderungen, die den Agenten nie erreichen — und
einen Pfad, der etwas Schlimmeres tut als nicht zu synchronisieren: er
überschreibt sechs Identitätsfelder mit `NULL` und schiebt genau das dann zu
ElevenLabs.

Die im Auftrag vorgesehene Verifikationsmethode („gegen `elevenlabs_sync_log`
prüfen, ob ein Eintrag mit den erwarteten `changed_fields` entsteht") ist heute
nicht durchführbar: `changed_fields` wird von keiner Codestelle geschrieben
(Befund S9).

---

## Teil A — Was überhaupt im Prompt landet

Alles, was `buildPromptV2()` (`admin-panel/netlify/functions/_lib/prompt-builder-v2.js`)
plus `calendarPromptBlock()` liest. Nur diese Felder sind „prompt-relevant";
alles andere darf ohne Sync geschrieben werden.

**Aus `customers`:**

| Feld | Wirkung im Prompt |
|---|---|
| `assistant_name` | `{{ASSISTANT_NAME}}`, Begrüssung |
| `ai_customer_type` | Wir/Ich-Form, Begrüssungsvariante |
| `ai_address_form` | Sie/Du |
| `ai_tone` | `{{TON}}` |
| `ai_language` | `{{SPRACHE}}`, Begrüssungssprache |
| `ai_person_name` | Begrüssung bei Einzelpersonen |
| `customer_legal_name`, `customer_name`, `name` | `{{CUSTOMER_LEGAL_NAME}}` |
| `customer_display_name` | `{{CUSTOMER_DISPLAY_NAME}}` |
| `ai_greeting` | `first_message` (überschreibt die generierte Begrüssung) |
| `ai_summary` | `{{ai_summary}}` |
| `ai_business_description`, `ai_services`, `ai_location_hours`, `ai_booking_faq` | Kunden-Layer-Abschnitte |
| `ai_instructions`, `ai_fallback_escalation`, `ai_response_constraints` | Anweisungen / Eskalation / Antwortgrenzen |
| `ai_forwarding_1_*`, `ai_forwarding_2_*` | Abschnitt WEITERLEITUNGEN |
| `ai_emergency_number` | Abschnitt NOTFALLNUMMER |
| `ai_internal_notes` | `[PROMPT_V2]`-Profil (Funktionen, Pflichtinfos, Terminbefugnis, Unsicherheits-Fallback) **und** `[WIZARD]`-Block |
| `voice_id` | `conversation_config.tts.voice_id` **und** indirekt `{{ASSISTANT_ROLE}}` über `voxera_voices.gender` |
| `industry_template_id` | wählt den Branchen-Layer |
| `ai_branch_extra` | **ab PR #859 / Prompt-Builder 2.2** Quelle der Wizard-Variablen |

**Aus anderen Tabellen:**

| Quelle | Wirkung |
|---|---|
| `system_config.value` @ `key='prompt_master_l1'` | kompletter Layer 1 |
| `industry_templates.prompt_block` | kompletter Layer 2 |
| `industry_templates.extra_steps` | (ab #859) definiert die erlaubten `ai_branch_extra`-Schlüssel |
| `customer_operational_updates` (`status='published'`, `ends_at > now()`) | Abschnitt AKTUELLE BETRIEBSINFORMATIONEN |
| `calendar_settings` (`feature_enabled`, `active_provider`, `appointment_duration_minutes`, `timezone`) | Abschnitt KALENDER **und** `tool_ids` des Agenten |
| `voxera_voices.gender` | `{{ASSISTANT_ROLE}}` („die Assistentin" / „der Assistent") |

---

## Teil B — Alle Schreibpfade, einzeln nachverfolgt

### Pfade, die zuverlässig synchronisieren

| # | Pfad | Trigger | Verdikt |
|---|---|---|---|
| 1 | Admin-Wizard, Praxis-/Branchenschritt (`index.html:7751`) | `trigger-elevenlabs-sync` `triggered_by=wizard`, sonst `elevenlabs-provision-agent` | ✅ synct, provisioniert sogar bei fehlendem Agenten |
| 2 | Admin AI-Setup-Tab (`index.html:8248`) | `trigger-elevenlabs-sync` `admin_save` | ⚠️ synct — aber siehe **S1**, was es vorher schreibt |
| 3 | Admin „Änderungswunsch übernehmen" (`confirmApplyChange`, `index.html:16512`) | `trigger-elevenlabs-sync` `customer_request` | ✅ synct (still, wenn kein Agent — **S8**) |
| 4 | Admin „Jetzt synchronisieren" (`admin-runtime-sync.js:106`) | über Routing-Shim → `trigger-elevenlabs-sync-v2` | ✅ funktioniert; die fehlende `agent_id` im Aufruf wird von v2 aus der DB nachgeladen |
| 5 | Kundendashboard Assistent/Geschäftswissen (`customer-update-assistant.js:207`) | `trigger-elevenlabs-sync` `customer_self_edit` | ✅ synct — ausser bei reinen Weiterleitungsänderungen (**S6**) |
| 6 | Kundendashboard Betriebsinformationen (`customer-operational-updates.js:67`) | `trigger-elevenlabs-sync` `customer_operational_update` | ✅ synct bei create/update/cancel — nicht bei Ablauf (**S3**) |
| 7 | Agent-Provisionierung (`elevenlabs-provision-agent.js:239`) | `trigger-elevenlabs-sync` `provision_*` | ✅ |
| 8 | Proxy `elevenlabs-sync-prompt.js` | reicht an `trigger-elevenlabs-sync` durch | ✅ (derzeit von keiner UI aufgerufen) |

### Pfade, die prompt-relevante Daten ändern und NICHT synchronisieren

| # | Pfad | Geänderte prompt-relevante Daten | Befund |
|---|---|---|---|
| 9 | `calendar-connections.js:159` (`save_settings`), `:239` (`disconnect`), `calendar-oauth-callback.js:93` | `calendar_settings.*` | **S2** |
| 10 | Ablauf von `customer_operational_updates` (Zeitfenster, kein Schreibvorgang) | Abschnitt AKTUELLE BETRIEBSINFORMATIONEN | **S3** |
| 11 | `system_config.prompt_master_l1`, `industry_templates.prompt_block` (nur direkt in Supabase editierbar) | Layer 1 und Layer 2 aller Kunden | **S4** |
| 12 | Admin-Modal „Kunde bearbeiten" (`submitEditCustomer`, `index.html:13931`) | `customer_name`, `assistant_name` | **S5** |
| 13 | `admin-voices.js:145` (Stimme im Katalog bearbeiten) | `voxera_voices.gender` → `{{ASSISTANT_ROLE}}` | **S7** |

### Pfade, die `customers` schreiben, aber nichts Prompt-Relevantes — kein Handlungsbedarf

`customer-update-settings.js` (Weiterleitungs-Setup, Aktivierung, Avatar — feste
Allowlist, keine `ai_*`-Felder) · `customer-status-update.js` · `customer-billing-update.js` ·
`contract-terminate.js` · `lifecycle-runner.js` · `_lib/contract-billing-orchestrator.js` ·
`_lib/offer-acceptance.js` (legt Kunden an, bevor ein Agent existiert — die
Provisionierung synct später) · `trigger-elevenlabs-sync-v2.js` (schreibt nur
Sync-Status) · `create-customer.js` · `onboarding-update.js`.
`customer-dashboard/netlify/functions/ai-apply-change.js` ist ein deaktivierter
Duplikat-Endpunkt (HTTP 410) und schreibt nichts.

---

## Teil C — Befunde

### S1 · Kritisch, aktiv: Der AI-Setup-Tab löscht sechs Identitätsfelder und synct die Löschung

`saveCustomerAiConfig()` (`admin-panel/index.html:8226-8248`) schreibt in jedem Fall:

```js
assistant_name:   cfg.assistantName||null,
ai_customer_type: cfg.customerType||null,
ai_address_form:  cfg.addressForm||null,
ai_tone:          cfg.tone||null,
ai_language:      cfg.language||null,
ai_greeting:      cfg.greeting||null,
```

Diese sechs `cfg`-Schlüssel werden **nirgends im Repo je gesetzt**
(`grep -n "cfg\.\(assistantName\|customerType\|addressForm\|tone\|language\|greeting\)\s*="` → keine Treffer).
Die Hydrierung von `state.aiConfigs` beim Laden (`index.html:15220-15243`) füllt
nur `businessDescription`, `services`, `locationHours`, `bookingFaq`,
`instructions`, `fallbackEscalation`, `responseConstraints`, `internalNotes`,
`summary`, `industryTemplateId`. Die Identitätsfelder fehlen dort — und der
AI-Setup-Tab hat auch gar keine Eingabefelder dafür.

Folge: Jeder Klick auf „AI Konfiguration speichern" setzt Name, Kundentyp,
Anrede, Ton, Sprache und Begrüssung des Kunden auf `NULL` — und der direkt
danach ausgelöste Sync (`index.html:8253`) überträgt genau diesen Verlust an den
Agenten. Am Telefon meldet sich danach „Lara", per Sie, `professional`, auf
Deutsch, mit generierter Begrüssung — egal was der Wizard oder der Kunde vorher
konfiguriert hatte.

Das ist die Umkehrung der Ausgangsfrage: nicht ein fehlender Sync, sondern ein
Sync, der zerstörte Daten zuverlässig ausliefert.

Nebenbefund: Der Button ist doppelt verdrahtet (`onclick` in `index.html:2552`
**und** `addEventListener` in `index.html:14745`) — ein Klick löst den Speichervorgang
zweimal aus.

### S2 · Kritisch: Kalendereinstellungen ändern den Prompt, lösen aber nie einen Sync aus

`calendarPromptBlock()` erzeugt aus `calendar_settings` einen kompletten
Prompt-Abschnitt, und `trigger-elevenlabs-sync.js:156-166` hängt bei aktivem
Kalender zusätzlich die `tool_ids` an den Agenten. Beides passiert
ausschliesslich zum Sync-Zeitpunkt.

Geschrieben wird `calendar_settings` an drei Stellen, keine davon synct:
`calendar-connections.js:159` (`save_settings` — inkl. `feature_enabled`,
`active_provider`, `appointment_duration_minutes`, `timezone`),
`calendar-connections.js:239` (beim Trennen eines Providers wird
`feature_enabled` auf `false` gesetzt) und `calendar-oauth-callback.js:93`.

Beide Richtungen sind schädlich:
- **Einschalten ohne Sync** → der Agent hat das Tool `manage_voxera_calendar`
  nicht und keine Buchungsanweisung. Der Kunde sieht „Kalender verbunden", der
  Agent kann nichts buchen.
- **Ausschalten/Trennen ohne Sync** → der Agent behält Tool und Anweisung und
  bucht weiter in einen abgehängten Kalender.

In Produktion existiert derzeit keine Zeile in `calendar_settings`, der Pfad ist
also noch nicht scharf geworden.

### S3 · Hoch: Betriebsinformationen laufen ab, ohne dass der Prompt nachgezogen wird

`loadPromptInputs()` filtert `customer_operational_updates` mit
`.gt('ends_at', nowIso)` — der Ablauf ist eine reine Lesezeit-Bedingung. Der
Prompt bei ElevenLabs ist aber eine eingefrorene Momentaufnahme.

Es gibt keinen geplanten Re-Sync: die drei Netlify-Schedules im Admin-Panel sind
`outbox-retry-worker`, `daily-billing-runner`, `lifecycle-runner`; im
Kundendashboard `cleanup-stale-calls` und `enforce-data-retention`. Keiner davon
berührt den Prompt.

Folge: „Wir haben bis 8. August Betriebsferien" bleibt nach dem 8. August im
Agentenprompt stehen, bis zufällig irgendein anderer Speichervorgang einen Sync
auslöst. Dasselbe gilt spiegelbildlich für den Beginn eines Fensters: eine für
nächste Woche geplante Schliessung ist bereits jetzt im Prompt (der Zeitraum
steht als Text drin, die Einhaltung hängt am Sprachmodell) — und ein Fenster,
das nach dem letzten Sync beginnt, wird korrekt übertragen, weil der Filter nur
auf `ends_at` prüft.

### S4 · Hoch: Master-Prompt und Branchenvorlagen haben keinen Fan-out

`system_config.prompt_master_l1` (Layer 1) und `industry_templates.prompt_block`
(Layer 2) werden im gesamten Repo **nur gelesen**, nie geschrieben — sie werden
direkt in Supabase gepflegt. Es existiert kein Mechanismus, der nach einer
Änderung alle betroffenen Kunden neu synchronisiert.

Folge: Eine Korrektur am Master-Prompt — inklusive der Sicherheitsregeln —
erreicht **null** Agenten, bis jeder Kunde einzeln von Hand synchronisiert wird.
Dasselbe gilt für Branchenvorlagen. In Produktion wurde `prompt_master_l1`
zuletzt am 2026-05-07 geändert; die ältesten Zeilen in `elevenlabs_sync_log`
stammen vom 2026-08-02, ein Nachweis über die Logs ist daher nicht mehr möglich.

Das ist auch der Grund, warum die D4-Härtung aus PR #859
(`neutralizePlaceholders`, Prompt-Builder 2.2) nach dem Merge nicht von selbst
wirksam wird: Sie greift erst beim nächsten Sync jedes einzelnen Kunden.

### S5 · Mittel: „Kunde bearbeiten" ändert Firmenname und Assistentenname ohne Sync — und schlägt zusätzlich komplett fehl

`submitEditCustomer()` (`index.html:13931`) schreibt u.a. `customer_name` und
`assistant_name` — beides prompt-relevant — und ruft danach keinen Sync auf.

Unabhängig davon dürfte dieser Speichervorgang aktuell überhaupt nicht
durchgehen: `admin-runtime-data-integrity.js` routet `admin-mutate`/`customers.update`
auf `admin-customer-update.js`, dessen `PROTECTED_FIELDS` unter anderem `status`,
`plan`, `plan_code`, `payment_status`, `voxera_number` und `elevenlabs_agent_id`
enthält. Genau diese sechs Schlüssel stehen im Payload des Modals → HTTP 409
`protected_customer_fields`, der gesamte Speichervorgang wird abgelehnt.

Das ist aus dem Code abgeleitet, nicht in der laufenden Oberfläche
nachgestellt — bitte beim nächsten Live-Test mitprüfen.

### S6 · Mittel, latent: `skipped_forwarding_only` ist eine bewusste Sync-Lücke auf prompt-relevanten Feldern

`customer-update-assistant.js:198-230` teilt die geänderten Felder in
`FORWARDING_FIELDS` und den Rest. Ändert der Kunde **nur** Weiterleitungen oder
die Notfallnummer, wird der Status auf `skipped_forwarding_only` gesetzt und
**kein** Sync ausgelöst.

Diese sieben Felder stehen aber im Prompt (`prompt-builder-v2.js:236-240`,
Abschnitte WEITERLEITUNGEN und NOTFALLNUMMER). Die Annahme hinter der Ausnahme
— Weiterleitung sei reine Telefonie-Konfiguration — stimmt nicht.

Heute ist der Pfad tot: keine Oberfläche im Kundendashboard sendet diese Felder
(`ai_forwarding_*` und `ai_emergency_number` werden in `index.html:13117-13123`
und `:16347-16353` nur gelesen), und PR #859 zeigt die Kategorie
„Weiterleitungen/Notfall" ebenfalls nur an. Der Zweig ist also nur per direktem
API-Aufruf erreichbar. Er wird in dem Moment scharf, in dem dieser Screen
editierbar wird.

Zusätzlich: `customer-runtime-assistant-profile.js:526-533` behandelt in der
Oberfläche nur `failed` und `skipped_no_agent` als Warnung.
`skipped_forwarding_only` läuft als „✓ Gespeichert." durch — der Kunde bekäme
also eine Erfolgsmeldung für etwas, das den Agenten nie erreicht.

### S7 · Mittel: Geschlechtsänderung im Stimmenkatalog wirkt auf alle zugewiesenen Kunden, ohne Sync

`trigger-elevenlabs-sync.js:61-69` leitet `{{ASSISTANT_ROLE}}` aus
`voxera_voices.gender` ab. `admin-voices.js:145` erlaubt das Bearbeiten genau
dieses Feldes. Wird eine Stimme von `female` auf `male` korrigiert, ändert das
den Prompt jedes Kunden mit dieser Stimme — ohne dass irgendetwas synchronisiert
wird. Gleiche Klasse wie S4, nur kleinerer Radius.

### S8 · Mittel: Sync ohne Agent verschwindet still

`saveCustomerAiConfig()` und `confirmApplyChange()` synchronisieren nur innerhalb
von `if (c?.elevenlabs_agent_id)`. Fehlt der Agent, passiert nichts — kein
Hinweis, keine Provisionierung. Nur der Wizard-Pfad (#1) provisioniert in diesem
Fall nach. Serverseitig ist das Verhalten sauber gemeldet
(`skipped_no_agent` in `customer-update-assistant.js:227`), in der Admin-UI nicht.

### S9 · Diagnose-Blocker: `changed_fields` wird von niemandem geschrieben

Die Spalte existiert (`elevenlabs_sync_log.changed_fields`, `jsonb`, in
Produktion vorhanden), und die Admin-Oberfläche liest sie
(`index.html:16405`, rendert „Geändert: …"). Geschrieben wird sie nie:
Der Insert in `trigger-elevenlabs-sync.js:210-219` setzt sie nicht, und das
mitgelieferte `prev_values` wird in Zeile 102 mit `void prev_values;`
ausdrücklich verworfen — obwohl drei Aufrufer es befüllen und
`trigger-elevenlabs-sync-v2.js` sowie `elevenlabs-sync-prompt.js` es
durchreichen.

Messung in Produktion: **20 Log-Zeilen, davon 0 mit `changed_fields`**
(2026-08-02 bis 2026-08-09).

Damit ist Auftragspunkt 3 in der vorgesehenen Form nicht durchführbar: Aus dem
Log lässt sich ablesen *dass* ein Sync lief, aber nicht *welches Feld* ihn
ausgelöst hat.

### S10 · Niedrig: Das Log ist kein Audit-Trail

`trimSyncLogs()` (`trigger-elevenlabs-sync.js:80-87`) behält pro Kunde die
letzten 10 Einträge und löscht den Rest bei jedem Sync. Für eine Rückschau über
mehrere Tage taugt das Log nicht.

### S11 · Info: Über-Sync bei nicht prompt-relevanten Feldern

`notification_mode` und die sechs `sms_*`-Felder landen in `patch` und zählen
damit als `hasNonForwardingChange` → jede SMS-Einstellung löst einen vollen
Prompt-Rebuild und einen ElevenLabs-PATCH aus. Harmlos, aber die Kehrseite
derselben fehlenden Feldklassifikation wie S6.

### S12 · PR #859: kein verlorener Sync-Aufruf

Der Verdacht aus dem Briefing („Refactor, bei dem ein Sync-Aufruf verloren
geht") bestätigt sich für #859 **nicht**. Geprüft am Diff des offenen Branches
`claude/new-session-hakq8g`:

- Alle Speicheraktionen der neuen Oberfläche (`saveBranch`, `saveTune`,
  `resetGreeting`, Namensänderung) laufen über `updateAssistant()` →
  `customer-update-assistant` → bestehender Sync-Aufruf.
- Das neue Feld `ai_branch_extra` (I8) wird in `patch` gelegt und fällt nicht
  unter `FORWARDING_FIELDS` → löst einen Sync aus. ✅
- `ai_branch_extra` wird durch Prompt-Builder 2.2 erstmals prompt-relevant.
  Beide Schreibwege sind abgedeckt: Admin-Wizard (`index.html:7702`, synct) und
  Kundendashboard (neu, synct).
- Die Kategorie „Weiterleitungen/Notfall" ist in #859 nur Anzeige, nicht
  editierbar — S6 bleibt damit latent.

Der Merge von #859 erhöht allerdings die Dringlichkeit von S4: die D4-Härtung
(`neutralizePlaceholders`) wirkt erst nach einem Sync pro Kunde.

---

## Teil D — Verifikation gegen die Datenbank

Gegen Produktion (`ulcofbgrovgcvowdjrge`) gelesen, nichts verändert:

- `elevenlabs_sync_log`: 20 Zeilen, 2026-08-02 bis 2026-08-09.
  Verteilung: `customer_self_edit` 16 ×, `admin_manual` 3 ×, `wizard` 1 × —
  alle `success`. **0 Zeilen mit `changed_fields`.**
- `customers`: 4 Datensätze, davon **einer** mit ElevenLabs-Agent
  (`E2E Test AG`, letzter Sync 2026-08-09 01:47, kein Drift zwischen
  `updated_at` und `elevenlabs_last_sync_at`).
- `calendar_settings`: leer — S2 ist noch nicht scharf geworden.
- `customer_operational_updates`: 1 Zeile, `cancelled`, Fenster abgelaufen.
- `system_config.prompt_master_l1`: zuletzt geändert 2026-05-07, also vor dem
  Beginn des heutigen Log-Fensters.

**Was ich nicht getan habe:** den in Auftragspunkt 3 beschriebenen Test
„jedes Feld einzeln ändern und den Log-Eintrag prüfen". Dafür müsste ich Daten
des einzigen echten Testkunden in Produktion verändern und die Agentenkonfiguration
bei ElevenLabs anfassen — das habe ich ohne Freigabe unterlassen. Zwei Wege
stehen offen: Freigabe für `cust_1786034079785_z8voxt` in Produktion, oder der
Testlauf auf `voxera-staging`, sobald dort ein Kunde mit Agent existiert. Ohne
S9 (fehlende `changed_fields`) bliebe die Aussagekraft in beiden Fällen
begrenzt — man sieht nur, *ob* ein Sync lief.

---

## Teil E — Muster hinter den Befunden

Der Sync ist heute an einzelne Speicher-Handler in der Oberfläche geknüpft, nicht
an die Daten. Daraus folgen alle fünf echten Lücken:

- Wer den Prompt aus **einer anderen Tabelle** speist, hat keinen Sync-Aufruf
  (S2 Kalender, S4 Master/Branche, S7 Stimmen).
- Wer den Prompt **ohne Schreibvorgang** ändert, kann keinen auslösen
  (S3 Zeitablauf).
- Wer einen **neuen Speicher-Handler** baut, muss daran denken
  (S5 Kunde-bearbeiten-Modal).
- Und die eine Stelle, die aufgrund einer Feldliste *entscheidet*, ob gesynct
  wird, hat diese Liste falsch gezogen (S6).

Der im Briefing skizzierte Zielzustand — ein garantierter, zentraler Trigger nach
dem Muster von `_lib/mail-delivery.js` (PR #857) — adressiert S5 und S6, aber
weder S2/S4/S7 (andere Tabelle) noch S3 (kein Schreibvorgang). Dafür braucht es
zusätzlich einen Fan-out über betroffene Kunden und einen zeitgesteuerten
Re-Sync. Das ist bewusst noch keine Empfehlung — erst gemeinsam entscheiden.

## Nächster Schritt

Rückmeldung, welche Befunde in welcher Reihenfolge angegangen werden. Aus meiner
Sicht sticht S1 heraus: dort geht es nicht um einen verspäteten Sync, sondern um
Datenverlust, der bei jedem Speichern im AI-Setup-Tab entsteht und sofort an den
Agenten weitergereicht wird.
