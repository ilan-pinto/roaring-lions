import type { Sim } from '@lions/sim';
import { SANDBOX_KDF, type SandboxPlacement } from '../sandbox-force';
import type { SandboxAnchors } from '../sandbox-anchors';
import { hostileFacing } from '../sandbox-facing';
import { placeOnOpen } from '../sandbox-place';

export interface VersusForce {
  bySide: [number[], number[]];
}

/** What a versus side fields beyond the sandbox force: a second Spike team.
 *  The single-player sandbox (`SANDBOX_KDF`) has one `at_team` against a Sarim
 *  force that is mostly infantry, and the golden gate's quiet, vehicle and kitted
 *  scenarios photograph it -- it must not move. A mirror match is different: the
 *  only armour on the map is the other seat's two Lavis, and four units per side
 *  could hurt one (two Lavis, one Spike team, one Peten), so a battle was decided
 *  by whichever Lavi pair won the tank duel. It sits at the mirror of the first
 *  `at_team` across the formation's axis (`1, -2` -> `1, 2`), a free tile beside
 *  the jeep, and is APPENDED so every earlier placement keeps its index. */
export const VERSUS_EXTRA: readonly SandboxPlacement[] = [['at_team', 1, 2]];

/** The force each versus seat fields: the sandbox force plus `VERSUS_EXTRA`. */
export const VERSUS_KDF: readonly SandboxPlacement[] = [...SANDBOX_KDF, ...VERSUS_EXTRA];

/** The mirror match (network design §9, N1): the sandbox's KDF force plus
 *  `VERSUS_EXTRA` on each side, side 1's offsets mirrored through its own
 *  anchor so the two forces face each other in the same formation. No Sarim,
 *  no civilians: in a room the only opposition is the other seat. */
export function versusSpawns(sim: Sim, typeOf: Map<string, number>, anchors: SandboxAnchors): VersusForce {
  const place = placeOnOpen(sim, typeOf);
  const [ax, ay] = anchors.friendly;
  const [bx, by] = anchors.hostile;
  const faceA = hostileFacing(bx, by, ax, ay); // side 0 looks at side 1
  const faceB = hostileFacing(ax, ay, bx, by); // side 1 looks at side 0
  const bySide: [number[], number[]] = [[], []];
  for (const [id, dx, dy] of VERSUS_KDF) bySide[0].push(place(id, 0, ax + dx, ay + dy, faceA));
  for (const [id, dx, dy] of VERSUS_KDF) bySide[1].push(place(id, 1, bx - dx, by - dy, faceB));
  return { bySide };
}

/** The tile a seat's camera starts on: its own side's anchor. */
export function campOf(anchors: SandboxAnchors, side: 0 | 1): readonly [number, number] {
  return side === 0 ? anchors.friendly : anchors.hostile;
}
