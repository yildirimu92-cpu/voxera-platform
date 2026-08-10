# Admin-Portal — Tote-Code-Liste

**Stand:** 10.08.2026 · **Bereich:** ausschliesslich `admin-panel/`
**Status:** Fundliste. **Nichts gelöscht.** Löschung erst nach Freigabe, gebündelt in
Welle 7 des Zielbilds (`ADMIN_PORTAL_ZIELBILD_2026-08-10.md`).

> **Abgrenzung:** Diese Liste wird bewusst getrennt vom laufenden
> Customer-Dashboard-Aufräum-Auftrag geführt und dort **nicht** eingespeist. Überschneidung
> ist nur bei `supabase/`-Themen zu erwarten — die sind hier nicht enthalten.

---

## Wie geprüft wurde

Für jeden Kandidaten eine Suche über das **gesamte Repository** (ohne `.git`), nicht nur
über `admin-panel/`. Aufrufe aus HTML-Attributen, aus Vorlagen-Zeichenketten und aus den
Laufzeit-Patches sind mitgezählt. Ein Treffer nur in Markdown-Dokumentation oder in einem
`verify-*`-Skript zählt **nicht** als Nutzung.

**Belegstufen:** <br>
**A — belegt tot:** null Referenzen ausserhalb der eigenen Definition. Löschbar. <br>
**B — unerreichbar:** existiert vollständig, aber es gibt keinen Weg dorthin. Braucht eine
Entscheidung: Einstieg nachrüsten oder löschen. <br>
**C — Attrappe:** läuft, arbeitet aber auf Fantasiedaten oder rendert ins Nichts.

---

## 1 · Frontend-Dateien

| Stufe | Datei | Umfang | Beleg |
|---|---|---|---|
| **A** | `shared/admin-runtime-qr-invoice-controls.js` | 8.7 KB / 162 Z. | Liegt im Verzeichnis, steht **nicht** in der Ladeliste von `shared/offer-brand.js`. Wird nie ausgeführt. Einzige Erwähnungen im Repo: zwei Doku-Dateien über Prüfskripte. |

---

## 2 · Netlify-Functions

| Stufe | Datei | Umfang | Beleg |
|---|---|---|---|
| **A** | `netlify/functions/send-offer.js` | — | **Null** Referenzen im gesamten Repo. Ersetzt durch `mail-dispatch` mit `mail_type:'offer_email'` — `sendOffer()` in `index.html:9970` ruft nachweislich `mail-dispatch` auf. |
| **A** | `netlify/functions/offer-link-customer.js` | 372 Z. | Einzige Erwähnung repo-weit: ein Kommentar in `supabase/migrations/2026-08-06_p0_rls_tenant_isolation_hardening.sql`. Kein Aufruf. |
| **A** | `netlify/functions/admin-invoice-qr-pdf-preview.js` | — | Null Referenzen. **Zusätzlich ohne `require-admin`-Guard** — das ist der Grund, warum diese Zeile zuerst stehen sollte: ein ungeschützter Endpunkt, den niemand braucht. |
| **A** | `netlify/functions/activate-subscription.js` | — | Nur von `scripts/verify-phase1-launch-gates.mjs` referenziert, nicht vom Produkt. Das Prüfskript muss beim Löschen mitangepasst werden. |
| **A** | `netlify/functions/_lib/swiss-qr-version.js` | — | Null Referenzen repo-weit. |
| **A** | `netlify/functions/delete-customer.js` | — | Absichtlicher Grabstein: antwortet immer HTTP 410, führt keine Datenbankoperation aus, Kopfkommentar erklärt die Ablösung durch `admin-mutate` (`customers.delete`). Der Grabstein hat seinen Zweck erfüllt. |

**Zur Prüfung, nicht zum Löschen:** Drei QR-Rechnungs-Generationen liegen nebeneinander —
`_lib/swiss-qr-bill.js` (327 Z.), `_lib/swiss-qr-bill-complete.js` (114 Z.),
`_lib/swiss-qr-bill-branded.js` (91 Z.). Alle drei werden benutzt, mit Aufrufketten kreuz
und quer (`-complete` lädt `-bill` *und* `-branded`; `admin-overage-invoice` lädt `-bill`
*und* `-branded`; `admin-invoice-qr-pdf` lädt `-bill` *und* `-complete`). Das ist kein
toter Code, sondern eine Zusammenlegung — **eigener Auftrag**, nicht Teil dieser Liste.

---

## 3 · Unerreichbare Funktionen in `index.html`

Definiert, aber im gesamten Repo nirgends aufgerufen — auch nicht aus `onclick`-Attributen
in Vorlagen-Zeichenketten und nicht aus den 29 Laufzeit-Patches.

| Stufe | Funktion | Zeile | ≈ Z. | Anmerkung |
|---|---|---|---|---|
| ~~A~~ | ~~`openCreditNoteModal`~~ | 17045 | 15 | **Erledigt** — Einstieg gebaut, Server-Aktion nachgezogen, siehe 4.2. |
| **B** | `renderOnboardingDetail` | 6764 | 29 | Schreibt in die versteckten Onboarding-Stubs (Diagnose 3.7). |
| ~~B~~ | ~~`resendInvite`~~ | 16906 | 16 | **Erledigt** — Einstieg im Kunden-Workspace nachgeruestet, siehe 4.1. |
| ~~A~~ | ~~`markCallReviewed`~~ | 14788 | 10 | **Erledigt** — echter Schreibpfad und Einstieg gebaut, siehe 4.3. |
| **A** | `sendBillingPaymentLink` | 13326 | 5 | Zahlungslink-Versand. Gehört zur abgelösten Stripe-/Zahlungslink-Phase — dieselbe, deren Bedienelemente `v3-regression-fix` per CSS versteckt. |
| **A** | `sendMonthlyBillingPaymentLink` | 13467 | 5 | dito |
| **A** | `sendYearlyBillingPaymentLink` | 13472 | 5 | dito |
| **A** | `markBillingPaid` | 13463 | 4 | dito |
| **A** | `markSubscriptionPaid` | 13477 | 4 | dito |
| **A** | `submitOnboardingSendAccess` | 6677 | 5 | Ersetzt durch `submitSendAccess`. |
| **A** | `uploadContractWord` | 12148 | 6 | Vertrag als Word-Datei hochladen — Funktion aus einer früheren Vertragsphase. |
| **A** | `getCustomerAccessBlockReasons` | 12797 | 6 | Ersetzt durch `resolveAccessGate`. |
| **A** | `assertCaseTransition` | 4799 | 9 | Ersetzt durch die Statuslogik in `cases-state-hotfix`. |
| **A** | `aiMissingFields` | 6793 | 4 | — |
| **C** | `toggleFlag` | 14915 | 5 | Siehe Abschnitt 5. |
| **C** | `toggleAdminStatus` | 14908 | 5 | Siehe Abschnitt 5. |

Weitere Einzelfunde derselben Art, jeweils 3–8 Zeilen: `bfReminderBadge`, `reminderBadge`,
`callStatusBadge`, `invoiceProviderLabel`, `canonicalOfferPlanValue`, `getPlanMins`,
`getContractTerminatedAt`, `getCurrentMonthStartIso`, `isOnboardingStatusReady`,
`cancelContract` (die benutzten Varianten heissen `cancelContractOrdinary` und
`cancelContractExtraordinary`).

**Summe Abschnitt 3: rund 180 Zeilen.**

---

## 4 · Die drei „nur der Knopf fehlt"-Fälle — nachgeprüft

**Korrektur vom 10.08., nach der Freigabe zum Nachrüsten.** Vor dem Bauen habe
ich alle drei bis zum Server durchgeprüft. Nur einer war wirklich fertig. Die
Einschätzung „vollständig gebaut, es fehlt nur der Einstieg" stimmte für die
beiden anderen nicht — sie stützte sich auf das Vorhandensein von Markup und
Absende-Funktion, nicht auf die Gegenstelle.

### 4.1 `resendInvite` — war tatsächlich fertig · **erledigt**

`resendInvite()` ruft `send-customer-access` auf: ein existierender, über
`require-admin` geschützter Endpunkt, der auch vom regulären „Zugang senden"
benutzt wird. Nichts fehlte ausser dem Aufruf.

**Nachgerüstet** im Kunden-Workspace, sichtbar nur solange der Zugang gesendet,
aber noch nicht aktiviert ist (`showInvitationSent`). Im Klick-Test erscheint der
Knopf beim eingeladenen Kunden und bleibt bei allen anderen Zuständen aus.

### 4.2 Gutschriften — **gebaut** · Freigabe vom 10.08.

> **Nachtrag:** Umut hat entschieden, die freistehende Kulanzgutschrift zu bauen.
> Umgesetzt als `credit-notes.create` in `admin-mutate` mit Capability
> `billing:write`, dahinter die Datenbankfunktion
> `admin_create_standalone_credit_note_v1` (Migration
> `2026-08-10_standalone_credit_notes.sql`). Sie teilt sich Nummernkreis
> (`VX-GS-JJJJ-NNNNNN`), Ablage, Idempotenz und Prüfprotokoll mit der
> rechnungsgebundenen Gutschrift — es ist also **kein** zweites Gutschriftsystem
> entstanden, sondern derselbe Apparat für den zweiten Fall. Einstieg im
> Kunden-Workspace, Karte „Vertrag & Billing". Der Befund unten bleibt als
> Begründung stehen, warum es so und nicht anders gebaut wurde.

**Ursprünglicher Befund:**

Das tote `#credit-note-modal` in `index.html` ist eine **ältere Generation** einer
Funktion, die im Portal längst bedienbar ist.

| | tote Generation | lebende Generation |
|---|---|---|
| Einstieg | keiner | Knopf „Storno / Gutschrift" im Rechnungsdetail |
| gebaut von | `index.html` | `admin-runtime-invoice-adjustments.js` |
| Server-Aufruf | `admin-mutate` / `invoices.create` | `invoice-financial-action` / `create_credit` |
| Server-Gegenstelle | **existiert nicht** | existiert, capability-geprüft |

`admin-mutate.js` kennt elf Aktionen — `invoices.create` ist keine davon. Der
Aufruf wäre mit `400 Unsupported action` zurückgekommen. Das Feature war also
nie funktionsfähig, nicht nur unerreichbar.

Fachlich sind es zwei verschiedene Fälle:

- **Gutschrift auf eine bestehende Rechnung** — das ist die lebende Generation.
  Sie ist erreichbar, verbucht `credited_amount` und `credit_reason` auf der
  Rechnung und zeigt eine Historie.
- **Freistehende Kulanzgutschrift ohne Rechnungsbezug** — das war die Absicht des
  toten Modals. Dafür bräuchte es eine neue Server-Aktion mit Nummernkreis,
  Mehrwertsteuer und QR-Rechnung. Das ist eine **neue Funktion**, kein
  nachgerüsteter Einstieg.

**Empfehlung:** Modal und die drei Funktionen löschen (rund 60 Zeilen).
Den toten Einstieg zu verdrahten würde ein zweites, schlechteres Gutschriftsystem
neben dem funktionierenden schaffen — genau das Muster, das dieser Umbau auflöst.

**Frage an dich:** Fehlt dir die freistehende Kulanzgutschrift im Alltag? Wenn ja,
ist das ein eigener kleiner Auftrag (Server-Aktion plus Einstieg). Wenn nein,
kommt das Modal in Welle 7 weg.

### 4.3 `markCallReviewed` — **gebaut** · Freigabe vom 10.08.

> **Nachtrag:** Umut hat entschieden, die Funktion fertigzustellen. Umgesetzt mit
> eigener Spalte `calls.reviewed_at` / `reviewed_by` (Migration
> `2026-08-10_calls_admin_review.sql`), Schreibpfad `calls.setReviewed` in
> `admin-mutate` mit Capability `customer:write`. `read_at` bleibt unberührt beim
> Kunden-Dashboard. Einstieg in der Aktivitätsliste — der Screen hatte vorher
> null Bedienelemente. Der Befund unten bleibt als Begründung für die eigene
> Spalte stehen.

**Ursprünglicher Befund:**

Die Funktion schreibt **nichts in die Datenbank**:

```js
call.summary = `${call.summary} (reviewed)`;
call.callback = false;
state.events.unshift(`${nowStamp()} · … Call reviewed`);
```

Alle drei Zuweisungen treffen nur den lokalen `state`. Beim nächsten Laden ist
die Markierung weg — und `call.summary` wäre dann um „(reviewed)" gewachsen,
ohne dass es je gespeichert wurde. Ein Knopf dafür sähe aus wie eine Funktion und
wäre keine.

Die Tabelle `calls` hat zwar `read_at`, aber das ist der Gelesen-Zustand des
**Kunden**-Dashboards. Ein Admin-„geprüft" darauf zu legen würde zwei Bedeutungen
in eine Spalte mischen.

**Empfehlung:** Funktion löschen. Wenn du „Anruf geprüft" als Admin-Funktion
willst, braucht sie eine eigene Spalte und einen Schreibpfad — auch das ein
eigener kleiner Auftrag, keine Nachrüstung.

**Frage an dich:** Brauchst du „Anruf als geprüft markieren" im Admin-Portal?

## 5 · Attrappen — Fantasiedaten in einem Betriebswerkzeug

| Stufe | Fundstelle | Beleg |
|---|---|---|
| **C** | `state.featureFlags` (`index.html:4386`) | Drei fest verdrahtete Einträge: „AI Escalation v2 — Pilot bei 3 Kunden", „Automatisierte Billing Mails — Geplant für Q2", „Live Call Quality Scoring — Interner Canary". `toggleFlag()` schaltet sie ON → OFF → PARTIAL. Gerendert wird in `#settings-feature-list` — **einen versteckten Stub** (`index.html:2805`). In Supabase existiert eine echte Tabelle `feature_flags` mit 15 Zeilen, die das Portal nie liest. |
| **C** | `state.admins` (`index.html:4381`) | „Lea Baumann", „Noah Keller", „Mia Vogel" mit E-Mail-Adressen und Status „MFA offen". `toggleAdminStatus()` arbeitet darauf. Zusätzlich hängt an `#settings-add-admin` (ebenfalls versteckter Stub) ein Handler, der `Neuer Admin 4` in diese Fantasieliste schreibt. Die **sichtbare** Admin-Tabelle liest korrekt aus der Tabelle `admins` — die Attrappe steht daneben. |
| **C** | `state.aiConfigs` (`index.html:4406–4410`) | Fünf ausformulierte Beispielkunden: Sanitär- und Notfallservice Zürich, Zahnarztpraxis Bern, Hotel Luzern, Apotheke Winterthur, inklusive Sätzen wie *„Sortimentswechsel noch nicht eingepflegt"* und *„Notfall-Flow am 2026-04-02 geschärft"*. Wird beim Datenladen überschrieben — **bis dahin ist es der Fallback.** Schlägt das Laden fehl, zeigt das Portal diese Kunden. |

**Empfehlung:** alle drei ersatzlos entfernen, zusammen mit `toggleFlag`,
`toggleAdminStatus` und dem `settings-add-admin`-Handler.

Zu den Feature-Flags: Die echte Tabelle anzubinden wäre ein **neues Feature**, kein
Aufräumen — deshalb steht es hier nicht als Empfehlung, sondern als Hinweis, dass die
Datengrundlage existiert, falls du das später willst.

---

## 6 · Versteckte Stub-Elemente

Fünf Blöcke unsichtbarer DOM-Elemente, die es nur gibt, damit alte Render-Funktionen nicht
abstürzen. Die Kommentare im Code sagen es selbst.

| Zeile | Kommentar im Quelltext | Inhalt |
|---|---|---|
| 2409 | „Hidden stubs so existing JS doesn't crash" | 9 Onboarding-Elemente |
| 2638 | „Hidden stubs" | `insight-calls-time`, `insight-trends` |
| 2730 | „Hidden stubs for legacy compatibility" | 5 Finance-Elemente |
| 2805 | „Hidden stubs" | `settings-admin-list`, `settings-feature-list`, `settings-add-admin` |
| 3483 | „nicht mehr sichtbar, aber JS liest sie" | `create-customer-start-date`, `create-customer-notes` |

Dazu passend `index.html:5798–5809`: eine Funktion, die zur Laufzeit entscheidet, ob sie in
die Insights-Ansicht oder in den „legacy"-Stub schreibt — beide Zielsätze werden gepflegt.

**Diese Blöcke fallen nicht einzeln, sondern mit ihren Schreibern.** Reihenfolge: erst die
unerreichbaren Funktionen aus Abschnitt 3 löschen, dann die Stubs. Umgekehrt bricht es.
Ausnahme: die zwei Felder in Zeile 3483 werden aktiv gelesen — die brauchen einen echten
Ersatz im Formular oder eine bewusste Entfernung samt Leseseite.

---

## 7 · Versehentlich eingecheckte Artefakte

| Stufe | Datei | Beleg |
|---|---|---|
| **A** | `docs/swiss-qr-done.txt` | Dateinamen und Inhalt deuten auf Arbeitsnotizen; keine Referenz |
| **A** | `docs/swiss-qr-final.txt` | dito |
| **A** | `docs/swiss-qr-last.txt` | dito |
| **A** | `docs/swiss-qr-stop.txt` | dito |
| **A** | `docs/swiss-qr-implementation-note.txt` | dito |

*(Liegen unter `docs/`, nicht unter `admin-panel/`, betreffen aber ausschliesslich das
Admin-Thema QR-Rechnung. Vor dem Löschen kurz hineinsehen — falls dort etwas steht, das in
`docs/swiss-qr-invoice.md` fehlt, gehört es dorthin statt in den Papierkorb.)*

---

## 8 · Bilanz und Reihenfolge

| Abschnitt | Umfang | Stufe |
|---|---|---|
| 1 · Frontend-Datei | 162 Z. | A |
| 2 · Netlify-Functions | 6 Dateien | A |
| 3 · Unerreichbare Funktionen | ~180 Z. | A/B |
| 4 · Gutschriften (aeltere Generation) | ~60 Z. | **A** — siehe 4.2 |
| 5 · Attrappen | ~25 Z. + 3 Handler | C |
| 6 · Versteckte Stubs | 5 Blöcke | folgt Abschnitt 3 |
| 7 · Artefakte | 5 Textdateien | A |

**Löschreihenfolge, damit nichts bricht:**

1. Abschnitt 7 (Artefakte) und Abschnitt 1 (`qr-invoice-controls.js`) — vollständig
   unabhängig, jederzeit möglich.
2. Abschnitt 2 (Functions) — `activate-subscription` erst nach Anpassung von
   `verify-phase1-launch-gates.mjs`.
3. Abschnitt 5 (Attrappen) samt ihrer drei Handler.
4. Abschnitt 3 (unerreichbare Funktionen).
5. Abschnitt 6 (Stubs) — **erst danach**, sonst brechen ihre Schreiber.
6. Abschnitt 4.2 und 4.3 — loeschbar, sobald die beiden Fragen unten beantwortet sind.

---

## 9 · Offene Fragen

| # | Frage |
|---|---|
| ~~1~~ | ~~Freistehende Kulanzgutschrift?~~ — **beantwortet: ja**, gebaut (4.2). |
| ~~2~~ | ~~„Anruf als geprüft markieren"?~~ — **beantwortet: ja**, gebaut (4.3). |
| **3** | Sollen die fünf `swiss-qr-*.txt` vor dem Löschen inhaltlich gesichtet werden, oder gehen sie ungelesen? |
| **4** | **Beide Migrationen liegen als Datei im Repo, sind aber auf keiner Datenbank angewendet.** Bis das geschieht, antwortet die Gutschrift mit einem Fehler und der Prüf-Haken speichert nicht. Soll ich sie auf Staging und Produktion anwenden? |

Alles andere in dieser Liste ist ohne Rückfrage löschbar, sobald das Zielbild freigegeben
ist — mit der Reihenfolge aus Abschnitt 8.
