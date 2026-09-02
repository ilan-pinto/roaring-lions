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
// painted ONCE into an offscreen canvas at one pixel per tile and blitted
// (unsmoothed) on each redraw. Per redraw the work is one `drawImage`, four
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
    if (o.zone === undefined) continue;
    const z = map.zones[o.zone];
    if (z) {
      out.push({ x: z[0] + z[2] / 2, y: z[1] + z[3] / 2 });
      continue;
    }
    const m = map.markers[o.zone];
    if (m) out.push({ x: m[0] + 0.5, y: m[1] + 0.5 });
  }
  return out;
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

/** Dot edge, in box pixels. 6px filled, from the spec's own inline style. */
const DOT = 6;
/** Diamond edge before the 45-degree turn, in box pixels. Spec: 8px stroked. */
const DIAMOND = 8;

export class Minimap {
  private readonly el: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** One pixel per tile, painted once. */
  private readonly terrain: HTMLCanvasElement;
  private readonly proj: MinimapProjection;
  private readonly chrome: ChromeColors;
  private readonly seenMarkers = new Set<string>();
  private readonly dpr: number;
  private tickN = 0;

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
    // Deliberately NOT pointer-events:none. The minimap sits over the corner
    // of the battlefield, and a click that fell through it would issue an
    // order on ground the player cannot see and did not aim at. Swallowing the
    // event is the correct behaviour until click-to-jump exists.
    host.appendChild(this.el);

    const ctx = this.el.getContext('2d');
    if (!ctx) throw new Error('minimap: no 2D context');
    this.ctx = ctx;

    this.terrain = this.paintTerrain();
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
    this.draw();
  }

  destroy(): void {
    this.el.remove();
  }

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

  private draw(): void {
    const { ctx, proj } = this;
    const s = MINIMAP_SIZE;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, s, s);

    ctx.fillStyle = this.chrome.ground;
    ctx.fillRect(0, 0, s, s);

    // Nearest-neighbour: a 48px source blown up 4.375x should read as tiles,
    // not as a blur of them.
    //
    // Desaturated, and on the TERRAIN ONLY. The spec puts `saturate(.4)` on
    // the whole box, marks included, because its minimap is a placeholder
    // screenshot with the dots laid over it; doing that for real would wash
    // out the four colours the minimap exists to report. Applying it here
    // instead keeps the intent (a muted map) and drops the cost. It is not
    // decoration: photographed at 1440x900 without it, an amber objective
    // diamond standing on Beit Sahwan's town block was nearly indistinguishable
    // from the building tone underneath it, which is exactly the reading a
    // player needs and the one place the map must not compete.
    ctx.imageSmoothingEnabled = false;
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
      ctx.fillStyle = this.deps.teamColors[d.side] ?? this.deps.teamColors[2];
      ctx.fillRect(Math.round(at.x - DOT / 2), Math.round(at.y - DOT / 2), DOT, DOT);
    }

    this.drawViewport();
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
