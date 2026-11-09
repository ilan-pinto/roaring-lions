// GH-943 WebGPU-primary (P1 T1): which toggle belongs to which band, and what it read (r0).
//
// ONE ROW PER (scenario, layer). A task that ports a layer APPENDS its row here in its own PR (shared one-line rows are appended, then
// rebased) and records `r0`, the ratio read on CI, from 3 runs per node key. The CI arms are deterministic, so a band's width belongs to
// its CLASS, not to a row's noise. An r0 outside its band is reported to the lead, NEVER widened.
//
// `layer` is a `BASELINES[scenario].layerChecks` layer name, or the literal `repaint-control` (the zero-time repaint, a `zero` row).
import { BANDS, type BandName } from './parity';

export interface ParityRow {
  readonly scenario: string;
  readonly layer: string;
  readonly band: BandName;
  /** The ratio read on CI (node / legacy-matched), per node key, once recorded. `null` until a task has 3 CI runs of it. */
  readonly r0: { readonly wgl2: number | null; readonly wgpu: number | null };
  /**
   * The node arm's floor on the primary delta, per node key: a third of the smallest of 3 CI runs. `null` until a task has read it
   * (the port tasks fill their own). Below the floor, or exactly 0 while it is null, parity-run prints DEAD (REPORT-ONLY, ruling 3).
   * Optional so rows built elsewhere (the P1 sheet tests) still type; absent reads as null. Ignored on a `zero` row: those are MEANT to read 0 on the node arm.
   */
  readonly nodeFloor?: { readonly wgl2: number | null; readonly wgpu: number | null };
  /** What the row asks, one line. */
  readonly note: string;
}

const UNREAD = { wgl2: null, wgpu: null } as const;
const NO_FLOOR = { wgl2: null, wgpu: null } as const;

export const PARITY_ROWS: readonly ParityRow[] = [
  { scenario: 'quiet', layer: 'repaint-control', band: 'zero', r0: UNREAD, nodeFloor: NO_FLOOR, note: 'a zero-time repaint moves nothing on either arm' },
  { scenario: 'quiet', layer: 'environment', band: 'loose', r0: UNREAD, nodeFloor: NO_FLOOR, note: 'T6: intensity on node, null envMap on legacy (T4 note: the matched census drops the legacy envMap, so L-matched reads ~0 px here and the ratio denominator is vacuous: report-only, read the node delta, not r)' },
  { scenario: 'quiet', layer: 'haze', band: 'tight', r0: UNREAD, nodeFloor: NO_FLOOR, note: 'T4: haze lives in the fog pass' },
  { scenario: 'quiet', layer: 'vignette', band: 'tight', r0: UNREAD, nodeFloor: NO_FLOOR, note: 'T3: vignette x roundTripHalf, after the grade' },
  { scenario: 'relief', layer: 'vignette', band: 'tight', r0: UNREAD, nodeFloor: NO_FLOOR, note: 'T3: the second vignette witness (tel_marum, different corners)' },
  { scenario: 'fogged', layer: 'fog', band: 'tight', r0: UNREAD, nodeFloor: NO_FLOOR, note: 'T4: shroud' },
  { scenario: 'fogged', layer: 'haze', band: 'tight', r0: UNREAD, nodeFloor: NO_FLOOR, note: 'T4' },
  { scenario: 'fogged', layer: 'environment', band: 'loose', r0: UNREAD, nodeFloor: NO_FLOOR, note: 'T6 (T4 note: the matched census drops the legacy envMap, so L-matched reads ~0 px here and the ratio denominator is vacuous: report-only, read the node delta, not r)' },
  { scenario: 'graded', layer: 'grade', band: 'tight', r0: UNREAD, nodeFloor: NO_FLOOR, note: 'T3: the grade LUT, display-referred' },
  { scenario: 'graded', layer: 'environment', band: 'loose', r0: UNREAD, nodeFloor: NO_FLOOR, note: 'T6 (T4 note: the matched census drops the legacy envMap, so L-matched reads ~0 px here and the ratio denominator is vacuous: report-only, read the node delta, not r)' },
  // GH-943 P2 (T3): the node ground's dry blend, macro and road (`terrain/mesh.node.ts`). `loose`: texture filtering differs by backend.
  // Node floors (T3 fix round): a third of the smallest of 3 CI runs per key (42463528089, 42502614669, 42506783555: identical
  // readings on both keys), rounded DOWN to 4 places. The aftermath rows stay null: on this branch their node readings are a
  // constant (~22) left by the decals toggle re-showing census-hidden decal materials, not the layer (fixed in the capture tool by T4).
  { scenario: 'quiet', layer: 'roads', band: 'loose', r0: UNREAD, nodeFloor: { wgl2: 0.1429, wgpu: 0.138 }, note: 'P2 T3: the road surface, shoulder and ruts' },
  { scenario: 'aftermath', layer: 'roads', band: 'loose', r0: UNREAD, nodeFloor: NO_FLOOR, note: 'P2 T3: the second roads witness' },
  { scenario: 'quiet', layer: 'ground-albedo', band: 'loose', r0: UNREAD, nodeFloor: { wgl2: 0.3016, wgpu: 0.2933 }, note: 'P2 T3: the five-slot albedo blend' },
  { scenario: 'open-ground', layer: 'ground-albedo', band: 'loose', r0: UNREAD, nodeFloor: { wgl2: 0.8815, wgpu: 0.8806 }, note: 'P2 T3' },
  { scenario: 'relief', layer: 'ground-albedo', band: 'loose', r0: UNREAD, nodeFloor: { wgl2: 1.1698, wgpu: 1.1617 }, note: 'P2 T3' },
  { scenario: 'quiet', layer: 'macro', band: 'loose', r0: UNREAD, nodeFloor: { wgl2: 0.1575, wgpu: 0.1529 }, note: 'P2 T3: the macro field' },
  { scenario: 'open-ground', layer: 'macro', band: 'loose', r0: UNREAD, nodeFloor: { wgl2: 0.2977, wgpu: 0.298 }, note: 'P2 T3' },
  { scenario: 'aftermath', layer: 'macro', band: 'loose', r0: UNREAD, nodeFloor: NO_FLOOR, note: 'P2 T3' },
  // GH-943 P2 (T4): the relief read on the node ground (`terrain/mesh.node.ts`, maths in `terrain/relief-read.ts`). `loose`.
  { scenario: 'relief', layer: 'slope-light', band: 'loose', r0: UNREAD, nodeFloor: { wgl2: 0.0188, wgpu: 0.0186 }, note: 'P2 T4: the lighting normal tilted by gain 2, capped at 38 degrees' },
  { scenario: 'aftermath', layer: 'slope-light', band: 'loose', r0: UNREAD, nodeFloor: { wgl2: 0.5096, wgpu: 0.5072 }, note: 'P2 T4' },
  { scenario: 'relief', layer: 'height-contours', band: 'loose', r0: UNREAD, nodeFloor: { wgl2: 0.1571, wgpu: 0.156 }, note: 'P2 T4: half-level contour lines and the height tint' },
  { scenario: 'aftermath', layer: 'height-contours', band: 'loose', r0: UNREAD, nodeFloor: { wgl2: 0.1333, wgpu: 0.1328 }, note: 'P2 T4' },
  // GH-943 P2 (T6): the node foliage's wind (`terrain/decor-mesh.node.ts`). `quiet`'s `repaint-control` row above must stay 0 with it live.
  { scenario: 'quiet', layer: 'wind', band: 'loose', r0: UNREAD, nodeFloor: NO_FLOOR, note: 'P2 T6: the foliage sway, sim clock, uSwayAmp by reference' },
  // GH-943 P2 (T7): the vehicles' bend and the rotor wash on the node foliage (`disturb.ts` -> `decor-mesh.node.ts`), witnessed by the
  // `vehicle` scenario's layer checks. The legacy floors are small and were measured on Metal (25 px / 0.0015 and 15 px / 0.0008), so the band is `ao`.
  { scenario: 'vehicle', layer: 'disturb', band: 'ao', r0: UNREAD, nodeFloor: NO_FLOOR, note: 'P2 T7: vehicle bend, tick-built capsules, uDisturbAmp by reference' },
  { scenario: 'vehicle', layer: 'wash', band: 'ao', r0: UNREAD, nodeFloor: NO_FLOOR, note: 'P2 T7: rotor wash flatten and thrash, sim clock' },
  { scenario: 'vehicle', layer: 'selection-ring', band: 'tight', r0: UNREAD, nodeFloor: NO_FLOOR, note: 'T5: the team rings, analytic coverage, no textures' },
  // GH-943 P3 (T3): the node unit twin (`units/unit-material.node.ts`): the team mark, the running gear and the soot on the hooked unit
  // materials, the per-entity fields per object. `loose`: textured. r0 and the node floors from this PR's `visual-parity` runs.
  ...['vehicle', 'kitted', 'fogged', 'graded'].map(
    (scenario): ParityRow => ({ scenario, layer: 'units', band: 'loose', r0: UNREAD, nodeFloor: NO_FLOOR, note: 'P3 T3: every unit, the hooked ones through the unit twin' })
  ),
  { scenario: 'vehicle', layer: 'team-mask', band: 'loose', r0: UNREAD, nodeFloor: NO_FLOOR, note: 'P3 T3: the Lavi team mark (rl-team-mark-2), slot colour by reference' },
  { scenario: 'vehicle', layer: 'unit-surface', band: 'loose', r0: UNREAD, nodeFloor: NO_FLOOR, note: 'P3 T3: per-role roughness/metalness, per object on the twin' },
  { scenario: 'kitted', layer: 'unit-surface', band: 'loose', r0: UNREAD, nodeFloor: NO_FLOOR, note: 'P3 T3' },
  { scenario: 'kitted', layer: 'kit', band: 'loose', r0: UNREAD, nodeFloor: NO_FLOOR, note: 'P3 T3: the grafted kit parts (excluded from the mark by their UVs)' },
  // GH-943 P1 (T5): bloom adds exactly 0 wherever nothing exceeds linear luminance 1.0 (a ZERO check on every quiet gated scenario).
  ...['quiet', 'open-ground', 'vehicle', 'kitted', 'fogged', 'graded'].map(
    (scenario): ParityRow => ({ scenario, layer: 'bloom', band: 'zero', r0: UNREAD, nodeFloor: NO_FLOOR, note: 'T5: bloom adds +0 on a frame with nothing over 1.0' })
  ),
];

/** The rows whose band name has no entry would silently never be judged: refuse at import. */
for (const r of PARITY_ROWS) {
  if (!(r.band in BANDS)) throw new Error(`parity-bands: row ${r.scenario}/${r.layer} names unknown band "${r.band}"`);
}
