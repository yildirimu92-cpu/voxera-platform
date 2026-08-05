## Zusammenfassung

Dieser Draft-PR stellt die verpflichtenden Customer-Launch-Checks auf der exakten Basis `main@b555e9896e8bbd66b86ce24ad20edb48f3d204d1` wieder her.

Der Source-Head ist `809839882ffc4dea9484ed8197b603bce9590a2a` und enthält genau einen Commit mit exakt zehn Source-Dateien.

## Source-Scope

1. `customer-dashboard/index.html`
2. `customer-dashboard/shared/customer-assistant-components.css`
3. `customer-dashboard/shared/customer-design-system.css`
4. `customer-dashboard/shared/customer-navigation-components.css`
5. `customer-dashboard/shared/customer-runtime-design-foundation.js`
6. `customer-dashboard/shared/customer-runtime-notifications-design.js` – gelöscht
7. `customer-dashboard/shared/offer-brand.js`
8. `scripts/verify-customer-design-foundation.mjs`
9. `scripts/verify-p0-security-foundation.mjs`
10. `scripts/verify-customer-navigation-unified.mjs`

Keine `.github`-Datei ist Teil des Zielbranch-Diffs.

## P0-Verifier als neunte Datei

- Die Retention-Prüfung wurde ausschließlich whitespace-tolerant gemacht.
- Die getrennten Fristen, die Texte `vollständige Transkripte` und `Archiveinträge` sowie das verpflichtende `strong`-Markup bleiben Teil des Vertrags.
- Der synchrone Bootstrap akzeptiert den unversionierten oder einen kanonisch numerisch versionierten Pfad.
- Die produktive Datei lädt weiterhin exakt `/shared/offer-brand.js?v=20260805-1`.
- Kein Security-Check wurde entfernt oder übersprungen.
- Keine Runtime-Sicherheitslogik wurde verändert.
- Die konkrete Release-Version `20260805-1` bleibt durch den Design-Foundation-Verifier abgesichert.

## Unified-Navigation-Verifier als zehnte Datei

- Der Loader-Vertrag erwartet `customer-runtime-design-foundation.js?v=20260805-1` und verbietet den alten Key `20260803-4`.
- `customer-assistant-components.css` wird als tatsächlicher Owner der drei Assistant-Selektoren eingelesen.
- `customer-navigation-components.css` muss diese drei Regeln ausdrücklich nicht mehr besitzen.
- Bestehende Root-Navigation-, Assistant-Switch-, Runtime-, Status-Detail- und `!important`-Guards blieben unverändert.

## Verifikation

Der vollständige GitHub-Actions-Checkout hat bestanden:

- exakter Zehn-Dateien-Scope;
- CSS-LineCounts `499 / 968 / 121`;
- Style-Tags `48 / 48`;
- Inline-JavaScript `33 / 33`;
- finale CSS-Newlines und Klammerstruktur;
- Cache-Kette `20260805-1`;
- Calendar-Runtime unverändert;
- Design Foundation PASS;
- Runtime Reachability PASS;
- P0 Security `53 / 53` PASS;
- Unified Navigation PASS;
- nicht-fail-fast Design-Recheck `292 / 292`, `0 FAIL`.

## Freigabegrenze

Die Browserprüfung auf den Netlify-Previews des exakten Source-Heads ist noch ausstehend:

- Desktop `1440×900`
- Mobile `390×844`
- Mobile `375×812`
- Mobile `320×568`

Der PR bleibt Draft. Kein Ready-for-review, Merge oder Production-Deploy wurde ausgeführt.
