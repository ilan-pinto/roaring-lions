/**
 * Task 10, spec 5-6: the depth-reading half of fog of war. Constructing the
 * pass builds a `ShaderMaterial` and a `FullScreenQuad` -- both plain JS
 * objects until something renders them -- so the constants, the uniform
 * plumbing and the shader SOURCE are all reachable headless. What the shader
 * actually paints is the browser check in this task's own report; what this
 * file pins is that the source still does the two things the whole design
 * rests on: reconstruct world XZ from depth, and leave the clear colour
 * alone.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  FogOfWarPass,
  FOG_NEVER_SEEN,
  FOG_EXPLORED,
  FOG_OFFMAP_FADE_TILES,
  FOG_TINT_HEX,
} from './fog-pass';
import { hexToLinear } from './terrain/shared';

describe('FogOfWarPass', () => {
  it('carries the spec constants as uniforms and the tint as a LINEAR colour', () => {
    const pass = new FogOfWarPass(new THREE.Texture(), 48, 48);
    expect(FOG_NEVER_SEEN).toBe(0.85);
    expect(FOG_EXPLORED).toBe(0.4);
    expect(pass.uniforms.uNeverSeen.value).toBe(FOG_NEVER_SEEN);
    expect(pass.uniforms.uExplored.value).toBe(FOG_EXPLORED);
    expect(pass.uniforms.uMapSize.value.toArray()).toEqual([48, 48]);
    // C2: defaults to 0 -- every shipped frame is a no-op on the on-map
    // maths, per the shader's own `mix(v, 1.0, uRevealAll)`.
    expect(pass.uniforms.uRevealAll.value).toBe(0);
    const [r] = hexToLinear(FOG_TINT_HEX);
    expect((pass.uniforms.uTint.value as THREE.Vector3).x).toBeCloseTo(r, 6);
    expect(pass.needsSwap).toBe(true);
  });

  it('updateCamera copies the inverse projection and world matrix', () => {
    const pass = new FogOfWarPass(new THREE.Texture(), 8, 8);
    const cam = new THREE.OrthographicCamera(-2, 2, 1, -1, 1, 10);
    cam.position.set(3, 4, 5);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    pass.updateCamera(cam);
    expect((pass.uniforms.uInvProjection.value as THREE.Matrix4).toArray()).toEqual(
      cam.projectionMatrixInverse.toArray()
    );
    expect((pass.uniforms.uCameraWorld.value as THREE.Matrix4).toArray()).toEqual(cam.matrixWorld.toArray());
  });

  it('shader reconstructs world XZ from depth and skips the clear colour', () => {
    const pass = new FogOfWarPass(new THREE.Texture(), 8, 8);
    const frag = pass.material.fragmentShader;
    expect(frag).toContain('if (depth >= 1.0)');
    expect(frag).toContain('uInvProjection * clip');
    expect(frag).toContain('uCameraWorld * view');
    expect(frag).toContain('world.x / uMapSize.x, world.z / uMapSize.y');
  });

  it('fades ground OUTSIDE the map to never-seen, over one tile', () => {
    // The shroud is ClampToEdgeWrapping, so without this a single visible
    // tile on the border floods a whole quadrant of `terrain/skirt.ts`'s
    // ground with the edge tile's value -- a searchlight wedge that
    // photographed (175, 171, 160) sRGB against the (55, 52, 45) of the
    // shrouded skirt beside it.
    const pass = new FogOfWarPass(new THREE.Texture(), 8, 8);
    const frag = pass.material.fragmentShader;
    expect(FOG_OFFMAP_FADE_TILES).toBe(1.0);
    // The distance outside is measured in TILES, not in map fractions: a
    // fraction would make the fade a map-size-dependent distance, so the
    // same overhanging roof would be dimmed differently on a 32-tile map and
    // a 64-tile one.
    expect(frag).toContain('max(vec2(0.0), max(-tex, tex - vec2(1.0)))');
    expect(frag).toContain(
      `v *= 1.0 - clamp(length(outUv * uMapSize) / ${FOG_OFFMAP_FADE_TILES.toFixed(1)}, 0.0, 1.0);`
    );
    // It MULTIPLIES the sampled value rather than replacing it, so a point
    // exactly on the border is bit-identical to what it was before this
    // existed -- the whole reason nothing inside the map moved.
    expect(frag).toContain('float v = texture2D(uShroud, tex).r;');
  });
});

describe('uRevealAll (C2: reveal every on-map tile without disabling the pass)', () => {
  it('runs BEFORE the off-map fade, so ground past the border still fades rather than snapping to seen', () => {
    // `plate-capture.ts` used to hide the fog-of-war boundary by disabling
    // this whole pass (`setDebugLayerVisible('fog', false)`), which also
    // disabled `FOG_OFFMAP_FADE_TILES` and shipped a pale, unshrouded wedge
    // beyond the map edge in the key art. The fix leaves the pass enabled
    // and forces the SAMPLED value toward 1.0 instead -- ordering matters:
    // if this line ran AFTER the off-map multiply, a revealed off-map pixel
    // would read as seen no matter how far outside the map it was.
    const pass = new FogOfWarPass(new THREE.Texture(), 8, 8);
    const frag = pass.material.fragmentShader;
    expect(frag).toContain('uniform float uRevealAll;');
    expect(frag).toContain('v = mix(v, 1.0, uRevealAll);');
    const revealIdx = frag.indexOf('v = mix(v, 1.0, uRevealAll);');
    const offMapIdx = frag.indexOf('v *= 1.0 - clamp(length(outUv * uMapSize)');
    expect(revealIdx).toBeGreaterThan(-1);
    expect(offMapIdx).toBeGreaterThan(-1);
    expect(revealIdx).toBeLessThan(offMapIdx);
  });
});

/**
 * The shader's reveal-plus-off-map maths, in JS, combining the two GLSL
 * lines pinned above so the numeric CLAIM (on-map always reads as seen; the
 * off-map fade is untouched) is checked rather than merely the source text.
 * `shroud` is the sampled shroud value before either term runs, matching
 * the shader's own `v`.
 */
function dimWithReveal(shroud: number, revealAll: number, tilesOutside: number): number {
  const revealed = shroud * (1 - revealAll) + 1.0 * revealAll; // mix(v, 1.0, uRevealAll)
  const fade = 1 - Math.min(1, Math.max(0, tilesOutside / FOG_OFFMAP_FADE_TILES));
  const v = revealed * fade;
  return v < 0.5
    ? FOG_NEVER_SEEN * (1 - v * 2) + FOG_EXPLORED * (v * 2)
    : FOG_EXPLORED * (1 - (v - 0.5) * 2);
}

describe('reveal-all combined with the off-map fade', () => {
  it('reads as fully seen (dim 0) anywhere ON the map, whatever the real shroud value', () => {
    for (const shroud of [0, 0.25, 0.5, 0.75, 1]) {
      expect(dimWithReveal(shroud, 1, 0)).toBeCloseTo(0, 6);
    }
  });

  it('leaves the off-map fade doing exactly what it does with reveal-all off', () => {
    // A tile beyond the border reads never-seen with reveal-all on OR off --
    // the fade has already driven v to 0 before dim is computed, so
    // uRevealAll's forced 1.0 never survives the multiply.
    expect(dimWithReveal(1, 1, FOG_OFFMAP_FADE_TILES)).toBeCloseTo(FOG_NEVER_SEEN, 6);
    expect(dimWithReveal(0, 0, FOG_OFFMAP_FADE_TILES)).toBeCloseTo(FOG_NEVER_SEEN, 6);
    // Halfway out, reveal-all's forced 1.0 fades linearly toward the border
    // exactly as a genuinely fully-seen shroud sample would.
    expect(dimWithReveal(1, 1, FOG_OFFMAP_FADE_TILES / 2)).toBeCloseTo(FOG_EXPLORED, 6);
  });

  it('is algebraically a no-op when uRevealAll is 0 -- the default, and every shipped frame', () => {
    for (const shroud of [0, 0.3, 0.6, 1]) {
      for (const tilesOutside of [0, 0.5, 2]) {
        const fade = 1 - Math.min(1, Math.max(0, tilesOutside / FOG_OFFMAP_FADE_TILES));
        const v = shroud * fade;
        const expected =
          v < 0.5 ? FOG_NEVER_SEEN * (1 - v * 2) + FOG_EXPLORED * (v * 2) : FOG_EXPLORED * (1 - (v - 0.5) * 2);
        expect(dimWithReveal(shroud, 0, tilesOutside)).toBeCloseTo(expected, 6);
      }
    }
  });
});

/**
 * The shader's off-map term, in JS, so the two claims about it are checked
 * rather than asserted from its source text alone. `tex` is the world
 * position in map fractions; the result is the multiplier applied to the
 * sampled shroud value.
 */
function offMapFade(tex: [number, number], mapSize: [number, number]): number {
  const outU = Math.max(0, Math.max(-tex[0], tex[0] - 1));
  const outV = Math.max(0, Math.max(-tex[1], tex[1] - 1));
  const tiles = Math.hypot(outU * mapSize[0], outV * mapSize[1]);
  return 1 - Math.min(1, Math.max(0, tiles / FOG_OFFMAP_FADE_TILES));
}

describe('the off-map fade', () => {
  it('is 1 everywhere on the map and 0 a tile beyond it', () => {
    const size: [number, number] = [48, 48];
    for (const t of [
      [0, 0],
      [0.5, 0.5],
      [1, 1],
      [0.5, 1],
    ] as [number, number][]) {
      expect(offMapFade(t, size), `on-map ${t.join(',')}`).toBe(1);
    }
    // One tile out on a 48-tile map is 1/48 of the map.
    expect(offMapFade([-1 / 48, 0.5], size)).toBeCloseTo(0, 6);
    expect(offMapFade([1 + 1 / 48, 0.5], size)).toBeCloseTo(0, 6);
    // ...and a long way out stays clamped at never-seen rather than going
    // negative and inverting the shroud.
    expect(offMapFade([-1, -1], size)).toBe(0);
  });

  it('is a distance in TILES, so map size does not change how far the fade reaches', () => {
    // A quarter tile out reads the same fraction on a 32-tile map and a
    // 64-tile one; expressing the fade in map fractions instead would make
    // it twice as wide on the smaller map.
    expect(offMapFade([-0.25 / 32, 0.5], [32, 32])).toBeCloseTo(0.75, 6);
    expect(offMapFade([-0.25 / 64, 0.5], [64, 64])).toBeCloseTo(0.75, 6);
  });
});
