'use strict';

const crypto = require('crypto');
const { normalizePhoneE164 } = require('./phone-normalize');

// ── GRENZE, ausdruecklich ───────────────────────────────────────────────────
//
// EINE ANRUFERNUMMER IST KEINE AUTHENTIFIZIERUNG.
//
// `system__caller_id` kommt aus der Telefonsignalisierung. Sie ist faelschbar
// (CLI-Spoofing ist mit jedem SIP-Anbieter in Minuten eingerichtet), sie ist
// teilbar (Festnetz einer Familie, Sammelanschluss einer Firma), sie kann
// unterdrueckt sein, und sie fehlt bei jedem Gespraech, das nicht ueber das
// Telefon laeuft -- Testgespraeche im ElevenLabs-Widget zum Beispiel haben sie
// nie. ElevenLabs selbst schreibt dazu, die Anrufer-ID koenne "gefaelscht oder
// geteilt" werden und gehoere mit einem zweiten Faktor kombiniert.
//
// Was hier gebaut wird, ist deshalb ausdruecklich KEIN Sicherheitsmerkmal,
// sondern eine Zuordnung: sie verhindert, dass das Nachschlagen einem beliebigen
// Anrufer die anstehenden Termine FREMDER Personen samt Termin-IDs vorliest --
// und damit die Moeglichkeit, sie abzusagen. Vorher tat es genau das: `lookup`
// lieferte alle anstehenden Termine des KUNDEN (also des Betriebs), an jeden,
// der anrief.
//
// Fuer den Anwendungsfall "den eigenen Termin absagen" ist diese Huerde
// vertretbar: der Schaden eines gelungenen Missbrauchs ist eine abgesagte
// Terminreservierung, kein Datenabfluss und kein Geldwert. Fuer alles darueber
// -- Rechnungen, Kundendaten, Zahlungen -- reicht sie nicht, und sie darf
// nirgends so dargestellt werden. Weder im Prompt noch in der Oberflaeche noch
// gegenueber Kunden steht ein Satz wie "nur Sie koennen Ihren Termin absagen".
//
// Der Rueckfall (Terminnummer) ist bewusst genauso schwach: eine kurze,
// gesprochene Ziffernfolge. Sie loest das Problem "Anruf von einer anderen
// Nummer", nicht das Problem "jemand will fremde Termine absagen".

const BUCHUNGSNUMMER_STELLEN = 6;

// Die Anrufernummer in einer vergleichbaren Form. Leerer String heisst: keine
// verwertbare Nummer -- unterdrueckt, anonym, oder gar kein Telefongespraech.
//
// Der gefaehrliche Fall ist nicht die fehlende Nummer, sondern der PLATZHALTER,
// der wie eine Nummer aussieht: geht er als Kennung durch, teilen sich alle
// anonymen Anrufer EINE Identitaet -- und der erste, der so bucht, oeffnet
// seinen Termin fuer jeden weiteren anonymen Anruf.
//
// Die Wortformen faengt normalizePhoneE164() heute schon ab, weil sie keine
// Ziffern enthalten; sie stehen hier trotzdem, damit eine kuenftige Lockerung
// der Normalisierung die Absicht nicht still aufhebt.
const KEINE_NUMMER = new Set(['anonymous', 'unknown', 'restricted', 'private', 'unavailable', 'withheld', 'null', 'undefined', 'none']);

// Diese hier faengt die Normalisierung NICHT ab: +266696687 ist ANONYMOUS auf
// der Telefontastatur und wird von mehreren Netzen genau so signalisiert. Als
// E.164 ist die Form tadellos -- ohne diese Liste waere sie eine gemeinsame
// Kennung fuer alle anonymen Anrufenden.
const PLATZHALTER_NUMMERN = new Set(['+266696687']);

function callerReference(raw) {
  const eingabe = String(raw || '').trim();
  if (!eingabe) return '';
  if (KEINE_NUMMER.has(eingabe.toLowerCase())) return '';
  const { normalized, valid } = normalizePhoneE164(eingabe);
  if (!valid || PLATZHALTER_NUMMERN.has(normalized)) return '';
  return normalized;
}

// Die Terminnummer. Sechs Ziffern, kryptografisch gezogen -- kurz genug, um sie
// am Telefon vorzulesen und aufzuschreiben, lang genug, um sie im Bestand eines
// einzelnen Betriebs nicht zufaellig zu treffen.
//
// Sie wird NICHT auf Kollisionen geprueft. Bei mehreren Treffern liest der
// Agent sie vor und laesst waehlen, statt zu raten -- dieselbe Regel gilt schon
// fuer mehrere Termine derselben Nummer.
function bookingReference() {
  return String(crypto.randomInt(0, 10 ** BUCHUNGSNUMMER_STELLEN)).padStart(BUCHUNGSNUMMER_STELLEN, '0');
}

// Was am Telefon gesprochen wird, kommt selten sauber an: "vier acht eins",
// "Nummer 481-902", "meine Terminnummer ist 481 902". Verglichen werden nur die
// Ziffern.
function normalizeBookingReference(raw) {
  const ziffern = String(raw || '').replace(/\D/g, '');
  if (ziffern.length < 4 || ziffern.length > 12) return '';
  return ziffern;
}

function identityFromBody(body) {
  return {
    callerReference: callerReference(body?.caller_id),
    bookingReference: normalizeBookingReference(body?.booking_reference)
  };
}

// STRENG. Ein Termin ohne hinterlegten Eigentuemer passt zu niemandem.
//
// Gebraucht beim Nachschlagen, also dort, wo eine Liste ausgegeben wird. Wer
// nichts vorweist, bekommt nichts zu hoeren -- auch keine Altbuchung, die vor
// dieser Aenderung entstanden ist und deshalb keine Kennung traegt. Das ist ein
// bewusster Verlust: solche Termine sind ueber das Nachschlagen nicht mehr
// auffindbar. Der Ausweg ist ein Rueckruf, nicht eine Liste fremder Termine.
function matchesCaller(termin, identitaet) {
  if (!termin) return false;
  const anrufer = String(identitaet?.callerReference || '');
  const beleg = String(identitaet?.bookingReference || '');
  if (anrufer && termin.caller_reference && termin.caller_reference === anrufer) return true;
  if (beleg && termin.booking_reference && termin.booking_reference === beleg) return true;
  return false;
}

// NACHSICHTIG. Zurueckgewiesen wird nur der WIDERSPRUCH.
//
// Gebraucht beim Absagen und Verschieben. Der Unterschied zum Nachschlagen ist
// nicht Bequemlichkeit, sondern die Frage, was der Aufrufer schon hat: das
// Nachschlagen GIBT eine Termin-ID heraus, das Absagen VERLANGT sie. Wer die ID
// bereits kennt, hat sie aus einer Voxera-Antwort -- entweder aus dem
// Buchungsgespraech oder aus einem Nachschlagen, das seinerseits gefiltert war.
//
// Deshalb: ein Termin ohne hinterlegten Eigentuemer (Altbestand) bleibt
// absagbar, ein Termin MIT hinterlegtem Eigentuemer nur fuer diesen.
function ownershipConflict(termin, identitaet) {
  if (!termin) return null;
  if (!termin.caller_reference && !termin.booking_reference) return null;
  if (matchesCaller(termin, identitaet)) return null;
  return 'calendar_appointment_not_yours';
}

module.exports = {
  BUCHUNGSNUMMER_STELLEN,
  callerReference,
  bookingReference,
  normalizeBookingReference,
  identityFromBody,
  matchesCaller,
  ownershipConflict
};
