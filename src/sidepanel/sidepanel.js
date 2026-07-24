import { MessageType } from '../lib/messages.js';
import { buildDocx } from '../lib/docxBuilder.js';

const el = {
  activatePicker: document.getElementById('activatePicker'),
  resetBtn: document.getElementById('resetBtn'),
  anchorStatus: document.getElementById('anchorStatus'),
  changeType: document.getElementById('changeType'),
  dirpad: document.getElementById('dirpad'),
  dirHint: document.getElementById('dirHint'),
  fieldName: document.getElementById('fieldName'),
  styleBlock: document.getElementById('styleBlock'),
  styleStatus: document.getElementById('styleStatus'),
  pickStyleSource: document.getElementById('pickStyleSource'),
  resetStyleSource: document.getElementById('resetStyleSource'),
  notes: document.getElementById('notes'),
  requestedBy: document.getElementById('requestedBy'),
  captureBefore: document.getElementById('captureBefore'),
  applyAndCaptureAfter: document.getElementById('applyAndCaptureAfter'),
  beforeThumb: document.getElementById('beforeThumb'),
  afterThumb: document.getElementById('afterThumb'),
  generateDocx: document.getElementById('generateDocx'),
  log: document.getElementById('log'),
};

const state = {
  tabId: null,
  windowId: null,
  pageUrl: '',
  pickedFrameId: null,
  anchorPreview: null,
  pickMeta: null, // spec metadata about the picked element (kind, fieldId, label, controlType, required)
  effectiveType: null, // resolved change type from auto-detect: 'insert-column' | 'insert-element'
  direction: 'below', // above | below | left | right
  styleMode: 'anchor', // 'anchor' | 'custom'
  styleSourcePreview: null,
  beforeDataUrl: null,
  afterDataUrl: null,
  afterHighlightResolved: null,
};

const DIR_LABELS = { above: 'Above', below: 'Below', left: 'Left', right: 'Right' };

function setDirection(dir) {
  state.direction = dir;
  el.dirpad.querySelectorAll('.dir').forEach((b) => b.classList.toggle('selected', b.dataset.dir === dir));
  el.dirHint.textContent = DIR_LABELS[dir] || dir;
}

el.dirpad.addEventListener('click', (e) => {
  const btn = e.target.closest('.dir');
  if (btn && !btn.disabled) setDirection(btn.dataset.dir);
});

// The change type that's actually in effect: the manual override if the user
// chose one, otherwise whatever auto-detect resolved on the last pick.
function effectiveTypeNow() {
  const dd = el.changeType.value;
  if (dd !== 'auto') return dd;
  return state.effectiveType;
}

// A doc-friendly change-type label from the effective type + detected kind.
function changeTypeLabel() {
  const eff = effectiveTypeNow();
  if (eff === 'insert-column') return 'Insert table column';
  if (eff === 'insert-element') return state.pickMeta?.kind ? `Insert ${state.pickMeta.kind}` : 'Insert element';
  return el.changeType.selectedOptions[0].textContent;
}

// The style-source picker only makes sense for grid columns; a field insert is
// a native clone, so its style always matches. Columns are horizontal, so
// above/below don't apply there. Driven by the effective (detected/overridden) type.
function updateChangeTypeUi() {
  const isColumn = effectiveTypeNow() === 'insert-column';
  el.styleBlock.hidden = !isColumn;

  el.dirpad.querySelectorAll('.dir').forEach((b) => {
    const vertical = b.dataset.dir === 'above' || b.dataset.dir === 'below';
    b.disabled = isColumn && vertical;
  });
  if (isColumn && (state.direction === 'above' || state.direction === 'below')) setDirection('right');
  else setDirection(state.direction);
}

// Keep the injected picker's hover-snapping aligned with the selected change
// type (cell vs field unit). Best-effort: no-op if the picker isn't injected yet.
async function syncChangeTypeToPicker() {
  if (state.tabId == null) return;
  try {
    await chrome.tabs.sendMessage(state.tabId, {
      type: MessageType.SET_CHANGE_TYPE,
      changeType: el.changeType.value,
    });
  } catch {
    // Picker not injected in any frame yet; it will be told on activation.
  }
}

el.changeType.addEventListener('change', () => {
  updateChangeTypeUi();
  syncChangeTypeToPicker();
});

function updateStyleStatus() {
  if (state.styleMode === 'custom' && state.styleSourcePreview) {
    const p = state.styleSourcePreview;
    el.styleStatus.textContent = `Matches <${p.tagName.toLowerCase()}> "${p.preview || '(empty)'}"`;
    el.resetStyleSource.hidden = false;
  } else {
    el.styleStatus.textContent = 'Matches the picked element.';
    el.resetStyleSource.hidden = true;
  }
}

function log(message, isError = false) {
  el.log.textContent = message;
  el.log.classList.toggle('error', isError);
}

async function refreshActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    state.tabId = tab.id;
    state.windowId = tab.windowId;
    state.pageUrl = tab.url || '';
  }
  return tab;
}

chrome.tabs.onActivated.addListener(refreshActiveTab);
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === state.tabId && changeInfo.url) state.pageUrl = changeInfo.url;
});

// Human-readable summary of the picked element, incl. PeopleSoft identity.
function describePickText(m) {
  if (!m) return 'No element picked yet.';
  if (m.kind === 'field') {
    const bits = [m.label ? `"${m.label}"` : '(no label)'];
    if (m.controlType) bits.push(m.controlType);
    if (m.required) bits.push('required');
    if (m.fieldId) bits.push(`id: ${m.fieldId}`);
    return `Detected field — ${bits.join(' · ')}`;
  }
  if (m.kind === 'grid-column') return `Detected column — "${m.label || '(empty)'}"`;
  if (m.kind) return `Detected ${m.kind} — "${m.label || '(empty)'}"`;
  return `Detected <${(m.tagName || '').toLowerCase()}>`;
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === MessageType.ANCHOR_PICKED) {
    state.pickedFrameId = sender.frameId ?? 0;
    state.anchorPreview = msg.payload;
    state.pickMeta = msg.payload;
    state.effectiveType = msg.payload.changeType || null;
    el.anchorStatus.textContent = describePickText(msg.payload);
    updateChangeTypeUi();
    log('Element detected. Set placement/details, then capture before/after.');
  } else if (msg.type === MessageType.STYLE_SOURCE_PICKED) {
    state.styleMode = 'custom';
    state.styleSourcePreview = msg.payload;
    updateStyleStatus();
    log('Style source picked — the new column will copy this element\'s look.');
  }
});

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load screenshot image.'));
    img.src = src;
  });
}

async function drawHighlight(dataUrl, bounds) {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  const dpr = bounds.devicePixelRatio || 1;
  const x = bounds.x * dpr;
  const y = bounds.y * dpr;
  const w = bounds.width * dpr;
  const h = bounds.height * dpr;

  ctx.lineWidth = 4;
  ctx.strokeStyle = '#dc2626';
  ctx.strokeRect(x - 4, y - 4, w + 8, h + 8);
  ctx.fillStyle = 'rgba(220, 38, 38, 0.12)';
  ctx.fillRect(x, y, w, h);

  return canvas.toDataURL('image/png');
}

async function dataUrlToArrayBuffer(dataUrl) {
  const res = await fetch(dataUrl);
  return res.arrayBuffer();
}

el.activatePicker.addEventListener('click', async () => {
  try {
    const tab = await refreshActiveTab();
    if (!tab) throw new Error('No active tab found.');
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['dist/picker.js'],
    });
    await syncChangeTypeToPicker();
    log('Picker active — click the element on the page to anchor the change.');
  } catch (err) {
    log(`Could not access the page (${err.message}). Click the extension icon again and retry.`, true);
  }
});

el.pickStyleSource.addEventListener('click', async () => {
  if (state.pickedFrameId == null) {
    log('Pick the anchor element first, then choose a style source.', true);
    return;
  }
  try {
    // Re-inject in case the picker isn't loaded yet (e.g. after a reload), then
    // switch the picker in the anchor's frame into style-pick mode. The style
    // source must live in the same frame as the anchor so insertColumn can read
    // its computed style at apply time.
    await chrome.scripting.executeScript({
      target: { tabId: state.tabId, frameIds: [state.pickedFrameId] },
      files: ['dist/picker.js'],
    });
    await chrome.tabs.sendMessage(state.tabId, { type: MessageType.ACTIVATE_STYLE_PICK }, { frameId: state.pickedFrameId });
    log('Style pick active — click the element whose style the new column should copy.');
  } catch (err) {
    log(`Could not start style picking (${err.message}). Click the extension icon again and retry.`, true);
  }
});

el.resetStyleSource.addEventListener('click', () => {
  state.styleMode = 'anchor';
  state.styleSourcePreview = null;
  updateStyleStatus();
  log('Style source reset to the picked element.');
});

el.resetBtn.addEventListener('click', async () => {
  if (state.tabId != null && state.pickedFrameId != null) {
    try {
      await chrome.tabs.sendMessage(state.tabId, { type: MessageType.RESET }, { frameId: state.pickedFrameId });
    } catch {
      // Frame may have navigated away already; nothing to clean up in that case.
    }
  }
  state.pickedFrameId = null;
  state.anchorPreview = null;
  state.pickMeta = null;
  state.effectiveType = null;
  state.styleMode = 'anchor';
  state.styleSourcePreview = null;
  state.beforeDataUrl = null;
  state.afterDataUrl = null;
  state.afterHighlightResolved = null;
  el.anchorStatus.textContent = 'No element picked yet.';
  updateChangeTypeUi();
  updateStyleStatus();
  el.beforeThumb.src = '';
  el.afterThumb.src = '';
  el.generateDocx.disabled = true;
  log('Reset.');
});

el.captureBefore.addEventListener('click', async () => {
  try {
    const tab = await refreshActiveTab();
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    state.beforeDataUrl = dataUrl;
    el.beforeThumb.src = dataUrl;
    log('"Before" captured.');
  } catch (err) {
    log(`Could not capture the page (${err.message}). Click the extension icon again and retry.`, true);
  }
});

el.applyAndCaptureAfter.addEventListener('click', async () => {
  if (state.pickedFrameId == null) {
    log('Pick an element first.', true);
    return;
  }
  if (!el.fieldName.value.trim()) {
    log('Enter a new column name first.', true);
    return;
  }

  try {
    const tab = await refreshActiveTab();
    const response = await chrome.tabs.sendMessage(
      tab.id,
      {
        type: MessageType.APPLY_CHANGE,
        payload: {
          changeType: el.changeType.value,
          direction: state.direction,
          fieldName: el.fieldName.value.trim(),
          styleMode: state.styleMode,
        },
      },
      { frameId: state.pickedFrameId },
    );

    if (!response?.ok) {
      throw new Error(response?.error || 'Applying the change failed.');
    }

    // The picker only responds after the change has painted (double rAF); this
    // extra margin covers slower reflows on large grids before we capture.
    await new Promise((r) => setTimeout(r, 150));
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });

    if (response.bounds?.resolved) {
      state.afterDataUrl = await drawHighlight(dataUrl, response.bounds);
      state.afterHighlightResolved = true;
    } else {
      state.afterDataUrl = dataUrl;
      state.afterHighlightResolved = false;
      log('Change applied (couldn\'t compute a precise highlight box in this frame — screenshot has no callout).');
    }

    el.afterThumb.src = state.afterDataUrl;
    el.generateDocx.disabled = false;
    if (state.afterHighlightResolved) log('Change applied and "after" captured.');
  } catch (err) {
    log(`Could not apply the change (${err.message}).`, true);
  }
});

el.generateDocx.addEventListener('click', async () => {
  try {
    el.generateDocx.disabled = true;
    log('Generating document…');

    const [beforeImageArrayBuffer, afterImageArrayBuffer] = await Promise.all([
      state.beforeDataUrl ? dataUrlToArrayBuffer(state.beforeDataUrl) : null,
      state.afterDataUrl ? dataUrlToArrayBuffer(state.afterDataUrl) : null,
    ]);

    const isClone = effectiveTypeNow() === 'insert-element';

    let caveat = isClone
      ? 'The new element is a visual mock cloned from an existing one (ids, values, and click actions stripped); wiring it to real data or navigation is up to the developer.'
      : 'Column insertion aligns cells by summed colSpan; complex grids with rowSpan on earlier columns may need manual adjustment by the developer.';
    if (state.afterHighlightResolved === false) {
      caveat += ' The "after" screenshot has no highlight box — the change location could not be geometrically resolved (likely a cross-origin nested frame).';
    }

    let styleBasis;
    if (isClone) {
      styleBasis = 'Cloned from the picked element, so styling matches natively.';
    } else if (state.styleMode === 'custom' && state.styleSourcePreview) {
      styleBasis = `Matches the style of <${state.styleSourcePreview.tagName.toLowerCase()}> "${state.styleSourcePreview.preview || '(empty)'}"`;
    } else {
      styleBasis = 'Matches the style of the picked column header';
    }

    const blob = await buildDocx({
      pageUrl: state.pageUrl,
      requestedBy: el.requestedBy.value.trim(),
      changeType: changeTypeLabel(),
      direction: state.direction,
      fieldName: el.fieldName.value.trim(),
      styleBasis,
      target: state.pickMeta,
      notes: el.notes.value.trim(),
      caveat,
      beforeImageArrayBuffer,
      afterImageArrayBuffer,
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ui-change-${Date.now()}.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    log('Document generated and downloaded.');
  } catch (err) {
    log(`Failed to generate document (${err.message}).`, true);
  } finally {
    el.generateDocx.disabled = false;
  }
});

updateChangeTypeUi();
refreshActiveTab();
