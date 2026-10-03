import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { fx } from '@lions/sim';
import {
  applyBuildingDamageBand,
  buildingDamageBand,
  BuildingScarMaterials,
  BURN_BAND_MAX,
  isBurningBand,
  SCAR_BAND_MAX,
  SCAR_MIX,
  scarMixForBand,
  scarredMaterial,
} from './building-damage';
import { CHARRED_TINT_HEX, liftTone } from '../world-materials';
import { CHARRED_RAMP } from './vehicle-mesh-role';

const texturedBase = (): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ map: new THREE.Texture(), color: 0xffffff, roughness: 0.6 });
const paletteBase = (): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color: 0xc8b494, roughness: 0.6 });

describe('the band table', () => {
  it('is the overlay log and billboard wear step\'s own eighths', () => {
    // `structureHpBand` ceil-rounds: 1 hp of 800 is band 1, not 0; 0 is dead.
    expect(buildingDamageBand(fx.fromInt(800), fx.fromInt(800))).toBe(8);
    expect(buildingDamageBand(fx.fromInt(1), fx.fromInt(800))).toBe(1);
    expect(buildingDamageBand(0, fx.fromInt(800))).toBe(0);
    expect(buildingDamageBand(fx.fromInt(300), fx.fromInt(800))).toBe(3);
  });

  it('leaves bands 8-6 clean and scars 5-1 by (1 - band/8) x SCAR_MIX', () => {
    for (const band of [8, 7, 6]) expect(scarMixForBand(band)).toBe(0);
    expect(SCAR_BAND_MAX).toBe(5);
    // The plan's own worked example: band 3 sits ~0.38 of the way to the wreck.
    expect(scarMixForBand(3)).toBeCloseTo(0.375, 6);
    expect(scarMixForBand(5)).toBeCloseTo((1 - 5 / 8) * SCAR_MIX, 6);
    expect(scarMixForBand(1)).toBeCloseTo((1 - 1 / 8) * SCAR_MIX, 6);
    // Monotone: a lower band is never cleaner than a higher one.
    for (let band = 5; band > 1; band--) {
      expect(scarMixForBand(band - 1)).toBeGreaterThan(scarMixForBand(band));
    }
    // Band 0 is the wreck's own clone; the table has no answer for it.
    expect(scarMixForBand(0)).toBe(0);
  });

  it('burns on bands 1-2 only', () => {
    expect(BURN_BAND_MAX).toBe(2);
    expect([8, 7, 6, 5, 4, 3, 0].some(isBurningBand)).toBe(false);
    expect(isBurningBand(2)).toBe(true);
    expect(isBurningBand(1)).toBe(true);
  });
});

describe('scarredMaterial', () => {
  it('tints a textured bake toward CHARRED_TINT_HEX and keeps its map by reference', () => {
    const base = texturedBase();
    const scarred = scarredMaterial(base, 3);
    const tint = new THREE.Color(CHARRED_TINT_HEX);
    const expected = new THREE.Color(0xffffff).lerp(tint, scarMixForBand(3));
    expect(scarred.color.getHex()).toBe(expected.getHex());
    expect(scarred.map).toBe(base.map);
    expect(scarred).not.toBe(base);
    // The base is untouched -- it is shared by every clone of the type.
    expect(base.color.getHex()).toBe(0xffffff);
    expect(base.roughness).toBe(0.6);
  });

  it('lerps a palette material toward the charred ramp\'s lit tone instead', () => {
    const base = paletteBase();
    const scarred = scarredMaterial(base, 1);
    const expected = new THREE.Color(0xc8b494).lerp(new THREE.Color(liftTone(CHARRED_RAMP)), scarMixForBand(1));
    expect(scarred.color.getHex()).toBe(expected.getHex());
  });

  it('drives roughness toward 1 by the same mix', () => {
    const scarred = scarredMaterial(texturedBase(), 2);
    expect(scarred.roughness).toBeCloseTo(0.6 + 0.4 * scarMixForBand(2), 6);
  });

  it('is darker at every lower band -- the sheet reads in one direction', () => {
    const base = texturedBase();
    let last = Infinity;
    for (const band of [5, 4, 3, 2, 1]) {
      const lum = scarredMaterial(base, band).color.getHSL({ h: 0, s: 0, l: 0 }).l;
      expect(lum).toBeLessThan(last);
      last = lum;
    }
  });
});

describe('BuildingScarMaterials', () => {
  function building(base: THREE.Material): { root: THREE.Group; meshes: THREE.Mesh[] } {
    const root = new THREE.Group();
    const meshes = [0, 1, 2].map(() => {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), base);
      root.add(m);
      return m;
    });
    return { root, meshes };
  }

  it('mints one clone per (base material x band), not per mesh or per call', () => {
    const base = texturedBase();
    const scars = new BuildingScarMaterials();
    const a = building(base);
    const b = building(base);
    applyBuildingDamageBand(a.root, 4, scars);
    applyBuildingDamageBand(b.root, 4, scars);
    applyBuildingDamageBand(a.root, 4, scars);
    expect(scars.size).toBe(1);
    const shared = a.meshes[0].material;
    for (const m of [...a.meshes, ...b.meshes]) expect(m.material).toBe(shared);
    applyBuildingDamageBand(a.root, 2, scars);
    expect(scars.size).toBe(2);
  });

  it('derives every band from the BASE, never from the previous band\'s clone', () => {
    const base = texturedBase();
    const scars = new BuildingScarMaterials();
    const { root, meshes } = building(base);
    applyBuildingDamageBand(root, 5, scars);
    applyBuildingDamageBand(root, 3, scars);
    // The same colour the pure function gives from the base: compounding
    // the two lerps would land darker than this.
    expect((meshes[0].material as THREE.MeshStandardMaterial).color.getHex()).toBe(
      scarredMaterial(base, 3).color.getHex()
    );
  });

  it('restores the base on a clean band and leaves band 8 untouched', () => {
    const base = texturedBase();
    const scars = new BuildingScarMaterials();
    const { root, meshes } = building(base);
    applyBuildingDamageBand(root, 8, scars);
    expect(scars.size).toBe(0);
    for (const m of meshes) expect(m.material).toBe(base);
    applyBuildingDamageBand(root, 2, scars);
    expect(meshes[0].material).not.toBe(base);
    applyBuildingDamageBand(root, 7, scars);
    for (const m of meshes) expect(m.material).toBe(base);
  });

  it('disposes its clones and nothing of the base\'s', () => {
    const base = texturedBase();
    const map = base.map as THREE.Texture;
    let mapDisposed = false;
    map.addEventListener('dispose', () => {
      mapDisposed = true;
    });
    const scars = new BuildingScarMaterials();
    const { root } = building(base);
    applyBuildingDamageBand(root, 1, scars);
    scars.dispose();
    expect(scars.size).toBe(0);
    expect(mapDisposed).toBe(false);
  });
});
