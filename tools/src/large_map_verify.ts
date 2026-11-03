// The generic large-map verifier (GH-920 B2): what a large versus map must prove before it is
// registered, read from the SHIPPED JSON through the real loader, the real `FlowField` and the real
// `versusSpawns`, never from the generator that wrote it. It is rujm_sawda_verify.ts (GH-913 L4) with
// the map's own facts lifted into a `LargeMapSpec`, plus the design's census (design 2.2): a naive 2x
// upscale distorts buildings, walls, roads, contours and markers, and each distortion has a check.
//
//   cd tools && ./node_modules/.bin/tsx src/large_map_verify.ts <map id>   prints the report, exits 1 on any failure
//   (run from tools/: from the repo root it exits non-zero with no output)
//
// What it checks:
//   1. shape: the spec's side, one elevation digit per tile;
//   2. the half-turn (x, y) -> (size - 1 - x, size - 1 - y): every tile, every elevation digit, every
//      marker and zone (bar a named centre), every building, both camps, both tunnel sets, and the
//      income of each zone against its twin's; the seats on the main diagonal (the anti-diagonal for a spec that
//      says so);
//      An ASYMMETRIC spec (`asymmetric: true`, Tel Marum (large)) skips all of 2 bar the markers' bounds and the seat markers'
//      existence, reads no seat diagonal, and in 3 and 5 asks for finite costs (reported both ways) and for the real placer's
//      moves to equal the spec's `displaced` literals and land on ground open to wheels and off the camps;
//   3. seat-to-seat flow cost, both ways, on foot and on wheels, equal and finite;
//   4. (optional) a cut: with every named crossing plugged no vehicle crosses, and each crossing alone
//      carries one;
//   5. spawns clean in all three pairings (KDF/KDF, KDF/Sarim, Sarim/KDF): every formation tile of
//      both seats on the map and open to wheels, the real placer lands every unit on its tile, and
//      the same-faction pairing is an exact mirror; no camp under a unit;
//   6. markers on ground nothing blocks;
//   7. built share at most 1%;
//   8. THE CENSUS, each a distortion of a naive 2x upscale:
//      - no building larger than its type's native footprint (a 2x2 house drawn 4x4);
//      - no wall or ditch two tiles thick (a 2x2 block of either);
//      - no road drawn as a 2x2 block or as an orthogonal staircase (two bend tiles side by side);
//      - no 2x2 diagonal step in the relief (three 2-tall transitions in a row, each two columns on:
//        the construction that scallops a contour on the drawn ground; relief_census.ts). The contour
//        wander on the drawn ground is a REPORTED fact, not a gate;
//      - (via 2) a marker at 2x on both halves is not its twin's half-turn image;
//   9. the rules file, by the data gate's own function, and the economy the spec names.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyTerrain, doctrines, maps, parseMap, structures, units, versusRules, type MapJson, type VersusRulesJson } from '@lions/data';
import type { Faction } from '@lions/net';
import { FlowField } from '../../packages/sim/src/flowfield';
import { Sim } from '../../packages/sim/src/sim';
import { builtShare } from '../../packages/app/src/ambience';
import { standMapStructures } from '../../packages/app/src/map-sim';
import { sandboxAnchors } from '../../packages/app/src/sandbox-anchors';
import { versusForceOf, versusSpawns } from '../../packages/app/src/net/versus-force';
import { versusRulesFailures } from '../validate_versus_rules.mjs';
import { contourWander, fatStairs } from './relief_census';
import { measureVersus, type VersusVisibilitySpec } from './map_visibility';
import { PASSES, billOf, centreBill, densestWindow, meshesOf, msOf } from './map_triangles';

/**
 * The built-share cap of a spec that does not name its own. It was the one global cap (1%), an upscale-fidelity check: a
 * naive 2x copy draws every building four times its footprint, so the share quadruples. GH-974 replaced it with a cap PER
 * MAP (`LargeMapSpec.maxBuiltShare`, required): a map with a town of its own (Milh Flats, large) has a share the upscale
 * never made, and the versus visibility gate (`VERSUS_CAPS`, 3%) holds a town to what the eye can see.
 */
export const MAX_BUILT_SHARE = 0.01;
/** How far round a crossing's marker the plug reaches by default, in tiles (Chebyshev). */
export const DEFAULT_PLUG_RADIUS = 4;
/** A cost at or above this is the field's own "unreachable". */
const FAR = 1_000_000;
const PAIRINGS: readonly (readonly [Faction, Faction])[] = [['kdf', 'kdf'], ['kdf', 'sarim'], ['sarim', 'kdf']];

/**
 * The most tiles one building of a type has on any shipped 48x48 map (a census of data/maps, 2 Nov
 * 2026: house 12, shanty 16, apartment 20, warehouse 28, concrete 9, hall 9, clinic 16, pump_house 4,
 * relay 2). A building of a 2x2 house drawn at 4x is 16 tiles and is over the house's 12. The ceiling is
 * the generic floor; a spec with a `reference` map holds the shapes to that map's exactly.
 */
export const NATIVE_MAX_TILES: Readonly<Record<string, number>> = {
  house: 12, shanty: 16, apartment: 20, warehouse: 28, concrete: 9, hall: 9, clinic: 16, pump_house: 4, relay: 2,
};

export type Crossing = { name: string; marker: string; radius?: number } | { name: string; zone: string };

export interface LargeMapSpec {
  /** The map's side in tiles. */
  size: number;
  /** The crossings of the cut, if the map has one. Absent: the cut is not checked. */
  crossings?: readonly Crossing[];
  /** The economy: how many income zones and what they pay a minute in all. */
  income: { zones: number; perMin: number };
  /** The routes an end has, per rules file. */
  routesPerEnd: number;
  /** The 48x48 map this one is the twin of: its building shapes are the large map's, exactly. */
  reference?: MapJson;
  /**
   * The most the buildings may cover, as a share of the map (`builtShare`, the share the ambience bed reads). Required
   * since GH-974: the cap is the map's own, written next to the numbers it was read on.
   */
  maxBuiltShare: number;
  /**
   * The versus visibility gate (map_visibility.ts `measureVersus`), REQUIRED: either the town zones it holds, or an explicit
   * exemption with its reason. A spec that names neither is red (`verifyVersusVisibility`), so a new map cannot skip the gate
   * by forgetting a field; the exempt set is pinned over `Object.keys(SPECS)` in large_map_verify.test.ts.
   */
  visibility: { towns: readonly string[] } | { exempt: string };
  /**
   * The structure-triangle bill (map_triangles.ts), if the map is held to one (GH-974): PR 1001 found that the cost of a town is
   * triangles, and a map drawn to a plan counts them as it places. In the centre `window` of tiles and in the densest `window`
   * anywhere, the structures (walls, buildings, ditch segments) draw at most as many triangles in one pass as the whole of the
   * `control` map, the 48x48 the render budget (+0.5 ms) is read against. Absent: not checked.
   */
  triangles?: { window: number; control: string };
  /** The share of tiles that are cover (`1 2 3 o n`), as [lowest, highest], if the map keeps a band. */
  coverShare?: readonly [number, number];
  /** How many 2x2 diagonal steps the relief may have; none when absent. */
  maxFatStairs?: number;
  /** The seats stand on the anti-diagonal (x + y = size - 1) rather than the main one (x = y): Milh Flats'. */
  antiDiagonal?: boolean;
  /** Markers that may stand without a twin tile (a named centre on the seam), none when absent. */
  lone?: readonly string[];
  /**
   * The map is NOT point-symmetric (Tel Marum (large), GH-920 B3: a campaign valley played from two measured seats). The
   * half-turn checks (tiles, elevation, markers, zones, structures, camps, routes, income pairs), the seat diagonal and the
   * equal flow cost both ways are skipped; what stays is everything about a single side of the map. The spawn check reads the
   * real placer instead of the formation tiles (a seat's formation may overlap rock: the placer moves the unit to the nearest
   * open tile, as the original does), and `displaced` pins how many units it moves, per pairing, as a literal.
   */
  asymmetric?: boolean;
  /** With `asymmetric`: the units the real placer moves off their formation tile, per pairing "f0/f1" (a literal, from an independent count). */
  displaced?: Readonly<Record<string, number>>;
  /** A name the report prints. */
  label?: string;
}

type Pt = readonly [number, number];

export interface Report {
  failures: string[];
  facts: Record<string, string | number>;
}

function world(json: MapJson) {
  const map = parseMap(json);
  const sim = new Sim({ seed: 20261101, width: map.width, height: map.height, capacity: 256 });
  applyTerrain(map, sim);
  standMapStructures(sim, map);
  const typeOf = new Map<string, number>();
  for (const [uid, u] of Object.entries(units)) typeOf.set(uid, sim.addUnitType(u as never));
  return { map, sim, typeOf };
}

/** Building shapes by type: "WxH" strings of every non-per-tile structure, sorted. */
function buildingShapes(json: MapJson): Record<string, string[]> {
  const map = parseMap(json);
  const spec = structures as Record<string, { per_tile?: boolean } | undefined>;
  const out: Record<string, string[]> = {};
  for (const s of map.structures) {
    if (spec[s.type]?.per_tile) continue;
    const xs = s.tiles.map((t) => t % json.width);
    const ys = s.tiles.map((t) => Math.floor(t / json.width));
    const w = Math.max(...xs) - Math.min(...xs) + 1;
    const h = Math.max(...ys) - Math.min(...ys) + 1;
    (out[s.type] ??= []).push(`${w}x${h}:${s.tiles.length}`);
  }
  for (const k of Object.keys(out)) out[k].sort();
  return out;
}

export function verifyLargeMap(json: MapJson, rules: VersusRulesJson, spec: LargeMapSpec): Report {
  const failures: string[] = [];
  const facts: Record<string, string | number> = {};
  const fail = (s: string) => failures.push(s);
  const W = json.width;
  const H = json.height;
  const SIZE = spec.size;

  // 1. shape
  if (W !== SIZE || H !== SIZE) fail(`shape: ${W}x${H}, not ${SIZE}x${SIZE}`);
  if (json.rows.length !== H || json.rows.some((r) => r.length !== W)) fail('shape: rows are not height x width');
  const elev = json.elevation ?? [];
  if (elev.length !== H || elev.some((r) => r.length !== W)) fail('shape: elevation is not height x width');
  if (failures.length > 0) return { failures, facts };

  const mirror = (p: readonly number[]): Pt => [W - 1 - p[0], H - 1 - p[1]];
  const markers = json.markers as Record<string, readonly number[]>;
  const zones = (json.zones ?? {}) as Record<string, readonly number[]>;
  const { map, sim } = world(json);

  // 2. the half-turn (skipped, bar the seat markers' existence and the markers' bounds, for an asymmetric map)
  const sym = !spec.asymmetric;
  const tileOff: string[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (json.rows[y][x] !== json.rows[H - 1 - y][W - 1 - x]) tileOff.push(`row ${x},${y}`);
      if (elev[y][x] !== elev[H - 1 - y][W - 1 - x]) tileOff.push(`elevation ${x},${y}`);
    }
  }
  if (sym && tileOff.length > 0) fail(`symmetry: ${tileOff.length} tiles are not their half-turn twin, first ${tileOff.slice(0, 6).join('; ')}`);
  facts.asymmetric_tiles = tileOff.length;

  // a map with no seat marker has nothing else to read (every later check starts from the two seats)
  if (!markers.versus_0 || !markers.versus_1) {
    fail('symmetry: a seat marker is missing');
    return { failures, facts };
  } else if (sym && mirror(markers.versus_0).join() !== markers.versus_1.join()) fail(`symmetry: versus_1 ${markers.versus_1} is not versus_0 ${markers.versus_0} mirrored`);
  for (const seat of ['versus_0', 'versus_1'] as const) {
    const p = markers[seat];
    if (!sym) break;
    if (p && !spec.antiDiagonal && p[0] !== p[1]) fail(`seats: ${seat} (${p}) is not on the main diagonal (x == y)`);
    if (p && spec.antiDiagonal && p[0] + p[1] !== SIZE - 1) fail(`seats: ${seat} (${p}) is not on the anti-diagonal (x + y == ${SIZE - 1})`);
  }
  const markerAt = new Map(Object.entries(markers).map(([n, p]) => [p.join(','), n]));
  if (sym) {
    const lonely = Object.entries(markers).filter(([, p]) => !markerAt.has(mirror(p).join(','))).map(([n]) => n).sort();
    if (lonely.join() !== [...(spec.lone ?? [])].sort().join()) {
      fail(`symmetry: markers with no twin tile: ${lonely.join(', ') || '(none)'}; ${spec.lone?.length ? `only ${spec.lone.join(', ')} may be alone` : 'every marker needs one'}`);
    }
    for (const [n, p] of Object.entries(markers)) {
      if (!n.endsWith('_0')) continue;
      const twin = markerAt.get(mirror(p).join(','));
      if (twin === undefined || !twin.endsWith('_1')) fail(`symmetry: ${n}'s twin tile holds ${twin ?? 'no marker'}, not a _1 marker`);
    }
  }
  const zoneAt = new Map(Object.entries(zones).map(([n, r]) => [r.join(','), n]));
  if (sym) {
    for (const [n, [x, y, w, h]] of Object.entries(zones)) {
      const twin = zoneAt.get([W - x - w, H - y - h, w, h].join(','));
      if (twin === undefined) fail(`symmetry: zone ${n} has no mirrored zone`);
      else if (n.endsWith('_0') && !twin.endsWith('_1')) fail(`symmetry: zone ${n}'s twin is ${twin}, not a _1 zone`);
    }
  }
  for (const [n, p] of Object.entries(markers)) {
    if (p[0] < 0 || p[1] < 0 || p[0] >= W || p[1] >= H) fail(`markers: ${n} (${p}) is off the map`);
    else if (sim.blocked[p[1] * W + p[0]] !== 0) fail(`markers: ${n} (${p}) is on ${json.rows[p[1]][p[0]]}, ground nothing can stand on`);
  }

  const structKey = (type: string, tiles: readonly number[]) => `${type}:${[...tiles].sort((a, b) => a - b).join(' ')}`;
  const have = new Set(map.structures.map((s) => structKey(s.type, s.tiles)));
  for (const s of map.structures) {
    if (sym && !have.has(structKey(s.type, s.tiles.map((t) => W * H - 1 - t)))) fail(`symmetry: ${s.type} at tile ${s.tiles[0]} has no mirrored twin`);
  }

  const camps = rules.ends;
  const campTiles = (c: { at: readonly number[]; size: readonly number[] }) => {
    const out: string[] = [];
    for (let y = c.at[1]; y < c.at[1] + c.size[1]; y++) for (let x = c.at[0]; x < c.at[0] + c.size[0]; x++) out.push(mirror([x, y]).join(','));
    return out.sort();
  };
  const hostileCamp: string[] = [];
  for (let y = camps.hostile.camp.at[1]; y < camps.hostile.camp.at[1] + camps.hostile.camp.size[1]; y++) {
    for (let x = camps.hostile.camp.at[0]; x < camps.hostile.camp.at[0] + camps.hostile.camp.size[0]; x++) hostileCamp.push(`${x},${y}`);
  }
  if (sym && campTiles(camps.friendly.camp).join(';') !== hostileCamp.sort().join(';')) fail('symmetry: the hostile camp is not the friendly camp mirrored');

  const routes = { friendly: rules.tunnels?.friendly ?? [], hostile: rules.tunnels?.hostile ?? [] };
  if (routes.friendly.length !== spec.routesPerEnd || routes.hostile.length !== spec.routesPerEnd) {
    fail(`economy: tunnel routes per end are ${routes.friendly.length} and ${routes.hostile.length}, not ${spec.routesPerEnd} and ${spec.routesPerEnd}`);
  }
  routes.friendly.forEach((r, i) => {
    const t = routes.hostile[i];
    if (!t || !sym) return;
    if (r.points.map((p) => mirror(p).join(',')).join(';') !== t.points.map((p) => p.join(',')).join(';') || r.capacity !== t.capacity) {
      fail(`symmetry: hostile route ${t.id} is not friendly route ${r.id} mirrored (points and capacity)`);
    }
  });

  const rate = new Map(rules.income_zones.map((z) => [z.zone, z.rate_per_min]));
  const total = rules.income_zones.reduce((a, z) => a + z.rate_per_min, 0);
  facts.income_zones = rules.income_zones.length;
  facts.income_per_min = total;
  if (rules.income_zones.length !== spec.income.zones) fail(`economy: ${rules.income_zones.length} income zones, not ${spec.income.zones}`);
  if (total !== spec.income.perMin) fail(`economy: income is ${total} a minute, not ${spec.income.perMin}`);
  for (const z of rules.income_zones) {
    const r = zones[z.zone];
    if (!r) continue;
    const twin = sym ? zoneAt.get([W - r[0] - r[2], H - r[1] - r[3], r[2], r[3]].join(',')) : undefined;
    if (twin !== undefined && rate.get(twin) !== z.rate_per_min) fail(`economy: ${z.zone} pays ${z.rate_per_min} and its twin ${twin} pays ${rate.get(twin)}`);
  }

  // 3. seat to seat, both ways, on foot and on wheels
  const seat0 = markers.versus_0 as Pt;
  const seat1 = markers.versus_1 as Pt;
  const cost = (mask: Uint8Array, from: readonly number[], to: readonly number[]) => {
    const f = new FlowField(W, H);
    f.compute(mask, sim.elevation, to[0], to[1]);
    return f.costAt(from[1] * W + from[0]);
  };
  for (const [domain, mask] of [['foot', sim.blocked], ['wheels', sim.blockedVehicle]] as const) {
    const there = cost(mask, seat0, seat1);
    const back = cost(mask, seat1, seat0);
    facts[`${domain}_seat_to_seat`] = there;
    if (!sym) facts[`${domain}_seat_to_seat_back`] = back;
    if (sym && there !== back) fail(`flow: ${domain} seat 0 to seat 1 costs ${there} and back costs ${back}`);
    if (!(there > 0 && there < FAR)) fail(`flow: ${domain} seat 0 to seat 1 is ${there}, not a finite route`);
  }
  facts.seat_distance = Number(Math.hypot(seat1[0] - seat0[0], seat1[1] - seat0[1]).toFixed(1));

  // 4. the cut: every crossing plugged and opened
  if (spec.crossings) {
    const box = (m: readonly number[], r: number) => {
      const out: number[] = [];
      for (let y = m[1] - r; y <= m[1] + r; y++) for (let x = m[0] - r; x <= m[0] + r; x++) if (x >= 0 && y >= 0 && x < W && y < H) out.push(y * W + x);
      return out;
    };
    const rect = (r: readonly number[]) => {
      const out: number[] = [];
      for (let y = r[1]; y < r[1] + r[3]; y++) for (let x = r[0]; x < r[0] + r[2]; x++) out.push(y * W + x);
      return out;
    };
    const crossings: Record<string, number[]> = {};
    for (const c of spec.crossings) {
      if ('marker' in c) {
        if (!markers[c.marker]) fail(`cut: marker ${c.marker} is missing`);
        else crossings[c.name] = box(markers[c.marker], c.radius ?? DEFAULT_PLUG_RADIUS);
      } else if (!zones[c.zone]) fail(`cut: zone ${c.zone} is missing`);
      else crossings[c.name] = rect(zones[c.zone]);
    }
    const wheelsWith = (open: readonly string[]) => {
      const mask = new Uint8Array(sim.blockedVehicle);
      for (const [name, tiles] of Object.entries(crossings)) if (!open.includes(name)) for (const t of tiles) mask[t] = 1;
      return mask;
    };
    if (Object.keys(crossings).length === spec.crossings.length) {
      const sealed = cost(wheelsWith([]), seat0, seat1);
      facts.wheels_all_plugged = sealed >= FAR ? 'no route' : sealed;
      if (sealed < FAR) fail(`cut: with every crossing plugged a vehicle still crosses (cost ${sealed}): the wadi leaks`);
      for (const name of Object.keys(crossings)) {
        const there = cost(wheelsWith([name]), seat0, seat1);
        const back = cost(wheelsWith([name]), seat1, seat0);
        facts[`wheels_via_${name}_only`] = there >= FAR ? 'no route' : there;
        if (there >= FAR) fail(`cut: ${name} alone does not carry a vehicle from seat 0 to seat 1`);
        if (back >= FAR) fail(`cut: ${name} alone does not carry a vehicle from seat 1 to seat 0`);
        if (sym && there < FAR && back < FAR && there !== back) fail(`cut: ${name} alone costs ${there} one way and ${back} the other`);
      }
    }
  }

  // 5. spawns, in all three pairings
  const anchors = sandboxAnchors(json);
  if (anchors.friendly.join() !== seat0.join() || anchors.hostile.join() !== seat1.join()) {
    fail(`spawns: sandboxAnchors reads ${anchors.friendly} / ${anchors.hostile}, not versus_0 ${seat0} / versus_1 ${seat1}`);
  }
  for (const [end, [ax, ay]] of [['friendly', seat0], ['hostile', seat1]] as const) {
    if (sim.blockedVehicle[ay * W + ax] !== 0) fail(`spawns: the ${end} seat (${ax},${ay}) is not open to wheels`);
  }
  const campTilesOf = new Set<string>();
  for (const end of ['friendly', 'hostile'] as const) {
    const c = rules.ends[end].camp;
    for (let y = c.at[1]; y < c.at[1] + c.size[1]; y++) for (let x = c.at[0]; x < c.at[0] + c.size[0]; x++) campTilesOf.add(`${x},${y}`);
  }
  for (const [f0, f1] of sym ? PAIRINGS : []) {
    for (const [side, faction] of [[0, f0], [1, f1]] as const) {
      const [ax, ay] = side === 0 ? seat0 : seat1;
      const sgn = side === 0 ? 1 : -1;
      for (const [uid, dx, dy] of versusForceOf(faction)) {
        const x = ax + sgn * dx;
        const y = ay + sgn * dy;
        const where = `${f0}/${f1} side ${side} ${uid} at (${x},${y})`;
        if (campTilesOf.has(`${x},${y}`)) fail(`spawns: ${where} is on a camp tile`);
        if (x < 0 || y < 0 || x >= W || y >= H) fail(`spawns: ${where} is off the map`);
        else if (sim.blockedVehicle[y * W + x] !== 0) fail(`spawns: ${where} is on ${json.rows[y][x]}, closed to wheels`);
      }
    }
  }
  for (const [f0, f1] of PAIRINGS) {
    // The real placer, on a fresh world per pairing: every unit lands on its formation tile.
    const w = world(json);
    const force = versusSpawns(w.sim, w.typeOf, anchors, [f0, f1]);
    const tileOf = (e: number): Pt => [w.sim.state.posX[e] / 65536 - 0.5, w.sim.state.posY[e] / 65536 - 0.5];
    let moved = 0;
    for (const side of [0, 1] as const) {
      const [ax, ay] = side === 0 ? seat0 : seat1;
      const sgn = side === 0 ? 1 : -1;
      versusForceOf(side === 0 ? f0 : f1).forEach(([, dx, dy], i) => {
        const got = tileOf(force.bySide[side][i]);
        if (got[0] !== ax + sgn * dx || got[1] !== ay + sgn * dy) moved++;
      });
    }
    if (sym && moved > 0) fail(`spawns: ${f0}/${f1}: ${moved} units were not placed on their formation tile`);
    if (!sym) {
      // An asymmetric map's formation may overlap rock; the placer moves the unit to the nearest open tile. The count it moves is
      // pinned (spec.displaced, a literal), and every unit must land on ground open to wheels and off the camps.
      facts[`displaced_${f0}_${f1}`] = moved;
      const want = spec.displaced?.[`${f0}/${f1}`];
      if (want === undefined) fail(`spawns: ${f0}/${f1}: the spec pins no displaced count (the placer moved ${moved})`);
      else if (moved !== want) fail(`spawns: ${f0}/${f1}: the placer moved ${moved} units off their formation tile, the spec says ${want}`);
      for (const side of [0, 1] as const) {
        force.bySide[side].forEach((e, i) => {
          const [x, y] = tileOf(e);
          if (sim.blockedVehicle[y * W + x] !== 0) fail(`spawns: ${f0}/${f1} side ${side} unit #${i} landed on ${json.rows[y][x]} at (${x},${y}), closed to wheels`);
          if (campTilesOf.has(`${x},${y}`)) fail(`spawns: ${f0}/${f1} side ${side} unit #${i} landed on a camp tile (${x},${y})`);
        });
      }
    }
    if (sym && f0 === f1) {
      force.bySide[0].forEach((e, i) => {
        const m = mirror(tileOf(e));
        const o = tileOf(force.bySide[1][i]);
        if (m[0] !== o[0] || m[1] !== o[1]) fail(`spawns: ${f0}/${f1}: unit #${i} is not its twin mirrored`);
      });
    }
  }

  // 7. built share
  const parsedShare = builtShare(map);
  facts.built_share = Number(parsedShare.toFixed(5));
  if (parsedShare > spec.maxBuiltShare) fail(`buildings: built share ${(parsedShare * 100).toFixed(2)}% is over ${spec.maxBuiltShare * 100}%`);
  const sdata = structures as Record<string, { low_profile?: boolean } | undefined>;
  if (sdata.wall?.low_profile !== true) fail('buildings: the wall type is not low-profile, so it would block sight');

  // 7b. the structure-triangle bill
  if (spec.triangles) {
    const meshes = meshesOf(json, map);
    const control = billOf(meshesOf(maps[spec.triangles.control as keyof typeof maps] as unknown as MapJson));
    const edge = Math.min(spec.triangles.window, W);
    const centre = centreBill(meshes, W, edge);
    const dense = densestWindow(meshes, W, edge);
    const whole = billOf(meshes);
    facts.triangles_control_per_pass = control.perPass;
    facts.triangles_whole_per_pass = whole.perPass;
    facts.triangles_centre_per_pass = centre.perPass;
    facts.triangles_densest_per_pass = dense.bill.perPass;
    facts.triangles_densest_at = `${dense.x0},${dense.y0}`;
    facts.triangles_centre_vs_control_ms = Number(msOf(PASSES * (centre.perPass - control.perPass)).toFixed(2));
    facts.triangles_densest_vs_control_ms = Number(msOf(PASSES * (dense.bill.perPass - control.perPass)).toFixed(2));
    if (centre.perPass > control.perPass) fail(`triangles: the centre ${edge}x${edge} draws ${centre.perPass} structure triangles a pass, over the ${spec.triangles.control} control's ${control.perPass}`);
    if (dense.bill.perPass > control.perPass) fail(`triangles: the densest ${edge}x${edge} (at ${dense.x0},${dense.y0}) draws ${dense.bill.perPass} structure triangles a pass, over the ${spec.triangles.control} control's ${control.perPass}`);
  }

  // 8. the census
  const shapes = buildingShapes(json);
  const over: string[] = [];
  for (const [type, list] of Object.entries(shapes)) {
    const ceiling = NATIVE_MAX_TILES[type];
    for (const s of list) {
      const tiles = Number(s.split(':')[1]);
      if (ceiling !== undefined && tiles > ceiling) over.push(`${type} ${s}`);
    }
  }
  if (over.length > 0) fail(`census: ${over.length} building(s) over their type's native footprint, first ${over.slice(0, 4).join('; ')}`);
  facts.buildings = Object.values(shapes).reduce((a, l) => a + l.length, 0);
  if (spec.reference) {
    const ref = buildingShapes(spec.reference);
    const types = new Set([...Object.keys(ref), ...Object.keys(shapes)]);
    for (const type of [...types].sort()) {
      const a = (ref[type] ?? []).join(' ');
      const b = (shapes[type] ?? []).join(' ');
      if (a !== b) fail(`census: ${type} shapes are [${b}] on this map and [${a}] on ${spec.reference.id}, whose footprints are the native ones`);
    }
  }
  const at = (x: number, y: number, c: string) => x >= 0 && y >= 0 && x < W && y < H && json.rows[y][x] === c;
  const thick: Record<string, string[]> = { '=': [], d: [], r: [] };
  const bends: string[] = [];
  const isBend = (x: number, y: number) => (at(x - 1, y, 'r') || at(x + 1, y, 'r')) && (at(x, y - 1, 'r') || at(x, y + 1, 'r'));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (const c of ['=', 'd', 'r']) {
        if (at(x, y, c) && at(x + 1, y, c) && at(x, y + 1, c) && at(x + 1, y + 1, c)) thick[c].push(`${x},${y}`);
      }
      if (at(x, y, 'r') && isBend(x, y)) {
        if (isBend(x + 1, y) && at(x + 1, y, 'r')) bends.push(`${x},${y}`);
        if (isBend(x, y + 1) && at(x, y + 1, 'r')) bends.push(`${x},${y}`);
      }
    }
  }
  facts.thick_wall_blocks = thick['='].length;
  facts.thick_ditch_blocks = thick.d.length;
  facts.road_blocks = thick.r.length;
  facts.road_stairs = bends.length;
  if (thick['='].length > 0) fail(`census: ${thick['='].length} 2x2 block(s) of wall, a wall two tiles thick, first at ${thick['='][0]}`);
  if (thick.d.length > 0) fail(`census: ${thick.d.length} 2x2 block(s) of ditch, a ditch two tiles thick, first at ${thick.d[0]}`);
  if (thick.r.length > 0) fail(`census: ${thick.r.length} 2x2 block(s) of road, a staircase road, first at ${thick.r[0]}`);
  if (bends.length > 0) fail(`census: ${bends.length} road bend(s) side by side, an orthogonal staircase, first at ${bends[0]}`);
  const stairs = fatStairs(sim.elevation, W, H);
  facts.fat_stairs = stairs.count;
  const stairLimit = spec.maxFatStairs ?? 0;
  if (stairs.count > stairLimit) {
    fail(`census: ${stairs.count} 2x2 diagonal step(s) in the relief, a contour that will scallop (the most is ${stairLimit}), first ${stairs.first.join('; ')}`);
  }
  // Report only: how far the drawn contours wander. It measures the relief's own irregularity as much as
  // any staircase (relief_census.ts), so it is a fact on the report and never a gate on a whole map.
  const wander = contourWander(sim.elevation, sim.blocked, W, H);
  facts.contour_wander = Number(wander.wander.toFixed(3));
  if (spec.coverShare) {
    let cover = 0;
    for (const r of json.rows) for (const ch of r) if ('123on'.includes(ch)) cover++;
    const share = cover / (W * H);
    facts.cover_share = Number(share.toFixed(4));
    if (share < spec.coverShare[0] || share > spec.coverShare[1]) {
      fail(`census: cover share ${(share * 100).toFixed(2)}% is outside ${spec.coverShare[0] * 100}-${spec.coverShare[1] * 100}%`);
    }
  }

  // 9. the rest of the rules file, by the data gate's own function
  const mapsById = new Map([[json.id, json as never]]);
  for (const line of versusRulesFailures([{ file: `data/versus/${rules.id}.json`, doc: rules }], mapsById)) {
    if (!line.startsWith('data/versus: no rules file')) fail(`rules: ${line}`);
  }
  const pops = { kdf: doctrines.kdf.pop_cap, sarim: doctrines.sarim.pop_cap };
  facts.pop_caps = `${pops.kdf}/${pops.sarim}`;
  if (pops.kdf !== 40 || pops.sarim !== 56) fail(`economy: pop caps are ${pops.kdf}/${pops.sarim}, not 40/56`);

  return { failures, facts };
}

/** The shipped large maps, by id, as the CLI and the tests read them. */
/** The reason the three maps offered before the versus gate (GH-974) are exempt from it: they were built to the old rules. */
export const SHIPPED_BEFORE_GATE = 'offered before the versus visibility gate (GH-974); read report-only in map_visibility.test.ts';

export const SPECS: Readonly<Record<string, () => LargeMapSpec>> = {
  rujm_sawda: () => ({
    label: 'Rujm Sawda',
    visibility: { exempt: SHIPPED_BEFORE_GATE },
    size: 80,
    maxBuiltShare: MAX_BUILT_SHARE,
    routesPerEnd: 3,
    income: { zones: 11, perMin: 360 },
    lone: ['centre'],
    // Its two mesa discs were drawn on 2x2 cells and the look pass (PR 928) left them: 26 diagonal steps, all
    // on the mesas (measured 2 Nov 2026, and contour_wander 1.18 there). The figure is the exemption, so any
    // further staircase turns the check red.
    maxFatStairs: 26,
    crossings: [
      { name: 'ford_ne', marker: 'ford_ne' },
      { name: 'ford_sw', marker: 'ford_sw' },
      { name: 'centre', marker: 'centre' },
      { name: 'mesa_ne', zone: 'mesa_ne' },
      { name: 'mesa_sw', zone: 'mesa_sw' },
    ],
  }),
  wadi_tarfan_l: () => ({
    label: 'Wadi Tarfan (large)',
    visibility: { exempt: SHIPPED_BEFORE_GATE },
    size: 96,
    maxBuiltShare: MAX_BUILT_SHARE,
    routesPerEnd: 2,
    income: { zones: 11, perMin: 300 },
    reference: maps.wadi_tarfan as unknown as MapJson,
    coverShare: [0.085, 0.11],
    crossings: [
      { name: 'ne_ford', marker: 'ne_ford', radius: 4 },
      { name: 'sw_ford', marker: 'sw_ford', radius: 4 },
      { name: 'centre', zone: 'centre_ford' },
    ],
  }),
  // GH-920 B3. Tel Marum's valley, NOT point-symmetric: two measured seats (the original's, doubled), four tunnel routes and a
  // five-zone economy, no cover on the sketch and none on the twin. No cut: both seats stand SOUTH of the wall band (the second in
  // the bowl before the pass), so no seat-to-seat route crosses it; the pass and the infantry-only corridor are pinned in
  // tel_marum_l_doctrine.test.ts instead.
  tel_marum_l: () => ({
    label: 'Tel Marum (large)',
    size: 96,
    routesPerEnd: 2,
    income: { zones: 5, perMin: 140 },
    reference: maps.tel_marum as unknown as MapJson,
    asymmetric: true,
    // the real placer's moves, each by an independent count of the formation tiles that are rock, a building or off the map (Python,
    // over the rows and the two force tables): 7, 13 and 10 of 30, 41 and 41 units. The original's own seats move 10, 11 and 15.
    displaced: { 'kdf/kdf': 7, 'kdf/sarim': 13, 'sarim/kdf': 10 },
  }),
  // GH-920 B3. An open plain: no cut, no tunnels (the original has no rules file), a lone centre marker, and the
  // seats on the anti-diagonal. The income is a table a mirror room never reads. This is the FIRST build, the one offered.
  milh_flats_l: () => ({
    label: 'Milh Flats (large)',
    visibility: { exempt: SHIPPED_BEFORE_GATE },
    size: 96,
    maxBuiltShare: MAX_BUILT_SHARE,
    routesPerEnd: 0,
    income: { zones: 7, perMin: 220 },
    reference: maps.milh_flats as unknown as MapJson,
    coverShare: [0.085, 0.11],
    antiDiagonal: true,
    lone: ['centre'],
  }),
  // GH-974. The REDO of the map above, STAGED (docs/campaign/staged_maps/milh_flats_l_redo, `staged()` below): a town of its
  // own, so the versus visibility gate runs and the built-share cap is the gate's 3%; the cut has three crossings, the two
  // fords and the town. It has no `reference`: its buildings are its own, held to the generic ceilings and the gate.
  milh_flats_l_redo: () => ({
    label: 'Milh Flats (large), redone',
    size: 96,
    // 0.76% built, with a town of its own: the cap is the versus gate's 3% (VERSUS_CAPS), not the upscale's 1%
    maxBuiltShare: 0.03,
    visibility: { towns: ['town'] },
    routesPerEnd: 0,
    income: { zones: 7, perMin: 220 },
    coverShare: [0.1, 0.14],
    antiDiagonal: true,
    lone: ['centre'],
    crossings: [
      { name: 'ford_nw', zone: 'ford_nw' },
      { name: 'ford_se', zone: 'ford_se' },
      // the town is ONE crossing: its interior has no exit but its two gates, so closing one closes it. The plug is the north
      // gate's box, not the whole enclosure (which would plug the ring too and hide a hole in it) and not the court (the yards
      // route round it)
      { name: 'town', marker: 'gate_1', radius: 3 },
    ],
  }),
  // GH-974. The REDO of Rujm Sawda, STAGED (docs/campaign/staged_maps/rujm_sawda_redo): four walled yards at the centre ford
  // are its town, so the versus visibility gate runs on them and the built-share cap is the map's own; the cut has the five
  // crossings of the shipped map (three fords, two mesas); and the structure triangles are counted (`triangles`).
  rujm_sawda_redo: () => ({
    label: 'Rujm Sawda, redone',
    size: 80,
    maxBuiltShare: 0.01,
    visibility: { towns: ['town'] },
    routesPerEnd: 3,
    income: { zones: 11, perMin: 360 },
    lone: ['centre'],
    triangles: { window: 48, control: 'milh_flats' },
    // 10.75% cover (scrub belts on the foot lanes, never cover 3): the band is the Milh redo's
    coverShare: [0.1, 0.14],
    crossings: [
      { name: 'ford_ne', marker: 'ford_ne' },
      { name: 'ford_sw', marker: 'ford_sw' },
      { name: 'centre', marker: 'centre' },
      { name: 'mesa_ne', zone: 'mesa_ne' },
      { name: 'mesa_sw', zone: 'mesa_sw' },
    ],
  }),
  // GH-974. The REDO of Wadi Tarfan (large), STAGED (docs/campaign/staged_maps/wadi_tarfan_l_redo): four walled yards at the
  // centre ford are its town, so the versus visibility gate runs on them and the built-share cap is the map's own; the wadi
  // runs edge to edge, so the cut has three crossings (the three fords) and no mesa; the structure triangles are counted
  // (`triangles`); the economy is eleven zones and 300 a minute, the shipped total, with the town's court paying the most.
  wadi_tarfan_l_redo: () => ({
    label: 'Wadi Tarfan (large), redone',
    size: 96,
    maxBuiltShare: 0.01,
    visibility: { towns: ['town'] },
    routesPerEnd: 2,
    income: { zones: 11, perMin: 300 },
    triangles: { window: 48, control: 'milh_flats' },
    // scrub belts on the foot lanes, never cover 3: the band is the Milh redo's
    coverShare: [0.1, 0.14],
    crossings: [
      { name: 'ne_ford', marker: 'ne_ford', radius: 4 },
      { name: 'sw_ford', marker: 'sw_ford', radius: 4 },
      { name: 'centre', zone: 'centre_ford' },
    ],
  }),
};

/**
 * The versus visibility gate on a shipped map (GH-974): the seat corridor, the scoring zones (the zones its rules file pays
 * for) and the towns it names, against `VERSUS_CAPS`. Async because it reads the building meshes.
 */
export async function verifyVersusVisibility(json: MapJson, rules: VersusRulesJson, spec: LargeMapSpec, caps?: VersusVisibilitySpec['caps']): Promise<{ failures: string[]; facts: Record<string, string | number> }> {
  const v = spec.visibility as LargeMapSpec['visibility'] | undefined;
  if (v === undefined) return { failures: [`visibility: the spec for ${spec.label ?? 'this map'} names neither \`towns\` nor \`exempt\`, so the versus gate is not bound`], facts: {} };
  if ('exempt' in v) return { failures: [], facts: { visibility_exempt: v.exempt } };
  const map = parseMap(json);
  const scoring = rules.income_zones.map((z) => z.zone).filter((z) => !v.towns.includes(z));
  return measureVersus(map, { towns: v.towns, scoring, caps });
}

/** The maps a large-map spec reads from docs/campaign/staged_maps instead of the data registry: authored, measured, NOT offered. */
const STAGED_IDS: ReadonlySet<string> = new Set(['milh_flats_l_redo', 'rujm_sawda_redo', 'wadi_tarfan_l_redo']);

/** A STAGED large map (see STAGED_IDS): its map and rules as the generator wrote them, read from disk, never from `@lions/data`. */
export function staged(id: string): { json: MapJson; rules: VersusRulesJson; spec: LargeMapSpec } {
  const dir = id;
  const spec = SPECS[id];
  if (!STAGED_IDS.has(id) || !spec) throw new Error(`no staged large map "${id}" (${[...STAGED_IDS].join(', ')})`);
  const read = (f: string) => JSON.parse(readFileSync(join(fileURLToPath(new URL('../..', import.meta.url)), 'docs', 'campaign', 'staged_maps', dir, f), 'utf8'));
  return { json: read('map.json') as MapJson, rules: read('versus.json') as VersusRulesJson, spec: spec() };
}

export function shipped(id: string): { json: MapJson; rules: VersusRulesJson; spec: LargeMapSpec } {
  const spec = SPECS[id];
  if (!spec) throw new Error(`no large-map spec for "${id}" (${Object.keys(SPECS).join(', ')})`);
  return {
    json: (maps as unknown as Record<string, MapJson>)[id],
    rules: (versusRules as unknown as Record<string, VersusRulesJson>)[id],
    spec: spec(),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const id = process.argv[2] ?? 'wadi_tarfan_l';
  const { json, rules, spec } = STAGED_IDS.has(id) ? staged(id) : shipped(id);
  const r = verifyLargeMap(json, rules, spec);
  const vis = await verifyVersusVisibility(json, rules, spec);
  r.failures.push(...vis.failures);
  Object.assign(r.facts, vis.facts);
  for (const [k, v] of Object.entries(r.facts)) console.log(`${k.padEnd(30)} ${v}`);
  if (r.failures.length > 0) {
    console.error(`\n${r.failures.length} failure(s):`);
    for (const f of r.failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`\n${id}: every check passes`);
}
