import { Document, Packer, Paragraph, HeadingLevel, TextRun, ImageRun } from 'docx';

const MAX_IMAGE_WIDTH_PX = 600;

async function loadImageDimensions(arrayBuffer) {
  const blob = new Blob([arrayBuffer], { type: 'image/png' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    return await new Promise((resolve, reject) => {
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error('Failed to decode screenshot image.'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function scaleToMaxWidth(width, height) {
  if (width <= MAX_IMAGE_WIDTH_PX) return { width, height };
  const ratio = MAX_IMAGE_WIDTH_PX / width;
  return { width: MAX_IMAGE_WIDTH_PX, height: Math.round(height * ratio) };
}

async function buildImageRun(arrayBuffer) {
  const naturalSize = await loadImageDimensions(arrayBuffer);
  const transformation = scaleToMaxWidth(naturalSize.width, naturalSize.height);
  return new ImageRun({ type: 'png', data: arrayBuffer, transformation });
}

function labeledParagraph(label, value) {
  return new Paragraph({
    children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(value || '—')],
  });
}

export async function buildDocx(report) {
  const {
    pageUrl,
    requestedBy,
    changeType,
    direction,
    fieldName,
    styleBasis,
    target,
    notes,
    caveat,
    beforeImageArrayBuffer,
    afterImageArrayBuffer,
  } = report;

  const DIRECTION_PHRASE = {
    above: 'Above the picked element',
    below: 'Below the picked element',
    left: 'To the left of the picked element',
    right: 'To the right of the picked element',
  };

  const children = [
    new Paragraph({ text: 'UI Change Request', heading: HeadingLevel.TITLE }),
    labeledParagraph('Page', pageUrl),
    labeledParagraph('Date', new Date().toLocaleString()),
    labeledParagraph('Requested by', requestedBy),

    new Paragraph({ text: 'Requested Change', heading: HeadingLevel.HEADING_1 }),
    labeledParagraph('Change type', changeType),
    labeledParagraph('Placement', DIRECTION_PHRASE[direction] || direction),
    labeledParagraph('New field name', fieldName),
    labeledParagraph('Styling', styleBasis),
    labeledParagraph('Notes', notes),
  ];

  // PeopleSoft-specific target identity — the part a developer needs to locate
  // the element in App Designer (record.field, control type, required, etc.).
  if (target) {
    children.push(new Paragraph({ text: 'Target element (PeopleSoft)', heading: HeadingLevel.HEADING_1 }));
    if (target.kind) children.push(labeledParagraph('Kind', target.kind));
    if (target.label) children.push(labeledParagraph('Label', target.label));
    if (target.fieldId) children.push(labeledParagraph('HTML id / field', target.fieldId));
    if (target.baseId && target.baseId !== target.fieldId) children.push(labeledParagraph('Base id (record.field)', target.baseId));
    if (target.controlType) children.push(labeledParagraph('Control type', target.controlType));
    if (target.kind === 'field') children.push(labeledParagraph('Required', target.required ? 'Yes' : 'No'));
  }

  if (caveat) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: caveat, italics: true, color: '92400E' })],
      }),
    );
  }

  children.push(new Paragraph({ text: 'Before', heading: HeadingLevel.HEADING_1 }));
  children.push(
    beforeImageArrayBuffer
      ? new Paragraph({ children: [await buildImageRun(beforeImageArrayBuffer)] })
      : new Paragraph('No "before" screenshot captured.'),
  );

  children.push(new Paragraph({ text: 'After (proposed)', heading: HeadingLevel.HEADING_1 }));
  children.push(
    afterImageArrayBuffer
      ? new Paragraph({ children: [await buildImageRun(afterImageArrayBuffer)] })
      : new Paragraph('No "after" screenshot captured.'),
  );

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBlob(doc);
}
