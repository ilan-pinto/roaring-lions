// GH-943 WebGPU-primary P1 (T3): the ramp card's PURE half -- layout, patches, the comparison. No dependencies, so the in-page half
// (`ramp-card-page.ts`, which Vite serves to a browser) can import it without pulling pngjs, and the vitest runs it with no browser.
// `ramp-card.ts` re-exports every name here and owns the PNG read and the driver.

/** One 8-bit level (the exact band, parity method). */
export const RAMP_TOLERANCE = 1;

export const RAMP_LAYOUT = { cols: 26, rows: 3, patchW: 40, patchH: 60, width: 26 * 40, height: 3 * 60 } as const;

/** The patch values: 0, then 2^-8 .. 2^4 (= 16) in half-octave steps. 25 steps + zero = 26 columns. */
export const RAMP_VALUES: readonly number[] = [0, ...Array.from({ length: RAMP_LAYOUT.cols - 1 }, (_, k) => 2 ** (-8 + k * 0.5))];
/** Row tints, applied to the value: neutral, warm, cool (so the grade's per-channel stages are exercised). */
export const RAMP_TINTS: readonly (readonly [number, number, number])[] = [
  [1, 1, 1],
  [1, 0.5, 0.25],
  [0.25, 0.5, 1],
];

export interface RampPatch {
  readonly row: number;
  readonly col: number;
  readonly value: number;
  /** Linear-light RGB the patch is drawn with. */
  readonly linear: readonly [number, number, number];
  /** Centre in card pixels, y down. */
  readonly x: number;
  readonly y: number;
}

export function rampPatches(): RampPatch[] {
  const out: RampPatch[] = [];
  for (let row = 0; row < RAMP_LAYOUT.rows; row++) {
    for (let col = 0; col < RAMP_LAYOUT.cols; col++) {
      const value = RAMP_VALUES[col] as number;
      const t = RAMP_TINTS[row] as readonly [number, number, number];
      out.push({
        row,
        col,
        value,
        linear: [value * t[0], value * t[1], value * t[2]],
        x: (col + 0.5) * RAMP_LAYOUT.patchW,
        y: (row + 0.5) * RAMP_LAYOUT.patchH,
      });
    }
  }
  return out;
}

export type Rgb8 = readonly [number, number, number];

export interface RampVerdict {
  readonly pass: boolean;
  /** The largest per-channel difference, in 8-bit levels. */
  readonly maxDelta: number;
  readonly worst: { readonly row: number; readonly col: number; readonly value: number; readonly legacy: Rgb8; readonly node: Rgb8 } | null;
  /** Patches whose largest channel difference exceeds the tolerance. */
  readonly failing: number;
  readonly total: number;
}

/** Compares two cards patch by patch. THROWS on a length mismatch (a truncated card must not read as a pass). */
export function compareCards(legacy: readonly Rgb8[], node: readonly Rgb8[], tolerance = RAMP_TOLERANCE): RampVerdict {
  const patches = rampPatches();
  if (legacy.length !== patches.length || node.length !== patches.length) {
    throw new Error(`ramp card: ${legacy.length} legacy and ${node.length} node patches, expected ${patches.length}`);
  }
  let maxDelta = 0;
  let failing = 0;
  let worst: RampVerdict['worst'] = null;
  patches.forEach((p, i) => {
    const a = legacy[i] as Rgb8;
    const b = node[i] as Rgb8;
    const d = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
    if (d > tolerance) failing++;
    if (d > maxDelta || worst === null) {
      maxDelta = d;
      worst = { row: p.row, col: p.col, value: p.value, legacy: a, node: b };
    }
  });
  return { pass: failing === 0, maxDelta, worst, failing, total: patches.length };
}

/** A card that is all one colour (a page that drew nothing, or a black readback) says nothing: refuse it rather than pass it. */
export function cardRefusal(patches: readonly Rgb8[], label: string): string | null {
  const distinct = new Set(patches.map((p) => p.join(',')));
  return distinct.size < 8 ? `${label}: the card has only ${distinct.size} distinct patch colours; nothing was drawn` : null;
}

