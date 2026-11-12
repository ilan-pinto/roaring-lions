/**
 * GH-1223 slice 1: the shipped infantry rigs as ragdolls (real GLBs, real Rapier, Node): the structural bone-to-body
 * mapping, the deterministic starting pose, and a whole incident settling on the ground, bit-identical twice.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { parseGlbHeadless } from '../units/headless-gltf';
import { buildMeshUnitTemplate, instantiateMeshUnit, type MeshUnitTemplate } from '../units/mesh-unit';
import { applyMeshClip } from '../units/mesh-clip';
import { liveFigureRoots } from '../units/mesh-death';
import { loadRapier, type Rapier } from './rapier';
import { buildFigures, figureLinks, groundPatch, writePose, HANDOFF_MS } from './ragdoll-rig';
import { POSE_STRIDE, RagdollIncident, poseDigest } from './ragdoll-world';

const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));

async function template(team: string): Promise<MeshUnitTemplate> {
  return buildMeshUnitTemplate(await parseGlbHeadless(readFileSync(`${REPO}art/meshes/${team}.glb`)), 'kdf', `${team}.glb`);
}

let R: Rapier;
let squad: MeshUnitTemplate;
let sniper: MeshUnitTemplate;
beforeAll(async () => {
  R = await loadRapier();
  squad = await template('inf_squad');
  sniper = await template('sniper_team');
}, 60_000);

const AT = { x: 10.5, y: 0, z: 12.5, yaw: 0.7 };
const SEED = { entityId: 7, deathTick: 40, away: [0.6, 0.8] as const };

/** One whole incident from a fresh entity of `t`: figures, a flat patch, 4 s of sim time. */
function settle(t: MeshUnitTemplate, typeId: string, frameMs: number) {
  const e = instantiateMeshUnit(t, typeId);
  // The screen was mid-walk, on the frame clock: the start pose must not care.
  applyMeshClip(e, 'move', { cut: true });
  e.mixer.update(frameMs / 1000);
  const { figures, driver } = buildFigures(e, t, AT, SEED);
  const t0 = SEED.deathTick * 50 + HANDOFF_MS;
  const inc = new RagdollIncident(R, { t0Ms: t0, figures, ground: groundPatch(AT.x, AT.z, () => 0), boxes: [] });
  for (let s = t0; s <= t0 + 5_000; s += frameMs) inc.advanceTo(s);
  const pose = inc.poseAt(t0 + 5_000, new Float64Array(inc.bodyCount * POSE_STRIDE));
  writePose(driver, pose);
  return { e, inc, figures, digest: poseDigest(inc.snapshot()) };
}

describe('bones to bodies, structurally', () => {
  it('a rig.py figure is 11 bodies: one root, hinges at the two elbows and two knees', () => {
    const e = instantiateMeshUnit(squad, 'inf_squad');
    const roots = liveFigureRoots(e.root);
    expect(roots.length).toBe(3);
    for (const r of roots) {
      const links = figureLinks(r);
      expect(links).toHaveLength(11);
      expect(links.filter((l) => l.parent < 0)).toHaveLength(1);
      expect(links.filter((l) => l.hinge)).toHaveLength(4);
      // Every hinge ends a chain and carries its leaf (the hand, the foot) in its shape.
      for (const l of links.filter((x) => x.hinge)) expect(l.shapeBones.length).toBeGreaterThan(1);
    }
  });

  it('every body is a sane capsule near its figure, at the sim position', () => {
    const e = instantiateMeshUnit(squad, 'inf_squad');
    const { figures } = buildFigures(e, squad, AT, SEED);
    expect(figures).toHaveLength(3);
    for (const f of figures) {
      for (const b of f.bodies) {
        expect(b.capsule.radius).toBeGreaterThanOrEqual(0.025);
        expect(b.capsule.radius).toBeLessThanOrEqual(0.15 + 1e-9);
        expect(b.capsule.halfHeight).toBeLessThan(0.6);
        // Metres: within 3 tiles (9 m) of the entity, between the ground and 2 m up.
        expect(Math.hypot(b.at[0] - AT.x * 3, b.at[2] - AT.z * 3)).toBeLessThan(9);
        expect(b.at[1]).toBeGreaterThan(-0.2);
        expect(b.at[1]).toBeLessThan(2.2);
      }
    }
  });
});

describe('a whole incident (design section 4)', () => {
  it('the same seed gives bit-identical body poses across two runs, whatever the screen was doing', () => {
    const a = settle(squad, 'inf_squad', 50);
    const b = settle(squad, 'inf_squad', 7);
    expect(b.digest).toBe(a.digest);
    expect(a.inc.frozen).toBe(true);
  });

  it('settles on the ground: no body under it, the figures moved off their feet', () => {
    const { inc } = settle(squad, 'inf_squad', 50);
    const pose = inc.snapshot();
    for (let k = 0; k < inc.bodyCount; k++) expect(pose[k * POSE_STRIDE + 1]).toBeGreaterThan(-0.05);
  });

  it('a rig with no fall clip (sniper_team) topples from idle and settles too', () => {
    expect(sniper.clips.has('fall')).toBe(false);
    const a = settle(sniper, 'sniper_team', 50);
    const b = settle(sniper, 'sniper_team', 50);
    expect(a.figures.length).toBeGreaterThan(0);
    expect(b.digest).toBe(a.digest);
    expect(a.inc.frozen).toBe(true);
  });

  it('writes the pose back onto the bones: a body bone ends where its body is', () => {
    const { e, inc } = settle(squad, 'inf_squad', 50);
    e.root.updateMatrixWorld(true);
    const pelvis = figureLinks(liveFigureRoots(e.root)[0])[0].bone;
    const p = pelvis.getWorldPosition(new THREE.Vector3()).multiplyScalar(3);
    const pose = inc.snapshot();
    expect(p.x).toBeCloseTo(pose[0], 4);
    expect(p.y).toBeCloseTo(pose[1], 4);
    expect(p.z).toBeCloseTo(pose[2], 4);
  });
});
