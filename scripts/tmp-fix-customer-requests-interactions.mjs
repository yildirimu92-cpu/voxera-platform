import assert from 'node:assert/strict';
import fs from 'node:fs';

const path = 'customer-dashboard/index.html';
let source = fs.readFileSync(path, 'utf8');

const oldBlock = `  if (!el.dataset.requestsKeyboardBound) {
    el.addEventListener('keydown', function(event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var row = event.target && event.target.closest ? event.target.closest('.vx-requests-row') : null;
      if (!row || event.target.closest('button, [data-action]')) return;
      event.preventDefault();
      dprToggleClick(event, row);
    });
    el.dataset.requestsKeyboardBound = '1';
  }
`;

const newBlock = `  if (!el.dataset.requestsClickBound) {
    el.addEventListener('click', function(event) {
      var target = event.target;
      var row = target && target.closest ? target.closest('.vx-requests-row') : null;

      if (window._vxInboxSelectionMode && row) {
        var rowId = vxInboxResolveRowRecordId(target) || vxInboxResolveRowRecordId(row);
        if (rowId) {
          event.preventDefault();
          event.stopPropagation();
          vxInboxToggleSelected(rowId);
          renderAnrufe();
          return;
        }
        var blockedAction = target && target.closest ? target.closest('button, [data-action]') : null;
        if (blockedAction) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }

      var overflowButton = target && target.closest ? target.closest('[data-action="overflow"]') : null;
      if (overflowButton) {
        event.preventDefault();
        event.stopPropagation();
        var menu = overflowButton.parentElement && overflowButton.parentElement.querySelector('.vx-row-menu');
        if (menu) vxOpenFloatingRowMenu(overflowButton, menu);
        return;
      }

      var item = target && target.closest ? target.closest('.vx-requests-item') : null;
      if (!item || target.closest('button, [data-action], .vx-row-menu')) return;
      var recordId = item.dataset && item.dataset.id ? item.dataset.id : '';
      if (!recordId) return;
      if (typeof vxSetActiveRequestRow === 'function') vxSetActiveRequestRow(recordId);
      var record = typeof vxResolveDprRecord === 'function' ? vxResolveDprRecord(recordId) : null;
      if (record && typeof isManualTaskRecord === 'function' && isManualTaskRecord(record)) {
        if (typeof showTaskDetail === 'function') showTaskDetail(recordId);
      } else if (typeof showCallDetail === 'function') {
        showCallDetail(recordId);
      }
    });
    el.dataset.requestsClickBound = '1';
  }

  if (!el.dataset.requestsKeyboardBound) {
    el.addEventListener('keydown', function(event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var row = event.target && event.target.closest ? event.target.closest('.vx-requests-row') : null;
      if (!row || event.target.closest('button, [data-action]')) return;
      event.preventDefault();
      row.click();
    });
    el.dataset.requestsKeyboardBound = '1';
  }
`;

assert.equal(source.split(oldBlock).length - 1, 1, 'requests keyboard block mismatch');
source = source.replace(oldBlock, newBlock);
assert.ok(source.includes("el.dataset.requestsClickBound = '1'"), 'delegated requests click binding missing');
assert.ok(source.includes('vxOpenFloatingRowMenu(overflowButton, menu)'), 'overflow action binding missing');
assert.ok(source.includes('vxInboxToggleSelected(rowId)'), 'selection mode binding missing');
assert.ok(source.includes('row.click();'), 'keyboard activation must dispatch the canonical click path');

fs.writeFileSync(path, source, 'utf8');
console.log('Customer requests interactions restored.');
