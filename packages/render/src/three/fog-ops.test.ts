/**
 * @vitest-environment jsdom
 *
 * GH-943 P2 (T1): the `Ops<T>` extension (min, max, abs, floor, step, pow, cos, atan2, sqrt, exp, sign) and `IntOps<T>`, the
 * arithmetic the material twins (T3-T7) are written against. Each op is pinned twice: `NUMBER_OPS` / `NUMBER_INT_OPS` against
 * LITERAL expected values (never a value the code under test computed), and the TSL implementation (`tslOps`, `tslIntOps`)
 * compiled to GLSL by three's own `GLSLNodeBuilder` (no GPU), which must carry the op with its arguments in order.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { NUMBER_INT_OPS, NUMBER_OPS, type Ops } from './fog-ops';
import { tslIntOps, tslOps, type N, type Tsl } from './fog-pass.node';
import { tileHash, tileHashOps } from '../tile-hash';

/** Compiles `node` (a float) as the red channel of a fragment and returns the GLSL fragment shader. */
async function glslOf(make: (TSL: Tsl) => N): Promise<string> {
  const W = await import('three/webgpu');
  const T = await import('three/tsl');
  const TSL = T as unknown as Tsl;
  const r = new W.WebGPURenderer({ forceWebGL: true });
  const mat = new W.NodeMaterial();
  mat.fragmentNode = TSL.vec4(make(TSL), 0, 0, 1) as never;
  // The typings hide the builder's working members; this is the slice the test reads (as `fog-pass.node.test.ts`).
  const builder = new W.GLSLNodeBuilder(new W.QuadMesh(mat), r) as unknown as {
    scene: THREE.Scene;
    camera: THREE.Camera;
    material: unknown;
    build(): void;
    fragmentShader: string;
  };
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.OrthographicCamera();
  builder.material = mat;
  builder.build();
  return builder.fragmentShader;
}

/** The ops, each applied to `a` (a uniform) and `b = a + 1` (so an argument swap changes the text). */
const UNARY = ['abs', 'floor', 'cos', 'sqrt', 'exp', 'sign'] as const;
const BINARY = ['min', 'max', 'step', 'pow', 'atan2'] as const;
/** The GLSL function each op must compile to. */
const GLSL_NAME: Record<(typeof UNARY)[number] | (typeof BINARY)[number], string> = {
  abs: 'abs', floor: 'floor', cos: 'cos', sqrt: 'sqrt', exp: 'exp', sign: 'sign',
  min: 'min', max: 'max', step: 'step', pow: 'pow', atan2: 'atan',
};

describe('Ops<T>: the new float ops on numbers, against literal values', () => {
  const o: Ops<number> = NUMBER_OPS;
  it('min, max, abs, floor', () => {
    expect(o.min(2, -3)).toBe(-3);
    expect(o.max(2, -3)).toBe(2);
    expect(o.abs(-2.5)).toBe(2.5);
    expect(o.abs(1.25)).toBe(1.25);
    expect(o.floor(-1.5)).toBe(-2);
    expect(o.floor(2.75)).toBe(2);
  });
  it('step is GLSL step(edge, x): 0 below the edge, 1 at and above it', () => {
    expect(o.step(0.5, 0.4)).toBe(0);
    expect(o.step(0.5, 0.5)).toBe(1);
    expect(o.step(0.5, 0.6)).toBe(1);
    expect(o.step(-1, -2)).toBe(0);
  });
  it('pow, cos, sqrt, exp', () => {
    expect(o.pow(2, 10)).toBe(1024);
    expect(o.pow(9, 0.5)).toBe(3);
    expect(o.cos(0)).toBe(1);
    expect(o.cos(3.141592653589793)).toBe(-1);
    expect(o.sqrt(2)).toBe(1.4142135623730951);
    expect(o.sqrt(16)).toBe(4);
    expect(o.exp(0)).toBe(1);
    expect(o.exp(1)).toBe(2.718281828459045);
  });
  it('atan2 is (y, x), in (-pi, pi]', () => {
    expect(o.atan2(1, 1)).toBe(0.7853981633974483);
    expect(o.atan2(1, -1)).toBe(2.356194490192345);
    expect(o.atan2(0, -1)).toBe(3.141592653589793);
    expect(o.atan2(-1, 0)).toBe(-1.5707963267948966);
    // `atan(x)` is written atan2(x, 1).
    expect(o.atan2(1, 1)).toBe(o.atan2(2, 2));
  });
  it('sign is -1, 0 or 1', () => {
    expect(o.sign(-3)).toBe(-1);
    expect(o.sign(0) === 0).toBe(true);
    expect(o.sign(4.5)).toBe(1);
  });
});

describe('Ops<T>: the TSL ops, compiled to GLSL by three\'s own builder', () => {
  for (const op of UNARY) {
    it(`${op} compiles to ${GLSL_NAME[op]}( a )`, async () => {
      const glsl = await glslOf((TSL) => (tslOps(TSL)[op] as (a: N) => N)(TSL.uniform(0.25)));
      expect(glsl).toContain(`fragColor = vec4( ${GLSL_NAME[op]}( nodeUniform0 ), 0.0, 0.0, 1.0 );`);
    });
  }
  for (const op of BINARY) {
    it(`${op} compiles to ${GLSL_NAME[op]}( a, b ), arguments in order`, async () => {
      const glsl = await glslOf((TSL) => {
        const a = TSL.uniform(0.25);
        return (tslOps(TSL)[op] as (x: N, y: N) => N)(a, a.add(1));
      });
      expect(glsl).toContain(`fragColor = vec4( ${GLSL_NAME[op]}( nodeUniform0, ( nodeUniform0 + 1.0 ) ), 0.0, 0.0, 1.0 );`);
    });
  }
});

describe('IntOps<T>: uint32 arithmetic on numbers, against literal values', () => {
  const o = NUMBER_INT_OPS;
  it('lit and fromFloat give the two\'s-complement pattern of a negative', () => {
    expect(o.lit(-1)).toBe(4294967295);
    expect(o.lit(4294967296 + 5)).toBe(5);
    expect(o.fromFloat(-1)).toBe(4294967295);
    expect(o.fromFloat(-5)).toBe(4294967291);
    expect(o.fromFloat(7)).toBe(7);
  });
  it('add and imul wrap mod 2^32', () => {
    expect(o.add(0xffffffff, 2)).toBe(1);
    expect(o.imul(0x80000000, 3)).toBe(2147483648);
    expect(o.imul(0x7fffffff, 0x7fffffff)).toBe(1);
    // A lattice product past 2^31: 6 * 374761393 = 2248568358.
    expect(o.imul(6, 374761393)).toBe(2248568358);
  });
  it('xor of the two extremes is all ones', () => {
    expect(o.xor(0x80000000, 0x7fffffff)).toBe(4294967295);
    expect(o.xor(0xffffffff, 0xffffffff)).toBe(0);
  });
  it('shr is the UNSIGNED shift: the top bit is never dragged down', () => {
    expect(o.shr(0x80000000, 13)).toBe(262144);
    expect(o.shr(0xffffffff, 16)).toBe(65535);
    expect(o.shr(0x7fffffff, 16)).toBe(32767);
  });
  it('toFloat01 is the top 24 bits over 2^24', () => {
    expect(o.toFloat01(0xffffffff)).toBe(16777215 / 16777216);
    expect(o.toFloat01(0x80000000)).toBe(0.5);
    expect(o.toFloat01(255)).toBe(0);
  });
});

describe('IntOps<T>: tileHashOps is tileHash', () => {
  /** 1000 lattice points: negatives, products and sums past 2^31 (most points), and the edge rows. */
  const points: Array<[number, number]> = [];
  for (let i = 0; i < 1000; i++) {
    const x = ((i * 7919) % 4001) - 2000;
    const y = ((i * 104729) % 3001) - 1500;
    points.push([x, y]);
  }
  points.splice(0, 6, [0, 0], [6, 0], [0, 4], [-1, -1], [2097151, 2097151], [-2097152, 1]);

  it('the integer hash equals tileHash * 2^32 on every point, and the set really exercises the top bit', () => {
    let topBitStart = 0;
    let topBitMixed = 0;
    for (const [x, y] of points) {
      const h = tileHashOps(NUMBER_INT_OPS, x, y);
      expect(h, `(${x}, ${y})`).toBe(tileHash(x, y) * 4294967296);
      const o = NUMBER_INT_OPS;
      const h0 = o.add(o.imul(o.fromFloat(x), o.lit(374761393)), o.imul(o.fromFloat(y), o.lit(668265263)));
      if (h0 >= 0x80000000) topBitStart++;
      const h1 = o.imul(o.xor(h0, o.shr(h0, 13)), o.lit(1274126177));
      if (h1 >= 0x80000000) topBitMixed++;
    }
    // A signed shift reads equal on every point whose intermediates keep the top bit clear: these must be many.
    expect(topBitStart).toBeGreaterThan(300);
    expect(topBitMixed).toBeGreaterThan(300);
  });

  it('toFloat01 of it is the top 24 bits of tileHash (the shader\'s own rlWindHash shape)', () => {
    for (const [x, y] of points) {
      expect(NUMBER_INT_OPS.toFloat01(tileHashOps(NUMBER_INT_OPS, x, y))).toBe(Math.floor(tileHash(x, y) * 16777216) / 16777216);
    }
  });

  it('on uint nodes it compiles to the uint hash, and the GLSL, evaluated in uint arithmetic, is tileHash', async () => {
    const glsl = await glslOf((TSL) => {
      const io = tslIntOps(TSL);
      return io.toFloat01(tileHashOps(io, TSL.uniform(0.25), TSL.uniform(0.5)));
    });
    // The three multipliers as uint literals, the two xorshifts and the 24-bit read, every shift on a uint.
    for (const k of ['374761393u', '668265263u', '1274126177u', '>> 13u', '>> 16u', '>> 8u', '^']) expect(glsl).toContain(k);
    expect(glsl).toContain('uint( int( nodeUniform0 ) )');
    expect(glsl).toContain('uint( int( nodeUniform1 ) )');
    // ...and those two input conversions are the only signed values in the graph: a shift on an `int` drags the sign bit down.
    expect(glsl.match(/\bint\(/g)?.length, 'a signed int in the hash').toBe(2);
    const vars = [...glsl.matchAll(/^\s*(\w+) (nodeVar\d+);$/gm)];
    expect(vars.length).toBeGreaterThan(0);
    for (const v of vars) expect(v[1], `${v[2]} is not a uint`).toBe('uint');
    // Evaluate the generated main() with BigInt uint32 arithmetic (each assignment reduced mod 2^32; inside one expression the
    // graph applies nothing after a product but the reduction, so this is exact for it).
    const body = glsl.slice(glsl.indexOf('void main()'));
    const assigns = [...body.matchAll(/^\s*(nodeVar\d+) = (.*);$/gm)].map((m) => [m[1] as string, m[2] as string] as const);
    const result = /fragColor = vec4\( \( float\( (.*) \) \/ 16777216\.0 \), 0\.0, 0\.0, 1\.0 \);/.exec(body)?.[1];
    expect(result).toBeDefined();
    // `uint(...)` and `int(...)` are modelled as the 32-bit reinterpretations they are, so a signed shift computes its own (wrong) value.
    const toJs = (e: string): string =>
      e
        .replace(/uint\( int\( nodeUniform(\d) \) \)/g, 'U$1')
        .replace(/\buint\(/g, 'UI(')
        .replace(/\bint\(/g, 'SI(')
        .replace(/(\d+)u\b/g, '$1n')
        .replace(/nodeVar(\d+)/g, 'V$1');
    const UI = (v: bigint): bigint => BigInt.asUintN(32, v);
    const SI = (v: bigint): bigint => BigInt.asIntN(32, v);
    const run = (x: number, y: number): number => {
      const env: Record<string, bigint> = { U0: BigInt.asUintN(32, BigInt(x)), U1: BigInt.asUintN(32, BigInt(y)) };
      const evalIn = (e: string): bigint => {
        const names = Object.keys(env);
        const f = new Function('UI', 'SI', ...names, `return (${toJs(e)});`) as (...a: unknown[]) => bigint;
        return BigInt.asUintN(32, f(UI, SI, ...names.map((n) => env[n])));
      };
      for (const [name, e] of assigns) env[name.replace('nodeVar', 'V')] = evalIn(e);
      return Number(evalIn(result as string)) / 16777216;
    };
    for (const [x, y] of points.slice(0, 200)) expect(run(x, y), `(${x}, ${y})`).toBe(Math.floor(tileHash(x, y) * 16777216) / 16777216);
  });
});
