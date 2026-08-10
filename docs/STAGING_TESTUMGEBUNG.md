# Staging-Testumgebung — klickbarer Branch-Deploy

**Angelegt:** 10.08.2026 · **Bezug:** `STAGING_PRODUKTION_TRENNUNG_KONZEPT_2026-08-08.md`,
`docs/RUNTIME_CONFIG_UND_PREVIEW_ISOLATION.md`

Eine dauerhaft klickbare Umgebung, um Änderungen am Customer Dashboard vor dem Merge
im Browser zu prüfen — ohne Terminal, ohne lokalen Checkout, ohne Produktionsdaten
anzufassen. Entstanden beim Klick-Test zu #913.

---

## Warum es sie gibt

Deploy-Previews von Pull Requests bekommen seit Option 3 bewusst **keine**
Zugangsdaten mehr. Sie zeigen Oberfläche, Navigation und Design; alles, was Daten
braucht, bleibt leer. Für einen funktionalen Klick-Test taugen sie deshalb nicht.

Diese Umgebung schliesst die Lücke: ein eigener Branch **ohne Pull Request**, damit
Netlify ihn im Kontext `branch-deploy` baut statt als `deploy-preview` — nur dieser
Kontext trägt die Staging-Zugangsdaten.

---

## Adresse und Zugang

| | |
| --- | --- |
| Adresse | `https://claude-klicktest-jm1vav-preview--voxera-dashboard.netlify.app` |
| Branch | `claude/klicktest-jm1vav-preview` (bewusst **ohne** PR) |
| Netlify-Site | `voxera-dashboard` |
| Supabase-Projekt | `voxera-staging` / `hzqiyyqfchvfcmmbemvd` |
| Testkonto | `klicktest@voxera.ch` |
| Passwort | **nicht in diesem Repository** — siehe unten |

> **Das Passwort steht bewusst nirgends im Repo.** Dieses Repository ist
> **öffentlich**, und das Staging-Projekt ist aus dem Internet erreichbar. Ein hier
> eingecheckter Login wäre für jeden nutzbar. Bewahre ihn im Passwortmanager auf.
>
> Verloren? Neu setzen, ohne etwas anderes anzufassen — in Supabase über
> *Authentication → Users → klicktest@voxera.ch → Reset password*, oder per SQL:
>
> ```sql
> update auth.users
> set encrypted_password = crypt('<neues-passwort>', gen_salt('bf', 10)),
>     updated_at = now()
> where email = 'klicktest@voxera.ch';
> ```

---

## Was auf Staging liegt

Genau so viel, wie die Oberfläche zum Starten braucht — kein Abbild der Produktion.

| Tabelle | Datensatz |
| --- | --- |
| `customers` | `klicktest-913` — „Klicktest AG", `operational_status = active` |
| `auth.users` + `public.users` | `klicktest@voxera.ch`, Rolle `customer`, verknüpft mit `klicktest-913` |
| `contracts` | Status `active`, Plan `professional`, 12 Monate — **zwingend**, siehe unten |
| `calendar_settings` | `feature_enabled = true`, `active_provider = google`, Buchungsfenster Mo–Fr 08:00–17:00 (Spalten-Default) |
| `customer_operational_updates` | ein laufender Eintrag „Betriebsferien" (Typ `closure`) |

**Nicht vorhanden:** eine echte `calendar_connections`-Zeile. Der Zustand
`reauthorization_required` lässt sich deshalb nicht durchklicken; er ist stattdessen
durch `customer-dashboard/tests/calendar-disconnect-availability.test.cjs` abgedeckt.

---

## Netlify-Verdrahtung

Für die Site `voxera-dashboard`:

1. *Build & deploy → Branch deploys* — `claude/klicktest-jm1vav-preview` freigegeben.
2. *Environment variables* — je Variable *Different value for each deploy context*,
   die Staging-Werte **ausschliesslich** unter *Branch deploys*:

   | Variable | Wert |
   | --- | --- |
   | `SUPABASE_URL` | `https://hzqiyyqfchvfcmmbemvd.supabase.co` |
   | `SUPABASE_ANON_KEY` | anon-Key des Staging-Projekts (öffentlich, aus Supabase → API keys) |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role des **Staging**-Projekts — niemals der Produktionswert |

**Produktion bleibt unberührt.** Die Werte unter *Production* nicht anfassen, und die
Staging-Werte nicht in den Kontext *Deploy previews* eintragen — sonst bekäme jede
offene PR-Preview wieder eine Datenverbindung, und genau das hat Option 3 abgestellt.

Netlify backt die Werte **beim Build** in `vx-runtime-config.js`. Eine Variablen-
änderung ohne neuen Deploy ändert an der ausgelieferten Seite nichts.

---

## Wenn etwas klemmt

**Erste Prüfung, ohne Terminal:** auf der Seite F12 drücken, im Reiter *Console*
`window.__VX_RUNTIME_CONFIG__` eingeben. `supabaseUrl` sagt eindeutig, welches Projekt
die Seite anspricht; `configured: false` heisst, im Kontext kamen keine Werte an.

| Symptom | Ursache |
| --- | --- |
| „Vorschau ohne Datenverbindung" | falscher Kontext oder Variablen fehlen — oder die PR-Preview statt des Branch-Deploys geöffnet |
| „Invalid API key" | URL und Key gehören zu verschiedenen Projekten, oder der Key wurde beim Kopieren beschädigt (anon-Key: 208 Zeichen, zwei Punkte) |
| „Customer entitlement denied" | kein aktiver Vertrag. `requireCustomerCaller` hat `requireActiveContract = true` als Vorgabewert (`_lib/require-customer.js:26`); `deriveContractState` akzeptiert nur `active` und `signed` |
| „column customers.\<name\> does not exist" | Migration fehlt auf Staging — siehe nächster Abschnitt |
| Login scheitert bei per SQL angelegten Nutzern | GoTrue stirbt an `NULL` in `confirmation_token`, `recovery_token`, `email_change`, `email_change_token_new`. Auf `''` setzen, nicht `NULL` lassen |

Genauere Gründe stehen in den Netlify-Logs unter *Logs → Functions*, Suche nach
`[require-customer]`.

---

## Wichtigster Vorbehalt: Staging ist kein Abbild der Produktion

Das Projekt entstand am 08.08.2026 und hat seither nur einzelne Migrationen gesehen —
mehrere davon wurden nach der Prüfung ausdrücklich wieder zurückgebaut
(`docs/GESCHAEFTSWISSEN_FREITEXTFELDER_DIAGNOSE_2026-08-09.md`). Beim Klick-Test zu
#913 fehlte deshalb `customers.ai_appointment_rules`; die Migration
`supabase/migrations/2026-08-09_appointment_rules_and_description_lead.sql` wurde
nachgefahren.

**Bevor du eine Fehlermeldung für einen Produktfehler hältst,** vergleiche das Schema.
Als Trockenübung reicht ein Spaltenzähler:

```sql
select count(*) from information_schema.columns
where table_schema = 'public' and table_name = 'customers';
```

Stimmen die Zahlen zwischen `hzqiyyqfchvfcmmbemvd` und `ulcofbgrovgcvowdjrge` nicht
überein, fehlt auf Staging eine Migration — nicht im Code.

---

## Lebensdauer

Branch und Testdaten sind **dauerhaft** und sollen nicht gelöscht werden. Für einen
neuen Prüfstand den zu testenden Stand auf `claude/klicktest-jm1vav-preview` pushen
(Netlify baut auf jeden Push) — nicht einen zweiten Branch anlegen, sonst müssen die
Variablen erneut verdrahtet werden.
