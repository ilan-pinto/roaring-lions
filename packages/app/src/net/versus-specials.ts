/**
 * GH-1102, the app's half (the lead's ruling of 7 Nov 2026, the simple version): in a
 * versus room on "Bring your brigade" every Store special a player owns joins that
 * player's starting force. The rule and the refusals are `@lions/net`'s `specials.ts`;
 * this module is what the client sends and what the world builds from the config.
 *
 * - `ownedStoreSpecials`: the claim, from the account's bought units. It goes into the
 *   create/join body beside the tiers (`connect.ts`) and nowhere else.
 * - `seatSpecials`: a seat's specials as the WORLD reads them, from the config alone, cleaned
 *   again against the data (as `seatKitTiers` cleans the tiers): a brigade room, a human KDF
 *   seat, a Store special, not refused. A hand-edited config or replay cannot field more.
 * - `spawnSpecials`: the placement, behind each seat's placed force, on an open tile its own
 *   mobility can stand on.
 *
 * The sim learns none of this: it sees unit types (`addUnitType`) and spawns.
 */
import { units } from '@lions/data';
import { specialRefusal, type SeatConfig, type SpawnEnd } from '@lions/net';
import { DOMAIN_VEHICLE, fx, isBoughtOnly, type Sim } from '@lions/sim';
import { kdfUnlockGate } from '../kdf-gate';
import type { SandboxAnchors } from '../sandbox-anchors';
import { hostileFacing } from '../sandbox-facing';

type ShippedUnit = (typeof units)[keyof typeof units];

/** Every Store special (a KDF unit whose gate is bought-only, `isBoughtOnly`), in `units`
 *  order -- the order a world registers and spawns them in, whatever order a claim lists
 *  them. The Worker's twin is `STORE_SPECIALS` (`worker/src/match/store-specials.ts`). */
export const STORE_SPECIAL_IDS: readonly string[] = (Object.values(units) as ShippedUnit[])
  .filter((u) => {
    if (u.faction !== 'kdf') return false;
    const gate = kdfUnlockGate(u, new Set());
    return gate !== undefined && isBoughtOnly(gate);
  })
  .map((u) => u.id);

/** The claim a brigade room's body carries: the Store specials among `bought` (the
 *  account's bought units, earned or coin-bought: the view the tier claim reads too). */
export function ownedStoreSpecials(bought: ReadonlySet<string>): string[] {
  return STORE_SPECIAL_IDS.filter((id) => bought.has(id));
}

/**
 * A seat's Store specials as the world fields them: `[]` unless the seat is a HUMAN KDF seat
 * on `kit: 'brigade'`; otherwise the config's `unlocks` walked through `STORE_SPECIAL_IDS`
 * (so in `units` order, each id once, nothing that is not a Store special) less
 * `VERSUS_REFUSED_SPECIALS`. The room minted exactly this (`mintConfig`); a refused id in a
 * config never came from a room, and was shown to both seats in the lobby besides.
 */
export function seatSpecials(seat: SeatConfig | undefined): string[] {
  if (seat === undefined || seat.kit !== 'brigade' || seat.faction !== 'kdf' || seat.kind !== 'human') return [];
  const claimed = new Set<unknown>(Array.isArray(seat.unlocks) ? seat.unlocks : []);
  return STORE_SPECIAL_IDS.filter((id) => claimed.has(id) && specialRefusal(id) === null);
}

/**
 * Where a seat's specials stand: offsets in the force's own frame, as `VERSUS_KDF`'s are
 * (dx toward the enemy, dy along the line), and the hostile end mirrors them through its
 * anchor the same way. The k-th special the seat brings (in `units` order) takes slot k. They
 * sit behind the placed force's rear rank (`apc_eitan` and `mortar_team` at dx -2), a reserve
 * that arrives with the force at tick 0. One slot per Store special, so a seat that owns
 * every one still has a slot for each (`versus-specials.test.ts`).
 */
export const SPECIAL_SLOTS: readonly (readonly [number, number])[] = [
  [-4, -6], [-4, -2], [-4, 2], [-4, 6],
  [-5, -4], [-5, 0], [-5, 4],
  [-6, -6], [-6, -2], [-6, 2], [-6, 6],
  [-7, 0],
];

/**
 * Spawns each side's specials at tick 0, the FRIENDLY end's first (as `versusSpawns` places
 * its forces), so entity ids do not depend on which side a seat plays. Each lands on the open
 * tile nearest its slot (Chebyshev rings, row-major inside a ring) that its OWN mobility can
 * stand on -- the vehicle mask (`blocked | boulder`) for a wheeled or tracked hull, the foot
 * mask for anything else -- and that no unit already stands on. Never a wall, rock, building
 * or (for a vehicle) a boulder field or ditch: the search widens until it finds one, and a map
 * with no such tile at all throws rather than strand a unit in a wall.
 *
 * Returns the entity ids, by side.
 */
export function spawnSpecials(
  sim: Sim,
  typeOfBySide: readonly [ReadonlyMap<string, number>, ReadonlyMap<string, number>],
  anchors: SandboxAnchors,
  ends: readonly [SpawnEnd, SpawnEnd],
  specialsBySide: readonly [readonly string[], readonly string[]],
): [number[], number[]] {
  const out: [number[], number[]] = [[], []];
  if (specialsBySide[0].length === 0 && specialsBySide[1].length === 0) return out;
  const w = sim.width;
  const h = sim.height;
  // Every tile a unit already stands on, so a special never lands on one.
  const taken = new Set<number>();
  const st = sim.state;
  for (let i = 0; i < sim.entityCount; i++) if (st.alive[i] === 1) taken.add((st.posY[i] >> 16) * w + (st.posX[i] >> 16));
  const openNear = (x: number, y: number, mask: Uint8Array): [number, number] => {
    const cx = Math.min(Math.max(x, 0), w - 1);
    const cy = Math.min(Math.max(y, 0), h - 1);
    const reach = Math.max(w, h);
    for (let r = 0; r <= reach; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = cx + dx;
          const ty = cy + dy;
          if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
          const t = ty * w + tx;
          if (mask[t] === 0 && !taken.has(t)) return [tx, ty];
        }
      }
    }
    throw new Error(`spawnSpecials: no open tile on the map for a special near (${x},${y})`);
  };
  const [ax, ay] = anchors.friendly;
  const [bx, by] = anchors.hostile;
  const atFriendly: 0 | 1 = ends[0] === 'friendly' ? 0 : 1;
  for (const side of [atFriendly, atFriendly === 0 ? 1 : 0] as const) {
    const friendly = side === atFriendly;
    const facing = friendly ? hostileFacing(bx, by, ax, ay) : hostileFacing(ax, ay, bx, by);
    specialsBySide[side].forEach((id, k) => {
      const t = typeOfBySide[side].get(id);
      if (t === undefined) throw new Error(`spawnSpecials: ${id} is not registered for side ${side}`);
      const slot = SPECIAL_SLOTS[k];
      if (slot === undefined) throw new Error(`spawnSpecials: no slot for special ${k} (${id})`);
      const [dx, dy] = slot;
      const mask = sim.unitTypes[t].pathDomain === DOMAIN_VEHICLE ? sim.blockedVehicle : sim.blocked;
      const [ox, oy] = friendly ? openNear(ax + dx, ay + dy, mask) : openNear(bx - dx, by - dy, mask);
      taken.add(oy * w + ox);
      out[side].push(sim.spawn(t, side, fx.from(ox + 0.5), fx.from(oy + 0.5), facing));
    });
  }
  return out;
}
