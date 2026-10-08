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
