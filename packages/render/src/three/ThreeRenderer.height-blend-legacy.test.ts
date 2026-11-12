/**
 * GH-1226 S3, pin L3 (design 2026-11-12-gh1226-height-blend-design.md section 3.6): a LEGACY `ThreeRenderer` booted on `qarn_hadid`'s
 * elevation draws no height blend and does no work for one.
 *
 *  - the ground material, and the renderer, hold no height-blend record (no own key, enumerable or not, by name);
 *  - the field's module is never imported and none of its exports is touched (a recording stand-in stands for it);
 *  - `terrainTones.heightBlend` is never READ: the tones carry a getter that throws on that one key.
 *
 * The field module (`terrain/height-blend-field.ts`, GH-1226 S2) is not on main when this lands, so the stand-in is a virtual mock keyed
 * by its path: once S2 is merged it replaces the real module for THIS file only, and the same assertions hold. The positive control
 * proves the recorder records, so "nothing touched" cannot pass vacuously. If S5 renames the module or moves the bake into another file,
 * update `FIELD_MODULES` here in that PR; the control below stays red-able by pointing it at the new path.
 *
 * Falsified (commit message): building the field outside the node branch, or reading `tones.heightBlend` in `rebuildTerrain`'s shared
 * part, turns the "never read" and "never touched" tests red.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { GroundMaterial } from './terrain/mesh';
import { LEGACY_GROUND, programOf } from './terrain/height-blend-pins.support';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
    render(): void {}
    getContext(): { isContextLost(): boolean } {
      return { isContextLost: () => false };
    }
    forceContextLoss(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

/** What the recording stand-in saw: one entry per module load, one per property read. */
const seen = vi.hoisted(() => ({ loads: [] as string[], reads: [] as string[] }));

/**
 * A recording wrapper over the REAL module. Registered for a path that does not exist on main (a mock factory only runs when something
 * imports the module, and nothing does there), and live from the day GH-1226 S2 lands the file.
 */
const recording = vi.hoisted(() => (name: string) => async (importOriginal: () => Promise<object>): Promise<object> => {
  seen.loads.push(name);
  return new Proxy(await importOriginal(), { get: (t, k, rcv) => { seen.reads.push(`${name}.${String(k)}`); return Reflect.get(t, k, rcv); } });
});
vi.mock('./terrain/height-blend-field', recording('height-blend-field'));
vi.mock('./terrain/height-blend-texture', recording('height-blend-texture'));

/** Whether a module exists on disk now: the positive control runs from the day it does, and stays visible as skipped until then. */
const exists = (rel: string): boolean => existsSync(fileURLToPath(new URL(`${rel}.ts`, import.meta.url)));

/** What had loaded by the time every static import of this file (ThreeRenderer included) had run: a STATIC import of the field from
 *  anything ThreeRenderer pulls in is in here, whatever order the tests then run in. */
const loadedByStaticImports: string[] = [...seen.loads];
/** Boots done so far: the positive control below refuses to run before any, because it caches the module and would hide a dynamic import. */
let boots = 0;

const MAP = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../data/maps/qarn_hadid.json', import.meta.url)), 'utf8')) as {
  width: number;
  height: number;
  elevation: string[];
};

const BASE_TONES: TerrainTones = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone', groveFamily: 'desert_tree',
  haze: '#E0B87A',
};

/** The tones with `heightBlend` as a NON-enumerable throwing getter: a spread or a `keys` walk does not trip it, an explicit read does. */
function tonesThatThrowOnHeightBlend(reads: string[]): TerrainTones {
  const t = { ...BASE_TONES };
  Object.defineProperty(t, 'heightBlend', {
    enumerable: false,
    configurable: true,
    get(): never {
      reads.push('tones.heightBlend');
      throw new Error('a legacy boot read tones.heightBlend');
    },
  });
  return t;
}

async function boot(tones: TerrainTones, extra: Partial<RendererOptions> = {}): Promise<{ r: ThreeRenderer; sim: Sim }> {
  const sim = new Sim({ seed: 1, width: MAP.width, height: MAP.height, capacity: 4 });
  const opts: RendererOptions = {
    background: '#14150F',
    teamColors: ['#C8B494', '#6E7449', '#8E9491'],
    hullColors: ['#8F9464', '#6E7449', '#4E5433'],
    infantryColors: ['#8F9464', '#6E7449', '#4E5433'],
    groupColors: ['#C8B494', '#6E7449', '#8E9491', '#3A3C33', '#E6D8BE', '#4E5433', '#8E9491', '#F2E8D5', '#6E7449'],
    terrainTones: tones,
    tracerColors: ['#F2E8D5', '#E6D8BE'],
    shellColors: ['#FFB43C', '#E8541E'],
    flashColor: '#F2E8D5',
    nearMissColor: '#6E7449',
    interceptColor: '#8E9491',
    environmentLight: false,
    ...extra,
  };
  const r = new ThreeRenderer(sim, opts);
  r.setDecor(new Uint8Array(MAP.width * MAP.height));
  r.setElevation(Uint8Array.from(MAP.elevation.join('').split('').map(Number)));
  r.frame(1, 0);
  // A dynamic import the boot starts (a fire-and-forget `import(...)` after the ground is built) loads the module a tick later.
  await vi.dynamicImportSettled();
  boots++;
  return { r, sim };
}

/** Every own property name and symbol description, enumerable or not. */
const ownNames = (o: object): string[] => Reflect.ownKeys(o).map((k) => (typeof k === 'symbol' ? (k.description ?? '') : k));
const HEIGHT_BLEND_NAME = /height.?blend/i;

describe('L3: a legacy boot on qarn_hadid\'s elevation draws and computes no height blend', () => {
  it('the input is the real map (a 48 x 48 relief grid with more than one level: a flat input would make the bake a no-op to skip)', () => {
    expect([MAP.width, MAP.height, MAP.elevation.length]).toEqual([48, 48, 48]);
    expect(new Set(MAP.elevation.join('')).size).toBeGreaterThan(2);
  });

  it('no height-blend module was loaded by a static import of anything this file imports', () => {
    expect(loadedByStaticImports, 'a static import (of the field or its texture) is reachable from ThreeRenderer').toEqual([]);
  });

  it.each([
    ['dry', {}, 'dry'],
    ['rain', { weather: 'rain' as const }, 'wet full'],
  ])('%s boot: holds no record, loads no field module, touches no export, never reads tones.heightBlend, and compiles main\'s ground', async (_n, extra, pinName) => {
    const before = seen.loads.length;
    seen.reads.length = 0;
    const { r } = await boot(tonesThatThrowOnHeightBlend(seen.reads), extra);
    const ground = (r as unknown as { groundMat: GroundMaterial }).groundMat;
    // The BOOTED material compiles to the same literals the bare class does (L2): a define, a uniform or an anchor added at boot is red.
    expect(programOf(ground)).toEqual((LEGACY_GROUND[pinName] as (typeof LEGACY_GROUND)[string]).pin);
    // Every own key and symbol, enumerable or not, on the material AND on the records it holds: the design keeps the blend's record under a
    // NON-enumerable key, which `Object.keys` cannot see.
    expect(ownNames(ground.defines ?? {}).filter((n) => HEIGHT_BLEND_NAME.test(n))).toEqual([]);
    expect(ownNames(ground).filter((n) => HEIGHT_BLEND_NAME.test(n))).toEqual([]);
    expect(ownNames(ground.uniforms).filter((n) => HEIGHT_BLEND_NAME.test(n))).toEqual([]);
    expect(ownNames(ground.userData).filter((n) => HEIGHT_BLEND_NAME.test(n))).toEqual([]);
    expect(ownNames(r).filter((n) => HEIGHT_BLEND_NAME.test(n))).toEqual([]);
    expect(seen.reads, 'something read tones.heightBlend or a field-module export on a legacy boot').toEqual([]);
    expect(seen.loads.slice(before), 'a legacy boot imported a height-blend module').toEqual([]);
    r.dispose();
  });

  // Armed by S2: the recorder cannot be exercised against a module that is not there. From the day the file exists this runs, and a
  // mock that no longer intercepts (a renamed module, a moved bake) is red here instead of silently recording nothing.
  it.runIf(exists('./terrain/height-blend-field'))('positive control: the recorder sees a load and a read of the real field module', async () => {
    // Order pin: this control caches the module, which would hide a dynamic import from any boot that ran after it.
    expect(boots, 'the positive control must run after the boots').toBeGreaterThan(0);
    seen.reads.length = 0;
    const spec = './terrain/height-blend-field';
    const m = (await import(/* @vite-ignore */ spec)) as Record<string, unknown>;
    void m.bakeHeightBlendField;
    expect(seen.loads).toContain('height-blend-field');
    expect(seen.reads).toContain('height-blend-field.bakeHeightBlendField');
  });

  it('positive control: the throwing getter fires on an explicit read, and does not on a spread or a key walk', () => {
    const reads: string[] = [];
    const t = tonesThatThrowOnHeightBlend(reads);
    void { ...t };
    void Object.keys(t);
    expect(reads).toEqual([]);
    expect(() => (t as TerrainTones & { heightBlend?: unknown }).heightBlend).toThrow(/legacy boot read/);
    expect(reads).toEqual(['tones.heightBlend']);
  });

  it('positive control: the record check sees a non-enumerable own key by name', () => {
    const g = new THREE.Object3D();
    Object.defineProperty(g, 'rlHeightBlendRecord', { value: {}, enumerable: false });
    expect(ownNames(g).filter((n) => HEIGHT_BLEND_NAME.test(n))).toEqual(['rlHeightBlendRecord']);
  });
});
