# Diagnose: sechs fehlschlagende Verify-/Audit-Skripte

**Datum:** 2026-08-09
**Anlass:** Beim vollständigen Lauf aller Verify-/Audit-Skripte des Repos (entdeckt
beim Merge von PR #851) schlugen sechs auf `main` fehl — unabhängig von den
Design-PRs, bereits vorher so.
**Auftrag:** Diagnose, kein Fix. Für jedes Skript: Was wird geprüft, warum
schlägt es fehl, echte Lücke oder veraltete Erwartung, wie kritisch.

**Belegbasis:** lokale Läufe aller sechs Skripte; Git-Historie (Repo war ein
Shallow Clone, für diese Analyse per `git fetch --unshallow` auf 4 700 Commits
vervollständigt); 26 CI-Läufe von `verify-db-security-invariants.yml`;
lesende Abfragen gegen die Produktions-DB (`ulcofbgrovgcvowdjrge`); Blueprint
der aktiven Make-Szenario „09. Voxera Central Mail Engine – Audited v5 Final".

---

## Kurzurteil

| Skript | Exit | Befund | Kritikalität |
| --- | --- | --- | --- |
| `verify-db-security-invariants` | 2 lokal / 1 in CI | **echter Befund** — Ledger-Drift auf Produktion | **hoch (Prozess), niedrig (Inhalt)** |
| `verify-invoice-only-swiss-billing` | 1 | veralteter Test (4 von 17 Checks) | kosmetisch |
| `verify-payment-account-settings` | 1 | veralteter Test, Code ist heute strenger | kosmetisch |
| `verify-supabase-ssot` | 1 | veralteter Test — Tabelle heisst `voxera_cases` | kosmetisch |
| `verify-commercial-orchestrator-p1_5` | 1 | veralteter Test — Whitespace | kosmetisch |
| `verify-elevenlabs-phone-number-assignment` | 1 | **kaputter Test, war nie grün** | kosmetisch, Check wertlos |

Fünf von sechs sind veraltete Testerwartungen ohne Substanzverlust. Der sechste
ist ein echter Befund derselben Fehlerklasse wie der P0-Vorfall.

---

## 1. `verify-db-security-invariants` — echter Befund

### Zwei verschiedene Fehlschläge nicht verwechseln

**Lokal: Exit 2.** Ohne `SUPABASE_DB_URL` bzw. die Einzelfelder kann das Skript
nichts messen und meldet das als „nicht prüfbar". Exit 2 ist laut
`docs/DB_SECURITY_CI_SETUP.md` bewusst ebenfalls rot — ein Check, der bei
unerreichbarer Datenbank grün meldet, wäre genau der abgeschaffte Fehlermodus.
Das ist **kein Befund**, sondern die Absicherung. Der Fehlschlag in der lokalen
53er-Runde zeigt den eigentlichen Befund also gar nicht.

**In CI: Exit 1.** Mit Secrets läuft der Check gegen Produktion und findet eine
verletzte Invariante.

### CI-Verlauf

26 Läufe. Läufe 8–11 grün (bis 2026-08-08 14:58). Ab Lauf 12 (15:42) und alle
15 seither rot, durchgehend mit demselben Ergebnis:

```
209 bestanden, 1 verletzt, 50 uebersprungen
```

### Die verletzte Invariante

Gruppe G, Richtung 2:

```
[FAIL] keine DB-Migration ohne Repo-Datei
       nur auf der DB: customer_effective_greeting, call_summary_correction
```

Nachgeprüft in `supabase_migrations.schema_migrations`:

| Version | Name | Repo-Datei |
| --- | --- | --- |
| `20260808151344` | `customer_effective_greeting` | `supabase/sql/2026-08-08_customer_effective_greeting.sql` |
| `20260808191250` | `call_summary_correction` | `supabase/sql/2026-08-08_call_summary_correction.sql` — **nur auf einem ungemergten Branch** |

Der Zeitstempel 15:13 erklärt, warum Lauf 12 um 15:42 als erster rot war.

### Warum der Check sie nicht findet

`checkLedger()` in `scripts/verify-db-security-invariants.mjs:250` liest
ausschliesslich `supabase/migrations/`. Das Repo legt DDL aber überwiegend in
`supabase/sql/` ab — **66 Dateien dort gegenüber 17 in `supabase/migrations/`**.
Jede aus `supabase/sql/` heraus angewandte Änderung erscheint zwangsläufig als
Waise. Der Check tut genau, was er soll; die Verzeichniswahl deckt sich nur
nicht mit der gelebten Konvention.

### Herkunft — geklärt, nicht mehr offen

`call_summary_correction` stammt aus der Etappe-4-Teil-B-Arbeit (Feature 3,
„KI-Zusammenfassung korrigieren"). Branch:
`origin/claude/anfragen-detail-features-plan-nxal72`, Commit `2066abb2`
(„Abnahme Feature 3: Migration auf Produktion, Nachpruefung dokumentiert",
2026-08-08 19:27 UTC). Der Branch trägt:

- `supabase/sql/2026-08-08_call_summary_correction.sql`
- `supabase/verification/call_summary_correction_post_migration.sql`
- `customer-dashboard/netlify/functions/call-save-summary-correction.js`
- `.github/workflows/verify-call-summary-correction.yml`
- Tests und Plandokument

**Der Branch ist nicht gemergt und hat keinen offenen PR.** Die Migration wurde
bewusst vor dem Merge auf Produktion angewandt und die Nachprüfung im
Commit-Text dokumentiert.

Damit ist der Befund **kein unbekannter Out-of-Band-Eingriff**, sondern die
Kombination zweier Umstände:

1. **Verzeichnis-Konvention** — die Datei liegt (bzw. landet) in
   `supabase/sql/`, der Check liest `supabase/migrations/`.
2. **Anwenden vor dem Merge** — solange `nxal72` nicht in `main` ist, kennt
   `main` die Datei überhaupt nicht.

Wichtig: Punkt 1 heisst, dass **auch ein Merge von `nxal72` den Check nicht
grün macht**. Die Datei käme in `supabase/sql/` an und bliebe unsichtbar.

### Inhaltliche Bewertung

Beide Migrationen sind rein additiv:

- `customer_effective_greeting`: `ALTER TABLE public.customers ADD COLUMN ai_effective_greeting text`
- `call_summary_correction`: `ALTER TABLE public.calls ADD COLUMN call_summary_corrected, _corrected_at, _corrected_by`

Rechte auf Produktion nachgemessen (`has_column_privilege`):

| Spalte | anon SELECT | anon UPDATE | authenticated SELECT | authenticated UPDATE |
| --- | --- | --- | --- | --- |
| `customers.ai_effective_greeting` | nein | nein | ja | **nein** |
| `calls.call_summary_corrected` | nein | nein | ja | **nein** |
| `calls.call_summary_corrected_at` | nein | nein | ja | **nein** |
| `calls.call_summary_corrected_by` | nein | nein | ja | **nein** |

Keine neue Policy, kein neuer Grant, keine Funktion. Die spaltengenaue
UPDATE-Allowlist auf `calls` und `customers` ist unverändert (Gruppe F6 grün).
**Inhaltlich harmlos.**

### Warum der Befund trotzdem ernst zu nehmen ist

Der Ledger-Abgleich ist die einzige Stelle, die Repo und Datenbank
gegeneinander hält. Beim P0-Vorfall lag die Wahrheit im Repo und fehlte auf der
DB; hier liegt sie auf der DB und fehlt im Repo. Beide Male ist Drift nur durch
diesen Abgleich sichtbar. Solange er wegen bekannter Drift rot steht, ist ein
**neuer** Befund nicht mehr davon zu unterscheiden — ein dauerhaft roter
Security-Check verliert seine Signalwirkung genauso wie ein dauerhaft grüner,
der nichts misst.

### Gegenprobe: was der Check strukturell nicht sieht

Auf die Frage, ob hier dieselbe Lücke wie beim P0-Check klafft, zusätzlich
geprüft:

**Views und Matviews sind in keiner Gruppe abgedeckt.** Sämtliche
Katalog-Abfragen in `supabase/verification/db_security_invariants_catalog.sql`
filtern auf `relkind = 'r'` — gewöhnliche Tabellen. Views (`'v'`), Matviews
(`'m'`), partitionierte (`'p'`) und Foreign Tables (`'f'`) fallen weder unter
die RLS-Prüfung noch unter die Grant-Baseline. Eine View auf Mandantendaten
läuft ohne `security_invoker` mit den Rechten ihres Owners und umginge RLS
vollständig.

*Aktuell kein Loch:* auf Produktion existieren **null** Views, Matviews,
partitionierte und Foreign Tables im Schema `public` (nachgemessen). Es ist ein
unbewachter zukünftiger Pfad, kein aktiver Befund.

**Gruppe F3 prüft gegen eine feste Liste.** `anon`-EXECUTE wird nur für zwölf
namentlich genannte Signaturen geprüft. Nachgemessen: zwei SECURITY-DEFINER-
Funktionen in `public` haben `anon`-EXECUTE und stehen nicht auf der Liste —
`apply_offer_credit_to_invoice_v1()` und `sync_ai_change_request_from_case()`.

*Kein aktiver Eskalationspfad:* beide geben `trigger` zurück und sind als
Trigger gebunden. Postgres lehnt einen Direktaufruf ab, PostgREST stellt
Trigger-Funktionen nicht als RPC bereit. Der Grant ist ein wirkungsloser
Supabase-Default. Eine **künftige** Nicht-Trigger-SECDEF-Funktion mit
Default-Grant wäre dagegen `anon`-aufrufbar, und F3 würde schweigen.

Gruppe F2 (`search_path`-Pinning) ist demgegenüber ein echter Zensus über alle
SECDEF-Funktionen und deckt Neuzugänge ab.

---

## 2. `verify-invoice-only-swiss-billing` — veraltet, 4 von 17 Checks

**Geprüft wird:** dass der Rechnungsversand ausschliesslich über die Swiss-QR-
Rechnung läuft — Admin-Schutz, PDF-Pflicht, PDF als Anhang, keine
Payment-Link-Nutzlast, Schweizer Locale/Zeitzone, Migration räumt alte
Payment-Links ab.

**Warum es fehlschlägt:** Das Skript entstand am 2026-08-01 um 02:15 gegen den
Stand `43c3472e` (02:09) von `admin-panel/netlify/functions/invoice-mail-dispatch.js`.
Um 10:56 desselben Tages schrieb `ea88fd47` („Use natural billing copy for
invoice delivery") die Datei um: **−207/+48 Zeilen**, Payload kompakt
formatiert.

| Check | Erwartet | Tatsächlich |
| --- | --- | --- |
| QR-PDF erforderlich | `qr_invoice_missing` | Bedingung **byte-identisch**, `step_failed` heisst jetzt `invoice_pdf_missing` |
| PDF als Anhang | `attachments: [{` | `attachments:[{` — Leerzeichen |
| explizit invoice-only | `payment_method: 'swiss_qr_invoice'` | `payment_method:'invoice'` — **Wertänderung** |
| Schweizer Locale/TZ | `locale: 'de-CH'` | `locale:'de-CH'` — Leerzeichen |

Die Schutzbedingung selbst ist unverändert:

```js
if (!trim(invoice.pdf_url) || !trim(invoice.qr_payload) || Number(invoice.pdf_version || 0) < 1) {
```

identisch in `43c3472e:146` und heute in `:99`. Nur Meldung und Fehlercode
wurden umbenannt, konsistent auch in `invoice-mail-preview.js`. Kein Konsument
wertet `step_failed` aus.

**Die Wertänderung war der einzige mögliche Regressionskandidat.** Nachgeprüft
im Blueprint des aktiven Make-Szenarios: der Router-Filter „Swiss QR Billing"
verzweigt auf `{{1.mail_type}}` = `invoice_email` / `reminder_email`, **nicht**
auf `payment_method`. Kein Template rendert das Feld. Der einzige Treffer für
`swiss_qr_invoice` im Blueprint steht im gespeicherten Webhook-Beispiel-Payload
(Feld-Mapping), nicht in einer Bedingung.

**Bewertung:** veralteter Test, Substanz vollständig intakt. Randnotiz:
`payment_method` trägt im Repo drei Werte für denselben Sachverhalt
(`invoice`, `bank_transfer`, historisch `swiss_qr_invoice`) — Aufräumkandidat,
kein Defekt.

---

## 3. `verify-payment-account-settings` — veraltet, Code ist strenger

**Geprüft wird:** Zahlungskonto-Tabelle, IBAN-/QR-IBAN-Validierung,
QRR-Paarung, Admin-Schutz, Audit-Eintrag, maskierte IBAN, Stripe aus.

**Warum es fehlschlägt:** Der Check `['Stripe disabled default',
runtime.includes('stripe_link_enabled:false')]` sucht ein Objekt-Literal in
`admin-panel/shared/admin-runtime-payment-account.js`. Das Skript entstand
2026-08-01 um 00:08. Zwei Stunden später entfernte `387b9317` („Remove Stripe
controls from payment account settings") die Stripe-Bedienelemente vollständig.
Geblieben ist Zeile 161:

```js
payload.stripe_link_enabled = false;
```

Das ist eine **unbedingte Erzwingung** statt eines überschreibbaren Defaults —
strenger als das, was der Check verlangt.

**Bewertung:** veralteter Test. Dass die stärkere Form greift, prüft
`verify-invoice-only-swiss-billing` mit „payment account always disables old
Stripe flag" — dieser Check ist grün.

---

## 4. `verify-supabase-ssot` — veraltet, Tabellenumbenennung

**Geprüft wird:** dass Admin- und Kundenoberfläche `customers`, `calls`,
`cases` per `.from('<tabelle>')` aus Supabase lesen und nirgends die
Airtable-API auftaucht; dass die vier Admin-Schreibpfade Supabase-gestützt
sind.

**Warum es fehlschlägt:** Zwei Checks für `cases` schlagen fehl, weil die
Tabelle `voxera_cases` heisst. Auf der Produktions-DB existiert **nur**
`voxera_cases`; eine Tabelle `cases` gibt es nicht. Die Oberflächen lesen
korrekt:

- `admin-panel/index.html:15141` → `from('voxera_cases')`
- `customer-dashboard/netlify/functions/_lib/create-operational-case.js` und
  weitere → `from('voxera_cases')`
- `admin-panel/netlify/functions/cases-create.js` / `cases-update.js` →
  `from('voxera_cases')`

Historie: am 2026-04-26 enthielt `admin-panel/index.html` noch `from('cases')`,
am 2026-05-02 nicht mehr. Das Skript (2026-04-17) war beim Schreiben grün und
ist mit der Umbenennung stillschweigend gekippt.

**Bewertung:** veralteter Test. Die SSOT-Aussage — Supabase statt Airtable —
hält unverändert; alle Airtable- und Schreibpfad-Checks sind grün.

---

## 5. `verify-commercial-orchestrator-p1_5` — veraltet, Whitespace

**Geprüft wird:** in den Abschnitten 1–8 echtes Verhalten gegen ein
Fake-Supabase (Vertragslebenszyklus, Audit-Abdeckung, Best-Effort-Verhalten bei
Audit-Ausfall), in Abschnitt 9 zusätzlich, dass UI und Server-Routing über den
zentralen Orchestrator laufen.

**Warum es fehlschlägt:** Die Abschnitte 1–8 laufen vollständig durch. Die
Zeile `[commercial_orchestrator] audit insert failed simulated audit insert
failure` ist der absichtlich provozierte Fehlerfall, kein Defekt. Es scheitert
Abschnitt 9, Zeile 226:

```js
assert.ok(indexHtml.includes("action:'contracts.cancel'"))
```

In `admin-panel/index.html:11257` steht `action: 'contracts.cancel'` — mit
Leerzeichen. Das Routing ist zentralisiert, die Prüfabsicht erfüllt.

Datiert: bis 2026-05-01 14:09:14 stand dort die Form ohne Leerzeichen. Commit
`a1debae2` („Add files via upload") brachte die gespacte Fassung, 19 Sekunden
später löschte `f1b4affc` die Vorgängerdatei. Seit **2026-05-01 rot**.

**Bewertung:** veralteter Test, Substanz intakt.

---

## 6. `verify-elevenlabs-phone-number-assignment` — war nie grün

**Geprüft wird:** dass der Telefonnummern-Helper die ElevenLabs-Phone-Numbers-
API korrekt anspricht (Basis-URL, Twilio-Provider, PATCH auf `agent_id`,
Statuswerte) und dass keine Telefonnummern, Agent-IDs oder Twilio-Tokens fest
im Code stehen.

**Warum es fehlschlägt:** Neun der zehn Quelltext-Literale treffen,
`status: 'imported_and_assigned'` nicht. In
`admin-panel/netlify/functions/_lib/elevenlabs-phone-number.js:135` steht:

```js
status: imported ? 'imported_and_assigned' : 'assigned',
```

Das Verhalten ist vorhanden, das gesuchte Literal nie.

Historie: Helper committet 2026-08-05 09:48 (`9420527e`), Verify-Skript 09:51
(`5b2b4d6a`). **Jede** Fassung der Helper-Datei in der Historie durchsucht — die
Zeichenkette `status: 'imported_and_assigned'` hat dort nie existiert. Der Test
wurde gegen eine vorgestellte Quelltextform geschrieben und offenbar nie
ausgeführt.

**Bewertung:** kaputter Test, der noch nie etwas bestätigt hat. Inhaltlich
kosmetisch, als Absicherung aber wertlos — er suggeriert eine Abdeckung, die es
nie gab. Das ist gefährlicher als ein fehlender Check.

---

## Zwei systemische Ursachen

### A. Genau die fehlschlagenden Skripte haben keinen CI-Gate

48 Verify-/Audit-Skripte stehen 21 Workflows gegenüber. **13 Skripte laufen in
keinem Workflow** — und alle fünf kosmetisch fehlschlagenden sind darunter. Der
sechste (`db-security-invariants`) hat einen Workflow und wurde binnen 44
Minuten rot gemeldet.

Ohne Gate rottet ein Check unbemerkt. Das Muster ist kein Zufall.

Skripte ohne Workflow:

```
verify-ai-change-requests-tenant-isolation      (sicherheitsrelevant)
verify-notifications-rls-hardening              (sicherheitsrelevant)
verify-p0-catchup                               (sicherheitsrelevant)
verify-commercial-orchestrator-p1_5
verify-contract-activation-countersign-gate
verify-elevenlabs-phone-number-assignment
verify-invoice-items-title-tax-rate-fix
verify-invoice-only-swiss-billing
verify-offer-acceptance-idempotency
verify-payment-account-settings
verify-qr-invoice-controls
verify-supabase-ssot
verify-swiss-qr-invoice
```

### B. `admin-panel/index.html` wird als Ganzdatei ersetzt

Die Historie zeigt durchgehend das Muster „Delete admin-panel/index.html" /
„Add files via upload" / „Rename index - 2026-05-01T135434.390.html to
index.html". Bei jedem Durchlauf ändert sich die Formatierung. Jeder Check, der
Quelltext-Literale in dieser Datei pinnt, ist strukturell brüchig —
`verify-commercial-orchestrator-p1_5` ist genau daran gestorben.

---

## Was unverifiziert bleibt

- Ob `call-save-summary-correction` auf Netlify **deployt** ist. Der
  Abnahme-Commit auf `nxal72` sagt ausdrücklich „noch nicht deployed"; von hier
  aus nicht nachprüfbar.
- Der gespeicherte Make-Beispiel-Payload trägt weiterhin `swiss_qr_invoice`.
  Das ist ein Sample für das Feld-Mapping, keine Laufzeitbedingung — dass daraus
  bei einem künftigen Neu-Mapping keine Bedingung gebaut wird, ist nicht
  garantiert.
- Ob die übrigen sieben grünen Ledger-Einträge tatsächlich aus den zugehörigen
  Repo-Dateien stammen. Der Ledger hält Urheber und Quelle nicht fest; der Check
  vergleicht nur Namen.

---

## Empfohlene Reihenfolge

1. **`db-security-invariants`** — der einzige echte Befund und der einzige
   Check, der aktuell `main` rot hält. Solange er rot steht, ist ein neuer
   Sicherheitsbefund nicht mehr unterscheidbar.
2. **`elevenlabs-phone-number-assignment`** — ein Check, der nie gemessen hat,
   ist gefährlicher als keiner.
3. **`supabase-ssot` und `payment-account-settings`** — je eine Zeile.
4. **`invoice-only-swiss-billing` und `commercial-orchestrator-p1_5`** — hier
   lohnt statt Literal-Nachziehen die Frage, ob die Prüfung überhaupt auf
   Quelltext-Substrings stehen sollte.

Quer dazu: die 13 Skripte ohne Workflow, besonders die drei
sicherheitsrelevanten. Ohne Gate wiederholt sich der Zustand.
