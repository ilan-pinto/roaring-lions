// GH-943 WebGPU-primary P1 T9: the pure half of the lead's sheet (`webgpu-p1-sheet.ts` drives the browser). No playwright here, so
// every decision can be driven red by a constructed input in `webgpu-p1-sheet.test.ts`.
import { PNG } from 'pngjs';
import { median } from './webgpu-abba';
import { BANDS, type BandName } from '../golden-diff/parity';
import { PARITY_ROWS } from '../golden-diff/parity-bands';

export const DIFF_GAIN = 8;
/** The bloom census' quiet ceiling (design: under 0.9, a 10% margin under the bloom threshold of 1.0). */
export const BLOOM_QUIET_CEILING = 0.9;
export const G_BAR = 1.05;
export const F_BAR = 1.1;

export interface PanelDiff {
  readonly png: PNG;
  /** Mean over R, G, B of |a - b|, in 0..255 channel units (the gate's primary metric). */
  readonly meanAbsChannelDelta: number;
  readonly changedPixels: number;
}

/** |a - b| per channel, multiplied by `gain` and clamped, opaque. Throws on a size mismatch (never a silent crop). */
export function diffPanel(a: PNG, b: PNG, gain = DIFF_GAIN): PanelDiff {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`diffPanel: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  const out = new PNG({ width: a.width, height: a.height });
  let sum = 0;
  let changed = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    let any = false;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs((a.data[i + c] as number) - (b.data[i + c] as number));
      sum += d;
      if (d > 0) any = true;
      out.data[i + c] = Math.min(255, d * gain);
    }
    out.data[i + 3] = 255;
    if (any) changed++;
  }
  return { png: out, meanAbsChannelDelta: sum / (a.width * a.height * 3), changedPixels: changed };
}

export interface TimedRounds {
  /** One median per round, in ms. */
  readonly roundMedians: readonly number[];
}

/** Median of the round medians, and the spread (max - min of them). At least 3 rounds, or it throws. */
export function syncedSummary(rounds: readonly number[]): { value: number; spread: number; rounds: number } {
  if (rounds.length < 3) throw new Error(`syncedSummary: ${rounds.length} round(s); at least 3 are required`);
  return { value: median(rounds), spread: Math.max(...rounds) - Math.min(...rounds), rounds: rounds.length };
}

export type Verdict = 'PASS' | 'FAIL';

export interface AbbaVerdictRow {
  readonly test: 'F' | 'G';
  readonly target: number;
  readonly ratio: number;
  readonly withinSpread: boolean;
  readonly met: boolean;
}

export interface GateInputs {
  readonly sheetFrames: number;
  readonly sheetUnsettled: number;
  readonly abba: readonly AbbaVerdictRow[];
  /** Triangles per arm at each view, from the ABBA's last pages (AO on: matched L keeps the pre-pass). */
  readonly triangles: readonly { zoom: number; L: number; F: number; G: number }[];
  readonly bloom: readonly { arm: 'F' | 'G'; exit: number; quietMax: number | null }[];
  readonly rafLine: string | null;
  readonly validationErrors: number;
}

export interface GateRow {
  readonly item: string;
  readonly verdict: Verdict;
  readonly detail: string;
}

/** G <= 1.05 x L is the bar; the P0 rule that a difference inside the spread counts as no difference (`barMet`) is kept, and said. */
export function gateTable(g: GateInputs): GateRow[] {
  const rows: GateRow[] = [];
  rows.push({
    item: 'sheet: 9 frames, 6 difference panels, L-shipped reference, 3 minimap crops',
    verdict: g.sheetFrames === 10 ? 'PASS' : 'FAIL',
    detail: `${g.sheetFrames} frames photographed; ${g.sheetUnsettled} not settled (two zero-time repaints differed)`,
  });
  for (const r of g.abba.filter((x) => x.test === 'G')) {
    rows.push({ item: `ABBA n${r.target}: G <= ${G_BAR} x L`, verdict: r.met ? 'PASS' : 'FAIL', detail: `x${r.ratio.toFixed(3)}${r.withinSpread ? ' (inside spread)' : ''}` });
  }
  if (!g.abba.some((x) => x.test === 'G')) rows.push({ item: `ABBA: G <= ${G_BAR} x L`, verdict: 'FAIL', detail: 'no G timing exists (refused or not run)' });
  for (const r of g.abba.filter((x) => x.test === 'F')) {
    rows.push({ item: `ABBA n${r.target}: F vs L (bar ${F_BAR}, reported)`, verdict: r.met ? 'PASS' : 'FAIL', detail: `x${r.ratio.toFixed(3)}${r.withinSpread ? ' (inside spread)' : ''}` });
  }
  const triBad = g.triangles.filter((t) => Math.abs(t.F - t.L) > t.L * 0.01 || Math.abs(t.G - t.L) > t.L * 0.01);
  rows.push({
    item: 'ABBA triangle agreement, AO on (within 1%)',
    verdict: g.triangles.length > 0 && triBad.length === 0 ? 'PASS' : 'FAIL',
    detail: g.triangles.length === 0 ? 'no triangle reading' : g.triangles.map((t) => `z${t.zoom}: L ${t.L} F ${t.F} G ${t.G}`).join('; '),
  });
  for (const b of g.bloom) {
    const ok = b.exit === 0 && b.quietMax !== null && b.quietMax > 0 && b.quietMax < BLOOM_QUIET_CEILING; // a max of exactly 0 is a black buffer, not a quiet scene
    rows.push({ item: `bloom census ${b.arm}: quiet max < ${BLOOM_QUIET_CEILING}`, verdict: ok ? 'PASS' : 'FAIL', detail: `exit ${b.exit}, max ${b.quietMax === null ? 'unread' : b.quietMax}` });
  }
  rows.push({
    item: 'rAF re-check: stub does not follow the zoom, the app flag does',
    verdict: g.rafLine !== null && /-> CONFIRMED/.test(g.rafLine) ? 'PASS' : 'FAIL',
    detail: g.rafLine ?? 'no hypothesis line',
  });
  rows.push({ item: 'GPUValidationErrors == 0', verdict: g.validationErrors === 0 ? 'PASS' : 'FAIL', detail: `${g.validationErrors}` });
  return rows;
}

/** Counts console lines naming a GPU validation error (the ABBA harness refuses the same pattern). */
export function countValidationErrors(lines: readonly string[]): number {
  return lines.filter((l) => /GPUValidationError|Destroyed texture|uploaded again/i.test(l)).length;
}

/** The highest `max` column of the bloom census' table rows ("map | quality | view | samples | p50 | p99 | max | frac"), or null when no row parses. */
export function parseQuietMax(out: string): number | null {
  let max: number | null = null;
  for (const line of out.split('\n')) {
    const c = line.split('|').map((s) => s.trim());
    if (c.length !== 8 || c[0] === 'map' || /aftermath/.test(c[0] as string)) continue;
    const m = Number(c[6]);
    if (Number.isFinite(m) && c[6] !== '') max = max === null ? m : Math.max(max, m);
  }
  return max;
}

export interface BandReport {
  readonly scenario: string;
  readonly layer: string;
  readonly band: BandName;
  readonly key: 'wgl2' | 'wgpu';
  readonly r0: number;
}

/** Every recorded r0 that sits outside its band: REPORTED, never widened. A `null` r0 is unread, not outside. */
export function r0Outside(rows = PARITY_ROWS): BandReport[] {
  const out: BandReport[] = [];
  for (const row of rows) {
    const band = BANDS[row.band];
    for (const key of ['wgl2', 'wgpu'] as const) {
      const r0 = row.r0[key];
      if (r0 === null) continue;
      const inside = band.kind === 'zero' ? r0 === 0 : band.kind === 'exact' ? r0 <= band.maxDelta : r0 >= band.lo && r0 <= band.hi;
      if (!inside) out.push({ scenario: row.scenario, layer: row.layer, band: row.band, key, r0 });
    }
  }
  return out;
}
