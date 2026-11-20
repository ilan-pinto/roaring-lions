// GH-1438 E13 rules (a) and (c) (docs/campaign/civilian-drama.md §10.2 E13): a civilian muster lies outside every
// `evacuate_before` zone, and on a mission with a gate the muster's crowd cannot walk to the refuge with every gate
// shut. The pure rules are tools/validate_muster.mjs; validate_data.mjs runs them on every shipped mission.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { structures as structureTypes } from '@lions/data';
import { maps, missions } from '@lions/data/content';
import { musterReach, musterZoneFailures, musters, sealedCompoundFailures } from '../validate_muster.mjs';

const ROOT = join(__dirname, '..', '..');

/** E1's proposed row (§2.2), as a FIXTURE: data/structures.json ships the `gate` schema but no gate type yet. */
const COMPOUND_GATE = {
  id: 'compound_gate', name: 'Compound Gate', symbol: 'G', hp_per_tile: 600, garrison_slots: 0, rubble_cover: 1,
  height_px: 14, color: 'limestone.5', roe_penalty: 0, per_tile: false, low_profile: true, standing_cover: 2,
  gate: { open_radius_tiles: 4, hold_open_s: 3, swing_s: 2 },
};
const TYPES_WITH_GATE = { ...(structureTypes as Record<string, unknown>), compound_gate: COMPOUND_GATE };

/** A crowd `road` of civilians, run to `to` at t=2; `group` may be shared with an enemy placement to make it mixed. */
const crowd = (to: string, extra: Record<string, unknown> = {}) => ({
  id: 'fixture',
  map: { file: 'x' },
  civilians: { refuge: 'refuge', groups: [{ unit: 'civilians', count: 3, at: [1, 1], group: 'road' }] },
  objectives: [{ id: 'evac', type: 'evacuate_before', target: 'yard', count: 2, seconds: 300 }],
  triggers: [{ id: 'run', on: { kind: 'timer_s', value: 2 }, do: { kind: 'withdraw_to', group: 'road', to } }],
  ...extra,
});

describe('rule (a): the muster is outside every evacuate_before zone', () => {
  const map = { width: 20, height: 20, rows: [], markers: { apron: [9, 5], inside: [10, 5], edge: [13, 8], past: [14, 8], below: [13, 9], refuge: [12, 6] }, zones: { yard: [10, 4, 4, 5], other: [0, 15, 3, 3] } };
  it('refuses a muster inside the zone and names the trigger, the marker and the zone', () => {
    expect(musterZoneFailures(crowd('inside'), map, 'm')).toEqual([
      'm: withdraw_to "run" musters the crowd at "inside" (10, 5), inside evacuate_before "evac"\'s zone "yard" -- the ' +
        'crowd would run into its own refuge and count itself in (GH-1438 E13 a)',
    ]);
  });
  it('the zone is [x, y, w, h], end-exclusive: (13, 8) is its last tile; (9, 5), (14, 8) and (13, 9) are outside', () => {
    expect(musterZoneFailures(crowd('edge'), map, 'm')).toHaveLength(1);
    for (const out of ['apron', 'past', 'below']) expect(musterZoneFailures(crowd(out), map, 'm'), out).toEqual([]);
  });
  it('reads EVERY evacuate_before zone, a second objective scoped to another group included', () => {
    const two = crowd('apron', {
      objectives: [
        { id: 'evac', type: 'evacuate_before', target: 'yard', count: 2, seconds: 300 },
        { id: 'late', type: 'evacuate_before', target: 'other', count: 1, seconds: 400, group: 'elsewhere' },
      ],
    });
    const zones = { ...map.zones, other: [8, 4, 2, 2] };
    expect(musterZoneFailures(two, { ...map, zones }, 'm')).toHaveLength(1);
    expect(musterZoneFailures(two, map, 'm')).toEqual([]);
  });
  it('only an ALL-civilian group musters: an enemy member in the group, or a commit, is not a muster', () => {
    const mixed = crowd('inside', { enemy: { garrison: [{ unit: 'militia_cell', count: 1, at: [2, 2], group: 'road' }] } });
    expect(musters(mixed, map.markers)).toEqual([]);
    expect(musterZoneFailures(mixed, map, 'm')).toEqual([]);
    const commit = crowd('inside', { triggers: [{ id: 'go', on: { kind: 'timer_s', value: 2 }, do: { kind: 'commit', group: 'road', to: 'inside' } }] });
    expect(musterZoneFailures(commit, map, 'm')).toEqual([]);
  });
});

describe('rule (c): with every gate shut, the muster cannot walk to the refuge', () => {
  // A 10x7 walled yard (`=`, the shipped wall) at x 3..9, y 1..5, gated on its west face by a 1x2 `G` at (3,2)-(3,3).
  const SEALED = [
    '............',
    '...=======..',
    '...G.....=..',
    '...G.....=..',
    '...=.....=..',
    '...=======..',
    '............',
  ];
  const yard = (rows: string[], zones: Record<string, number[]> = { yard: [4, 2, 5, 3] }) => ({
    width: rows[0].length, height: rows.length, rows, markers: { apron: [1, 3], refuge: [6, 3] }, zones,
  });
  const at = (rows: string[], x: number, y: number, c: string) => rows.map((r, j) => (j === y ? r.slice(0, x) + c + r.slice(x + 1) : r));

  it('a sealed yard passes', () => {
    expect(sealedCompoundFailures(crowd('apron'), yard(SEALED), TYPES_WITH_GATE, 'm')).toEqual([]);
  });
  it('a hole in the wall fails, and names the muster, what it reached and where', () => {
    const holed = at(SEALED, 9, 4, '.');
    expect(sealedCompoundFailures(crowd('apron'), yard(holed), TYPES_WITH_GATE, 'm')).toEqual([
      'm: withdraw_to "run" musters the crowd at "apron" (1, 3), and with every gate shut it can still walk to ' +
        'evacuate_before "evac"\'s zone "yard" at (8, 4) -- the compound is not sealed, so a passive player\'s crowd ' +
        'leaks in (GH-1438 E13 c)',
    ]);
  });
  it('the gate is read SHUT: the gate tiles are blocked, never a way in', () => {
    // The same yard with the gate drawn as open ground leaks through the gap: the gate is what seals it.
    const gap = at(at(SEALED, 3, 2, '.'), 3, 3, '.');
    expect(musterReach(crowd('apron'), yard(gap), TYPES_WITH_GATE)[0].reached).not.toBeNull();
    expect(musterReach(crowd('apron'), yard(SEALED), TYPES_WITH_GATE)[0].reached).toBeNull();
  });
  it('no corner cutting: a wall whose blocks only touch diagonally still seals (the flow field never cuts a corner)', () => {
    // A notch in the east wall: (9,3) open, plugged by (10,3) and (10,2). From (9,3) the diagonal to the open (10,4)
    // passes between (10,3) and (9,4), both wall: a corner-cutting walker would leak there, the sim's never does.
    const stepped = at(at(at(SEALED, 9, 3, '.'), 10, 3, '='), 10, 2, '=');
    expect(sealedCompoundFailures(crowd('apron'), yard(stepped), TYPES_WITH_GATE, 'm')).toEqual([]);
    // ...and an orthogonal leak out of the same notch: (9,2) open too, onto the open (10,2).
    const leak = at(at(SEALED, 9, 3, '.'), 9, 2, '.');
    expect(sealedCompoundFailures(crowd('apron'), yard(leak), TYPES_WITH_GATE, 'm')).toHaveLength(1);
  });
  it('the target is the refuge tile AND every evacuation zone tile', () => {
    // A zone that pokes out of the wall is reached outside it, though the refuge inside stays sealed.
    const out = sealedCompoundFailures(crowd('apron'), yard(SEALED, { yard: [4, 2, 5, 3], porch: [0, 5, 2, 2] }), TYPES_WITH_GATE, 'm');
    expect(out).toEqual([]); // `porch` is not an evacuate_before target yet
    const poke = crowd('apron', { objectives: [{ id: 'evac', type: 'evacuate_before', target: 'porch', count: 2, seconds: 300 }] });
    expect(sealedCompoundFailures(poke, yard(SEALED, { porch: [0, 5, 2, 2] }), TYPES_WITH_GATE, 'm')).toHaveLength(1);
    // With no zone at all the refuge marker alone is the target.
    const bare = crowd('apron', { objectives: [] });
    expect(musterReach(bare, yard(at(SEALED, 9, 4, '.'), {}), TYPES_WITH_GATE)[0].reached).toMatchObject({ x: 6, y: 3, what: 'the refuge "refuge"' });
  });
  it('a muster marker on a blocked tile is refused, never read as a sealed (empty) flood', () => {
    // (3,4) is the yard's west wall, (3,2) the shut gate, (0,0) inside a placed structure: each a flood with no start.
    const m = (to: string, extra = {}) => crowd(to, extra);
    const markers = { apron: [1, 3], refuge: [6, 3], on_wall: [3, 4], on_gate: [3, 2], in_hut: [0, 0], off_map: [40, 3] };
    const map = { ...yard(SEALED), markers };
    expect(sealedCompoundFailures(m('on_wall'), map, TYPES_WITH_GATE, 'm')).toEqual([
      'm: withdraw_to "run" musters the crowd at "on_wall" (3, 4), which is off the map or on a blocked tile -- a ' +
        'muster marker stands on open ground, or nobody can say where the crowd ends up (GH-1438 E13 c)',
    ]);
    expect(sealedCompoundFailures(m('on_gate'), map, TYPES_WITH_GATE, 'm')).toHaveLength(1);
    expect(sealedCompoundFailures(m('off_map'), map, TYPES_WITH_GATE, 'm')).toHaveLength(1);
    const hut = m('in_hut', { structures: [{ type: 'house', at: [0, 0], size: [1, 1] }] });
    expect(sealedCompoundFailures(hut, map, TYPES_WITH_GATE, 'm')).toHaveLength(1);
    // The open apron beside them still passes.
    expect(sealedCompoundFailures(m('apron'), map, TYPES_WITH_GATE, 'm')).toEqual([]);
  });
  it('a boulder, ditch or marsh band is open on foot: a wall gap filled with b, d or ~ LEAKS', () => {
    // Civilians are on foot, and `b`, `d` and `~` stop only wheels and tracks (CLAUDE.md, "A map").
    for (const c of ['b', 'd', '~']) {
      const band = at(at(at(SEALED, 9, 2, c), 9, 3, c), 9, 4, c);
      expect(sealedCompoundFailures(crowd('apron'), yard(band), TYPES_WITH_GATE, 'm'), c).toHaveLength(1);
    }
  });
  it('a mission structures[] footprint blocks (at + size, default [2,2]), a placed gate included', () => {
    const open = at(at(SEALED, 3, 2, '.'), 3, 3, '.');
    const placed = crowd('apron', { structures: [{ type: 'compound_gate', at: [3, 2], size: [1, 2] }] });
    expect(sealedCompoundFailures(placed, yard(open), TYPES_WITH_GATE, 'm')).toEqual([]);
    const square = crowd('apron', { structures: [{ type: 'compound_gate', at: [2, 2] }] }); // 2x2 at (2,2): covers x 2..3
    expect(sealedCompoundFailures(square, yard(open), TYPES_WITH_GATE, 'm')).toEqual([]);
  });
  it('SCOPE: a mission with no gate has no compound to seal, so it is silent there, leak and all', () => {
    const gap = at(at(SEALED, 3, 2, '.'), 3, 3, '.');
    expect(musterReach(crowd('apron'), yard(gap), TYPES_WITH_GATE)[0].reached).not.toBeNull();
    expect(sealedCompoundFailures(crowd('apron'), yard(gap), TYPES_WITH_GATE, 'm')).toEqual([]);
    // Without the gate TYPE the `G` is not a gate: shipped data has no gate type, so a `G` there is just unknown.
    expect(sealedCompoundFailures(crowd('apron'), yard(at(SEALED, 9, 4, '.')), structureTypes, 'm')).toEqual([]);
  });
});

describe('the breach pilot shape (§11.1.2): marj_perimeter, the shipped breach, the pilot two gates and two musters', () => {
  const breach = JSON.parse(readFileSync(join(ROOT, 'data/missions/beit_sahwan_breach.json'), 'utf8'));
  const mapJson = JSON.parse(readFileSync(join(ROOT, 'data/maps/marj_perimeter.json'), 'utf8'));
  const map = { ...mapJson, markers: { ...mapJson.markers, gate_apron_w: [15, 22], gate_apron_e: [33, 24], in_yard: [20, 22] } };
  const WEST = { type: 'compound_gate', at: [17, 21], size: [1, 2] };
  const EAST = { type: 'compound_gate', at: [31, 24], size: [1, 2] };
  const pilot = (gates: unknown[], westTo = 'gate_apron_w') => ({
    ...breach,
    structures: [...breach.structures, ...gates],
    civilians: {
      ...breach.civilians,
      groups: [
        ...breach.civilians.groups,
        { unit: 'civilians', count: 3, at: [3.5, 20.5], group: 'road_w' },
        { unit: 'civilians', count: 3, at: [44.5, 20.5], group: 'road_e' },
      ],
    },
    triggers: [
      ...breach.triggers,
      { id: 'run_w', on: { kind: 'timer_s', value: 2 }, do: { kind: 'withdraw_to', group: 'road_w', to: westTo } },
      { id: 'run_e', on: { kind: 'timer_s', value: 2 }, do: { kind: 'withdraw_to', group: 'road_e', to: 'gate_apron_e' } },
    ],
  });
  it('the refuge is inside the compound zone and the zone inside the wall (the shape the rule protects)', () => {
    expect(breach.civilians.refuge).toBe('civ_refuge');
    expect(map.markers.civ_refuge).toEqual([24, 26]);
    expect(map.zones.compound).toEqual([18, 17, 13, 13]);
  });
  it('both gates shut: both musters pass rules (a) and (c)', () => {
    const m = pilot([WEST, EAST]);
    expect(musters(m, map.markers)).toHaveLength(2);
    expect(musterZoneFailures(m, map, 'b')).toEqual([]);
    expect(sealedCompoundFailures(m, map, TYPES_WITH_GATE, 'b')).toEqual([]);
  });
  it('the east gap left open (one gate placed): both crowds walk in round the wall, so (c) refuses both', () => {
    const out = sealedCompoundFailures(pilot([WEST]), map, TYPES_WITH_GATE, 'b');
    expect(out).toHaveLength(2);
    expect(out[0]).toContain('"gate_apron_w" (15, 22), and with every gate shut it can still walk to');
    expect(out[1]).toContain('"gate_apron_e" (33, 24), and with every gate shut it can still walk to');
  });
  it('the west muster moved inside the yard fails (a), and (c) with it', () => {
    const m = pilot([WEST, EAST], 'in_yard');
    expect(musterZoneFailures(m, map, 'b')).toHaveLength(1);
    expect(sealedCompoundFailures(m, map, TYPES_WITH_GATE, 'b')).toHaveLength(1);
  });
});

describe('every shipped mission', () => {
  const ids = Object.keys(missions);
  type MapJson = { markers?: Record<string, readonly number[]> };
  const mapOf = (id: string) => (maps as Record<string, MapJson>)[(missions as Record<string, { map: { file: string } }>)[id].map.file];

  it('walks all 40 missions and their 4 musters (Beit Sahwan IV), literals so a lost walk cannot pass', () => {
    expect(ids.length).toBe(40);
    expect(ids.reduce((n, id) => n + musters(missions[id as keyof typeof missions], mapOf(id)?.markers).length, 0)).toBe(4);
  });
  it.each(ids)('%s passes rules (a) and (c)', (id) => {
    const m = missions[id as keyof typeof missions];
    expect(musterZoneFailures(m, mapOf(id), id)).toEqual([]);
    expect(sealedCompoundFailures(m, mapOf(id), structureTypes, id)).toEqual([]);
  });
  it('Beit Sahwan IV: its four gate-less musters CAN walk to the collection point, so the gate scope is load-bearing', () => {
    const id = 'beit_sahwan_4_subterranean';
    const reach = musterReach(missions[id as keyof typeof missions], mapOf(id), structureTypes);
    expect(reach.map((r: { muster: { marker: string } }) => r.muster.marker)).toEqual([
      'civ_muster_yard', 'civ_muster_souk', 'civ_muster_market', 'civ_muster_clinic',
    ]);
    for (const r of reach) expect(r.reached?.what, r.muster.marker).toBe('evacuate_before "get_them_out"\'s zone "collection_point"');
  });
});
