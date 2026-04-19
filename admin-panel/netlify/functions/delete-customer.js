/**
 * delete-customer.js
 *
 * ⛔ DEPRECATED – DIESER ENDPUNKT IST DEAKTIVIERT.
 *
 * Dieser Endpunkt wurde durch customer-delete-permanently.js ersetzt,
 * welcher über admin-mutate.js (action: "customers.delete") aufgerufen
 * werden soll.
 *
 * Gründe für Deprecation:
 *   1. Fehlender Role-Check (kein owner-only Constraint)
 *   2. Unvollständige Delete-Sequenz (cases, onboarding fehlten)
 *   3. Inkonsistente Governance gegenüber customer-delete-permanently.js
 *
 * Empfohlener Ersatz:
 *   POST /.netlify/functions/admin-mutate
 *   Body: { "action": "customers.delete", "customer_id": "<id>" }
 *   Voraussetzung: Caller muss Admin mit Rolle "owner" sein.
 *
 * Dieser Endpunkt antwortet immer mit HTTP 410 Gone.
 * Er führt keine Datenbankoperationen aus.
 */

'use strict';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  console.warn(
    '[delete-customer] ⛔ Deprecated endpoint called. ' +
    'Use admin-mutate with action "customers.delete" instead.'
  );

  return {
    statusCode: 410,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      success: false,
      error: 'Dieser Endpunkt ist deaktiviert (deprecated).',
      replacement: {
        endpoint: '/.netlify/functions/admin-mutate',
        method: 'POST',
        body: {
          action: 'customers.delete',
          customer_id: '<customer_id>',
        },
        note: 'Caller muss Admin mit Rolle "owner" sein.',
      },
    }),
  };
};
