import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  GRASS_LAYER,
  GRASS_NAME_PREFIX,
  GRASS_ZOOMS,
  HIDE_GRASS_SCRIPT,
  flatFrameRefusal,
  identicalPairRefusal,
  settleField,
  sheetBootRefusals,
  countGrassMeshes,
  grassColumnRefusals,
  grassCondition,
  grassRefusals,
  grassRows,
  grassTable,
  hideGrassOnPage,
  hiddenRefusal,
  type GrassNodeLike,
  type GrassReading,
} from './webgpu-grass-lib';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(path.resolve(HERE, rel), 'utf8');

const pass = (sceneCalls: number, shadow = 20, ao = 30): GrassReading['perPass'] => ({
  shadow: { calls: shadow, objects: shadow },
  scene: { calls: sceneCalls, objects: sceneCalls },
  ao: { calls: ao, objects: ao },
  post: { calls: 6, objects: 6 },
});
/** A literal on/off pair at every zoom: the field adds 40 scene calls and 90k triangles and touches no other pass. */
const goodReadings = (): GrassReading[] =>
  GRASS_ZOOMS.flatMap((zoom): GrassReading[] => [
    { zoom, grass: 'on', perPass: pass(140), triangles: 590_000, grassMeshes: 40, layerChanged: 0 },
    { zoom, grass: 'off', perPass: pass(100), triangles: 500_000, grassMeshes: 0, layerChanged: 1 },
  ]);

const node = (name: string, visible: boolean, isMesh: boolean, children: GrassNodeLike[] = []): GrassNodeLike => ({ name, visible, isMesh, children });

describe('countGrassMeshes', () => {
  it('counts visible meshes named under the field, and none under a hidden ancestor or with another name', () => {
    const scene = node('scene', true, false, [
      node(GRASS_NAME_PREFIX, true, false, [node(`${GRASS_NAME_PREFIX}-c0-v0`, true, true), node(`${GRASS_NAME_PREFIX}-c0-v1`, false, true), node(`${GRASS_NAME_PREFIX}-c1-v0`, true, true)]),
      node('rl-ground', true, true),
      node('other', false, false, [node(`${GRASS_NAME_PREFIX}-stray`, true, true)]),
    ]);
    expect(countGrassMeshes(scene)).toBe(2);
  });
  it('is zero when the root of the field is hidden', () => {
    const scene = node('scene', true, false, [node(GRASS_NAME_PREFIX, false, false, [node(`${GRASS_NAME_PREFIX}-c0-v0`, true, true)])]);
    expect(countGrassMeshes(scene)).toBe(0);
  });
});

describe('grassRefusals: the probe cannot pass vacuously', () => {
  it('reads a good pair at every zoom', () => {
    expect(grassRefusals(goodReadings())).toEqual([]);
    // One row per zoom (0.5, 1, 1.5, 2.5): an empty list would pass `every` vacuously.
    expect(grassRows(goodReadings())).toHaveLength(4);
    expect(grassRows(goodReadings()).every((r) => r.sceneCalls === 40 && r.shadowCalls === 0 && r.aoCalls === 0 && r.triangles === 90_000)).toBe(true);
  });
  it('REFUSES a grass-on arm that built no field (0 visible grass meshes, scene calls equal the off arm)', () => {
    const noField = goodReadings().map((r): GrassReading => (r.grass === 'on' ? { ...r, perPass: pass(100), triangles: 500_000, grassMeshes: 0 } : r));
    const out = grassRefusals(noField);
    expect(out).toHaveLength(GRASS_ZOOMS.length);
    expect(out[0]).toMatch(/0 visible grass meshes.*0 grass calls/);
  });
  it('REFUSES a grass-on arm with meshes but no more scene calls than the off arm', () => {
    const same = goodReadings().map((r): GrassReading => (r.grass === 'on' ? { ...r, perPass: pass(100) } : r));
    expect(grassRefusals(same)[0]).toMatch(/0 grass calls/);
  });
  it('REFUSES a grass-off arm that still shows grass, and a hide that changed nothing', () => {
    const stillOn = goodReadings().map((r): GrassReading => (r.grass === 'off' ? { ...r, grassMeshes: 3 } : r));
    expect(grassRefusals(stillOn)[0]).toMatch(/grass-off arm still has 3/);
    const noToggle = goodReadings().map((r): GrassReading => (r.grass === 'off' ? { ...r, layerChanged: 0 } : r));
    expect(grassRefusals(noToggle)[0]).toMatch(/0 changed/);
  });
  it('REFUSES a table with a hole: a zoom with only one arm, and an empty reading list', () => {
    const hole = goodReadings().filter((r) => !(r.zoom === 1.5 && r.grass === 'off'));
    expect(grassRefusals(hole)).toEqual(['z1.5: no grass-off reading']);
    expect(grassRefusals([])).toHaveLength(GRASS_ZOOMS.length);
  });
  it('prints one row per zoom, with the shadow and AO deltas', () => {
    const t = grassTable(goodReadings());
    expect(t).toHaveLength(2 + GRASS_ZOOMS.length);
    expect(t[2]).toBe('| z0.5 | 40 | 140 / 100 | 90000 | 0 | 0 | 40 |');
  });
});

describe('the hide on the tools that boot the app', () => {
  const fakeWindow = (hides: boolean): { evaluate(script: string): Promise<unknown>; calls: [string, boolean][] } => {
    const calls: [string, boolean][] = [];
    const field = node(GRASS_NAME_PREFIX, true, false, [node(`${GRASS_NAME_PREFIX}-c0-v0`, true, true)]);
    const scene = node('scene', true, false, [field]);
    const renderer = {
      scene,
      setDebugLayerVisible: (name: string, visible: boolean): number => {
        calls.push([name, visible]);
        if (hides && name === GRASS_LAYER) (field as { visible: boolean }).visible = visible;
        return hides ? 1 : 0;
      },
    };
    return { calls, evaluate: async (script: string) => new Function('window', `return ${script}`)({ __lions: { renderer } }) as unknown };
  };
  it('hides the layer and reads 0 visible meshes', async () => {
    const w = fakeWindow(true);
    expect(await hideGrassOnPage(w, 't')).toEqual({ changed: 1, meshes: 0 });
    expect(w.calls).toEqual([[GRASS_LAYER, false]]);
  });
  it('throws a refusal when the layer left grass visible', async () => {
    await expect(hideGrassOnPage(fakeWindow(false), 'banding-probe L')).rejects.toThrow(/banding-probe L: grass: hidden was asked for but 1 grass mesh/);
    expect(hiddenRefusal('x', 0)).toBeNull();
    expect(hiddenRefusal('x', 2)).toMatch(/2 grass mesh/);
  });
  it('the injected script carries the same layer and prefix as the module', () => {
    expect(HIDE_GRASS_SCRIPT).toContain(JSON.stringify(GRASS_LAYER));
    expect(HIDE_GRASS_SCRIPT).toContain(JSON.stringify(GRASS_NAME_PREFIX));
  });
});

describe('grassColumnRefusals (webgpu:abba --grass)', () => {
  const on = { mode: 'on', meshes: 30, views: [{ zoom: 1, triangles: 600 }, { zoom: 2.5, triangles: 700 }] } as const;
  const off = { mode: 'off', meshes: 0, views: [{ zoom: 1, triangles: 500 }, { zoom: 2.5, triangles: 600 }] } as const;
  it('passes a real on/off pair', () => expect(grassColumnRefusals(on, off)).toEqual([]));
  it('refuses an on page with no grass, an off page with grass, and two identical scenes', () => {
    expect(grassColumnRefusals({ ...on, meshes: 0 }, off)[0]).toMatch(/0 grass calls/);
    expect(grassColumnRefusals(on, { ...off, meshes: 4 })[0]).toMatch(/still has 4/);
    expect(grassColumnRefusals({ ...on, views: off.views }, off)).toHaveLength(2);
  });
});

describe('the instruments name the grass (design 5.3, decision 12)', () => {
  it('prints grass: hidden', () => expect(grassCondition('hidden')).toBe('grass: hidden'));
  it('the layer and the name prefix are the renderer\'s own', () => {
    expect(src('../../../packages/render/src/three/terrain/grass-field.node.ts')).toContain(`export const GRASS_FIELD_NAME = '${GRASS_NAME_PREFIX}';`);
    expect(src('../../../packages/render/src/three/debug-layers.ts')).toContain(`'${GRASS_LAYER}'`);
  });

  /**
   * EVERY tool under tools/src/perf that names wadi_halam_4 either hides the grass (it imports the grass lib) or is named here with its
   * reason. A new tool that frames the map is red until it does one or the other.
   */
  const EXEMPT: Readonly<Record<string, string>> = {
    'webgpu-units-probe-lib.ts': 'the subject table only (data): the probe that boots them, webgpu-units-probe.ts, hides the grass',
    'wounded-read-captures.ts': 'wound reads on one arm (no L-vs-G); it does not boot the node field comparison',
    'webgpu-grass-lib.ts': 'is the lib',
    'webgpu-grass-probe.ts': 'IS the grass column (G on against G off); it names the map for it',
  };
  const files = readdirSync(HERE).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  const naming = files.filter((f) => src(f).includes('wadi_halam_4'));
  it('finds the tools (the scan reads something)', () => expect(naming.length).toBeGreaterThanOrEqual(8));
  for (const f of naming) {
    if (EXEMPT[f] !== undefined) continue;
    it(`${f} hides the grass and prints it`, () => {
      const text = src(f);
      expect(text, `${f} must import the grass lib`).toMatch(/from '\.\/webgpu-grass-lib'/);
      expect(text, `${f} must name grassCondition or take the page's grass state`).toMatch(/grassCondition|hiddenRefusal|hideGrassOnPage|grass: GrassMode|grass\?: GrassMode/);
    });
  }
  it('has no stale exemption', () => {
    for (const f of Object.keys(EXEMPT)) expect(files, `${f} is exempt but not in the directory`).toContain(f);
  });
  it('the app-booting tools call hideGrassOnPage and the page-booting ones pass the mode through', () => {
    for (const f of ['webgpu-banding-probe.ts', 'webgpu-banding-sheet.ts', 'webgpu-p1-sheet.ts', 'webgpu-p2-sheet.ts', 'webgpu-units-probe.ts', 'webgpu-raf-hypothesis.ts']) {
      expect(src(f), f).toContain('hideGrassOnPage(page');
      expect(src(f), `${f} must import hideGrassOnPage`).toMatch(/import \{[^}]*\bhideGrassOnPage\b[^}]*\} from '\.\/webgpu-grass-lib'/);
    }
    expect(src('webgpu-submit-probe.ts')).toContain("info.grass.mode !== 'hidden'");
    expect(src('webgpu-abba-run.ts')).toContain("grassCondition('hidden')");
  });
});

describe('GH-1167 S7/S8 follow-up: the sheet refusals and the settled wait', () => {
  const flat = (v: number, n = 4 * 97 * 4): Uint8Array => new Uint8Array(n).fill(v);
  it('flatFrameRefusal: a flat frame refuses, a frame with a 40-level spread passes', () => {
    expect(flatFrameRefusal('f', flat(90))).toMatch(/blank or flat \(range 90\.\.90\)/);
    const varied = flat(90);
    varied[4 * 97 * 2] = 130;
    varied[4 * 97 * 2 + 1] = 130;
    varied[4 * 97 * 2 + 2] = 130;
    expect(flatFrameRefusal('f', varied)).toBeNull();
    // a spread of 11 is still flat, 12 is not (the literal floor)
    const edge = flat(100);
    for (const k of [0, 1, 2]) edge[4 * 97 + k] = 111;
    expect(flatFrameRefusal('f', edge)).not.toBeNull();
    for (const k of [0, 1, 2]) edge[4 * 97 + k] = 112;
    expect(flatFrameRefusal('f', edge)).toBeNull();
  });
  it('identicalPairRefusal: identical bytes refuse, one differing byte passes, different lengths pass', () => {
    expect(identicalPairRefusal('p', new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toMatch(/byte-identical/);
    expect(identicalPairRefusal('p', new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBeNull();
    expect(identicalPairRefusal('p', new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBeNull();
  });
  it('sheetBootRefusals: each of the three faults is named, a clean boot has none', () => {
    expect(sheetBootRefusals('node-webgpu', 'apple / metal-3', 108)).toEqual([]);
    expect(sheetBootRefusals('node-webgl2', 'apple / metal-3', 108)).toHaveLength(1);
    expect(sheetBootRefusals('node-webgpu', 'google / swiftshader', 108)[0]).toMatch(/not hardware Metal/);
    expect(sheetBootRefusals('node-webgpu', 'nvidia', 108)[0]).toMatch(/not hardware Metal/);
    expect(sheetBootRefusals('node-webgpu', 'metal-3 via swiftshader', 108)[0]).toMatch(/not hardware Metal/);
    expect(sheetBootRefusals('node-webgpu', 'apple / metal-3', 0)[0]).toMatch(/no visible rl-grass-field mesh/);
    expect(sheetBootRefusals('legacy-gl', 'x', 0)).toHaveLength(3);
  });
  it('settleField: waits through zeros, needs the same non-zero count twice, throws when it never arrives', async () => {
    const reads = [0, 0, 7, 108, 108];
    let i = 0;
    let polls = 0;
    const got = await settleField(
      () => reads[Math.min(i, reads.length - 1)] as number,
      async () => {
        polls++;
        i++;
      }
    );
    expect(got).toBe(108); // not the first non-zero (7): the count moved
    expect(polls).toBe(4);
    await expect(settleField(() => 0, async () => {}, 2, 5)).rejects.toThrow(/did not hold a stable non-zero/);
    let flip = 0;
    await expect(settleField(() => (flip++ % 2 === 0 ? 3 : 4), async () => {}, 2, 20)).rejects.toThrow(/did not hold/);
  });
});
