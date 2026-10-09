// Town-label collision avoidance for the campaign board (both renderers).
//
// A dozen towns can project close enough together -- on the 3D board, as the
// basin turns; on the flat board, wherever two of `world.json`'s `at` points
// sit near each other -- that their name labels overlap into an unreadable
// smear. `nudgeLabels` computes a per-town vertical offset that clears every
// collision, greedily, so a caller can apply it as one CSS custom property
// per label rather than reflowing the DOM.

export interface LabelBox {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Greedy top-down: sort by y, and push each label below every already-placed
 *  label whose horizontal span it shares. Offsets are downward only, so a pin
 *  keeps its label near it and the pass is stable frame to frame. O(n²) over
 *  a dozen towns, called once per frame while the board turns. */
export function nudgeLabels(items: readonly LabelBox[], gap: number): ReadonlyMap<string, number> {
  const placed: { x0: number; x1: number; y1: number }[] = [];
  const out = new Map<string, number>();
  for (const it of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let top = it.y;
    for (const p of placed) {
      const sharesX = it.x < p.x1 && it.x + it.w > p.x0;
      if (sharesX && top < p.y1 + gap) top = p.y1 + gap;
    }
    out.set(it.id, top - it.y);
    placed.push({ x0: it.x, x1: it.x + it.w, y1: top + it.h });
  }
  return out;
}

/**
 * The box a 3D-board pin occupies on screen, for `nudgeLabels` (PA-20).
 *
 * The pin's own point is where the ring sits; the label is `reach` pixels to
 * its right (`translate(0.875rem, ...)` in theme.css) and then `labelW` wide.
 * `onFrame` used to hand `nudgeLabels` the pin point and the LABEL's width, a
 * span that starts at the ring and ends `reach` short of where the label
 * really ends -- so a neighbour whose ring stood within `reach` of this
 * label's tail read as clear, and "Beit Sahwan 0/15" ran into "Qarn Hadid".
 * `pad` keeps two labels on one row from touching end to end.
 */
export function pinLabelBox(
  id: string,
  point: { x: number; y: number },
  label: { w: number; h: number },
  reach: number,
  pad: number
): LabelBox {
  return { id, x: point.x, y: point.y, w: reach + label.w + pad, h: label.h };
}
