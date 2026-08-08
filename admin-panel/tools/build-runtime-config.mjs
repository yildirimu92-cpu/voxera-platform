// Netlify-Build-Schritt fuer das Admin Panel.
// Die Logik liegt in scripts/runtime-config.mjs; dieser Wrapper existiert nur,
// damit der Aufruf in netlify.toml relativ zum Base-Verzeichnis der Site
// eindeutig ist und nicht vom Arbeitsverzeichnis abhaengt.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildRuntimeConfig } from '../../scripts/runtime-config.mjs';

const siteDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
buildRuntimeConfig({ siteDir, site: 'admin-panel' });
