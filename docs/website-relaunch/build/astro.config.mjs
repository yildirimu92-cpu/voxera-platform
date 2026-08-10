import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Statische Ausgabe: eine echte HTML-Datei pro URL. Kein Hash-Routing, kein
// Client-Side-Only-Rendering — jede Unterseite muss ohne JavaScript vollstaendig
// lesbar sein (Zielbild B.5).
export default defineConfig({
  site: 'https://voxera.ch',
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
  integrations: [
    sitemap({
      // Transaktionsseiten gehoeren nicht in den Index. Sie werden ausserdem
      // per <meta name="robots" content="noindex"> markiert.
      filter: (page) =>
        !page.includes('/offer-accept') &&
        !page.includes('/contract-signed'),
    }),
  ],
  // Kein Framework-Runtime im Auslieferungsstand. JS-Budget: 30 KB gzipped
  // ueber die ganze Seite — siehe scripts/verify-seo.mjs.
});
