# Voxera Make-Szenarien

Die Blueprint-Dateien in diesem Verzeichnis sind versionierte, sanitierte Vorlagen. Produktive Secrets werden nicht im Repository gespeichert.

## Call Intake

`01-call-intake-audited-v4.1-secure-resolver.blueprint.json` behebt den fehlenden Resolver-Request-Body. Vor dem Import muss der Platzhalter `REPLACE_WITH_ROTATED_CALL_INTAKE_RESOLVER_SECRET` durch den aktuellen Netlify-Wert `CALL_INTAKE_RESOLVER_SECRET` ersetzt werden.

Das Szenario bleibt deaktiviert, bis ein echter Testanruf erfolgreich durchgelaufen ist.
