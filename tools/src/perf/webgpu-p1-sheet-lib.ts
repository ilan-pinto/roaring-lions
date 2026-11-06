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

export interface SheetFrameView {
  readonly zoom: number;
  readonly png: string;
  readonly settled: boolean;
  readonly syncedMs: number;
  readonly syncedSpread: number;
  readonly rounds: readonly number[];
  readonly triangles: number;
  readonly draws: number;
}
export interface SheetArmView {
  readonly arm: 'L' | 'G' | 'F' | 'LS';
  readonly backend: string;
  readonly adapter: string;
  readonly load: number;
  readonly camera: { x: number; y: number };
  readonly tick: number;
  readonly frames: readonly SheetFrameView[];
  readonly minimap: string;
}
export interface SheetPanelView {
  readonly name: string;
  readonly zoom: number;
  readonly file: string;
  readonly mean: number;
  readonly changed: number;
}

const base = (f: string): string => f.slice(f.lastIndexOf('/') + 1);
const ARM_NAME = { L: 'L matched', G: 'G', F: 'F', LS: 'L shipped' } as const;

/** The sheet's HTML. Every arm is OPTIONAL (a run with `--arms` that omits one still assembles a sheet, with that cell marked absent). */
export function sheetHtml(arms: Partial<Record<'L' | 'G' | 'F' | 'LS', SheetArmView>>, panels: readonly SheetPanelView[], title: string, zooms: readonly number[]): string {
  const absent = (what: string): string => `<div class="c"><div class="cap">${what}: not captured in this run</div></div>`;
  const cell = (a: SheetArmView | undefined, id: keyof typeof ARM_NAME, z: number): string => {
    const f = a?.frames.find((x) => x.zoom === z);
    if (a === undefined || f === undefined) return absent(`${ARM_NAME[id]} z${z}`);
    return `<div class="c"><img src="${base(f.png)}"><div class="cap">${ARM_NAME[id]} z${z}: synced ${f.syncedMs.toFixed(2)} ms (spread ${f.syncedSpread.toFixed(2)}, ${f.rounds.length} rounds), ${f.triangles.toLocaleString()} tris, ${f.draws} draws${f.settled ? '' : ' UNSETTLED'}<br>${a.backend} / ${a.adapter} / load ${a.load.toFixed(2)}</div></div>`;
  };
  const rows = (['L', 'G', 'F'] as const).map((id) => `<div class="row">${zooms.map((z) => cell(arms[id], id, z)).join('')}</div>`).join('');
  const diffRows = (['G', 'F'] as const)
    .map((t) => {
      const mine = panels.filter((p) => p.name.startsWith(t));
      return `<div class="row">${mine.length === 0 ? absent(`|${t} - L| panels`) : mine.map((p) => `<div class="c"><img src="${base(p.file)}"><div class="cap">|${p.name}| x8 at z${p.zoom}: mean abs channel delta ${p.mean.toFixed(4)}, ${p.changed.toLocaleString()} px changed</div></div>`).join('')}</div>`;
    })
    .join('');
  const mini = (['L', 'G', 'F'] as const)
    .map((id) => {
      const a = arms[id];
      return a === undefined ? '' : `<div class="m"><img src="${base(a.minimap)}"><div class="cap">${id} minimap, 2x</div></div>`;
    })
    .join('');
  const ref = arms.L ?? arms.G ?? arms.F ?? arms.LS;
  const cam = ref === undefined ? 'unknown' : `(${ref.camera.x.toFixed(1)}, ${ref.camera.y.toFixed(1)}), tick ${ref.tick}`;
  return `<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:16px;background:#111;color:#ddd;font:13px/1.35 ui-monospace,Menlo,monospace;width:1800px}
.row{display:flex;gap:8px;margin-bottom:8px}.c{width:588px}.c img{width:588px;display:block}.m img{display:block}.cap{padding:2px 0}
h2{margin:14px 0 6px;font-size:14px}
</style>
<h2>GH-943 WebGPU P1 sheet: ${title}, booted camera ${cam}, parked force, music off</h2>
<h2>Rows: L matched (AO on), G (node on WebGPU), F (node on WebGL2). Columns: z${zooms.join(', z')}.</h2>${rows}
<h2>Differences (x8)</h2>${diffRows}
<h2>L shipped at z1 (the player's frame, no census), and the minimap per arm</h2>
<div class="row">${cell(arms.LS, 'LS', 1)}<div class="c" style="display:flex;gap:8px;align-items:flex-start">${mini}</div></div>`;
}
