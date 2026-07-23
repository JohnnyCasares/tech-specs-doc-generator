import { MessageType } from '../lib/messages.js';
import { insertColumn, removeAllGhosts } from '../lib/tableColumn.js';
import { insertField, resolveFieldUnit } from '../lib/cloneField.js';
import { getUnionRectInTopFrame } from '../lib/geometry.js';

// Injected on demand (all_frames: true) each time the user clicks "Activate picker".
// Guards against double-injection into the same frame by stashing state on `window`.
(function initPicker() {
  if (window.__docgenPicker) {
    window.__docgenPicker.activate('anchor');
    return;
  }

  let pickedRaw = null; // the raw element the user clicked (re-resolved at apply time)
  let styleSourceElement = null;
  let hoverEl = null;
  let pickModeActive = false;
  let pickPurpose = 'anchor'; // 'anchor' | 'style'
  let currentChangeType = 'insert-column';

  // Resolve the raw clicked node to the meaningful unit for the active change
  // type: a table cell for column inserts, a whole field unit for field inserts.
  function resolveByChangeType(el, changeType) {
    if (changeType === 'insert-field') return resolveFieldUnit(el);
    return el.closest('th, td') || el; // insert-column (and default)
  }

  const HOVER_OUTLINE = { anchor: '2px solid #2563eb', style: '2px solid #7c3aed' };

  function onMouseOver(e) {
    if (!pickModeActive) return;
    const target = pickPurpose === 'style'
      ? (e.target.closest('th, td') || e.target)
      : resolveByChangeType(e.target, currentChangeType);
    // Moving within the same resolved unit (over its nested markup) must NOT
    // re-save the outline — otherwise our own highlight gets stored as the
    // "previous" value and restoring it leaves the outline stuck on the page.
    if (target === hoverEl) return;
    clearHoverOutline();
    hoverEl = target;
    hoverEl.dataset.docgenPrevOutline = hoverEl.style.outline || '';
    hoverEl.style.outline = HOVER_OUTLINE[pickPurpose];
  }

  function clearHoverOutline() {
    if (!hoverEl) return;
    hoverEl.style.outline = hoverEl.dataset.docgenPrevOutline || '';
    delete hoverEl.dataset.docgenPrevOutline;
    hoverEl = null;
  }

  // Safety net: restore any elements still carrying a saved outline (e.g. from a
  // prior build's bug or an interrupted hover) so no stray highlights linger.
  function clearStrayOutlines() {
    document.querySelectorAll('[data-docgen-prev-outline]').forEach((elm) => {
      elm.style.outline = elm.dataset.docgenPrevOutline || '';
      delete elm.dataset.docgenPrevOutline;
    });
  }

  function describe(el) {
    return {
      tagName: el.tagName,
      preview: (el.textContent || '').trim().slice(0, 80),
    };
  }

  function onClick(e) {
    if (!pickModeActive) return;
    // Must win against the host page's own click handling (e.g. PeopleSoft's
    // PIA/iScript navigation) to avoid triggering a real click on the anchor.
    e.preventDefault();
    e.stopImmediatePropagation();

    const purpose = pickPurpose;
    clearHoverOutline();
    deactivate();

    if (purpose === 'style') {
      styleSourceElement = e.target.closest('th, td') || e.target;
      chrome.runtime.sendMessage({ type: MessageType.STYLE_SOURCE_PICKED, payload: describe(styleSourceElement) });
    } else {
      pickedRaw = e.target;
      const unit = resolveByChangeType(pickedRaw, currentChangeType);
      chrome.runtime.sendMessage({ type: MessageType.ANCHOR_PICKED, payload: describe(unit) });
    }
  }

  function activate(purpose = 'anchor') {
    pickPurpose = purpose;
    pickModeActive = true;
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('click', onClick, true);
  }

  function deactivate() {
    pickModeActive = false;
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('click', onClick, true);
    clearHoverOutline();
  }

  // Wait for the browser to lay out and paint the just-applied DOM changes
  // before measuring/capturing, so the screenshot isn't taken mid-reflow.
  function afterPaint(fn) {
    requestAnimationFrame(() => requestAnimationFrame(fn));
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.type) {
      case MessageType.SET_CHANGE_TYPE: {
        currentChangeType = msg.changeType || 'insert-column';
        sendResponse({ ok: true });
        return false;
      }
      case MessageType.ACTIVATE_STYLE_PICK: {
        activate('style');
        sendResponse({ ok: true });
        return false;
      }
      case MessageType.APPLY_CHANGE: {
        if (!pickedRaw) {
          sendResponse({ ok: false, error: 'No element picked in this frame.' });
          return false;
        }
        try {
          const changeType = msg.payload.changeType || 'insert-column';
          let elements;
          if (changeType === 'insert-field') {
            elements = insertField(resolveFieldUnit(pickedRaw), msg.payload);
          } else {
            const anchor = pickedRaw.closest('th, td') || pickedRaw;
            const headerStyleDonor = msg.payload.styleMode === 'custom' && styleSourceElement
              ? styleSourceElement
              : anchor;
            elements = insertColumn(anchor, { ...msg.payload, headerStyleDonor });
          }
          afterPaint(() => {
            let bounds;
            try {
              bounds = elements.length ? getUnionRectInTopFrame(elements) : { resolved: false };
            } catch {
              bounds = { resolved: false };
            }
            sendResponse({ ok: true, bounds });
          });
          return true; // response is sent asynchronously after paint
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
          return false;
        }
      }
      case MessageType.RESET: {
        removeAllGhosts(document);
        clearStrayOutlines();
        pickedRaw = null;
        styleSourceElement = null;
        deactivate();
        sendResponse({ ok: true });
        return false;
      }
      default:
        return false;
    }
  });

  window.__docgenPicker = { activate, deactivate };
  activate('anchor');
})();
