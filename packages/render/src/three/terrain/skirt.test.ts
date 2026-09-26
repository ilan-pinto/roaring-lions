import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  buildSkirt,
  disposeSkirt,
  setSkirtAlbedo,
  skirtBounds,
  skirtRing,
  SKIRT_TONE,
  SKIRT_Y,
} from './skirt';
import { WORLD_RENDER_ORDER } from '../units/render-order';
import { MARK_EPSILON, WORLD_PER_LEVEL } from './shared';
import { albedoMean, GROUND_ALBEDOS } from './mesh';

describe('buildSkirt', () => {
  it('spans three maps in each axis, centred on the map', () => {
    const b = skirtBounds(48, 40);
    expect(b.x0).toBe(-48);
    expect(b.x1).toBe(96);
    expect(b.z0).toBe(-40);
    expect(b.z1).toBe(80);
    // One full map of margin on every side -- the property that decides
    // whether the frame's corners are covered at minimum zoom, and the one
    // an off-by-one in the margin arithmetic would silently halve.
    expect(b.x1 - b.x0).toBe(48 * 3);
    expect(b.z1 - b.z0).toBe(40 * 3);
    expect((b.x0 + b.x1) / 2).toBe(24);
    expect((b.z0 + b.z1) / 2).toBe(20);
  });

  it('is a flat, up-facing ring just BELOW the map base level', () => {
    const mesh = buildSkirt(12, 8);
    const pos = mesh.geometry.getAttribute('position');
    // Eight vertices -- the outer rectangle then the map's own footprint
    // (G5, `skirtRing`) -- not the four of the old one-rectangle quad.
    expect(pos.count).toBe(8);
    // `toBeCloseTo`, not `toBe`: the attribute is a Float32Array and
    // -0.01 has no exact single-precision representation.
    for (let i = 0; i < pos.count; i++) expect(pos.getY(i)).toBeCloseTo(SKIRT_Y, 7);
    // Strictly below base level, or a flat map's terrain -- which is at
    // exactly y = 0 -- z-fights the skirt across the whole playable area.
    // And by no more than the repo's own mark epsilon, so the step at the
    // map edge is under 4% of one terrace.
    expect(SKIRT_Y).toBeLessThan(0);
    expect(Math.abs(SKIRT_Y)).toBe(MARK_EPSILON);
    expect(Math.abs(SKIRT_Y)).toBeLessThan(WORLD_PER_LEVEL * 0.04);
    // Up-facing on every one of the ring's eight triangles, computed from the
    // INDEXED triangles rather than read off the `normal` attribute -- a
    // correct attribute over a back-facing winding would otherwise pass here
    // and draw nothing on screen under `FrontSide` culling. This assertion
    // caught exactly that on the old single rectangle: the obvious
    // (0,1,2)/(0,2,3) fan over its perimeter faces the GROUND, because
    // `pushPolygon`'s unflipped fan is `(0, i+1, i)`.
    const idx = mesh.geometry.getIndex();
    expect(idx).not.toBeNull();
    expect(idx!.count).toBe(24);
    const p = (i: number): THREE.Vector3 =>
      new THREE.Vector3().fromBufferAttribute(pos, idx!.getX(i));
    for (let t = 0; t < idx!.count / 3; t++) {
      const a = p(t * 3);
      const b = p(t * 3 + 1);
      const c = p(t * 3 + 2);
      const face = new THREE.Vector3()
        .subVectors(b, a)
        .cross(new THREE.Vector3().subVectors(c, a))
        .normalize();
      expect(face.y, `triangle ${t}`).toBeGreaterThan(0);
    }
    for (let i = 0; i < pos.count; i++) expect(mesh.geometry.getAttribute('normal').getY(i)).toBe(1);
    disposeSkirt(mesh);
  });

  it('draws in the world band, takes no shadow and casts none', () => {
    const mesh = buildSkirt(12, 8);
    expect(mesh.renderOrder).toBe(WORLD_RENDER_ORDER);
    // The sun's shadow box is fitted to the MAP (`../lighting.ts`), so two
    // thirds of this quad is outside it in every direction.
    expect(mesh.receiveShadow).toBe(false);
    expect(mesh.castShadow).toBe(false);
    // Opaque, depth-writing world geometry -- which is also what keeps it in
    // the AO pass's G-buffer (`post-chain.ts`'s `isAoOccluder`) rather than
    // being filtered out of it as an overlay.
    expect(mesh.material.depthWrite).toBe(true);
    expect(mesh.material.transparent).toBe(false);
    expect(mesh.geometry.getAttribute('normal')).toBeDefined();
    disposeSkirt(mesh);
  });

  it('draws flat SKIRT_TONE before the albedo lands -- the 404 path', () => {
    const mesh = buildSkirt(12, 8);
    expect(mesh.material.map).toBeNull();
    expect(mesh.material.color.r).toBeCloseTo(SKIRT_TONE.r, 6);
    expect(mesh.material.color.g).toBeCloseTo(SKIRT_TONE.g, 6);
    expect(mesh.material.color.b).toBeCloseTo(SKIRT_TONE.b, 6);
    disposeSkirt(mesh);
  });
});

describe('setSkirtAlbedo', () => {
  it('applies the sand image as a RATIO, so the quad still averages to SKIRT_TONE', () => {
    const mesh = buildSkirt(12, 8);
    const mean = albedoMean('desert_sand_tile');
    setSkirtAlbedo(mesh, new THREE.Texture(), mean, GROUND_ALBEDOS.desert_sand_tile.tiles);
    expect(mesh.material.map).not.toBeNull();
    // `color * mean` is what the fragment averages to, because the image's
    // own average texel IS its mean and nothing decodes it (`NoColorSpace`).
    // Binding the texture as a plain `map` at a grey multiplier instead
    // would leave this product at the photograph's own saturated sand hue --
    // darker, but not desaturated, and the map edge would still read as a
    // tone change. These three are the whole difference.
    expect(mesh.material.color.r * mean.x).toBeCloseTo(SKIRT_TONE.r, 6);
    expect(mesh.material.color.g * mean.y).toBeCloseTo(SKIRT_TONE.g, 6);
    expect(mesh.material.color.b * mean.z).toBeCloseTo(SKIRT_TONE.b, 6);
    // ...and the result really is a warm GREY: the ground's own sand is far
    // more saturated than this, which is the visible property the number is
    // chosen for.
    const tone = new THREE.Color(SKIRT_TONE.r, SKIRT_TONE.g, SKIRT_TONE.b);
    const sand = new THREE.Color(mean.x, mean.y, mean.z);
    expect(tone.getHSL({ h: 0, s: 0, l: 0 }).s).toBeLessThan(
      sand.getHSL({ h: 0, s: 0, l: 0 }).s / 3
    );
    disposeSkirt(mesh);
  });

  it('carries the ground shader’s own world-space repeat, so the seam lines up', () => {
    const mesh = buildSkirt(12, 8);
    const tiles = GROUND_ALBEDOS.desert_sand_tile.tiles;
    setSkirtAlbedo(mesh, new THREE.Texture(), albedoMean('desert_sand_tile'), tiles);
    const pos = mesh.geometry.getAttribute('position');
    const uv = mesh.geometry.getAttribute('uv');
    expect(uv.count).toBe(pos.count);
    // The ground samples `vGroundUv / uSandTiles` with `vGroundUv` the
    // vertex's own world `(x, z)` (`ground.ts`'s `pushQuad`). Anything else
    // here puts a visible discontinuity in the sand exactly at the map edge,
    // which is the one place this whole task is trying to hide.
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i)).toBeCloseTo(pos.getX(i) / tiles, 6);
      expect(uv.getY(i)).toBeCloseTo(pos.getZ(i) / tiles, 6);
    }
    // The shared texture object is left alone -- the ground material samples
    // the SAME `THREE.Texture`, and a repeat written onto it to serve the
    // skirt would be a coupling nothing here would catch breaking.
    expect(mesh.material.map?.repeat.x).toBe(1);
    expect(mesh.material.map?.repeat.y).toBe(1);
    disposeSkirt(mesh);
  });
});

describe('skirtRing -- G5', () => {
  const tri = (r: ReturnType<typeof skirtRing>, t: number): THREE.Vector3[] =>
    [0, 1, 2].map((k) => {
      const i = r.indices[t * 3 + k];
      return new THREE.Vector3(r.positions[i * 3], r.positions[i * 3 + 1], r.positions[i * 3 + 2]);
    });

  // Catmull-Rom undershoots to -0.077 on tel_marum (spec G5), well below the
  // skirt's -0.01. So no skirt triangle may cover ANY point of the footprint:
  // that is the whole fix.
  it('covers no point strictly inside the map footprint', () => {
    const r = skirtRing(48, 40);
    for (let t = 0; t < r.indices.length / 3; t++) {
      const [a, b, c] = tri(r, t);
      const cx = (a.x + b.x + c.x) / 3;
      const cz = (a.z + b.z + c.z) / 3;
      const inside = cx > 0 && cx < 48 && cz > 0 && cz < 40;
      expect(inside, `triangle ${t} centroid (${cx}, ${cz})`).toBe(false);
    }
  });

  it('still covers the whole margin: ring area = outer - footprint', () => {
    const r = skirtRing(48, 40);
    let area = 0;
    for (let t = 0; t < r.indices.length / 3; t++) {
      const [a, b, c] = tri(r, t);
      area += Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
    }
    const { x0, x1, z0, z1 } = skirtBounds(48, 40);
    expect(area).toBeCloseTo((x1 - x0) * (z1 - z0) - 48 * 40, 6);
  });

  it('faces up on every triangle (FrontSide culling draws nothing otherwise)', () => {
    const r = skirtRing(12, 8);
    for (let t = 0; t < r.indices.length / 3; t++) {
      const [a, b, c] = tri(r, t);
      const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      expect(n.y, `triangle ${t}`).toBeGreaterThan(0);
    }
  });

  it('is what buildSkirt draws', () => {
    const mesh = buildSkirt(12, 8);
    expect(mesh.geometry.getAttribute('position').count).toBe(8);
    expect(mesh.geometry.getIndex()?.count).toBe(24);
    disposeSkirt(mesh);
  });
});
