/**
 * Free play as Sarim (GH-1381): the force the player commands and the one it faces, when `/free-play/<map>?side=sarim`.
 *
 * Loaded on demand (`main.ts`, `importWithRetry`) and only for a Sarim pick, so a KDF Free play, a mission and the
 * entry chunk never carry it (`content-wiring.test.ts`).
 *
 * Nothing here is new content. The two forces are the versus room's (PR 1507): the player fields `VERSUS_SARIM` at the
 * friendly anchor and faces `VERSUS_KDF` (the sandbox's KDF force plus the second Spike team) at the hostile anchor,
 * placed by `versusSpawns` itself -- the hostile end's offsets mirrored through its anchor, both ends facing each
 * other -- so the ground looks exactly as a KDF v Sarim room with a Sarim host does. The SIDES are single-player's:
 * the player is side 0 (seat 0, human-held, the viewer) as in every Free play, so nothing about who commands what
 * changes, and the KDF opposition stands on side 1 as the Sarim opposition does in a KDF Free play. The sim runs
 * both sides on the same rules whichever faction stands on them.
 *
 * The anchors are the sandbox's (`sandboxAnchors`), not a versus room's measured seats: the Sarim pick walks the same
 * ground the KDF pick does on every map, with the forces swapped.
 */
import type { Faction } from '@lions/net';
import type { Sim } from '@lions/sim';
import type { SandboxAnchors } from './sandbox-anchors';
import { SANDBOX_CIV } from './sandbox-force';
import { sandboxCivilians, type SandboxForce } from './sandbox-spawn';
import { versusSpawns, versusUnitTypes } from './net/versus-force';

/** Each SIDE's faction in a Sarim Free play: the player's (side 0) first. */
export const SARIM_FREE_PLAY_FACTIONS: readonly [Faction, Faction] = ['sarim', 'kdf'];

/** The extras a Sarim Free play can take that put a unit on the map (`sideFlags` has already dropped the KDF-only ones). */
export interface SarimSandboxExtras {
  civ: boolean;
}

/** Both forces, then (`&civ`) the crowd, last, as the KDF sandbox places it. */
export function sarimSandboxSpawns(sim: Sim, typeOf: Map<string, number>, anchors: SandboxAnchors, extras: SarimSandboxExtras): SandboxForce {
  const { bySide } = versusSpawns(sim, typeOf, anchors, SARIM_FREE_PLAY_FACTIONS);
  return { player: bySide[0], civilians: extras.civ ? sandboxCivilians(sim, typeOf, anchors) : [] };
}

/** Every unit type a Sarim Free play places, for the mesh roster: read off the same tables `versusSpawns` iterates. */
export function sarimSandboxUnitTypes(extras: SarimSandboxExtras): Set<string> {
  const out = versusUnitTypes(SARIM_FREE_PLAY_FACTIONS);
  if (extras.civ) for (const [id] of SANDBOX_CIV) out.add(id);
  return out;
}
