import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  COLLAPSE_SHROUD_AXIS_MAX,
  COLLAPSE_SHROUD_BLOOM_FRACTION,
  COLLAPSE_SHROUD_BLOOM_MAX,
  COLLAPSE_SHROUD_BLOOM_MIN,
  COLLAPSE_SHROUD_CAPACITY,
  COLLAPSE_SHROUD_COVER,
  COLLAPSE_SHROUD_DENSITY,
  COLLAPSE_SHROUD_DURATION_MS,
  COLLAPSE_SHROUD_EDGE_SOFTNESS,
  COLLAPSE_SHROUD_GROWTH_SPREAD,
  COLLAPSE_SHROUD_HOLD_FRACTION,
  COLLAPSE_SHROUD_HOLD_STAGGER,
  COLLAPSE_SHROUD_JITTER,
  COLLAPSE_SHROUD_MIN_RADIUS,
  COLLAPSE_SHROUD_AXIS_MIN,
  COLLAPSE_SHROUD_PUFFS_MAX,
  COLLAPSE_SHROUD_RIM_CORE,
  COLLAPSE_SHROUD_SWAP_DELAY_MS,
  CollapseShroudManager,
  collapseShroudBloom,
  collapseShroudDensity,
  collapseShroudLayout,
  collapseShroudPuffGeometry,
  collapseShroudSwapProgress,
  createCollapseShroudMaterial,
} from './collapse-shroud';
import { SMOKE_PLUME_DENSITY, SMOKE_PLUME_DEFAULT_DURATION_MS } from './smoke-plume';
import { SMOKE_ALPHA_CEIL } from '../smoke-mesh';
import { SMOKE_RENDER_ORDER } from './render-order';

/**
 * The world-space extents of every shipped building mesh, read off the loaded
 * `BuildingMeshTemplate.root` in a real browser (`.superpowers/queue/
 * collapse-smoke-report.md`). These are what the covering assertions below are
 * walked against, so "prove it on the tallest and the shortest thing in the
 * game" is a fact about the shipped art rather than about invented numbers.
 *
 * `wall` is not on `beit_sahwan_outskirts` and so is not in that browser
 * reading; its entry is the sim's own footprint (one tile -- `per_tile` gives
 * every tile of a run its own structure) and the height `marj_perimeter`
 * draws it at. It is the SHORTEST thing in the game by a wide margin and is
 * the case `COLLAPSE_SHROUD_MIN_RADIUS` exists for.
 *
 * `hall` replaces the retired `mosque` row (task O10, GDD Section 2: "never
 * a faith") -- NOT read off a browser like the rest of this table, since
 * none was available this session. Computed instead straight from the
 * shipped `art/meshes/buildings/hall.glb`'s own accessor bounds (raw extent
 * 8.4168 x 4.5617 x 9.6216 world units) divided by `MESH_SCALE`'s inverse,
 * i.e. `/ MESH_UNITS_PER_TILE` (3.0) -- the identical relationship the other
 * six rows in this table satisfy exactly against their own shipped GLBs
 * (e.g. `apartment`'s 14.752/23.235/14.656 raw extent, divided by 3, is this
 * table's own 4.917/7.745/4.885 to three decimal places), which is how this
 * number was cross-checked rather than assumed.
 */
const SHIPPED_BUILDINGS: ReadonlyArray<readonly [string, number, number, number]> = [
  ['apartment', 4.917, 7.745, 4.885],
  ['house', 4.264, 4.237, 3.712],
  ['hall', 2.806, 1.521, 3.207],
  ['concrete', 2.343, 2.993, 2.31],
  ['warehouse', 3.999, 1.396, 4.0],
  ['shanty', 2.977, 1.017, 2.368],
  ['wall', 1.08, 0.583, 1.08],
];

/**
 * Every point of a building's own box, on a dense grid, and how far outside
 * the nearest puff's DENSE CORE it falls (<= 0 means covered).
 *
 * The core, not the sphere, and that is the whole distinction
 * `COLLAPSE_SHROUD_RIM_CORE` exists for: a point inside a sphere but outside
 * its core sits where the rim fade has already thinned the fragment to
 * nothing, so it is geometrically covered and optically bare. Asserting on
 * the sphere passed while the tallest shipped building leaked 16464 px of its
 * own mesh swap.
 *
 * Sampling the box the BUILDING occupies, not the spilled box the lattice is
 * laid out over: the spill is margin, and margin is not what has to be
 * proven.
 */
function worstUncovered(
  puffs: ReturnType<typeof collapseShroudLayout>,
  width: number,
  height: number,
  depth: number,
  steps = 12
): number {
  let worst = -Infinity;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      for (let k = 0; k <= steps; k++) {
        const x = -width / 2 + (width * i) / steps;
        const y = (height * j) / steps;
        const z = -depth / 2 + (depth * k) / steps;
        let best = Infinity;
        for (const p of puffs) {
          const d = Math.hypot(x - p.dx, y - p.dy, z - p.dz) - p.radius * COLLAPSE_SHROUD_RIM_CORE;
          if (d < best) best = d;
        }
        if (best > worst) worst = best;
      }
    }
  }
  return worst;
}

describe('collapseShroudLayout coverage', () => {
  it.each(SHIPPED_BUILDINGS)(
    'covers every point of %s (%f x %f x %f) with margin to spare',
    (_id, w, h, d) => {
      // The table reads (width, HEIGHT, depth) because that is how a bounding
      // box is quoted; `collapseShroudLayout` takes (width, DEPTH, height).
      expect(worstUncovered(collapseShroudLayout(w, d, h, 7), w, h, d)).toBeLessThan(0);
    }
  );

  it('covers the TALLEST and the SHORTEST shipped buildings at every seed it will ever be given', () => {
    // `beginCollapseShroud` seeds with the structure INDEX, so the seeds this
    // is asked for in a real mission are 0..structureCount. A jitter that
    // happens to be benign at one seed and opens a hole at another is exactly
    // what `COLLAPSE_SHROUD_COVER`'s margin exists to make impossible, so this
    // walks a spread of them rather than one.
    for (let seed = 0; seed < 40; seed++) {
      const tall = collapseShroudLayout(4.917, 4.885, 7.745, seed);
      expect(worstUncovered(tall, 4.917, 7.745, 4.885, 8), `apartment seed ${seed}`).toBeLessThan(0);
      const short = collapseShroudLayout(1.08, 1.08, 0.583, seed);
      expect(worstUncovered(short, 1.08, 0.583, 1.08, 8), `wall seed ${seed}`).toBeLessThan(0);
    }
  });

  it('keeps the cover multiple above what the jitter can spend', () => {
    // The guarantee: a point is at most one half-cell-diagonal from its own
    // cell centre, and the jitter moves that centre by at most `2 * JITTER`
    // half-diagonals. Raising the jitter without raising the cover opens
    // holes, so the relationship is asserted rather than left in a comment.
    expect(COLLAPSE_SHROUD_COVER).toBeGreaterThan(1 + 2 * COLLAPSE_SHROUD_JITTER);
  });

  it('never returns more puffs than the pool budgets for', () => {
    for (const [, w, h, d] of SHIPPED_BUILDINGS) {
      expect(collapseShroudLayout(w, d, h).length).toBeLessThanOrEqual(COLLAPSE_SHROUD_PUFFS_MAX);
    }
    // A building far larger than anything shipped still cannot overrun it.
    expect(collapseShroudLayout(60, 60, 60).length).toBe(COLLAPSE_SHROUD_PUFFS_MAX);
    expect(COLLAPSE_SHROUD_PUFFS_MAX).toBe(COLLAPSE_SHROUD_AXIS_MAX ** 3);
    expect(COLLAPSE_SHROUD_AXIS_MIN).toBeLessThan(COLLAPSE_SHROUD_AXIS_MAX);
  });

  it('scales with the building rather than using one constant size', () => {
    const wall = collapseShroudLayout(1.08, 1.08, 0.583);
    const apartment = collapseShroudLayout(4.917, 4.885, 7.745);
    const reach = (ps: ReturnType<typeof collapseShroudLayout>): number =>
      Math.max(...ps.map((p) => p.dy + p.radius));
    // The whole point: one size does not fit both. If the shroud stopped
    // reading the building's extents these would converge.
    expect(reach(apartment)).toBeGreaterThan(3 * reach(wall));
    expect(apartment.length).toBeGreaterThan(wall.length);
    // ...and the shortest thing in the game still gets a cloud big enough to
    // read as an event rather than a speck.
    expect(reach(wall)).toBeGreaterThan(0.5);
  });

  it('is deterministic for a given seed and genuinely varies between seeds', () => {
    const a = collapseShroudLayout(3.6, 2.767, 3.317, 11);
    const b = collapseShroudLayout(3.6, 2.767, 3.317, 11);
    const c = collapseShroudLayout(3.6, 2.767, 3.317, 12);
    expect(a).toEqual(b);
    expect(a.length).toBe(c.length);
    expect(a[0].radius).toBe(c[0].radius); // radii are size-derived, not seeded
    expect(a.some((p, i) => p.dx !== c[i].dx || p.dy !== c[i].dy || p.dz !== c[i].dz)).toBe(true);
  });

  it('keeps the lattice on and above the ground, never buried under it', () => {
    for (const [id, w, h, d] of SHIPPED_BUILDINGS) {
      for (const p of collapseShroudLayout(w, d, h, 3)) {
        expect(p.dy, `${id} puff centre below ground`).toBeGreaterThan(0);
      }
    }
  });

  it('gives every puff a non-negative growth and hold bonus', () => {
    // Both are what keeps the covering proof and the swap guarantee true: a
    // NEGATIVE growth would shrink a puff below the covering radius, and a
    // negative hold bonus would start one fading before the swap.
    for (const p of collapseShroudLayout(4.917, 4.885, 7.745, 5)) {
      expect(p.growth).toBeGreaterThanOrEqual(0);
      expect(p.growth).toBeLessThanOrEqual(COLLAPSE_SHROUD_GROWTH_SPREAD);
      expect(p.holdBonus).toBeGreaterThanOrEqual(0);
      expect(p.holdBonus).toBeLessThanOrEqual(COLLAPSE_SHROUD_HOLD_STAGGER);
    }
  });

  it('degrades to the floor lattice rather than throwing on a zero-extent building', () => {
    const puffs = collapseShroudLayout(0, 0, 0);
    expect(puffs.length).toBeGreaterThan(1);
    expect(puffs[0].radius).toBe(COLLAPSE_SHROUD_MIN_RADIUS);
  });

  it('never lays out a single-puff shroud, however small the building', () => {
    // One puff is one blended layer, and one layer's transmittance is
    // 1 - COLLAPSE_SHROUD_DENSITY however big you make it. Measured on the
    // shortest thing in the game: a 1x1x1 lattice hid 81.7% of the wall
    // panel's own swap and a 2x2x2 one hid 99.9%, at identical density.
    //
    // Asserted against the LITERAL requirement (more than one puff), never
    // against `COLLAPSE_SHROUD_AXIS_MIN ** 3` -- which is what this test said
    // first, and which made it a tautology: dropping the floor to 1 left it
    // green, because the expectation moved with the constant it was meant to
    // pin. That is the third time an assertion in this codebase's smoke work
    // has interpolated its own subject.
    for (const [id, w, h, d] of SHIPPED_BUILDINGS) {
      const puffs = collapseShroudLayout(w, d, h);
      expect(puffs.length, `${id} laid out only ${puffs.length} puff(s)`).toBeGreaterThan(1);
    }
    expect(collapseShroudLayout(0.01, 0.01, 0.01).length).toBeGreaterThan(1);
    expect(COLLAPSE_SHROUD_AXIS_MIN).toBeGreaterThanOrEqual(2);
  });

  it('derives the core fraction from the rim fade rather than carrying a loose number', () => {
    // `smoothstep(0, E, f)` reaches 0.9 at f = t*E where 3t^2 - 2t^3 = 0.9;
    // for a sphere |N.V| = sqrt(1 - (d/r)^2), so the 90%-density core is at
    // d/r = sqrt(1 - (t*E)^2). Changing COLLAPSE_SHROUD_EDGE_SOFTNESS without
    // changing COLLAPSE_SHROUD_RIM_CORE goes red here.
    let t = 0;
    for (let lo = 0, hi = 1, i = 0; i < 60; i++) {
      t = (lo + hi) / 2;
      if (3 * t * t - 2 * t * t * t < 0.9) lo = t;
      else hi = t;
    }
    const f = t * COLLAPSE_SHROUD_EDGE_SOFTNESS;
    expect(COLLAPSE_SHROUD_RIM_CORE).toBeCloseTo(Math.sqrt(1 - f * f), 2);
  });
});

describe('collapseShroudBloom', () => {
  it('starts gathered, reaches exactly 1 at the end of the bloom, and keeps spreading', () => {
    expect(collapseShroudBloom(0)).toBeCloseTo(COLLAPSE_SHROUD_BLOOM_MIN, 10);
    expect(collapseShroudBloom(COLLAPSE_SHROUD_BLOOM_FRACTION)).toBeCloseTo(1, 10);
    expect(collapseShroudBloom(1)).toBeCloseTo(COLLAPSE_SHROUD_BLOOM_MAX, 10);
  });

  it('NEVER contracts -- dust that draws back in is a cloud being sucked into the ground', () => {
    let prev = -Infinity;
    for (let p = 0; p <= 1.0001; p += 0.005) {
      const v = collapseShroudBloom(p);
      expect(v, `bloom went backwards at progress ${p.toFixed(3)}`).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = v;
    }
  });

  it('clamps outside [0, 1] rather than reading past either end', () => {
    expect(collapseShroudBloom(-3)).toBeCloseTo(COLLAPSE_SHROUD_BLOOM_MIN, 10);
    expect(collapseShroudBloom(9)).toBeCloseTo(COLLAPSE_SHROUD_BLOOM_MAX, 10);
  });
});

describe('collapseShroudDensity', () => {
  it('rises over the bloom, holds at exactly 1, and dissolves to exactly 0', () => {
    expect(collapseShroudDensity(0)).toBe(0);
    expect(collapseShroudDensity(COLLAPSE_SHROUD_BLOOM_FRACTION)).toBeCloseTo(1, 10);
    expect(collapseShroudDensity(COLLAPSE_SHROUD_HOLD_FRACTION)).toBe(1);
    expect(collapseShroudDensity(1)).toBeCloseTo(0, 10);
  });

  it('never lets a hold bonus ADVANCE a fade', () => {
    // The swap guarantee is "every puff is at full density for the whole
    // nominal hold". A hold bonus that could bring a fade forward would break
    // it for that one puff and open a window in the cloud at exactly the
    // wrong moment.
    for (let p = 0; p <= 1.0001; p += 0.01) {
      for (const bonus of [0, 0.05, COLLAPSE_SHROUD_HOLD_STAGGER]) {
        expect(
          collapseShroudDensity(p, bonus),
          `bonus ${bonus} thinned puff early at progress ${p.toFixed(2)}`
        ).toBeGreaterThanOrEqual(collapseShroudDensity(p, 0) - 1e-12);
      }
    }
  });

  it('leaves EVERY puff fully dense for the whole nominal hold', () => {
    for (let p = COLLAPSE_SHROUD_BLOOM_FRACTION; p <= COLLAPSE_SHROUD_HOLD_FRACTION; p += 0.005) {
      for (const bonus of [0, COLLAPSE_SHROUD_HOLD_STAGGER / 2, COLLAPSE_SHROUD_HOLD_STAGGER]) {
        expect(collapseShroudDensity(p, bonus), `progress ${p.toFixed(3)} bonus ${bonus}`).toBe(1);
      }
    }
  });

  it('actually staggers -- two puffs with different bonuses thin at different times', () => {
    // Without this the "ruin comes through gaps rather than a uniform dimming"
    // claim is unbacked. A stagger of 0 would leave the whole cloud in
    // lockstep and this goes red.
    const p = COLLAPSE_SHROUD_HOLD_FRACTION + COLLAPSE_SHROUD_HOLD_STAGGER / 2;
    expect(collapseShroudDensity(p, 0)).toBeLessThan(1);
    expect(collapseShroudDensity(p, COLLAPSE_SHROUD_HOLD_STAGGER)).toBe(1);
    // ...and the stagger constant is a real fraction of the life, not a token
    // one the assertion above would pass with. (Range-bounded rather than
    // interpolated, so shrinking it toward zero fails here.)
    expect(COLLAPSE_SHROUD_HOLD_STAGGER).toBeGreaterThan(0.05);
    expect(COLLAPSE_SHROUD_HOLD_STAGGER).toBeLessThan(1 - COLLAPSE_SHROUD_HOLD_FRACTION);
  });
});

describe('the mesh swap lands inside the dense plateau', () => {
  it('places the swap past the bloom and short of the fade', () => {
    // THE load-bearing assertion of this whole module. If the swap drifts
    // outside this window the intact->wreck cut is visible again and the
    // effect has failed, however good the cloud looks.
    const swap = collapseShroudSwapProgress();
    expect(swap).toBeGreaterThan(COLLAPSE_SHROUD_BLOOM_FRACTION);
    expect(swap).toBeLessThan(COLLAPSE_SHROUD_HOLD_FRACTION);
  });

  it('has the shroud fully grown and fully dense at that instant, for every puff', () => {
    const swap = collapseShroudSwapProgress();
    expect(collapseShroudBloom(swap)).toBeGreaterThanOrEqual(1);
    for (const bonus of [0, COLLAPSE_SHROUD_HOLD_STAGGER]) {
      expect(collapseShroudDensity(swap, bonus)).toBe(1);
    }
  });

  it('still covers the tallest shipped building at the bloom scale the swap sees', () => {
    // The covering proof is stated for bloom >= 1; this checks the number the
    // swap actually lands on, on the building it is hardest for.
    const scale = collapseShroudBloom(collapseShroudSwapProgress());
    const puffs = collapseShroudLayout(4.917, 4.885, 7.745, 3).map((p) => ({
      ...p,
      dx: p.dx * scale,
      dy: p.dy * scale,
      dz: p.dz * scale,
      radius: p.radius * scale,
    }));
    expect(worstUncovered(puffs, 4.917, 7.745, 4.885, 10)).toBeLessThan(0);
  });

  it('leaves the shroud gone well before the plume it hands over to', () => {
    expect(COLLAPSE_SHROUD_DURATION_MS).toBeLessThan(SMOKE_PLUME_DEFAULT_DURATION_MS);
    expect(COLLAPSE_SHROUD_SWAP_DELAY_MS).toBeLessThan(COLLAPSE_SHROUD_DURATION_MS);
  });
});

describe('createCollapseShroudMaterial', () => {
  it('composites rather than pinning alpha to 1 -- the plume defect, not repeated', () => {
    // `createVfxMeshMaterial`'s `vec4(uColor, 1.0)` is what made the smoke
    // plume a cardboard cutout (76d3a4d). Matching on the ASSIGNMENT's own
    // shape rather than on a substring that a comment could satisfy: a
    // previous smoke test passed against the GLSL COMMENT that named the
    // expression instead of the expression.
    const src = createCollapseShroudMaterial().fragmentShader;
    expect(src).toMatch(/gl_FragColor\s*=\s*vec4\(vColor,\s*a\);/);
    expect(src).toMatch(/float a = [0-9.]+ \* vOpacity \* rim;/);
    expect(src).not.toMatch(/gl_FragColor\s*=\s*vec4\([^)]*,\s*1\.0\)/);
  });

  it('fades its own rim from the view-facing term', () => {
    expect(createCollapseShroudMaterial().fragmentShader).toMatch(
      /float rim = smoothstep\(0\.0, [0-9.]+, vFacing\);/
    );
  });

  it('is denser than ambient smoke, and that is the whole point', () => {
    // Range-bounded rather than compared to an interpolated copy of itself:
    // the assertion has to fail if somebody "restores" this to plume levels.
    expect(COLLAPSE_SHROUD_DENSITY).toBeGreaterThan(SMOKE_PLUME_DENSITY);
    // SMOKE_ALPHA_CEIL (0.80), not the old SMOKE_ALPHA_MAX (0.72, retired
    // 2026-09-06 when ambient smoke moved from a flat multiplier to a
    // density curve) -- see smoke-mesh.ts's own "Why 0.80, not 0.85"
    // section: that curve's own ceiling was deliberately solved to stay
    // BELOW this constant, precisely so this assertion keeps holding.
    expect(COLLAPSE_SHROUD_DENSITY).toBeGreaterThan(SMOKE_ALPHA_CEIL);
    expect(COLLAPSE_SHROUD_DENSITY).toBeLessThan(1);
  });

  it('feathers a much wider band than the plume, because a sphere is not a lumpy hull', () => {
    expect(COLLAPSE_SHROUD_EDGE_SOFTNESS).toBeGreaterThan(0.6);
    expect(COLLAPSE_SHROUD_EDGE_SOFTNESS).toBeLessThan(1);
  });

  it('draws as smoke does: blended, never depth-tested, never depth-written', () => {
    const m = createCollapseShroudMaterial();
    expect(m.transparent).toBe(true);
    expect(m.depthTest).toBe(false);
    expect(m.depthWrite).toBe(false);
    expect(m.blending).toBe(THREE.NormalBlending);
  });
});

describe('CollapseShroudManager', () => {
  it('draws nothing until something collapses', () => {
    const m = new CollapseShroudManager();
    m.step(16);
    expect(m.liveCount).toBe(0);
    expect(m.instanceCount).toBe(0);
    expect(m.mesh.renderOrder).toBe(SMOKE_RENDER_ORDER);
    m.dispose();
  });

  it('writes one instance per puff and retires the shroud at end of life', () => {
    const m = new CollapseShroudManager();
    m.spawn(10, 0, 12, 3.6, 2.767, 3.317, 1);
    m.step(16);
    const expected = collapseShroudLayout(3.6, 2.767, 3.317, 1).length;
    expect(m.liveCount).toBe(1);
    expect(m.instanceCount).toBe(expected);
    m.step(COLLAPSE_SHROUD_DURATION_MS);
    expect(m.liveCount).toBe(0);
    expect(m.instanceCount).toBe(0);
    m.dispose();
  });

  it('anchors every puff on the building, and scales uniformly', () => {
    const m = new CollapseShroudManager();
    m.spawn(20, 5, 30, 3.6, 2.767, 3.317, 2);
    m.step(COLLAPSE_SHROUD_SWAP_DELAY_MS);
    const mat = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (let i = 0; i < m.instanceCount; i++) {
      m.mesh.getMatrixAt(i, mat);
      mat.decompose(pos, quat, scale);
      expect(Math.hypot(pos.x - 20, pos.z - 30)).toBeLessThan(8);
      expect(pos.y).toBeGreaterThan(5); // sits on the building's ground, not the world origin
      // Uniform: the material skips the plume's inverse-scale normal
      // correction on exactly this assumption.
      expect(scale.y).toBeCloseTo(scale.x, 10);
      expect(scale.z).toBeCloseTo(scale.x, 10);
    }
    m.dispose();
  });

  it('holds every puff at full opacity at the instant of the swap', () => {
    const m = new CollapseShroudManager();
    m.spawn(0, 0, 0, 4.917, 4.885, 7.745, 4);
    m.step(COLLAPSE_SHROUD_SWAP_DELAY_MS);
    const a = m.mesh.geometry.getAttribute('aOpacity') as THREE.InstancedBufferAttribute;
    for (let i = 0; i < m.instanceCount; i++) {
      expect(a.getX(i), `puff ${i} was already thinning at the swap`).toBe(1);
    }
    m.dispose();
  });

  it('evicts the oldest shroud rather than overrunning the pool', () => {
    const m = new CollapseShroudManager(2);
    m.spawn(0, 0, 0, 3, 3, 3, 1);
    m.spawn(1, 0, 1, 3, 3, 3, 2);
    m.spawn(2, 0, 2, 3, 3, 3, 3);
    m.step(16);
    expect(m.liveCount).toBe(2);
    m.dispose();
  });

  it('refuses a zero-length shroud', () => {
    const m = new CollapseShroudManager();
    m.spawn(0, 0, 0, 3, 3, 3, 0, 0);
    m.step(16);
    expect(m.liveCount).toBe(0);
    m.dispose();
  });

  it('resolves its three shades through the palette, never a literal', () => {
    const asked: string[] = [];
    const m = new CollapseShroudManager();
    m.setColors((key) => {
      asked.push(key);
      return '#C29455';
    });
    expect(asked).toEqual(['dust.4', 'dust.2', 'dust.1']);
    expect((m.mesh.material as THREE.ShaderMaterial).uniforms.uBody.value).toBeInstanceOf(THREE.Color);
    m.dispose();
  });

  it('sizes its pool for the worst case a caller can reach', () => {
    const m = new CollapseShroudManager();
    for (let i = 0; i < COLLAPSE_SHROUD_CAPACITY; i++) m.spawn(i, 0, 0, 60, 60, 60, i);
    m.step(16);
    expect(m.instanceCount).toBe(COLLAPSE_SHROUD_CAPACITY * COLLAPSE_SHROUD_PUFFS_MAX);
    m.dispose();
  });
});

describe('collapseShroudPuffGeometry', () => {
  it('is a smooth unit sphere -- a faceted normal would break the rim fade', () => {
    const g = collapseShroudPuffGeometry();
    const pos = g.getAttribute('position');
    const nrm = g.getAttribute('normal');
    expect(pos.count).toBe(nrm.count);
    for (let i = 0; i < pos.count; i += 17) {
      const r = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
      expect(r).toBeCloseTo(1, 5);
      // Exactly radial: the normal IS the normalised position, which is what
      // makes `abs(viewNormal.z)` read as "how much sphere is behind this
      // pixel" rather than as a per-face constant.
      expect(nrm.getX(i)).toBeCloseTo(pos.getX(i) / r, 5);
      expect(nrm.getY(i)).toBeCloseTo(pos.getY(i) / r, 5);
    }
    g.dispose();
  });
});
