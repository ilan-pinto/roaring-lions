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
  GROUND_TEXTURE_MEAN,
  GROUND_TEXTURE_TILES,
  ROCK_TEXTURE_MEAN,
  ROCK_TEXTURE_TILES,
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
    expect(ROCK_TEXTURE_TILES).toBeLessThan(GROUND_TEXTURE_TILES);
  });

  it("the rock mean is the image's own, measured", () => {
    expect(ROCK_TEXTURE_MEAN.x * 255).toBeCloseTo(152.9, 1);
    expect(ROCK_TEXTURE_MEAN.y * 255).toBeCloseTo(141.2, 1);
    expect(ROCK_TEXTURE_MEAN.z * 255).toBeCloseTo(125.2, 1);
    // The two materials have to separate at a glance -- warm sand against
    // cool grey-tan rock is the whole reason a second texture exists.
    expect(GROUND_TEXTURE_MEAN.x - GROUND_TEXTURE_MEAN.z).toBeGreaterThan(
      ROCK_TEXTURE_MEAN.x - ROCK_TEXTURE_MEAN.z
    );
  });

  it("the mean is the image's own, measured -- not a guess that would tint every map", () => {
    // If this drifts from `assets/textures/desert_sand_tile.png`'s real mean,
    // open ground stops averaging to its palette tone and the whole map takes
    // a colour cast that still looks like sand.
    expect(GROUND_TEXTURE_MEAN.x * 255).toBeCloseTo(203.5, 1);
    expect(GROUND_TEXTURE_MEAN.y * 255).toBeCloseTo(166.6, 1);
    expect(GROUND_TEXTURE_MEAN.z * 255).toBeCloseTo(110.7, 1);
    expect(GROUND_TEXTURE_TILES).toBeGreaterThan(0);
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
