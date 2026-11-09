// The shipped missions' `first_contact` triggers must not fire in the first 100 ticks (5 s) of a passive run: nobody has met anyone
// yet. Four of them did, at tick 1 to 12, because the old rule counted a militiaman spotting a civilian and a gun truck cutting a
// neutral wall as "contact" (see packages/sim/src/first-contact.test.ts for the rule; this is the data it protects).
// The probe that prints the table: tools/src/backtest/first-contact-probe.ts.
import { describe, expect, it } from 'vitest';
import { missions } from '@lions/data';
import type { MissionJson, SimEvent } from '@lions/sim';
import { missionWorld } from './mission-harness';

const EARLY_TICKS = 100;
const SEEDS = [1, 2, 3];

const firstContactTriggers = (): { mission: string; id: string }[] =>
  Object.entries(missions as Record<string, MissionJson>).flatMap(([mission, m]) =>
    (m.triggers ?? []).flatMap((t, i) => (t.on.kind === 'first_contact' ? [{ mission, id: t.id ?? `trigger_${i}` }] : []))
  );

describe('shipped first_contact triggers', () => {
  it('there are 7 of them, in 6 missions (a change of this count is a change to review here)', () => {
    const all = firstContactTriggers();
    expect(all).toHaveLength(7);
    expect(new Set(all.map((t) => t.mission)).size).toBe(6);
    // Khan Rafid III's rocket team is one of them again (GH-1173).
    expect(all.some((t) => t.mission === 'khan_rafid_3_clearance')).toBe(true);
  });

  // Khan Rafid III's rocket team used to spawn at tick 2 only because the old rule counted a militiaman cutting a neutral structure as contact
  // (GH-1170 held it there with a 0.1 s timer); GH-1173 put `first_contact` back. It is quiet for 100 ticks of a passive run (the loop below) and
  // fires on a real meeting, which the scripted plan's drone makes at tick 176 on the pinned seed.
  it('khan_rafid_3_clearance puts its rocket team on the board on a real first contact, not on a timer', () => {
    const t = (missions as Record<string, MissionJson>).khan_rafid_3_clearance.triggers?.find((x) => x.id === 'a_rocket_team_moves_into_the_east_lane');
    expect(t?.on).toEqual({ kind: 'first_contact' });
  });

  // GH-1173: the spawned rocket team used to raze three lane walls inside the first 76 s of a passive walk (it spawned at tick 2). Those collapses are what
  // `pnpm perf:memory` had drawn by its last frame; with a real first contact nothing in the walk razes a wall until the store wall falls at tick 2401, one
  // tick after the walk's last frame, and the three wall-collapse textures stay decoded and un-uploaded (decoded ImageBitmaps 120 -> 168 MiB, over the 161 ceiling).
  // The placed lane team (`kr_lane_east`) therefore carries no ambush stance: it shoots the lane walls from tick 9, as the spawned team did.
  it('khan_rafid_3_clearance: the placed east-lane rocket team has no ambush stance (it razes lane walls in a passive walk)', () => {
    const g = (missions as Record<string, MissionJson>).khan_rafid_3_clearance.enemy?.garrison?.find((x) => x.tag === 'kr_lane_east');
    expect(g?.unit).toBe('rpg_team');
    expect(g?.stance).toBeUndefined();
  });

  for (const { mission, id } of firstContactTriggers()) {
    it(`${mission}: "${id}" does not fire in the first ${EARLY_TICKS} ticks of a passive run, seeds ${SEEDS.join(',')}`, () => {
      for (const seed of SEEDS) {
        const { sim, runtime } = missionWorld(mission, {}, seed);
        let firedAt = -1;
        for (let n = 0; n < EARLY_TICKS && firedAt < 0; n++) {
          for (const me of runtime.step(sim.tick())) if (me.kind === 'trigger' && me.id === id) firedAt = me.tick;
        }
        expect(firedAt, `seed ${seed}`).toBe(-1);
      }
    });
  }

  // Not vacuous: in these four worlds the sim DOES make the events the old rule fired on inside the window, so the test above is
  // passing because of the rule and not because the worlds went quiet.
  const loose: readonly [string, string][] = [
    ['khan_rafid_3_clearance', 'fire at a structure'],
    ['wadi_halam_5_depot', 'fire at a structure'],
    ['beit_sahwan_1_recon', 'an enemy identifying a civilian'],
    ['wadi_halam_4_village', 'an enemy identifying a civilian'],
  ];
  for (const [mission, what] of loose) {
    it(`${mission} still makes the event the old rule fired on (${what}) inside ${EARLY_TICKS} ticks`, () => {
      const { sim, runtime } = missionWorld(mission, {}, 1);
      const S = sim.state as unknown as Record<string, ArrayLike<number>>;
      let found = false;
      for (let n = 0; n < EARLY_TICKS && !found; n++) {
        const ev: SimEvent[] = sim.tick();
        for (const e of ev) {
          if (e.kind === 'fire' && e.target < 0 && S.side[e.shooter] === 1) found = true;
          if (e.kind === 'contact' && e.level === 'identified' && e.side === 1 && S.side[e.target] === 2) found = true;
        }
        runtime.step(ev);
      }
      expect(found).toBe(true);
    });
  }
});
