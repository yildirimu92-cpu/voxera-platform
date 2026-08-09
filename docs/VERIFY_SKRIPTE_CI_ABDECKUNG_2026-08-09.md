# CI-Abdeckung der Verify-/Audit-Skripte

**Stand:** 2026-08-09
**Anlass:** Bei der Diagnose der sechs fehlschlagenden Skripte
(`VERIFY_SKRIPTE_DIAGNOSE_2026-08-09.md`) war das auffälligste Muster nicht
inhaltlicher Art: **alle fünf kosmetisch fehlschlagenden Skripte hatten keinen
CI-Workflow.** Der sechste hatte einen und wurde binnen 44 Minuten rot gemeldet.

Ohne Gate rottet ein Check unbemerkt. Das ist kein Zufallsbefund, sondern die
Erklärung dafür, warum vier Checks monatelang rot sein konnten, ohne dass es
jemandem auffiel — und warum einer davon nie grün war.

## Ausgangslage

48 Verify-/Audit-Skripte unter `scripts/`, 21 Workflows unter
`.github/workflows/`. **13 Skripte liefen in keinem Workflow.**

Zusätzlich existieren zwei Shell-Checks ohne Workflow:
`scripts/check-admin-runtime-no-disabled-at.sh` und
`scripts/run-swiss-qr-check.sh`.

## Was mit diesem Durchgang geschlossen wurde

Für die drei sicherheitsrelevanten Skripte wurde je ein Workflow angelegt:

| Skript | Workflow | Prüft |
| --- | --- | --- |
| `verify-ai-change-requests-tenant-isolation` | `verify-ai-change-requests-tenant-isolation.yml` | Mandantentrennung der AI-Change-Requests gegen Migration und Verifikations-SQL |
| `verify-notifications-rls-hardening` | `verify-notifications-rls-hardening.yml` | RLS-Härtung der Benachrichtigungen (`current_customer_id` statt Mandanten-Join), inkl. `customer-dashboard/index.html` |
| `verify-p0-catchup` | `verify-p0-catchup.yml` | Nachzug der P0-Security-Migration gegen die Vorlage vom 2026-07-28 |

### Warum diese drei ohne Pfad-Filter laufen

Die übrigen Verify-Workflows im Repo filtern auf die Dateien, die der jeweilige
Check liest. Für einen Sicherheitscheck ist das eine zusätzliche Stelle, an der
Abdeckung still verlorengeht: wer eine gelesene Datei anfasst, sie aber nicht in
die Pfadliste eingetragen hat, bekommt einen **übersprungenen** statt eines
bestandenen Laufs — und übersprungen sieht in der PR-Ansicht nicht nach einer
Lücke aus.

Alle drei lesen ausschliesslich Repo-Dateien und brauchen zusammen weniger als
eine Sekunde. Der Filter spart nichts, was dieses Risiko rechtfertigt.

### Was diese drei Checks nicht leisten

Sie lesen Repo-Dateien. Ob die geprüften Policies auf der Datenbank **wirksam**
sind, kann keiner von ihnen sehen — genau das war der P0-Vorfall. Diese Frage
beantwortet allein `verify-db-security-invariants.yml` gegen die echte
Produktions-DB. Die Checks ersetzen einander nicht.

## Was offen bleibt

Zehn Skripte laufen weiterhin in keinem Workflow. Alle zehn sind aktuell grün
und brauchen je unter einer Sekunde; ein Gate wäre für jedes davon eine
Workflow-Datei nach dem Muster der drei neuen.

| Skript | Deckt ab | Relevanz |
| --- | --- | --- |
| `verify-offer-acceptance-idempotency` | Doppelannahme von Offerten, Sperre gegen Mehrfachverträge | Daten/Vertrag |
| `verify-contract-activation-countersign-gate` | Gegenzeichnungs-Gate vor der Aktivierung | Daten/Vertrag |
| `verify-commercial-orchestrator-p1_5` | Vertragslebenszyklus, Audit-Abdeckung, zentrales Routing | Daten/Vertrag |
| `verify-invoice-items-title-tax-rate-fix` | Titel- und Steuersatz-Drift auf Rechnungspositionen | Billing |
| `verify-invoice-only-swiss-billing` | Rechnungsversand ausschliesslich per Swiss-QR, kein Zahlungslink | Billing |
| `verify-qr-invoice-controls` | Bedienelemente der QR-Rechnung | Billing |
| `verify-swiss-qr-invoice` | Aufbau der QR-Rechnung selbst | Billing |
| `verify-payment-account-settings` | Zahlungskonto, IBAN-/QR-IBAN-Validierung, Stripe aus | Billing |
| `verify-supabase-ssot` | Supabase als einzige Quelle, kein Airtable | Architektur |
| `verify-elevenlabs-phone-number-assignment` | Telefonnummern-Zuweisung an den Agenten | Integration |

Sieben der zehn sind billing- oder vertragsrelevant. Das ist kein Argument für
Eile, aber eines gegen „später".

`verify-supabase-ssot` ist der einzige Kandidat mit einer externen Abhängigkeit:
er ruft `rg` (ripgrep) über `execSync` auf. Ein Workflow dafür sollte dessen
Vorhandensein absichern, statt sich auf das Runner-Image zu verlassen — so wie
`verify-db-security-invariants.yml` es für `psql` tut.

## Vollständiger Lauf zum Stichtag

Nach den Reparaturen dieses Durchgangs, lokal über alle 48 Skripte:

```
bestanden: 47   fehlgeschlagen: 1
  verify-db-security-invariants (exit 2)
```

Exit 2 heisst „nicht prüfbar": ohne Datenbank-Zugangsdaten kann das Skript
lokal nichts messen und meldet das, statt grün zu behaupten. In CI läuft es mit
Secrets gegen die Produktions-DB.

## Der eigentlich offene Punkt

Ein Gate je Skript verhindert, dass ein **bestehender** Check rottet. Es
verhindert nicht, dass ein **neues** Skript ohne Workflow angelegt wird — genau
so sind die 13 entstanden. Dagegen hülfe ein Lauf, der alle Skripte einsammelt,
statt sie einzeln aufzuzählen, oder eine Prüfung, dass zu jedem `scripts/verify-*.mjs`
ein Workflow existiert. Beides ist hier bewusst **nicht** umgesetzt: es ändert
die CI-Struktur des Repos und gehört in eine eigene Entscheidung, nicht an das
Ende einer Reparaturrunde.
