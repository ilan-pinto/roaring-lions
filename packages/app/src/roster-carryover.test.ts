// packages/app/src/roster-carryover.test.ts
//
// The chain, not the links. Every step of R-13's pipeline has its own spec;
// this file drives the WHOLE victory write -- `applyRosterCarryover`, the same
// function `main.ts` calls -- through two consecutive missions, feeding each
// mission's output ledger in as the next one's `before`. That is the only way
// to tell "a survivor's slot was reattached" from "a survivor was issued a
// fresh slot that happened to match", and the only place the order of the
// steps, and which ledger each one reads, is under test at all.
//
// `fight` is the stand-in for the sim's side of a mission. It draws
// `from_ledger` bodies the way `spawnPlacement` does (first entry of the type
// in pool order, spliced out -- `mission.ts:1254-1267`), captures a death the
// way `main.ts` does (`lostRecordFor` off the drawn entry, which is the object
// `rosterEntryOf` hands back), and rebuilds the roster the way `checkEnd` does
// (`mission.ts:1861-1887`): a fielded survivor field by field, keeping only
// `name` -- so its `slot` is DROPPED -- then fresh bodies, then every unfielded
// pool entry spread whole, slot and all.
import { describe, expect, it } from 'vitest';
import { names as namesJson, units } from '@lions/data';
import { nameKind, type NamesJson } from './names';
import { applyRosterCarryover, type RosterCarryover, type RosterCarryoverDeps } from './roster-carryover';
import { lostRecordFor } from './roster-lost';
import type { CampaignLedger, LostRecord, RosterEntry } from './ledger-store';

const table = namesJson as NamesJson;
const unitOf = (typeId: string): { id: string; role: string; name?: string } | undefined =>
  units[typeId as keyof typeof units] as { id: string; role: string; name?: string } | undefined;

/** `main.ts`'s own deps, over the real unit catalogue and callsign tables. */
const deps = (cap?: number): RosterCarryoverDeps => ({
  kindOf: (typeId) => nameKind(unitOf(typeId) ?? { id: typeId, role: 'infantry' }, table),
  names: table,
  displayName: (typeId) => unitOf(typeId)?.name ?? typeId,
  ...(cap !== undefined ? { cap } : {}),
});

interface Battle {
  missionId: string;
  /** One `from_ledger` body per entry, drawn in this order. */
  field: string[];
  /** Callsigns of drawn bodies that die, and the tick -- WITHIN this mission --
   *  each one dies at. */
  dies?: Record<string, number>;
  /** Fresh bodies (a remnant, a reinforcement) that come home: no name, no slot. */
  fresh?: string[];
}

function fight(ledger: CampaignLedger, b: Battle): { produced: CampaignLedger; lost: LostRecord[] } {
  const pool = [...(ledger['roster.surviving_units'] ?? [])];
  const drawn: RosterEntry[] = [];
  for (const type of b.field) {
    const idx = pool.findIndex((r) => r.type === type);
    if (idx < 0) continue;
    drawn.push(pool[idx]);
    pool.splice(idx, 1);
  }
  const lost: LostRecord[] = [];
  const out: RosterEntry[] = [];
  for (const origin of drawn) {
    const diedAt = origin.name !== undefined ? b.dies?.[origin.name] : undefined;
    if (diedAt !== undefined) {
      const record = lostRecordFor(origin, origin.type, b.missionId, diedAt);
      if (record) lost.push(record);
      continue;
    }
    const entry: RosterEntry = {
      type: origin.type,
      veterancy: origin.veterancy,
      missions: (origin.missions ?? 0) + 1,
      kills: (origin.kills ?? 0) + 1,
    };
    if (origin.name !== undefined) entry.name = origin.name;
    out.push(entry);
  }
  for (const type of b.fresh ?? []) out.push({ type, veterancy: 0, missions: 1, kills: 0 });
  for (const left of pool) out.push({ ...left });
  return { produced: { 'roster.surviving_units': out }, lost };
}

interface Played extends RosterCarryover {
  /** The roster `fight` (checkEnd's stand-in) produced. */
  produced: RosterEntry[];
  /** How many were already stood down when the mission began. */
  reserveIn: number;
}

/** One mission, end to end: the stand-in sim, then the app's own write. */
function play(before: CampaignLedger, b: Battle, cap?: number): Played {
  const { produced, lost } = fight(before, b);
  return {
    ...applyRosterCarryover(before, produced, lost, deps(cap)),
    produced: produced['roster.surviving_units'] ?? [],
    reserveIn: before['roster.reserve']?.length ?? 0,
  };
}

/** A save written by this branch: named, slotted, and deliberately NOT in
 *  `rosterOrder` (the Lavi, the veteran, is third), so a split that sorted the
 *  active list would visibly reorder it. */
const SAVE: CampaignLedger = {
  'roster.surviving_units': [
    { type: 'inf_squad', veterancy: 1, missions: 2, kills: 5, name: 'Sela', slot: 0 },
    { type: 'inf_squad', veterancy: 0, missions: 1, kills: 0, name: 'Barzel', slot: 1 },
    { type: 'mbt_lavi', veterancy: 2, missions: 3, kills: 9, name: '1-2 Ayil', slot: 2 },
    { type: 'at_team', veterancy: 0, missions: 1, kills: 1, name: 'Tzur', slot: 3 },
    { type: 'inf_squad', veterancy: 0, missions: 1, kills: 2, name: 'Marom', slot: 4 },
  ],
  'campaign.names_issued': { squad: 4, vehicle: 1, task: 0 },
  'campaign.slots_issued': 5,
  'roe.mission_ratings': { beit_sahwan_breach: 97 },
};

/** Mission 1 is LONG: Barzel dies at tick 4800, and the only new body home is
 *  a mortar team -- so no rifle squad takes his place and slot 1 stays vacant.
 *  Mission 2 is SHORT: Marom dies at tick 200, and one new rifle squad comes
 *  home. Two rifle-squad vacancies stand open at the second write, and the
 *  OLDER one carries the HIGHER tick. */
const M1: Battle = {
  missionId: 'beit_sahwan_2_foothold',
  field: ['inf_squad', 'inf_squad', 'inf_squad', 'mbt_lavi'],
  dies: { Barzel: 4800 },
  fresh: ['mortar_team'],
};
const M2: Battle = {
  missionId: 'beit_sahwan_3_clearance',
  field: ['inf_squad', 'inf_squad', 'mbt_lavi'],
  dies: { Marom: 200 },
  fresh: ['inf_squad'],
};

function campaign(): { m1: Played; m2: Played } {
  const m1 = play(SAVE, M1);
  const m2 = play(m1.ledger, M2);
  return { m1, m2 };
}

const active = (p: Played): RosterEntry[] => p.ledger['roster.surviving_units'] ?? [];
const reserve = (p: Played): RosterEntry[] => p.ledger['roster.reserve'] ?? [];
const slotOf = (p: Played, name: string): number | undefined =>
  [...active(p), ...reserve(p)].find((r) => r.name === name)?.slot;

describe('applyRosterCarryover — two missions through the one function main.ts calls', () => {
  it('a survivor keeps its slot across both missions, and slots_issued grows only by new units', () => {
    const { m1, m2 } = campaign();
    // Fielded and home twice (checkEnd dropped the slot both times), fielded
    // and home twice, and never fielded at all.
    for (const [name, slot] of [['Sela', 0], ['1-2 Ayil', 2], ['Tzur', 3]] as const) {
      expect(slotOf(m1, name), `${name} after mission 1`).toBe(slot);
      expect(slotOf(m2, name), `${name} after mission 2`).toBe(slot);
    }
    // Mission 1 brings home one new body, the mortar team, with no vacancy of
    // its type to take: one fresh id. Mission 2's one new body takes a
    // vacancy: none. Nobody who was already on the roster draws one.
    expect(m1.ledger['campaign.slots_issued']).toBe(6);
    expect(active(m1).find((r) => r.type === 'mortar_team')?.slot).toBe(5);
    expect(m2.ledger['campaign.slots_issued']).toBe(6);
  });

  it('one death appends one record, the new unit of that type takes the slot, and the rows carry display names', () => {
    const { m1, m2 } = campaign();
    expect(m1.ledger['roster.lost']).toHaveLength(1);
    expect(m2.ledger['roster.lost']).toHaveLength(2);
    expect(m2.ledger['roster.lost']?.[1]).toMatchObject({ slot: 4, name: 'Marom', missionId: 'beit_sahwan_3_clearance' });

    const recruit = active(m2).find((r) => r.type === 'inf_squad' && r.missions === 1);
    expect(recruit?.slot).toBe(4);
    expect(recruit?.name).toBeDefined();

    expect(m2.lostNamed).toEqual([{ name: 'Marom', type: 'Rifle Squad' }]);
    expect(m2.replacements).toEqual([{ name: recruit?.name, predecessor: 'Marom' }]);
    const rawIds = new Set(Object.keys(units));
    for (const row of [...m1.lostNamed, ...m2.lostNamed]) expect(rawIds.has(row.type), row.type).toBe(false);
    for (const row of m2.replacements) {
      expect(rawIds.has(row.name), row.name).toBe(false);
      expect(rawIds.has(row.predecessor), row.predecessor).toBe(false);
    }
  });

  // Final review, Important 1, through the whole chain. `tick` restarts every
  // mission: Barzel's loss (mission 1, tick 4800) is OLDER than Marom's
  // (mission 2, tick 200) and carries the higher tick. The recruit takes the
  // newer vacancy, and the older one stays open.
  it('offers the newer vacancy first when the older loss has the higher tick', () => {
    const { m2 } = campaign();
    expect(active(m2).find((r) => r.type === 'inf_squad' && r.missions === 1)?.slot).toBe(4);
    const held = new Set([...active(m2), ...reserve(m2)].map((r) => r.slot));
    expect(held.has(1), 'Barzel\'s place is still vacant').toBe(false);
  });

  it('conserves active plus reserve, and no slot appears twice across them', () => {
    const { m1, m2 } = campaign();
    // The cap run as well, where the reserve is not empty going in or out.
    const capped1 = play(SAVE, M1, 4);
    const capped2 = play(capped1.ledger, M2, 4);
    for (const p of [m1, m2, capped1, capped2]) {
      expect(active(p).length + reserve(p).length).toBe(p.produced.length + p.reserveIn);
      const slots = [...active(p), ...reserve(p)].map((r) => r.slot);
      expect(slots.every((s) => s !== undefined)).toBe(true);
      expect(new Set(slots).size).toBe(slots.length);
    }
  });

  // Final review, Important 2, through the whole chain. `spawnPlacement` draws
  // the first entry of a type in pool order, so pool order is gameplay.
  it('below the cap, the active list is checkEnd\'s own order', () => {
    const { m1, m2 } = campaign();
    const service = (r: RosterEntry): unknown[] => [r.type, r.veterancy, r.missions, r.kills];
    for (const p of [m1, m2]) {
      expect(reserve(p)).toEqual([]);
      expect(active(p).map(service)).toEqual(p.produced.map(service));
    }
  });

  it('with a small cap, the overflow stands down and comes back after losses', () => {
    // Mission 1 at cap 4: five come home, and the rookie mortar team -- no
    // kills, the newest slot -- is the one who stands down.
    const m1 = play(SAVE, M1, 4);
    expect(active(m1)).toHaveLength(4);
    expect(reserve(m1).map((r) => r.type)).toEqual(['mortar_team']);
    // Mission 2 at cap 4, with no recruit this time: Marom is lost and nobody
    // new comes home, so there is room, and the mortar team is recalled --
    // at the END, behind the three who never left.
    const m2 = play(m1.ledger, { ...M2, fresh: [] }, 4);
    expect(reserve(m2)).toEqual([]);
    expect(active(m2).map((r) => r.name)).toEqual(['Sela', '1-2 Ayil', 'Tzur', reserve(m1)[0].name]);
  });

  it('gives deep-equal output for the same inputs, twice', () => {
    expect(campaign()).toEqual(campaign());
  });

  // R-7. The bytes a build from before this branch wrote: named, no slot
  // anywhere, no reserve, no memorials, no slot counter. The first write numbers
  // the roster in its own order from 0; the second mission's death is the first
  // that can leave a memorial.
  it('numbers a pre-change save 0..n-1 on its first write, with no memorials', () => {
    const preChange = JSON.parse(
      '{"roster.surviving_units":[{"type":"inf_squad","veterancy":2,"name":"Barkai","missions":4,"kills":11},{"type":"mbt_lavi","veterancy":1,"name":"1-2 Ayil","missions":2,"kills":3}],"campaign.names_issued":{"squad":1,"vehicle":1,"task":0}}',
    ) as CampaignLedger;
    const m1 = play(preChange, { missionId: 'beit_sahwan_2_foothold', field: ['inf_squad', 'mbt_lavi'] });
    expect(active(m1).map((r) => r.slot)).toEqual([0, 1]);
    expect(m1.ledger['campaign.slots_issued']).toBe(2);
    expect(m1.ledger['roster.lost']).toEqual([]);
    expect(reserve(m1)).toEqual([]);
    expect(m1.lostNamed).toEqual([]);

    const m2 = play(m1.ledger, { missionId: 'beit_sahwan_3_clearance', field: ['inf_squad'], dies: { Barkai: 50 }, fresh: ['inf_squad'] });
    expect(m2.ledger['roster.lost']).toMatchObject([{ slot: 0, name: 'Barkai' }]);
    expect(active(m2).find((r) => r.missions === 1)?.slot).toBe(0);
  });
});
