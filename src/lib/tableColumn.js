function norm(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

function colSpanOf(cell) {
  return cell.colSpan || 1;
}

function getRows(table) {
  const rows = [];
  if (table.tHead) rows.push(...table.tHead.rows);
  for (const tbody of table.tBodies) rows.push(...tbody.rows);
  if (table.tFoot) rows.push(...table.tFoot.rows);
  return rows;
}

function columnIndexOf(cell) {
  let index = 0;
  for (const c of cell.parentElement.children) {
    if (c === cell) break;
    index += colSpanOf(c);
  }
  return index;
}

// Visual properties copied from a donor element so the inserted column blends
// in with the existing grid instead of looking foreign. Layout-forcing props
// (width/height/position) are intentionally excluded so the new column sizes
// itself naturally within the table.
const VISUAL_PROPS = [
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'color', 'background-color', 'background-image',
  'text-align', 'vertical-align', 'text-transform', 'white-space',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-top-style', 'border-top-color',
  'border-right-width', 'border-right-style', 'border-right-color',
  'border-bottom-width', 'border-bottom-style', 'border-bottom-color',
  'border-left-width', 'border-left-style', 'border-left-color',
];

function copyVisualStyle(donor, target) {
  const cs = getComputedStyle(donor);
  for (const prop of VISUAL_PROPS) {
    target.style.setProperty(prop, cs.getPropertyValue(prop));
  }
}

function insertCellIntoRow(row, targetColIndex, { fieldName, headerDonor }) {
  let running = 0;
  let insertBeforeCell = null;
  for (const cell of row.children) {
    if (running >= targetColIndex) {
      insertBeforeCell = cell;
      break;
    }
    running += colSpanOf(cell);
  }

  const rowHasHeaderCells = Array.from(row.children).some((c) => c.tagName === 'TH');
  const newCell = document.createElement(rowHasHeaderCells ? 'th' : 'td');
  newCell.dataset.docgenGhost = '1';
  newCell.textContent = rowHasHeaderCells ? fieldName : '—';

  // The existing cell the new one sits next to — a real in-row sibling to mimic.
  // Header cells copy the chosen donor; body cells copy their in-row neighbor so
  // the whole column reads as native to the grid.
  const neighbor = insertBeforeCell || row.lastElementChild;
  const donor = rowHasHeaderCells ? headerDonor : neighbor;
  if (donor) copyVisualStyle(donor, newCell);

  if (insertBeforeCell) {
    row.insertBefore(newCell, insertBeforeCell);
  } else {
    row.appendChild(newCell);
  }
  return newCell;
}

// Inserts a new column next to the picked one. PeopleSoft (and similar grids)
// often split a single visual grid across TWO <table> elements — a sticky
// header clone with no body rows, plus the real data table. Clicking the
// visible header lands in the header-only clone, so inserting into just that
// table yields a header with no cells beneath it. We therefore find every grid
// table that shares the picked column's header label and insert into each, so
// the data table's body rows get the column too.
//
// Best-effort: aligns by summed colSpan per row within each table. Rows whose
// earlier columns carry a rowSpan from a prior row are not modeled (documented
// v1 limitation) and can drift on complex grids.
export function insertColumn(anchorEl, { position, fieldName, headerStyleDonor }) {
  // Defensive: callers should already pass a <th>/<td> (the picker snaps to
  // one), but re-resolve here too in case the picked element is nested text.
  const anchorCell = anchorEl.closest('th, td') || anchorEl;
  const anchorTable = anchorCell.closest('table');
  if (!anchorTable) {
    throw new Error('Picked element is not inside a <table> — column insertion only supports table grids in v1.');
  }

  const label = norm(anchorCell.textContent);
  const headerDonor = headerStyleDonor || anchorCell;

  // Grid tables to touch: the anchor's table plus any other table with a header
  // cell of the same label (the split sticky-header / data-table pair).
  const tables = new Set([anchorTable]);
  if (label) {
    for (const th of document.querySelectorAll('th')) {
      if (norm(th.textContent) === label) {
        const t = th.closest('table');
        if (t) tables.add(t);
      }
    }
  }

  const insertedCells = [];
  for (const table of tables) {
    // Locate the column within THIS table by label so leading-column offsets
    // between the two tables self-correct; fall back to the anchor's own index.
    let refCell = null;
    if (label) {
      refCell = Array.from(table.querySelectorAll('th')).find((th) => norm(th.textContent) === label) || null;
    }
    if (!refCell && table === anchorTable) refCell = anchorCell;
    if (!refCell) continue;

    const refIndex = columnIndexOf(refCell);
    const targetColIndex = position === 'before' ? refIndex : refIndex + colSpanOf(refCell);

    for (const row of getRows(table)) {
      insertedCells.push(insertCellIntoRow(row, targetColIndex, { fieldName, headerDonor }));
    }
  }

  return insertedCells;
}

export function removeAllGhosts(root = document) {
  root.querySelectorAll('[data-docgen-ghost="1"]').forEach((el) => el.remove());
}
