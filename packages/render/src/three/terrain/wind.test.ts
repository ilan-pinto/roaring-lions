/**
 * The wind (GH-984 N1): the field's maths, and the proof that the GLSL which draws it is the same
 * maths and not a transcription that drifted.
 *
 * Two pins on the shader, because a source search for constants alone passes a shader that computes
 * the wrong thing with the right numbers:
 *  1. every TS constant appears in the GLSL as its delimited eight-digit literal (`sway.test.ts`'s rule);
 *  2. `rlWindLean` and `rlWindGust` are written in a scalar subset, transpiled here to JS and RUN against
 *     `windLean` / `windGust` on real numbers; the hash is evaluated from the GLSL text's own constants
 *     with BigInt `uint` arithmetic.
 * Oracles are literals: the amplitudes and periods below are design §7's, retyped, not imported.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildDecorMesh } from './decor-mesh';
import { makeWindUniforms } from './wind-uniforms';
import {
  RAIN_SWAY_AMP, RAIN_SWAY_GUST, SWAY_DIR_X, SWAY_DIR_Z, SWAY_GUST_EVERY_S, SWAY_GUST_GAIN, SWAY_GUST_WIDTH_S,
  SWAY_AMPLITUDE, SWAY_PERIOD_S, SWAY_PHASE_X, SWAY_PHASE_Z, SWAY_TOP,
  WIND_CLASSES, WIND_GUST_CELL_S, WIND_GUST_GAIN, WIND_GUST_HI, WIND_GUST_LEAN, WIND_GUST_LO, WIND_GUST_SALT,
  WIND_GUST_SPEED_TPS, WIND_SKEW_MAX_DEG, WIND_STRENGTH_MAX,
  gustHash, windClassOfKey, windGust, windGustGlsl, windHeading, windLean, windLeanGlsl, windVertexChunk,
  type WindClassId, type WindSettings,
} from './wind';
import { TILE_HASH_MIX, TILE_HASH_MX, TILE_HASH_MY, TILE_HASH_SHIFT_A, TILE_HASH_SHIFT_B } from '../../tile-hash';
import { swayWeight } from './sway';

const EAST: WindSettings = { strength: 1, dirX: SWAY_DIR_X, dirZ: SWAY_DIR_Z };

// --- the GLSL, run --------------------------------------------------------------------------

/** `rlWindHash` evaluated from the GLSL text's own constants, in BigInt mod 2^32 (GLSL ES 3.00 `uint`). */
function glslHash(src: string, i: number): number {
  const m = /uint h = uint\(i\) \* (\d+)u \+ uint\((\d+)\) \* (\d+)u;\s*h = \(h \^ \(h >> (\d+)u\)\) \* (\d+)u;\s*h = h \^ \(h >> (\d+)u\);\s*return float\(h >> 8u\) \/ 16777216\.0;/.exec(src);
  if (m === null) throw new Error('rlWindHash is not in the shape the test evaluates');
  const [mx, salt, my, a, mix, b] = m.slice(1).map((v) => BigInt(v));
  const M = (1n << 32n) - 1n;
  const ui = BigInt.asUintN(32, BigInt(i));
  let h = (ui * mx + salt * my) & M;
  h = ((h ^ (h >> a)) * mix) & M;
  h = h ^ (h >> b);
  return Number(h >> 8n) / 16777216;
}

interface GlslTwin {
  rlWindLean(cls: number, hN: number, worldH: number, t: number, ox: number, oz: number, dx: number, dz: number, strength: number): number;
  rlWindGust(t: number, ox: number, oz: number, dx: number, dz: number): number;
}

/** Transpile the scalar GLSL subset `windLeanGlsl` is written in, and run it. */
function twin(wet: boolean): GlslTwin {
  const src = windLeanGlsl(wet);
  const hash = (i: number): number => glslHash(src, i);
  const body = src
    .replace(/float rlWindHash\(int i\) \{[\s\S]*?\n\}\n/, '')
    .replace(/const float (\w+)\[4\] = float\[4\]\(([^)]*)\);/g, 'const $1 = [$2];')
    .replace(/^(float|int) (\w+)\(([^)]*)\) \{/gm, (_m, _t: string, name: string, params: string) =>
      `function ${name}(${params.replace(/\b(float|int)\s+/g, '')}) {`)
    .replace(/^(\s*)float (\w+) =/gm, '$1let $2 =');
  const make = new Function(
    'sin', 'floor', 'clamp', 'mix', 'pow', 'smoothstep', 'int', 'PI2', 'rlWindHash',
    `${body}\nreturn { rlWindLean, rlWindGust };`
  ) as (...a: unknown[]) => GlslTwin;
  return make(
    Math.sin, Math.floor,
    (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x)),
    (a: number, b: number, k: number) => a + (b - a) * k,
    Math.pow,
    (lo: number, hi: number, x: number) => { const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo))); return t * t * (3 - 2 * t); },
    Math.trunc, 2 * Math.PI, hash
  );
}

describe('the gust lattice hash', () => {
  it('is tileHash(i, salt) in uint arithmetic: the GLSL text, evaluated, equals the TS hash', () => {
    const src = windGustGlsl();
    for (const i of [-100000, -4097, -3, -1, 0, 1, 2, 7, 255, 4096, 123456, 2147483647 % 1000003]) {
      expect(glslHash(src, i)).toBe(gustHash(i));
    }
  });
  it('takes its multipliers from tile-hash.ts, never retyped', () => {
    const src = windGustGlsl();
    for (const k of [TILE_HASH_MX, TILE_HASH_MY, TILE_HASH_MIX]) expect(src).toContain(`${k}u`);
    expect(src).toContain(`>> ${TILE_HASH_SHIFT_A}u`);
    expect(src).toContain(`>> ${TILE_HASH_SHIFT_B}u`);
    expect(src).toContain(`uint(${WIND_GUST_SALT})`);
  });
  it('is not random: the same lattice point answers the same, and the values spread over [0, 1)', () => {
    const vals = Array.from({ length: 4000 }, (_, i) => gustHash(i));
    expect(vals.map((_, i) => gustHash(i))).toEqual(vals);
    expect(Math.min(...vals)).toBeLessThan(0.01);
    expect(Math.max(...vals)).toBeGreaterThan(0.99);
    expect(vals.reduce((a, b) => a + b, 0) / vals.length).toBeGreaterThan(0.45);
    expect(vals.reduce((a, b) => a + b, 0) / vals.length).toBeLessThan(0.55);
  });
});

describe('design §7 start values', () => {
  it('pins each class: tip amplitude (wu) and period (s), as literals', () => {
    expect(WIND_CLASSES.map((c) => [c.name, c.amp, c.periodS])).toEqual([
      ['grass', 0.015, 1.9],
      ['reed', 0.03, 2.4],
      ['shrub', 0.02, 3.0],
      ['tree', 0.035, 3.8],
    ]);
  });
  it('pins each class: stiffness, gust gain and the height basis, as literals', () => {
    expect(WIND_CLASSES.map((c) => [c.name, c.stiffness, c.gustGain, c.worldBasis])).toEqual([
      ['grass', 2, 1.5, false],
      ['reed', 1.5, 1.5, false],
      ['shrub', 2, 1.5, false],
      ['tree', 2, 1.5, true],
    ]);
  });
  it('pins the gust: x1.5, front 3 tiles/s, strength 0..2, skew 30 deg', () => {
    expect(WIND_GUST_GAIN).toBe(1.5);
    expect(WIND_GUST_SPEED_TPS).toBe(3);
    expect(WIND_STRENGTH_MAX).toBe(2);
    expect(WIND_SKEW_MAX_DEG).toBe(30);
  });
  it('class ids are the table index', () => {
    expect(WIND_CLASSES.map((c, i) => [c.name, i])).toEqual([['grass', 0], ['reed', 1], ['shrub', 2], ['tree', 3]]);
    expect(windClassOfKey('wet_grass_2')).toBe(0);
    expect(windClassOfKey('reed_0')).toBe(1);
    expect(windClassOfKey('bush_1')).toBe(2);
    expect(windClassOfKey('desert_tree_0')).toBe(3);
  });
});

describe('the GLSL carries every TS constant', () => {
  const glslAll = windLeanGlsl() + windVertexChunk() + windGustGlsl();
  const has = (src: string, k: number): boolean =>
    new RegExp(`(?<![0-9.])${k.toFixed(8).replace(/\./g, '\\.')}(?![0-9])`).test(src);

  it('every scalar constant, as its delimited eight-digit literal', () => {
    for (const k of [
      SWAY_TOP, SWAY_PHASE_X, SWAY_PHASE_Z, SWAY_DIR_X, SWAY_DIR_Z, SWAY_PERIOD_S, SWAY_GUST_EVERY_S, SWAY_GUST_WIDTH_S,
      SWAY_GUST_GAIN, SWAY_AMPLITUDE, WIND_GUST_SPEED_TPS, WIND_GUST_CELL_S, WIND_GUST_LO, WIND_GUST_HI, WIND_GUST_LEAN,
    ]) {
      expect(has(glslAll, k), `${k}`).toBe(true);
    }
  });
  it('the wet variant carries the two wet constants, and the dry one does not', () => {
    const wet = windLeanGlsl(true) + windVertexChunk(true);
    expect(has(wet, RAIN_SWAY_GUST)).toBe(true);
    expect(has(wet, RAIN_SWAY_AMP)).toBe(true);
    expect(has(wet, SWAY_AMPLITUDE * RAIN_SWAY_AMP)).toBe(true);
    expect(windLeanGlsl(false)).not.toContain('float gain = 3.00000000;');
    expect(windLeanGlsl(true)).toContain('float gain = 3.00000000;');
  });
  it('the class tables are in id order, every column', () => {
    const src = windLeanGlsl();
    const row = (name: string, pick: (c: (typeof WIND_CLASSES)[number]) => number): void => {
      const lits = WIND_CLASSES.map((c) => pick(c).toFixed(8)).join(', ');
      expect(src).toContain(`const float ${name}[4] = float[4](${lits});`);
    };
    row('RL_WIND_AMP', (c) => c.amp);
    row('RL_WIND_PERIOD', (c) => c.periodS);
    row('RL_WIND_GAIN', (c) => c.gustGain);
    row('RL_WIND_STIFF', (c) => c.stiffness);
    row('RL_WIND_WORLD', (c) => (c.worldBasis ? 1 : 0));
  });
  it('reads the wind uniforms and the nature attribute, and splices only at the batching matrix', () => {
    const chunk = windVertexChunk();
    for (const name of ['uWindMode', 'uWindStrength', 'uWindDir', 'uSwayTime', 'uSwayAmp', 'rlNature', 'USE_BATCHING']) {
      expect(chunk).toContain(name);
    }
  });
});

describe('the GLSL, run, equals the TS mirror (per-class displacement)', () => {
  const samples: { hN: number; worldH: number; t: number; ox: number; oz: number }[] = [];
  for (let k = 0; k < 160; k++) {
    samples.push({
      hN: ((k * 37) % 101) / 100,
      worldH: ((k * 53) % 131) / 100,
      t: k * 1.37 - 20,
      ox: ((k * 29) % 97) - 40 + 0.31,
      oz: ((k * 41) % 89) - 33 + 0.77,
    });
  }
  for (const wet of [false, true]) {
    for (const cls of [0, 1, 2, 3] as WindClassId[]) {
      it(`${WIND_CLASSES[cls].name}${wet ? ' (wet)' : ''}: every sample within 1e-9 of windLean`, () => {
        const g = twin(wet);
        const wind: WindSettings = { strength: 1.3, dirX: 0.8, dirZ: -0.6 };
        let moved = 0;
        for (const s of samples) {
          const ref = windLean(cls, s.hN, s.worldH, s.t, s.ox, s.oz, wind, wet);
          const lean = g.rlWindLean(cls, s.hN, s.worldH, s.t, s.ox, s.oz, wind.dirX, wind.dirZ, wind.strength);
          expect(wind.dirX * lean).toBeCloseTo(ref.dx, 9);
          expect(wind.dirZ * lean).toBeCloseTo(ref.dz, 9);
          if (Math.abs(ref.dx) > 1e-4) moved++;
        }
        // Anti-vacuity: the comparison above is not 0 == 0.
        expect(moved).toBeGreaterThan(40);
      });
    }
  }
  it('the gust twin equals windGust', () => {
    const g = twin(false);
    for (const s of samples) {
      expect(g.rlWindGust(s.t, s.ox, s.oz, 0.6, -0.8)).toBeCloseTo(windGust(s.t, s.ox, s.oz, 0.6, -0.8), 12);
    }
  });
});

describe('per-class tip displacement', () => {
  const tipPeak = (cls: WindClassId, wind: WindSettings = EAST): number => {
    let worst = 0;
    for (let t = 0; t < 600; t += 0.05) {
      const o = windLean(cls, 1, 1, t, 3.2, 7.9, wind);
      worst = Math.max(worst, Math.hypot(o.dx, o.dz));
    }
    return worst;
  };
  it.each([
    ['grass', 0, 0.015],
    ['reed', 1, 0.03],
    ['shrub', 2, 0.02],
    ['tree', 3, 0.035],
  ] as const)('%s tip never exceeds amp x (gain + lean) and reaches 1.5 x amp in a gust', (_n, cls, amp) => {
    const worst = tipPeak(cls);
    expect(worst).toBeLessThanOrEqual(amp * (1.5 + 0.5) + 1e-12);
    expect(worst).toBeGreaterThan(amp * 1.5);
  });
  it('strength scales every lean linearly: 2 is twice 1, 0 is still', () => {
    for (const cls of [0, 1, 2, 3] as WindClassId[]) {
      expect(tipPeak(cls, { ...EAST, strength: 2 })).toBeCloseTo(2 * tipPeak(cls), 9);
      expect(tipPeak(cls, { ...EAST, strength: 0 })).toBe(0);
    }
  });
  it('bends from the tip: half height is a quarter of the tip at stiffness 2, zero at the root', () => {
    const at = (h: number): number => {
      const o = windLean(0, h, 0.12, 12.3, 5, 5, EAST);
      return Math.hypot(o.dx, o.dz);
    };
    expect(at(0)).toBe(0);
    expect(at(0.5)).toBeCloseTo(at(1) / 4, 12);
    expect(at(1)).toBeGreaterThan(0);
  });
  it('a tree keeps the crown rule: world height over TOP, squared (swayWeight), with trunk and crown on one curve', () => {
    const a = windLean(3, 0.1, 0.5, 9, 2, 3, EAST);
    const b = windLean(3, 0.9, 0.5, 9, 2, 3, EAST);
    expect(a).toEqual(b); // the normalised height is ignored for a tree
    const tip = windLean(3, 0, SWAY_TOP, 9, 2, 3, EAST);
    expect(Math.hypot(a.dx, a.dz)).toBeCloseTo(swayWeight(0.5) * Math.hypot(tip.dx, tip.dz), 12);
  });
  it('a grass blade does not move with world height (only with its place in its own box)', () => {
    expect(windLean(0, 0.5, 0.1, 9, 2, 3, EAST)).toEqual(windLean(0, 0.5, 5, 9, 2, 3, EAST));
  });
  it('leans along the heading, both ways, and not across it', () => {
    const d = windHeading('west', 20, 1);
    const o = windLean(3, 1, 1, 4.4, 1, 1, d);
    expect(o.dx * d.dirZ - o.dz * d.dirX).toBeCloseTo(0, 12);
    expect(o.dx * d.dirX + o.dz * d.dirZ).not.toBeCloseTo(0, 6);
  });
});

describe('the gust is a front that travels', () => {
  it('a point downwind sees the same gust SPEED tiles per second later', () => {
    for (const [t, x, z] of [[10, 4, 9], [33.3, 20, 2], [101.7, 0, 0]] as const) {
      for (const d of [0.5, 2, 7]) {
        const here = windGust(t, x, z, EAST.dirX, EAST.dirZ);
        const there = windGust(t + d, x + WIND_GUST_SPEED_TPS * d * EAST.dirX, z + WIND_GUST_SPEED_TPS * d * EAST.dirZ, EAST.dirX, EAST.dirZ);
        expect(there).toBeCloseTo(here, 9);
      }
    }
  });
  it('and two points a gust-front apart differ at one instant (it is a front, not a global bump)', () => {
    let differs = 0;
    for (let t = 0; t < 120; t += 1) {
      if (Math.abs(windGust(t, 0, 0, EAST.dirX, EAST.dirZ) - windGust(t, 15, -15, EAST.dirX, EAST.dirZ)) > 0.2) differs++;
    }
    expect(differs).toBeGreaterThan(10);
  });
  it('stays in [0, 1], is calm part of the time, and gusts 6-14 s apart at the median', () => {
    const up: number[] = [];
    let prev = 0;
    let calm = 0;
    let max = 0;
    const n = 80000;
    for (let i = 0; i < n; i++) {
      const t = i * 0.05;
      const g = windGust(t, 0, 0, EAST.dirX, EAST.dirZ);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
      max = Math.max(max, g);
      if (g === 0) calm++;
      if (g > 0.5 && prev <= 0.5) up.push(t);
      prev = g;
    }
    const gaps = up.slice(1).map((v, i) => v - up[i]).sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    expect(median).toBeGreaterThan(6);
    expect(median).toBeLessThan(14);
    expect(max).toBe(1);
    expect(calm / n).toBeGreaterThan(0.3);
  });
});

describe('the heading', () => {
  it('east with no skew IS the old sway axis; west is its opposite', () => {
    const e = windHeading('east', 0, 1);
    expect(e.dirX).toBeCloseTo(SWAY_DIR_X, 15);
    expect(e.dirZ).toBeCloseTo(SWAY_DIR_Z, 15);
    const w = windHeading('west', 0, 1);
    expect(w.dirX).toBeCloseTo(-SWAY_DIR_X, 15);
    expect(w.dirZ).toBeCloseTo(-SWAY_DIR_Z, 15);
  });
  it('is a unit vector at any skew, and a skew of 30 is 30 degrees off the screen side', () => {
    for (const side of ['east', 'west'] as const) {
      for (const skew of [-30, -12, 0, 7, 30]) {
        const h = windHeading(side, skew, 1);
        expect(Math.hypot(h.dirX, h.dirZ)).toBeCloseTo(1, 12);
        const right = { x: Math.SQRT1_2, z: -Math.SQRT1_2 };
        const along = (h.dirX * right.x + h.dirZ * right.z) * (side === 'east' ? 1 : -1);
        expect(Math.acos(Math.min(1, along)) * (180 / Math.PI)).toBeCloseTo(Math.abs(skew), 6);
      }
    }
  });
  it('clamps the skew to 30 and the strength to 0..2, so a hand-built option stays on the camera`s side', () => {
    expect(windHeading('east', 90, 1)).toEqual(windHeading('east', 30, 1));
    expect(windHeading('west', -90, 1)).toEqual(windHeading('west', -30, 1));
    expect(windHeading('east', 0, 9).strength).toBe(2);
    expect(windHeading('east', 0, -1).strength).toBe(0);
  });
  it('positive skew turns east toward the viewer (+x, +z) and west away from it', () => {
    const e = windHeading('east', 30, 1);
    expect(e.dirX + e.dirZ).toBeGreaterThan(0);
    const w = windHeading('west', 30, 1);
    expect(w.dirX + w.dirZ).toBeLessThan(0);
  });
});

// --- trunk follows crown ------------------------------------------------------------------

const DECOR = join(__dirname, '../../../../../art/meshes/decor');
interface GlbJson {
  nodes: { mesh?: number; extras?: { rl_role?: string } }[];
  meshes: { primitives: { attributes: Record<string, number> }[] }[];
  accessors: { min?: number[]; max?: number[] }[];
}
function glbJson(path: string): GlbJson {
  const b = readFileSync(path);
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8')) as GlbJson;
}
/** [min y, max y] of the primitives on nodes tagged `role`, in model units. */
function roleY(j: GlbJson, role: string): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const n of j.nodes) {
    if (n.mesh === undefined || n.extras?.rl_role !== role) continue;
    for (const p of j.meshes[n.mesh].primitives) {
      const a = j.accessors[p.attributes.POSITION];
      lo = Math.min(lo, a.min?.[1] ?? Infinity);
      hi = Math.max(hi, a.max?.[1] ?? -Infinity);
    }
  }
  return [lo, hi];
}

/** Does the trunk batch `buildDecorMesh` makes actually carry the wind chunk? The real material, compiled. */
function trunkBatchSways(): boolean {
  const parts = new Map([
    ['tree_0', [{ role: 'foliage' as const, geometry: new THREE.BoxGeometry() }, { role: 'trunk' as const, geometry: new THREE.BoxGeometry() }]],
  ]);
  const group = buildDecorMesh(
    [{ family: 'tree', variant: 0, x: 0, z: 0, y: 0, yawTurns: 0, scale: 1 }],
    { parts },
    { time: { value: 0 }, amp: { value: 1 }, wind: makeWindUniforms() }
  );
  const trunk = group.children.find((c) => c.name === 'decor-trunk') as THREE.BatchedMesh;
  const shader = { uniforms: {}, vertexShader: THREE.ShaderChunk.meshphysical_vert, fragmentShader: '' };
  (trunk.material as THREE.Material).onBeforeCompile(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    {} as THREE.WebGLRenderer
  );
  return shader.vertexShader.includes('rlWindLean(') && shader.vertexShader.includes(windVertexChunk(false, true));
}

describe('trunk follows crown (design §9: < 0.005 wu across a gust)', () => {
  const MODEL_PER_WU = 3; // MESH_UNITS_PER_TILE
  const trunkSways = trunkBatchSways();
  let armed = 0;
  it('the trunk batch carries the wind chunk (the falsifier: drop it from the trunk material and this goes red)', () => {
    expect(trunkSways).toBe(true);
  });
  it.each([
    'tree_0', 'tree_1', 'tree_2', 'cedar_0', 'cedar_1', 'cedar_2', 'desert_tree_0', 'desert_tree_1', 'desert_tree_2',
  ])('%s: at the joint the trunk and the crown never part by 0.005 wu, at any instance scale, over 3 minutes', (id) => {
    const j = glbJson(join(DECOR, `${id}.glb`));
    const [, trunkTop] = roleY(j, 'trunk');
    const [crownBase] = roleY(j, 'foliage');
    // The joint: where the crown's underside meets the stem. A trunk that runs on up inside the crown
    // is met at the crown's base; one that stops short, at its own top.
    const jointModel = Math.min(trunkTop, crownBase);
    let worst = 0;
    let crownMoved = 0;
    for (const scale of [0.68 * 0.8, 0.8, 1, 1.2]) {
      const hJoint = (jointModel / MODEL_PER_WU) * scale;
      const hCrown = (crownBase / MODEL_PER_WU) * scale;
      for (let t = 0; t < 180; t += 0.1) {
        const stem = trunkSways ? windLean(3, 1, hJoint, t, 11.5, 4.5, EAST) : { dx: 0, dz: 0 };
        const crown = windLean(3, 1, hCrown, t, 11.5, 4.5, EAST);
        worst = Math.max(worst, Math.hypot(stem.dx - crown.dx, stem.dz - crown.dz));
        crownMoved = Math.max(crownMoved, Math.hypot(crown.dx, crown.dz));
      }
    }
    expect(worst).toBeLessThan(0.005);
    // Anti-vacuity: where the joint is high enough to move (a cedar`s crown starts near the ground),
    // the crown`s underside moves by more than the allowed gap, so a stem held still would fail.
    if (jointModel / MODEL_PER_WU > 0.35) {
      expect(crownMoved).toBeGreaterThan(0.005);
      armed++;
    }
  });
  it('and the check is armed on most of the roster (not a vacuous pass over low joints)', () => {
    expect(armed).toBeGreaterThanOrEqual(5);
  });
  it('a trunk top moves of the order design §7 gives (0.008 wu), at a mid-size tree`s gust peak', () => {
    const h = (1.31 / MODEL_PER_WU) * 1; // tree_0's trunk top at scale 1
    let worst = 0;
    for (let t = 0; t < 600; t += 0.1) {
      const o = windLean(3, 1, h, t, 11.5, 4.5, EAST);
      worst = Math.max(worst, Math.hypot(o.dx, o.dz));
    }
    expect(worst).toBeGreaterThan(0.004);
    expect(worst).toBeLessThan(0.016);
  });
});

// --- reduced motion's branch ----------------------------------------------------------------

describe('the legacy branch (reduced motion) is today`s sway', () => {
  it('carries the periodic gust, the fixed axis and the 0.035 amplitude exactly as the old chunk did', () => {
    const c = windVertexChunk();
    expect(c).toContain('uSwayAmp * 0.03500000 * rlSwayR * rlSwayR * rlSwayGust');
    expect(c).toContain('mod(uSwayTime, 11.00000000)');
    expect(c).toContain('if (rlSwayPh < 2.50000000)');
    expect(c).toContain('(1.40000000 - 1.0)');
    expect(c).toContain('vec2 rlSwayDir = vec2(0.70710678, -0.70710678);');
    expect(c).toContain('sin(PI2 * uSwayTime / 3.80000000');
    // Mode 0 never evaluates the wind; mode 1 never the legacy maths.
    expect(c).toMatch(/if \(uWindMode > 0\.5\) \{[\s\S]*rlWindLean[\s\S]*\} else \{[\s\S]*rlSwayBump/);
  });
  it('a trunk holds still there: amplitude literal 0', () => {
    expect(windVertexChunk(false, true)).toContain('uSwayAmp * 0.00000000 *');
    expect(windVertexChunk(true, true)).toContain('uSwayAmp * 0.00000000 *');
  });
});
