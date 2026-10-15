import { applyTerrain, maps, parseMap, units, type MapJson, type ParsedMap } from '@lions/data';
import type { Faction, MatchConfig, SeatConfig } from '@lions/net';
import { Sim, type TunnelRouteJson } from '@lions/sim';
import { standMapStructures } from '../map-sim';
import { sandboxAnchors, type SandboxAnchors } from '../sandbox-anchors';
import { upgradePrepass, type UpgradePrepass } from '../upgrade-prepass';
import { factionsBySide, versusSpawns } from './versus-force';

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
  /** Entity ids each side spawned with, by side. */
  bySide: [number[], number[]];
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
  const sim = new Sim({ seed: config.seed, width: map.width, height: map.height, capacity: 256 });
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
  // therefore registers exactly the roster and nothing else.
  const roster: readonly RosterUnit[] = Object.values(units);
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
    if (sameKit(kitBySide[0].unitKitTiers[u.id], kitBySide[1].unitKitTiers[u.id])) return;
    typeOf1.set(u.id, sim.addUnitType(kitBySide[1].registered[k]));
  });
  const typeOfBySide = [typeOf, typeOf1] as const;

  const anchors = sandboxAnchors(mapJson);
  const { bySide } = versusSpawns(sim, typeOfBySide, anchors, factions);
  return { sim, typeOf, typeOfBySide, kitBySide, mapJson, map, anchors, factions, bySide };
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
  for (const u of Object.values(units) as readonly RosterUnit[]) {
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

/** Whether two effective kits are the same, on key-sorted entries with zero
 *  tiers ignored (a zero tier fields nothing). */
function sameKit(a: Readonly<Record<string, number>> | undefined, b: Readonly<Record<string, number>> | undefined): boolean {
  const entries = (t: Readonly<Record<string, number>> | undefined): string =>
    JSON.stringify(Object.entries(t ?? {}).filter(([, n]) => n > 0).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
  return entries(a) === entries(b);
}
