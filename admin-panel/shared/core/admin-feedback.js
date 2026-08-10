/**
 * core/admin-feedback.js — Rückmeldung an den Admin: ein Toast, ein Dialog.
 *
 * Welle 1 des Admin-Zielbilds, Regel R4: eine Fehlerbehandlung, eine Tonalität.
 *
 * Ausgangslage
 * ------------
 * Das Portal hatte drei Rückmeldesysteme nebeneinander: 111 `showToast`, 27
 * gestaltete Dialoge (`voxAlert`/`voxConfirm`/`voxPrompt`) und 44 native
 * Browser-Kästen (`alert`/`confirm`) ohne jedes Voxera-Design. Der native Kasten
 * erschien unter anderem beim Deaktivieren eines Admins und beim Speichern.
 *
 * Diese Datei bündelt beides, was bleiben soll. Die Dialogfunktionen sind
 * unverändert aus `index.html` hierher gezogen — gleiche Namen, gleiches
 * Verhalten, gleiche DOM-Ids (`#vox-dialog-*`). Die nativen Kästen werden an
 * ihren 44 Aufrufstellen durch `voxAlert` / `voxConfirm` ersetzt.
 *
 * Bewusst NICHT Teil dieser Welle
 * -------------------------------
 * Das Aussehen des Toasts. Die dunkle Pille ohne Tonalität ist ein eigener,
 * noch nicht beauftragter Punkt. `toast()` nimmt deshalb schon einen `tone`
 * entgegen und legt ihn als `data-tone` an das Element — sichtbar ändert sich
 * nichts. Wenn der Toast-Auftrag kommt, ist diese eine Funktion die einzige
 * Stelle, die angefasst werden muss.
 */
(function (root) {
  'use strict';
  if (!root || typeof document === 'undefined') return;

  var TONES = new Set(['info', 'success', 'warning', 'error']);

  /* ── Toast ──────────────────────────────────────────────────────────────── */

  /**
   * @param {string} message
   * @param {object|number} [options] Zahl = Anzeigedauer (Rückwärtskompatibilität
   *        zur alten Signatur `showToast(msg, duration)`).
   */
  function toast(message, options) {
    var settings = typeof options === 'number' ? { duration: options } : (options || {});
    var duration = Number.isFinite(settings.duration) ? settings.duration : 3000;
    var tone = TONES.has(settings.tone) ? settings.tone : 'info';

    var element = document.getElementById('toast');
    if (!element) {
      // Kein Toast-Element im DOM: die Meldung darf trotzdem nicht verloren
      // gehen. Früher stand hier ein natives alert() — jetzt der eigene Dialog.
      notice({ message: String(message == null ? '' : message) });
      return;
    }

    element.textContent = String(message == null ? '' : message);
    element.dataset.tone = tone;
    element.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    element.setAttribute('aria-live', tone === 'error' ? 'assertive' : 'polite');
    element.style.opacity = '1';
    clearTimeout(element._timer);
    element._timer = setTimeout(function () { element.style.opacity = '0'; }, duration);
  }

  /* ── Dialog ─────────────────────────────────────────────────────────────── */
  /* Unverändert aus index.html übernommen (Block „Shared Dialog"). */

  var pendingResolve = null;

  function dialogResolve(value) {
    if (!pendingResolve) return;
    var fn = pendingResolve;
    pendingResolve = null;
    var modal = document.getElementById('vox-dialog-modal');
    if (modal) modal.classList.remove('open');
    fn(value);
  }

  function dialogReset() {
    // Hängt noch ein Dialog offen, wird er sauber abgebrochen statt vergessen.
    if (pendingResolve) {
      var previous = pendingResolve;
      pendingResolve = null;
      previous(null);
    }
  }

  function confirm(settings) {
    var options = settings || {};
    var title = options.title || 'Bestätigen';
    var message = options.message || '';
    var confirmText = options.confirmText || 'Bestätigen';
    var cancelText = options.cancelText || 'Abbrechen';
    var danger = Boolean(options.danger);

    dialogReset();
    return new Promise(function (resolve) {
      pendingResolve = resolve;
      document.getElementById('vox-dialog-title').textContent = title;
      var bodyEl = document.getElementById('vox-dialog-body');
      bodyEl.innerHTML = String(message).replace(/\n/g, '<br>');
      bodyEl.style.display = message ? 'block' : 'none';
      document.getElementById('vox-dialog-input-wrap').style.display = 'none';
      var cancelBtn = document.getElementById('vox-dialog-cancel');
      var confirmBtn = document.getElementById('vox-dialog-confirm');
      cancelBtn.textContent = cancelText;
      cancelBtn.style.display = '';
      confirmBtn.textContent = confirmText;
      confirmBtn.className = danger ? 'btn btn-danger' : 'btn btn-primary';
      cancelBtn.onclick = function () { dialogResolve(false); };
      confirmBtn.onclick = function () { dialogResolve(true); };
      document.getElementById('vox-dialog-modal').classList.add('open');
    });
  }

  function notice(settings) {
    var options = settings || {};
    var title = options.title || 'Hinweis';
    var message = options.message || '';
    var confirmText = options.confirmText || 'OK';

    dialogReset();
    return new Promise(function (resolve) {
      pendingResolve = resolve;
      document.getElementById('vox-dialog-title').textContent = title;
      var bodyEl = document.getElementById('vox-dialog-body');
      bodyEl.innerHTML = String(message).replace(/\n/g, '<br>');
      bodyEl.style.display = message ? 'block' : 'none';
      document.getElementById('vox-dialog-input-wrap').style.display = 'none';
      var cancelBtn = document.getElementById('vox-dialog-cancel');
      var confirmBtn = document.getElementById('vox-dialog-confirm');
      cancelBtn.style.display = 'none';
      confirmBtn.textContent = confirmText;
      confirmBtn.className = 'btn btn-primary';
      confirmBtn.onclick = function () { dialogResolve(true); };
      document.getElementById('vox-dialog-modal').classList.add('open');
    });
  }

  function prompt(settings) {
    var options = settings || {};
    var title = options.title || 'Eingabe';
    var message = options.message || '';
    var label = options.label || '';
    var placeholder = options.placeholder || '';
    var defaultValue = options.defaultValue || '';
    var confirmText = options.confirmText || 'Speichern';
    var cancelText = options.cancelText || 'Abbrechen';
    var required = Boolean(options.required);

    dialogReset();
    return new Promise(function (resolve) {
      pendingResolve = resolve;
      document.getElementById('vox-dialog-title').textContent = title;
      var bodyEl = document.getElementById('vox-dialog-body');
      bodyEl.innerHTML = message ? String(message).replace(/\n/g, '<br>') : '';
      bodyEl.style.display = message ? 'block' : 'none';
      document.getElementById('vox-dialog-input-wrap').style.display = 'block';
      var labelEl = document.getElementById('vox-dialog-input-label');
      labelEl.textContent = label;
      labelEl.style.display = label ? 'block' : 'none';
      var errorEl = document.getElementById('vox-dialog-input-error');
      errorEl.style.display = 'none';
      var inputEl = document.getElementById('vox-dialog-input');
      inputEl.placeholder = placeholder;
      inputEl.value = defaultValue;
      var cancelBtn = document.getElementById('vox-dialog-cancel');
      var confirmBtn = document.getElementById('vox-dialog-confirm');
      cancelBtn.textContent = cancelText;
      cancelBtn.style.display = '';
      confirmBtn.textContent = confirmText;
      confirmBtn.className = 'btn btn-primary';
      cancelBtn.onclick = function () { dialogResolve(null); };
      confirmBtn.onclick = function () {
        var value = String(inputEl.value || '').trim();
        if (required && !value) {
          errorEl.textContent = 'Eingabe erforderlich.';
          errorEl.style.display = 'block';
          inputEl.focus();
          return;
        }
        dialogResolve(value);
      };
      document.getElementById('vox-dialog-modal').classList.add('open');
      setTimeout(function () { inputEl.focus(); }, 50);
    });
  }

  root.VoxeraFeedback = {
    toast: toast,
    notice: notice,
    confirm: confirm,
    prompt: prompt,
    reset: dialogReset,
    resolve: dialogResolve
  };

  // Die eingeführten Namen bleiben, damit die 138 bestehenden Aufrufstellen
  // unverändert weiterlaufen. Sie zeigen jetzt hierher statt auf eigene
  // Implementierungen in index.html.
  root.showToast = toast;
  root.voxAlert = notice;
  root.voxConfirm = confirm;
  root.voxPrompt = prompt;
  root.voxDialogResolve = dialogResolve;
  root._voxDialogReset = dialogReset;
})(typeof globalThis !== 'undefined' ? globalThis : window);
