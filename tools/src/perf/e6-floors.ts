/**
 * The floors of `pnpm e6:capture` (E6 chunk D, GH-274, spec 2026-10-24 section 8), kept PURE so the
 * argument they make can be tested without a browser. The browser half is `e6-captures.ts`.
 *
 * ## Why the raw runs are stored and the floors are derived from them
 *
 * `blast-captures.ts` writes a floor as a number beside a `measured` record and has a spec assert the
 * third. Here the READINGS are the data and `deriveFloor` is the only thing that turns them into a
 * floor, so a floor cannot be edited without its evidence moving, and the evidence cannot be dropped
 * without the floor disappearing (an uncalibrated key judges as a FAILURE, never as a pass).
 *
 * ## The rule (R-M)
 *
 * **A floor is a third of the smallest of the measured runs**, per metric, rounded DOWN, with the run
 * count stored beside it. A range with no sample size is an anecdote. A layer toggle that reads zero
 * must FAIL a floor check (`debug-layers.ts`'s argument), because a layer that resolves to no objects
 * produces a zero delta and a check that passed on zero would read a deleted layer as healthy.
 *
 * ## The two kinds of key
 *
 * - `floor`: the toggle must MOVE the frame (a layer that is drawing something).
 * - `zero`: the toggle must move it by EXACTLY 0 px / 0.0000 (a negative control: the beam must not
 *   draw while locked out, or behind smoke; a dive must draw no missile). A `zero` key is only a
 *   witness when its positive control (`controlOf`) is a `floor` key read in the same run, so a zero
 *   cannot come from a toggle that never works.
 */

export interface Reading {
  readonly diffPixels: number;
  readonly meanAbsChannelDelta: number;
}

export type FloorKind = 'floor' | 'zero';

export interface FloorSpec {
  readonly kind: FloorKind;
  /** The spec 8 subject this key belongs to (S1..S8). */
  readonly subject: string;
  /** The debug layer hidden for the A/B. */
  readonly layer: string;
  /** Where in the subject's timeline it is read. */
  readonly rung: string;
  /** A `zero` key: the `floor` key, read in the same run, that proves the toggle works. */
  readonly controlOf?: string;
  /** One sentence: why this rung and layer. */
  readonly why: string;
}

/** Every key the harness reads, in spec order. */
export const E6_KEYS = {
  'S1/swarm': {
    kind: 'floor', subject: 'S1', layer: 'swarm', rung: 'a full swarm hovering, tick 20',
    why: 'the bodies, the rotor discs and every member in flight: the swarm layer must have something to hide',
  },
  'S3/beam': {
    kind: 'floor', subject: 'S3', layer: 'beam', rung: 'mid-dwell (dwell 22 of 30)',
    why: 'the ribbons and glows of a beam at 73% focus',
  },
  'S3/beam-shimmer': {
    kind: 'floor', subject: 'S3', layer: 'beam-shimmer', rung: 'mid-dwell (dwell 22 of 30)',
    why: 'the heat shimmer is spliced into the fog pass; hiding it must move the frame',
  },
  'S4/swarm': {
    kind: 'floor', subject: 'S4', layer: 'swarm', rung: '200 ms after the first struck',
    why: 'the swarm layer includes the tumbling member in flight',
  },
  'S4/beam': {
    kind: 'floor', subject: 'S4', layer: 'beam', rung: 'the first struck, the frame it lands (pulse 1)',
    why: 'the strike pulse widens the core, the sheath and the target glow',
  },
  'S5/beam@0': {
    kind: 'zero', subject: 'S5', layer: 'beam', rung: 'the lockout tick, the frame it lands', controlOf: 'S3/beam',
    why: 'a forced shutdown snaps the beam: no fade, no lens glow, no pulse (a struck on the same tick included)',
  },
  'S5/beam@250ms': {
    kind: 'zero', subject: 'S5', layer: 'beam', rung: 'lockout + 250 ms (5 ticks, vent puffs live)', controlOf: 'S3/beam',
    why: 'the beam must not draw while locked out; the vent puffs are particles, not the beam layer',
  },
  'S5/beam@3s': {
    kind: 'zero', subject: 'S5', layer: 'beam', rung: 'lockout + 3 s (halfway through the 6 s cooldown)', controlOf: 'S3/beam',
    why: 'still dark mid-cooldown',
  },
  'S6/beam-lit': {
    kind: 'floor', subject: 'S6', layer: 'beam', rung: 'dwelling on the swarm, before the smoke',
    why: 'the positive control of S6: the same carrier and swarm, the beam up',
  },
  'S6/beam': {
    kind: 'zero', subject: 'S6', layer: 'beam', rung: 'smoke laid on the line, the sim has broken the beam, +250 ms',
    controlOf: 'S6/beam-lit',
    why: 'the sim breaks a beam through smoke; the renderer must not hold the last target',
  },
  'S7/swarm-wrecks': {
    kind: 'floor', subject: 'S7', layer: 'swarm-wrecks', rung: '2 s after the third member is shot down',
    why: 'three charred wrecks lie on the ground',
  },
  'S8/swarm': {
    kind: 'floor', subject: 'S8', layer: 'swarm', rung: 'a dive in flight onto a parked apc_eitan',
    why: 'the diver is drawn (and the cloud it left)',
  },
  // The spec's own reading. It is NOT, at this staging, a witness for a dive routed through `missile`: the
  // round is a few pixels, flies 1.2 tiles beside the Eitan, and the falsification read 0 px / 0.0000 on it
  // (at +50, +100 and +150 ms) with a round live in `missileFx`. It stays because the spec asks for it and
  // it costs nothing; the witnesses are `S8.diving` (a diver in the air, no round in `missileFx`) and the
  // bloom key below.
  'S8/missiles@50ms': {
    kind: 'zero', subject: 'S8', layer: 'missiles', rung: 'a dive in flight, +50 ms', controlOf: 'S8/swarm',
    why: 'the dive profile draws no missile body or trail',
  },
  // What a routed shot DOES throw is the `fire_heat` muzzle flash and its bloom, which a dive never throws
  // before it lands: the falsification read 9860 px / 4.4517 here against exactly 0 on the real build.
  'S8/bloom@50ms': {
    kind: 'zero', subject: 'S8', layer: 'bloom', rung: 'a dive in flight, +50 ms', controlOf: 'S8/swarm',
    why: 'nothing HDR is alive before the dive lands; a swarm shot routed through the muzzle path blooms',
  },
} as const satisfies Record<string, FloorSpec>;

export type FloorKey = keyof typeof E6_KEYS;

export const E6_KEY_LIST = Object.keys(E6_KEYS) as FloorKey[];

/**
 * The measured runs, per `floor` key, oldest first. EMPTY until calibrated; an uncalibrated `floor`
 * key judges red (`checkVerdict`), so a new key cannot ship without evidence.
 *
 * Conditions of every run here are written in `E6_CALIBRATION`.
 */
export const E6_RUNS: Readonly<Record<string, readonly Reading[]>> = {
  'S1/swarm': [
    { diffPixels: 3361, meanAbsChannelDelta: 1.3393 },
    { diffPixels: 3433, meanAbsChannelDelta: 1.357 },
    { diffPixels: 3433, meanAbsChannelDelta: 1.357 },
  ],
  'S3/beam': [
    { diffPixels: 14414, meanAbsChannelDelta: 7.1598 },
    { diffPixels: 14318, meanAbsChannelDelta: 7.1203 },
    { diffPixels: 14318, meanAbsChannelDelta: 7.1203 },
  ],
  // Sub-threshold in pixels (23-25 of a 240,000 px crop), so the magnitude is the check, the `relief`
  // precedent. It is the faintest toggle in the set: the shimmer is a few-pixel distortion at the
  // target, and a third of 0.0141 is 0.0047. The falsification (the shimmer not fed) reads 0 / 0.0000.
  'S3/beam-shimmer': [
    { diffPixels: 23, meanAbsChannelDelta: 0.0156 },
    { diffPixels: 25, meanAbsChannelDelta: 0.0141 },
    { diffPixels: 25, meanAbsChannelDelta: 0.0141 },
  ],
  'S4/swarm': [
    { diffPixels: 1524, meanAbsChannelDelta: 0.7023 },
    { diffPixels: 1446, meanAbsChannelDelta: 0.6183 },
    { diffPixels: 1342, meanAbsChannelDelta: 0.5779 },
  ],
  'S4/beam': [
    { diffPixels: 23478, meanAbsChannelDelta: 11.3188 },
    { diffPixels: 23860, meanAbsChannelDelta: 11.4515 },
    { diffPixels: 23993, meanAbsChannelDelta: 11.4873 },
  ],
  'S6/beam-lit': [
    { diffPixels: 13561, meanAbsChannelDelta: 7.1671 },
    { diffPixels: 13561, meanAbsChannelDelta: 7.1671 },
    { diffPixels: 13561, meanAbsChannelDelta: 7.1671 },
  ],
  'S7/swarm-wrecks': [
    { diffPixels: 231, meanAbsChannelDelta: 0.1055 },
    { diffPixels: 226, meanAbsChannelDelta: 0.0974 },
    { diffPixels: 227, meanAbsChannelDelta: 0.0976 },
  ],
  'S8/swarm': [
    { diffPixels: 2565, meanAbsChannelDelta: 1.0228 },
    { diffPixels: 2565, meanAbsChannelDelta: 1.0228 },
    { diffPixels: 2565, meanAbsChannelDelta: 1.0228 },
  ],
};

/** Where and when `E6_RUNS` were taken. A reading with no conditions is an anecdote. */
export const E6_CALIBRATION =
  '3 runs on darwin-arm64, ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro), 1400x900 at deviceScaleFactor 1, 2026-10-25, ' +
  'one browser, music off, a 600x400 crop at each subject\'s own zoom (S1 2.0, the beam subjects 1.5, S8 2.5), the sim in lockstep by hand. ' +
  'Run 1 the full ladder, runs 2 and 3 `--toggles-only` (the same readings to the pixel on S1, S6 and S8; the VFX particles are ' +
  'randomised, so S3 to S7 move by a few hundred pixels at most). Load averages at the start of each run 59.36/20.54/14.23, ' +
  '52.02/25.37/16.43 and 35.86/23.70/16.08: other sessions were on the machine, and a toggle A/B repaints at zero elapsed time so the ' +
  'load moves no reading.';

export interface Floor {
  readonly minDiffPixels: number;
  readonly minMeanAbsChannelDelta: number;
  /** The smallest of the runs, per metric, and how many runs there were. */
  readonly basis: { readonly minDiffPixels: number; readonly minMeanAbsChannelDelta: number; readonly runs: number };
}

/** A third of the smallest, per metric, rounded DOWN (pixels to a whole number, delta to 4 places). */
export function deriveFloor(runs: readonly Reading[]): Floor {
  if (runs.length === 0) throw new Error('deriveFloor: no runs');
  const minPx = Math.min(...runs.map((r) => r.diffPixels));
  const minDelta = Math.min(...runs.map((r) => r.meanAbsChannelDelta));
  return {
    minDiffPixels: Math.floor(minPx / 3),
    minMeanAbsChannelDelta: Math.floor((minDelta / 3) * 10_000) / 10_000,
    basis: { minDiffPixels: minPx, minMeanAbsChannelDelta: minDelta, runs: runs.length },
  };
}

/** The floors in force: derived, never written. Only `floor` keys with runs have one. */
export function floorsFor(runs: Readonly<Record<string, readonly Reading[]>>): Partial<Record<FloorKey, Floor>> {
  const out: Partial<Record<FloorKey, Floor>> = {};
  for (const key of E6_KEY_LIST) {
    if (E6_KEYS[key].kind !== 'floor') continue;
    const r = runs[key];
    if (r !== undefined && r.length > 0) out[key] = deriveFloor(r);
  }
  return out;
}

export const E6_FLOORS: Partial<Record<FloorKey, Floor>> = floorsFor(E6_RUNS);

export interface Verdict {
  readonly ok: boolean;
  readonly key: string;
  readonly reasons: readonly string[];
}

/**
 * Whether one toggle reading is acceptable for its key.
 *
 * `floor`: fails on EITHER metric under its floor, and fails outright when the key has no floor yet.
 * `zero`: fails on ANY movement at all. An unknown key fails rather than throwing, so a name that
 * stops resolving is a red row and not a crash that loses the sheet.
 */
export function checkVerdict(
  key: string,
  reading: Reading,
  floors: Partial<Record<FloorKey, Floor>> = E6_FLOORS
): Verdict {
  const spec = (E6_KEYS as Record<string, FloorSpec>)[key];
  if (spec === undefined) return { ok: false, key, reasons: [`no key "${key}" (have: ${E6_KEY_LIST.join(', ')})`] };
  const reasons: string[] = [];
  if (spec.kind === 'zero') {
    if (reading.diffPixels !== 0) reasons.push(`diffPixels ${reading.diffPixels} != 0`);
    if (reading.meanAbsChannelDelta !== 0) reasons.push(`meanAbsChannelDelta ${reading.meanAbsChannelDelta.toFixed(4)} != 0`);
    return { ok: reasons.length === 0, key, reasons };
  }
  const floor = floors[key as FloorKey];
  if (floor === undefined) return { ok: false, key, reasons: ['uncalibrated: no runs, so no floor (a zero must fail)'] };
  if (!(reading.diffPixels >= floor.minDiffPixels)) reasons.push(`diffPixels ${reading.diffPixels} < floor ${floor.minDiffPixels}`);
  if (!(reading.meanAbsChannelDelta >= floor.minMeanAbsChannelDelta)) {
    reasons.push(`meanAbsChannelDelta ${reading.meanAbsChannelDelta.toFixed(4)} < floor ${floor.minMeanAbsChannelDelta}`);
  }
  return { ok: reasons.length === 0, key, reasons };
}

/** One line of the "floors in force" listing. */
export function floorLine(key: FloorKey, f: Floor): string {
  const px = f.minDiffPixels === 0 ? 'pixel count does not gate this key -- the tone column votes' : `${f.minDiffPixels} px`;
  return (
    `- \`${key}\` (${E6_KEYS[key].rung}): ${px} / ${f.minMeanAbsChannelDelta} ` +
    `(a third of ${f.basis.minDiffPixels} px / ${f.basis.minMeanAbsChannelDelta} over ${f.basis.runs} runs)`
  );
}

/**
 * One falsification: a one-line mutation of the render code, run, watched go red, reverted.
 * Recorded as data so a spec can assert that each recorded reading really is refused by the
 * floors in force (a falsification whose reading would have passed proves nothing).
 */
export interface Falsification {
  readonly id: string;
  /** The file and the one-line change, as a diff would show it. */
  readonly mutation: string;
  /** The key(s) that must go red. */
  readonly key: FloorKey | 'readback' | 'relation';
  /** What the harness read under the mutation. For a `readback`, a plain sentence instead. */
  readonly reading: Reading | string;
}

/**
 * The eight falsifications of spec 8, each a ONE-LINE mutation of the render code, run through
 * `pnpm e6:capture -- --toggles-only --only=<subject>` with the floors above in force, watched go red, and
 * reverted (the file byte-identical to HEAD afterwards, checked). 2026-10-25, same machine and conditions as
 * `E6_CALIBRATION`. The prose readings are the harness's own words.
 */
export const E6_FALSIFICATIONS: readonly Falsification[] = [
  {
    id: 'F1 draw count, not swarmMembers',
    mutation: 'ThreeRenderer.ts updateSwarms: `input.live = alive ? this.sim.swarmMembers(i) : 0;` -> `alive ? swarm.count : 0;`',
    key: 'readback',
    reading:
      'S2.readback red: 341 of 439 frames drew a count the sim does not have (drawn 12 throughout while the sim thinned 12 to 4; ' +
      '+2 s sim 11 drawn 12 ... +10 s sim 6 drawn 12). S4.tumbling, S4.coincide and S7.wrecks went red with it, and S7/swarm-wrecks read 0 px / 0.0000.',
  },
  {
    id: 'F2 drop the lowest slot, not the highest',
    mutation: 'swarm-layout.ts planExits: `for (let slot = prev - 1; slot >= live && slot >= 0; slot--) {` -> `for (let slot = 0; slot < prev - live; slot++) {`',
    key: 'relation',
    reading: 'S4.coincide red, and it alone: the beam ended 0.617 tiles (xz) from the member that tumbles (tolerance 0.2); S2 stayed green (the count is right, the member is wrong)',
  },
  {
    id: 'F3 a beam with no forced shutdown (ignores locked and the lockout event)',
    mutation: 'beam-look.ts stepBeamLook: `const snapped = input.locked || input.lockout;` -> `const snapped = false;`',
    key: 'S5/beam@0',
    reading: { diffPixels: 4894, meanAbsChannelDelta: 3.7363 },
  },
  {
    id: 'F4 a beam that keeps its last target through a break',
    mutation: 'beam-look.ts stepBeamLook: `const lasing = input.target >= 0 && !snapped;` -> `const lasing = (input.target >= 0 || state.env > 0) && !snapped;`',
    key: 'S6/beam',
    reading: { diffPixels: 247, meanAbsChannelDelta: 0.3201 },
  },
  {
    id: 'F5 the shimmer not fed',
    mutation: 'ThreeRenderer.ts feedBeamShimmer: `const count = this.beamShimmerWorldCount;` -> `const count = 0;`',
    key: 'S3/beam-shimmer',
    reading: { diffPixels: 0, meanAbsChannelDelta: 0 },
  },
  {
    id: 'F6 the swarm layer not consulted per frame',
    mutation: 'ThreeRenderer.ts updateSwarms: `env.bodiesHidden = this.unitsDebugHidden || this.swarmDebugHidden;` -> `env.bodiesHidden = this.unitsDebugHidden;`',
    key: 'S1/swarm',
    reading: { diffPixels: 0, meanAbsChannelDelta: 0 },
  },
  {
    id: 'F7 wrecks not spawned',
    mutation: 'swarm-batch.ts stepExits: `this.wreckRing.push({ x: f.x, ... });` -> `void f;`',
    key: 'S7/swarm-wrecks',
    reading: { diffPixels: 0, meanAbsChannelDelta: 0 },
  },
  {
    id: 'F8 a swarm dive routed through missile',
    mutation: 'ThreeRenderer.ts onFire: `const swarmDive = type.swarm !== null && this.swarmBatches.has(type.id);` -> `const swarmDive = false;`',
    key: 'S8/bloom@50ms',
    reading: { diffPixels: 9860, meanAbsChannelDelta: 4.4517 },
  },
];
