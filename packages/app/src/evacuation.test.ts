import { describe, expect, it } from 'vitest';
import { activeRefuge, evacuationTargets, refugePoint, withEvacuationProgress } from './evacuation';
import khanRafid2 from '../../../data/missions/khan_rafid_2_foothold.json';
import khanRafidMap from '../../../data/maps/khan_rafid.json';
import firstLight from '../../../data/missions/beit_sahwan_breach.json';
import { briefingBeats } from './ui/loading';

const mission = {
  civilians: { refuge: 'civ_refuge' },
  objectives: [
    { id: 'hold', type: 'hold_for' },
    { id: 'get_four_in', type: 'evacuate_before', count: 4 },
    { id: 'one_default', type: 'evacuate_before' },
  ],
};
const markers = { civ_refuge: [24, 22] as const };
const row = (id: string, status = 'active', text = id) => ({ id, text, status, primary: true });

describe('refugePoint', () => {
  it("is the refuge marker's tile centre, as the runtime resolves it", () => {
    expect(refugePoint(mission, markers)).toEqual({ x: 24.5, y: 22.5 });
  });
  it('is null with no refuge named, or a marker the map lacks', () => {
    expect(refugePoint({}, markers)).toBeNull();
    expect(refugePoint({ civilians: { refuge: 'nowhere' } }, markers)).toBeNull();
    expect(refugePoint(undefined, markers)).toBeNull();
  });
  // The mission the report was filed against, read from the shipped files.
  it("finds Khan Rafid II's refuge inside its own ward", () => {
    const at = refugePoint(khanRafid2, khanRafidMap.markers as unknown as Record<string, [number, number]>);
    const ward = (khanRafidMap.zones as unknown as Record<string, number[]>).ward;
    expect(at).not.toBeNull();
    expect(at!.x).toBeGreaterThanOrEqual(ward[0]);
    expect(at!.x).toBeLessThan(ward[0] + ward[2]);
    expect(at!.y).toBeGreaterThanOrEqual(ward[1]);
    expect(at!.y).toBeLessThan(ward[1] + ward[3]);
  });
});

describe('evacuationTargets', () => {
  it('collects every evacuate_before with its count, defaulting to one', () => {
    expect([...evacuationTargets(mission)]).toEqual([
      ['get_four_in', 4],
      ['one_default', 1],
    ]);
  });
  it('is empty for a mission with none, or no mission', () => {
    expect(evacuationTargets({ objectives: [{ id: 'a', type: 'hold_for' }] }).size).toBe(0);
    expect(evacuationTargets(undefined).size).toBe(0);
  });
});

describe('withEvacuationProgress', () => {
  const targets = evacuationTargets(mission);
  const refuge = { x: 24.5, y: 22.5 };

  it('stamps an active evacuation with its tally and the refuge', () => {
    const out = withEvacuationProgress([row('hold'), row('get_four_in', 'active', 'Get four in')], targets, 1, refuge);
    expect(out[0]).toEqual(row('hold'));
    expect(out[1]).toMatchObject({ text: 'Get four in (1/4)', jumpTo: refuge });
  });

  it('never shows more out than the objective asks for', () => {
    const out = withEvacuationProgress([row('get_four_in', 'active', 'X')], targets, 6, refuge);
    expect(out[0].text).toBe('X (4/4)');
  });

  it('leaves a decided evacuation as authored', () => {
    const out = withEvacuationProgress([row('get_four_in', 'failed', 'X')], targets, 2, refuge);
    expect(out[0]).toEqual(row('get_four_in', 'failed', 'X'));
  });

  it('offers no jump when there is no refuge to jump to', () => {
    const out = withEvacuationProgress([row('get_four_in', 'active', 'X')], targets, 0, null);
    expect(out[0].text).toBe('X (0/4)');
    expect(out[0].jumpTo).toBeUndefined();
  });

  it('passes a mission with no evacuation straight through', () => {
    const rows = [row('hold')];
    expect(withEvacuationProgress(rows, new Map(), 3, refuge)).toEqual(rows);
  });
});

describe('activeRefuge', () => {
  const targets = evacuationTargets(mission);
  const refuge = { x: 24.5, y: 22.5 };
  it('is the refuge while an evacuation is active, and null once none is', () => {
    expect(activeRefuge([row('hold'), row('get_four_in')], targets, refuge)).toEqual(refuge);
    expect(activeRefuge([row('get_four_in', 'complete'), row('one_default', 'failed')], targets, refuge)).toBeNull();
    // A hold still running does not keep the refuge up on its own.
    expect(activeRefuge([row('hold')], targets, refuge)).toBeNull();
    expect(activeRefuge([row('get_four_in')], targets, null)).toBeNull();
  });
});

// The rule, in words, in the first mission that scores it (GH-279). Held to the
// narrative sheet's own contract: 385-1,225 characters
// (`.claude/agents/narrative-designer.md`, `docs/campaign/README.md`) and the
// eight beats `docs/campaign/beit_sahwan/narrative.md` §2.3 tabulates.
describe("First Light's briefing states the flight rule", () => {
  const beats = briefingBeats(firstLight.briefing);
  // GH-345 cut the briefing with the mission (two problems, no mortar, no
  // outpost, no corridor): five beats now, the flight rule still the last.
  it('names both triggers: a soldier within four tiles, and fire', () => {
    expect(beats[4]).toMatch(/within four tiles/);
    expect(beats[4]).toMatch(/under fire/);
  });
  it('stays inside the authored band and the tabulated five beats', () => {
    expect(firstLight.briefing.length).toBeGreaterThanOrEqual(385);
    expect(firstLight.briefing.length).toBeLessThanOrEqual(1225);
    expect(beats).toHaveLength(5);
  });
});
