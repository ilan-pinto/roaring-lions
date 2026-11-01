// Rujm Sawda's verifier (GH-913, work package L4): everything the lead asked a large versus map to
// prove before it is registered, read from the SHIPPED JSON through the real loader, the real
// `FlowField` and the real `versusSpawns`, never from the generator that wrote it
// (tools/maps/rujm_sawda/build.mjs).
//
//   npx tsx tools/src/rujm_sawda_verify.ts          prints the report, exits 1 on any failure
//
// tools/src/rujm_sawda.test.ts runs the same function on the shipped files and then on mutated
// copies, each of which must come back red.
//
// What it checks:
//   1. shape: 80x80, one elevation digit per tile;
//   2. the half-turn (x, y) -> (79 - x, 79 - y): every tile, every elevation digit, every marker
//      and zone (bar the named `centre`), every building, both camps, both tunnel sets, and the
//      income of each zone against its twin's;
//   3. seat-to-seat flow cost, both ways, on foot and on wheels, equal and finite;
//   4. the wadi is a cut for vehicles with exactly five ways across: the three fords and the two
//      mesas. Plugging all five leaves no vehicle route; each ford ALONE carries vehicles; each
//      mesa ALONE carries them;
//   5. each mesa's ramps work both ways (a route between its two ramp markers, in both
//      directions, over the crown), the west ramp on the north-west bank's side and the south ramp
//      on the other's;
//   6. spawns are clean in all three pairings (KDF/KDF, KDF/Sarim, Sarim/KDF): every formation tile
//      of both seats is on the map and open to wheels, and the same-faction pairing is an exact
//      mirror;
//   7. built share at most 1%, and a building of more than one storey only inside a well's walls and
//      at least LANE_SETBACK tiles from any track;
//   8. the economy: eleven income zones, 360 a minute, twins paying alike; three Sarim tunnel routes
//      an end.
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

export const SIZE = 80;
/** A multi-storey building must stand at least this many tiles (Chebyshev) from any track tile. */
export const LANE_SETBACK = 5;
/** How far round a ford's marker the plug reaches, in tiles (Chebyshev). */
export const FORD_PLUG_RADIUS = 4;
export const MAX_BUILT_SHARE = 0.01;
/** A cost at or above this is the field's own "unreachable". */
const FAR = 1_000_000;
const FORDS = [
  { name: 'ford_ne', marker: 'ford_ne' },
  { name: 'ford_sw', marker: 'ford_sw' },
  { name: 'centre', marker: 'centre' },
] as const;
const MESAS = ['mesa_ne', 'mesa_sw'] as const;
const PAIRINGS: readonly (readonly [Faction, Faction])[] = [['kdf', 'kdf'], ['kdf', 'sarim'], ['sarim', 'kdf']];

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

export function verifyRujmSawda(json: MapJson, rules: VersusRulesJson): Report {
  const failures: string[] = [];
  const facts: Record<string, string | number> = {};
  const fail = (s: string) => failures.push(s);
  const W = json.width;
  const H = json.height;

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

  // 2. the half-turn
  const tileOff: string[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (json.rows[y][x] !== json.rows[H - 1 - y][W - 1 - x]) tileOff.push(`row ${x},${y}`);
      if (elev[y][x] !== elev[H - 1 - y][W - 1 - x]) tileOff.push(`elevation ${x},${y}`);
    }
  }
  if (tileOff.length > 0) fail(`symmetry: ${tileOff.length} tiles are not their half-turn twin, first ${tileOff.slice(0, 6).join('; ')}`);
  facts.asymmetric_tiles = tileOff.length;

  if (!markers.versus_0 || !markers.versus_1) fail('symmetry: a seat marker is missing');
  else if (mirror(markers.versus_0).join() !== markers.versus_1.join()) fail(`symmetry: versus_1 ${markers.versus_1} is not versus_0 ${markers.versus_0} mirrored`);
  const markerAt = new Map(Object.entries(markers).map(([n, p]) => [p.join(','), n]));
  const lonely = Object.entries(markers).filter(([, p]) => !markerAt.has(mirror(p).join(','))).map(([n]) => n).sort();
  if (lonely.join() !== 'centre') fail(`symmetry: markers with no twin tile: ${lonely.join(', ') || '(none)'}; only centre may be alone`);
  for (const [n, p] of Object.entries(markers)) {
    if (!n.endsWith('_0')) continue;
    const twin = markerAt.get(mirror(p).join(','));
    if (twin === undefined || !twin.endsWith('_1')) fail(`symmetry: ${n}'s twin tile holds ${twin ?? 'no marker'}, not a _1 marker`);
  }
  const zoneAt = new Map(Object.entries(zones).map(([n, r]) => [r.join(','), n]));
  for (const [n, [x, y, w, h]] of Object.entries(zones)) {
    const twin = zoneAt.get([W - x - w, H - y - h, w, h].join(','));
    if (twin === undefined) fail(`symmetry: zone ${n} has no mirrored zone`);
    else if (n.endsWith('_0') && !twin.endsWith('_1')) fail(`symmetry: zone ${n}'s twin is ${twin}, not a _1 zone`);
  }

  for (const [n, p] of Object.entries(markers)) {
    if (sim.blocked[p[1] * W + p[0]] !== 0) fail(`markers: ${n} (${p}) is on ${json.rows[p[1]][p[0]]}, ground nothing can stand on`);
  }

  const structKey = (type: string, tiles: readonly number[]) => `${type}:${[...tiles].sort((a, b) => a - b).join(' ')}`;
  const have = new Set(map.structures.map((s) => structKey(s.type, s.tiles)));
  for (const s of map.structures) {
    if (!have.has(structKey(s.type, s.tiles.map((t) => W * H - 1 - t)))) fail(`symmetry: ${s.type} at tile ${s.tiles[0]} has no mirrored twin`);
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
  if (campTiles(camps.friendly.camp).join(';') !== hostileCamp.sort().join(';')) fail('symmetry: the hostile camp is not the friendly camp mirrored');

  const routes = { friendly: rules.tunnels?.friendly ?? [], hostile: rules.tunnels?.hostile ?? [] };
  if (routes.friendly.length !== 3 || routes.hostile.length !== 3) fail(`economy: tunnel routes per end are ${routes.friendly.length} and ${routes.hostile.length}, not 3 and 3`);
  routes.friendly.forEach((r, i) => {
    const t = routes.hostile[i];
    if (!t) return;
    if (r.points.map((p) => mirror(p).join(',')).join(';') !== t.points.map((p) => p.join(',')).join(';') || r.capacity !== t.capacity) {
      fail(`symmetry: hostile route ${t.id} is not friendly route ${r.id} mirrored (points and capacity)`);
    }
  });

  const rate = new Map(rules.income_zones.map((z) => [z.zone, z.rate_per_min]));
  const total = rules.income_zones.reduce((a, z) => a + z.rate_per_min, 0);
  facts.income_zones = rules.income_zones.length;
  facts.income_per_min = total;
  if (rules.income_zones.length !== 11) fail(`economy: ${rules.income_zones.length} income zones, not 11`);
  if (total !== 360) fail(`economy: income is ${total} a minute, not 360`);
  for (const z of rules.income_zones) {
    const r = zones[z.zone];
    if (!r) continue;
    const twin = zoneAt.get([W - r[0] - r[2], H - r[1] - r[3], r[2], r[3]].join(','));
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
    if (there !== back) fail(`flow: ${domain} seat 0 to seat 1 costs ${there} and back costs ${back}`);
    if (!(there > 0 && there < FAR)) fail(`flow: ${domain} seat 0 to seat 1 is ${there}, not a finite route`);
  }

  // 4. the cut: five ways across, plugged and opened
  const plugRadius = (m: readonly number[]) => {
    const out: number[] = [];
    for (let y = m[1] - FORD_PLUG_RADIUS; y <= m[1] + FORD_PLUG_RADIUS; y++) {
      for (let x = m[0] - FORD_PLUG_RADIUS; x <= m[0] + FORD_PLUG_RADIUS; x++) if (x >= 0 && y >= 0 && x < W && y < H) out.push(y * W + x);
    }
    return out;
  };
  const plugRect = (r: readonly number[]) => {
    const out: number[] = [];
    for (let y = r[1]; y < r[1] + r[3]; y++) for (let x = r[0]; x < r[0] + r[2]; x++) out.push(y * W + x);
    return out;
  };
  const crossings: Record<string, number[]> = {};
  for (const f of FORDS) {
    if (!markers[f.marker]) fail(`cut: marker ${f.marker} is missing`);
    else crossings[f.name] = plugRadius(markers[f.marker]);
  }
  for (const m of MESAS) {
    if (!zones[m]) fail(`cut: zone ${m} is missing`);
    else crossings[m] = plugRect(zones[m]);
  }
  const wheelsWith = (open: readonly string[]) => {
    const mask = new Uint8Array(sim.blockedVehicle);
    for (const [name, tiles] of Object.entries(crossings)) if (!open.includes(name)) for (const t of tiles) mask[t] = 1;
    return mask;
  };
  if (Object.keys(crossings).length === 5) {
    const sealed = cost(wheelsWith([]), seat0, seat1);
    facts.wheels_all_five_plugged = sealed >= FAR ? 'no route' : sealed;
    if (sealed < FAR) fail(`cut: with all three fords and both mesas plugged a vehicle still crosses (cost ${sealed}): the wadi leaks`);
    for (const name of Object.keys(crossings)) {
      const there = cost(wheelsWith([name]), seat0, seat1);
      const back = cost(wheelsWith([name]), seat1, seat0);
      facts[`wheels_via_${name}_only`] = there >= FAR ? 'no route' : there;
      if (there >= FAR) fail(`cut: ${name} alone does not carry a vehicle from seat 0 to seat 1`);
      if (back >= FAR) fail(`cut: ${name} alone does not carry a vehicle from seat 1 to seat 0`);
      if (there < FAR && back < FAR && there !== back) fail(`cut: ${name} alone costs ${there} one way and ${back} the other`);
    }
    // 5. a mesa's ramps, both ways, with the fords shut and only that mesa open
    for (const [mesa, west, south, nearWest, nearSouth] of [
      ['mesa_ne', 'ramp_ne_w', 'ramp_ne_s', seat0, seat1],
      ['mesa_sw', 'ramp_sw_e', 'ramp_sw_n', seat1, seat0],
    ] as const) {
      if (!markers[west] || !markers[south]) {
        fail(`ramps: ${west} or ${south} is missing`);
        continue;
      }
      const mask = wheelsWith([mesa]);
      for (const r of [west, south]) {
        if (mask[markers[r][1] * W + markers[r][0]] !== 0) fail(`ramps: ${r} (${markers[r]}) is closed to wheels`);
      }
      const up = cost(mask, markers[west], markers[south]);
      const down = cost(mask, markers[south], markers[west]);
      facts[`${mesa}_ramp_to_ramp`] = up >= FAR ? 'no route' : up;
      facts[`${mesa}_ramp_to_ramp_back`] = down >= FAR ? 'no route' : down;
      if (up >= FAR) fail(`ramps: no wheeled route from ${west} over ${mesa} to ${south}`);
      if (down >= FAR) fail(`ramps: no wheeled route from ${south} over ${mesa} to ${west}`);
      // The west ramp is the near bank's: its own seat reaches it, over the bank, sooner than the far seat.
      const wNear = cost(mask, nearWest, markers[west]);
      const wFar = cost(mask, nearSouth, markers[west]);
      const sNear = cost(mask, nearSouth, markers[south]);
      const sFar = cost(mask, nearWest, markers[south]);
      if (!(wNear < wFar)) fail(`ramps: ${west} is not nearer its own bank's seat (${wNear}) than the other's (${wFar})`);
      if (!(sNear < sFar)) fail(`ramps: ${south} is not nearer its own bank's seat (${sNear}) than the other's (${sFar})`);
    }
  }

  // 6. spawns, in all three pairings
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
  for (const [f0, f1] of PAIRINGS) {
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
  {
    // The real placer, on a fresh world per pairing: every unit lands on its formation tile.
    for (const [f0, f1] of PAIRINGS) {
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
      if (moved > 0) fail(`spawns: ${f0}/${f1}: ${moved} units were not placed on their formation tile`);
      if (f0 === f1) {
        force.bySide[0].forEach((e, i) => {
          const m = mirror(tileOf(e));
          const o = tileOf(force.bySide[1][i]);
          if (m[0] !== o[0] || m[1] !== o[1]) fail(`spawns: ${f0}/${f1}: unit #${i} is not its twin mirrored`);
        });
      }
    }
  }

  // 7. built share, and storeys
  const parsedShare = builtShare(map);
  facts.built_share = Number(parsedShare.toFixed(5));
  if (parsedShare > MAX_BUILT_SHARE) fail(`buildings: built share ${(parsedShare * 100).toFixed(2)}% is over ${MAX_BUILT_SHARE * 100}%`);
  const trackTiles: Pt[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (json.rows[y][x] === 'r') trackTiles.push([x, y]);
  const wellZones = Object.entries(zones).filter(([n]) => n.startsWith('well_')).map(([, r]) => r);
  const spec = structures as Record<string, { floors?: number; low_profile?: boolean } | undefined>;
  if (spec.wall?.low_profile !== true) fail('buildings: the wall type is not low-profile, so it would block sight');
  let multi = 0;
  for (const s of map.structures) {
    if ((spec[s.type]?.floors ?? 1) <= 1) continue;
    multi++;
    const pts = s.tiles.map((t): Pt => [t % W, Math.floor(t / W)]);
    const inWell = pts.every(([x, y]) => wellZones.some((r) => x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3]));
    if (!inWell) fail(`buildings: a ${s.type} of more than one storey at (${pts[0]}) is outside the wells' walls`);
    let nearest = Infinity;
    for (const [x, y] of pts) for (const [tx, ty] of trackTiles) nearest = Math.min(nearest, Math.max(Math.abs(x - tx), Math.abs(y - ty)));
    if (nearest < LANE_SETBACK) fail(`buildings: a ${s.type} of more than one storey at (${pts[0]}) is ${nearest} tiles from a track; the least is ${LANE_SETBACK}`);
  }
  facts.multi_storey_buildings = multi;
  if (multi !== 4) fail(`buildings: ${multi} multi-storey buildings, not the four farmhouses`);

  // the rest of the rules file, by the data gate's own function
  const mapsById = new Map([[json.id, json as never]]);
  // (the "no rules file for a matchup map" lines are about the OTHER maps, which this call is not given)
  for (const line of versusRulesFailures([{ file: `data/versus/${rules.id}.json`, doc: rules }], mapsById)) {
    if (!line.startsWith('data/versus: no rules file')) fail(`rules: ${line}`);
  }
  const pops = { kdf: doctrines.kdf.pop_cap, sarim: doctrines.sarim.pop_cap };
  facts.pop_caps = `${pops.kdf}/${pops.sarim}`;
  if (pops.kdf !== 40 || pops.sarim !== 56) fail(`economy: pop caps are ${pops.kdf}/${pops.sarim}, not 40/56`);

  return { failures, facts };
}

/** The shipped map and its rules, for the CLI and the test. */
export function shipped(): { json: MapJson; rules: VersusRulesJson } {
  return { json: maps.rujm_sawda as unknown as MapJson, rules: versusRules.rujm_sawda };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { json, rules } = shipped();
  const r = verifyRujmSawda(json, rules);
  for (const [k, v] of Object.entries(r.facts)) console.log(`${k.padEnd(30)} ${v}`);
  if (r.failures.length > 0) {
    console.error(`\n${r.failures.length} failure(s):`);
    for (const f of r.failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log('\nrujm_sawda: every check passes');
}
