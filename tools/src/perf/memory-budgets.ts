// The budgets `pnpm perf:memory -- --gate` judges a walk against, and the
// judging itself -- pure, so `memory-budgets.test.ts` can drive it with
// hand-built readings and watch every check go red.
//
// Budgets are keyed by CAPTURE ENVIRONMENT, for the visual gate's reason
// (`golden-diff/baseline.ts`): the same walk reads differently on SwiftShader
// and on a GPU -- the process total most of all, since a software rasteriser
// keeps every texture in the GPU process's own heap -- so a number measured on
// one is not a budget for the other. A missing environment is exit 3, never a
// silent pass.
import type { MemoryInventory } from '../../../packages/render/src/three/memory-inventory';
import type { LedgerReadout } from './memory-ledger';

export interface Reading {
  label: string;
  atS: number;
  js: { used: number; total: number; backing: number; embedder: number; jsTotal: number };
  dom: { nodes: number; documents: number; listeners: number };
  gpu: { liveBytes: number; liveContexts: number; retainedLostContexts: number; ledger: LedgerReadout };
  process: { total: number; byType: Record<string, number>; method: string };
  inventory: MemoryInventory | null;
  sim: { entityCount: number; tick: number; flowFields: number | null; width: number; height: number } | null;
  uasm: number | string | null;
}

/** Ceilings in MiB for one kind of checkpoint. */
export interface Ceiling {
  jsTotalMiB: number;
  gpuMiB: number;
  processMiB: number;
}

export interface MemoryBudget {
  /** How the measurements behind these numbers were taken -- printed with every verdict. */
  conditions: string;
  menu: Ceiling;
  board: Ceiling;
  /** Applied to every mission checkpoint. */
  mission: Ceiling;
  leak: {
    /** A menu reached AFTER leaving a mission may hold at most this many MiB of
     *  JS (heap + ArrayBuffers) more than the FIRST menu reading. */
    jsOverMenuMiB: number;
    /** ...and at most this many MiB more GPU (ledger) than the first menu. */
    gpuOverMenuMiB: number;
    /** WebGL contexts that are lost yet still reachable after a forced GC --
     *  a renderer something still holds after its screen was left. */
    maxRetainedLostContexts: number;
  };
}

export interface Verdict {
  ok: boolean;
  detail: string;
}

const MiB = 1048576;
const f = (b: number): string => (b / MiB).toFixed(1);

/** `darwin-arm64-metal`, `linux-x64-swiftshader`, ... from the unmasked GL
 *  renderer string the browser actually reported. */
export function envKeyFor(platform: string, arch: string, unmaskedRenderer: string): string {
  const r = unmaskedRenderer.toLowerCase();
  const backend = r.includes('swiftshader') ? 'swiftshader' : r.includes('metal') || r.includes('apple') ? 'metal' : 'gpu';
  return `${platform}-${arch}-${backend}`;
}

function ceilingChecks(r: Reading, c: Ceiling, kind: string): Verdict[] {
  return [
    { ok: r.js.jsTotal <= c.jsTotalMiB * MiB, detail: `${r.label}: JS heap + ArrayBuffers ${f(r.js.jsTotal)} MiB <= ${c.jsTotalMiB} (${kind})` },
    { ok: r.gpu.liveBytes <= c.gpuMiB * MiB, detail: `${r.label}: GPU ledger ${f(r.gpu.liveBytes)} MiB <= ${c.gpuMiB} (${kind})` },
    { ok: r.process.total <= c.processMiB * MiB, detail: `${r.label}: all Chromium processes ${f(r.process.total)} MiB <= ${c.processMiB} (${kind})` },
  ];
}

/** Every check, in walk order. A walk with no `menu` reading, or with no
 *  mission at all, is not judged as a pass: it fails, naming what is missing. */
export function judge(readings: readonly Reading[], b: MemoryBudget): Verdict[] {
  const out: Verdict[] = [];
  const menu = readings.find((r) => r.label === 'menu');
  if (!menu) return [{ ok: false, detail: 'no "menu" reading -- the leak baseline is missing' }];
  const missions = readings.filter((r) => r.label.startsWith('mission '));
  const afters = readings.filter((r) => r.label.startsWith('menu after '));
  if (missions.length === 0 || afters.length !== missions.length) {
    return [{ ok: false, detail: `${missions.length} mission reading(s) and ${afters.length} after-leave reading(s): nothing to judge` }];
  }
  for (const r of readings) {
    if (r.label === 'menu' || r.label.startsWith('menu ')) out.push(...ceilingChecks(r, b.menu, 'menu'));
    else if (r.label === 'board') out.push(...ceilingChecks(r, b.board, 'board'));
    else if (r.label.startsWith('mission ')) out.push(...ceilingChecks(r, b.mission, 'mission'));
  }
  for (const r of afters) {
    const dj = r.js.jsTotal - menu.js.jsTotal;
    const dg = r.gpu.liveBytes - menu.gpu.liveBytes;
    out.push({
      ok: dj <= b.leak.jsOverMenuMiB * MiB,
      detail: `${r.label}: JS ${dj >= 0 ? '+' : ''}${f(dj)} MiB over the first menu (${f(menu.js.jsTotal)}) <= +${b.leak.jsOverMenuMiB} (leak)`,
    });
    out.push({
      ok: dg <= b.leak.gpuOverMenuMiB * MiB,
      detail: `${r.label}: GPU ${dg >= 0 ? '+' : ''}${f(dg)} MiB over the first menu (${f(menu.gpu.liveBytes)}) <= +${b.leak.gpuOverMenuMiB} (leak)`,
    });
    out.push({
      ok: r.gpu.liveContexts <= menu.gpu.liveContexts,
      detail: `${r.label}: ${r.gpu.liveContexts} live WebGL context(s) <= the menu's ${menu.gpu.liveContexts} (leak)`,
    });
    out.push({
      ok: r.gpu.retainedLostContexts <= b.leak.maxRetainedLostContexts,
      detail: `${r.label}: ${r.gpu.retainedLostContexts} released context(s) still reachable after GC <= ${b.leak.maxRetainedLostContexts} (leak)`,
    });
  }
  return out;
}

/** Filled from CI measurements; see docs/PERFORMANCE.md, "Memory". */
export const MEMORY_BUDGETS: Readonly<Record<string, MemoryBudget>> = {};
