import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  READY_HANG_MAX,
  SHOWCASE_CLIP,
  applyReadyPose,
  bonesOf,
  figureTurner,
  lineOrder,
  livingFigureRoots,
  poseRigged,
  respaceLine,
  splitShowcase,
  visiblePoints,
} from './garage-pose';

const bone = (name: string, x = 0, y = 0, z = 0): THREE.Bone => {
  const b = new THREE.Bone();
  b.name = name;
  b.position.set(x, y, z);
  return b;
};

/**
 * A Meshy-style skinned figure facing +X (so its left is -Z), arms either
 * held out level in front (`raised`, a rifle up) or hanging straight down.
 * The spine is bent forward 20 degrees -- an idle's crouch -- and `rest`
 * holds it upright, as the bind pose does.
 */
function figure(prefix: string, raised: boolean) {
  const root = new THREE.Group();
  const hips = bone(`${prefix}_Hips`, 0, 0.9, 0);
  const spine = bone(`${prefix}_Spine`, 0, 0.3, 0);
  hips.add(spine);
  root.add(hips);
  const arm = (side: 'Left' | 'Right', z: number) => {
    const a = bone(`${prefix}_${side}Arm`, 0, 0.45, z);
    const f = raised ? bone(`${prefix}_${side}ForeArm`, 0.3, 0, 0) : bone(`${prefix}_${side}ForeArm`, 0, -0.3, 0);
    const h = raised ? bone(`${prefix}_${side}Hand`, 0.25, 0, 0) : bone(`${prefix}_${side}Hand`, 0, -0.25, 0);
    spine.add(a);
    a.add(f);
    f.add(h);
    return { a, f, h };
  };
  const left = arm('Left', -0.2);
  const right = arm('Right', 0.2);
  const bones = bonesOf(root);
  const rest = new Map(bones.map((b) => [b, { q: b.quaternion.clone(), p: b.position.clone() }] as const));
  // The idle's crouch, applied AFTER rest was taken.
  spine.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 9);
  root.updateMatrixWorld(true);
  return { root, bones, rest, spine, left, right };
}

const worldY = (o: THREE.Object3D): number => o.getWorldPosition(new THREE.Vector3()).y;

describe('splitShowcase', () => {
  it('takes a baked showcase clip out of the list and keeps the rest in order', () => {
    const clips = [{ name: 'idle' }, { name: SHOWCASE_CLIP }, { name: 'move' }];
    expect(splitShowcase(clips)).toEqual({ showcase: { name: SHOWCASE_CLIP }, rest: [{ name: 'idle' }, { name: 'move' }] });
  });

  it('is a no-op on a GLB with none, which is every shipped one today', () => {
    const clips = [{ name: 'idle' }, { name: 'wreck' }];
    expect(splitShowcase(clips)).toEqual({ showcase: null, rest: clips });
  });
});

describe('the relaxed ready', () => {
  it('lowers a raised rifle: hands come down, the crouch comes out of the spine', () => {
    const f = figure('f0', true);
    // Raised: out in front, well under half the arm's length below the
    // shoulder even with the crouch tipping them down.
    expect(worldY(f.left.a) - worldY(f.left.h)).toBeLessThan(0.55 * READY_HANG_MAX);
    expect(applyReadyPose(f.root, f.bones, f.rest)).toBe(true);
    f.root.updateMatrixWorld(true);
    expect(f.spine.quaternion.angleTo(f.rest.get(f.spine)!.q)).toBeCloseTo(0, 9);
    for (const side of [f.left, f.right]) {
      // Pitched 90 degrees down about the shoulder line: the 0.55 arm now
      // hangs its whole length below the shoulder.
      expect(worldY(side.a) - worldY(side.h)).toBeCloseTo(0.55, 6);
    }
  });

  it('leaves a figure whose idle already carries the rifle low exactly as it was', () => {
    const f = figure('f0', false);
    const before = f.bones.map((b) => b.quaternion.clone());
    expect(applyReadyPose(f.root, f.bones, f.rest)).toBe(false);
    f.bones.forEach((b, i) => expect(b.quaternion.equals(before[i])).toBe(true));
  });

  it('decides per figure, by how far the hands hang', () => {
    const team = new THREE.Group();
    const up = figure('f0', true);
    const down = figure('f1', false);
    team.add(up.root, down.root);
    const bones = [...up.bones, ...down.bones];
    const rest = new Map([...up.rest, ...down.rest]);
    const downSpine = down.spine.quaternion.clone();
    expect(applyReadyPose(team, bones, rest)).toBe(true);
    // The hanging figure's crouch is untouched; the raised one's is reset.
    expect(down.spine.quaternion.equals(downSpine)).toBe(true);
    expect(up.spine.quaternion.angleTo(up.rest.get(up.spine)!.q)).toBeCloseTo(0, 9);
    expect(READY_HANG_MAX).toBeGreaterThan(0);
    expect(READY_HANG_MAX).toBeLessThan(1);
  });

  it('does nothing to a rigidly bound kit figure, which has no arm bones', () => {
    const root = new THREE.Group();
    root.add(bone('at_fire_root'), bone('at_fire_death_root'));
    const bones = bonesOf(root);
    expect(applyReadyPose(root, bones, new Map())).toBe(false);
  });
});

describe('poseRigged: where the pose comes from', () => {
  const scaleClip = (name: string, boneName: string, s: number): THREE.AnimationClip =>
    new THREE.AnimationClip(name, 1, [new THREE.VectorKeyframeTrack(`${boneName}.scale`, [0, 1], [s, s, s, s, s, s])]);

  it('prefers a baked showcase clip over idle', () => {
    const root = new THREE.Group();
    const dead = bone('a_death_root');
    root.add(dead);
    const r = poseRigged(root, { showcase: scaleClip(SHOWCASE_CLIP, 'a_death_root', 0), idle: scaleClip('idle', 'a_death_root', 1) });
    expect(r.source).toBe('showcase');
    expect(dead.scale.x).toBe(0);
  });

  it("falls back to idle frame 0, whose scale keys hide the death rig the bind pose shows", () => {
    const root = new THREE.Group();
    const dead = bone('a_death_root');
    root.add(bone('a_root'), dead);
    expect(dead.scale.x).toBe(1);
    const r = poseRigged(root, { showcase: null, idle: scaleClip('idle', 'a_death_root', 0) });
    expect(r.source).toBe('idle0');
    expect(dead.scale.x).toBe(0);
    expect(livingFigureRoots(bonesOf(root)).map((b) => b.name)).toEqual(['a_root']);
  });

  it('reports the bind pose when there is no clip at all', () => {
    expect(poseRigged(new THREE.Group(), { showcase: null, idle: null }).source).toBe('bind');
  });
});

describe('livingFigureRoots', () => {
  it('takes the shown top-level bones and drops a hidden death rig or walker', () => {
    const root = new THREE.Group();
    const a = bone('demo_a_root');
    const b = bone('demo_b_root');
    const da = bone('demo_a_death_root');
    da.scale.setScalar(0);
    const walk = bone('demo_walker');
    walk.scale.setScalar(0);
    const child = bone('demo_a_pelvis');
    a.add(child);
    root.add(a, b, da, walk);
    expect(livingFigureRoots(bonesOf(root)).map((x) => x.name)).toEqual(['demo_a_root', 'demo_b_root']);
  });

  it('keeps a bone NAMED for death when it is the one that is shown (the prone sniper)', () => {
    const root = new THREE.Group();
    const living = bone('snp_a_death_root');
    const empty = bone('snp_a_root');
    empty.scale.setScalar(0);
    root.add(living, empty);
    expect(livingFigureRoots(bonesOf(root)).map((x) => x.name)).toEqual(['snp_a_death_root']);
  });
});

describe('figureTurner: each figure turns on its own spot', () => {
  it('turns about the world vertical through the figure, even under a rotated armature', () => {
    const armature = new THREE.Group();
    // A Y-up conversion and the mesh scale, as a Meshy import carries.
    armature.rotation.x = -Math.PI / 2;
    armature.scale.setScalar(1 / 3);
    const scene = new THREE.Group();
    scene.add(armature);
    const fig = bone('f0_Hips', 0.6, 0, 0);
    const nose = new THREE.Object3D();
    // One unit in front of the figure, in world terms: local +X here is
    // world +X under this armature.
    nose.position.set(3, 0, 0);
    fig.add(nose);
    armature.add(fig);
    scene.updateMatrixWorld(true);
    const axis = fig.getWorldPosition(new THREE.Vector3());
    const start = nose.getWorldPosition(new THREE.Vector3());
    const turn = figureTurner([fig]);
    turn(90);
    scene.updateMatrixWorld(true);
    expect(fig.getWorldPosition(new THREE.Vector3()).distanceTo(axis)).toBeCloseTo(0, 9);
    const end = nose.getWorldPosition(new THREE.Vector3());
    expect(end.y).toBeCloseTo(start.y, 9);
    // rotation.y = +90 sends +X to -Z.
    expect(end.x - axis.x).toBeCloseTo(0, 9);
    expect(end.z - axis.z).toBeCloseTo(-1, 9);
    // 450 is 90: the turn wraps.
    turn(450);
    scene.updateMatrixWorld(true);
    expect(nose.getWorldPosition(new THREE.Vector3()).distanceTo(end)).toBeCloseTo(0, 9);
  });

  it('turns two figures independently, each about its own axis', () => {
    const root = new THREE.Group();
    const a = bone('a', 0, 0, -1);
    const b = bone('b', 0, 0, 1);
    root.add(a, b);
    figureTurner([a, b])(180);
    root.updateMatrixWorld(true);
    expect(a.getWorldPosition(new THREE.Vector3()).z).toBeCloseTo(-1, 9);
    expect(b.getWorldPosition(new THREE.Vector3()).z).toBeCloseTo(1, 9);
  });
});

describe('the line', () => {
  it('orders figures as they stood and stands them evenly across the view, centred', () => {
    const armature = new THREE.Group();
    armature.rotation.x = -Math.PI / 2;
    const root = new THREE.Group();
    root.add(armature);
    // Local y under this armature is world -Z: these stand in depth order.
    const a = bone('a', 0.1, 0.5, 0);
    const b = bone('b', 0.0, -0.5, 0);
    const c = bone('c', 0.2, 0.0, 0);
    armature.add(a, b, c);
    root.updateMatrixWorld(true);
    const ordered = lineOrder([a, b, c]);
    expect(ordered.map((x) => x.name)).toEqual(['a', 'c', 'b']);
    respaceLine(ordered, 0.4);
    root.updateMatrixWorld(true);
    const zs = ordered.map((x) => x.getWorldPosition(new THREE.Vector3()).z);
    expect(zs[1] - zs[0]).toBeCloseTo(0.4, 9);
    expect(zs[2] - zs[1]).toBeCloseTo(0.4, 9);
    expect(zs[0] + zs[1] + zs[2]).toBeCloseTo(0, 9);
    const xs = ordered.map((x) => x.getWorldPosition(new THREE.Vector3()).x);
    expect(xs[0]).toBeCloseTo(xs[1], 9);
    expect(xs[1]).toBeCloseTo(xs[2], 9);
  });
});

describe('visiblePoints', () => {
  it('skips a mesh under a hidden ancestor and tags each point with its figure', () => {
    const root = new THREE.Group();
    const a = bone('a', 0, 0, 0);
    const dead = bone('a_death_root');
    dead.scale.setScalar(0);
    root.add(a, dead);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 0, 1, 0, 0], 3));
    const shown = new THREE.Mesh(geo);
    const hidden = new THREE.Mesh(geo);
    a.add(shown);
    dead.add(hidden);
    const { points, owner } = visiblePoints(root, [a]);
    expect(points).toHaveLength(3);
    expect(owner).toEqual([0, 0, 0]);
  });

  it('skins on the CPU and drops vertices bound to a bone the pose scaled to nothing', () => {
    const root = new THREE.Group();
    const live = bone('live', 0, 0, 0);
    const corpse = bone('corpse_death_root', 0, 0, 0);
    root.add(live, corpse);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 1, 0, 0, 2, 0], 3));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0, 1, 0, 0, 0], 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0], 4));
    const mesh = new THREE.SkinnedMesh(geo);
    root.add(mesh);
    root.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton([live, corpse]));
    // Pose: the living bone moves up 5, the corpse is hidden.
    live.position.y = 5;
    corpse.scale.setScalar(0);
    const { points, owner } = visiblePoints(root, [live]);
    expect(points).toHaveLength(1);
    expect(points[0].y).toBeCloseTo(6, 9);
    expect(owner).toEqual([0]);
  });
});
