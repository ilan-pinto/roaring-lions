/**
 * The ATGM motion sheet (GH-250, spec
 * `docs/superpowers/specs/2026-09-28-atgm-animation-design.md`, "Capture
 * protocol"): ten seconds of a guided or unguided round leaving the launcher,
 * flying, and landing, judged IN MOTION through a flip page -- never a still.
 *
 *   pnpm atgm:capture -- --label=before --port=5197
 *   pnpm atgm:capture -- --label=after --port=5198 --only=spike,rpg
 *
 * A retarget of `blast-captures.ts`, and it keeps that file's three paid-for
 * behaviours: the frame loop is FROZEN (`FREEZE_FRAME_LOOP_SCRIPT`), every
 * frame is pumped by hand (rAF is throttled in a hidden tab), and subjects are
 * spawned, never found. It differs in one: the sim is driven in LOCKSTEP by
 * hand (plan P-6) -- `sim.tick()`, `renderer.snapshot()`,
 * `renderer.onEvents(events)` once per 50 ms of pumped frame time -- and never
 * through `__lions.step`, whose closing `frame(1, lastFrameMs)` would age
 * every rung by whatever the freeze latched.
 *
 * It takes NO frame-cost numbers: other headless browsers share the machine,
 * so the sheet records the load average instead, as a capture condition.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { musicOffInitScript } from '../ui-review/music-off';

// ---------------------------------------------------------------------------
// The pure half, imported by the spec. Nothing here may pull in playwright.
// ---------------------------------------------------------------------------

export const ATGM_WINDOW_MS = 10_000;
/** Dense through the flight: the slowest round, a Kornet at 8 tiles, is ~1.6 s. */
export const ATGM_DENSE_UNTIL_MS = 3_000;
export const ATGM_DENSE_EVERY_MS = 50;
export const ATGM_SPARSE_EVERY_MS = 250;

/** 0..3000 every 50 ms, then 3250..10000 every 250 ms: 61 + 28 = 89 rungs. */
export function atgmLadder(): number[] {
  const out: number[] = [];
  for (let t = 0; t <= ATGM_DENSE_UNTIL_MS; t += ATGM_DENSE_EVERY_MS) out.push(t);
  for (let t = ATGM_DENSE_UNTIL_MS + ATGM_SPARSE_EVERY_MS; t <= ATGM_WINDOW_MS; t += ATGM_SPARSE_EVERY_MS) out.push(t);
  return out;
}

export const ATGM_LADDER_MS: readonly number[] = atgmLadder();

export interface AtgmSubject {
  id: string;
  shooter: string;
  shooterSide: 0 | 1;
  target: string;
  targetSide: 0 | 1;
  /** Shooter tile; the target stands at `(x + gapTiles, y)`. */
  x: number;
  y: number;
  gapTiles: number;
  expectVariant: 'top_attack' | 'guided' | 'unguided';
  why: string;
}

/** The four pairs of the spec's capture protocol, on the open northern band
 *  (rows 0-7 of `beit_sahwan_outskirts`). They run one after another and each
 *  pair is removed after its window (plan P-7), so rows may repeat. */
export const ATGM_SUBJECTS: readonly AtgmSubject[] = [
  {
    id: 'spike',
    shooter: 'at_team',
    shooterSide: 0,
    target: 'technical',
    targetSide: 1,
    x: 4,
    y: 3,
    gapTiles: 7,
    expectVariant: 'top_attack',
    why: 'The only top-attack profile: a Spike that climbs and dives onto the roof rather than flying flat.',
  },
  {
    id: 'kornet',
    shooter: 'atgm_cell',
    shooterSide: 1,
    target: 'jeep_shoded',
    targetSide: 0,
    x: 4,
    y: 4,
    gapTiles: 8,
    expectVariant: 'guided',
    why: 'The longest ground-launched guided flight, into a target with no APS, so nothing intercepts it.',
  },
  {
    id: 'hellfire',
    shooter: 'heli_peten',
    shooterSide: 0,
    target: 'technical',
    targetSide: 1,
    x: 4,
    y: 5,
    gapTiles: 8,
    expectVariant: 'guided',
    why: 'The air launch: the round starts at rotor height, and at 8 tiles the 7.5-tile chain gun is out of range.',
  },
  {
    id: 'rpg',
    shooter: 'rpg_team',
    shooterSide: 1,
    target: 'jeep_shoded',
    targetSide: 0,
    x: 4,
    y: 3,
    gapTiles: 4,
    expectVariant: 'unguided',
    why: 'The short unguided rocket: the whole flight fits in about a dozen dense rungs.',
  },
];

/** How a stretch of pumped time is driven: one sim tick per `tickMs`, and
 *  frames of at most `frameMs` with the exact remainder, so the accumulated
 *  frame time lands ON the rung rather than near it. */
export function lockstepPlan(ms: number, tickMs: number, frameMs: number): { ticks: number; frames: number[] } {
  const frames: number[] = [];
  let left = ms;
  while (left >= frameMs) {
    frames.push(frameMs);
    left -= frameMs;
  }
  if (left > 0) frames.push(left);
  return { ticks: Math.floor(ms / tickMs), frames };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** One self-contained page that plays the frames at their REAL timestamps
 *  (so the sparse tail runs at the pace it was captured at), holds a second,
 *  and loops. No external script, no URL: it opens from disk. */
export function flipHtml(label: string, frames: readonly { file: string; tMs: number }[]): string {
  // `<` escaped inside the script so a file name can never close the tag.
  const files = JSON.stringify(frames.map((f) => f.file)).replace(/</g, '\\u003c');
  const times = JSON.stringify(frames.map((f) => f.tMs));
  const first = frames.length > 0 ? escapeHtml(frames[0].file) : '';
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>ATGM flip -- ${escapeHtml(label)}</title>
<style>body{margin:16px;font:14px sans-serif}img{display:block;image-rendering:pixelated;max-width:100%}</style>
</head><body>
<h1>ATGM flip -- ${escapeHtml(label)}</h1>
<p><label>speed <select id="s"><option value="1">1x</option><option value="0.5">0.5x</option><option value="0.25">0.25x</option></select></label>
<button id="p" type="button">pause</button> <span id="t"></span> (plays at real timestamps, holds 1 s, then loops)</p>
<img id="f" src="${first}" alt="frame">
<script>
const T=${times};
const F=${files};
const img=document.getElementById('f'),sel=document.getElementById('s'),btn=document.getElementById('p'),lab=document.getElementById('t');
let i=0,paused=false,timer=0;
function show(){img.src=F[i];lab.textContent='t = '+T[i]+' ms ('+(i+1)+'/'+F.length+')';}
function next(){
  if(paused||F.length===0)return;
  const speed=Number(sel.value);
  const loop=i>=F.length-1;
  const wait=loop?1000:(T[i+1]-T[i])/speed;
  timer=setTimeout(function(){i=loop?0:i+1;show();next();},wait);
}
btn.onclick=function(){paused=!paused;btn.textContent=paused?'play':'pause';clearTimeout(timer);if(!paused)next();};
sel.onchange=function(){clearTimeout(timer);next();};
for(const f of F){const p=new Image();p.src=f;}
show();next();
</script>
</body></html>
`;
}

export interface AtgmCell {
  subject: string;
  tMs: number;
  tick: number;
  zoom: number;
  /** Rounds in flight after this rung: `missileFx.missiles.length`, or on a
   *  build without it (the before-set) `bolts.length`. */
  inFlight: number;
  /** The oldest round's `t / duration` after this rung, or -1 with none in
   *  flight (and always -1 on a build without `missileFx`). */
  progress: number;
  /** Live smoke-trail puffs in `missileFx.trail` -- 0 on a build without it. */
  trail: number;
  /** The brightest flash light live within `FLASH_NEAR_TILES` of the target,
   *  in EMITTER units (the pool's own `peak / FLASH_INTENSITY_SCALE`), so a
   *  HEAT hit reads the `missile_impact.json` 2.6 and an intercept 1.3. */
  flash: number;
  file: string;
}

/** Copied from `packages/render/src/three/flash-light.ts` (the spec pins it
 *  against that file as text): the harness imports nothing from `three`. */
export const FLASH_INTENSITY_SCALE = 12;
/** How near the target a live flash must be to count as the impact's. */
export const FLASH_NEAR_TILES = 1.5;

export function atgmSheetIndex(label: string, env: string, cells: readonly AtgmCell[]): string {
  return [
    `# ATGM capture sheet -- ${label}`,
    ``,
    `Capture conditions: ${env}`,
    ``,
    `Ladder: ${ATGM_LADDER_MS.length} rungs a subject -- every ${ATGM_DENSE_EVERY_MS} ms to ${ATGM_DENSE_UNTIL_MS} ms, ` +
      `then every ${ATGM_SPARSE_EVERY_MS} ms to ${ATGM_WINDOW_MS} ms -- in lockstep: one sim tick per 50 ms of pumped ` +
      `frame time. Judge the flip pages, not the stills.`,
    ``,
    `| subject | t (ms) | tick | zoom | in flight | progress | trail puffs | flash at target | file |`,
    `|---|---|---|---|---|---|---|---|---|`,
    ...cells.map(
      (c) =>
        `| ${c.subject} | ${c.tMs} | ${c.tick} | ${c.zoom} | ${c.inFlight} | ${c.progress < 0 ? '-' : c.progress.toFixed(2)} | ` +
        `${c.trail} | ${c.flash.toFixed(2)} | \`${c.file}\` |`
    ),
    ``,
  ].join('\n');
}

export interface AtgmLayerFloor {
  minDiffPixels: number;
  minMeanAbsChannelDelta: number;
  measured: string;
}

/** The capture conditions every `ATGM_MISSILES_RUNS` reading was taken under. */
const MISSILES_RUNS_CONDITIONS =
  '2026-09-28, darwin-arm64 12 cpus, ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)), ' +
  'SwiftShader driver), viewport 1400x900 dsf1, 600x400 crop, zoom 2.0, rung 600';

/**
 * The `missiles` toggle at rung 600, three consecutive full after-set runs a
 * subject (Task 7's report, Step 2), as `[diffPixels, meanAbsChannelDelta]`.
 * The source of every floor below, and pinned against it by the spec.
 */
export const ATGM_MISSILES_RUNS: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
  spike: [[244, 0.1237], [277, 0.1328], [225, 0.1207]],
  kornet: [[170, 0.0983], [164, 0.0994], [195, 0.1152]],
  hellfire: [[520, 0.1812], [452, 0.149], [550, 0.1858]],
  rpg: [[70, 0.1084], [70, 0.1084], [70, 0.1077]],
};

function measuredFor(id: string, floorPx: number, floorDelta: number): string {
  const runs = ATGM_MISSILES_RUNS[id].map(([px, d]) => `${px}/${d.toFixed(4)}`).join(', ');
  return `${MISSILES_RUNS_CONDITIONS}, three full after-set runs (px / mean abs channel delta): ${id} ${runs}; ` +
    `floors ${floorPx} and ${floorDelta} are a third of this subject's own minimum, rounded down.`;
}

/**
 * The `missiles` toggle floors, **one per subject**: a third of THAT
 * subject's own smallest reading over its three runs, per metric, rounded
 * down -- the blast harness's rule, applied per shot (final fix wave). Task 7
 * shipped one shared pair, set by the smallest round on screen (the RPG's
 * 70 px, the Kornet's 0.0983), which left the Spike judged against a third
 * of an RPG: hiding its sprites outright (T7 mutation (a), 86 px / 0.0292)
 * cleared the pixel floor and missed the delta floor by 11%. Against its own
 * floor that reading sits 27% under.
 *
 * Floors are only ever RAISED, from measurement. Never lower one to clear a
 * red run: a floor at 0 passes a layer that draws nothing.
 */
export const ATGM_MISSILES_FLOORS: Readonly<Record<string, AtgmLayerFloor>> = {
  spike: { minDiffPixels: 75, minMeanAbsChannelDelta: 0.0402, measured: measuredFor('spike', 75, 0.0402) },
  kornet: { minDiffPixels: 54, minMeanAbsChannelDelta: 0.0327, measured: measuredFor('kornet', 54, 0.0327) },
  hellfire: { minDiffPixels: 150, minMeanAbsChannelDelta: 0.0496, measured: measuredFor('hellfire', 150, 0.0496) },
  rpg: { minDiffPixels: 23, minMeanAbsChannelDelta: 0.0359, measured: measuredFor('rpg', 23, 0.0359) },
};

/** The floor a subject's reading is judged against. Throws for a subject
 *  with none, rather than judging it against another subject's. */
export function missilesFloorFor(subject: string): AtgmLayerFloor {
  const f = ATGM_MISSILES_FLOORS[subject];
  if (f === undefined) throw new Error(`no missiles floor for subject "${subject}"`);
  return f;
}

/** Why one `missiles` toggle reading fails its floor -- empty when it clears
 *  it. A layer the build does not have fails too: the after-set must have it. */
export function missilesFloorReasons(
  reading: { available: boolean; diffPixels: number; meanAbsChannelDelta: number },
  floor: AtgmLayerFloor
): string[] {
  if (!reading.available) return ['the missiles layer is not in this build'];
  const out: string[] = [];
  if (!(reading.diffPixels >= floor.minDiffPixels)) out.push(`diffPixels ${reading.diffPixels} < floor ${floor.minDiffPixels}`);
  if (!(reading.meanAbsChannelDelta >= floor.minMeanAbsChannelDelta)) {
    out.push(`meanAbsChannelDelta ${reading.meanAbsChannelDelta.toFixed(4)} < floor ${floor.minMeanAbsChannelDelta}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The browser half.
// ---------------------------------------------------------------------------

const PORTS: readonly number[] = [5197, 5198];
const VIEWPORT = { width: 1400, height: 900 } as const;
const SETTLE_VIEWPORT = { width: 320, height: 200 } as const;
const LADDER_ZOOM = 2.0;
const ESTABLISH_ZOOM = 1.0;
const CROP = { width: 600, height: 400 } as const;
const CROP_LIFT_PX = 40;
const TICK_MS = 50;
const FRAME_MS = 16;
const FIRE_TICK_CAP = 1200;
const TOGGLE_RUNG_MS = 600;
const DRAIN_TICKS = 20;
/** 16 ms frames pumped after the drain ticks, at most, waiting for the air to clear. */
const DRAIN_FRAME_CAP = 400;
const FIXED = 65536;
const STEP_TIMEOUT_MS = 120_000;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

interface LionsWindow {
  __lions: {
    renderer: {
      camera: { x: number; y: number; zoom: number };
      frame(alpha: number, dtMs: number): void;
      snapshot(): void;
      onEvents(events: unknown[]): void;
      worldToScreen(x: number, y: number): { x: number; y: number };
      bolts?: unknown[];
      missileFx?: { missiles: { t: number; duration: number }[]; trail: { live: number } };
      flashLights?: { active?: { x: number; z: number; peak: number }[] };
      curX?: ArrayLike<number>;
      curY?: ArrayLike<number>;
    };
    sim: {
      tickCount: number;
      unitTypes: { id: string }[];
      state: { alive: Int8Array | Uint8Array };
      spawn(typeIdx: number, side: number, x: number, y: number): number;
      tick(): { kind: string; shooter?: number; weaponId?: string }[];
      removeFromPlay(id: number): void;
    };
  };
}

interface ToggleReading {
  subject: string;
  layer: string;
  available: boolean;
  diffPixels: number;
  meanAbsChannelDelta: number;
  note: string;
}

function arg(name: string): string {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : '';
}

function load(): string {
  const [a, b, c] = os.loadavg();
  return `load ${a.toFixed(2)}/${b.toFixed(2)}/${c.toFixed(2)} on ${os.cpus().length} cpus`;
}

/** Drives `ms` of lockstep time in the page and returns the tick and the
 *  in-flight count afterwards. A tick lands on the frame that crosses each
 *  50 ms boundary. NO named function expressions in an evaluate body: esbuild
 *  wraps them in `__name`, which the page does not have. */
async function pump(
  page: import('playwright').Page,
  ms: number,
  target = -1
): Promise<{
  tick: number;
  inFlight: number;
  progress: number;
  trail: number;
  flash: number;
  fires: { tick: number; shooter: number; weaponId: string }[];
}> {
  const plan = lockstepPlan(ms, TICK_MS, FRAME_MS);
  return page.evaluate(
    ([frames, ticks, tickMs, tgt, scale, near]) => {
      const L = (window as unknown as LionsWindow).__lions;
      let pumped = 0;
      let done = 0;
      const fires: { tick: number; shooter: number; weaponId: string }[] = [];
      for (const f of frames) {
        L.renderer.frame(1, f);
        pumped += f;
        while (done < ticks && pumped >= (done + 1) * tickMs) {
          const events = L.sim.tick();
          L.renderer.snapshot();
          L.renderer.onEvents(events);
          for (const e of events) {
            if (e.kind === 'fire') fires.push({ tick: L.sim.tickCount, shooter: e.shooter ?? -1, weaponId: e.weaponId ?? '?' });
          }
          done++;
        }
      }
      const r = L.renderer;
      const mfx = r.missileFx;
      const inFlight = mfx !== undefined ? mfx.missiles.length : (r.bolts ?? []).length;
      const first = mfx !== undefined && mfx.missiles.length > 0 ? mfx.missiles[0] : undefined;
      const progress = first === undefined ? -1 : first.duration > 0 ? Math.min(1, first.t / first.duration) : 1;
      const trail = mfx !== undefined ? mfx.trail.live : 0;
      // Read-only peeks at two private renderer fields: the target's drawn
      // position and the flash pool's live list. Nothing is written.
      let flash = 0;
      const tx = tgt >= 0 && r.curX !== undefined ? r.curX[tgt] : NaN;
      const ty = tgt >= 0 && r.curY !== undefined ? r.curY[tgt] : NaN;
      for (const f of r.flashLights?.active ?? []) {
        if (Math.hypot(f.x - tx, f.z - ty) <= near) flash = Math.max(flash, f.peak / scale);
      }
      return { tick: L.sim.tickCount, inFlight, progress, trail, flash, fires };
    },
    [plan.frames, plan.ticks, TICK_MS, target, FLASH_INTENSITY_SCALE, FLASH_NEAR_TILES] as const
  );
}

/** Centres the camera on the pair at `zoom`, repaints at zero elapsed time,
 *  and returns the 600x400 crop around the midpoint, lifted 40 px. */
async function frameOn(page: import('playwright').Page, s: AtgmSubject, zoom: number) {
  const mx = s.x + s.gapTiles / 2;
  const at = await page.evaluate(
    ([x, y, z]) => {
      const L = (window as unknown as LionsWindow).__lions;
      L.renderer.camera.x = x;
      L.renderer.camera.y = y;
      L.renderer.camera.zoom = z;
      L.renderer.frame(1, 0);
      return L.renderer.worldToScreen(x, y);
    },
    [mx, s.y, zoom] as const
  );
  return {
    x: Math.min(Math.max(0, at.x - CROP.width / 2), VIEWPORT.width - CROP.width),
    y: Math.min(Math.max(0, at.y - CROP.height / 2 - CROP_LIFT_PX), VIEWPORT.height - CROP.height),
    width: CROP.width,
    height: CROP.height,
  };
}

async function main(): Promise<void> {
  const { chromium } = await import('playwright');
  const { ensureDevServer, stopDevServer, readUnmaskedRenderer } = await import('../golden-diff/browser');
  const { FREEZE_FRAME_LOOP_SCRIPT, REPAINT_SCRIPT, layerToggleScript } = await import('../golden-diff/capture-protocol');
  const { computeDiff } = await import('../golden-diff/diff');
  const { settleScript, parseSettleResult, settleLine } = await import('./blast-captures');

  const label = arg('label');
  if (label !== 'before' && label !== 'after') throw new Error('--label=before|after is required');
  const port = Number(arg('port'));
  if (port === 5173 || !PORTS.includes(port)) {
    throw new Error(`--port must be one of ${PORTS.join('/')} (got "${arg('port')}"); 5173 and every other port are someone else's`);
  }
  const onlyIds = arg('only').split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  for (const id of onlyIds) {
    if (!ATGM_SUBJECTS.some((s) => s.id === id)) throw new Error(`--only=${id} names no subject`);
  }
  const wanted = onlyIds.length > 0 ? ATGM_SUBJECTS.filter((s) => onlyIds.includes(s.id)) : ATGM_SUBJECTS;
  const out = path.join(REPO_ROOT, '.superpowers', 'art-captures', 'atgm', label);
  fs.mkdirSync(path.join(out, 'toggles'), { recursive: true });

  const server = await ensureDevServer(port, REPO_ROOT, 'atgm-captures');
  if (server === null) {
    console.error(`port ${port} is not ours -- pick the other of 5197/5198`);
    process.exitCode = 2;
    return;
  }
  const cells: AtgmCell[] = [];
  const notes: string[] = [`machine at start: ${load()}`];
  const toggles: ToggleReading[] = [];
  const windowFires: Record<string, { tick: number; shooter: number; weaponId: string }[]> = {};
  const fired: Record<string, { tick: number; weaponId: string; ticksWaited: number } | null> = {};
  let env = '';
  const browser = await chromium.launch({ headless: true });
  try {
    const gl = (await readUnmaskedRenderer(browser)).replace(/\|/g, '/');
    env = `${process.platform}-${process.arch} ${gl} ${VIEWPORT.width}x${VIEWPORT.height} dsf1`;
    const page = await browser.newPage({ viewport: { ...SETTLE_VIEWPORT }, deviceScaleFactor: 1 });
    await page.addInitScript(musicOffInitScript());
    page.setDefaultTimeout(STEP_TIMEOUT_MS);
    page.on('pageerror', (err) => console.log('  page error:', err.message));
    await page.goto(`http://localhost:${port}/?sandbox=beit_sahwan_outskirts&renderer=three`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof (window as unknown as { __lions?: unknown }).__lions !== 'undefined');
    await page.evaluate(() => document.fonts.ready);
    const settle = parseSettleResult(await page.evaluate(settleScript(30_000)));
    notes.push(settleLine('beit_sahwan_outskirts', settle));
    await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);
    await page.setViewportSize({ ...VIEWPORT });
    await page.waitForFunction(
      ([w, h]) => {
        const c = document.querySelector('canvas');
        return c !== null && c.clientWidth === w && c.clientHeight === h;
      },
      [VIEWPORT.width, VIEWPORT.height] as const
    );

    let establishing = true;
    for (const s of wanted) {
      console.log(`${label}: ${s.id} (${s.shooter} -> ${s.target}, ${s.gapTiles} tiles)`);
      const start = await page.evaluate(
        ([row, fixed, cap]) => {
          const L = (window as unknown as LionsWindow).__lions;
          const si = L.sim.unitTypes.findIndex((t) => t.id === row.shooter);
          const ti = L.sim.unitTypes.findIndex((t) => t.id === row.target);
          if (si < 0 || ti < 0) throw new Error(`${row.shooter}/${row.target} not in this build`);
          const shooter = L.sim.spawn(si, row.shooterSide, row.x * fixed, row.y * fixed);
          const target = L.sim.spawn(ti, row.targetSide, (row.x + row.gapTiles) * fixed, row.y * fixed);
          for (let n = 1; n <= cap; n++) {
            const events = L.sim.tick();
            L.renderer.snapshot();
            L.renderer.onEvents(events);
            const hit = events.find((e) => e.kind === 'fire' && e.shooter === shooter);
            if (hit !== undefined) return { shooter, target, n, tick: L.sim.tickCount, weaponId: hit.weaponId ?? '?' };
          }
          return { shooter, target, n: -1, tick: L.sim.tickCount, weaponId: '' };
        },
        [s, FIXED, FIRE_TICK_CAP] as const
      );
      if (start.n < 0) {
        notes.push(`${s.id}: ${s.shooter} did not fire in ${FIRE_TICK_CAP} ticks -- subject skipped, no rung recorded`);
        fired[s.id] = null;
        process.exitCode = 1;
      } else {
        fired[s.id] = { tick: start.tick, weaponId: start.weaponId, ticksWaited: start.n };
        console.log(`  fire (${start.weaponId}) at tick ${start.tick}, after ${start.n} ticks`);
        let prev = 0;
        const seen: { tick: number; shooter: number; weaponId: string }[] = [];
        windowFires[s.id] = seen;
        for (const tMs of ATGM_LADDER_MS) {
          const st = await pump(page, tMs - prev, start.target);
          prev = tMs;
          seen.push(...st.fires);
          const clip = await frameOn(page, s, LADDER_ZOOM);
          const file = `${s.id}-${String(tMs).padStart(5, '0')}.png`;
          await page.screenshot({ path: path.join(out, file), clip });
          const measured = { inFlight: st.inFlight, progress: st.progress, trail: st.trail, flash: st.flash };
          cells.push({ subject: s.id, tMs, tick: st.tick, zoom: LADDER_ZOOM, ...measured, file });
          if (tMs !== TOGGLE_RUNG_MS) continue;
          const shown = path.join(out, 'toggles', `${s.id}-missiles-shown.png`);
          const hidden = path.join(out, 'toggles', `${s.id}-missiles-hidden.png`);
          await page.evaluate(REPAINT_SCRIPT);
          await page.screenshot({ path: shown, clip });
          try {
            await page.evaluate(layerToggleScript('missiles', false));
            await page.screenshot({ path: hidden, clip });
            await page.evaluate(layerToggleScript('missiles', true));
            const d = computeDiff(shown, hidden, { outDir: path.join(out, 'toggles'), diffFileName: `${s.id}-missiles-diff.png` });
            toggles.push({ subject: s.id, layer: 'missiles', available: true, ...d, note: '' });
          } catch (err) {
            const first = (err instanceof Error ? err.message : String(err)).split('\n')[0];
            toggles.push({ subject: s.id, layer: 'missiles', available: false, diffPixels: 0, meanAbsChannelDelta: 0, note: `layer not in this build (${first})` });
          }
          // The zoom-1.0 establishing still, of the first pair at its rung 600.
          // Taken HERE rather than after the loop because the pair is removed
          // at the end of its window; a zero-time repaint moves no clock.
          if (establishing) {
            establishing = false;
            await frameOn(page, s, ESTABLISH_ZOOM);
            const est = `${s.id}-establish-z1-${String(tMs).padStart(5, '0')}.png`;
            await page.screenshot({ path: path.join(out, est) });
            cells.push({ subject: s.id, tMs, tick: st.tick, zoom: ESTABLISH_ZOOM, ...measured, file: est });
          }
        }
      }
      await page.evaluate(
        ([ids]) => {
          const L = (window as unknown as LionsWindow).__lions;
          for (const id of ids) if (L.sim.state.alive[id] === 1) L.sim.removeFromPlay(id);
        },
        [[start.shooter, start.target]] as const
      );
      // The drain is DRAIN_TICKS lockstep ticks WITH their frames, then frames
      // until nothing is in flight. Ticks alone age no round: a round is
      // stepped by frame time, and a Hellfire fired at 10 s was measured still
      // flying through the next subject's first 700 ms.
      let drained = await pump(page, DRAIN_TICKS * TICK_MS);
      for (let n = 0; drained.inFlight > 0 && n < DRAIN_FRAME_CAP; n++) drained = await pump(page, FRAME_MS);
      if (drained.inFlight > 0) notes.push(`${s.id}: ${drained.inFlight} round(s) still in flight after the drain`);
      const flight = cells.filter((c) => c.subject === s.id && c.zoom === LADDER_ZOOM);
      fs.writeFileSync(path.join(out, `flip-${s.id}.html`), flipHtml(`${label} / ${s.id}`, flight));
    }
    await page.close();
  } finally {
    await browser.close();
    stopDevServer(server, 'atgm-captures');
  }
  notes.push(`machine at end: ${load()}`);

  // The floor (Task 7): a reading below it fails the run, the blast harness's
  // rule. Judged on the after-set only -- the before-set has no such layer.
  if (label === 'after') {
    for (const t of toggles) {
      const reasons = missilesFloorReasons(t, missilesFloorFor(t.subject));
      t.note = reasons.length === 0 ? 'clears the floor' : `BELOW THE FLOOR: ${reasons.join('; ')}`;
      if (reasons.length > 0) {
        console.error(`${t.subject}: missiles toggle ${t.diffPixels} px / ${t.meanAbsChannelDelta.toFixed(4)} -- ${reasons.join('; ')}`);
        process.exitCode = 1;
      }
    }
  }

  const perSubject = wanted.map((s) => {
    const f = fired[s.id];
    const ladder = cells.filter((c) => c.subject === s.id && c.zoom === LADDER_ZOOM);
    const later = (windowFires[s.id] ?? []).map((e) => `${e.weaponId}@${e.tick}`).join(', ');
    const land = ladder.findIndex((c, i) => i > 0 && c.inFlight === 0 && ladder[i - 1].inFlight >= 1);
    const landed = land < 0 ? 'no landing rung' :
      `lands by ${ladder[land].tMs} ms (flash ${ladder[land].flash.toFixed(2)}, trail ${ladder[land].trail} puffs)`;
    const at2000 = ladder.find((c) => c.tMs === 2000);
    return `${s.id}: ${ladder.length} frames, fire ${f ? `${f.weaponId} at tick ${f.tick}` : 'NONE'}, ` +
      `${ladder.filter((c) => c.inFlight >= 1).length} rungs with inFlight >= 1; ${landed}; ` +
      `trail at 2000 ms ${at2000 ? at2000.trail : '-'} puffs; fires later in the window: ${later || 'none'}`;
  });
  const md = [
    atgmSheetIndex(label, env, cells),
    `## Summary`,
    ``,
    ...perSubject.map((l) => `- ${l}`),
    ``,
    `## Toggle A/B (\`missiles\`, rung ${TOGGLE_RUNG_MS} ms)`,
    ``,
    `| subject | available | diff px | mean abs channel delta | note |`,
    `|---|---|---|---|---|`,
    ...toggles.map((t) => `| ${t.subject} | ${t.available ? 'yes' : 'no'} | ${t.diffPixels} | ${t.meanAbsChannelDelta.toFixed(4)} | ${t.note.replace(/\|/g, '/')} |`),
    ``,
    `## Notes`,
    ``,
    `- port ${port}, \`?sandbox=beit_sahwan_outskirts&renderer=three\`, frame loop frozen, lockstep ${TICK_MS} ms ticks / ${FRAME_MS} ms frames, crop ${CROP.width}x${CROP.height} lifted ${CROP_LIFT_PX} px; no frame-cost numbers are taken`,
    ...notes.map((n) => `- ${n}`),
    ``,
  ].join('\n');
  fs.writeFileSync(path.join(out, 'sheet.md'), md);
  fs.writeFileSync(
    path.join(out, 'sheet.json'),
    JSON.stringify({ label, env, port, subjects: wanted, fired, windowFires, cells, toggles, floors: ATGM_MISSILES_FLOORS, notes }, null, 2) + '\n'
  );
  console.log(perSubject.join('\n'));
  console.log(`sheet at ${path.join(out, 'sheet.md')}`);
}

// Only when run as a script: the spec imports the pure half without booting a browser.
const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().then(
    () => process.exit(process.exitCode ?? 0),
    (err: unknown) => {
      console.error(err);
      process.exit(1);
    }
  );
}
