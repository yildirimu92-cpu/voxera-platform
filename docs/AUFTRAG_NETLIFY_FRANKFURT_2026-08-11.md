# Auftrag — Netlify-Functions von Ohio nach Frankfurt

**Datum:** 11.08.2026 · **Status:** vorbereitet, **nicht ausgeführt** · **Grundlage:**
`DATENRESIDENZ_DIAGNOSE_2026-08-11.md`, Abschnitt C.2 · **Entscheidung:** angenommen am 11.08.2026

Dieser Auftrag beschreibt eine Umstellung, die **in der Netlify-Konsole** stattfindet, nicht im
Code. Er ist bewusst so geschrieben, dass er ohne Rückfrage ausführbar ist — inklusive der Punkte,
an denen er **nicht** ausgeführt werden sollte.

---

## 1. Was umgestellt wird

**Die Ausführungsregion der Netlify-Functions**, von `us-east-2` (Ohio, USA) auf `eu-central-1`
(Frankfurt, EU).

Das ist die einzige Änderung. Nicht betroffen: Code, Umgebungsvariablen, Domains, DNS,
Webhook-Adressen, Supabase, Twilio, ElevenLabs, Make.

**Warum das der beste Hebel ist:** Durch die Functions läuft **jeder** Datenfluss des Systems —
der Post-Call-Webhook mit dem vollständigen Transkript, der Audio-Proxy, die Stammdatenpflege,
der Twilio-Router. Die Daten werden dort nicht gespeichert, aber verarbeitet. Es ist die einzige
Verlagerung im gesamten Stack, die **ohne Vertragsänderung und ohne Codeänderung** auskommt.

**Nebeneffekt, der zählt:** Die Datenbank steht in Zürich. Frankfurt ist von Zürich rund 300 km
entfernt, Ohio rund 7000 km. Jeder Supabase-Aufruf aus einer Function wird spürbar schneller.

---

## 2. Welche Projekte

| Projekt | Netlify-Site | Functions | Zeitgesteuerte Functions | Umstellen? |
|---|---|---|---|---|
| `customer-dashboard` | `voxera-dashboard` | 34 | 2 | ✅ **ja** |
| `admin-panel` | (Admin-Site) | 54 | 5 | ✅ **ja** |
| Marketing-Website `voxera.ch` | (Website-Site) | **0** | 0 | ❌ **nein** — rein statisch, es gibt keine Functions, deren Region man setzen könnte |

**Beide Projekte müssen einzeln umgestellt werden.** Die Region ist eine Eigenschaft der Site,
nicht des Kontos. Keine der beiden `netlify.toml` enthält heute eine Regionsangabe — beide laufen
auf dem Netlify-Default.

> ⚠️ **Wichtig zur Staging-Umgebung:** Laut `docs/STAGING_TESTUMGEBUNG.md` ist Staging ein
> **Branch-Deploy derselben Site** `voxera-dashboard`, keine eigene Site. Die Functions-Region gilt
> für die **gesamte Site** und damit für Produktion und Staging gemeinsam. **Ein isolierter
> Vorabtest auf Staging ist deshalb nicht möglich.** Das ist der Hauptgrund für das Zeitfenster
> in Abschnitt 5.

---

## 3. Ausführung

Pro Projekt:

1. Netlify → Projekt auswählen → **Project configuration**
2. → **Build & deploy** → **Continuous deployment** → Abschnitt **Functions region**
3. Aktuellen Wert **notieren** (Erwartung: `us-east-2`) — das ist der Rückfallwert
4. Auf **`eu-central-1` (Frankfurt)** umstellen, **Save**
5. **Redeploy auslösen** — die Einstellung greift erst mit dem nächsten Deploy.
   *Clear cache and deploy* verwenden, nicht nur „Retry deploy"

Danach Abschnitt 4 abarbeiten, **bevor** das zweite Projekt umgestellt wird. Erst
`customer-dashboard`, dann `admin-panel` — in dieser Reihenfolge, weil am Dashboard der
Anrufpfad hängt und ein Fehler dort sofort sichtbar wird.

### 3.1 Die Einstellung im Repository sichtbar machen

Die Region ist eine reine Konsoleneinstellung und im Repository unsichtbar. Genau diese Klasse von
Problem hat dieses Projekt schon einmal Zeit gekostet (siehe `ACTIVATION_ROUTING_AUDIT_2026-08-09.md`,
wo eine unsichtbare Regel eine sichtbare überstimmt hat).

**Deshalb gehört nach erfolgreicher Umstellung in beide `netlify.toml` ein Kommentar:**

```toml
# Functions-Region: eu-central-1 (Frankfurt), gesetzt in der Netlify-Konsole unter
# Build & deploy → Continuous deployment → Functions region. Bewusst EU und nicht
# US-Default: durch die Functions laufen Transkripte und Stammdaten.
# Siehe docs/AUFTRAG_NETLIFY_FRANKFURT_2026-08-11.md. Netlify-Default waere us-east-2.
```

Ob Netlify die Region inzwischen auch als `netlify.toml`-Schlüssel akzeptiert, ist **vor** der
Umstellung in der aktuellen Netlify-Dokumentation zu prüfen. Falls ja, ist der Schlüssel dem
Konsolen-Klick vorzuziehen — dann steht die Region versioniert im Repository statt nur in einer
Konsole. Der Kommentar oben entfällt in dem Fall zugunsten des echten Schlüssels.

---

## 4. Was nach dem Redeploy zu prüfen ist

### 4.1 Zuerst — der Anrufpfad (blockierend)

Der Twilio-Router liegt **auf dem Live-Anrufpfad**. Läuft er nicht, nimmt niemand mehr ab.

| # | Prüfung | Erwartung |
|---|---|---|
| 1 | **Testanruf auf die Voxera-Nummer** | Lara nimmt ab, Gespräch läuft normal |
| 2 | Netlify → *Logs → Functions* → `twilio-inbound-router` | Aufruf sichtbar, HTTP 200, TwiML mit `<Redirect>` |
| 3 | Nach dem Anruf: `elevenlabs-post-call` in den Logs | HTTP 200, Transkript geschrieben |
| 4 | Der Anruf erscheint im Dashboard mit Transkript und Zusammenfassung | vollständig |
| 5 | Audio-Player im Dashboard | spielt ab (Proxy auf ElevenLabs funktioniert) |

**Schlägt 1 oder 2 fehl: sofort zurückrollen** (Abschnitt 6). Nicht debuggen, während die
Nummer tot ist.

### 4.2 Dann — Laufzeit und Zeitsteuerung

| # | Prüfung | Erwartung / Warum |
|---|---|---|
| 6 | Dauer von `twilio-inbound-router` in den Logs, vorher/nachher vergleichen | ⚠️ **Kann langsamer werden.** Frankfurt → ElevenLabs-US und → Twilio-US ist weiter als Ohio → US. Der Router macht einen Twilio-Aufruf, bevor er antwortet. Solange die Antwortzeit klar unter Twilios Timeout bleibt, ist das unkritisch — aber es ist die einzige Stelle, an der die Verlagerung *schaden* kann |
| 7 | Dauer beliebiger Supabase-lesender Functions | sollte **schneller** werden (Frankfurt→Zürich statt Ohio→Zürich) |
| 8 | `fanout-sync-worker` (alle 5 Min.) | läuft durch. `admin-panel/netlify.toml` dokumentiert die ~26-Sekunden-Grenze von Netlify und dass ein Sync 4–7 ElevenLabs-Aufrufe kostet — diese Aufrufe gehen jetzt aus Frankfurt in die USA und werden **langsamer**. Batch-Grösse im Auge behalten |
| 9 | Alle 7 zeitgesteuerten Functions feuern im nächsten Zyklus | `cleanup-stale-calls` und `outbox-retry-worker` (5 Min.), dann über Nacht `enforce-data-retention` 03:17, `fanout-sync-planner` 03:40, `lifecycle-runner` 04:15, `daily-billing-runner` 06:00 |
| 10 | Am Folgetag: `enforce-data-retention` hat gelaufen und `ok: true, enabled: true` geloggt | Die Löschung ist seit 10.08. scharf — sie darf durch die Umstellung nicht ausfallen |

### 4.3 Dann — Zugangswege, die auf Herkunft prüfen

| # | Prüfung | Warum |
|---|---|---|
| 11 | Supabase → *Project Settings → Database → Network Restrictions* | Ist dort eine IP-Beschränkung gesetzt, ändern sich mit der Region die ausgehenden IPs und **alle** Functions verlieren die Datenbank. Vor der Umstellung prüfen, nicht danach |
| 12 | Etwaige IP-Allowlists bei Twilio, ElevenLabs, Make | dieselbe Logik |
| 13 | Umgebungsvariablen unverändert vorhanden | Env-Variablen sind Site-, nicht Region-Eigenschaft — sollte unberührt sein, ist aber billig zu bestätigen. `vx-runtime-config.js` wird beim Build erzeugt, also nach dem Redeploy neu |
| 14 | Login ins Dashboard und ins Admin-Panel | Ende-zu-Ende, deckt Auth und Runtime-Config mit ab |

> **Punkt 11 vorziehen.** Er ist der einzige, der die Umstellung von vornherein verhindern könnte,
> und er kostet 30 Sekunden. Wer ihn erst nachher prüft, hat im Zweifel ein totes System.

---

## 5. Zeitfenster

Weil Staging dieselbe Site ist (Abschnitt 2), gibt es keinen risikolosen Vorabtest. Daher:

- **Randzeit wählen** — abends oder am Wochenende, wenn ein verpasster Anruf am wenigsten kostet.
- **Nicht Montagmorgen**, nicht während Geschäftszeiten der Kunden.
- Der Rollback (Abschnitt 6) muss **in derselben Sitzung** durchführbar sein — also nicht
  umstellen und weggehen.
- Beim aktuellen Stand von **0 zahlenden Kunden im Livebetrieb** ist das Risiko so niedrig, wie es
  je sein wird. **Das spricht dafür, es jetzt zu machen und nicht später.**

---

## 6. Rollback

1. Netlify → Projekt → *Build & deploy* → *Functions region* → zurück auf den in Schritt 3
   notierten Wert (`us-east-2`)
2. **Redeploy** (*Clear cache and deploy*)
3. Testanruf wiederholen

Der Rollback ist vollständig und ohne Datenverlust — die Functions sind zustandslos, es wird nur
Rechenzeit verschoben. Es gibt nichts zu migrieren und nichts, das in der alten Region
zurückbliebe.

---

## 7. Was dieser Auftrag **nicht** erreicht

Damit die Wirkung nicht überschätzt wird:

- **Die Datenresidenz-Aussage der Website ändert sich dadurch nicht.** Audio und Transkript werden
  weiterhin bei ElevenLabs in den USA verarbeitet, die Vermittlung läuft weiterhin über Twilio
  `us1`. Der Text aus D.3 der Diagnose bleibt richtig, vorher wie nachher.
- **Was sich ändert, ist eine Zeile im Rechtsdokument:** In §5 der Datenschutzerklärung steht bei
  Web-Hosting heute „EU / USA". Nach dieser Umstellung ist **„EU"** korrekt. Das ist der einzige
  unmittelbar nach aussen sichtbare Effekt — und er gehört in denselben Arbeitsgang wie die
  übrigen §-Korrekturen aus F.1 und F.2 der Diagnose.
- Twilio und ElevenLabs bleiben unberührt (Entscheidungen 3 und 4, zurückgestellt).

---

## 8. Aufwandsschätzung

| Posten | Aufwand |
|---|---|
| Vorabprüfung Punkt 11 (Netzwerkbeschränkungen) | 5 Min. |
| Umstellung + Redeploy, beide Projekte | 20 Min. |
| Prüfliste 4.1–4.3 | 30 Min. |
| Beobachtung der Nacht-Jobs am Folgetag | 10 Min. |
| Kommentar in beide `netlify.toml` + Commit | 10 Min. |
| **Summe** | **rund 75 Minuten**, verteilt auf zwei Tage |
