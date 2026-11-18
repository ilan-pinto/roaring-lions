// GH-1395 slice 1: amendments to the orders and the named challenge, as data (design
// 2026-11-15-challenge-star-design.md §3-§5; the lead's rulings D1-D13 on PR 1459, 16 Nov 2026).
//
// An amendment is a list of operations from the CLOSED overlay set (`overlays.ts`), applied by `applyOverlays`
// AFTER the difficulty posture, before the runtime is built: the sim never learns an amendment exists. A mission
// offers three (D8); its challenge names the ones that must be on (extras allowed, D7) and a predicate over the
// run's own result row. A beaten challenge pays 10 Roar coins ONCE PER ACCOUNT (D1, `@lions/economy`'s
// `roarEarn`, the Worker's `victory`), pays no credits (D3), counts toward no unit unlock (D2), and is not
// recorded on Easier (GH-1394 D9; `packages/app/src/challenge.ts`).
//
// Leaf package rule (CLAUDE.md): @lions/data imports no other @lions package, so the result row and the mission
// are typed structurally here, and `TICKS_PER_TARGET_MINUTE` is a literal pinned against @lions/sim's
// `TICKS_PER_SECOND` from outside this package (`tools/src/challenges.test.ts`).

import amendmentsJson from '../../../data/challenges/amendments.json';
// The pilot (D9): one mission per phase, in sorted file order. `index.test.ts` pins this list to the directory.
import bsBreach from '../../../data/challenges/beit_sahwan_breach.json';
import bs1 from '../../../data/challenges/beit_sahwan_1_recon.json';
import bs2 from '../../../data/challenges/beit_sahwan_2_foothold.json';
import bs3 from '../../../data/challenges/beit_sahwan_3_clearance.json';
import bs4 from '../../../data/challenges/beit_sahwan_4_subterranean.json';
import uz2 from '../../../data/challenges/umm_zeitoun_2_buildup.json';
import type { OverlayOp } from './overlays';
// The index the coin rules share and the ledger key live apart, so the entry chunk never carries this catalogue.
export { CHALLENGE_LEDGER_KEY, challengeMissionIds, hasChallenge } from './challenge-ids';

/** One generic amendment (`data/challenges/amendments.json`). */
export interface AmendmentJson {
  id: string;
  /** English source text (data text, as a mission's name is; not an en.json key). */
  label: string;
  blurb: string;
  ops: readonly OverlayOp[];
}

export interface AmendmentCatalogue {
  amendments: readonly AmendmentJson[];
}

/** The CLOSED predicate set (§5.1). Every named field must hold. */
export interface ChallengeWin {
  conduct_at_least?: number;
  lost_at_most?: number;
  ticks_at_most_target?: true;
  carries_all?: true;
}

/** A mission's offers and its one named challenge (`data/challenges/<mission>.json`). */
export interface MissionChallengeJson {
  mission: string;
  offers: readonly string[];
  /** D8's mission-specific amendment, where it earns its place: the library's shape, offered by this mission only. */
  own?: readonly AmendmentJson[];
  challenge: {
    id: string;
    label: string;
    blurb: string;
    amendments: readonly string[];
    win: ChallengeWin;
  };
}

/** The shipped library. */
export const amendments: AmendmentCatalogue = amendmentsJson as unknown as AmendmentCatalogue;

/** Every mission's challenge, sorted by mission id. */
// Written in sorted order rather than sorted at load: a call at module top level is a side effect the bundler must keep,
// and it kept this whole catalogue on the app's entry chunk through @lions/data's index (webgpu:bundle, +7.4 KB).
// `challenges.test.ts` pins the order.
export const missionChallenges: readonly MissionChallengeJson[] = [bs1, bs2, bs3, bs4, bsBreach, uz2] as unknown as MissionChallengeJson[];

/** One mission's challenge mark: the challenge's id and the run's own row. */
export interface ChallengeMark {
  id: string;
  roe: number;
  ticks: number;
  lost: number;
}

/** 60 s of 20 Hz sim ticks: the unit `target_minutes` is compared in. A literal, because this leaf package cannot
 *  import @lions/sim; `tools/src/challenges.test.ts` pins it to `60 * TICKS_PER_SECOND`. */
export const TICKS_PER_TARGET_MINUTE = 1200;

export function challengeOf(missionId: string): MissionChallengeJson | undefined {
  return missionChallenges.find((c) => c.mission === missionId);
}


/**
 * The op lists a set of amendment ids applies, in LIBRARY order (then the mission's own) with duplicates dropped, so
 * `['a', 'b']` and `['b', 'a']` build the same mission (a save or a replay that stores the ids reloads one mission,
 * D10). `missionId` given: every id must be one that mission offers, and its `own` amendment is known. Throws on an
 * unknown or unoffered id (a caller fault, never a player one: the deploy screen offers only the mission's three).
 */
export function amendmentOps(
  ids: readonly string[],
  missionId?: string,
  catalogue: AmendmentCatalogue = amendments
): readonly (readonly OverlayOp[])[] {
  if (ids.length === 0) return [];
  const c = missionId === undefined ? undefined : challengeOf(missionId);
  const known: readonly AmendmentJson[] = [...catalogue.amendments, ...(c?.own ?? [])];
  for (const id of ids) {
    if (!known.some((a) => a.id === id)) throw new Error(`amendments: no amendment "${id}" in the library${missionId === undefined ? '' : ` or ${missionId}'s own`}`);
    if (missionId !== undefined && !(c?.offers ?? []).includes(id)) throw new Error(`amendments: ${missionId} does not offer "${id}"`);
  }
  const on = new Set(ids);
  return known.filter((a) => on.has(a.id)).map((a) => a.ops);
}

/** D7: the challenge is armed when every amendment it names is on; extra amendments on top are allowed. */
export function challengeArmed(c: MissionChallengeJson, on: readonly string[]): boolean {
  return c.challenge.amendments.every((id) => on.includes(id));
}

/** The run's own result row, as the runtime's end and the playtest harness both read it. */
export interface ChallengeRun {
  roe: number;
  /** Sim ticks at the end (20 a second). */
  ticks: number;
  /** Player units that died, built ones included (the ledger's `lost`). */
  lost: number;
  /** Every `carries: true` secondary of the mission AS PLAYED is complete. */
  carriesAll: boolean;
}

/** The predicate (§5.1), on one run's row. `targetMinutes` is the mission's own `target_minutes` (no overlay moves it). */
export function challengeMet(win: ChallengeWin, run: ChallengeRun, targetMinutes: number): boolean {
  if (win.conduct_at_least !== undefined && !(run.roe >= win.conduct_at_least)) return false;
  if (win.lost_at_most !== undefined && !(run.lost <= win.lost_at_most)) return false;
  if (win.ticks_at_most_target === true && !(run.ticks <= targetMinutes * TICKS_PER_TARGET_MINUTE)) return false;
  if (win.carries_all === true && !run.carriesAll) return false;
  return true;
}

/** Whether mark `a` should replace `b` as this campaign's best: faster, then higher Conduct (`betterResult`'s order
 *  without the stars, which a challenge run grades separately). */
export function betterMark(a: ChallengeMark, b: ChallengeMark): boolean {
  if (a.ticks !== b.ticks) return a.ticks < b.ticks;
  return a.roe > b.roe;
}
