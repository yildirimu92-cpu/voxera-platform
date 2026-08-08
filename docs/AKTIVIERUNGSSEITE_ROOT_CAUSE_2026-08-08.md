# `activate.html` — Root-Cause-Analyse und Fix

**Datum:** 2026-08-08 · **Schweregrad:** Blockiert jeden echten Pilotkunden
**Gefunden:** beiläufig beim Browser-Test zur Preview-Isolation (Option 3)

---

## 1. Beobachtetes Problem

`customer-dashboard/activate.html` — die Seite, auf der ein eingeladener Kunde sein Passwort
setzt und damit sein Konto aktiviert — hatte **keine funktionierende Logik**. Die Seite blieb
dauerhaft auf „Aktivierungslink wird geprüft…" stehen.

Ohne Fehlermeldung. Ohne Konsolen-Ausgabe. Ohne fehlgeschlagenen Request.

## 2. Reproduktionspfad

1. `customer-dashboard/` statisch ausliefern
2. `/activate.html#access_token=…&type=invite` öffnen
3. Erwartet: Passwort-Formular. Tatsächlich: „Aktivierungslink wird geprüft…", dauerhaft.

Im Browser gemessen (Chromium, Supabase-Bibliothek gestubbt): `sb` ist `undefined`,
`createClient` wird nie aufgerufen, `init` ist nicht definiert, **kein** `pageerror`.

## 3. Root Cause — bewiesen

Die Datei war **abgeschnitten**. Sie endete mitten in einem Kommentar:

```
// ── Start ───\xEF\xBF\xBD
```

`\xEF\xBF\xBD` ist U+FFFD (Replacement Character). Danach kam nichts mehr: kein `</script>`,
kein `</body>`, kein `</html>`.

Das Zeichen verrät den Mechanismus. Der Kommentar bestand aus `─` (U+2500), in UTF-8 drei
Bytes. Der Schnitt landete **innerhalb** einer solchen Drei-Byte-Sequenz; beim erneuten
Dekodieren wurde der Rest zu U+FFFD. Ein sauberer Schnitt an einer Zeilengrenze sieht anders
aus — das hier ist ein Byte-Limit, kein Zeilen-Limit.

Der HTML-Parser behandelt einen bei EOF noch offenen `<script>`-Block als Parse-Fehler und
**führt ihn nicht aus**. Deshalb lief kein einziges Zeichen der Aktivierungslogik — und
deshalb gab es auch keine Fehlermeldung: nicht ausgeführter Code wirft nicht.

### Wann es passierte

| Commit | Größe | `</html>` | |
| --- | --- | --- | --- |
| `05f8b3b0` „Refactor welcome-email flow" | 10 752 B | **ja** | letzte vollständige Fassung |
| `caec33a1` | — | — | Datei gelöscht |
| `70d8fc26` „Rename activate (2).html to activate.html" | 11 226 B | **nein** | **hier riss sie ab** |
| `cf859dc1` „Rename activate (3).html…" | 11 396 B | nein | Schaden vererbt |
| `41f2a1e3` „Rename activate (4).html…" | 12 034 B | nein | Schaden vererbt |
| … 15 weitere Commits … | | nein | alle bauten auf der kaputten Datei auf |

Die Commit-Namen benennen die Ursache selbst: die Datei wurde außerhalb des Repos bearbeitet
— heruntergeladen als `activate (2).html`, geändert, wieder hochgeladen. Auf diesem Weg ging
das Ende verloren. Danach hat niemand mehr das Ende angefasst, alle 20 Folge-Commits
bearbeiteten die Mitte.

Ein zweiter Beleg für denselben Weg: die Datei enthielt Cloudflare-Artefakte
(`__cf_email__`, `/cdn-cgi/scripts/…/email-decode.min.js`) — die entstehen nur, wenn man eine
über Cloudflare ausgelieferte Seite speichert. Siehe Abschnitt 5.

## 4. Fix

Nur der Schwanz fehlte. Belegt, nicht geraten: der aktuelle Inline-Block parst unverändert
als gültiges JavaScript (`node --check`), es fehlte also kein Code in der Mitte. Und die
vollständige Fassung `05f8b3b0` zeigt exakt, was am Ende stand:

```js
// ── Start ────────────────────────────────────────────────────────────────────
init();
</script>
</body>
</html>
```

`init()` war die ganze Zeit definiert (heute Zeile 193) — nur nie aufgerufen. Die heutige
Fassung ist gegenüber `05f8b3b0` weiterentwickelt (sie behandelt Implicit- **und**
PKCE-Flow), hängt aber nur an `SUCCESS_REDIRECT_DELAY` und den vier View-IDs; alle vorhanden.

Ergänzt wurde ein Guard `if (sb) init();`. Seit der Preview-Isolation kann `sb` null sein;
ohne Guard würde `init()` dort eine uncaught `TypeError` werfen.

### Verifikation im Browser (Chromium, Supabase gestubbt)

| Szenario | Ergebnis |
| --- | --- |
| Produktion, Hash mit Token (`type=invite`) | `setSession` aufgerufen → **Passwort-Formular** |
| Produktion, kein Hash (PKCE, keine Session) | `getSession` aufgerufen → „Link ungültig" |
| Preview ohne Zugangsdaten | kein Aufruf, Hinweis-Overlay, keine Fehler |

Vor dem Fix trat in keinem der drei Fälle irgendetwas davon ein.

## 5. Zweiter Defekt, gleiche Ursache

Die Support-Adresse auf der Fehlerseite war Cloudflare-verschleiert:

```html
<a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="ddaea8…">[email protected]</a>
```

Diese Verschleierung braucht einen Decoder unter `/cdn-cgi/scripts/…`, den Cloudflare
zur Laufzeit einspielt. Das Dashboard läuft auf **Netlify** — der Pfad ist dort ein 404 (im
Browser bestätigt: `REQFAIL /cdn-cgi/scripts/…/email-decode.min.js`).

Ein Kunde mit abgelaufenem Link las also wörtlich: *„Bitte kontaktieren Sie den Support unter
**[email protected]**"*.

Die Adresse ließ sich aus `data-cfemail` deterministisch zurückrechnen (erstes Byte ist der
Schlüssel, Rest XOR): **`support@voxera.ch`**. Sie ist jetzt als einfacher `mailto:`-Link
eingesetzt, der tote Decoder-Script-Tag entfernt.

> **Offen:** Ob `support@voxera.ch` ein aktives Postfach ist, wurde **nicht** verifiziert.
> Die Kommandozentrale führt „Support-Prozess für Pilotkunden" als ungeklärt. Die Adresse
> stammt aus der Datei selbst, nicht aus einer Annahme — sollte aber vor Pilotstart geprüft
> werden.

## 6. Schutz gegen Wiederholung

`scripts/verify-activation-page-integrity.mjs` (Workflow *Verify Activation Page Integrity*,
läuft auf PRs) prüft: schließende Tags vorhanden und Datei endet auf `</html>`; kein U+FFFD;
`<script>`-Tags paarig; `init()` definiert **und** aufgerufen; keine Cloudflare-Artefakte;
Inline-Block syntaktisch gültig; jede via `showView()` angesteuerte Ansicht existiert im
Markup.

Gegen die tatsächlich kaputte Fassung (`1118adf`) gegengeprüft: **9 von 11 Prüfungen schlagen
dort an.** Der Check hätte den Schaden bei `70d8fc26` sofort gemeldet.

## 7. Was offen bleibt

- **Nicht verifiziert: die live ausgelieferte Fassung.** `dashboard.voxera.ch` ist aus dieser
  Umgebung nicht erreichbar (Egress-Proxy blockt). Da Netlify aus genau diesem Repository
  deployt, ist die ausgelieferte Datei mit hoher Wahrscheinlichkeit dieselbe kaputte — bewiesen
  ist es nicht. **Nach dem Deploy einmal mit einem echten Einladungslink gegenprüfen.**
- **Indizienlage stützt den Befund:** alle vier Kunden in der Produktions-Datenbank stehen auf
  `invited` bzw. `onboarding`, keiner ist je über die Aktivierung hinausgekommen.
- **Geprüft und sauber:** alle sechs HTML-Dateien des Repos wurden auf dieselbe Fehlerklasse
  untersucht (endet auf `</html>`, `<script>`-Tags paarig, kein U+FFFD). `activate.html` war
  die einzige betroffene Datei; `admin-panel/index.html` (35 script-Paare),
  `admin-panel/login.html`, `admin-panel/offer-pdf.html`, `customer-dashboard/index.html` und
  `contract-signed.html` sind vollständig. `__cf_email__` und `/cdn-cgi/` kommen im übrigen
  Repo nicht vor.
