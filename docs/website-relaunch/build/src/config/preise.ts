/**
 * Preise — EINZIGE Quelle.
 *
 * Hintergrund (Content-Audit C1): Auf der alten Seite standen die Preise
 * hartkodiert an mehreren Stellen, und `plan_config` in Supabase hat 0 Zeilen.
 * Genau dieses Muster hat dazu gefuehrt, dass ein Aktionspreis mit Ablaufdatum
 * „31. Mai 2026" ueber zwei Monate lang als aktuell angezeigt wurde.
 *
 * Deshalb: Preistabelle, Vergleich und die strukturierten Daten (Offer) ziehen
 * ihre Werte ausschliesslich von hier.
 *
 * STATUS: Platzhalter. Die Werte entsprechen dem Stand der alten Seite und sind
 * vom Betreiber freigegeben, um weiterbauen zu koennen. Die endgueltigen Preise
 * kommen nach der laufenden Margen-Rechnung (ElevenLabs-Ueberschreitungspreis,
 * Twilio-Minutenpreis stehen aus). `/preise/` geht erst mit den echten Zahlen live.
 */

export type Plan = {
  id: 'starter' | 'business' | 'professional';
  name: string;
  monatlichChf: number;
  einrichtungChf: number;
  inklusivMinuten: number;
  zusatzminuteChf: number;
  hervorgehoben?: boolean;
  enthalten: string[];
  nichtEnthalten?: string[];
};

export const PLAENE: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    monatlichChf: 99,
    einrichtungChf: 490,
    inklusivMinuten: 20,
    zusatzminuteChf: 0.75,
    enthalten: [
      '24/7 KI-Telefonassistent',
      'Dashboard-Zugang',
      'E-Mail-Benachrichtigungen',
      '1 Schweizer Nummer',
    ],
    nichtEnthalten: ['Rückruf-Management'],
  },
  {
    id: 'business',
    name: 'Business',
    monatlichChf: 199,
    einrichtungChf: 690,
    inklusivMinuten: 100,
    zusatzminuteChf: 0.7,
    hervorgehoben: true,
    enthalten: [
      'Alles aus Starter',
      'Rückruf-Management',
      'Priority Support',
      '1 Schweizer Nummer',
    ],
  },
  {
    id: 'professional',
    name: 'Professional',
    monatlichChf: 299,
    einrichtungChf: 990,
    inklusivMinuten: 200,
    zusatzminuteChf: 0.65,
    enthalten: [
      'Alles aus Business',
      'Individuelle Konfiguration',
      'Priority Support',
      '1 Schweizer Nummer',
    ],
  },
];

/**
 * Aktion: derzeit KEINE.
 *
 * Bewusst leer, nicht auf ein altes Datum gesetzt. Ein Ablaufdatum, das ohne
 * Deploy still verstreicht, ist genau der Fehler aus C1 — lieber eine Luecke
 * als eine falsche Zusage.
 *
 * Wird wieder eine Aktion gefuehrt, hier eintragen:
 *   { gueltigBis: '2026-12-31', einrichtungChf: { starter: 390, ... } }
 * Der Build-Waechter (scripts/verify-seo.mjs) bricht ab, sobald `gueltigBis`
 * in der Vergangenheit liegt.
 */
export const AKTION: {
  gueltigBis: string;
  einrichtungChf: Record<Plan['id'], number>;
} | null = null;

export const KONDITIONEN = [
  'Alle Preise in CHF, exkl. MwSt.',
  'Keine Mindestlaufzeit bei Monatsplänen, 30 Tage Kündigungsfrist',
  'Jahrespläne: 12 Monate Laufzeit, 10 % Rabatt, automatische Verlängerung ohne Kündigung 30 Tage vor Ablauf',
];

/** Merkmale, die noch nicht existieren, gehoeren nicht in die Feature-Liste
 *  eines bezahlten Plans (Content-Audit C7). Sie stehen hier getrennt und
 *  werden ohne Preisbezug ausgewiesen. */
export const GEPLANT: { plan: Plan['id']; was: string }[] = [
  { plan: 'professional', was: 'Erweiterte Auswertungen' },
];
