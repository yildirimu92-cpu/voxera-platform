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

/**
 * VORGABE fuer die kommende Preisarbeit — Aufbewahrung als Planmerkmal.
 * Entschieden am 11.08.2026. Grundlage:
 * docs/TICKET_TRANSKRIPT_AUFBEWAHRUNG_2026-08-11.md (Weg C).
 *
 * Die Aufbewahrungsfrist soll nach Plan gestaffelt werden. Die Werte stehen
 * bewusst noch NICHT hier: sie werden gemeinsam mit Grundpreis und
 * Zusatzminutenpreis entschieden, nicht separat. Drei Vorgaben gelten aber
 * unabhaengig davon, welche Zahlen es werden.
 *
 * 1. AUFNAHME IST NICHT MITSTAFFELBAR.
 *    ElevenLabs kennt genau EINEN Aufbewahrungswert fuer Gespraechsdaten und
 *    Audio gemeinsam (90 Tage, geprueft am 11.08.2026), und die Aufnahme liegt
 *    ausschliesslich dort -- Voxera hat keine eigene Kopie. Verlaengerbar ist
 *    deshalb nur, was in Zuerich liegt: Transkript, Zusammenfassung, Metadaten.
 *
 *    Folge fuer den Text: "12 Monate Verlauf" ist ohne Zusatz FALSCH und muss
 *    ueberall ausgeschrieben werden als "12 Monate Transkript und
 *    Zusammenfassung, 90 Tage Aufnahme". An drei Stellen gleich: Preistabelle,
 *    Paragraf 7 der Datenschutzerklaerung, Beschreibung im Dashboard. Wer
 *    "Verlauf" hoert, denkt an das Gespraech -- und meint im Zweifel das
 *    Anhoerbare.
 *
 * 2. "UPGRADE WIRKT NUR NACH VORNE" GEHOERT AN DIE UPGRADE-STELLE.
 *    Eine hoehere Stufe holt keine bereits geloeschte Aufnahme und kein
 *    geloeschtes Transkript zurueck. Dieser Hinweis gehoert dorthin, wo jemand
 *    tatsaechlich upgraden kann -- Preistabelle und Upgrade-Dialog im
 *    Dashboard --, nicht in die Konditionen-Liste und nicht in eine Fussnote.
 *    Er ist im Moment der Entscheidung relevant, nicht beim Nachlesen.
 *
 * 3. DIE STAFFELUNG VERKAUFT NACHVOLLZIEHBARKEIT, NICHT GESPRAECHSDAUER.
 *    Die 90-Tage-Aufnahme ist in JEDEM Plan gleich. Was ein hoeherer Plan
 *    bringt, ist ein laengerer nachlesbarer Verlauf -- die Grundlage fuer die
 *    "Erweiterten Auswertungen" aus GEPLANT.
 *    Gegenueber Arztpraxen und Anwaltskanzleien ist die kurze, in allen
 *    Plaenen gleiche Aufnahmefrist ein ARGUMENT, kein Zugestaendnis: das
 *    heikelste Datum liegt ueberall gleich kurz. Entsprechend formulieren --
 *    nicht entschuldigend ("nur 90 Tage"), sondern als Eigenschaft.
 */
export const AUFBEWAHRUNG_VORGABE = {
  aufnahmeTageAlleplaene: 90,
  transkriptTageProPlan: null as Record<Plan['id'], number> | null,
} as const;
