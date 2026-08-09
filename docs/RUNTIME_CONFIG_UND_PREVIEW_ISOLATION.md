# Laufzeit-Konfiguration und Preview-Isolation

**Angelegt:** 2026-08-08 · **Bezug:** `STAGING_PRODUKTION_TRENNUNG_KONZEPT_2026-08-08.md`, Option 3

Umsetzung von Option 3: Deploy-Previews bekommen keine Produktions-Zugangsdaten mehr.
Sie zeigen weiterhin Oberfläche, Navigation und Design — alles, was Daten braucht, bleibt leer.

Das ist **kein Ersatz für Option 1** (eigenes Staging-Projekt). Es entfernt den heute
wahrscheinlichsten Unfallpfad und ist gleichzeitig Vorarbeit für Option 1: derselbe
Mechanismus zeigt später auf die Staging-Instanz statt auf nichts.

---

## Was sich geändert hat

Vorher standen `SUPABASE_URL` und `SUPABASE_ANON_KEY` fest in fünf HTML-Dateien. Es gab
keinen Schalter — jede Preview zeigte zwangsläufig auf Produktion.

Jetzt erzeugt der Netlify-Build pro Site eine Datei `vx-runtime-config.js` aus den
Umgebungsvariablen. Die HTML-Dateien lesen daraus.

```
Netlify Build
  └─ node tools/build-runtime-config.mjs
       └─ scripts/runtime-config.mjs
            └─ liest SUPABASE_URL / SUPABASE_ANON_KEY / CONTEXT / BRANCH
            └─ schreibt <site>/vx-runtime-config.js
                 └─ setzt window.__VX_RUNTIME_CONFIG__
                 └─ zeigt bei fehlenden Werten einen sichtbaren Hinweis
```

| Datei | Rolle |
| --- | --- |
| `scripts/runtime-config.mjs` | gesamte Logik, einzige Quelle |
| `customer-dashboard/tools/build-runtime-config.mjs` | Aufruf-Wrapper (Build-Schritt) |
| `admin-panel/tools/build-runtime-config.mjs` | Aufruf-Wrapper (Build-Schritt) |
| `<site>/vx-runtime-config.js` | **erzeugt.** Die eingecheckte Fassung ist ein Platzhalter ohne Zugangsdaten und wird vom Build überschrieben |
| `scripts/verify-runtime-config-isolation.mjs` | CI-Check gegen Rückfall |

Geändert wurden: `customer-dashboard/index.html`, `customer-dashboard/activate.html`,
`admin-panel/index.html`, `admin-panel/login.html`.

Aus `contract-signed.html` wurden zwei **unbenutzte** Konstanten entfernt. Die Seite lädt
ausschließlich über `/.netlify/functions/contract-public-get` und liegt außerhalb beider
Publish-Verzeichnisse — sie bekommt deshalb bewusst kein `vx-runtime-config.js`.

**Fehlende Zugangsdaten sind kein Build-Fehler.** Im Preview-Kontext sind sie der
gewünschte Zustand; ein Abbruch würde jede Preview rot färben.

---

## Noch zu tun: Netlify-Dashboard

Der Code allein trennt nichts. **Solange die Variablen für alle Kontexte gelten, bekommt
auch eine Preview sie weiterhin.** Erst dieser Schritt macht die Trennung wirksam.

Für **beide** Sites (Customer Dashboard, Admin Panel):

1. **Site configuration → Environment variables**
2. Für `SUPABASE_URL` und `SUPABASE_ANON_KEY` jeweils:
   *Options → Edit* → bei „Values" von *Same value for all deploy contexts* auf
   ***Different value for each deploy context*** wechseln.
3. Den Produktionswert **nur** unter *Production* eintragen.
   *Deploy previews* und *Branch deploys* **leer lassen** — nicht löschen, leer lassen.
4. Genauso mit den serverseitigen Variablen verfahren, denn die Netlify Functions haben
   keinen eigenen Umgebungs-Guard und laufen in Previews mit denselben Rechten:

   | Variable | warum |
   | --- | --- |
   | `SUPABASE_SERVICE_ROLE_KEY` | umgeht RLS vollständig — der wichtigste Einzelposten |
   | `ELEVENLABS_API_KEY` | legt Agents an und ändert sie |
   | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Nummernzuweisung, echte ausgehende Anrufe |
   | `MAKE_MAIL_WEBHOOK`, `MAKE_CASE_WEBHOOK`, `MAKE_WELCOME_WEBHOOK`, `MAKE_CALL_INTAKE_WEBHOOK` | löst echten E-Mail-Versand aus |
   | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | dito, direkter Versandweg |
   | `ANTHROPIC_API_KEY` | verursacht echte Kosten |
   | `CALENDAR_TOKEN_ENCRYPTION_KEY`, `CALENDAR_TOOL_WEBHOOK_SECRET` | Kalender-Integration |

5. Beide Sites neu deployen, damit der Build-Schritt greift.

**Nicht anfassen:** `URL`, `DEPLOY_PRIME_URL`, `DEPLOY_URL`, `CONTEXT`, `BRANCH` — die setzt
Netlify selbst.

### Die Make-Hooks: welcher Wert wohin gehört

Beide Sites benutzen gleichnamige Variablen mit **unterschiedlichen Werten pro Site**. Genau
daran ist das Admin-Benachrichtigungssystem gescheitert: auf der Dashboard-Site trug
`MAKE_MAIL_WEBHOOK` den Call-Intake-Hook, weil `elevenlabs-post-call.js` sie für
Gesprächsdaten mitbenutzte. Make quittiert solche Requests mit **HTTP 200** und legt sie in
die Queue eines abgeschalteten Szenarios — der Versand sieht von außen erfolgreich aus,
kommt aber nie an. Fünf Testanfragen und neun Anrufe landeten so spurlos in einer Queue,
während Code und Oberfläche Erfolg meldeten.

| Variable | Site | Make-Szenario | Hook-URL |
| --- | --- | --- | --- |
| `MAKE_MAIL_WEBHOOK` | Admin **und** Dashboard | 09. Voxera Central Mail Engine | `.../4hlkpn5t6i3m9wsvu5mbpqggygq4yc6s` |
| `MAKE_CALL_INTAKE_WEBHOOK` | nur Dashboard | 01. Call Intake | `.../i4fimhp5gp2lh72cifakob6w2pvryx7h` |

`MAKE_MAIL_WEBHOOK` und `MAKE_CALL_INTAKE_WEBHOOK` dürfen **niemals denselben Wert** tragen.
`_lib/mail-delivery.js` verweigert in diesem Fall den Versand, statt ihn ins Leere laufen zu
lassen, und `scripts/verify-mail-engine-contracts.mjs` verhindert, dass wieder eine Funktion
außerhalb der Versand-Bibliothek `MAKE_MAIL_WEBHOOK` direkt liest.

Nach dem Eintragen prüfen: eine KI-Änderungsanfrage im Kundenportal auslösen und in Make
unter *09. Voxera Central Mail Engine → History* nachsehen, ob eine Execution erscheint.
Bleibt die Liste leer, zeigt die Variable weiterhin auf den falschen Hook.

### Danach prüfen

| | Erwartung |
| --- | --- |
| Produktion (`voxera.ch`, Admin) | unverändert; kein Hinweis |
| Beliebige Deploy-Preview | Hinweiskarte „Vorschau ohne Datenverbindung" unten links, schliessbar; Oberfläche, Navigation und Tab-Leiste bleiben bedienbar |
| Preview, DevTools-Konsole | `[vx-runtime-config] Keine Supabase-Zugangsdaten fuer diesen Kontext.` |
| Preview, `window.__VX_RUNTIME_CONFIG__` | `{ configured: false, supabaseUrl: null, … }` |

> **Korrektur 09.08.** Bis heute war der Hinweis ein deckendes Vollbild
> (`position:fixed; inset:0; background:#0d1b2a`, kein Schliessen) — die
> Oberfläche dahinter war *nicht* sichtbar, obwohl dieser Abschnitt und der
> Hinweistext selbst das versprachen. Aufgelöst zugunsten des Textes: Previews
> ohne Zugangsdaten haben genau einen verbliebenen Zweck, nämlich Layout und
> Design zu beurteilen, und ein Blocker macht ihn unmöglich.
> `scripts/verify-runtime-config-isolation.mjs` prüft seither am erzeugten File,
> dass das Vollbild nicht zurückkommt (Abschnitt 6 dort), inklusive
> Schliessen-Knopf und Abstand über der mobilen Tab-Leiste.

---

## Was das kostet

Funktionale Tests in Previews entfallen. Wer Billing-Läufe, Call-Intake oder
Vertragsabschlüsse testen will, hat bis zur Umsetzung von Option 1 nur Produktion.

**Konsequenz für den geplanten End-to-End-Test:** Er sollte **nach** Option 1 laufen. Sonst
wird er erneut gegen Produktion gefahren und erzeugt genau die Datenlage, die anschließend
getrennt werden müsste.

---

## Verifikation

`scripts/verify-runtime-config-isolation.mjs` (CI: *Verify Runtime Config Isolation*, läuft
auf PRs, reiner Datei-Check ohne DB-Verbindung) prüft:

1. keine Supabase-URL und kein Supabase-JWT in den fünf HTML-Dateien;
2. jede Anwendungsdatei lädt `/vx-runtime-config.js` **vor** der ersten Verwendung;
3. jede Anwendungsdatei prüft die Werte, bevor `createClient` läuft;
4. die eingecheckten `vx-runtime-config.js` tragen `configured:false` und keine Werte;
5. beide `netlify.toml` rufen den Build-Schritt auf;
6. der Generator liefert in beiden Zuständen gültiges JavaScript;
7. der Build-Schritt läuft ohne gesetzte Variablen durch und erzeugt exakt den
   eingecheckten Platzhalter.

Der Check wurde gegen drei absichtlich eingebaute Defekte gegengeprüft (hartkodierte URL,
fehlendes Script-Tag, Platzhalter mit echtem Wert) und hat alle drei gemeldet.

Zusätzlich in einem echten Chromium gemessen (beide Zustände, alle vier Seiten): ohne
Zugangsdaten wird **kein** `createClient` aufgerufen und das Overlay erscheint; mit
Zugangsdaten wird der Client mit der korrekten URL gebaut und es erscheint kein Overlay.

**Nicht verifiziert:** das Verhalten auf einer echten Netlify-Deploy-Preview. Dafür braucht
es einen Deploy nach Schritt 2–5 oben.

---

## Nebenbefund — `customer-dashboard/activate.html` ist abgeschnitten

Beim Browser-Test aufgefallen, **nicht durch diese Änderung verursacht und hier bewusst
nicht behoben.** Eigener Root-Cause-Fall.

**Fakt:** Die Datei endet mitten in einem Kommentar:

```
// ── Start ───\xEF\xBF\xBD
```

`\xEF\xBF\xBD` ist U+FFFD (Replacement Character) — ein Zeichen, das beim Speichern mit
falscher Zeichenkodierung entsteht. Danach kommt nichts mehr: **kein `</script>`, kein
`</body>`, kein `</html>`.

**Fakt:** Das gilt seit dem ersten Commit, der die Datei berührt (`c065c21`); Größe und
Dateiende sind seither unverändert. Die Datei war in diesem Repo nie vollständig.

**Fakt (im Browser gemessen):** Weil der `<script>`-Block bei Zeile 137 nie geschlossen
wird, führt der HTML-Parser ihn nicht aus. Gemessen mit gültiger Konfiguration und einer
gestubbten Supabase-Bibliothek: `sb` ist `undefined`, `createClient` wird nie aufgerufen,
und es wird kein Fehler geworfen — die Seite scheitert vollkommen lautlos.

**Konsequenz:** Die Aktivierungsseite — auf der ein eingeladener Kunde sein Passwort setzt —
hat keine funktionierende Logik. Das passt zum Datenbestand: alle vier Kunden stehen auf
`invited` bzw. `onboarding`, keiner ist über die Aktivierung hinausgekommen.

**Warum hier nicht behoben:** Es fehlt Code, kein Zeichen ist falsch. Was hinter
`// ── Start ───` stand, steht in keiner Version dieses Repos. Eine Rekonstruktion wäre
geraten, nicht hergeleitet — und würde gegen die Audit-first-Regel aus `AGENTS.md`
verstoßen. Braucht einen eigenen Durchgang mit Blick auf die tatsächlich deployte Fassung.

Die Umstellung auf die Laufzeit-Konfiguration wurde in dieser Datei trotzdem mitgemacht:
die hartkodierten Zugangsdaten standen real im Quelltext, und sobald die Datei repariert
ist, greift die Trennung dort sofort mit.
