import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  classifyConsole,
  coincide,
  e6FlipHtml,
  readbackVerdict,
} from './e6-captures';
import { E6_KEYS, E6_KEY_LIST } from './e6-floors';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, 'e6-captures.ts'), 'utf8');

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

  it('reads every key of the floors table somewhere in the harness source', () => {
    for (const key of E6_KEY_LIST) expect(source.includes(`'${key}'`), key).toBe(true);
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

describe('the lockstep', () => {
  it('pumps one tick as three frames that sum to exactly 50 ms', () => {
    expect(TICK_FRAMES.reduce((a, b) => a + b, 0)).toBe(TICK_MS);
    expect(Math.max(...TICK_FRAMES)).toBeLessThan(100); // under FRAME_DT_CEILING_MS: raw and clamped clocks agree
  });

  it('is a string, never a function: esbuild keepNames would wrap a function in __name', () => {
    expect(typeof PAGE_API).toBe('string');
    expect(PAGE_API).not.toMatch(/__name/);
    // The in-page API is evaluated as an expression and must parse as one.
    expect(() => new Function(`return ${PAGE_API}`)).not.toThrow();
  });

  it('carries alpha through the frames like the app loop, and never ticks through __lions.step', () => {
    expect(PAGE_API).toMatch(/r\.frame\(acc \/ 50, f\)/);
    expect(PAGE_API).toMatch(/sim\.tick\(\)/);
    expect(PAGE_API).toMatch(/r\.snapshot\(\)/);
    expect(PAGE_API).toMatch(/r\.onEvents\(events\)/);
  });

  it('repaints a toggle at zero elapsed presentation time', () => {
    expect(PAGE_API).toMatch(/api\.repaint = \(\) => \{ r\.frame\(api\.alpha, 0\)/);
    expect(PAGE_API).toMatch(/api\.layer = .*setDebugLayerVisible.*r\.frame\(api\.alpha, 0\)/);
  });
});

describe('the harness takes a port, music off, and the GPU like every other', () => {
  const code = source
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

  it('claims its port through port.ts with its own environment key, and refuses 5173 and 5177', () => {
    expect(code).toMatch(/claimPort\('e6-captures', 'E6_CAPTURE_PORT', PORT\)/);
    expect(code).toMatch(/const PORT = 5179/);
    expect(code).toMatch(/port === 5173 \|\| port === 5177/);
  });

  it('starts music off through the one helper and never writes lions.settings by hand', () => {
    expect(code).toMatch(/musicOffInitScript\(\)/);
    expect(code).not.toMatch(/lions\.settings/);
  });

  it('chooses its GPU backend through gpu.ts (Metal on macOS)', () => {
    expect(code).toMatch(/gpuLaunchArgs\(resolveGpuBackend\(process\.argv, process\.platform\)\)/);
  });

  it('freezes the frame loop and asks the inherited steady-loop settle with its refusal', () => {
    expect(code).toMatch(/FREEZE_FRAME_LOOP_SCRIPT/);
    expect(code).toMatch(/settleScript\(settleMs\)/);
    expect(code).toMatch(/unsteadySettleRefusal\(/);
  });

  it('stops only the dev server it started, through the harness stop, and never pkills', () => {
    expect(code).toMatch(/stopDevServer\(server, 'e6-captures'\)/);
    expect(code).not.toMatch(/pkill|killall/);
  });

  it('spawns every subject and never finds one', () => {
    expect(code).toMatch(/__e6\.spawn|window\.__e6\.spawn/);
    expect(code).toMatch(/api\.clear/);
  });
});

describe('the flip page', () => {
  it('plays frames at their real timestamps and escapes a file name', () => {
    const html = e6FlipHtml('x', [{ file: 'a<b>.png', tMs: 0 }, { file: 'c.png', tMs: 100 }]);
    expect(html).toContain('"a\\u003cb>.png"');
    expect(html).toContain('const T=[0,100]');
  });
});

describe('every key names a layer the table can toggle', () => {
  it('has a rung description for every key', () => {
    for (const key of E6_KEY_LIST) expect(E6_KEYS[key].rung.length, key).toBeGreaterThan(5);
  });
});
