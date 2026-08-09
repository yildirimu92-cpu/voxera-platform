# Benachrichtigungseinstellungen — Diagnose und Zielbild

**Stand:** 2026-08-09 · **Auftrag:** Briefing "Benachrichtigungseinstellungen definieren (Kunden-Dashboard + Admin-Portal)"
**Status:** Diagnose abgeschlossen, Zielbild zur Freigabe. **Kein Code geändert** — UI-Umsetzung erst nach Freigabe (Auftrag Punkt 2 und 4).

---

## 0. Kurzfassung

Die Ausgangslage im Briefing ("aktuell keine strukturierte Benachrichtigungseinstellung — nur der eine Punkt auf der Fähigkeiten-Karte") ist zu günstig formuliert. Es gibt bereits eine **vollständige Benachrichtigungs-Einstellungsseite** im Kunden-Dashboard (`Mehr → Benachrichtigungen`, drei E-Mail-Optionen plus drei Dashboard-Schalter). Sie sieht fertig aus. Das eigentliche Problem ist nicht, dass Einstellungen fehlen, sondern dass **von sechs sichtbaren Schaltern heute keiner einzige einen Versand steuert**:

| Schalter | Was er verspricht | Was er tatsächlich bewirkt |
|---|---|---|
| E-Mail: Keine / Nur Rückruf / Jeder Anruf | steuert den Mailversand | schreibt `notification_mode` — eine Spalte, die **kein Versandpfad liest** (B1) |
| Dashboard: Wichtige Anfragen | filtert die Glocke | wirkt — greift aber wegen des Fallbacks auf *alle* Anruf-Hinweise (B2) |
| Dashboard: Rückrufe und Aufgaben | filtert die Glocke | steuert **null** Zeilen, den Typ gibt es in Produktion nicht (B2) |
| Dashboard: Systemhinweise | — | fest auf `true` verdrahtet, `disabled`, ohne zugeordnete Zeilen (B2) |

Im Admin-Portal ist die Lage umgekehrt sauber: es gibt **keine** Einstellungsseite, aber mit `_lib/mail-delivery.js` + `outbox_events` (PR #857) einen belastbaren Unterbau, auf dem eine entstehen kann. Von den fünf definierten Admin-Events existiert genau eines als echter Versand.

**Die wichtigste Einzelentscheidung dieses Auftrags** ist deshalb nicht die Anzahl der Ereignisse, sondern B1: welche Spalte den Versand gatet. Sie kollidiert direkt mit dem parallel laufenden Szenario-01-Auftrag und muss in genau einem der beiden gelöst werden (Abschnitt 3).

---

## 1. Diagnose Kunden-Dashboard

### Was heute existiert

**Seite:** `customer-dashboard/index.html:8006–8033` — `#mehr-sub-benachrichtigungen`, erreichbar über `Mehr → Benachrichtigungen`.
**Speichern:** `vxSaveBenachrichtigungen()` (`index.html:14797`) — zwei Schreibwege in einer Aktion:
- E-Mail-Modus → `POST /.netlify/functions/customer-update-settings` → `customers.notification_mode`
- Dashboard-Schalter → direkter PostgREST-`update` aus dem Browser → `customers.in_app_notification_settings`

**Datenmodell (Produktion verifiziert):** `notification_mode` (text, `none|callback_only|all_calls`), die drei Legacy-Booleans `notification_active` / `new_log_email_active` / `missed_call_email_active`, `in_app_notification_settings` (jsonb, drei Kategorien), `phone_notification_to`, sowie sieben ungenutzte SMS-Spalten (`sms_notify_*`, `sms_caller_*`).

---

### B1 — Die Kundeneinstellung steuert den Mailversand nicht *(kritisch)*

`customer-update-settings.js:82–84` schreibt bewusst **nur** `notification_mode`:

> *"Canonical single source of truth: persist only notification_mode. Legacy boolean mirrors were removed from runtime writes to avoid schema-drift 500s."*

Der Versandpfad liest aber genau die Booleans, die dadurch eingefroren sind:

- **heute:** `call-intake-resolve-customer.js:132–135` liefert `notification_active` / `new_log_email_active` / `missed_call_email_active` an Make-Szenario 01, das darauf routet.
- **künftig:** `_lib/call-notification.js:146,152` aus dem Szenario-01-Branch (`claude/szenario-01-migration-4t5y8e`) gatet in `decideMail()` auf `notification_active` (Rückruf-Route) und `new_log_email_active` (Alle-Anrufe-Route) — ausdrücklich "Bit für Bit" identisch zu Szenario 01.

`notification_mode` wird von **keinem** Versandpfad gelesen. Nachweis: `grep -rn "notification_mode"` über beide `netlify/functions`-Bäume trifft ausschliesslich Schreib- und Anzeige-Stellen (`customer-update-settings.js`, `customer-update-assistant.js`, `customer-assistant-profile.js`) plus den Resolver, der den Wert zwar mitliefert, aber unbenutzt lässt.

**Messbarer Effekt (Produktionsdaten, 4 Kunden):**

| `notification_mode` | `notification_active` | `new_log_email_active` | Kunden | Effekt nach Szenario-01-Migration |
|---|---|---|---|---|
| `callback_only` | true | true | **3** | bekommen zusätzlich eine Mail nach **jedem** Anruf — obwohl "Nur bei Rückruf-Anfragen" gewählt |
| `all_calls` | true | true | 1 | zufällig korrekt |

Wählt ein Kunde heute **"Keine E-Mails"**, bleiben beide Booleans auf `true` — er bekäme weiterhin alles. Der Fehler ist aktuell unsichtbar, weil Szenario 01 abgeschaltet ist. **Ab dem Tag, an dem die Szenario-01-Migration live geht, wird er zu sichtbarem Fehlversand** — und zwar in der Richtung "mehr Mails als bestellt", nicht "weniger".

Das ist dieselbe Fehlerklasse wie N6 und wie die Mail-Verifikation vom 09.08.: eine Einstellung quittiert Erfolg und bleibt wirkungslos.

---

### B2 — Zwei der drei Dashboard-Schalter steuern nichts *(mittel)*

`vxNotifTypeToSettingsCategory()` (`index.html:10185`) ordnet Notification-Typen drei Kategorien zu. In Produktion existieren in `notifications` genau zwei Typen:

| Typ | Zeilen | Kategorie | steuernder Schalter |
|---|---|---|---|
| `call` | 22 | `important_requests` *(über den V1-Fallback für unbekannte Typen)* | "Wichtige Anfragen" |
| `hot` | 1 | `important_requests` | "Wichtige Anfragen" |

- **"Rückrufe und Aufgaben"** erwartet `callback`, `callback_due`, `task_due`, `followup` — kein einziger dieser Typen wird je geschrieben. Einziger Producer ist `elevenlabs-post-call.js:526,1058` mit `type: isHot ? 'hot' : 'call'`.
- **"Systemhinweise"** ist zusätzlich in `vxNormalizeInAppNotificationSettings()` hart auf `true` normalisiert und im Markup `disabled` — er ist reine Dekoration über einer leeren Kategorie.
- **"Wichtige Anfragen"** wirkt, aber nicht wie beschriftet: der Fallback zieht auch gewöhnliche Anrufe hinein. Wer "Hot Leads und dringende Anliegen" abschaltet, schaltet in Wahrheit die komplette Glocke ab.

---

### B3 — Doppelte DOM-IDs, alte Seite gewinnt nie *(mittel)*

`inapp-setting-important-requests`, `-callbacks-and-tasks`, `-system` existieren **zweimal**:
- `index.html:8025–8027` in `#mehr-sub-benachrichtigungen` (aktuelle Seite)
- `index.html:8204–8218` in `#tab-einstellungen` (Altseite)

`getElementById` trifft immer die erste Vorkommnis. Die Altseite zeigt beim Öffnen also dauerhaft ungesetzte Schalter und speichert nie — unabhängig davon, was der Kunde dort klickt. Sie ist erreichbar: `nav-einstellungen` ist zwar `display:none`, aber `mnav-konto` (`index.html:8409`) und der Tab-Restore über `MAIN_NAV_HISTORY_TABS` / `VX_ROOT_TABS` (`index.html:25568,25716`) führen dorthin.

Im selben Block liegen weitere Karteileichen: `browser-notif-toggle` / `toggleBrowserNotif()`, der Sound-Picker (`selectSound()`), und `vxSetToggle2()` (`index.html:14835`), das `sms-*-toggle2`-Elemente anspricht, die es im Markup nicht mehr gibt.

---

### B4 — In-App-Einstellungen gehen am Endpoint vorbei *(mittel)*

`in_app_notification_settings` fehlt in `CANONICAL_ALLOWED_FIELDS` (`customer-update-settings.js:15–28`) und wird stattdessen direkt aus dem Browser per PostgREST geschrieben (`index.html:14820`). Eine Speichern-Aktion, zwei Wege, einer davon ohne serverseitige Validierung — genau die Asymmetrie, die `customer-update-settings.js` als Torwächter eigentlich auflösen sollte.

---

### B5 — Die Fähigkeiten-Karte nennt den Kanal aus einer toten Quelle *(klein, aber sichtbar)*

`notificationDetail()` (`customer-assistant-profile.js:104–114`) leitet die Kanal-Angabe "E-Mail" aus `new_log_email_active` / `missed_call_email_active` ab — den Spalten aus B1, die seit dem 07.04. niemand mehr schreibt. Für jeden Kunden, der seine Einstellung seither einmal geändert hat, fällt der Text auf "Benachrichtigungen für alle Anrufe" zurück, **ohne den Kanal zu nennen**. Der im Briefing zitierte Wortlaut "E-Mail für alle Anrufe" stammt aus dem Backfill von 2026-04-07, nicht aus einer lebenden Quelle.

Zusätzlich erscheint `Telefon/SMS` im selben Text, sobald `phone_notification_to` befüllt ist — für einen Kanal, für den nirgends Versandlogik existiert.

Der Status "Konfiguriert" selbst ist korrekt und bewusst so gewählt (PR #871) — die Karte prüft Einstellungsfelder, keinen Zustellbeleg. Nur die Kanal-Herleitung darunter ist kaputt.

---

### B6 — Der Werksstandard hat drei verschiedene Antworten *(Default-Drift)*

| Quelle | "ab Werk" |
|---|---|
| `supabase/sql/2026-04-07_notification_mode_single_source.sql` | `DEFAULT 'none'` |
| **Produktion** (verifiziert) | `notification_mode DEFAULT 'callback_only'`, `notification_active DEFAULT true`, `new_log_email_active DEFAULT true`, `missed_call_email_active DEFAULT false` |
| UI-Anzeige | `customerMeta.notificationMode \|\| 'none'` (`index.html:14780`, `16322`) — ein `NULL`-Wert erscheint als "Keine E-Mails" |

Die SQL-Datei aus dem Repo ist auf Produktion nie in dieser Form angekommen. Für die Zielbild-Frage "was ist ab Werk an" heisst das: der Default muss neu und **einmal** gesetzt werden, nicht aus dem Bestand abgelesen.

---

### B7 — SMS: Datenmodell vollständig, alles andere fehlt

`sms_notify_enabled/trigger/number` (ans Voxera-Team) und `sms_caller_enabled/trigger/template` (an den Anrufer) existieren auf `customers` und sind über `customer-update-assistant.js:288–293` sogar **schreibbar** — es gibt nur keine UI, die sie sendet, keine Versandlogik, und keinen aktiven Add-on (`customer_addons` ist in Produktion leer; `index.html:16402` erwartet ein `sms_notify_kunde`). Deckt sich mit dem Roadmap-Fund vom 08.08.

---

## 2. Diagnose Admin-Portal

### Was heute existiert

**Einstellungsseite:** keine Benachrichtigungs-Einstellung. `#section-settings` (`admin-panel/index.html:2741–2797`) enthält Konto, System-Infos, Admin-Verwaltung (Tabelle `admins`, 1 aktive Zeile) und Plan-Konfiguration.
**In-App-Kanal:** existiert nicht. `notifications` ist rein kundenseitig (`customer_id` + RLS auf `current_customer_id()`, Migration 2026-08-08). Phase 3 aus PR #857 ist offen.
**Versandweg:** `_lib/mail-delivery.js` + `outbox_events` + `outbox-retry-worker.js` — belastbar, gehärtet, mit einheitlichem Ergebnisvertrag. **Genau der Unterbau, auf dem dieser Auftrag aufsetzen soll.**

### B8 — Von fünf Events existiert eines

| # | Event (Beschluss 09.08.) | Natürlicher Auslösepunkt im Code | Versand heute |
|---|---|---|---|
| 1 | KI-Änderungsanfrage | `customer-dashboard/.../ai-change-request-create.js:75` | ✅ `mail_type: ai_change_request` |
| 2 | Gegenzeichnung ausstehend | `admin-panel/.../offer-public-accept.js` (Kunde signiert, `countersigned_at` noch leer) | ❌ kein Emitter, kein `mail_type` |
| 3 | Vertragsstart bestätigt | `admin-panel/.../contract-start-confirm.js` | ❌ kein Emitter, kein `mail_type` |
| 4 | Billing-/Zustellfehler | `admin-panel/.../outbox-retry-worker.js:300` (`markOutboxFailed`), `daily-billing-runner.js` | ❌ Fehlschlag wird protokolliert, niemand benachrichtigt |
| 5 | Kündigung eingereicht | `customer-dashboard/.../customer-cancel-contract.js` | ❌ der tote `ai-change-notify`-Aufruf wurde in PR #857 entfernt |

### B9 — Kein Empfängerbegriff

`ai_change_request` trägt **keinen** Empfänger im Payload (`ai-change-request-create.js:77–86`) — die Mail-Engine routet auf ein festes Sammelpostfach. Weder `admins` noch die separate Tabelle `admin_emails` wird von irgendeinem Versandpfad gelesen. Der Roadmap-Beschluss "Empfänger direkt an den User statt Sammelpostfach" ist damit noch nicht eingelöst.

### B10 — PR #857 ist noch nicht auf main

`main` endet bei `fbaad87`; `claude/admin-notifications-pr-818-kbk8bu` ist offen. Bestätigt durch die Daten: `outbox_events` enthält in Produktion **keine einzige** `ai_change_request`- oder `contract_signed_email`-Zeile — nur `offer_email` (7), `invoice_email` (7), `reminder_email` (5), `reminder_final_email` (3), `customer_welcome_access_email` (2), `setup_fee_email` (1).

**Alles im Admin-Zielbild setzt PR #857 als gemergt und deployed voraus, inklusive des ausstehenden `MAKE_MAIL_WEBHOOK`-Fixes.** Ohne das baut die Einstellungsseite Schalter für einen Versandweg, der noch nicht existiert — exakt der Fehler, den B1 und B2 auf der Kundenseite dokumentieren.

### B11 — Zwei Mail-Typen sind deklariert, aber sendet niemand

`password_changed_email` und `assistant_updated_email` stehen in `config/mail-engine-contracts.json` und in `MAIL_ENGINE_TYPES`, haben aber **null** Emitter im gesamten Repo. Für das Admin-Zielbild irrelevant, für die Frage "welche Events existieren technisch bereits" aber Teil der Antwort: die Vertragsliste ist kein Inventar dessen, was läuft.

---

## 3. Verhältnis zum Szenario-01-Auftrag *(Auftrag Punkt 3)*

Der Branch `claude/szenario-01-migration-4t5y8e` (3 Commits über `main`) migriert den Anruf-Benachrichtigungspfad auf `_lib/mail-delivery.js`. Er führt dabei ein:

- `_lib/call-notification.js` mit zwei neuen Mail-Typen: **`callback_request_email`** und **`call_notification_email`**
- eine Erweiterung von `config/mail-engine-contracts.json` und `verify-mail-engine-contracts.mjs`
- `supabase/sql/2026-08-09_outbox_dedupe_unique.sql` (Doppelversand-Sperre)

**Überschneidung:** genau eine, aber eine harte — `decideMail()` gatet auf den Legacy-Booleans (B1). Der Szenario-01-Auftrag hat das bewusst so gebaut ("Parität zu den beiden Router-Filtern in Szenario 01"), was für eine reine Migration richtig ist: eine Migration soll das Verhalten nicht nebenbei ändern.

**Vorschlag zur Arbeitsteilung — keine Doppelarbeit, keine Lücke:**

| | Szenario-01-Auftrag | dieser Auftrag |
|---|---|---|
| Mail-Typen `callback_request_email` / `call_notification_email` | **baut sie** | benutzt sie, baut sie nicht nach |
| Make-Szenario-09-Routen dafür | **seine Sache** | rührt Make nicht an |
| `decideMail()`-Gating | lässt es auf den Booleans (Parität) | **stellt es auf `notification_mode` um** — als eigener, benannter Verhaltenswechsel |
| Einmalige Datenangleichung der 4 Bestandskunden | — | **hier** (Abschnitt 4.4) |
| Einstellungs-UI beider Portale | — | **hier** |

Der Szenario-01-Branch sollte **zuerst** mergen. Dieser Auftrag setzt anschliessend genau eine Änderung obendrauf (`decideMail()` liest `notification_mode`) statt beide Branches am selben Gating arbeiten zu lassen.

**Rückmeldung an den Szenario-01-Auftrag nötig:** dass sein Gating bewusst temporär ist und hier abgelöst wird — sonst wird es dort als "so gewollt" zementiert.

---

## 4. Zielbild Kunden-Dashboard

### 4.1 Leitlinie

Grundsatz 15 (Zielgruppe nicht digital-affin) heisst hier nicht nur "wenige Schalter", sondern vor allem: **kein Schalter ohne Wirkung**. Die Diagnose zeigt sechs sichtbare Schalter und null wirksame — das Zielbild kehrt das um, notfalls mit weniger Schaltern.

Zweite Leitlinie, aus B2/B3 gelernt: **was nicht zugestellt werden kann, wird nicht angeboten.** Lieber vier ehrliche Ereignisse als fünf, von denen eines eine neue Make-Route bräuchte, die es noch nicht gibt.

### 4.2 Vorschlag: 4 Ereignisse, zwei Gruppen

**Gruppe A — "Sie entscheiden" (echte An/Aus-Schalter)**

| # | Wortlaut auf der Seite | Untertitel | Kanal | Standard | Zustellung über |
|---|---|---|---|---|---|
| 1 | **Anruf mit Rückrufwunsch** | "Wenn jemand um Rückruf bittet — mit Nummer und Anliegen." | E-Mail | **AN** | `callback_request_email` *(Szenario-01-Auftrag)* |
| 2 | **Zusammenfassung jedes Anrufs** | "Nach jedem Gespräch eine kurze Zusammenfassung." | E-Mail | **AUS** | `call_notification_email` *(Szenario-01-Auftrag)* |
| 3 | **Hinweise in der Glocke** | "Neue Anrufe erscheinen als Hinweis im Dashboard." | Dashboard | **AN** | `notifications`-Tabelle *(existiert)* |

**Gruppe B — "Immer aktiv" (sichtbar, nicht abschaltbar, mit Begründung in einem Satz)**

| # | Wortlaut | Begründung auf der Seite | Zustellung über |
|---|---|---|---|
| 4 | **Wichtiges zu Vertrag und Rechnung** | "Rechnungen, Mahnungen und Vertragsänderungen senden wir immer — dazu sind wir vertraglich verpflichtet." | `invoice_email`, `reminder_email`, `reminder_final_email`, `contract_signed_email`, `contract_expired_email` *(alle existieren und laufen)* |

Damit sind es **3 wählbare + 1 transparent gesperrtes** Ereignis — im vom Briefing gesetzten Rahmen 3–5, und jedes einzelne mit einem realen Versandpfad hinterlegt.

### 4.3 Warum nicht mehr

Drei Kandidaten wurden geprüft und bewusst **nicht** aufgenommen:

- **"Dringende Anliegen / Hot Leads" als eigener Schalter.** Bräuchte einen dritten Mail-Typ und damit eine neue Make-Route — laut Briefing ausdrücklich nicht Teil dieses Auftrags ("nur an die bestehende Infrastruktur andocken"). `hot` bleibt in der Glocke sichtbar, wo es heute schon funktioniert.
- **"Rückrufe und Aufgaben" (Glocke).** Steuert null Zeilen (B2). Kommt zurück, wenn es einen Producer für `callback`/`task_due` gibt — nicht vorher.
- **Empfänger-Adresse frei wählbar.** Heute read-only aus dem Profil. Eine zweite Adresse ist ein eigenes Thema (Zustellbarkeit, Verifikation) und passt nicht zu "einfache Bedienung".

### 4.4 Standardwerte und der Bestand

**Werksstandard für Neukunden:** Ereignis 1 **AN**, Ereignis 2 **AUS**, Ereignis 3 **AN**. Begründung: ein Rückrufwunsch ist der Fall, in dem eine verpasste Mail Geld kostet; eine Mail nach *jedem* Anruf ist bei 20 Anrufen am Tag der schnellste Weg in den Spam-Ordner und damit dahin, dass auch Ereignis 1 nicht mehr gelesen wird. Entspricht `notification_mode = 'callback_only'` — also dem heutigen Produktions-Default, nicht dem der SQL-Datei (B6). Die SQL-Datei wird angeglichen, nicht die Produktion.

**Bestandskunden (4 Stück):** einmalige Datenangleichung, keine stille Änderung ihrer Wahl. Konkret: `notification_mode` bleibt massgeblich, die drei Legacy-Booleans werden **einmal** daraus neu abgeleitet (die Umkehrung des Backfills von 2026-04-07) und danach nicht mehr geschrieben. Für die 3 Kunden auf `callback_only` heisst das: `new_log_email_active` fällt auf `false` — sie bekommen genau das, was sie eingestellt haben, statt zusätzlich jeden Anruf.

*Zu entscheiden:* Ob die 4 Bestandskunden zusätzlich eine Info-Mail bekommen ("Ihre Benachrichtigungen haben wir präzisiert"). Meine Empfehlung: **nein** — die Änderung stellt den gewählten Zustand her, sie ändert ihn nicht; eine Mail darüber würde einen Fehler ankündigen, den bisher niemand bemerkt hat, und der bei 3 von 4 Kunden ohnehin nur Test-Accounts betrifft.

### 4.5 SMS

Laut Briefing nur die Oberfläche vorsehen, keine Anbindung. Nach B2/B3 **empfehle ich ausdrücklich, in V1 keinen SMS-Schalter zu rendern** — wir haben gerade vier tote Schalter diagnostiziert, ein fünfter mit "Bald verfügbar" wäre derselbe Fehler mit Etikett. Stattdessen:

- Das Datenmodell ist bereits vollständig (B7), es muss nichts vorbereitet werden.
- Ereignis 1 bekommt im Layout die Struktur, die einen zweiten Kanal später aufnimmt (Zeile mit Kanal-Chips statt nacktem Schalter), aber vorerst nur mit E-Mail belegt.
- Der Schalter erscheint, sobald ein Versandweg existiert — dann als **SMS nur für Ereignis 1**, wie im Briefing vorgezeichnet.

*Zu entscheiden:* falls stattdessen doch ein sichtbarer, deaktivierter SMS-Schalter gewünscht ist, baue ich ihn — dann bitte explizit, damit es eine bewusste Ausnahme bleibt.

### 4.6 Was die Umsetzung anfassen würde

1. **`decideMail()` in `_lib/call-notification.js`** auf `notification_mode` umstellen (nach Merge des Szenario-01-Branches). *Das ist die eigentliche Reparatur.*
2. **`customer-update-settings.js`**: `in_app_notification_settings` in `CANONICAL_ALLOWED_FIELDS` aufnehmen, In-App-Schreibweg vom Browser auf den Endpoint ziehen (B4).
3. **`index.html`**: Seite `#mehr-sub-benachrichtigungen` auf die vier Ereignisse umbauen; Duplikate und Karteileichen in `#tab-einstellungen` entfernen (B3).
4. **`vxNotifTypeToSettingsCategory()`**: auf die real existierenden Typen reduzieren, Fallback ehrlich benennen (B2).
5. **Migration**: einmalige Angleichung der Legacy-Booleans + `DEFAULT`-Korrektur (B6, 4.4).
6. **`customer-assistant-profile.js`**: `notificationDetail()` aus `notification_mode` statt aus den Booleans ableiten; `Telefon/SMS` entfernen, solange es keinen Versand gibt (B5) — siehe Abschnitt 6.

---

## 5. Zielbild Admin-Portal

### 5.1 Leitlinie

Internes Team, kein KMU-Kunde — hier darf es granularer sein. Aber dieselbe Regel gilt: kein Schalter ohne Versandpfad. Da vier der fünf Events heute keinen Emitter haben (B8), zerfällt der Admin-Teil sauber in zwei Stufen.

### 5.2 Die Seite: `Einstellungen → Benachrichtigungen`

Neue Karte in `#section-settings`, direkt unter "Mein Admin-Konto". Fünf Zeilen, pro Zeile ein Kanal-Toggle **E-Mail** — und eine zweite Toggle-Spalte **Im Portal**, die in Stufe 1 komplett ausgeblendet bleibt (Phase 3 aus PR #857).

| # | Zeile | Untertitel | E-Mail Standard | Emitter |
|---|---|---|---|---|
| 1 | **KI-Änderungsanfrage** | "Ein Kunde wünscht eine Änderung an seinem Assistenten." | **AN** | existiert |
| 2 | **Gegenzeichnung ausstehend** | "Ein Kunde hat unterschrieben — der Vertrag wartet auf Ihre Gegenzeichnung." | **AN** | zu bauen |
| 3 | **Vertragsstart bestätigt** | "Ein Vertrag ist aktiv geworden." | **AUS** | zu bauen |
| 4 | **Billing- oder Zustellfehler** | "Eine Rechnung oder E-Mail konnte nicht zugestellt werden." | **AN** | zu bauen |
| 5 | **Kündigung eingereicht** | "Ein Kunde hat gekündigt." | **AN** | zu bauen |

**Standardwerte begründet:** 2, 4 und 5 blockieren oder gefährden Geld und brauchen eine Reaktion desselben Tages — die sind ab Werk an. 3 ist eine Bestätigung dessen, was der Admin selbst ausgelöst hat, und im Portal ohnehin sichtbar — ab Werk aus. 1 ist der einzige, der heute schon zustellt, und bleibt an.

### 5.3 Empfänger

Pro Admin-Konto, nicht pro Portal — die Einstellung hängt an `admins.id` (heute genau eine aktive Zeile). Neue Tabelle `admin_notification_settings (admin_id, event_key, email_enabled, in_app_enabled)` statt einer jsonb-Spalte, weil das Admin-Portal im Gegensatz zum Kunden-Dashboard mehrere Empfänger pro Event bekommen wird, sobald das Team wächst.

Damit wird gleichzeitig B9 gelöst: der Versand liest die Empfängerliste aus der Tabelle und setzt `recipient.email` in den Payload, statt sich auf das Sammelpostfach der Mail-Engine zu verlassen. `ai_change_request` bekommt dabei nachträglich einen Empfänger.

*Nicht Teil davon:* Rollenverteilung bei mehreren Admins (Roadmap: "aktuell Solo-Team, noch nicht relevant"). Die Tabelle kann es später, die UI zeigt es nicht.

### 5.4 Stufen

**Stufe 1 — Seite + Event 1.** Tabelle, Einstellungsseite mit allen fünf Zeilen, Empfängerauflösung, `ai_change_request` respektiert die Einstellung. Events 2–5 erscheinen in der Liste mit einem sichtbaren Zustand **"noch nicht aktiv"** statt eines Schalters, der nichts tut. Das ist die einzige ehrliche Darstellung, solange die Emitter fehlen — und sie macht den Restaufwand im Portal selbst sichtbar.

**Stufe 2 — Events 2–5.** Vier `deliverMail()`-Aufrufe an den in B8 benannten Stellen, vier neue `mail_type`s in `config/mail-engine-contracts.json`, vier Routen in Make-Szenario 09. **Der Make-Teil ist nicht Code und muss vom User gemacht werden** — deshalb als eigene Stufe, nicht mit Stufe 1 vermischt. Erst wenn eine Route steht, wird die zugehörige Zeile in der UI zu einem echten Schalter.

*Zu entscheiden:* ob Stufe 2 Teil dieses Auftrags ist oder Phase 4 aus PR #857 bleibt. Meine Empfehlung: **Phase 4 aus PR #857** — der Chat dort kennt die Mail-Engine-Verträge und die Merge-Reihenfolge; dieser Auftrag liefert die Einstellungsseite und die Empfängerauflösung, die Phase 4 dann benutzt.

### 5.5 In-App-Kanal (Phase 3)

Bleibt ausserhalb. `notifications` ist kundenseitig und RLS-gebunden (B7 der Roadmap); ein Admin-Kanal ist Greenfield mit erprobtem Muster. Die Tabelle aus 5.3 hat die Spalte `in_app_enabled` bereits, die UI-Spalte bleibt bis dahin ausgeblendet.

---

## 6. Fähigkeiten-Karte *(Auftrag Punkt 5)*

Der Eintrag "Benachrichtigungen versenden" (`customer-assistant-profile.js:195–208`) wird **nicht abgelöst, sondern korrigiert und verlinkt**:

- Detailtext aus `notification_mode` statt aus den toten Booleans ableiten (B5).
- `Telefon/SMS` entfernen, solange kein Versandweg existiert.
- Neuer Wortlaut, an den vier Ereignissen orientiert: z. B. *"E-Mail bei Rückrufwunsch"* / *"E-Mail nach jedem Anruf"* / *"Nur Hinweise im Dashboard"*.
- Die Karte bekommt einen Link auf `Mehr → Benachrichtigungen`. Der Status "Konfiguriert" bleibt — er ist seit PR #871 bewusst kein Zustellbeleg.

Die Karte bleibt damit das, was sie ist: eine Statusanzeige. Die Einstellungsseite bleibt der einzige Ort, an dem etwas geändert wird.

---

## 7. Offene Entscheidungen — Rückmeldung erbeten

| # | Frage | Meine Empfehlung |
|---|---|---|
| E1 | **B1**: Gating auf `notification_mode` umstellen — in diesem Auftrag, nach Merge des Szenario-01-Branches? | Ja. Sonst geht die Migration mit einem bekannten Fehlversand live. |
| E2 | Kunden-Zielbild: 3 wählbare + 1 gesperrtes Ereignis wie in 4.2? | Ja — jedes mit realem Versandpfad. |
| E3 | Werksstandard Kunde: Rückrufwunsch AN, jeder Anruf AUS, Glocke AN? | Ja. |
| E4 | Bestandskunden angleichen ohne Info-Mail? | Ja, ohne Mail (4.4). |
| E5 | SMS in V1 gar nicht rendern statt deaktiviert zu zeigen? | Ja (4.5). |
| E6 | Admin-Zielbild: fünf Zeilen, Stufe 1 baut Seite + Event 1, Events 2–5 sichtbar als "noch nicht aktiv"? | Ja. |
| E7 | Admin-Standardwerte: 1, 2, 4, 5 AN — 3 AUS? | Ja (5.2). |
| E8 | Stufe 2 (Emitter für Events 2–5 + Make-Routen) hier oder als Phase 4 in PR #857? | Phase 4 in PR #857. |
| E9 | Reihenfolge: erst Szenario-01-Branch mergen, dann dieser Auftrag? | Ja — sonst arbeiten zwei Branches am selben `decideMail()`. |

---

## Anhang — Belege

**Produktionsdaten** (Projekt `ulcofbgrovgcvowdjrge`, read-only abgefragt am 09.08.):

- `customers`: 4 Zeilen — 3 × (`callback_only`, `notification_active=true`, `new_log_email_active=true`, `missed_call_email_active=false`), 1 × (`all_calls`, alle drei true). Alle 4 mit `in_app_notification_settings = {system:true, important_requests:true, callbacks_and_tasks:true}`, alle SMS-Flags `false`, `phone_notification_to` überall leer.
- `notifications`: 22 × `type='call'`, 1 × `type='hot'`. Keine weiteren Typen.
- `outbox_events`: `offer_email` 7, `invoice_email` 7, `reminder_email` 5, `reminder_final_email` 3, `customer_welcome_access_email` 2, `setup_fee_email` 1 — alle `sent`. Kein `ai_change_request`, kein `contract_signed_email`.
- `admins`: 1 Zeile, `status='active'`. `customer_addons`: 0 Zeilen.
- Spalten-Defaults: `notification_mode='callback_only'`, `notification_active=true`, `new_log_email_active=true`, `missed_call_email_active=false`.

**Codestellen:** siehe Datei:Zeile-Angaben in den jeweiligen Befunden.

**Nicht verifiziert:** kein Live-Anruf, kein echter Mailversand ausgelöst. Die Aussage "Szenario 01 ist aus" ist aus der Roadmap vom 09.08. übernommen und hier nicht erneut gegen Make geprüft — Make wurde auftragsgemäss nicht angefasst.

---

# Nachtrag: Umsetzung (09.08., nach Freigabe E1–E9)

Alle neun Entscheidungen wurden wie empfohlen freigegeben. Was gebaut wurde, und wo es vom Zielbild abweicht.

## Eine Abweichung von Abschnitt 4.2 — begründet

Das Zielbild nennt "Anruf mit Rückrufwunsch" und "Zusammenfassung jedes Anrufs" als zwei gleichrangige Ereignisse. Beim Bauen zeigte sich: das sind sie nicht.

`notification_mode` kennt drei Zustände. Zwei unabhängige Schalter hätten vier versprochen — und der vierte, "keine Rückruf-Mail, aber Zusammenfassung nach jedem Anruf", existiert weder im Datenmodell noch fachlich: ein Rückrufwunsch *ist* ein Anruf, die Zusammenfassung würde ihn mit abdecken. Zwei gleichrangige Zeilen hätten damit eine Unabhängigkeit vorgetäuscht, die es nicht gibt — dieselbe Fehlerklasse wie B2, nur neu gebaut.

**Umgesetzt als Schalter plus Unterschalter:**

| Rückrufwunsch | Auch ohne Rückrufwunsch | `notification_mode` |
|---|---|---|
| aus | *(gesperrt)* | `none` |
| an | aus | `callback_only` *(Werksstandard)* |
| an | an | `all_calls` |

Der Unterschalter wird gesperrt statt still ignoriert, und die Zeile sagt warum ("Nicht verfügbar, solange Sie gar keine E-Mails erhalten möchten"). Jeder Zustand ist erreichbar, keiner ist erfunden.

## Kunden-Dashboard

| Befund | Umsetzung |
|---|---|
| **B1** | `decideMail()` in `_lib/call-notification.js` gatet auf `notification_mode`. Die drei Legacy-Booleans kommen im ausführbaren Teil der Datei nicht mehr vor; das Verify-Skript prüft das auf Quellcode-Ebene, damit die Bedingung nicht zurückkehrt. |
| **B2** | Statt drei Glocken-Schaltern einer, der sagt was er tut ("Hinweise in der Glocke"). Die Kategorie-Zuordnung bleibt dokumentiert für einen späteren `callback`/`task_due`-Producer. |
| **B3** | Die doppelten `inapp-setting-*`-IDs sind entfernt. |
| **B4** | `in_app_notification_settings` läuft über `customer-update-settings.js` — ein Request statt zweier Schreibwege, also nichts mehr halb gespeichert. Systemhinweise sind serverseitig auf `true` festgenagelt. |
| **B5** | `notificationDetail()` und `notificationConfigured` kommen aus `notification_mode`. `Telefon/SMS` entfernt. Neuer Verweis von der Karte auf die Einstellungsseite. |
| **B6** | Werksstandard `callback_only` an drei Stellen identisch: Migration, `call-notification.js`, `index.html`. |

**Nebenfund, mitentfernt:** `selectNotifCard()` / `saveNotifSettings()` in `#tab-einstellungen` waren ein *dritter* Schreibweg auf `notification_mode`, mit eigenem Autosave über `patchCustomerRecord()`. `saveNotifSettings()` las `notification-mode-hidden` und fällt ohne dieses Feld auf `'none'` zurück — nach dem Entfernen der Karten hätte ein versehentlicher Aufruf die Einstellung des Kunden auf "keine E-Mails" gesetzt. Deshalb mit entfernt statt unbenutzt stehengelassen. Ton-Auswahl und Browser-Push bleiben unangetastet: eigene Konsumenten (`playNotifSound`), nichts mit dem Mailversand zu tun.

## Admin-Portal (Stufe 1)

- **Neue Tabelle** `admin_notification_settings (admin_id, event_key, email_enabled, in_app_enabled)`, RLS an, keine Grants für `anon`/`authenticated` — der Zugriff läuft ausschliesslich über Service-Role. Bewusst nicht auf fehlende Grants verlassen: genau diese Annahme hielt am 08.08. bei `public.notifications` nicht.
- **Neue Karte** "Meine Benachrichtigungen" in `Einstellungen`, über `admin-notification-settings.js`. Ein Admin ändert nur die eigenen Einstellungen.
- **Events 2–5** erscheinen als **"Noch nicht aktiv"** statt als Schalter. Was verfügbar ist, entscheidet das Backend (`mailType` gesetzt) — nicht die Oberfläche. Jedes noch nicht gebaute Event nennt seine künftige Auslösestelle im Code.
- **B9 gelöst:** `ai_change_request` löst die Empfänger aus der Tabelle auf und setzt `recipient.email` in den Payload. Ohne Empfänger wird **kein Erfolg behauptet** — und "niemand hat es eingeschaltet" (`no_recipients_enabled`) ist von "die Abfrage ist gescheitert" (`lookup_failed`) unterscheidbar.

## Verifikation

- `verify-notification-settings.mjs` (neu): **60 Prüfungen grün.** Prüft die Kette statt der Stellen — Schalter → Modus → Endpoint → Gating. Fällt ein Glied aus, fällt der Test, auch wenn jede Datei für sich fehlerfrei bleibt.
- `verify-call-notification-migration.mjs`: 19/19 grün, Gating-Tests auf das neue Modell umgestellt.
- **52 von 53** Verify-Skripten grün. Der eine rote ist `verify-db-security-invariants.mjs` — fehlende DB-Zugangsdaten, auf `main` identisch rot.
- Inline-Skriptblöcke syntaktisch geprüft: 31 im Kunden-Dashboard, 4 im Admin-Panel, alle fehlerfrei. Keine neuen doppelten DOM-IDs.
- Beide Migrationen **auf Staging gefahren**: Defaults, Kommentare, RLS, Grants, FK-Kaskade und Check-Constraint verifiziert. **Produktion bewusst nicht angefasst.**

## Ehrlich benannte Grenzen

- **Kein Live-Anruf, kein echter Mailversand ausgelöst.** Die Wirkkette ist an Fixtures und Quellcode verifiziert, nicht an einer zugestellten Mail.
- **Die Oberflächen wurden nicht im Browser geklickt.** Die Logik läuft im Test gegen einen DOM-Stub; Layout und Bedienung sind unbelegt.
- **Beide Migrationen sind auf Produktion angewendet** (09.08., nach Freigabe — Admin-Migration zuerst, dann die Gating-Migration). Belege unten.
- **Kein Live-Anruf und keine echte Mail** haben die Kette bestätigt — die Migrationen sind an den Daten verifiziert, nicht an einer Zustellung.
- **Stufe 2** (Emitter für Events 2–5 plus vier Routen in Make-Szenario 09) ist wie freigegeben nicht Teil dieses Auftrags, sondern Phase 4 in PR #857.


---

# Nachtrag 2: Produktionsstand (09.08., nach Freigabe)

## Admin-Migration — angewendet

Fünf Zeilen für den einen aktiven Admin, Werksstandard exakt wie in E7 freigegeben (`contract_start_confirmed` aus, die übrigen vier an). RLS aktiv, **null Policies und null Grants** für `anon`/`authenticated` — die Tabelle ist ausschliesslich über die Service-Role erreichbar. Die Abfrage, die `resolveAdminRecipients()` ausführt, liefert **einen Empfänger mit gültiger Mailadresse**.

Kein Risikofenster: die zum Zeitpunkt der Migration deployte Version kennt die Tabelle nicht. Das Verhalten ändert sich erst mit dem Deploy — und dann findet der Code die Zeilen bereits vor.

## Gating-Migration — angewendet

Sicherung vorab angelegt (`customers_notification_backup_20260809`, 4 Zeilen). **`notification_mode` wurde bei keinem einzigen Kunden verändert** — die Wahl der Kunden ist unangetastet, nachgewiesen durch Abgleich gegen die Sicherung.

Der Effekt auf die abgeleiteten Legacy-Booleans:

| `notification_mode` | Kunden | Versand vorher (altes Gating) | Versand nachher | |
|---|---|---|---|---|
| `callback_only` | **3** | Mail nach **jedem** Anruf | nur Rückruf-Mail | ✅ korrigiert |
| `all_calls` | 1 | Mail nach jedem Anruf | Rückruf-Mail + Zusammenfassung | unverändert richtig |

**Das eigentliche Ergebnis:** altes und neues Gating liefern jetzt für **alle vier Kunden dasselbe**. Damit ist das Fenster zwischen dem Szenario-01-Deploy und dem Deploy dieses Branches harmlos — in diesem Zeitraum gatet der Produktionscode noch auf die Legacy-Booleans, und die stimmen ab sofort mit `notification_mode` überein.

Nebeneffekt, bewusst und folgenlos: `missed_call_email_active` ging bei den drei `callback_only`-Kunden von `false` auf `true`. Die Spalte hat keinen Leser — weder im Repo noch in den beiden Router-Filtern von Szenario 01 (die lesen `notification_active` und `new_log_email_active`). Sie spiegelt jetzt korrekt den gewählten Modus, statt widersprüchlich dazu zu stehen.

Defaults korrigiert: `notification_mode` bleibt `callback_only`, `new_log_email_active` von `true` auf `false` — ein Neukunde startet nicht mehr im Widerspruch zu seinem eigenen `notification_mode`. Drei Spalten sind in der Datenbank als tot markiert.

## Was jetzt noch aussteht

1. **Szenario-01-Branch mergen** — wartet auf Make-Handarbeit und Live-Testanruf.
2. **Diesen Branch mergen und deployen** — danach.

Ein Fund am Rande: PR #857 ist auf `main` (`deliverMail` in `ai-change-request-create.js`), trotzdem steht `outbox_events` bei null `ai_change_request`-Zeilen. Entweder ist seit dem Merge keine Änderungsanfrage eingegangen, oder der Pfad kommt noch nicht durch. Beim nächsten Testlauf mitprüfen.


---

# Nachtrag 3: Ungeschützte Sicherungstabelle (09.08.)

**Mein Fehler, mit Wirkung in Produktion.** Die Sicherung in `2026-08-09_notification_mode_gating.sql` wurde per `CREATE TABLE AS` angelegt — und nur die Kopie, nicht ihr Schutz. `CREATE TABLE AS` erzeugt eine Tabelle mit RLS aus, und die Default-Privileges des Projekts geben `anon` und `authenticated` in `public` **ALL**. Die Kopie enthielt `id` und die Benachrichtigungseinstellungen aller vier Produktionskunden und war über die öffentliche API nicht nur les-, sondern auch schreibbar (`SELECT, INSERT, UPDATE, DELETE` für `anon`).

**Was besonders ärgerlich ist:** die Admin-Migration derselben Nacht begründet genau diese Härtung ausdrücklich und verweist dabei auf den `notifications`-Vorfall vom 08.08. Die Regel war bekannt und zwei Dateien weiter trotzdem nicht angewandt — weil eine Sicherungstabelle nicht wie ein Feature aussieht und die Aufmerksamkeit am Zweck der Migration hing, nicht an ihrem Nebenprodukt.

## Korrektur

- **Produktion geschlossen:** RLS an, `revoke all` für `anon` und `authenticated`. Nachher-Zustand verifiziert: RLS aktiv, null Policies, keine Browser-Grants.
- **Migrationsdatei nachgezogen**, damit ein Replay auf Staging oder ein Restore das Loch nicht neu aufreisst.
- **Gesamtscan Produktion:** keine weitere Tabelle in `public` ohne RLS, die für `anon`/`authenticated` erreichbar wäre.

## Der Guard

`scripts/verify-migration-table-hardening.mjs` prüft jede Migration in `supabase/migrations/`: jede dort angelegte Tabelle in `public` muss in derselben Datei RLS einschalten und den Browser-Zugriff regeln (Revoke für beide Rollen oder eine ausdrückliche Policy). Bewusste Ausnahmen sind möglich, müssen sich aber mit `-- HARDENING-AUSNAHME: <Begründung>` erklären.

Gegenprobe bestanden: entfernt man die Härtung aus der Gating-Migration wieder, meldet der Guard beide Verstösse.

Zwei Fehlalarme des Guards unterwegs gefangen und behoben — er kannte anfangs nur `revoke ... from anon` einzeln und nicht die Sammelform `from anon, authenticated` bzw. die Schreibweise `on table public.x`, und meldete dadurch acht bzw. eine Migration fälschlich als ungehärtet. Ein Wächter, der falsch Alarm schlägt, wird genauso ignoriert wie einer, der schweigt.

## Ein Befund am Rande, nicht von mir angefasst

`telephony_numbers` und `telephony_number_assignment_audit` tragen in Produktion weiterhin die Default-Grants für `anon`/`authenticated`. **Das ist kein offener Zugriff** — RLS ist an und es gibt keine einzige Policy, `anon` bekommt dort keine Zeile. Es fehlt nur der Gürtel zum Hosenträger. Die Migrationsdatei ist nachgezogen; das Nachziehen auf Produktion habe ich **nicht** im Vorbeigehen gemacht, weil beide Tabellen einem anderen Arbeitsstrang gehören. Ein `revoke all ... from anon, authenticated` auf beiden wäre der Abschluss — deine Entscheidung.
