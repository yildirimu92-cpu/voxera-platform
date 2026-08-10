/**
 * Branchentexte.
 *
 * HERKUNFT: abgeleitet aus den echten Prompt-Vorlagen des Produkts
 * (`public.industry_templates`, gelesen am 10.08.2026) — Notfall-Kriterien,
 * Eskalationsregeln und Aufnahme-Checklisten sind das, was der Assistent
 * tatsaechlich tut, nicht was gut klingt.
 *
 * Das ist der Unterschied zwischen einer Seite, die rankt, und acht Seiten,
 * die sich gegenseitig entwerten: „Was Lara fragt, wenn um 18 Uhr ein
 * Rohrbruch gemeldet wird" statt „auch fuer Handwerksbetriebe geeignet".
 *
 * NICHT uebernommen: die kundenspezifischen Platzhalter aus den Vorlagen
 * (`[Preis eintragen]`, `[Pannennummer]`). Das sind Konfigurationswerte pro
 * Kunde und keine Aussagen, die Voxera auf der Website treffen kann.
 */

export type BranchenInhalt = {
  einstieg: string;
  situationen: { titel: string; text: string }[];
  erfasst: string[];
  faq: { frage: string; antwort: string }[];
};

export const INHALTE: Record<string, BranchenInhalt> = {
  'handwerk-bau': {
    einstieg:
      'Auf der Baustelle klingelt das Telefon zur Unzeit — und der Anrufer mit dem Wasserschaden ruft nicht zweimal an. Lara nimmt ab, erkennt, ob es ein Notfall ist, und gibt Dringendes sofort weiter.',
    situationen: [
      {
        titel: 'Rohrbruch um 18 Uhr',
        text: 'Lara erkennt Rohrbruch, Überschwemmung, Stromunterbruch und Heizungsausfall im Winter als Notfall, weist die anrufende Person an, den Haupthahn abzudrehen, und meldet den Einsatz sofort weiter — statt ihn in einer Voicemail liegen zu lassen.',
      },
      {
        titel: 'Gasgeruch gemeldet',
        text: 'Bei einem gemeldeten Gasleck weist Lara an, Fenster zu öffnen und das Gebäude zu verlassen, und nennt Notruf 118 sowie den Gasversorger. Erst danach geht es um Ihren Termin.',
      },
      {
        titel: 'Normale Auftragsanfrage',
        text: 'Kein Notfall? Dann nimmt Lara den Auftrag strukturiert auf und stuft ihn als normal ein — Sie sehen im Dashboard auf einen Blick, was warten kann und was nicht.',
      },
    ],
    erfasst: ['Name', 'Adresse', 'Art des Problems oder Auftrags', 'Dringlichkeit: normal, dringend oder Notfall'],
    faq: [
      {
        frage: 'Erkennt der Assistent wirklich, was ein Notfall ist?',
        antwort:
          'Ja. Die Notfall-Kriterien sind für Handwerksbetriebe hinterlegt — Rohrbruch, Überschwemmung, Stromunterbruch, Heizungsausfall im Winter. Sie können sie an Ihren Betrieb anpassen.',
      },
      {
        frage: 'Was passiert mit Kostenvoranschlägen?',
        antwort:
          'Lara nimmt die Anfrage auf und kündigt die Besichtigung an. Preise nennt sie nur, wenn Sie sie hinterlegt haben — geschätzt wird nichts.',
      },
    ],
  },

  'arztpraxis-gesundheit': {
    einstieg:
      'Während der Behandlung klingelt es — und das Praxisteam kann nicht an zwei Orten sein. Lara nimmt Terminwünsche und Anliegen auf, ohne je medizinisch zu beraten.',
    situationen: [
      {
        titel: 'Akuter Notfall am Telefon',
        text: 'Bei starken Schmerzen, Atemnot oder Bewusstlosigkeit nennt Lara sofort den Notruf 144. Sie versucht nicht, die Lage einzuschätzen — sie leitet weiter.',
      },
      {
        titel: 'Abgebrochener Zahn',
        text: 'In der Zahnarztvorlage gibt Lara den Hinweis, den Zahn in Milch aufzubewahren, markiert den Fall als Notfall und gibt ihn sofort weiter. Kleine Dinge, die im Alltag untergehen.',
      },
      {
        titel: '„Habe ich jetzt eine Grippe?"',
        text: 'Lara beantwortet keine medizinischen Fragen. Sie nimmt das Anliegen auf und kündigt den Rückruf durch das Praxisteam an — das ist bewusst so gebaut.',
      },
    ],
    erfasst: ['Name', 'Geburtsdatum', 'Versichertennummer, falls vorhanden', 'Anliegen oder Grund', 'Gewünschtes Datum'],
    faq: [
      {
        frage: 'Gibt der Assistent medizinische Auskunft?',
        antwort:
          'Nein, und das ist fest hinterlegt. Er nimmt auf, priorisiert und leitet weiter. Die medizinische Beurteilung bleibt beim Praxisteam.',
      },
      {
        frage: 'Wie geht er mit Angst-Patienten um?',
        antwort:
          'Die Zahnarztvorlage ist ausdrücklich auf Ruhe und Einfühlsamkeit ausgelegt, weil viele Anrufende Zahnarztangst haben.',
      },
    ],
  },

  immobilien: {
    einstieg:
      'Beim Besichtigungstermin bleibt das Telefon in der Tasche — und jeder unbeantwortete Anruf ist ein Interessent, der zur Konkurrenz geht. Lara qualifiziert stattdessen.',
    situationen: [
      {
        titel: 'Kaufinteressent',
        text: 'Lara nimmt Budget, gewünschte Region, Grösse in Zimmern oder Quadratmetern und den Zeitplan auf. Sie rufen jemanden zurück, von dem Sie bereits wissen, ob er passt.',
      },
      {
        titel: 'Verkaufsinteressent',
        text: 'Objekttyp, Standort und gewünschter Verkaufszeitpunkt werden erfasst — die Basis für das Erstgespräch steht, bevor Sie zum Hörer greifen.',
      },
      {
        titel: 'Preisverhandlung am Telefon',
        text: 'Konkrete Kaufangebote und Verhandlungen leitet Lara immer an den Berater weiter. Sie verhandelt nicht und macht keine Zusagen.',
      },
    ],
    erfasst: [
      'Bei Kaufinteresse: Budget, Region, Grösse, Zeitplan',
      'Bei Verkaufsinteresse: Objekttyp, Standort, Verkaufszeitpunkt',
      'Bei Mietinteresse: Wunschobjekt, Budget, Einzugstermin',
    ],
    faq: [
      {
        frage: 'Nennt der Assistent Preise oder Bewertungen?',
        antwort:
          'Nein. Rechtliche Fragen und Preisverhandlungen gehen an den Berater oder Notar — Lara qualifiziert die Anfrage und übergibt.',
      },
    ],
  },

  'treuhand-recht-finanzen': {
    einstieg:
      'Diskretion und Fristen — beides verträgt keine verpassten Anrufe. Lara nimmt Erstanfragen auf und koordiniert Termine, ohne selbst Auskunft zu geben.',
    situationen: [
      {
        titel: 'Ablaufende Frist',
        text: 'Läuft eine Steuererklärung oder eine andere Frist ab, markiert Lara den Fall als dringend und informiert sofort — statt ihn in die normale Rückrufliste zu legen.',
      },
      {
        titel: 'Haftbefehl oder Verhaftung',
        text: 'In der Anwaltsvorlage nennt Lara sofort die Notfallnummer und stuft den Fall als äusserst dringend ein.',
      },
      {
        titel: '„Habe ich in diesem Fall Recht?"',
        text: 'Darauf antwortet Lara nicht. Sie hält fest, dass das nur nach Aktenstudium beurteilt werden kann, und vereinbart das Erstgespräch.',
      },
    ],
    erfasst: ['Name', 'Firmenname, falls Geschäftskunde', 'Rechtsgebiet oder Anliegen', 'Gewünschtes Datum für das Erstgespräch'],
    faq: [
      {
        frage: 'Wie diskret ist das?',
        antwort:
          'Lara gibt keine Auskunft über Mandate und beurteilt keine Fälle. Sie nimmt auf und übergibt. Wo Ihre Daten liegen, steht in der Datenschutzerklärung.',
      },
      {
        frage: 'Wie geht der Assistent mit emotionalen Anrufen um?',
        antwort:
          'Bei Scheidung oder Todesfall ist die Vorlage auf einfühlsames Reagieren und ein Terminangebot ausgelegt — ohne Druck.',
      },
    ],
  },

  'coiffeur-beauty': {
    einstieg:
      'Während der Coloration klingelt das Telefon — und wer nicht durchkommt, bucht beim Salon nebenan. Lara nimmt Terminanfragen auf, auch mitten in der Behandlung.',
    situationen: [
      {
        titel: 'Terminanfrage mit Wunsch-Stylistin',
        text: 'Lara nimmt die gewünschte Dienstleistung, die Wunsch-Stylistin sowie Datum und Uhrzeit auf — nicht nur „ruft zurück".',
      },
      {
        titel: 'Neue Kundin mit Allergien',
        text: 'Bei neuen Kundinnen und Kunden fragt Lara nach Allergien und Unverträglichkeiten. Das steht in der Vorlage, weil es später nicht nachgeholt werden kann.',
      },
      {
        titel: 'Reaktion auf ein Produkt',
        text: 'Meldet jemand eine allergische Reaktion, nimmt Lara das ernst, empfiehlt einen Arztbesuch und informiert sofort die Inhaberin.',
      },
    ],
    erfasst: ['Gewünschte Dienstleistung', 'Wunsch-Stylistin oder -Stylist', 'Datum und Uhrzeit', 'Name und Telefonnummer', 'Bei Neukundinnen: Allergien'],
    faq: [
      {
        frage: 'Kennt der Assistent unsere Absagefrist?',
        antwort:
          'Ja. Die 24-Stunden-Absagefrist ist in der Vorlage hinterlegt und lässt sich an Ihren Salon anpassen.',
      },
      {
        frage: 'Weiss er, wie lange eine Coloration dauert?',
        antwort:
          'Die Vorlage rechnet mit 2 bis 3 Stunden und empfiehlt, früh genug zu buchen — damit Termine realistisch geplant werden.',
      },
    ],
  },

  'garage-automobil': {
    einstieg:
      'Unter dem Auto hört man das Telefon nicht. Lara nimmt Reparaturanfragen und Pannenmeldungen auf — mit allen Angaben, die Sie für eine Einschätzung brauchen.',
    situationen: [
      {
        titel: 'Panne am Strassenrand',
        text: 'Lara nimmt Standort, Fahrzeugtyp und Problem auf, nennt Ihre Pannennummer und markiert den Fall als dringend.',
      },
      {
        titel: 'Reparaturanfrage',
        text: 'Fahrzeugmarke, Modell, Jahrgang und Kilometerstand werden erfasst — Sie können die Arbeit einschätzen, bevor Sie zurückrufen.',
      },
      {
        titel: 'Unzufrieden nach der Reparatur',
        text: 'Beschwerden nimmt Lara empathisch auf und kündigt den Rückruf durch die Geschäftsführung an, statt zu diskutieren.',
      },
    ],
    erfasst: ['Name', 'Fahrzeugmarke und Modell', 'Jahrgang', 'Kilometerstand', 'Anliegen oder Problem'],
    faq: [
      {
        frage: 'Nennt der Assistent Preise für einen Service?',
        antwort:
          'Nur die Richtwerte, die Sie hinterlegt haben. Die verbindliche Offerte kommt nach dem Fahrzeugcheck — Lara schätzt nichts.',
      },
    ],
  },

  'gastronomie-hotellerie': {
    einstieg:
      'Während des Mittagsservice klingelt es ununterbrochen — und jede unbeantwortete Reservation ist ein leerer Tisch. Lara nimmt ab, während das Team bei den Gästen ist.',
    situationen: [
      {
        titel: 'Reservation mit Allergien',
        text: 'Lara erfasst Datum, Uhrzeit, Personenzahl und Allergien oder besondere Wünsche gleich mit — die Küche weiss Bescheid, bevor die Gäste da sind.',
      },
      {
        titel: 'Grosse Gruppe',
        text: 'Gruppen ab acht Personen brauchen Vorlauf. Lara nimmt die Anfrage auf und kündigt den Rückruf durch die Inhaberin oder den Inhaber an.',
      },
      {
        titel: 'Zimmeranfrage im Hotel',
        text: 'Anreise- und Abreisedatum, Zimmerkategorie und Personenzahl werden erfasst; Gruppenanfragen gehen ans Front Office statt in die Warteschlange.',
      },
    ],
    erfasst: ['Datum und Uhrzeit', 'Personenzahl', 'Name und Telefonnummer', 'Allergien oder besondere Wünsche'],
    faq: [
      {
        frage: 'Kann der Assistent Tische verbindlich zusagen?',
        antwort:
          'Das hängt von Ihrer Einstellung ab. Sie legen fest, ob Lara direkt bucht oder die Anfrage aufnimmt und Ihr Team bestätigt.',
      },
    ],
  },
};
