# VOXERA – Admin lifecycle + RBAC verification

## 1. Verified coverage

### Privilegierte Admin-Endpunkte/Mutationen (verifiziert gegen Runtime-Code)

| endpoint / action | requireAdminCaller | admin-mutate | legacy path | notes |
|---|---|---|---|---|
| `/.netlify/functions/admin-mutate` (`customers.update`, `admins.create`, `admins.updateRole`, `admins.setStatus`, `offers.*`, `contracts.*`, `plan-config.update`) | yes | yes (self) | no | Zentraler Server-Mutations-Hub; Caller wird vor Action-Dispatch geprüft. |
| `/.netlify/functions/create-customer` | yes | no | no | Eigener privilegierter Pfad außerhalb `admin-mutate`; serverseitig geschützt. |
| `/.netlify/functions/customer-status-update` | yes | no | no | Eigener privilegierter Pfad; serverseitig geschützt. |
| `/.netlify/functions/onboarding-update` | yes | no | no | Eigener privilegierter Pfad; serverseitig geschützt. |
| `/.netlify/functions/cases-create` | yes | no | no | Eigener privilegierter Pfad; serverseitig geschützt. |
| `/.netlify/functions/cases-update` | yes | no | no | Eigener privilegierter Pfad; serverseitig geschützt. |
| `/.netlify/functions/send-customer-access` | yes | no | no | Eigener privilegierter Pfad; serverseitig geschützt. |
| `/.netlify/functions/mail-dispatch` | yes | no | no | Eigener privilegierter Pfad; serverseitig geschützt. |
| `/.netlify/functions/offer-status-update` | yes | no | no | Eigener privilegierter Pfad; serverseitig geschützt. |
| `/.netlify/functions/contract-signed` | yes | no | no | Eigener privilegierter Pfad; serverseitig geschützt. |
| `/.netlify/functions/contract-start-confirm` | yes | no | no | Eigener privilegierter Pfad; serverseitig geschützt. |
| `/.netlify/functions/customer-billing-update` | yes | no | no | Eigener privilegierter Pfad; serverseitig geschützt. |
| `/.netlify/functions/customer-archive` | yes | no | no | Eigener privilegierter Pfad; serverseitig geschützt. |
| `/.netlify/functions/customer-delete-permanently` | yes | no | no | Zusätzlicher owner-only Check im Handler. |

### Nicht unter Admin-RBAC laufende Endpunkte (bewusst anderer Zweck)

- `offer-public-get` / `offer-public-accept`: öffentliche Token-Flows (keine `requireAdminCaller`-Prüfung). 
- `call-intake-webhook`: auf `410 moved` gestellt.
- `outbox-retry-worker` und `daily-billing-runner`: Job/Worker-Pfade ohne `requireAdminCaller`.

## 2. Confirmed working parts

- Kanonische Rollen/Status werden serverseitig normalisiert und auf canonical sets geprüft (`owner|admin|support`, `active|disabled`), inklusive Alias-Mapping (`super-admin`→`owner`, `ops`→`admin`).
- `requireAdminCaller()` blockiert nicht aktive/disabled Admins serverseitig zentral mit `403`.
- Die drei Lifecycle-Mutationen laufen real über `admin-mutate`:
  - `admins.create`
  - `admins.updateRole`
  - `admins.setStatus`
- Lifecycle-Mutationen haben Capability-Gate `admin:manage`; damit können nicht-owner keine Admin-Lifecycle-Änderungen ausführen.
- Erfolgreiche Create/Role/Status-Änderungen schreiben Audit-Einträge in `admin_lifecycle_audit` (inkl. actor/target + vorher/nachher-Werte).

## 3. Gaps / remaining risks

- **Governance-Lücke:** Kein Schutz gegen Self-Role-Downgrade (Owner kann sich selbst per `admins.updateRole` herabstufen).
- **Governance-Lücke:** Kein Schutz gegen Deaktivierung des letzten verbleibenden Owners.
- **Audit-Lücke bei technischen Fehlern:** Mutation und Audit sind nicht transaktional gekoppelt; wenn Audit-Insert fehlschlägt, kann die Mutation bereits persistiert sein.
- **Coverage-/Konsistenz-Lücke (Scope):** Viele privilegierte Mutationen laufen weiterhin außerhalb `admin-mutate` (zwar mit `requireAdminCaller`, aber nicht im zentralen Mutations-Hub).
- **Frontend-Altspur (UI-only):** versteckter Legacy-Stub `settings-add-admin` pusht lokalen Mock-Admin in `state.admins` (kein Server-Write, aber irreführender Parallelpfad im UI-Code).

## 4. Owner / disabled / governance edge cases

- `self-disable`: **abgesichert** (`admins.setStatus` blockiert `adminId === caller.userId && nextStatus==='disabled'`).
- `self-role-downgrade`: **nicht abgesichert** (kein entsprechender Guard in `admins.updateRole`).
- `disable last owner`: **nicht abgesichert** (kein Owner-Minimum-Check vor Statuswechsel).
- Unberechtigte Role-/Status-Änderung durch `admin/support`: **abgesichert** über `admin:manage` Capability (nur `owner`).
- Reaktivierung deaktivierter Admins: **abgesichert/implementiert** über `admins.setStatus` mit `active`.
- Disabled Admin bei privilegiertem Endpoint: **abgesichert** durch `requireAdminCaller` (`403`, `error: "Admin account is disabled"`, `caller_status`).
- Disabled Admin im Admin-UI: **API-seitig blockiert**; zusätzlich UI-seitig Redirect/Signout in `requireAdminSessionOrRedirect`. Login-Page prüft allerdings nur Rolle, nicht Status (Session wird erst in `index.html` verworfen).

## 5. Audit trail coverage

- Erfolgsfälle `admins.create`, `admins.updateRole`, `admins.setStatus` werden auditiert.
- Vorher/Nachher-Werte werden bei Role-/Status-Änderungen aus `previous` + `next` gesetzt.
- Actor/Target werden in den drei Erfolgsflows befüllt (Schema erlaubt zwar NULL, Flow liefert aber IDs in diesen Pfaden).
- Abgelehnte Mutationen (z. B. 403/400) werden **nicht** in `admin_lifecycle_audit` geschrieben.
- No-op bei `admins.setStatus` (Status unverändert) liefert `unchanged: true` ohne Audit-Insert.

## 6. Pilot verdict

**pilot-ready with minor gaps** – der serverseitige RBAC-/Lifecycle-Kern greift auf den geprüften privilegierten Admin-Pfaden zuverlässig, aber zwei Governance-Guards fehlen noch (self-role-downgrade, last-owner protection).

## 7. Empfohlene nächste Aktion

**Einen serverseitigen Guard in `admin-mutate` ergänzen, der (a) Self-Role-Downgrade von Owner blockiert und (b) Deaktivierung/Rollenentzug des letzten Owners verhindert.**
