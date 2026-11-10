// GH-943 P3 T13 (GH-1152): the pure half of the draw-submission probe (`webgpu-submit-probe.ts`, page side `webgpu-page.ts`'s
// `submit*`). Readings in, the hypothesis table, the per-pass and per-type tallies, the refusals and the lever out, so a test can feed
// every refusal the input that trips it. Imported by the page too (it is plain TypeScript with no Node or DOM dependency).
import type { PerPass, RenderPassId } from '../../../packages/render/src/three/backend/pass-counter';
import { compare, median, summarise, type ArmSummary } from './webgpu-abba';
import { profileSelf, type CpuProfile } from './cpu-profile';

export type SubmitArm = 'L' | 'G' | 'F';
export type { PerPass, RenderPassId };
export const PASSES: readonly RenderPassId[] = ['shadow', 'scene', 'ao', 'post'];

/** What a draw call drew, by the object's own kind, in this order of precedence. */
export type DrawType = 'batchedEntry' | 'skinned' | 'instanced' | 'nodeMesh' | 'stockMesh';
export const DRAW_TYPES: readonly DrawType[] = ['batchedEntry', 'skinned', 'instanced', 'nodeMesh', 'stockMesh'];

export interface DrawObjectLike {
  readonly isBatchedMesh?: boolean;
  readonly isSkinnedMesh?: boolean;
  readonly isInstancedMesh?: boolean;
  readonly material?: unknown;
}

/**
 * The type of one draw. `batchedEntry` is a draw of a BatchedMesh (one per ENTRY on WebGPU, one per batch on WebGL2's multi-draw),
 * `nodeMesh` a mesh whose own material is a node material (a P2/P3 twin: `NodeMaterialObserver` marks it `hasNode`, so it takes a
 * FULL refresh every pass), `stockMesh` anything else (a stock material the node renderer converts, or every mesh on legacy).
 */
export function drawTypeOf(o: DrawObjectLike): DrawType {
  if (o.isBatchedMesh === true) return 'batchedEntry';
  if (o.isSkinnedMesh === true) return 'skinned';
  if (o.isInstancedMesh === true) return 'instanced';
  const m = Array.isArray(o.material) ? (o.material[0] as unknown) : o.material;
  if (m !== null && typeof m === 'object' && (m as { isNodeMaterial?: boolean }).isNodeMaterial === true) return 'nodeMesh';
  return 'stockMesh';
}

export const emptyByType = (): Record<DrawType, number> => ({ batchedEntry: 0, skinned: 0, instanced: 0, nodeMesh: 0, stockMesh: 0 });

export type Hypothesis = 'H1' | 'H2' | 'H3' | 'H4' | 'H5' | 'H6';
export const HYPOTHESIS_NAME: Record<Hypothesis, string> = {
  H1: 'BatchedMesh per-entry loop: decor and props hidden',
  H2: 'per-object FULL refresh: FULL refreshes per frame by type (a counting wrap of needsRefresh)',
  H3: 'the shadow pass: unit castShadow off',
  H4: 'the AO pre-pass: `ao` hidden',
  H5: 'the measurement: the census inside cpuRender',
  H6: 'the P3 additions: the same run before (P2 tree) and after the T3-T12 twins',
};

/** A toggle the page applies on top of the base scene; `base` is none. */
export type VariantId = 'base' | 'decor-props-hidden' | 'unit-shadow-off' | 'ao-hidden';
export interface Variant {
  readonly id: VariantId;
  /** The hypothesis this toggle reads; null for the base. */
  readonly hypothesis: 'H1' | 'H3' | 'H4' | null;
}
export const VARIANTS: readonly Variant[] = [
  { id: 'base', hypothesis: null },
  { id: 'decor-props-hidden', hypothesis: 'H1' },
  { id: 'unit-shadow-off', hypothesis: 'H3' },
  { id: 'ao-hidden', hypothesis: 'H4' },
];
export const TOGGLE_HYPOTHESES = ['H1', 'H3', 'H4'] as const;
export type ToggleHypothesis = (typeof TOGGLE_HYPOTHESES)[number];

export interface ProfileTop {
  readonly fn: string;
  readonly file: string;
  readonly selfMs: number;
}

/** Why a FULL refresh was FULL (`NodeMaterialObserver.needsRefresh`): the material holds nodes, the object is skinned, or neither. */
export interface FullReason {
  hasNode: number;
  hasAnimation: number;
  other: number;
}

/** One reading: one arm, one unit count, one variant, on one page. */
export interface SubmitReading {
  readonly arm: SubmitArm;
  /** The spawn target (300, 600). */
  readonly n: number;
  readonly living: number;
  readonly variant: VariantId;
  /** What the toggle reported changing (objects or a layer count); 0 for the base. */
  readonly applied: number;
  /** Warm-up frames until the unit scene stopped changing, and whether it did within the page's cap (false refuses). */
  readonly settleFrames: number;
  readonly settled: boolean;
  /** Calls and distinct objects by pass, from the node backend's `stats().perPass` (G, F) or the page's own legacy wraps (L). Null on
   *  a tree that has no per-pass counter (H6's before arm). */
  readonly perPass: PerPass | null;
  /** The renderer's own frame counters. */
  readonly calls: number;
  readonly triangles: number;
  readonly byType: Record<DrawType, number>;
  /** FULL refreshes in the stats frame, by type (node arms only; null on L). */
  readonly fullRefresh: Record<DrawType, number> | null;
  readonly fullReason: FullReason | null;
  /** Median CPU render over the timed frames, the census LEFT OUT (null on a counts-only run). */
  readonly cpuRenderMs: number | null;
  /** The same median with the census left in (the P0-P2 definition). */
  readonly cpuRenderInclCensusMs: number | null;
  /** The census's mean cost per timed frame (it runs every 60th frame; 0 on L). */
  readonly censusMs: number | null;
  /** Median GPU time per frame from timestamp queries (G only, on a timestamps page; null otherwise). */
  readonly gpuMs: number | null;
  readonly profileTop: readonly ProfileTop[];
}

const sumCalls = (p: PerPass): number => PASSES.reduce((n, k) => n + p[k].calls, 0);

/** G1 at run time: on a node arm the per-pass calls must add up to the frame's own counter. */
export function perPassRefusals(readings: readonly SubmitReading[]): string[] {
  const out: string[] = [];
  for (const r of readings) {
    if (r.arm === 'L') continue;
    if (r.perPass === null) {
      out.push(`${r.arm} n${r.n} ${r.variant}: no per-pass counts on a node arm`);
      continue;
    }
    const s = sumCalls(r.perPass);
    if (s !== r.calls) out.push(`${r.arm} n${r.n} ${r.variant}: the per-pass calls sum to ${s}, the frame counter reads ${r.calls} (the passes do not add up)`);
  }
  return out;
}

/** A reading of a scene that never stopped changing is not a reading of the scene. */
export function unsettledRefusals(readings: readonly SubmitReading[]): string[] {
  return readings.filter((r) => !r.settled).map((r) => `${r.arm} n${r.n} ${r.variant}: the unit scene was still changing after ${r.settleFrames} frames`);
}

/** The pass each toggle hypothesis removes work from, when it has one. */
export const TOGGLE_PASS: Readonly<Record<ToggleHypothesis, RenderPassId | null>> = { H1: null, H3: 'shadow', H4: 'ao' };

/**
 * A toggle hypothesis the COUNT settles without its toggle: the pass it would remove draws 0 calls in EVERY base reading (H4 at z0.5,
 * where `zoomFadeWeight` is 0 and the AO pre-pass is skipped on both arms). Its toggle has nothing to remove, so its silence is the
 * answer, not a dead toggle: `deadHypotheses` leaves it out, and the table says why. One base reading with a call in that pass, or a
 * base with no per-pass counts, and it is an ordinary hypothesis again.
 */
export function settledByCount(readings: readonly SubmitReading[]): ToggleHypothesis[] {
  return TOGGLE_HYPOTHESES.filter((h) => {
    const pass = TOGGLE_PASS[h];
    if (pass === null) return false;
    const bases = readings.filter((r) => r.variant === 'base');
    return bases.length > 0 && bases.every((r) => r.perPass !== null && r.perPass[pass].calls === 0);
  });
}

/** A timed cell: one arm, count and variant over the ABBA rounds (median of round medians, and its spread). */
export interface TimedCell {
  readonly arm: SubmitArm;
  readonly n: number;
  readonly variant: VariantId;
  readonly cpuRender: ArmSummary;
}

/** Builds the timed cells from every page's readings, `round` per page: per round, the median of that round's pages. */
export function timedCells(pages: readonly { round: number; readings: readonly SubmitReading[] }[]): TimedCell[] {
  const acc = new Map<string, { arm: SubmitArm; n: number; variant: VariantId; byRound: Map<number, number[]> }>();
  for (const p of pages) {
    for (const r of p.readings) {
      if (r.cpuRenderMs === null) continue;
      const key = `${r.arm}|${r.n}|${r.variant}`;
      const cell = acc.get(key) ?? { arm: r.arm, n: r.n, variant: r.variant, byRound: new Map<number, number[]>() };
      const v = cell.byRound.get(p.round) ?? [];
      v.push(r.cpuRenderMs);
      cell.byRound.set(p.round, v);
      acc.set(key, cell);
    }
  }
  return [...acc.values()].map((c) => ({ arm: c.arm, n: c.n, variant: c.variant, cpuRender: summarise([...c.byRound.values()]) }));
}

const findReading = (rs: readonly SubmitReading[], arm: SubmitArm, n: number, variant: VariantId): SubmitReading | undefined =>
  [...rs].reverse().find((r) => r.arm === arm && r.n === n && r.variant === variant);
const findCell = (cs: readonly TimedCell[], arm: SubmitArm, n: number, variant: VariantId): TimedCell | undefined =>
  cs.find((c) => c.arm === arm && c.n === n && c.variant === variant);

/** Did the variant move the COUNT on this arm and count: calls, triangles or any pass's calls/objects differ from the base. */
export function countMoved(base: SubmitReading, v: SubmitReading): boolean {
  if (base.calls !== v.calls || base.triangles !== v.triangles) return true;
  if (base.perPass !== null && v.perPass !== null) {
    for (const p of PASSES) if (base.perPass[p].calls !== v.perPass[p].calls || base.perPass[p].objects !== v.perPass[p].objects) return true;
  }
  return false;
}

/** Did the variant move the COST: the difference is outside both spreads (`compare`'s "no difference" rule). */
export function costMoved(base: TimedCell, v: TimedCell): boolean {
  return !compare(base.cpuRender, v.cpuRender).withinSpread;
}

/**
 * G2: the toggle hypotheses whose variants moved neither cost nor count on any arm and count it was read on (the banding probe's
 * `deadHypotheses` rule). A toggle that changed nothing tested nothing, and the probe REFUSES. A hypothesis with no variant reading at
 * all is reported by `missingHypotheses`, not here.
 */
export function deadHypotheses(readings: readonly SubmitReading[], cells: readonly TimedCell[] = []): ToggleHypothesis[] {
  const out: ToggleHypothesis[] = [];
  const settled = settledByCount(readings);
  for (const h of TOGGLE_HYPOTHESES) {
    if (settled.includes(h)) continue;
    const variant = VARIANTS.find((v) => v.hypothesis === h)?.id as VariantId;
    const rows = readings.filter((r) => r.variant === variant);
    if (rows.length === 0) continue;
    let moved = false;
    for (const v of rows) {
      const base = findReading(readings, v.arm, v.n, 'base');
      if (base !== undefined && countMoved(base, v)) moved = true;
      const bc = findCell(cells, v.arm, v.n, 'base');
      const vc = findCell(cells, v.arm, v.n, variant);
      if (bc !== undefined && vc !== undefined && costMoved(bc, vc)) moved = true;
    }
    if (!moved) out.push(h);
  }
  return out;
}

/** The toggle hypotheses with no variant reading at all, or no base to read it against. */
export function missingHypotheses(readings: readonly SubmitReading[]): ToggleHypothesis[] {
  return TOGGLE_HYPOTHESES.filter((h) => {
    const variant = VARIANTS.find((v) => v.hypothesis === h)?.id as VariantId;
    return !readings.some((r) => r.variant === variant && findReading(readings, r.arm, r.n, 'base') !== undefined);
  });
}

/** Where a sample must land for a profile to have covered the frame: the renderer's own code (three, or `packages/render`). */
export const FRAME_CODE = /three|packages\/render|ThreeRenderer|node-backend/;
const META_FN = /^\((idle|program|garbage collector|root)\)$/;

/**
 * G3: an empty profile, a 0-sample one, or one with no sample in the frame's code (the profiler did not cover the timed frames: it
 * was started after them, or stopped before) refuses (exit 2).
 */
export function profileRefusal(p: CpuProfile | null | undefined, label: string): string | null {
  if (p === null || p === undefined || !Array.isArray(p.nodes) || p.nodes.length === 0) return `${label}: the profile is empty`;
  if (!Array.isArray(p.samples) || p.samples.length === 0) return `${label}: the profile has 0 samples`;
  const s = profileSelf(p);
  const frameMs = s.byFunction.filter((r) => !META_FN.test(r.fn) && FRAME_CODE.test(r.file)).reduce((n, r) => n + r.selfMs, 0);
  if (!(frameMs > 0)) return `${label}: no sample of the profile (${p.samples.length}) lands in the frame's code (three / packages/render); it did not cover the timed frames`;
  return null;
}

/** The top `top` functions by self time, the profiler's idle line left out. */
export function profileTopOf(p: CpuProfile, top = 12): ProfileTop[] {
  return profileSelf(p)
    .byFunction.filter((r) => r.fn !== '(idle)')
    .slice(0, top)
    .map((r) => ({ fn: r.fn, file: r.file, selfMs: Number(r.selfMs.toFixed(2)) }));
}

/** FULL refreshes per 300 units on one arm's base, by type: (n_hi - n_lo) scaled to 300 units of spawn target. */
export function fullRefreshSlope(readings: readonly SubmitReading[], arm: SubmitArm, lo: number, hi: number): Record<DrawType, number> | null {
  const a = findReading(readings, arm, lo, 'base');
  const b = findReading(readings, arm, hi, 'base');
  if (a?.fullRefresh == null || b?.fullRefresh == null) return null;
  const out = emptyByType();
  for (const t of DRAW_TYPES) out[t] = ((b.fullRefresh[t] - a.fullRefresh[t]) * 300) / (hi - lo);
  return out;
}

/** The §0 slopes the finding is read against: per 300 units, L +4.27 and G +6.88 ms (P2 sheet §2, Metal). */
export const P2_SLOPE_MS = { L: 4.27, G: 6.88 } as const;

const fmtMs = (c: TimedCell | undefined): string => (c === undefined ? 'n/a' : `${c.cpuRender.value.toFixed(2)} (±${c.cpuRender.spread.toFixed(2)})`);
const totalOf = (t: Record<DrawType, number> | null): number => (t === null ? 0 : DRAW_TYPES.reduce((n, k) => n + t[k], 0));
const fmtTypes = (t: Record<DrawType, number> | null): string => (t === null ? 'n/a' : DRAW_TYPES.filter((k) => t[k] !== 0).map((k) => `${k} ${Math.round(t[k])}`).join(', ') || '0');
const fmtPerPass = (p: PerPass | null): string => (p === null ? 'n/a' : PASSES.map((k) => `${k} ${p[k].calls}/${p[k].objects}`).join(', '));

/** One row of the hypothesis table. */
export interface HypothesisRow {
  readonly hypothesis: Hypothesis;
  readonly variant: string;
  readonly n: number;
  readonly lMs: string;
  readonly gMs: string;
  readonly count: string;
  readonly verdict: string;
}

/** The H6 cells: G (and L, when it was run) on the P2 tree and on the integration tree, base variant. */
export interface BeforeAfter {
  readonly n: number;
  readonly before: ArmSummary;
  readonly after: ArmSummary;
}

/** Per arm and count: the variant's change against the base, in ms (negative is a saving), and whether it is outside the spreads. */
function delta(cells: readonly TimedCell[], arm: SubmitArm, n: number, variant: VariantId): { ms: number; moved: boolean } | null {
  const b = findCell(cells, arm, n, 'base');
  const v = findCell(cells, arm, n, variant);
  if (b === undefined || v === undefined) return null;
  return { ms: v.cpuRender.value - b.cpuRender.value, moved: costMoved(b, v) };
}

/**
 * The verdict for a toggle at the HIGH count: does it move the n_hi G/L ratio, or only the intercept (the G slope from n_lo to n_hi
 * stays inside the spreads)? Counts-only: what it moved in the counter, on G against L.
 */
export function toggleVerdict(readings: readonly SubmitReading[], cells: readonly TimedCell[], variant: VariantId, lo: number, hi: number): string {
  const gB = findReading(readings, 'G', hi, 'base');
  const gV = findReading(readings, 'G', hi, variant);
  const lB = findReading(readings, 'L', hi, 'base');
  const lV = findReading(readings, 'L', hi, variant);
  const counts: string[] = [];
  if (gB && gV) counts.push(`G calls ${gV.calls - gB.calls >= 0 ? '+' : ''}${gV.calls - gB.calls}`);
  if (lB && lV) counts.push(`L calls ${lV.calls - lB.calls >= 0 ? '+' : ''}${lV.calls - lB.calls}`);
  const g = (n: number, v: VariantId): TimedCell | undefined => findCell(cells, 'G', n, v);
  const l = (n: number, v: VariantId): TimedCell | undefined => findCell(cells, 'L', n, v);
  const gb = g(hi, 'base');
  const gv = g(hi, variant);
  const lb = l(hi, 'base');
  const lv = l(hi, variant);
  if (gb === undefined || gv === undefined || lb === undefined || lv === undefined) return `counts only: ${counts.join(', ') || 'no reading'}`;
  const rb = gb.cpuRender.value / lb.cpuRender.value;
  const rv = gv.cpuRender.value / lv.cpuRender.value;
  // The ratio's own noise, from the four spreads (relative spreads add for a quotient).
  const noise = rb * (gb.cpuRender.spread / gb.cpuRender.value + lb.cpuRender.spread / lb.cpuRender.value) + rv * (gv.cpuRender.spread / gv.cpuRender.value + lv.cpuRender.spread / lv.cpuRender.value);
  const ratioMoves = Math.abs(rv - rb) > noise;
  const gbl = g(lo, 'base');
  const gvl = g(lo, variant);
  let slope = '';
  let interceptOnly = false;
  if (gbl !== undefined && gvl !== undefined) {
    const sb = gb.cpuRender.value - gbl.cpuRender.value;
    const sv = gv.cpuRender.value - gvl.cpuRender.value;
    const sNoise = gb.cpuRender.spread + gbl.cpuRender.spread + gv.cpuRender.spread + gvl.cpuRender.spread;
    slope = `; G slope n${lo}->n${hi} ${sb.toFixed(2)} -> ${sv.toFixed(2)} ms`;
    interceptOnly = Math.abs(sv - sb) <= sNoise && Math.abs(gv.cpuRender.value - gb.cpuRender.value) > gb.cpuRender.spread + gv.cpuRender.spread;
  }
  const what = ratioMoves ? 'MOVES the n600 ratio' : interceptOnly ? 'only the intercept' : 'does not move the ratio';
  return `${what}: G/L x${rb.toFixed(3)} -> x${rv.toFixed(3)} (noise ${noise.toFixed(3)})${slope}; ${counts.join(', ')}`;
}

/** The full hypothesis table (H1-H6), one row per variant and count. */
export function hypothesisRows(o: {
  readings: readonly SubmitReading[];
  cells: readonly TimedCell[];
  counts: readonly number[];
  beforeAfter?: readonly BeforeAfter[] | null;
}): HypothesisRow[] {
  const rows: HypothesisRow[] = [];
  const lo = Math.min(...o.counts);
  const hi = Math.max(...o.counts);
  const ms = (arm: SubmitArm, n: number, v: VariantId): string => fmtMs(findCell(o.cells, arm, n, v));
  for (const n of o.counts) {
    const g = findReading(o.readings, 'G', n, 'base');
    const l = findReading(o.readings, 'L', n, 'base');
    rows.push({ hypothesis: 'H1', variant: 'base', n, lMs: ms('L', n, 'base'), gMs: ms('G', n, 'base'), count: `G ${g?.calls ?? 'n/a'} calls (${fmtPerPass(g?.perPass ?? null)}); G batchedEntry ${g?.byType.batchedEntry ?? 'n/a'}; L ${l?.calls ?? 'n/a'} calls, L batchedEntry ${l?.byType.batchedEntry ?? 'n/a'}`, verdict: 'the base (every toggle is read against it)' });
  }
  for (const v of VARIANTS) {
    if (v.hypothesis === null) continue;
    for (const n of o.counts) {
      const gv = findReading(o.readings, 'G', n, v.id);
      const dG = delta(o.cells, 'G', n, v.id);
      const dL = delta(o.cells, 'L', n, v.id);
      const dMs = dG === null || dL === null ? '' : `; dG ${dG.ms.toFixed(2)} ms${dG.moved ? '' : ' (in spread)'}, dL ${dL.ms.toFixed(2)} ms${dL.moved ? '' : ' (in spread)'}`;
      rows.push({
        hypothesis: v.hypothesis,
        variant: v.id,
        n,
        lMs: ms('L', n, v.id),
        gMs: ms('G', n, v.id),
        count: `G ${gv?.calls ?? 'n/a'} calls (${fmtPerPass(gv?.perPass ?? null)}), toggle applied ${gv?.applied ?? 'n/a'}`,
        verdict: settledByCount(o.readings).includes(v.hypothesis)
          ? `settled by the count: the ${TOGGLE_PASS[v.hypothesis]} pass draws 0 calls in every base reading, so the toggle has nothing to remove${dMs}`
          : n === hi
            ? toggleVerdict(o.readings, o.cells, v.id, lo, hi) + dMs
            : `read at n${n}${dMs}`,
      });
    }
  }
  // H2: FULL refreshes on G.
  const slope = fullRefreshSlope(o.readings, 'G', lo, hi);
  for (const n of o.counts) {
    const g = findReading(o.readings, 'G', n, 'base');
    rows.push({
      hypothesis: 'H2',
      variant: 'FULL refreshes / frame',
      n,
      lMs: ms('L', n, 'base'),
      gMs: ms('G', n, 'base'),
      count: `G FULL ${totalOf(g?.fullRefresh ?? null)} (${fmtTypes(g?.fullRefresh ?? null)}); reasons ${g?.fullReason ? `hasNode ${g.fullReason.hasNode}, hasAnimation ${g.fullReason.hasAnimation}, other ${g.fullReason.other}` : 'n/a'}`,
      verdict: n === hi ? h2Verdict(o.cells, slope, lo, hi) : `read at n${n}`,
    });
  }
  // H5: the census.
  for (const n of o.counts) {
    const g = findReading(o.readings, 'G', n, 'base');
    rows.push({ hypothesis: 'H5', variant: 'census out of cpuRender', n, lMs: ms('L', n, 'base'), gMs: ms('G', n, 'base'), count: `G censusMs ${g?.censusMs?.toFixed(3) ?? 'n/a'} / frame; median incl census ${g?.cpuRenderInclCensusMs?.toFixed(2) ?? 'n/a'} ms`, verdict: n === hi ? h5Verdict(o.readings, o.cells, hi) : `read at n${n}` });
  }
  // H6: before and after.
  for (const ba of o.beforeAfter ?? []) {
    const c = compare(ba.before, ba.after);
    rows.push({ hypothesis: 'H6', variant: 'G after / G before (base)', n: ba.n, lMs: 'n/a', gMs: `${ba.after.value.toFixed(2)} vs ${ba.before.value.toFixed(2)}`, count: '', verdict: `P3 added x${c.ratio.toFixed(3)} (${(ba.after.value - ba.before.value).toFixed(2)} ms)${c.withinSpread ? ', inside the spread' : ''}` });
  }
  if ((o.beforeAfter ?? []).length === 0) rows.push({ hypothesis: 'H6', variant: 'before / after', n: hi, lMs: 'n/a', gMs: 'n/a', count: 'n/a', verdict: 'not run (needs the Metal hold)' });
  return rows;
}

function h2Verdict(cells: readonly TimedCell[], slope: Record<DrawType, number> | null, lo: number, hi: number): string {
  if (slope === null) return 'no FULL counts on G';
  const per300 = totalOf(slope);
  const gl = findCell(cells, 'G', lo, 'base');
  const gh = findCell(cells, 'G', hi, 'base');
  const ll = findCell(cells, 'L', lo, 'base');
  const lh = findCell(cells, 'L', hi, 'base');
  const head = `FULL refreshes grow ${per300.toFixed(0)} per 300 units (${fmtTypes(slope)})`;
  if (gl === undefined || gh === undefined || ll === undefined || lh === undefined) return `${head}; against the P2 slopes G +${P2_SLOPE_MS.G} / L +${P2_SLOPE_MS.L} ms per 300 (counts only)`;
  const sG = ((gh.cpuRender.value - gl.cpuRender.value) * 300) / (hi - lo);
  const sL = ((lh.cpuRender.value - ll.cpuRender.value) * 300) / (hi - lo);
  const excess = sG - sL;
  return `${head}; measured slopes G +${sG.toFixed(2)} / L +${sL.toFixed(2)} ms per 300 (P2: +${P2_SLOPE_MS.G} / +${P2_SLOPE_MS.L}); G's excess slope ${excess.toFixed(2)} ms is ${per300 > 0 ? ((excess * 1000) / per300).toFixed(2) : 'n/a'} us per FULL refresh if it were all refresh`;
}

function h5Verdict(readings: readonly SubmitReading[], cells: readonly TimedCell[], hi: number): string {
  const g = findReading(readings, 'G', hi, 'base');
  const gc = findCell(cells, 'G', hi, 'base');
  const lc = findCell(cells, 'L', hi, 'base');
  if (g === undefined || g.censusMs === null || gc === undefined || lc === undefined) return 'counts only: the census is timed on the Metal hold';
  const diff = gc.cpuRender.value - lc.cpuRender.value;
  const incl = g.cpuRenderInclCensusMs ?? gc.cpuRender.value;
  const inMedian = incl - (g.cpuRenderMs ?? incl);
  return `census ${g.censusMs.toFixed(3)} ms per frame (mean) against the n${hi} G-L difference ${diff.toFixed(2)} ms (${diff > 0 ? ((g.censusMs / diff) * 100).toFixed(1) : 'n/a'}%); in the median ${inMedian.toFixed(3)} ms`;
}

/** The table as markdown. */
export function hypothesisTable(rows: readonly HypothesisRow[]): string[] {
  return [
    '| hypothesis | variant | n | L ms | G ms | count | verdict |',
    '|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.hypothesis} | ${r.variant} | ${r.n} | ${r.lMs} | ${r.gMs} | ${r.count} | ${r.verdict} |`),
  ];
}

/** The per-pass and per-type tallies, one line per reading. */
export function tallyTable(readings: readonly SubmitReading[]): string[] {
  return [
    '| arm | n | variant | living | calls | triangles | shadow c/o | scene c/o | ao c/o | post c/o | batchedEntry | skinned | instanced | nodeMesh | stockMesh | FULL (G) |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...readings.map((r) => {
      const pp = (k: RenderPassId): string => (r.perPass === null ? 'n/a' : `${r.perPass[k].calls}/${r.perPass[k].objects}`);
      return `| ${r.arm} | ${r.n} | ${r.variant} | ${r.living} | ${r.calls} | ${r.triangles} | ${pp('shadow')} | ${pp('scene')} | ${pp('ao')} | ${pp('post')} | ${r.byType.batchedEntry} | ${r.byType.skinned} | ${r.byType.instanced} | ${r.byType.nodeMesh} | ${r.byType.stockMesh} | ${r.fullRefresh === null ? 'n/a' : totalOf(r.fullRefresh)} |`;
    }),
  ];
}

/**
 * The lever T14 takes. With timing: the toggle hypothesis that closes the most of the n_hi G-L gap (the G saving minus the L saving,
 * outside the spreads), against the H2 estimate. Counts only: the largest G-over-L call excess and the FULL-refresh slope, named as
 * counts-only (the saving it would buy is not measured).
 */
export function recommendLever(readings: readonly SubmitReading[], cells: readonly TimedCell[], lo: number, hi: number): string {
  const gap = (() => {
    const g = findCell(cells, 'G', hi, 'base');
    const l = findCell(cells, 'L', hi, 'base');
    return g !== undefined && l !== undefined ? g.cpuRender.value - l.cpuRender.value : null;
  })();
  if (gap !== null) {
    const ranked = TOGGLE_HYPOTHESES.map((h) => {
      const variant = VARIANTS.find((v) => v.hypothesis === h)?.id as VariantId;
      const dG = delta(cells, 'G', hi, variant);
      const dL = delta(cells, 'L', hi, variant);
      const closes = dG !== null && dL !== null && dG.moved ? -(dG.ms - dL.ms) : 0;
      return { h, closes };
    }).sort((a, b) => b.closes - a.closes);
    const best = ranked[0];
    if (best !== undefined && best.closes > 0) {
      return `${best.h} (${HYPOTHESIS_NAME[best.h]}): it closes ${best.closes.toFixed(2)} ms of the n${hi} G-L gap of ${gap.toFixed(2)} ms (${((best.closes / gap) * 100).toFixed(0)}%); ranking ${ranked.map((r) => `${r.h} ${r.closes.toFixed(2)}`).join(', ')}`;
    }
    return `no toggle closes the n${hi} G-L gap (${gap.toFixed(2)} ms) outside the spreads; ranking ${ranked.map((r) => `${r.h} ${r.closes.toFixed(2)}`).join(', ')}`;
  }
  const g = findReading(readings, 'G', hi, 'base');
  const l = findReading(readings, 'L', hi, 'base');
  if (g === undefined || l === undefined) return 'no reading on G and L at the high count';
  const excess = DRAW_TYPES.map((t) => ({ t, d: g.byType[t] - l.byType[t] })).sort((a, b) => b.d - a.d);
  const slope = fullRefreshSlope(readings, 'G', lo, hi);
  return `counts only (no timing): G draws ${g.calls - l.calls} more calls than L at n${hi}, by type ${excess.map((e) => `${e.t} ${e.d >= 0 ? '+' : ''}${e.d}`).join(', ')}; FULL refreshes on G grow ${slope === null ? 'n/a' : totalOf(slope).toFixed(0)} per 300 units (${fmtTypes(slope)})`;
}

/** The median of a list, or null for none (the GPU-time frames). */
export const medianOrNull = (v: readonly number[]): number | null => (v.length === 0 ? null : median(v));
