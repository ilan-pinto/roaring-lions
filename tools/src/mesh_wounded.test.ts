// The wounded pair (GH-707 P2): `wounded_kdf` and `wounded_sarim`, one man on his front each.
//
// They are rigged GLBs and in `RIGGED_UNIT_MESHES`, but the tree-wide gait/hold gates cannot judge
// them and are told so by name rather than by silence:
//
//   - no `move`, so `pnpm gait:meshes` has nothing to measure and no `rl_gait` is declared. The
//     renderer rate-matches only `move`/`moveFire` (`LOCOMOTION_CLIPS`); a `crawl` plays at
//     timeScale 1. So the crawl is AUTHORED at the unit's own ground speed
//     (`tools/units/wounded.py`, `CRAWL_PULL_M`) and this spec measures it back off the bytes.
//     `GAIT_CRAWL_ONLY` (gait-pass.ts) is that exemption, and it is pinned here to the role-`wounded`
//     unit JSONs, so a third wounded type with no entry in it, or an entry for a type that is not
//     wounded, goes red.
//   - no weapon, so no hold, kneel or pinned clip (`motion:meshes` has no entry for them).
//   - the ground rule (nothing under the ground) is the census in `mesh_gait.test.ts`, which reads
//     the living clips idle/fire/move: none of which a wounded man has. Held here instead, in
//     every clip he does have.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RIGGED_UNIT_MESHES } from '../../packages/app/src/mesh-catalogue';
import { RESCUE_CLIP_NAMES, RESCUE_CLIPS } from '../../packages/render/src/three/units/rescue-pose';
import { measureLowestVertex, measureNodePoses, measureRoleFootprint, readGlb, rotationDeltaDeg, SAMPLES } from './mesh_gait';
import { GAIT_CRAWL_ONLY } from './meshes/gait-pass';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const MESHES = `${REPO}art/meshes/`;
const TILE_M = 3;

interface UnitJson {
  id: string;
  role: string;
  mobility: { speed_tiles_s: number };
}

/** Every unit JSON on disk whose role is `wounded`, read from the files, not from a list. */
function woundedUnits(): UnitJson[] {
  const out: UnitJson[] = [];
  for (const dir of ['kdf', 'enemy', '']) {
    const base = `${REPO}data/units/${dir}`;
    for (const f of readdirSync(base).filter((n) => n.endsWith('.json'))) {
      const j = JSON.parse(readFileSync(`${base}/${f}`, 'utf8')) as UnitJson;
      if (j.role === 'wounded') out.push(j);
    }
  }
  return out;
}

const WOUNDED = woundedUnits();
const CLIPS = [RESCUE_CLIPS.woundedIdle, RESCUE_CLIPS.woundedIdleFallback, RESCUE_CLIPS.woundedMove, 'wreck'];

describe('the wounded pair: which types, and the exemption that names them', () => {
  it('is exactly the role-wounded unit JSONs, one rigged GLB each, and the gait exemption is the same set', () => {
    expect(WOUNDED.map((u) => u.id).sort()).toEqual(['wounded_kdf', 'wounded_sarim']);
    expect(Object.keys(GAIT_CRAWL_ONLY).sort()).toEqual(WOUNDED.map((u) => u.id).sort());
    for (const u of WOUNDED) expect(RIGGED_UNIT_MESHES[u.id]?.files, `${u.id}: catalogue`).toEqual([`${u.id}.glb`]);
  });
});

for (const u of WOUNDED) {
  const path = `${MESHES}${u.id}.glb`;
  const glb = readGlb(path);
  const scene = glb.json.scenes?.[glb.json.scene ?? 0];
  const clipNames = (glb.json.animations ?? []).map((a) => a.name ?? '');

  describe(`${u.id}: the contract`, () => {
    it('carries exactly down, idleWounded, crawl, wreck -- every name one the renderer asks for', () => {
      expect([...clipNames].sort()).toEqual([...CLIPS].sort());
      for (const c of clipNames) expect([...RESCUE_CLIP_NAMES, 'wreck'] as string[]).toContain(c);
    });
    it('is one figure, with no gait declared, no material and no weapon', () => {
      expect(scene?.extras?.rl_figures).toEqual([{ prefix: 'w0', squad: false }]);
      expect(scene?.extras?.rl_gait, 'a crawl is not rate-matched: nothing to declare').toBeUndefined();
      expect(glb.json.materials ?? [], 'zero materials').toHaveLength(0);
      const roles = (glb.json.meshes ?? []).map((m) => m.name);
      expect(roles).not.toContain('weapon');
    });
  });

  describe(`${u.id}: a living man is not drawn as the corpse`, () => {
    // `living_not_wreck.test.ts` cannot judge him (no idle/move to resolve to), so this is its
    // twin: every pose a living wounded man opens and closes on differs from `wreck`'s by more
    // than 5 degrees at some joint, or by more than 5 cm.
    const corpse = measureNodePoses(path, 'wreck', 'start');
    for (const clip of ['down', 'idleWounded', 'crawl']) {
      for (const at of ['start', 'end'] as const) {
        it(`${clip} (${at}) is not the wreck`, () => {
          const pose = measureNodePoses(path, clip, at);
          let rot = 0;
          let move = 0;
          pose.forEach((p, i) => {
            rot = Math.max(rot, rotationDeltaDeg(p.rotation, corpse[i].rotation));
            move = Math.max(move, Math.hypot(...(p.translation.map((v, k) => v - corpse[i].translation[k]) as [number, number, number])));
          });
          expect(rot > 5 || move > 0.05, `${clip} ${at}: max joint rotation ${rot.toFixed(1)} deg, translation ${(move * 100).toFixed(1)} cm`).toBe(true);
        });
      }
    }
  });

  describe(`${u.id}: nothing under the ground, in every clip he has`, () => {
    for (const clip of CLIPS) {
      it(`${clip}: lowest vertex at or above the ground, and never floating`, () => {
        const read = measureLowestVertex(path, clip);
        expect(read.map((f) => f.root)).toEqual(['w0_root']);
        for (const f of read) {
          expect(f.instants, `${clip}: instants sampled`).toBeGreaterThan(1);
          expect(f.lowestM, `${clip}: lowest vertex (${f.joint} at ${f.atS.toFixed(3)} s)`).toBeGreaterThanOrEqual(0);
          expect(f.floatM, `${clip}: lowest vertex at its highest instant`).toBeLessThanOrEqual(0.015);
        }
      });
    }
  });

  describe(`${u.id}: the crawl covers the ground at the speed the unit declares`, () => {
    it('a planted hand slides back along the body at speed_tiles_s x 3 m', () => {
      const want = u.mobility.speed_tiles_s * TILE_M;
      // The hands are the `skin_shadow` vertices that travel most (the neck barely moves).
      const fp = measureRoleFootprint(path, 'skin_shadow', 'crawl');
      const dt = fp.clipSeconds / SAMPLES;
      const fwd = fp.bestVertexTrace.forwardM;
      // Contact is the half of the cycle the hand moves BACK along the body: the mean of those
      // steps is the speed the ground goes by under it.
      const back: number[] = [];
      for (let i = 0; i < fwd.length; i++) {
        const d = fwd[(i + 1) % fwd.length] - fwd[i];
        if (d < 0) back.push(-d / dt);
      }
      expect(back.length, 'steps of backward travel').toBeGreaterThan(SAMPLES / 4);
      const got = back.reduce((a, b) => a + b, 0) / back.length;
      expect(want).toBeCloseTo(0.36, 6);
      expect(got, `contact slide ${got.toFixed(3)} m/s against ${want.toFixed(3)} m/s declared`).toBeGreaterThan(want * 0.92);
      expect(got).toBeLessThan(want * 1.08);
    });
  });
}
