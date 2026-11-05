// GH-943 WebGPU-primary (P1 T1): the parity method, as pure functions (plan, "Parity method").
//
// For one layer toggle, the node arm and the legacy-MATCHED arm each read a delta: the shown-minus-hidden meanAbsChannelDelta
// (PRIMARY, 0..255 scale) and the changed-pixel count (SECONDARY). The ratio r = delta_node / delta_legacy says whether the node
// twin contributes as much to the picture as the GLSL it replaces. A band is a class of tolerance:
//
//   exact  the difference between the arms is at most 1/255 of a channel (the ramp card)
//   zero   both deltas are exactly 0 (bloom on a scene with no HDR, the repaint control)
//   tight  r in [0.95, 1.05]  (fog, haze, vignette, grade)
//   loose  r in [0.85, 1.15]  (environment, the bloom card)
//   ao     r in [0.70, 1.30]
//
// Everything is REPORT-ONLY in P1; the lead votes the bands in at the sheet. A band is NEVER widened to make a row pass: an r0 outside
// its band is reported to the lead.
//
// THE RULE THAT MAKES THIS A GATE AND NOT A RUBBER STAMP: a layer that contributes nothing cannot be in parity with anything. A node
// delta of 0 against a legacy delta that moved reads r = 0 (FAIL); a legacy delta of 0 reads r undefined (FAIL, "no legacy signal");
// only the `zero` band accepts a 0, and it accepts nothing else.

export type BandName = 'exact' | 'zero' | 'tight' | 'loose' | 'ao';

export interface RatioBand {
  readonly kind: 'ratio';
  readonly lo: number;
  readonly hi: number;
}
export interface ExactBand {
  readonly kind: 'exact';
  /** In 0..255 channel units: 1/255 of the 0..1 range is 1 here. */
  readonly maxDelta: number;
}
export interface ZeroBand {
  readonly kind: 'zero';
}
export type Band = RatioBand | ExactBand | ZeroBand;

export const BANDS: Readonly<Record<BandName, Band>> = {
  exact: { kind: 'exact', maxDelta: 1 },
  zero: { kind: 'zero' },
  tight: { kind: 'ratio', lo: 0.95, hi: 1.05 },
  loose: { kind: 'ratio', lo: 0.85, hi: 1.15 },
  ao: { kind: 'ratio', lo: 0.7, hi: 1.3 },
};

/** The two numbers one arm read for one toggle. */
export interface ArmDelta {
  readonly meanAbsChannelDelta: number;
  readonly changedPixels: number;
}

export interface ParityVerdict {
  readonly ok: boolean;
  /** Node / legacy-matched on the primary metric, or null when it is undefined (legacy read 0). */
  readonly ratio: number | null;
  /** Same on the secondary metric; report-only, never votes. */
  readonly pixelRatio: number | null;
  readonly message: string;
}

/** `a / b`, or null when b is 0 (an undefined ratio is never silently 0 or Infinity). */
export function ratioOf(a: number, b: number): number | null {
  return b === 0 || !Number.isFinite(a) || !Number.isFinite(b) ? null : a / b;
}

/** Judges one row. Total: a NaN or negative reading is a FAIL, never a pass by comparison accident. */
export function parityVerdict(band: Band, node: ArmDelta, legacy: ArmDelta): ParityVerdict {
  const ratio = ratioOf(node.meanAbsChannelDelta, legacy.meanAbsChannelDelta);
  const pixelRatio = ratioOf(node.changedPixels, legacy.changedPixels);
  const bad = [node.meanAbsChannelDelta, legacy.meanAbsChannelDelta, node.changedPixels, legacy.changedPixels].some(
    (v) => !Number.isFinite(v) || v < 0
  );
  if (bad) return { ok: false, ratio, pixelRatio, message: 'a reading is NaN, infinite or negative: nothing was measured' };
  if (band.kind === 'zero') {
    const zero = node.meanAbsChannelDelta === 0 && legacy.meanAbsChannelDelta === 0 && node.changedPixels === 0 && legacy.changedPixels === 0;
    return {
      ok: zero,
      ratio,
      pixelRatio,
      message: zero ? 'both arms read exactly 0' : `zero band: node ${node.meanAbsChannelDelta.toFixed(4)} / ${node.changedPixels} px, legacy ${legacy.meanAbsChannelDelta.toFixed(4)} / ${legacy.changedPixels} px`,
    };
  }
  if (band.kind === 'exact') {
    const d = Math.abs(node.meanAbsChannelDelta - legacy.meanAbsChannelDelta);
    return { ok: d <= band.maxDelta, ratio, pixelRatio, message: `|node - legacy| = ${d.toFixed(4)} (<= ${band.maxDelta})` };
  }
  if (legacy.meanAbsChannelDelta === 0) {
    return { ok: false, ratio: null, pixelRatio, message: 'legacy-matched read 0: there is no legacy signal to be in parity with (a layer that moves nothing cannot be judged)' };
  }
  if (ratio === null) return { ok: false, ratio, pixelRatio, message: 'ratio undefined' };
  const ok = ratio >= band.lo && ratio <= band.hi;
  return { ok, ratio, pixelRatio, message: `r = ${ratio.toFixed(4)} ${ok ? 'in' : 'OUTSIDE'} [${band.lo}, ${band.hi}]` };
}
