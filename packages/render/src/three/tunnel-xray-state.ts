/**
 * GH-471: the x-ray reveal's RULES, three-free so they are testable as plain
 * numbers. `tunnel-xray.ts` is the GPU half and reads everything from here.
 *
 * ## What the player sees, and when (approved by the lead 2026-10-08)
 *
 *  - Nothing for a route side 0 has not IDENTIFIED. A suspected route keeps
 *    the trail's spoil rung and the spoil heap, exactly as before: anyone can
 *    see dirt, only a detector reads the route (`../trail.ts`).
 *  - An identified route lights WHOLE while any `mark_tunnel` carrier of
 *    side 0 sees any tile of it (`held`).
 *  - Once nobody holds it, it fades over the window in which the SIM forgets
 *    it: contact decays from 1 by `CONTACT_DECAY` a tick until it falls under
 *    `LOST_AT`, and the ladder then emits `lost`. That window is derived below
 *    from the sim's own two constants, copied and pinned against `tuning.ts`
 *    as text (`tunnel-xray-state.test.ts`) -- `@lions/sim` does not export
 *    them, and this package does not change the sim for a presentation fact.
 *  - Every time on this clock is SIM time (`presentationSimMs`): a pause
 *    holds the fade and the pulse, and a capture at a pinned tick repeats.
 *
 * Invariant 4: every input here is a read of sim state or a sim event.
 * Nothing here can write back.
 */

/** `CONTACT_DECAY` in `packages/sim/src/tuning.ts`, Q16.16 -- pinned as text. */
export const SIM_CONTACT_DECAY_Q16 = 65209;
/** `LOST_AT` in `packages/sim/src/tuning.ts`, Q16.16 -- pinned as text. */
export const SIM_LOST_AT_Q16 = 13107;
/** The sim's fixed tick (invariant 1). */
export const SIM_TICKS_PER_SECOND = 20;

/** Ticks for an identified route's contact to fall from 1 to under `LOST_AT`
 *  with no observer: ln(LOST_AT) / ln(CONTACT_DECAY), ~322. */
export const SIM_FORGET_TICKS = Math.ceil(Math.log(SIM_LOST_AT_Q16 / 65536) / Math.log(SIM_CONTACT_DECAY_Q16 / 65536));
/** The same window in seconds (~16.1 s): the reveal fades over exactly it. */
export const XRAY_FORGET_S = SIM_FORGET_TICKS / SIM_TICKS_PER_SECOND;
/** Where the fade bottoms out while the route is still identified: a route
 *  the player has found but nobody is watching stays legible until the sim
 *  itself drops it, and then goes out. */
export const XRAY_FADE_FLOOR = 0.3;
/** A carrier read at the 5 Hz refresh counts as "now" for this long, so the
 *  gap between two refreshes is never read as a lapse. */
export const XRAY_HELD_GRACE_S = 0.3;
/** How fast the drawn strength follows its target, per sim second. */
export const XRAY_EASE_PER_S = 4;
/** Discovery sweep speed along the route, tiles per sim second. */
export const XRAY_PULSE_TILES_PER_S = 12;
/** How long the discovery flash takes to settle (e-folding), sim seconds. */
export const XRAY_FLASH_S = 1.6;
/** A route picked up again later re-runs the sweep at this much flash. */
export const XRAY_REPEAT_FLASH = 0.25;
/** The finder-to-route beam's life, sim seconds. */
export const XRAY_BEAM_S = 1.2;
/** `MAX_TUNNELS` in `sim.ts`: the uniform arrays are this long. */
export const XRAY_MAX_ROUTES = 16;
/** The figure batch's capacity. More occupants than this draw this many. */
export const XRAY_MAX_FIGURES = 64;

/**
 * The strength a route is heading for. `level` is side 0's contact level
 * AFTER the collapse downgrade (`collapsedRouteLevel`), so a dead route is
 * never 2; `sinceHeldS` is sim seconds since a carrier last saw it.
 */
export function xrayTarget(level: 0 | 1 | 2, sinceHeldS: number): number {
  if (level !== 2) return 0;
  if (sinceHeldS <= XRAY_HELD_GRACE_S) return 1;
  return Math.max(XRAY_FADE_FLOOR, 1 - (sinceHeldS / XRAY_FORGET_S) * (1 - XRAY_FADE_FLOOR));
}

/** Per-route state, stepped on the sim clock. */
export class XrayRouteClock {
  readonly strength = new Float32Array(XRAY_MAX_ROUTES);
  /** Pulse front distance from its origin, tiles (huge = fully swept). */
  readonly front = new Float32Array(XRAY_MAX_ROUTES).fill(1e6);
  readonly flash = new Float32Array(XRAY_MAX_ROUTES);
  /** Arc length (tiles) the sweep starts from. */
  readonly origin = new Float32Array(XRAY_MAX_ROUTES);
  private readonly level = new Uint8Array(XRAY_MAX_ROUTES);
  private readonly lastHeldS = new Float64Array(XRAY_MAX_ROUTES).fill(-1e9);
  private readonly pulseStartS = new Float64Array(XRAY_MAX_ROUTES).fill(-1e9);
  private readonly repeat = new Uint8Array(XRAY_MAX_ROUTES);
  private readonly found = new Set<number>();
  private lastStepS: number | null = null;
  beamStartS = -1e9;

  /** The 5 Hz read: side 0's level on route `r`, and whether a carrier sees it. */
  setRoute(r: number, level: 0 | 1 | 2, held: boolean, nowS: number): void {
    if (r < 0 || r >= XRAY_MAX_ROUTES) return;
    this.level[r] = level;
    if (level === 2 && held) this.lastHeldS[r] = nowS;
  }

  /** The `tunnelContact` identified event. Returns true the FIRST time this
   *  route is found this mission -- the only time the beat (beam, full flash)
   *  plays; a later re-acquisition re-runs the sweep quietly. */
  discover(r: number, nowS: number, originTiles: number): boolean {
    if (r < 0 || r >= XRAY_MAX_ROUTES) return false;
    const first = !this.found.has(r);
    this.found.add(r);
    this.lastHeldS[r] = nowS;
    this.pulseStartS[r] = nowS;
    this.origin[r] = originTiles;
    this.repeat[r] = first ? 0 : 1;
    if (first) this.beamStartS = nowS;
    return first;
  }

  /** Advance to sim time `nowS`. A repeat at the same `nowS` changes
   *  nothing, so a zero-time repaint is exact. */
  step(nowS: number, routeCount: number): void {
    const dt = this.lastStepS === null ? 0 : Math.max(0, Math.min(0.25, nowS - this.lastStepS));
    this.lastStepS = nowS;
    const k = Math.min(1, dt * XRAY_EASE_PER_S);
    for (let r = 0; r < Math.min(routeCount, XRAY_MAX_ROUTES); r++) {
      const target = xrayTarget(this.level[r] as 0 | 1 | 2, nowS - this.lastHeldS[r]);
      // Going out on `lost` is quick; coming in follows the sweep.
      this.strength[r] = target === 0 && this.strength[r] < 0.01 ? 0 : this.strength[r] + (target - this.strength[r]) * k;
      if (this.level[r] === 2 && this.strength[r] < target && this.pulseStartS[r] === -1e9) {
        // Identified with no event seen (a route already identified when this
        // renderer started): no sweep, just there.
        this.strength[r] = target;
      }
      const age = nowS - this.pulseStartS[r];
      this.front[r] = age < 0 ? 0 : age * XRAY_PULSE_TILES_PER_S;
      this.flash[r] = age >= 0 && age < XRAY_FLASH_S * 3 ? Math.exp(-age / XRAY_FLASH_S) * (this.repeat[r] ? XRAY_REPEAT_FLASH : 1) : 0;
    }
  }

  /** Has the sweep reached arc length `s` on route `r`? */
  revealed(r: number, s: number): boolean {
    return Math.abs(s - this.origin[r]) <= this.front[r];
  }

  /** The beam's alpha at `nowS`, 0 when it is not showing. */
  beamAlpha(nowS: number): number {
    const age = nowS - this.beamStartS;
    return age >= 0 && age < XRAY_BEAM_S ? 0.9 * (1 - age / XRAY_BEAM_S) : 0;
  }
}

/**
 * Where a fighter inside route `r` stands, as arc length along it. The sim
 * keeps NO position for a buried unit (its `posX/posY` is wherever it went
 * under), so this is presentation: a home on the route chosen by id, and a
 * slow pace either side of it on the sim clock. `dir` is which way he faces.
 */
export function figureAlongRoute(id: number, r: number, lengthTiles: number, nowS: number): { s: number; dir: 1 | -1; bob: number } {
  const h = hash01(id * 7919 + r * 104729);
  const home = (0.25 + 0.6 * h) * lengthTiles;
  const phase = nowS * (0.22 + 0.1 * h) + h * Math.PI * 2;
  const lo = Math.min(0.3, lengthTiles / 2);
  const s = Math.min(lengthTiles - lo, Math.max(lo, home + Math.sin(phase) * 1.1));
  return { s, dir: Math.cos(phase) >= 0 ? 1 : -1, bob: Math.abs(Math.sin(nowS * 6 + h * 10)) * 0.02 };
}

/** Index of the polyline sample nearest (x, y); samples are xy pairs. */
export function nearestSample(xy: Float32Array | readonly number[], x: number, y: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < xy.length / 2; i++) {
    const d = Math.hypot(xy[i * 2] - x, xy[i * 2 + 1] - y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export function hash01(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
