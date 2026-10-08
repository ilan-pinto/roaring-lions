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
// from `blocked`/`boulder`/`cover` (48px, unsmoothed) -- what shipped first,
// and what a renderer that cannot photograph yet (or a test) still gets.
// Per redraw the work is one `drawImage`, four
// `screenToWorld` calls, one pass over living entities, and a handful of
// diamonds -- and the whole thing happens at 4 Hz, on the HUD's own cadence.
//
// Nothing here reads or writes sim state beyond the read-only `sim.state` view
// (invariant 4), and the only @lions/sim imports are `fx` and the `Sim` type.

import { unitIsObserved, type TerrainTones } from '@lions/render';
import { fx, type Sim } from '@lions/sim';
import { paintMapTerrain } from './map-preview';
import { zoneStateOf } from '../objective-zones';
import type { AlertTier } from './alerts';
import type { Tone } from './hud-model';

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
  /** The objective type, which makes a raze/collapse zone a `target`
   *  (`zoneStateOf`). Optional: absent reads as a hold. */
  readonly type?: string;
  /** Why a timed hold is paused, as `objectiveList` reports it (VR-36). */
  readonly paused?: 'contested' | 'unheld';
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
  /**
   * Where the families walk to, in tiles, while an evacuation objective is
   * still being scored -- null otherwise (GH-279). A thunk for the same
   * reason `objectives` is: it drops off the moment the evacuation is
   * decided. Optional, and absent means nothing is drawn, which is what every
   * mount that predates it gets.
   *
   * Its own mark rather than one more objective diamond. The refuge usually
   * sits inside ground another objective is about (Khan Rafid's is two tiles
   * from the ward's own hold diamond), and two amber diamonds nine pixels
   * apart read as one smudged one.
   */
  refuge?: () => MinimapPoint | null;
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
   * Optional, and `null` is a first-class answer rather than a failure: a
   * renderer that has no photograph to give falls back to `paintTerrain` --
   * which is not a degradation, it is exactly what shipped. (Pixi answered
   * null forever until it was retired, WP-A3.3.) Every test that predates
   * this mounts without it and takes that same path.
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
export const CHROME = {
  /** The camera's own footprint. */
  viewport: 'var(--live)',
  /** A named piece of ground the player has seen. */
  story: 'var(--live)',
  /** An objective zone in each of the world's hold states (VR-36) -- the
   *  tokens over the SAME palette keys `objectiveZoneColorKey` gives the
   *  world's outline (`vfx.tracer`, `team.neutral`, `team.hostile`). */
  held: 'var(--live)',
  unheld: 'var(--warn)',
  contested: 'var(--bad)',
  /** An alert ring in its alert's tone (VR-36). */
  toneGood: 'var(--good)',
  toneBad: 'var(--bad)',
  toneWarn: 'var(--warn)',
  toneInfo: 'var(--info)',
  /** The dark keyline under a zone edge, a ring and a suspected contact,
   *  so each holds on pale sand -- the job the refuge cross's edge does. */
  markEdge: 'var(--mark-edge)',
  /** Where families are walked to while an evacuation is scored (GH-279). */
  refuge: 'var(--good)',
  /** The refuge cross's dark under-stroke. Measured necessary, not taste:
   *  photographed at 1440x900 on Khan Rafid, the green cross alone on the
   *  desaturated sand-and-limestone ward was a faint smudge beside the
   *  lime viewport outline. */
  refugeEdge: 'var(--mark-edge)',
  /** An identified tunnel route (GH-471), the world x-ray's own colour --
   *  `--intercept` is `vfx.interceptor`, the bore's rim. */
  tunnel: 'var(--intercept)',
  /** Under the map, on the two edges a non-square map would letterbox. */
  ground: 'var(--panel-bg-solid)',
} as const;

export type ChromeKey = keyof typeof CHROME;
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

/** GH-471: the identified-route line's stroke, its keyline, and the shaft
 *  square, in box pixels. */
const TUNNEL_STROKE = 2;
const TUNNEL_KEYLINE = 4;
const TUNNEL_SHAFT = 5;

/** What the minimap may know about tunnels: a structural subset of `Sim`. */
export interface TunnelSource {
  readonly tunnelCount: number;
  readonly tnAlive: ArrayLike<number>;
  readonly tnLength: ArrayLike<number>;
  tunnelContactLevel(side: number, r: number): number;
  tunnelPointAt(r: number, d: number): readonly [number, number];
}

/** One identified route as the minimap draws it, in tile-centre coordinates. */
export interface TunnelMark {
  readonly route: number;
  readonly line: readonly (readonly [number, number])[];
  /** Mouth, then vent. */
  readonly shafts: readonly [readonly [number, number], readonly [number, number]];
}

/**
 * GH-471: the routes side 0 holds IDENTIFIED right now, and only those --
 * the same level the world's x-ray draws at (a collapsed route draws
 * nothing, as the world's does not). A pure read of the sim.
 */
export function tunnelMarks(sim: TunnelSource): TunnelMark[] {
  const out: TunnelMark[] = [];
  for (let r = 0; r < sim.tunnelCount; r++) {
    if (sim.tnAlive[r] === 0 || sim.tunnelContactLevel(0, r) !== 2) continue;
    const len = fx.toNumber(sim.tnLength[r]);
    const line: [number, number][] = [];
    for (let d = 0; ; d += 0.5) {
      const at = Math.min(d, len);
      const p = sim.tunnelPointAt(r, fx.from(at));
      line.push([fx.toNumber(p[0]) + 0.5, fx.toNumber(p[1]) + 0.5]);
      if (at >= len) break;
    }
    out.push({ route: r, line, shafts: [line[0], line[line.length - 1]] });
  }
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
/** A zone objective's state on the minimap -- the world's own four. */
export type ZoneState = 'held' | 'unheld' | 'contested' | 'target';

/**
 * How one zone state is drawn (VR-36, approved 2026-10-08). The colour is the
 * world's, by construction; the DASH is the second channel, because `--live`
 * and `--warn` measure ΔE 8-17 apart under deuteranopia and protanopia
 * (`docs/polish/minimap-state.md`), so colour alone cannot tell held from
 * not held. The pulse mirrors `objectiveZonePulse`: what is changing pulses.
 */
export interface ZoneMarkStyle {
  chrome: ChromeKey;
  dashed: boolean;
  pulses: boolean;
}
export function zoneMarkStyle(state: ZoneState): ZoneMarkStyle {
  switch (state) {
    case 'held':
      return { chrome: 'held', dashed: false, pulses: false };
    case 'unheld':
      return { chrome: 'unheld', dashed: true, pulses: true };
    case 'contested':
      return { chrome: 'contested', dashed: true, pulses: true };
    case 'target':
      return { chrome: 'contested', dashed: false, pulses: false };
  }
}

/** One active objective as the minimap draws it: its zone's rectangle where
 *  it names a zone, otherwise the marker it names, and its state. */
export interface ObjectiveMark {
  state: ZoneState;
  /** `[x, y, w, h]` in tiles, or null for a marker objective. */
  rect: readonly [number, number, number, number] | null;
  at: MinimapPoint;
}

/** Every ACTIVE objective that names ground, as `ObjectiveMark`s. The state is
 *  `zoneStateOf` -- the renderer's own rule, imported, not restated. */
export function objectiveMarks(objectives: readonly MinimapObjective[], map: MinimapMap): ObjectiveMark[] {
  const out: ObjectiveMark[] = [];
  for (const o of objectives) {
    if (o.status !== 'active' || o.zone === undefined) continue;
    const at = objectivePoint(o, map);
    if (at === null) continue;
    const z = map.zones[o.zone];
    out.push({ state: zoneStateOf({ type: o.type ?? '', paused: o.paused }), rect: z ?? null, at });
  }
  return out;
}

export function objectivePoint(o: MinimapObjective, map: Pick<MinimapMap, 'zones' | 'markers'>): MinimapPoint | null {
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
  /** A hostile the player has only SUSPECTED (`sim.contactLevel` < 2), not
   *  identified -- drawn hollow, like the world's hollow diamond (VR-36). */
  suspected: boolean;
}

/** The silhouettes a unit mark can wear. `hollow` is a suspected contact. */
export type DotShape = 'square' | 'triangle' | 'circle' | 'hollow';

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
export function dotShape(side: number, suspected = false): DotShape {
  if (side === 0) return 'square';
  // VR-36: what the player KNOWS about the contact, as the world says it
  // (`contactShapeOf` -> 'unknown', a hollow diamond). Hostiles only: a
  // friendly is always known, and the world marks no civilian.
  if (side === 1 && suspected) return 'hollow';
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
    const side = st.side[i];
    out.push({ x, y, side, suspected: side === 1 && sim.contactLevel(0, i) < 2 });
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
 * The alert ring by TIER (VR-36, approved 2026-10-08): how big, how wide,
 * how long, and whether it is doubled. `important` is the ring that shipped
 * (5 -> 16 px, 2 px, `FLASH_MS`); a major alert is bigger, longer and two
 * rings; a minor one smaller, thinner and shorter.
 */
export const RING_BY_TIER: Readonly<Record<AlertTier, { r0: number; r1: number; width: number; ms: number; double: boolean }>> = {
  major: { r0: 6, r1: 22, width: 2, ms: 2000, double: true },
  important: { r0: 5, r1: 16, width: 2, ms: FLASH_MS, double: false },
  minor: { r0: 4, r1: 11, width: 1.5, ms: 1000, double: false },
};
/** The gap between a major alert's two rings, px. */
const RING_DOUBLE_GAP = 4;

/** What an alert ring looks like: its tier's geometry, its tone's colour, and
 *  which way it moves. */
export interface RingStyle {
  r0: number;
  r1: number;
  width: number;
  ms: number;
  double: boolean;
  chrome: ChromeKey;
  /** Good news and info SETTLE inward; bad news and caution spread outward.
   *  The second channel beside colour: `--good` and `--bad` measure ΔE 14-20
   *  apart under protanopia (`docs/polish/minimap-state.md`). */
  inward: boolean;
}
export function ringStyle(tier: AlertTier, tone: Tone): RingStyle {
  const g = RING_BY_TIER[tier];
  const chrome: ChromeKey =
    tone === 'bad' ? 'toneBad' : tone === 'warn' ? 'toneWarn' : tone === 'good' ? 'toneGood' : 'toneInfo';
  return { ...g, chrome, inward: tone === 'good' || tone === 'info' || tone === 'live' || tone === 'mute' };
}
/** The ring's radius at fade `alpha` (1 at the event, 0 at the end). */
export function ringRadius(style: RingStyle, alpha: number): number {
  const t = 1 - alpha;
  return style.inward ? style.r1 - (style.r1 - style.r0) * t : style.r0 + (style.r1 - style.r0) * t;
}

/** One ring's period of pulse for an unheld or contested zone, ms -- the
 *  world's `objectiveZonePulse` (0.09 rad a 60 Hz frame) in wall time. */
export const ZONE_PULSE_MS = (2 * Math.PI * 1000) / (0.09 * 60);
/** The pulse's stroke alpha, low and high. Never below 0.55: a 2 px edge on a
 *  210 px map must not fade out of sight between redraws. */
export const ZONE_PULSE_ALPHA: readonly [number, number] = [0.55, 1];
export function zonePulseAlpha(nowMs: number): number {
  const [lo, hi] = ZONE_PULSE_ALPHA;
  return lo + (hi - lo) * (0.5 + 0.5 * Math.sin((2 * Math.PI * nowMs) / ZONE_PULSE_MS));
}

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
/** The objective zone mark (VR-36): 2 px edge on a 4 px keyline, a 3/2 dash
 *  while not held or contested, and a 0.12 fill. The world dropped its own
 *  0.12 fill for a hatched ground band (GH-470); on the minimap the fill is a
 *  flat mark on a flat map and hides nothing. */
const ZONE_STROKE = 2;
const ZONE_KEYLINE = 4;
const ZONE_DASH: readonly number[] = [3, 2];
const ZONE_FILL_ALPHA = 0.12;
/** A marker objective's square, px. */
const OBJECTIVE_SQUARE = 10;
/** The suspected contact's hollow diamond (VR-36): 8 px tall, a 1.5 px stroke
 *  on a 3.5 px keyline. */
const SUSPECT_HALF = 4;
const SUSPECT_STROKE = 1.5;
const SUSPECT_KEYLINE = 3.5;
/** The ping's ring, same idea and deliberately a different size: it starts
 *  inside the important ring's 5 px and ends outside its 16, so a ping landing on top of
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
   *  whose renderer keeps answering null would repaint 2,304 tiles four times
   *  a second for a picture that cannot change. */
  private painted: HTMLCanvasElement | null = null;
  private readonly proj: MinimapProjection;
  /** Re-resolved by `setTeamColors` (VR-01): `unheld`/`toneWarn` are `--warn`
   *  and `contested`/`toneBad` are `--bad`, which a colour-vision block
   *  re-points. */
  private chrome: ChromeColors;
  /** `deps.teamColors` until `setTeamColors` replaces it (VR-01). */
  private teamColors: readonly [string, string, string];
  private readonly seenMarkers = new Set<string>();
  /** Live alert marks: where, and the wall-clock instant each landed. */
  private readonly flashes: { p: MinimapPoint; at: number; style: RingStyle }[] = [];
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
    this.teamColors = deps.teamColors;
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
  /** GH-345: on or off screen by the HUD disclosure set. Off is inert as well
   *  as invisible: a `display: none` canvas takes no pointer events, so none
   *  of its four gestures can land. */
  setShown(on: boolean): void {
    this.el.toggleAttribute('data-hud-hidden', !on);
  }

  /**
   * VR-01: a colour-vision change mid-mission. The dots take the variant's
   * `teamColors` -- the SAME array `Renderer.setTeamColors` was handed, so a
   * dot and the ring on the field still cannot disagree -- and the chrome is
   * re-read through the probe, because the zone and ring tokens `--warn` and
   * `--bad` follow `data-cvd`, and the block that re-points them has already been written on the root
   * by the time the settings bus fires. Redraws at once rather than waiting
   * up to four ticks: a paused game would otherwise keep the old colours.
   */
  setTeamColors(teamColors: readonly [string, string, string]): void {
    this.teamColors = teamColors;
    this.chrome = resolveChrome(this.el.parentElement ?? document.body);
    this.draw(performance.now());
  }

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
  flash(points: readonly MinimapPoint[], nowMs: number, mark: { tier: AlertTier; tone: Tone }): void {
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      if (nowMs - this.flashes[i].at >= this.flashes[i].style.ms) this.flashes.splice(i, 1);
    }
    // VR-36: the ring wears the alert's urgency and its good/bad, so a lost
    // tank no longer looks like reinforcements arriving. Required, not
    // defaulted: a call site that forgot it would silently draw one look
    // for everything again, which is the defect.
    const style = ringStyle(mark.tier, mark.tone);
    for (const p of points) this.flashes.push({ p: { x: p.x, y: p.y }, at: nowMs, style });
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
   * The ground, once -- painted by `map-preview.ts`'s `paintMapTerrain`, the
   * one copy of the tile loop (shell-upgrade Phase 3, Task 3: the deploy
   * screen draws the same ground before any `Sim` exists, so the loop moved
   * out of this class rather than being copied beside it). What stays here is
   * what is the minimap's own: the `'painted'` label and the throw, because
   * unlike the deploy screen's preview this canvas cannot go without it.
   */
  private paintTerrain(): HTMLCanvasElement {
    const c = paintMapTerrain(this.deps.map, this.deps.tones);
    if (c === null) throw new Error('minimap: no 2D context for the terrain layer');
    // See `photographedTerrain` for why both grounds label themselves.
    c.dataset.source = 'painted';
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
   * `null === null` short-circuits the same way, so a renderer that keeps
   * answering null never re-enters `groundFor` at all.
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

    for (const m of objectiveMarks(this.deps.objectives(), this.deps.map)) {
      this.objectiveMark(m, nowMs);
    }
    this.drawTunnels();
    for (const p of observedMarkers(this.deps.map, this.fogAt, this.seenMarkers)) {
      this.diamond(p, this.chrome.story);
    }
    const refuge = this.deps.refuge?.() ?? null;
    if (refuge) this.cross(refuge, this.chrome.refuge, this.chrome.refugeEdge);

    for (const d of unitDots(this.deps.sim, this.fogAt)) {
      const at = tileToBox(proj, d.x, d.y);
      // Colour FIRST and unchanged: the shape is the second channel, not the
      // replacement for a first one that was measured to work.
      ctx.fillStyle = this.teamColors[d.side] ?? this.teamColors[2];
      this.dot(at, dotShape(d.side, d.suspected));
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
    if (shape === 'hollow') {
      // VR-36: a suspected contact, the world's hollow diamond in miniature --
      // the colour the fill would have had, as a stroke over the keyline.
      const color = String(ctx.fillStyle);
      const r = SUSPECT_HALF;
      for (const [style, width] of [
        [this.chrome.markEdge, SUSPECT_KEYLINE],
        [color, SUSPECT_STROKE],
      ] as const) {
        ctx.strokeStyle = style;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(at.x, at.y - r);
        ctx.lineTo(at.x + r, at.y);
        ctx.lineTo(at.x, at.y + r);
        ctx.lineTo(at.x - r, at.y);
        ctx.closePath();
        ctx.stroke();
      }
      ctx.lineWidth = 1;
      return;
    }
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
   * The alert marks: a stroked ring, fading over its tier's life.
   *
   * Drawn AFTER the unit dots and BEFORE the viewport outline. A mark the
   * player must see over the dots -- a squad wiped out is exactly the moment
   * its own dot stops being there -- and under the frame that says where they
   * are looking, which is the one mark that must never be obscured.
   *
   * VR-36 (approved 2026-10-08): it used to be one amber ring for every
   * alert, so a lost tank and a delivered jeep looked alike. Now the TIER sets
   * size, width, life and a double ring for major (`RING_BY_TIER`), the TONE
   * sets the colour, and good news settles inward where bad news spreads out
   * (`ringStyle`). Every ring sits on a `--mark-edge` keyline two pixels
   * wider, at the same alpha.
   */
  /** GH-471: every route side 0 holds identified, as a line with a square
   *  at each shaft (`tunnelMarks`); nothing for a suspected or unknown one.
   *  Over the terrain and the zones, under the unit dots. */
  private drawTunnels(): void {
    const { ctx, proj } = this;
    for (const mark of tunnelMarks(this.deps.sim)) {
      const pts = mark.line.map(([x, y]) => tileToBox(proj, x, y));
      for (const [style, width] of [
        [this.chrome.markEdge, TUNNEL_KEYLINE],
        [this.chrome.tunnel, TUNNEL_STROKE],
      ] as const) {
        ctx.strokeStyle = style;
        ctx.lineWidth = width;
        ctx.beginPath();
        pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.stroke();
      }
      ctx.fillStyle = this.chrome.tunnel;
      for (const [x, y] of mark.shafts) {
        const p = tileToBox(proj, x, y);
        ctx.fillRect(Math.round(p.x - TUNNEL_SHAFT / 2), Math.round(p.y - TUNNEL_SHAFT / 2), TUNNEL_SHAFT, TUNNEL_SHAFT);
      }
    }
    ctx.lineWidth = 1;
  }

  private drawFlashes(nowMs: number): void {
    const { ctx, proj } = this;
    for (const f of this.flashes) {
      const a = linearFade(nowMs - f.at, f.style.ms);
      if (a <= 0) continue;
      const at = tileToBox(proj, f.p.x, f.p.y);
      const r = ringRadius(f.style, a);
      const radii = f.style.double ? [r, r - RING_DOUBLE_GAP] : [r];
      ctx.save();
      ctx.globalAlpha = a;
      for (const rr of radii) {
        if (rr <= 1) continue;
        for (const [style, width] of [
          [this.chrome.markEdge, f.style.width + 2],
          [this.chrome[f.style.chrome], f.style.width],
        ] as const) {
          ctx.strokeStyle = style;
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.arc(at.x, at.y, rr, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  /**
   * The player's own marks: an expanding ring with a static dot at its centre,
   * fading over `PING_MS`.
   *
   * `CHROME.story`'s tone rather than an alert tone, and that is the whole
   * distinction the two marks carry: an alert ring is the game asking for
   * attention, and this is the player's own note on ground they named. A ping
   * in an alert colour would make the minimap report a threat the sim never
   * raised. The centre dot is the ping's own: no alert ring carries one.
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

  /**
   * One objective, as the world draws it (VR-36): its zone's own rectangle in
   * the world's state colour, a translucent fill, a `--mark-edge` keyline, and
   * a DASHED edge while not held or contested (`zoneMarkStyle`). It used to
   * be an amber diamond at the zone centre whatever its state -- and a red
   * diamond would now be a suspected contact, so the zone is the shape.
   *
   * A marker objective has no rectangle: it gets a square of
   * `OBJECTIVE_SQUARE` px at the marker, by the same rules.
   */
  private objectiveMark(m: ObjectiveMark, nowMs: number): void {
    const { ctx, proj } = this;
    const look = zoneMarkStyle(m.state);
    const color = this.chrome[look.chrome];
    let x0: number, y0: number, x1: number, y1: number;
    if (m.rect !== null) {
      const a = tileToBox(proj, m.rect[0], m.rect[1]);
      const b = tileToBox(proj, m.rect[0] + m.rect[2], m.rect[1] + m.rect[3]);
      [x0, y0, x1, y1] = [a.x, a.y, b.x, b.y];
    } else {
      const c = tileToBox(proj, m.at.x, m.at.y);
      const h = OBJECTIVE_SQUARE / 2;
      [x0, y0, x1, y1] = [c.x - h, c.y - h, c.x + h, c.y + h];
    }
    const outline = (): void => {
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y0);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x0, y1);
      ctx.closePath();
    };
    ctx.save();
    ctx.globalAlpha = ZONE_FILL_ALPHA;
    ctx.fillStyle = color;
    outline();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.strokeStyle = this.chrome.markEdge;
    ctx.lineWidth = ZONE_KEYLINE;
    outline();
    ctx.stroke();
    ctx.globalAlpha = look.pulses ? zonePulseAlpha(nowMs) : 1;
    ctx.setLineDash(look.dashed ? ZONE_DASH : []);
    ctx.strokeStyle = color;
    ctx.lineWidth = ZONE_STROKE;
    outline();
    ctx.stroke();
    ctx.restore();
  }

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

  /** A plus sign, a little wider than `DIAMOND`: the refuge (GH-279). A different SHAPE
   *  from every other mark here, not just a different colour -- the same
   *  second channel `dotShape` gives the unit dots. */
  private cross(p: MinimapPoint, color: string, edge: string): void {
    const { ctx } = this;
    const at = tileToBox(this.proj, p.x, p.y);
    const r = DIAMOND / 2 + 2;
    // Edge first and wider, then the colour on top: a dark keyline so the
    // mark holds on light ground as well as dark.
    for (const [style, width] of [
      [edge, 5],
      [color, 3],
    ] as const) {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(at.x - r, at.y);
      ctx.lineTo(at.x + r, at.y);
      ctx.moveTo(at.x, at.y - r);
      ctx.lineTo(at.x, at.y + r);
      ctx.stroke();
    }
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
