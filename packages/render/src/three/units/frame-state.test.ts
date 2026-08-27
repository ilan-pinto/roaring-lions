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
  type EntityFrameInput,
} from './frame-state';
import { resolveClip, type UnitAnimInput } from '../../clip';
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
