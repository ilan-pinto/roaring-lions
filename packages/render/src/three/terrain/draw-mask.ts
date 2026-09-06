/**
 * The blocked mask the GROUND is drawn from, as opposed to the one the sim
 * paths and sees with.
 *
 * `ground.ts` draws a blocked tile as a flat terrace with no albedo -- right
 * for a building pad and a rock wall. A LOW-PROFILE structure is blocked for
 * movement too, but it is a fence or a compound wall standing on the ground,
 * not a slab covering it: drawn from the sim's own mask, a chain-link run
 * came up on a strip of bare grey (2026-09-06, Wadi Halam IV), grass on both
 * sides and none under the wire. This clears the tiles of every LIVE
 * low-profile structure so the ground -- sand, grass, scatter -- continues
 * under the mesh. A dead one keeps the sim's mask: its rubble sits on a pad,
 * which is what rubble does.
 *
 * Render only. The sim never sees this array; `Sim.blocked` is untouched.
 */
export interface DrawMaskWorld {
  readonly width: number;
  readonly height: number;
  readonly blocked: Uint8Array;
  structureAt(x: number, y: number): number;
  readonly structures: { readonly alive: Uint8Array; readonly typeIdx: Uint16Array | Uint8Array | Int32Array | number[] };
  readonly structureTypes: readonly { readonly lowProfile: boolean }[];
}

export function drawBlockedMask(world: DrawMaskWorld): Uint8Array {
  const out = new Uint8Array(world.blocked);
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const t = y * world.width + x;
      if (out[t] === 0) continue;
      const s = world.structureAt(x, y);
      if (s < 0 || world.structures.alive[s] !== 1) continue;
      if (world.structureTypes[world.structures.typeIdx[s]].lowProfile) out[t] = 0;
    }
  }
  return out;
}
