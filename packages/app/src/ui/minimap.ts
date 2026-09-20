// The minimap: 210x210 in the bottom-right corner, top-down, four things on it.
//
// Slice 4 of the map-first HUD (GH-153). Its own file, and its own 4 Hz
// counter, so it neither waits on nor collides with the selection-cluster work
// happening in hud.ts at the same time. `main.ts` mounts it beside the Hud and
// calls `onTick()` from the same place it calls `hud.onTick()`.
//
// Three things here were decided rather than inherited, and each is the answer
// to one of the ways a minimap goes wrong.
//
// --- 1. Fog. -------------------------------------------------------------
//
// A minimap is the easiest place in a game to leak the sim. Every hostile is
// sitting right there in `sim.state`, and drawing all of them is one loop, so
// the honest version is the one that costs you something. The rule this file
// uses is not a new rule and is deliberately not a re-derivation of one: it
// imports `unitIsObserved` from @lions/render -- the SAME function the three.js
// backend's three unit-draw paths and its occlusion silhouettes all hang off
// (`three/units/observed.ts`, whose own top comment explains why it is one
// function and not four copies of `side === 0 || isVisible(...)`). This file
// is the fourth caller, not the fourth copy. A player's own units always draw;
// anything else draws only while the player is ACTUALLY observing its tile
// this instant (fog level 2), and stops the moment sight is lost.
//
// Two extra exclusions on top of that rule, both of which can only ever HIDE a
// unit, never reveal one: a unit riding inside a transport (`carriedBy >= 0`)
// is not a second dot beside the vehicle carrying it, and a unit inside a
// tunnel (`tunnelIn >= 0`) has no body on the surface at all -- the whole
// point of the tunnel subsystem is that you have to find it. `pickUnit` in
// both backends already refuses a buried unit for the same reason.
//
// Terrain is NOT fogged, and that is a different question rather than an
// inconsistency. The shape of the ground is briefed, not discovered: the
// mission text names the approach, the pass, the wadi. What fog withholds is
// who is standing on it.
//
// --- 2. Coordinates. -----------------------------------------------------
//
// The world is dimetric and this is top-down, so tile space maps straight onto
// the square: one linear scale, no isoX/isoY anywhere. `project.ts` is
// deliberately not exported from @lions/render and nothing here wants it.
//
// The one place the camera does get consulted is the viewport outline, and it
// is ASKED rather than recomputed (CLAUDE.md: projection is a question you put
// to the renderer). `Renderer.screenToWorld` is called on the four corners of
// the drawing surface, and the four world points that come back are joined up.
// Note that what comes back is a DIAMOND, not the axis-aligned rectangle the
// design spec draws: the spec's minimap is a placeholder screenshot of the
// dimetric view with the marks laid on by hand, and on a genuinely top-down
// minimap a rectangular screen IS a rotated square in tile space. Drawing its
// bounding box instead would claim the player can see about twice the ground
// they can, which is the one thing a viewport indicator must not do.
//
// --- 3. Cost. ------------------------------------------------------------
//
// Terrain is 2,304 tiles on every shipped map and it does not change, so it is
// built ONCE into an offscreen canvas and blitted on each redraw. Since
// Task 15 there are two ways it is built and the choice is made once, in the
// constructor: the renderer's own photograph of the lit, textured ground
// (`Renderer.captureGroundAlbedo`, 210px, smoothed) where the backend can
// take one, and otherwise `paintTerrain`'s one-pixel-per-tile reconstruction
// from `blocked`/`boulder`/`cover` (48px, unsmoothed) -- which is what
// `?renderer=pixi` gets, and what shipped.
// Per redraw the work is one `drawImage`, four
// `screenToWorld` calls, one pass over living entities, and a handful of
// diamonds -- and the whole thing happens at 4 Hz, on the HUD's own cadence.
//
// Nothing here reads or writes sim state beyond the read-only `sim.state` view
// (invariant 4), and the only @lions/sim imports are `fx` and the `Sim` type.

import { unitIsObserved, type TerrainTones } from '@lions/render';
import { fx, type Sim } from '@lions/sim';

/**
 * The box, in CSS pixels. theme.css sizes `.rl-minimap` from the `--minimap`
 * token that slice 1 reserved; this is the backing store that has to agree
 * with it. If the two ever drift the canvas scales rather than clipping, so
 * the failure is a visibly soft minimap rather than a silently cropped one.
 */
export const MINIMAP_SIZE = 210;

/** A point in tile space. */
export interface MinimapPoint {
  x: number;
  y: number;
}

/**
 * What the minimap needs from the map. A structural subset of `ParsedMap`, so
 * `main.ts` hands its own `map` straight in and this file needs no dependency
 * on @lions/data.
 */
export interface MinimapMap {
  readonly width: number;
  readonly height: number;
  /** Impassable: buildings and `^` rock ridge. */
  readonly blocked: Uint8Array;
  /** Passable on foot, a wall to anything wheeled or tracked. */
  readonly boulder: Uint8Array;
  /** Cover level 0-3. */
  readonly cover: Uint8Array;
  readonly markers: Readonly<Record<string, readonly [number, number]>>;
  readonly zones: Readonly<Record<string, readonly [number, number, number, number]>>;
}

/**
 * What the minimap needs from the renderer. A structural subset of `Renderer`,
 * naming only the two queries and the two dimensions -- so this file cannot
 * reach a backend-only member even by accident, and a test can supply a plain
 * object.
 */
export interface MinimapView {
  readonly width: number;
  readonly height: number;
  isVisible(wx: number, wy: number): boolean;
  screenToWorld(px: number, py: number): { x: number; y: number };
}

/**
 * One objective, as `MissionRuntime.objectiveList` reports it. Only the two
 * fields the minimap can draw from: whether it is still being fought over, and
 * the ground it is fought over.
 */
export interface MinimapObjective {
  readonly status: string;
  /** Zone (or marker) the objective names. */
  readonly zone?: string;
}

export interface MinimapDeps {
  sim: Sim;
  map: MinimapMap;
  view: MinimapView;
  /** This map's terrain tones, already resolved to hex by `main.ts` -- the
   *  SAME values the battlefield is drawn with, so the minimap cannot show a
   *  different-coloured version of the same ground. */
  tones: TerrainTones;
  /** `RendererOptions.teamColors`: [player, hostile, neutral]. Passed rather
   *  than re-resolved for the same reason -- a dot is the field's own colour
   *  for that side, by construction. */
  teamColors: readonly [string, string, string];
  /** Live objectives. A thunk: objectives complete and drop off mid-mission. */
  objectives: () => readonly MinimapObjective[];
  /** What the three player gestures mean. Optional: without it the canvas is
   *  inert and swallows its events exactly as it did before Task 10, which is
   *  also what every test that predates this mounts. */
  input?: MinimapInput;
  /**
   * The map's own lit ground, photographed once by the renderer (Task 15,
   * `Renderer.captureGroundAlbedo`) -- the SAME surface the player is
   * looking at, rather than this file's 1px-per-tile reconstruction of it
   * from `blocked`/`boulder`/`cover`.
   *
   * A thunk called on EVERY redraw -- 4 Hz, `onTick` -- and that is not the
   * same as photographing on every redraw. The renderer's answer is
   * identity-stable (`Renderer.captureGroundAlbedo`): it hands back the same
   * `ImageData` until something has actually changed what a photograph of
   * this ground would look like, so the steady state here is one reference
   * compare and the blit source is rebuilt only when the object changes.
   *
   * It used to be called exactly once, from the constructor, and the defect
   * that closed was a race rather than a preference. The renderer fires six
   * ground-albedo texture loads fire-and-forget at map load and does not
   * await them; the minimap mounts right after the deploy gate, which on a
   * sandbox or the tutorial is immediately. A single ask could therefore
   * photograph ground whose textures had not landed and show those slots'
   * flat palette tone for the whole mission -- quietly, since that picture is
   * still lit, shaded and elevation-correct, just not the one the player is
   * looking at.
   *
   * Optional, and `null` is a first-class answer rather than a failure:
   * `?renderer=pixi` has no ground mesh to photograph and implements
   * nothing, so it falls back to `paintTerrain` -- which is not a
   * degradation, it is exactly what shipped. Every test that predates this
   * mounts without it and takes that same path.
   */
  groundImage?: () => ImageData | null;
}

/**
 * What the minimap does with a click, as three questions put to the caller.
 *
 * Deliberately not a renderer, a Sim or an intent: this file knows where the
 * player pointed and nothing whatever about what a camera or an order is.
 * `main.ts` owns all three answers, and the middle one is required to go
 * through the SAME `resolvePointer` the battlefield's own right-click does --
 * a minimap order that resolved differently from the identical click on the
 * field would be two answers to one question.
 */
export interface MinimapInput {
  /** Put the camera on this tile. */
  jumpTo(x: number, y: number): void;
  /** A right-click here, with the modifiers the player was holding. */
  order(x: number, y: number, mods: { append: boolean; confirm: boolean }): void;
  /** Mark this tile. Local and silent to the sim: nothing is queued and
   *  nothing is dispatched (invariant 4), and there is no second player to
   *  signal. */
  ping(x: number, y: number): void;
}

/**
 * Chrome colours, written as the CSS they resolve from so `pnpm validate:ui`
 * checks the token names (it reads every var() reference out of source and
 * fails on one
 * theme.css does not declare). Resolved through a probe element at
 * construction; see `resolveChrome`.
 *
 * These are HUD tones rather than battlefield tones, which is the split: the
 * map area of the minimap wears the palette the terrain and the units wear,
 * and the marks laid over it wear the palette the rest of the HUD wears.
 */
const CHROME = {
  /** The camera's own footprint. */
  viewport: 'var(--live)',
  /** A named piece of ground the player has seen. */
  story: 'var(--live)',
  /** Ground an objective is fought over. */
  objective: 'var(--warn)',
  /** Under the map, on the two edges a non-square map would letterbox. */
  ground: 'var(--panel-bg-solid)',
} as const;

type ChromeKey = keyof typeof CHROME;
export type ChromeColors = Record<ChromeKey, string>;

/**
 * Turn `CHROME`'s CSS into colours a 2D context will take.
 *
 * A probe element rather than `getComputedStyle(root).getPropertyValue('--live')`,
 * because that reads the custom property's own value and a var() chain is not
 * guaranteed to come back substituted. Setting `color` and reading it back is:
 * the cascade does the substitution and the result is an `rgb(...)` string.
 *
 * A token that fails to resolve is reported once, by name. It has to be:
 * assigning an unparseable string to `fillStyle` is a silent no-op that leaves
 * the PREVIOUS colour in place, so the failure mode is a minimap drawn in
 * whatever colour happened to be set last -- plausible, wrong, and unreadable
 * as a bug.
 */
export function resolveChrome(host: HTMLElement): ChromeColors {
  const probe = document.createElement('span');
  probe.style.position = 'absolute';
  probe.style.opacity = '0';
  probe.style.pointerEvents = 'none';
  host.appendChild(probe);
  const out = {} as ChromeColors;
  for (const key of Object.keys(CHROME) as ChromeKey[]) {
    probe.style.color = '';
    probe.style.color = CHROME[key];
    const got = window.getComputedStyle(probe).color;
    if (!got) console.warn(`minimap: ${CHROME[key]} did not resolve — ${key} will not draw`);
    out[key] = got;
  }
  probe.remove();
  return out;
}

/** Tile space → the square, as one scale and a letterbox offset. */
export interface MinimapProjection {
  /** Box pixels per tile. */
  scale: number;
  ox: number;
  oy: number;
}

/**
 * Fit a `w`x`h` tile grid into a `size`x`size` box, preserving aspect.
 *
 * Every shipped map is 48x48, so in practice this is `210/48 = 4.375` with no
 * offset at all. It is written for the general case anyway because the one
 * thing that must never happen is a non-square map drawn stretched: a player
 * reading distance off a stretched minimap reads it wrong in one axis only,
 * which is far harder to notice than a minimap that is obviously letterboxed.
 */
export function minimapProjection(w: number, h: number, size: number): MinimapProjection {
  const scale = size / Math.max(w, h);
  return { scale, ox: (size - w * scale) / 2, oy: (size - h * scale) / 2 };
}

/** Tile point → box pixel. */
export function tileToBox(p: MinimapProjection, tx: number, ty: number): MinimapPoint {
  return { x: p.ox + tx * p.scale, y: p.oy + ty * p.scale };
}

/**
 * Box pixel → tile point: the inverse of `tileToBox`, clamped to the map.
 *
 * Written as the algebraic inverse rather than as a second projection, so the
 * two cannot drift -- the round trip is a test, and a minimap whose click
 * landed a tile away from the mark it was aimed at would be a second answer
 * to the question section 2 of this file's header settles once.
 *
 * The clamp is not tidiness. A letterboxed map (`ox`/`oy` non-zero) has box
 * pixels with NO tile under them, and every caller of this is a player's
 * click: without it a click on the dead strip below a wide map jumps the
 * camera off the world, or -- worse, because it is silent -- orders a squad
 * to walk to a tile that does not exist. Clamping to the map's own edge is
 * the nearest honest answer to "there".
 */
export function boxToTile(
  p: MinimapProjection,
  bx: number,
  by: number,
  w: number,
  h: number
): MinimapPoint {
  const clamp = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);
  return {
    x: clamp((bx - p.ox) / p.scale, w),
    y: clamp((by - p.oy) / p.scale, h),
  };
}

/**
 * Turn a WebGL read-back the right way up: reverse the ROW order, leaving
 * every row's pixels exactly where they were.
 *
 * WebGL's framebuffer origin is the bottom-left and a 2D canvas's is the
 * top-left, so `readRenderTargetPixels` hands back the last row first. The
 * flip is here, on the app side, and deliberately not inside the renderer's
 * GL method: `preserveDrawingBuffer` is off and canvas readback is black by
 * design (CLAUDE.md), so there is no way to assert the row order of a real
 * capture from a test at all -- while a pure function over a
 * `Uint8ClampedArray` is two assertions. The failure this buys is worth
 * catching by name: an upside-down minimap is still a picture that looks
 * like a map.
 *
 * A fresh buffer rather than an in-place swap. It is called once per map,
 * the source is the renderer's own read-back array with no other reader,
 * and an in-place version would be an involution that is only correct for
 * an even row count.
 *
 * The backing buffer is spelled out on the way OUT and left open on the way
 * in. TypeScript 5.7 made the typed arrays generic in it, and `ImageData`'s
 * constructor takes a plain `ArrayBuffer` only -- so a bare
 * `Uint8ClampedArray` return (which means `ArrayBufferLike`, and therefore
 * admits `SharedArrayBuffer`) is rejected at the one call site in `main.ts`.
 * A freshly allocated array always has a plain buffer; saying so is what
 * lets the caller hand the result straight to `new ImageData`.
 */
export function flipRows(
  data: Uint8ClampedArray,
  width: number,
  height: number
): Uint8ClampedArray<ArrayBuffer> {
  const stride = width * 4;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    out.set(data.subarray(y * stride, (y + 1) * stride), (height - 1 - y) * stride);
  }
  return out;
}

/**
 * The renderer's photograph, on a canvas `drawImage` will take.
 *
 * `ImageData` crosses the `api.ts` seam because it is the one shape that
 * needs neither side to know about the other's rendering stack -- but it is
 * not itself drawable, so it is blitted onto an offscreen canvas here, once,
 * exactly as `paintTerrain` builds one. Both label themselves in
 * `dataset.source`: an offscreen canvas is never in the document, so the
 * label costs nothing and is how a test reads back WHICH ground was blitted
 * rather than recomputing which one should have been (the same move
 * `__lions.cursorKey()` makes against `canvas.dataset.cursor`).
 */
function photographedTerrain(img: ImageData): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.dataset.source = 'ground-albedo';
  const g = c.getContext('2d');
  if (!g) throw new Error('minimap: no 2D context for the photographed ground');
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * The camera's footprint in tile space: the four screen corners, asked of the
 * renderer and joined up in order.
 *
 * Clockwise from the top-left of the drawing surface, so the polygon is not
 * self-crossing. Deliberately unclamped to the map — a camera panned past the
 * edge should show its outline hanging off the edge, which is exactly the
 * feedback that says "you have panned off the map".
 */
export function viewportQuad(view: MinimapView): MinimapPoint[] {
  const w = view.width;
  const h = view.height;
  return [
    view.screenToWorld(0, 0),
    view.screenToWorld(w, 0),
    view.screenToWorld(w, h),
    view.screenToWorld(0, h),
  ];
}

/**
 * Where the objectives still in play are, in tile space.
 *
 * A zone resolves to its centre, a marker to its own tile's centre; an
 * objective naming neither (`eliminate_hvt`, `survive_until`, and every other
 * type `objectiveList` reports no `zone` for) contributes nothing rather than
 * a diamond at 0,0.
 *
 * NOT fog-gated, unlike units, and that is the point of the distinction this
 * file draws: the player is TOLD to hold the western approach. Where the
 * objective is was never secret. Who is standing on it is.
 */
export function objectivePoints(
  objectives: readonly MinimapObjective[],
  map: MinimapMap
): MinimapPoint[] {
  const out: MinimapPoint[] = [];
  for (const o of objectives) {
    if (o.status !== 'active') continue;
    const at = objectivePoint(o, map);
    if (at) out.push(at);
  }
  return out;
}

/**
 * The ground ONE objective names, or null when it names none.
 *
 * Split out of `objectivePoints` above because `main.ts`'s alert layer needs
 * the same answer for a single objective -- where the camera goes when the
 * player presses the jump key on an `objective` alert. Two resolutions of
 * "zone, or a marker of the same name, or nothing" would be two answers that
 * could disagree by a tile, and the one place a disagreement would show is
 * the camera landing somewhere other than the diamond the player aimed at.
 *
 * It resolves GROUND and nothing else. The `status !== 'active'` filter stays
 * in `objectivePoints`, where it belongs: an `objective` MissionEvent fires
 * when a status CHANGES, so by the time the alert layer asks, the objective
 * worth jumping to is usually the one that just stopped being active.
 */
export function objectivePoint(o: MinimapObjective, map: MinimapMap): MinimapPoint | null {
  if (o.zone === undefined) return null;
  const z = map.zones[o.zone];
  if (z) return { x: z[0] + z[2] / 2, y: z[1] + z[3] / 2 };
  const m = map.markers[o.zone];
  if (m) return { x: m[0] + 0.5, y: m[1] + 0.5 };
  return null;
}

/**
 * Named ground the player has laid eyes on, latched.
 *
 * The mission schema has no concept of a "story marker" — the same hole slice 1
 * hit with the commander's name, and the same honest answer: say what the data
 * actually is rather than invent a field. What every map DOES carry is named
 * ground (`hollow`, `battery_position`, `tunnel_mouth_west`, `civ_refuge`), and
 * that is the map's story written down by whoever authored it.
 *
 * It cannot be drawn wholesale, because half of those names are the enemy's:
 * putting a diamond on Tel Marum's `battery_position` at t=0 hands the player
 * the answer to the mission whose entire subject is finding the battery. So a
 * marker appears under exactly the rule a contact appears under — its tile is
 * observed right now — and then STAYS, because ground you have walked does not
 * become anonymous again when you look away. A marker is latched only by having
 * actually been seen, so the latch cannot leak anything the live rule would not
 * already have shown.
 *
 * `seen` is the caller's set and is mutated here; that is what makes this
 * O(markers) per redraw with no re-scan of what is already known.
 */
export function observedMarkers(
  map: MinimapMap,
  isVisible: (wx: number, wy: number) => boolean,
  seen: Set<string>
): MinimapPoint[] {
  const out: MinimapPoint[] = [];
  for (const [name, at] of Object.entries(map.markers)) {
    const x = at[0] + 0.5;
    const y = at[1] + 0.5;
    if (!seen.has(name)) {
      if (!isVisible(x, y)) continue;
      seen.add(name);
    }
    out.push({ x, y });
  }
  return out;
}

/** One unit as the minimap draws it: where, and whose. */
export interface MinimapDot extends MinimapPoint {
  side: number;
}

/** The three silhouettes a unit dot can wear. */
export type DotShape = 'square' | 'triangle' | 'circle';

/**
 * Which silhouette a side gets.
 *
 * A SECOND channel beside the colour, not a replacement for it, and the
 * distinction is load-bearing: G0 decision #3 measured this palette's team
 * colours as NOT collapsing under any simulated deficiency, so the colours
 * here are unchanged and the shape is laid down beside them. Anything
 * claiming this FIXES a colour problem would be claiming a measurement that
 * says the opposite.
 *
 * What the three shapes are chosen for is corner count -- four, three, none
 * -- rather than size, because every dot is the same `DOT` tall and a
 * silhouette that differed by size would read as distance instead of side.
 * Which side gets which is arbitrary beyond that, except that the default
 * arm is the circle: it is also the honest answer for a side this file has
 * never been told about, since `teamColors` has exactly three entries and
 * `dotShape` must answer for any number.
 */
export function dotShape(side: number): DotShape {
  if (side === 0) return 'square';
  if (side === 1) return 'triangle';
  return 'circle';
}

/**
 * Every unit the player is entitled to see, in tile space.
 *
 * The fog rule is `unitIsObserved`, imported rather than restated — see this
 * file's top comment. The two exclusions above it are conservative by
 * construction: both can only remove a dot.
 */
export function unitDots(sim: Sim, isVisible: (wx: number, wy: number) => boolean): MinimapDot[] {
  const st = sim.state;
  const out: MinimapDot[] = [];
  for (let i = 0; i < sim.entityCount; i++) {
    if (st.alive[i] !== 1) continue;
    // Inside a vehicle: the vehicle is the dot. Inside a tunnel: no body on
    // the surface at all, and finding it is the mechanic.
    if (st.carriedBy[i] >= 0 || st.tunnelIn[i] >= 0) continue;
    const x = fx.toNumber(st.posX[i]);
    const y = fx.toNumber(st.posY[i]);
    if (!unitIsObserved(st.side[i], x, y, isVisible)) continue;
    out.push({ x, y, side: st.side[i] });
  }
  return out;
}

/**
 * How long an alert mark stays on the minimap. Long enough to catch an eye
 * that was elsewhere when it landed, short enough that three in a row do not
 * become a permanent decoration.
 *
 * A WALL-CLOCK duration, in milliseconds, and never a tick count. The flash
 * is presentation: it says "something happened over there" to a player, and
 * nothing about it may reach the sim (invariant 4). Measuring it in ticks
 * would also make it a different length at double speed, which is the one
 * thing an attention cue must not be.
 */
export const FLASH_MS = 1400;

/**
 * One fade, over whatever span the caller names: 1 at the event, 0 at the end
 * of the span, straight line between.
 *
 * Linear, because the thing being judged is "is it still there", not a
 * brightness curve -- and linear is the one shape a reader can check against
 * the numbers beside it without running it.
 *
 * Generalised from `flashAlpha` when the ping arrived on its own, longer
 * span (Task 10). Two curves for two marks would have been two places for the
 * "is it gone yet" boundary to be written down, and they agree here by
 * construction instead.
 */
export function linearFade(ageMs: number, spanMs: number): number {
  if (ageMs <= 0) return 1;
  if (spanMs <= 0 || ageMs >= spanMs) return 0;
  return 1 - ageMs / spanMs;
}

/** The alert flash's own span. Kept as its own name because Task 4's callers
 *  and tests speak it, and because `FLASH_MS` is the fact, not the curve. */
export function flashAlpha(ageMs: number): number {
  return linearFade(ageMs, FLASH_MS);
}

/**
 * How long a ping stays on the minimap -- nearly twice `FLASH_MS`, and
 * deliberately so. A flash is the game telling the player to look; a ping is
 * the player telling THEMSELVES to look, at a tile they picked out on purpose
 * and are about to act on. It has to outlive the glance away from the minimap
 * that reading it causes.
 */
export const PING_MS = 2500;

/** Dot edge, in box pixels. 6px filled, from the spec's own inline style. */
const DOT = 6;
/** Diamond edge before the 45-degree turn, in box pixels. Spec: 8px stroked. */
const DIAMOND = 8;
/** The alert ring, in box pixels: where it starts and where it ends. It
 *  EXPANDS as it fades, so the eye is caught by motion rather than by
 *  brightness alone -- the same reason a real warning light sweeps. The
 *  larger end is well clear of `DIAMOND`, so an alert standing on an
 *  objective is still two distinguishable marks. */
const FLASH_R0 = 5;
const FLASH_R1 = 16;
/** The ping's ring, same idea and deliberately a different size: it starts
 *  inside `FLASH_R0` and ends outside `FLASH_R1`, so a ping landing on top of
 *  an alert is never the same circle at the same instant. */
const PING_R0 = 3;
const PING_R1 = 20;
/** The ping's centre dot. Static: the ring is the motion that catches the
 *  eye, and by the time it has expanded it no longer says WHERE. */
const PING_DOT = 2;

export class Minimap {
  private readonly el: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** The ground currently being blitted: the renderer's photograph of the
   *  lit terrain where there is one, otherwise `paintTerrain`'s
   *  one-pixel-per-tile reconstruction. Rebuilt only when the renderer hands
   *  back a DIFFERENT image -- see `refreshTerrain`. */
  private terrain: HTMLCanvasElement;
  /** Which of the two `terrain` is. Read by `draw` for one thing only --
   *  whether to smooth the blit -- and the two want opposite answers. */
  private terrainIsPhotograph: boolean;
  /** The `ImageData` `terrain` was built from, by IDENTITY rather than by
   *  contents, or null when `terrain` is the painted fallback. This is the
   *  whole of the freshness test: comparing pixels would cost more than the
   *  blit it is trying to avoid, and the renderer already promises the same
   *  object until its own picture changes. */
  private terrainFrom: ImageData | null = null;
  /** The painted fallback, built at most once and kept. Without it a mission
   *  on `?renderer=pixi` -- where every ask answers null -- would repaint
   *  2,304 tiles four times a second for a picture that cannot change. */
  private painted: HTMLCanvasElement | null = null;
  private readonly proj: MinimapProjection;
  private readonly chrome: ChromeColors;
  private readonly seenMarkers = new Set<string>();
  /** Live alert marks: where, and the wall-clock instant each landed. */
  private readonly flashes: { p: MinimapPoint; at: number }[] = [];
  /** Live player pings, same shape and its own span. */
  private readonly pings: { p: MinimapPoint; at: number }[] = [];
  private readonly dpr: number;
  private tickN = 0;
  /** A left button is down and the camera is following the pointer. */
  private dragging = false;
  /** The pointer has moved since that button went down. See `onUp`. */
  private dragMoved = false;
  /** Every listener this component owns, cut in one call by `destroy()`. */
  private readonly listeners = new AbortController();

  constructor(
    host: HTMLElement,
    private readonly deps: MinimapDeps
  ) {
    this.chrome = resolveChrome(host);
    this.proj = minimapProjection(deps.map.width, deps.map.height, MINIMAP_SIZE);
    // Cap at 2: past that the backing store grows quadratically for a gain
    // nobody can see on a 210px box.
    this.dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);

    this.el = document.createElement('canvas');
    this.el.className = 'rl-minimap';
    this.el.width = MINIMAP_SIZE * this.dpr;
    this.el.height = MINIMAP_SIZE * this.dpr;
    // Deliberately NOT pointer-events:none, and since Task 10 the reason has
    // changed rather than gone away. It used to be that a click falling
    // through would issue an order on ground the player did not aim at, so
    // swallowing was the whole of it. Now the box IS a control -- click to
    // jump, drag to pan, right-click to order, alt-click to ping -- and the
    // swallowing is what keeps those four gestures from ALSO reaching the
    // battlefield underneath and doing a second, different thing. Every
    // handler that acts calls `preventDefault` BEFORE it consults `input`, so
    // a click is swallowed even where nothing is wired -- which is the promise
    // this comment made before the box was a control and still makes. A bare
    // hover is deliberately not swallowed: `pointermove` is only this
    // component's event while a drag is in flight.
    host.appendChild(this.el);
    const signal = this.listeners.signal;
    this.el.addEventListener('pointerdown', this.onDown, { signal });
    this.el.addEventListener('pointermove', this.onMove, { signal });
    this.el.addEventListener('pointerup', this.onUp, { signal });
    // `pointerup` is not the only way a drag ends, and the other two are not
    // hypothetical: a pen or touch contact can be interrupted
    // (`pointercancel`), and without `setPointerCapture` the release lands on
    // whatever is under the pointer -- the battlefield canvas -- so this
    // element never hears it. Either way `dragging` would latch true and
    // every later BUTTON-LESS hover over the box would pan the camera.
    this.el.addEventListener('pointercancel', this.onCancel, { signal });
    this.el.addEventListener('lostpointercapture', this.onCancel, { signal });
    this.el.addEventListener('contextmenu', this.onMenu, { signal });

    const ctx = this.el.getContext('2d');
    if (!ctx) throw new Error('minimap: no 2D context');
    this.ctx = ctx;

    // The first ask, spelled out here rather than left to `refreshTerrain`
    // below, because `terrain` and `terrainIsPhotograph` have to be
    // definitely assigned by the end of this constructor and the compiler
    // cannot see that through a method call. `draw()` asks again immediately
    // and gets the same object back, so the second ask is one reference
    // compare, not a second photograph.
    const photo = deps.groundImage?.() ?? null;
    this.terrainFrom = photo;
    this.terrainIsPhotograph = photo !== null;
    this.terrain = this.groundFor(photo);
    this.draw();
  }

  /**
   * The HUD's cadence, kept locally rather than borrowed, so this component
   * does not depend on hud.ts for anything at all. 4 Hz: at 20 Hz the redraw
   * is 5x the cost for a picture that reads identically, and the units on a
   * 4.375px-per-tile map move a fraction of a pixel between ticks.
   */
  onTick(): void {
    if (this.tickN++ % 5 !== 0) return;
    this.draw(performance.now());
  }

  /**
   * Mark ground the player should look at, now.
   *
   * Points rather than entities, and that is the whole design: the alert this
   * exists for is `unitLost`, whose subject is dead by the time the feed line
   * is written, so an entity-keyed mark would have nothing to draw at. A tile
   * survives its occupant.
   *
   * `nowMs` is passed in rather than read here for the same reason `draw`
   * takes one -- the caller is the tick loop, which already holds a frame
   * clock, and a second `performance.now()` a few hundred microseconds later
   * would make the two disagree for no gain.
   *
   * Expired entries are dropped here, on every call, so the list holds at
   * most one `FLASH_MS` window's worth of alerts plus the batch just added --
   * a bound set by how fast alerts can arrive, never by mission length. The
   * sweep is on the ADD rather than on the draw because `drawFlashes` runs
   * five times as often and skips a dead entry in one comparison anyway.
   */
  flash(points: readonly MinimapPoint[], nowMs: number): void {
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      if (nowMs - this.flashes[i].at >= FLASH_MS) this.flashes.splice(i, 1);
    }
    for (const p of points) this.flashes.push({ p: { x: p.x, y: p.y }, at: nowMs });
  }

  /**
   * Mark ground the PLAYER chose, now.
   *
   * The same shape as `flash` and deliberately not the same list: a flash is
   * the game saying "look", a ping is the player saying it, they run on
   * different spans, and a player who pings the tile an alert just fired on
   * should see both marks rather than one that has quietly replaced the
   * other.
   *
   * Local and silent to the sim: nothing here is queued, dispatched, or
   * observable from `sim.state` (invariant 4). There is no second player to
   * signal -- this is a note to oneself, and `main.ts` drops an order marker
   * on the field beside it so the note exists in both places the eye goes.
   *
   * Expired entries are dropped on the ADD, exactly as `flash` does, so the
   * list holds at most one `PING_MS` window's worth plus the one just pushed:
   * a bound set by how fast a player can click, never by mission length.
   */
  ping(x: number, y: number, nowMs: number): void {
    for (let i = this.pings.length - 1; i >= 0; i--) {
      if (nowMs - this.pings[i].at >= PING_MS) this.pings.splice(i, 1);
    }
    this.pings.push({ p: { x, y }, at: nowMs });
  }

  destroy(): void {
    // Before the element goes: a drag in flight when a mission ends still
    // holds a reference to this node through the browser's pointer capture,
    // and a removed element's listeners are otherwise only collected when
    // nothing holds it.
    this.listeners.abort();
    this.el.remove();
  }

  /**
   * Where the player pointed, in tile space.
   *
   * `clientX - rect.left`, matching `main.ts`'s own `canvasXY`, so the app has
   * one convention for reading a pointer rather than two. It is a convention
   * and not a correctness claim: `ev.offsetX` is already relative to the
   * target's own box and would give the same answer in a browser. What is NOT
   * optional is subtracting the element's origin at all -- this box is
   * anchored bottom-RIGHT, so its rect starts roughly 1200px in, and a raw
   * client coordinate would clamp every click to the far corner of the map.
   *
   * No DPR term -- the backing store is `MINIMAP_SIZE * dpr` but the CSS box
   * is `MINIMAP_SIZE`, and both `getBoundingClientRect` and `boxToTile` work
   * in CSS pixels.
   */
  private pointAt(ev: MouseEvent): MinimapPoint {
    const rect = this.el.getBoundingClientRect();
    return boxToTile(
      this.proj,
      ev.clientX - rect.left,
      ev.clientY - rect.top,
      this.deps.map.width,
      this.deps.map.height
    );
  }

  /**
   * A click and a drag are ONE path: a click is a drag of zero length, so
   * `jumpTo` is called on down, on every move while the button is held, and
   * once more on release. Two code paths would be two answers to "where did
   * the player point".
   *
   * Alt takes the click instead, and does NOT arm the drag -- a ping is a
   * single mark on a tile the player picked out, and a ping that panned the
   * camera as the hand moved off would be both gestures at once.
   */
  private readonly onDown = (ev: PointerEvent): void => {
    ev.preventDefault();
    const input = this.deps.input;
    if (!input || ev.button !== 0) return;
    const at = this.pointAt(ev);
    if (ev.altKey) {
      input.ping(at.x, at.y);
      return;
    }
    this.dragging = true;
    this.dragMoved = false;
    // Optional because jsdom implements neither this nor `PointerEvent`, and
    // because what it buys is a drag that keeps panning once the pointer has
    // left the 210px box -- which is most of a real drag.
    this.el.setPointerCapture?.(ev.pointerId);
    input.jumpTo(at.x, at.y);
  };

  /** Only while dragging, and `preventDefault` only then too: a bare hover
   *  over the minimap is not this component's event to swallow. */
  private readonly onMove = (ev: PointerEvent): void => {
    if (!this.dragging) return;
    ev.preventDefault();
    this.dragMoved = true;
    const input = this.deps.input;
    if (!input) return;
    const at = this.pointAt(ev);
    input.jumpTo(at.x, at.y);
  };

  /**
   * The release ends a DRAG where the hand stopped, rather than where the last
   * `pointermove` happened to fire -- a pointer moved and released inside one
   * frame delivers its final position only here.
   *
   * It jumps only when the pointer actually moved, and that is what keeps a
   * click one gesture: a plain click is a drag of zero length whose press has
   * already answered it, and jumping again on its release would write the
   * camera twice for one click. Pointer capture is released implicitly by the
   * browser after pointerup, so there is nothing to give back here.
   */
  private readonly onUp = (ev: PointerEvent): void => {
    if (!this.dragging) return;
    ev.preventDefault();
    const moved = this.dragMoved;
    this.dragging = false;
    this.dragMoved = false;
    const input = this.deps.input;
    if (!input || !moved) return;
    const at = this.pointAt(ev);
    input.jumpTo(at.x, at.y);
  };

  /** The drag ends with no final position: nothing is jumped to, the flags
   *  are simply put back. Not folded into `onUp` because that one ANSWERS the
   *  release and this one has no answer to give -- a cancelled gesture is not
   *  a gesture that finished somewhere. */
  private readonly onCancel = (): void => {
    this.dragging = false;
    this.dragMoved = false;
  };

  /** The order. The modifiers are passed on rather than interpreted: what
   *  Shift and Alt MEAN is `resolvePointer`'s business, and this file
   *  deciding any part of it would be the second answer the whole arrangement
   *  exists to prevent. */
  private readonly onMenu = (ev: MouseEvent): void => {
    ev.preventDefault();
    const input = this.deps.input;
    if (!input) return;
    const at = this.pointAt(ev);
    input.order(at.x, at.y, { append: ev.shiftKey, confirm: ev.altKey });
  };

  /**
   * The ground, once. Cover tiers read as the graining they are on the field;
   * `blocked` covers both buildings and rock ridge; `boulder` gets the rock
   * tone because it is rock, and because on `tel_marum` the boulder corridor
   * is a piece of terrain the player has to plan around and therefore has to
   * be able to see from the minimap.
   */
  private paintTerrain(): HTMLCanvasElement {
    const { map, tones } = this.deps;
    const c = document.createElement('canvas');
    c.width = map.width;
    c.height = map.height;
    // See `photographedTerrain` for why both grounds label themselves.
    c.dataset.source = 'painted';
    const g = c.getContext('2d');
    if (!g) throw new Error('minimap: no 2D context for the terrain layer');
    g.fillStyle = tones.open;
    g.fillRect(0, 0, map.width, map.height);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const i = y * map.width + x;
        let tone: string | null = null;
        if (map.blocked[i] !== 0) tone = tones.blocked;
        else if (map.boulder[i] !== 0) tone = tones.rock;
        else if (map.cover[i] > 0) tone = tones.cover[Math.min(map.cover[i], 3) - 1];
        if (tone === null) continue;
        g.fillStyle = tone;
        g.fillRect(x, y, 1, 1);
      }
    }
    return c;
  }

  /**
   * The canvas to blit for the image the renderer answered with, building
   * whichever of the two grounds that is.
   *
   * The painted fallback is cached and the photograph is not, and the
   * asymmetry is the point: there is exactly one painted ground for a map,
   * while a new `ImageData` means the renderer has a new picture and the old
   * canvas is the thing being replaced.
   */
  private groundFor(photo: ImageData | null): HTMLCanvasElement {
    if (photo !== null) return photographedTerrain(photo);
    this.painted ??= this.paintTerrain();
    return this.painted;
  }

  /**
   * Ask the renderer for its ground, and rebuild the blit source only if the
   * answer is a different object.
   *
   * Called once per redraw. The comparison is IDENTITY and the renderer
   * promises it (`Renderer.captureGroundAlbedo`): the same `ImageData` comes
   * back until the terrain is rebuilt or a ground texture lands, so the
   * steady-state cost of asking four times a second is a reference compare.
   * `null === null` short-circuits the same way, so a Pixi mission -- which
   * answers null forever -- never re-enters `groundFor` at all.
   *
   * A null answer AFTER a photograph deliberately falls back rather than
   * keeping the last picture: null means the backend cannot photograph this
   * ground, and showing a stale photograph of ground it has disowned is the
   * failure this whole seam was re-plumbed to stop.
   */
  private refreshTerrain(): void {
    const photo = this.deps.groundImage?.() ?? null;
    if (photo === this.terrainFrom) return;
    this.terrainFrom = photo;
    this.terrainIsPhotograph = photo !== null;
    this.terrain = this.groundFor(photo);
  }

  /** `nowMs` defaults so the constructor's first paint needs no clock of its
   *  own; `onTick` passes the frame's. Wall time, never ticks -- see
   *  `FLASH_MS`. */
  private draw(nowMs: number = performance.now()): void {
    const { ctx, proj } = this;
    const s = MINIMAP_SIZE;
    // Before anything is laid down: the ground is the bottom of the stack,
    // and a refresh after the blit would show the new picture one redraw
    // late for no gain.
    this.refreshTerrain();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, s, s);

    ctx.fillStyle = this.chrome.ground;
    ctx.fillRect(0, 0, s, s);

    // Nearest-neighbour for the PAINTED ground: a 48px source blown up 4.375x
    // should read as tiles, not as a blur of them.
    //
    // And the opposite for the photograph, which is the one thing Task 15
    // reconsidered rather than inherited. `captureGroundAlbedo` renders at
    // MINIMAP_SIZE, so its source is already at the box's own scale (210px
    // into a 210px box, 1.0x on every shipped map) -- there is no blow-up
    // for nearest-neighbour to keep crisp, and refusing to interpolate a
    // near-1:1 resample only re-aliases an image that already landed right.
    // The letterbox scale on a non-square map is fractional, which is
    // exactly where the difference shows.
    //
    // Desaturated, and on the TERRAIN ONLY. Unchanged by Task 15, and it
    // matters more now rather than less: a photograph of lit ground carries
    // far more colour than a flat palette tone did. The spec puts `saturate(.4)` on
    // the whole box, marks included, because its minimap is a placeholder
    // screenshot with the dots laid over it; doing that for real would wash
    // out the four colours the minimap exists to report. Applying it here
    // instead keeps the intent (a muted map) and drops the cost. It is not
    // decoration: photographed at 1440x900 without it, an amber objective
    // diamond standing on Beit Sahwan's town block was nearly indistinguishable
    // from the building tone underneath it, which is exactly the reading a
    // player needs and the one place the map must not compete.
    ctx.imageSmoothingEnabled = this.terrainIsPhotograph;
    ctx.filter = 'saturate(0.4)';
    ctx.drawImage(
      this.terrain,
      proj.ox,
      proj.oy,
      this.deps.map.width * proj.scale,
      this.deps.map.height * proj.scale
    );
    ctx.filter = 'none';
    ctx.imageSmoothingEnabled = true;

    for (const p of objectivePoints(this.deps.objectives(), this.deps.map)) {
      this.diamond(p, this.chrome.objective);
    }
    for (const p of observedMarkers(this.deps.map, this.fogAt, this.seenMarkers)) {
      this.diamond(p, this.chrome.story);
    }

    for (const d of unitDots(this.deps.sim, this.fogAt)) {
      const at = tileToBox(proj, d.x, d.y);
      // Colour FIRST and unchanged: the shape is the second channel, not the
      // replacement for a first one that was measured to work.
      ctx.fillStyle = this.deps.teamColors[d.side] ?? this.deps.teamColors[2];
      this.dot(at, dotShape(d.side));
    }

    this.drawFlashes(nowMs);
    this.drawPings(nowMs);

    this.drawViewport();
  }

  /**
   * One unit mark, `DOT` box pixels tall whichever silhouette it wears.
   *
   * The square keeps its rounded integer rect -- a 6px axis-aligned fill on a
   * half-pixel boundary is a blurred 7px one, and the player's own units are
   * the marks most often stacked. The other two are paths and are NOT
   * rounded: a triangle snapped to whole pixels is a different triangle, and
   * neither shape has an edge that a half pixel can smear along.
   *
   * All three are centred on the tile, and for the triangle that means its
   * CENTROID rather than its bounding box -- an equilateral sitting on its
   * bounding centre reads as a mark a pixel above where the unit is, which is
   * exactly the error a minimap must not make.
   */
  private dot(at: MinimapPoint, shape: DotShape): void {
    const { ctx } = this;
    if (shape === 'square') {
      ctx.fillRect(Math.round(at.x - DOT / 2), Math.round(at.y - DOT / 2), DOT, DOT);
      return;
    }
    if (shape === 'circle') {
      ctx.beginPath();
      ctx.arc(at.x, at.y, DOT / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    // Equilateral, `DOT` tall, apex up. The centroid sits one third of the
    // height above the base, so the apex is 2/3 up and the base 1/3 down.
    const half = DOT / Math.sqrt(3);
    ctx.beginPath();
    ctx.moveTo(at.x, at.y - (DOT * 2) / 3);
    ctx.lineTo(at.x + half, at.y + DOT / 3);
    ctx.lineTo(at.x - half, at.y + DOT / 3);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * The alert marks: an expanding stroked ring, fading over `FLASH_MS`.
   *
   * Drawn AFTER the unit dots and BEFORE the viewport outline. A mark the
   * player must see over the dots -- a squad wiped out is exactly the moment
   * its own dot stops being there -- and under the frame that says where they
   * are looking, which is the one mark that must never be obscured.
   *
   * `CHROME.objective`'s amber rather than a fifth chrome key: an alert is
   * the same "look here" the objective diamond already means, and a second
   * amber would be two tokens for one idea (CLAUDE.md: colour comes from the
   * palette, through `theme.css`'s semantic names).
   *
   * At the minimap's 4 Hz a 1400 ms flash gets about six frames, which is a
   * visible fade rather than a blink.
   */
  private drawFlashes(nowMs: number): void {
    const { ctx, proj } = this;
    for (const f of this.flashes) {
      const a = flashAlpha(nowMs - f.at);
      if (a <= 0) continue;
      const at = tileToBox(proj, f.p.x, f.p.y);
      // Expands as it fades: motion is what catches an eye that was looking
      // somewhere else, which is the whole job.
      const r = FLASH_R0 + (FLASH_R1 - FLASH_R0) * (1 - a);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = this.chrome.objective;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * The player's own marks: an expanding ring with a static dot at its centre,
   * fading over `PING_MS`.
   *
   * `CHROME.story`'s tone rather than the alert amber, and that is the whole
   * distinction the two marks carry: amber is the game asking for attention,
   * and this is the player's own note on ground they named. A ping in the
   * alert colour would make the minimap report a threat the sim never raised.
   *
   * Drawn after the flashes and still under the viewport outline, for the
   * same reason the flashes are: the frame that says where the player is
   * looking is the one mark nothing may obscure.
   */
  private drawPings(nowMs: number): void {
    const { ctx, proj } = this;
    for (const p of this.pings) {
      const a = linearFade(nowMs - p.at, PING_MS);
      if (a <= 0) continue;
      const at = tileToBox(proj, p.p.x, p.p.y);
      const r = PING_R0 + (PING_R1 - PING_R0) * (1 - a);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = this.chrome.story;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
      ctx.stroke();
      // The address, and it does not grow: by the time the ring has expanded
      // it has stopped saying WHERE.
      ctx.fillStyle = this.chrome.story;
      ctx.beginPath();
      ctx.arc(at.x, at.y, PING_DOT, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /** Bound once: `unitDots` and `observedMarkers` take fog as a predicate so
   *  they stay free of the renderer, and re-closing it per redraw is litter. */
  private readonly fogAt = (wx: number, wy: number): boolean => this.deps.view.isVisible(wx, wy);

  /** A stroked square turned 45 degrees, matching the spec's own transform. */
  private diamond(p: MinimapPoint, color: string): void {
    const { ctx } = this;
    const at = tileToBox(this.proj, p.x, p.y);
    const r = (DIAMOND * Math.SQRT2) / 2;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(at.x, at.y - r);
    ctx.lineTo(at.x + r, at.y);
    ctx.lineTo(at.x, at.y + r);
    ctx.lineTo(at.x - r, at.y);
    ctx.closePath();
    ctx.stroke();
  }

  private drawViewport(): void {
    const { ctx, proj } = this;
    const quad = viewportQuad(this.deps.view);
    ctx.strokeStyle = this.chrome.viewport;
    ctx.lineWidth = 1;
    ctx.beginPath();
    quad.forEach((w, i) => {
      const at = tileToBox(proj, w.x, w.y);
      if (i === 0) ctx.moveTo(at.x, at.y);
      else ctx.lineTo(at.x, at.y);
    });
    ctx.closePath();
    ctx.stroke();
  }
}
