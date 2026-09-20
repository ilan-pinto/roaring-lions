// @vitest-environment jsdom
//
// The minimap (GH-153, slice 4).
//
// The assertions here are shaped by what a minimap can get wrong that nothing
// else notices:
//
//   - it can leak the sim. Every hostile on the map is one array index away,
//     so the tests that matter are the ones that put a hostile the player has
//     never seen into a real `Sim` and then check that NOTHING was drawn where
//     it stands — through the real draw path, not through the predicate. A
//     test that only exercised `unitDots` would pass while `draw()` painted
//     the whole roster.
//   - it can lie about the camera. `viewportQuad` must ask the renderer for
//     all four corners; a bounding box built from two would claim twice the
//     ground.
//   - it can silently stop being top-down. `tileToBox` is one linear scale,
//     and a dimetric term creeping in would still produce a plausible picture.
//
// jsdom has no canvas backend (`getContext` returns null), so the context is a
// recording stub. That is an upgrade rather than a workaround: it lets a test
// assert the exact fills and strokes, which a real context would only let it
// assert by reading pixels back.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { units } from '@lions/data';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import {
  FLASH_MS,
  MINIMAP_SIZE,
  Minimap,
  PING_MS,
  boxToTile,
  dotShape,
  flashAlpha,
  flipRows,
  linearFade,
  minimapProjection,
  objectivePoint,
  objectivePoints,
  observedMarkers,
  tileToBox,
  unitDots,
  viewportQuad,
  type DotShape,
  type MinimapDeps,
  type MinimapMap,
  type MinimapPoint,
  type MinimapView,
} from './minimap';

// --- the recording context ------------------------------------------------

interface FillRect {
  kind: 'fillRect';
  style: string;
  filter: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface StrokePath {
  kind: 'stroke';
  style: string;
  filter: string;
  /** `globalAlpha` at the moment of the stroke. Recorded because the alert
   *  flash is the one mark drawn translucent, and a `save`/`restore` it
   *  forgot would leave every later mark faded -- a defect that photographs
   *  as "the minimap went dim" and reads as nothing at all in a test that
   *  only looked at coordinates. */
  alpha: number;
  points: [number, number][];
}
/** A filled PATH, which is how the two non-square unit marks and the ping's
 *  centre dot are drawn. Recorded with the same shape as a stroke so the two
 *  can be compared; `fillRect` stays its own op because a rectangle never
 *  becomes a path. */
interface FillPath {
  kind: 'fillPath';
  style: string;
  filter: string;
  alpha: number;
  points: [number, number][];
}
interface DrawImage {
  kind: 'drawImage';
  filter: string;
  smoothing: boolean;
  /** WHICH picture was blitted, read back off the source canvas's own
   *  `dataset.source` rather than inferred from its size. Task 15 gave the
   *  minimap two possible grounds -- the renderer's photograph of the lit
   *  terrain and `paintTerrain`'s 1px-per-tile invention -- and they differ
   *  by which canvas is handed to `drawImage`, by nothing else. Reading the
   *  label the code itself wrote is the same move `__lions.cursorKey()`
   *  makes against `canvas.dataset.cursor`: recomputing which path SHOULD
   *  have been taken would agree with the logic and say nothing about the
   *  wiring. Every op carries it, so a blit from a canvas that never
   *  labelled itself reads 'unknown' rather than silently matching. */
  source: string;
  /** WHICH canvas OBJECT, as a small stable number the recorder mints per
   *  source it has seen. `source` says which of the two grounds was blitted
   *  and cannot say whether the minimap threw one away and built another --
   *  two photographs both label themselves `ground-albedo`. That is exactly
   *  the question the per-redraw ask raises: a minimap that rebuilt its blit
   *  canvas four times a second would draw a correct picture and still be
   *  the defect. A number rather than the element itself, so a failure reads
   *  `2 !== 1` instead of two pages of DOM. */
  srcId: number;
}
type Op = FillRect | StrokePath | FillPath | DrawImage;

/**
 * One unit mark, whatever shape it was drawn as.
 *
 * Colour alone stopped being the whole story in Task 10: a side is a colour
 * AND a silhouette, so a test has to be able to ask which shape was laid
 * down. The three are told apart by what they record and nothing is guessed:
 * a square is a `fillRect`, a triangle a filled path of three points, a
 * circle a filled path of the four cardinal points the `arc` stub flattens
 * to. Reported with its centre (the MEAN of the path's points, which is the
 * tile for all three by construction), its bounding height, and its style --
 * the last because the ground fill is a square too, and picking one side out
 * is exactly what the fog tests do.
 */
interface Dot {
  shape: DotShape;
  style: string;
  x: number;
  y: number;
  /** Bounding height in box pixels. 6 for every shape the dot loop draws. */
  size: number;
}

interface Recorder {
  ops: Op[];
  fills(): FillRect[];
  strokes(): StrokePath[];
  paths(): FillPath[];
  images(): DrawImage[];
  dots(): Dot[];
}

let recorder: Recorder;
const realGetContext = HTMLCanvasElement.prototype.getContext;

function installContext(): Recorder {
  const ops: Op[] = [];
  // Object identity, minted on first sight and stable thereafter. A WeakMap
  // so a canvas the minimap has discarded is not held alive by the recorder,
  // which is the whole point of the per-redraw ask being cheap.
  const ids = new WeakMap<object, number>();
  let nextId = 0;
  const idOf = (src: unknown): number => {
    if (typeof src !== 'object' || src === null) return -1;
    const known = ids.get(src);
    if (known !== undefined) return known;
    nextId += 1;
    ids.set(src, nextId);
    return nextId;
  };
  let path: [number, number][] = [];
  const saved: { fillStyle: string; strokeStyle: string; lineWidth: number; globalAlpha: number }[] = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    filter: 'none',
    imageSmoothingEnabled: true,
    setTransform: () => {},
    clearRect: () => {},
    // A real 2D context's save/restore stack, for the style fields this stub
    // records. A no-op pair would make a missing `restore()` untestable.
    save() {
      saved.push({
        fillStyle: String(this.fillStyle),
        strokeStyle: String(this.strokeStyle),
        lineWidth: Number(this.lineWidth),
        globalAlpha: Number(this.globalAlpha),
      });
    },
    restore() {
      const was = saved.pop();
      if (!was) return;
      this.fillStyle = was.fillStyle;
      this.strokeStyle = was.strokeStyle;
      this.lineWidth = was.lineWidth;
      this.globalAlpha = was.globalAlpha;
    },
    // Flattened to the four cardinal points, which is all any assertion here
    // asks of a circle: where its centre is and how big it is.
    arc(x: number, y: number, r: number) {
      path.push([x + r, y], [x, y + r], [x - r, y], [x, y - r]);
    },
    drawImage(src: unknown) {
      ops.push({
        kind: 'drawImage',
        filter: String(this.filter),
        smoothing: Boolean(this.imageSmoothingEnabled),
        source: src instanceof HTMLCanvasElement ? (src.dataset.source ?? 'unknown') : 'unknown',
        srcId: idOf(src),
      });
    },
    // jsdom has no canvas backend, so this is where the renderer's photograph
    // would land. Recording nothing is right: no assertion here asks what the
    // pixels ARE -- `flipRows` owns the only claim this file makes about
    // pixel order, and it is pure.
    putImageData: () => {},
    beginPath: () => {
      path = [];
    },
    moveTo: (x: number, y: number) => path.push([x, y]),
    lineTo: (x: number, y: number) => path.push([x, y]),
    closePath: () => {},
    fillRect(x: number, y: number, w: number, h: number) {
      ops.push({ kind: 'fillRect', style: String(this.fillStyle), filter: String(this.filter), x, y, w, h });
    },
    stroke() {
      ops.push({
        kind: 'stroke',
        style: String(this.strokeStyle),
        filter: String(this.filter),
        alpha: Number(this.globalAlpha),
        points: [...path],
      });
    },
    fill() {
      ops.push({
        kind: 'fillPath',
        style: String(this.fillStyle),
        filter: String(this.filter),
        alpha: Number(this.globalAlpha),
        points: [...path],
      });
    },
  };
  // Assigned rather than `vi.spyOn`d: `getContext` is overloaded five ways and
  // `mockReturnValue` binds to the last of them (`GPUCanvasContext`), so the
  // spy form only typechecks behind a cast that says the opposite of what is
  // happening. The original is put back in `afterEach`.
  HTMLCanvasElement.prototype.getContext = (() =>
    ctx) as unknown as HTMLCanvasElement['getContext'];
  const mean = (ns: number[]): number => ns.reduce((a, b) => a + b, 0) / ns.length;
  return {
    ops,
    fills: () => ops.filter((o): o is FillRect => o.kind === 'fillRect'),
    strokes: () => ops.filter((o): o is StrokePath => o.kind === 'stroke'),
    paths: () => ops.filter((o): o is FillPath => o.kind === 'fillPath'),
    images: () => ops.filter((o): o is DrawImage => o.kind === 'drawImage'),
    dots: () =>
      ops.flatMap((o): Dot[] => {
        if (o.kind === 'fillRect') {
          return [{ shape: 'square', style: o.style, x: o.x + o.w / 2, y: o.y + o.h / 2, size: o.h }];
        }
        if (o.kind !== 'fillPath' || o.points.length === 0) return [];
        const ys = o.points.map(([, y]) => y);
        return [
          {
            shape: o.points.length === 3 ? 'triangle' : 'circle',
            style: o.style,
            x: mean(o.points.map(([x]) => x)),
            y: mean(ys),
            size: Math.max(...ys) - Math.min(...ys),
          },
        ];
      }),
  };
}

/**
 * jsdom implements `ImageData` only when the optional `canvas` package is
 * installed, and this repo does not install it -- the same shape as this
 * config's bare `{}` for `window.localStorage` (CLAUDE.md), and the same
 * trap: the missing global is a `ReferenceError` at construction, not a
 * quiet wrong answer.
 *
 * Three fields are the WHOLE of what the minimap reads off one -- `width`,
 * `height` and the buffer it hands straight to `putImageData` -- so this is
 * the data structure itself rather than a stand-in for a behaviour. Nothing
 * here decodes or draws it: `flipRows` owns the only claim this file makes
 * about pixel order and is pure.
 */
class ImageDataShim {
  readonly colorSpace: PredefinedColorSpace = 'srgb';
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number
  ) {}
}
if (typeof globalThis.ImageData === 'undefined') {
  (globalThis as { ImageData?: typeof ImageData }).ImageData =
    ImageDataShim as unknown as typeof ImageData;
}

beforeEach(() => {
  recorder = installContext();
});
afterEach(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
  document.body.innerHTML = '';
});

// --- the world under test -------------------------------------------------

const W = 48;

/** A flat 48x48 field with one 3x3 building at 20,20 and cover at 5,5. */
function makeMap(over: Partial<MinimapMap> = {}): MinimapMap {
  const blocked = new Uint8Array(W * W);
  const boulder = new Uint8Array(W * W);
  const cover = new Uint8Array(W * W);
  for (let y = 20; y < 23; y++) for (let x = 20; x < 23; x++) blocked[y * W + x] = 1;
  cover[5 * W + 5] = 2;
  return {
    width: W,
    height: W,
    blocked,
    boulder,
    cover,
    markers: { kdf_start: [2, 2], battery: [40, 40] },
    zones: { west_approach: [4, 10, 6, 4] },
    ...over,
  };
}

const TONES = {
  open: 'open',
  cover: ['c1', 'c2', 'c3'],
  blocked: 'blocked',
  rock: 'rock',
} as unknown as MinimapDeps['tones'];

const TEAM: readonly [string, string, string] = ['blue', 'red', 'amber'];

/** Player unit at 2,2; hostile at 40,40. The hostile is far enough away that no
 *  honest fog rule could reach it — the tests below set visibility explicitly. */
function makeSim(): { sim: Sim; mine: number; theirs: number } {
  const sim = new Sim({ seed: 1, width: W, height: W, capacity: 16 });
  const t = sim.addUnitType(units.inf_squad as unknown as UnitTypeJson);
  const mine = sim.spawn(t, 0, fx.from(2), fx.from(2));
  const theirs = sim.spawn(t, 1, fx.from(40), fx.from(40));
  return { sim, mine, theirs };
}

/** A renderer stand-in. `visible` decides fog; the camera spans 10..30 in both
 *  axes by default, which on a 48-tile map is a rectangle well inside it. */
function makeView(visible: (x: number, y: number) => boolean): MinimapView {
  return {
    width: 1440,
    height: 900,
    isVisible: (x, y) => visible(x, y),
    screenToWorld: (px, py) => ({ x: 10 + (px / 1440) * 20, y: 10 + (py / 900) * 20 }),
  };
}

function mount(
  visible: (x: number, y: number) => boolean,
  over: Partial<MinimapDeps> = {}
): { sim: Sim; mine: number; theirs: number; minimap: Minimap } {
  const { sim, mine, theirs } = makeSim();
  const minimap = new Minimap(document.body, {
    sim,
    map: makeMap(),
    view: makeView(visible),
    tones: TONES,
    teamColors: TEAM,
    objectives: () => [],
    ...over,
  });
  return { sim, mine, theirs, minimap };
}

/**
 * The four points a diamond centred on tile (`tx`,`ty`) must have.
 *
 * The spec draws an 8px square turned 45 degrees, so the half-diagonal is
 * `8 * sqrt(2) / 2`. Spelling the whole shape out rather than probing one
 * corner is deliberate: a diamond's first point sits directly above its
 * centre, so a test that only looked at x would not notice the thing growing.
 */
function diamondAt(tx: number, ty: number): [number, number][] {
  const at = tileToBox(minimapProjection(W, W, MINIMAP_SIZE), tx, ty);
  const r = (8 * Math.SQRT2) / 2;
  return [
    [at.x, at.y - r],
    [at.x + r, at.y],
    [at.x, at.y + r],
    [at.x - r, at.y],
  ];
}

/** A stroke whose four points are exactly `want`, or undefined. */
function strokeMatching(want: [number, number][]): StrokePath | undefined {
  return recorder
    .strokes()
    .find(
      (s) =>
        s.points.length === want.length &&
        s.points.every((p, i) => Math.abs(p[0] - want[i][0]) < 1e-6 && Math.abs(p[1] - want[i][1]) < 1e-6)
    );
}

/**
 * Every fill the draw path laid down in a team's colour.
 *
 * Deliberately NOT filtered by size. It was, and that made the fog tests below
 * narrower than their own names: "draws no dot at all" would have gone on
 * passing if the dot were merely resized, because a 5x5 red square is not a
 * 6x6 one — proved by changing `DOT` and watching the leak test stay green
 * while three others went red. The size is asserted where a dot IS expected,
 * which is the only place it means anything.
 *
 * Team colours cannot collide with anything else recorded here: the terrain
 * layer fills in `tones`, and the box fill in a chrome colour.
 */
function dotsOf(color: string): (FillRect | FillPath)[] {
  return [...recorder.fills(), ...recorder.paths()].filter((f) => f.style === color);
}

// --- fog: the deliverable -------------------------------------------------

describe('fog', () => {
  it('draws no dot at all for a hostile the player has not seen', () => {
    mount(() => false);
    expect(dotsOf('red')).toEqual([]);
  });

  it('draws the hostile the moment its tile is observed', () => {
    mount((x, y) => x >= 39 && x <= 41 && y >= 39 && y <= 41);
    const red = recorder.dots().filter((d) => d.style === 'red');
    expect(red).toHaveLength(1);
    // The spec's own inline style: 6 box pixels tall, centred on the tile,
    // 40 tiles at 210/48 px per tile. The SHAPE is side 1's own (Task 10) --
    // a triangle, drawn beside the colour rather than instead of it.
    expect(red[0].shape).toBe('triangle');
    expect(red[0].size).toBeCloseTo(6, 6);
    const at = tileToBox(minimapProjection(W, W, MINIMAP_SIZE), 40, 40);
    expect(red[0].x).toBeCloseTo(at.x, 6);
    expect(red[0].y).toBeCloseTo(at.y, 6);
  });

  it("draws the player's own units through fog", () => {
    mount(() => false);
    expect(dotsOf('blue')).toHaveLength(1);
  });

  it('drops the hostile again when sight is lost', () => {
    let seen = true;
    const { minimap } = mount(() => seen);
    expect(dotsOf('red')).toHaveLength(1);
    seen = false;
    recorder.ops.length = 0;
    for (let i = 0; i < 5; i++) minimap.onTick();
    expect(dotsOf('red')).toEqual([]);
  });

  it('never draws a unit riding inside a transport', () => {
    const sim = new Sim({ seed: 1, width: W, height: W, capacity: 16 });
    const apc = sim.addUnitType(units.apc_eitan as unknown as UnitTypeJson);
    const inf = sim.addUnitType(units.inf_squad as unknown as UnitTypeJson);
    const car = sim.spawn(apc, 0, fx.from(6), fx.from(6));
    const rider = sim.spawn(inf, 0, fx.from(6), fx.from(6));
    expect(sim.embarkAtSpawn(car, rider)).toBe(true);
    expect(unitDots(sim, () => true).map((d) => d.side)).toHaveLength(1);
  });

  it('never draws a unit inside a tunnel, observed or not', () => {
    const sim = new Sim({ seed: 1, width: W, height: W, capacity: 16 });
    const t = sim.addUnitType(units.inf_squad as unknown as UnitTypeJson);
    const r = sim.addTunnel({
      id: 'tn',
      points: [
        [8, 8],
        [12, 8],
      ],
      dig_tiles_per_s: 1,
      pre_dug: true,
    });
    const buried = sim.spawn(t, 1, fx.from(8), fx.from(8));
    sim.putInTunnel(buried, r);
    expect(unitDots(sim, () => true)).toEqual([]);
  });
});

// --- coordinates ----------------------------------------------------------

describe('coordinates', () => {
  it('maps tile space straight onto the square', () => {
    const p = minimapProjection(48, 48, 210);
    expect(p.scale).toBeCloseTo(210 / 48, 10);
    expect(p.ox).toBe(0);
    expect(p.oy).toBe(0);
    expect(tileToBox(p, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(tileToBox(p, 48, 48)).toEqual({ x: 210, y: 210 });
    // Top-down, not dimetric: y moves the point down and nothing else. Under
    // isoX/isoY a step in y would move it left as well.
    const a = tileToBox(p, 10, 10);
    const b = tileToBox(p, 10, 20);
    expect(b.x).toBe(a.x);
    expect(b.y).toBeGreaterThan(a.y);
  });

  it('letterboxes a non-square map rather than stretching it', () => {
    const p = minimapProjection(48, 24, 210);
    expect(p.scale).toBeCloseTo(210 / 48, 10);
    expect(p.ox).toBe(0);
    expect(p.oy).toBeCloseTo(52.5, 10);
  });

  it('asks the renderer for all four screen corners, in order', () => {
    const asked: [number, number][] = [];
    const view: MinimapView = {
      width: 1440,
      height: 900,
      isVisible: () => false,
      screenToWorld: (px, py) => {
        asked.push([px, py]);
        return { x: px / 100, y: py / 100 };
      },
    };
    const quad = viewportQuad(view);
    expect(asked).toEqual([
      [0, 0],
      [1440, 0],
      [1440, 900],
      [0, 900],
    ]);
    expect(quad).toEqual([
      { x: 0, y: 0 },
      { x: 14.4, y: 0 },
      { x: 14.4, y: 9 },
      { x: 0, y: 9 },
    ]);
  });

  it('strokes the viewport outline where screenToWorld says it is', () => {
    mount(() => false);
    const p = minimapProjection(W, W, MINIMAP_SIZE);
    // makeView spans world 10..30 across the whole surface.
    const corners = [
      tileToBox(p, 10, 10),
      tileToBox(p, 30, 10),
      tileToBox(p, 30, 30),
      tileToBox(p, 10, 30),
    ];
    const hit = recorder
      .strokes()
      .find((s) => s.points.length === 4 && Math.abs(s.points[0][0] - corners[0].x) < 1e-6);
    expect(hit).toBeDefined();
    expect(hit?.points.map(([x, y]) => [Math.round(x), Math.round(y)])).toEqual(
      corners.map((c) => [Math.round(c.x), Math.round(c.y)])
    );
  });
});

// --- objectives and story markers -----------------------------------------

describe('objective diamonds', () => {
  const map = makeMap();

  it('puts an active zone objective at the zone centre', () => {
    expect(objectivePoints([{ status: 'active', zone: 'west_approach' }], map)).toEqual([
      { x: 7, y: 12 },
    ]);
  });

  it('falls back to a marker of the same name', () => {
    expect(objectivePoints([{ status: 'active', zone: 'battery' }], map)).toEqual([
      { x: 40.5, y: 40.5 },
    ]);
  });

  it('drops an objective that is no longer active', () => {
    expect(objectivePoints([{ status: 'complete', zone: 'west_approach' }], map)).toEqual([]);
  });

  it('ignores an objective that names no ground', () => {
    expect(objectivePoints([{ status: 'active' }], map)).toEqual([]);
  });

  // `objectivePoint` is the single-objective half, shared with `main.ts`'s
  // `alertWorld.objectiveAt` so the camera jumps to the ground the diamond is
  // drawn on rather than to a second, re-derived answer. It resolves ground
  // and nothing else -- the `status` filter above is `objectivePoints`' own
  // concern, and must not live here: an `objective` MissionEvent fires when a
  // status CHANGES, so the alert a player most wants to jump to names an
  // objective that is no longer active by the time it is read.
  it('resolves one objective on its own, status and all', () => {
    expect(objectivePoint({ status: 'active', zone: 'west_approach' }, map)).toEqual({ x: 7, y: 12 });
    expect(objectivePoint({ status: 'active', zone: 'battery' }, map)).toEqual({ x: 40.5, y: 40.5 });
    expect(objectivePoint({ status: 'active' }, map)).toBeNull();
    expect(objectivePoint({ status: 'active', zone: 'nowhere' }, map)).toBeNull();
    expect(objectivePoint({ status: 'complete', zone: 'west_approach' }, map)).toEqual({ x: 7, y: 12 });
  });

  it('is not fog-gated — the player is told where the objective is', () => {
    mount(() => false, { objectives: () => [{ status: 'active', zone: 'west_approach' }] });
    // Total blackout: not one marker and not one contact was drawn, and the
    // objective diamond is there anyway, at the zone centre and at spec size.
    expect(strokeMatching(diamondAt(7, 12))).toBeDefined();
    expect(dotsOf('red')).toEqual([]);
  });
});

describe('story markers', () => {
  it('hides a marker on ground the player has never seen', () => {
    const map = makeMap();
    expect(observedMarkers(map, () => false, new Set())).toEqual([]);
  });

  it('reveals a marker once its own tile is observed', () => {
    const map = makeMap();
    const seen = new Set<string>();
    const near = (x: number): boolean => x < 10;
    expect(observedMarkers(map, (x) => near(x), seen)).toEqual([{ x: 2.5, y: 2.5 }]);
    expect([...seen]).toEqual(['kdf_start']);
  });

  it('keeps a marker after sight of it is lost', () => {
    const map = makeMap();
    const seen = new Set<string>();
    observedMarkers(map, () => true, seen);
    expect(observedMarkers(map, () => false, seen)).toHaveLength(2);
  });

  it('draws a seen marker as a diamond of the spec size, at its own tile', () => {
    // Fog open only around kdf_start at [2,2]; `battery` at [40,40] stays dark.
    mount((x, y) => x < 10 && y < 10);
    expect(strokeMatching(diamondAt(2.5, 2.5))).toBeDefined();
    expect(strokeMatching(diamondAt(40.5, 40.5))).toBeUndefined();
  });
});

// --- the box --------------------------------------------------------------

describe('mount', () => {
  it('is a canvas in the corner, sized from MINIMAP_SIZE', () => {
    mount(() => false);
    const el = document.querySelector('canvas.rl-minimap') as HTMLCanvasElement;
    expect(el).not.toBeNull();
    expect(el.width % MINIMAP_SIZE).toBe(0);
    expect(el.width).toBe(el.height);
  });

  it('desaturates the terrain and nothing else', () => {
    // The spec puts saturate(.4) on the whole box because its minimap is a
    // placeholder screenshot. Doing that for real would wash out the four
    // colours the minimap exists to report — so the filter must be ON for the
    // terrain blit and OFF by the time a dot or a diamond is drawn.
    mount(() => true, { objectives: () => [{ status: 'active', zone: 'west_approach' }] });
    const blits = recorder.images();
    expect(blits).toHaveLength(1);
    expect(blits[0]).toEqual({
      kind: 'drawImage',
      filter: 'saturate(0.4)',
      smoothing: false,
      // Task 15 (R-F1), then the landing-2 fix wave: the recorder's op has
      // grown two fields and this exact-match grew with them. Nothing about
      // the behaviour asserted here moved -- this mount supplies no
      // `groundImage`, which is the Pixi path and what shipped.
      source: 'painted',
      // The first canvas the recorder saw in this test's own context.
      srcId: 1,
    });
    const marks = [...dotsOf('blue'), ...dotsOf('red'), ...recorder.strokes()];
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.map((m) => m.filter)).toEqual(marks.map(() => 'none'));
  });

  it('redraws on every fifth tick and not between them', () => {
    const { minimap } = mount(() => true);
    recorder.ops.length = 0;
    minimap.onTick();
    const after1 = recorder.ops.length;
    expect(after1).toBeGreaterThan(0);
    minimap.onTick();
    minimap.onTick();
    minimap.onTick();
    minimap.onTick();
    expect(recorder.ops.length).toBe(after1);
    minimap.onTick();
    expect(recorder.ops.length).toBeGreaterThan(after1);
  });
});

// --- the alert flash ------------------------------------------------------

describe('the alert flash', () => {
  it('is full strength at the event and gone at the end', () => {
    expect(flashAlpha(0)).toBe(1);
    expect(flashAlpha(FLASH_MS / 2)).toBeCloseTo(0.5);
    expect(flashAlpha(FLASH_MS)).toBe(0);
    expect(flashAlpha(FLASH_MS + 1000)).toBe(0);
  });

  // The flash is a TILE, not an entity: the unit the alert is about is usually
  // dead, so an entity-keyed flash would have nothing to draw at.
  //
  // DISCLOSED: this one cannot fail on its own, and that was measured rather
  // than reasoned. `onTick` redraws the whole minimap, so the stroke count
  // grows by the markers and the viewport outline whether or not a ring is
  // drawn -- gutting `flash` so it records nothing leaves this green. It is
  // kept because its SUBJECT is right (a point, not an entity, and 12,12 is
  // nobody's tile), and the four tests below are what actually gate it: each
  // finds the ring by the one thing nothing else in the draw path does.
  it('draws a mark for a point whose unit no longer exists', () => {
    const { minimap } = mount(() => true);
    const strokesBefore = recorder.strokes().length;
    minimap.flash([{ x: 12, y: 12 }], 1000);
    minimap.onTick();
    expect(recorder.strokes().length).toBeGreaterThan(strokesBefore);
  });

  /**
   * The flash ring, identified by the one thing nothing else in the draw path
   * does: stroke at less than full alpha. Shape cannot tell it from a diamond
   * -- the stub flattens an arc to its four cardinal points, which is the
   * diamond's own point set -- and colour cannot either, because jsdom's
   * `getComputedStyle` resolves every chrome token to the same empty string.
   */
  const ring = (): StrokePath | undefined => recorder.strokes().find((k) => k.alpha < 1);

  it('rings the tile it was given, and fades over FLASH_MS', () => {
    // A point nowhere near a unit, a marker or the viewport quad. Stamped
    // half a window in the past, so the alpha at draw time is a value the
    // real clock cannot land outside.
    const { minimap } = mount(() => false);
    recorder.ops.length = 0;
    minimap.flash([{ x: 12, y: 34 }], performance.now() - FLASH_MS / 2);
    minimap.onTick();
    const hit = ring();
    expect(hit).toBeDefined();
    expect(hit?.alpha).toBeGreaterThan(0.4);
    expect(hit?.alpha).toBeLessThan(0.6);
    // Centred on the tile. The whole point set rather than one of them: a ring
    // at the right x and the wrong y passes a single-point check.
    const at = tileToBox(minimapProjection(W, W, MINIMAP_SIZE), 12, 34);
    const cx = hit?.points.map(([x]) => x) ?? [];
    const cy = hit?.points.map(([, y]) => y) ?? [];
    expect((Math.min(...cx) + Math.max(...cx)) / 2).toBeCloseTo(at.x, 6);
    expect((Math.min(...cy) + Math.max(...cy)) / 2).toBeCloseTo(at.y, 6);
    expect(Math.max(...cx) - Math.min(...cx)).toBeGreaterThan(0);
  });

  it('puts globalAlpha back, so the viewport outline is not left faded', () => {
    const { minimap } = mount(() => false);
    recorder.ops.length = 0;
    minimap.flash([{ x: 12, y: 34 }], performance.now() - FLASH_MS / 2);
    minimap.onTick();
    // The viewport outline is the LAST stroke of a redraw, drawn after the
    // flash. A missing `restore()` leaves it wearing the ring's alpha, which
    // photographs as "the minimap went dim" and reads as nothing at all in a
    // test that only looked at coordinates.
    const strokes = recorder.strokes();
    expect(strokes.length).toBeGreaterThan(1);
    expect(strokes[strokes.length - 1].alpha).toBe(1);
  });

  it('stops drawing a mark that has outlived FLASH_MS', () => {
    const { minimap } = mount(() => false);
    minimap.flash([{ x: 12, y: 34 }], performance.now() - FLASH_MS - 1);
    recorder.ops.length = 0;
    minimap.onTick();
    expect(ring()).toBeUndefined();
  });

  it('draws over the unit dots and under the viewport outline', () => {
    // The order is the whole reason this layer is in `draw()` rather than in
    // its own canvas. A mark the player must see OVER the dots -- a squad
    // wiped out is exactly the moment its own dot stops being there -- and
    // UNDER the frame that says where they are looking, which is the one mark
    // that must never be obscured.
    const { minimap } = mount(() => true);
    recorder.ops.length = 0;
    minimap.flash([{ x: 12, y: 34 }], performance.now() - FLASH_MS / 2);
    minimap.onTick();
    const ringAt = recorder.ops.findIndex((o) => o.kind === 'stroke' && o.alpha < 1);
    const lastDot = recorder.ops.reduce(
      (best, o, i) =>
        (o.kind === 'fillRect' || o.kind === 'fillPath') && (o.style === 'blue' || o.style === 'red')
          ? i
          : best,
      -1
    );
    const lastStroke = recorder.ops.reduce((best, o, i) => (o.kind === 'stroke' ? i : best), -1);
    expect(ringAt).toBeGreaterThan(-1);
    expect(lastDot).toBeGreaterThan(-1);
    expect(ringAt).toBeGreaterThan(lastDot);
    expect(ringAt).toBeLessThan(lastStroke);
  });

  it('draws one ring per live point, and none for the expired ones beside them', () => {
    const { minimap } = mount(() => false);
    minimap.flash([{ x: 12, y: 34 }], performance.now() - FLASH_MS - 1);
    minimap.flash([{ x: 20, y: 30 }, { x: 30, y: 20 }], performance.now() - FLASH_MS / 2);
    recorder.ops.length = 0;
    minimap.onTick();
    expect(recorder.strokes().filter((k) => k.alpha < 1)).toHaveLength(2);
  });
});

// --- the minimap becomes a control (Task 10) -------------------------------

describe('boxToTile', () => {
  const p = minimapProjection(48, 48, 210);
  it('is the inverse of tileToBox', () => {
    for (const [tx, ty] of [
      [0, 0],
      [12.5, 30.25],
      [47.9, 47.9],
    ] as const) {
      const b = tileToBox(p, tx, ty);
      const back = boxToTile(p, b.x, b.y, 48, 48);
      expect(back.x).toBeCloseTo(tx, 5);
      expect(back.y).toBeCloseTo(ty, 5);
    }
  });

  it('clamps a point in the letterbox to the map, never off it', () => {
    const wide = minimapProjection(48, 24, 210); // a hypothetical non-square map
    expect(boxToTile(wide, 105, 0, 48, 24)).toEqual({ x: 24, y: 0 });
    expect(boxToTile(wide, -50, 999, 48, 24)).toEqual({ x: 0, y: 24 });
  });
});

describe('dotShape', () => {
  it('gives each side its own silhouette, so colour is not the only channel', () => {
    expect(dotShape(0)).toBe('square');
    expect(dotShape(1)).toBe('triangle');
    expect(dotShape(2)).toBe('circle');
    expect(dotShape(7)).toBe('circle');
  });

  it('draws each side in its own shape AND its own colour, on the real path', () => {
    // Redundancy, not a replacement: G0 decision #3 measured the team colours
    // as NOT collapsing under any simulated deficiency, so the shape is a
    // second channel beside a working first one. A test that only checked the
    // shape would let the colour quietly go.
    const sim = new Sim({ seed: 1, width: W, height: W, capacity: 16 });
    const t = sim.addUnitType(units.inf_squad as unknown as UnitTypeJson);
    sim.spawn(t, 0, fx.from(2), fx.from(2));
    sim.spawn(t, 1, fx.from(10), fx.from(10));
    sim.spawn(t, 2, fx.from(30), fx.from(30));
    mount(() => true, { sim });
    const shapesOf = (color: string): DotShape[] =>
      recorder
        .dots()
        .filter((d) => d.style === color)
        .map((d) => d.shape);
    expect(shapesOf('blue')).toEqual(['square']);
    expect(shapesOf('red')).toEqual(['triangle']);
    expect(shapesOf('amber')).toEqual(['circle']);
  });
});

// jsdom has no `PointerEvent`, so the events below are plain `MouseEvent`s
// carrying `clientX`/`clientY`, and the implementation reads
// `clientX - rect.left` the way `main.ts`'s own `canvasXY` does. One
// convention for pointer coordinates in this app.
//
// MEASURED, because the obvious reason to prefer it is not true here: jsdom's
// `offsetX` is NOT a read-only zero, it is `pageX` (probed -- a click at
// clientX 105 reads offsetX 105), so on an element whose bounding rect starts
// at the origin the two expressions agree and no test can tell them apart.
// What IS testable, and is the defect that would actually ship, is dropping
// the element's own origin: the minimap lives in the bottom-RIGHT corner, so
// its rect starts some 1200px in, and a handler that forgot to subtract that
// would clamp every click to the far edge of the map. `a click on a box that
// is not at the origin` below stubs the rect and pins it -- and jsdom's
// `offsetX` does not consult that stub, so it separates the two.
const at = (kind: string, x: number, y: number, init: MouseEventInit = {}): MouseEvent =>
  new MouseEvent(kind, { bubbles: true, cancelable: true, clientX: x, clientY: y, ...init });
const noopInput = { jumpTo: () => undefined, order: () => undefined, ping: () => undefined };
const canvasOf = (): HTMLCanvasElement => {
  const el = document.body.querySelector<HTMLCanvasElement>('canvas.rl-minimap');
  if (!el) throw new Error('no minimap canvas');
  return el;
};

describe('minimap input', () => {
  it('a left click jumps the camera to that tile', () => {
    const jumps: MinimapPoint[] = [];
    mount(() => true, { input: { ...noopInput, jumpTo: (x, y) => jumps.push({ x, y }) } });
    const c = canvasOf();
    c.dispatchEvent(at('pointerdown', 105, 105, { button: 0 }));
    c.dispatchEvent(at('pointerup', 105, 105, { button: 0 }));
    expect(jumps).toHaveLength(1);
    expect(jumps[0].x).toBeCloseTo(24, 1);
  });

  // Drag and click are ONE path: a click is a drag of zero length. Two code
  // paths here would be two answers to "where did the player point".
  it('a drag keeps jumping while the button is down, and stops on release', () => {
    const jumps: MinimapPoint[] = [];
    mount(() => true, { input: { ...noopInput, jumpTo: (x, y) => jumps.push({ x, y }) } });
    const c = canvasOf();
    c.dispatchEvent(at('pointerdown', 20, 20, { button: 0 }));
    c.dispatchEvent(at('pointermove', 60, 60));
    c.dispatchEvent(at('pointermove', 100, 100));
    c.dispatchEvent(at('pointerup', 100, 100));
    c.dispatchEvent(at('pointermove', 140, 140));
    expect(jumps).toHaveLength(4); // down + two moves + up, and nothing after
  });

  it('lands on the release point, even when no pointermove reported it', () => {
    // A pointer moved and released inside one frame delivers its final
    // position only on the up, so the release is not decoration: without it
    // the camera stops where the last move happened to fire.
    const jumps: MinimapPoint[] = [];
    mount(() => true, { input: { ...noopInput, jumpTo: (x, y) => jumps.push({ x, y }) } });
    const c = canvasOf();
    c.dispatchEvent(at('pointerdown', 20, 20, { button: 0 }));
    c.dispatchEvent(at('pointermove', 60, 60));
    c.dispatchEvent(at('pointerup', 140, 140));
    expect(jumps).toHaveLength(3);
    expect(jumps[2].x).toBeCloseTo(32, 1);
  });

  it('lets go of the drag when the pointer stream is cut', () => {
    // `pointerup` is not the only way a drag ends. A pen or touch contact can
    // be interrupted (`pointercancel`), and in a browser without
    // `setPointerCapture` the release lands on whatever is under the pointer
    // -- the battlefield canvas -- so this element never hears it. Either way
    // `dragging` would stay true and every subsequent BUTTON-LESS hover over
    // the box would pan the camera, until the next click happened to clear
    // it. A minimap that pans when the hand merely passes over it reads as a
    // broken camera rather than a stuck flag.
    for (const cut of ['pointercancel', 'lostpointercapture']) {
      document.body.innerHTML = '';
      const jumps: MinimapPoint[] = [];
      mount(() => true, { input: { ...noopInput, jumpTo: (x, y) => jumps.push({ x, y }) } });
      const c = canvasOf();
      c.dispatchEvent(at('pointerdown', 20, 20, { button: 0 }));
      c.dispatchEvent(at('pointermove', 60, 60));
      expect(jumps).toHaveLength(2);
      c.dispatchEvent(at(cut, 60, 60));
      c.dispatchEvent(at('pointermove', 140, 140));
      expect(jumps, cut).toHaveLength(2);
    }
  });

  it('a right click orders, with the modifiers, and never jumps', () => {
    const orders: { mods: { append: boolean; confirm: boolean } }[] = [];
    const jumps: number[] = [];
    mount(() => true, {
      input: {
        ...noopInput,
        jumpTo: () => jumps.push(1),
        order: (_x, _y, mods) => orders.push({ mods }),
      },
    });
    canvasOf().dispatchEvent(at('contextmenu', 105, 105, { shiftKey: true, altKey: true }));
    expect(jumps).toEqual([]);
    expect(orders).toEqual([{ mods: { append: true, confirm: true } }]);
  });

  it('keeps Shift and Alt apart, which holding both cannot show', () => {
    // MEASURED: the test above holds BOTH modifiers, so swapping the two in
    // the handler leaves it green -- proved by swapping them and watching
    // nothing go red. One modifier at a time is what separates them.
    const mods: { append: boolean; confirm: boolean }[] = [];
    mount(() => true, {
      input: { ...noopInput, order: (_x, _y, m) => mods.push(m) },
    });
    const c = canvasOf();
    c.dispatchEvent(at('contextmenu', 105, 105, { shiftKey: true }));
    c.dispatchEvent(at('contextmenu', 105, 105, { altKey: true }));
    c.dispatchEvent(at('contextmenu', 105, 105));
    expect(mods).toEqual([
      { append: true, confirm: false },
      { append: false, confirm: true },
      { append: false, confirm: false },
    ]);
  });

  it('reads a click on a box that is not at the origin', () => {
    // The minimap is anchored bottom-right, so its bounding rect never starts
    // at 0 in a real browser. A handler that read the raw client coordinate
    // would put every click a thousand pixels off the map and clamp it to the
    // corner -- which looks like a broken minimap rather than a coordinate
    // bug, because a clamped answer is still a plausible one.
    const jumps: MinimapPoint[] = [];
    mount(() => true, { input: { ...noopInput, jumpTo: (x, y) => jumps.push({ x, y }) } });
    const c = canvasOf();
    const rect = { left: 1000, top: 500, right: 1210, bottom: 710, width: 210, height: 210, x: 1000, y: 500, toJSON: () => ({}) };
    c.getBoundingClientRect = (() => rect) as HTMLCanvasElement['getBoundingClientRect'];
    c.dispatchEvent(at('pointerdown', 1105, 605, { button: 0 }));
    expect(jumps).toHaveLength(1);
    expect(jumps[0].x).toBeCloseTo(24, 1);
    expect(jumps[0].y).toBeCloseTo(24, 1);
  });

  it('orders on the tile under the pointer, in the same coordinates a jump uses', () => {
    // The order and the jump are the same question asked with a different
    // button, so a right-click that landed a tile away from where the same
    // pixel jumps to would be a second projection.
    const orders: MinimapPoint[] = [];
    const jumps: MinimapPoint[] = [];
    mount(() => true, {
      input: {
        ...noopInput,
        jumpTo: (x, y) => jumps.push({ x, y }),
        order: (x, y) => orders.push({ x, y }),
      },
    });
    const c = canvasOf();
    c.dispatchEvent(at('contextmenu', 70, 140));
    c.dispatchEvent(at('pointerdown', 70, 140, { button: 0 }));
    expect(orders).toEqual(jumps);
    expect(orders[0].x).toBeCloseTo(16, 1);
    expect(orders[0].y).toBeCloseTo(32, 1);
  });

  it('alt+left pings instead of jumping', () => {
    const pings: MinimapPoint[] = [];
    const jumps: number[] = [];
    mount(() => true, {
      input: { ...noopInput, jumpTo: () => jumps.push(1), ping: (x, y) => pings.push({ x, y }) },
    });
    canvasOf().dispatchEvent(at('pointerdown', 105, 105, { button: 0, altKey: true }));
    expect(pings).toHaveLength(1);
    expect(jumps).toEqual([]);
  });

  it('does not start a drag from an alt+click, so a ping cannot pan the camera', () => {
    const jumps: number[] = [];
    mount(() => true, { input: { ...noopInput, jumpTo: () => jumps.push(1) } });
    const c = canvasOf();
    c.dispatchEvent(at('pointerdown', 105, 105, { button: 0, altKey: true }));
    c.dispatchEvent(at('pointermove', 60, 60));
    c.dispatchEvent(at('pointerup', 60, 60));
    expect(jumps).toEqual([]);
  });

  // The pre-existing promise the constructor makes: a click must never fall
  // through to the battlefield underneath.
  it('still swallows every pointer event it handles', () => {
    mount(() => true, { input: noopInput });
    const ev = at('contextmenu', 10, 10);
    canvasOf().dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    const down = at('pointerdown', 10, 10, { button: 0 });
    canvasOf().dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  it('with no input wired the canvas is inert, exactly as it was', () => {
    mount(() => true);
    expect(() => canvasOf().dispatchEvent(at('pointerdown', 10, 10, { button: 0 }))).not.toThrow();
  });

  it('releases its listeners on destroy', () => {
    // The element is removed either way, so a leaked listener is invisible
    // until something else still holds the node -- a drag in flight when a
    // mission ends, which is precisely the case.
    const jumps: number[] = [];
    const { minimap } = mount(() => true, {
      input: { ...noopInput, jumpTo: () => jumps.push(1) },
    });
    const c = canvasOf();
    minimap.destroy();
    c.dispatchEvent(at('pointerdown', 105, 105, { button: 0 }));
    c.dispatchEvent(at('contextmenu', 105, 105));
    expect(jumps).toEqual([]);
  });
});

describe('the ping', () => {
  it('fades over PING_MS and then is gone', () => {
    expect(linearFade(0, PING_MS)).toBe(1);
    expect(linearFade(PING_MS, PING_MS)).toBe(0);
  });

  it('is the one fade curve, so the flash is a span rather than a second one', () => {
    // `flashAlpha` is Task 4's wrapper and stays, so its callers and its tests
    // are untouched; what it must not be any more is a second implementation.
    expect(flashAlpha(FLASH_MS / 2)).toBe(linearFade(FLASH_MS / 2, FLASH_MS));
    expect(linearFade(PING_MS / 4, PING_MS)).toBeCloseTo(0.75, 10);
    expect(linearFade(-1, PING_MS)).toBe(1);
    expect(linearFade(PING_MS + 1000, PING_MS)).toBe(0);
  });

  /** The ping's ring: the one stroke drawn at less than full alpha here. */
  const pingRing = (): StrokePath | undefined => recorder.strokes().find((k) => k.alpha < 1);
  /** Its centre dot: the one FILLED path drawn at less than full alpha. */
  const pingDot = (): FillPath | undefined => recorder.paths().find((f) => f.alpha < 1);
  const span = (points: [number, number][]): number => {
    const xs = points.map(([x]) => x);
    return Math.max(...xs) - Math.min(...xs);
  };

  it('rings the tile it was given, and puts a static dot at its centre', () => {
    const { minimap } = mount(() => false);
    recorder.ops.length = 0;
    minimap.ping(12, 34, performance.now() - PING_MS / 2);
    minimap.onTick();
    const box = tileToBox(minimapProjection(W, W, MINIMAP_SIZE), 12, 34);
    const ring = pingRing();
    expect(ring).toBeDefined();
    expect(ring?.alpha).toBeGreaterThan(0.4);
    expect(ring?.alpha).toBeLessThan(0.6);
    const rx = ring?.points.map(([x]) => x) ?? [];
    const ry = ring?.points.map(([, y]) => y) ?? [];
    expect((Math.min(...rx) + Math.max(...rx)) / 2).toBeCloseTo(box.x, 6);
    expect((Math.min(...ry) + Math.max(...ry)) / 2).toBeCloseTo(box.y, 6);
    const dot = pingDot();
    expect(dot).toBeDefined();
    const dx = dot?.points.map(([x]) => x) ?? [];
    expect((Math.min(...dx) + Math.max(...dx)) / 2).toBeCloseTo(box.x, 6);
  });

  it('expands the ring as it fades, and never the centre dot', () => {
    // The ring is motion, which is what catches an eye looking elsewhere; the
    // dot is the address, and an address that grew would stop being one.
    const { minimap } = mount(() => false);
    recorder.ops.length = 0;
    const now = performance.now();
    minimap.ping(12, 34, now - PING_MS * 0.1);
    minimap.ping(30, 20, now - PING_MS * 0.9);
    minimap.onTick();
    const rings = recorder.strokes().filter((k) => k.alpha < 1);
    const dots = recorder.paths().filter((f) => f.alpha < 1);
    expect(rings).toHaveLength(2);
    expect(dots).toHaveLength(2);
    expect(span(rings[1].points)).toBeGreaterThan(span(rings[0].points));
    expect(span(dots[1].points)).toBeCloseTo(span(dots[0].points), 6);
  });

  // DISCLOSED, and measured rather than assumed: the sweep `ping` does on
  // every push -- which is what bounds the list -- has NO observable
  // consequence and no test here can fail on it. Removing it entirely leaves
  // all 53 specs green, because `drawPings` skips a faded entry in one
  // comparison whether or not it is still in the array. The test below gates
  // that SKIP, which is the visible half; the bound is a memory claim, stated
  // in `ping`'s own comment and carried by review. The same is true of
  // `flash`, and has been since Task 4.
  it('draws one mark per live ping, and none for the expired ones beside them', () => {
    const { minimap } = mount(() => false);
    const now = performance.now();
    minimap.ping(12, 34, now - PING_MS - 1);
    minimap.ping(20, 30, now - PING_MS / 2);
    minimap.ping(30, 20, now - PING_MS / 2);
    recorder.ops.length = 0;
    minimap.onTick();
    expect(recorder.strokes().filter((k) => k.alpha < 1)).toHaveLength(2);
    expect(recorder.paths().filter((f) => f.alpha < 1)).toHaveLength(2);
  });

  it('puts globalAlpha back, so the viewport outline is not left faded', () => {
    const { minimap } = mount(() => false);
    recorder.ops.length = 0;
    minimap.ping(12, 34, performance.now() - PING_MS / 2);
    minimap.onTick();
    const strokes = recorder.strokes();
    expect(strokes.length).toBeGreaterThan(1);
    expect(strokes[strokes.length - 1].alpha).toBe(1);
  });

  it('draws over the unit dots and under the viewport outline', () => {
    const { minimap } = mount(() => true);
    recorder.ops.length = 0;
    minimap.ping(12, 34, performance.now() - PING_MS / 2);
    minimap.onTick();
    const ringAt = recorder.ops.findIndex((o) => o.kind === 'stroke' && o.alpha < 1);
    const lastDot = recorder.ops.reduce(
      (best, o, i) =>
        (o.kind === 'fillRect' || o.kind === 'fillPath') && (o.style === 'blue' || o.style === 'red')
          ? i
          : best,
      -1
    );
    const lastStroke = recorder.ops.reduce((best, o, i) => (o.kind === 'stroke' ? i : best), -1);
    expect(ringAt).toBeGreaterThan(-1);
    expect(lastDot).toBeGreaterThan(-1);
    expect(ringAt).toBeGreaterThan(lastDot);
    expect(ringAt).toBeLessThan(lastStroke);
  });
});

// --- the lit ground (Task 15) ---------------------------------------------

describe('the lit ground', () => {
  it('blits the renderer image when there is one', () => {
    // The recorder records every `drawImage`; the question is which SOURCE
    // was blitted.
    const img = new ImageData(new Uint8ClampedArray(48 * 48 * 4).fill(200), 48, 48);
    const { minimap } = mount(() => true, { groundImage: () => img });
    minimap.onTick();
    expect(recorder.images().at(-1)?.source).toBe('ground-albedo');
  });

  it('falls back to the painted terrain when there is none -- which is what Pixi gets', () => {
    const { minimap } = mount(() => true, { groundImage: () => null });
    minimap.onTick();
    expect(recorder.images().at(-1)?.source).toBe('painted');
  });

  it('asks again on every redraw, so a texture that lands late is not missed', () => {
    // This used to assert `calls === 1`, and the single ask was the defect.
    // The renderer fires six ground-albedo texture loads at map load and
    // awaits none of them, while the minimap mounts right after the deploy
    // gate -- immediately, on a sandbox or the tutorial. A photograph taken
    // before those land shows the flat palette tone for the whole mission,
    // and with one ask there is no second chance. Asking is cheap by
    // contract: the renderer's answer is identity-stable, so the ask below
    // is a reference compare and not a readback.
    let calls = 0;
    const { minimap } = mount(() => true, {
      groundImage: () => {
        calls++;
        return null;
      },
    });
    const atMount = calls;
    expect(atMount).toBeGreaterThan(0);
    // 4 Hz: `onTick` redraws on every fifth tick.
    for (let i = 0; i < 20; i++) minimap.onTick();
    expect(calls).toBe(atMount + 4);
  });

  it('re-blits only when the image identity changes, never when it is the same object', () => {
    // Both halves in one test on purpose: they are one property, and the two
    // failures are each other's mirror. Asking once makes the first
    // assertion fail (the late image never arrives); rebuilding on every
    // redraw makes the second fail (a new canvas four times a second, for a
    // picture that did not change).
    const first = new ImageData(new Uint8ClampedArray(48 * 48 * 4).fill(200), 48, 48);
    const second = new ImageData(new Uint8ClampedArray(48 * 48 * 4).fill(90), 48, 48);
    let current = first;
    const { minimap } = mount(() => true, { groundImage: () => current });
    // `onTick` redraws on every FIFTH tick (4 Hz), so one redraw is five
    // calls. Calling it once and expecting a picture is the trap this
    // helper exists to avoid -- four of the five are early returns.
    const redraw = (): void => {
      for (let i = 0; i < 5; i++) minimap.onTick();
    };

    recorder.ops.length = 0;
    redraw();
    const a = recorder.images().at(-1);
    redraw();
    const b = recorder.images().at(-1);
    expect(a?.source).toBe('ground-albedo');
    // Same `ImageData` object -> the same canvas, not a fresh one that
    // happens to look identical.
    expect(b?.srcId).toBe(a?.srcId);

    // A ground texture lands, the renderer's memo is dropped, and the next
    // ask answers with a different object.
    current = second;
    redraw();
    const c = recorder.images().at(-1);
    expect(c?.source).toBe('ground-albedo');
    expect(c?.srcId).not.toBe(a?.srcId);

    // And it STAYS the new one -- a rebuild per redraw would show up here
    // too, one redraw later.
    redraw();
    expect(recorder.images().at(-1)?.srcId).toBe(c?.srcId);
  });

  it('smooths the photograph and not the painted tiles', () => {
    // The two sources want opposite answers and the reason is their size. A
    // 48px painted canvas blown up 4.375x must read as TILES, so nearest
    // neighbour; a 210px photograph is already at the box's own scale and
    // nearest neighbour there only re-aliases an image that is already
    // right. Asserted rather than left to the eye because the flag is one
    // boolean two lines apart from the blit that consumes it.
    const img = new ImageData(new Uint8ClampedArray(48 * 48 * 4).fill(200), 48, 48);
    const lit = mount(() => true, { groundImage: () => img });
    lit.minimap.onTick();
    expect(recorder.images().at(-1)?.smoothing).toBe(true);
    expect(recorder.images().at(-1)?.filter).toBe('saturate(0.4)');
  });
});

// --- flipRows -------------------------------------------------------------
//
// WebGL's framebuffer origin is the BOTTOM-left and a 2D canvas's is the
// top-left, so the renderer's read-back arrives upside down. The flip is on
// the app side, in a pure function, rather than inside an untestable GL
// method: `preserveDrawingBuffer` is off and canvas readback is black by
// design, so there is no way to assert the row order of a real capture at
// all -- and an upside-down minimap is a picture that looks like a map.

describe('flipRows', () => {
  it('reverses row order and leaves each row intact', () => {
    const src = new Uint8ClampedArray([1, 1, 1, 1, 2, 2, 2, 2]); // 1x2 RGBA
    expect([...flipRows(src, 1, 2)]).toEqual([2, 2, 2, 2, 1, 1, 1, 1]);
  });

  it('is an involution', () => {
    const src = new Uint8ClampedArray(Array.from({ length: 48 }, (_, i) => i));
    expect([...flipRows(flipRows(src, 3, 4), 3, 4)]).toEqual([...src]);
  });
});
