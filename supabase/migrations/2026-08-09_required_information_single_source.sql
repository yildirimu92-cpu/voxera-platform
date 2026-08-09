-- J8 / G6: Die Aufnahme-Checkliste bekommt eine Quelle.
--
-- Befund (Diagnose, Abschnitt 2, G6): Dieselbe Anweisung steht zweimal. Einmal
-- typisiert als `[PROMPT_V2].requiredInformation`, das der Builder als eigenen
-- Abschnitt `## PFLICHTINFORMATIONEN` rendert. Und einmal als erste Zeile in
-- `industry_templates.default_booking_faq`, von wo sie beim Anlegen eines
-- Kunden in `ai_booking_faq` kopiert wird und im Abschnitt TERMINLOGIK & FAQ
-- landet. Zwei Quellen ohne Rangfolge: der Agent bekommt die Checkliste
-- moeglicherweise zweimal, mit abweichendem Wortlaut.
--
-- KORREKTUR ZUR DIAGNOSE: Dort steht "15 von 19". Beim Auszaehlen der Zeilen
-- oberhalb der Ueberschrift "Häufige Fragen:" sind es **19 von 19**. Die
-- urspruengliche Zaehlung suchte woertlich nach "… aufnehmen:" und uebersah
-- die vier Vorlagen, die dieselbe Sache anders formulieren
-- (`digitalmarketing` "Lead qualifizieren und Erstgespräch terminieren:",
-- `immobilien` "Kaufinteressenten: … aufnehmen", `fitness` "Probetraining
-- anmelden:", `generic` "Terminanfragen: … aufnehmen").
--
-- Diese Migration macht drei Dinge:
--   1. eine neue Spalte `default_required_information` je Vorlage,
--   2. die Checkliste dorthin, umformuliert als Liste von Angaben,
--   3. die entsprechenden Zeilen aus `default_booking_faq` entfernen.
--
-- Was NICHT entfernt wird: echte Terminregeln. "Absagen: mindestens 24 Stunden
-- vorher", "Gruppen ab 8 Personen: mindestens 1 Woche im Voraus",
-- "Notfall-Kriterien: …" sind keine Aufnahme-Checkliste, sondern Auskuenfte am
-- Telefon. Sie bleiben, wo sie sind.
--
-- Was ZUSAETZLICH entfernt wird, und warum: drei Zeilen behaupten eine
-- Terminbefugnis --
--   `facharzt`  "KEINE direkte Terminbestätigung — Rückruf durch Praxisteam."
--   `garage`    "Bestätigung per SMS oder Anruf durch die Werkstatt."
--   `generic`   "… Rückruf durch das Team zur Bestätigung."
-- Seit J4 steht die Terminbefugnis als typisierte Kundenspalte
-- (`ai_appointment_mode`) und wird als Abschnitt TERMINBEFUGNIS gerendert. Ein
-- Vorlagensatz daneben ist nicht nur doppelt, er kann der Einstellung des
-- Kunden widersprechen: waehlt ein Facharzt "Direkt buchen", sagt der
-- Vorlagentext weiterhin, es gebe keine direkte Bestaetigung. Derselbe Befund
-- wie G6, nur an einem anderen Feld -- deshalb hier mit erledigt.
--
-- Rangfolge im Prompt (Code, nicht Daten): die Antwort des Kunden fuehrt, die
-- Vorlage ist Rueckfall. Steht in `[PROMPT_V2].requiredInformation` etwas,
-- gilt das; sonst die Vorlage. Nie beides.
--
-- Die Migration prueft sich am Ende selbst: Wenn eine der 25 zu entfernenden
-- Zeilen nicht woertlich so in der Datenbank steht, aendert `replace()`
-- stillschweigend nichts und die Doppelung bliebe bestehen. Der Block am Ende
-- bricht in diesem Fall mit einer Meldung ab, statt einen halben Zustand zu
-- hinterlassen.

begin;

alter table public.industry_templates
  add column if not exists default_required_information text;

comment on column public.industry_templates.default_required_information is
  'J8 / G6: Aufnahme-Checkliste der Branche. Rueckfall fuer [PROMPT_V2].requiredInformation; die Kundenantwort fuehrt.';

update public.industry_templates t
set default_required_information = v.info
from (values
  ('anwalt', 'Name\nKontaktangaben\nRechtsgebiet (kurz)\nGewünschtes Datum für das Erstgespräch'),
  ('baeckerei', 'Produkt\nMenge\nGewünschtes Abholdatum und Abholzeit\nName\nTelefonnummer'),
  ('coiffeur', 'Gewünschte Dienstleistung (zum Beispiel Schnitt und Föhnen oder Coloration)\nGewünschte Stylistin oder gewünschter Stylist\nDatum und Uhrzeit\nName\nTelefonnummer'),
  ('digitalmarketing', 'Firmenname\nBranche\nAktuelle Online-Präsenz (Webseite vorhanden: ja oder nein)\nHauptziel (mehr Kunden, bessere Sichtbarkeit oder Webseite)\nUngefährer Budget-Rahmen\nKontaktdaten und Wunschtermin'),
  ('facharzt', 'Name\nGeburtsdatum\nVersichertennummer, falls vorhanden\nAnliegen oder Grund\nGewünschtes Datum'),
  ('fitness', 'Für ein Probetraining: Name, Kontaktangaben und gewünschtes Datum\nFür eine Kursanmeldung: Kursname, Datum, Name und Mitgliedsnummer, falls vorhanden'),
  ('garage', 'Name\nFahrzeugmarke und Modell\nJahrgang\nKilometerstand\nAnliegen oder Problem'),
  ('generic', 'Gewünschtes Datum\nGewünschte Uhrzeit\nAnliegen\nKontaktangaben'),
  ('handwerk', 'Name\nAdresse\nArt des Problems oder Auftrags\nDringlichkeit (normal, dringend oder Notfall)'),
  ('hotel', 'Anreisedatum und Abreisedatum\nZimmerkategorie\nAnzahl Personen\nKontaktdaten'),
  ('immobilien', 'Bei Kaufinteresse: Budget, gewünschte Region, Grösse in Zimmern oder Quadratmetern, Zeitplan\nBei Verkaufsinteresse: Objekttyp, Standort, gewünschter Verkaufszeitpunkt\nBei Mietinteresse: Wunschobjekt, Budget, Einzugstermin'),
  ('it-support', 'Firmenname\nKontaktperson\nBeschreibung des Problems\nAnzahl betroffener Geräte oder Benutzer\nDringlichkeit (normal, dringend oder kritisch)'),
  ('kosmetik', 'Gewünschte Behandlung\nDatum und Uhrzeit\nName\nTelefonnummer\nBei neuen Kundinnen und Kunden: Allergien oder Unverträglichkeiten'),
  ('physiotherapie', 'Name\nAnliegen oder Diagnose (kurz)\nÄrztliche Verordnung vorhanden (ja oder nein)\nGewünschtes Datum'),
  ('reinigung', 'Name\nAdresse\nArt der Reinigung\nObjektgrösse in Quadratmetern oder Zimmern\nGewünschte Häufigkeit\nWunschtermin für die Besichtigung'),
  ('restaurant', 'Datum\nUhrzeit\nPersonenzahl\nName\nTelefonnummer\nAllergien oder besondere Wünsche'),
  ('treuhand', 'Name\nFirmenname, falls Geschäftskunde\nAnliegen\nGewünschtes Datum'),
  ('versicherung', 'Bei einer Schadenmeldung: Name, Policennummer falls vorhanden, Art des Schadens, Datum und kurze Beschreibung\nBei einer Terminanfrage: Wunschdatum, Wunschzeit, Anliegen und Kontaktdaten'),
  ('zahnarzt', 'Name\nGeburtsdatum\nAnliegen (Kontrolle, Schmerzen oder Behandlung)\nGewünschtes Datum')
) as v(id, info)
where t.id = v.id;

-- Die zu entfernenden Zeilen, woertlich so, wie sie heute in der Datenbank
-- stehen. Der Zeilenumbruch ist dort zwei Zeichen (Backslash und n), nicht ein
-- Umbruch -- deshalb steht er hier genauso.
create temporary table j8_removals(id text, fragment text) on commit drop;
insert into j8_removals(id, fragment) values
  ('anwalt', 'Erstanfrage aufnehmen: Name, Kontakt, Rechtsgebiet (kurz), gewünschtes Datum für Erstgespräch.\n'),
  ('baeckerei', 'Bestellung aufnehmen: Produkt, Menge, gewünschtes Abholdatum und -zeit, Name und Telefonnummer.\n'),
  ('coiffeur', 'Termin aufnehmen: Dienstleistung (z.B. Schnitt + Föhnen, Coloration), gewünschte Stylistin/Stylisten, Datum und Uhrzeit, Name und Telefonnummer.\n'),
  ('digitalmarketing', 'Lead qualifizieren und Erstgespräch terminieren: Firmenname, Branche, aktuelle Online-Präsenz (Webseite vorhanden? Ja/Nein), Hauptziel (mehr Kunden, bessere Sichtbarkeit, Webseite), Budget-Rahmen (grob), Kontaktdaten und Wunschtermin.\n'),
  ('facharzt', 'Terminanfrage aufnehmen: Name, Geburtsdatum, Versichertennummer (falls vorhanden), Anliegen/Grund, gewünschtes Datum.\n'),
  ('facharzt', 'KEINE direkte Terminbestätigung — Rückruf durch Praxisteam.\n'),
  ('fitness', 'Probetraining anmelden: Name, Kontakt, gewünschtes Datum.\n'),
  ('fitness', 'Kursanmeldung: Kursname, Datum, Name und Mitgliedsnummer (falls vorhanden).\n'),
  ('garage', 'Terminanfrage aufnehmen: Name, Fahrzeugmarke/-modell, Jahrgang, Kilometerstand, Anliegen/Problem.\n'),
  ('garage', 'Bestätigung per SMS oder Anruf durch die Werkstatt.\n'),
  ('generic', 'Terminanfragen: Datum, Uhrzeit und Anliegen aufnehmen. Rückruf durch das Team zur Bestätigung.\n'),
  ('handwerk', 'Auftragsanfrage aufnehmen: Name, Adresse, Art des Problems/Auftrags, Dringlichkeit (Normal / Dringend / Notfall).\n'),
  ('hotel', 'Reservationsanfrage aufnehmen: Anreise-/Abreisedatum, Zimmerkategorie, Anzahl Personen, Kontaktdaten.\n'),
  ('immobilien', 'Kaufinteressenten: Budget, gewünschte Region, Grösse (Zimmer/m²), Zeitplan aufnehmen.\n'),
  ('immobilien', 'Verkaufsinteressenten: Objekt-Typ, Standort, gewünschten Verkaufszeitpunkt aufnehmen.\n'),
  ('immobilien', 'Mietinteressenten: Wunschobjekt, Budget, Einzugstermin aufnehmen.\n'),
  ('it-support', 'Ticket aufnehmen: Firmenname, Kontaktperson, Beschreibung des Problems, Anzahl betroffener Geräte/User, Dringlichkeit (Normal / Dringend / Kritisch).\n'),
  ('kosmetik', 'Termin aufnehmen: Behandlung, Datum und Uhrzeit, Name und Telefonnummer. Bei Neukunden: kurz nach Allergien oder Unverträglichkeiten fragen.\n'),
  ('physiotherapie', 'Terminanfrage aufnehmen: Name, Anliegen/Diagnose (kurz), ärztliche Verordnung vorhanden (Ja/Nein), gewünschtes Datum.\n'),
  ('reinigung', 'Offerten-Anfrage aufnehmen: Name, Adresse, Art der Reinigung, Objektgrösse (m² oder Zimmer), gewünschte Häufigkeit, Wunschtermin für Besichtigung.\n'),
  ('restaurant', 'Reservation aufnehmen: Datum, Uhrzeit, Personenzahl, Name und Telefonnummer. Allergien oder besondere Wünsche notieren.\n'),
  ('treuhand', 'Terminanfrage aufnehmen: Name, Firmenname (falls Geschäftskunde), Anliegen, gewünschtes Datum.\n'),
  ('versicherung', 'Schadenmeldung aufnehmen: Name, Policennummer (falls vorhanden), Art des Schadens, Datum und kurze Beschreibung.\n'),
  ('versicherung', 'Terminanfrage: Datum, Uhrzeit-Wunsch, Anliegen und Kontaktdaten aufnehmen.\n'),
  -- Bei `zahnarzt` faellt nur der erste Satz weg. Der zweite ("Neue Patienten:
  -- bitte Krankenkassenkarte mitbringen.") ist ein Hinweis AN die anrufende
  -- Person und keine Angabe, die erfragt wird -- er bleibt als Regelzeile.
  ('zahnarzt', 'Terminanfrage aufnehmen: Name, Geburtsdatum, Anliegen (Kontrolle / Schmerzen / Behandlung), gewünschtes Datum. ');

-- Die Ersetzung selbst: eine Zeile nach der anderen, damit jede einzeln
-- nachvollziehbar bleibt.
do $j8_remove$
declare
  row record;
begin
  for row in select id, fragment from j8_removals loop
    update public.industry_templates
    set default_booking_faq = replace(default_booking_faq, row.fragment, '')
    where id = row.id;
  end loop;
end
$j8_remove$;

-- Selbstkontrolle. Steht eine der Zeilen nicht woertlich so in der Datenbank,
-- hat replace() nichts getan und die Doppelung bliebe bestehen.
do $j8_verify$
declare
  leftover text;
begin
  select string_agg(r.id || ': ' || left(r.fragment, 40), ' | ')
  into leftover
  from j8_removals r
  join public.industry_templates t on t.id = r.id
  where position(r.fragment in t.default_booking_faq) > 0;

  if leftover is not null then
    raise exception 'J8: diese Zeilen wurden nicht entfernt -- %', leftover;
  end if;

  if exists (select 1 from public.industry_templates where coalesce(default_required_information, '') = '') then
    raise exception 'J8: mindestens eine Vorlage hat keine Aufnahme-Checkliste bekommen';
  end if;
end
$j8_verify$;

commit;
