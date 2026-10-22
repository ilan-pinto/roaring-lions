import { applyTerrain, doctrines, maps, parseMap, roadMaskOf, units, versusMissionOf, versusRules, versusZonesOf, type MapJson, type ParsedMap } from '@lions/data';
import { economyRoom, endOfSeat, seatRules, type Faction, type MatchConfig, type SeatConfig, type SpawnEnd } from '@lions/net';
import { sameTrackTiers } from '@lions/render';
import { MissionRuntime, Sim, type MissionContext, type MissionEvent, type MissionJson, type SimEvent, type TunnelRouteJson } from '@lions/sim';
import { standMapStructures } from '../map-sim';
import type { SandboxAnchors } from '../sandbox-anchors';
import { versusAnchors } from './versus-seats';
import { upgradePrepass, type UpgradePrepass } from '../upgrade-prepass';
import { factionsBySide, versusSpawns } from './versus-force';
import { versusRoster } from './versus-roster';

/** One unit of the shipped roster, as the prepass takes and returns it. */
export type RosterUnit = (typeof units)[keyof typeof units];

/** The world a versus room plays at tick 0. */
export interface MatchWorld {
  sim: Sim;
  /** Side 0's id -> sim type index; the same object as `typeOfBySide[0]`. */
  typeOf: Map<string, number>;
  /** Each SIDE's id -> sim type index. Side 1's is side 0's with an entry
   *  replaced for every KDF type whose kit differs between the two sides. */
  typeOfBySide: readonly [Map<string, number>, Map<string, number>];
  /** Each SIDE's prepass over the whole roster, from that side's cleaned claim
   *  (`seatKitTiers`). Side 1's `registered` holds every type, but only the
   *  ones its kit changed were added to the sim; read the tables, not that. */
  kitBySide: readonly [UpgradePrepass<RosterUnit>, UpgradePrepass<RosterUnit>];
  mapJson: MapJson;
  /** The parsed map `sim` was built from -- what the renderer is handed. */
  map: ParsedMap;
  anchors: SandboxAnchors;
  factions: [Faction, Faction];
  /** Each SIDE's spawn end (LD1, N3 Task 2): the end of the seat that plays
   *  it (`endOfSeat`), so a Sarim host -- side 1 -- stands on `friendly`.
   *  `['friendly', 'hostile']` in every mirror and KDF-host room. */
  endOfSide: readonly [SpawnEnd, SpawnEnd];
  /** Entity ids each side spawned with, by side. */
  bySide: [number[], number[]];
  /** The skirmish economy's runtime (N3 Task 3): camps, purses, doctrine
   *  menus and income zones, from `data/versus/<map>.json` and
   *  `data/doctrines/*.json`. Null in a mirror room (`economyRoom`), which
   *  plays today's placed-force match and nothing else. It never ends by
   *  itself (no objectives, `checkEnd`); `outcome.ts` decides the match. */
  runtime: MissionRuntime | null;
  /** The structure types the economy runtime stands (its rules file's camps, through
   *  `versusMissionOf`), so the browser loads their meshes (N3 Task 6): a room has no
   *  mission whose `structures` the mesh plan could read. `[]` in a mirror room. */
  structureTypes: readonly string[];
}

/**
 * The world a versus room plays, from its config alone -- the ONE place the
 * versus boot's sim-state writes live, so the browser (`bootBattlefield`) and
 * a headless client (the AI harness) build the same bytes. A copy in `tools/`
 * would drift silently.
 *
 * The statements are `bootBattlefield`'s own, in its order: the sim, the map's
 * terrain and buildings, the map's own tunnel routes, the unit types the
 * browser's prepass registers (side 0's kit, then a copy of each KDF type
 * whose kit side 1 claims differently -- `seatKitTiers`; a matched room
 * registers the base ladder alone), the anchors, then the two forces, each
 * side through its own type map. Throws on a sandbox
 * config, and on a map that is not shipped (the browser's quiet fall-back to
 * another map would put the two machines on different worlds).
 */
export function buildMatchWorld(config: MatchConfig): MatchWorld {
  if (config.mode !== 'versus') throw new Error(`buildMatchWorld: a versus config is required, got mode "${config.mode}"`);
  const mapJson = (maps as Record<string, MapJson | undefined>)[config.map];
  if (mapJson === undefined) throw new Error(`buildMatchWorld: map "${config.map}" is not shipped`);
  const map = parseMap(mapJson);
  // 256: see `bootBattlefield` -- `spawn` never reuses a dead unit's slot.
  const sim = new Sim({ seed: config.seed, width: map.width, height: map.height, capacity: 256, humanHeld: seatRules(config).humanHeld });
  applyTerrain(map, sim);
  standMapStructures(sim, map);

  // Positional: entry r IS the sim's route index, so assert it (see main.ts).
  const tunnelRoutes: TunnelRouteJson[] = map.tunnels.map((t) => ({
    id: t.id,
    points: t.points,
    dig_tiles_per_s: t.digTilesPerS,
    pre_dug: t.preDug,
  }));
  for (let i = 0; i < tunnelRoutes.length; i++) {
    const got = sim.addTunnel(tunnelRoutes[i]);
    if (got !== i) throw new Error(`tunnel "${tunnelRoutes[i].id}" registered as route ${got}, expected ${i}`);
  }

  // Each side's kit comes from the CONFIG alone (never this machine's
  // account), so both seats register the same types in the same order. Side
  // 0 registers the whole roster, as every room always has; side 1 appends a
  // copy only of a KDF type whose kit differs from side 0's, in roster order,
  // and only when side 1 is itself a KDF side.
  // A matched room, or a brigade room whose seats claim the same kit,
  // therefore registers exactly the roster and nothing else. The roster is
  // `versusRoster()`: the shipped units minus `VERSUS_HELD_UNITS`.
  const roster: readonly RosterUnit[] = versusRoster();
  const seats = seatsBySide(config);
  const kitBySide = [
    upgradePrepass(roster, seatKitTiers(seats[0])),
    upgradePrepass(roster, seatKitTiers(seats[1])),
  ] as const;
  const typeOf = new Map<string, number>();
  for (const registered of kitBySide[0].registered) typeOf.set(registered.id, sim.addUnitType(registered));
  const typeOf1 = new Map(typeOf);
  const factions = factionsBySide(config);
  roster.forEach((u, k) => {
    // A Sarim side 1 fields no KDF type, so a copy for it would be registered and never spawned.
    if (factions[1] !== 'kdf' || u.faction !== 'kdf') return;
    // The ONE "same kit" predicate, shared with the renderer's `templateKey`
    // so it never draws one kit on an id whose two sim types differ, nor loads
    // a second template for an id whose two sim types are one.
    if (sameTrackTiers(kitBySide[0].unitKitTiers[u.id], kitBySide[1].unitKitTiers[u.id])) return;
    typeOf1.set(u.id, sim.addUnitType(kitBySide[1].registered[k]));
  });
  const typeOfBySide = [typeOf, typeOf1] as const;

  const anchors = versusAnchors(mapJson);
  const endOfSide = endsBySide(config);
  const { bySide } = versusSpawns(sim, typeOfBySide, anchors, factions, endOfSide);
  // The runtime comes AFTER both forces, so every entity id a mirror room
  // spawned, and so every mirror byte, is what it was; a mirror builds none.
  const economy = economyRoom(config) ? economyRuntime(sim, config.map, map, typeOf, factions, endOfSide) : null;
  const runtime = economy?.runtime ?? null;
  const structureTypes = economy?.structureTypes ?? [];
  return { sim, typeOf, typeOfBySide, kitBySide, mapJson, map, anchors, factions, endOfSide, bySide, runtime, structureTypes };
}

/**
 * One room tick, the ONE body both the browser (`main.ts`'s room path) and
 * the AI harness (`tools/src/net/agent-client.ts`) run, so the two cannot
 * drift: the runtime prices and spends what the frame set aside, the sim
 * ticks, the runtime steps over the tick's events. A mirror room (no runtime)
 * is `sim.tick()` alone, exactly as before.
 */
export function matchTick(w: Pick<MatchWorld, 'sim' | 'runtime'>): { sim: SimEvent[]; mission: MissionEvent[] } {
  w.runtime?.applyQueued();
  const ev = w.sim.tick();
  return { sim: ev, mission: w.runtime?.step(ev) ?? [] };
}

/**
 * The runtime's production catalogue in a versus room: a unit on the asking
 * side's doctrine menu (`menus[side]`, by side, so by that side's faction)
 * costs what its own JSON says; anything else is not available in the field.
 * No `unlock` -- the doctrine menu IS the gate (P-7) -- and no `intel`.
 */
export function versusUnitInfo(menus: readonly [readonly string[], readonly string[]]): NonNullable<MissionContext['unitInfo']> {
  // A room registers `versusRoster()` (shipped units minus VERSUS_HELD_UNITS), so a menu id
  // outside it would pass here and throw in `typeIdOf` at the build: answer null instead.
  const catalogue: Record<string, RosterUnit | undefined> = Object.fromEntries(versusRoster().map((u) => [u.id, u]));
  return (id, side) => {
    if (!menus[side].includes(id)) return null;
    const u = catalogue[id];
    if (u === undefined) return null;
    return {
      logistics: u.cost.logistics,
      buildTimeS: 'build_time_s' in u.cost ? u.cost.build_time_s : 20,
      population: 'population' in u.cost ? u.cost.population : 1,
    };
  };
}

/**
 * The runtime an economy room plays (N3 Task 3). Everything in it is data:
 * the camps and income zones from the map's versus rules file, the menu, start
 * purse and population cap from each side's faction's doctrine. Side `s`
 * stands at `endOfSide[s]`, so its camp is that end's (LD1: a Sarim host is
 * side 1 at the friendly end, and the friendly camp is side 1's).
 */
function economyRuntime(
  sim: Sim,
  mapId: string,
  map: ParsedMap,
  typeOf: ReadonlyMap<string, number>,
  factions: readonly [Faction, Faction],
  endOfSide: readonly [SpawnEnd, SpawnEnd],
): { runtime: MissionRuntime; structureTypes: string[] } {
  const rules = versusRules[mapId];
  if (rules === undefined) throw new Error(`buildMatchWorld: map "${mapId}" has no versus rules file`);
  const sideAt = (end: SpawnEnd): 0 | 1 => (endOfSide[0] === end ? 0 : 1);
  const mission = versusMissionOf(rules, { friendly: sideAt('friendly'), hostile: sideAt('hostile') });
  // By SIDE, and so by that side's faction -- never the files' or the seats' order.
  const doctrine = [doctrines[factions[0]], doctrines[factions[1]]] as const;
  const ctx: MissionContext = {
    // The context has one lookup: side 0's (Q7). Under LD1 side 0 is the KDF
    // side, and a Sarim type is never kitted, so this is exact for both.
    typeIdOf: (id) => {
      const t = typeOf.get(id);
      if (t === undefined) throw new Error(`versus runtime references unknown unit ${id}`);
      return t;
    },
    markers: map.markers,
    zones: versusZonesOf(rules, map.zones),
    roadMask: roadMaskOf(map),
    unitInfo: versusUnitInfo([doctrine[0].menu, doctrine[1].menu]),
    popCaps: [doctrine[0].pop_cap ?? null, doctrine[1].pop_cap ?? null],
    economy: {
      logisticsStart: [doctrine[0].budget.logistics_start, doctrine[1].budget.logistics_start],
      logisticsRatePerMin: [0, 0],
    },
  };
  const runtime = new MissionRuntime(sim, mission as MissionJson, ctx);
  runtime.start();
  return { runtime, structureTypes: [...new Set(mission.structures.map((st) => st.type))] };
}

/** Each SIDE's spawn end, from the seat that plays it: the end follows the
 *  SEAT (`endOfSeat`), the side follows the faction (LD1). A config whose two
 *  seats share a side (never a versus room's) keeps today's default. */
export function endsBySide(config: Pick<MatchConfig, 'seats'>): readonly [SpawnEnd, SpawnEnd] {
  const [a, b] = config.seats;
  if (a.side === b.side) return ['friendly', 'hostile'];
  const out: [SpawnEnd, SpawnEnd] = ['friendly', 'hostile'];
  out[a.side] = endOfSeat(a.seat);
  out[b.side] = endOfSeat(b.seat);
  return out;
}

/** Each SIDE's seat (index 0 is side 0), read by `side` and never by seat
 *  index, with `factionsBySide`'s own rule (a later seat on a side wins). */
function seatsBySide(config: MatchConfig): [SeatConfig | undefined, SeatConfig | undefined] {
  const out: [SeatConfig | undefined, SeatConfig | undefined] = [undefined, undefined];
  for (const s of config.seats) out[s.side] = s;
  return out;
}

/**
 * A seat's kit claim as the world reads it: `{}` unless the seat is a KDF
 * seat on `kit: 'brigade'`, otherwise the claim walked through the SHIPPED
 * roster rather than through its own keys -- every KDF id, every track that id
 * declares -- reading only own data properties, each leaf truncated and
 * clamped to that track's real tier count. A validated config admits a leaf
 * up to 16 and any key name; nothing of the claim reaches `upgradePrepass` but
 * what this returns, and both levels are null-prototype objects, so no own
 * `__proto__` key and no inherited name can be read as a tier. Zero tiers are
 * dropped, so two claims that field the same kit clean to the same object.
 */
export function seatKitTiers(seat: SeatConfig | undefined): Record<string, Record<string, number>> {
  const out = Object.create(null) as Record<string, Record<string, number>>;
  if (seat === undefined || seat.kit !== 'brigade' || seat.faction !== 'kdf') return out;
  const claim: unknown = seat.tiers;
  for (const u of versusRoster()) {
    const upgrades = (u as { upgrades?: Record<string, { tiers: readonly unknown[] }> }).upgrades;
    if (u.faction !== 'kdf' || upgrades === undefined) continue;
    const perType = ownValue(claim, u.id);
    if (perType === undefined) continue;
    const tracks = Object.create(null) as Record<string, number>;
    let any = false;
    for (const [track, declared] of Object.entries(upgrades)) {
      const raw = ownValue(perType, track);
      if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
      const tier = Math.min(Math.max(Math.trunc(raw), 0), declared.tiers.length);
      if (tier === 0) continue;
      tracks[track] = tier;
      any = true;
    }
    if (any) out[u.id] = tracks;
  }
  return out;
}

/** `o[key]` when `o` is a plain object holding `key` as an OWN DATA property;
 *  never an inherited name, never a getter. */
function ownValue(o: unknown, key: string): unknown {
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return undefined;
  const d = Object.getOwnPropertyDescriptor(o, key);
  return d !== undefined && 'value' in d ? d.value : undefined;
}
