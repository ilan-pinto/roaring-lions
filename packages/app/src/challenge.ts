/**
 * GH-1395 slice 1: whether a won campaign run beat its mission's challenge, and the campaign-ledger mark it leaves
 * (design 2026-11-15-challenge-star-design.md §5; the lead's rulings D1-D13 on PR 1459, 16 Nov 2026). One module so
 * the victory handler and the playtest harness cannot disagree, as `campaign-pay.ts` and `posture.ts` are.
 *
 * A challenge is beaten on a VICTORY in which every amendment the challenge names was on (extras allowed, D7), the run
 * was not on Easier (GH-1394 D9), the mission was OPEN in the campaign the run booted in (the guard `payScope` uses:
 * "New campaign" plus `/mission/<id>` must not farm a mark), and the predicate held on the run's own row. Then:
 *   - the campaign ledger gets a mark under `campaign.challenge_results` (best-of, this campaign; New campaign clears it);
 *   - the victory reports `challenge: true`, and `settleVictory` (victory-settle.ts) pays 10 Roar coins ONCE PER ACCOUNT
 *     on the wallet's lifetime record (`payChallenge`; the Worker's `victory` holds the same rule against `earn_lifetime`).
 * Everything here is loaded LAZILY: main.ts reaches it only through `./posture`'s re-export, so the entry chunk (at the
 * `webgpu:bundle` ceiling) carries none of it.
 * It pays no credits (D3): `creditsFor` is called exactly as for any win, on the mission as played. It counts toward no
 * unit unlock (D2): `starsEarned` reads `campaign.mission_results` only. The sim never learns an amendment exists.
 */
import {
  amendmentOps,
  amendments as amendmentLibrary,
  applyOverlays,
  betterMark,
  challengeArmed,
  challengeMet,
  challengeOf,
  postureApplies,
  postureOf,
  postures,
  CHALLENGE_LEDGER_KEY,
  type AmendmentJson,
  type ChallengeMark,
  type ChallengeRun,
  type MissionChallengeJson,
  type OverlayMission,
} from '@lions/data';
import type { LedgerData, MissionRuntime } from '@lions/sim';
// GH-1418: the campaign this build plays (the desktop demo's cut, or the whole of world.json), as the board opens it.
import { campaignWorldJson } from './shell/demo-cut';
import { missionOpen, parseWorld, type ParsedWorld } from './campaign';
import { t } from './i18n/t';

export { CHALLENGE_LEDGER_KEY };
export type { ChallengeMark, ChallengeRun };

/**
 * `mission` as the campaign plays it: the ledger's posture first, then the amendments the player put on (D7, §3.3).
 * No amendments is exactly `campaignMission` (posture.ts), the mission itself at Standard. Throws on an amendment the
 * mission does not offer (a caller fault: the deploy screen offers only the mission's own three).
 */
export function amendedMission<T extends OverlayMission & { id: string }>(
  mission: T,
  ledger: Readonly<Record<string, unknown>> | null | undefined,
  amendments: readonly string[],
  label?: (key: string) => string
): T {
  return applyOverlays(mission, { posture: postureOf(ledger), amendments: amendmentOps(amendments, mission.id) }, postures, label === undefined ? {} : { label });
}

export interface ChallengeRunInput {
  missionId: string;
  result: 'ongoing' | 'victory' | 'defeat';
  /** The amendment ids the run was played with. */
  amendments: readonly string[];
  /** The campaign ledger as the run BOOTED (before this victory wrote to it): it says the posture and what was open. */
  ledgerAtBoot: LedgerData | undefined;
  world: ParsedWorld;
  /** The authored mission's `target_minutes` (no overlay moves it). */
  targetMinutes: number;
  run: ChallengeRun;
}

/** The run's own row off a finished runtime, as the victory handler and the playtest harness both read it: `lost` is
 *  every player unit lost (`lostByType` summed, the ledger's `lost`), `carriesAll` every carrying secondary complete,
 *  `objectivesDone` the ids of every objective complete at the end. */
export function runRowOf(rt: Pick<MissionRuntime, 'lostByType' | 'objectiveList'>, roe: number, ticks: number): ChallengeRun {
  return {
    roe,
    ticks,
    lost: Object.values(rt.lostByType()).reduce((n, k) => n + k, 0),
    carriesAll: rt.objectiveList.every((o) => o.primary || o.carries !== true || o.status === 'complete'),
    objectivesDone: rt.objectiveList.filter((o) => o.status === 'complete').map((o) => o.id),
  };
}

/** The mark this run earned, or null when it beat no challenge. Pure. */
export function challengeMarkFor(a: ChallengeRunInput): ChallengeMark | null {
  if (a.result !== 'victory') return null;
  const c = challengeOf(a.missionId);
  if (c === undefined) return null;
  if (postureOf(a.ledgerAtBoot) === 'easier') return null;
  if (!missionOpen(a.world, a.missionId, a.ledgerAtBoot)) return null;
  if (!challengeArmed(c, a.amendments)) return null;
  if (!challengeMet(c.challenge.win, a.run, a.targetMinutes)) return null;
  return { id: c.challenge.id, roe: a.run.roe, ticks: a.run.ticks, lost: a.run.lost };
}

/** `ledger` with `mark` recorded for `missionId`, best-of (faster, then higher Conduct); the same ledger back when
 *  there is no mark or the stored one is better. Keys rebuilt in sorted order, like the runtime's own result keys. */
export function withChallengeMark<L extends LedgerData>(ledger: L, missionId: string, mark: ChallengeMark | null | false | undefined): L {
  if (!mark) return ledger;
  const prior = challengeMarksOf(ledger);
  const held = Object.hasOwn(prior, missionId) ? prior[missionId] : undefined;
  if (held !== undefined && !betterMark(mark, held)) return ledger;
  const merged: Record<string, ChallengeMark> = { ...prior, [missionId]: mark };
  const out: Record<string, ChallengeMark> = {};
  for (const k of Object.keys(merged).sort()) out[k] = merged[k];
  return { ...ledger, [CHALLENGE_LEDGER_KEY]: out };
}

/**
 * C9: this campaign's marks, well-shaped rows only. The ledger sanitiser (`@lions/economy` ledger-shape, on the entry
 * chunk) has no rule for the key, on purpose: the key's only readers are here, loaded lazily, and they read through
 * this, so a hand-edited or wrong-shaped row is dropped where it is read and never reaches a coin (the coin's record is
 * the wallet's, never the ledger's).
 */
export function challengeMarksOf(ledger: LedgerData | undefined): Record<string, ChallengeMark> {
  const raw = ledger?.[CHALLENGE_LEDGER_KEY];
  const out: Record<string, ChallengeMark> = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const m = v as Partial<ChallengeMark> | null;
    if (k === '__proto__' || typeof m !== 'object' || m === null) continue;
    if (typeof m.id === 'string' && num(m.roe) && num(m.ticks) && num(m.lost)) out[k] = { id: m.id, roe: m.roe, ticks: m.ticks, lost: m.lost };
  }
  return out;
}

/** The amendments on top of a mission the posture has already been applied to (`campaignMission`): applyOverlays'
 *  own order, posture first and amendments last, in two calls. None: `mission` itself. */
export function amended<T extends OverlayMission & { id: string }>(mission: T, ids: readonly string[]): T {
  return applyOverlays(mission, { amendments: amendmentOps(ids, mission.id) });
}

/**
 * The victory handler's one call (main.ts, through the lazy `./posture`): the mark this run earned, or null. Reads the
 * run's own row off the runtime, the mission's own target, and the ledger the run BOOTED with.
 */
export function victoryMark(
  mission: { id: string },
  ledgerAtBoot: LedgerData | undefined,
  amendments: readonly string[] | undefined,
  rt: Pick<MissionRuntime, 'lostByType' | 'objectiveList'>,
  end: { result: 'ongoing' | 'victory' | 'defeat'; roeRating: number; tick: number }
): ChallengeMark | null {
  return challengeMarkFor({
    missionId: mission.id,
    result: end.result,
    amendments: amendments ?? [],
    ledgerAtBoot,
    world: parseWorld(campaignWorldJson()),
    targetMinutes: (mission as { target_minutes?: number }).target_minutes ?? 0,
    run: runRowOf(rt, end.roeRating, end.tick),
  });
}

// ---- slice 2: the deploy panel's gate, the run's ids, and the after-action rung ------------------------------------

/**
 * The challenge the deploy panel offers for `mission`, or null when it shows no panel. The lead's gates (GH-1395 slice
 * 2): a PILOT mission only (one with a challenge file); never the tutorial (`postureApplies`, keyed on the ledger
 * contract, never a name list); never on Easier (GH-1394 D9: an Easier run records no mark and pays no coin, so it is
 * offered none); and only for a mission OPEN at boot (`missionOpen`, the guard `challengeMarkFor` holds), so the panel
 * never promises a coin the run cannot earn. A resumed run is the caller's gate (`amendmentsForRun`): its ids are the save's.
 */
export function amendmentOffer(
  mission: (OverlayMission & { id: string }) | undefined,
  ledger: LedgerData | undefined,
  w: ParsedWorld = parseWorld(campaignWorldJson())
): MissionChallengeJson | null {
  if (mission === undefined || !postureApplies(mission)) return null;
  const c = challengeOf(mission.id);
  if (c === undefined) return null;
  if (postureOf(ledger) === 'easier') return null;
  if (!missionOpen(w, mission.id, ledger)) return null;
  return c;
}

/** The amendments a mission offers, in its own `offers` order, each with its data text (library or the mission's own). */
export function offeredAmendments(c: MissionChallengeJson): AmendmentJson[] {
  const known = [...amendmentLibrary.amendments, ...(c.own ?? [])];
  return c.offers.map((id) => {
    const a = known.find((x) => x.id === id);
    if (a === undefined) throw new Error(`amendments: ${c.mission} offers "${id}", which is in neither the library nor its own`);
    return a;
  });
}

/**
 * The amendment ids a run is played with, and whether the deploy panel is drawn (D10: these ids are the run's start
 * input, so the save, the replay and Restart carry them).
 * - A RESUMED run plays the save's ids, exactly, with no panel. Every saved id must still be one the mission offers,
 *   or the resume is refused (`refused`): a save must neither shed a restriction nor be rebuilt as another mission.
 * - A new run plays `requested` (the panel's last choice, carried through a restart) filtered to what
 *   `amendmentOffer` allows: an id the mission does not offer is dropped, duplicates go, and the order is the
 *   mission's own `offers` order, so one choice is one id list. No offer (not a pilot, the tutorial, Easier, not open):
 *   no ids and no panel, whatever was requested.
 */
export function amendmentsForRun(o: {
  mission: (OverlayMission & { id: string }) | undefined;
  ledger: LedgerData | undefined;
  requested?: readonly string[] | undefined;
  saved: readonly string[] | null;
  world?: ParsedWorld;
}): { ids: string[]; offer: MissionChallengeJson | null } | { refused: true } {
  if (o.saved !== null) {
    if (o.saved.length === 0) return { ids: [], offer: null };
    const c = o.mission === undefined ? undefined : challengeOf(o.mission.id);
    if (c === undefined || !o.saved.every((id) => c.offers.includes(id))) return { refused: true };
    return { ids: c.offers.filter((id) => o.saved?.includes(id)), offer: null };
  }
  const offer = amendmentOffer(o.mission, o.ledger, o.world);
  if (offer === null) return { ids: [], offer: null };
  const want = o.requested ?? [];
  return { ids: offer.offers.filter((id) => want.includes(id)), offer };
}

const mmss = (ticks: number): string => {
  const s = Math.floor(ticks / 20);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The after-action's challenge rung (`AfterActionInputs.challenge`). */
export interface ChallengeRungView {
  met: boolean;
  text: string;
}

/**
 * The after-action's fourth rung (design §5.3 2): the challenge, met or not, drawn only on a run played with
 * amendments on (none on: null, so an unamended debrief is unchanged). It is NOT a star (D2): the ladder's three
 * `LadderRung`s are untouched, and this is its own field. `met` is `mark !== null`: the one judgement
 * (`challengeMarkFor`), never re-derived here. The coins it paid are the report's award row, not this line.
 */
export function challengeRung(
  missionId: string,
  ids: readonly string[],
  mark: ChallengeMark | null,
  run: ChallengeRun,
  targetMinutes: number,
  /** The run's objectives with their text as played (the runtime's `objectiveList`): `objective_done` names its one. */
  objectives: readonly { readonly id: string; readonly text: string }[] = []
): ChallengeRungView | null {
  if (ids.length === 0) return null;
  const c = challengeOf(missionId);
  if (c === undefined) return null;
  const name = c.challenge.label;
  if (!challengeArmed(c, ids)) {
    const label = new Map(offeredAmendments(c).map((a) => [a.id, a.label] as const));
    const list = c.challenge.amendments.map((id) => label.get(id) ?? id).join(' · ');
    return { met: false, text: t('aar.challenge.unarmed', { name, list }) };
  }
  const w = c.challenge.win;
  const parts: string[] = [];
  if (w.conduct_at_least !== undefined) parts.push(t('aar.challenge.conduct', { roe: run.roe, need: w.conduct_at_least }));
  if (w.lost_at_most !== undefined) parts.push(t('aar.challenge.lost', { n: run.lost, most: w.lost_at_most }));
  if (w.ticks_at_most_target === true) parts.push(t('aar.challenge.clock', { clock: mmss(run.ticks), target: targetMinutes }));
  if (w.carries_all === true) parts.push(t(run.carriesAll ? 'aar.challenge.carried' : 'aar.challenge.carriedNot'));
  if (w.objective_done !== undefined) {
    const objective = objectives.find((o) => o.id === w.objective_done)?.text ?? w.objective_done;
    parts.push(t(run.objectivesDone.includes(w.objective_done) ? 'aar.challenge.objective' : 'aar.challenge.objectiveNot', { objective }));
  }
  return { met: mark !== null, text: t(mark !== null ? 'aar.challenge.met' : 'aar.challenge.missed', { name, detail: parts.join(' · ') }) };
}

/** The victory handler's rung call (main.ts, through `./posture`), on the same row `victoryMark` judged. */
export function victoryRung(
  mission: { id: string },
  amendments: readonly string[],
  mark: ChallengeMark | null,
  rt: Pick<MissionRuntime, 'lostByType' | 'objectiveList'>,
  end: { roeRating: number; tick: number }
): ChallengeRungView | null {
  return challengeRung(mission.id, amendments, mark, runRowOf(rt, end.roeRating, end.tick), (mission as { target_minutes?: number }).target_minutes ?? 0, rt.objectiveList);
}

export { settleVictory, type VictorySettle } from './victory-settle';
