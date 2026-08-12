# Ticket — Staging ist als Vorstufe für Sicherheitsänderungen unbrauchbar

**Datum:** 11.08.2026 · **Status:** offen, **Vorrang** · **Typ:** Vertrauen in die Prüfumgebung ·
**Gefunden bei:** Verifikation von Massnahme 1, `docs/ANON_DML_WURZEL_DIAGNOSE_2026-08-11.md`, 7 ·
**Nicht angefasst** — weder Staging noch die Ledger

---

## 1. Warum das Vorrang hat, obwohl dort keine Kundendaten liegen

Staging trägt 29 Tabellen, auf denen `anon` truncieren kann. Das ist **nicht** der Grund für die
Dringlichkeit — es sind keine Kundendaten dort, und die Rollen sind nur über PostgREST annehmbar.

**Der Grund ist die Aussagekraft.** Staging ist die Umgebung, in der Änderungen geprüft werden,
bevor sie auf Produktion gehen. Wenn ihr Zustand von Produktion abweicht, dann wurde **jede
Migration, die dort als „sauber" durchging, gegen einen anderen Zustand geprüft als den, der real
ist.** Das Ergebnis war nie falsch — es war nur nie eine Aussage über Produktion.

Und niemand wusste es.

---

## 2. Die drei Fragen

### (a) Warum wurden genau diese zwei ausgelassen, während spätere durchliefen?

**Die Frage beruht auf einer Annahme, die sich beim Nachmessen nicht gehalten hat** — meiner. Ich
hatte berichtet, die beiden Sicherheitsmigrationen vom 09.08. „fehlten" im Staging-Ledger, während
spätere da seien. Das legt nahe, aus einer gemeinsamen Reihe seien zwei herausgefallen.

**So ist es nicht.** Der vollständige Vergleich (siehe (c)) zeigt: Es gibt keine gemeinsame Reihe.
Nichts wurde ausgelassen, weil nie etwas gemeinsam war.

**Was stattdessen zu klären ist:** Wie ist die Staging-Datenbank entstanden? Die Zeitstempel
(08.08.) und der leere `pg_default_acl` deuten auf einen anderen Weg als „dieselben Migrationen,
später angewandt" — etwa ein Schema-Dump, ein Supabase-Branch oder ein `db push` aus einem anderen
Arbeitsstand. **Diese eine Antwort erklärt vermutlich alles Übrige**, einschliesslich (b).

### (b) Läuft der Katalogcheck tatsächlich nur gegen Produktion, und seit wann? ✅ **beantwortet**

**Ja, ausschliesslich — seit dem ersten Tag.** Belegt an der vollständigen Historie von
`.github/workflows/verify-db-security-invariants.yml`: ein einziger Job, ein einziges Environment
(`production-db-readonly`), und in **keinem** Commit der Datei kommt jemals ein zweites Ziel oder
das Wort „staging" vor. Es gab nie mehr als eine `SUPABASE_DB_URL`.

**Damit ist die Antwort auf die eigentliche Frage — „hätte der Zustand je auffallen können?" —
nein.** Nicht „es wurde übersehen", sondern: es wurde nie gemessen. Die 29 TRUNCATE-Rechte auf
Staging hätten den Check ab dem 09.08. rot gefärbt, wenn er je dort gelaufen wäre.

**Umgesetzt am 12.08.** (Entscheidung B): Der Workflow fährt jetzt eine Matrix über beide
Umgebungen. Staging ist bewusst `continue-on-error`, siehe die Begründung in der Datei.

### (c) Welche weiteren Migrationen fehlen auf Staging? ✅ **beantwortet — die Antwort ist die Diagnose**

Vollständiger Ledger-Vergleich, beide `supabase_migrations.schema_migrations` abgefragt:

| | Produktion | Staging |
|---|---|---|
| Einträge | **38** | **40** |
| **Gemeinsame Versionen** | \*\*0\*\* | \*\*0\*\* |

**Nicht eine einzige Version kommt in beiden vor.**

| | erste Version | letzte Version |
|---|---|---|
| Produktion | `20260808031625` | `20260811184947` |
| Staging | `20260808180914` | `20260811184207` |

> **Die Antwort auf (c) lautet damit nicht „diese drei fehlen", sondern: die Frage ist nicht
> beantwortbar.** Nach Version fehlen alle 38 — und das sagt nichts. Staging ist **nicht hinter**
> Produktion, es ist eine **eigene Linie**.
>
> **Die beiden Umgebungen lassen sich nur über ihren Zustand vergleichen, nicht über ihre Ledger.**
> Das ist der eigentliche Befund, und er ist grösser als die ursprüngliche Vermutung: Ein
> Ledger-Abgleich als Kontrollinstrument existiert für dieses Paar nicht und kann auch nicht
> nachträglich hergestellt werden, ohne eine der beiden Linien aufzugeben.

---

## 3. Zustandsvergleich — das einzige tragfähige Mass

Gemessen 11.08.2026:

| | Produktion | Staging |
|---|---|---|
| Tabellen in `public` | 47 | 46 |
| `anon` mit INSERT | 18 | **27** |
| `authenticated` mit INSERT | 20 | **29** |
| **TRUNCATE für Browser-Rollen** | **0** | **29** |
| Default-ACL-Einträge (Tabellen) | 2 | **keine** |

Die letzte Zeile ist die aufschlussreichste: Auf Staging gibt es **überhaupt keine** angepassten
Default-Privilegien. Die 29 TRUNCATE-Rechte sind dort also nicht geerbt, sondern **ausdrücklich
vergeben** — vermutlich durch ein `grant all ... to anon, authenticated` im Aufsetzweg. Ein weiterer
Hinweis darauf, dass die Umgebung anders entstanden ist als durch die Repo-Migrationen.

---

## 4. Was zu entscheiden ist

Nicht „nachziehen ja/nein", sondern was Staging überhaupt sein soll:

| Option | | Aufwand |
|---|---|---|
| **A** | **Staging aus Produktion neu aufsetzen** — gleiche Linie, gleiche Grants, künftig ein gemeinsamer Ledger | hoch, einmalig |
| **B** | **Staging als eigenständige Umgebung akzeptieren**, aber den Katalogcheck **gegen beide** laufen lassen | mittel |
| **C** | **Staging als Sicherheits-Vorstufe abschreiben** und das ausdrücklich dokumentieren — Grant- und RLS-Änderungen werden dann nirgends geprobt | gering, ehrlich, riskant |

> **Stand 12.08.: B ist im Repo umgesetzt, aber noch nicht wirksam.** Der Matrix-Job existiert;
> es fehlen zwei Dinge, die nur im GitHub-Konto anzulegen sind und die ich nicht anlegen kann:
> das Environment `staging-db-readonly` und darin die Zugangsdaten (`SUPABASE_DB_URL_CI_VERIFIER_STAGING`
> oder die Einzelfelder `SUPABASE_DB_HOST_STAGING` / `_PORT_STAGING` / `_USER_STAGING` /
> `_PASSWORD_STAGING`). Solange sie fehlen, endet der Staging-Job mit „nicht prüfbar" (Exit 2) —
> **nicht mit grün**, das ist der Unterschied, auf den es hier ankommt.
>
> Auf Staging braucht es ausserdem dieselbe Verifier-Rolle wie auf Produktion, also die Migration
> `20260808114412_ci_security_verifier_role.sql`. Ohne sie fehlen die Proben-Helfer, und der Job
> meldet genau das.

**Empfehlung: B, mit A als Ziel.** B stellt sofort her, was heute fehlt — dass eine Abweichung
überhaupt auffällt —, und kostet im Wesentlichen eine zweite `SUPABASE_DB_URL` im Workflow. Ohne B
wiederholt sich der Zustand mit der nächsten Sicherheitsmigration, unabhängig davon, was man einmalig
nachzieht.

**Was in jedem Fall gilt:** Solange weder A noch B umgesetzt ist, ist ein „auf Staging geprüft" bei
Grant-, RLS- oder Policy-Änderungen **keine Aussage über Produktion.** Das gehört in `AGENTS.md`
oder `docs/STAGING_TESTUMGEBUNG.md`, damit es nicht wieder jemand annimmt.

---

## 5. Nicht Teil dieses Tickets

- Die 29 TRUNCATE-Rechte auf Staging selbst. Sie sind Folge, nicht Ursache, und ohne Entscheidung
  aus Abschnitt 4 wäre ein Nachziehen nur Kosmetik.
- Die Wurzelmigration aus Massnahme 1 auf Staging. Sie wäre dort ein **No-op** — `pg_default_acl`
  ist leer, es gibt nichts zu widerrufen. Erst nach Entscheidung A oder B sinnvoll.
