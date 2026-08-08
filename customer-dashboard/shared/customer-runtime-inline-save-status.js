(function initVoxeraInlineSaveStatus(root) {
  'use strict';
  if (!root || typeof root.vxInlineSaveStatus === 'function') return;

  // Shared save-feedback pattern for the customer dashboard: the button that
  // triggered the save carries the state itself (label swaps to a saving
  // label, then briefly to a done label, then reverts). Nothing else on the
  // page re-renders or scrolls while this runs. Mirrors the pattern already
  // used by vxSetActionButtonLoading / vxDv2SaveNote in index.html.
  //
  // button   - the element to animate, or null/undefined to skip the label
  //            swap entirely (e.g. a save triggered by a <select> change).
  // run      - async function performing the actual save; its resolved
  //            value is returned, its rejection is rethrown after the
  //            button has been restored.
  // options  - { savingLabel, doneLabel, holdMs }
  //            holdMs: how long the doneLabel stays visible before the
  //            button reverts (default 1400ms).
  async function vxInlineSaveStatus(button, run, options) {
    var config = options || {};
    var savingLabel = config.savingLabel || 'Speichert …';
    var doneLabel = config.doneLabel || 'Gespeichert ✓';
    var holdMs = typeof config.holdMs === 'number' ? config.holdMs : 1400;
    var originalLabel = button ? button.textContent : '';

    function restore() {
      if (!button) return;
      button.textContent = originalLabel;
      button.disabled = false;
      button.removeAttribute('aria-disabled');
    }

    if (button) {
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
      button.textContent = savingLabel;
    }

    try {
      var result = await run();
      if (button) {
        button.textContent = doneLabel;
        await new Promise(function (resolve) { root.setTimeout(resolve, holdMs); });
        restore();
      }
      return result;
    } catch (error) {
      restore();
      throw error;
    }
  }

  root.vxInlineSaveStatus = vxInlineSaveStatus;
})(typeof globalThis !== 'undefined' ? globalThis : this);
