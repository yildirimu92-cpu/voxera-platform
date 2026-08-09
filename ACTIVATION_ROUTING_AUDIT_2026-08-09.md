# Audit: Wohin führt der Aktivierungslink wirklich? (09.08.2026)

Auftrag: Briefing "customer-dashboard/activate.html reparieren". Punkte 1–3
(Quellensuche, Reparatur) waren beim Start dieses Fensters bereits erledigt und
gemergt. Dieses Audit deckt Punkt 4 (Live-Test) und Punkt 5 (die vier
Testkunden) ab — und korrigiert dabei die zentrale Annahme des Briefings.

Alle Aussagen sind als **Fakt**, **Wahrscheinlich** oder **Unverifiziert**
gekennzeichnet (AGENTS.md, No-Assumption-Regel).

---

## 1. Kurzfassung

**Die Aktivierungsseite war kaputt — aber sie war nicht der Weg, den Kunden
gehen.** Der Aktivierungslink aus der Willkommensmail zeigt per Default auf die
Dashboard-Wurzel, nicht auf `/activate`. Dort nimmt `index.html` den
Recovery-Token mit einem eigenen, vollständig funktionierenden Passwortformular
entgegen. Genau das ist am 07.08. nachweislich passiert, während `activate.html`
keine einzige Zeile ausführen konnte.

Daraus folgt:

- Die Einschätzung "launch-kritisch, kein Pilotkunde könnte aktivieren" ist
  **nicht haltbar** (Beleg unten). Der Reparaturbedarf war real, die
  Dringlichkeitseinstufung nicht.
- `activate.html` ist heute **wahrscheinlich toter Code in Produktion**.
- Es existieren **zwei parallele Implementierungen derselben Aktion**
  (Passwort nach Einladung setzen). Das ist der eigentliche strukturelle Fund
  und verstösst gegen AGENTS.md ("multiple handlers for the same action").

---

## 2. Belegte Beobachtung: die Aktivierung lief am 07.08. woanders

**Fakt.** Auszug aus `auth.audit_log_entries` (Produktionsprojekt
`ulcofbgrovgcvowdjrge`), Kunde E2E Test AG / `yildirim.u92@gmail.com`:

| Zeit (UTC) | Aktion | Bedeutung |
|---|---|---|
| 07.08. 08:06:05.42 | `user_signedup` (actor `service_role`) | `admin.createUser()` aus `send-customer-access.js`, **ohne Passwort** |
| 07.08. 08:06:05.97 | `user_recovery_requested` | `admin.generateLink({type:'recovery'})` |
| 07.08. 08:06:38.68 | `login` (ohne `traits.provider`) | Recovery-Token wird eingelöst, Link wurde geklickt |
| 07.08. 08:06:47.76 | `user_updated_password` + `user_modified` | **Passwort gesetzt, 9 Sekunden nach dem Klick** |
| 07.08. 08:07:20.73 | `login` (`provider: email`) | Anmeldung mit dem neuen Passwort |
| 07.08. 08:08:56.79 | `login` (`provider: email`) | zweite Anmeldung |

**Fakt.** Zum selben Zeitpunkt war `activate.html` abgeschnitten. Der damals
ausgelieferte Stand (`3f06cd5`, 13'077 Bytes) endet auf:

```
// ── Start ───\357\277\275\n
```

Kein `</script>`, kein `</body>`, kein `</html>`. Ein bei EOF offener
`script`-Block wird vom HTML-Parser nicht ausgeführt.

**Schlussfolgerung (Fakt, per Ausschluss):** Innerhalb von 9 Sekunden nach dem
Klick wurde ein Passwort gesetzt. Auf einer Seite, die keine Zeile JavaScript
ausführt, ist das unmöglich. Die Landeseite war also eine andere.

**Fakt.** Es gibt genau eine andere Stelle im Code, die das kann:
`customer-dashboard/index.html`.

- `index.html:29254` → `handleRecoveryHash()` (Implicit Flow, `#access_token…&type=recovery`)
- `index.html:29261` → `handleRecoveryCode()` (PKCE, `?code=…`)
- beide → `showPasswordResetForm()` → `doReset()` → `sb.auth.updateUser({password})`

Beide Flow-Varianten sind abgedeckt, der Pfad ist vollständig und funktioniert.

---

## 3. Warum der Link dort landet

**Fakt.** `admin-panel/netlify/functions/send-customer-access.js:752`:

```js
const activateUrl = process.env.ACTIVATE_URL || 'https://dashboard.voxera.ch';
…
generateLink({ type: 'recovery', email, options: { redirectTo: activateUrl } })
```

Derselbe Default in `outbox-retry-worker.js:134`.

**Fakt.** Der Fallback zeigt auf die Dashboard-Wurzel, nicht auf `/activate`.

**Wahrscheinlich.** `ACTIVATE_URL` ist in Netlify nicht gesetzt. Belege: das
Verhalten vom 07.08. passt exakt zum Fallback, und das Risiko steht seit dem
07.04. unbearbeitet in `LAUNCH_READINESS_ANALYSE_2026-04-07.md:58`
("`ACTIVATE_URL` Default auf `https://dashboard.voxera.ch` kann
Aktivierungsroute verfehlen").

**Unverifiziert.** Der tatsächliche Wert der Netlify-Umgebungsvariable. Diese
Session hat keinen Netlify-Zugang; der Egress-Proxy blockiert ausserdem
`*.supabase.co` und `cdn.jsdelivr.net` (403), sodass der Mailweg von hier aus
nicht nachgestellt werden kann. **Das muss der User im Netlify-UI nachsehen.**

### Zweite Stolperstelle auf demselben Weg

**Wahrscheinlich.** Selbst wenn `ACTIVATE_URL=https://dashboard.voxera.ch/activate`
gesetzt würde, greift der Pfad `/activate` möglicherweise nicht:

- `customer-dashboard/netlify.toml` enthält `[[redirects]] from = "/*" to = "/index.html" status = 200`
- `customer-dashboard/_redirects` enthält `/activate  /activate.html  200`

Netlify wertet Regeln aus `netlify.toml` **vor** denen aus `_redirects` aus. Die
Catch-all-Regel würde `/activate` damit abfangen, bevor die spezifische Regel
zum Zug kommt. `/activate.html` (mit Endung) ist davon nicht betroffen, weil
existierende Dateien einer nicht erzwungenen `200`-Regel vorgehen.

**Unverifiziert**, weil nicht live getestet. Falls die Entscheidung auf
"über `activate.html` aktivieren" fällt, ist das vor dem Ausrollen zu prüfen —
sonst ersetzt man einen stillen Fehlweg durch den nächsten.

---

## 4. Punkt 4: Live-Test der reparierten Seite

**Was nicht ging.** Ein vollständiger Live-Test (Einladung auslösen → Mail
empfangen → Link klicken) ist aus dieser Session nicht durchführbar: kein
Zugriff auf das Postfach, und der Egress-Proxy blockiert `*.supabase.co` mit
403. Organisationsrichtlinie — bewusst nicht umgangen.

**Was geprüft wurde.** `activate.html` wurde unverändert in einem echten
Chromium ausgeführt, mit der **echten** `supabase-js`-Bibliothek. Ersetzt wurde
nur der Supabase-Server durch einen GoTrue-Stub, der die Aufrufe protokolliert.
21 Prüfungen, alle bestanden:

- Skriptblock läuft, `sb` wird gebaut (das war der eigentliche Schaden)
- Recovery-Hash → `setSession` → Passwortformular erscheint, Hash wird bereinigt
- Echtzeit-Bestätigung meldet Abweichung und Übereinstimmung korrekt
- Zu kurzes Passwort wird abgelehnt, **ohne** Serveraufruf
- Reihenfolge belegt: `PUT /auth/v1/user` → `POST /auth/v1/logout` → `POST /auth/v1/token?grant_type=password`
- Neu-Login geht mit dem neu gesetzten Passwort raus
- **Session landet in `sessionStorage` unter `voxera-auth`** — genau das, was
  `b9c071a` reparierte
- **kein** `sb-…-auth-token` in `localStorage` (der alte Fehlerzustand)
- `voxera_just_activated`-Merker gesetzt, Weiterleitung ausgelöst
- Ohne Token: Fehleransicht, Supportadresse `mailto:info@voxera.ch`

**Bewertung:** Die Logik der reparierten Seite ist verifiziert. **Nicht**
verifiziert ist das Einlösen eines echten Supabase-Tokens — dafür braucht es
einen Durchlauf auf einer Umgebung mit Netzzugang.

Das Testskript liegt ausserhalb des Repos (`activate-flow.test.mjs`, benötigt
Playwright, das hier weder Projekt- noch CI-Abhängigkeit ist). Bewusst nicht
eingecheckt, um keine neue CI-Abhängigkeit ohne Entscheidung einzuführen.

**Fakt.** Der statische Wächter `scripts/verify-activation-page-integrity.mjs`
läuft grün (13 Prüfungen) und ist über
`.github/workflows/verify-activation-page-integrity.yml` in CI verdrahtet. Die
Fehlerklasse "Datei abgeschnitten" kann nicht unbemerkt zurückkommen.

---

## 5. Punkt 5: Müssen die vier Testkunden nachaktiviert werden?

**Nein — und die Ausgangsbeschreibung trifft nicht zu.** Stand Produktion:

| Kunde | `status` | `invite_status` | Auth-Konto | Passwort | letzter Login |
|---|---|---|---|---|---|
| E2E Test AG | `invited` | `sent` | ja | ja | 09.08. 11:15 |
| E2E 2 Test AG | `onboarding` | `not_sent` | **nein** | – | – |
| E2E 3 Test AG | `onboarding` | `not_sent` | **nein** | – | – |
| E2E 4 Test AG | `onboarding` | `not_sent` | **nein** | – | – |

**Fakt.** Nur **einer** der vier wurde je eingeladen. Die anderen drei haben
kein Auth-Konto — sie sind nicht an der Aktivierung gescheitert, sie wurden nie
eingeladen. Für sie ist nichts zu reparieren; sie brauchen eine Einladung
("Zugang senden" im Admin-Portal).

**Fakt.** Der eine eingeladene Kunde hat ein funktionierendes Passwort und
meldet sich laufend an (zuletzt heute).

**Fakt.** `status` bleibt trotzdem auf `invited`, weil nichts im Kundenpfad
diesen Wert fortschreibt. Der Übergang auf `activated` ist eine ausdrückliche
Admin-Aktion (`send-customer-access.js`, `action: 'mark_activated'`;
`admin-panel/index.html:12928`). Weder `activate.html` noch `index.html`
schreiben je in `customers.status`.

**Fakt.** `invited` **und** `onboarding` stehen beide in
`ENTITLED_CUSTOMER_STATUSES`
(`customer-dashboard/netlify/functions/_lib/customer-entitlement.js:3`). Der
Kundenstatus hat also nie den Dashboard-Zugriff blockiert.

**Konsequenz für die Diagnose:** `status = 'invited'` ist **kein** Beleg dafür,
dass eine Aktivierung fehlgeschlagen ist. Die Aussage "alle vier stehen auf
invited/onboarding, keiner hat je aktiviert" hat aus diesem Feld einen Schluss
gezogen, den es nicht trägt.

---

## 6. Entscheidung: Option A (vom User freigegeben, 09.08.)

Zwei Implementierungen derselben Aktion nebeneinander sind der Zustand, den
AGENTS.md ausschliesst. Eine muss weg. Das ist eine Produktentscheidung, keine
technische — deshalb hier nur der Vorschlag, keine Umsetzung:

**Option A — `activate.html` wird der Weg.**
`ACTIVATE_URL` in Netlify auf die Aktivierungsseite setzen, vorher die
Redirect-Reihenfolge aus Abschnitt 3 klären (voraussichtlich `/activate.html`
statt `/activate`, oder die Catch-all-Regel in `netlify.toml` anpassen).
Danach das Recovery-Formular in `index.html` auf den reinen
Passwort-vergessen-Fall zurückschneiden.
*Dafür:* eigene, auf den Einladungsfall zugeschnittene Seite; erklärender Text,
Erfolgszustand, Weiterleitung.
*Dagegen:* verschiebt den scharfen Pfad auf Code, der noch nie echten
Produktionsverkehr gesehen hat.

**Option B — `index.html` bleibt der Weg.**
`activate.html` samt Wächter und Workflow entfernen, Default in
`send-customer-access.js` als bewusst dokumentieren.
*Dafür:* der Pfad läuft nachweislich seit Monaten in Produktion.
*Dagegen:* der Einladungsfall bekommt weiter das Formular "Neues Passwort",
das für "Passwort vergessen" formuliert ist.

**Empfehlung: Option A**, aber erst nach einem echten Durchlauf auf Staging
(Projekt `hzqiyyqfchvfcmmbemvd`) — nicht direkt auf Produktion umstellen.

Unabhängig von der Wahl: Der stille Fallback in `send-customer-access.js:752`
sollte verschwinden. Eine fehlende `ACTIVATE_URL` sollte laut scheitern statt
den Kunden auf eine andere Seite zu schicken, als der Name der Variable
verspricht.

---

## 7. Risiken und Unverifiziertes

- **Unverifiziert und wichtigster Restposten:** Wert von `ACTIVATE_URL` in
  Netlify. Ein dort verbliebener Wurzelwert überstimmt den neuen Default
  weiterhin — dann ändert die Umsetzung aus Abschnitt 8 nichts am Fehlweg. Die
  neue Warnung im Log macht es sichtbar, verhindert es aber nicht.
- **Unverifiziert:** dass die neue `/activate`-Regel live greift. Die
  Reihenfolgeannahme (`netlify.toml` vor `_redirects`, erste passende Regel
  gewinnt) ist dokumentiertes Netlify-Verhalten, hier aber nicht live getestet.
- **Unverifiziert:** Einlösen eines echten Supabase-Recovery-Tokens durch
  `activate.html`. Der Browser-Durchlauf deckt die Logik ab, nicht den Server.
- **Nebenfund, nicht verfolgt (Briefing: dokumentieren, nicht mitfixen):**
  Zur Willkommensmail vom 07.08. 08:06 gibt es **keine** passende Ausführung im
  Make-Szenario "09. Voxera Central Mail Engine" (letzte davor 06.08. 22:46,
  nächste danach 07.08. 11:29 — beides Editiervorgänge). `welcome_sent_at`
  wurde trotzdem gesetzt. Ob die Mail über einen anderen Weg ging oder gar
  nicht ankam, ist offen und gehört in einen eigenen Auftrag.
- **Nicht angefasst:** Optik der Aktivierungsseite, andere Screens mit
  möglichen Kodierungsproblemen (Briefing, Abschnitt "Nicht Teil dieses
  Auftrags").

---

## 8. Umsetzung von Option A

Nach der Freigabe umgesetzt. Vier Änderungen, alle am *Weg zur Seite* —
`activate.html` selbst wurde nicht angefasst.

**1. Ein Ziel statt zwei Fallbacks.**
Neu: `admin-panel/netlify/functions/_lib/activation-url.js`. Beide Aufrufer
(`send-customer-access.js`, `outbox-retry-worker.js`) hatten je einen eigenen
Fallback, beide zeigten an der Aktivierungsseite vorbei. Jetzt entscheidet eine
Stelle.

Der Default wird aus `DASHBOARD_URL` + `/activate` gebildet und ist damit von
sich aus richtig — er hängt nicht daran, dass jemand in Netlify eine zweite
Variable pflegt. `ACTIVATE_URL` bleibt als ausdrücklicher Vorrang bestehen
(Staging). Zeigt der aufgelöste Wert nicht auf die Aktivierungsseite, wird das
pro Versand als `level: warn` protokolliert statt still hingenommen.

| Umgebung | Ziel | zeigt auf die Seite |
|---|---|---|
| nichts gesetzt | `https://dashboard.voxera.ch/activate` | ja |
| nur `DASHBOARD_URL` | `<DASHBOARD_URL>/activate` | ja |
| `ACTIVATE_URL` korrekt | wie gesetzt | ja |
| `ACTIVATE_URL` = alter Wurzelwert | `https://dashboard.voxera.ch` | **nein → Warnung** |

**2. Passwort-vergessen bleibt getrennt.**
Der Reset-Weg zeigt weiter auf die Dashboard-Wurzel, wo das Recovery-Formular
in `index.html` hingehört. Die beiden Fälle trennen sich damit am Link, nicht
durch Verzweigungen in der Seite — deshalb war an `index.html` nichts zu
ändern. Nebenbei behoben: `outbox-retry-worker.js` gab beiden Mailtypen
dasselbe Ziel; ein gesetztes `ACTIVATE_URL` hätte auch nachgereichte
Reset-Mails auf die Aktivierungsseite geschickt.

**3. Routing entdoppelt.**
`customer-dashboard/netlify.toml` bekommt eine `/activate` → `/activate.html`
Regel **vor** der Catch-all-Regel. `customer-dashboard/_redirects` ist entfernt:
seine beiden Regeln stehen jetzt vollständig in `netlify.toml`, und da Netlify
diese Datei zuerst auswertet, kam `_redirects` ohnehin nie zum Zug — es täuschte
eine Regel vor, die nicht griff. Genau diese Doppelquelle hat den Fehlweg
verdeckt.

**4. Der Wächter deckt jetzt auch den Weg ab.**
`scripts/verify-activation-page-integrity.mjs` prüft zusätzlich: das Default-Ziel
zeigt auf die Aktivierungsseite, beide Aufrufer nutzen den gemeinsamen Resolver
(kein eigenes `process.env.ACTIVATE_URL` mehr), die `/activate`-Regel steht vor
der Catch-all-Regel, und `_redirects` ist nicht wieder da. **18 Prüfungen, alle
grün.** Die Trigger-Pfade des Workflows sind auf alle geprüften Dateien
erweitert.

**5. Nachtrag: Weiterleitung zurück auf relativ.**
Beim Abgleich mit der Originalfassung `05f8b3b0` (siehe Abschnitt 9) fiel eine
Abweichung auf, die bei der Wiederherstellung entstanden war: das Original
leitete nach Erfolg relativ auf `/index.html` weiter, die wiederhergestellte
Fassung auf die feste Adresse `https://dashboard.voxera.ch`. Auf Produktion
folgenlos, auf Staging und in Deploy-Previews nicht — wer dort aktiviert, wäre
auf der Produktionsumgebung gelandet. Damit hätte ausgerechnet der empfohlene
Staging-Durchlauf auf der falschen Umgebung geendet.

Beide Stellen (Weiterleitung und der "hier"-Link im Erfolgstext) sind zurück auf
den relativen Pfad. Der Wächter prüft jetzt zusätzlich, dass in `activate.html`
überhaupt keine feste `voxera.ch`-Adresse steht (**19 Prüfungen**), und der
Browser-Durchlauf belegt, dass die Weiterleitung auf demselben Ursprung bleibt
(**22 Prüfungen**).

### Was der User noch tun muss

- **`ACTIVATE_URL` in Netlify nachsehen.** Steht dort noch der alte Wurzelwert
  `https://dashboard.voxera.ch`, überstimmt er den neuen Default und der Fehlweg
  bleibt bestehen. Entweder löschen (dann greift der Default) oder auf
  `https://dashboard.voxera.ch/activate` setzen.
- **Auf Staging durchspielen**, bevor das auf Produktion geht: echte Einladung
  auslösen, Mail klicken, Passwort setzen, Login prüfen. Das ist der Teil, den
  weder der Wächter noch der Browser-Durchlauf ersetzen können.

---

## 9. Nachtrag: die Quelle existiert doch (Herkunft des Fixes)

Das Briefing hielt fest, der fehlende Code existiere "in **keiner** Version
dieses Repos", und leitete daraus ab, jede Reparatur wäre eine Rekonstruktion
und müsste zur Freigabe vorgelegt werden. Diese Annahme ist **widerlegt**.

**Fakt.** Die lokale Historie zeigt 14 Fassungen von `activate.html`, alle
abgeschnitten (12'585 bzw. 13'076 Bytes, Ende jeweils `// ── Start ───` +
U+FFFD). Das sieht nach "keine vollständige Fassung" aus — ist aber ein
Artefakt: **der Klon ist shallow**, die lokale Historie beginnt am 02.08.2026.
Zusätzlich wurde die Datei umbenannt, `--follow` half deshalb ebenfalls nicht.

**Fakt.** Über die GitHub-API sind beide vom Fix zitierten Commits vorhanden:

- `05f8b3b0f4c0d6c112c1bbdb6a33688ec535dd27` (03.04.2026, `copilot-swe-agent`,
  "Refactor welcome-email flow: activation link statt Passwort") legt
  `customer-dashboard/activate.html` mit 255 Zeilen an — **vollständig**.
- `70d8fc26e2cca446d2959dc1d377937797e2b4cf` (07.04.2026, Weboberfläche),
  "Rename activate (2).html to activate.html", 1 Zeile geändert — hier riss sie
  ab.

**Fakt.** Die Originalfassung endet auf:

```
// ── Start ──────────────────────────────────────────
init();
</script>
</body>
</html>
```

Exakt der fehlende Teil. Der Fix `f9b7c9f` war damit **hergeleitet, nicht
geraten** — die Audit-first-Regel wurde eingehalten, auch wenn das aus der
lokalen Historie allein nicht nachvollziehbar war.

**Lehre für künftige Quellensuchen in diesem Repo:** `git log` im Arbeitsklon
beantwortet die Frage "gab es je eine funktionierende Fassung?" **nicht**. Der
Klon ist shallow und Umbenennungen brechen die Pfadverfolgung. Erst die
GitHub-API gibt die vollständige Antwort.

**Nebenbefund aus dem Abgleich, bereits behoben (Abschnitt 8.5):** die
Weiterleitung war bei der Wiederherstellung von relativ auf die feste
Produktionsadresse gewechselt.
