import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { ClipName } from '../../sheet';
import { isMeshClipName } from './mesh-anim';
import { MED_CARRYING, MED_DELIVERING, MED_IDLE, MED_TO_WOUNDED, MED_TREATING } from '@lions/sim';
import { RESCUE_CLIP_NAMES, figuresShown, rescueClipFor, woundedHiddenByCarry } from './rescue-pose';
import { beginMeshDeath, stepMeshDeath } from './mesh-death';
import { buildSquadRig, concealFigures, reassertHiddenFigures, revealFigures, setDrawnAsOne, splitClips, type FigureSpec } from './squad-rig';

const has = (...n: ClipName[]): Set<ClipName> => new Set(n);
const wounded = { isWounded: true, isMedic: false, medState: MED_IDLE, moving: false };
const medic = (medState: number, moving = false) => ({ isWounded: false, isMedic: true, medState, moving });

describe('rescueClipFor', () => {
  it('leaves every other unit alone', () => {
    expect(rescueClipFor({ isWounded: false, isMedic: false, medState: MED_TREATING, moving: true }, has('treat', 'carry', 'crawl'))).toBeNull();
  });
  it('a wounded man lies on idleWounded, else down, and is inert with neither', () => {
    expect(rescueClipFor(wounded, has('idleWounded', 'down'))).toBe('idleWounded');
    expect(rescueClipFor(wounded, has('down'))).toBe('down');
    expect(rescueClipFor(wounded, has('idle'))).toBeNull();
  });
  it('a moving wounded man crawls, and only when the GLB has crawl', () => {
    expect(rescueClipFor({ ...wounded, moving: true }, has('crawl', 'down'))).toBe('crawl');
    expect(rescueClipFor({ ...wounded, moving: true }, has('down', 'move'))).toBeNull();
  });
  it('a treating medic plays treat, else kneel, else nothing', () => {
    expect(rescueClipFor(medic(MED_TREATING), has('treat', 'kneel'))).toBe('treat');
    expect(rescueClipFor(medic(MED_TREATING), has('kneel'))).toBe('kneel');
    expect(rescueClipFor(medic(MED_TREATING), has('idle'))).toBeNull();
  });
  it('a carrying or delivering medic plays carry, an idle or walking one nothing', () => {
    expect(rescueClipFor(medic(MED_CARRYING, true), has('carry'))).toBe('carry');
    expect(rescueClipFor(medic(MED_DELIVERING), has('carry'))).toBe('carry');
    expect(rescueClipFor(medic(MED_CARRYING), has('treat'))).toBeNull();
    expect(rescueClipFor(medic(MED_IDLE), has('carry', 'treat'))).toBeNull();
    expect(rescueClipFor(medic(MED_TO_WOUNDED, true), has('carry', 'treat'))).toBeNull();
  });
  it('every clip it can ask for is a canonical mesh clip name', () => {
    for (const n of RESCUE_CLIP_NAMES) expect(isMeshClipName(n)).toBe(true);
    expect([...RESCUE_CLIP_NAMES].sort()).toEqual(['carry', 'crawl', 'down', 'idleWounded', 'kneel', 'treat']);
  });
});

describe('woundedHiddenByCarry', () => {
  it('hides a carried wounded only', () => {
    expect(woundedHiddenByCarry(true, 7)).toBe(true);
    expect(woundedHiddenByCarry(true, -1)).toBe(false);
    expect(woundedHiddenByCarry(false, 7)).toBe(false);
  });
});

describe('figuresShown', () => {
  it('takes no path for a single-figure type', () => {
    expect(figuresShown(1, 1, 3)).toBeNull();
    expect(figuresShown(1, 0, 3)).toBeNull();
  });
  it('is one-to-one when the GLB matches', () => {
    expect([3, 2, 1].map((up) => figuresShown(3, up, 3))).toEqual([3, 2, 1]);
  });
  it('never hides the last figure of a team, even at zero up', () => {
    expect(figuresShown(3, 0, 3)).toBe(1);
  });
  it('maps proportionally when the GLB differs', () => {
    expect(figuresShown(4, 2, 2)).toBe(1);
    expect(figuresShown(4, 3, 2)).toBe(2);
    expect(figuresShown(2, 1, 4)).toBe(2);
    expect(figuresShown(3, 9, 3)).toBe(3);
  });
  it('shows nothing new for a GLB without figures', () => {
    expect(figuresShown(3, 2, 0)).toBeNull();
  });
});

describe('conceal and reveal on a built rig', () => {
  const specs: FigureSpec[] = ['a', 'b', 'c'].map((prefix) => ({ prefix, recoil: null, squad: false }));
  /** Three figures; `b_death_root` rests at scale 0.5 and a `scaled` clip keys it 0 -> 1. */
  function rig() {
    const root = new THREE.Group();
    for (const p of ['a', 'b', 'c']) {
      const bone = new THREE.Bone();
      bone.name = `${p}_root`;
      root.add(bone);
    }
    const death = new THREE.Bone();
    death.name = 'b_death_root';
    death.scale.setScalar(0.5);
    root.add(death);
    const mixer = new THREE.AnimationMixer(root);
    const keyed = new THREE.AnimationClip('keyed', 1, [
      new THREE.VectorKeyframeTrack('b_death_root.scale', [0, 0.1], [0, 0, 0, 1, 1, 1]),
    ]);
    const r = buildSquadRig(root, mixer, specs, null)!;
    return { root, r, mixer, keyed };
  }
  const s = (root: THREE.Object3D, n: string) => root.getObjectByName(n)!.scale.x;

  it('collapses the topmost figures and restores each to its REST scale on a rejoin', () => {
    const { root, r } = rig();
    concealFigures(r, 2);
    expect([s(root, 'a_root'), s(root, 'b_root'), s(root, 'c_root')]).toEqual([1, 1, 0]);
    concealFigures(r, 1);
    expect([s(root, 'a_root'), s(root, 'b_root'), s(root, 'b_death_root'), s(root, 'c_root')]).toEqual([1, 0, 0, 0]);
    revealFigures(r, 3);
    expect([s(root, 'a_root'), s(root, 'b_root'), s(root, 'c_root')]).toEqual([1, 1, 1]);
    expect(s(root, 'b_death_root')).toBe(0.5); // its rest, not 1
  });
  it('keeps one figure standing at a count of zero', () => {
    const { root, r } = rig();
    concealFigures(r, 0);
    expect([s(root, 'a_root'), s(root, 'b_root')]).toEqual([1, 0]);
  });
  it('a full-strength team is never written', () => {
    const { root, r } = rig();
    root.getObjectByName('a_root')!.scale.setScalar(2);
    revealFigures(r, 3);
    expect(s(root, 'a_root')).toBe(2);
  });
  it('a scale-keyed clip does not undo the hide once it is re-asserted after the mixer', () => {
    const { root, r, mixer, keyed } = rig();
    mixer.clipAction(keyed).play();
    concealFigures(r, 1);
    mixer.update(0.5);
    expect(s(root, 'b_death_root')).toBe(1); // the mixer wrote it back
    reassertHiddenFigures(r);
    expect(s(root, 'b_death_root')).toBe(0);
    reassertHiddenFigures(null); // a team with no rig
  });
  it('a rejoin before the mixer lets the keyed clip own the node again', () => {
    const { root, r, mixer, keyed } = rig();
    mixer.clipAction(keyed).play();
    concealFigures(r, 1);
    revealFigures(r, 3);
    mixer.update(0.5);
    expect(s(root, 'b_death_root')).toBe(1);
  });
  it('stepMeshDeath keeps a hidden figure hidden while the fall clip keys it back on', () => {
    const { root, r, mixer } = rig();
    const fall = new THREE.AnimationClip('fall', 1, [
      new THREE.VectorKeyframeTrack('b_death_root.scale', [0, 1], [1, 1, 1, 1, 1, 1]),
    ]);
    const actions = new Map<ClipName, THREE.AnimationAction>([['fall', mixer.clipAction(fall)]]);
    const entity = { typeId: 't', root, mixer, actions, currentClip: null, clipScale: new Map(), fades: new Map(), squad: r };
    concealFigures(r, 1);
    const d = beginMeshDeath(entity as never);
    expect(d.phase).toBe('falling');
    stepMeshDeath(d, 0.25, { scene: new THREE.Scene(), elevation: null, width: 8, height: 8, isExplored: () => true } as never);
    expect(s(root, 'b_death_root')).toBe(0);
  });
});

describe('setDrawnAsOne', () => {
  const specs: FigureSpec[] = ['a', 'b'].map((prefix) => ({ prefix, recoil: null, squad: true }));
  it('parks the figure groups and stops their players going one-rig, and stops the team actions coming back', () => {
    const root = new THREE.Group();
    const arm = new THREE.Group();
    root.add(arm);
    for (const p of ['a', 'b']) {
      const bone = new THREE.Bone();
      bone.name = `${p}_root`;
      arm.add(bone);
    }
    const mixer = new THREE.AnimationMixer(root);
    const idle = new THREE.AnimationClip('idle', 1, [new THREE.VectorKeyframeTrack('a_root.position', [0, 1], [0, 0, 0, 0, 0, 0])]);
    const clips = splitClips(new Map<ClipName, THREE.AnimationClip>([['idle', idle]]), ['a', 'b'])!;
    const r = buildSquadRig(root, mixer, specs, clips)!;
    expect(r.squad).toBe(true);
    const team = { actions: new Map<ClipName, THREE.AnimationAction>([['idle', mixer.clipAction(idle)]]), currentClip: 'idle' as ClipName | null, clipScale: new Map(), fades: new Map() };
    const f = r.figures[0];
    f.group!.position.set(3, 0, 4);
    f.started = true;
    f.player!.currentClip = 'idle';
    setDrawnAsOne(team, r, true);
    expect([f.group!.position.x, f.started, f.player!.currentClip, r.asOne]).toEqual([0, false, null, true]);
    team.actions.get('idle')!.play();
    setDrawnAsOne(team, r, true); // idempotent: nothing is touched again
    expect(team.actions.get('idle')!.isRunning()).toBe(true);
    setDrawnAsOne(team, r, false);
    expect([team.currentClip, team.actions.get('idle')!.isRunning(), r.asOne]).toEqual([null, false, false]);
  });
});
