// The lead's standing rule (22 Oct 2026), on the exported bytes: a crew cut
// from ONE Meshy body has figures of DIFFERENT builds (one taller, one
// stronger, one heavier), and every figure carries at least one weapon --
// a crewman whose hands are on the equipment carries his rifle slung.
//
// `tools/units/crew_builds.py` is the table and refuses a table that breaks
// either half before Blender cuts anything; this repeats both on what
// shipped, so an importer that read the table and then ignored it (a build
// never applied, a rifle never bound to a figure) cannot pass.
//
// Shape is read in each figure's STANDING body (the walker of a kneeler, or
// the figure itself), in bind pose, from its own bones' vertices: standing
// height, chest width (the spine's vertices at 0.70-0.80 of that height),
// and waist width and depth (spine and pelvis at 0.50-0.60). Two figures
// closer than SAME_TOL in EVERY measure are the same body. Arm girth is NOT
// one of the measures: read in bind pose it moved 0.084 -> 0.057 m between
// the walkers and the leader on the pre-rule file, three copies of ONE
// body -- the motion pass's hold reworks the leader's arms -- so it would
// call identical bodies different. The strong build is told apart by its
// chest; its arm girth is the importer's log.
//
// Falsified (22 Oct), three ways, each red on exactly its own half:
// - the pre-rule `at_nlos_team.glb` (three copies of one crewman, only the
//   leader armed): both red -- every pair 0.0% apart (1.760 / 0.516 / 0.420
//   / 0.423 m), and nl_gun, nl_gunw, nl_load, nl_loadw bare;
// - `_body_variant` made a no-op, re-imported: the build test red, 0.0%;
// - the slung rifles dropped (`parts += slung` removed), re-imported: the
//   weapon test red, the same four bodies bare.
// Shipped: nl_gun 1.760 / 0.516 / 0.463 / 0.478 (heavier), nl_load 1.760 /
// 0.561 / 0.416 / 0.423 (strong), nl_lead 1.866 / 0.532 / 0.428 / 0.432 (tall).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readAccessor, readGlb } from './mesh_gait';

const MESHES = fileURLToPath(new URL('../../art/meshes/', import.meta.url));

/** Crews held to the rule (it post-dates every other team). */
const VARIED_CREWS: readonly string[] = ['at_nlos_team.glb'];
const SAME_TOL = 0.03;
const MIN_WEAPON_VERTS = 20;

interface Body { verts: { p: [number, number, number]; joint: string; role: string }[] }

function bodies(path: string): { figures: string[]; standing: Map<string, string>; living: string[]; byBody: Map<string, Body> } {
  const glb = readGlb(path);
  const nodes = glb.json.nodes ?? [];
  const meshes = glb.json.meshes ?? [];
  const names = nodes.map((n) => n.name ?? '');
  const roots = names.filter((n) => /_root$/.test(n) && !/_death_root$/.test(n)).map((n) => n.replace(/_root$/, ''));
  const rootSet = new Set(roots);
  const walkers = roots.filter((r) => r.endsWith('w') && rootSet.has(r.slice(0, -1)));
  const figures = roots.filter((r) => !walkers.includes(r));
  const standing = new Map(figures.map((f) => [f, rootSet.has(`${f}w`) ? `${f}w` : f]));
  const byBody = new Map<string, Body>(roots.map((r) => [r, { verts: [] }]));
  // Longest prefix first, so `nl_gunw_spine` is never read as `nl_gun`'s.
  const order = [...roots].sort((a, b) => b.length - a.length);
  for (const n of nodes) {
    if (n.mesh === undefined || n.skin === undefined) continue;
    const role = n.name ?? '';
    const skin = glb.json.skins![n.skin];
    for (const prim of meshes[n.mesh].primitives) {
      const pos = readAccessor(glb, prim.attributes.POSITION);
      const J = readAccessor(glb, prim.attributes.JOINTS_0);
      const W = readAccessor(glb, prim.attributes.WEIGHTS_0);
      for (let i = 0; i < pos.count; i++) {
        let b = 0;
        for (let k = 1; k < 4; k++) if (W.data[i * 4 + k] > W.data[i * 4 + b]) b = k;
        const joint = names[skin.joints[J.data[i * 4 + b]]];
        if (/_death/.test(joint)) continue;
        const owner = order.find((r) => joint.startsWith(`${r}_`));
        if (!owner) continue;
        byBody.get(owner)!.verts.push({ p: [pos.data[i * 3], pos.data[i * 3 + 1], pos.data[i * 3 + 2]], joint, role });
      }
    }
  }
  return { figures, standing, living: roots, byBody };
}

function extent(vals: number[]): number {
  return vals.length ? Math.max(...vals) - Math.min(...vals) : 0;
}

/** glTF: +Y up, +X forward, Blender's +Y left is -Z. */
function build(prefix: string, body: Body): Record<string, number> {
  const flesh = body.verts.filter((v) => v.role !== 'weapon' && v.role !== 'metal');
  const ys = flesh.map((v) => v.p[1]);
  const lo = Math.min(...ys);
  const h = Math.max(...ys) - lo;
  const band = (j: RegExp, a: number, b: number) =>
    flesh.filter((v) => j.test(v.joint) && v.p[1] > lo + a * h && v.p[1] < lo + b * h).map((v) => v.p);
  const spine = new RegExp(`^${prefix}_spine$`);
  const trunk = new RegExp(`^${prefix}_(spine|pelvis)$`);
  const chest = band(spine, 0.7, 0.8);
  const waist = band(trunk, 0.5, 0.6);
  return {
    heightM: h,
    chestWidthM: extent(chest.map((p) => p[2])),
    waistWidthM: extent(waist.map((p) => p[2])),
    waistDepthM: extent(waist.map((p) => p[0])),
  };
}

describe('a crew cut from one body: different builds, every man armed (the 22 Oct rule)', () => {
  for (const file of VARIED_CREWS) {
    const path = `${MESHES}${file}`;

    it(`${file}: no two figures share a build`, () => {
      expect(existsSync(path), path).toBe(true);
      const { figures, standing, byBody } = bodies(path);
      expect(figures.length, `${file}: figures`).toBeGreaterThanOrEqual(2);
      const reads = new Map(figures.map((f) => {
        const s = standing.get(f)!;
        const b = build(s, byBody.get(s)!);
        // Not vacuous: every measure read something.
        for (const [k, v] of Object.entries(b)) expect(v, `${file} ${s} ${k}`).toBeGreaterThan(0.02);
        return [f, b] as const;
      }));
      const table = [...reads].map(([f, b]) => `${f}: ` + Object.entries(b).map(([k, v]) => `${k} ${v.toFixed(3)}`).join(', '));
      for (let i = 0; i < figures.length; i++) {
        for (let j = i + 1; j < figures.length; j++) {
          const a = reads.get(figures[i])!, b = reads.get(figures[j])!;
          const worst = Math.max(...Object.keys(a).map((k) => Math.abs(a[k] / b[k] - 1)));
          expect(worst, `${file}: ${figures[i]} vs ${figures[j]} differ by at most ${(worst * 100).toFixed(1)}% in any measure\n${table.join('\n')}`)
            .toBeGreaterThan(SAME_TOL);
        }
      }
    });

    it(`${file}: every living body carries a weapon on its own bones`, () => {
      const { living, byBody } = bodies(path);
      const bare = living.filter((p) => byBody.get(p)!.verts.filter((v) => v.role === 'weapon').length < MIN_WEAPON_VERTS);
      expect(living.length, `${file}: living bodies`).toBeGreaterThanOrEqual(2);
      expect(bare, `${file}: bodies with fewer than ${MIN_WEAPON_VERTS} weapon vertices on their own bones`).toEqual([]);
    });
  }
});
