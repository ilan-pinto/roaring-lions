/**
 * `pnpm tsx tools/src/perf/wet-readability-report.ts <captures dir> [--map=ein_qasab] [--out=<report.txt>]`
 *
 * Reads a `ground:capture --stops=... --read=...` run (its frames and `cost.json`) and prints, per stop and
 * per treatment, the figure's readability (`wet-readability.ts`): CIEDE2000 of its mean colour and of its
 * darkest 15% against the ground, with the floor 15.6, the mask's size, and the repaint control. The mask is
 * each treatment's own `-read-m-<name>` frame against the stop's `-read-g` frame (units hidden): a pixel is the
 * figure's iff it differs between the two, so the mask follows the pose of that frame; the ground is `-read-g`.
 *
 * Throws when a frame is missing or a mask is empty: a number from nothing is the failure the module refuses.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { READABILITY_FLOOR, figureMask, maskSize, readability, type Frame, type Readability } from './wet-readability';

/** The mask is searched within this many px of the squad's screen position (the figure is about 35 x 80 px at z2.5). */
export const MASK_SEARCH_PX = 70;

function load(file: string): Frame {
  if (!fs.existsSync(file)) throw new Error(`wet-readability-report: missing frame ${file}`);
  const png = PNG.sync.read(fs.readFileSync(file));
  return { width: png.width, height: png.height, data: png.data };
}

/** One treatment over its samples: the mean of each number and its spread (standard deviation). */
export interface TreatmentRead {
  readonly treatment: string;
  readonly samples: number;
  readonly mean: number;
  readonly meanSd: number;
  readonly darkest: number;
  readonly darkestSd: number;
  readonly perPixelMedian: number;
  readonly shareAboveFloor: number;
  readonly internalContrast: number;
  readonly pixels: number;
  readonly figureMean: { r: number; g: number; b: number };
  readonly figureDarkest: { r: number; g: number; b: number };
  readonly ground: { r: number; g: number; b: number };
}

export interface StopRead {
  readonly kind: string;
  readonly rows: readonly TreatmentRead[];
}

function avg(v: readonly number[]): number {
  return v.reduce((a, b) => a + b, 0) / v.length;
}
function sd(v: readonly number[]): number {
  const m = avg(v);
  return Math.sqrt(avg(v.map((x) => (x - m) ** 2)));
}

export function summarise(treatment: string, rs: readonly Readability[]): TreatmentRead {
  const rgb = (pick: (r: Readability) => { r: number; g: number; b: number }): { r: number; g: number; b: number } => ({
    r: avg(rs.map((r) => pick(r).r)),
    g: avg(rs.map((r) => pick(r).g)),
    b: avg(rs.map((r) => pick(r).b)),
  });
  return {
    treatment,
    samples: rs.length,
    mean: avg(rs.map((r) => r.mean)),
    meanSd: sd(rs.map((r) => r.mean)),
    darkest: avg(rs.map((r) => r.darkest)),
    darkestSd: sd(rs.map((r) => r.darkest)),
    perPixelMedian: avg(rs.map((r) => r.perPixelMedian)),
    shareAboveFloor: avg(rs.map((r) => r.shareAboveFloor)),
    internalContrast: avg(rs.map((r) => r.internalContrast)),
    pixels: Math.round(avg(rs.map((r) => r.pixels))),
    figureMean: rgb((r) => r.figureMean),
    figureDarkest: rgb((r) => r.figureDarkest),
    ground: rgb((r) => r.ground),
  };
}

export function readStop(dir: string, map: string, kind: string, squadScreen: readonly [number, number], treatments: readonly string[], samples: number): StopRead {
  const stop = `${map}-squad-${kind}`;
  const f = (what: string): Frame => load(path.join(dir, `${stop}-read-${what}.png`));
  const [cx, cy] = squadScreen;
  const g = f('g');
  const rows = treatments.map((t) => {
    const rs: Readability[] = [];
    for (let j = 0; j < samples; j++) {
      const m = f(`m-${t}-s${j}`);
      const mask = figureMask(m, g, cx, cy, MASK_SEARCH_PX);
      if (maskSize(mask) === 0) throw new Error(`wet-readability-report: ${stop} ${t} sample ${j}: the figure mask is empty (the frame and the ground frame did not differ near the squad)`);
      rs.push(readability(m, g, mask));
    }
    return summarise(t, rs);
  });
  return { kind, rows };
}

export function formatStop(s: StopRead): string {
  const lines = [`${s.kind}:`];
  const rgb = (c: { r: number; g: number; b: number }): string => `(${c.r.toFixed(0)},${c.g.toFixed(0)},${c.b.toFixed(0)})`;
  for (const r of s.rows) {
    const pass = (v: number): string => (v >= READABILITY_FLOOR ? 'ok ' : 'LOW');
    lines.push(
      `  ${r.treatment.padEnd(14)} mean ${r.mean.toFixed(1).padStart(5)}+-${r.meanSd.toFixed(1)} ${pass(r.mean)}  darkest15% ${r.darkest.toFixed(1).padStart(5)}+-${r.darkestSd.toFixed(1)} ${pass(r.darkest)}  ` +
        `per-pixel median ${r.perPixelMedian.toFixed(1).padStart(5)} (${(r.shareAboveFloor * 100).toFixed(0).padStart(2)}% >= floor)  internal p95/p5 ${r.internalContrast.toFixed(1).padStart(6)}  ` +
        `figure ${rgb(r.figureMean)} dark ${rgb(r.figureDarkest)} ground ${rgb(r.ground)}  n=${r.pixels} x${r.samples}`
    );
  }
  return lines.join('\n');
}

function main(): void {
  const argv = process.argv.slice(2);
  const dir = argv.find((a) => !a.startsWith('--'));
  if (dir === undefined) throw new Error('usage: wet-readability-report <captures dir> [--map=<id>] [--out=<file>]');
  const flag = (n: string): string | undefined => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const map = flag('map') ?? 'ein_qasab';
  const cost = JSON.parse(fs.readFileSync(path.join(dir, 'cost.json'), 'utf8')) as Record<string, { views: Record<string, { squadScreen?: [number, number] }> }>;
  const views = cost[map]?.views;
  if (views === undefined) throw new Error(`wet-readability-report: cost.json has no map ${map}`);
  const treatments = new Set<string>();
  let samples = 0;
  for (const name of Object.keys(views)) {
    const m = new RegExp(`^${map}-squad-[a-z]+-read-m-(.+)-s(\\d+)$`).exec(name);
    if (m !== null && m[1] !== undefined && m[2] !== undefined) {
      treatments.add(m[1]);
      samples = Math.max(samples, Number(m[2]) + 1);
    }
  }
  const order = [...treatments];
  const out: string[] = [`readability of the KDF figure vs the ground behind it, floor ${READABILITY_FLOOR} (CIEDE2000), ${order.length} treatments x ${samples} samples (mean +- sd over samples): ${order.join(', ')}`];
  for (const kind of ['road', 'water', 'grass']) {
    const squad = views[`${map}-squad-${kind}`]?.squadScreen;
    if (squad === undefined) continue;
    out.push(formatStop(readStop(dir, map, kind, squad, order, samples)));
  }
  const text = out.join('\n') + '\n';
  const to = flag('out');
  if (to !== undefined) fs.writeFileSync(to, text);
  process.stdout.write(text);
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
