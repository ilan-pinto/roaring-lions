/**
 * `mesh-clip.ts` -- the owned crossfade ramp (D1) and the scale-signature
 * cut (D2). `environment: 'node'`; every action here is a real
 * `THREE.AnimationAction` on a real `AnimationMixer` bound to a parsed
 * fixture GLB, so `getEffectiveWeight` and `isRunning` are three.js's own.
 *
 * Falsifications, each run by hand and reverted (named in the commit):
 *   - ramp -> `action.fadeIn`: 'sum of weights is 1 across a re-selection' reads < 1
 *   - drop the signature comparison in `applyMeshClip`: 'a scale swap cuts' sees weight 0.5
 *   - `advanceMeshClipFades` never calls `stop()`: 'outgoing action is stopped at the end' fails
 *   - `isScheduled()` -> `isRunning()` in the blend branch's "carries weight" guard: 'a finished
 *     one-shot still fades out on the next switch' fails (fix round 1, GH review)
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildMeshUnitTemplate, instantiateMeshUnit, type MeshUnitEntity } from './mesh-unit';
import { parseFixture } from './mesh-fixture';
import {
  MESH_CLIP_FADE_SECONDS,
  SCALE_ANIMATED,
  applyMeshClip,
  advanceMeshClipFades,
  scaleSignature,
  transitionIsCut,
} from './mesh-clip';

async function entityWith(opts: Omit<Parameters<typeof parseFixture>[0], 'roleName'>): Promise<MeshUnitEntity> {
  const gltf = await parseFixture({ roleName: 'uniform', ...opts });
  return instantiateMeshUnit(buildMeshUnitTemplate(gltf, 'kdf'), 'inf_squad');
}

function weight(e: MeshUnitEntity, name: string): number {
  const a = e.actions.get(name as never);
  return a ? a.getEffectiveWeight() : 0;
}

function sumOfWeights(e: MeshUnitEntity): number {
  let s = 0;
  for (const a of e.actions.values()) if (a.isScheduled()) s += a.getEffectiveWeight();
  return s;
}

/** One frame: ramps, then the mixer, exactly the order every call site uses. */
function frame(e: MeshUnitEntity, dt: number): void {
  advanceMeshClipFades(e, dt);
  e.mixer.update(dt);
}

describe('scaleSignature', () => {
  const track = (name: string, values: number[]) =>
    new THREE.VectorKeyframeTrack(name, [0, 1], values);
  it('is null for a clip with no scale track', () => {
    const clip = new THREE.AnimationClip('idle', 1, [new THREE.QuaternionKeyframeTrack('b.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])]);
    expect(scaleSignature(clip)).toBeNull();
  });
  it('names every constant scale track and its value, sorted', () => {
    const clip = new THREE.AnimationClip('down', 1, [track('root.scale', [0, 0, 0, 0, 0, 0]), track('death_root.scale', [1, 1, 1, 1, 1, 1])]);
    expect(scaleSignature(clip)).toBe('death_root.scale=1.000;root.scale=0.000');
  });
  it('reads a scale track whose value changes as animated', () => {
    const clip = new THREE.AnimationClip('x', 1, [track('root.scale', [1, 1, 1, 0.5, 0.5, 0.5])]);
    expect(scaleSignature(clip)).toBe(SCALE_ANIMATED);
  });
});

describe('transitionIsCut', () => {
  it('blends two scale-free clips, and two clips keying the same scales', () => {
    expect(transitionIsCut(null, null)).toBe(false);
    expect(transitionIsCut('root.scale=1.000', 'root.scale=1.000')).toBe(false);
  });
  it('cuts when the signatures differ, when either is animated, and when there is no previous clip', () => {
    expect(transitionIsCut('root.scale=1.000', 'root.scale=0.000')).toBe(true);
    expect(transitionIsCut(null, 'root.scale=0.000')).toBe(true);
    expect(transitionIsCut(SCALE_ANIMATED, SCALE_ANIMATED)).toBe(true);
    expect(transitionIsCut(undefined, null)).toBe(true);
  });
});

describe('applyMeshClip -- the crossfade (D1)', () => {
  it('ramps the incoming clip 0 -> 1 and the outgoing 1 -> 0 over MESH_CLIP_FADE_SECONDS', async () => {
    const e = await entityWith({ clipName: ['idle', 'move'] });
    applyMeshClip(e, 'idle');
    frame(e, 0.5);
    applyMeshClip(e, 'move');
    expect(e.currentClip).toBe('move');
    frame(e, MESH_CLIP_FADE_SECONDS / 2);
    expect(weight(e, 'idle')).toBeCloseTo(0.5, 6);
    expect(weight(e, 'move')).toBeCloseTo(0.5, 6);
    frame(e, MESH_CLIP_FADE_SECONDS / 2);
    expect(weight(e, 'move')).toBeCloseTo(1, 6);
    expect(e.actions.get('idle')?.isRunning()).toBe(false); // outgoing action is stopped at the end
    expect(e.fades.size).toBe(0);
  });

  it('keeps the sum of running weights at exactly 1 across a re-selection mid-fade', async () => {
    const e = await entityWith({ clipName: ['idle', 'move', 'fire'] });
    applyMeshClip(e, 'idle');
    frame(e, 0.5);
    applyMeshClip(e, 'move');
    frame(e, 0.05); // idle 2/3, move 1/3
    applyMeshClip(e, 'idle'); // re-select the clip that is fading out
    for (let i = 0; i < 12; i++) {
      frame(e, 0.025);
      expect(sumOfWeights(e)).toBeCloseTo(1, 6);
    }
    applyMeshClip(e, 'fire');
    frame(e, 0.02);
    applyMeshClip(e, 'move'); // three actions live at once
    for (let i = 0; i < 12; i++) {
      frame(e, 0.025);
      expect(sumOfWeights(e)).toBeCloseTo(1, 6);
    }
    expect(e.currentClip).toBe('move');
    expect(weight(e, 'move')).toBeCloseTo(1, 6);
  });

  it('a re-selected clip keeps its own time rather than restarting', async () => {
    const e = await entityWith({ clipName: ['idle', 'move'] });
    applyMeshClip(e, 'move');
    frame(e, 0.4);
    applyMeshClip(e, 'idle');
    frame(e, 0.05);
    const before = e.actions.get('move')?.time ?? -1;
    applyMeshClip(e, 'move');
    expect(e.actions.get('move')?.time).toBeCloseTo(before, 6);
  });

  it('plays the very first clip at weight 1 with no ramp', async () => {
    const e = await entityWith({ clipName: ['idle'] });
    applyMeshClip(e, 'idle');
    expect(weight(e, 'idle')).toBe(1);
    expect(e.fades.size).toBe(0);
  });

  it('a once clip is entered with the fade and still holds its last frame', async () => {
    const e = await entityWith({ clipName: ['idle', 'wreck'] });
    applyMeshClip(e, 'idle');
    frame(e, 0.5);
    applyMeshClip(e, 'wreck', { once: true });
    frame(e, MESH_CLIP_FADE_SECONDS / 2);
    expect(weight(e, 'wreck')).toBeCloseTo(0.5, 6);
    for (let i = 0; i < 20; i++) frame(e, 0.1);
    expect(e.actions.get('wreck')?.paused).toBe(true);
    expect(weight(e, 'wreck')).toBeCloseTo(1, 6);
  });

  it('a finished one-shot still fades out on the next switch', async () => {
    // `down` and `wreck` share a scale signature (both root 0 / death_root
    // 1), so `down -> wreck` is a BLEND -- the case where a paused-but-
    // weighted action must still be picked up by the "carries weight" guard.
    // `idle -> down` differs in signature, so it is a CUT, matching the real
    // `mesh-death.ts` sequence this test reproduces.
    const e = await entityWith({
      clipName: ['idle', 'down', 'wreck'],
      clipSeconds: 0.1,
      scaleClips: {
        idle: { root: 1, deathRoot: 0 },
        down: { root: 0, deathRoot: 1 },
        wreck: { root: 0, deathRoot: 1 },
      },
    });
    applyMeshClip(e, 'idle');
    frame(e, 0.5);
    applyMeshClip(e, 'down', { once: true }); // a cut (idle/down differ in scale signature)
    frame(e, 0.5); // 5x the 0.1s clip length -- long since paused at its last frame
    expect(e.actions.get('down')?.paused).toBe(true);
    expect(e.actions.get('down')?.isRunning()).toBe(false);

    applyMeshClip(e, 'wreck', { once: true }); // a blend (down/wreck share a scale signature)
    expect(e.fades.has('down')).toBe(true);
    expect(e.fades.get('down')?.from).toBe(1);
    expect(e.fades.get('down')?.to).toBe(0);

    frame(e, MESH_CLIP_FADE_SECONDS);
    expect(e.actions.get('down')?.isScheduled()).toBe(false);
    expect(weight(e, 'wreck')).toBe(1);
  });
});

describe('applyMeshClip -- the cut (D2)', () => {
  it('a scale swap switches in one step: no intermediate weight, the outgoing action stopped', async () => {
    const e = await entityWith({
      clipName: ['idle', 'down'],
      scaleClips: { idle: { root: 1, deathRoot: 0 }, down: { root: 0, deathRoot: 1 } },
    });
    applyMeshClip(e, 'idle');
    frame(e, 0.5);
    applyMeshClip(e, 'down');
    expect(weight(e, 'down')).toBe(1);
    expect(e.actions.get('idle')?.isRunning()).toBe(false);
    frame(e, MESH_CLIP_FADE_SECONDS / 2);
    expect(weight(e, 'down')).toBe(1); // a cut has nothing to ramp
  });

  it('two clips keying the SAME scales still blend', async () => {
    const e = await entityWith({
      clipName: ['idle', 'move'],
      scaleClips: { idle: { root: 1, deathRoot: 0 }, move: { root: 1, deathRoot: 0 } },
    });
    applyMeshClip(e, 'idle');
    frame(e, 0.5);
    applyMeshClip(e, 'move');
    frame(e, MESH_CLIP_FADE_SECONDS / 2);
    expect(weight(e, 'move')).toBeCloseTo(0.5, 6);
  });

  it('`cut: true` forces the one-step switch on a scale-free pair', async () => {
    const e = await entityWith({ clipName: ['idle', 'wreck'] });
    applyMeshClip(e, 'idle');
    frame(e, 0.5);
    applyMeshClip(e, 'wreck', { once: true, cut: true });
    expect(weight(e, 'wreck')).toBe(1);
    expect(e.actions.get('idle')?.isRunning()).toBe(false);
  });

  it('the template carries one signature per clip, and the entity sees the same map', async () => {
    const gltf = await parseFixture({
      roleName: 'uniform',
      clipName: ['idle', 'down'],
      scaleClips: { idle: { root: 1, deathRoot: 0 }, down: { root: 0, deathRoot: 1 } },
    });
    const template = buildMeshUnitTemplate(gltf, 'kdf');
    expect(template.clipScale.get('idle')).toBe('death_root.scale=0.000;root_joint.scale=1.000');
    expect(template.clipScale.get('down')).toBe('death_root.scale=1.000;root_joint.scale=0.000');
    const e = instantiateMeshUnit(template, 'inf_squad');
    expect(e.clipScale).toBe(template.clipScale);
  });
});
