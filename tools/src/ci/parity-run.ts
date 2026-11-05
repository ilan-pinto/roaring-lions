// GH-943 WebGPU-primary (P1 T1): the parity report, REPORT-ONLY in P1.
//
//   pnpm --filter @lions/tools exec tsx src/ci/parity-run.ts --legacy=<out-dir of --match-node> --node=<out-dir of --gpu=webgl2|webgpu> [--key=wgl2|wgpu]
//
// Reads `<dir>/<scenario>/summary.json` (the gate writes a `readings` block into it: the repaint control and every layer toggle)
// from the legacy-MATCHED arm and a node arm, and judges every row of `golden-diff/parity-bands.ts` by `golden-diff/parity.ts`.
//
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
  /** Why the row could not be judged. */
  readonly refusal: string | null;
}

function readingFor(s: SummaryJson | undefined, layer: string): ReadingJson | null {
  const r = s?.readings;
  if (!r) return null;
  if (layer === 'repaint-control') return r.repaintControl;
  return r.layers.find((l) => l.layer === layer) ?? null;
}

export function buildParityLines(legacy: ArmSummaries, node: ArmSummaries, rows: readonly ParityRow[] = PARITY_ROWS): ParityLine[] {
  return rows.map((row) => {
    const l = readingFor(legacy.get(row.scenario), row.layer);
    const n = readingFor(node.get(row.scenario), row.layer);
    if (l === null) return { row, verdict: null, refusal: 'the legacy-matched arm has no reading for this row' };
    if (n === null) return { row, verdict: null, refusal: 'the node arm has no reading for this row' };
    return { row, verdict: parityVerdict(BANDS[row.band], n, l), refusal: null };
  });
}

export function formatParity(lines: readonly ParityLine[], key: string): string[] {
  const out = [`parity (${key}, REPORT-ONLY): ratio = node / legacy-matched, primary = meanAbsChannelDelta`];
  for (const { row, verdict, refusal } of lines) {
    const id = `${row.scenario}/${row.layer} [${row.band}]`;
    if (verdict === null) out.push(`  REFUSED ${id}: ${refusal ?? ''}`);
    else out.push(`  ${verdict.ok ? 'PASS' : 'FAIL'} ${id}: ${verdict.message}${verdict.pixelRatio === null ? '' : ` (px ratio ${verdict.pixelRatio.toFixed(3)})`}`);
  }
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
  const lines = buildParityLines(load(legacyDir, scenarios), load(nodeDir, scenarios));
  for (const l of formatParity(lines, arg('key') ?? path.basename(nodeDir))) log(`[parity-run] ${l}`);
  const code = parityExit(lines);
  log(`[parity-run] exit ${code} (0 all in band, 1 out of band, 2 not everything could be judged)`);
  return code;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runParity(process.argv.slice(2));
}
