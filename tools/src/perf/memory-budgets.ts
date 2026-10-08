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
    /** A menu reached AFTER leaving a mission may hold at most this many
     *  PERCENT more JS (heap + ArrayBuffers) than the FIRST menu reading. */
    jsOverMenuPct: number;
    /** ...and at most this many percent more GPU (ledger) than the first menu. */
    gpuOverMenuPct: number;
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
    const pj = (100 * dj) / menu.js.jsTotal;
    const pg = menu.gpu.liveBytes > 0 ? (100 * dg) / menu.gpu.liveBytes : dg > 0 ? Infinity : 0;
    const sign = (x: number): string => (x >= 0 ? '+' : '');
    out.push({
      ok: pj <= b.leak.jsOverMenuPct,
      detail:
        `${r.label}: JS ${sign(dj)}${f(dj)} MiB (${sign(pj)}${pj.toFixed(1)}%) over the first menu's ` +
        `${f(menu.js.jsTotal)} <= +${b.leak.jsOverMenuPct}% (leak)`,
    });
    out.push({
      ok: pg <= b.leak.gpuOverMenuPct,
      detail:
        `${r.label}: GPU ${sign(dg)}${f(dg)} MiB (${sign(pg)}${pg.toFixed(1)}%) over the first menu's ` +
        `${f(menu.gpu.liveBytes)} <= +${b.leak.gpuOverMenuPct}% (leak)`,
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

/** Margins over the largest reading of each kind: JS and the process total
 *  move run to run, the GL ledger does not (it counts what was ASKED for, so
 *  the same tree reads the same bytes on every run and every machine), so it
 *  gets the smallest margin. The leak budgets are percentages of the FIRST
 *  menu reading. Budgets round UP to a whole MiB. */
export const MARGIN = { js: 1.25, gpu: 1.15, process: 1.25 } as const;

/** See docs/PERFORMANCE.md, "Memory", for every reading behind these. */
export const MEMORY_BUDGETS: Readonly<Record<string, MemoryBudget>> = {
  // Local only -- CI never runs here. M3 Pro, ANGLE/Metal, 1400x900 @1x, dev
  // server, n=4 walks (2026-10-08). Largest readings: menu-kind JS 62.6 /
  // GPU 522.1 / process 1934.5; board 31.9 / 138.2 / 649.0; mission 128.9 /
  // 882.2 / 3207.3 MiB; after-leave JS +14.6% and GPU +0.0% over the menu.
  'darwin-arm64-metal': {
    conditions: 'darwin-arm64-metal: M3 Pro, ANGLE/Metal, 1400x900 @1x, dev server, n=4, margins JS x1.25 GPU x1.15 process x1.25',
    menu: { jsTotalMiB: 79, gpuMiB: 601, processMiB: 2419 },
    board: { jsTotalMiB: 40, gpuMiB: 159, processMiB: 812 },
    mission: { jsTotalMiB: 162, gpuMiB: 1015, processMiB: 4010 },
    leak: { jsOverMenuPct: 30, gpuOverMenuPct: 2, maxRetainedLostContexts: 0 },
  },
};
