import { DOMAIN_VEHICLE, fx, type Sim } from '@lions/sim';

/** How far the spiral looks for a free tile (it was 6 before the occupancy test). */
const MAX_RING = 12;

/**
 * The sandbox's placer, out of `main.ts`'s `sandboxSpawns` so the mirror match
 * (`net/versus-force.ts`) places units by exactly the same rule: spawn by unit
 * id on the nearest open tile, never in rock or a wall.
 *
 * Terrain the formation knows nothing about: an offset that lands in rock or a
 * wall would strand a unit inside it, and Tel Marum's ridge sits right where
 * the opposition's band falls. Spiral out to the nearest open tile.
 */
export function placeOnOpen(
  sim: Sim,
  typeOf: Map<string, number>
): (id: string, side: number, x: number, y: number, facing?: number) => number {
  const tileFor = openTileFor(sim, typeOf);
  return (id, side, x, y, facing = 0) => {
    const [ox, oy] = tileFor(id, x, y);
    return sim.spawn(typeOf.get(id) as number, side, fx.from(ox + 0.5), fx.from(oy + 0.5), facing);
  };
}

/**
 * The tile `placeOnOpen` would stand a body of unit `id` on, asked for at (x, y), WITHOUT spawning it: for a body
 * something else spawns, which is the `&works` builder (`sandbox-works.ts`'s `sandboxWorksBuilders`), raised by a
 * `MissionRuntime` that refuses a blocked tile outright instead of searching. One rule, one copy.
 */
export function openTileFor(
  sim: Sim,
  typeOf: Map<string, number>
): (id: string, x: number, y: number) => [number, number] {
  // GH-1360 S1: a tile is open for a body iff it is clear on THAT body's own mask (the vehicle mask, `blocked |
  // boulder`, for anything that paths as a vehicle; air and foot read `blocked`) and no living body already stands
  // on it. "Vehicle" is the type's `moveDomain`, which is `mobility.wheeled` and never `FOOT_ROLES` (CLAUDE.md).
  const occupied = (): Set<number> => {
    const taken = new Set<number>();
    const st = sim.state;
    for (let i = 0; i < sim.entityCount; i++) {
      if (st.alive[i] !== 1) continue;
      taken.add((st.posY[i] >> 16) * sim.width + (st.posX[i] >> 16));
    }
    return taken;
  };

  const open = (x: number, y: number, mask: Uint8Array, taken: Set<number>): [number, number] => {
    const cx = Math.min(Math.max(Math.round(x), 0), sim.width - 1);
    const cy = Math.min(Math.max(Math.round(y), 0), sim.height - 1);
    let firstClear: [number, number] | null = null;
    for (let r = 0; r <= MAX_RING; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = cx + dx;
          const ty = cy + dy;
          if (tx < 0 || ty < 0 || tx >= sim.width || ty >= sim.height) continue;
          const t = ty * sim.width + tx;
          if (mask[t] !== 0) continue;
          if (!taken.has(t)) return [tx, ty];
          // Last resort only: a crowded pocket stacks rather than strands a body in rock.
          firstClear ??= [tx, ty];
        }
      }
    }
    return firstClear ?? [cx, cy];
  };

  return (id, x, y) => {
    const t = typeOf.get(id);
    if (t === undefined) throw new Error(`unknown unit ${id}`);
    const mask = sim.unitTypes[t].moveDomain === DOMAIN_VEHICLE ? sim.blockedVehicle : sim.blocked;
    return open(x, y, mask, occupied());
  };
}
