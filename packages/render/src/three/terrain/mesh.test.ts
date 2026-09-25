/**
 * The three terrain materials' contract, asserted against the uniforms and
 * against the shader source three.js would actually compile -- the same way
 * `campaign/world-material.test.ts` pins the diorama's, and for the same
 * reason: this suite runs under `environment: 'node'` with no GL context.
 *
 * All three are `MeshStandardMaterial` now, lit and shadowed by `lighting.ts`'s
 * one sun. What used to need asserting -- that the ground's own slope shade was
 * a DEPARTURE from flat, and smooth rather than banded -- is gone with the
 * private light that needed it: the third named palette exemption
 * (`surface.ts`, `SURFACE_SHADING_EXEMPTION`) is now the scene's job, not this
 * file's.
 *
 * What still has to be pinned here is the part three.js does NOT provide and
 * that this change had to carry over verbatim: the six-slot albedo blend. It
 * reaches the GPU through `onBeforeCompile`, which is a string edit of three's
 * own chunks -- so an anchor that stops matching, a uniform the material owns
 * but never hands the program, or a slot wired into `GROUND_SLOTS` and not into
 * the shader are all silent, and all of them draw a plausible flat-toned map.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  GroundMaterial,
  GroveMaterial,
  vertexColorMaterial,
  toGeometry,
  GROUND_ALBEDOS,
  GROUND_SLOTS,
  albedoMean,
  slotUniforms,
  prepareGroundTexture,
  controlTextures,
} from './mesh';
import { buildControlMap, buildMacroField, HEIGHT_BLEND, MACRO_HUE, MACRO_LUMINANCE } from './control-map';
import { buildGround, WALL_ALBEDO_NONE, WALL_ALBEDO_ROCK, WALL_ALBEDO_TOP } from './ground';
import {
  ROAD_EDGE_BEND,
  ROAD_EDGE_FALLOFF,
  ROAD_HALF_WIDTH,
  RUT_ALPHA,
  RUT_JUNCTION_FADE,
  RUT_OFFSET,
  RUT_WIDTH,
  ROAD_GRAIN_GAIN,
  ROAD_GRAIN_TILES,
  SHOULDER_ALPHA,
  SHOULDER_TILES,
} from './road-graph';
import { DECOR_RIDGE, DECOR_ROAD, srgbToLinear } from './shared';
import type { MeshData, TerrainInput } from './types';

type Vec3 = [number, number, number];

/** Verbatim from `ground.test.ts` -- vertex `i`'s position. */
function vertex(m: MeshData, i: number): Vec3 {
  return [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
}

/** Verbatim from `ground.test.ts`: which of the four things `buildGround`
 *  emits a triangle belongs to, classified from its own vertices. */
function kindOf(a: Vec3, b: Vec3, c: Vec3): 'tile top' | 'east face' | 'south face' | 'surface patch' {
  if (a[0] === b[0] && b[0] === c[0]) return 'east face';
  if (a[2] === b[2] && b[2] === c[2]) return 'south face';
  if (a[1] === b[1] && b[1] === c[1]) return 'tile top';
  return 'surface patch';
}

/** `ground.test.ts`'s own tone set -- any on-palette `TerrainTones` will do,
 *  since nothing here reads a colour. */
const TONES = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'] as [string, string, string],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone' as const, groveFamily: 'desert_tree' as const,
};
const BACKGROUND = '#14150F';

/** A 4x4 map with something on it for each control channel to say: a road
 *  row, a cover-2 tile and a ridge. */
const tinyInput: TerrainInput = (() => {
  const w = 4;
  const h = 4;
  const decor = new Uint8Array(w * h);
  const blocked = new Uint8Array(w * h);
  const cover = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) decor[0 * w + x] = DECOR_ROAD;
  cover[2 * w + 1] = 2;
  decor[3 * w + 3] = DECOR_RIDGE;
  blocked[3 * w + 3] = 1;
  return { width: w, height: h, decor, elevation: null, blocked, cover };
})();

/** 4x4 at elevation 1, a `^` ridge at (1,1) and a building's blocked tile at
 *  (2,2), both at elevation 3 -- so each throws walls, one of each kind. */
function reliefWithRidgeAndBuilding(): TerrainInput {
  const w = 4;
  const h = 4;
  const elevation = new Uint8Array(w * h).fill(1);
  const decor = new Uint8Array(w * h);
  const blocked = new Uint8Array(w * h);
  decor[1 * w + 1] = DECOR_RIDGE;
  blocked[1 * w + 1] = 1;
  elevation[1 * w + 1] = 3;
  blocked[2 * w + 2] = 1;
  elevation[2 * w + 2] = 3;
  return { width: w, height: h, decor, elevation, blocked, cover: new Uint8Array(w * h) };
}

/**
 * The standard material's own sources with this material's injection applied
 * -- the text the GPU would compile.
 *
 * `onBeforeCompile` is three.js's only seam onto that text, so a test that
 * wants to read the shader has to run it. The three fields below are all
 * `WebGLProgramParametersWithUniforms` members these materials touch; the cast
 * is what the signature demands and nothing here reads the rest.
 */
function compiled(material: THREE.Material): {
  uniforms: Record<string, THREE.IUniform>;
  vertexShader: string;
  fragmentShader: string;
} {
  const shader = {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: THREE.ShaderChunk.meshphysical_vert,
    fragmentShader: THREE.ShaderChunk.meshphysical_frag,
  };
  material.onBeforeCompile(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    {} as THREE.WebGLRenderer
  );
  return shader;
}

/** `compiled(material).fragmentShader` -- the brief's name for the same seam. */
function compiledFragmentSource(material: THREE.Material): string {
  return compiled(material).fragmentShader;
}

describe('GroundMaterial samples the control map', () => {
  const src = compiledFragmentSource(new GroundMaterial());

  it('declares the control and macro samplers, and no longer the five surface masks', () => {
    for (const u of ['uControlA', 'uControlB', 'uMacro', 'uMapSize', 'uMacroAmp']) expect(src).toContain(u);
    for (const m of ['vSandMask', 'vRockMask', 'vScrubMask', 'vGroveMask', 'vKnollMask']) expect(src).not.toContain(m);
  });
  it('carries the tested constants, not a transcription of them', () => {
    expect(src).toContain(HEIGHT_BLEND.toFixed(3));
    expect(src).toContain(MACRO_LUMINANCE.toFixed(3));
    expect(src).toContain(MACRO_HUE.toFixed(3));
    // Once each: a constant written in several places passes "contains" with
    // one of them retyped by hand, which is the drift this test exists for.
    for (const c of [HEIGHT_BLEND, MACRO_LUMINANCE, MACRO_HUE]) {
      expect(src.split(c.toFixed(3)).length - 1, `${c.toFixed(3)} is written more than once`).toBe(1);
    }
    // And every weight goes through the one biased helper.
    expect(src.match(/rlHeightBiased\(rlW[0-4], rlF[0-4]\)/g)).toHaveLength(5);
    // The exact inverse of `buildMacroField`'s `round(128 + 127 v)`, so the
    // 1x1 default of 128 is m = 0 exactly.
    expect(src).toContain('* 255.0 - 128.0) / 127.0');
  });
  it('fails soft: before any map lands, every default means "flat palette tone"', () => {
    const u = new GroundMaterial().uniforms;
    const px = (name: string): number[] => Array.from((u[name].value as THREE.DataTexture).image.data as Uint8Array);
    expect(px('uControlA')).toEqual([0, 0, 0, 0]);
    expect(px('uControlB')).toEqual([0, 255, 255, 128]);
    expect(px('uMacro')[0]).toBe(128);
    expect(u.uMacroAmp.value).toBe(1);
  });
  it('builds its textures as data, not colour', () => {
    const t = controlTextures(buildControlMap(tinyInput), buildMacroField(4, 4));
    for (const tex of [t.a, t.b, t.macro]) {
      expect(tex.colorSpace).toBe(THREE.NoColorSpace);
      expect(tex.flipY).toBe(false);
      expect(tex.wrapS).toBe(THREE.ClampToEdgeWrapping);
      expect(tex.wrapT).toBe(THREE.ClampToEdgeWrapping);
      expect(tex.generateMipmaps).toBe(true);
      // Filtered and mipmapped: at zoom 0.35 a fragment spans several control
      // texels, and an unfiltered minification shimmers every splat edge.
      expect(tex.magFilter).toBe(THREE.LinearFilter);
      expect(tex.minFilter).toBe(THREE.LinearMipmapLinearFilter);
      // One byte a texel on the macro field: a 4-byte row alignment would
      // skew every row after the first on any width not a multiple of 4.
      expect(tex.unpackAlignment).toBe(1);
    }
    expect(t.macro.format).toBe(THREE.RedFormat);
  });
  it('rescales the height-biased weights back to their own sum, as heightBiased does', () => {
    // Without the rescale the bias INVENTS or DESTROYS weight: a tile
    // interior's single weight would drift off its strength, and the "every
    // interior is the old chain of mixes exactly" claim would be false.
    expect(src).toContain('4.0 * w * (1.0 - w)');
    expect(src).toMatch(
      /if \(rlBSum > 0\.0\) \{\s*float rlRescale = \(rlW0 \+ rlW1 \+ rlW2 \+ rlW3 \+ rlW4\) \/ rlBSum;/
    );
    for (let i = 0; i < 5; i++) expect(src).toContain(`rlW${i} = rlB${i} * rlRescale;`);
  });
  it('reads the wall attribute and the world position in the vertex stage', () => {
    const vert = compiled(new GroundMaterial()).vertexShader;
    expect(vert).toContain('attribute float wallAlbedo;');
    expect(vert).toContain('vRlWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    // After `<begin_vertex>`, where `transformed` exists.
    expect(vert.indexOf('#include <begin_vertex>')).toBeLessThan(vert.indexOf('vRlWorldXZ ='));
  });
});

describe('the road shader (#226)', () => {
  const src = compiledFragmentSource(new GroundMaterial());
  it('has no road slot and no axis blend any more', () => {
    expect(GROUND_SLOTS).toEqual(['sand', 'rock', 'scrub', 'grove', 'knoll']);
    for (const gone of ['uRoad;', 'uRoadStrength', 'vRoadAxis', 'vRoadMask', 'rlRoadUv']) expect(src).not.toContain(gone);
  });
  it('draws surface, shoulder and ruts from control B with the tested profile constants', () => {
    for (const k of [
      ROAD_HALF_WIDTH,
      ROAD_EDGE_FALLOFF,
      ROAD_EDGE_BEND,
      SHOULDER_TILES,
      SHOULDER_ALPHA,
      RUT_OFFSET,
      RUT_WIDTH,
      RUT_ALPHA,
      RUT_JUNCTION_FADE,
    ])
      expect(src).toContain(k.toFixed(3));
    for (const u of ['uRoadOn', 'uRoadTone', 'uShoulderTone', 'uRutTone', 'uRoadGrainTiles', 'uRoadGrainGain'])
      expect(src).toContain(u);
  });
  it('derives the edge and rut bands from the tested constants rather than from retyped literals (F-3)', () => {
    // `roadProfile`'s edgeLo/edgeHi and rutLo/rutHi, spelled as expressions of
    // the exported constants so a drifted base constant moves the shader too.
    const h = ROAD_HALF_WIDTH.toFixed(3);
    const f = ROAD_EDGE_FALLOFF.toFixed(3);
    const w = RUT_WIDTH.toFixed(3);
    expect(src).toContain(`(${h} - 0.5 * ${f})`);
    expect(src).toContain(`(${h} + 0.5 * ${f})`);
    expect(src).toContain(`(0.5 * ${w} - 0.010)`);
    expect(src).toContain(`(0.5 * ${w} + 0.010)`);
    // Neither the old nor the derived value appears as a bare literal.
    for (const derived of ['0.270', '0.450', '0.020']) expect(src).not.toContain(derived);
  });
  it('takes its grain from the knoll sampler -- one shared image, no road asset (R-7)', () => {
    expect(src).toMatch(/vec2 rlGrainUv = vRlWorldXZ\s*\/\s*uRoadGrainTiles;/);
    expect(src).toMatch(/textureGrad\s*\(\s*uKnoll\s*,\s*rlGrainUv\s*,\s*rlGrainDx\s*,\s*rlGrainDy\s*\)/);
  });
  it('skips the road block where control B saturates, taking the grain gradient outside the branch', () => {
    // At B.g = 1 the bent edge is >= 1 - ROAD_EDGE_BEND, past the shoulder's
    // outer edge (ROAD_HALF_WIDTH + FALLOFF/2 + SHOULDER_TILES = 0.57), so
    // surface, shoulder and rut are exactly 0 there and the skip is
    // pixel-identical -- proven by a golden A/B of 0 px (fix wave).
    expect(ROAD_HALF_WIDTH + ROAD_EDGE_FALLOFF / 2 + SHOULDER_TILES).toBeLessThan(1 - ROAD_EDGE_BEND);
    const branch = src.indexOf('if (rlB.g < 1.0) {');
    expect(branch).toBeGreaterThan(-1);
    // The derivatives are taken BEFORE the branch: implicit derivatives are
    // undefined in non-uniform control flow.
    expect(src.indexOf('dFdx(rlGrainUv)')).toBeGreaterThan(-1);
    expect(src.indexOf('dFdx(rlGrainUv)')).toBeLessThan(branch);
    expect(src.indexOf('dFdy(rlGrainUv)')).toBeLessThan(branch);
    expect(src.indexOf('textureGrad(uKnoll')).toBeGreaterThan(branch);
  });
  it('lets the road cover the surfaces beneath it', () => {
    expect(src).toMatch(/rlW0\s*\*=\s*\(1\.0\s*-\s*rlRoadSurf\)/);
    for (let i = 1; i < 5; i++) expect(src).toContain(`rlW${i} *= (1.0 - rlRoadSurf);`);
    // ...after the height-bias rescale, which would otherwise hand the covered
    // weight straight back.
    expect(src.indexOf('rlW0 *= (1.0 - rlRoadSurf)')).toBeGreaterThan(src.indexOf('rlW4 = rlB4 * rlRescale;'));
  });
  it('paints the tones before the ratio multiply, and adds the grain as a ratio term of its own', () => {
    // The albedo is a RATIO to the palette tone, so the road's tone has to be
    // in `diffuseColor` before the multiply -- mixed in after it, the ratio
    // would scale the road tone instead of the tile's.
    const mul = src.indexOf('diffuseColor.rgb *= rlAlbedo * rlMacro;');
    for (const t of ['uRoadTone, rlRoadSurf)', 'uShoulderTone, rlShoulder)', 'uRutTone, rlRut)']) {
      const at = src.indexOf(`diffuseColor.rgb = mix(diffuseColor.rgb, ${t};`);
      expect(at, t).toBeGreaterThan(-1);
      expect(at, t).toBeLessThan(mul);
    }
    expect(src).toMatch(/rlRoadGrainTerm = rlRoadSurf\s*\*\s*\(mix\(vec3\(1\.0\),\s*rlGrain,\s*uRoadGrainGain\)\s*-\s*1\.0\)/);
    expect(src).toMatch(/\+\s*rlRoadGrainTerm;/);
  });
  it('is a top-only surface, switched by uRoadOn', () => {
    // A road never paints a wall (`rlTop`), and the `roads` layer (Task 9)
    // removes it by writing uRoadOn = 0.
    expect(src).toMatch(/rlRoadSurf = uRoadOn \* rlTop \*/);
    expect(src).toMatch(/rlShoulder = uRoadOn \* rlTop \*/);
  });
  it('fails soft: the grain is off until the knoll image lands (F-12), the road on', () => {
    // Before the image lands `uKnoll` is the 1x1 white pixel, which reads as
    // 1 / uKnollMean -- about 1.6x -- and a live gain would brighten every
    // road by that much. 0 until `ThreeRenderer`'s knoll load sets it.
    const u = new GroundMaterial().uniforms;
    expect(u.uRoadGrainGain.value).toBe(0);
    expect(u.uRoadOn.value).toBe(1);
    expect(u.uRoadGrainTiles.value).toBe(ROAD_GRAIN_TILES);
  });
  it('stashes the grain gain with the slot strengths when ground-albedo hides, and puts it back', () => {
    const m = new GroundMaterial();
    m.uniforms.uRoadGrainGain.value = ROAD_GRAIN_GAIN;
    m.setAlbedoVisible(false);
    expect(m.uniforms.uRoadGrainGain.value).toBe(0);
    m.setAlbedoVisible(false);
    m.setAlbedoVisible(true);
    expect(m.uniforms.uRoadGrainGain.value).toBe(ROAD_GRAIN_GAIN);
  });
});

describe('wallAlbedo -- the one per-vertex surface fact left (R-5)', () => {
  it('is -1 on every top, 1 on a ridge wall, 0 on a building wall', () => {
    const data = buildGround(reliefWithRidgeAndBuilding(), TONES, BACKGROUND);
    const w = data.wallAlbedo;
    if (!w) throw new Error('buildGround emitted no wallAlbedo');
    const byKind = new Map<string, Set<number>>();
    for (let t = 0; t < data.indices.length / 3; t++) {
      const vs = [0, 1, 2].map((k) => data.indices[t * 3 + k]);
      const kind = kindOf(vertex(data, vs[0]), vertex(data, vs[1]), vertex(data, vs[2]));
      const set = byKind.get(kind) ?? new Set<number>();
      for (const v of vs) set.add(w[v]);
      byKind.set(kind, set);
    }
    for (const top of ['tile top', 'surface patch']) {
      const s = byKind.get(top);
      if (s) expect(s, top).toEqual(new Set([WALL_ALBEDO_TOP]));
    }
    const walls = new Set([...(byKind.get('east face') ?? []), ...(byKind.get('south face') ?? [])]);
    expect(walls).toEqual(new Set([WALL_ALBEDO_ROCK, WALL_ALBEDO_NONE]));
    expect(toGeometry(data).getAttribute('wallAlbedo').count).toBe(data.positions.length / 3);
  });
});

describe('GroundMaterial', () => {
  it('is a lit, vertex-coloured, double-sided standard material with the five albedo slots as uniforms', () => {
    const m = new GroundMaterial();
    expect(m.isMeshStandardMaterial).toBe(true);
    expect(m.vertexColors).toBe(true);
    expect(m.side).toBe(THREE.DoubleSide);
    for (const slot of GROUND_SLOTS) {
      const u = slotUniforms(slot);
      expect(m.uniforms[u.map]).toBeDefined();
      expect(m.uniforms[u.strength].value).toBe(0);
      expect(m.uniforms[u.mean]).toBeDefined();
      expect(m.uniforms[u.tiles]).toBeDefined();
    }
  });
  it('injects the albedo blend into the standard fragment shader after the vertex colour', () => {
    const m = new GroundMaterial();
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderChunk.meshphysical_vert,
      fragmentShader: THREE.ShaderChunk.meshphysical_frag,
    };
    m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.uSandStrength).toBe(m.uniforms.uSandStrength);
    expect(shader.vertexShader).toContain('attribute vec2 groundUv;');
    expect(shader.fragmentShader).toContain('diffuseColor.rgb *= rlAlbedo * rlMacro;');
    expect(shader.fragmentShader.indexOf('#include <color_fragment>')).toBeLessThan(
      shader.fragmentShader.indexOf('diffuseColor.rgb *= rlAlbedo * rlMacro;')
    );
    expect(m.customProgramCacheKey()).toBe('rl-ground');
  });
});

describe('GroveMaterial', () => {
  it('injects the wind offset into the vertex shader and exposes uTime', () => {
    const m = new GroveMaterial();
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderChunk.meshphysical_vert,
      fragmentShader: THREE.ShaderChunk.meshphysical_frag,
    };
    m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.uTime).toBe(m.uniforms.uTime);
    expect(shader.vertexShader).toContain('attribute float sway;');
    expect(shader.vertexShader).toContain('transformed += vec3(rlWind, 0.0, -rlWind);');
    expect(m.customProgramCacheKey()).toBe('rl-grove');
  });
});

describe('vertexColorMaterial', () => {
  it('is a lit vertex-coloured standard material', () => {
    const m = vertexColorMaterial();
    expect(m.isMeshStandardMaterial).toBe(true);
    expect(m.vertexColors).toBe(true);
  });
});

describe('the ground albedo tile', () => {
  it('starts at strength 0 with a valid sampler bound, so a missing image costs the palette tone nothing', () => {
    // Two separate hazards, and the strength uniform only covers one of them.
    // Sampling an UNBOUND `sampler2D` is undefined behaviour, and `NaN * 0`
    // is still `NaN` -- so the default has to be a real 1x1 texture as well
    // as a zero strength, or a map whose fetch failed could draw garbage
    // rather than flat ground.
    const m = new GroundMaterial();
    expect(m.uniforms.uSandStrength.value).toBe(0);
    expect(m.uniforms.uSand.value).toBeInstanceOf(THREE.Texture);
    expect(m.uniforms.uSand.value.image.width).toBe(1);
  });

  it('is applied as a RATIO to the tile mean, so open ground averages to its palette tone', () => {
    // Not a replacement for the vertex colour. `paletteTone * (texel / mean)`
    // keeps `tones.ts`'s composited relationship between road, cover and open
    // ground intact and lets the texture supply variation only -- and it
    // degrades to exactly 1.0 where the mask is 0 or the image is absent,
    // which is what makes terraces, walls, roads and every map with no relief
    // byte-identical.
    const src = compiled(new GroundMaterial()).fragmentShader;
    expect(src).toMatch(/texture2D\s*\(\s*uSand[^)]*\)\.rgb\s*\/\s*uSandMean/);
    // Weighted by the control map now, not switched by a `vSandMask`.
    expect(src).toMatch(/mix\s*\(\s*vec3\(1\.0\)\s*,\s*rlSand\s*,\s*uSandStrength\s*\)/);
    // The builder's own planar projection, NOT `vWorldPos.xz`: XZ is only
    // right for a horizontal surface, and an east-facing cliff has a constant
    // world X, so XZ would give every fragment on it the same U and smear one
    // column of the image down the whole face. See `MeshData.groundUv`.
    expect(src).toMatch(/vGroundUv\s*\/\s*uSandTiles/);
    expect(src).not.toMatch(/vWorldPos\.xz/);
  });

  it('applies the ROCK tile the same way, on its own mask, at its own scale', () => {
    const src = compiled(new GroundMaterial()).fragmentShader;
    expect(src).toMatch(/texture2D\s*\(\s*uRock[^)]*\)\.rgb\s*\/\s*uRockMean/);
    expect(src).toMatch(/mix\s*\(\s*vec3\(1\.0\)\s*,\s*rlRock\s*,\s*uRockStrength\s*\)/);
    expect(src).toMatch(/vGroundUv\s*\/\s*uRockTiles/);
    const m = new GroundMaterial();
    expect(m.uniforms.uRockStrength.value).toBe(0);
    expect(m.uniforms.uRock.value.image.width).toBe(1);
    // A ridge face is one to two levels tall; the rock repeat has to be
    // smaller than the sand's or a whole cliff shows a tenth of the image.
    expect(GROUND_ALBEDOS.rock_ground_tile.tiles).toBeLessThan(GROUND_ALBEDOS.desert_sand_tile.tiles);
  });

  it('separates sand from rock by warmth, which is why there are two images', () => {
    // The numbers themselves are checked against the shipped PNGs by
    // `tools/src/ground-albedo.test.ts`, which decodes them; what belongs
    // HERE is the relationship the two are for. Warm sand against cool
    // grey-tan rock is the whole reason a ridge gets its own texture.
    const sand = albedoMean('desert_sand_tile');
    const rock = albedoMean('rock_ground_tile');
    expect(sand.x - sand.z).toBeGreaterThan(rock.x - rock.z);
  });

  it('gives every slot all four uniforms, and no slot a per-vertex mask', () => {
    // The failure this exists to stop: a slot wired into `GROUND_SLOTS` (so
    // `ThreeRenderer` fetches its image and writes its uniforms) whose
    // uniforms or mask the shader never declares. Nothing throws -- the
    // write lands on an object three.js ignores, and the ground quietly
    // draws its flat palette tone forever.
    const m = new GroundMaterial();
    const { fragmentShader: frag, vertexShader: vert } = compiled(m);
    for (const slot of GROUND_SLOTS) {
      const u = slotUniforms(slot);
      for (const name of [u.map, u.strength, u.mean, u.tiles]) {
        expect(m.uniforms[name], `no uniform ${name} for slot ${slot}`).toBeDefined();
        expect(frag, `shader never reads ${name}`).toContain(name);
      }
      // Every slot starts OFF, so a map whose image never arrives draws the
      // palette tone rather than white or undefined.
      expect(m.uniforms[u.strength].value).toBe(0);
      expect(m.uniforms[u.map].value.image.width).toBe(1);
      // The control map says which surface a fragment is on -- the road too,
      // since Task 6 moved it to control B's distance field. A stale mask
      // still read here would be switching a surface the map also weights.
      const mask = `${slot}Mask`;
      const vMask = `v${slot.charAt(0).toUpperCase()}${slot.slice(1)}Mask`;
      expect(vert, `${mask} is still an attribute`).not.toContain(`attribute float ${mask};`);
      expect(frag, `shader still reads ${vMask}`).not.toContain(vMask);
    }
    expect(vert).not.toContain('attribute float roadMask;');
    expect(vert).not.toContain('attribute float roadAxis;');
  });

  it('every slot default names an image the albedo table knows', () => {
    // `mean` and `tiles` are overwritten at load time from `GROUND_ALBEDOS`;
    // these are only the values used before an image arrives. They still
    // have to BE one of the table's entries, or the pre-load default is a
    // number nobody measured.
    const m = new GroundMaterial();
    const known = Object.values(GROUND_ALBEDOS);
    for (const slot of GROUND_SLOTS) {
      const u = slotUniforms(slot);
      const tiles = m.uniforms[u.tiles].value as number;
      const mean = m.uniforms[u.mean].value as THREE.Vector3;
      expect(
        known.some(
          (a) =>
            a.tiles === tiles &&
            Math.abs(a.mean[0] / 255 - mean.x) < 1e-6 &&
            Math.abs(a.mean[1] / 255 - mean.y) < 1e-6 &&
            Math.abs(a.mean[2] / 255 - mean.z) < 1e-6
        ),
        `slot ${slot} defaults to a mean/tiles pair no GROUND_ALBEDOS entry has`
      ).toBe(true);
    }
  });

  it('defaults each slot to the image that slot actually draws', () => {
    // Stronger than "a pair the table has", and the reason is that the
    // defaults used to be written out one uniform at a time inside the
    // material and are a TABLE now (`DEFAULT_ALBEDO_FOR_SLOT`). A table is
    // exactly the shape a transcription slip hides in: rock defaulting to the
    // road's mean would still pass the test above, and would only show as a
    // colour cast on ridges during the fraction of a second before the image
    // arrives -- or permanently, on a map whose rock tile 404s.
    const m = new GroundMaterial();
    const expected: Record<string, keyof typeof GROUND_ALBEDOS> = {
      sand: 'desert_sand_tile',
      rock: 'rock_ground_tile',
      scrub: 'rough_scrub_tile',
      grove: 'orchard_floor_tile',
      knoll: 'knoll_scree_tile',
    };
    for (const slot of GROUND_SLOTS) {
      const u = slotUniforms(slot);
      const id = expected[slot];
      expect(m.uniforms[u.tiles].value, `slot ${slot} tiles`).toBe(GROUND_ALBEDOS[id].tiles);
      const mean = m.uniforms[u.mean].value as THREE.Vector3;
      expect(mean.equals(albedoMean(id)), `slot ${slot} mean is not ${id}'s`).toBe(true);
    }
  });

  it('gives each slot its OWN mean vector, never one shared object', () => {
    // Uniform values are mutable and `loadGroundTexture` writes them per slot.
    // Two slots sharing one `THREE.Vector3` would make the open-ground image's
    // arrival silently re-mean the rock as well.
    const m = new GroundMaterial();
    const seen = new Set<THREE.Vector3>();
    for (const slot of GROUND_SLOTS) seen.add(m.uniforms[slotUniforms(slot).mean].value as THREE.Vector3);
    expect(seen.size).toBe(GROUND_SLOTS.length);
  });

  it('applies every albedo as a MIX FROM 1.0, which is what keeps the average on-palette', () => {
    // The exemption's whole scope rests on one identity: the fragment is
    // `1 + g*(texel/mean - 1)`, whose average over the image is exactly 1 for
    // any gain `g`, because `mean(texel/mean)` is 1 by construction. That
    // holds ONLY for the mix-from-1.0 form. A shader that multiplied the
    // texel in directly (`base *= texel / mean * g`, say) would scale the
    // whole surface off the tone `tones.ts` composited -- and would still
    // look like ground, which is why this is asserted against the source
    // rather than left to the doc comment that derives it.
    const src = compiled(new GroundMaterial()).fragmentShader;
    for (const slot of GROUND_SLOTS) {
      const u = slotUniforms(slot);
      const cap = slot.charAt(0).toUpperCase() + slot.slice(1);
      // Every slot's weight comes from the control map, outside the mix.
      const pattern = new RegExp(
        `mix\\s*\\(\\s*vec3\\(1\\.0\\)\\s*,\\s*rl${cap}\\s*,\\s*${u.strength}\\s*\\)`
      );
      expect(src, `${slot} is not applied as a mix from vec3(1.0)`).toMatch(pattern);
      // ...and each is a ratio to its own measured mean, never the raw texel.
      expect(src, `${slot} does not divide by ${u.mean}`).toMatch(new RegExp(`/\\s*${u.mean}\\b`));
    }
  });

  it('fetches every slot exactly once -- the road no longer takes a second, axis-swapped tap', () => {
    // The old road was the one directional image, fetched twice and mixed by
    // a per-vertex axis. The distance field has no axis, so no slot may pay
    // for a second fetch of its own image any more.
    const src = compiled(new GroundMaterial()).fragmentShader;
    for (const slot of GROUND_SLOTS) {
      const stem = slotUniforms(slot).map;
      const own = src.split(`texture2D(${stem}, vGroundUv`).length - 1;
      expect(own, `${slot} fetches its own albedo more than once`).toBe(1);
    }
  });

  it('anchors the road to the tile, which needs a repeat of exactly one', () => {
    // The source is one track with gravel shoulders, centred at 0.492 of the
    // image width -- not a field of road. World tile boundaries are integers,
    // so a repeat of 1 world unit is the only value that puts the lane down
    // each road tile's own centre. Anything else and a road tile shows
    // whichever slice of a track its world position happens to land on.
    expect(GROUND_ALBEDOS.road_track_tile.tiles).toBe(1);
  });

  it('prepareGroundTexture forces NoColorSpace and plain repeat wrapping', () => {
    // NoColorSpace even though every OTHER map in this renderer is sRGB now
    // (`world-materials.ts`'s `prepareTexturedMap`, the reverse call). This
    // one is not a colour: the blend divides each texel by the image's own
    // mean, `GROUND_ALBEDOS` measures that mean in raw file BYTES, and the
    // ratio is only 1-on-average if both sides are in the same space. Tag it
    // sRGB and the GPU decodes the texel while the divisor stays a byte, which
    // drags the whole surface off the tone `tones.ts` composited and still
    // looks like ground. And the wrap must be REPEAT, not mirrored: the source
    // is seamless (edge deltas 14.6/15.9 against an adjacent-column baseline
    // of 14.2), and mirroring a seamless tile draws a kaleidoscope diamond at
    // every junction.
    const tex = prepareGroundTexture(new THREE.Texture());
    expect(tex.colorSpace).toBe(THREE.NoColorSpace);
    expect(tex.wrapS).toBe(THREE.RepeatWrapping);
    expect(tex.wrapT).toBe(THREE.RepeatWrapping);
    expect(tex.wrapS).not.toBe(THREE.MirroredRepeatWrapping);
    expect(tex.generateMipmaps).toBe(true);
  });
});

describe('toGeometry', () => {
  const base: MeshData = {
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 1, 0, 1]),
    colors: Float32Array.from([1, 1, 1, 1, 1, 1, 1, 1, 1]),
    indices: Uint32Array.from([0, 1, 2]),
  };

  it('uploads a default up normal when the builder computed none, and the authored one when it did', () => {
    // Every geometry gets a `normal` attribute now (see `GeometryOptions` in
    // mesh.ts): ground/scatter/residual/building-decor with no normals of
    // their own get an up-fill default, and only `buildGround`'s own
    // analytic normals (or an explicit `{ normals: 'compute' }`) differ from
    // that -- see the "toGeometry colour space and normals" suite below for
    // the compute case.
    const def = toGeometry(base).getAttribute('normal');
    expect(def).toBeDefined();
    expect(def.count).toBe(3);
    expect([def.getX(0), def.getY(0), def.getZ(0)]).toEqual([0, 1, 0]);
    const withNormals = toGeometry({ ...base, normals: Float32Array.from([0, 1, 0, 0, 1, 0, 0, 1, 0]) });
    expect(withNormals.getAttribute('normal')).toBeDefined();
    expect(withNormals.getAttribute('normal').count).toBe(3);
  });

  it('uploads the wall-albedo attribute when the builder computed one, and none when it did not', () => {
    // The one per-vertex albedo fact left after Task 7 retired the seven
    // masks this suite used to pin here (`sandMask`/`rockMask` among them) --
    // `wallAlbedo -- the one per-vertex surface fact left (R-5)` above is
    // where that attribute's own upload is pinned in full; this is only the
    // present/absent shape every optional `MeshData` field shares.
    expect(toGeometry(base).getAttribute('wallAlbedo')).toBeUndefined();
    const walled = toGeometry({ ...base, wallAlbedo: Float32Array.from([1, 1, 0]) });
    expect(walled.getAttribute('wallAlbedo').count).toBe(3);
    expect(walled.getAttribute('wallAlbedo').itemSize).toBe(1);
  });

  it('uploads the albedo UVs when present, and none when absent', () => {
    expect(toGeometry(base).getAttribute('groundUv')).toBeUndefined();
    const full = toGeometry({
      ...base,
      groundUv: Float32Array.from([0, 0, 1, 0, 1, 1]),
    });
    expect(full.getAttribute('groundUv').itemSize).toBe(2);
    // Deliberately NOT three.js's reserved `uv` name -- see toGeometry.
    expect(full.getAttribute('uv')).toBeUndefined();
  });
});

describe('toGeometry colour space and normals', () => {
  const data = (): MeshData => ({
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0, 1]),
    colors: Float32Array.from([200 / 255, 180 / 255, 148 / 255, 1, 1, 1, 0, 0, 0]),
    indices: Uint32Array.from([0, 1, 2]),
  });
  it('writes LINEAR vertex colours from the builders sRGB bytes and no litColor', () => {
    const g = toGeometry(data());
    const c = g.getAttribute('color');
    expect(c.getX(0)).toBeCloseTo(srgbToLinear(200 / 255), 6);
    expect(c.getX(1)).toBeCloseTo(1, 6);
    expect(c.getX(2)).toBe(0);
    expect(g.getAttribute('litColor')).toBeUndefined();
  });
  it('gives a normal-less mark an up normal by default', () => {
    const n = toGeometry(data()).getAttribute('normal');
    expect(n.count).toBe(3);
    expect([n.getX(0), n.getY(0), n.getZ(0)]).toEqual([0, 1, 0]);
  });
  it('computes face normals on request', () => {
    const n = toGeometry(data(), { normals: 'compute' }).getAttribute('normal');
    // The triangle (0,0,0)-(1,0,0)-(0,0,1) lies in the XZ plane: its normal is +/-Y.
    expect(Math.abs(n.getY(0))).toBeCloseTo(1, 6);
  });
  it('keeps authored normals verbatim', () => {
    const d = data();
    d.normals = Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const n = toGeometry(d, { normals: 'compute' }).getAttribute('normal');
    expect(n.getZ(0)).toBe(1);
  });
});

describe('GroundMaterial debug toggles -- ground-albedo and macro', () => {
  it('ground-albedo hides the five slots and NOT the macro, because a 404 leaves the macro on', () => {
    // The `ground-albedo` check measures "the texture never arrived". A real
    // 404 leaves the macro field on, so a hide that also removed the macro
    // would credit the macro's contribution to the tiles -- and keep that
    // check passing on a texture that never arrives.
    const m = new GroundMaterial();
    m.uniforms.uSandStrength.value = 1;
    expect(m.setAlbedoVisible(false)).toBe(GROUND_SLOTS.length);
    for (const slot of GROUND_SLOTS) expect(m.uniforms[slotUniforms(slot).strength].value).toBe(0);
    expect(m.uniforms.uMacroAmp.value).toBe(1);
    // Idempotent: a second hide must not stash the zeroes.
    m.setAlbedoVisible(false);
    m.setAlbedoVisible(true);
    expect(m.uniforms.uSandStrength.value).toBe(1);
  });
  it('macro hides the amplitude alone, idempotently, and restores it', () => {
    // Hidden together with ground-albedo it is the flat palette tone the
    // scatter tone check flattens to: scatter marks carry no macro.
    const m = new GroundMaterial();
    m.uniforms.uSandStrength.value = 1;
    expect(m.setMacroVisible(false)).toBe(1);
    expect(m.uniforms.uMacroAmp.value).toBe(0);
    expect(m.uniforms.uSandStrength.value).toBe(1);
    expect(m.setMacroVisible(false), 'a second hide changes nothing').toBe(0);
    expect(m.setMacroVisible(true)).toBe(1);
    expect(m.uniforms.uMacroAmp.value).toBe(1);
    expect(m.setMacroVisible(true)).toBe(0);
  });
});
