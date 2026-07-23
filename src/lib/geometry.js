// Runs inside a specific frame's content-script world. Walks getBoundingClientRect()
// up through ancestor iframes to translate an element's rect into top-frame viewport
// coordinates. Only works while every ancestor frame on the path is same-origin with
// its own parent — if any hop is cross-origin, `window.frameElement`/`.parent` access
// throws or returns null and we report resolved:false so the caller can fall back to
// an unhighlighted screenshot instead of a wrong box.
export function getRectInTopFrame(el) {
  const rect = el.getBoundingClientRect();
  let x = rect.left;
  let y = rect.top;
  let win = window;

  try {
    while (win !== win.top) {
      const frameEl = win.frameElement;
      if (!frameEl) return { resolved: false };
      const frameRect = frameEl.getBoundingClientRect();
      x += frameRect.left;
      y += frameRect.top;
      win = win.parent;
    }
  } catch {
    return { resolved: false };
  }

  return {
    resolved: true,
    x,
    y,
    width: rect.width,
    height: rect.height,
    devicePixelRatio: window.devicePixelRatio || 1,
  };
}

// Union of several elements' top-frame rects — used to draw one highlight box
// around a whole inserted column rather than just its first cell. Returns
// resolved:false if any element's rect can't be resolved (cross-origin frame).
export function getUnionRectInTopFrame(elements) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let dpr = 1;

  for (const el of elements) {
    const r = getRectInTopFrame(el);
    if (!r.resolved) return { resolved: false };
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
    dpr = r.devicePixelRatio;
  }

  if (!Number.isFinite(minX)) return { resolved: false };

  return {
    resolved: true,
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    devicePixelRatio: dpr,
  };
}
