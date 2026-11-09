/**
 * A flag raid as one seat reads it (GH-976 P3): where each flag's ground is, and how each raid is going. ONE function,
 * read by the browser's world marks (`main.ts`) and by the AI harness's `observe` (`tools/src/net/view.ts`), so a model
 * is shown the board a human is shown, as `points-view.ts` does for a points race.
 *
 * Fog: the state of both flags is PUBLIC by design, as the score of a points race is: a seat sees its own flag go
 * `contested` or `raided` while the raiders are still in the fog, because the count is on the strip of both players. The
 * units in the zones stay hidden (`sideView` lists contacts only in sight).
 *
 * Import-free on purpose, like `points-view.ts`: the harness's stdout-purity walk follows every import.
 */

/** The slice of `MissionRuntime` the board reads: its objective rows. */
export interface FlagRuntime {
  readonly objectiveList: readonly { readonly id: string; readonly status: string; readonly paused?: 'contested' | 'unheld'; readonly ticksLeft?: number }[];
}

/** The slice of the rules the board reads: a flag block as `flagBlockOf(file, setup)` returns it (GH-976 R0.22), so a set-up room
 *  and a v1 room are read alike. */
export interface FlagRules {
  readonly flags: { readonly friendly: { readonly at: readonly number[]; readonly size: readonly number[] }; readonly hostile: { readonly at: readonly number[]; readonly size: readonly number[] } };
  readonly holdS: number;
}

/** How the raid on one flag stands. `open`: nobody of the raiding side is on it. `raiding`: the raiders hold it alone and
 *  the count runs. `contested`: raiders and defenders are both on it, the count is at zero. `captured`: the hold was served. */
export type RaidState = 'open' | 'raiding' | 'contested' | 'captured';

export interface FlagLine {
  /** x, y, width, height, in tiles. */
  at: [number, number, number, number];
  state: RaidState;
  /** Whole seconds the raid has held it, in the current go (0 unless `raiding`). */
  held: number;
}

export interface FlagView {
  /** Seconds a raid must hold the ground alone. */
  holdSeconds: number;
  /** The flag this seat defends, and how the enemy's raid on it stands. */
  mine: FlagLine;
  /** The flag this seat raids, and how its own raid stands. */
  theirs: FlagLine;
}

/** The sim's tick rate, restated: the board imports nothing. */
const TICKS_PER_SECOND = 20;

/** The raid on `side`'s enemy: the objective `raid_flag_<side>` of `versusModeMissionOf`, read as a line. */
function raidOf(rt: FlagRuntime, side: 0 | 1, holdS: number, at: readonly number[], size: readonly number[]): FlagLine {
  const o = rt.objectiveList.find((x) => x.id === `raid_flag_${side}`);
  const rect: [number, number, number, number] = [at[0], at[1], size[0], size[1]];
  if (o === undefined) return { at: rect, state: 'open', held: 0 };
  if (o.status === 'complete') return { at: rect, state: 'captured', held: holdS };
  if (o.paused === 'contested') return { at: rect, state: 'contested', held: 0 };
  if (o.paused === 'unheld') return { at: rect, state: 'open', held: 0 };
  const whole = holdS * TICKS_PER_SECOND;
  const left = o.ticksLeft ?? whole;
  // Not yet stepped (or not one tick served): nobody has begun, so the flag is open.
  if (left >= whole) return { at: rect, state: 'open', held: 0 };
  return { at: rect, state: 'raiding', held: Math.floor((whole - left) / TICKS_PER_SECOND) };
}

/** `viewer`'s board, given the END its side stands at (`endOfViewer`; the other side is at the other end). */
export function flagViewOf(rt: FlagRuntime, rules: FlagRules, viewer: 0 | 1, endOfViewer: 'friendly' | 'hostile'): FlagView {
  const holdS = rules.holdS;
  const theirEnd = endOfViewer === 'friendly' ? 'hostile' : 'friendly';
  const enemy: 0 | 1 = viewer === 0 ? 1 : 0;
  return {
    holdSeconds: holdS,
    mine: raidOf(rt, enemy, holdS, rules.flags[endOfViewer].at, rules.flags[endOfViewer].size),
    theirs: raidOf(rt, viewer, holdS, rules.flags[theirEnd].at, rules.flags[theirEnd].size),
  };
}

/** One outlined zone as the renderer takes it (`ObjectiveZoneView`, restated: this file imports nothing). */
export interface FlagZoneMark {
  id: string;
  rect: readonly number[];
  state: 'held' | 'unheld' | 'contested' | 'target';
}

/**
 * The two flags as the world outlines them, by the renderer's own zone states: ground you may take is dashed (`unheld`), ground
 * you hold alone is solid (`held`), a fight for it pulses (`contested`), and ground the enemy holds is the hostile colour
 * (`target`). Your flag with nobody on it is solid: it is yours.
 */
export function flagMarksOf(view: FlagView): FlagZoneMark[] {
  const theirs: FlagZoneMark['state'] = view.theirs.state === 'contested' ? 'contested' : view.theirs.state === 'open' ? 'unheld' : 'held';
  const mine: FlagZoneMark['state'] = view.mine.state === 'contested' ? 'contested' : view.mine.state === 'open' ? 'held' : 'target';
  return [
    { id: 'flag:theirs', rect: view.theirs.at, state: theirs },
    { id: 'flag:mine', rect: view.mine.at, state: mine },
  ];
}
