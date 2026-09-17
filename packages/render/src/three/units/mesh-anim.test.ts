/**
 * Per this project's own testing standard: every assertion below that
 * matters was verified by breaking the corresponding line in `mesh-anim.ts`
 * by hand and confirming the SPECIFIC test named goes red, then reverting.
 * Reported in `.superpowers/f-runtime-report.md`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
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
  LOCOMOTION_CLIPS,
  isLocomotionClip,
  clipGroundSpeedTiles,
  gaitTimeScale,
  parseGaitExtras,
  GAIT_TIME_SCALE_MAX,
  GAIT_TIME_SCALE_MIN,
} from './mesh-anim';
import { ROUT_CADENCE } from '../../clip';
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

// --- gait: playback matched to measured ground speed ---------------------
//
// The numbers used below are the SHIPPED declarations, read off
// `art/meshes/**` by `pnpm gait:meshes`'s own instrument (Task 5) and
// restated here so a reader can check the arithmetic by hand.
//
// **They are LITERALS here, but something DOES check them against the
// bytes -- just not this file.** Design sec 3.5's shipped-bytes sweep landed
// in Task 7's gate: `tools/src/mesh_gait.test.ts`'s "declared rl_gait against
// a fresh measurement" describe block (mesh_gait.test.ts:1425-1442) reads
// every declaration off the shipped `art/meshes/**` bytes and reds on a
// re-export that skipped `pnpm gait:meshes` -- the exact risk an earlier
// version of this header said was still open ("someone re-exporting
// `yahalom_engineer.glb` with a longer stride and leaving this file alone").
// Re-running `pnpm gait:meshes` still means re-reading THESE literals and the
// table in `GAIT_TIME_SCALE_MAX`'s doc comment by hand, if it is this file's
// own numbers you want brought current.

describe('LOCOMOTION_CLIPS / isLocomotionClip', () => {
  it('names exactly the two clips that describe ground travel', () => {
    expect([...LOCOMOTION_CLIPS].sort()).toEqual(['move', 'moveFire']);
  });

  it('rejects every other clip name -- a stride is the only thing rate-matching can scale', () => {
    // Warning 5 in one assertion: `idle`, `fire`, `down`, `work` and the two
    // wreck poses have no stride, so scaling their playback rate by a ground
    // speed is meaningless. Break: add `idle` to LOCOMOTION_CLIPS and this
    // goes red.
    for (const name of CLIP_NAMES) {
      const expected = name === 'move' || name === 'moveFire';
      expect(isLocomotionClip(name)).toBe(expected);
    }
    expect(isLocomotionClip('walk')).toBe(false);
  });
});

describe('clipGroundSpeedTiles', () => {
  it('converts a stride in METRES and a cycle in seconds into tiles/s', () => {
    // `meshy_mortar_team.glb`: 1.2761 m of forward boot travel over a
    // 0.6667 s cycle. One tile is 3 m, so the clip covers 0.42537 tiles per
    // cycle at 1.5 cycles/s -- 0.63805 tiles/s. Break: drop the
    // MESH_UNITS_PER_TILE divisor and this reads 1.914, going red.
    expect(clipGroundSpeedTiles({ strideM: 1.2761, cycleS: 0.6667 })).toBeCloseTo(0.63805, 4);
  });

  it('a longer clip at the same stride is a SLOWER clip', () => {
    // Pins the direction of `cycleS`. Break: multiply by `cycleS` instead of
    // dividing and this inverts, going red.
    const quick = clipGroundSpeedTiles({ strideM: 1.2, cycleS: 0.5 });
    const slow = clipGroundSpeedTiles({ strideM: 1.2, cycleS: 1.0 });
    expect(slow).toBeCloseTo(quick / 2, 10);
  });
});

describe('gaitTimeScale', () => {
  /** `meshy_mortar_team.glb`'s shipped declaration. */
  const MORTAR = { strideM: 1.2761, cycleS: 0.6667 };

  it("plays a clip at 1x when the unit moves at the clip's own ground speed", () => {
    // 0.63805 tiles/s is what MORTAR's legs describe (see the block above),
    // and `mortar_team`'s own `speed_tiles_s` is 0.65 -- the one shipped
    // mesh whose feet already very nearly kept up (design sec 2.2, ratio
    // 0.987).
    expect(gaitTimeScale(MORTAR, 0.63805, 1)).toBeCloseTo(1, 4);
  });

  it('speeds a clip up when the unit outruns its own legs', () => {
    // 3 places, not 4: 0.63805 is itself a rounded restatement of
    // 1.2761 / (0.6667 * 3), so doubling it carries the rounding with it.
    expect(gaitTimeScale(MORTAR, 2 * 0.63805, 1)).toBeCloseTo(2, 3);
  });

  it('SLOWS a clip down when the ground slows the unit -- the point of the whole change', () => {
    // A unit sliding along a wall keeps only one axis of a diagonal step, so
    // it crosses 0.707 of its own nominal ground. Its legs must slow with
    // it; today they march at full cadence whatever it does. Break: raise
    // GAIT_TIME_SCALE_MIN to the brief's example 0.5 and the second
    // assertion goes red.
    expect(gaitTimeScale(MORTAR, 0.707 * 0.63805, 1)).toBeCloseTo(0.707, 4);
    expect(gaitTimeScale(MORTAR, 0.1 * 0.63805, 1)).toBeCloseTo(0.1, 4);
  });

  it('carries rout cadence, which no MESH code has ever read', () => {
    const calm = gaitTimeScale(MORTAR, 0.63805, 1);
    const routed = gaitTimeScale(MORTAR, 0.63805, ROUT_CADENCE);
    expect(routed / calm).toBeCloseTo(ROUT_CADENCE, 10);
  });

  it('clamps rather than playing a clip at an absurd rate', () => {
    // The case this guard exists for is a TELEPORT, not art: a unit
    // surfacing from a tunnel, dismounting, or spawning as a reinforcement
    // moves tens of tiles between two ticks, and `entitySpeed` is a raw
    // per-tick position delta times 20 Hz.
    expect(gaitTimeScale(MORTAR, 99, 1)).toBe(GAIT_TIME_SCALE_MAX);
    expect(gaitTimeScale(MORTAR, 0, 1)).toBe(GAIT_TIME_SCALE_MIN);
  });

  it('leaves the clamp well clear of every shipped multiplier', () => {
    // `yahalom_engineer.glb` is the worst shipped case: 1.0041 m over a
    // 1.0417 s cycle is 0.32131 tiles/s of leg, against `yahalom_squad`'s
    // own 0.85 tiles/s of ground -- 2.6454x. The brief's example clamped at
    // 2.5, which would have clipped exactly that unit and quietly put the
    // slide back on the one mesh with the largest correction to make.
    const yahalom = { strideM: 1.0041, cycleS: 1.0417 };
    expect(gaitTimeScale(yahalom, 0.85, 1)).toBeCloseTo(2.6454, 3);
    expect(gaitTimeScale(yahalom, 0.85, 1)).toBeLessThan(GAIT_TIME_SCALE_MAX);
  });

  it("is 1 for a mesh that declares no gait, which is exactly today's behaviour", () => {
    // `atgm_cell`, `mortar_crew`, `digger_crew` (crew-served, no leg keys)
    // and `moto_rpg` (a motorcycle) declare none, legitimately.
    expect(gaitTimeScale(undefined, 0.9, 1)).toBe(1);
    expect(gaitTimeScale(undefined, 0.9, ROUT_CADENCE)).toBe(1);
  });

  it('is 1, not NaN, for a degenerate declaration or a NaN position', () => {
    expect(gaitTimeScale({ strideM: 0, cycleS: 0.667 }, 0.9, 1)).toBe(1);
    expect(gaitTimeScale({ strideM: 1.2761, cycleS: 0 }, 0.9, 1)).toBe(1);
    expect(gaitTimeScale({ strideM: 1.2761, cycleS: 0.6667 }, Number.NaN, 1)).toBe(1);
  });
});

describe('parseGaitExtras', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads the shape `pnpm gait:meshes` writes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gait = parseGaitExtras(
      { move: { strideM: 1.0948, cycleS: 0.625 }, moveFire: { strideM: 1.5534, cycleS: 0.6667 } },
      'meshy_soldier.glb'
    );
    expect(gait?.get('move')).toEqual({ strideM: 1.0948, cycleS: 0.625 });
    expect(gait?.get('moveFire')).toEqual({ strideM: 1.5534, cycleS: 0.6667 });
    expect(warn).not.toHaveBeenCalled();
  });

  it('is undefined when the file declares nothing -- the four crew-served rigs', () => {
    expect(parseGaitExtras(undefined, 'atgm_cell.glb')).toBeUndefined();
  });

  it('drops a NON-LOCOMOTION clip and names the file', () => {
    // Structural enforcement of warning 5: a gait for `fire` cannot reach
    // the arithmetic at all, because it never enters the map the renderer
    // looks a clip up in. Break: accept any `isMeshClipName` key and this
    // goes red.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gait = parseGaitExtras(
      { move: { strideM: 1.2, cycleS: 0.6 }, fire: { strideM: 1.2, cycleS: 0.6 } },
      'suspect.glb'
    );
    expect([...(gait?.keys() ?? [])]).toEqual(['move']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('suspect.glb');
    expect(String(warn.mock.calls[0]?.[0])).toContain('fire');
  });

  it.each([
    ['a missing strideM', { move: { cycleS: 0.6 } }],
    ['a zero cycle', { move: { strideM: 1.2, cycleS: 0 } }],
    ['a negative stride', { move: { strideM: -1.2, cycleS: 0.6 } }],
    ['a stride that is a string', { move: { strideM: '1.2', cycleS: 0.6 } }],
    ['a clip entry that is not an object', { move: 1.2 }],
  ])('drops %s rather than letting it reach the arithmetic', (_label, raw) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gait = parseGaitExtras(raw, 'suspect.glb');
    expect(gait?.get('move')).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).toContain('suspect.glb');
  });

  it('warns rather than returning a silent empty map for `rl_gait: {}`', () => {
    // An empty result is a silent one, not a weak one. A file that declares
    // the key and fills it with nothing is a build that half-ran, and it
    // must not read the same as a file that legitimately declares none.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gait = parseGaitExtras({}, 'half-run.glb');
    expect(gait?.size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('half-run.glb');
  });

  it('rejects a non-object `rl_gait` outright', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseGaitExtras([1, 2, 3], 'array.glb')).toBeUndefined();
    expect(parseGaitExtras('move', 'string.glb')).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
