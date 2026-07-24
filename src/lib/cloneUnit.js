// Universal (non-grid) "insert" change: duplicate an existing UI unit as a
// proposed new one, by cloning it. PeopleSoft renders nearly everything as a
// self-contained ps_box-* / grid-row wrapper, so one resolver + clone covers
// tiles, buttons, menu items, and group boxes. Fields are handled specially so
// a field always brings its LABEL along, even in classic layouts where the two
// are separate siblings (see fieldModel.js). Cloning makes the mock pixel-native
// for free; we then clear text inputs, neutralize behavior (onclick/href), and
// relabel.

import { resolveFieldGroup } from './fieldModel.js';

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

// Input types that hold user-entered text (worth clearing on a clone). Button/
// checkbox/radio/etc. are excluded — clearing a button input's `value` erases
// its caption, which made cloned buttons render empty.
const TEXT_ENTRY_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', '']);

function isTextEntry(el) {
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  return TEXT_ENTRY_TYPES.has((el.getAttribute('type') || '').toLowerCase());
}

function isButtonControl(el) {
  return el.matches && el.matches('input[type=button], input[type=submit], input[type=reset]');
}

// Priority-ordered: the FIRST rule whose selector matches an ancestor wins, so
// a specific unit (tile, button, group box) beats the broad catch-all. Tiles
// resolve to their flex grid-row so the clone lays out as a proper new tile.
const UNIT_RULES = [
  '.ps_grid-row.nuitile',                                        // homepage tile (flex grid item)
  '.ps_box-button, .PSPUSHBUTTONWRAPPER',                        // button / header icon / menu item
  'input[type=button], input[type=submit], input[type=reset], button, a[role="button"]', // bare button
  'fieldset, .ps_box-group',                                     // group box / section (broad, last)
];

export function resolveUnit(el) {
  for (const sel of UNIT_RULES) {
    const hit = el.closest(sel);
    if (hit) return hit;
  }
  let cur = el;
  for (let i = 0; i < 6 && cur; i++) {
    if (cur.querySelector && cur.querySelector('input, select, textarea')) return cur;
    cur = cur.parentElement;
  }
  return el.closest('a, button, li') || el;
}

function describeUnit(unit) {
  const cls = (unit.className || '').toString();
  if (unit.matches('[aria-roledescription="Tile"], .ps_grid-row.nuitile') || /nuitile|nuilp/.test(cls)) {
    return { kind: 'tile', label: norm(unit.querySelector('.ps-label')?.textContent || unit.textContent).slice(0, 60) };
  }
  if (unit.matches('.ps_box-button, .PSPUSHBUTTONWRAPPER, button, a[role="button"]') || /PSPUSHBUTTON|ps_box-button/.test(cls)) {
    return { kind: 'button', label: norm(unit.textContent) || unit.querySelector?.('input')?.value || '' };
  }
  if (unit.matches('fieldset, .ps_box-group')) {
    return { kind: 'section', label: norm(unit.querySelector('.ps-label, legend, h1, h2, h3')?.textContent).slice(0, 60) };
  }
  return { kind: 'element', label: norm(unit.textContent).slice(0, 60) };
}

// Resolve whatever the user clicked into a clone target: a field (with its
// label paired in), or a standalone unit (tile/button/section). Returns
// { nodes, labelNode, fieldNode, meta } — `nodes` are the element(s) to clone.
export function resolveInsertTarget(el) {
  const field = resolveFieldGroup(el);
  if (field) {
    return { nodes: field.nodes, labelNode: field.labelNode, fieldNode: field.fieldNode, meta: field.meta };
  }
  const unit = resolveUnit(el);
  return { nodes: [unit], labelNode: unit, fieldNode: null, meta: describeUnit(unit) };
}

// The column header text for a body cell, by matching column index in the table.
function columnHeaderForCell(td) {
  const table = td.closest('table');
  const headerRow = table && table.tHead && table.tHead.rows[0];
  if (!headerRow) return norm(td.textContent).slice(0, 40);
  let idx = 0;
  for (const c of td.parentElement.children) {
    if (c === td) break;
    idx += c.colSpan || 1;
  }
  let running = 0;
  for (const th of headerRow.children) {
    if (running === idx) return norm(th.textContent).slice(0, 40);
    running += th.colSpan || 1;
  }
  return norm(td.textContent).slice(0, 40);
}

// Auto-detect what the user is pointing at, so they don't pick a change type by
// hand. Returns { changeType, target, meta } where `target` is the element to
// highlight on hover. Precedence: table header → column; a form field →
// element; a data-grid body cell → column; anything else → its nearest unit.
export function classifyElement(el) {
  const th = el.closest('th');
  if (th && th.closest('table')) {
    return { changeType: 'insert-column', target: th, meta: { kind: 'grid-column', label: norm(th.textContent).slice(0, 40) } };
  }

  const field = resolveFieldGroup(el);
  if (field) {
    return { changeType: 'insert-element', target: field.fieldNode || field.nodes[0], meta: field.meta };
  }

  const td = el.closest('td');
  if (td) {
    const table = td.closest('table');
    if (table && table.querySelector('th')) {
      return { changeType: 'insert-column', target: td, meta: { kind: 'grid-column', label: columnHeaderForCell(td) } };
    }
  }

  const unit = resolveUnit(el);
  return { changeType: 'insert-element', target: unit, meta: describeUnit(unit) };
}

function sanitizeClone(clone) {
  const els = [clone, ...clone.querySelectorAll('*')];
  for (const el of els) {
    if (el.removeAttribute) {
      el.removeAttribute('id'); // avoid duplicate ids (PeopleSoft styles by class, so look is preserved)
      el.removeAttribute('onclick'); // neutralize navigation / tile-launch behavior on the mock
      el.removeAttribute('href');
      el.removeAttribute('groupletid');
    }
    if (el.matches && el.matches('input, select, textarea')) {
      el.removeAttribute('name'); // never participate in a form submit
      if (isTextEntry(el)) {
        el.value = '';
        el.removeAttribute('value');
        el.readOnly = true;
      }
    }
  }
}

// Set the mock's caption to the new name, wherever the caption lives: a field
// label (Fluid `.ps-label` / classic `.PSEDITBOXLABEL`), a button's `value`, or
// a link/button's text.
function relabel(clone, name) {
  if (!name) return;

  const labelTarget = clone.querySelector('.ps-label, .PSEDITBOXLABEL, .ps_box-label label, label')
    || (clone.matches('.ps-label, .PSEDITBOXLABEL, label') ? clone : null);
  if (labelTarget) {
    const inner = labelTarget.querySelector('label, .ps-label, .PSEDITBOXLABEL') || labelTarget;
    inner.textContent = name;
    return;
  }

  const btn = isButtonControl(clone) ? clone : clone.querySelector('input[type=button], input[type=submit], input[type=reset]');
  if (btn) {
    btn.value = name;
    btn.setAttribute('value', name);
    return;
  }

  const link = clone.matches('a, button') ? clone : clone.querySelector('a.ps-button, a[role="button"], button');
  if (link && norm(link.textContent)) link.textContent = name;
}

// Display-only fields (span.PSEDITBOX_DISPONLY) hold a sample value in their
// text; blank it so the mock reads as an empty new field, not a copy.
function blankDisplayValue(clone) {
  if (clone.querySelector && clone.querySelector('input, select, textarea')) return;
  if (clone.matches && clone.matches('span, div') && norm(clone.textContent)) {
    clone.textContent = ' ';
  }
}

function firstInDomOrder(nodes) {
  return nodes
    .slice()
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))[0];
}

// How a container arranges its children, so placement can pick the right
// technique. '2d' = CSS grid or wrapping flex (e.g. the homepage tile grid);
// 'horizontal'/'vertical' = single-axis flex/block flow.
function layoutMode(container) {
  const s = getComputedStyle(container);
  const d = s.display;
  if (d === 'grid' || d === 'inline-grid') return '2d';
  if (d === 'flex' || d === 'inline-flex') {
    const column = /column/.test(s.flexDirection);
    const wrapping = /wrap/.test(s.flexWrap);
    if (wrapping && !column) return '2d';
    return column ? 'vertical' : 'horizontal';
  }
  if (d === 'inline' || d === 'inline-block') return 'horizontal';
  return 'vertical';
}

// Plain DOM sibling insertion (before/after), for placement ALONG a container's
// natural flow axis. Handles multi-node groups (label + field) that share a
// parent, or fall back to per-node placement for split layouts.
function siblingInsert(nodes, clones, before) {
  const sameParent = nodes.every((n) => n.parentElement === nodes[0].parentElement);
  if (sameParent) {
    const parent = nodes[0].parentElement;
    const ordered = nodes
      .map((n, i) => ({ n, c: clones[i] }))
      .sort((a, b) => (a.n.compareDocumentPosition(b.n) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const ref = before ? ordered[0].n : ordered[ordered.length - 1].n.nextSibling;
    ordered.forEach(({ c }) => parent.insertBefore(c, ref));
  } else {
    nodes.forEach((n, i) => {
      if (before) n.parentElement.insertBefore(clones[i], n);
      else n.parentElement.insertBefore(clones[i], n.nextSibling);
    });
  }
}

// Cross-axis placement in a single-axis container: move the original(s) + clone(s)
// into a scoped flex box (row for left/right, column for above/below) so they sit
// beside/stacked without disturbing the rest of the layout. The wrapper is tagged
// so reset can unwrap it (removeAllGhosts), restoring the original.
function crossAxisInsert(nodes, clones, before, flexDirection) {
  const anchorRef = firstInDomOrder(nodes);
  const parent = anchorRef.parentElement;
  const wrap = document.createElement('div');
  wrap.dataset.docgenWrap = '1';
  wrap.style.cssText = `display:flex;flex-direction:${flexDirection};gap:16px;align-items:${flexDirection === 'row' ? 'center' : 'flex-start'};`;
  parent.insertBefore(wrap, anchorRef);
  const ordered = before ? [...clones, ...nodes] : [...nodes, ...clones];
  ordered.forEach((n) => wrap.appendChild(n));
}

// Count how many items sit in the anchor's visual row of a 2D grid, so above/
// below can offset the insertion point by a full row.
function columnsInRow(container, anchor) {
  const top = anchor.offsetTop;
  let cols = 0;
  for (const child of container.children) {
    if (child.dataset && child.dataset.docgenGhost === '1') continue;
    if (Math.abs(child.offsetTop - top) < 3) cols++;
  }
  return Math.max(1, cols);
}

// Above/below inside a 2D grid: insert one full row earlier/later so the clone
// lands directly above/below the anchor rather than merely adjacent in flow.
function gridRowInsert(container, nodes, clones, above) {
  const anchor = firstInDomOrder(nodes);
  const items = Array.from(container.children).filter((c) => !(c.dataset && c.dataset.docgenGhost === '1'));
  const cols = columnsInRow(container, anchor);
  const idx = items.indexOf(anchor);
  // Below: insert one row after (anchor stays put). Above: insert one row before,
  // with +1 to offset the shift the insertion itself causes to the anchor, so the
  // clone lands in the anchor's column rather than one cell to the left.
  const ref = above
    ? (items[Math.max(0, idx - cols + 1)] || items[0])
    : (items[idx + cols] || null);
  clones.forEach((c) => container.insertBefore(c, ref));
}

// Layout-aware placement: interpret above/below/left/right relative to how the
// anchor's container actually flows, so a tile grid, a vertical form, and a
// horizontal button row all place the clone in the visually correct spot.
function placeClones(nodes, clones, direction) {
  const container = firstInDomOrder(nodes).parentElement;
  const mode = layoutMode(container);
  const before = direction === 'left' || direction === 'above';
  const horizontal = direction === 'left' || direction === 'right';

  if (mode === '2d') {
    if (horizontal) siblingInsert(nodes, clones, before); // native grid flow
    else if (nodes.length === 1) gridRowInsert(container, nodes, clones, before); // one row up/down
    else siblingInsert(nodes, clones, before);
  } else if (mode === 'horizontal') {
    if (horizontal) siblingInsert(nodes, clones, before);
    else crossAxisInsert(nodes, clones, before, 'column'); // above/below cross-axis
  } else {
    // vertical (block / flex-column): the common form-field case
    if (!horizontal) siblingInsert(nodes, clones, before);
    else crossAxisInsert(nodes, clones, before, 'row'); // left/right cross-axis
  }
}

export function insertClone(target, { direction, position, fieldName }) {
  const { nodes, labelNode, fieldNode } = target;
  if (!nodes || !nodes.length || !nodes[0].parentElement) {
    throw new Error('Could not resolve an element to duplicate — try clicking directly on the item (field, tile, button, or section).');
  }

  // `position` (before/after) kept for backward compatibility; map to direction.
  const dir = direction || (position === 'before' ? 'above' : 'below');

  const clones = nodes.map((n) => {
    const c = n.cloneNode(true);
    c.dataset.docgenGhost = '1';
    sanitizeClone(c);
    return c;
  });

  // Relabel the label-bearing clone; blank the field clone's sample value.
  const labelIdx = labelNode ? nodes.indexOf(labelNode) : 0;
  relabel(clones[labelIdx >= 0 ? labelIdx : 0], fieldName);
  if (fieldNode && fieldNode !== labelNode) {
    const fieldIdx = nodes.indexOf(fieldNode);
    if (fieldIdx >= 0) blankDisplayValue(clones[fieldIdx]);
  }

  placeClones(nodes, clones, dir);
  return clones;
}
