import type { Sim } from '@lions/sim';
import { SANDBOX_KDF } from '../sandbox-force';
import type { SandboxAnchors } from '../sandbox-anchors';
import { hostileFacing } from '../sandbox-facing';
import { placeOnOpen } from '../sandbox-place';

export interface VersusForce {
  bySide: [number[], number[]];
}

/** The mirror match (network design §9, N1): the sandbox's KDF force on each
 *  side, side 1's offsets mirrored through its own anchor so the two forces
 *  face each other in the same formation. No Sarim, no civilians: in a room
 *  the only opposition is the other seat. */
export function versusSpawns(sim: Sim, typeOf: Map<string, number>, anchors: SandboxAnchors): VersusForce {
  const place = placeOnOpen(sim, typeOf);
  const [ax, ay] = anchors.friendly;
  const [bx, by] = anchors.hostile;
  const faceA = hostileFacing(bx, by, ax, ay); // side 0 looks at side 1
  const faceB = hostileFacing(ax, ay, bx, by); // side 1 looks at side 0
  const bySide: [number[], number[]] = [[], []];
  for (const [id, dx, dy] of SANDBOX_KDF) bySide[0].push(place(id, 0, ax + dx, ay + dy, faceA));
  for (const [id, dx, dy] of SANDBOX_KDF) bySide[1].push(place(id, 1, bx - dx, by - dy, faceB));
  return { bySide };
}

/** The tile a seat's camera starts on: its own side's anchor. */
export function campOf(anchors: SandboxAnchors, side: 0 | 1): readonly [number, number] {
  return side === 0 ? anchors.friendly : anchors.hostile;
}
