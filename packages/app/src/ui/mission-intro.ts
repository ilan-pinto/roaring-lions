// packages/app/src/ui/mission-intro.ts
/**
 * The briefing -> battlefield transition (H3, "T4"; rulings of 2026-10-15 in
 * the coordinator's `h3-transition-mock/proposal.md`). After the player
 * presses Deploy, the briefing card FOLDS into the commander bar while the
 * camera eases in from a wider start pose onto `player_start`, and the sim
 * clock is held until the camera lands. This file is the pure half, like
 * `outcome-beat.ts`: the timings, who gets an intro at all, the start pose,
 * the camera at a given moment and the fold's geometry. The DOM half is
 * `mission-intro-run.ts`; the animations themselves live in theme.css, whose
 * `--dur-intro-*` / `--delay-intro-*` tokens `mission-intro.test.ts` pins to
 * `INTRO_MS` below.
 *
 * Presentation only: nothing here reaches the sim (invariants 1 and 4).
 * `main.ts` holds the tick accumulator for `plan.holdMs` and writes the
 * camera from its frame loop alone.
 *
 * Reduced motion: no fold, no camera move. The deploy screen fades out over
 * `reducedFade` ms (a named exemption from theme.css's 1 ms collapse), and
 * the HUD, the reveal and the clock all arrive when it has gone.
 */

/** Every timing, ms after the intro starts (the first painted world frame).
 *  One table: theme.css's tokens are pinned to it, and the runner's timers
 *  read it. */
export const INTRO_MS = {
  /** The card's translate + scale onto the commander bar. */
  fold: 650,
  /** The screen's backdrop fades from here ... */
  backdropAt: 100,
  /** ... over this long. */
  backdrop: 450,
  /** The card fades out over the end of the fold. */
  cardFadeAt: 480,
  cardFade: 170,
  /** The HUD (and every pane the battlefield mounted) steps in. */
  hudAt: 520,
  hudFade: 250,
  /** The card lands: the screen is removed and the reveal runs. */
  land: 650,
  /** The commander bar's outline pulse, from the landing. */
  pulse: 700,
  /** The camera's ease onto `player_start`; the clock is held until then. */
  camera: 1400,
  /** Reduced motion: the screen's opacity fade, and everything else at its end. */
  reducedFade: 200,
} as const;

/** The start pose is this much wider than the landing zoom ... */
export const INTRO_START_ZOOM = 0.6;
/** ... and this far from `player_start` toward the first primary objective. */
export const INTRO_START_TOWARD = 1 / 3;
/** `main.ts`'s own zoom clamp floor (0.35-2.5): the start never goes below it. */
const ZOOM_MIN = 0.35;

export interface IntroPlan {
  readonly reduced: boolean;
  /** When the HUD starts stepping in. */
  readonly hudAtMs: number;
  /** When the screen is removed and the reveal runs. */
  readonly landMs: number;
  /** How long the camera eases; 0 = it does not move. */
  readonly cameraMs: number;
  /** How long the sim clock is held. */
  readonly holdMs: number;
}

export interface IntroFacts {
  /** The deploy screen held for a briefing (`briefingHoldsDeployment`). */
  readonly hasBriefing: boolean;
  /** No mission: a Free Play sandbox, which is an instrument. */
  readonly sandbox: boolean;
  /** A network room: its frames are the clock (R33), so nothing may hold it. */
  readonly room: boolean;
  /** A mission a tutorial teaches: its steps run from the first frame. */
  readonly tutorial: boolean;
  readonly reduced: boolean;
}

/** Who gets an intro, and which. Null is today's cut, exactly. */
export function introPlan(f: IntroFacts): IntroPlan | null {
  if (f.sandbox || f.room || f.tutorial || !f.hasBriefing) return null;
  if (f.reduced) {
    const ms = INTRO_MS.reducedFade;
    return { reduced: true, hudAtMs: ms, landMs: ms, cameraMs: 0, holdMs: ms };
  }
  return { reduced: false, hudAtMs: INTRO_MS.hudAt, landMs: INTRO_MS.land, cameraMs: INTRO_MS.camera, holdMs: INTRO_MS.camera };
}

export interface IntroCamera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * What the start pose leans toward: the centre of the first primary
 * objective's `target` zone, else the map's centre. Only a `target` that
 * names a zone counts (a raze target names a structure tag, not ground).
 */
export function introToward(
  objectives: readonly { primary?: boolean; target?: string }[],
  zones: Readonly<Record<string, readonly number[]>>,
  map: { width: number; height: number }
): Point {
  for (const o of objectives) {
    if (o.primary === false || typeof o.target !== 'string') continue;
    if (!Object.hasOwn(zones, o.target)) continue;
    const z = zones[o.target];
    if (z.length < 4) continue;
    return { x: z[0] + z[2] / 2, y: z[1] + z[3] / 2 };
  }
  return { x: map.width / 2, y: map.height / 2 };
}

/**
 * The wide view the camera eases in from: zoom x0.6 (never below the 0.35
 * floor), a third of the way toward `toward`, then CLAMPED -- `clamp` is
 * `main.ts`'s `clampCamera` for the renderer's view at that zoom, so a start
 * at the map's edge does not open on off-map void (the mock's T1 finding).
 */
export function introStartPose(end: IntroCamera, toward: Point, clamp: (cam: IntroCamera) => Point): IntroCamera {
  const zoom = Math.max(ZOOM_MIN, end.zoom * INTRO_START_ZOOM);
  const c = clamp({
    x: end.x + (toward.x - end.x) * INTRO_START_TOWARD,
    y: end.y + (toward.y - end.y) * INTRO_START_TOWARD,
    zoom,
  });
  return { x: c.x, y: c.y, zoom };
}

const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);
const easeOutCubic = (x: number): number => 1 - Math.pow(1 - x, 3);

/**
 * The camera at `elapsedMs`, or null when the plan does not move it or the
 * ease is over -- the caller writes the end pose once, when the intro ends.
 */
export function introCamera(elapsedMs: number, plan: IntroPlan, start: IntroCamera, end: IntroCamera): IntroCamera | null {
  if (plan.cameraMs <= 0 || elapsedMs >= plan.cameraMs) return null;
  const k = easeOutCubic(clamp01(elapsedMs / plan.cameraMs));
  return {
    x: start.x + (end.x - start.x) * k,
    y: start.y + (end.y - start.y) * k,
    zoom: start.zoom + (end.zoom - start.zoom) * k,
  };
}

export interface RectLike {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface FoldGeometry {
  /** Translation of the box's top-left corner onto the bar's, px. */
  readonly dx: number;
  readonly dy: number;
  /** Scale that makes the box exactly as wide as the bar. */
  readonly scale: number;
  /** How much of the box's bottom to clip away, in the box's OWN (pre-scale)
   *  px -- `clip-path` is applied in local space, before the transform -- so
   *  what is left, scaled, is exactly as tall as the bar. */
  readonly clipBottomPx: number;
}

/** The fold onto the commander bar, from two viewport rects (transform
 *  origin at the box's top-left). Null when either rect is empty: a hidden
 *  bar or a box already gone, where the card only fades. */
export function foldGeometry(box: RectLike, cmd: RectLike): FoldGeometry | null {
  if (!(box.width > 0 && box.height > 0 && cmd.width > 0 && cmd.height > 0)) return null;
  const scale = cmd.width / box.width;
  const keep = Math.min(box.height, cmd.height / scale);
  return { dx: cmd.left - box.left, dy: cmd.top - box.top, scale, clipBottomPx: box.height - keep };
}
