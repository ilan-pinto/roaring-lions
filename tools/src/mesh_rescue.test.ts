// The Nemala Medic Team (`inf_medic_squad`, GH-707 P2): what the tree-wide gait, hold and ground
// censuses in `mesh_gait.test.ts` cannot see, because it is the only team that carries a casualty.
//
//   - two DIFFERENT bodies (the lead's standing infantry rule, 22 Oct), measured off the bytes;
//   - the folded-stretcher bundle stands `BUNDLE_ABOVE_HELMET` over the helmet, the lever against
//     at_team / demo_squad / breach_team / inf_squad;
//   - every figure carries a weapon on its own bone, SLUNG (behind the back, muzzle up, rigid to the
//     spine) in `carry` and `treat`, low-ready in `idle` (the census gates that one);
//   - the litter and the casualty on it are scale 0 in every clip but `carry`;
//   - `carry`: each bearer's both hands CLOSE ON the litter's own grip geometry, the men stand inside
//     the lead's +-1.35 m, nothing is under the ground, and a planted foot moves at the unit's own
//     CARRYING speed (`carry` is not a locomotion clip, so the renderer will not rate-match it);
//   - `treat`: nothing under the ground, both men kneeling.
//
// Every check below that measures a quantity also runs against an input built to fail (a control),
// inside the spec: a litter moved 0.3 m, a clip with the litter left switched on, a foot speed the
// clip was not authored for, med_b given med_a's own body, a weapon in its low-ready `idle`.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { describe, expect, it, vi } from 'vitest';
import { RESCUE_CLIPS } from '../../packages/render/src/three/units/rescue-pose';
import { measureFootSkate, measureJointPoses, measureLowestVertex } from './mesh_gait';
import { writeTrack } from './meshes/motion/edit';
import { handPoint } from './meshes/motion/hold';
import { MOTION_TEAMS } from './meshes/motion/teams';
import { carry as carryPoint, restVertices, Rig, tracksOf } from './meshes/motion/rig';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const FILE = `${REPO}art/meshes/inf_medic_squad.glb`;
const UNIT = JSON.parse(readFileSync(`${REPO}data/units/kdf/inf_medic_squad.json`, 'utf8')) as {
  mobility: { speed_tiles_s: number };
  rescue: { carry_speed_mult: number };
  hull: { figures: number };
};
const TILE_M = 3;
const BODY = ['med_a', 'med_b'] as const;
const LITTER = 'med_a_litter';
// Each measurement skins the whole file at every key and midpoint (a second or two); on a busy machine
// that is minutes of CPU, and the default 5 s is a flake, not a gate.
vi.setConfig({ testTimeout: 120_000 });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.readBinary(new Uint8Array(readFileSync(FILE)));
const scratch = mkdtempSync(join(tmpdir(), 'rescue-'));

/** A copy of the file, edited by `edit`, written to a scratch path (the gates read paths). */
async function mutated(name: string, edit: (d: Document) => void): Promise<string> {
  const d = await io.readBinary(new Uint8Array(readFileSync(FILE)));
  edit(d);
  const out = join(scratch, name);
  await io.write(out, d);
  return out;
}

const scaleOf = (path: string, clip: string, at: 'start' | 'end', joint: string): number =>
  measureJointPoses(path, clip, at).find((j) => j.name === joint)!.scale;

describe('inf_medic_squad: the file', () => {
  it('ships the clips the renderer asks for, and no drag', () => {
    const names = doc.getRoot().listAnimations().map((a) => a.getName()).sort();
    for (const c of ['idle', 'move', 'moveFire', 'fire', 'kneel', 'kneelIn', 'kneelOut', 'pinned', 'down', 'wreck', RESCUE_CLIPS.medicTreat, RESCUE_CLIPS.medicCarry]) {
      expect(names, c).toContain(c);
    }
    expect(names).not.toContain('drag');
  });

  it('is two figures, as the unit declares, and both are drawn as separate men', () => {
    const extras = doc.getRoot().listScenes()[0].getExtras() as { rl_figures?: { prefix: string; squad: boolean }[] };
    expect(extras.rl_figures?.map((f) => f.prefix)).toEqual([...BODY]);
    expect(extras.rl_figures?.every((f) => f.squad)).toBe(true);
    expect(UNIT.hull.figures).toBe(2);
  });

  it('keeps the motion team entry, the unit JSON and the clip in step', () => {
    const team = MOTION_TEAMS.inf_medic_squad;
    expect(team.speedTiles).toBe(UNIT.mobility.speed_tiles_s);
    expect(team.rescue?.carryMult).toBe(UNIT.rescue.carry_speed_mult);
  });
});

/** True when every channel of every clip targets a node one of the two men owns (`squad-rig.ts`'s `ownsTrack`),
 *  which is what lets the renderer split the clips per figure: ONE shared track (a `prop`) makes
 *  `splitClips` return null and the team falls back to one player, the men no longer walking their own
 *  paths. The litter rides `med_a_litter` for exactly this reason. */
function everyTrackIsOwned(d: Document): { ok: boolean; stray: string[] } {
  const stray = new Set<string>();
  for (const anim of d.getRoot().listAnimations()) {
    for (const c of anim.listChannels()) {
      const name = c.getTargetNode()?.getName() ?? '';
      if (!BODY.some((p) => name.startsWith(`${p}_`) || name.startsWith(`${p}k_`) || name.startsWith(`${p}w_`))) stray.add(`${anim.getName()}:${name}`);
    }
  }
  return { ok: stray.size === 0, stray: [...stray] };
}

describe('inf_medic_squad: the per-figure split of the clips', () => {
  it('every track of every clip belongs to one of the two men, the litter included', () => {
    const r = everyTrackIsOwned(doc);
    expect(r.stray, 'tracks that belong to no figure').toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('control: a shared `prop` bone keyed in a clip is read as a stray track', async () => {
    const d = await io.readBinary(new Uint8Array(readFileSync(FILE)));
    const rig = new Rig(d);
    const idle = d.getRoot().listAnimations().find((a) => a.getName() === 'idle')!;
    const prop = d.createNode('prop');
    rig.node('med_a_root').getParentNode()?.addChild(prop);
    writeTrack(d, idle, prop, 'scale', [0, 1], [1, 1, 1, 1, 1, 1]);
    const r = everyTrackIsOwned(d);
    expect(r.ok).toBe(false);
    expect(r.stray).toEqual(['idle:prop']);
  });
});

describe('inf_medic_squad: two different bodies', () => {
  const rig0 = new Rig(doc);
  const verts = restVertices(rig0);
  type Vert = (typeof verts)[number];
  /** Height of a body (head, helmet and boots: the textured roles), and the width of its trunk: twice
   *  the 80th percentile of the textured vertices' distance from his own spine, over the chest band
   *  (a percentile, not the extreme: a sleeve's stray triangle is not his chest). */
  function body(vs: readonly Vert[], prefix: string): { height: number; trunk: number } {
    const mine = vs.filter((v) => v.joint.getName().startsWith(`${prefix}_`) && !/death/.test(v.joint.getName()));
    const worn = mine.filter((v) => v.role === 'uniform' || v.role === 'face' || v.role === 'boot');
    const cz = rig0.restWorld.get(rig0.node(`${prefix}_spine`))!.t[2];
    const trunk = worn
      .filter((v) => v.joint.getName() === `${prefix}_spine` && v.p[1] > 1.0 && v.p[1] < 1.3)
      .map((v) => Math.abs(v.p[2] - cz))
      .sort((x, y) => x - y);
    return { height: Math.max(...worn.map((v) => v.p[1])), trunk: 2 * trunk[Math.floor(0.8 * (trunk.length - 1))] };
  }
  /** The lead's rule, as the conditions it breaks: med_a taller by > 5 cm, med_b wider by > 10 %,
   *  both inside 1.7-1.9 m. Empty when the two bodies differ as they must. */
  function bodyRuleBreaks(vs: readonly Vert[]): string[] {
    const a = body(vs, 'med_a');
    const b = body(vs, 'med_b');
    console.log(`medic bodies: med_a ${a.height.toFixed(3)} m, trunk ${a.trunk.toFixed(3)} m; med_b ${b.height.toFixed(3)} m, trunk ${b.trunk.toFixed(3)} m`);
    const out: string[] = [];
    if (!(a.height - b.height > 0.05)) out.push('not taller');
    if (!(b.trunk / a.trunk > 1.1)) out.push('not wider');
    if (!(Math.max(a.height, b.height) < 1.9)) out.push('too tall');
    if (!(Math.min(a.height, b.height) > 1.7)) out.push('too short');
    return out;
  }

  it('one is taller by at least 5 cm and the other wider through the trunk by at least 10 %', () => {
    expect(bodyRuleBreaks(verts)).toEqual([]);
  });

  it('control: med_b given med_a\'s own body (in memory) is read as neither taller nor wider', () => {
    // Every med_b vertex replaced by med_a's, re-bound to med_b's same-named joint and moved by the
    // two spines' rest offset: one body twice over, which the rule must refuse on both counts.
    const sa = rig0.restWorld.get(rig0.node('med_a_spine'))!.t;
    const sb = rig0.restWorld.get(rig0.node('med_b_spine'))!.t;
    // (med_a's litter has no med_b twin, and is not part of a body: it is left out.)
    const names = new Set(doc.getRoot().listNodes().map((n) => n.getName()));
    const twin = verts
      .filter((v) => v.joint.getName().startsWith('med_a_') && names.has(v.joint.getName().replace(/^med_a_/, 'med_b_')))
      .map((v) => ({
        ...v,
        joint: rig0.node(v.joint.getName().replace(/^med_a_/, 'med_b_')),
        p: [v.p[0] + sb[0] - sa[0], v.p[1], v.p[2] + sb[2] - sa[2]] as typeof v.p,
      }));
    const same = [...verts.filter((v) => !v.joint.getName().startsWith('med_b_')), ...twin];
    const breaks = bodyRuleBreaks(same);
    expect(breaks).toContain('not taller');
    expect(breaks).toContain('not wider');
  });
});

describe('inf_medic_squad: the folded stretcher and the carbine, on each man', () => {
  const verts = restVertices(new Rig(doc));
  for (const p of BODY) {
    it(`${p}: the bundle's top stands 0.25-0.35 m above his helmet`, () => {
      const head = Math.max(...verts.filter((v) => v.joint.getName() === `${p}_head` && (v.role === 'uniform' || v.role === 'face')).map((v) => v.p[1]));
      const bundle = Math.max(
        ...verts.filter((v) => v.joint.getName() === `${p}_spine` && (v.role === 'wood' || v.role === 'metal')).map((v) => v.p[1])
      );
      console.log(`${p}: helmet ${head.toFixed(3)} m, bundle ${bundle.toFixed(3)} m, over ${(bundle - head).toFixed(3)} m`);
      expect(bundle - head).toBeGreaterThan(0.25);
      expect(bundle - head).toBeLessThan(0.35);
    });

    it(`${p}: carries a carbine on his own weapon bone`, () => {
      const w = verts.filter((v) => v.joint.getName() === `${p}_weapon` && v.role === 'weapon');
      expect(w.length, `${p}: weapon vertices`).toBeGreaterThan(60);
    });
  }
});

describe('inf_medic_squad: the litter is scale 0 everywhere but `carry`', () => {
  const clips = doc.getRoot().listAnimations().map((a) => a.getName());
  for (const clip of clips) {
    const want = clip === RESCUE_CLIPS.medicCarry ? 1 : 0;
    it(`${clip}: litter scale ${want}`, () => {
      for (const at of ['start', 'end'] as const) {
        const s = scaleOf(FILE, clip, at, LITTER);
        expect(want === 1 ? s : Math.abs(s), `${clip} ${at}`).toBeCloseTo(want === 1 ? 1 : 0, 6);
      }
    });
  }

  it('control: a clip that keys the litter on is read as on', async () => {
    const path = await mutated('litter-on.glb', (d) => {
      const idle = d.getRoot().listAnimations().find((a) => a.getName() === 'idle')!;
      const rig = new Rig(d);
      writeTrack(d, idle, rig.node(LITTER), 'scale', [0, 1], [1, 1, 1, 1, 1, 1]);
    });
    expect(scaleOf(path, 'idle', 'start', LITTER)).toBeCloseTo(1, 6);
  });
});

describe('inf_medic_squad: carry', () => {
  const carrySpeedMs = UNIT.mobility.speed_tiles_s * UNIT.rescue.carry_speed_mult * TILE_M;

  /** The worst distance, over the clip, from a bearer's hand to the AXIS of a grip of the litter's own
   *  geometry at ITS end. A grip is a wood tube: the file holds its two end rings, so the axis is the
   *  segment between the rings' centres (the distance to a ring vertex would read 0.1 m for a hand
   *  that is on it). */
  function worstGripGap(d: Document, clip: string): number {
    const rig = new Rig(d);
    const verts = restVertices(rig);
    const litter = rig.node(LITTER);
    const anim = d.getRoot().listAnimations().find((a) => a.getName() === clip)!;
    const tracks = tracksOf(anim);
    const ends = verts.filter((v) => v.joint === litter && v.role === 'wood' && Math.abs(v.p[0]) > 0.8);
    expect(ends.length, 'grip vertices on the litter').toBeGreaterThan(50);
    const mid = (pts: number[][]) => [0, 1, 2].map((k) => pts.reduce((s2, q) => s2 + q[k], 0) / pts.length);
    // the four grips: one per (end, pole), told apart by the sign of rest x and z about the litter's centre
    const centre = rig.restWorld.get(litter)!.t;
    const grips = new Map<string, { p: number[]; end: number }[]>();
    for (const v of ends) {
      const key = `${Math.sign(v.p[0] - centre[0])}:${Math.sign(v.p[2] - centre[2])}`;
      if (!grips.has(key)) grips.set(key, []);
      grips.get(key)!.push({ p: v.p, end: Math.sign(v.p[0] - centre[0]) });
    }
    expect(grips.size, 'four grips').toBe(4);
    const axisOf = (pts: { p: number[] }[]): [number[], number[]] => {
      const xs = pts.map((q) => q.p[0]).sort((a, b) => a - b);
      const cut = xs[Math.floor(xs.length / 2)];
      return [mid(pts.filter((q) => q.p[0] < cut).map((q) => q.p)), mid(pts.filter((q) => q.p[0] >= cut).map((q) => q.p))];
    };
    const segs = [...grips].map(([key, pts]) => ({ end: pts[0].end, axis: axisOf(pts), key }));
    let worst = 0;
    for (let k = 0; k <= 16; k++) {
      const t = (k / 16) * [...tracks.values()][0].times.at(-1)!;
      const w = rig.worlds(rig.sample(tracks, t));
      const to = (p: number[]) => carryPoint(rig, w, litter, p as [number, number, number]);
      for (const p of BODY) {
        const root = w(rig.node(`${p}_root`)).t;
        for (const side of ['L', 'R'] as const) {
          const fore = rig.node(`${p}_forearm_${side}`);
          const hand = carryPoint(rig, w, fore, handPoint(rig, verts, fore));
          const near = Math.min(
            ...segs
              .filter((g) => g.end === Math.sign(root[0]))
              .map((g) => {
                const a = to(g.axis[0]);
                const b = to(g.axis[1]);
                const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
                const u = Math.max(0, Math.min(1, ((hand[0] - a[0]) * ab[0] + (hand[1] - a[1]) * ab[1] + (hand[2] - a[2]) * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
                return Math.hypot(a[0] + u * ab[0] - hand[0], a[1] + u * ab[1] - hand[1], a[2] + u * ab[2] - hand[2]);
              })
          );
          worst = Math.max(worst, near);
        }
      }
    }
    return worst;
  }

  it('both hands of both bearers close on the grips at their own end (within 4 cm of the grip axis; the grip is 3 cm in radius)', () => {
    const gap = worstGripGap(doc, RESCUE_CLIPS.medicCarry);
    console.log(`carry: worst hand-to-grip-axis distance ${gap.toFixed(3)} m`);
    expect(gap).toBeLessThan(0.04);
  });

  it('control: a litter moved 0.3 m sideways is read as a miss', async () => {
    const d = await io.readBinary(new Uint8Array(readFileSync(FILE)));
    const rig = new Rig(d);
    const anim = d.getRoot().listAnimations().find((a) => a.getName() === 'carry')!;
    const tr = tracksOf(anim).get(`${LITTER}.translation`)!;
    const moved = Array.from(tr.values).map((v, i) => (i % 3 === 2 ? v + 0.3 : v));
    writeTrack(d, anim, rig.node(LITTER), 'translation', Array.from(tr.times), moved);
    expect(worstGripGap(d, 'carry')).toBeGreaterThan(0.25);
  });

  /** The lead's carrying footprint, as the conditions it breaks: in `carry` each bearer's root
   *  stands between 1.2 and 1.35 m off the litter's centre line, and at rest (`idle`) inside 1.2 m. */
  function spacingBreaks(path: string): string[] {
    const poses = measureJointPoses(path, 'carry', 'start');
    const xs = BODY.map((p) => poses.find((j) => j.name === `${p}_root`)!.translation[0]).sort((a, b) => a - b);
    console.log(`carry: bearers at x ${xs.map((x) => x.toFixed(3)).join(', ')}`);
    const out: string[] = [];
    if (!(xs[0] > -1.35)) out.push('rear bearer outside 1.35 m');
    if (!(xs[0] < -1.2)) out.push('rear bearer inside 1.2 m');
    if (!(xs[1] < 1.35)) out.push('front bearer outside 1.35 m');
    if (!(xs[1] > 1.2)) out.push('front bearer inside 1.2 m');
    const rest = measureJointPoses(path, 'idle', 'start');
    for (const p of BODY) {
      if (!(Math.abs(rest.find((j) => j.name === `${p}_root`)!.translation[0]) < 1.2)) out.push(`${p} at rest outside 1.2 m`);
    }
    return out;
  }

  it('the bearers stand inside the lead\'s +-1.35 m, past the +-1.2 m rest footprint', () => {
    expect(spacingBreaks(FILE)).toEqual([]);
  });

  it('control: bearers 0.1 m further apart are read as outside the allowance', async () => {
    const path = await mutated('apart.glb', (d) => {
      const rig = new Rig(d);
      const anim = d.getRoot().listAnimations().find((x) => x.getName() === 'carry')!;
      for (const [p, dx] of [['med_a', -0.1], ['med_b', 0.1]] as const) {
        const tr = tracksOf(anim).get(`${p}_root.translation`)!;
        writeTrack(d, anim, rig.node(`${p}_root`), 'translation', Array.from(tr.times), Array.from(tr.values).map((v, i) => (i % 3 === 0 ? v + dx : v)));
      }
    });
    const breaks = spacingBreaks(path);
    expect(breaks).toContain('rear bearer outside 1.35 m');
    expect(breaks).toContain('front bearer outside 1.35 m');
  });

  it('a planted foot moves at the unit\'s own carrying speed, not at its walking speed', () => {
    for (const f of measureFootSkate(FILE, 'carry', carrySpeedMs, 1)) {
      expect(f.samples, `${f.figure}: contact samples`).toBeGreaterThan(10);
      expect(f.skate, `${f.figure}: skate at ${carrySpeedMs.toFixed(3)} m/s`).toBeLessThan(0.25);
    }
  });

  it('control: the same clip judged at a speed it was not authored for reads as skating', () => {
    for (const f of measureFootSkate(FILE, 'carry', 4.0, 1)) expect(f.skate, f.figure).toBeGreaterThan(0.25);
  });

  it('nothing is under the ground, and no man floats more than in `move`', () => {
    const moveFloat = new Map(measureLowestVertex(FILE, 'move').map((f) => [f.root, f.floatM] as const));
    const read = measureLowestVertex(FILE, 'carry').filter((f) => f.root.endsWith('_root'));
    expect(read.map((f) => f.root).sort()).toEqual(['med_a_root', 'med_b_root']);
    for (const f of read) {
      expect(f.lowestM, `${f.root}: lowest`).toBeGreaterThanOrEqual(-1e-6);
      // The stride's own aerial moment, the same as `move`'s (0.038-0.040 m on both men): carry is
      // `move`'s legs re-timed, so it may not float more than they do.
      expect(f.floatM, `${f.root}: float`).toBeLessThan(moveFloat.get(f.root)! + 0.005);
    }
  });

  it('control: a root dropped 5 cm is read as under the ground', async () => {
    const path = await mutated('sunk.glb', (d) => {
      const rig = new Rig(d);
      const anim = d.getRoot().listAnimations().find((a) => a.getName() === 'carry')!;
      const tr = tracksOf(anim).get('med_a_root.translation')!;
      writeTrack(d, anim, rig.node('med_a_root'), 'translation', Array.from(tr.times), Array.from(tr.values).map((v, i) => (i % 3 === 1 ? v - 0.05 : v)));
    });
    const read = measureLowestVertex(path, 'carry').find((f) => f.root === 'med_a_root')!;
    expect(read.lowestM).toBeLessThan(-0.02);
  });
});

describe('inf_medic_squad: the carbine is slung in carry and treat, ready in idle', () => {
  const rig = new Rig(doc);
  const verts = restVertices(rig);

  /** The weapon of `p` in the spine's frame at `t`: its centroid, and its elevation above level (degrees). */
  function weaponAt(d: Document, clip: string, p: string, t: number): { c: number[]; elev: number; behind: number } {
    const r = new Rig(d);
    const v = restVertices(r).filter((x) => x.joint.getName() === `${p}_weapon` && x.role === 'weapon');
    const anim = d.getRoot().listAnimations().find((a) => a.getName() === clip)!;
    const tracks = tracksOf(anim);
    const w = r.worlds(r.sample(tracks, t));
    const pts = v.map((x) => carryPoint(r, w, x.joint, x.p));
    const sorted = [...pts].sort((a, b) => a[1] - b[1]);
    const n = Math.max(4, Math.floor(sorted.length / 5));
    const mean = (xs: number[][]) => [0, 1, 2].map((k) => xs.reduce((s, q) => s + q[k], 0) / xs.length);
    const lo = mean(sorted.slice(0, n));
    const hi = mean(sorted.slice(-n));
    const len = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
    const spine = w(r.node(`${p}_spine`)).t;
    const c = mean(pts);
    // the line's steepness (0 = level, 90 = upright), not which end is the muzzle
    return { c, elev: (Math.asin(Math.abs(hi[1] - lo[1]) / len) * 180) / Math.PI, behind: spine[0] - c[0] };
  }

  for (const clip of [RESCUE_CLIPS.medicCarry, RESCUE_CLIPS.medicTreat]) {
    for (const p of BODY) {
      it(`${clip} ${p}: slung -- the carbine upright on his back (> 55 deg), behind the spine (> 0.25 m), the same pose all clip long`, () => {
        const reads = [0, 0.25, 0.5, 0.75].map((f) => {
          const dur = tracksOf(doc.getRoot().listAnimations().find((a) => a.getName() === clip)!).get(`${p}_spine.rotation`)!.times.at(-1)!;
          return weaponAt(doc, clip, p, f * dur);
        });
        for (const r of reads) {
          expect(r.elev, `${clip} ${p}: elevation`).toBeGreaterThan(55);
          expect(r.behind, `${clip} ${p}: behind the spine`).toBeGreaterThan(0.25);
        }
        // Rigid to the spine: its elevation moves only as the torso does (it leans on the kneel).
        expect(Math.max(...reads.map((r) => r.elev)) - Math.min(...reads.map((r) => r.elev)), `${clip} ${p}: steepness swing`).toBeLessThan(25);
      });
    }
  }

  it('control: the same reading on `idle` (the hold\'s low ready) is not a sling', () => {
    for (const p of BODY) {
      const r = weaponAt(doc, 'idle', p, 0);
      expect(r.elev, `${p}: idle steepness`).toBeLessThan(45);
      expect(r.behind, `${p}: idle, in front of the spine`).toBeLessThan(0.25);
    }
    expect(verts.length).toBeGreaterThan(1000);
    void rig;
  });
});

describe('inf_medic_squad: treat', () => {
  it('both men kneel over the casualty: nothing under the ground, nothing floating', () => {
    const read = measureLowestVertex(FILE, RESCUE_CLIPS.medicTreat).filter((f) => f.root.endsWith('_root'));
    expect(read.map((f) => f.root).sort()).toEqual(['med_a_root', 'med_b_root']);
    for (const f of read) {
      expect(f.lowestM, `${f.root}: lowest`).toBeGreaterThanOrEqual(0);
      expect(f.floatM, `${f.root}: float`).toBeLessThan(0.01);
    }
  });

  it('they are lower than they stand: the hips of a kneeling man are well under a standing man\'s', () => {
    const hip = (clip: string, p: string) => measureJointPoses(FILE, clip, 'start').find((j) => j.name === `${p}_pelvis`)!.translation[1];
    for (const p of BODY) {
      expect(hip(RESCUE_CLIPS.medicTreat, p), `${p}: treat hips`).toBeLessThan(0.75 * hip('idle', p));
    }
  });
});
