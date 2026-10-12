import { fx, type Sim } from '@lions/sim';

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
  const open = (x: number, y: number): [number, number] => {
    const cx = Math.min(Math.max(Math.round(x), 0), sim.width - 1);
    const cy = Math.min(Math.max(Math.round(y), 0), sim.height - 1);
    for (let r = 0; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = cx + dx;
          const ty = cy + dy;
          if (tx < 0 || ty < 0 || tx >= sim.width || ty >= sim.height) continue;
          if (sim.blocked[ty * sim.width + tx] === 0) return [tx, ty];
        }
      }
    }
    return [cx, cy];
  };

  return (id, side, x, y, facing = 0) => {
    const t = typeOf.get(id);
    if (t === undefined) throw new Error(`unknown unit ${id}`);
    const [ox, oy] = open(x, y);
    return sim.spawn(t, side, fx.from(ox + 0.5), fx.from(oy + 0.5), facing);
  };
}
