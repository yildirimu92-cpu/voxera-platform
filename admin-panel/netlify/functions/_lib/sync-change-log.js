'use strict';

// Feld-Diff für elevenlabs_sync_log.changed_fields.
//
// Die Spalte existierte, wurde aber nie beschrieben: trigger-elevenlabs-sync
// verwarf die vom Aufrufer gesendeten prev_values mit `void prev_values`.
// Dadurch war jede Sync-Diagnose auf den Vergleich zweier prompt_snapshot
// angewiesen. Hier entsteht der Diff aus den Werten vor dem Schreiben und dem
// Datensatz, den der Sync anschliessend lädt.

const MAX_VALUE_LENGTH = 300;

function truncate(value) {
  if (value === null || value === undefined) return null;
  const asText = String(value);
  return asText.length > MAX_VALUE_LENGTH ? `${asText.slice(0, MAX_VALUE_LENGTH)}…` : asText;
}

function buildChangedFields(prevValues, customer = {}, explicitFields = null) {
  const fields = new Set(Array.isArray(explicitFields) ? explicitFields.map(item => String(item)) : []);
  const before = {};
  const after = {};

  if (prevValues && typeof prevValues === 'object' && !Array.isArray(prevValues)) {
    for (const [key, previous] of Object.entries(prevValues)) {
      if (!Object.prototype.hasOwnProperty.call(customer, key)) continue;
      const current = customer[key];
      if (String(previous ?? '') === String(current ?? '')) continue;
      fields.add(key);
      before[key] = truncate(previous);
      after[key] = truncate(current);
    }
  }

  for (const key of fields) {
    if (key in after) continue;
    if (!Object.prototype.hasOwnProperty.call(customer, key)) continue;
    after[key] = truncate(customer[key]);
  }

  if (!fields.size) return null;
  return { fields: [...fields].sort(), before, after };
}

module.exports = { buildChangedFields, MAX_VALUE_LENGTH };
