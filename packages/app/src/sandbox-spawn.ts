import type { Sim } from '@lions/sim';
import type { SandboxAnchors } from './sandbox-anchors';
import { hostileFacing } from './sandbox-facing';
import { placeOnOpen } from './sandbox-place';
import {
  SANDBOX_CIV,
  SANDBOX_ENEMY,
  SANDBOX_KDF,
  SANDBOX_SUR,
  SANDBOX_TUNNEL_KDF,
  type SandboxExtras,
} from './sandbox-force';

export interface SandboxForce {
  /** Side 0. Who can shepherd a civilian, and who can carry one. */
  player: number[];
  /** Side 2. A CONTIGUOUS id block, which is what makes the four figures come
   *  out two apiece — `pickMeshVariant` is `entityId % variants.length`. */
  civilians: number[];
}

/**
 * The sandbox force, placed relative to the map's own anchors.
 *
 * The offsets are the coordinates the hardcoded version used, expressed
 * against beit_sahwan_outskirts' `kdf_assembly` and `town_center` — so that
 * map's sandbox is unchanged, and every other map gets the same formation
 * translated onto its own ground.
 *
 * Out of `main.ts` so a test can build the force the app actually builds
 * rather than a second copy of this loop (`sandbox-force.test.ts` pins that it
 * garrisons nobody). The five placement TABLES live in `./sandbox-force`:
 * `sandboxUnitTypes` there answers "which unit types will this sandbox place"
 * off the very arrays this function iterates, so the mesh plan cannot fall
 * behind the force.
 *
 * Returns the ids it made, in two lists, because `&civ` needs both: the
 * civilian flight rule takes the crowd it steps and the force that shepherds
 * it. Nothing else reads them.
 */
export function sandboxSpawns(
  sim: Sim,
  typeOf: Map<string, number>,
  anchors: SandboxAnchors,
  extras: SandboxExtras = { tunnel: false, sur: false, civ: false, works: false }
): SandboxForce {
  // The nearest-open-tile placer is shared with the mirror match
  // (`sandbox-place.ts`): the same rule, one copy.
  const spawn = placeOnOpen(sim, typeOf);

  const [fxA, fyA] = anchors.friendly;
  const [hxA, hyA] = anchors.hostile;
  // Hostiles face the friendly anchor rather than a fixed compass direction:
  // "west" was right for one map and is meaningless on any other. A full turn
  // is 1.0 in this fixed-point angle (WEST, a half turn, is 32768); the sim's
  // LUT atan2 returns it already normalised into [0, 1), engine-independent.
  const facing = hostileFacing(fxA, fyA, hxA, hyA);

  const force: SandboxForce = { player: [], civilians: [] };
  for (const [id, dx, dy] of SANDBOX_KDF) force.player.push(spawn(id, 0, fxA + dx, fyA + dy));
  if (extras.tunnel) {
    for (const [id, dx, dy] of SANDBOX_TUNNEL_KDF) {
      force.player.push(spawn(id, 0, fxA + dx, fyA + dy));
    }
  }
  for (const [id, dx, dy] of SANDBOX_ENEMY) spawn(id, 1, hxA + dx, hyA + dy, facing);
  if (extras.sur) {
    for (const [id, dx, dy] of SANDBOX_SUR) spawn(id, 1, hxA + dx, hyA + dy, facing);
  }
  // Civilians go LAST, on side 2, so their ids are one unbroken run whatever
  // the other flags added before them. The variant rotation is arithmetic on
  // the id, so a gap in the block is a repeated figure.
  //
  // They stand on the MIDPOINT of the two anchors: a mission puts civilians on
  // the ground being fought over, and anywhere else here would be a crowd the
  // player's advance never reaches — which is the whole of what `&civ` is for.
  if (extras.civ) {
    const cx = (fxA + hxA) / 2;
    const cy = (fyA + hyA) / 2;
    for (const [id, dx, dy] of SANDBOX_CIV) force.civilians.push(spawn(id, 2, cx + dx, cy + dy));
  }
  return force;
}
