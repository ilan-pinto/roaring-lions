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
  /** Decoded ImageBitmaps still reachable (the ledger's `bitmaps`). Logical
   *  bytes like the GPU ledger, so the same on every machine and run -- the
   *  one reading that locks GH-469 savings 1 and 2 in: the process total's
   *  1.25 margin is wider than either saving. */
  bitmapsMiB: number;
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
    /** DOM nodes alive after a forced GC beyond the first menu's count --
     *  a left screen's detached DOM that something still references. */
    maxExtraNodes: number;
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
    {
      ok: r.gpu.ledger.bitmaps.bytes <= c.bitmapsMiB * MiB,
      detail: `${r.label}: decoded ImageBitmaps ${f(r.gpu.ledger.bitmaps.bytes)} MiB <= ${c.bitmapsMiB} (${kind})`,
    },
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
      ok: r.dom.nodes - menu.dom.nodes <= b.leak.maxExtraNodes,
      detail: `${r.label}: ${r.dom.nodes} DOM nodes, ${r.dom.nodes - menu.dom.nodes} over the first menu's ${menu.dom.nodes} <= ${b.leak.maxExtraNodes} (leak)`,
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
export const MARGIN = { js: 1.25, gpu: 1.15, process: 1.25, bitmaps: 1.15 } as const;

/** A ceiling for a reading that is 0 today would be 0 x 1.15 = 0, and any one
 *  bitmap would fail it; this is the floor a bitmap ceiling is given instead. */
export const BITMAP_FLOOR_MIB = 16;

/** See docs/PERFORMANCE.md, "Memory", for every reading behind these. */
// GH-469 saving 1 (free each GLB texture's CPU copy after upload) LOWERED the
// process ceilings to its own readings x the same 1.25, never raising one:
// CI n=3 (run 37839390735, attempts 1-3) menu 1122-1198 / after a leave
// 1331-1437 / board 649-651 / mission 2296-2464 MiB; Metal n=3 menu-kind <=
// 1679.9 / board <= 546.1 / mission <= 2716.7. JS and GPU unchanged. And it
// ADDED the bitmap ceiling that actually locks it in: decoded bitmaps read
// 0 at the menu and board and 468 / 532 / 564 MiB at the three missions, the
// same bytes on CI (n=3) and Metal (n=3); x 1.15, with BITMAP_FLOOR_MIB for
// the zeroes. main read 184 / 64 / 888-1004 there, so a revert fails it.
// GH-469 saving 2 (don't decode textures for templates nobody draws), measured
// COMBINED with saving 1 after #478 landed: CI n=1 (run 37853799840) menu
// 1397 / board 648 / mission <= 2008 MiB process, decoded bitmaps 0 at the
// menu and board and 48 / 112 / 108 at the missions; Metal n=3 mission <=
// 2346, bitmaps 48 / 112 / 108-140. Process ceilings re-derived x 1.25 and
// only lowered (linux mission 3080 -> 2511, darwin 3396 -> 2933); the mission
// bitmap ceiling 649 -> 161 (140 x 1.15). Reverting either saving fails it:
// on Metal, saving 1 reverted reads 488-552 at the missions, saving 2
// reverted 500-564.
// GH-469 saving 3 (a lighter live menu backdrop), measured COMBINED with
// savings 1 and 2: CI n=1 (run 37880172368) the menu's GPU ledger 522.1 ->
// 230.8 MiB on every menu reading, process menu <= 1124.5, board 661.4,
// mission <= 2010.6; Metal n=3 menu-kind <= 1394.1, board 529.5, mission <=
// 2303.2. Menu GPU 601 -> 266 (230.8 x 1.15) -- the lock, since main's 522
// fails it -- and the process ceilings x 1.25, only lowered.
export const MEMORY_BUDGETS: Readonly<Record<string, MemoryBudget>> = {
  // CI's `memory` job. ubuntu-latest, ANGLE/SwiftShader, 1400x900 @1x, dev
  // server, n=4 walks on four runners (2026-10-08, run 37826952688: the
  // `memory` job and three `memory-calibrate` runners). Largest readings:
  // menu-kind JS 59.7 / GPU 522.1 / process 1636.5; board 31.9 / 138.3 /
  // 750.7; mission 125.2 / 882.2 / 2927.0 MiB; after-leave JS +9.8% and GPU
  // +0.0% over the menu, DOM nodes +0, no released context reachable. A fifth
  // walk with 10 s play slices (run 37820472000) read inside these but for a
  // mission process total of 2946.7. Leak percentages are about twice the
  // largest measured, rounded up to 5.
  'linux-x64-swiftshader': {
    conditions: 'linux-x64-swiftshader: ubuntu-latest, SwiftShader, 1400x900 @1x, dev server, n=4 (process and bitmaps re-measured at GH-469 savings 1+2+3: CI n=1, Metal n=3), margins JS x1.25 GPU x1.15 process x1.25 bitmaps x1.15',
    menu: { jsTotalMiB: 75, gpuMiB: 266, processMiB: 1406, bitmapsMiB: 16 },
    board: { jsTotalMiB: 40, gpuMiB: 159, processMiB: 810, bitmapsMiB: 16 },
    mission: { jsTotalMiB: 157, gpuMiB: 1015, processMiB: 2511, bitmapsMiB: 161 },
    leak: { jsOverMenuPct: 20, gpuOverMenuPct: 2, maxRetainedLostContexts: 0, maxExtraNodes: 50 },
  },
  // Local only -- CI never runs here. M3 Pro, ANGLE/Metal, 1400x900 @1x, dev
  // server, n=4 walks (2026-10-08). Largest readings: menu-kind JS 62.6 /
  // GPU 522.1 / process 1934.5; board 31.9 / 138.2 / 649.0; mission 128.9 /
  // 882.2 / 3207.3 MiB; after-leave JS +14.6% and GPU +0.0% over the menu,
  // DOM nodes +0.
  'darwin-arm64-metal': {
    conditions: 'darwin-arm64-metal: M3 Pro, ANGLE/Metal, 1400x900 @1x, dev server, n=4 (process and bitmaps re-measured at GH-469 savings 1+2+3: CI n=1, Metal n=3), margins JS x1.25 GPU x1.15 process x1.25 bitmaps x1.15',
    menu: { jsTotalMiB: 79, gpuMiB: 266, processMiB: 1743, bitmapsMiB: 16 },
    board: { jsTotalMiB: 40, gpuMiB: 159, processMiB: 662, bitmapsMiB: 16 },
    mission: { jsTotalMiB: 162, gpuMiB: 1015, processMiB: 2880, bitmapsMiB: 161 },
    leak: { jsOverMenuPct: 30, gpuOverMenuPct: 2, maxRetainedLostContexts: 0, maxExtraNodes: 50 },
  },
};
