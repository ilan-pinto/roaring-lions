/**
 * The pure half of `perf:fx`'s infantry-kill row (GH-1400, the ragdoll read the lead ruled on 16 Nov 2026).
 * Three-free and browser-free, so a test holds all of it; `fx-cost.ts` runs it in the page.
 *
 * What the row is for. `RAGDOLL_PRESETS_LIVE` (`packages/render/src/three/preset-live.ts`) gives `high` a cap of 16
 * ragdoll FIGURES and `medium` 8. The flip waits on one Metal browser read of what that costs a frame: switch on minus
 * switch off, Δmedian <= 1.0 ms and Δp95 <= 2.0 ms (design section 3). The existing `kill` row kills Lavis, which are
 * vehicles and never ragdoll, so it cannot see the cost at all.
 *
 * Four things this file exists to refuse.
 *
 * **A cap the burst cannot reach.** A claim is all or nothing per entity (`RagdollSystem.claim`), and `inf_squad` is
 * three figures, so squads top out at 15 of 16 and 6 of 8. The burst is two-figure teams, exactly `cap / 2` of them,
 * plus ONE more killed last, which must be refused: the read shows the cap full AND the cap holding.
 *
 * **A ragdoll that never steps.** Ragdolls hand off and step on the presentation SIM clock
 * (`presentationSimMs(tickCount, alpha)`), never frame time, so a frame loop that does not tick the sim times the same
 * frozen frame in both arms and reads a delta of 0. `liveFrames` is the frame schedule: three frames a 20 Hz tick, at
 * alpha 1/3, 2/3 and 1, with the tick itself outside the timed bracket.
 *
 * **An override that did not take.** The ON arm serves `preset-live.ts` with the switch rewritten to `true`
 * (`rewritePresetLive`, a Playwright route; nothing on disk and nothing shipped changes). The rewrite must find
 * exactly one switch, and the page must read back the cap `EXPECTED_LIVE_CAP` names, or the run refuses.
 *
 * **A verdict without its noise.** `abVerdict` reports the off arm's own round-to-round spread and the quiet rows'
 * delta beside the burst delta, so a pass inside the noise reads as what it is.
 */

export type Preset = 'high' | 'medium' | 'low';
export type Arm = 'off' | 'on';

/** The pass bar, ms per frame, switch on minus off, at every preset (design section 3; the lead's ruling 1). */
export const RAGDOLL_GATE_MS = { median: 1.0, p95: 2.0 } as const;

/**
 * The validity bound on the CONTROL rows (quiet before any death, settled after every ragdoll froze), |on - off| of the
 * median, ms. PR 1520: "the quiet delta must be ~0". Fixed BEFORE the re-run that uses it (the first 4-round read at
 * `high` had its quiet control at +1.3 ms, tracking the burst row round by round), never tuned to a reading: a control
 * over it makes the verdict INCONCLUSIVE, whatever the burst rows say, and an inconclusive read flips nothing.
 */
export const CONTROL_BOUND_MS = 0.3;

/** The cap each preset's ON arm must read back (`RAGDOLL_PRESET_CAPS` with the switch on). Literals on purpose: an
 *  oracle never imports what it checks. The OFF arm reads 0 on every preset (the shipped default). */
export const EXPECTED_LIVE_CAP: Readonly<Record<Preset, number>> = { high: 16, medium: 8, low: 0 };

/** Two-figure KDF teams, in order of preference; the harness takes the first the sandbox has a mesh for. */
export const TWO_FIGURE_TEAMS = ['at_team', 'sniper_team', 'breach_team', 'demo_squad', 'inf_medic_squad', 'yahalom_squad'] as const;
export const TEAM_FIGURES = 2;
/** The burst's length in sim ticks: the headless bench's mortar burst (GH-1400, 15 Nov). */
export const BURST_TICKS = 4;
/** A cap a preset with no ragdolls is burst at: the same deaths as `high`, so `low`'s delta is a like-for-like 0. */
export const ZERO_CAP_BURST_AT = 16;

export interface BurstPlan {
  /** Victims killed on each of the `BURST_TICKS` ticks; the refused one is the last of the last tick. */
  readonly perTick: readonly number[];
  readonly victims: number;
  readonly offeredFigures: number;
  /** Figures the ragdolls must hold at the peak: the cap, exactly. */
  readonly expectedPeakFigures: number;
}

/** The burst for a cap: `cap / 2` two-figure teams and one more, over `BURST_TICKS` ticks, the extra killed last. */
export function ragdollBurstPlan(cap: number): BurstPlan {
  if (!Number.isInteger(cap) || cap < 0) throw new Error(`fx-ragdoll: cap must be a non-negative integer, got ${cap}`);
  const fillTo = cap === 0 ? ZERO_CAP_BURST_AT : cap;
  if (fillTo % TEAM_FIGURES !== 0) throw new Error(`fx-ragdoll: cap ${cap} is not a whole number of two-figure teams`);
  const victims = fillTo / TEAM_FIGURES + 1;
  const perTick: number[] = [];
  const base = Math.floor(victims / BURST_TICKS);
  const rest = victims % BURST_TICKS;
  // The remainder goes to the LAST ticks, so the extra victim is killed on the final tick, after the cap is full.
  for (let k = 0; k < BURST_TICKS; k++) perTick.push(base + (k >= BURST_TICKS - rest ? 1 : 0));
  return { perTick, victims, offeredFigures: victims * TEAM_FIGURES, expectedPeakFigures: cap };
}

/**
 * One arm's plan. BOTH arms of a preset kill the SAME burst, the one for the preset's LIVE cap; only the figures the
 * ragdolls must hold differ (the cap ON, 0 OFF). The first `medium` read burst the OFF arm at its own cap (0, so nine
 * teams) and the ON arm at 8 (five): its quiet frame drew 44 calls and 53k triangles fewer before anything died, and
 * the ON arm read 0.65 ms FASTER in every row.
 */
export function armPlan(liveCap: number, arm: Arm): { readonly burst: BurstPlan; readonly expectedPeakFigures: number } {
  const burst = ragdollBurstPlan(liveCap);
  return { burst, expectedPeakFigures: arm === 'on' ? burst.expectedPeakFigures : 0 };
}

/** One frame of a live schedule: tick the sim first (outside the timed bracket) when `tick`, then draw at `alpha`. */
export interface LiveFrame {
  readonly tick: boolean;
  readonly alpha: number;
}

/** `n` ticks' worth of frames at 60 fps against the 20 Hz sim: tick, then alpha 1/3, 2/3, 1. */
export function liveFrames(ticks: number): LiveFrame[] {
  const out: LiveFrame[] = [];
  for (let t = 0; t < ticks; t++) for (let k = 1; k <= 3; k++) out.push({ tick: k === 1, alpha: k / 3 });
  return out;
}

/** `presentationSimMs` (`packages/render/src/three/decal-maths.ts`), restated: the clock the ragdolls step on. */
export function presentationMs(tickCount: number, alpha: number): number {
  return Math.max(0, (tickCount - 1 + alpha) * 50);
}

/** The windows the burst is read in, ms after the LAST kill's tick (the incident life is 4 s, `MAX_STEPS` 240). */
export const BURST_WINDOWS: readonly { readonly name: string; readonly from: number; readonly to: number }[] = [
  { name: 'burst all', from: -200, to: 4500 },
  { name: 'burst @250ms', from: 250, to: 1000 },
  { name: 'burst @1s', from: 1000, to: 1750 },
  { name: 'burst @4s', from: 4000, to: 4500 },
];
/** How long after the last kill the burst is timed for (covers every window). */
export const BURST_TIMED_UNTIL_MS = 4500;

export interface Sample {
  /** Presentation sim ms of the frame, relative to the last kill's tick. */
  readonly t: number;
  /** Wall ms of `frame()` plus its 1x1 readPixels sync. */
  readonly ms: number;
}

export interface Stats {
  readonly n: number;
  readonly med: number;
  readonly p95: number;
  readonly max: number;
}

/** The quantile convention `fx-cost.ts` already uses: sorted[floor(p * n)], clamped. */
export function stats(ms: readonly number[]): Stats {
  if (ms.length === 0) throw new Error('fx-ragdoll: stats of no frames');
  const s = [...ms].sort((a, b) => a - b);
  const at = (p: number): number => s[Math.min(s.length - 1, Math.floor(p * s.length))] as number;
  return { n: s.length, med: at(0.5), p95: at(0.95), max: s[s.length - 1] as number };
}

/** Each `BURST_WINDOWS` window's stats over the samples inside [from, to). A window with no frame throws. */
export function windowStats(samples: readonly Sample[]): Record<string, Stats> {
  const out: Record<string, Stats> = {};
  for (const w of BURST_WINDOWS) {
    const inside = samples.filter((s) => s.t >= w.from && s.t < w.to).map((s) => s.ms);
    if (inside.length === 0) throw new Error(`fx-ragdoll: window ${w.name} [${w.from}, ${w.to}) holds no frame`);
    out[w.name] = stats(inside);
  }
  return out;
}

/**
 * The arm order for `rounds` rounds: ABBA blocks (off, on, on, off, ...), so a drift linear in time lands on both
 * arms alike. Every round has one of each; `rounds` >= 3 is the brief's floor.
 */
export function abSchedule(rounds: number): Arm[] {
  if (!Number.isInteger(rounds) || rounds < 1) throw new Error(`fx-ragdoll: rounds must be a positive integer, got ${rounds}`);
  const out: Arm[] = [];
  for (let r = 0; r < rounds; r++) out.push(...((r % 2 === 0 ? ['off', 'on'] : ['on', 'off']) as Arm[]));
  return out;
}

/** What one boot of one arm read: a row name to its stats. */
export type ArmRows = Record<string, Stats>;

export interface RowVerdict {
  readonly row: string;
  readonly offMed: number;
  readonly onMed: number;
  readonly dMed: number;
  readonly offP95: number;
  readonly onP95: number;
  readonly dP95: number;
  /** The off arm's own spread of medians across rounds (max - min): the noise this delta sits in. */
  readonly offSpread: number;
  readonly gated: boolean;
  /** An idle-sweep row (`sweepRowName`): reported, neither gated nor a control. */
  readonly informational: boolean;
  readonly pass: boolean;
  /** On minus off per round (boot `i` of each arm), the noise in plain sight. */
  readonly perRound: readonly number[];
}

export type Outcome = 'pass' | 'fail' | 'inconclusive';

export interface AbVerdict {
  readonly rows: readonly RowVerdict[];
  /** `inconclusive` when any control row's |dMed| exceeds `CONTROL_BOUND_MS`; else `pass` when every gated row holds. */
  readonly outcome: Outcome;
  /** Every gated row holds the bar (read it only beside `outcome`). */
  readonly pass: boolean;
}

/** The median over rounds: the midpoint of the two middle values for an even count (the upper-middle one decided the
 *  first 4-round read at high, +1.3 against a midpoint of +0.9). */
export function medianOf(v: readonly number[]): number {
  if (v.length === 0) throw new Error('fx-ragdoll: median of no readings');
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

/**
 * Switch on minus off, per row: the median over rounds of each arm's per-boot median (and p95), differenced. Rows whose
 * name starts with `burst` are GATED against `RAGDOLL_GATE_MS`; the others (quiet, settled) are the controls and must
 * read about 0. A row missing from any boot throws: a verdict over fewer boots than were run is a different verdict.
 */
export function abVerdict(off: readonly ArmRows[], on: readonly ArmRows[]): AbVerdict {
  if (off.length === 0 || on.length === 0) throw new Error('fx-ragdoll: a verdict needs at least one boot of each arm');
  const names = Object.keys(off[0] as ArmRows);
  const rows: RowVerdict[] = [];
  for (const row of names) {
    const pick = (boots: readonly ArmRows[], k: 'med' | 'p95'): number[] =>
      boots.map((b) => {
        const s = b[row];
        if (s === undefined) throw new Error(`fx-ragdoll: row ${row} is missing from a boot`);
        return s[k];
      });
    const offMeds = pick(off, 'med');
    const onMeds = pick(on, 'med');
    const offMed = medianOf(offMeds);
    const onMed = medianOf(onMeds);
    const perRound = onMeds.slice(0, Math.min(onMeds.length, offMeds.length)).map((v, i) => v - (offMeds[i] as number));
    const offP95 = medianOf(pick(off, 'p95'));
    const onP95 = medianOf(pick(on, 'p95'));
    const dMed = onMed - offMed;
    const dP95 = onP95 - offP95;
    const gated = row.startsWith('burst');
    const informational = row.startsWith('idle ');
    rows.push({
      row,
      offMed,
      onMed,
      dMed,
      offP95,
      onP95,
      dP95,
      offSpread: Math.max(...offMeds) - Math.min(...offMeds),
      gated,
      informational,
      pass: !gated || (dMed <= RAGDOLL_GATE_MS.median && dP95 <= RAGDOLL_GATE_MS.p95),
      perRound,
    });
  }
  const pass = rows.every((r) => r.pass);
  const controlOpen = rows.some((r) => !r.gated && !r.informational && Math.abs(r.dMed) > CONTROL_BOUND_MS);
  return { rows, pass, outcome: controlOpen ? 'inconclusive' : pass ? 'pass' : 'fail' };
}

/** The switch line `preset-live.ts` serves with, TypeScript-typed or as Vite's transform emits it. */
const SWITCH_RE = {
  ragdolls: /(export\s+const\s+RAGDOLL_PRESETS_LIVE\s*(?::\s*boolean\s*)?=\s*)false\b/g,
  softParticles: /(export\s+const\s+SOFT_PARTICLES_PRESET_LIVE\s*(?::\s*boolean\s*)?=\s*)false\b/g,
} as const;

/**
 * `preset-live.ts`'s served source with the named switches set to `true`: the ON arm's override, applied to the
 * response in the browser (a Playwright route), so no file changes and no shipped default moves. Each named switch
 * must match EXACTLY once, or this throws (a renamed switch, a switch already true, a transform that changed shape).
 */
export function rewritePresetLive(code: string, which: readonly (keyof typeof SWITCH_RE)[]): string {
  let out = code;
  for (const k of which) {
    const re = SWITCH_RE[k];
    const n = (out.match(re) ?? []).length;
    if (n !== 1) throw new Error(`fx-ragdoll: expected exactly one "${k}" switch set to false in preset-live, found ${n}`);
    out = out.replace(re, '$1true');
  }
  return out;
}

const ANY_SWITCH_RE = {
  ragdolls: /(export\s+const\s+RAGDOLL_PRESETS_LIVE\s*(?::\s*boolean\s*)?=\s*)(?:true|false)\b/g,
  softParticles: /(export\s+const\s+SOFT_PARTICLES_PRESET_LIVE\s*(?::\s*boolean\s*)?=\s*)(?:true|false)\b/g,
} as const;

/**
 * `preset-live.ts`'s served source with each named switch SET to the given value, whatever it ships as: an arm that must
 * hold a switch where the tree does not (the soft-particle OFF arm once `SOFT_PARTICLES_PRESET_LIVE` is true, which
 * `--soft=off` alone, by dropping `&soft`, would leave ON). Each named switch must match exactly once, or this throws.
 */
export function setPresetSwitches(code: string, to: { readonly ragdolls?: boolean; readonly softParticles?: boolean }): string {
  let out = code;
  for (const k of ['ragdolls', 'softParticles'] as const) {
    const v = to[k];
    if (v === undefined) continue;
    const re = ANY_SWITCH_RE[k];
    const n = (out.match(re) ?? []).length;
    if (n !== 1) throw new Error(`fx-ragdoll: expected exactly one "${k}" switch in preset-live, found ${n}`);
    out = out.replace(re, `$1${v}`);
  }
  return out;
}

/** A URL path is `preset-live.ts` as the dev server serves it (any prefix, any query). */
export function isPresetLiveModule(pathname: string): boolean {
  return pathname.endsWith('/render/src/three/preset-live.ts');
}

/** The row name of an idle-sweep point: informational, never gated and never a control (`abVerdict`). */
export function sweepRowName(atMs: number): string {
  return `idle @${atMs / 1000}s`;
}

/**
 * Parses the ragdoll A/B options: `--ragdoll-ab` (the mode), `--ab-rounds=<n>` (default 3) and `--idle-sweep=<s>,<s>,...`
 * (seconds after the scenario start, strictly increasing, at most 120: the declared sweep; GH-1400's owed read).
 */
export function parseRagdollArgs(argv: readonly string[]): { readonly ab: boolean; readonly rounds: number; readonly sweepMs: readonly number[] } {
  const ab = argv.includes('--ragdoll-ab');
  const raw = argv.find((a) => a.startsWith('--ab-rounds='))?.slice('--ab-rounds='.length);
  if (raw !== undefined && !ab) throw new Error('fx-ragdoll: --ab-rounds is a --ragdoll-ab option');
  if (raw !== undefined && !/^\d+$/.test(raw)) throw new Error(`fx-ragdoll: --ab-rounds wants a positive integer, got "${raw}"`);
  const rounds = raw === undefined ? 3 : Number(raw);
  if (rounds < 1) throw new Error('fx-ragdoll: --ab-rounds must be at least 1');
  const rawSweep = argv.find((a) => a.startsWith('--idle-sweep='))?.slice('--idle-sweep='.length);
  if (rawSweep !== undefined && !ab) throw new Error('fx-ragdoll: --idle-sweep is a --ragdoll-ab option');
  const sweepMs: number[] = [];
  if (rawSweep !== undefined) {
    for (const t of rawSweep.split(',')) {
      if (!/^\d+$/.test(t.trim())) throw new Error(`fx-ragdoll: --idle-sweep wants whole seconds, got "${t}"`);
      const ms = Number(t.trim()) * 1000;
      if (ms > 120000) throw new Error('fx-ragdoll: --idle-sweep points stop at 120 s');
      if (sweepMs.length > 0 && ms <= (sweepMs[sweepMs.length - 1] as number)) throw new Error('fx-ragdoll: --idle-sweep must increase');
      sweepMs.push(ms);
    }
  }
  return { ab, rounds, sweepMs };
}
