// Universal (non-grid) change: duplicate an existing field/element as a proposed
// new one. Works by cloning the picked "field unit" so the mock is pixel-native
// for free, then clearing inputs and relabeling. Handles PeopleSoft's
// `.ps_box-edit` label+control units and falls back to a generic "nearest
// ancestor that contains an input" heuristic for other sites.

const FIELD_SELECTOR = '.ps_box-edit, [class*="form-group"], [class*="form-field"], [class*="field-row"], fieldset';

// Given whatever element the user clicked, resolve up to the self-contained
// field unit worth cloning (label + control), not just the raw input or label.
export function resolveFieldUnit(el) {
  const known = el.closest(FIELD_SELECTOR);
  if (known) return known;

  // Generic: smallest ancestor (starting at el) that contains a form control.
  let cur = el;
  for (let i = 0; i < 6 && cur; i++) {
    if (cur.querySelector && cur.querySelector('input, select, textarea')) return cur;
    cur = cur.parentElement;
  }
  // Last resort: the label the user clicked, or the element itself.
  return el.closest('label') || el;
}

function sanitizeClone(clone) {
  const els = [clone, ...clone.querySelectorAll('*')];
  for (const el of els) {
    // Drop ids so the mock doesn't collide with the originals (PeopleSoft styles
    // by class, so appearance is preserved). Drop names so the ghost never
    // participates in form submission.
    if (el.removeAttribute) el.removeAttribute('id');
    if (el.matches && el.matches('input, select, textarea')) {
      el.value = '';
      el.removeAttribute('value');
      el.removeAttribute('name');
      el.readOnly = true;
    }
  }
}

function relabel(clone, name) {
  if (!name) return;
  const labelEl = clone.querySelector('label, .ps-label, .ps_box-label') || clone;
  const inner = labelEl.querySelector('label, .ps-label') || labelEl;
  inner.textContent = name;
}

export function insertField(unit, { position, fieldName }) {
  if (!unit || !unit.parentElement) {
    throw new Error('Could not resolve a field to duplicate — try clicking directly on the field or its label.');
  }

  const clone = unit.cloneNode(true);
  clone.dataset.docgenGhost = '1';
  sanitizeClone(clone);
  relabel(clone, fieldName);

  if (position === 'before') {
    unit.parentElement.insertBefore(clone, unit);
  } else {
    unit.parentElement.insertBefore(clone, unit.nextSibling);
  }

  return [clone];
}
