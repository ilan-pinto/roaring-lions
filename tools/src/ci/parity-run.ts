// GH-943 WebGPU-primary (P1 T1): the parity report, REPORT-ONLY in P1.
//
//   pnpm --filter @lions/tools exec tsx src/ci/parity-run.ts --legacy=<out-dir of --match-node> --node=<out-dir of --gpu=webgl2|webgpu> [--key=webgl2|webgpu]
//
// Reads `<dir>/<scenario>/summary.json` (the gate writes a `readings` block into it: the repaint control and every layer toggle)
// from the legacy-MATCHED arm and a node arm, and judges every row of `golden-diff/parity-bands.ts` by `golden-diff/parity.ts`.
//
// DEAD (T1b) is printed beside the band verdict and NEVER changes the exit code.
// Exit: 0 every row in band, 1 at least one row out of band, 2 nothing could be judged (a missing summary, a missing row, zero rows).
// A row the legacy or node arm did not read is a REFUSAL (2), not a skip: a table that silently judged fewer rows than it declares
// would pass vacuously. The CI job is report-only, so 1 and 2 only colour the log; the numbers are the product.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BANDS, parityVerdict, type ParityVerdict } from '../golden-diff/parity';
import { PARITY_ROWS, type ParityRow } from '../golden-diff/parity-bands';

interface ReadingJson {
  readonly layer?: string;
  readonly meanAbsChannelDelta: number;
  readonly changedPixels: number;
  readonly diffPixels: number;
}
export interface SummaryJson {
  readonly readings?: { readonly repaintControl: ReadingJson; readonly layers: readonly ReadingJson[] };
}
/** scenario id -> its parsed summary.json (absent when the arm wrote none). */
export type ArmSummaries = ReadonlyMap<string, SummaryJson>;

export interface ParityLine {
  readonly row: ParityRow;
  readonly verdict: ParityVerdict | null;
  /** The node A/B did not change the frame (REPORT-ONLY: never part of the exit code). Always false on a `zero` row. */
  readonly dead: boolean;
  /** The node delta and the floor it was held to (0 = no floor read yet), for the DEAD line. */
  readonly nodeDelta: number | null;
  readonly floor: number;
  /** Why the row could not be judged. */
  readonly refusal: string | null;
}

function readingFor(s: SummaryJson | undefined, layer: string): ReadingJson | null {
  const r = s?.readings;
  if (!r) return null;
  if (layer === 'repaint-control') return r.repaintControl;
  return r.layers.find((l) => l.layer === layer) ?? null;
}

/**
 * The ONE place a key name becomes a `nodeFloor` column. ci.yml passes `--key=webgl2|webgpu` (the `--gpu=` names); the table's columns
 * are `wgl2|wgpu`. Both spellings are accepted. An unknown non-empty key THROWS: reading it as "no floor" is what left every floor
 * unapplied on CI (DEAD fired only at exactly 0). '' is the no-key case and reads no floor.
 */
export function floorKeyOf(key: string): 'wgl2' | 'wgpu' | null {
  if (key === 'wgl2' || key === 'webgl2') return 'wgl2';
  if (key === 'wgpu' || key === 'webgpu') return 'wgpu';
  if (key === '') return null;
  throw new Error(`parity-run: unknown key "${key}" (want webgl2|webgpu, or wgl2|wgpu)`);
}

/**
 * DEAD (ruling 3, report-only): the node delta is under the row's floor for this key, or exactly 0 while no floor is read yet. A delta
 * EQUAL to the floor is alive. A `zero`-band row is exempt: 0 is its pass. Strict `<` against a floor that is at least the smallest
 * positive number, so 0 is DEAD with no floor and a floor of 0 is treated as unread.
 */
export function isDead(row: ParityRow, key: string, nodeDelta: number): boolean {
  if (row.band === 'zero') return false;
  const fk = floorKeyOf(key);
  const floor = (fk === null ? null : row.nodeFloor?.[fk]) ?? 0;
  return nodeDelta < Math.max(floor, Number.MIN_VALUE);
}

export function buildParityLines(legacy: ArmSummaries, node: ArmSummaries, rows: readonly ParityRow[] = PARITY_ROWS, key = ''): ParityLine[] {
  const fk = floorKeyOf(key);
  return rows.map((row) => {
    const l = readingFor(legacy.get(row.scenario), row.layer);
    const n = readingFor(node.get(row.scenario), row.layer);
    const floor = (fk === null ? null : row.nodeFloor?.[fk]) ?? 0;
    if (l === null) return { row, verdict: null, dead: false, nodeDelta: n?.meanAbsChannelDelta ?? null, floor, refusal: 'the legacy-matched arm has no reading for this row' };
    if (n === null) return { row, verdict: null, dead: false, nodeDelta: null, floor, refusal: 'the node arm has no reading for this row' };
    return { row, verdict: parityVerdict(BANDS[row.band], n, l), dead: isDead(row, key, n.meanAbsChannelDelta), nodeDelta: n.meanAbsChannelDelta, floor, refusal: null };
  });
}

export function formatParity(lines: readonly ParityLine[], key: string): string[] {
  const out = [`parity (${key}, REPORT-ONLY): ratio = node / legacy-matched, primary = meanAbsChannelDelta`];
  for (const { row, verdict, refusal, dead, nodeDelta, floor } of lines) {
    const id = `${row.scenario}/${row.layer} [${row.band}]`;
    if (verdict === null) out.push(`  REFUSED ${id}: ${refusal ?? ''}`);
    else out.push(`  ${verdict.ok ? 'PASS' : 'FAIL'} ${id}: ${verdict.message}${verdict.pixelRatio === null ? '' : ` (px ratio ${verdict.pixelRatio.toFixed(3)})`}`);
    if (dead) out.push(`  DEAD ${id}: node delta ${(nodeDelta ?? 0).toFixed(4)} is under its floor (${floor > 0 ? floor.toFixed(4) : 'none read yet, so 0 is dead'}); the node A/B does not change the frame (report-only)`);
  }
  const deadCount = lines.filter((l) => l.dead).length;
  if (deadCount > 0) out.push(`  DEAD rows: ${deadCount} (REPORT-ONLY, never fails the job)`);
  return out;
}

export function parityExit(lines: readonly ParityLine[]): number {
  if (lines.length === 0) return 2;
  if (lines.some((l) => l.verdict === null)) return 2;
  return lines.every((l) => l.verdict?.ok === true) ? 0 : 1;
}

function load(dir: string, scenarios: readonly string[]): Map<string, SummaryJson> {
  const m = new Map<string, SummaryJson>();
  for (const s of scenarios) {
    const f = path.join(dir, s, 'summary.json');
    if (existsSync(f)) m.set(s, JSON.parse(readFileSync(f, 'utf8')) as SummaryJson);
  }
  return m;
}

export function runParity(argv: readonly string[], log: (l: string) => void = console.log): number {
  const arg = (n: string): string | undefined => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const legacyDir = arg('legacy');
  const nodeDir = arg('node');
  if (legacyDir === undefined || nodeDir === undefined) {
    console.error('[parity-run] pass --legacy=<dir> --node=<dir>');
    return 2;
  }
  const scenarios = [...new Set(PARITY_ROWS.map((r) => r.scenario))];
  // An explicit --key must be a known name (an unknown one is read as "no floor" on CI, which is what `floorKeyOf` refuses). With none given,
  // the node dir's own name is a key only when it IS one: a local run on `out/` reports with no floor (as before) rather than refusing.
  const base = path.basename(nodeDir);
  const given = arg('key');
  const key = given ?? (['wgl2', 'wgpu', 'webgl2', 'webgpu'].includes(base) ? base : '');
  try {
    // `--key=` (an unset shell variable in ci.yml) is a key that was asked for and is empty: it would silently read no floor, the very fault `floorKeyOf` exists to stop.
    if (given === '') throw new Error('parity-run: --key= is empty (want webgl2|webgpu, or wgl2|wgpu)');
    floorKeyOf(key);
  } catch (e) {
    console.error(String(e));
    return 2;
  }
  const lines = buildParityLines(load(legacyDir, scenarios), load(nodeDir, scenarios), PARITY_ROWS, key);
  for (const l of formatParity(lines, key)) log(`[parity-run] ${l}`);
  const code = parityExit(lines);
  log(`[parity-run] exit ${code} (0 all in band, 1 out of band, 2 not everything could be judged)`);
  return code;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runParity(process.argv.slice(2));
}
