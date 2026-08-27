// Task B3.11 -- the 300-unit gate.
//
// This decides whether the three.js migration's core promise (larger maps,
// far more units) is true. It is pass/fail, and the number is allowed to be
// bad -- see the task brief for the "do not tune quietly" instruction this
// file is built to honour.
//
// Two execution modes share everything except the last few lines:
//
//   1. Node CLI (`npx tsx tools/src/perf/three-units.ts`): builds a real
//      `Sim` on a real map, spawns a real (mixed-type, two-sided, in-contact)
//      roster, and times `sim.tick()` alone -- no renderer, no browser, no
//      GPU. This is the authoritative SIM TICK COST number: it cannot be
//      contaminated by anything a renderer does, because there is no
//      renderer in this process at all.
//
//   2. Browser (dynamically imported from a page the real Vite dev server
//      is serving, e.g. `import('/@fs/<abs path to this file>')` from the
//      console of a tab navigated to the app): builds the identical world
//      (same seed, same pure spawn/placement functions) against a REAL
//      `ThreeRenderer` or `PixiRenderer` -- `ThreeRenderer` cannot be
//      constructed under `environment: 'node'`, per the brief, which is
//      exactly why mode 1 does not attempt it. `runBackendCurve` is the
//      browser entry point; it also re-times `sim.tick()` locally as a
//      cross-check against mode 1's numbers, and separately times
//      `renderer.frame()` with the sim held still, so a slow tick is never
//      mistaken for a slow renderer (the brief's own warning).
//
// Both modes build the world through the SAME pure functions
// (`buildWorld`, `computeAnchors`, `createSpawner`, `spawnUpTo`,
// `measureTicks`) so the two processes' numbers describe the same world
// rather than two different ones that happen to share a unit count.
//
// Nothing here touches `ThreeRenderer.ts`, `terrain/dirty.ts` or
// `renderer.ts` -- it only imports from them (relative paths, since
// `@lions/render` is not a declared dependency of `@lions/tools` and adding
// one was judged not worth the package.json churn for a perf tool; Node's
// module resolution does not care how a file is reached, only what is at the
// end of the path).

import {
  Sim,
  fx,
  HALF_TURN,
  TICKS_PER_SECOND,
  type SimConfig,
  type UnitTypeJson,
} from '@lions/sim';
import {
  units,
  maps,
  structures as structureCatalogue,
  parseMap,
  applyTerrain,
  paletteColor,
  vfxEmitters,
  type ParsedMap,
} from '@lions/data';

// Renderer-side imports are all relative paths INTO packages/render/src --
// never through `@lions/render`'s package specifier (tools/ does not depend
// on it) and never through a barrel `ThreeRenderer` is required to stay out
// of. `sheet.ts`/`three/units/atlas.ts` are pure (no DOM, no `three` import
// of their own beyond atlas.ts's types) and already unit-tested; reused
// unchanged here for the texture-memory calculation, exactly as the brief's
// Ruling 2 requires for animation -- the same principle applies to "how many
// bytes does a sheet cost", which is `packSheet` and `packSheet` alone.
import { parseManifest, type SheetSpec } from '../../../packages/render/src/sheet';
import { packSheet, FRAME_PX } from '../../../packages/render/src/three/units/atlas';
import type { Renderer, RendererOptions, TerrainTones } from '../../../packages/render/src/api';
import type { EmitterSpec } from '../../../packages/render/src/vfx';

// ============================================================================
// World construction -- pure enough to run in Node, reused by the browser.
// ============================================================================

/** Fixed so every run (Node tick pass, three.js browser pass, Pixi browser
 *  pass) spawns the identical world. Not a determinism guarantee across
 *  processes (RNG streams are per-entity but nothing here reads them before
 *  combat starts) -- just a fixed starting point so "same N" means the same
 *  roster in the same places every time this file runs. */
const SEED = 20260827;

/** The map this gate measures against. `beit_sahwan_outskirts` is the M0
 *  sandbox default, flat (no elevation milestone interactions to confound
 *  a units-only measurement), and already exercises both the terrain
 *  builder's normal path and real structures (parseMap derives them from
 *  the `#`/`=` grid; nothing in the raw JSON needs to say "structures"). */
const MAP_ID: keyof typeof maps = 'beit_sahwan_outskirts';

export interface WorldSetup {
  sim: Sim;
  map: ParsedMap;
  typeOf: Map<string, number>;
}

/** Builds a `Sim` on `MAP_ID` with terrain, structures and every unit TYPE
 *  (not yet any unit) registered -- exactly `main.ts`'s and `playtest.ts`'s
 *  own world-setup sequence, so this measures the real pipeline rather than
 *  a simplified stand-in for it. `capacity` is the caller's budget: `spawn`
 *  never reuses a dead slot (CLAUDE.md), so it must cover every unit that
 *  will ever be spawned across every checkpoint, not merely the peak living
 *  count. */
export function buildWorld(capacity: number): WorldSetup {
  const map = parseMap(maps[MAP_ID]);
  const config: SimConfig = { seed: SEED, width: map.width, height: map.height, capacity };
  const sim = new Sim(config);
  applyTerrain(map, sim);

  const structTypeIdx = new Map<string, number>();
  for (const [id, spec] of Object.entries(structureCatalogue)) {
    structTypeIdx.set(id, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  }
  for (const b of map.structures) {
    const t = structTypeIdx.get(b.type);
    if (t === undefined) throw new Error(`map references unknown structure type ${b.type}`);
    sim.addStructure(t, b.tiles);
  }

  const typeOf = new Map<string, number>();
  for (const u of Object.values(units) as UnitTypeJson[]) typeOf.set(u.id, sim.addUnitType(u));

  return { sim, map, typeOf };
}

export type TileXY = readonly [number, number];

/** Two anchors close enough that the nearest ranks of each side start
 *  within sight AND weapon range at spawn -- `stepCombat` auto-selects and
 *  auto-fires at any detected target in range with zero orders queued
 *  (`sim.ts`'s `stepCombat`), so no move/attack command is needed to get a
 *  real firefight going. Contact-range placement (`sandbox-anchors.ts`'s
 *  ~0.6x-the-map-edge convention, used for the actual sandbox) is
 *  deliberately NOT reused here: it is tuned for a player who will close
 *  the distance, and this harness issues no orders at all, so it would spawn
 *  a mission-sized crowd that never fires a shot. Every authored unit's
 *  sight/weapon range sits in 3.5-12 tiles (checked against the real JSON);
 *  16 tiles apart puts only the two anchors' OWN nearest ranks inside that
 *  band immediately -- close enough for a real, sustained firefight (not a
 *  token shot or two) but far enough that the bulk of a large formation's
 *  reserve rank sits outside every weapon's range and is not mutually
 *  grinding itself down before there is anything to measure. (10 tiles was
 *  tried first and measured ~35% attrition by the 400 checkpoint, cumulative
 *  across checkpoints sharing one continuous sim -- an honest number, but
 *  a confound this task does not need: it is fixed regardless of N either
 *  way, so "does combat start" still does not vary between checkpoints.) */
export function computeAnchors(map: ParsedMap): { friendly: TileXY; hostile: TileXY } {
  const cy = Math.round(map.height / 2);
  const cx = Math.round(map.width / 2);
  return { friendly: [cx - 8, cy], hostile: [cx + 8, cy] };
}

/** Tiles at increasing Chebyshev distance from an anchor, skipping blocked
 *  ground and anything already claimed by a caller-shared `taken` set.
 *  Deterministic, collision-free regardless of how many units land near the
 *  same anchor, and shared between both sides' generators via one `taken`
 *  set so the two formations cannot spawn on top of each other as their
 *  rings grow into the middle at high N. */
export function* ringTiles(
  sim: Pick<Sim, 'width' | 'height' | 'blocked'>,
  cx: number,
  cy: number,
  taken: Set<number>
): Generator<TileXY> {
  const maxR = sim.width + sim.height;
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = cx + dx;
        const ty = cy + dy;
        if (tx < 0 || ty < 0 || tx >= sim.width || ty >= sim.height) continue;
        const key = ty * sim.width + tx;
        if (sim.blocked[key] !== 0) continue;
        if (taken.has(key)) continue;
        taken.add(key);
        yield [tx, ty];
      }
    }
  }
}

/** Type ids only -- every one of these already has real art wired in
 *  `main.ts`'s `SPRITE_MAP` (`SPRITE_MAP_PATHS` below is a literal copy of
 *  the paths for exactly this subset), so "load sprites" here exercises the
 *  identical fetch/decode/pack path a real mission does, not a placeholder.
 *  This is the SAME 20-type roster the app's own `?sandbox` already spawns
 *  (`SANDBOX_KDF`/`SANDBOX_ENEMY` in `main.ts`, deduplicated to unique
 *  types) -- deliberately not invented for this harness, so "a 300-unit
 *  fight fields more types than a small mission" is measured against
 *  content that already ships, not a roster picked to make a number look a
 *  particular way. */
export const FRIENDLY_ROSTER: readonly string[] = [
  'mbt_lavi',
  'ifv_namer',
  'apc_eitan',
  'inf_squad',
  'at_team',
  'mortar_team',
  'jeep_shoded',
  'recon_drone',
  'dozer_d9',
  'heli_peten',
];

export const HOSTILE_ROSTER: readonly string[] = [
  'militia_cell',
  'rpg_team',
  'atgm_cell',
  'technical',
  'mortar_crew',
  'gun_truck',
  'charge_squad',
  'loiter_drone',
  'moto_rpg',
  'paramotor',
];

export interface Spawner {
  /** Spawns one more unit of the given side, cycling through that side's
   *  roster in order, and returns its entity id. */
  spawnOne(side: 0 | 1): number;
}

/** Builds a spawner that places units in expanding rings around each side's
 *  anchor, cycling through that side's roster. `taken` is shared across both
 *  rings (see `ringTiles`'s own doc comment) so the two formations cannot
 *  collide once they grow into each other at high N. */
export function createSpawner(
  sim: Sim,
  typeOf: Map<string, number>,
  friendlyAnchor: TileXY,
  hostileAnchor: TileXY
): Spawner {
  const taken = new Set<number>();
  const friendlyRing = ringTiles(sim, friendlyAnchor[0], friendlyAnchor[1], taken);
  const hostileRing = ringTiles(sim, hostileAnchor[0], hostileAnchor[1], taken);
  let fCount = 0;
  let hCount = 0;
  return {
    spawnOne(side) {
      const roster = side === 0 ? FRIENDLY_ROSTER : HOSTILE_ROSTER;
      const ring = side === 0 ? friendlyRing : hostileRing;
      const anchor = side === 0 ? friendlyAnchor : hostileAnchor;
      const idx = side === 0 ? fCount++ : hCount++;
      const typeId = roster[idx % roster.length];
      const t = typeOf.get(typeId);
      if (t === undefined) throw new Error(`unknown unit type ${typeId}`);
      const next = ring.next();
      const [tx, ty] = next.done ? anchor : next.value;
      const facing = side === 0 ? 0 : HALF_TURN;
      return sim.spawn(t, side, fx.from(tx + 0.5), fx.from(ty + 0.5), facing);
    },
  };
}

/** Spawns alternately from each side until `sim.entityCount` (the LIFETIME
 *  spawn count -- see `buildWorld`'s doc comment) reaches `target`. Called
 *  repeatedly across ascending checkpoints on the SAME sim, so a checkpoint
 *  spawns only the delta since the last one.
 *
 *  Task C3: does NOT "top the living count back up" -- `entityCount` counts
 *  lifetime spawns and never decreases as units die, and this loop's own
 *  condition reads that same never-decreasing counter, so a casualty
 *  between two checkpoints is never replaced: once `entityCount` reaches
 *  `target`, the loop exits regardless of how many of those spawns are
 *  still alive. In the browser harness, where real combat can kill units
 *  between checkpoints, the LIVING count at a later checkpoint can end up
 *  strictly below `target`. */
export function spawnUpTo(sim: Sim, spawner: Spawner, target: number): void {
  while (sim.entityCount < target) {
    const side: 0 | 1 = sim.entityCount % 2 === 0 ? 0 : 1;
    spawner.spawnOne(side);
  }
}

export function livingCount(sim: Sim): number {
  let n = 0;
  for (let i = 0; i < sim.entityCount; i++) if (sim.state.alive[i] === 1) n++;
  return n;
}

// ============================================================================
// Timing
// ============================================================================

export interface SampleStats {
  samples: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  totalMs: number;
}

export function summarize(samples: readonly number[]): SampleStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const totalMs = samples.reduce((a, b) => a + b, 0);
  const p95Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return {
    samples: samples.length,
    avgMs: samples.length > 0 ? totalMs / samples.length : 0,
    p95Ms: sorted.length > 0 ? sorted[p95Idx] : 0,
    maxMs: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
    totalMs,
  };
}

/** Times `ticks` calls to `sim.tick()` alone -- no renderer, no `onEvents`,
 *  no `snapshot`. This is the function both the Node CLI and the browser
 *  harness call; in Node it is the only cost in the process, in the browser
 *  it is a same-process cross-check against Node's numbers. */
export function measureTicks(sim: Sim, ticks: number): SampleStats {
  const samples: number[] = new Array<number>(ticks);
  for (let i = 0; i < ticks; i++) {
    const t0 = performance.now();
    sim.tick();
    samples[i] = performance.now() - t0;
  }
  return summarize(samples);
}

// ============================================================================
// Node CLI -- tick cost only, no renderer, no browser, no GPU.
//
// Task B4.4: this mode is the half of the three-vs-Pixi perf claim that CAN
// join CI, because it is the half with no browser/GPU in it -- `measureTicks`
// times `sim.tick()` alone, and `sim.tick()` runs identically under `tsx` in
// a GitHub Actions runner as it does in a real browser tab. So this mode now
// ASSERTS a budget per checkpoint and sets a non-zero exit code on breach,
// exactly like `pnpm balance`'s `report(...)` -> `process.exit(ok ? 0 : 1)`
// -- the precedent this file follows, wired the same way into `ci.yml`'s
// `gates` job.
//
// Be precise about what this guards and what it does not (a fix-round on
// this task's own report corrected an earlier version of this comment that
// overclaimed the second point):
//
//   - It only exercises `@lions/sim`. `packages/sim/` is frozen for the
//     whole three.js migration, so NOTHING under `packages/render/src/
//     three/**` -- the code this migration is actually about -- can ever
//     trip this gate. It is not a guard on the render-cost claim this task
//     re-measured; it guards one specific, already-documented sim-side
//     failure mode: CLAUDE.md's scaling-debt entry names detection as O(N^2)
//     per tick and flags it "real at the GDD's 300-unit target," and that is
//     exactly the number this mode times.
//   - The thresholds carry 5-9x headroom over currently-measured cost (see
//     the constants' own doc comment), so a regression smaller than roughly
//     3x passes silently. It is a coarse trip-wire, not a tight one.
//   - An EARLIER version of this comment claimed a tick-cost regression
//     caught here "would have shown up in the browser run too," reasoning
//     that the browser harness's own `measureCheckpoint` re-times
//     `sim.tick()` as a cross-check against these same Node numbers. A
//     fix-round on this task found that claim unsupported: an in-browser
//     tab running Pixi's `renderer.frame()` measured its OWN renderer-free
//     `sim.tick()` cost 5-8x higher than this Node CLI reports for the
//     identical world (2.18ms node vs ~14.5ms in-tab; 4.00ms vs ~12.9ms) --
//     i.e. sharing a tab with a GPU-heavy renderer inflates tick timing by
//     itself, which means this Node number and an in-tab number are NOT
//     interchangeable cross-checks the way the old comment claimed. This
//     gate's real justification is the bullet above: it is a first,
//     narrowly-scoped automated guard on one named sim-side debt, not a
//     stand-in for the browser measurement.
//   - Actually wiring the RENDER-cost claim into an automated gate would
//     need a real headless-browser-in-CI setup (e.g. Playwright driving an
//     actual Chromium with a real or software GL context) -- nothing of the
//     kind exists in this repo today, and building one is a bigger change
//     than this task's "wire an entry point" scope. Until then the render
//     comparison stays a manual browser gate, the same debt shape CLAUDE.md
//     already records for `playtest.ts`.
// ============================================================================

const CHECKPOINTS: readonly number[] = [65, 150, 300, 400];
const WARMUP_TICKS = 5;
const TIMED_TICKS = 40;

/** Fractions of the real 20 Hz tick budget (50 ms). Measured today (task
 *  B4.4, fog live) via THIS Node CLI -- no browser, no renderer, no tab --
 *  avg 0.21-2.84 ms, p95 0.72-3.79 ms, max 0.88-6.68 ms across the four
 *  checkpoints, so these thresholds carry roughly 5-9x headroom over the
 *  current worst case: enough to absorb CI-runner-vs-dev-laptop variance
 *  without being so wide a real O(N^2)-style regression (a 5-10x jump is the
 *  shape CLAUDE.md's detection-debt entry describes) could still slip under
 *  it -- though anything under ~3x still would (see the block comment
 *  above). Tighten only alongside a real re-measurement, the same rule
 *  `tuning.ts` follows for combat constants. Do NOT compare these numbers
 *  against an in-browser tick measurement from this file's browser mode --
 *  see that mode's own doc comment: a tab running a renderer measures a
 *  materially different (and, for Pixi, much higher) tick cost than this
 *  isolated Node process does, for the identical world. */
const MAX_AVG_TICK_MS = 20;
const MAX_P95_TICK_MS = 30;
const MAX_MAX_TICK_MS = 40;

async function runNodeCli(): Promise<void> {
  const capacity = CHECKPOINTS[CHECKPOINTS.length - 1] + 100;
  const { sim, map, typeOf } = buildWorld(capacity);
  const anchors = computeAnchors(map);
  const spawner = createSpawner(sim, typeOf, anchors.friendly, anchors.hostile);

  console.log(`[three-units] map=${MAP_ID} seed=${SEED} capacity=${capacity} tick=${TICKS_PER_SECOND}Hz`);
  console.log(
    `[three-units] regression budget: avg<${MAX_AVG_TICK_MS}ms p95<${MAX_P95_TICK_MS}ms max<${MAX_MAX_TICK_MS}ms ` +
      `(hard tick budget is ${(1000 / TICKS_PER_SECOND).toFixed(1)}ms)`
  );
  console.log('units_target | living | avg_ms | p95_ms | max_ms | budget_ms(1/20s)');
  let ok = true;
  for (const target of CHECKPOINTS) {
    spawnUpTo(sim, spawner, target);
    for (let i = 0; i < WARMUP_TICKS; i++) sim.tick();
    const stats = measureTicks(sim, TIMED_TICKS);
    const living = livingCount(sim);
    const budgetMs = 1000 / TICKS_PER_SECOND;
    console.log(
      `${target} | ${living} | ${stats.avgMs.toFixed(3)} | ${stats.p95Ms.toFixed(3)} | ` +
        `${stats.maxMs.toFixed(3)} | ${budgetMs.toFixed(3)}`
    );
    if (stats.avgMs >= MAX_AVG_TICK_MS || stats.p95Ms >= MAX_P95_TICK_MS || stats.maxMs >= MAX_MAX_TICK_MS) {
      ok = false;
      console.error(
        `[three-units] REGRESSION at units_target=${target} (living=${living}): ` +
          `avg=${stats.avgMs.toFixed(3)}ms p95=${stats.p95Ms.toFixed(3)}ms max=${stats.maxMs.toFixed(3)}ms ` +
          `exceeds budget avg<${MAX_AVG_TICK_MS} p95<${MAX_P95_TICK_MS} max<${MAX_MAX_TICK_MS}`
      );
    }
  }
  if (!ok) {
    console.error(
      '[three-units] sim tick cost regressed past this gate\'s budget -- see CLAUDE.md\'s ' +
        'detection-is-O(N^2) scaling debt before assuming the threshold is merely stale.'
    );
    process.exitCode = 1;
  }
}

// ============================================================================
// Browser harness -- real ThreeRenderer/PixiRenderer, real sprite sheets.
//
// Not imported at module scope: the browser-only imports below (`three`'s
// two doors, and DOM types) only resolve, and only execute, when this
// module runs in a browser. Under Node, `isNode` is true and `runNodeCli`
// is the only thing that runs -- the functions below are still parsed
// (harmless) but never called, so `new THREE.WebGLRenderer(...)` (inside
// `ThreeRenderer`'s own constructor, not this file) never executes.
// ============================================================================

interface SpriteSpec {
  path: string;
  turretPath?: string;
}

/** Literal copy of the relevant subset of `main.ts`'s `SPRITE_MAP` -- paths
 *  only (data, not code), without the `${BASE}` prefix so this object stays
 *  free of any `import.meta.env` access at module scope. `resolveSpritePath`
 *  below prepends the base at call time, in the browser-only functions. */
const SPRITE_MAP: Record<string, SpriteSpec> = {
  mbt_lavi: { path: 'sprites/TNK_HULL/', turretPath: 'sprites/TNK_TURR/' },
  ifv_namer: { path: 'sprites/NAMER_HULL/', turretPath: 'sprites/NAMER_TURR/' },
  apc_eitan: { path: 'sprites/EITAN_HULL/', turretPath: 'sprites/EITAN_TURR/' },
  inf_squad: { path: 'sprites/INF_SQUAD/' },
  at_team: { path: 'sprites/INF_AT/' },
  mortar_team: { path: 'sprites/INF_MORTAR/' },
  jeep_shoded: { path: 'sprites/JEEP_HULL/' },
  recon_drone: { path: 'sprites/DRONE_RECON/' },
  dozer_d9: { path: 'sprites/D9_HULL/' },
  heli_peten: { path: 'sprites/APACHE_HULL/' },
  militia_cell: { path: 'sprites/INF_MILITIA/' },
  rpg_team: { path: 'sprites/INF_RPG/' },
  atgm_cell: { path: 'sprites/INF_ATGM/' },
  technical: { path: 'sprites/TECH_HULL/', turretPath: 'sprites/TECH_TURR/' },
  mortar_crew: { path: 'sprites/INF_MORTAR_E/' },
  gun_truck: { path: 'sprites/GUNTRUCK_HULL/', turretPath: 'sprites/GUNTRUCK_TURR/' },
  charge_squad: { path: 'sprites/INF_CHARGE/' },
  loiter_drone: { path: 'sprites/DRONE_LOITER/' },
  moto_rpg: { path: 'sprites/MOTO_RPG/' },
  paramotor: { path: 'sprites/PARA_MOTOR/' },
};

/** Literal copy of `main.ts`'s `STRUCTURE_SPRITES`. */
const STRUCTURE_SPRITES: Record<string, string> = {
  shanty: 'sprites/BLD_SHANTY/',
  house: 'sprites/BLD_HOUSE/',
  warehouse: 'sprites/BLD_WAREHOUSE/',
  apartment: 'sprites/BLD_APARTMENT/',
  concrete: 'sprites/BLD_CONCRETE/',
  mosque: 'sprites/BLD_MOSQUE/',
  wall: 'sprites/BLD_WALL/',
};

/** `TERRAIN_THEMES.arid` from `packages/app/src/terrain-themes.ts`, copied
 *  rather than imported: `MAP_ID` (`beit_sahwan_outskirts`) defaults to the
 *  arid theme (`parseMap`'s own default), and this harness has no other use
 *  for `packages/app/src` -- keeping it self-contained in `tools/` avoids a
 *  reach into a sibling package's app-shell-internal module for one object
 *  literal. Values are real palette keys, not invented ones. */
function aridTerrainTones(): TerrainTones {
  return {
    open: paletteColor('limestone.3'),
    cover: [paletteColor('limestone.2'), paletteColor('dust.1'), paletteColor('dust.0')],
    blocked: paletteColor('limestone.4'),
    underBuilding: paletteColor('shadow.0'),
    road: paletteColor('dust.3'),
    rut: paletteColor('dust.5'),
    rock: paletteColor('limestone.6'),
    rockLit: paletteColor('limestone.3'),
    earth: paletteColor('terracotta.2'),
    low: paletteColor('olive.1'),
    trunk: paletteColor('dust.5'),
    trunkLit: paletteColor('dust.3'),
    leafDark: paletteColor('olive.2'),
    leafMid: paletteColor('olive.1'),
    leafLit: paletteColor('olive.0'),
    bladeLit: paletteColor('limestone.2'),
    bladeShade: paletteColor('limestone.5'),
    spoil: paletteColor('terracotta.1'),
    crownRatio: 0.52,
    scatter: 'stone',
  };
}

function buildRendererOptions(): RendererOptions {
  return {
    background: paletteColor('shadow.1'),
    teamColors: [paletteColor('team.kedem'), paletteColor('team.hostile'), paletteColor('team.neutral')],
    hullColors: [paletteColor('olive.1'), paletteColor('dust.2'), paletteColor('limestone.1')],
    infantryColors: [paletteColor('olive.0'), paletteColor('dust.0'), paletteColor('limestone.1')],
    groupColors: [
      paletteColor('group.g1'),
      paletteColor('group.g2'),
      paletteColor('group.g3'),
      paletteColor('group.g4'),
      paletteColor('group.g5'),
      paletteColor('group.g6'),
      paletteColor('group.g7'),
      paletteColor('group.g8'),
      paletteColor('group.g9'),
    ],
    terrainTones: aridTerrainTones(),
    tracerColors: [paletteColor('vfx.tracer'), paletteColor('vfx.ember')],
    flashColor: paletteColor('vfx.fire'),
    nearMissColor: paletteColor('dust.0'),
    interceptColor: paletteColor('vfx.interceptor'),
    resolveColor: paletteColor,
  };
}

function createHost(): HTMLElement {
  const host = document.createElement('div');
  host.id = 'three-units-perf-host';
  host.style.position = 'fixed';
  host.style.left = '0';
  host.style.top = '0';
  host.style.width = '1280px';
  host.style.height = '720px';
  document.body.appendChild(host);
  return host;
}

/** Bytes one sheet's `DataArrayTexture` costs at RGBA8, no mipmaps:
 *  `packSheet(sheet).layers * FRAME_PX * FRAME_PX * 4` -- the exact formula
 *  `atlas.ts`'s own top comment documents ("272 layers x 256x256 x 4 bytes")
 *  and the one `buildUnitTexture` actually uploads. Computed independently
 *  of `ThreeRenderer` (which exposes no memory stats and whose private
 *  `THREE.WebGLRenderer` is deliberately not reached into) by re-running the
 *  same pure `packSheet` the renderer itself calls, against the identical
 *  manifest fetch. */
function sheetBytes(sheet: SheetSpec): number {
  return packSheet(sheet).layers * FRAME_PX * FRAME_PX * 4;
}

interface TextureBudget {
  perType: { typeId: string; hullBytes: number; turretBytes: number; totalBytes: number }[];
  totalBytes: number;
}

/** Fetches every spawned unit type's manifest(s) and sums the bytes their
 *  `DataArrayTexture`(s) cost -- hull and turret are separate textures (see
 *  `ThreeRenderer.loadSprites`, which builds one of each when `turretPath`
 *  is given). Structure textures are deliberately excluded: they are a
 *  single flat `THREE.Texture` per type (`loadStructureSprite` calls
 *  `loadStructureFrame`, never `packSheet`/`buildUnitTexture`), not a
 *  256-layer array, so their contribution is a low single-digit MB at most
 *  against the roster's hundreds of MB -- not worth the extra fetch/decode
 *  machinery for a number this task's VRAM finding does not turn on. */
async function computeTextureBudget(base: string, typeIds: readonly string[]): Promise<TextureBudget> {
  const perType: TextureBudget['perType'] = [];
  let totalBytes = 0;
  for (const typeId of typeIds) {
    const spec = SPRITE_MAP[typeId];
    if (!spec) continue;
    const hullRes = await fetch(`${base}${spec.path}manifest.json`);
    if (!hullRes.ok) throw new Error(`manifest ${hullRes.status} at ${spec.path}`);
    const hullSheet = parseManifest(await hullRes.json());
    const hullBytes = sheetBytes(hullSheet);
    let turretBytes = 0;
    if (spec.turretPath) {
      const turretRes = await fetch(`${base}${spec.turretPath}manifest.json`);
      if (!turretRes.ok) throw new Error(`manifest ${turretRes.status} at ${spec.turretPath}`);
      const turretSheet = parseManifest(await turretRes.json());
      turretBytes = sheetBytes(turretSheet);
    }
    const totalForType = hullBytes + turretBytes;
    perType.push({ typeId, hullBytes, turretBytes, totalBytes: totalForType });
    totalBytes += totalForType;
  }
  return { perType, totalBytes };
}

/** Loads every roster type's sprites (hull + turret) and every structure
 *  type the map actually places, through the real `Renderer.loadSprites`/
 *  `loadStructureSprite` -- identical to what `main.ts` does for a live
 *  mission, so the GPU state during measurement (real textures, real
 *  instancer geometry) is the state a player would actually see, not a
 *  placeholder. Runs once per backend, BEFORE any unit is spawned, so
 *  fetch/decode latency (thousands of individual PNGs -- see this file's
 *  top comment) never lands inside a timed phase. */
async function loadAllSprites(renderer: Renderer, map: ParsedMap, base: string): Promise<void> {
  const allTypes = [...FRIENDLY_ROSTER, ...HOSTILE_ROSTER];
  await Promise.all(
    allTypes.map(async (typeId) => {
      const spec = SPRITE_MAP[typeId];
      if (!spec) throw new Error(`no sprite spec for ${typeId}`);
      await renderer.loadSprites(typeId, `${base}${spec.path}`, { turretPath: spec.turretPath });
    })
  );
  const structureTypes = new Set(map.structures.map((s) => s.type));
  await Promise.all(
    [...structureTypes].map(async (typeId) => {
      const path = STRUCTURE_SPRITES[typeId];
      if (!path) return; // no art for this type -- procedural fallback, same as a live mission
      await renderer.loadStructureSprite(typeId, `${base}${path}`);
    })
  );
}

export interface CheckpointReport {
  target: number;
  livingAtMeasure: number;
  tick: SampleStats;
  render: SampleStats;
}

const SETTLE_WARMUP_TICKS = 5;
// 2 sim-seconds at 20 Hz -- enough for a real, sustained firefight to be in
// progress (tracers in flight, turrets tracking) without letting attrition
// compound checkpoint over checkpoint the way 60 first did (see
// `computeAnchors`'s doc comment: living count undershot target by ~35% at
// the top checkpoint before this and the anchor separation were both tuned).
const SETTLE_TIMED_TICKS = 40;
const RENDER_WARMUP_FRAMES = 10;
const RENDER_TIMED_FRAMES = 180; // 3 seconds at 60 fps

/** One checkpoint: settle (timed ticks, sim state advances -- this is the
 *  in-browser cross-check of `measureTicks`'s Node numbers) then render
 *  (timed frames, sim state held FIXED). The two phases never overlap, so
 *  "render cost" cannot include a tick and "tick cost" cannot include a
 *  frame -- the brief's "separate the two clocks" requirement, structurally
 *  rather than by convention. */
async function measureCheckpoint(renderer: Renderer, sim: Sim, target: number): Promise<CheckpointReport> {
  for (let i = 0; i < SETTLE_WARMUP_TICKS; i++) {
    const events = sim.tick();
    renderer.snapshot();
    renderer.onEvents(events);
  }
  const tickSamples: number[] = new Array<number>(SETTLE_TIMED_TICKS);
  for (let i = 0; i < SETTLE_TIMED_TICKS; i++) {
    const t0 = performance.now();
    const events = sim.tick();
    tickSamples[i] = performance.now() - t0;
    renderer.snapshot();
    renderer.onEvents(events);
  }

  const livingAtMeasure = livingCount(sim);
  const dtMs = 1000 / 60;
  for (let i = 0; i < RENDER_WARMUP_FRAMES; i++) renderer.frame(1, dtMs);
  const renderSamples: number[] = new Array<number>(RENDER_TIMED_FRAMES);
  for (let i = 0; i < RENDER_TIMED_FRAMES; i++) {
    const t0 = performance.now();
    renderer.frame(1, dtMs);
    renderSamples[i] = performance.now() - t0;
  }

  return {
    target,
    livingAtMeasure,
    tick: summarize(tickSamples),
    render: summarize(renderSamples),
  };
}

export interface BackendReport {
  backend: 'three' | 'pixi';
  checkpoints: CheckpointReport[];
  textureBudget: TextureBudget;
}

/** Runs the full curve for one backend: one world, one renderer, one sprite
 *  load, `CHECKPOINTS.length` measured checkpoints, then dispose. Reusing
 *  one `Sim`/`Renderer` pair across all four checkpoints (rather than
 *  rebuilding at each N) means sprite loading -- the expensive part, by far
 *  -- happens exactly once per backend rather than once per (backend,
 *  count) pair, and it means unit count grows the way a real mission's
 *  does (reinforcement, not reset-and-replay). `capacity` is sized for the
 *  top checkpoint plus headroom for whatever combat attrition costs between
 *  checkpoints (`spawn` never reuses a dead slot, so a top-up after losses
 *  consumes fresh capacity). */
export async function runBackendCurve(
  backend: 'three' | 'pixi',
  makeRenderer: (sim: Sim, opts: RendererOptions) => Renderer,
  base: string,
  onProgress?: (msg: string) => void
): Promise<BackendReport> {
  const capacity = CHECKPOINTS[CHECKPOINTS.length - 1] + 150;
  const { sim, map, typeOf } = buildWorld(capacity);
  const opts = buildRendererOptions();
  const renderer = makeRenderer(sim, opts);
  renderer.setDecor(map.decor);
  renderer.setElevation(map.elevation);
  const host = createHost();
  onProgress?.(`[${backend}] init()`);
  await renderer.init(host);
  renderer.useEmitters(vfxEmitters as EmitterSpec[], paletteColor);

  onProgress?.(`[${backend}] loading sprites (roster + map structures)...`);
  await loadAllSprites(renderer, map, base);

  const anchors = computeAnchors(map);
  const spawner = createSpawner(sim, typeOf, anchors.friendly, anchors.hostile);
  renderer.camera.x = (anchors.friendly[0] + anchors.hostile[0]) / 2;
  renderer.camera.y = (anchors.friendly[1] + anchors.hostile[1]) / 2;

  const checkpoints: CheckpointReport[] = [];
  for (const target of CHECKPOINTS) {
    spawnUpTo(sim, spawner, target);
    onProgress?.(`[${backend}] measuring at target=${target} living=${livingCount(sim)}...`);
    const report = await measureCheckpoint(renderer, sim, target);
    checkpoints.push(report);
  }

  onProgress?.(`[${backend}] computing texture budget...`);
  const textureBudget = await computeTextureBudget(base, [...FRIENDLY_ROSTER, ...HOSTILE_ROSTER]);

  disposeRenderer(backend, renderer);
  host.remove();

  return { backend, checkpoints, textureBudget };
}

/** `Renderer` (`api.ts`) deliberately does not declare `dispose()` -- Pixi's
 *  own `Application` is torn down with the page, and only `ThreeRenderer`
 *  exposes an explicit one (it forces WebGL context loss; Pixi's canvas
 *  needs no equivalent to free its context on navigation). This harness
 *  runs each backend in its own tab (see this file's top comment), so
 *  skipping Pixi here is not a leak across the measurement -- the tab goes
 *  away regardless. */
function disposeRenderer(backend: 'three' | 'pixi', renderer: Renderer): void {
  if (backend !== 'three') return;
  (renderer as unknown as { dispose(): void }).dispose();
}

/** Convenience entry point for the browser console: dynamically import this
 *  module from a page the app's own Vite dev server is serving (so
 *  `@lions/render/three`'s own transitive `three` import resolves through
 *  `packages/render/node_modules`), then:
 *
 *    const mod = await import('/@fs/<absolute path>/tools/src/perf/three-units.ts');
 *    const report = await mod.measureThree();
 *
 *  Kept as a named export rather than auto-run on import so a stray dynamic
 *  import (e.g. from a devtools autocomplete probe) cannot kick off a
 *  multi-minute sprite-loading run by accident.
 *
 *  EXPECT A WIDE RANGE ON PIXI'S NUMBERS, NOT A SINGLE POINT. Two fix-rounds
 *  on task B4.4 chased this down. Round 1 measured Pixi's render cost 5-25x
 *  lower than an independent re-run and blamed it on the automation tab's
 *  `document.visibilityState === 'hidden'` (never composited to a screen) --
 *  round 2 refuted that directly: the independent re-run's tab was ALSO
 *  `hidden:true`/`hasFocus:false`, in the exact same automation tab group,
 *  so tab-visibility cannot be what separated the two measurements. That
 *  hypothesis is TESTED AND REFUTED -- do not re-chase it.
 *
 *  What actually separates the runs is ambient CPU load, and it hits the two
 *  backends asymmetrically. In a lightly-loaded run, this file's OWN
 *  renderer-free `sim.tick()` (the exact code the Node CLI above times)
 *  read 1.6-2.9ms inside a tab also driving THREE's renderer, and roughly
 *  the same, 2.5-3.5ms, inside a tab also driving PIXI's. Under real ambient
 *  load (another process on the machine at ~30-60% CPU, not induced by this
 *  harness), the same renderer-free code read 2.5-3.5ms next to three but
 *  12.0-14.5ms next to Pixi -- a 4-6x jump for Pixi's tab and barely any
 *  move for three's, on code that does not know which renderer shares its
 *  tab. That is a genuine load-SENSITIVITY difference between the backends
 *  (Pixi's CPU-bound batching degrades under contention; three's instanced
 *  draws largely do not), not a measurement artefact of either run being
 *  "wrong". Report Pixi's render/tick cost as a RANGE bounded by a quiet-ish
 *  run and a loaded run, and note which end is closer to what a real player
 *  has running (a loaded machine, if anything, closer to the high end) --
 *  never as one clean number. three's numbers stay tight across load levels
 *  and don't need the same treatment. */
export async function measureThree(
  onProgress?: (msg: string) => void
): Promise<BackendReport> {
  const { ThreeRenderer } = await import('../../../packages/render/src/three/ThreeRenderer');
  const base = resolveBase();
  return runBackendCurve('three', (sim, opts) => new ThreeRenderer(sim, opts), base, onProgress);
}

export async function measurePixi(
  onProgress?: (msg: string) => void
): Promise<BackendReport> {
  const { PixiRenderer } = await import('../../../packages/render/src/renderer');
  const base = resolveBase();
  return runBackendCurve('pixi', (sim, opts) => new PixiRenderer(sim, opts), base, onProgress);
}

/** `assets/` is served at the app's own root by `vite.config.ts`'s
 *  `publicDir`, so a dev-server base of `/` is correct for every context
 *  this harness runs in (it is a local dev tool, never a GitHub Pages
 *  build). Reading `import.meta.env.BASE_URL` would need `vite/client`'s
 *  ambient types, which this package does not declare and should not have
 *  to for one constant. */
function resolveBase(): string {
  return '/';
}

// ============================================================================
// Entry point selection
// ============================================================================

// True only when THIS FILE is the direct `tsx` entry point (`process.argv[1]`
// names it), not merely when something under Node happens to import it for
// its pure functions -- a cross-check script that imports `buildWorld`/
// `spawnUpTo`/`measureTicks` directly (as this file's own doc comment
// invites) would otherwise trigger a second, uncontrolled CLI run as an
// import side effect, sharing the process with whatever the importer does
// next and producing exactly the contaminated, GC-noisy timings that side
// effect caused the first time this was tried. The browser has no `process`
// global at all, so this stays false there unconditionally regardless --
// nothing above runs `new THREE.WebGLRenderer(...)` (or even imports the
// module that would) unless `measureThree`/`measurePixi` is explicitly
// called, which only the browser console path above does.
const isNodeCli =
  typeof process !== 'undefined' &&
  typeof process.versions?.node === 'string' &&
  typeof process.argv[1] === 'string' &&
  import.meta.url === `file://${process.argv[1]}`;

if (isNodeCli) {
  runNodeCli().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
