// The distinctness check (GH-382, docs/campaign/ground-ladder.md section 9): two missions of
// a campaign must not be played on the same ground.
//
// WHY FEATURE IDENTITY AND NOT RAW. Raw identity (the share of all 2,304 tiles that match,
// position for position) is dominated by open ground: `marj_perimeter` and `tutorial_ground`
// read 87% raw and nobody would call them the same map. Feature identity counts only the
// tiles where EITHER map is not open `.`, and puts the same pair at 16% or below. The
// highest figure between two maps of different towns on main is 16%; every repeated pair
// sat at 70% or above. 35% is twice the worst honest pair and half the best repeated one.
//
// ALL EIGHT ORIENTATIONS. A mirrored or rotated copy of a map reads 0% position for
// position, so each pair is compared under the 4 rotations x mirror and the MOST similar
// orientation is the one that counts.
//
// ELEVATION. Where both maps carry a grid, a pair whose grids sit within one level of each
// other on more than 80% of tiles, in ANY orientation, fails too: a flat copy of a relief map
// would otherwise read as different ground. Measured on main before this landed: the most
// alike elevation grids of two DIFFERENT towns are 67.8% (`qarn_hadid` / `umm_zeitoun_*`), so
// 80% separates nothing honest. A map with NO grid is flat by omission and is not compared.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = join(import.meta.dirname, '..', '..');
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

export const FEATURE_GATE = 0.35;
export const ELEVATION_WITHIN = 0.8;

export interface GridMap {
  id: string;
  width: number;
  height: number;
  rows: readonly string[];
  elevation?: readonly string[];
}

export interface CampaignMission {
  mission: string;
  town: string;
  map: string;
}

/** Every mission `world.json` lists, in campaign order, with the map file it plays on. */
export function campaignMissions(): CampaignMission[] {
  const world = read('data/campaign/world.json') as {
    regions: { towns: { id: string; missions: string[] }[] }[];
  };
  const out: CampaignMission[] = [];
  for (const r of world.regions)
    for (const t of r.towns)
      for (const m of t.missions) {
        const mi = read(`data/missions/${m}.json`) as { map: { file: string } };
        out.push({ mission: m, town: t.id, map: mi.map.file });
      }
  return out;
}

export function loadMap(id: string): GridMap {
  return read(`data/maps/${id}.json`) as GridMap;
}

type Grid = string[][];

/** The eight dihedral images of a rectangular grid. A 90 degree turn swaps width and height. */
export function orientations<T>(g: readonly (readonly T[])[]): T[][][] {
  const rot = (a: readonly (readonly T[])[]): T[][] => {
    const h = a.length;
    const w = a[0].length;
    const out: T[][] = [];
    for (let x = 0; x < w; x++) {
      const row: T[] = [];
      for (let y = h - 1; y >= 0; y--) row.push(a[y][x]);
      out.push(row);
    }
    return out;
  };
  const mirror = (a: readonly (readonly T[])[]): T[][] => a.map((r) => [...r].reverse());
  const out: T[][][] = [];
  let cur: T[][] = g.map((r) => [...r]);
  for (let i = 0; i < 4; i++) {
    out.push(cur);
    out.push(mirror(cur));
    cur = rot(cur);
  }
  return out;
}

const grid = (rows: readonly string[]): Grid => rows.map((r) => [...r]);

export interface Comparison {
  /** Share of tiles identical over tiles where either map is not open `.`, in the most similar orientation. */
  feature: number;
  /** Share of ALL tiles identical, in the same orientation (reported, never gated). */
  raw: number;
  /** Which of the eight orientations gave `feature` (0 = as authored). */
  orientation: number;
  /** Largest share of tiles within one level over all eight orientations, or null if either map has no grid. */
  elevationWithin: number | null;
}

export function compare(a: GridMap, b: GridMap): Comparison {
  const A = orientations(grid(a.rows));
  const B0 = grid(b.rows);
  const Ae = a.elevation ? orientations(grid(a.elevation)) : null;
  const be = b.elevation ? grid(b.elevation) : null;
  let best: Comparison = { feature: -1, raw: 0, orientation: -1, elevationWithin: null };
  let bestWithin: number | null = null;
  for (let o = 0; o < A.length; o++) {
    const ga = A[o];
    if (ga.length !== B0.length || ga[0].length !== B0[0].length) continue;
    let same = 0;
    let feat = 0;
    let featSame = 0;
    for (let y = 0; y < ga.length; y++)
      for (let x = 0; x < ga[0].length; x++) {
        const p = ga[y][x];
        const q = B0[y][x];
        if (p === q) same++;
        if (p !== '.' || q !== '.') {
          feat++;
          if (p === q) featSame++;
        }
      }
    const feature = feat === 0 ? 1 : featSame / feat;
    let within: number | null = null;
    if (Ae && be) {
      let ok = 0;
      for (let y = 0; y < ga.length; y++)
        for (let x = 0; x < ga[0].length; x++)
          if (Math.abs(Number(Ae[o][y][x]) - Number(be[y][x])) <= 1) ok++;
      within = ok / (ga.length * ga[0].length);
    }
    if (within !== null) bestWithin = Math.max(bestWithin ?? 0, within);
    if (feature > best.feature) {
      best = { feature, raw: same / (ga.length * ga[0].length), orientation: o, elevationWithin: null };
    }
  }
  if (best.orientation < 0) return { feature: 0, raw: 0, orientation: -1, elevationWithin: null };
  return { ...best, elevationWithin: bestWithin };
}

export function tooAlike(c: Comparison): boolean {
  if (c.feature > FEATURE_GATE) return true;
  return c.elevationWithin !== null && c.elevationWithin > ELEVATION_WITHIN;
}

export interface PairRow {
  a: CampaignMission;
  b: CampaignMission;
  cmp: Comparison;
  fails: boolean;
}

/** Every pair of distinct missions (a mission pair on one shared file compares a map with itself: 100%). */
export function allPairs(missions: readonly CampaignMission[], load: (id: string) => GridMap = loadMap): PairRow[] {
  const cache = new Map<string, GridMap>();
  const get = (id: string): GridMap => {
    let m = cache.get(id);
    if (!m) cache.set(id, (m = load(id)));
    return m;
  };
  const rows: PairRow[] = [];
  for (let i = 0; i < missions.length; i++)
    for (let j = i + 1; j < missions.length; j++) {
      const cmp = compare(get(missions[i].map), get(missions[j].map));
      rows.push({ a: missions[i], b: missions[j], cmp, fails: tooAlike(cmp) });
    }
  return rows;
}

/**
 * Arcs not yet rebuilt under GH-382. A pair is excused ONLY when BOTH missions belong to the
 * same pending town, which is where the repeats are; a pair across towns is never excused, so
 * a new map that copies another town's ground still goes red. Delete an entry when its arc
 * lands; the spec then holds every pair in that town to the gate. When the list is empty the
 * check is a gate on the whole campaign.
 */
export const PENDING_ARCS: readonly { town: string; todo: string }[] = [
  { town: 'beit_sahwan', todo: 'TODO(#382): Beit Sahwan arc not yet rebuilt onto new ground' },
  { town: 'khan_rafid', todo: 'TODO(#382): Khan Rafid arc not yet rebuilt onto new ground' },
  { town: 'deir_amun', todo: 'TODO(#382): Deir Amun arc not yet rebuilt onto new ground' },
  { town: 'tel_marum', todo: 'TODO(#382): Tel Marum arc not yet rebuilt onto new ground' },
  { town: 'qarn_hadid', todo: 'TODO(#382): Qarn Hadid arc not yet rebuilt onto new ground' },
  { town: 'umm_zeitoun', todo: 'TODO(#382): Umm Zeitoun arc not yet rebuilt onto new ground' },
];

export function excused(r: PairRow, pending: readonly { town: string }[] = PENDING_ARCS): boolean {
  return r.a.town === r.b.town && pending.some((p) => p.town === r.a.town);
}

export function report(rows: readonly PairRow[], pending: readonly { town: string }[] = PENDING_ARCS): string {
  const lines: string[] = [];
  for (const r of rows.filter((x) => x.fails)) {
    const tag = excused(r, pending) ? 'pending' : 'FAIL   ';
    lines.push(
      `${tag} ${r.a.mission} (${r.a.map}) ~ ${r.b.mission} (${r.b.map}): feature ${(r.cmp.feature * 100).toFixed(0)}% ` +
        `raw ${(r.cmp.raw * 100).toFixed(0)}% orientation ${r.cmp.orientation}` +
        (r.cmp.elevationWithin !== null ? ` elev-within-1 ${(r.cmp.elevationWithin * 100).toFixed(0)}%` : '')
    );
  }
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').slice(-1)[0])) {
  const rows = allPairs(campaignMissions());
  const worst = [...rows].sort((x, y) => y.cmp.feature - x.cmp.feature);
  console.log(report(rows) || '(no pair over the gate)');
  const cross = worst.filter((r) => r.a.town !== r.b.town).slice(0, 8);
  console.log('\nhighest feature identity between DIFFERENT towns:');
  for (const r of cross)
    console.log(
      `  ${(r.cmp.feature * 100).toFixed(0)}% (elev ${r.cmp.elevationWithin === null ? '-' : (r.cmp.elevationWithin * 100).toFixed(0) + '%'}) ${r.a.map} ~ ${r.b.map}`
    );
}
