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
} from './mesh';
import { srgbToLinear } from './shared';
import type { MeshData } from './types';

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

describe('GroundMaterial', () => {
  it('is a lit, vertex-coloured, double-sided standard material with the six albedo slots as uniforms', () => {
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
    expect(shader.fragmentShader).toContain('diffuseColor.rgb *= rlAlbedo;');
    expect(shader.fragmentShader.indexOf('#include <color_fragment>')).toBeLessThan(
      shader.fragmentShader.indexOf('diffuseColor.rgb *= rlAlbedo;')
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
    expect(src).toMatch(/mix\s*\(\s*vec3\(1\.0\)\s*,\s*rlSand\s*,\s*uSandStrength\s*\*\s*vSandMask\s*\)/);
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
    expect(src).toMatch(/mix\s*\(\s*vec3\(1\.0\)\s*,\s*rlRock\s*,\s*uRockStrength\s*\*\s*vRockMask\s*\)/);
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

  it('gives every slot all four uniforms and a mask the shader actually reads', () => {
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
      const mask = `${slot}Mask`;
      expect(vert, `no ${mask} attribute`).toContain(`attribute float ${mask};`);
      expect(frag, `shader never reads v${slot.charAt(0).toUpperCase()}${slot.slice(1)}Mask`).toContain(
        `v${slot.charAt(0).toUpperCase()}${slot.slice(1)}Mask`
      );
    }
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
      road: 'road_track_tile',
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
      const pattern = new RegExp(
        `mix\\s*\\(\\s*vec3\\(1\\.0\\)\\s*,\\s*rl${cap}\\s*,\\s*${u.strength}\\s*\\*\\s*v${cap}Mask\\s*\\)`
      );
      expect(src, `${slot} is not applied as a mix from vec3(1.0)`).toMatch(pattern);
      // ...and each is a ratio to its own measured mean, never the raw texel.
      expect(src, `${slot} does not divide by ${u.mean}`).toMatch(new RegExp(`/\\s*${u.mean}\\b`));
    }
  });

  it('blends the road between two samples, and only the road', () => {
    // The road is the one slot whose image is directional -- a single wheel
    // track -- so it is the one slot that fetches twice and mixes by an
    // axis. If that mix ever disappears, every junction on every map goes
    // back to being a road that runs one way and stops.
    const src = compiled(new GroundMaterial()).fragmentShader;
    expect(src).toMatch(/mix\s*\(\s*texture2D\s*\(\s*uRoad\s*,\s*rlRoadUv\s*\)\.rgb\s*,/);
    expect(src).toMatch(/texture2D\s*\(\s*uRoad\s*,\s*rlRoadUv\.yx\s*\)\.rgb\s*,\s*vRoadAxis\s*\)/);
    // ...and no other slot does, which is what keeps the extra tap paid for
    // once rather than five times.
    for (const slot of GROUND_SLOTS) {
      if (slot === 'road') continue;
      const stem = slotUniforms(slot).map;
      expect(src.split(`texture2D(${stem},`).length - 1, `${slot} fetches more than once`).toBe(1);
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

  it('uploads the sand mask when the builder computed one, and none when it did not', () => {
    expect(toGeometry(base).getAttribute('sandMask')).toBeUndefined();
    const masked = toGeometry({ ...base, sandMask: Float32Array.from([1, 1, 0]) });
    expect(masked.getAttribute('sandMask').count).toBe(3);
    expect(masked.getAttribute('sandMask').itemSize).toBe(1);
  });

  it('uploads the rock mask and the albedo UVs when present, and none when absent', () => {
    expect(toGeometry(base).getAttribute('rockMask')).toBeUndefined();
    expect(toGeometry(base).getAttribute('groundUv')).toBeUndefined();
    const full = toGeometry({
      ...base,
      rockMask: Float32Array.from([0, 1, 1]),
      groundUv: Float32Array.from([0, 0, 1, 0, 1, 1]),
    });
    expect(full.getAttribute('rockMask').count).toBe(3);
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
