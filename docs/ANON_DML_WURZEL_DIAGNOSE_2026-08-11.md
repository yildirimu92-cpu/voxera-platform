# Anschluss an #892 — die Wurzel ist nur zur Hälfte zu

**Datum:** 11.08.2026 · **Status:** Diagnose, **keine Änderung** · **Anschluss an:**
[#892](https://github.com/yildirimu92-cpu/voxera-platform/pull/892) („Nicht Teil dieser Arbeit":
die eingefrorenen anon-DML-Rechte) · **Alle Zahlen live auf Produktion gemessen**

---

## 1. Was #892 hinterlassen hat — geprüft, nicht angenommen

### 1.1 Der Sweep hält ✅

| Rolle | TRUNCATE-Rechte, 09.08. | **heute** |
|---|---|---|
| `anon` | 26 → 0 | **0** ✅ |
| `authenticated` | 27 → 0 | **0** ✅ |
| `service_role` | 45 | **47** (unverändert vollständig) |

**Der Bestand ist von 45 auf 47 Tabellen gewachsen, und die beiden neuen haben kein TRUNCATE
geerbt.** Das ist der eigentliche Beleg: Nicht der Sweep hat gehalten, sondern die
**Wurzelbehandlung**. Eine Liste hätte hier bereits zwei Lücken.

### 1.2 Der grantor-gebundene Fund ist unverändert 🔴

```
Erzeuger postgres        r  {anon=arwdxtm/postgres,        authenticated=arwdxtm/postgres}
Erzeuger supabase_admin  r  {anon=arwdDxtm/supabase_admin, authenticated=arwdDxtm/supabase_admin}
                                       ^                                  ^
                                       D = TRUNCATE, weiterhin vergeben
```

Reproduziert wie in #892 beschrieben. **Er greift heute nicht:** alle 47 Tabellen gehören
`postgres`, keine einzige `supabase_admin`. Der Bestandscheck im CI würde eine solche Tabelle beim
nächsten Lauf melden — das ist geprüft, die Zusage aus #892 trägt.

---

## 2. Der Anschluss: dieselbe Wurzel, nur ein Buchstabe weniger

Der entscheidende Befund steht in der Zeile oben, und zwar in dem, was **nicht** entfernt wurde:

```
Erzeuger postgres  r  anon=arwdxtm
                        a = INSERT
                         r = SELECT
                          w = UPDATE
                           d = DELETE
                            (D = TRUNCATE — von #892 entfernt)
```

> **#892 hat aus der Default-Privilegien-Zeile genau einen Buchstaben entfernt: `D`.**
> `a`, `w` und `d` — INSERT, UPDATE, DELETE — stehen unverändert drin. **Jede neu angelegte Tabelle
> in `public` vergibt sie weiterhin automatisch an `anon` und `authenticated`.**

Das ist keine neue Lücke. Es ist **dieselbe** Lücke, aus der die 27 TRUNCATE-Rechte entstanden sind
— nur für die drei Rechte, die #892 bewusst eingefroren statt entfernt hat.

### 2.1 Warum die Tabellen trotzdem sauber aussehen — und warum das nicht beruhigt

Aktueller Bestand:

| Recht | `anon` | `authenticated` |
|---|---|---|
| SELECT | 18 | 28 |
| INSERT | 18 | 20 |
| UPDATE | 17 | 19 |
| DELETE | **18** | **21** |

Die anon-Zahl ist seit #892 von 26 auf 18 gesunken — dazwischen lief anderes Aufräumen
(`revoke_browser_grants`). **Die beiden neuen Tabellen sind nicht dabei.** Der Grund ist aber nicht
die Wurzel:

```sql
-- 20260809155951_customer_voice_previews.sql:27
revoke all on public.customer_voice_previews from anon, authenticated;

-- 20260809145738_elevenlabs_sync_queue.sql:68-70
REVOKE ALL ON TABLE public.elevenlabs_sync_queue FROM public;
REVOKE ALL ON TABLE public.elevenlabs_sync_queue FROM anon;
REVOKE ALL ON TABLE public.elevenlabs_sync_queue FROM authenticated;
```

**Beide Tabellen sind sauber, weil ihre Migration daran gedacht hat.** Geprüft: seit dem 09.08.
gibt es keine Migration, die eine Tabelle anlegt, ohne zu widerrufen.

> Das ist **Disziplin, keine Struktur.** Genau das Argument, mit dem #892 die Einzeltabellen-Lösung
> beim TRUNCATE verworfen hat („eine gepflegte Liste wäre beim nächsten `create table` unbemerkt
> unvollständig"), gilt hier unverändert — nur dass die Rolle der Liste jetzt der Mensch übernimmt,
> der die Migration schreibt.

### 2.2 Das CI-Netz endet, wo #892 endete

`db_security_invariants_catalog.sql:409–423` prüft die Default-Privilegien — aber:

```sql
and pg_get_userbyid(d.defaclrole) = 'postgres'
and ac.privilege_type = 'TRUNCATE'
```

**Nur TRUNCATE, nur Erzeuger `postgres`.** Käme morgen `a`, `w` oder `d` auf einer neuen Tabelle
zurück — was es laut 2.1 automatisch tut —, meldet das niemand. Der Wächter bewacht genau den
Buchstaben, der schon weg ist.

---

## 3. Warum die Reihenfolge zwingend ist

Die verlockende Reihenfolge ist **Bestand zuerst**: 18 Tabellen sind sichtbar, messbar und fühlen
sich nach Fortschritt an. Sie ist falsch, aus drei Gründen — und alle drei stehen schon in #892,
nur für den anderen Buchstaben.

| # | | Konsequenz bei „Bestand zuerst" |
|---|---|---|
| 1 | Die Wurzel vergibt weiter | Der erste `create table` nach dem Sweep stellt den Zustand teilweise wieder her. Der Sweep wäre eine Momentaufnahme mit Verfallsdatum — wörtlich der Satz aus #892 |
| 2 | Kein Wächter | Ohne erweiterten CI-Check merkt es niemand. Der Bestandscheck deckt TRUNCATE ab, nicht DML |
| 3 | Der grantor-Fund bleibt tragbar **nur mit** Wächter | `supabase_admin` vergibt `arwdDxtm` und ist aus der Migrationsrolle nicht änderbar (42501, in #892 ausprobiert). Beim TRUNCATE war das akzeptabel, **weil der Bestandscheck eine solche Tabelle meldet.** Für DML gibt es diesen Auffangnetz-Satz heute nicht |

> **Punkt 3 ist der eigentliche Anschluss.** Der grantor-gebundene Fund ist kein Restposten, den man
> abhaken kann — er ist der Grund, warum der CI-Check **Teil der Massnahme** sein muss und nicht ihr
> Nachklapp. Die Begründung, mit der #892 die zweite Tür offen lassen durfte, lautete: „Entstünde je
> eine solche Tabelle, meldet sie der Bestandscheck." Dieser Satz ist für DML erst wahr, wenn der
> Check DML kennt.

**Zwingende Reihenfolge:**

1. **Wurzel** — `alter default privileges in schema public revoke insert, update, delete on tables from anon, authenticated`
2. **Wächter** — CI-Check auf DML erweitern, Wurzel **und** Bestand, je Tabelle im Fehlerfall
3. **Bestand** — erst dann die 18 bzw. 21 Tabellen, dynamisch über `pg_class` statt über eine Liste

Schritt 2 vor Schritt 3, nicht danach: Der Check ist die Selbstkontrolle, dass Schritt 3 nichts
anderes angefasst hat — genau die Rolle, die in #892 der Baseline-Diff mit „exakt 30 Entfernungen,
ausschliesslich TRUNCATE" gespielt hat.

---

## 4. Ein Unterschied zu #892, der alles langsamer macht

Beim TRUNCATE war die Vorarbeit billig: Keine Datenbankfunktion, kein Anwendungscode setzte je
TRUNCATE ab (0 Treffer). **Das Recht war nachweislich tot.**

**Bei INSERT/UPDATE/DELETE ist es das nicht.** Erste Stichprobe:

| Pfad | Rolle | Bewertung |
|---|---|---|
| `offer-public-accept.js` → `offer_acceptances` | **service_role** (Netlify-Function) | anon-Recht vermutlich entbehrlich |
| `customer-dashboard/index.html:12827` → `.from('users')` | **Browser** | direkt aus dem Browser, Rolle je nach Sitzung |
| `admin-panel/index.html:8483, 15082` → `.from('admins')` | **Browser** | dito |
| `admin-panel/index.html:15411` → `.from('onboarding')` | **Browser** | dito |

> **Das Admin-Portal arbeitet als `authenticated` und schreibt direkt aus dem Browser.** Ein
> pauschales `revoke ... from authenticated` legt es lahm. Das ist der Grund, warum #892 diese
> Rechte eingefroren und nicht entfernt hat, und der Grund, warum dieser Auftrag **nicht** dieselbe
> Form haben kann wie der TRUNCATE-Sweep.

**Daraus folgt eine Aufteilung, die #892 noch nicht brauchte:**

| Rolle | Behandlung | Begründung |
|---|---|---|
| **`anon`** | vermutlich vollständig entziehbar | Kein bekannter Pfad schreibt legitim als `anon` — die öffentlichen Flows laufen über Functions mit `service_role`. **Zu belegen, nicht anzunehmen** |
| **`authenticated`** | **nicht pauschal** | Das Admin-Portal schreibt real. Hier braucht es eine Pfad-für-Pfad-Aufnahme, bevor irgendetwas widerrufen wird |

**Die Wurzelbehandlung (Schritt 1) ist von dieser Unterscheidung nicht betroffen** — sie wirkt nur
auf **künftige** Tabellen, und für die ist „kein DML für anon/authenticated per Default" in beiden
Fällen richtig. Wer eine neue Tabelle braucht, die das Portal beschreibt, vergibt das Recht dort
ausdrücklich. Das ist derselbe Weg, den `elevenlabs_sync_queue` schon geht.

> **Deshalb ist Schritt 1 auch sofort machbar, während Schritt 3 Vorarbeit braucht.** Das ist die
> nützlichste Erkenntnis dieser Diagnose: Der billige Teil ist der wirksame.

---

## 5. Vorschlag

| # | Massnahme | Aufwand | Risiko |
|---|---|---|---|
| **1** | **Wurzel schliessen** (`revoke insert, update, delete` aus den Default-Privilegien) + **CI-Check erweitern** | ~halber Tag | **niedrig** — wirkt nur auf künftige Tabellen, ändert an keinem heutigen Recht etwas |
| 2 | Pfadaufnahme: welche Browser-Schreibpfade laufen als `authenticated`, welche über Functions | ~1 Tag | keines (nur Lesen) |
| 3 | `anon`-DML auf den 18 Tabellen entziehen, nachdem 2 belegt hat, dass kein Pfad es braucht | ~halber Tag | mittel |
| 4 | `authenticated`-DML tabellenweise, nur wo 2 es deckt | offen | hoch — eigener Auftrag |

**Empfehlung: Massnahme 1 vorziehen und einzeln fahren.** Sie hat das beste Verhältnis im ganzen
Vorhaben: Sie ändert **kein einziges bestehendes Recht** — also kann sie nichts lahmlegen —, und sie
stoppt trotzdem das Nachwachsen. Alles Weitere kann danach in Ruhe passieren, ohne dass sich der
Befund währenddessen vergrössert.

**Nicht Teil dieses Vorschlags:** die Nebenfunde 3–5 aus #889 (wirkungslose
`calls_insert_service_or_admin`-Policy, drei duplizierende Alt-Policies auf `calls`, `DELETE` auf
`calls`). Sie sind seit dem 09.08. unverändert offen.

---

## 6. Offene Frage vor Massnahme 1

`alter default privileges` wirkt **pro Erzeuger-Rolle**. Die Migration läuft als `postgres` und
kann deshalb nur den `postgres`-Eintrag ändern — der `supabase_admin`-Eintrag bleibt, wie schon beim
TRUNCATE (42501).

**Das ist hinnehmbar, aber nur mit Schritt 2 des Wächters.** Zu entscheiden ist, ob der erweiterte
CI-Check den `supabase_admin`-Eintrag
- **(a)** wie heute ausblendet und sich auf den Bestandscheck verlässt, oder
- **(b)** ihn ausdrücklich als bekannten, tolerierten Zustand prüft und meldet, sobald eine
  `supabase_admin`-eigene Tabelle in `public` auftaucht.

**Empfehlung (b).** Der Bestandscheck fängt die Folge; (b) fängt die Ursache und macht sichtbar,
dass die zweite Tür bewusst offen steht statt vergessen wurde. Kostet eine Abfrage.

---

## 7. Nebenbefund beim Verifizieren: Staging trägt den Zustand vor #892

Beim Versuch, die Migration auf Staging zu proben statt ihre Wirkung zu behaupten, ist etwas
aufgefallen, das nicht Teil des Auftrags war.

**Gemessen am 11.08.2026 auf `voxera-staging` (`hzqiyyqfchvfcmmbemvd`):**

| | Produktion | **Staging** |
|---|---|---|
| Tabellen in `public` | 47 | 46 |
| `anon` mit INSERT | 18 | **27** |
| `authenticated` mit INSERT | 20 | **29** |
| **TRUNCATE für Browser-Rollen** | **0** ✅ | **29** 🔴 |
| Default-ACL-Einträge für Tabellen | 2 (postgres, supabase_admin) | **keine** |

**Die beiden Sicherheitsmigrationen vom 09.08. fehlen im Staging-Ledger** — direkt abgefragt, nicht
aus dem Bestand geschlossen:

- `20260809164858_truncate_grant_sweep` — **fehlt**
- `20260809174824_revoke_browser_grants_rls_no_policy` — **fehlt**

Spätere Migrationen sind dagegen da, bis `20260811184207`. Es ist also **kein** stehengebliebenes
Projekt: Staging bekommt Fachmigrationen, aber die beiden Grant-Migrationen sind übersprungen
worden.

> **Was daraus folgt — zwei Dinge:**
>
> 1. **Staging taugt für diese Klasse von Änderung nicht als Probe.** Sein `pg_default_acl` ist
>    leer; die Wurzelmigration wäre dort ein No-op und würde nichts beweisen. Deshalb ist die
>    Wirkung dieser Migration in Abschnitt 5 **hergeleitet und nicht gemessen** — das ist offen
>    gesagt, statt eine Probe zu behaupten, die keine wäre.
> 2. **Der Sicherheitsstand der beiden Umgebungen ist auseinandergelaufen.** Auf Staging kann
>    `anon` 29 Tabellen truncieren — genau der Zustand, den #892 auf Produktion beseitigt hat. Der
>    Katalogcheck läuft offenbar nur gegen Produktion, sonst wäre es rot.

**Nicht angefasst.** Das ist ein eigener Auftrag, und er ist grösser als er aussieht: Zu klären ist
nicht nur, ob die beiden Migrationen nachgezogen werden, sondern **warum sie ausgelassen wurden** —
und ob der Katalogcheck künftig gegen beide Umgebungen laufen soll. Ohne die zweite Frage wiederholt
sich der Zustand mit der nächsten Sicherheitsmigration.

**Für den hier vorgeschlagenen Ablauf heisst das:** Die Wurzelmigration gehört auf **beide**
Umgebungen — auf Staging allerdings erst sinnvoll, nachdem die beiden ausgelassenen Migrationen dort
nachgezogen sind. Sonst schliesst man eine Wurzel, während der Bestand daneben unbehandelt liegt.
