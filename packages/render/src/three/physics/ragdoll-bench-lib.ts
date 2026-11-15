/**
 * GH-1400 Q1: the pure half of the ragdoll CPU bench (`ragdoll-bench.test.ts`): statistics, a synthetic figure, a ground patch.
 *
 * Why this lives under `three/physics/` and not `tools/`: the physics fence (`tools/physics_fence.mjs`, GH-1223) lets only this
 * folder, `ThreeRenderer.ts` and the three folder's own specs import the physics code, and a script in `tools/` importing
 * `ragdoll-world` would be a crossing. Nothing here is imported by the renderer, so it adds no byte to a bundle.
 *
 * Three-free and sim-free like the world it feeds. The figure is SYNTHETIC: eleven bodies with the topology `ragdoll-rig.ts`
 * builds from a rig.py figure (pelvis, spine, neck with the head merged, two upper arms, two forearms, two thighs, two shins;
 * the four forearm and shin bodies are hinges, the rest balls), human-sized, not read from a GLB. What the bench measures is
 * Rapier's cost for that body count and joint count, which is what the cap buys.
 */
import type { Q4, RagdollBodySpec, RagdollFigureSpec, V3 } from './ragdoll-world';

export interface Summary {
  readonly n: number;
  readonly min: number;
  readonly median: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
  readonly mean: number;
}

/** The p-th percentile (0 to 100) of an ASCENDING array, nearest-rank: the smallest value with at least p% of the sample at or below it. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new Error('percentile of an empty sample');
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function summarise(xs: readonly number[]): Summary {
  if (xs.length === 0) throw new Error('summarise of an empty sample');
  const s = [...xs].sort((a, b) => a - b);
  let sum = 0;
  for (const x of s) sum += x;
  return { n: s.length, min: s[0], median: percentile(s, 50), p95: percentile(s, 95), p99: percentile(s, 99), max: s[s.length - 1], mean: sum / s.length };
}

function quatFromYTo(d: V3): Q4 {
  const dot = d[1];
  if (dot < -0.9999) return [1, 0, 0, 0];
  const x = d[2];
  const z = -d[0];
  const w = 1 + dot;
  const n = Math.hypot(x, z, w) || 1;
  return [x / n, 0, z / n, w / n];
}

interface Segment {
  readonly from: V3;
  readonly to: V3;
  readonly radius: number;
  readonly parent: number;
  readonly hinge: boolean;
}

/** The eleven link bodies of a standing figure, metres, facing +z, feet on y = 0. Parents come before children. */
const STANDING: readonly Segment[] = [
  { from: [0, 0.92, 0], to: [0, 1.02, 0], radius: 0.14, parent: -1, hinge: false }, // pelvis
  { from: [0, 1.02, 0], to: [0, 1.38, 0], radius: 0.15, parent: 0, hinge: false }, // spine
  { from: [0, 1.38, 0], to: [0, 1.68, 0], radius: 0.1, parent: 1, hinge: false }, // neck and head
  { from: [0.2, 1.35, 0], to: [0.22, 1.08, 0], radius: 0.05, parent: 1, hinge: false }, // upper arm L
  { from: [0.22, 1.08, 0], to: [0.22, 0.82, 0.05], radius: 0.04, parent: 3, hinge: true }, // forearm L
  { from: [-0.2, 1.35, 0], to: [-0.22, 1.08, 0], radius: 0.05, parent: 1, hinge: false }, // upper arm R
  { from: [-0.22, 1.08, 0], to: [-0.22, 0.82, 0.05], radius: 0.04, parent: 5, hinge: true }, // forearm R
  { from: [0.09, 0.95, 0], to: [0.09, 0.5, 0], radius: 0.07, parent: 0, hinge: false }, // thigh L
  { from: [0.09, 0.5, 0], to: [0.09, 0.06, 0], radius: 0.06, parent: 7, hinge: true }, // shin L
  { from: [-0.09, 0.95, 0], to: [-0.09, 0.5, 0], radius: 0.07, parent: 0, hinge: false }, // thigh R
  { from: [-0.09, 0.5, 0], to: [-0.09, 0.06, 0], radius: 0.06, parent: 9, hinge: true }, // shin R
];

/** Bodies per synthetic figure (a rig.py figure under `ragdoll-rig.ts`: 11). */
export const BODIES_PER_FIGURE = STANDING.length;
/** Hinge joints per figure (elbows and knees). */
export const HINGES_PER_FIGURE = STANDING.filter((s) => s.hinge).length;

/** One standing figure at (x, z) metres, handed off with the push `ragdoll-rig.ts` gives (about 1 m/s away, 0.4 up) and a topple spin. */
export function syntheticFigure(x: number, z: number): RagdollFigureSpec {
  const bodies: RagdollBodySpec[] = STANDING.map((s) => {
    const dx = s.to[0] - s.from[0];
    const dy = s.to[1] - s.from[1];
    const dz = s.to[2] - s.from[2];
    const len = Math.hypot(dx, dy, dz);
    const dir: V3 = [dx / len, dy / len, dz / len];
    return {
      parent: s.parent,
      at: [s.from[0] + x, s.from[1], s.from[2] + z],
      capsule: {
        centre: [(s.from[0] + s.to[0]) / 2 + x, (s.from[1] + s.to[1]) / 2, (s.from[2] + s.to[2]) / 2 + z],
        rot: quatFromYTo(dir),
        halfHeight: Math.max(0.01, len / 2 - s.radius),
        radius: s.radius,
      },
      hinge: s.hinge ? [1, 0, 0] : null,
      linvel: [0.7, 0.4, 0.3],
      angvel: [1.5, 0, 0],
    };
  });
  return { bodies };
}

/** `n` figures in a tight cluster (0.8 m apart), the way a squad falls. Centred on the origin. */
export function squad(n: number, originX = 0, originZ = 0): RagdollFigureSpec[] {
  const cols = Math.ceil(Math.sqrt(n));
  return Array.from({ length: n }, (_, i) => syntheticFigure(originX + (i % cols) * 0.8, originZ + Math.floor(i / cols) * 0.8));
}

/** The drawn ground under an incident: a `cells` x `cells` grid over `size` metres, y = 0 with a small fixed ripple (never degenerate flat). */
export function groundPatch(size = 48, cells = 24): { vertices: Float32Array; indices: Uint32Array } {
  const stride = cells + 1;
  const vertices = new Float32Array(stride * stride * 3);
  for (let j = 0; j <= cells; j++) {
    for (let i = 0; i <= cells; i++) {
      const o = (j * stride + i) * 3;
      vertices[o] = (i / cells - 0.5) * size;
      vertices[o + 1] = 0.02 * Math.sin(i * 1.7) * Math.cos(j * 1.3);
      vertices[o + 2] = (j / cells - 0.5) * size;
    }
  }
  const indices = new Uint32Array(cells * cells * 6);
  let k = 0;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const a = j * stride + i;
      indices.set([a, a + stride, a + 1, a + 1, a + stride, a + stride + 1], k);
      k += 6;
    }
  }
  return { vertices, indices };
}

/**
 * A burst: `figures` deaths spread over `ticks` consecutive ticks, grouped into entities of `perEntity` figures (an `inf_squad` is 3).
 * Returns one entry per entity: the tick it dies on and how many figures it holds. Deaths are dealt round-robin over the ticks, so the
 * spread is even, and the last entity takes the remainder.
 */
export function burstSchedule(figures: number, perEntity: number, ticks: number): { tick: number; figures: number }[] {
  const out: { tick: number; figures: number }[] = [];
  let left = figures;
  for (let e = 0; left > 0; e++) {
    const f = Math.min(perEntity, left);
    out.push({ tick: e % ticks, figures: f });
    left -= f;
  }
  return out;
}
