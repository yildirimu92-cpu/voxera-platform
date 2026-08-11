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

## 7. Nebenbefund beim Verifizieren: Staging ist keine Vorstufe, sondern eine andere Linie

Beim Versuch, die Migration auf Staging zu proben statt ihre Wirkung zu behaupten, ist etwas
aufgefallen, das nicht Teil des Auftrags war.

> **Korrektur an der ersten Fassung dieses Abschnitts.** Zuerst stand hier, die beiden
> Sicherheitsmigrationen vom 09.08. „fehlten" im Staging-Ledger, während spätere durchgelaufen
> seien. Der vollständige Ledger-Vergleich zeigt: **Das ist zu harmlos formuliert.** Es wurde nichts
> ausgelassen — die beiden Ledger haben **überhaupt nichts gemeinsam.**

### 7.1 Der Ledger-Vergleich

| | Produktion | Staging |
|---|---|---|
| Einträge in `supabase_migrations.schema_migrations` | 38 | 40 |
| **Gemeinsame Versionen** | **0** | **0** |

Nicht eine einzige Version kommt in beiden vor. Staging ist **nicht hinter** Produktion — es ist
eine **eigene Linie**. Die Zeitstempel liegen zwar im selben Zeitraum (08.–11.08.), aber es sind
durchweg andere Migrationen: Produktion beginnt bei `20260808031625`, Staging bei `20260808180914`.

**Damit ist die Frage „welche Migrationen fehlen auf Staging?" nicht sinnvoll beantwortbar.** Die
Antwort nach Version lautet „alle 38", und sie sagt nichts. Die beiden Umgebungen lassen sich **nur
über ihren Zustand vergleichen, nicht über ihre Ledger.**

### 7.2 Der Zustandsvergleich — und der bleibt gültig

Gemessen am 11.08.2026:

| | Produktion | **Staging** |
|---|---|---|
| Tabellen in `public` | 47 | 46 |
| `anon` mit INSERT | 18 | **27** |
| `authenticated` mit INSERT | 20 | **29** |
| **TRUNCATE für Browser-Rollen** | **0** ✅ | **29** 🔴 |
| Default-ACL-Einträge für Tabellen | 2 (postgres, supabase_admin) | **keine** |

Auf Staging kann `anon` 29 Tabellen truncieren — der Zustand, den #892 auf Produktion beseitigt hat.
Der Katalogcheck läuft offenbar nur gegen Produktion, sonst wäre das rot.

### 7.3 Was daraus folgt

1. **Staging taugt für diese Klasse von Änderung nicht als Probe.** Sein `pg_default_acl` ist leer;
   die Wurzelmigration wäre dort ein No-op. Deshalb wurde die Wirkung dieser Migration **auf
   Produktion gemessen** (Abschnitt 8), nicht auf Staging simuliert.
2. **Der Sicherheitsstand beider Umgebungen ist auseinandergelaufen** — und zwar nicht durch
   Vergessen, sondern strukturell, weil es nie eine gemeinsame Linie gab.
3. **Die eigentliche Konsequenz ist nicht der Bestand, sondern das Vertrauen:** Jede Migration, die
   auf Staging als „sauber" geprüft wurde, wurde gegen einen anderen Zustand geprüft als den, der in
   Produktion herrscht. Staging trägt keine Kundendaten — das Problem ist nicht das Risiko dort,
   sondern die Aussagekraft von allem, was dort geprüft wurde.

**Nicht angefasst.** Eigenes Ticket: `docs/TICKET_STAGING_LEDGER_DIVERGENZ_2026-08-11.md`.

---

## 8. Massnahme 1 angewendet — gemessen, nicht behauptet

Angewendet auf Produktion am 11.08.2026 in der vereinbarten Reihenfolge: Ausgangsmessung, anwenden,
Check danach, plus direkter Vorher-Nachher-Vergleich der ACL-Zeile selbst. Der Check hatte auf
Produktion nie PASS gemeldet — dass er danach grün ist, wäre allein kein Beleg.

### 8.1 Die ACL-Zeile, vorher und nachher

```
VORHER   postgres  {postgres=arwdDxtm, anon=arwdxtm, authenticated=arwdxtm, service_role=arwdDxtm}
NACHHER  postgres  {postgres=arwdDxtm, anon=rxtm,    authenticated=rxtm,    service_role=arwdDxtm}
                                            ^^^^                  ^^^^
                                   a, w, d entfernt -- r, x, t, m bleiben
```

Genau die drei Buchstaben des Auftrags, kein vierter. `service_role` und `postgres` unverändert.
Der `supabase_admin`-Eintrag ebenfalls unverändert `arwdDxtm` — erwartet, er ist aus dieser Rolle
nicht änderbar.

### 8.2 Die Checks

| Check | vorher | nachher |
|---|---|---|
| Default-Privilegien ohne INSERT/UPDATE/DELETE | **FAIL** (6 Verursacher namentlich) | **PASS** |
| Default-Privilegien ohne TRUNCATE (#892) | PASS | **PASS** (unberührt) |
| Keine Tabelle gehört `supabase_admin` | PASS | **PASS** |

### 8.3 Die Kontrollmessung — der wichtigere Beleg

Die Migration behauptet, **kein bestehendes Recht** zu ändern. Gemessen über alle 47 Tabellen:

| Rolle | Recht | vorher | nachher |
|---|---|---|---|
| `anon` | INSERT / UPDATE / DELETE / SELECT | 18 / 17 / 18 / 18 | **18 / 17 / 18 / 18** |
| `authenticated` | INSERT / UPDATE / DELETE / SELECT | 20 / 19 / 21 / 28 | **20 / 19 / 21 / 28** |
| `service_role` | INSERT / UPDATE / DELETE / SELECT / TRUNCATE | 47 / 47 / 47 / 47 / 47 | **47 / 47 / 47 / 47 / 47** |

**Zeile für Zeile identisch.** Die Wurzel ist zu, der Bestand unangetastet — genau die Trennung, auf
der die Reihenfolge beruht.

### 8.4 Was ab jetzt gilt

Jede neu in `public` angelegte Tabelle vergibt an `anon` und `authenticated` **kein**
INSERT/UPDATE/DELETE mehr. Wer eine Tabelle braucht, die das Portal beschreibt, vergibt das Recht
in **ihrer** Migration ausdrücklich — derselbe Weg, den `elevenlabs_sync_queue` schon geht.

> Das ist die Absicht, nicht ein Nebeneffekt: **ein ausdrückliches Grant ist eine Entscheidung, ein
> geerbtes ist keine.**

**Offener Entscheidungspunkt:** Die Zeile lautet jetzt `anon=rxtm` — SELECT, REFERENCES, TRIGGER,
MAINTAIN. `x` und `t` sind ebenfalls fragwürdig; `TRIGGER` erlaubt das Anlegen von Triggern. Bewusst
nicht mitgenommen, weil der Auftrag INSERT/UPDATE/DELETE lautete. **Zu entscheiden, wenn sichtbar
ist, ob `rxtm` irgendwo gebraucht wird.**
