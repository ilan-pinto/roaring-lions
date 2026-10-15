/**
 * The held-building banner (lead ruling 2026-10-14): where it hangs on every
 * garrisonable building as shipped, and the batch that draws it.
 *
 * The placement half reads the real GLBs from `art/meshes/buildings/`, the
 * sources `pnpm encode:meshes` mirrors into `assets/`, and checks the spot
 * `placeBanner` chose with an INDEPENDENT instrument: three's own
 * `Raycaster` against the building's own meshes, not the z-buffers the
 * search rasterised. A cloth the camera cannot see, or one in the building's
 * own shadow where the search claimed sun, is caught by a ray, not by the
 * arithmetic that picked it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { parseGlbHeadless } from './headless-gltf';
import { MESH_SCALE } from './mesh-anim';
import { VIEW_DIRECTION } from '../camera';
import { DAY_SUN_DIRECTION } from '../time-of-day';
import { BANNER_MIN_DROP, BANNER_STANDOFF, type BannerSpot } from './banner-placement';
import { GarrisonBannerBatch, bannerMatrix, bannerSpotFor } from './garrison-banner';

/** Every structure type with `garrison_slots > 0` in `data/structures.json`,
 *  and the face its banner lands on. All ten land on the sunlit `+z` face but
 *  the clinic, whose `+z` face is a porch -- posts and a canopy beam, with no
 *  run of wall the cloth can hang flat against. */
const EXPECTED_FACE: Readonly<Record<string, BannerSpot['face']>> = {
  shanty: '+z',
  house: '+z',
  apartment: '+z',
  warehouse: '+z',
  concrete: '+z',
  hall: '+z',
  camp: '+z',
  clinic: '+x',
  relay: '+z',
  pump_house: '+z',
};

/** Garrisonable types that get NO banner, and why. `bannerSpotFor` wants a
 *  flat run of wall the cloth can hang against for `BANNER_MIN_DROP`, and
 *  these have none -- the renderer then draws no banner (`ThreeRenderer`
 *  skips a type whose spot is null). An entry here is a claim that the
 *  search really comes back empty: the demotion test below fails the moment
 *  it finds a spot, so a stale exemption cannot outlive its reason. */
const NO_BANNER: Readonly<Record<string, string>> = {
  // GH-66: a 1.09 m horseshoe of pillow bags, every course a row of bumps
  // and nothing flat; its occupant stands IN the ring (`height_px` 0), so
  // the held read is the man himself, in his own team colour.
  sandbag_post: 'a ring of bags, no flat face to hang from',
};

const structures = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../../data/structures.json', import.meta.url)), 'utf8')
) as { types: Record<string, { garrison_slots: number }> };

function sunDir(): [number, number, number] {
  const [x, y, z] = DAY_SUN_DIRECTION;
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

async function loadTemplate(type: string): Promise<THREE.Object3D> {
  const bytes = readFileSync(fileURLToPath(new URL(`../../../../../art/meshes/buildings/${type}.glb`, import.meta.url)));
  const gltf = await parseGlbHeadless(new Uint8Array(bytes));
  gltf.scene.scale.setScalar(MESH_SCALE);
  gltf.scene.updateMatrixWorld(true);
  return gltf.scene;
}

/** Points across the cloth, in template space, standing `BANNER_STANDOFF`
 *  proud of the hang plane: a 5 x 7 grid inset from the edges. */
function clothPoints(spot: BannerSpot): THREE.Vector3[] {
  const m = bannerMatrix(spot, new THREE.Vector3(), { sx: 1, sy: 1, sz: 1 });
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 7; j++) {
      const lx = -0.4 + (0.8 * i) / 4;
      const ly = -0.1 - (0.8 * j) / 6;
      out.push(new THREE.Vector3(lx, ly, BANNER_STANDOFF).applyMatrix4(m));
    }
  }
  return out;
}

/** Share of `points` from which a ray toward `dir` meets none of `root`. */
function clearShare(root: THREE.Object3D, points: readonly THREE.Vector3[], dir: THREE.Vector3): number {
  const ray = new THREE.Raycaster();
  let clear = 0;
  for (const p of points) {
    ray.set(p.clone().addScaledVector(dir, 0.002), dir);
    if (ray.intersectObject(root, true).length === 0) clear++;
  }
  return clear / points.length;
}

describe('the banner spot on every garrisonable building as shipped', () => {
  const types = Object.entries(structures.types)
    .filter(([, t]) => t.garrison_slots > 0)
    .map(([id]) => id)
    .sort();
  const spots = new Map<string, { root: THREE.Object3D; spot: BannerSpot | null }>();

  beforeAll(async () => {
    for (const type of types) {
      const root = await loadTemplate(type);
      spots.set(type, { root, spot: bannerSpotFor(root, sunDir()) });
    }
  });

  it('covers exactly the types the data says can be held', () => {
    expect(types).toEqual([...Object.keys(EXPECTED_FACE), ...Object.keys(NO_BANNER)].sort());
  });

  it.each(Object.keys(NO_BANNER).sort())('%s: still has no banner spot (else move it to EXPECTED_FACE)', (type) => {
    expect(spots.get(type)?.spot ?? null, `${type} now has a spot: delete its NO_BANNER entry`).toBeNull();
  });

  it.each(Object.keys(EXPECTED_FACE).sort())('%s: a spot on its expected face, a real cloth', (type) => {
    const got = spots.get(type);
    expect(got?.spot, `${type}: no spot at all`).not.toBeNull();
    const spot = got?.spot as BannerSpot;
    expect(spot.face).toBe(EXPECTED_FACE[type]);
    expect(spot.drop).toBeGreaterThanOrEqual(BANNER_MIN_DROP);
    expect(spot.width).toBeGreaterThanOrEqual(0.2);
    expect(spot.solid).toBeGreaterThanOrEqual(0.5);
    // The hang point is on the building, inside its plan.
    const box = new THREE.Box3().setFromObject(got?.root as THREE.Object3D);
    expect(spot.x).toBeGreaterThanOrEqual(box.min.x - 1e-6);
    expect(spot.x).toBeLessThanOrEqual(box.max.x + 1e-6);
    expect(spot.z).toBeGreaterThanOrEqual(box.min.z - 1e-6);
    expect(spot.z).toBeLessThanOrEqual(box.max.z + 1e-6);
    expect(spot.y - spot.drop).toBeGreaterThan(0.05);
  });

  it.each(Object.keys(EXPECTED_FACE).sort())('%s: the camera sees the whole cloth (raycast, not the search)', (type) => {
    const got = spots.get(type);
    const spot = got?.spot as BannerSpot;
    const view = VIEW_DIRECTION.clone().normalize();
    expect(clearShare(got?.root as THREE.Object3D, clothPoints(spot), view)).toBe(1);
  });

  it.each(Object.entries(EXPECTED_FACE).filter(([, f]) => f === '+z').map(([t]) => t).sort())(
    '%s: on the sunlit face, the day sun reaches the cloth (raycast)',
    (type) => {
      const got = spots.get(type);
      const spot = got?.spot as BannerSpot;
      const sun = new THREE.Vector3(...sunDir());
      // The hall is the mock's defect: its sunlit face is a portico, and the
      // mock's cloth went to the shaded wall (4 px at zoom 1).
      expect(clearShare(got?.root as THREE.Object3D, clothPoints(spot), sun)).toBeGreaterThanOrEqual(0.9);
      expect(spot.lit).toBeGreaterThanOrEqual(0.9);
    }
  );
});

describe('bannerMatrix', () => {
  const spot: BannerSpot = { face: '+z', x: 0.5, y: 2, z: 1.2, width: 0.4, drop: 1, lit: 1, solid: 1 };

  it('moves the template spot to the clone and scales it by the clone fit', () => {
    const m = bannerMatrix(spot, new THREE.Vector3(10, 0.5, 20), { sx: 0.5, sy: 0.8, sz: 0.6 });
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    m.decompose(p, q, s);
    expect(p.x).toBeCloseTo(10 + 0.5 * 0.5);
    expect(p.y).toBeCloseTo(0.5 + 2 * 0.8);
    expect(p.z).toBeCloseTo(20 + 1.2 * 0.6);
    // Width along the face's own plan axis (x for +z), drop by the height.
    expect(s.x).toBeCloseTo(0.4 * 0.5);
    expect(s.y).toBeCloseTo(1 * 0.8);
    expect(s.z).toBeCloseTo(1);
  });

  it('turns a +x banner to face +x and takes its width from the z scale', () => {
    const m = bannerMatrix({ ...spot, face: '+x' }, new THREE.Vector3(), { sx: 0.5, sy: 1, sz: 0.6 });
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(m);
    expect(normal.x).toBeCloseTo(1);
    expect(normal.z).toBeCloseTo(0);
    const s = new THREE.Vector3();
    m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
    expect(s.x).toBeCloseTo(0.4 * 0.6);
  });
});

describe('GarrisonBannerBatch', () => {
  /** A colour as `THREE.Color.set` reads it; the renderer passes the palette's
   *  resolved team hex. */
  const BLUE = 'rgb(10, 20, 200)';
  const RED = 'rgb(200, 20, 30)';
  const entry = (s: number, hex = BLUE) => ({ s, hex, matrix: new THREE.Matrix4().makeTranslation(s, 0, 0) });

  it('draws one instance per entry, and hides with none', () => {
    const b = new GarrisonBannerBatch({ value: 0 });
    b.update([entry(3), entry(7)]);
    expect(b.count).toBe(2);
    expect(b.mesh.visible).toBe(true);
    b.update([]);
    expect(b.count).toBe(0);
    expect(b.mesh.visible).toBe(false);
    b.dispose();
  });

  it('uploads only when the set or a colour changed', () => {
    const b = new GarrisonBannerBatch({ value: 0 });
    b.update([entry(3)]);
    const v = b.mesh.instanceMatrix.version;
    b.update([entry(3)]);
    expect(b.mesh.instanceMatrix.version).toBe(v);
    b.update([entry(3, RED)]);
    expect(b.mesh.instanceMatrix.version).toBeGreaterThan(v);
    b.dispose();
  });

  it('the debug flag survives the per-frame update that writes visible', () => {
    const b = new GarrisonBannerBatch({ value: 0 });
    b.update([entry(1)]);
    expect(b.setDebugHidden(true)).toBe(1);
    b.update([entry(1)]);
    expect(b.mesh.visible).toBe(false);
    b.setDebugHidden(false);
    b.update([entry(1)]);
    expect(b.mesh.visible).toBe(true);
    b.dispose();
  });

  it('casts and receives the sun like the wall it hangs on', () => {
    const b = new GarrisonBannerBatch({ value: 0 });
    expect(b.mesh.castShadow).toBe(true);
    expect(b.mesh.receiveShadow).toBe(true);
    b.dispose();
  });
});
