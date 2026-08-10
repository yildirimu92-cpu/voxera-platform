import { defineCollection, z } from 'astro:content';

/**
 * Ratgeber. Die Struktur steht jetzt, damit sie nicht nachtraeglich umgebaut
 * werden muss, wenn Artikel dazukommen (SEO-Nachtrag, Punkt 2).
 *
 * `aktualisiert` ist Pflicht: bei Ratgeber-Inhalten ist das Aktualisierungsdatum
 * ein echtes Ranking-Signal und darf nicht von Hand gepflegt werden muessen.
 *
 * `branche` ist Pflicht und einwertig: jeder Artikel verlinkt GENAU EINE
 * Branchenseite. So entsteht die interne Verzahnung beim Schreiben und nicht
 * als nachtraegliche Aufraeumaktion.
 */
const ratgeber = defineCollection({
  type: 'content',
  schema: z.object({
    titel: z.string().max(60),
    beschreibung: z.string().max(155),
    kategorie: z.enum([
      'telefonie-erreichbarkeit',
      'ki-im-kmu',
      'branchenpraxis',
      'recht-datenschutz',
    ]),
    /** Slug genau einer Branchenseite. */
    branche: z.enum([
      'handwerk-bau',
      'arztpraxis-gesundheit',
      'immobilien',
      'treuhand-recht-finanzen',
      'coiffeur-beauty',
      'garage-automobil',
      'gastronomie-hotellerie',
      'detailhandel-logistik',
    ]),
    autor: z.string().default('Umut Yildirim'),
    veroeffentlicht: z.date(),
    aktualisiert: z.date(),
    entwurf: z.boolean().default(false),
  }),
});

export const collections = { ratgeber };
