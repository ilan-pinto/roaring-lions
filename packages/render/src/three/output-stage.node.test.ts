/**
 * @vitest-environment jsdom
 *
 * GH-943 P1 (T3) gates: the output stage's maths on the node path (vignette, LUT coordinate, dither), and the ORDER of its
 * fragments in the real node graph. Each has a one-line falsification, run by hand and listed in the commit message.
 *
 * The node graph is evaluated on the CPU by `evalNode`, a tiny interpreter over exactly the node classes the maths builds
 * (const, uniform, operator, math, join, var). It is how "the vignette, node vs JS" is checked against LITERAL numbers rather than
 * against a recomputation of the same expression.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import * as TSL from 'three/tsl';
import type { Node as TslNode } from 'three/webgpu';
import { NUMBER_OPS, type Ops } from './fog-ops';
import { tslOps } from './fog-pass.node';
import { VIGNETTE_RADIUS, VIGNETTE_SOFTNESS, VIGNETTE_STRENGTH, vignetteFactor, vignetteScale } from './vignette-spec';
import { GRADE_LUT_SIZE, bakeLutFloats, gradeNoise, lutCoord, resolveGrade, IDENTITY_GRADE, type GradeJson } from './grade-maths';
import { createNodePostChain, type NodePostDeps } from './post-chain.node';
import { QUALITY_PRESETS } from '../quality';
import type { PostKit } from './backend/backend';
import dusk from '../../../../data/grades/dusk.json';
import { OUTPUT_MATHS } from './output-maths';

// --- a CPU evaluator for the scalar node graphs this file builds ------------------------------------------------------------------
interface AnyNode {
  constructor: { name: string };
  value?: number;
  op?: string;
  method?: string;
  aNode?: AnyNode;
  bNode?: AnyNode;
  cNode?: AnyNode;
  node?: AnyNode;
  nodes?: AnyNode[];
}
type Val = number | number[];
const lift = (f: (a: number, b: number) => number) => (a: Val, b: Val): Val =>
  Array.isArray(a) ? a.map((x, i) => f(x, Array.isArray(b) ? (b[i] as number) : b)) : Array.isArray(b) ? b.map((y) => f(a, y)) : f(a, b);

function evalNode(n: AnyNode): Val {
  switch (n.constructor.name) {
    case 'VarNode':
      return evalNode(n.node as AnyNode);
    case 'ConstNode':
    case 'UniformNode':
      return n.value as number;
    case 'JoinNode':
      return (n.nodes as AnyNode[]).map((c) => evalNode(c) as number);
    case 'OperatorNode': {
      const a = evalNode(n.aNode as AnyNode);
      const b = evalNode(n.bNode as AnyNode);
      const f = { '+': (x: number, y: number) => x + y, '-': (x: number, y: number) => x - y, '*': (x: number, y: number) => x * y, '/': (x: number, y: number) => x / y }[n.op as string];
      if (!f) throw new Error(`evalNode: operator ${n.op}`);
      return lift(f)(a, b);
    }
    case 'MathNode': {
      const a = evalNode(n.aNode as AnyNode);
      switch (n.method) {
        case 'length':
          return Math.sqrt((a as number[]).reduce((s, x) => s + x * x, 0));
        case 'fract':
          return (a as number) - Math.floor(a as number);
        case 'smoothstep':
          return NUMBER_OPS.smoothstep(a as number, evalNode(n.bNode as AnyNode) as number, evalNode(n.cNode as AnyNode) as number);
        case 'clamp': {
          const lo = evalNode(n.bNode as AnyNode) as number;
          const hi = evalNode(n.cNode as AnyNode) as number;
          return Array.isArray(a) ? a.map((x) => Math.min(hi, Math.max(lo, x))) : Math.min(hi, Math.max(lo, a));
        }
        default:
          throw new Error(`evalNode: math ${n.method}`);
      }
    }
    default:
      throw new Error(`evalNode: node ${n.constructor.name}`);
  }
}

const nodeOps = tslOps(TSL as never) as unknown as Ops<TslNode>;
const u = (v: number): TslNode => TSL.uniform(v) as unknown as TslNode;

describe('the vignette, node graph vs JS vs literals', () => {
  // Expected values worked by hand from the shipped constants (radius 0.62, softness 0.45, half-diagonal 0.7071, strength 0.55):
  //   corner (1,1):   d = 0.70711/0.7071 = 1.0000096 -> t = 0.844466 -> smoothstep 0.9349520 -> scale 1 - 0.55 * 0.9349520 = 0.485776
  //   edge (1, 0.5):  d = 0.70711        -> t = 0.193578 -> smoothstep 0.097917
  //   inside (0.8, 0.5): d = 0.4243 < radius -> exactly 0
  const CASES: Array<{ u: number; v: number; factor: number }> = [
    { u: 0.5, v: 0.5, factor: 0 },
    { u: 0.8, v: 0.5, factor: 0 },
    { u: 1, v: 0.5, factor: 0.097917 },
    { u: 1, v: 1, factor: 0.934952 },
  ];
  for (const c of CASES) {
    it(`factor at (${c.u}, ${c.v}) is ${c.factor} in JS and in the node graph`, () => {
      // Falsify: change `VIGNETTE_HALF_DIAGONAL` to 0.7 in vignette-spec.ts (or swap radius and softness in `vignetteFactor`).
      const js = vignetteFactor(NUMBER_OPS, c.u, c.v, VIGNETTE_RADIUS, VIGNETTE_SOFTNESS);
      expect(js).toBeCloseTo(c.factor, 5);
      const node = vignetteFactor(nodeOps, u(c.u), u(c.v), u(VIGNETTE_RADIUS), u(VIGNETTE_SOFTNESS));
      expect(evalNode(node as unknown as AnyNode) as number).toBeCloseTo(c.factor, 5);
    });
  }

  it('the scale is 0.485776 at the corner and exactly 1 at strength 0', () => {
    const f = vignetteFactor(NUMBER_OPS, 1, 1, VIGNETTE_RADIUS, VIGNETTE_SOFTNESS);
    expect(vignetteScale(NUMBER_OPS, VIGNETTE_STRENGTH, f)).toBeCloseTo(0.485776, 5);
    expect(vignetteScale(NUMBER_OPS, 0, f)).toBe(1);
    const node = vignetteScale(nodeOps, u(VIGNETTE_STRENGTH), vignetteFactor(nodeOps, u(1), u(1), u(VIGNETTE_RADIUS), u(VIGNETTE_SOFTNESS)));
    expect(evalNode(node as unknown as AnyNode) as number).toBeCloseTo(0.485776, 5);
  });
});

describe('the LUT coordinate and the dither noise, node graph vs JS vs literals', () => {
  it('lutCoord lands on texel centres: 0 -> 0.5/32, 1 -> 31.5/32, and clamps outside 0..1', () => {
    // Falsify: drop the `+ 0.5 / size` from `lutCoord`.
    expect(GRADE_LUT_SIZE).toBe(32);
    expect(lutCoord(NUMBER_OPS, 0)).toBeCloseTo(0.015625, 8);
    expect(lutCoord(NUMBER_OPS, 1)).toBeCloseTo(0.984375, 8);
    expect(lutCoord(NUMBER_OPS, 5)).toBeCloseTo(0.984375, 8);
    expect(lutCoord(NUMBER_OPS, -2)).toBeCloseTo(0.015625, 8);
    for (const c of [0, 0.25, 1, 3]) expect(evalNode(lutCoord(nodeOps, u(c)) as unknown as AnyNode) as number).toBeCloseTo(lutCoord(NUMBER_OPS, c), 6);
  });

  it('the dither noise at fixed pixels reads literals, node graph = JS', () => {
    // fract(52.9829189 * fract(x * 0.06711056 + y * 0.00583715)), worked by hand: (1,1) -> 0.864983, (10.5,20.5) -> 0.675010 (worked in python, independent of the TS)
    // Falsify: change 52.9829189 in `gradeNoise`.
    const a = gradeNoise(NUMBER_OPS, 1, 1);
    expect(a).toBeCloseTo(0.864983, 5);
    expect(gradeNoise(NUMBER_OPS, 10.5, 20.5)).toBeCloseTo(0.67501, 5);
    expect(evalNode(gradeNoise(nodeOps, u(1), u(1)) as unknown as AnyNode) as number).toBeCloseTo(a, 6);
  });
});

// --- the real node chain ---------------------------------------------------------------------------------------------------------
async function deps(): Promise<NodePostDeps> {
  const W = await import('three/webgpu');
  const T = await import('three/tsl');
  const { smaa } = await import('three/addons/tsl/display/SMAANode.js');
  return { W, TSL: T, smaa: smaa as never, outputMaths: OUTPUT_MATHS };
}
const emptyKit: PostKit = { fog: null, ao: null, bloom: null };
const fakeNodeRenderer = {} as never;

/** Every node under `root` (children walked through `getChildren`), `root` included. */
function subtree(root: unknown): Set<unknown> {
  const seen = new Set<unknown>();
  const walk = (n: { getChildren(): Iterable<unknown> }): void => {
    if (seen.has(n)) return;
    seen.add(n);
    for (const c of n.getChildren()) walk(c as never);
  };
  walk(root as never);
  return seen;
}
const named = (set: Set<unknown>, cls: string): unknown[] => [...set].filter((n) => (n as { constructor: { name: string } }).constructor.name === cls);

describe('the order of the output stage in the node graph', () => {
  it('encode -> LUT -> roundTripHalf x vignette -> dither, outermost last', async () => {
    // `low` has no SMAA, so the pipeline's output node IS the stage. Falsify (vignette before sRGB): in post-chain.node.ts move
    // the `grade.dither(vignette.apply(grade.lookup(...)))` line above `TSL.renderOutput` and feed it `colour.rgb` of the pass.
    const chain = createNodePostChain(await deps(), fakeNodeRenderer, new THREE.Scene(), new THREE.PerspectiveCamera(), QUALITY_PRESETS.low, emptyKit);
    const out = chain.pipeline.outputNode;
    const all = subtree(out);
    const outputNodes = named(all, 'RenderOutputNode');
    expect(outputNodes).toHaveLength(1);
    const lutSamples = named(all, 'Texture3DNode');
    expect(lutSamples).toHaveLength(1);

    // The vignette multiply is the OperatorNode '*' whose subtree holds the vignette strength uniform.
    const vig = chain.vignette.uniforms.uVigStrength;
    const mul = [...all].find(
      (n) => (n as { op?: string }).op === '*' && subtree(n).has(uniformNodeOf(all, vig)) && named(subtree(n), 'UnpackFloatNode').length > 0
    );
    expect(mul, 'the vignette multiply is in the graph').toBeDefined();
    const inVig = subtree(mul);
    // The vignette (and its half-float round trip) wraps the LUT lookup, which wraps the encode...
    expect(inVig.has(lutSamples[0])).toBe(true);
    expect(inVig.has(outputNodes[0])).toBe(true);
    const selects = named(all, 'ConditionalNode');
    const lutSelect = selects.find((s) => subtree(s).has(lutSamples[0]));
    expect(lutSelect).toBeDefined();
    expect(subtree(lutSelect).has(outputNodes[0])).toBe(true);
    // The dither is outermost: its select (the one holding the pixel position) contains the whole vignette product.
    const frag = named(all, 'ScreenNode').filter((s) => (s as { scope?: string }).scope === 'coordinate');
    expect(frag.length).toBeGreaterThan(0);
    const ditherSelect = selects.find((s) => subtree(s).has(frag[0]) && subtree(s).has(mul));
    expect(ditherSelect).toBeDefined();
    // ...and the vignette product does NOT contain the pixel position: the dither comes after it.
    expect(inVig.has(frag[0])).toBe(false);
    chain.dispose();
  });

  it('adds no pass: the node chain keeps the T2 pass names with the grade and vignette in OutputPass', async () => {
    const chain = createNodePostChain(await deps(), fakeNodeRenderer, new THREE.Scene(), new THREE.PerspectiveCamera(), QUALITY_PRESETS.high, emptyKit);
    expect(chain.passNames).toEqual(['RenderPass', 'OutputPass', 'SMAAPass']);
    chain.dispose();
  });
});

/** The uniform NODE whose `.value` accessor the handle exposes: the handle IS the node (`uniforms.X` is the UniformNode itself). */
function uniformNodeOf(_all: Set<unknown>, handle: unknown): unknown {
  return handle;
}

describe('the grade and vignette handles on the node chain', () => {
  const build = async () => createNodePostChain(await deps(), fakeNodeRenderer, new THREE.Scene(), new THREE.PerspectiveCamera(), QUALITY_PRESETS.low, emptyKit);

  it('start as legacy starts: vignette OFF (strength 0), grade not active, grade-on 0', async () => {
    const chain = await build();
    expect(chain.vignette.enabled).toBe(false);
    expect(chain.vignette.uniforms.uVigStrength.value).toBe(0);
    expect(chain.grade.active).toBe(false);
    expect(chain.grade.uniforms.uGradeOn.value).toBe(0);
    chain.dispose();
  });

  it('vignette.enabled writes the shipped strength, and false writes exactly 0', async () => {
    // Falsify: make the setter write `VIGNETTE_STRENGTH` unconditionally.
    const chain = await build();
    chain.vignette.enabled = true;
    expect(chain.vignette.uniforms.uVigStrength.value).toBe(VIGNETTE_STRENGTH);
    chain.vignette.enabled = false;
    expect(chain.vignette.uniforms.uVigStrength.value).toBe(0);
    chain.dispose();
  });

  it('an identity or null grade builds nothing: apply returns false and the lookup stays off', async () => {
    const chain = await build();
    expect(chain.grade.apply(null)).toBe(false);
    expect(chain.grade.apply(IDENTITY_GRADE)).toBe(false);
    expect(chain.grade.uniforms.uGradeOn.value).toBe(0);
    chain.dispose();
  });

  it('a real grade rewrites the LUT texels (the shared bake, as half floats) and the switch gates it', async () => {
    // Falsify: skip the `this.half[i] = ...` copy in `apply`.
    const chain = await build();
    const grade = resolveGrade(dusk as GradeJson, 1, (k) => (k.startsWith('water') ? '#3a6f8f' : '#c46a4a'));
    expect(chain.grade.apply(grade)).toBe(true);
    expect(chain.grade.active).toBe(true);
    expect(chain.grade.uniforms.uGradeOn.value).toBe(1);
    const data = chain.grade.lut.image.data as Uint16Array;
    const floats = bakeLutFloats(grade);
    expect(data).toHaveLength(floats.length);
    // Texel (31, 31, 31), the white corner: the bake's last RGB triple, as a half float.
    const o = floats.length - 4;
    for (let c = 0; c < 3; c++) expect(THREE.DataUtils.fromHalfFloat(data[o + c] as number)).toBeCloseTo(floats[o + c] as number, 3);
    chain.grade.enabled = false;
    expect(chain.grade.uniforms.uGradeOn.value).toBe(0);
    chain.grade.enabled = true;
    expect(chain.grade.uniforms.uGradeOn.value).toBe(1);
    expect(chain.grade.apply(grade, { dither: false })).toBe(true);
    expect(chain.grade.uniforms.uGradeDither.value).toBe(0);
    chain.dispose();
  });
});
