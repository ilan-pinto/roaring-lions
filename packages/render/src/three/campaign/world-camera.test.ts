/**
 * The one guarantee that makes turning the campaign board safe: **no yaw can
 * push any part of it off screen.**
 *
 * Checked the way a viewer would rather than the way the fit computes it.
 * `fitHalfHeight` samples yaw at `FIT_SAMPLES` (every half degree); these
 * tests sample yaws it never looked at -- offset by an irrational fraction
 * of the sample step so no assertion can land on a sample the fit itself
 * used -- and project every bounding-box corner through the real camera.
 *
 * The second assertion is the one that stops the whole file being vacuous.
 * `return 1e9` satisfies "everything is inside the frustum" perfectly, and
 * leaves the board a dot in the middle of the screen. So the fit must also
 * be TIGHT: at its worst yaw the board has to fill most of the frame.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { glbFixture } from './glb-fixture';
import {
  boxCorners,
  fitHalfHeight,
  footprintCandidates,
  projectToCanvas,
  worldViewCamera,
  WORLD_VIEW_MARGIN,
} from './world-camera';
import { readWorldScene } from './world-scene';

const GLB = 'art/meshes/campaign/sahar_basin.glb';

/** The real board, centred horizontally the way `world-view.ts` centres it
 *  before the pivot turns -- box, footprint candidates, and every vertex. */
function board(): {
  box: THREE.Box3;
  frame: THREE.Vector3[];
  verts: Float32Array;
  target: THREE.Vector3;
  origin: THREE.Vector3;
} {
  const { root } = glbFixture(GLB);
  const scene = readWorldScene(root, (m) => new THREE.MeshBasicMaterial({ map: m }));
  const centre = scene.bounds.getCenter(new THREE.Vector3());
  root.position.set(-centre.x, 0, -centre.z);
  root.updateMatrixWorld(true);
  const size = scene.bounds.getSize(new THREE.Vector3());
  const box = new THREE.Box3(
    new THREE.Vector3(-size.x / 2, scene.bounds.min.y, -size.z / 2),
    new THREE.Vector3(size.x / 2, scene.bounds.max.y, size.z / 2)
  );
  const meshes = [...[...scene.regions.values()].flat(), ...scene.scenery];
  const frame = footprintCandidates(meshes);

  // Every vertex, in the same recentred frame -- what the fit must actually
  // contain, as opposed to the reduced set it is allowed to look at.
  const all: number[] = [];
  const v = new THREE.Vector3();
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      all.push(v.x, v.y, v.z);
    }
  }
  return {
    box,
    frame,
    verts: new Float32Array(all),
    target: new THREE.Vector3(0, (box.min.y + box.max.y) / 2, 0),
    origin: new THREE.Vector3(0, 0, 0),
  };
}

const corners = boxCorners;

/** The worst |ndc.x| and |ndc.y| any corner reaches, over `samples` yaws
 *  deliberately offset off the fit's own sample grid. */
function worstNdc(
  box: THREE.Box3,
  target: THREE.Vector3,
  halfHeight: number,
  aspect: number,
  samples: number
): { x: number; y: number } {
  const camera = worldViewCamera(target, halfHeight, aspect);
  const pts = corners(box);
  const pivot = new THREE.Group();
  const holder = new THREE.Object3D();
  pivot.add(holder);
  let mx = 0;
  let my = 0;
  // The golden-ratio offset means no sampled yaw here coincides with one the
  // fit used, however the two sample counts relate.
  const PHI = 0.618033988749895;
  for (let i = 0; i < samples; i++) {
    pivot.rotation.y = ((i + PHI) / samples) * Math.PI * 2;
    pivot.updateMatrixWorld(true);
    for (const c of pts) {
      const p = c.clone().applyMatrix4(pivot.matrixWorld).project(camera);
      mx = Math.max(mx, Math.abs(p.x));
      my = Math.max(my, Math.abs(p.y));
    }
  }
  return { x: mx, y: my };
}

// 16:9 is the stage's own aspect (`theme.css`); the other two are what the
// stage actually measures at the two window sizes this work was checked at.
const ASPECTS: [string, number][] = [
  ['16:9 stage', 16 / 9],
  ['wide', 1140 / 500],
  ['tall', 900 / 700],
];

describe('the campaign board is framed at every yaw', () => {
  const { box, target, origin } = board();

  for (const [name, aspect] of ASPECTS) {
    it(`keeps every corner on screen through a full turn (${name})`, () => {
      const halfHeight = fitHalfHeight(corners(box), origin, aspect, target);
      const worst = worstNdc(box, target, halfHeight, aspect, 997);
      expect(worst.x, 'worst |ndc.x|').toBeLessThanOrEqual(1);
      expect(worst.y, 'worst |ndc.y|').toBeLessThanOrEqual(1);
    });

    it(`does not waste the frame doing it (${name})`, () => {
      // Without this, `return 1e9` passes the test above and the board is a
      // speck. The fit adds WORLD_VIEW_MARGIN of slack and nothing else, so
      // the binding axis must come within that margin of the edge.
      const halfHeight = fitHalfHeight(corners(box), origin, aspect, target);
      const worst = worstNdc(box, target, halfHeight, aspect, 997);
      const tightest = 1 / (1 + WORLD_VIEW_MARGIN);
      expect(Math.max(worst.x, worst.y), 'the board must reach the frame').toBeGreaterThan(
        tightest - 0.02
      );
    });
  }

  /**
   * The sweep is the CONTRACT, and on the shipped asset it is very nearly
   * vacuous -- measured, not assumed. `sahar_basin` is 1.00032 x 0.90511 in
   * plan, near enough to round that its projected extent moves **0.10-0.12%
   * over a full turn** (0.42477 -> 0.42518 at 16:9 and at 1140/500, 0.52397
   * -> 0.52462 at 900/700). `WORLD_VIEW_MARGIN` alone is 60x that, so
   * fitting the authored orientation and nothing else would frame this board
   * at every yaw, and deleting the sweep does NOT fail the tests above.
   *
   * That is a fact about this diorama, not about the function, which is why
   * this case exists: an elongated board is where the sweep is the only
   * thing standing between a rotation and a board sliced off at the edges.
   * Without it a reader would have to take the sweep on trust, and a later
   * "this loop does nothing, measured" would delete it correctly and break
   * the next world.
   */
  it('needs the sweep for a board that is not nearly round', () => {
    const aspect = 16 / 9;
    const long = new THREE.Box3(
      new THREE.Vector3(-1.5, 0, -0.2),
      new THREE.Vector3(1.5, 0.2, 0.2)
    );
    const mid = new THREE.Vector3(0, 0.1, 0);
    const swept = fitHalfHeight(boxCorners(long), origin, aspect, mid);
    expect(worstNdc(long, mid, swept, aspect, 997).x).toBeLessThanOrEqual(1);

    // What fitting the authored orientation alone would have given. The
    // arithmetic is `fitHalfHeight`'s, with the sweep collapsed to yaw 0.
    const view = worldViewCamera(mid, 1, aspect).matrixWorldInverse;
    let mx = 0;
    let my = 0;
    for (const c of corners(long)) {
      const p = c.clone().applyMatrix4(view);
      mx = Math.max(mx, Math.abs(p.x));
      my = Math.max(my, Math.abs(p.y));
    }
    const yawZeroOnly = Math.max(my, mx / aspect) * (1 + WORLD_VIEW_MARGIN);
    expect(yawZeroOnly).toBeLessThan(swept);
    expect(worstNdc(long, mid, yawZeroOnly, aspect, 997).x).toBeGreaterThan(1);
  });

  /**
   * The fit looks at 28 hull points where the board has 33,678 vertices. That
   * reduction is licensed by an argument (orthographic projection is affine,
   * so an extreme is attained at a hull vertex) and the argument is exactly
   * the kind that is right until the day the hull is computed on the wrong
   * axis. So this checks it against every vertex, not against the reduction.
   *
   * Fewer yaw samples here than above -- 61 rather than 997 -- because this
   * is 33,678 points per sample rather than eight, and the property being
   * checked is the reduction rather than the sweep, which the case above
   * covers.
   *
   * **`WORLD_VIEW_MARGIN` is divided back out**, and that is the difference
   * between this test working and not. With the margin left in, the 6% of
   * slack swallows every plausible under-coverage: falsified by hand, both
   * truncating the hull to four points AND dropping the board's top height
   * from the candidate set entirely leave this green, because a flat slab's
   * fit moves less than 6% under either. Removing the margin asks the
   * question the margin was never meant to answer -- does the FIT contain
   * the board -- and both mutations then go red.
   */
  it('frames every one of the board’s own vertices, not just its hull', () => {
    const { frame, verts, target, origin } = board();
    for (const [, aspect] of ASPECTS) {
      const halfHeight = fitHalfHeight(frame, origin, aspect, target) / (1 + WORLD_VIEW_MARGIN);
      const camera = worldViewCamera(target, halfHeight, aspect);
      const view = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse);
      const p = new THREE.Vector3();
      let worst = 0;
      for (let s = 0; s < 61; s++) {
        const yaw = ((s + 0.618033988749895) / 61) * Math.PI * 2;
        const c = Math.cos(yaw);
        const sn = Math.sin(yaw);
        for (let i = 0; i < verts.length; i += 3) {
          const x = verts[i] as number;
          const y = verts[i + 1] as number;
          const z = verts[i + 2] as number;
          p.set(x * c + z * sn, y, -x * sn + z * c).applyMatrix4(view);
          worst = Math.max(worst, Math.abs(p.x), Math.abs(p.y));
        }
      }
      expect(worst, `aspect ${aspect.toFixed(3)}`).toBeLessThanOrEqual(1);
    }
  });

  /**
   * The candidates must stand at BOTH the board's floor and its highest peak.
   *
   * Structural rather than behavioural, and that is deliberate: on this asset
   * the height candidates are DORMANT. The plan extent (1.000 x 0.905) beats
   * the height (0.203) into the frustum at every aspect this screen is used
   * at, so `max(maxY, maxX/aspect)` is decided by the horizontal term and
   * **deleting the peak candidate entirely leaves every other test in this
   * file green** -- falsified by hand, including with the margin divided out.
   *
   * That is the same shape as the yaw sweep above: correct, contractual, and
   * currently unexercised by the one world that exists. A taller board -- a
   * mountain range with a small footprint -- makes it load-bearing
   * immediately, and this is what would still be standing when it does.
   */
  it('offers each footprint point at both the board’s floor and its highest peak', () => {
    const { frame, verts } = board();
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 1; i < verts.length; i += 3) {
      const y = verts[i] as number;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const heights = [...new Set(frame.map((v) => Number(v.y.toFixed(6))))].sort((a, b) => a - b);
    expect(heights).toHaveLength(2);
    expect(heights[0] as number).toBeCloseTo(minY, 5);
    expect(heights[1] as number).toBeCloseTo(maxY, 5);
    // Both heights for every footprint point, not one height for some.
    expect(frame).toHaveLength(28 * 2);
  });

  /**
   * The measurement that justifies fitting the footprint rather than the box:
   * **the board draws 1.25x larger in the same frame**, because a hexagon's
   * bounding box has four corners with no board under them.
   */
  it('draws the board 1.25x larger than fitting its bounding box would', () => {
    const { box, frame, target, origin } = board();
    const aspect = 1140 / 641;
    const byBox = fitHalfHeight(corners(box), origin, aspect, target);
    const byHull = fitHalfHeight(frame, origin, aspect, target);
    expect(byBox / byHull).toBeGreaterThan(1.2);
    expect(byBox).toBeCloseTo(0.4507, 3);
    expect(byHull).toBeCloseTo(0.3607, 3);
  });

  it('holds the board at a constant size as it turns', () => {
    // The alternative fit -- per frame, to the current yaw -- wastes no
    // screen and makes the board swell and shrink as it rotates. One
    // frustum for the whole turn is what makes a drag change orientation
    // and nothing else.
    const aspect = 16 / 9;
    const halfHeight = fitHalfHeight(corners(box), origin, aspect, target);
    const a = worldViewCamera(target, halfHeight, aspect);
    const b = worldViewCamera(target, halfHeight, aspect);
    expect(a.top).toBe(b.top);
    expect(a.right).toBe(b.right);
    expect(a.right / a.top).toBeCloseTo(aspect, 10);
  });

  it('projects a marker to the canvas pixel under it', () => {
    const aspect = 16 / 9;
    const halfHeight = fitHalfHeight(corners(box), origin, aspect, target);
    const camera = worldViewCamera(target, halfHeight, aspect);
    const centre = projectToCanvas(target, camera, 1600, 900);
    expect(centre.x).toBeCloseTo(800, 6);
    expect(centre.y).toBeCloseTo(450, 6);
    // A point straight up from the target must land HIGHER on the canvas,
    // which is where a y-flip would show.
    const up = projectToCanvas(target.clone().setY(target.y + 0.1), camera, 1600, 900);
    expect(up.y).toBeLessThan(centre.y);
  });
});
