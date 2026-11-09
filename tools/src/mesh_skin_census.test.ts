/**
 * The Meshy Rifle Squad's skinned surface, read on the shipped bytes (GH-746, the round-4 review of 9 Nov):
 *
 *  N1 -- no needle at a fist: within 0.12 m of each fist, at rest and through every living clip, at most 3 slivers
 *        (longest edge over 25 mm, height under 2.5 mm), none longer than 40 mm. The fused grip, parted from the gun,
 *        left an open rim of them (b79fe403c: f2's firing fist 15, the longest 96 mm); the importer now caps the rim and
 *        refuses a build that keeps more (`_clean_fist_slivers`).
 *  N3 -- no comb in the armpit: in fire and moveFire, at most 30 edges between a figure's spine and an upper arm stretched
 *        past 2.5x and 3 cm, none past 0.15 m (7320cef47: moveFire 44-71 edges at 0.19-0.23 m on the firing side).
 *
 * Open readings are named, each with its demotion (they must keep failing, or the entry goes):
 *  - `move`: the SUPPORT fist (rig R) shows 1-2 slivers of 45-85 mm in the run's arm swing (rest and every other clip:
 *    none; 9 Nov round 4);
 *  - the support-side armpit (rig R, `upperarm_R`): 100-110 edges at 0.37-0.38 m in fire and moveFire, unchanged since
 *    round 1 and not visible at the garage or game framings (the reviews of 9 Nov).
 *
 * Constructed failing inputs, each run: a triangle at f1's firing fist made a 6 cm needle (N1 red); f1's firing upper arm
 * swung 50 deg in moveFire (N3 red).
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readGlb, type GlbFile } from './mesh_gait';
import { armpitStretch, fistSlivers, readUniform, withVertexAt } from './mesh_skin_census';

const SQUAD = fileURLToPath(new URL('../../art/meshes/inf_squad.glb', import.meta.url));
const FIGURES = ['f0', 'f1', 'f2'] as const;
const CLIPS = [null, 'idle', 'move', 'fire', 'moveFire', 'kneel', 'kneelIn', 'kneelOut', 'pinned'] as const;
const FRACS = [0, 0.25, 0.5, 0.75, 0.875];
const MAX_SLIVERS = 3;
const MAX_SLIVER_M = 0.04;
const MAX_STRETCH_EDGES = 30;
const MAX_STRETCH_M = 0.15;

/** clip + rig side of a fist -> the reason; the reading must still fail somewhere in that clip, on some figure. */
const SLIVER_OPEN: Readonly<Record<string, string>> = {
  'move R': 'the support fist shows 1-2 slivers of 45-85 mm in the run\'s arm swing (9 Nov, round 4); none at rest or in any other clip',
};
/** rig side -> reason; the support-side armpit's web, still over the bar in fire and moveFire. */
const STRETCH_OPEN: Readonly<Record<string, string>> = {
  R: 'the support armpit (upperarm_R): 100-110 edges at 0.37-0.38 m in fire and moveFire, unchanged since round 1, not visible at the garage or game framings',
};

const glb = readGlb(SQUAD);
const over = (r: { count: number; longestM: number }): boolean => r.count > MAX_SLIVERS || r.longestM > MAX_SLIVER_M;

describe('N1: no needle at a fist (rest and every living clip)', () => {
  for (const fig of FIGURES) {
    it(`${fig}: at most ${MAX_SLIVERS} slivers per fist, none over ${MAX_SLIVER_M * 1000} mm`, () => {
      const bad: string[] = [];
      for (const clip of CLIPS) for (const fr of clip === null ? [0] : FRACS) {
        for (const r of fistSlivers(glb, fig, clip, fr)) {
          if (!over(r)) continue;
          const key = `${clip ?? 'rest'} ${r.hand.slice(-1)}`;
          if (key in SLIVER_OPEN) continue;
          bad.push(`${key} @${fr}: ${r.count} slivers, longest ${(r.longestM * 1000).toFixed(0)} mm`);
        }
      }
      expect(bad).toEqual([]);
    }, 300_000);
  }
  it.each(Object.keys(SLIVER_OPEN))('open reading "%s" still fails (else delete it)', (key) => {
    const [clip, side] = key.split(' ');
    const fails = FIGURES.some((fig) => FRACS.some((fr) => fistSlivers(glb, fig, clip, fr).some((r) => r.hand.endsWith(`_${side}`) && over(r))));
    expect(fails, `${key}: now inside the bar, delete its SLIVER_OPEN entry`).toBe(true);
    expect(SLIVER_OPEN[key].length).toBeGreaterThan(20);
  }, 300_000);
  it('fails on a needle: a triangle at f1\'s firing fist stretched into a 6 cm sliver (constructed input)', () => {
    const u = readUniform(glb);
    const v = u.dom.findIndex((d) => d === 'f1_hand_L');
    const tri = u.tris.find((t) => t.includes(v))!;
    const [a, b] = tri.filter((x) => x !== v).map((x) => [u.pos.data[x * 3], u.pos.data[x * 3 + 1], u.pos.data[x * 3 + 2]] as [number, number, number]);
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const n = Math.hypot(d[0], d[1], d[2]);
    const far: [number, number, number] = [a[0] + (d[0] / n) * 0.06, a[1] + (d[1] / n) * 0.06, a[2] + (d[2] / n) * 0.06];
    const r = fistSlivers(withVertexAt(glb, v, far) as GlbFile, 'f1', null);
    expect(r.some(over)).toBe(true);
    expect(fistSlivers(glb, 'f1', null).some(over)).toBe(false);
  }, 120_000);
});

describe('N3: no comb in the armpit (fire, moveFire)', () => {
  for (const fig of FIGURES) for (const side of ['L', 'R'] as const) for (const clip of ['fire', 'moveFire']) {
    it(`${fig} ${side} ${clip}`, () => {
      const r = armpitStretch(glb, fig, side, clip);
      const bad = r.edges > MAX_STRETCH_EDGES || r.longestM > MAX_STRETCH_M;
      if (side in STRETCH_OPEN) expect(bad, `${side}: inside the bar now, delete its STRETCH_OPEN entry`).toBe(true);
      else expect(bad, `${r.pair} in ${clip}: ${r.edges} edges, longest ${r.longestM.toFixed(3)} m`).toBe(false);
    }, 120_000);
  }
  it('fails on a swung arm: f1\'s firing upper arm turned 50 deg in moveFire (constructed input)', () => {
    const json = JSON.parse(JSON.stringify(glb.json)) as GlbFile['json'];
    const bin = new Uint8Array(glb.bin);
    const nodes = json.nodes ?? [];
    const ni = nodes.findIndex((n) => n.name === 'f1_upperarm_L');
    const anim = json.animations!.find((a) => a.name === 'moveFire')!;
    const ch = anim.channels.find((c) => c.target.node === ni && c.target.path === 'rotation')!;
    const acc = json.accessors![anim.samplers[ch.sampler].output];
    const bv = json.bufferViews![acc.bufferView!];
    const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    const h = (50 * Math.PI) / 360, s = Math.sin(h), c = Math.cos(h);
    for (let k = 0; k < acc.count; k++) {
      const [x, y, z, w] = [0, 1, 2, 3].map((i) => dv.getFloat32(base + (k * 4 + i) * 4, true));
      // q * (rotation about local x by 50 deg)
      const q = [w * s + x * c, y * c + z * s, z * c - y * s, w * c - x * s];
      q.forEach((val, i) => dv.setFloat32(base + (k * 4 + i) * 4, val, true));
    }
    const r = armpitStretch({ json, bin }, 'f1', 'L', 'moveFire');
    expect(r.edges > MAX_STRETCH_EDGES || r.longestM > MAX_STRETCH_M).toBe(true);
  }, 120_000);
});
