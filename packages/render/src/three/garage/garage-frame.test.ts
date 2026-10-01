import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  GARAGE_ELEVATION_DEG,
  GARAGE_FOV_DEG,
  GARAGE_MARGIN_X,
  GARAGE_MARGIN_Y,
  KEY_AZIMUTH_DEG,
  LINE_GAP,
  clearSpacing,
  defaultYawDeg,
  fitCamera,
  stageLights,
  sunScreenSide,
  wrapDegrees,
  type GarageClass,
} from './garage-frame';

/** Where `rotation.y = deg` sends a local ground vector `(x, z)`. */
function turned(deg: number, x: number, z: number): { x: number; z: number } {
  const v = new THREE.Vector3(x, 0, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(deg));
  return { x: v.x, z: v.z };
}

/** A box's eight corners turned through a whole turn every 15 degrees:
 *  what the door hands `fitCamera`. */
function sweptBox(lx: number, h: number, lz: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let a = 0; a < 360; a += 15) {
    for (const x of [-lx / 2, lx / 2])
      for (const z of [-lz / 2, lz / 2])
        for (const y of [0, h]) {
          const p = turned(a, x, z);
          out.push(new THREE.Vector3(p.x, y, p.z));
        }
  }
  return out;
}

describe('the key light follows the sun', () => {
  it('puts the shipped sun on the screen LEFT, as lighting.ts says', () => {
    expect(sunScreenSide()).toBe(1);
  });

  it('flips with a mirrored sun', () => {
    const view = new THREE.Vector3(1, 1, 1).normalize();
    expect(sunScreenSide(new THREE.Vector3(-0.4, 0.8, 0.4), view)).toBe(1);
    expect(sunScreenSide(new THREE.Vector3(0.4, 0.8, -0.4), view)).toBe(-1);
  });

  it('keys from the sun side and fills from the other, both above the stage', () => {
    const { key, fill } = stageLights(1);
    // The garage camera sits on +X, so screen-left is +Z.
    expect(key.z).toBeGreaterThan(0);
    expect(fill.z).toBeLessThan(0);
    expect(key.y).toBeGreaterThan(0.5);
    expect(fill.y).toBeGreaterThan(0);
    expect(Math.atan2(key.z, key.x) * (180 / Math.PI)).toBeCloseTo(KEY_AZIMUTH_DEG, 6);
    const mirrored = stageLights(-1);
    expect(mirrored.key.z).toBeLessThan(0);
    expect(mirrored.fill.z).toBeGreaterThan(0);
  });
});

describe('each unit starts with its broad face toward the key', () => {
  const keyGround = (side: 1 | -1): { x: number; z: number } => {
    const k = stageLights(side).key;
    const n = Math.hypot(k.x, k.z);
    return { x: k.x / n, z: k.z / n };
  };

  for (const side of [1, -1] as const) {
    it(`a figure faces the key (sun side ${side})`, () => {
      const front = turned(defaultYawDeg('figures', side), 1, 0);
      const k = keyGround(side);
      expect(front.x).toBeCloseTo(k.x, 9);
      expect(front.z).toBeCloseTo(k.z, 9);
    });

    it(`a vehicle shows the key its flank, nose away from the light (sun side ${side})`, () => {
      const yaw = defaultYawDeg('vehicle', side);
      const flank = turned(yaw, 0, side);
      const k = keyGround(side);
      expect(flank.x).toBeCloseTo(k.x, 9);
      expect(flank.z).toBeCloseTo(k.z, 9);
      // The nose points to the side of the screen away from the key.
      const nose = turned(yaw, 1, 0);
      expect(Math.sign(nose.z)).toBe(-side);
    });
  }

  it('lands in [0, 360)', () => {
    for (const cls of ['figures', 'vehicle'] as const) {
      const d = defaultYawDeg(cls);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThan(360);
    }
  });
});

describe('wrapDegrees', () => {
  it('folds into [0, 360)', () => {
    expect(wrapDegrees(360)).toBe(0);
    expect(wrapDegrees(-40)).toBe(320);
    expect(Object.is(wrapDegrees(-0), 0)).toBe(true);
  });
});

describe('framing per class', () => {
  const ASPECT = 566 / 378;
  // A rifle team's line and a tank, in world units (a tile is 1).
  const subjects: Record<GarageClass, THREE.Vector3[]> = {
    figures: sweptBox(0.3, 0.6, 1.1),
    vehicle: sweptBox(2.2, 0.8, 1.2),
  };

  for (const cls of ['figures', 'vehicle'] as const) {
    it(`${cls}: every point of the whole turn lands inside the margins, and the fit is tight`, () => {
      const pts = subjects[cls];
      const fit = fitCamera(pts, GARAGE_FOV_DEG, GARAGE_ELEVATION_DEG[cls], ASPECT);
      const cam = new THREE.PerspectiveCamera(GARAGE_FOV_DEG, ASPECT, 0.01, 1000);
      cam.position.copy(fit.position);
      cam.lookAt(fit.target);
      cam.updateMatrixWorld(true);
      let worst = 0;
      for (const p of pts) {
        const q = p.clone().project(cam);
        expect(Math.abs(q.x)).toBeLessThanOrEqual(GARAGE_MARGIN_X + 1e-6);
        expect(Math.abs(q.y)).toBeLessThanOrEqual(GARAGE_MARGIN_Y + 1e-6);
        worst = Math.max(worst, Math.abs(q.x) / GARAGE_MARGIN_X, Math.abs(q.y) / GARAGE_MARGIN_Y);
      }
      // Some point touches a margin: the model is as large as it can be.
      expect(worst).toBeGreaterThan(0.995);
    });

    it(`${cls}: the camera sits on +X at the class's own height above the horizon`, () => {
      const fit = fitCamera(subjects[cls], GARAGE_FOV_DEG, GARAGE_ELEVATION_DEG[cls], ASPECT);
      const d = fit.position.clone().sub(fit.target);
      expect(d.x).toBeGreaterThan(0);
      expect(Math.abs(d.z)).toBeLessThan(1e-9);
      const el = Math.atan2(d.y, Math.hypot(d.x, d.z)) * (180 / Math.PI);
      expect(el).toBeCloseTo(GARAGE_ELEVATION_DEG[cls], 6);
      expect(d.length()).toBeCloseTo(fit.distance, 6);
    });
  }

  it('looks down on a vehicle more steeply than on a figure', () => {
    expect(GARAGE_ELEVATION_DEG.vehicle).toBeGreaterThan(GARAGE_ELEVATION_DEG.figures);
  });

  it('a bigger subject is framed from further away, at the same margins', () => {
    const near = fitCamera(sweptBox(1, 0.5, 0.6), GARAGE_FOV_DEG, 18, ASPECT);
    const far = fitCamera(sweptBox(2, 1, 1.2), GARAGE_FOV_DEG, 18, ASPECT);
    expect(far.distance / near.distance).toBeCloseTo(2, 1);
  });
});

describe('clearSpacing: neighbours never touch at any angle of the turn', () => {
  it('two discs need their two radii plus the gap', () => {
    const disc = (r: number): { x: number; z: number }[] =>
      Array.from({ length: 72 }, (_, i) => ({ x: r * Math.cos((i * Math.PI) / 36), z: r * Math.sin((i * Math.PI) / 36) }));
    expect(clearSpacing(disc(0.1), disc(0.15))).toBeCloseTo(0.25 + LINE_GAP, 3);
  });

  it('a rifle that points at the next man sets the spacing, not the body', () => {
    // A body 0.1 across with a rifle reaching 0.3 forward (+x).
    const rifleman = [
      { x: 0.05, z: 0.05 },
      { x: -0.05, z: -0.05 },
      { x: 0.05, z: -0.05 },
      { x: -0.05, z: 0.05 },
      { x: 0.3, z: 0 },
    ];
    const s = clearSpacing(rifleman, rifleman, 1);
    // Rifle along the line: 0.3 of muzzle plus the next man's 0.05 of back.
    expect(s).toBeGreaterThanOrEqual(0.3 + 0.05 + LINE_GAP);
    // Far more than the bodies alone would need.
    expect(s).toBeGreaterThan(clearSpacing(rifleman.slice(0, 4), rifleman.slice(0, 4), 1) + 0.2);
    // And at that spacing, no turn puts a point of one past the other's.
    for (let deg = 0; deg < 360; deg += 1) {
      const t = THREE.MathUtils.degToRad(deg);
      const z = (p: { x: number; z: number }): number => -p.x * Math.sin(t) + p.z * Math.cos(t);
      const reachA = Math.max(...rifleman.map(z));
      const reachB = Math.min(...rifleman.map(z)) + s;
      expect(reachA).toBeLessThan(reachB);
    }
  });

  it('is nothing for an empty figure', () => {
    expect(clearSpacing([], [{ x: 0, z: 0 }])).toBe(0);
  });
});
