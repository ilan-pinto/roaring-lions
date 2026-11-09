// GH-1144: the bought-track gate must be able to fail. Each case below is a track (or an exemption table) built to be wrong, and the gate must call it so.
import { describe, expect, it } from 'vitest';
import type { UnitTypeJson } from '@lions/sim';
import { EXEMPT, aloneAtMax, checkOf, fireCheck, fireDistance, judge, orphanExemptions, trackChecks, tracksOf, type TrackCheck } from './bought-tracks';
import { NINE, stagedUnit, trackRow } from './special-units-probes';
import { isPinnedOnly } from './pinned-only';

const SEEDS = 6;

/** `json` with `mutate` applied to a deep copy of the track's tiers (the unit's own data is never touched). */
function withTrack(json: UnitTypeJson, track: string, mutate: (tiers: { price: number; patch: Record<string, number> }[]) => void): UnitTypeJson {
  const copy = JSON.parse(JSON.stringify(json)) as { upgrades: Record<string, { tiers: { price: number; patch: Record<string, number> }[] }> };
  mutate(copy.upgrades[track].tiers);
  return copy as unknown as UnitTypeJson;
}

describe('the nine bought-only units, one track at a time', () => {
  // The playtest's own 30 seeds: at 6 the camo Lavi's small firepower gain (+3%) reads a tie, so the gate is only as good as its seed count.
  const checks = trackChecks(NINE);
  const verdicts = judge(checks);

  it('covers every track every one of the nine carries (21 of them), none twice', () => {
    expect(checks).toHaveLength(21);
    expect(new Set(checks.map((c) => `${c.id}.${c.track}`)).size).toBe(21);
    for (const id of NINE) expect(checks.filter((c) => c.id === id).map((c) => c.track)).toEqual(tracksOf(stagedUnit(id)));
  });

  it('every track gains in its own drill, except the three named armour ties', () => {
    const bad = verdicts.filter((v) => v.state !== 'ok' && v.state !== 'exempt').map((v) => `${v.check.id}.${v.check.track}: ${v.state} (${v.check.detail})`);
    expect(bad).toEqual([]);
    expect(verdicts.filter((v) => v.state === 'exempt').map((v) => `${v.check.id}.${v.check.track}`).sort()).toEqual(Object.keys(EXEMPT).sort());
  });

  it('names no exemption that covers nothing', () => {
    expect(orphanExemptions(checks)).toEqual([]);
  });
});

describe('the gate can fail', () => {
  const nlos = stagedUnit('at_nlos_team');
  const dog = stagedUnit('ugv_recon_dog');
  const grenadier = stagedUnit('inf_grenadier');

  it('an armour track that adds nothing is a tie, and a tie fails', () => {
    const dead = withTrack(nlos, 'armour', (tiers) => tiers.forEach((t) => (t.patch = {})));
    const row = trackRow('at_nlos_team', dead, aloneAtMax(dead, 'armour'), SEEDS);
    const check = checkOf(row, 'armour');
    expect(check.gains).toBe(false);
    expect(judge([check])[0].state).toBe('fail');
  });

  it('a sensors track that blinds the unit does not gain', () => {
    const blind = withTrack(dog, 'sensors', (tiers) =>
      tiers.forEach((t) => {
        for (const k of Object.keys(t.patch)) t.patch[k] = -Math.abs(t.patch[k]) * 4;
      })
    );
    const check = checkOf(trackRow('ugv_recon_dog', blind, aloneAtMax(blind, 'sensors'), SEEDS), 'sensors');
    expect(check.gains).toBe(false);
  });

  it('a firepower track on a weapon the drill cannot reach is read at the weapon\'s own range (the grenadier is 5 tiles, not 8)', () => {
    expect(fireDistance(grenadier)).toBe(5);
    expect(fireDistance(nlos)).toBe(8);
    expect(fireCheck('inf_grenadier', grenadier, SEEDS).gains).toBe(true);
  });

  it('a firepower track that does nothing is a tie', () => {
    const dead = withTrack(nlos, 'firepower', (tiers) => tiers.forEach((t) => (t.patch = {})));
    expect(fireCheck('at_nlos_team', dead, SEEDS).gains).toBe(false);
  });

  it('a track alone leaves the other tracks at base', () => {
    const only = aloneAtMax(nlos, 'sensors') as unknown as { hull: { hp: number }; weapons: { accuracy: number }[] };
    const base = nlos as unknown as { hull: { hp: number }; weapons: { accuracy: number }[] };
    expect(only.hull.hp).toBe(base.hull.hp);
    expect(only.weapons[0].accuracy).toBe(base.weapons[0].accuracy);
    expect(JSON.stringify(aloneAtMax(nlos, 'sensors'))).not.toBe(JSON.stringify(nlos));
  });

  it('a named tie that starts to gain is STALE, and a tie that is not named FAILS', () => {
    const gain: TrackCheck = { id: 'spg_cluster', track: 'armour', drill: 'survival', gains: true, detail: '' };
    const tie: TrackCheck = { id: 'spg_cluster', track: 'armour', drill: 'survival', gains: false, detail: '' };
    expect(judge([gain], { 'spg_cluster.armour': 'x' })[0].state).toBe('stale');
    expect(judge([tie], { 'spg_cluster.armour': 'x' })[0].state).toBe('exempt');
    expect(judge([tie], {})[0].state).toBe('fail');
    expect(judge([gain], {})[0].state).toBe('ok');
  });

  it('an exemption naming a track no check covers is an orphan', () => {
    const only: TrackCheck = { id: 'spg_cluster', track: 'sensors', drill: 'identification', gains: true, detail: '' };
    expect(orphanExemptions([only], { 'spg_cluster.armour': 'x', 'spg_cluster.sensors': 'y' })).toEqual(['spg_cluster.armour']);
  });
});

describe('the pinned-seed-only labels', () => {
  it('(max tier) and (track replay) are left out of the 30-seed sweep; a plain or (bought) label is not', () => {
    expect(isPinnedOnly('khan_rafid_3_clearance (max tier)')).toBe(true);
    expect(isPinnedOnly('umm_zeitoun_4_clearance (bought spg_cluster armour) (track replay)')).toBe(true);
    expect(isPinnedOnly('umm_zeitoun_4_clearance (bought)')).toBe(false);
    expect(isPinnedOnly('umm_zeitoun_4_clearance')).toBe(false);
  });
});
