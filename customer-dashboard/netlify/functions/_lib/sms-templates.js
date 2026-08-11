'use strict';

// sms-templates.js
// Textbau und Laengenrechnung fuer die beiden Anruf-SMS.
//
// Zwei Nachrichten, zwei Empfaengergruppen, zwei Zwecke:
//
//   Team    (4-5 Nummern) -- dass ein Anruf da ist, wie dringend, unter welcher
//                            Nummer zurueckzurufen ist, und ein Link ins
//                            Dashboard. KEIN Anliegen.
//   Anrufer (1 Nummer)    -- Bestaetigung, dass die Anfrage aufgenommen ist.
//                            Fuer jemanden, der am Strassenrand steht.
//
//
// WARUM DIE TEAM-SMS KEIN ANLIEGEN TRAEGT
//
// Twilio bewahrt Message Records 400 Tage auf, in den USA, INKLUSIVE
// Nachrichtentext. Dem stehen 90 Tage im eigenen Bestand gegenueber
// (TRANSCRIPT_RETENTION_DAYS in enforce-data-retention.js), und diese Funktion
// raeumt Supabase auf, nicht Twilio.
//
// Eine Team-SMS mit Zusammenfassung haette damit einen zweiten Bestand
// erzeugt, der laenger lebt als der erste, in einer anderen Jurisdiktion liegt
// und vom eigenen Loeschprozess nicht erreicht wird -- gefuellt mit Name,
// Aufenthaltsort und Notlage des Anrufers.
//
// Entscheidung vom 2026-08-11: Das Inhaltsdatum entsteht dort gar nicht erst.
// Die Team-SMS ist ein Wecker mit Rueckrufnummer, kein Bericht. Wer wissen
// will, worum es geht, oeffnet das Dashboard -- dort greift die eigene Frist.
//
// Das kostet Nutzen, und zwar echten: um drei Uhr nachts einen Link zu oeffnen
// ist mehr Aufwand als eine SMS zu lesen. Der Verlust ist bewusst in Kauf
// genommen, nicht uebersehen. Wer die Zusammenfassung wieder hineinschreiben
// will, aendert damit die Rechtslage -- nicht bloss den Text.
//
// Siehe docs/BEFUND_TWILIO_DATENRESIDENZ_2026-08-11.md.
//
//
// DER ABSENDER IST EINWEG
//
// Versendet wird unter einer alphanumerischen Absenderkennung ("Voxera"). Das
// ist im Twilio-Konto freigeschaltet, ohne Registrierung, sofort verfuegbar --
// und der Preis dafuer ist, dass niemand antworten kann. Auch das
// STOP-Schluesselwort funktioniert nicht.
//
// Daraus folgen zwei Dinge, die beide Vorlagen betreffen:
//
//   1. Keine Nachricht darf um eine Antwort bitten. Kein "antworten Sie mit
//      Ihrem Standort", kein "STOP zum Abbestellen" -- Letzteres waere sogar
//      ein Versprechen, das die Technik bricht.
//   2. Die Anrufer-SMS muss eine Rueckrufnummer TRAGEN. Sie ist eine
//      Sackgasse: Der Anrufer kann auf sie nicht reagieren, und ohne Nummer
//      im Text hat er keinen Weg zurueck.
//
//
// DIE KODIERUNGSFALLE
//
// Eine SMS ist bis 160 Zeichen ein Segment -- aber nur in GSM-7. Ein einziges
// Zeichen ausserhalb dieses Vorrats kippt die ganze Nachricht auf UCS-2, und
// dort ist bei 70 Zeichen Schluss. Deutsche Umlaute sind in GSM-7 enthalten
// und damit harmlos. Typografische Anfuehrungszeichen, Gedankenstriche und
// Auslassungspunkte sind es nicht -- und genau die liefert ein Sprachmodell,
// wenn man es laesst.
//
// Ein unbedachtes Zeichen verdoppelt also die Kosten oder verdreifacht sie.
// Deshalb laeuft jeder Text durch toGsm7(), bevor er gemessen wird.

// GSM 03.38, Grundvorrat. Jedes Zeichen zaehlt einfach.
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?'
  + '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';

// GSM 03.38, Erweiterungstabelle. Jedes Zeichen zaehlt DOPPELT, weil ihm ein
// Escape vorausgeht.
const GSM7_EXTENDED = '^{}\\[~]|€';

const GSM7_BASIC_SET = new Set(GSM7_BASIC.split(''));
const GSM7_EXTENDED_SET = new Set(GSM7_EXTENDED.split(''));

// Was ein Modell (oder eine Zwischenablage) gern liefert, und wodurch es sich
// verlustfrei ersetzen laesst. Verlustfrei heisst hier: die Bedeutung bleibt,
// die Typografie leidet. Bei einer Notfall-SMS ist das der richtige Tausch.
const GSM7_REPLACEMENTS = Object.freeze({
  '„': '"', '“': '"', '”': '"', '«': '"', '»': '"',
  '‘': "'", '’': "'", '‚': "'", '‹': "'", '›': "'",
  '–': '-', '—': '-', '−': '-', '‑': '-',
  '…': '...',
  ' ': ' ', ' ': ' ', ' ': ' ', '​': '',
  '•': '-', '·': '-',
  '→': '->', '←': '<-',
  '­': ''
});

/**
 * Bringt einen Text nach GSM-7, so weit es verlustfrei geht.
 * Was danach noch uebrig bleibt, wird entfernt statt durchgereicht: ein
 * einzelnes Emoji im Kundennamen wuerde sonst die ganze Nachricht auf 70
 * Zeichen kuerzen, und das faellt erst in der Rechnung auf.
 */
function toGsm7(input) {
  const raw = input == null ? '' : String(input);
  let out = '';
  let entferntZeichen = 0;

  for (const ch of raw) {
    const ersatz = GSM7_REPLACEMENTS[ch];
    if (ersatz !== undefined) { out += ersatz; continue; }
    if (GSM7_BASIC_SET.has(ch) || GSM7_EXTENDED_SET.has(ch)) { out += ch; continue; }

    // Zusammengesetzte Zeichen (e + Akzent) auf ihren Grundbuchstaben
    // zurueckfuehren, bevor aufgegeben wird -- rettet die meisten Namen.
    const zerlegt = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (zerlegt && [...zerlegt].every(c => GSM7_BASIC_SET.has(c))) { out += zerlegt; continue; }

    entferntZeichen += 1;
  }

  return { text: out, entferntZeichen };
}

/** Zeichenlaenge in GSM-7-Einheiten. Erweiterungszeichen zaehlen doppelt. */
function gsm7Laenge(text) {
  let n = 0;
  for (const ch of String(text || '')) n += GSM7_EXTENDED_SET.has(ch) ? 2 : 1;
  return n;
}

/**
 * Segmente und damit Kosten. Ein Segment = ein bezahlter Versand.
 *
 * Mehrteilige Nachrichten verlieren je Segment sieben Zeichen an den
 * Verkettungskopf -- 153 statt 160. Wer mit 160 rechnet, unterschaetzt die
 * Kosten einer knapp zu langen Nachricht um genau ein Segment.
 */
function segmenteBerechnen(text) {
  const { text: gsm } = toGsm7(text);
  const laenge = gsm7Laenge(gsm);
  if (laenge === 0) return { segmente: 0, laenge: 0, kodierung: 'GSM-7' };
  if (laenge <= 160) return { segmente: 1, laenge, kodierung: 'GSM-7' };
  return { segmente: Math.ceil(laenge / 153), laenge, kodierung: 'GSM-7' };
}

/** Kuerzt auf eine GSM-7-Laenge und haengt ein Auslassungszeichen an. */
function kuerzen(text, maxLaenge) {
  const roh = String(text || '').trim();
  if (gsm7Laenge(roh) <= maxLaenge) return roh;
  if (maxLaenge <= 3) return roh.slice(0, Math.max(0, maxLaenge));
  let out = '';
  for (const ch of roh) {
    const next = out + ch;
    if (gsm7Laenge(next) > maxLaenge - 3) break;
    out = next;
  }
  return out.trimEnd() + '...';
}

function s(v) { return v == null ? '' : String(v).trim(); }

/** Uhrzeit in Europe/Zurich. Der Empfaenger steht in der Schweiz, nicht in UTC. */
function uhrzeit(datum) {
  const d = datum instanceof Date ? datum : new Date(datum || Date.now());
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('de-CH', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich'
    }).format(d);
  } catch {
    return '';
  }
}

// Ein Segment ist das Ziel, nicht bloss die Obergrenze: bei fuenf Empfaengern
// kostet jedes zusaetzliche Segment fuenfmal.
const ZIEL_LAENGE = 160;

/**
 * Team-SMS. Ein Wecker mit Rueckrufnummer, kein Bericht.
 *
 * Vier Zeilen, und jede beantwortet genau eine Frage, die um drei Uhr nachts
 * gestellt wird:
 *
 *   1. Ist etwas passiert?      -- Absender und Uhrzeit
 *   2. Wie eilig?               -- Dringlichkeit, sofern eingestuft
 *   3. Wen rufe ich an?         -- Rueckrufnummer
 *   4. Wo steht der Rest?       -- Link ins Dashboard
 *
 * BEWUSST NICHT ENTHALTEN: Name des Anrufers, Anliegen, Zusammenfassung,
 * Kategorie, Ort. Das ist keine Sparsamkeit aus Platzgruenden -- die Nachricht
 * hat Platz uebrig -- sondern die Entscheidung aus dem Kopf dieser Datei: Was
 * nicht gesendet wird, liegt auch nicht 400 Tage bei Twilio.
 *
 * Die Parameterliste nimmt diese Felder deshalb gar nicht mehr entgegen. Wer
 * sie wieder hineinschreiben will, muss die Signatur aendern und stoesst dabei
 * auf diesen Kommentar -- das ist der Zweck.
 */
function buildTeamSms({
  dringlichkeit = '',
  rueckrufnummer = '',
  dashboardUrl = '',
  zeitpunkt = null
} = {}) {
  const zeit = uhrzeit(zeitpunkt);
  const zeilen = [['Voxera', zeit, 'Neuer Anruf'].filter(Boolean).join(' ')];

  // Die einzige Einstufung, die mitgeht. Sie sagt, wie schnell zu reagieren
  // ist, ohne zu sagen, worum es geht.
  if (s(dringlichkeit)) zeilen.push(`Dringlichkeit: ${s(dringlichkeit)}`);

  // Ohne Rueckrufnummer ist die Nachricht nicht handlungsfaehig. Dass sie
  // fehlt, muss dastehen -- sonst sucht das Team auf dem Sperrbildschirm nach
  // etwas, das nicht kommt.
  zeilen.push(s(rueckrufnummer)
    ? `Rueckruf: ${s(rueckrufnummer)}`
    : 'Rueckruf: keine Nummer uebermittelt');

  // Der Link ersetzt die Zusammenfassung. Er traegt kein Inhaltsdatum -- und
  // hinter ihm greift die eigene Aufbewahrungsfrist statt Twilios.
  if (s(dashboardUrl)) zeilen.push(`Details: ${s(dashboardUrl)}`);

  return finalisieren(zeilen.join('\n'), 'team');
}

/**
 * Anrufer-SMS.
 *
 * Der Grundsatz: nichts versprechen, was nicht gedeckt ist.
 *
 * Bei einem Notfall ist die wichtigste Information, WANN jemand kommt -- und
 * genau das weiss der Assistent nicht. Er kennt weder den Standort der
 * Fahrzeuge noch die Auftragslage. Eine Zeitangabe waere geraten, und eine
 * gerissene Zusage ist schlimmer als keine: Wer "in 20 Minuten" liest, sucht
 * keine andere Hilfe mehr.
 *
 * Was stattdessen dasteht, ist nachweislich wahr -- vorausgesetzt, die
 * Reihenfolge aus call-sms.js wird eingehalten (Team zuerst, Anrufer nur bei
 * mindestens einer angenommenen Team-SMS). "Das Team ist informiert" ist dann
 * keine Floskel, sondern eine Tatsachenbehauptung mit Beleg.
 *
 * Die Rueckrufnummer gehoert hier hinein, weil der Absender einweg ist: Der
 * Anrufer kann auf diese SMS nicht antworten. Ohne Nummer im Text haette er
 * keinen Weg zurueck.
 */
function buildCallerSms({
  firma = '',
  rueckrufnummer = '',
  notfallnummer = '',
  // Ob mindestens eine Team-SMS von Twilio angenommen wurde. Steuert, wie
  // stark die mittlere Zeile behaupten darf -- siehe dort.
  teamInformiert = false,
  zeitpunkt = null
} = {}) {
  const zeit = uhrzeit(zeitpunkt);

  // Die hinteren Zeilen zuerst, weil sie unverhandelbar sind: die
  // Rueckrufnummer ist der einzige Weg zurueck (der Absender ist einweg), und
  // die Notfallnummer ist die einzige Zeile, die Leben rettet. Was sich
  // anpassen muss, ist der Firmenname -- ihn zu kuerzen kostet Schoenheit,
  // die anderen zu kuerzen kostet Funktion.
  const schluss = [];

  // "Das Team ist informiert" ist eine Tatsachenbehauptung, keine Floskel --
  // sie darf nur dastehen, wenn mindestens eine Team-SMS von Twilio angenommen
  // wurde. Ist die SMS-Erweiterung fuer das Team gar nicht gebucht, wurde das
  // Team ueber E-Mail benachrichtigt; dann traegt die Nachricht die schwaechere,
  // aber zutreffende Aussage.
  //
  // Der dritte Fall -- Team-Versand versucht und vollstaendig gescheitert --
  // kommt hier nie an: call-sms.js unterdrueckt die Anrufer-SMS dann ganz.
  schluss.push(teamInformiert
    ? 'Das Team ist informiert und meldet sich.'
    : 'Ihre Anfrage ist aufgenommen. Jemand meldet sich.');
  if (s(rueckrufnummer)) schluss.push(`Rueckfragen: ${s(rueckrufnummer)}`);
  if (s(notfallnummer)) schluss.push(`Bei Lebensgefahr: ${s(notfallnummer)}`);

  const rumpf = zeit
    ? `Ihre Anfrage ist bei %s eingegangen (${zeit}).`
    : 'Ihre Anfrage ist bei %s eingegangen.';

  const schlussText = toGsm7(schluss.join('\n')).text;
  const rumpfLeer = toGsm7(rumpf.replace('%s', '')).text;
  const platzFirma = ZIEL_LAENGE - gsm7Laenge(schlussText) - gsm7Laenge(rumpfLeer) - 1;

  // Unter zehn Zeichen ist ein Firmenname nicht mehr wiederzuerkennen -- dann
  // lieber das neutrale "uns" als ein Fragment, das nach Fehler aussieht.
  const firmaRoh = toGsm7(s(firma)).text;
  const firmaText = (firmaRoh && platzFirma >= 10)
    ? kuerzen(firmaRoh, platzFirma)
    : 'uns';

  const zeilen = [rumpf.replace('%s', firmaText), ...schluss];

  // Kein "STOP zum Abbestellen": das Schluesselwort funktioniert bei
  // alphanumerischem Absender nicht. Es anzubieten waere ein Versprechen, das
  // die Technik bricht -- und bei einer einmaligen, angeforderten Bestaetigung
  // ist es ohnehin nicht erforderlich.

  return finalisieren(zeilen.join('\n'), 'caller');
}

/**
 * Gemeinsamer Abschluss: nach GSM-7 bringen, messen, und die Ueberlaenge
 * sichtbar machen statt sie zu verschlucken.
 */
function finalisieren(text, art) {
  const { text: gsm, entferntZeichen } = toGsm7(text);
  const bereinigt = gsm.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const mass = segmenteBerechnen(bereinigt);

  return {
    text: bereinigt,
    art,
    laenge: mass.laenge,
    segmente: mass.segmente,
    kodierung: mass.kodierung,
    entfernteZeichen: entferntZeichen,
    ueberEinSegment: mass.segmente > 1
  };
}

module.exports = {
  toGsm7,
  gsm7Laenge,
  segmenteBerechnen,
  kuerzen,
  buildTeamSms,
  buildCallerSms,
  ZIEL_LAENGE
};
