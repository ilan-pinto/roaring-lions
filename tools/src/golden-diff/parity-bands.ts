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
  /** What the row asks, one line. */
  readonly note: string;
}

const UNREAD = { wgl2: null, wgpu: null } as const;

export const PARITY_ROWS: readonly ParityRow[] = [
  { scenario: 'quiet', layer: 'repaint-control', band: 'zero', r0: UNREAD, note: 'a zero-time repaint moves nothing on either arm' },
  { scenario: 'quiet', layer: 'environment', band: 'loose', r0: UNREAD, note: 'T6: intensity on node, null envMap on legacy' },
  { scenario: 'quiet', layer: 'haze', band: 'tight', r0: UNREAD, note: 'T4: haze lives in the fog pass' },
  { scenario: 'quiet', layer: 'vignette', band: 'tight', r0: UNREAD, note: 'T3: vignette x roundTripHalf, after the grade' },
  { scenario: 'relief', layer: 'vignette', band: 'tight', r0: UNREAD, note: 'T3: the second vignette witness (tel_marum, different corners)' },
  { scenario: 'fogged', layer: 'fog', band: 'tight', r0: UNREAD, note: 'T4: shroud' },
  { scenario: 'fogged', layer: 'haze', band: 'tight', r0: UNREAD, note: 'T4' },
  { scenario: 'fogged', layer: 'environment', band: 'loose', r0: UNREAD, note: 'T6' },
  { scenario: 'graded', layer: 'grade', band: 'tight', r0: UNREAD, note: 'T3: the grade LUT, display-referred' },
  { scenario: 'graded', layer: 'environment', band: 'loose', r0: UNREAD, note: 'T6' },
];

/** The rows whose band name has no entry would silently never be judged: refuse at import. */
for (const r of PARITY_ROWS) {
  if (!(r.band in BANDS)) throw new Error(`parity-bands: row ${r.scenario}/${r.layer} names unknown band "${r.band}"`);
}
