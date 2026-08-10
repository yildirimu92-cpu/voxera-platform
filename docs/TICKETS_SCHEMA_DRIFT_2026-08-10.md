# Tickets aus dem Schema-Audit vom 10.08.2026

Herkunft: Paket 0 des Vorhabens "gestaffelte Paketstruktur". Geprueft wurden
alle 76 Strich-Migrationen unter `supabase/migrations/` gegen den tatsaechlichen
Zustand der Live-Datenbank -- 367 Objekte (Tabellen, Spalten, Funktionen,
Indizes, Constraints, Policies) per Existenzabgleich gegen `pg_catalog` und
`information_schema`.

Ergebnis: 42 Migrationen vollstaendig live, 18 unter abweichenden Namen live
(Umbenennungen und spaetere Ersetzungen, inhaltlich angekommen), 8 nie
angewendet, 8 nicht statisch pruefbar (reine DML-/GRANT-Migrationen).

Von den 8 nicht angewendeten sind zwei mit
`2026-08-10_addon_schema_alignment_and_subscription_plan_code.sql` erledigt
(#43 Addon-Schema, #22 `subscriptions.plan_code`). Eine ist folgenlos, weil der
Code den Fehler abfaengt (#11, siehe unten). Die uebrigen sind hier als eigene
Tickets festgehalten -- bewusst **ausserhalb** der Paketstruktur, um deren
Auslieferung nicht zu verzoegern.

Kein Ticket hier ist eine Voraussetzung fuer die Paketstruktur. Ticket 1 ist
trotzdem zeitkritisch, weil es einen anderen Prozess betrifft.

---

## Ticket 1 -- Go-Live-Gate ist funktionslos ⚠️ zeitnah ansehen

**Migration:** `2026-07-29_manual_admin_go_live_gate.sql` -- nicht angewendet,
kein einziges ihrer 9 Objekte existiert live.

**Fehlt:**
- Tabelle `customer_lifecycle_events`
- Spalten `customers.go_live_approved_at`, `go_live_approved_by`,
  `go_live_approval_note`, `go_live_checks`, `live_at`
- Funktionen `admin_approve_customer_go_live`, `admin_activate_customer_go_live`
- Index `customer_lifecycle_events_customer_created_idx`

**Auswirkung:** `admin-panel/netlify/functions/customer-go-live.js` ruft beide
Funktionen per RPC auf (Zeilen 318 und 373) und liest die `go_live_*`-Spalten
(Zeilen 215, 218, 304-306, 349, 354). Keines davon existiert. Der manuelle
Go-Live-Freigabeprozess ist damit vollstaendig ausser Betrieb -- nicht
degradiert, sondern wirkungslos.

**Warum zeitnah:** Dieses Ticket betrifft den Go-Live-Prozess von Kunden
direkt, nicht die Preisstruktur. Solange es offen ist, gibt es keine
technische Freigabekontrolle vor dem Livegang -- unabhaengig davon, ob und
wann gestaffelte Pakete verkauft werden. Vor dem naechsten Kunden-Go-Live
sollte geklaert sein, ob der Prozess derzeit ueber einen anderen Weg
abgesichert ist.

**Offene Frage vor der Umsetzung:** Die Migration referenziert
`customers.id`-Typen und einen Freigabe-Workflow, der seit Juli
moeglicherweise anders gedacht ist. Vor dem Nachziehen pruefen, ob die
Migration noch dem gewuenschten Ablauf entspricht oder neu geschnitten werden
muss.

---

## Ticket 2 -- Admin-Lifecycle-Audit schreibt ins Leere

**Migration:** `2026-04-17_admin_lifecycle_rbac_hardening.sql` -- teilweise
angewendet (2 von 7 Objekten live).

**Fehlt:**
- Tabelle `admin_lifecycle_audit`
- Spalte `admins.disabled_at`
- Indizes `idx_admins_status`, `idx_admin_lifecycle_audit_target_time`,
  `idx_admin_lifecycle_audit_actor_time`

**Vorhanden:** `admins.status` und `admins_status_check` existieren -- der
Statusteil der Migration ist auf anderem Weg angekommen.

**Auswirkung:** `admin-panel/netlify/functions/admin-mutate.js:174` fuegt in
`admin_lifecycle_audit` ein. Die Tabelle existiert nicht, der Insert schlaegt
fehl. Administrative Lebenszyklus-Aktionen werden dadurch nicht protokolliert.
Ob der fehlgeschlagene Insert die umgebende Aktion abbricht oder nur den
Audit-Eintrag verliert, ist im Ticket zu pruefen -- davon haengt die
Dringlichkeit ab.

---

## Ticket 3 -- Auto-Live nach Testanruf greift nicht

**Migration:** `2026-04-10_auto_live_on_test_call_completed.sql` -- nicht
angewendet.

**Fehlt:** Funktion `fn_customer_auto_live_after_test_call`.

**Auswirkung:** Der automatische Uebergang eines Kunden in den Live-Status nach
erfolgreichem Testanruf findet nicht statt. Kein Codepfad ruft die Funktion
direkt auf; sie war als Trigger gedacht. Praktisch bedeutet das, dass der
Statuswechsel manuell erfolgen muss.

**Zusammenhang:** ueberschneidet sich thematisch mit Ticket 1. Beide betreffen
den Uebergang nach Live. Sinnvollerweise gemeinsam entscheiden, welcher der
beiden Wege -- automatisch nach Testanruf oder manuelle Admin-Freigabe -- der
gewollte ist. Moeglicherweise hat der eine den anderen absichtlich abgeloest;
das laesst sich aus dem Schema allein nicht beantworten.

---

## Ticket 4 -- `offers.public_token` ohne Unique-Constraint

**Unabhaengig von allen anderen Tickets und von der Paketstruktur.**

**Migration:** `2026-04-11_offer_public_acceptance_v1.sql` -- ueberwiegend live
(5 von 7 Objekten), aber die beiden Indizes fehlen.

**Fehlt:**
- `uq_offers_public_token` (UNIQUE)
- `idx_offers_public_token_expires`

**Nachgeprueft:** Auf `public.offers` existieren nur `offers_pkey` und
`offers_offer_number_key (UNIQUE offer_number)`. Auf `public_token` liegt
weder ein Unique-Index noch ein Unique-Constraint.

**Auswirkung:** `public_token` ist der Schluessel des oeffentlichen
Angebotslinks (`offer-public-get.js`, `offer-public-accept.js`). Ohne
Unique-Constraint ist datenbankseitig nicht ausgeschlossen, dass zwei Angebote
denselben Token tragen. Das ist ein Datenintegritaetsrisiko auf einem
unauthentifizierten Pfad -- ein Token, der auf mehr als ein Angebot passt,
oeffnet fremde Angebotsdaten.

Die Wahrscheinlichkeit haengt an der Token-Erzeugung im Code; auch bei
kryptografisch sicherer Erzeugung gehoert die Zusicherung in die Datenbank und
nicht allein in die Anwendung.

**Umsetzung:** Vor dem Anlegen des Unique-Index auf Duplikate pruefen:

```sql
select public_token, count(*)
  from public.offers
 where public_token is not null
 group by public_token having count(*) > 1;
```

Bei leerem Ergebnis kann der Index direkt angelegt werden.

---

## Ticket 5 -- Default-Privilegien vererben EXECUTE an `anon`/`authenticated`

**Eigener Strang, nicht Teil der Paketstruktur. Bearbeitung mit Opus 5,
Effort Hoch. Der Wurzelfix wird separat freigegeben und NICHT mit einem
Einzelentzug zusammengezogen.**

**Symptom, an dem es aufgefallen ist:** Am 10.08. gingen zwei neu angelegte
SECURITY-DEFINER-Funktionen (`activate_customer_addon_v1`,
`customer_has_addon`) mit EXECUTE fuer `anon` und `authenticated` live,
obwohl die Migrationen `revoke all ... from public` enthielten. Behoben in
`2026-08-10_addon_functions_execute_revoke_hotfix.sql`.

**Ursache:** Supabase konfiguriert im Schema `public`
`ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO anon,
authenticated, service_role`. Jede neu angelegte Funktion erbt diese
namentlichen Grants. `REVOKE ... FROM PUBLIC` entfernt nur das
PUBLIC-Pseudorollen-Grant und laesst sie stehen. Das ist dieselbe Bauart von
Problem wie die Default-Privilegien auf Tabellen, die am 09.08. behandelt
wurden -- nur fuer Funktionen und bisher unbehandelt.

Solange die Default-Privilegien stehen, erbt **jede kuenftige Funktion**
dieselbe Oeffnung. Einzelne Entzuege behandeln Symptome.

**Bekannte Treffer zum Zeitpunkt der Aufnahme** (SECURITY DEFINER **und**
EXECUTE fuer `anon`/`authenticated`), beide vorbestehend und nicht geprueft:

- `apply_offer_credit_to_invoice_v1`
- `sync_ai_change_request_from_case`

`is_customer_entitled` faellt in dieselbe Abfrage, wird aber vermutlich
absichtlich aus RLS-Policies heraus als `authenticated` aufgerufen -- genau
diese Unterscheidung ist der Kern der Aufgabe.

**Auftrag, in dieser Reihenfolge:**

1. **Vollstaendige Inventur.** Alle Funktionen in `public` mit
   `SECURITY DEFINER` und EXECUTE fuer `anon` oder `authenticated`. Pro
   Treffer dokumentieren: Aufrufer (Code, RLS-Policy, Trigger), ob der
   Zugriff gewollt ist, was bei Entzug bricht.

   ```sql
   select p.proname, p.prosecdef,
          has_function_privilege('anon', p.oid, 'EXECUTE') as anon_darf,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_darf
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
   order by (p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')) desc;
   ```

2. **Wurzelfix als Vorschlag mit Auswirkungsanalyse**, nicht blind anwenden:

   ```sql
   alter default privileges in schema public
     revoke execute on functions from anon, authenticated;
   ```

   Legitime Dashboard-RPCs, die `authenticated` brauchen, muessen vorher
   identifiziert und anschliessend gezielt zurueck-gegrantet werden. Ein
   pauschaler Entzug ohne diese Liste legt das Kundenportal lahm.

3. **Separate Freigabe** fuer den Wurzelfix.

**Vorbild fuer das Idiom:** `2026-07-28_p0_security_foundation.sql:14-17` --
einzeln von `public`, `anon`, `authenticated`, `service_role` widerrufen,
dann gezielt zurueckgeben.

---

## Nicht als Ticket gefuehrt

**`2026-04-07_outbox_retry_worker_support.sql`** (`outbox_events.dead_lettered_at`
und `idx_outbox_events_retry_scan` fehlen) ist die einzige der acht Luecken, die
im Code antizipiert wurde: `webhook-outbox.js:204` erkennt den Fehler ueber
`isMissingColumnError` und schreibt ohne die Spalte weiter. Funktional
folgenlos; die Spalte kann bei Gelegenheit nachgezogen werden, muss aber nicht.

**`2026-04-10_subscription_billing_runner_state.sql`** (`subscriptions.payment_status`)
und **`2026-04-12_contract_pending_review_status.sql`** (`contracts_status_check`)
sind ebenfalls nicht live, aber ohne gefundene Codereferenz. Anmerkung zum
zweiten: `public.contracts` hat aktuell **keinerlei** CHECK-Constraints, der
Vertragsstatus ist datenbankseitig also ungeprueft. Falls das stoert, gehoert
es in ein eigenes Ticket.

---

## Methodische Einschraenkung

Objekt-Existenz beweist nicht, dass eine Migration als solche gelaufen ist --
ein Objekt kann auch von Hand oder durch eine spaetere Migration entstanden
sein. Umgekehrt bedeutet ein fehlendes Objekt nicht zwingend, dass die Absicht
der Migration unerfuellt blieb; in 18 Faellen war sie unter anderem Namen
erfuellt (etwa `cases` -> `voxera_cases`). Die oben gefuehrten Tickets sind
jeweils zusaetzlich gegen den aufrufenden Code geprueft.

Acht Migrationen enthalten ausschliesslich UPDATE-/GRANT-Anweisungen und
lassen sich so nicht pruefen. Bei einer davon ist der Effekt empirisch
widerlegt: `2026-04-10_plan_config_source_of_truth_unify_professional.sql`
sollte `customers.plan_code` aus `plan` befuellen; die Spalte ist bei allen
vier Kunden NULL. Die uebrigen sieben bleiben offen.
