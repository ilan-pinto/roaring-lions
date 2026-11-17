/**
 * The carbine's length on a skinned Meshy team, read off the SHIPPED bytes (GH-826, infantry upgrade unit 1).
 *
 * Why it exists. The skinned importer refuses a Meshy carbine outside 0.72-0.98 m (`GUN_LEN_BAND`), but that is an
 * import-time refusal: nothing read the length from `art/meshes/<team>.glb`, so a file built another way (a row's band
 * widened, a graft's sections edited) shipped whatever it had. This reads it: per figure, the extent of the `weapon`
 * role's vertices along their own principal axis, in the bind pose. Nothing is imported from the importer and the
 * stamped `rl_hands` frame is not consulted: the axis is the point cloud's own.
 *
 * The bands are literals:
 *  - every skinned team: each man's carbine within the global band, scaled by nothing (0.72-0.98 m);
 *  - `demo_squad` has a band of its OWN (the lead's ruling of 13 Nov 2026): Meshy sculpted its carbine with a bare buffer
 *    tube, 0.625 m; a collapsed stock is grafted on in the importer and the team is pinned at the grafted length, "a real
 *    engineer's short carbine". It is a ratchet, per man (the two men are scalings of one body, so their guns differ):
 *    it may not get shorter, and a longer one is a new ruling. The global band is NOT widened for it.
 *
 * Falsified (run, watched red, put back by hand), 13 Nov 2026:
 *  - the implementation: the importer row's last stock section moved from e -0.055 to -0.040 (a 15 mm shorter stock),
 *    the team rebuilt (through the review switch) and put in `art/meshes`: demo_a 0.661 against 0.665-0.675 and demo_b
 *    0.729 against 0.734-0.744, both red; the bytes restored. With the section before it moved too (-0.045 to -0.030)
 *    the importer's own band refused the build: "0.665 m with its grafted stock, outside (0.67, 0.69)";
 *  - the bytes: the constructed inputs at the bottom (a carbine with its rear pulled in reads short; the Rifle Squad
 *    read against the engineers' band is red, so the bands are not interchangeable).
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { GlbFile } from './mesh_gait';
import { figureBuilds, infantryTeams, owns, readRoleMeshes } from './mesh_figures';
import { handsSource } from './mesh_hand_gates';

const MESHES = fileURLToPath(new URL('../../art/meshes/', import.meta.url));

/** Metres. The importer's global band for a Meshy carbine. */
const GLOBAL_BAND: readonly [number, number] = [0.72, 0.98];
/** A team's own band, per man: [min, max] metres. A ratchet at the shipped length, +-5 mm for the reading. */
const OWN_BAND: Readonly<Record<string, Readonly<Record<string, readonly [number, number]>>>> = {
  // the lead's ruling of 13 Nov 2026 (GH-826 unit 1): the grafted collapsed stock, 0.680 m on the base body
  // read 13 Nov on the shipped bytes: demo_a (the body x0.98 across) 0.6702, demo_b (x1.08) 0.7389
  demo_squad: { demo_a: [0.665, 0.675], demo_b: [0.734, 0.744] },
};

type V3 = [number, number, number];

/** A figure's weapon vertices in the bind pose: the `weapon` role mesh's vertices its bones own. */
function weaponPoints(glb: GlbFile, prefix: string, shorten = 0): V3[] {
  const out: V3[] = [];
  for (const m of readRoleMeshes(glb)) {
    if (m.role !== 'weapon') continue;
    for (let i = 0; i < m.pos.count; i++) {
      if (!owns(prefix, m.joint[i])) continue;
      out.push([m.pos.data[i * 3], m.pos.data[i * 3 + 1], m.pos.data[i * 3 + 2]]);
    }
  }
  if (shorten > 0) {
    // the constructed failing input: every vertex in the rear `shorten` metres pulled forward to that station
    const { c, axis } = principal(out);
    const proj = out.map((p) => (p[0] - c[0]) * axis[0] + (p[1] - c[1]) * axis[1] + (p[2] - c[2]) * axis[2]);
    const lo = Math.min(...proj);
    return out.map((p, i) => {
      const d = lo + shorten - proj[i];
      return d > 0 ? ([p[0] + axis[0] * d, p[1] + axis[1] * d, p[2] + axis[2] * d] as V3) : p;
    });
  }
  return out;
}

/** The point cloud's centroid and principal axis (power iteration on its covariance), the axis pointing to +X. */
function principal(points: readonly V3[]): { c: V3; axis: V3 } {
  const n = points.length;
  const c: V3 = [0, 0, 0];
  for (const p of points) for (let k = 0; k < 3; k++) c[k] += p[k] / n;
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of points) {
    const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 3 + j] += d[i] * d[j];
  }
  let v: V3 = [1, 0.1, 0.05];
  for (let it = 0; it < 96; it++) {
    const w: V3 = [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
    const l = Math.hypot(w[0], w[1], w[2]);
    v = [w[0] / l, w[1] / l, w[2] / l];
  }
  return { c, axis: v[0] < 0 ? [-v[0], -v[1], -v[2]] : v };
}

/** The carbine's length: its vertices' extent along their own principal axis, metres. */
function gunLength(points: readonly V3[]): number {
  const { c, axis } = principal(points);
  let lo = Infinity, hi = -Infinity;
  for (const p of points) {
    const e = (p[0] - c[0]) * axis[0] + (p[1] - c[1]) * axis[1] + (p[2] - c[2]) * axis[2];
    lo = Math.min(lo, e); hi = Math.max(hi, e);
  }
  return hi - lo;
}

const bandOf = (team: string, fig: string): readonly [number, number] => OWN_BAND[team]?.[fig] ?? GLOBAL_BAND;

const skinned = infantryTeams(MESHES, (d) => readdirSync(d)).filter(([, g]) => handsSource(g) === 'meshy');
const rows = skinned.flatMap(([team, glb]) => figureBuilds(glb).map((fig) => [team, fig, glb] as [string, string, GlbFile]));

describe('the carbine of a skinned Meshy team is a carbine long', () => {
  it('reads the population it says it reads', () => {
    expect(skinned.map(([t]) => t).sort()).toEqual(['demo_squad', 'inf_squad']);
    expect(rows.map(([t, f]) => `${t}/${f}`).sort()).toEqual(['demo_squad/demo_a', 'demo_squad/demo_b', 'inf_squad/f0', 'inf_squad/f1', 'inf_squad/f2']);
    for (const [team, fig, glb] of rows) expect(weaponPoints(glb, fig).length, `${team}/${fig}: weapon vertices`).toBeGreaterThan(300);
  });

  it('a band of its own names a real team and every one of its men', () => {
    for (const [team, men] of Object.entries(OWN_BAND)) {
      const glb = skinned.find(([t]) => t === team)?.[1];
      expect(glb, `${team}: a band for a team that is not a skinned infantry GLB`).toBeDefined();
      expect(Object.keys(men).sort()).toEqual(figureBuilds(glb!));
      for (const [lo, hi] of Object.values(men)) expect(hi - lo, 'a ratchet, not a range: 10 mm for the reading').toBeLessThanOrEqual(0.0101);
    }
  });

  it.each(rows)('%s %s: inside its band', (team, fig, glb) => {
    const len = gunLength(weaponPoints(glb, fig));
    const [lo, hi] = bandOf(team, fig);
    expect(len, `${team}/${fig}: the carbine reads ${len.toFixed(3)} m, its band is ${lo}-${hi}`).toBeGreaterThanOrEqual(lo);
    expect(len, `${team}/${fig}: the carbine reads ${len.toFixed(3)} m, its band is ${lo}-${hi}`).toBeLessThanOrEqual(hi);
  });
});

describe('the gun-length reading can fail (constructed inputs)', () => {
  const demo = skinned.find(([t]) => t === 'demo_squad')![1];
  const squad = skinned.find(([t]) => t === 'inf_squad')![1];
  it('the engineers\' carbine with its rear 55 mm pulled in (the stock off: the bare tube) is under its band', () => {
    for (const fig of ['demo_a', 'demo_b']) {
      const whole = gunLength(weaponPoints(demo, fig));
      const cut = gunLength(weaponPoints(demo, fig, 0.055));
      expect(whole - cut).toBeGreaterThan(0.045);
      expect(cut).toBeLessThan(bandOf('demo_squad', fig)[0]);
    }
  });
  it('demo_a\'s carbine is under the global band: the team\'s own band is doing the work, and is not the global one', () => {
    // (demo_b is the same carbine on a body 8 % wider: 0.739, over the global floor; his own band still pins him)
    expect(gunLength(weaponPoints(demo, 'demo_a'))).toBeLessThan(GLOBAL_BAND[0]);
    expect(bandOf('demo_squad', 'demo_b')[1]).toBeLessThan(GLOBAL_BAND[1] - 0.2);
  });
  it('the Rifle Squad read against the engineers\' band is red: the bands are not interchangeable', () => {
    const len = gunLength(weaponPoints(squad, 'f1'));
    expect(len).toBeGreaterThan(OWN_BAND.demo_squad.demo_b[1]);
  });
});
