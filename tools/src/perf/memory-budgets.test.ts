import { describe, expect, it } from 'vitest';
import { envKeyFor, judge, MEMORY_BUDGETS, type MemoryBudget, type Reading } from './memory-budgets';

const MiB = 1048576;

function reading(
  label: string,
  o: { js?: number; gpu?: number; proc?: number; ctx?: number; lost?: number; nodes?: number; bmp?: number } = {}
): Reading {
  return {
    label,
    atS: 0,
    js: { used: 0, total: 0, backing: 0, embedder: 0, jsTotal: (o.js ?? 50) * MiB },
    dom: { nodes: o.nodes ?? 230, documents: 1, listeners: 0 },
    gpu: {
      liveBytes: (o.gpu ?? 100) * MiB,
      liveContexts: o.ctx ?? 1,
      retainedLostContexts: o.lost ?? 0,
      ledger: { contexts: [], sources: { bytes: 0, count: 0, byKind: {} }, bitmaps: { bytes: (o.bmp ?? 0) * MiB, count: 0 }, audio: { bytes: 0, count: 0 }, unknownFormats: [] },
    },
    process: { total: (o.proc ?? 1000) * MiB, byType: {}, method: 'test' },
    inventory: null,
    sim: null,
    uasm: null,
  };
}

const BUDGET: MemoryBudget = {
  conditions: 'test',
  menu: { jsTotalMiB: 60, gpuMiB: 120, processMiB: 1200, bitmapsMiB: 16 },
  board: { jsTotalMiB: 40, gpuMiB: 80, processMiB: 800, bitmapsMiB: 16 },
  mission: { jsTotalMiB: 150, gpuMiB: 300, processMiB: 2000, bitmapsMiB: 600 },
  leak: { jsOverMenuPct: 20, gpuOverMenuPct: 2, maxRetainedLostContexts: 0, maxExtraNodes: 50 },
};

function walk(over: Partial<Record<string, Parameters<typeof reading>[1]>> = {}): Reading[] {
  return [
    reading('menu', over.menu),
    reading('board', { js: 30, gpu: 50, proc: 600, ...over.board }),
    reading('mission a', { js: 120, gpu: 250, proc: 1800, ...over.mission }),
    reading('menu after a', { js: 55, ...over.after }),
  ];
}

const failures = (rs: Reading[]): string[] => judge(rs, BUDGET).filter((v) => !v.ok).map((v) => v.detail);

describe('judge', () => {
  it('passes a walk inside every budget', () => {
    expect(failures(walk())).toEqual([]);
  });

  it.each([
    ['menu JS', { menu: { js: 61 } }, /menu: JS heap/],
    ['board GPU', { board: { gpu: 81 } }, /board: GPU ledger/],
    ['mission process', { mission: { proc: 2001 } }, /mission a: all Chromium processes/],
    ['mission decoded bitmaps (GH-469 savings 1 and 2 reverted)', { mission: { bmp: 972 } }, /mission a: decoded ImageBitmaps 972\.0 MiB <= 600/],
    ['after-leave JS over the menu', { after: { js: 60.5 } }, /menu after a: JS \+10\.5 MiB \(\+21\.0%\)/],
    ['after-leave GPU over the menu', { after: { gpu: 103 } }, /menu after a: GPU \+3\.0 MiB \(\+3\.0%\)/],
    ['a second live context after leaving', { after: { ctx: 2 } }, /2 live WebGL context/],
    ['a released context still reachable', { after: { lost: 1 } }, /1 released context/],
    ['a left screen\'s DOM still reachable', { after: { nodes: 281 } }, /281 DOM nodes, 51 over/],
  ])('fails on %s', (_name, over, re) => {
    const f = failures(walk(over as never));
    expect(f.length).toBeGreaterThan(0);
    expect(f.some((d) => re.test(d))).toBe(true);
  });

  it('refuses to pass a walk with no baseline or no mission', () => {
    expect(failures(walk().filter((r) => r.label !== 'menu'))).toHaveLength(1);
    expect(failures(walk().filter((r) => !r.label.startsWith('mission')))).toHaveLength(1);
    expect(failures(walk().filter((r) => !r.label.startsWith('menu after')))).toHaveLength(1);
  });
});

describe('the after-leave JS ceiling (lead ruling 10 Nov, GH-746)', () => {
  const AFTER: MemoryBudget = { ...BUDGET, menuAfterJsTotalMiB: 64 };
  const fails = (rs: Reading[]): string[] => judge(rs, AFTER).filter((v) => !v.ok).map((v) => v.detail);
  it('holds a menu after leaving to its own ceiling, and only that reading', () => {
    expect(fails(walk({ menu: { js: 55 }, after: { js: 63 } }))).toEqual([]);
    expect(fails(walk({ menu: { js: 55 }, after: { js: 64.5 } }))).toEqual([expect.stringMatching(/menu after a: JS heap \+ ArrayBuffers 64\.5 MiB <= 64 \(menu after a mission\)/)]);
    // the first menu keeps the menu ceiling (60 here)
    expect(fails(walk({ menu: { js: 61 }, after: { js: 63 } })).some((d) => /^menu: JS heap/.test(d))).toBe(true);
  });
  it('the shipped CI budget: 78 after leaving, 65 for the first menu', () => {
    const ci = MEMORY_BUDGETS['linux-x64-swiftshader'];
    // lead ruling 10 Nov (GH-1197 P1): 72. Was 70. Lead ruling 20 Nov 2026 (GH-1400, ragdolls ON, the Rapier module): 78. Was 72.
    expect(ci.menuAfterJsTotalMiB).toBe(78);
    expect(ci.menu.jsTotalMiB).toBe(65);
  });
});

// Lead ruling 20 Nov 2026 (GH-1400): exactly two limits moved, and every other one is pinned here at its value before the
// ruling, so a drive-by loosening of another reads red. The Metal target is local only and was not touched.
describe('the shipped CI limits after the GH-1400 ruling', () => {
  const ci = MEMORY_BUDGETS['linux-x64-swiftshader'];
  it('moved: the JS leak bound is +25%', () => {
    expect(ci.leak.jsOverMenuPct).toBe(25);
  });
  it('did not move: every other memory and GPU limit', () => {
    expect(ci.menu).toEqual({ jsTotalMiB: 65, gpuMiB: 266, processMiB: 1406, bitmapsMiB: 16 });
    expect(ci.board).toEqual({ jsTotalMiB: 27, gpuMiB: 159, processMiB: 810, bitmapsMiB: 16 });
    expect(ci.mission).toEqual({ jsTotalMiB: 154, gpuMiB: 1015, processMiB: 2511, bitmapsMiB: 161 });
    expect(ci.leak.gpuOverMenuPct).toBe(2);
    expect(ci.leak.maxRetainedLostContexts).toBe(0);
    expect(ci.leak.maxExtraNodes).toBe(50);
    expect(MEMORY_BUDGETS['darwin-arm64-metal'].leak.jsOverMenuPct).toBe(30);
    expect(MEMORY_BUDGETS['darwin-arm64-metal'].menuAfterJsTotalMiB).toBeUndefined();
  });

  // The CI walk's own first menu is 62.2 MiB (run 44578814135); the readings below are that walk with the Rapier module
  // resident (the three CI readings) and then with a leak added on top of it.
  const FIRST = 62.2;
  const withModule = (after: { js?: number; gpu?: number; ctx?: number; nodes?: number; lost?: number }): string[] =>
    judge(
      [
        reading('menu', { js: FIRST, gpu: 243, proc: 842, nodes: 501 }),
        reading('board', { js: 25.2, gpu: 138, proc: 625, nodes: 650 }),
        reading('mission a', { js: 147, gpu: 889, proc: 2046, bmp: 64 }),
        reading('menu after a', { js: 77.6, gpu: 243, proc: 1183, nodes: 501, ...after }),
      ],
      ci
    )
      .filter((v) => !v.ok)
      .map((v) => v.detail);

  it('now passes the three readings that were red (77.6, 74.8, 75.8) and nothing else', () => {
    expect(withModule({})).toEqual([]);
    expect(withModule({ js: 74.8 })).toEqual([]);
    expect(withModule({ js: 75.8 })).toEqual([]);
  });

  it('still goes red at the edge of both raised limits', () => {
    // 78.5 is over the 78 ceiling; +25.1% of 62.2 is 77.8, and the ceiling is the binding one there, so use a walk
    // with a lower ceiling reading to see the percentage on its own below.
    expect(withModule({ js: 78.5 }).some((d) => /JS heap \+ ArrayBuffers 78\.5 MiB <= 78 \(menu after a mission\)/.test(d))).toBe(true);
    const bound = judge(
      [reading('menu', { js: 40, gpu: 243, proc: 842, nodes: 501 }), reading('board', { js: 25.2, gpu: 138, proc: 625 }), reading('mission a', { js: 100, gpu: 889, proc: 2046, bmp: 64 }), reading('menu after a', { js: 50.2, gpu: 243, proc: 1183, nodes: 501 })],
      ci
    )
      .filter((v) => !v.ok)
      .map((v) => v.detail);
    expect(bound.some((d) => /JS \+10\.2 MiB \(\+25\.5%\) over the first menu's 40\.0 <= \+25% \(leak\)/.test(d))).toBe(true);
    expect(judge([reading('menu', { js: 40 }), reading('board', { js: 25.2 }), reading('mission a', { js: 100, gpu: 889, proc: 2046, bmp: 64 }), reading('menu after a', { js: 49.9 })], ci).filter((v) => !v.ok && /\(leak\)/.test(v.detail))).toEqual([]);
  });

  it('a mission\'s world left alive per mission still goes red, on the limits that were not moved', () => {
    // A retained renderer and scene shows as a second live WebGL context, extra GPU ledger bytes, and DOM nodes.
    const leaky = withModule({ gpu: 243 + 40, ctx: 2, nodes: 501 + 80 });
    expect(leaky.some((d) => /2 live WebGL context/.test(d))).toBe(true);
    expect(leaky.some((d) => /GPU \+40\.0 MiB/.test(d))).toBe(true);
    expect(leaky.some((d) => /80 over the first menu's 501/.test(d))).toBe(true);
    // ...and a context released but still reachable after GC.
    expect(withModule({ lost: 1 }).some((d) => /1 released context/.test(d))).toBe(true);
    // The Rapier module alone (JS only, no context, GPU or DOM growth) is exactly what the two raised limits admit.
    expect(withModule({ js: 77.6 })).toEqual([]);
  });
});

describe('envKeyFor', () => {
  it('keys on the rasteriser the browser reported', () => {
    expect(envKeyFor('linux', 'x64', 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)')).toBe(
      'linux-x64-swiftshader'
    );
    expect(envKeyFor('darwin', 'arm64', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)')).toBe(
      'darwin-arm64-metal'
    );
  });

  it('has no budget it was never measured for', () => {
    for (const k of Object.keys(MEMORY_BUDGETS)) expect(k).toMatch(/^(linux|darwin)-(x64|arm64)-(swiftshader|metal)$/);
  });
});
