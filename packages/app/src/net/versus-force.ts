import type { Faction, MatchConfig, SpawnEnd } from '@lions/net';
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

/** The Sarim force for a quick KDF-vs-Sarim friend match (2026-10-14, the
 *  version before N3's per-seat economy): a placed force, no production,
 *  6,736 of value against the KDF force's 6,664. Sarim fights the way its
 *  doctrine says -- a wall of Kornet teams (`atgm_cell`) over a ZU-23 gun
 *  truck screen against air and infantry, two MANPADS, a Grad battery's two
 *  launchers and a rifle section on each flank.
 *
 *  Tuned on the headless versus probe (each side's whole force attack-moving
 *  on the other's centre; composition and count only, never a unit stat):
 *  an equal-value mix with infantry, RPGs, technicals and a mortar lost
 *  24 of 24 on both maps, because a Namer's 30 mm and a Lavi's gun clear
 *  anything that walks; the Kornet is the one Sarim weapon that kills armour
 *  through the Trophy. The PR carries the table. Offsets read as
 *  `VERSUS_KDF`'s do -- dx toward the enemy, dy along the line -- and side 1
 *  mirrors them the same way. */
export const VERSUS_SARIM: readonly SandboxPlacement[] = [
  ['sarim_rifles', 2, -5],
  ['sarim_rifles', 2, 5],
  ['atgm_cell', 1, -9],
  ['atgm_cell', 1, -7],
  ['atgm_cell', 1, -5],
  ['atgm_cell', 1, -4],
  ['atgm_cell', 1, -2],
  ['atgm_cell', 1, 0],
  ['atgm_cell', 1, 2],
  ['atgm_cell', 1, 4],
  ['atgm_cell', 1, 5],
  ['atgm_cell', 1, 7],
  ['atgm_cell', 1, 9],
  ['atgm_cell', 0, -7],
  ['atgm_cell', 0, 0],
  ['atgm_cell', 0, 7],
  ['gun_truck', -2, -9],
  ['manpad_team', -2, -6],
  ['gun_truck', -2, -4],
  ['manpad_team', -2, -1],
  ['gun_truck', -2, 1],
  ['gun_truck', -2, 4],
  ['gun_truck', -2, 6],
  ['gun_truck', -2, 9],
  ['rocket_battery', -4, -5],
  ['rocket_battery', -4, 5],
];

/** The force a faction fields in a versus room. */
export function versusForceOf(faction: Faction): readonly SandboxPlacement[] {
  return faction === 'sarim' ? VERSUS_SARIM : VERSUS_KDF;
}

/** Each SIDE's faction in a versus room (index 0 is side 0), from the config
 *  both seats share. KDF on both sides -- the mirror -- for no config. */
export function factionsBySide(config: Pick<MatchConfig, 'seats'> | null): [Faction, Faction] {
  const out: [Faction, Faction] = ['kdf', 'kdf'];
  for (const s of config?.seats ?? []) out[s.side] = s.faction;
  return out;
}

/** Every unit type a versus room can field, for the mesh roster. */
export function versusUnitTypes(factions: readonly [Faction, Faction]): Set<string> {
  return new Set(factions.flatMap((f) => versusForceOf(f).map(([id]) => id)));
}

/** A versus match (network design §9, N1): each side's faction force --
 *  `VERSUS_KDF` (the sandbox's KDF force plus `VERSUS_EXTRA`) or
 *  `VERSUS_SARIM` -- on its own END's anchor (`ends`, by side). The force at
 *  the `hostile` end has its offsets mirrored through that anchor so the two
 *  forces face each other -- by END, never by side (LD1, N3 Task 2): a Sarim
 *  host is side 1 at the friendly end and stands exactly where a Sarim side 0
 *  stood before LD1. The FRIENDLY end's force is placed first, whichever side
 *  stands there, so entity ids, and with them every per-entity RNG stream, do
 *  not depend on which side a seat plays. With the default `ends` (side 0
 *  friendly) a KDF-vs-KDF room spawns exactly what it always did. No
 *  civilians: in a room the only opposition is the other seat.
 *
 *  `typeOf` is one id -> type map for both sides (the headless probes, and
 *  every room before per-seat kit), or one per SIDE (`buildMatchWorld`), so
 *  each side spawns the types its own kit registered. */
export function versusSpawns(
  sim: Sim,
  typeOf: Map<string, number> | readonly [Map<string, number>, Map<string, number>],
  anchors: SandboxAnchors,
  factions: readonly [Faction, Faction] = ['kdf', 'kdf'],
  ends: readonly [SpawnEnd, SpawnEnd] = ['friendly', 'hostile'],
): VersusForce {
  if (ends[0] === ends[1]) throw new Error(`versusSpawns: the two sides need two ends, got ${ends[0]} twice`);
  const typeOfBySide = typeOf instanceof Map ? [typeOf, typeOf] as const : typeOf;
  const atFriendly: 0 | 1 = ends[0] === 'friendly' ? 0 : 1;
  const atHostile: 0 | 1 = atFriendly === 0 ? 1 : 0;
  const placeF = placeOnOpen(sim, typeOfBySide[atFriendly]);
  const placeH = placeOnOpen(sim, typeOfBySide[atHostile]);
  const [ax, ay] = anchors.friendly;
  const [bx, by] = anchors.hostile;
  const faceA = hostileFacing(bx, by, ax, ay); // the friendly end looks at the hostile one
  const faceB = hostileFacing(ax, ay, bx, by); // the hostile end looks back
  const bySide: [number[], number[]] = [[], []];
  for (const [id, dx, dy] of versusForceOf(factions[atFriendly])) bySide[atFriendly].push(placeF(id, atFriendly, ax + dx, ay + dy, faceA));
  for (const [id, dx, dy] of versusForceOf(factions[atHostile])) bySide[atHostile].push(placeH(id, atHostile, bx - dx, by - dy, faceB));
  return { bySide };
}

/** The tile a seat's camera starts on: its own END's anchor (`endOfSeat`). */
export function campOf(anchors: SandboxAnchors, end: SpawnEnd): readonly [number, number] {
  return end === 'friendly' ? anchors.friendly : anchors.hostile;
}
