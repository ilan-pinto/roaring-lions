import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BEAM_GAP_TILES,
  COINCIDE_XZ_TILES,
  COINCIDE_Y_TILES,
  E6_SUBJECTS,
  PAGE_API,
  ROOT_GAP_TILES,
  TICK_FRAMES,
  TICK_MS,
  backendVerdict,
  checkLabel,
  classifyConsole,
  coincide,
  e6FlipHtml,
  freshRunDir,
  guarded,
  installSignalStop,
  portRefusal,
  readbackVerdict,
  shaderVerdict,
  type ProgramReport,
  type SignalHost,
} from './e6-captures';
import { E6_KEYS, E6_KEY_LIST } from './e6-floors';

describe('the console is a verdict: the first compile of three shaders on a GPU', () => {
  it('fails on any console.error and any page error', () => {
    expect(classifyConsole('error', 'something broke')).toBe('fatal');
    expect(classifyConsole('pageerror', 'ReferenceError: x is not defined')).toBe('fatal');
  });

  it("fails on three's own shader and program errors, at any level", () => {
    expect(classifyConsole('error', 'THREE.WebGLProgram: Shader Error 0 - VALIDATE_STATUS false')).toBe('fatal');
    expect(classifyConsole('warning', 'THREE.WebGLProgram: program not valid')).toBe('fatal');
    expect(classifyConsole('warning', 'THREE.WebGLShader: Shader couldn\'t compile.')).toBe('fatal');
    expect(classifyConsole('warning', 'WebGL: INVALID_OPERATION: useProgram: program not valid')).toBe('fatal');
    expect(classifyConsole('warning', 'ANGLE: link error: varying not written')).toBe('fatal');
  });

  it('records an ordinary warning as a note, not a failure', () => {
    expect(classifyConsole('warning', 'a deprecation notice about something else')).toBe('note');
  });

  it("treats the harness's own staging line as a note even though it says nothing about shaders", () => {
    const line = '[lions] drone_swarm reached the field with no mesh queued - loading it now.';
    expect(classifyConsole('warning', line)).toBe('note');
  });

  it("exempts SwiftShader's own readback note, as routes-check does", () => {
    expect(classifyConsole('warning', 'GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels')).toBe('note');
  });

  it('ignores a plain log line that names nothing', () => {
    expect(classifyConsole('log', 'hello')).toBe('ignore');
    expect(classifyConsole('info', 'program loaded the campaign')).toBe('ignore');
  });
});

describe('S2: the draw follows the sim, and the swarm actually thinned', () => {
  const run = (members: number[], drawn: number[] = members) => members.map((m, i) => ({ tick: i, members: m, drawn: drawn[i] }));

  it('passes a draw that equals the sim at every frame over a thinning swarm', () => {
    const v = readbackVerdict(run([12, 12, 11, 11, 10, 9, 8, 8, 7, 6]), 12, 4);
    expect(v.ok).toBe(true);
    expect(v.distinctMembers).toEqual([12, 11, 10, 9, 8, 7, 6]);
  });

  it('FAILS a draw that ignores swarmMembers and keeps drawing the full count', () => {
    const members = [12, 12, 11, 11, 10, 9, 8];
    const v = readbackVerdict(run(members, members.map(() => 12)), 12, 4);
    expect(v.ok).toBe(false);
    expect(v.mismatches.length).toBe(5);
    expect(v.reasons.join(' ')).toMatch(/draw a count the sim does not have|drew a count/);
  });

  it('fails a single frame of disagreement', () => {
    const members = [12, 12, 11, 10, 9];
    const drawn = [12, 12, 11, 11, 9];
    expect(readbackVerdict(run(members, drawn), 12, 4).ok).toBe(false);
  });

  it('refuses a readback over a swarm that never thinned: it would pass for any draw', () => {
    const v = readbackVerdict(run([12, 12, 12, 12, 12]), 12, 4);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/never thinned/);
  });

  it('refuses a run that does not begin at the full count, and an empty one', () => {
    expect(readbackVerdict(run([11, 10, 9, 8]), 12, 4).ok).toBe(false);
    expect(readbackVerdict([], 12, 4).ok).toBe(false);
  });
});

describe('S4: the beam ends on the member that falls', () => {
  const end = { x: 11, y: 0.6, z: 3 };

  it('passes a fall that starts where the beam ended', () => {
    expect(coincide(end, { x: 11.01, y: 0.6, z: 3.0 }).ok).toBe(true);
  });

  it('FAILS the lowest slot falling instead: another member, another place in the cloud', () => {
    // The cloud is 1.5 tiles across: a different slot is up to ~1.5 tiles away.
    expect(coincide(end, { x: 10.4, y: 0.6, z: 3.5 }).ok).toBe(false);
    expect(coincide(end, { x: 11, y: 0.6, z: 3 + COINCIDE_XZ_TILES + 0.01 }).ok).toBe(false);
    expect(coincide(end, { x: 11, y: 0.6 + COINCIDE_Y_TILES + 0.01, z: 3 }).ok).toBe(false);
  });
});

describe('the subject table covers spec 8', () => {
  it('has distinct ids', () => {
    const ids = E6_SUBJECTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('witnesses every one of S1 to S8, each by at least one subject', () => {
    const covered = new Set(E6_SUBJECTS.flatMap((s) => s.covers));
    for (const n of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']) expect(covered.has(n), n).toBe(true);
  });

  it('keeps every subject on the open northern band (rows 0-7) and in range of itself', () => {
    for (const s of E6_SUBJECTS) {
      expect(s.y, s.id).toBeGreaterThanOrEqual(0);
      expect(s.y, s.id).toBeLessThan(8);
    }
    expect(BEAM_GAP_TILES).toBeLessThan(9); // the beam's range
    expect(ROOT_GAP_TILES).toBeLessThan(BEAM_GAP_TILES);
  });

  it('places the four root subjects at the four cardinal bearings, so one of them faces each way', () => {
    const roots = E6_SUBJECTS.filter((s) => s.mode === 'root').map((s) => `${s.bearing?.[0]},${s.bearing?.[1]}`);
    expect(new Set(roots)).toEqual(new Set(['1,0', '0,1', '-1,0', '0,-1']));
  });

  it('puts the subject that leaves wrecks on the ground after the one that wants clean sand', () => {
    const order = E6_SUBJECTS.map((s) => s.id);
    expect(order.indexOf('scale')).toBeLessThan(order.indexOf('beam_sequence'));
  });
});

describe('the lockstep, run against a fake page', () => {
  /** The in-page API, evaluated for real with a stub `__lions`, so what it DOES is asserted, not what it spells. */
  function page(opts: { lostOnConstruct?: boolean } = {}) {
    const frames: { alpha: number; dt: number }[] = [];
    const calls: string[] = [];
    const listeners: Record<string, () => void> = {};
    const hidden: Record<string, number> = { beam: 1, missiles: 0 };
    const renderer = {
      camera: { x: 0, y: 0, zoom: 1 },
      frame: (alpha: number, dt: number) => frames.push({ alpha, dt }),
      snapshot: () => calls.push('snapshot'),
      onEvents: () => calls.push('onEvents'),
      setDebugLayerVisible: (name: string) => hidden[name] ?? 0,
      worldToScreen: () => ({ x: 0, y: 0 }),
      renderer: { getContext: () => ({ isContextLost: () => opts.lostOnConstruct === true, getExtension: () => null, getParameter: () => 'stub', RENDERER: 0, VERSION: 1 }) },
    };
    const sim = { tickCount: 0, tick: () => { sim.tickCount++; calls.push('tick'); return []; }, entityCount: 0, state: { alive: [] }, unitTypes: [] };
    const window = { __lions: { renderer, sim } };
    const document = { querySelector: () => ({ addEventListener: (ev: string, fn: () => void) => { listeners[ev] = fn; }, clientWidth: 1400, clientHeight: 900 }) };
    const api = new Function('window', 'document', `return ${PAGE_API}`)(window, document) as Record<string, (...a: unknown[]) => unknown> & { alpha: number; lost: boolean };
    return { api, frames, calls, listeners };
  }

  it('is a string, never a function: esbuild keepNames would wrap a function in __name', () => {
    expect(typeof PAGE_API).toBe('string');
    expect(PAGE_API).not.toMatch(/__name/);
  });

  it('pumps one tick as three frames that sum to exactly 50 ms', () => {
    expect(TICK_FRAMES.reduce((a, b) => a + b, 0)).toBe(TICK_MS);
    expect(Math.max(...TICK_FRAMES)).toBeLessThan(100);
  });

  it('ticks the sim by hand and carries alpha through the tick like the app loop (never through __lions.step)', () => {
    const { api, frames, calls } = page();
    (api.tick as (n: number) => unknown)(1);
    expect(calls).toEqual(['tick', 'snapshot', 'onEvents']);
    expect(frames.map((f) => f.dt)).toEqual([16, 16, 18]);
    expect(frames.map((f) => Number(f.alpha.toFixed(2)))).toEqual([0.32, 0.64, 1]);
  });

  it('repaints at zero elapsed presentation time at the current alpha', () => {
    const { api, frames } = page();
    api.alpha = 0;
    (api.repaint as () => unknown)();
    expect(frames).toEqual([{ alpha: 0, dt: 0 }]);
  });

  it('hands a layer toggle back the object count the renderer resolved, then repaints at zero time', () => {
    const { api, frames } = page();
    expect((api.layer as (n: string, v: boolean) => number)('beam', false)).toBe(1);
    expect((api.layer as (n: string, v: boolean) => number)('missiles', false)).toBe(0);
    expect(frames.every((f) => f.dt === 0)).toBe(true);
  });

  it('reports a lost WebGL context, from the context itself or from the event', () => {
    const a = page();
    expect((a.api.gl as () => { lost: boolean })().lost).toBe(false);
    a.listeners['webglcontextlost']();
    expect((a.api.gl as () => { lost: boolean })().lost).toBe(true);
    expect((page({ lostOnConstruct: true }).api.gl as () => { lost: boolean })().lost).toBe(true);
  });
});

describe('shaderVerdict: a green over nothing is not a green', () => {
  const good: ProgramReport = {
    named: { fog: { present: true, compiled: true, linked: true }, beam: { present: true, compiled: true, linked: true } },
    all: { count: 66, failed: [] },
  };

  it('passes a full report with linked programs and a live context', () => {
    expect(shaderVerdict(good, { full: true, contextLost: false })).toEqual([]);
  });

  it('FAILS an inspection that saw 0 programs', () => {
    const v = shaderVerdict({ ...good, all: { count: 0, failed: [] } }, { full: true, contextLost: false });
    expect(v.join(' ')).toMatch(/0 programs/);
  });

  it('FAILS a lost context even when every program reads linked', () => {
    expect(shaderVerdict(good, { full: true, contextLost: true }).join(' ')).toMatch(/context was lost/);
  });

  it('fails a program that did not link, one that failed in the global list, and a missing report', () => {
    const bad: ProgramReport = { named: { beam: { present: true, compiled: true, linked: false, log: 'ERROR' } }, all: { count: 3, failed: ['x: log'] } };
    const v = shaderVerdict(bad, { full: false, contextLost: false }).join(' ');
    expect(v).toMatch(/beam: program did not link: ERROR/);
    expect(v).toMatch(/program failed to link: x: log/);
    expect(shaderVerdict(null, { full: false, contextLost: false })).toEqual(['the shader link check never ran']);
  });

  it('requires every named program in a full run, and only the compiled ones in a partial one', () => {
    const partial: ProgramReport = { named: { rotors: { present: true, compiled: false } }, all: { count: 5, failed: [] } };
    expect(shaderVerdict(partial, { full: true, contextLost: false }).join(' ')).toMatch(/rotors: no program was ever compiled/);
    expect(shaderVerdict(partial, { full: false, contextLost: false })).toEqual([]);
  });
});

describe('backendVerdict: the floors were calibrated on Metal', () => {
  const metal = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)';
  it('passes a Metal request that got Metal', () => {
    expect(backendVerdict('metal', metal)).toEqual({ failure: null, stamp: null });
  });
  it('FAILS a Metal request whose renderer is not Metal', () => {
    const v = backendVerdict('metal', 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)), SwiftShader driver)');
    expect(v.failure).toMatch(/not Metal/);
  });
  it('stamps a SwiftShader run, in the sheet header, rather than failing it', () => {
    const v = backendVerdict('swiftshader', 'ANGLE (SwiftShader)');
    expect(v.failure).toBeNull();
    expect(v.stamp).toMatch(/floors calibrated on Metal/);
  });
});

describe('the port is refused before anything claims it', () => {
  it('refuses 5173 and 5177 and nothing else', () => {
    expect(portRefusal(5177)).toMatch(/5177/);
    expect(portRefusal(5173)).toMatch(/5173/);
    expect(portRefusal(5179)).toBeNull();
    expect(portRefusal(5178)).toBeNull();
  });
});

describe('teardown: no run leaves vite listening', () => {
  function host() {
    const handlers: Record<string, (() => void)[]> = {};
    const h: SignalHost = {
      once: (e, fn) => { (handlers[e] ??= []).push(fn); },
      removeListener: (e, fn) => { handlers[e] = (handlers[e] ?? []).filter((x) => x !== fn); },
    };
    return { h, handlers };
  }

  it('stops the server and exits 130 on SIGINT and on SIGTERM', () => {
    for (const sig of ['SIGINT', 'SIGTERM'] as const) {
      const { h, handlers } = host();
      const log: string[] = [];
      installSignalStop(() => log.push('stop'), h, (c) => log.push(`exit ${c}`));
      for (const fn of handlers[sig]) fn();
      expect(log).toEqual(['stop', 'exit 130']);
    }
  });

  it('takes its handlers off again', () => {
    const { h, handlers } = host();
    const off = installSignalStop(() => undefined, h, () => undefined);
    off();
    expect(handlers['SIGINT']).toEqual([]);
    expect(handlers['SIGTERM']).toEqual([]);
  });

  it('stops the server when the browser fails to LAUNCH', async () => {
    const log: string[] = [];
    await expect(guarded(() => Promise.reject(new Error('launch failed')), () => log.push('stop'), async () => 1)).rejects.toThrow('launch failed');
    expect(log).toEqual(['stop']);
  });

  it('closes the browser, then stops the server, when the body throws', async () => {
    const log: string[] = [];
    const browser = { close: async () => { log.push('close'); } };
    await expect(guarded(async () => browser, () => log.push('stop'), async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(log).toEqual(['close', 'stop']);
  });

  it('stops the server even when closing the browser throws', async () => {
    const log: string[] = [];
    const browser = { close: async () => { throw new Error('close failed'); } };
    await expect(guarded(async () => browser, () => log.push('stop'), async () => 1)).rejects.toThrow('close failed');
    expect(log).toEqual(['stop']);
  });

  it('returns the body result on the happy path', async () => {
    const browser = { close: async () => undefined };
    expect(await guarded(async () => browser, () => undefined, async () => 42)).toBe(42);
  });
});

describe('every run writes to a fresh directory', () => {
  it('accepts a directory that does not exist or is empty', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'e6-fresh-'));
    expect(freshRunDir(root, 'a')).toBe(path.join(root, 'a'));
    mkdirSync(path.join(root, 'b'));
    expect(freshRunDir(root, 'b')).toBe(path.join(root, 'b'));
  });

  it('REFUSES a directory that already holds a previous run', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'e6-fresh-'));
    mkdirSync(path.join(root, 'old'));
    writeFileSync(path.join(root, 'old', 'beam_sequence-00050ms-seq.png'), 'x');
    expect(() => freshRunDir(root, 'old')).toThrow(/not empty/);
  });
});

describe('a report-only row is never a pass', () => {
  it('labels info INFO whatever its ok says, and the rest PASS or FAIL', () => {
    expect(checkLabel({ ok: true, info: true })).toBe('INFO');
    expect(checkLabel({ ok: false, info: true })).toBe('INFO');
    expect(checkLabel({ ok: true })).toBe('PASS');
    expect(checkLabel({ ok: false })).toBe('FAIL');
  });
});

describe('the flip page', () => {
  it('plays frames at their real timestamps and escapes a file name', () => {
    const html = e6FlipHtml('x', [{ file: 'a<b>.png', tMs: 0 }, { file: 'c.png', tMs: 100 }]);
    expect(html).toContain('"a\\u003cb>.png"');
    expect(html).toContain('const T=[0,100]');
  });
});

describe('every key describes its rung', () => {
  it('has a rung description for every key', () => {
    for (const key of E6_KEY_LIST) expect(E6_KEYS[key].rung.length, key).toBeGreaterThan(5);
  });
});
