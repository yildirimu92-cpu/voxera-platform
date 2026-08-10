/**
 * core/admin-format.js — Zahlen, Beträge und Daten in Schweizer Schreibweise.
 *
 * Welle 1 des Admin-Zielbilds. Ersetzt den Formatierungsteil von
 * `shared/admin-runtime-invoice-only-ch.js`.
 *
 * Warum es diese Datei gibt
 * ------------------------
 * Der abgelöste Patch lief alle 1200 ms über JEDEN Textknoten des Dokuments und
 * schrieb um, was nach Datum oder CHF-Betrag aussah. Das hat Inhalte zerstört:
 * aus "Basis 5 CHF + 0.018 CHF/Minute" wurde im Browser
 * "Basis CHF 5.00 + 0.CHF 18.00/Minute", weil der Ausdruck nach dem Punkt in
 * "0.018" eine Wortgrenze fand und "018 CHF" als eigenen Betrag las.
 *
 * Zwei Änderungen gegenüber dem Patch:
 *
 * 1. Der Ausdruck erkennt die Zahl vollständig und lässt alles in Ruhe, was
 *    unmittelbar an eine Ziffer, einen Punkt oder ein Komma grenzt.
 * 2. Beträge mit drei oder mehr Nachkommastellen werden NICHT angefasst. Ein
 *    Minutentarif von 0.018 CHF ist kein Rechnungsbetrag und darf nicht auf
 *    zwei Stellen gerundet werden.
 *
 * Kein Dauer-Timer mehr (Regel R6): `localize()` wird von den Stellen gerufen,
 * die etwas gerendert haben — nach dem Datenladen, nach einem Routenwechsel und
 * als Sicherheitsnetz kurz nach einem Klick.
 *
 * Übergangscharakter: Auf Dauer formatiert jeder Screen seine eigene Ausgabe
 * über `chf()` / `date()` beim Rendern, und `localize()` verschwindet. Solange
 * die Screens noch rohe ISO-Daten und nackte Beträge ausgeben, bleibt dieser
 * Nachlauf bestehen — dann aber ohne Inhalte zu zerstören.
 */
(function (root) {
  'use strict';
  if (!root || typeof document === 'undefined') return;

  var SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'CODE', 'PRE', 'SVG', 'PATH']);

  /** Wandelt "1'234,50" / "1234.50" in eine Zahl. Gibt null bei Unsinn. */
  function parseAmount(raw) {
    var value = String(raw == null ? '' : raw).replace(/[\s'’]/g, '');
    if (!value) return null;
    var hasComma = value.indexOf(',') >= 0;
    var hasDot = value.indexOf('.') >= 0;
    if (hasComma && hasDot) {
      if (value.lastIndexOf(',') > value.lastIndexOf('.')) value = value.replace(/\./g, '').replace(',', '.');
      else value = value.replace(/,/g, '');
    } else if (hasComma) {
      value = value.replace(',', '.');
    }
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /** Zahl → "1'234.50" (ohne Währungszeichen). */
  function amount(value) {
    var parsed = typeof value === 'number' ? value : parseAmount(value);
    if (parsed == null) return null;
    return new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parsed);
  }

  /** Zahl → "CHF 1'234.50". */
  function chf(value) {
    var formatted = amount(value);
    return formatted == null ? '' : 'CHF ' + formatted;
  }

  function formatDate(value, includeTime) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value == null ? '' : value);
    var options = { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Zurich' };
    if (includeTime) {
      options.hour = '2-digit';
      options.minute = '2-digit';
    }
    return new Intl.DateTimeFormat('de-CH', options).format(date);
  }

  function date(value) { return formatDate(value, false); }
  function dateTime(value) { return formatDate(value, true); }

  /**
   * Zählt die Nachkommastellen einer roh geschriebenen Zahl.
   * "0.018" → 3, "5" → 0, "12.50" → 2.
   */
  function decimals(raw) {
    var match = String(raw == null ? '' : raw).replace(/[\s'’]/g, '').match(/[.,](\d+)$/);
    return match ? match[1].length : 0;
  }

  /**
   * Formatiert Beträge und Daten in einer Zeichenkette.
   *
   * Bewusst konservativ: Was nicht eindeutig als Betrag oder Datum erkennbar
   * ist, bleibt unverändert. Lieber eine Stelle unformatiert als eine Stelle
   * zerstört.
   */
  function text(value) {
    var out = String(value == null ? '' : value);

    // ISO-Zeitstempel und ISO-Daten.
    out = out.replace(/\b(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?Z\b/g, function (match) {
      return formatDate(match, true);
    });
    out = out.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, function (match) {
      return formatDate(match + 'T12:00:00Z', false);
    });

    // Schweizer Datum auf zweistellige Tages-/Monatszahl bringen.
    out = out.replace(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/g, function (_match, day, month, year) {
      return String(day).padStart(2, '0') + '.' + String(month).padStart(2, '0') + '.' + year;
    });

    // "CHF 5" → "CHF 5.00". Das vorangestellte Zeichen wird mitgefangen, damit
    // die Ersetzung nie mitten in einer längeren Zahl ansetzt.
    out = out.replace(/(^|[^\d.,'’])CHF\s*([+-]?\d[\d'’ ]*(?:[.,]\d+)?)/g, function (match, pre, raw) {
      if (decimals(raw) > 2) return match;   // Tarif, kein Rechnungsbetrag
      var formatted = amount(raw);
      return formatted == null ? match : pre + 'CHF ' + formatted;
    });

    // "5 CHF" → "CHF 5.00", mit derselben Vorsichtsregel.
    out = out.replace(/(^|[^\d.,'’])([+-]?\d[\d'’ ]*(?:[.,]\d+)?)\s*CHF\b/g, function (match, pre, raw) {
      if (decimals(raw) > 2) return match;   // "0.018 CHF/Minute" bleibt stehen
      var formatted = amount(raw);
      return formatted == null ? match : pre + 'CHF ' + formatted;
    });

    return out;
  }

  /**
   * Wendet `text()` auf die sichtbaren Textknoten unterhalb von `node` an.
   * Übergangsmechanismus, siehe Kopfkommentar.
   */
  function localize(node) {
    var target = node || document.querySelector('.main') || document.body;
    if (!target || typeof document.createTreeWalker !== 'function') return;
    var walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, {
      acceptNode: function (candidate) {
        var parent = candidate.parentElement;
        if (!parent || SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.closest('[contenteditable="true"],[data-vx-no-format]')) return NodeFilter.FILTER_REJECT;
        var value = String(candidate.nodeValue || '');
        if (!value.trim()) return NodeFilter.FILTER_REJECT;
        if (!/\d{4}-\d{2}-\d{2}/.test(value) && !/\bCHF\b/.test(value) && !/\b\d{1,2}\.\d{1,2}\.\d{4}\b/.test(value)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (candidate) {
      var next = text(candidate.nodeValue);
      if (next !== candidate.nodeValue) candidate.nodeValue = next;
    });
  }

  /** Formatiert das Hauptfenster und alle offenen Dialoge. */
  function localizeAll() {
    localize(document.querySelector('.main') || document.body);
    document.querySelectorAll('.modal-overlay.open').forEach(localize);
  }

  document.documentElement.lang = 'de-CH';

  // Sicherheitsnetz, solange die Screens ihre Ausgabe noch nicht selbst
  // formatieren: nach einem Klick kann neuer Inhalt im DOM stehen. Kein
  // Intervall — der Nachlauf hängt an echten Ereignissen.
  document.addEventListener('click', function () { setTimeout(localizeAll, 80); }, true);
  root.addEventListener('hashchange', function () { setTimeout(localizeAll, 80); });

  root.VoxeraFormat = {
    amount: amount,
    chf: chf,
    date: date,
    dateTime: dateTime,
    parseAmount: parseAmount,
    text: text,
    localize: localize,
    localizeAll: localizeAll
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
