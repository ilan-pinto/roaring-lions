/**
 * No cloth on the gun: the `weapon` role of a skinned Meshy team carries no sleeve- or glove-coloured faces (GH-826,
 * infantry upgrade unit 1; the Opus review of 13 Nov 2026, B3).
 *
 * Why it exists. Meshy sculpts the gun fused to the vest and the fists. The importer sends the faces along that line (one
 * gun vertex, the others on the body) to the weapon mesh as a rigid "skirt", so nothing stretches when the gun leaves the
 * vest. Where the other vertices were a sleeve, a cuff or a glove, the skirt carried the sleeve's olive and the glove's
 * brown onto the gun: on the Combat Engineers' first build, 95 warm faces (203-227 cm2 a man) that stood by the firing
 * fist as a pale blade in every aimed clip, where the hands are 8-9 cm from where they were sculpted. No gate read the
 * weapon mesh's colours. This does, off the bytes: every weapon-role triangle's texel (at its uv centroid) in CIE Lab; a
 * face is WARM when b* is over 7 (yellow of neutral: the olive is +14, the glove +14, the coyote +31) and L* over 12 (not
 * the gun's own near-black, where b* is noise). The carbines are blue-grey: b* at or under 0.
 *
 * The ceilings are literals, per man: faces and cm2.
 *  - `demo_squad` is held at what it ships with since the importer keeps only the vest's skirt (`gun_skirt_vest_only`).
 *  - `inf_squad` (the pilot, accepted by the lead on 12 Nov) carries 253-318 such faces, most of them its stock's pocket
 *    in the vest and its fists' contact faces. It is a RATCHET at those readings: named, not fixed here, may not grow.
 *
 * Falsified (13 Nov 2026): by mutation of the implementation, `gun_skirt_vest_only=False` in demo_squad's importer row,
 * the team rebuilt and put in `art/meshes`: demo_a and demo_b both red (95 faces each, 203.1 and 226.6 cm2, against
 * the ceiling of 2); the bytes
 * restored. And the constructed input at the bottom: the Rifle Squad read against the engineers' ceiling is red.
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { GlbFile } from './mesh_gait';
import { figureBuilds, infantryTeams, owns, readRoleMeshes, readTexture, triAreaM2, triLab, trianglesOf } from './mesh_figures';
import { handsSource } from './mesh_hand_gates';

const MESHES = fileURLToPath(new URL('../../art/meshes/', import.meta.url));

/** A weapon face is warm (cloth, not gun) when its texel's b* is over this and its L* over `WARM_MIN_L`. */
const WARM_MIN_B = 7;
const WARM_MIN_L = 12;

/** Per man: the most warm faces, and the most warm area (cm2), the weapon mesh may carry. */
const CEILING: Readonly<Record<string, Readonly<Record<string, { faces: number; cm2: number }>>>> = {
  demo_squad: { demo_a: { faces: 2, cm2: 1.5 }, demo_b: { faces: 2, cm2: 1.5 } },
  // the pilot's own, read 13 Nov 2026 on its shipped bytes: a ratchet, not a pass
  inf_squad: { f0: { faces: 253, cm2: 375 }, f1: { faces: 318, cm2: 475 }, f2: { faces: 311, cm2: 497 } },
};

function warmFaces(glb: GlbFile, fig: string): { all: number; faces: number; cm2: number } {
  const tex = readTexture(glb);
  if (!tex) throw new Error('no baked colour texture: the weapon mesh cannot be read by colour');
  let all = 0, faces = 0, m2 = 0;
  for (const m of readRoleMeshes(glb)) {
    if (m.role !== 'weapon') continue;
    for (const t of trianglesOf(m)) {
      if (!owns(fig, t.bone)) continue;
      all += 1;
      const l = triLab(tex, t);
      if (l && l[2] > WARM_MIN_B && l[0] > WARM_MIN_L) { faces += 1; m2 += triAreaM2(t); }
    }
  }
  return { all, faces, cm2: m2 * 1e4 };
}

const skinned = infantryTeams(MESHES, (d) => readdirSync(d)).filter(([, g]) => handsSource(g) === 'meshy');
const rows = skinned.flatMap(([team, glb]) => figureBuilds(glb).map((fig) => [team, fig, glb] as [string, string, GlbFile]));

describe('the weapon mesh of a skinned Meshy team carries no cloth', () => {
  it('reads the population it says it reads, and every man has a ceiling', () => {
    expect(rows.map(([t, f]) => `${t}/${f}`).sort()).toEqual(['demo_squad/demo_a', 'demo_squad/demo_b', 'inf_squad/f0', 'inf_squad/f1', 'inf_squad/f2']);
    for (const [team, fig, glb] of rows) {
      expect(CEILING[team]?.[fig], `${team}/${fig}: no ceiling`).toBeDefined();
      expect(warmFaces(glb, fig).all, `${team}/${fig}: weapon triangles read`).toBeGreaterThan(800);
    }
  });

  it.each(rows)('%s %s: warm faces on the weapon at or under its ceiling', (team, fig, glb) => {
    const r = warmFaces(glb, fig);
    const c = CEILING[team][fig];
    expect(r.faces, `${team}/${fig}: ${r.faces} sleeve- or glove-coloured faces on the weapon mesh (${r.cm2.toFixed(1)} cm2), ceiling ${c.faces}`).toBeLessThanOrEqual(c.faces);
    expect(r.cm2, `${team}/${fig}: ${r.cm2.toFixed(1)} cm2 of sleeve- or glove-coloured faces on the weapon mesh, ceiling ${c.cm2}`).toBeLessThanOrEqual(c.cm2);
  });
});

describe('the cloth reading can fail (constructed input)', () => {
  it('the Rifle Squad read against the engineers\' ceiling is red by two orders', () => {
    const squad = skinned.find(([t]) => t === 'inf_squad')![1];
    const r = warmFaces(squad, 'f1');
    expect(r.faces).toBeGreaterThan(100 * CEILING.demo_squad.demo_a.faces);
    expect(r.cm2).toBeGreaterThan(100 * CEILING.demo_squad.demo_a.cm2);
  });
});
