# Voxera Make-Szenarien

Produktive Make-Secrets und exportierte Szenarien mit Verbindungs-IDs werden nicht im Repository gespeichert.

## Call Intake – Secure Resolver

Das Szenario `01 Call Intake Audited v4 Secure Resolver` muss im HTTP-Modul 2 einen JSON-Body an `call-intake-resolve-customer` senden:

```json
{
  "called_number": "{{ifempty(1.called_number; 1.voxera_number)}}"
}
```

Erforderliche Einstellungen:

- Methode: `POST`
- Body content type: `application/json`
- Body input method: `JSON string`
- Header: `X-Call-Intake-Secret` mit dem Netlify-Wert `CALL_INTAKE_RESOLVER_SECRET`
- keine fest eingetragene Telefonnummer

Der bisher exportierte Secret-Wert gilt als offengelegt und muss rotiert werden. Das Szenario bleibt deaktiviert, bis ein echter Anruf an eine Voxera-Nummer erfolgreich `resolved: true` liefert.
