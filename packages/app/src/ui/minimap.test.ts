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
  MINIMAP_SIZE,
  Minimap,
  minimapProjection,
  objectivePoints,
  observedMarkers,
  tileToBox,
  unitDots,
  viewportQuad,
  type MinimapDeps,
  type MinimapMap,
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
  points: [number, number][];
}
interface DrawImage {
  kind: 'drawImage';
  filter: string;
  smoothing: boolean;
}
type Op = FillRect | StrokePath | DrawImage;

interface Recorder {
  ops: Op[];
  fills(): FillRect[];
  strokes(): StrokePath[];
  images(): DrawImage[];
}

let recorder: Recorder;
const realGetContext = HTMLCanvasElement.prototype.getContext;

function installContext(): Recorder {
  const ops: Op[] = [];
  let path: [number, number][] = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    filter: 'none',
    imageSmoothingEnabled: true,
    setTransform: () => {},
    clearRect: () => {},
    drawImage() {
      ops.push({
        kind: 'drawImage',
        filter: String(this.filter),
        smoothing: Boolean(this.imageSmoothingEnabled),
      });
    },
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
  return {
    ops,
    fills: () => ops.filter((o): o is FillRect => o.kind === 'fillRect'),
    strokes: () => ops.filter((o): o is StrokePath => o.kind === 'stroke'),
    images: () => ops.filter((o): o is DrawImage => o.kind === 'drawImage'),
  };
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
function dotsOf(color: string): FillRect[] {
  return recorder.fills().filter((f) => f.style === color);
}

// --- fog: the deliverable -------------------------------------------------

describe('fog', () => {
  it('draws no dot at all for a hostile the player has not seen', () => {
    mount(() => false);
    expect(dotsOf('red')).toEqual([]);
  });

  it('draws the hostile the moment its tile is observed', () => {
    mount((x, y) => x >= 39 && x <= 41 && y >= 39 && y <= 41);
    const red = dotsOf('red');
    expect(red).toHaveLength(1);
    // The spec's own inline style: a 6x6 fill, centred on the tile. 40 tiles
    // at 210/48 px per tile.
    expect([red[0].w, red[0].h]).toEqual([6, 6]);
    const at = tileToBox(minimapProjection(W, W, MINIMAP_SIZE), 40, 40);
    expect(red[0].x).toBe(Math.round(at.x - red[0].w / 2));
    expect(red[0].y).toBe(Math.round(at.y - red[0].h / 2));
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
    expect(blits[0]).toEqual({ kind: 'drawImage', filter: 'saturate(0.4)', smoothing: false });
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
