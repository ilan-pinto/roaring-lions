/**
 * `groundSurfaceMaterial`'s contract, asserted against the shader source and
 * the uniforms rather than against a rendered pixel -- the same way
 * `campaign/world-material.test.ts` pins the diorama's, and for the same
 * reason: this suite runs under `environment: 'node'` with no GL context,
 * and the two properties that matter here are both structural.
 *
 * The shade term is the FOURTH named exemption from `data/palette.json`
 * (`surface.ts`, `SURFACE_SHADING_EXEMPTION`). What keeps it narrow is not
 * the comment on it, it is these two facts:
 *
 *  1. It is written as a DEPARTURE from a level surface, so an up normal
 *     gives exactly 1.0 and everything carrying one -- every terrace top,
 *     every wall, every tile of the four maps with no relief -- emits the
 *     same palette bytes it always did.
 *  2. It is smooth, never banded, so it cannot draw the contour terraces
 *     this whole change exists to remove.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  groundSurfaceMaterial,
  terrainMaterial,
  toGeometry,
  GROUND_LIGHT_DIR,
  GROUND_RELIEF_STRENGTH,
  GROUND_SHADE_FLOOR,
  GROUND_SHADE_CEIL,
  GROUND_ALBEDOS,
  GROUND_SLOTS,
  albedoMean,
  slotUniforms,
  prepareGroundTexture,
} from './mesh';
import type { MeshData } from './types';

/** The shade term, evaluated in TypeScript exactly as the fragment shader
 *  writes it. Not an approximation of the shader: the same three lines, so a
 *  change to the shader that this file does not mirror shows up as a failing
 *  assertion below rather than as a silently different picture. */
function shade(nx: number, ny: number, nz: number): number {
  const L = GROUND_LIGHT_DIR;
  const len = Math.hypot(nx, ny, nz);
  const rel = (nx / len) * L.x + (ny / len) * L.y + (nz / len) * L.z - (0 * L.x + 1 * L.y + 0 * L.z);
  return Math.min(GROUND_SHADE_CEIL, Math.max(GROUND_SHADE_FLOOR, 1 + GROUND_RELIEF_STRENGTH * rel));
}

describe('groundSurfaceMaterial', () => {
  it('is EXACTLY 1.0 at an up normal -- flat ground, terrace tops and walls keep their palette bytes', () => {
    // Not `toBeCloseTo`. The whole reason the term is `1 + R * (N.L - up.L)`
    // rather than the campaign board's `1 - S * (1 - N.L)` is that this
    // subtraction is of one expression from itself when the normal is up, so
    // the difference is exactly zero and the multiplier exactly one. The
    // board's form would have darkened every flat map in the game by
    // `0.136 * S` for no reason -- and every flat map is three of the four
    // gated golden scenarios.
    expect(shade(0, 1, 0)).toBe(1);
  });

  it('darkens a slope turned away from the sun and lifts one turned toward it', () => {
    const away = shade(-0.5, 1, -0.5);
    const toward = shade(0.5, 1, 0.3);
    expect(away).toBeLessThan(1);
    expect(toward).toBeGreaterThan(1);
    // Asymmetric, and physically so: the sun sits 59.8 degrees up, so a tilt
    // can only take much away. Stated as a property because a symmetric
    // result would mean the light had been flattened toward the horizon.
    expect(1 - away).toBeGreaterThan(toward - 1);
  });

  it('never leaves [FLOOR, CEIL], so a wall-steep patch cannot go to mud or to white', () => {
    for (let i = 0; i < 2000; i++) {
      const a = (i / 2000) * Math.PI * 2;
      const b = ((i * 7) / 2000) * Math.PI;
      const s = shade(Math.cos(a) * Math.sin(b), Math.abs(Math.cos(b)) + 1e-3, Math.sin(a) * Math.sin(b));
      expect(s).toBeGreaterThanOrEqual(GROUND_SHADE_FLOOR);
      expect(s).toBeLessThanOrEqual(GROUND_SHADE_CEIL);
    }
  });

  it('does not band the shade -- this is a heightfield, not a building facet', () => {
    // `texturedBuildingMaterial` quantises into hard steps because a building
    // is flat-faced and the bands land on real edges. Three hard bands across
    // a hillside draw contour terraces that are not in the heightfield --
    // which is the defect this material exists to remove, reintroduced by a
    // different route. Same call `campaign/world-material.test.ts` makes for
    // the diorama.
    const src = groundSurfaceMaterial().fragmentShader;
    expect(src).not.toMatch(/floor\s*\(/);
    expect(src).not.toMatch(/uSteps|SHADE_STEPS/);
    expect(src).toMatch(/clamp\s*\(\s*1\.0\s*\+\s*uRelief/);
  });

  it('reads the WORLD normal with no normalMatrix -- buildGround already writes world normals', () => {
    const vert = groundSurfaceMaterial().vertexShader;
    expect(vert).toMatch(/vWorldNormal\s*=\s*normal\s*;/);
    expect(vert).not.toMatch(/normalMatrix/);
  });

  it('is DoubleSide, because a heightfield patch can legitimately turn away from this camera', () => {
    // Measured: the steepest open ground on `qarn_hadid` is 3.75 levels per
    // tile and on `tel_marum` 4.01, against a back-facing threshold of about
    // 3.2 -- and the closest triangle on a shipped map clears it by a dot
    // product of 0.00001. Under FrontSide that is one authored tile away from
    // a HOLE in the map.
    expect(groundSurfaceMaterial().side).toBe(THREE.DoubleSide);
  });

  it('leaves terrainMaterial alone -- the exemption is the ground surface and nothing else', () => {
    // Scatter marks, groves, the residual layer and every building box still
    // draw through the unlit vertex-colour pass-through. If this material
    // ever grew a normal or a shade term, the palette exemption would have
    // silently widened to most of the frame.
    const src = terrainMaterial() as THREE.ShaderMaterial;
    expect(src.fragmentShader).not.toMatch(/uLightDir|uRelief|shade/);
    expect(src.vertexShader).not.toMatch(/normal/);
    expect(src.side).toBe(THREE.FrontSide);
  });
});

describe('the ground albedo tile', () => {
  it('starts at strength 0 with a valid sampler bound, so a missing image costs the palette tone nothing', () => {
    // Two separate hazards, and the strength uniform only covers one of them.
    // Sampling an UNBOUND `sampler2D` is undefined behaviour, and `NaN * 0`
    // is still `NaN` -- so the default has to be a real 1x1 texture as well
    // as a zero strength, or a map whose fetch failed could draw garbage
    // rather than flat ground.
    const m = groundSurfaceMaterial();
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
    const src = groundSurfaceMaterial().fragmentShader;
    expect(src).toMatch(/texture2D\s*\(\s*uSand[^)]*\)\.rgb\s*\/\s*uSandMean/);
    expect(src).toMatch(/mix\s*\(\s*vec3\(1\.0\)\s*,\s*sand\s*,\s*uSandStrength\s*\*\s*vSandMask\s*\)/);
    // The builder's own planar projection, NOT `vWorldPos.xz`: XZ is only
    // right for a horizontal surface, and an east-facing cliff has a constant
    // world X, so XZ would give every fragment on it the same U and smear one
    // column of the image down the whole face. See `MeshData.groundUv`.
    expect(src).toMatch(/vGroundUv\s*\/\s*uSandTiles/);
    expect(src).not.toMatch(/vWorldPos\.xz/);
  });

  it('applies the ROCK tile the same way, on its own mask, at its own scale', () => {
    const src = groundSurfaceMaterial().fragmentShader;
    expect(src).toMatch(/texture2D\s*\(\s*uRock[^)]*\)\.rgb\s*\/\s*uRockMean/);
    expect(src).toMatch(/mix\s*\(\s*vec3\(1\.0\)\s*,\s*rock\s*,\s*uRockStrength\s*\*\s*vRockMask\s*\)/);
    expect(src).toMatch(/vGroundUv\s*\/\s*uRockTiles/);
    const m = groundSurfaceMaterial();
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
    const m = groundSurfaceMaterial();
    const frag = m.fragmentShader;
    const vert = m.vertexShader;
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
    const m = groundSurfaceMaterial();
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

  it('applies every albedo as a MIX FROM 1.0, which is what keeps the average on-palette', () => {
    // The exemption's whole scope rests on one identity: the fragment is
    // `1 + g*(texel/mean - 1)`, whose average over the image is exactly 1 for
    // any gain `g`, because `mean(texel/mean)` is 1 by construction. That
    // holds ONLY for the mix-from-1.0 form. A shader that multiplied the
    // texel in directly (`base *= texel / mean * g`, say) would scale the
    // whole surface off the tone `tones.ts` composited -- and would still
    // look like ground, which is why this is asserted against the source
    // rather than left to the doc comment that derives it.
    const src = groundSurfaceMaterial().fragmentShader;
    for (const slot of GROUND_SLOTS) {
      const u = slotUniforms(slot);
      const cap = slot.charAt(0).toUpperCase() + slot.slice(1);
      const pattern = new RegExp(
        `mix\\s*\\(\\s*vec3\\(1\\.0\\)\\s*,\\s*${slot}\\s*,\\s*${u.strength}\\s*\\*\\s*v${cap}Mask\\s*\\)`
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
    const src = groundSurfaceMaterial().fragmentShader;
    expect(src).toMatch(/mix\s*\(\s*texture2D\s*\(\s*uRoad\s*,\s*roadUv\s*\)\.rgb\s*,/);
    expect(src).toMatch(/texture2D\s*\(\s*uRoad\s*,\s*roadUv\.yx\s*\)\.rgb\s*,\s*vRoadAxis\s*\)/);
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
    // `TextureLoader` stamps `SRGBColorSpace` on a colour map and this
    // renderer's output is pass-through, so an sRGB internal format decodes
    // on every sample with nothing to re-encode it -- measured elsewhere in
    // this tree as a lit wall dropping from rgb 67 to 51 while still looking
    // like a building. And the wrap must be REPEAT, not mirrored: the source
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

  it('uploads a normal attribute when the builder computed one, and none when it did not', () => {
    // Only `buildGround` computes normals; every other terrain sub-mesh draws
    // through a material that declares none. Uploading a default would be a
    // lie about geometry that has no meaningful normal.
    expect(toGeometry(base).getAttribute('normal')).toBeUndefined();
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
