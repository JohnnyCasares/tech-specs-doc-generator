import { MessageType } from '../lib/messages.js';
import { buildDocx } from '../lib/docxBuilder.js';

const el = {
  activatePicker: document.getElementById('activatePicker'),
  resetBtn: document.getElementById('resetBtn'),
  anchorStatus: document.getElementById('anchorStatus'),
  changeType: document.getElementById('changeType'),
  position: document.getElementById('position'),
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
  styleMode: 'anchor', // 'anchor' | 'custom'
  styleSourcePreview: null,
  beforeDataUrl: null,
  afterDataUrl: null,
  afterHighlightResolved: null,
};

// The style-source picker only makes sense for grid columns; a field insert is
// a native clone, so its style always matches. Hide the block outside column mode.
function updateChangeTypeUi() {
  el.styleBlock.hidden = el.changeType.value !== 'insert-column';
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

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === MessageType.ANCHOR_PICKED) {
    state.pickedFrameId = sender.frameId ?? 0;
    state.anchorPreview = msg.payload;
    el.anchorStatus.textContent = `Picked <${msg.payload.tagName.toLowerCase()}> "${msg.payload.preview || '(empty)'}"`;
    log('Element picked. Fill in the change details, then capture before/after.');
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
  state.styleMode = 'anchor';
  state.styleSourcePreview = null;
  state.beforeDataUrl = null;
  state.afterDataUrl = null;
  state.afterHighlightResolved = null;
  el.anchorStatus.textContent = 'No element picked yet.';
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
          position: el.position.value,
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

    const isField = el.changeType.value === 'insert-field';

    let caveat = isField
      ? 'The new field is a visual mock cloned from an existing field (ids and values stripped); wiring it to a real data source is up to the developer.'
      : 'Column insertion aligns cells by summed colSpan; complex grids with rowSpan on earlier columns may need manual adjustment by the developer.';
    if (state.afterHighlightResolved === false) {
      caveat += ' The "after" screenshot has no highlight box — the change location could not be geometrically resolved (likely a cross-origin nested frame).';
    }

    let styleBasis;
    if (isField) {
      styleBasis = 'Cloned from the picked field, so styling matches natively.';
    } else if (state.styleMode === 'custom' && state.styleSourcePreview) {
      styleBasis = `Matches the style of <${state.styleSourcePreview.tagName.toLowerCase()}> "${state.styleSourcePreview.preview || '(empty)'}"`;
    } else {
      styleBasis = 'Matches the style of the picked column header';
    }

    const blob = await buildDocx({
      pageUrl: state.pageUrl,
      requestedBy: el.requestedBy.value.trim(),
      changeType: el.changeType.selectedOptions[0].textContent,
      position: el.position.value,
      fieldName: el.fieldName.value.trim(),
      styleBasis,
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
