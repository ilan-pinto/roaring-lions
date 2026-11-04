/**
 * The knocked-out gun on the model (`gun-out.ts`): a barrel bent 14 degrees, a short gun's whole
 * mount tilted, the char shell, and the swap that applies them only while the sim says the gun is out.
 * The geometry is built from plain boxes: the numbers below are the lead's (14 degrees), not the
 * module's own constants restated, so a drifted constant fails here.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  GUN_OUT_MESH_NAME,
  GunOutVariants,
  applyGunOut,
  buildGunOutVariant,
  mantletXOf,
  vehicleGunOutDrawn,
} from './gun-out';
import { buildVehicleMeshTemplate, instantiateVehicleMesh } from './mesh-vehicle';
import { parseRigidFixture } from './rigid-mesh-fixture';

/** A bar along +x from `x0` to `x1`, `h` thick, in 24 steps (so the bend has vertices to bend). */
function bar(x0: number, x1: number, h = 0.2): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(x1 - x0, h, h, 24, 1, 1);
  g.translate((x0 + x1) / 2, 0, 0);
  return g;
}

function bounds(g: THREE.BufferGeometry): THREE.Box3 {
  g.computeBoundingBox();
  return g.boundingBox as THREE.Box3;
}

const DEG14 = (14 * Math.PI) / 180;

describe('buildGunOutVariant: the bend', () => {
  it('drops the muzzle by length x sin(14 degrees) and leaves everything behind the mantlet where it was', () => {
    const src = bar(-1, 4);
    const before = Float32Array.from(src.getAttribute('position').array as Float32Array);
    const v = buildGunOutVariant(src, 1.0);
    const tip = bounds(v.bent).min.y;
    // The tip's centreline drops 3 * sin(14 deg); its lower face a little more (the bar is 0.2 thick).
    expect(tip).toBeLessThan(-3 * Math.sin(DEG14) + 0.05);
    expect(tip).toBeGreaterThan(-3 * Math.sin(DEG14) - 0.2);
    const pos = v.bent.getAttribute('position');
    const rear: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      if (before[i * 3] <= 1.0) {
        rear.push(Math.abs(pos.getX(i) - before[i * 3]) + Math.abs(pos.getY(i) - before[i * 3 + 1]));
      }
    }
    expect(rear.length).toBeGreaterThan(0);
    expect(Math.max(...rear)).toBe(0);
    // The source is read, never written.
    expect(Array.from(src.getAttribute('position').array as Float32Array)).toEqual(Array.from(before));
  });

  it('bends as one tube: the droop grows monotonically along the barrel', () => {
    const v = buildGunOutVariant(bar(-1, 4), 1.0);
    const pos = v.bent.getAttribute('position');
    const dropAt = new Map<number, number>();
    for (let i = 0; i < pos.count; i++) {
      const key = Math.round(pos.getX(i) * 10);
      dropAt.set(key, Math.min(dropAt.get(key) ?? 0, pos.getY(i)));
    }
    const xs = [...dropAt.keys()].sort((a, b) => a - b);
    let last = 0;
    for (const k of xs) {
      const d = dropAt.get(k) as number;
      expect(d).toBeLessThanOrEqual(last + 0.12);
      last = Math.min(last, d);
    }
  });

  it('turns the normals with the barrel, so the light follows the bend', () => {
    const v = buildGunOutVariant(bar(-1, 4), 1.0);
    const nor = v.bent.getAttribute('normal');
    const pos = v.bent.getAttribute('position');
    let tipUp = 0;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getX(i) > 3.9 && nor.getY(i) > 0.5) tipUp = Math.max(tipUp, nor.getY(i));
    }
    // A top-face normal at the muzzle has turned about -14 degrees, so its y is cos(14 deg), not 1.
    expect(tipUp).toBeGreaterThan(0.9);
    expect(tipUp).toBeLessThan(Math.cos(DEG14) + 0.01);
  });
});

describe('buildGunOutVariant: a short gun', () => {
  it('tilts the whole mount: the rear-top corner moves, which it does not on a long barrel', () => {
    const rearTopMove = (x1: number): number => {
      const src = bar(0, x1);
      const before = src.getAttribute('position');
      let ri = -1;
      for (let i = 0; i < before.count; i++) if (before.getX(i) < 0.01 && before.getY(i) > 0.05) ri = i;
      const x = before.getX(ri);
      const y = before.getY(ri);
      const v = buildGunOutVariant(src, 0.3);
      const after = v.bent.getAttribute('position');
      return Math.hypot(after.getX(ri) - x, after.getY(ri) - y);
    };
    expect(rearTopMove(1.6)).toBeGreaterThan(0.005); // a 1.3 barrel past the mantlet: short, the mount tilts
    expect(rearTopMove(3.5)).toBe(0); // a 3.2 barrel: long, the mount stays
  });

  it('droops further than the bend alone would', () => {
    const tip = (x1: number, mantlet: number): number => bounds(buildGunOutVariant(bar(0, x1), mantlet).bent).min.y;
    const bendAlone = -1.3 * Math.sin(DEG14);
    expect(tip(1.6, 0.3)).toBeLessThan(bendAlone - 0.1);
  });
});

describe('buildGunOutVariant: the char', () => {
  it('is the last of the barrel only, a thin shell standing off it', () => {
    const v = buildGunOutVariant(bar(-1, 4), 1.0);
    expect(v.scorch).not.toBeNull();
    const s = v.scorch as THREE.BufferGeometry;
    const sp = s.getAttribute('position');
    expect(sp.count % 3).toBe(0);
    expect(sp.count).toBeGreaterThan(0);
    // Every char vertex lies in the muzzle 40%: forward of 60% of the way from the mantlet to the tip.
    let minX = Infinity;
    for (let i = 0; i < sp.count; i++) minX = Math.min(minX, sp.getX(i));
    expect(minX).toBeGreaterThan(1.0 + 0.55 * 3);
    // And far less than the whole barrel.
    const bentTris = (v.bent.getIndex() as THREE.BufferAttribute).count / 3;
    expect(sp.count / 3).toBeLessThan(bentTris / 2);
  });

  it('a barrel with no triangle in the last 40% has no shell, not an empty mesh', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    g.setIndex([0, 1, 2]);
    expect(buildGunOutVariant(g, 0.1).scorch).toBeNull();
  });
});

describe('mantletXOf', () => {
  it('is the front of the turret body: the largest x of the sibling turret meshes', () => {
    expect(mantletXOf([bar(-2, 0.9), bar(-1, 1.2)])).toBeCloseTo(1.2, 5);
    expect(mantletXOf([])).toBeNull();
  });
});

/** A turreted fixture: `turret_hull` and `turret_metal` under the pivot, the way the shipped GLBs are. */
async function turreted() {
  const gltf = await parseRigidFixture({
    parts: [
      { nodeName: 'hull_hull', extrasRole: 'hull' },
      { nodeName: 'turret_hull', extrasRole: 'hull' },
      { nodeName: GUN_OUT_MESH_NAME, extrasRole: 'metal' },
    ],
    pivot: { pivotName: 'turret_pivot', pivotChildren: [1, 2] },
    clipNames: ['idle', 'wreck'],
    deathRoot: { parts: ['hull_hull'] },
  });
  const template = buildVehicleMeshTemplate(gltf, 'mbt_lavi');
  return { template, entity: instantiateVehicleMesh(template, 'mbt_lavi') };
}

function barrelOf(entity: ReturnType<typeof instantiateVehicleMesh>): THREE.Mesh {
  let found: THREE.Mesh | null = null;
  entity.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.name === GUN_OUT_MESH_NAME && m.userData.rl_wreck !== true) found = m;
  });
  if (!found) throw new Error('no barrel');
  return found;
}

describe('applyGunOut: the swap', () => {
  it('is applied only while the gun is out: healthy draws the template geometry, gun out the bent one, repaired the template again', async () => {
    const { template, entity } = await turreted();
    const variants = new GunOutVariants();
    const mesh = barrelOf(entity);
    const shipped = mesh.geometry;
    expect(vehicleGunOutDrawn(entity)).toBe(false);

    expect(applyGunOut(entity, false, variants)).toBe(false); // nothing to do: still the shipped model
    expect(mesh.geometry).toBe(shipped);

    expect(applyGunOut(entity, true, variants)).toBe(true);
    expect(vehicleGunOutDrawn(entity)).toBe(true);
    expect(mesh.geometry).not.toBe(shipped);
    expect(variants.size).toBe(1);

    expect(applyGunOut(entity, true, variants)).toBe(false); // idempotent
    expect(applyGunOut(entity, false, variants)).toBe(true);
    expect(mesh.geometry).toBe(shipped);
    expect(mesh.children.some((c) => c.name === `${GUN_OUT_MESH_NAME}__scorch`)).toBe(false);
    // The template itself was never touched.
    let templateGeom: THREE.BufferGeometry | null = null;
    template.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.name === GUN_OUT_MESH_NAME && m.userData.rl_wreck !== true) templateGeom = m.geometry;
    });
    expect(templateGeom).toBe(shipped);
  });

  it('shares one bent geometry between two hulls of a type', async () => {
    const { template, entity } = await turreted();
    const other = instantiateVehicleMesh(template, 'mbt_lavi');
    const variants = new GunOutVariants();
    applyGunOut(entity, true, variants);
    applyGunOut(other, true, variants);
    expect(barrelOf(entity).geometry).toBe(barrelOf(other).geometry);
    expect(variants.size).toBe(1);
  });

  it('a hull with no turret_metal (a jeep, a rocket battery) has no gun to bend and is left alone', async () => {
    const gltf = await parseRigidFixture({
      parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }],
      clipNames: ['idle', 'wreck'],
      deathRoot: { parts: ['hull_hull'] },
    });
    const entity = instantiateVehicleMesh(buildVehicleMeshTemplate(gltf, 'jeep_shoded'), 'jeep_shoded');
    expect(applyGunOut(entity, true, new GunOutVariants())).toBe(false);
  });
});
