/** Seitenweite Konfiguration. */

export const SITE = {
  url: 'https://voxera.ch',
  name: 'Voxera',
  /** de-CH, nicht de. Fuer Schweizer Suchergebnisse das richtige Signal
   *  (die alte Seite deklarierte lang="de"). */
  lang: 'de-CH',
  /** Launch auf Deutsch. Die Struktur ist so angelegt, dass /fr/ und /it/
   *  spaeter ohne Umbau danebenpassen — siehe Base.astro, hreflang. */
  sprachen: ['de-CH'] as const,
  mail: 'info@voxera.ch',
  telefon: '076 310 33 13',
  ort: 'Meggen, Kanton Luzern, Schweiz',
  dashboard: 'https://dashboard.voxera.ch',
  calendly: 'https://calendly.com/voxera_ch/voxera-demo-ai-telefonassistent',
};

/** Hauptnavigation. Jede Seite ist von / aus in maximal zwei Klicks
 *  erreichbar — keine verwaisten Seiten (Zielbild B.5). */
export const NAV = [
  { href: '/so-funktionierts/', label: "So funktioniert's" },
  { href: '/branchen/', label: 'Branchen' },
  { href: '/preise/', label: 'Preise' },
  { href: '/ratgeber/', label: 'Ratgeber' },
  { href: '/demo/', label: 'Demo' },
];

/** Die acht Branchen. `vorlage` verweist auf die Prompt-Vorlagen im Produkt
 *  (industry_templates) — daher kommt der branchenspezifische Inhalt.
 *  `gesperrt` markiert Seiten, die noch nicht live gehen duerfen. */
export const BRANCHEN = [
  { slug: 'handwerk-bau',            titel: 'Handwerk & Bau',            keyword: 'Telefonservice Handwerker',            vorlagen: ['handwerk', 'reinigung'] },
  { slug: 'arztpraxis-gesundheit',   titel: 'Arztpraxis & Gesundheit',   keyword: 'Telefon Arztpraxis entlasten',         vorlagen: ['facharzt', 'zahnarzt', 'physiotherapie'] },
  { slug: 'immobilien',              titel: 'Immobilien',                keyword: 'Telefonassistent Immobilienmakler',    vorlagen: ['immobilien'] },
  { slug: 'treuhand-recht-finanzen', titel: 'Treuhand, Recht & Finanzen',keyword: 'Telefonservice Treuhand Anwaltskanzlei', vorlagen: ['treuhand', 'anwalt', 'versicherung'] },
  { slug: 'coiffeur-beauty',         titel: 'Coiffeur & Beauty',         keyword: 'Terminannahme Coiffeur Telefon',       vorlagen: ['coiffeur', 'kosmetik'] },
  { slug: 'garage-automobil',        titel: 'Garage & Automobil',        keyword: 'Telefonservice Autogarage',            vorlagen: ['garage'] },
  { slug: 'gastronomie-hotellerie',  titel: 'Gastronomie & Hotellerie',  keyword: 'Reservation Telefon Restaurant',       vorlagen: ['restaurant', 'hotel', 'baeckerei'] },
  {
    slug: 'detailhandel-logistik',
    titel: 'Detailhandel & Logistik',
    keyword: 'Telefonservice Detailhandel',
    // Zwei getrennte Vorlagen, beschlossen am 10.08.2026 — noch nicht gebaut.
    vorlagen: ['detailhandel', 'logistik'],
    gesperrt: 'Vorlagen im Produkt noch nicht gebaut (siehe Produktpunkt Dokument 04)',
  },
] as const;

/** Ratgeber-Kategorien. Bewusst wenige und fix — Tag-Archive erzeugen bei
 *  wenigen Artikeln genau die Duennseiten, die vermieden werden sollen. */
export const RATGEBER_KATEGORIEN = [
  { slug: 'telefonie-erreichbarkeit', titel: 'Telefonie & Erreichbarkeit' },
  { slug: 'ki-im-kmu',                titel: 'KI im KMU' },
  { slug: 'branchenpraxis',           titel: 'Branchenpraxis' },
  { slug: 'recht-datenschutz',        titel: 'Recht & Datenschutz' },
] as const;
