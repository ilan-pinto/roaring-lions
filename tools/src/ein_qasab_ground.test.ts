// Ein Qasab I-III on their own ground (GH-912), as assertions: no authored order in the town points
// at ground its unit cannot reach. A wave whose route does not exist does not fail loudly, it
// parks at the map edge and the pressure curve the script measured never arrives; a patrol with a
// waypoint in the marsh stalls; a carrier whose refuge is unreachable never fires `evacuated`.
//
// Modelled on wadi_halam_ground.test.ts. Every route is walked through the real `FlowField` with the
// mask of the unit's own domain (`blocked` for a man on foot, `blockedVehicle` for anything wheeled),
// and the test is not vacuous: it counts what it walked, and a control closes one road to show the
// walk can fail.
import { describe, expect, it } from 'vitest';
import { applyTerrain, maps, missions, parseMap, structures as structureCatalogue, type MapJson } from '@lions/data';
import { DIR_DX, DIR_DY, DIR_NONE, FlowField } from '../../packages/sim/src/flowfield';
import { Sim } from '../../packages/sim/src/sim';

type Pt = readonly [number, number];
type Domain = 'foot' | 'vehicle';

interface Placement {
  unit: string;
  count?: number;
  at?: Pt;
  from?: string;
  marker?: string;
  stance?: { kind: string; waypoints?: Pt[] };
}
interface MissionShape {
  map: { file: string; player_start: Pt };
  civilians?: { refuge: string; groups: Placement[] };
  enemy?: { garrison?: Placement[]; waves?: { to: string; units: Placement[] }[] };
  triggers?: { id: string; do: { kind: string; group?: string; to?: string } }[];
}

const ALL = missions as unknown as Record<string, MissionShape>;
const MAPS = maps as unknown as Record<string, MapJson>;

/** The movement domain of a unit id in this town's rosters (data/units: militia_cell and rpg_team are men on
 *  foot, the swarm flies, civilians walk, everything else is wheeled). */
function domainOf(unit: string): Domain | 'air' {
  if (unit === 'drone_swarm') return 'air';
  return unit === 'militia_cell' || unit === 'rpg_team' || unit === 'civilians' ? 'foot' : 'vehicle';
}

function world(json: MapJson) {
  const map = parseMap(json);
  const sim = new Sim({ seed: 11, width: map.width, height: map.height, capacity: 16 });
  applyTerrain(map, sim);
  const idx = new Map<string, number>();
  for (const [id, spec] of Object.entries(structureCatalogue)) idx.set(id, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  for (const b of map.structures) sim.addStructure(idx.get(b.type) as number, b.tiles);
  return { map, sim };
}

/** True when the flow field for this domain carries `from` to `to`. */
function reaches(json: MapJson, domain: Domain, from: Pt, to: Pt): boolean {
  const { map, sim } = world(json);
  const field = new FlowField(map.width, map.height);
  field.compute(domain === 'foot' ? sim.blocked : sim.blockedVehicle, sim.elevation, to[0], to[1]);
  let [x, y] = from;
  for (let n = 0; n <= map.width * map.height; n++) {
    if (x === to[0] && y === to[1]) return true;
    const d = field.dirs[y * map.width + x];
    if (d === undefined || d === DIR_NONE) return false;
    x += DIR_DX[d] ?? 0;
    y += DIR_DY[d] ?? 0;
  }
  return false;
}

const tile = (p: Pt): Pt => [Math.floor(p[0]), Math.floor(p[1])];
const marker = (json: MapJson, name: string): Pt => {
  const m = json.markers?.[name];
  if (!m) throw new Error(`no marker ${name} on ${json.id}`);
  return [m[0], m[1]];
};

const TOWN = ['ein_qasab_1_recon', 'ein_qasab_2_foothold', 'ein_qasab_3_buildup'] as const;

describe('every ground wave in the town reaches the marker it is sent to', () => {
  let walked = 0;
  for (const id of TOWN) {
    const m = ALL[id];
    const json = MAPS[m.map.file];
    for (const w of m.enemy?.waves ?? []) {
      for (const u of w.units) {
        const dom = domainOf(u.unit);
        if (dom === 'air' || !u.from) continue;
        it(`${id}: ${u.unit} ${u.from} -> ${w.to} (${dom})`, () => {
          walked++;
          expect(reaches(json, dom, marker(json, u.from as string), marker(json, w.to))).toBe(true);
        });
      }
    }
  }
  it('walked a real number of routes (the loop above is not vacuous)', () => {
    // I: 5 waves, 6 unit groups; II: 6 ground groups + 1 swarm skipped; III: 6 waves, 7 unit groups. Tests register
    // before this one runs, in file order, so the count is complete here.
    expect(walked).toBeGreaterThanOrEqual(20);
  });
});

describe('the trigger runs, patrols and civilians go somewhere real', () => {
  it('I: the south-road wheels withdraw east along the causeway they came by, and the track patrol turns for the hamlet', () => {
    const json = MAPS.ein_qasab;
    expect(reaches(json, 'vehicle', marker(json, 'causeway_s'), marker(json, 'rif_se'))).toBe(true);
    expect(reaches(json, 'vehicle', [39, 14], marker(json, 'hamlet'))).toBe(true);
    // the patrol's own two waypoints are one road
    expect(reaches(json, 'vehicle', tile([39.5, 14.5]), tile([39.5, 32.5]))).toBe(true);
  });

  it('II: the gap rider patrols the north track through the dyke gap, and the saddle truck drives down to the farm', () => {
    const json = MAPS.jebel_matar;
    expect(reaches(json, 'vehicle', tile([30.5, 27.5]), tile([37.5, 35.5]))).toBe(true);
    expect(reaches(json, 'vehicle', tile([34.5, 11.5]), marker(json, 'farm'))).toBe(true);
  });

  it('III: the ferry runs for the north road, and the reserve comes down to the head', () => {
    const json = MAPS.ein_qasab_3;
    expect(reaches(json, 'vehicle', tile([25.5, 14.5]), marker(json, 'north_exit'))).toBe(true);
    expect(reaches(json, 'foot', tile([36.5, 3.5]), marker(json, 'causeway_head'))).toBe(true);
    expect(reaches(json, 'foot', tile([38.5, 3.5]), marker(json, 'causeway_head'))).toBe(true);
  });

  it('every civilian group can walk to its refuge', () => {
    let groups = 0;
    for (const id of TOWN) {
      const m = ALL[id];
      const json = MAPS[m.map.file];
      const refuge = marker(json, m.civilians?.refuge as string);
      for (const g of m.civilians?.groups ?? []) {
        const from = g.at ? tile(g.at) : marker(json, g.marker as string);
        groups++;
        expect(reaches(json, 'foot', from, refuge), `${id}: civilians at ${from} -> ${m.civilians?.refuge}`).toBe(true);
      }
    }
    expect(groups).toBe(7);
  });

  it('every wave marker, refuge marker and patrol waypoint stands on a tile the sim lets its unit stand on', () => {
    for (const id of TOWN) {
      const m = ALL[id];
      const json = MAPS[m.map.file];
      const { map, sim } = world(json);
      const names = new Set<string>([m.civilians?.refuge as string]);
      for (const w of m.enemy?.waves ?? []) {
        names.add(w.to);
        for (const u of w.units) if (u.from) names.add(u.from);
      }
      for (const n of names) {
        const [x, y] = marker(json, n);
        expect(sim.blocked[y * map.width + x], `${id}: marker ${n} (${x},${y}) is a wall`).toBe(0);
      }
      for (const g of m.enemy?.garrison ?? []) {
        for (const wp of g.stance?.waypoints ?? []) {
          const [x, y] = tile(wp);
          const mask = domainOf(g.unit) === 'foot' ? sim.blocked : sim.blockedVehicle;
          expect(mask[y * map.width + x], `${id}: ${g.unit} waypoint (${x},${y})`).toBe(0);
        }
      }
    }
  });
});

describe('the walk can fail (controls)', () => {
  it('II: with the dyke gap closed the east wave has no wheeled route to the farm', () => {
    const json = MAPS.jebel_matar;
    const closed: MapJson = { ...json, rows: json.rows.map((r, y) => (y === 35 ? r.slice(0, 37) + '^^' + r.slice(39) : r)) };
    expect(reaches(json, 'vehicle', marker(json, 'rif_e'), marker(json, 'farm'))).toBe(true);
    expect(reaches(closed, 'vehicle', marker(closed, 'rif_e'), marker(closed, 'farm'))).toBe(false);
  });
  it('III: the west island is a foot destination only: the same walk from the camp door fails for a wheel', () => {
    const json = MAPS.ein_qasab_3;
    expect(reaches(json, 'foot', marker(json, 'camp_door'), [4, 21])).toBe(true);
    expect(reaches(json, 'vehicle', marker(json, 'camp_door'), [4, 21])).toBe(false);
  });
});
