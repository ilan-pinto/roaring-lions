import { describe, expect, it } from 'vitest';

import worldJson from '../../../data/campaign/world.json';
import commanderJson from '../../../data/campaign/commander.json';
import type { LedgerData } from '@lions/sim';
import {
  campaignRoe,
  campaignSummary,
  commanderForMission,
  hostagesAccount,
  hostagesLine,
  newlyUnlocked,
  nextMissionAfter,
  nextMissionOf,
  parseCommander,
  parseWorld,
  promotionAfter,
  regionForTown,
  regionProgress,
  regionStars,
  townProgress,
  townStars,
  villainPortrait,
  villainState,
  type CommanderData,
  type ParsedWorld,
} from './campaign';

const world = parseWorld(worldJson);
const marj = world.regions[0]!;
const sur = world.regions[1]!;
const beitSahwan = marj.towns[0]!;
const ALL_BS = beitSahwan.missions;
// The Marj's full roster, across all three towns (Beit Sahwan, Khan Rafid,
// Deir Amun) -- used wherever a test needs region-wide completion rather
// than one town's.
const ALL_MARJ = marj.towns.flatMap((t) => t.missions);
const commander = parseCommander(commanderJson);

describe('parseWorld', () => {
  it('maps snake_case authoring keys onto the runtime spelling', () => {
    // Moved with the Marj's completion (Khan Rafid + Deir Amun, design.md C3
    // / O-KR1): Sur now opens only once the whole Marj -- Beit Sahwan, Khan
    // Rafid and Deir Amun -- is finished, not two-thirds of it.
    expect(sur.unlock?.afterMission).toBe('deir_amun_3_subterranean');
  });

  it('keeps town positions as a fixed pair', () => {
    expect(beitSahwan.at).toHaveLength(2);
  });

  it('rejects a world whose regions are missing rather than yielding a half object', () => {
    expect(() => parseWorld({ id: 'x', name: 'x', art: 'a.svg' })).toThrow();
  });
});

describe('regionProgress', () => {
  it('is live with nothing done when the first region has no gate', () => {
    const p = regionProgress(marj, {});
    expect(p.status).toBe('live');
    expect(p.done).toBe(0);
    expect(p.lockedBecause).toBe(null);
  });

  it('counts completed missions across all of a region towns', () => {
    // The Marj is three towns now (Beit Sahwan, Khan Rafid, Deir Amun), so
    // the region's total is all eleven of their missions, not just Beit
    // Sahwan's five.
    const p = regionProgress(marj, { 'campaign.completed_missions': [ALL_BS[0]!] });
    expect(p.done).toBe(1);
    expect(p.total).toBe(ALL_MARJ.length);
  });

  it('is complete only when every mission of every town is done', () => {
    const p = regionProgress(marj, { 'campaign.completed_missions': [...ALL_MARJ] });
    expect(p.status).toBe('complete');
    expect(p.done).toBe(p.total);
  });

  it('is locked, and says why, while its gate is unmet', () => {
    const p = regionProgress(sur, {});
    expect(p.status).toBe('locked');
    expect(p.lockedBecause).toContain('deir_amun_3_subterranean');
  });

  it('opens once the gating mission is cleared', () => {
    const p = regionProgress(sur, { 'campaign.completed_missions': ['deir_amun_3_subterranean'] });
    expect(p.status).toBe('live');
    expect(p.lockedBecause).toBe(null);
  });

  it('reports an unlocked region with nothing authored as empty, not complete and not live', () => {
    // Every real town in world.json now carries missions -- Khan Rafid and
    // Deir Amun landed theirs alongside Sur's gate moving to
    // deir_amun_3_subterranean -- so this is a synthetic fixture rather than
    // a real town standing in for "unlocked region, one town, nothing
    // authored", the way nextMissionOf's equivalent case below is.
    //
    // It must not read as `live` either (#117): the card printed the badge
    // `live` directly above "no operations authored yet", and the badge is the
    // half a player acts on. `live` promises something to click; `empty` is
    // open ground with nothing on it. The un-clickable hover affordances that
    // made that promise worse are gated on the same distinction -- see
    // worldmap.test.ts.
    const marjWithOneEmptyTown = {
      ...marj,
      towns: [{ id: 'empty_town', name: 'Empty Town', at: [0, 0] as [number, number], missions: [] }],
    };
    const p = regionProgress(marjWithOneEmptyTown, {});
    expect(p.total).toBe(0);
    expect(p.status).toBe('empty');
    expect(p.lockedBecause).toBe(null);
  });

  it('ignores completed missions that belong to other regions', () => {
    const p = regionProgress(sur, { 'campaign.completed_missions': [...ALL_BS] });
    expect(p.done).toBe(0);
  });
});

describe('nextMissionOf', () => {
  it('is the first mission when nothing is done', () => {
    expect(nextMissionOf(beitSahwan, {})).toBe(ALL_BS[0]);
  });

  it('skips what is already complete, in authored order', () => {
    expect(nextMissionOf(beitSahwan, { 'campaign.completed_missions': [ALL_BS[0]!] })).toBe(ALL_BS[1]);
  });

  it('returns the first incomplete mission even when a later one was cleared out of order', () => {
    const done = { 'campaign.completed_missions': [ALL_BS[2]!] };
    expect(nextMissionOf(beitSahwan, done)).toBe(ALL_BS[0]);
  });

  it('is null for a finished town, which is how the map knows to stop offering it', () => {
    expect(nextMissionOf(beitSahwan, { 'campaign.completed_missions': [...ALL_BS] })).toBe(null);
  });

  it('is null for a town with no missions authored yet', () => {
    // Every real town in world.json now carries missions -- Khan Rafid and
    // Deir Amun (marj.towns[1] and marj.towns[2]) landed theirs -- so this is
    // a synthetic fixture rather than a real, still-empty town.
    expect(nextMissionOf({ id: 'empty_town', name: 'Empty Town', at: [0, 0], missions: [] }, {})).toBe(null);
  });
});

describe('nextMissionAfter', () => {
  it('resolves through the owning town for a mission that is on the map', () => {
    const done = { 'campaign.completed_missions': [ALL_BS[0]!, ALL_BS[1]!] };
    expect(nextMissionAfter(world, ALL_BS[1]!, done)).toBe(ALL_BS[2]);
  });

  it('hands off to the current front when no town owns the finished mission', () => {
    // beit_sahwan_0_tutorial is deliberately not listed under any town -- it teaches
    // the mouse, not the war -- so this exercises the fallback, not the owning-town path.
    expect(nextMissionAfter(world, 'beit_sahwan_0_tutorial', {})).toBe(ALL_BS[0]);
  });

  it('is undefined for the last mission of the last authored town, not a wrap-around', () => {
    const done = { 'campaign.completed_missions': [...ALL_BS] };
    expect(nextMissionAfter(world, ALL_BS[ALL_BS.length - 1]!, done)).toBeUndefined();
  });

  it('still returns the following mission when the ledger already records the one that just finished', () => {
    // This is the shape main.ts actually calls it with -- updatedLedger already has the
    // just-finished mission merged in before nextMissionAfter ever sees it.
    const done = { 'campaign.completed_missions': [ALL_BS[0]!] };
    expect(nextMissionAfter(world, ALL_BS[0]!, done)).toBe(ALL_BS[1]);
  });

  it('resolves through the owning town, not the fallback, when both are live and disagree', () => {
    // Synthetic, not world.json: in the real fixture, beit_sahwan is both the only
    // authored town and the current front, so the owning-town path and the fallback
    // always land on the same mission and no real input can tell them apart. This world
    // gives two live regions with different available missions, and lists the *other*
    // one (B) first, specifically so the two paths disagree -- if the owning-town lookup
    // were skipped, the fallback would reach B before it ever got to A.
    const synthetic: ParsedWorld = {
      id: 'synthetic',
      name: 'Synthetic Theatre',
      art: 'synthetic.svg',
      regions: [
        {
          id: 'region_b',
          name: 'Region B',
          faction: 'b-faction',
          doctrine: 'b-doctrine',
          towns: [{ id: 'town_b', name: 'Town B', at: [0, 0], missions: ['b1'] }],
        },
        {
          id: 'region_a',
          name: 'Region A',
          faction: 'a-faction',
          doctrine: 'a-doctrine',
          towns: [{ id: 'town_a', name: 'Town A', at: [0, 0], missions: ['a1', 'a2'] }],
        },
      ],
    };
    const ledger = { 'campaign.completed_missions': ['a1'] };
    expect(nextMissionAfter(synthetic, 'a1', ledger)).toBe('a2');
  });
});

describe('townProgress', () => {
  it('counts only its own missions', () => {
    const p = townProgress(beitSahwan, { 'campaign.completed_missions': [ALL_BS[0]!, 'unrelated'] });
    expect(p).toEqual({ done: 1, total: ALL_BS.length });
  });
});

describe('campaignRoe', () => {
  it('is null before any mission has been rated', () => {
    expect(campaignRoe({})).toBe(null);
  });

  it('averages the per-mission bests', () => {
    const r = campaignRoe({ 'roe.mission_ratings': { a: 40, b: 80 } });
    expect(r?.mean).toBe(60);
  });

  it('names the worst-rated mission, so a low average is explainable', () => {
    const r = campaignRoe({ 'roe.mission_ratings': { a: 40, b: 80 } });
    expect(r?.worst).toEqual(['a', 40]);
  });

  it('reports no worst mission when only one has been played', () => {
    expect(campaignRoe({ 'roe.mission_ratings': { a: 40 } })?.worst).toBe(null);
  });

  it('falls back to a legacy save with a bare cumulative rating and no map', () => {
    const r = campaignRoe({ 'roe.cumulative_rating': 64 } as LedgerData);
    expect(r?.mean).toBe(64);
    expect(r?.worst).toBe(null);
  });
});

describe('parseCommander', () => {
  it('reads Shai and Idit from the shipped commander.json', () => {
    // Both carry a `portrait` file name (Shai's and Idit's landed 2026-09-04);
    // exercised by the same `toEqual` this file used before the field existed.
    expect(commander.people.shai).toEqual({
      name: 'Shai Hammai',
      plate: 'Hammai',
      portrait: 'shai_hammai.png',
    });
    expect(commander.people.idit).toEqual({ name: 'Idit Zohar', plate: 'Zohar', portrait: 'idit_zohar.png' });
  });

  it('carries an unresolved portrait file name through untouched -- resolving it to a URL is not this module\'s job', () => {
    expect(parseCommander(commanderJson).people.shai.portrait).toBe('shai_hammai.png');
    expect(parseCommander({ people: { shai: { name: 'S', plate: 'P' }, idit: { name: 'I', plate: 'Q' } }, ranks: [{ rank: 'R', stars: 1 }] }).people.shai.portrait).toBeUndefined();
  });

  it('maps the authoring spelling (until_mission) onto the runtime one (untilMission)', () => {
    // Moved with Khan Rafid / Deir Amun (design.md C4): the Captain's tenure
    // now runs through all six of those missions too, so the act boundary --
    // and the third star -- lands at deir_amun_3_subterranean rather than at
    // beit_sahwan_4_subterranean.
    expect(commander.ranks[0]!.untilMission).toBe('deir_amun_3_subterranean');
    // The last entry is the default and carries no until_mission at all.
    expect(commander.ranks[commander.ranks.length - 1]!.untilMission).toBeUndefined();
  });

  it('rejects a commander object with no people or no ranks, rather than yielding a half object', () => {
    expect(() => parseCommander({ ranks: [] })).toThrow();
    expect(() => parseCommander({ people: { shai: {}, idit: {} } })).toThrow();
  });
});

describe('commanderForMission', () => {
  it('is Captain for every Beit Sahwan mission, including the tutorial and First Light', () => {
    // The tutorial (beit_sahwan_0_tutorial) is deliberately unlisted under
    // any town (`nextMissionAfter`'s own doc comment) -- this is the case
    // `missionPosition`'s id-prefix fallback exists for. First Light is
    // `beit_sahwan_breach`, ALL_BS[0], already in the list.
    for (const id of [...ALL_BS, 'beit_sahwan_0_tutorial']) {
      expect(commanderForMission(commander, world, id).rank).toBe('Captain');
    }
  });

  it('is Captain throughout Khan Rafid and Deir Amun -- the arc these six missions belong to', () => {
    // design.md D1/D2 and C4: the whole point of moving the Captain
    // until_mission to deir_amun_3_subterranean is that Shai is not promoted
    // mid-arc. Every one of the six missions, including the last, must still
    // read Captain.
    for (const id of [
      'khan_rafid_1_recon',
      'khan_rafid_2_foothold',
      'khan_rafid_3_clearance',
      'deir_amun_1_recon',
      'deir_amun_2_foothold',
      'deir_amun_3_subterranean',
    ]) {
      expect(commanderForMission(commander, world, id).rank).toBe('Captain');
    }
  });

  it('is Major at Tel Marum I', () => {
    expect(commanderForMission(commander, world, 'tel_marum_1_recon').rank).toBe('Major');
  });

  it('is Lieutenant Colonel at Wadi Halam I', () => {
    expect(commanderForMission(commander, world, 'wadi_halam_1_fords').rank).toBe('Lieutenant Colonel');
  });

  it('defaults to Colonel -- the last entry, which names no until_mission -- for an unknown mission id', () => {
    expect(commanderForMission(commander, world, 'not_a_real_mission').rank).toBe('Colonel');
  });

  it("resolves Shai's name, plate and stars from commander.json rather than a hard-coded constant", () => {
    const r = commanderForMission(commander, world, 'beit_sahwan_breach');
    expect(r).toEqual({ name: 'Shai Hammai', plate: 'Hammai', rank: 'Captain', stars: 2 });
  });

  it('never promotes early -- the mission that ENDS a rank still holds it, not the one after', () => {
    expect(commanderForMission(commander, world, 'beit_sahwan_4_subterranean').rank).toBe('Captain');
    expect(commanderForMission(commander, world, 'wadi_halam_5_depot').rank).toBe('Lieutenant Colonel');
  });

  it('resolves at mission granularity, not just town granularity, for a synthetic mid-town promotion', () => {
    // None of commander.json's real boundaries fall mid-town today (every
    // until_mission is a town's own last mission), so this is the one case
    // that needs a synthetic fixture: proof that a future promotion placed
    // BETWEEN two missions of the same town would still land correctly,
    // rather than only by the accident of every boundary so far being a
    // town's last mission.
    const midTown: CommanderData = {
      people: commander.people,
      ranks: [
        { rank: 'Lieutenant', stars: 1, untilMission: 'beit_sahwan_1_recon' },
        { rank: 'Captain', stars: 2 },
      ],
    };
    expect(commanderForMission(midTown, world, 'beit_sahwan_breach').rank).toBe('Lieutenant');
    expect(commanderForMission(midTown, world, 'beit_sahwan_1_recon').rank).toBe('Lieutenant');
    expect(commanderForMission(midTown, world, 'beit_sahwan_2_foothold').rank).toBe('Captain');
  });
});

describe('regionForTown', () => {
  it('finds the region that owns a town id', () => {
    expect(regionForTown(world, 'beit_sahwan')?.id).toBe('marj');
    expect(regionForTown(world, 'tel_marum')?.id).toBe('sur');
    expect(regionForTown(world, 'umm_zeitoun')?.id).toBe('sur');
    expect(regionForTown(world, 'wadi_halam')?.id).toBe('naharin');
  });

  it('is undefined for a town id world.json does not have, and for undefined itself', () => {
    expect(regionForTown(world, 'not_a_real_town')).toBeUndefined();
    expect(regionForTown(world, undefined)).toBeUndefined();
  });
});

describe('villainPortrait', () => {
  it("reads each front's villain face from the shipped commander.json (storyline.md G18)", () => {
    expect(villainPortrait(commander, 'marj')).toBe('nadir_sahim.png');
    expect(villainPortrait(commander, 'sur')).toBe('karim_adhal.png');
    expect(villainPortrait(commander, 'naharin')).toBe('jubran_hallaq.png');
  });

  it('is undefined for a region with no villain entry, and for undefined itself', () => {
    expect(villainPortrait(commander, 'not_a_real_region')).toBeUndefined();
    expect(villainPortrait(commander, undefined)).toBeUndefined();
  });

  it('is undefined on a commander object with no villains block at all, rather than throwing', () => {
    const noVillains: CommanderData = { people: commander.people, ranks: commander.ranks };
    expect(villainPortrait(noVillains, 'marj')).toBeUndefined();
  });

  it('composes with regionForTown the way main.ts resolves the enemy face end to end', () => {
    const region = regionForTown(world, 'tel_marum');
    expect(villainPortrait(commander, region?.id)).toBe('karim_adhal.png');
    const unknown = regionForTown(world, 'not_a_real_town');
    expect(villainPortrait(commander, unknown?.id)).toBeUndefined();
  });
});

describe('campaignSummary', () => {
  it('reads the mean of the per-mission ratings, not the legacy key nothing writes', () => {
    expect(campaignSummary({ 'roe.mission_ratings': { a: 80, b: 60 } })).toBe('campaign: Conduct 70');
    expect(campaignSummary({})).toBe('campaign: fresh start');
  });
});

describe('stars on the board', () => {
  const bs = world.regions[0]!.towns[0]!;
  it('sums each mission\'s best stars against three per mission', () => {
    const ledger: LedgerData = { 'campaign.mission_results': { [bs.missions[0]!]: { stars: 2, roe: 90, ticks: 1, lost: 0 } } };
    expect(townStars(bs, ledger)).toEqual({ earned: 2, possible: bs.missions.length * 3 });
    expect(regionStars(world.regions[0]!, ledger).earned).toBe(2);
    expect(townStars(bs, undefined)).toEqual({ earned: 0, possible: bs.missions.length * 3 });
  });
});

describe('newlyUnlocked', () => {
  it('lists units locked before and open after, and nothing else', () => {
    const units = [
      { id: 'a', name: 'A', unlock: { roeMin: 60 } },
      { id: 'b', name: 'B', unlock: { roeMin: 90 } },
      { id: 'c', name: 'C' },
    ];
    const before = { 'roe.mission_ratings': { m1: 50 } };
    const after = { 'roe.mission_ratings': { m1: 50, m2: 80 } }; // mean 65
    expect(newlyUnlocked(units, before, after)).toEqual([{ id: 'a', name: 'A', gate: 'conduct' }]);
  });

  it('says which gate opened, so the debrief can print the why', () => {
    // Spec §4.5 wants "Campaign Conduct 58 → 62: Namer IFV available", and the
    // two figures only make sense for a Conduct gate -- a unit opened by
    // clearing a mission has no before/after number to show.
    const units = [
      { id: 'a', name: 'A', unlock: { roeMin: 60 } },
      { id: 'b', name: 'B', unlock: { afterMission: 'm2' } },
    ];
    const before = { 'roe.mission_ratings': { m1: 50 }, 'campaign.completed_missions': [] };
    const after = {
      'roe.mission_ratings': { m1: 50, m2: 80 },
      'campaign.completed_missions': ['m2'],
    };
    expect(newlyUnlocked(units, before, after)).toEqual([
      { id: 'a', name: 'A', gate: 'conduct' },
      { id: 'b', name: 'B', gate: 'mission' },
    ]);
  });
});

describe('promotionAfter', () => {
  it('names the next rank when the mission ends a rank, and nothing otherwise', () => {
    // deir_amun_3_subterranean, not beit_sahwan_4_subterranean: Captain's authored
    // until_mission moved there when Khan Rafid and Deir Amun landed in the Marj
    // (design.md C3/C4), and the motivation-layer spec (§4.5) says ranks already
    // live in commander.json matching the act ends -- deir_amun_3_subterranean is
    // that act end today.
    const p = promotionAfter(commander, world, 'deir_amun_3_subterranean');
    expect(p?.rank).toBe('Major');
    expect(p?.stars).toBe(3);
    expect(promotionAfter(commander, world, 'beit_sahwan_1_recon')).toBeNull();
  });
});

describe('villainState', () => {
  const marj = world.regions[0]!;
  const last = marj.towns[marj.towns.length - 1]!.missions.at(-1)!;
  it('is at large until the front\'s last mission is done', () => {
    expect(villainState(marj, {}, () => undefined)).toBe('at_large');
  });
  it('is captured when that mission\'s primaries include a capture, else killed', () => {
    const done = { 'campaign.completed_missions': [last] };
    expect(villainState(marj, done, () => ({ objectives: [{ type: 'capture', primary: true }] }))).toBe('captured');
    expect(villainState(marj, done, () => ({ objectives: [{ type: 'eliminate_hvt', primary: true }] }))).toBe('killed');
  });
});

describe('the account of the taken', () => {
  it('subtracts what came back from what was taken, and reads nothing when the world names no number', () => {
    expect(hostagesAccount(world, { 'civ.hostages_recovered': { a: 2, b: 3 } })).toEqual({ taken: 19, recovered: 5 });
    expect(hostagesAccount({ ...world, taken: undefined }, {})).toBeNull();
  });
  it('is Idit\'s line', () => {
    expect(hostagesLine({ taken: 19, recovered: 0 })).toBe('Nineteen still out.');
    expect(hostagesLine({ taken: 19, recovered: 2 }, { count: 2, place: 'the shaft head' })).toBe(
      'Seventeen still out. Two came back at the shaft head.'
    );
    expect(hostagesLine({ taken: 19, recovered: 19 })).toBe('Nobody still out.');
  });
});
