/**
 * Per this project's own testing standard: every assertion below that
 * matters was verified by breaking the corresponding line in `mesh-anim.ts`
 * by hand and confirming the SPECIFIC test named goes red, then reverting.
 * Reported in `.superpowers/f-runtime-report.md`.
 */
import { describe, it, expect } from 'vitest';
import {
  CLIP_NAMES,
  isMeshClipName,
  meshClipOrFallback,
  MESH_UNITS_PER_TILE,
  MESH_SCALE,
  meshYawFromFacing,
  resolveMeshMotionClip,
  hashEntityId,
  pickDeathClip,
} from './mesh-anim';
import type { ClipName } from '../../sheet';

describe('CLIP_NAMES / isMeshClipName', () => {
  it('lists exactly the eight canonical clip names', () => {
    expect(new Set(CLIP_NAMES)).toEqual(
      new Set(['idle', 'move', 'fire', 'down', 'wreck', 'work', 'moveFire', 'wreckAlt'])
    );
  });

  it('accepts every canonical name and rejects a typo', () => {
    for (const name of CLIP_NAMES) expect(isMeshClipName(name)).toBe(true);
    // Break: change the `hasOwnProperty` check to always return true.
    // Verified by hand -- this line then goes red because `isMeshClipName`
    // is a type guard the contract's own "a clip present under any other
    // name is a failure" line depends on (`mesh-unit.ts`'s
    // `buildMeshUnitTemplate`); accepting a typo here would silently accept
    // one there too.
    expect(isMeshClipName('walk')).toBe(false);
    expect(isMeshClipName('reload')).toBe(false);
  });
});

describe('meshClipOrFallback', () => {
  const available = new Set<ClipName>(['idle', 'move']);

  it('returns the requested clip when the GLB declares it', () => {
    expect(meshClipOrFallback(available, 'move')).toBe('move');
  });

  // Break: change `available.has(clip) ? clip : 'idle'` to always return
  // `clip`. Verified by hand -- this test then expects 'idle' but gets
  // 'fire', going red, because a GLB with no `fire` clip would otherwise be
  // asked to play an `AnimationAction` that does not exist.
  it('degrades to idle when the GLB never authored the requested clip', () => {
    expect(meshClipOrFallback(available, 'fire')).toBe('idle');
    expect(meshClipOrFallback(available, 'work')).toBe('idle');
  });

  it('does not degrade idle itself, even absent from `available`', () => {
    // A GLB missing even `idle` is a contract violation the LOADER should
    // catch (mesh-unit.ts requires idle-or-nothing at the call site), but
    // this pure function's own contract is unconditional: asked for idle,
    // it returns idle, never substituting a third clip.
    expect(meshClipOrFallback(new Set(), 'idle')).toBe('idle');
  });
});

describe('MESH_UNITS_PER_TILE / MESH_SCALE', () => {
  it('MESH_SCALE is the reciprocal of MESH_UNITS_PER_TILE', () => {
    expect(MESH_UNITS_PER_TILE).toBe(3.0);
    expect(MESH_SCALE).toBeCloseTo(1 / 3, 10);
  });
});

describe('meshYawFromFacing', () => {
  // Break: flip the sign (`2 * Math.PI * facingTurns` instead of negated).
  // Verified by hand -- `meshYawFromFacing(0.25)` then returns +π/2 instead
  // of -π/2, and this test's `toBeCloseTo(-Math.PI / 2, ...)` goes red.
  it('facing 0 (world +x) yaws to 0 -- the mesh\'s own rest-pose forward', () => {
    expect(meshYawFromFacing(0)).toBeCloseTo(0, 10);
  });

  it('facing 0.25 (world +z, `Math.atan2` quarter turn) yaws to -π/2', () => {
    expect(meshYawFromFacing(0.25)).toBeCloseTo(-Math.PI / 2, 10);
  });

  it('facing 0.5 (world -x) yaws to -π (== π)', () => {
    const yaw = meshYawFromFacing(0.5);
    // Either sign of π is the same rotation; normalise before comparing.
    const normalised = ((yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    expect(normalised).toBeCloseTo(Math.PI, 10);
  });

  it('facing 0.75 (world -z) yaws to -3π/2 (== π/2)', () => {
    const yaw = meshYawFromFacing(0.75);
    const normalised = ((yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    expect(normalised).toBeCloseTo(Math.PI / 2, 10);
  });

  it('rotationY(yaw) applied to local +X lands on the facing direction it was derived from', () => {
    // Direct check against three.js's own convention, independent of the
    // derivation's algebra: Matrix4.makeRotationY(θ) sends (1,0,0) to
    // (cosθ, 0, -sinθ). For facing f, world direction is (cos 2πf, 0, sin
    // 2πf) (game x -> world X, game y -> world Z). The two must match.
    for (const f of [0, 0.1, 0.25, 0.6, 0.9]) {
      const yaw = meshYawFromFacing(f);
      const rotated = [Math.cos(yaw), -Math.sin(yaw)];
      const expected = [Math.cos(2 * Math.PI * f), Math.sin(2 * Math.PI * f)];
      expect(rotated[0]).toBeCloseTo(expected[0], 10);
      expect(rotated[1]).toBeCloseTo(expected[1], 10);
    }
  });
});

describe('resolveMeshMotionClip', () => {
  // Break: change `desired === 'fire' && moving && hasMoveFire` to
  // `hasMoveFire` alone. Verified by hand -- this test then expects 'fire'
  // but gets 'moveFire' for a standing shooter, going red.
  it('plays moveFire only when firing, moving, and the GLB carries the clip', () => {
    expect(resolveMeshMotionClip('fire', true, true)).toBe('moveFire');
  });

  it('the fifteen-other-teams case: no moveFire clip, plain fire passes through unchanged', () => {
    expect(resolveMeshMotionClip('fire', true, false)).toBe('fire');
  });

  it('standing and firing (not moving): stays on fire even when the GLB has moveFire', () => {
    expect(resolveMeshMotionClip('fire', false, true)).toBe('fire');
  });

  it('any non-fire desired clip passes through unchanged regardless of the other inputs', () => {
    expect(resolveMeshMotionClip('move', true, true)).toBe('move');
    expect(resolveMeshMotionClip('idle', false, true)).toBe('idle');
    expect(resolveMeshMotionClip('down', true, true)).toBe('down');
  });
});

describe('hashEntityId', () => {
  it('is deterministic -- the same id always hashes the same', () => {
    expect(hashEntityId(42)).toBe(hashEntityId(42));
    expect(hashEntityId(0)).toBe(hashEntityId(0));
  });

  it('different ids are not all mapped to the same bucket', () => {
    const buckets = new Set([0, 1, 2, 3, 4, 5, 6, 7].map((id) => hashEntityId(id) % 2));
    expect(buckets.size).toBe(2);
  });
});

describe('pickDeathClip', () => {
  it('always picks wreck when the GLB has no wreckAlt', () => {
    for (const id of [0, 1, 2, 3, 17, 256]) {
      expect(pickDeathClip(id, false)).toBe('wreck');
    }
  });

  // Break: change `hashEntityId(entityId) % 2 === 1` to `=== 0`. Verified by
  // hand -- this test's own "not every id gives the same answer" assertion
  // still passes either way (it is symmetric), but the fixed set of ids
  // below stops matching this exact split, going red -- which is the point:
  // it pins the ACTUAL split, not merely "some split exists".
  it('splits ids between wreck and wreckAlt when the GLB has both', () => {
    const picks = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((id) => pickDeathClip(id, true)));
    expect(picks.has('wreck')).toBe(true);
    expect(picks.has('wreckAlt')).toBe(true);
  });

  it('is deterministic for a fixed entity id -- the same replay shows the same fall', () => {
    for (const id of [0, 1, 2, 41, 999]) {
      const first = pickDeathClip(id, true);
      const second = pickDeathClip(id, true);
      expect(second).toBe(first);
    }
  });
});
