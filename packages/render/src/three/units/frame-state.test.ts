/**
 * `entityFrame` is the pure per-entity decision Task B3.3 ports from Pixi's
 * `frame()` unit loop (`renderer.ts:1919` onward) -- interpolation, ground
 * lift, contact-level alpha, garrison roof placement, clip resolution, frame
 * advance, facing. Every case below is chosen to fail if the corresponding
 * behaviour were reimplemented wrong, not merely to exercise a code path --
 * see this file's own break-check notes inline where one exists.
 */
import { describe, it, expect } from 'vitest';
import { fx, HALF_TURN } from '@lions/sim';
import {
  entityFrame,
  assignRoofSlots,
  ROOF_SLOTS,
  ROOF_SPREAD_PX,
  RECOIL_PX_VEHICLE,
  RECOIL_PX_SOFT,
  FLINCH_PX,
  AIR_LIFT_PX,
  TURRET_STIFFNESS,
  TURRET_DAMPING,
  type EntityFrameInput,
  type EntityFrame,
} from './frame-state';
import { resolveClip, resolveTurretClip, type UnitAnimInput } from '../../clip';
import { phaseOffset } from '../../anim';
import { clipOrFallback, type SheetSpec } from '../../sheet';
import { WORLD_Y_PER_LIFT_PIXEL } from '../../project';
import { WORLD_PER_LEVEL, screenOffsetToWorld } from '../terrain/shared';

/** A representative clip-layout sheet: idle/move/fire/down, 8 facings.
 *  `move` has 4 frames -- enough to exercise real frame advance. */
const sheet: SheetSpec = {
  facings: 8,
  facingOffset: 0,
  facingReverse: false,
  scale: 1,
  layout: 'clip',
  clips: {
    idle: { frames: 10, fps: 0, loop: true, fileOffset: 0 },
    move: { frames: 4, fps: 0, loop: true, fileOffset: 0 },
    fire: { frames: 1, fps: 8, loop: false, fileOffset: 0 },
    down: { frames: 1, fps: 0, loop: false, fileOffset: 0 },
  },
};

/** The same sheet, minus `fire` -- for the fallback-to-idle case. */
const sheetNoFire: SheetSpec = {
  ...sheet,
  clips: { idle: sheet.clips.idle, move: sheet.clips.move, down: sheet.clips.down },
};

/** A turret sheet: idle plus a real `fire` clip, one frame per facing for
 *  each -- matching the gun truck's own shape (its "16 frames" are 16
 *  FACINGS of one recoiled pose, not a multi-frame animation within one
 *  facing). 8 facings, matching `sheet` above so a shared `facingNorm`
 *  means the same thing for both in these tests. */
const turretSheet: SheetSpec = {
  facings: 8,
  facingOffset: 0,
  facingReverse: false,
  scale: 1,
  layout: 'clip',
  clips: {
    idle: { frames: 1, fps: 0, loop: false, fileOffset: 0 },
    fire: { frames: 1, fps: 12, loop: false, fileOffset: 0 },
  },
};

/** A turret sheet with no `fire` clip at all -- every shipped turret but
 *  the gun truck's (`clip.test.ts`'s own `idleOnly` fixture, mirrored). */
const turretSheetIdleOnly: SheetSpec = {
  ...turretSheet,
  clips: { idle: turretSheet.clips.idle },
};

const baseAnim: UnitAnimInput = {
  alive: 1,
  routed: 0,
  pinned: 0,
  speed: 0,
  firing: false,
  working: false,
};

function makeInput(overrides: Partial<EntityFrameInput> = {}): EntityFrameInput {
  return {
    entityId: 0,
    prevX: 0,
    prevY: 0,
    curX: 0,
    curY: 0,
    alpha: 1,
    elevation: null,
    mapWidth: 4,
    mapHeight: 4,
    side: 0,
    contactLevel: 2,
    isAir: false,
    roofSlot: -1,
    roofPx: 0,
    sheet,
    anim: baseAnim,
    dtSeconds: 0,
    entityAnimFrame: new Float64Array(1),
    animSeeded: new Uint8Array(1),
    facing: 0,
    recoilT: 0,
    recoilDir: 0,
    recoilPower: 0,
    flinchT: 0,
    flinchDir: 0,
    turretSheet: null,
    turretTargetX: null,
    turretTargetY: null,
    turretFiring: false,
    turretFacing: new Float64Array(1),
    turretVel: new Float64Array(1),
    turretSeeded: new Uint8Array(1),
    ...overrides,
  };
}

describe('entityFrame — interpolation', () => {
  it('lands exactly on prevX/prevY at alpha 0', () => {
    const out = entityFrame(makeInput({ prevX: 2, prevY: 3, curX: 6, curY: 9, alpha: 0 }));
    expect(out.wx).toBe(2);
    expect(out.wy).toBe(3);
  });

  it('lands exactly on curX/curY at alpha 1', () => {
    const out = entityFrame(makeInput({ prevX: 2, prevY: 3, curX: 6, curY: 9, alpha: 1 }));
    expect(out.wx).toBe(6);
    expect(out.wy).toBe(9);
  });

  it('is the midpoint at alpha 0.5', () => {
    const out = entityFrame(makeInput({ prevX: 2, prevY: 4, curX: 6, curY: 10, alpha: 0.5 }));
    expect(out.wx).toBeCloseTo(4);
    expect(out.wy).toBeCloseTo(7);
  });
});

describe('entityFrame — ground lift', () => {
  // 4x4 grid, level 3 at tile (1, 1), flat everywhere else.
  const elevation = new Uint8Array([
    0, 0, 0, 0,
    0, 3, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ]);

  it('lifts the unit to the world height of the tile it stands on', () => {
    const out = entityFrame(
      makeInput({ prevX: 1.5, prevY: 1.5, curX: 1.5, curY: 1.5, alpha: 0, elevation })
    );
    expect(out.worldY).toBeCloseTo(3 * WORLD_PER_LEVEL, 10);
  });

  it('is flat (worldY 0) off the raised tile', () => {
    const out = entityFrame(
      makeInput({ prevX: 0.5, prevY: 0.5, curX: 0.5, curY: 0.5, alpha: 0, elevation })
    );
    expect(out.worldY).toBe(0);
  });

  it('is flat everywhere with no elevation layer at all', () => {
    const out = entityFrame(
      makeInput({ prevX: 1.5, prevY: 1.5, curX: 1.5, curY: 1.5, alpha: 0, elevation: null })
    );
    expect(out.worldY).toBe(0);
  });
});

describe('entityFrame — posture matches resolveClip exactly', () => {
  const cases: Array<[string, UnitAnimInput]> = [
    ['dead outranks everything', { alive: 0, routed: 1, pinned: 1, speed: 3, firing: true, working: true }],
    ['routed and stopped goes down', { alive: 1, routed: 1, pinned: 0, speed: 0, firing: false, working: false }],
    ['routed and still moving runs', { alive: 1, routed: 1, pinned: 0, speed: 2, firing: false, working: false }],
    ['pinned outranks working and firing', { alive: 1, routed: 0, pinned: 1, speed: 2, firing: true, working: true }],
    ['working outranks firing', { alive: 1, routed: 0, pinned: 0, speed: 0, firing: true, working: true }],
    ['firing (nothing higher-priority true)', { alive: 1, routed: 0, pinned: 0, speed: 0, firing: true, working: false }],
    ['moving', { alive: 1, routed: 0, pinned: 0, speed: 1.2, firing: false, working: false }],
    ['idle', { alive: 1, routed: 0, pinned: 0, speed: 0, firing: false, working: false }],
  ];

  it.each(cases)('%s', (_label, anim) => {
    const out = entityFrame(makeInput({ anim }));
    expect(out.clip).toBe(clipOrFallback(sheet, resolveClip(anim)));
  });
});

describe('entityFrame — clip fallback', () => {
  it('falls back to idle when the sheet never authored the resolved clip', () => {
    const out = entityFrame(
      makeInput({ sheet: sheetNoFire, anim: { ...baseAnim, firing: true } })
    );
    expect(out.clip).toBe('idle');
  });
});

describe('entityFrame — frame advance is time-based, not call-count-based', () => {
  // This is the break check named in the brief: an implementation that
  // advanced the phase by a fixed amount per *call* (rather than by
  // `fps * dtSeconds`) would make two 1/60s steps land somewhere different
  // from one 1/30s step, even though real elapsed time is identical either
  // way. See anim.test.ts's own `advancePhase` proof for the primitive-level
  // version of this same property; this is the integration-level one,
  // through entityFrame's own persisted-phase wiring.
  const movingAnim: UnitAnimInput = { ...baseAnim, speed: 1.4 };

  it('two half-steps land at the same phase as one full step of equal total time', () => {
    const phaseTwoSteps = new Float64Array([1]); // pre-seeded, mid-cycle
    const seededTwoSteps = new Uint8Array([1]);
    entityFrame(
      makeInput({ anim: movingAnim, dtSeconds: 1 / 60, entityAnimFrame: phaseTwoSteps, animSeeded: seededTwoSteps })
    );
    entityFrame(
      makeInput({ anim: movingAnim, dtSeconds: 1 / 60, entityAnimFrame: phaseTwoSteps, animSeeded: seededTwoSteps })
    );

    const phaseOneStep = new Float64Array([1]);
    const seededOneStep = new Uint8Array([1]);
    entityFrame(
      makeInput({ anim: movingAnim, dtSeconds: 1 / 30, entityAnimFrame: phaseOneStep, animSeeded: seededOneStep })
    );

    expect(phaseTwoSteps[0]).toBeCloseTo(phaseOneStep[0], 10);
  });

  it('holds the phase when dtSeconds is 0, however many times it is called', () => {
    const phase = new Float64Array([1.75]);
    const seeded = new Uint8Array([1]);
    for (let i = 0; i < 5; i++) {
      entityFrame(makeInput({ anim: movingAnim, dtSeconds: 0, entityAnimFrame: phase, animSeeded: seeded }));
    }
    expect(phase[0]).toBeCloseTo(1.75, 10);
  });

  it('does not touch the persisted phase for a one-frame clip', () => {
    const phase = new Float64Array([2.5]);
    const seeded = new Uint8Array([1]);
    const out = entityFrame(
      makeInput({
        anim: { ...baseAnim, pinned: 1 }, // -> 'down', a 1-frame clip on this sheet
        dtSeconds: 1,
        entityAnimFrame: phase,
        animSeeded: seeded,
      })
    );
    expect(phase[0]).toBe(2.5);
    expect(out.frame).toBe(0);
  });

  it('seeds the phase from phaseOffset(entityId, nFrames) on first advance, not from zero', () => {
    // Sized for entityId 3 so its own slot is unambiguous from entity 0's.
    const phase = new Float64Array(4); // starts at 0 for every entity
    const seeded = new Uint8Array(4); // not yet seeded for any entity
    entityFrame(
      makeInput({
        entityId: 3,
        anim: movingAnim,
        dtSeconds: 0, // isolate the seed from any advance
        entityAnimFrame: phase,
        animSeeded: seeded,
      })
    );
    expect(seeded[3]).toBe(1);
    expect(phase[3]).toBeCloseTo(phaseOffset(3, 4), 10);
  });
});

describe('entityFrame — contact-level body alpha', () => {
  it.each([
    [2, 1],
    [1, 0.65],
    [0, 0.35],
  ])('contact level %s -> alpha %s for a non-player side', (level, expected) => {
    const out = entityFrame(makeInput({ side: 1, contactLevel: level }));
    expect(out.alpha).toBe(expected);
  });

  it('is always full alpha for the player side, regardless of contact level', () => {
    for (const level of [0, 1, 2]) {
      const out = entityFrame(makeInput({ side: 0, contactLevel: level }));
      expect(out.alpha).toBe(1);
    }
  });
});

describe('entityFrame — air lift', () => {
  it('adds no height for a grounded (non-isAir) unit', () => {
    const out = entityFrame(makeInput({ isAir: false }));
    expect(out.worldY).toBe(0);
  });

  it('lifts worldY by AIR_LIFT_PX converted through WORLD_Y_PER_LIFT_PIXEL -- a real world height, not a screen-space nudge', () => {
    // Mirrors the identical roof-lift test below by design: both are real
    // `worldY` offsets, not a Pixi-style post-projection sprite nudge, and
    // this test would fail exactly the way that one would if a future edit
    // reintroduced a screen-space "liftDy" field instead.
    const grounded = entityFrame(makeInput({ isAir: false }));
    const airborne = entityFrame(makeInput({ isAir: true }));
    expect(airborne.worldY).toBeCloseTo(grounded.worldY + AIR_LIFT_PX * WORLD_Y_PER_LIFT_PIXEL, 10);
  });

  it('composes additively with garrison roof lift rather than one overriding the other', () => {
    // Not a real in-game combination (an isAir type is never garrisonedIn),
    // but pins the "just add it" shape the implementation actually uses --
    // a future edit that branched on isAir vs. roofSlot instead of summing
    // both would still pass every other test in this file and only fail here.
    const roofOnly = entityFrame(makeInput({ isAir: false, roofSlot: 0, roofPx: 40 }));
    const roofAndAir = entityFrame(makeInput({ isAir: true, roofSlot: 0, roofPx: 40 }));
    expect(roofAndAir.worldY).toBeCloseTo(roofOnly.worldY + AIR_LIFT_PX * WORLD_Y_PER_LIFT_PIXEL, 10);
  });
});

describe('entityFrame — garrison roof placement', () => {
  it('has no offset, no lift and stays visible when not garrisoned', () => {
    const out = entityFrame(makeInput({ roofSlot: -1, roofPx: 999 }));
    expect(out.roofDx).toBe(0);
    expect(out.roofDy).toBe(0);
    expect(out.worldY).toBe(0);
    expect(out.visible).toBe(true);
  });

  it('spreads slots symmetrically either side of centre, by exactly ROOF_SPREAD_PX/ROOF_SLOTS', () => {
    // Pinned to the actual constant and to centring, not merely "slot 1 is
    // to the right of slot 0" -- a reviewer substitution of
    // `slot * ROOF_SPREAD_PX * 3` (uncentred, 3x as wide) satisfies a bare
    // ordering check but must fail this one on both magnitude and symmetry.
    const slot0 = entityFrame(makeInput({ roofSlot: 0, roofPx: 40 }));
    const slot1 = entityFrame(makeInput({ roofSlot: 1, roofPx: 40 }));
    expect(slot0.roofDx).toBeCloseTo(-ROOF_SPREAD_PX / 2, 10);
    expect(slot1.roofDx).toBeCloseTo(ROOF_SPREAD_PX / 2, 10);
    expect(slot0.roofDx).toBeCloseTo(-slot1.roofDx, 10);
    expect(slot0.visible).toBe(true);
    expect(slot1.visible).toBe(true);
  });

  it('lifts worldY by real world height, not a screen-space roofDy nudge', () => {
    // The fix-round finding: buildings.ts genuinely extrudes a roof box
    // above the ground (`roofY = topY + heightPx * WORLD_Y_PER_LIFT_PIXEL`),
    // so a garrisoned occupant must gain the SAME real height or it
    // depth-tests inside the building's own walls. roofDy stays 0
    // unconditionally; only worldY carries the lift.
    const grounded = entityFrame(makeInput({ roofSlot: -1 }));
    const onRoof = entityFrame(makeInput({ roofSlot: 0, roofPx: 40 }));
    expect(onRoof.roofDy).toBe(0);
    expect(onRoof.worldY).toBeCloseTo(grounded.worldY + 40 * WORLD_Y_PER_LIFT_PIXEL, 10);
  });

  it('is invisible past ROOF_SLOTS — the pips still count it, the sprite does not draw', () => {
    const out = entityFrame(makeInput({ roofSlot: ROOF_SLOTS, roofPx: 40 }));
    expect(out.visible).toBe(false);
  });

  it('does not advance or seed the persisted phase for an occupant over the cap', () => {
    // Matches Pixi's `continue` (renderer.ts:1952), which exits before ever
    // reaching the frame-advance code for this entity. An invisible
    // occupant that kept animating anyway would visibly jump the moment a
    // roof slot frees up and it starts drawing again.
    const phase = new Float64Array([1.5]);
    const seeded = new Uint8Array([0]);
    const out = entityFrame(
      makeInput({
        roofSlot: ROOF_SLOTS, // over the cap
        roofPx: 40,
        anim: { ...baseAnim, speed: 1.4 }, // resolves to 'move', a 4-frame clip
        dtSeconds: 1,
        entityAnimFrame: phase,
        animSeeded: seeded,
      })
    );
    expect(out.visible).toBe(false);
    expect(phase[0]).toBe(1.5);
    expect(seeded[0]).toBe(0);
  });
});

describe('entityFrame — facing', () => {
  it('converts raw Q16.16 facing through fx.toNumber, exactly as Pixi does', () => {
    const out = entityFrame(makeInput({ facing: HALF_TURN }));
    expect(out.facing).toBeCloseTo(fx.toNumber(HALF_TURN), 10);
    expect(out.facing).toBeCloseTo(0.5, 10);
  });

  it('is zero for a due-east (unrotated) facing', () => {
    const out = entityFrame(makeInput({ facing: 0 }));
    expect(out.facing).toBe(0);
  });
});

describe('entityFrame — recoil/flinch', () => {
  it('leaves wx/wy untouched when neither timer is running', () => {
    const out = entityFrame(makeInput({ curX: 5, curY: 5, alpha: 1 }));
    expect(out.wx).toBe(5);
    expect(out.wy).toBe(5);
  });

  it('offsets wx/wy by the SAME world delta screenOffsetToWorld gives the equivalent screen nudge', () => {
    // recoilT 1 (freshly fired), power 1 -> px = RECOIL_PX_VEHICLE, firing
    // due east (dir 0) -> Pixi's ox = -RECOIL_PX_VEHICLE, oy = 0
    // (renderer.ts:2053-2056 at k=1). Reproduced independently here via
    // screenOffsetToWorld rather than re-deriving entityFrame's own
    // arithmetic, so this fails if the conversion is skipped, inverted, or
    // applied on the wrong axis.
    const out = entityFrame(
      makeInput({ curX: 5, curY: 5, alpha: 1, recoilT: 1, recoilDir: 0, recoilPower: 1 })
    );
    const expected = screenOffsetToWorld(-RECOIL_PX_VEHICLE, 0);
    expect(out.wx).toBeCloseTo(5 + expected.dx, 10);
    expect(out.wy).toBeCloseTo(5 + expected.dy, 10);
  });

  it('interpolates recoil travel between RECOIL_PX_SOFT and RECOIL_PX_VEHICLE by recoilPower', () => {
    const soft = entityFrame(makeInput({ curX: 0, curY: 0, alpha: 1, recoilT: 1, recoilDir: 0, recoilPower: 0 }));
    const vehicle = entityFrame(makeInput({ curX: 0, curY: 0, alpha: 1, recoilT: 1, recoilDir: 0, recoilPower: 1 }));
    // Both kick backwards along the same (0) bearing; a harder-hitting weapon
    // (recoilPower 1) must travel farther than a softer one (recoilPower 0).
    const softDist = Math.hypot(soft.wx, soft.wy);
    const vehicleDist = Math.hypot(vehicle.wx, vehicle.wy);
    expect(vehicleDist).toBeGreaterThan(softDist);
    expect(softDist).toBeGreaterThan(0);
  });

  it('eases out — recoil travel shrinks as recoilT decays toward 0', () => {
    const fresh = entityFrame(makeInput({ curX: 0, curY: 0, alpha: 1, recoilT: 1, recoilDir: 0.25, recoilPower: 1 }));
    const settling = entityFrame(makeInput({ curX: 0, curY: 0, alpha: 1, recoilT: 0.2, recoilDir: 0.25, recoilPower: 1 }));
    expect(Math.hypot(settling.wx, settling.wy)).toBeLessThan(Math.hypot(fresh.wx, fresh.wy));
  });

  it('flinch jolts the entity away from the shooter, independent of recoil', () => {
    const out = entityFrame(makeInput({ curX: 0, curY: 0, alpha: 1, flinchT: 1, flinchDir: 0 }));
    const expected = screenOffsetToWorld(FLINCH_PX, 0);
    expect(out.wx).toBeCloseTo(expected.dx, 10);
    expect(out.wy).toBeCloseTo(expected.dy, 10);
  });

  it('pins the exported RECOIL_PX_SOFT/RECOIL_PX_VEHICLE/FLINCH_PX values this module actually uses', () => {
    // NOT a check against renderer.ts's own RECOIL_PX_SOFT/RECOIL_PX_VEHICLE/
    // FLINCH_PX (private, unexported, and importing them would pull pixi.js
    // into this module's graph -- see this file's own top comment on why
    // they are redeclared here rather than imported). This only pins the
    // three literals entityFrame's own recoil/flinch arithmetic reads
    // (asserted indirectly, through those numbers, by the tests above) --
    // it cannot and does not detect renderer.ts's copies drifting, since it
    // has no access to them. If the two ever need to be kept in sync, that
    // has to be done by eye against renderer.ts:60-61, not by this test.
    expect(RECOIL_PX_SOFT).toBe(1);
    expect(RECOIL_PX_VEHICLE).toBe(3);
    expect(FLINCH_PX).toBe(2.5);
  });

  it('does not perturb worldY — ground height is sampled at the un-recoiled position', () => {
    // 4x4 grid, level 3 at tile (1, 1) -- matching the "ground lift" suite
    // above. Recoil/flinch offsets are a small fraction of a tile, so they
    // must never change which tile's height entityFrame reports.
    const elevation = new Uint8Array([0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const plain = entityFrame(
      makeInput({ prevX: 1.5, prevY: 1.5, curX: 1.5, curY: 1.5, alpha: 0, elevation })
    );
    const recoiling = entityFrame(
      makeInput({
        prevX: 1.5,
        prevY: 1.5,
        curX: 1.5,
        curY: 1.5,
        alpha: 0,
        elevation,
        recoilT: 1,
        recoilDir: 0,
        recoilPower: 1,
      })
    );
    expect(recoiling.worldY).toBe(plain.worldY);
  });
});

describe('entityFrame — turret facing (Task B3.6)', () => {
  it('with no turret sheet, turretFacing equals the hull facing and turretClip stays idle', () => {
    const out = entityFrame(makeInput({ facing: HALF_TURN, turretSheet: null }));
    expect(out.turretFacing).toBeCloseTo(fx.toNumber(HALF_TURN), 10);
    expect(out.turretClip).toBe('idle');
    expect(out.turretFrame).toBe(0);
  });

  it('seeds turretFacing to the hull\'s current facing on first use, not from zero', () => {
    const turretFacing = new Float64Array([0]);
    const turretVel = new Float64Array([0]);
    const turretSeeded = new Uint8Array([0]);
    const out = entityFrame(
      makeInput({
        facing: HALF_TURN, // 0.5
        dtSeconds: 0, // isolates the seed from the spring
        turretSheet,
        turretFacing,
        turretVel,
        turretSeeded,
      })
    );
    expect(turretSeeded[0]).toBe(1);
    expect(turretFacing[0]).toBeCloseTo(0.5, 10);
    expect(out.turretFacing).toBeCloseTo(0.5, 10);
  });

  it('BREAK CHECK 1: springs toward a live target rather than snapping straight to it', () => {
    // Hull faces due east (0); the target sits due west of the shooter, so
    // the goal angle is 0.5 turns away -- as large a single-step delta as
    // this representation has. A snap (`turretFacing[i] = goalTurn`) would
    // land out.turretFacing at 0.5 in one call; the real spring, integrated
    // for one 1/60s step from rest, can only have covered a small fraction
    // of that distance.
    const turretFacing = new Float64Array([0]);
    const turretVel = new Float64Array([0]);
    const turretSeeded = new Uint8Array([1]); // already seeded -- isolates the spring from the seed
    const out = entityFrame(
      makeInput({
        facing: 0,
        curX: 0,
        curY: 0,
        turretTargetX: -5,
        turretTargetY: 0,
        dtSeconds: 1 / 60,
        turretSheet,
        turretFacing,
        turretVel,
        turretSeeded,
      })
    );
    expect(out.turretFacing).toBeGreaterThan(0);
    expect(out.turretFacing).toBeLessThan(0.1);
    // The persisted array is mutated in place, matching entityAnimFrame's
    // own contract -- not merely the returned EntityFrame.
    expect(turretFacing[0]).toBeCloseTo(out.turretFacing, 10);
    expect(turretVel[0]).not.toBe(0);
  });

  it('BREAK CHECK: the Euler step is bounded even under a long frame hitch (sdt clamped to 1/30)', () => {
    // The same 0.5-turn goal delta as break check 1, but with a wildly long
    // dtSeconds (a real 100ms-hitch-or-worse frame) -- entityFrame's own
    // comment on `sdt` says explicit Euler diverges once damping * dt
    // exceeds 1, which this dtSeconds clears many times over if it reaches
    // the integration unclamped.
    const turretFacing = new Float64Array([0]);
    const turretVel = new Float64Array([0]);
    const turretSeeded = new Uint8Array([1]);
    const out = entityFrame(
      makeInput({
        facing: 0,
        curX: 0,
        curY: 0,
        turretTargetX: -5,
        turretTargetY: 0,
        dtSeconds: 0.5, // 30x a real 60fps frame
        turretSheet,
        turretFacing,
        turretVel,
        turretSeeded,
      })
    );
    // delta = 0.5, accel = 0.5 * TURRET_STIFFNESS = 45 (turretVel starts 0).
    // Clamped: sdt = 1/30 -> turretVel = 45 * (1/30) = 1.5,
    //          turretFacing = 1.5 * (1/30) = 0.05.
    // Unclamped: sdt = 0.5 -> turretVel = 45 * 0.5 = 22.5 -- 15x larger,
    // and would land turretFacing at 22.5 * 0.5 = 11.25 (mod 1 -> 0.25),
    // nowhere near either of these numbers.
    expect(turretVel[0]).toBeCloseTo(1.5, 5);
    expect(out.turretFacing).toBeCloseTo(0.05, 5);
  });

  it('converges toward the goal over many steps (the spring is not merely non-snapping, it arrives)', () => {
    const turretFacing = new Float64Array([0]);
    const turretVel = new Float64Array([0]);
    const turretSeeded = new Uint8Array([1]);
    const step = (): EntityFrame =>
      entityFrame(
        makeInput({
          facing: 0,
          curX: 0,
          curY: 0,
          turretTargetX: -5,
          turretTargetY: 0,
          dtSeconds: 1 / 60,
          turretSheet,
          turretFacing,
          turretVel,
          turretSeeded,
        })
      );
    // 239 steps advance the persisted state without needing to hold onto
    // (or assert a non-null type on) every intermediate result -- only the
    // last one is read.
    for (let i = 0; i < 239; i++) step();
    const out = step();
    expect(out.turretFacing).toBeCloseTo(0.5, 1);
  });

  it('BREAK CHECK 3: returns to the hull heading over time, not instantly, once the target is lost', () => {
    // turretFacing starts pointed opposite the hull's own heading (0.5 turns
    // away, the same worst-case delta as break check 1) with no target --
    // the goal is therefore the hull's own facing (0). An "instant return"
    // implementation (`turretFacing[i] = facingNorm` whenever there is no
    // target) would land out.turretFacing at (approximately) 0 in one call;
    // the real spring can only have moved a small fraction of the way back.
    const turretFacing = new Float64Array([0.5]);
    const turretVel = new Float64Array([0]);
    const turretSeeded = new Uint8Array([1]);
    const step = (): EntityFrame =>
      entityFrame(
        makeInput({
          facing: 0,
          turretTargetX: null,
          turretTargetY: null,
          dtSeconds: 1 / 60,
          turretSheet,
          turretFacing,
          turretVel,
          turretSeeded,
        })
      );
    const out = step();
    expect(out.turretFacing).toBeGreaterThan(0.4);

    // Not merely "moved a little" -- a mutant that re-targets the goal at
    // whatever turretFacing ALREADY is (so the turret drifts to a stop
    // wherever it happens to be, and never actually comes home) would pass
    // the single-step assertion above just as easily as the real spring
    // does, since both start with a near-zero first step. Continuing to
    // step with no target for much longer is what tells the two apart: the
    // real spring keeps closing the distance toward the hull's own facing
    // (0) and gets there; a goal-that-chases-current-position mutant never
    // moves again once its own single-step "progress" is spent.
    for (let i = 0; i < 239; i++) step();
    const settled = step();
    // turretFacing is circular (wrapped into [0, 1)), so "close to the hull's
    // 0 heading" means close to EITHER 0 or 1, not merely close to the
    // literal number 0 -- the shortest distance around the circle is what
    // "arrived home" actually means.
    const distanceFromHullHeading = Math.min(settled.turretFacing, 1 - settled.turretFacing);
    expect(distanceFromHullHeading).toBeLessThan(0.05);
  });

  it('turret clip resolution reads an INDEPENDENT firing signal, not the hull\'s anim.firing', () => {
    // The hull is firing but the turret is not: the hull's own resolved
    // clip (irrelevant here) plays no part -- resolveTurretClip must never
    // see 'fire'.
    const hullFiringOnly = entityFrame(
      makeInput({ turretSheet, turretFiring: false, anim: { ...baseAnim, firing: true } })
    );
    expect(hullFiringOnly.turretClip).toBe('idle');

    // The reverse: the turret fired but the hull's own `anim.firing` is
    // false (matches every shipped turreted vehicle -- no hull sheet with
    // turret art declares a `fire` clip of its own, so `anim.firing` can
    // never be the signal this depends on).
    const turretFiringOnly = entityFrame(
      makeInput({ turretSheet, turretFiring: true, anim: { ...baseAnim, firing: false } })
    );
    expect(turretFiringOnly.turretClip).toBe('fire');
  });

  it('never asks a turret sheet for a clip it does not declare, matching resolveTurretClip\'s own contract', () => {
    const out = entityFrame(
      makeInput({ turretSheet: turretSheetIdleOnly, turretFiring: true, anim: { ...baseAnim, firing: false } })
    );
    expect(out.turretClip).toBe(resolveTurretClip('fire', turretSheetIdleOnly.clips));
    expect(out.turretClip).toBe('idle');
  });

  it('a pinned/dead/routed unit\'s turret does not fire either, matching resolveClip\'s own precedence', () => {
    const out = entityFrame(
      makeInput({
        turretSheet,
        turretFiring: true,
        anim: { ...baseAnim, pinned: 1, firing: false },
      })
    );
    expect(out.turretClip).toBe('idle');
  });

  it('clamps turretFrame to the turret sheet\'s own frame count for the resolved clip, not the hull\'s', () => {
    const multiFrameTurret: SheetSpec = {
      ...turretSheet,
      clips: { idle: turretSheet.clips.idle, fire: { frames: 2, fps: 12, loop: false, fileOffset: 0 } },
    };
    // Force the hull's own frame index to 3 (the last index of `sheet`'s
    // 4-frame `move` clip) by pre-seeding entityAnimFrame past it, with
    // dtSeconds 0 so it does not advance further.
    const out = entityFrame(
      makeInput({
        anim: { ...baseAnim, speed: 1.2 }, // -> 'move' on the hull
        dtSeconds: 0,
        entityAnimFrame: new Float64Array([3.9]),
        animSeeded: new Uint8Array([1]),
        turretSheet: multiFrameTurret,
        turretFiring: true,
      })
    );
    expect(out.frame).toBe(3); // the hull's own index, unclamped by the turret
    expect(out.turretClip).toBe('fire');
    expect(out.turretFrame).toBe(1); // clamped to multiFrameTurret's fire frame count - 1
  });

  it('pins the exported TURRET_STIFFNESS/TURRET_DAMPING values this module actually uses', () => {
    // Same caveat as the RECOIL_PX pin above: this cannot detect
    // renderer.ts's own copies (private, unexported) drifting -- only that
    // THIS module's spring uses the documented 90/13.
    expect(TURRET_STIFFNESS).toBe(90);
    expect(TURRET_DAMPING).toBe(13);
  });
});

describe('assignRoofSlots', () => {
  it('assigns -1 to every unit that is not garrisoned', () => {
    const garrisonedIn = new Int32Array([-1, -1]);
    const alive = new Uint8Array([1, 1]);
    expect(Array.from(assignRoofSlots(garrisonedIn, alive, 2))).toEqual([-1, -1]);
  });

  it('assigns ascending slots in entity order within one building', () => {
    const garrisonedIn = new Int32Array([5, 5, 5]);
    const alive = new Uint8Array([1, 1, 1]);
    expect(Array.from(assignRoofSlots(garrisonedIn, alive, 3))).toEqual([0, 1, 2]);
  });

  it('never gives a dead entity a slot, and does not count it against the living', () => {
    const garrisonedIn = new Int32Array([5, 5, 5]);
    const alive = new Uint8Array([1, 0, 1]);
    expect(Array.from(assignRoofSlots(garrisonedIn, alive, 3))).toEqual([0, -1, 1]);
  });

  it('runs an independent slot sequence per building', () => {
    const garrisonedIn = new Int32Array([5, 6, 5, 6]);
    const alive = new Uint8Array([1, 1, 1, 1]);
    expect(Array.from(assignRoofSlots(garrisonedIn, alive, 4))).toEqual([0, 0, 1, 1]);
  });
});
