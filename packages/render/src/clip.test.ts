import { describe, expect, it } from 'vitest';
import { cadenceScale, resolveClip, resolveTurretClip, ROUT_CADENCE, type UnitAnimInput } from './clip';

const alive: UnitAnimInput = {
  alive: 1,
  routed: 0,
  pinned: 0,
  speed: 0,
  firing: false,
  working: false,
};

describe('resolveClip — precedence', () => {
  it('stands still by default', () => {
    expect(resolveClip(alive)).toBe('idle');
  });

  it('walks when actually covering ground', () => {
    expect(resolveClip({ ...alive, speed: 0.9 })).toBe('move');
  });

  it('does not walk when ordered to move but going nowhere', () => {
    // Speed is measured, not read off the order. A unit pressed against a
    // wall or a blocked flow field would otherwise walk on the spot.
    expect(resolveClip({ ...alive, speed: 0 })).toBe('idle');
  });

  it('goes to ground when pinned', () => {
    // Suppression is the highest-value mechanic in the model (GDD 5.5), so
    // it gets the posture, not just a bar.
    expect(resolveClip({ ...alive, pinned: 1 })).toBe('down');
  });

  it('stays down when pinned even while trying to move', () => {
    expect(resolveClip({ ...alive, pinned: 1, speed: 0.9 })).toBe('down');
  });

  it('fires when the shot clip is latched', () => {
    expect(resolveClip({ ...alive, firing: true })).toBe('fire');
  });

  it('drops to ground rather than firing when suppressed mid-shot', () => {
    // The correct read: getting suppressed interrupts you. If fire outranked
    // pinned, a unit would keep posing with its rifle up while pinned.
    expect(resolveClip({ ...alive, pinned: 1, firing: true })).toBe('down');
  });

  it('keeps firing while moving — firing outranks locomotion', () => {
    expect(resolveClip({ ...alive, firing: true, speed: 0.9 })).toBe('fire');
  });
});

describe('resolveClip — work', () => {
  it('shows work while a tunnel charge is being worked', () => {
    expect(resolveClip({ ...alive, working: true })).toBe('work');
  });

  it('outranks fire — the ordering that prevents the per-burst bob', () => {
    // `fire` latches per shot and `work` kneels the lead figure. If fire won,
    // each burst would stand him up and kneel him back down — the same
    // whole-team bob the fire clip itself was once rebuilt to eliminate
    // (teams.py _standing_posture). The charge pose holds; muzzle VFX carry
    // the shooting.
    expect(resolveClip({ ...alive, working: true, firing: true })).toBe('work');
  });

  it('outranks locomotion — a working team is planted, whatever speed says', () => {
    // The sim resets charge progress on displacement, so speed here is a
    // stale tick delta at most; without this a working unit could flicker
    // into a walk for a frame.
    expect(resolveClip({ ...alive, working: true, speed: 0.9 })).toBe('work');
  });

  it('goes down rather than working when pinned — a pinned man is not working', () => {
    expect(resolveClip({ ...alive, working: true, pinned: 1 })).toBe('down');
  });

  it('runs rather than working when routed', () => {
    expect(resolveClip({ ...alive, working: true, routed: 1, speed: 1.2 })).toBe('move');
  });

  it('a dead unit never works', () => {
    expect(resolveClip({ ...alive, working: true, alive: 0 })).toBe('down');
  });

  it('does not scale cadence — work runs at its authored fps', () => {
    expect(cadenceScale({ ...alive, working: true })).toBe(1);
  });
});

describe('resolveClip — rout', () => {
  it('runs when broken and actually running', () => {
    expect(resolveClip({ ...alive, routed: 1, speed: 1.2 })).toBe('move');
  });

  it('outranks pinned — a broken unit runs rather than cowers', () => {
    // Rout is what pinning escalates into; showing the earlier state would
    // hide the more important one.
    expect(resolveClip({ ...alive, routed: 1, pinned: 1, speed: 1.2 })).toBe('move');
  });

  it('cowers when broken but pinned in place', () => {
    expect(resolveClip({ ...alive, routed: 1, pinned: 1, speed: 0 })).toBe('down');
  });

  it('outranks firing — broken units are not shooting', () => {
    expect(resolveClip({ ...alive, routed: 1, firing: true, speed: 1.2 })).toBe('move');
  });
});

describe('resolveClip — death', () => {
  it('goes down when killed, outranking everything', () => {
    expect(resolveClip({ ...alive, alive: 0, speed: 2, firing: true, routed: 1 })).toBe('down');
  });

  it('a dead unit never walks, whatever its last measured speed was', () => {
    // Speed is a stale tick delta at the moment of death; without the alive
    // check a corpse would stride off.
    expect(resolveClip({ ...alive, alive: 0, speed: 3.5 })).toBe('down');
  });
});

describe('cadenceScale', () => {
  it('is unity for an ordinary unit', () => {
    expect(cadenceScale(alive)).toBe(1);
  });

  it('speeds the gait for a routed unit — panic is sold by cadence, not art', () => {
    // This is why rout reuses `move` instead of needing its own run clip.
    expect(cadenceScale({ ...alive, routed: 1, speed: 1.2 })).toBe(ROUT_CADENCE);
    expect(ROUT_CADENCE).toBeGreaterThan(1);
  });

  it('does not speed up a routed unit that is down', () => {
    expect(cadenceScale({ ...alive, routed: 1, pinned: 1, speed: 0 })).toBe(1);
  });
});

describe('resolveTurretClip — a station has a smaller vocabulary than its hull', () => {
  const both = { idle: 1, fire: 1 };
  const idleOnly = { idle: 1 };

  it('recoils only while the hull is firing', () => {
    expect(resolveTurretClip('fire', both)).toBe('fire');
    expect(resolveTurretClip('idle', both)).toBe('idle');
  });

  it('never asks for a clip the sheet does not declare', () => {
    // Every turret sheet but the gun truck's is idle-only. Asking for `fire`
    // there would fall through to a missing texture set.
    expect(resolveTurretClip('fire', idleOnly)).toBe('idle');
    expect(resolveTurretClip('fire', undefined)).toBe('idle');
  });

  it('does not pass hull-only clips through', () => {
    // `move`, `down` and `wreck` exist on hull sheets and on no turret sheet.
    for (const c of ['move', 'down', 'wreck'] as const) {
      expect(resolveTurretClip(c, both)).toBe('idle');
    }
  });
});
