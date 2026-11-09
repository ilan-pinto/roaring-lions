/**
 * @vitest-environment jsdom
 *
 * GH-943 P2 (T3): `assertNoImplicitSampleInConditional` on DELIBERATE fixtures, so the checker the ground graph is run through is
 * known to be able to fail. The TSL fixture is compiled by three's own `GLSLNodeBuilder` (no GPU): one `If`-wrapped plain `texture()`
 * tap, which it must reject, and the same tap made `.grad()`, which it must accept.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { assertNoImplicitSampleInConditional, implicitSamplesInConditionals } from './sample-uniformity';

/** A float uniform `c`, a texture, and a fragment whose colour is assigned INSIDE `If(c > 0.5)`: plain or explicit-gradient. */
async function fixture(explicit: boolean): Promise<string> {
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const T = TSL as unknown as {
    uniform(v: number): { greaterThan(n: number): unknown };
    texture(t: THREE.Texture, uv: unknown): { grad(dx: unknown, dy: unknown): unknown };
    vec4(...a: unknown[]): { toVar(): { assign(v: unknown): void } };
    vec2(...a: unknown[]): unknown;
    uv(): unknown;
    dFdx(a: unknown): unknown;
    dFdy(a: unknown): unknown;
    If(c: unknown, body: () => void): void;
    Fn(body: () => unknown): () => unknown;
  };
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const c = T.uniform(0);
  const node = T.Fn(() => {
    const uv = T.uv();
    const out = T.vec4(0, 0, 0, 1).toVar();
    T.If(c.greaterThan(0.5), () => {
      const tap = T.texture(tex, uv);
      out.assign(explicit ? tap.grad(T.dFdx(uv), T.dFdy(uv)) : tap);
    });
    return out;
  })();
  const r = new W.WebGPURenderer({ forceWebGL: true });
  const mat = new W.NodeMaterial();
  mat.fragmentNode = node as never;
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

describe('assertNoImplicitSampleInConditional', () => {
  it('REJECTS a plain texture() tap inside an If (the compiled TSL fixture)', async () => {
    const src = await fixture(false);
    // Non-vacuous: the fixture really put the tap inside an `if` body.
    expect(src).toMatch(/if \( \( nodeUniform\d+ > 0\.5 \) \) \{[\s\S]*\btexture\( nodeUniform/);
    expect(() => assertNoImplicitSampleInConditional(src)).toThrow(/implicit-gradient sample inside a conditional/);
  });
  it('ACCEPTS the same tap made .grad() (explicit gradient)', async () => {
    const src = await fixture(true);
    expect(src).toMatch(/if \( \( nodeUniform\d+ > 0\.5 \) \) \{[\s\S]*\btextureGrad\( nodeUniform/);
    expect(() => assertNoImplicitSampleInConditional(src)).not.toThrow();
  });
  it('reads braceless bodies, else bodies, WGSL heads and loops, and ignores comments and top-level taps', () => {
    expect(implicitSamplesInConditionals('void main() { vec4 a = texture(s, uv); }')).toEqual([]);
    expect(implicitSamplesInConditionals('void main() { if (c) a = texture(s, uv); b = texture(s, uv); }')).toHaveLength(1);
    expect(implicitSamplesInConditionals('void main() { if (c) { a = 1.0; } else { a = texture(s, uv).x; } }')).toHaveLength(1);
    expect(implicitSamplesInConditionals('void main() { if (c) { } else a = texture2D(s, uv).x; }')).toHaveLength(1);
    expect(implicitSamplesInConditionals('fn main() { if c > 0.5 { a = textureSample(t, s, uv); } }')).toHaveLength(1);
    expect(implicitSamplesInConditionals('fn main() { loop { a = textureSample(t, s, uv); } }')).toHaveLength(1);
    expect(implicitSamplesInConditionals('fn main() { if c > 0.5 { a = textureSampleGrad(t, s, uv, dx, dy); } }')).toEqual([]);
    expect(implicitSamplesInConditionals('void main() { for (int i = 0; i < 4; i++) { a += texture(s, uv); } }')).toHaveLength(1);
    expect(implicitSamplesInConditionals('void main() { if (c) { a = 1.0; } b = texture(s, uv); // if (c) texture(s, uv)\n }')).toEqual([]);
    expect(implicitSamplesInConditionals('void main() { if (c) { x = textureLod(s, uv, 0.0); y = texelFetch(s, p, 0); } }')).toEqual([]);
  });
});
