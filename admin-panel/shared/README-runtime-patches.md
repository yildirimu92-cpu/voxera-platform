# Admin runtime patches

Die drei Runtime-Module enthalten den aktuellen UI-Konsolidierungsbatch für PR #688:

- `admin-runtime-ui.js`: KPI-Design, Cockpit-Queues, Zusatzübersicht und kontrastabhängige Headerfarben.
- `admin-runtime-navigation.js`: kompakte Sales-Ansicht, einheitlicher Kunden-Workspace und Vertrags-/Rechnungsnavigation.
- `admin-runtime-sync.js`: belastbarer Assistenten-Sync-Status mit Kundenauswahl, Timeout und Retry.

Die Module werden über `offer-brand.js` als klassische Browser-Skripte geladen und durch `scripts/verify-admin-runtime-patches.mjs` syntaktisch in CI geprüft.
