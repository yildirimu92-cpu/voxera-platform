# Website-Neukonzeption voxera.ch — Rückmeldung Schritt 1–3

**Datum:** 10.08.2026 · **Status:** Zielbild besprochen, erste Entscheidungen getroffen.
**Es wurde nichts gebaut.**

Grundlage: `briefing-website-neukonzeption.md` und der Nachtrag
`briefing-website-seo-addendum.md`.

| Dokument | Inhalt | Status |
|---|---|---|
| [`ist-stand-2026-08-10/`](ist-stand-2026-08-10/) | **Archivkopie der alten Seite** — 8 Originaldateien | ✅ gesichert |
| [`01_IST_AUFNAHME_2026-08-10.md`](01_IST_AUFNAHME_2026-08-10.md) | Schritt 1 — Sicherung der Live-Seite | ✅ im Kern erledigt |
| [`02_CONTENT_AUDIT_2026-08-10.md`](02_CONTENT_AUDIT_2026-08-10.md) | Schritt 2 — **26 Befunde**, gegen Stack und Datenbank geprüft | vollständig bis auf die Dateiliste |
| [`03_ZIELBILD_2026-08-10.md`](03_ZIELBILD_2026-08-10.md) | Schritt 3 — Sitemap, SEO & Content-Struktur, Design, Stack | vollständig, Design entschieden |
| [`04_PRODUKTPUNKT_BRANCHENVORLAGE_DETAILHANDEL.md`](04_PRODUKTPUNKT_BRANCHENVORLAGE_DETAILHANDEL.md) | Produktarbeit, kein Website-Text — abgegrenzt vorgemerkt | vorgemerkt, nicht begonnen |

## 🔴 Vier Dinge, die nicht auf den Relaunch warten sollten

Die Live-Seite trägt Aussagen, die heute falsch sind — nicht erst nach dem Umbau:

1. **Drei namentliche Kundenstimmen mit Fünf-Sterne-Bewertung** und **„Über 20 Schweizer KMU
   vertrauen bereits auf Voxera"** — die Datenbank kennt 4 Kundendatensätze, **0 davon live**,
   und 19 Anrufe im gesamten System (C16/C17).
2. **Die Datenresidenz-Aussage widerspricht der eigenen Datenschutzerklärung.** Die FAQ sagt
   „ausschliesslich in der Schweiz", §6 der Datenschutzerklärung sagt korrekt, dass eine
   Übermittlung in die USA erfolgen kann. Vier Stellen tragen die falsche Fassung — eine
   davon steht in `offer-accept.html` **direkt über dem Signaturfeld** (C2).
3. **Die AGB bezeichnen sich selbst öffentlich als ungeprüfte Arbeitsversion** — und werden
   im Signaturprozess verbindlich akzeptiert. Dazu ein Versionskonflikt zwischen
   Zustimmungsstempel (1. Mai) und veröffentlichtem Stand (3. Juli) (C23).
4. **Der abgelaufene Aktionspreis** an vier Fundstellen (C1).

**Der einzige gute Teil an Punkt 2:** die richtige Formulierung existiert bereits — in der
eigenen Datenschutzerklärung. Es muss nichts erfunden werden, nur angeglichen.

## Entscheidungen vom 10.08.2026

- **Design: Option B — „Schweizer Werkbank."** Hell geführt, Night als Schrift- und
  Aktionsfarbe, Sand als einzige warme Fläche. Die daraus folgenden Bau-Vorgaben stehen in
  Zielbild, Abschnitt C.1.
- **Preise: mit den aktuellen Werten als Platzhalter weiterarbeiten.** Das Finale hängt an
  der laufenden Margen-Rechnung. Bedingung: der Platzhalter trägt **kein Ablaufdatum** —
  genau das ist der Fehler aus Befund C1.
- **`detailhandel-logistik`: zwei getrennte Vorlagen** (`detailhandel` + `logistik`) werden
  nachgebaut. Als eigener Produktpunkt abgegrenzt (Dokument 04). Die Branchenseite darf erst
  live gehen, wenn beide Vorlagen stehen.
- **✅ Baustart für das entscheidungsfreie Gerüst ist freigegeben** (10.08.2026) — Sitemap,
  Layout, alle Seitentypen, SEO-Technik und Ratgeber-Unterbau. Läuft parallel zum Hotfix an
  der Live-Seite. **Gesperrt bleiben:** `/preise/`, `/branchen/detailhandel-logistik/` und der
  finale Relaunch.
- **Datenresidenz: läuft in einem separaten, sofortigen Strang** — unabhängig vom Relaunch,
  weil die Aussage heute live steht. Die neue Seite erbt das Ergebnis, statt die Frage ein
  zweites Mal aufzumachen.

## Was noch aussteht

Quellen für 62 % / 3.4 h / CHF 4'500 / 72 % · getestete Telefonanbieter · Belastbarkeit der
24h- und 99 %-Zusagen · finale Preise · Löschfristen angleichen und Preflight (C24) · vier
Zusagen der Datenschutzerklärung bestätigen oder abschwächen (C25) · **vollständige
Dateiliste des Deploys** als letzter Rest von Schritt 1.

**Keiner dieser Punkte blockiert das Baugerüst.** Sie betreffen einzelne Textstellen und das
Go-Live.

## Was die Sicherung ergeben hat

Die Archivkopie hat elf zusätzliche Befunde gebracht — die vier oben plus sieben weitere:
kein Canonical und **kein Schema.org** auf der ganzen Seite (die sechsteilige FAQ bringt
deshalb heute nichts an Rich Results), doppelte URLs für jeden Rechtstext ohne Canonical,
`offer-accept.html` als bis dahin **undokumentierte Transaktionsseite**, veröffentlichte
Löschfristen, die nicht mit dem Code übereinstimmen und deren Automatik abgeschaltet ist,
sowie ein Impressum ohne UID trotz „exkl. MwSt.".

Zwei Befunde haben sich dabei **erledigt**: die Live-Seite bewirbt keine Kalenderfunktionen
(C10), und der AVV ist bewusst nicht öffentlich (C11) — beide Rechtstexte sagen übereinstimmend,
er werde beim Vertragsabschluss ausgehändigt.

Und zwei Dinge sind **besser als erwartet**: es gibt **kein Tracking** auf der Seite (keine
Messreihen, die verlorengehen, kein Cookie-Banner-Erbe), und die Datenschutzerklärung ist
inhaltlich sorgfältig gemacht — sie ist der Text, an dem sich das Marketing ausrichten sollte,
nicht umgekehrt.

## Ablage

Diese Dokumente liegen in `voxera-platform`, weil diese Session nur dort Schreibrechte hat.
`voxera-website` enthält bisher ausschliesslich eine `README.md`. Der Ordner ist bewusst
in sich geschlossen, damit er beim Baustart als Ganzes nach `voxera-website` umziehen kann —
mit Ausnahme von Dokument 04, das als Produktarbeit in `voxera-platform` bleibt.
