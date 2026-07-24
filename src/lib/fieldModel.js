// PeopleSoft field model: identify the field a click lands on, pair it with its
// label, and extract spec-worthy metadata. Works across both PeopleSoft layouts:
//
//   Fluid  — label + control share a self-contained `.ps_box-edit` wrapper.
//   Classic— label (`div.PT_CP_DIV_LABEL#win0div{ID}lbl > span.PSEDITBOXLABEL`)
//            and field (`#{ID}`, e.g. `input.PSEDITBOX` or `span.PSEDITBOX_DISPONLY`)
//            are SEPARATE siblings.
//
// The reliable link in BOTH is the id convention (verified live): the label
// container is always `win0div{FIELDID}lbl`, and `<label for>` equals the field
// id. We key off that so a picked field always brings its label along.

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

const FIELD_SELECTOR = 'input[id], select[id], textarea[id], [id][class*="DISPONLY"]';

// From whatever node was clicked, work out the PeopleSoft field id.
export function identifyFieldId(el) {
  if (!el || !el.matches) return null;
  if (el.matches(FIELD_SELECTOR)) return el.id;
  if (el.matches('label[for]')) return el.getAttribute('for');

  // Clicked the label (or its inner span): label container id is win0div{ID}lbl.
  const lblAnc = el.closest('[id^="win0div"][id$="lbl"]');
  if (lblAnc) {
    const m = lblAnc.id.match(/^win0div(.+)lbl$/);
    if (m) return m[1];
  }

  // Clicked a wrapper (e.g. the .ps_box-edit box) — look inside for the control.
  const inner = el.querySelector && el.querySelector(FIELD_SELECTOR);
  if (inner) return inner.id;

  return null;
}

function findLabelNode(fieldId) {
  const forLabel = document.querySelector(`label[for="${CSS.escape(fieldId)}"]`);
  if (forLabel) return forLabel.closest('.ps_box-label, .PT_CP_DIV_LABEL') || forLabel;
  return document.getElementById(`win0div${fieldId}lbl`);
}

function inferControlType(fieldNode) {
  const cls = (fieldNode.className || '').toString();
  if (fieldNode.tagName === 'SELECT') return 'dropdown';
  if (fieldNode.tagName === 'TEXTAREA' || /longedit/i.test(cls)) return 'long edit box';
  if (fieldNode.matches('input[type=checkbox]')) return 'checkbox';
  if (fieldNode.matches('input[type=radio]')) return 'radio button';
  if (/DISPONLY|disponly/.test(cls)) return 'display-only';
  const prompt = document.getElementById(`${fieldNode.id}$prompt`);
  if (prompt && /ps_icon-date/.test((prompt.className || '').toString())) return 'date';
  if (prompt) return 'lookup / prompt';
  if (fieldNode.tagName === 'INPUT') return 'edit box';
  return 'field';
}

function fieldMetadata(fieldNode, labelNode) {
  const rawLabel = norm(labelNode && labelNode.textContent);
  const required = rawLabel.startsWith('*');
  const label = rawLabel.replace(/^\*/, '').replace(/:\s*$/, '').trim();
  // Grid controls carry a $N row-index suffix; the base id is the record.field.
  const baseId = fieldNode.id.replace(/\$\d+\$?$/, '');
  return {
    kind: 'field',
    fieldId: fieldNode.id,
    baseId,
    label,
    required,
    controlType: inferControlType(fieldNode),
  };
}

// Returns { nodes, labelNode, fieldNode, selfContained, meta } for a field, or
// null if the click isn't on a field. `nodes` are the element(s) to clone: one
// self-contained box (Fluid), or [label, field] in DOM order (classic).
export function resolveFieldGroup(el) {
  const fieldId = identifyFieldId(el);
  if (!fieldId) return null;
  const fieldNode = document.getElementById(fieldId);
  if (!fieldNode) return null;

  const labelNode = findLabelNode(fieldId);
  const box = fieldNode.closest('.ps_box-edit, [class*="form-group"], [class*="form-field"]');
  const selfContained = !!(box && labelNode && box.contains(labelNode));

  let nodes;
  if (selfContained) {
    nodes = [box];
  } else {
    nodes = [labelNode, fieldNode].filter(Boolean);
    // keep DOM order so grouped insertion preserves label-before-field layout
    nodes.sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
  }

  return { nodes, labelNode, fieldNode, selfContained, meta: fieldMetadata(fieldNode, labelNode) };
}
