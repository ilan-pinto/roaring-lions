/**
 * `pnpm e6:capture`: the witness for the drone swarm's instanced draw and the laser beam's VFX
 * (E6 chunk D, GH-274, spec `_coord/e6-art/spec.md` section 8).
 *
 *   pnpm e6:capture -- --label=run1 --out=<parent> [--shots=<dir>] [--only=<ids>] [--toggles-only]
 *                      [--calibrate] [--port=<n>] [--gpu=metal|swiftshader]
 *
 * Each run writes to a FRESH `<out>/<label>` (refused when it already holds anything). A Metal request whose
 * renderer string is not Metal fails the run; a SwiftShader run is stamped as not comparable with the floors.
 *
 * No gated golden scenario holds a swarm or a beam, and `combat` is report-only for being unstable,
 * so, as with the blast (R-L), a dedicated harness is the only instrument.
 *
 * ## A retarget of `blast-captures.ts` and `atgm-captures.ts`, not a new protocol
 *
 * Inherited unchanged, each one paid for once already:
 *
 * 1. **The frame loop is FROZEN** (`FREEZE_FRAME_LOOP_SCRIPT`) after a steady-loop settle
 *    (`settleScript`, its line printed into the sheet), and every frame is pumped by hand. The settle's
 *    refusal (`unsteadySettleRefusal`) is not asked: it refuses only a `step(1)` subject, and every subject
 *    here is hand-ticked, so the call could never fire.
 * 2. **Subjects are SPAWNED, never found**, on the open northern band (rows 0-7) of
 *    `beit_sahwan_outskirts`. Everything the sandbox placed is taken off the field first, so no
 *    unit of the sandbox's own can shoot a swarm, lase one, or lift fog over one.
 * 3. **The sim is driven in LOCKSTEP by hand** (`atgm-captures.ts`): one `sim.tick()`,
 *    `renderer.snapshot()`, `renderer.onEvents(events)`, then 50 ms of pumped frames, per tick. Never
 *    through `__lions.step`, whose closing `frame(1, lastFrameMs)` ages every effect by whatever the
 *    freeze latched. Every dwell, strike, lockout and tumble here therefore lands on its tick.
 * 4. **The toggle A/B** (R-M): hide a named draw layer, repaint at ZERO elapsed presentation time,
 *    photograph, compare; with a repaint control first. A zero must FAIL a floor check.
 *
 * ## What is new here
 *
 * - **The first real compile of three shaders.** The rotor-disc `ShaderMaterial` (`swarm-batch.ts`),
 *   the beam ribbon shader (`beam-batch.ts`) and the heat-shimmer block spliced into the fog pass
 *   had never run on a GPU. The page's console is watched for the whole run: any `console.error`,
 *   page error, or message naming a shader / program / compile / link FAILS the run, and every
 *   material is asked of the GL context itself (`getProgramParameter(LINK_STATUS)`), so a program
 *   that logged nothing and did not link is still red. The GPU renderer string is printed.
 * - **Negative controls** (S5, S6, S8): the toggle must move the frame by EXACTLY 0 px / 0.0000, and
 *   each is paired with a `floor` key read in the same run, so a zero cannot come from a toggle that
 *   never works.
 * - **Readbacks, not recomputations**: `__lions.swarmDrawn(id)` against `sim.swarmMembers(id)` at
 *   every frame (S2), and the beam end against the member that tumbles (S4).
 *
 * ## What the first runs found (2026-10-25, ANGLE/Metal, Apple M3 Pro)
 *
 * - **Every shader compiled on the first run**: the rotor-disc material, the beam ribbon shader and
 *   the fog pass with its shimmer block each hold a linked program, 66 programs in all and none failed,
 *   and the console carried no error, warning or page error. No defect of chunks B or C turned up.
 * - **The falsification record is `E6_FALSIFICATIONS` in `e6-floors.ts`** (eight one-line mutations of the
 *   render code, each run, red, and reverted), and it prints into every sheet. Three limits of the table
 *   were measured and are worth keeping beside it:
 *   1. `S8/missiles` reads 0 px / 0.0000 on a build whose dive IS routed through `missile`, at +50, +100 and
 *      +150 ms, with a round live in `missileFx`: the round is a few pixels and the A/B cannot see it. The
 *      spec's reading is kept REPORT-ONLY (kind `info`, printed, never judged), and the witnesses are `S8.diving` and `S8/bloom@50ms` (the routed shot throws
 *      the `fire_heat` muzzle and its bloom: 9860 px / 4.4517 against exactly 0).
 *   2. The `locked` half of the beam's forced shutdown is NOT witnessed here: `const snapped = input.lockout;`
 *      (dropping `input.locked`) leaves S5 green, because during a lockout the sim already reports target -1
 *      and the `lockout` event snaps the beam. `locked` matters only when `onBeam` swallowed the event under
 *      `setQuiet`; `beam-look.test.ts` ('locked: nothing in the world') is its guard.
 *   3. A reading depends on the sim's absolute tick (the swarm bob and the beam shimmer run on the sim
 *      clock), so a `--only` run reads a few hundred pixels off the full run's: `S8/swarm` 2051-2275 px
 *      against the calibrated 2565. Floors are a third of the full run, and the `--only` readings clear them.
 *
 * ## Layout (y = 3, x apart, so no subject stands in another's crop and no wreck is reused)
 *
 *   beam_sequence  carrier (4,3)  swarm (11,3)      S2 S3 S4 S5 S7 (one 17 s run, lockout and recovery)
 *   s1_hover       swarm (22,3)   spotter (25,3)    S1
 *   beam_root_*    carrier (20,4) swarm 3.5 tiles   the beam's root against its own turret, 4 bearings
 *   s6_smoke       carrier (28,3) swarm (35,3)      S6, an apc_eitan lays the screen between
 *   s8_dive        eitan (40,3)   swarm (41.2,3)    S8
 *   scale          carrier (14,3) eitan (17,3)      the carrier beside the Eitan
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { musicOffInitScript } from '../ui-review/music-off';
import { gpuLaunchArgs, resolveGpuBackend, type GpuBackend } from '../ui-review/gpu';
import { claimPort, resolvePort } from '../ui-review/port';
import {
  E6_CALIBRATION,
  E6_FALSIFICATIONS,
  E6_FLOORS,
  E6_KEYS,
  E6_KEY_LIST,
  checkVerdict,
  floorLine,
  type FloorKey,
  type Reading,
  type Verdict,
} from './e6-floors';
import { parseSettleResult, settleLine, settleScript } from './blast-captures';

// ---------------------------------------------------------------------------
// The pure half. Imported by `e6-captures.test.ts`, which must not pull playwright into
// `pnpm test`, so everything browser-shaped is behind a dynamic import inside `main()`.
// ---------------------------------------------------------------------------

/** One lockstep tick, in ms, and the three frames that pump it (16 + 16 + 18). */
export const TICK_MS = 50;
export const TICK_FRAMES: readonly number[] = [16, 16, 18];

export type E6Mode = 'hover' | 'beam_sequence' | 'smoke' | 'dive' | 'scale' | 'root';

export interface E6Subject {
  readonly id: string;
  readonly mode: E6Mode;
  /** Which spec 8 subjects (S1..S8) this run witnesses. */
  readonly covers: readonly string[];
  /** The tile the camera is centred on. */
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
  readonly why: string;
  /** `root`: the swarm's offset from the carrier, in tiles. */
  readonly bearing?: readonly [number, number];
  readonly bearingName?: string;
}

/** The carrier-to-swarm gap of every beam subject but the root ones. In range (9) and in the open. */
export const BEAM_GAP_TILES = 7;
/** The root subjects stand closer: only the muzzle matters, and a short beam keeps the crop tight. */
export const ROOT_GAP_TILES = 3.5;

export const E6_SUBJECTS: readonly E6Subject[] = [
  // First, on clean sand: the sequence's wrecks lie on the ground for the rest of the run.
  { id: 'scale', mode: 'scale', covers: [], x: 15.5, y: 3, zoom: 2.5, why: 'the carrier beside the Eitan, to judge size, turret and radiator module' },
  {
    id: 'beam_sequence', mode: 'beam_sequence', covers: ['S2', 'S3', 'S4', 'S5', 'S7'], x: 7.5, y: 3, zoom: 1.5,
    why:
      'one carrier lases one full swarm from acquisition through eight strikes, the lockout and the recovery. ' +
      'S2 reads the draw against the sim at every frame, S3 the mid-dwell, S4 the first strike (pulse and the ' +
      'tumbling member), S7 the wrecks two seconds after the third, S5 the lockout',
  },
  {
    id: 's1_hover', mode: 'hover', covers: ['S1'], x: 22, y: 3, zoom: 2,
    why: 'a full swarm of twelve hovering, tick-pinned, with a side-0 spotter that lifts the fog and nothing in range',
  },
  { id: 'beam_root_e', mode: 'root', covers: [], x: 20, y: 4, zoom: 2.5, bearing: [1, 0], bearingName: 'east', why: 'the beam root against its own turret, target to the east' },
  { id: 'beam_root_s', mode: 'root', covers: [], x: 20, y: 4, zoom: 2.5, bearing: [0, 1], bearingName: 'south', why: 'the beam root against its own turret, target to the south' },
  { id: 'beam_root_w', mode: 'root', covers: [], x: 20, y: 4, zoom: 2.5, bearing: [-1, 0], bearingName: 'west', why: 'the beam root against its own turret, target to the west' },
  { id: 'beam_root_n', mode: 'root', covers: [], x: 20, y: 4, zoom: 2.5, bearing: [0, -1], bearingName: 'north', why: 'the beam root against its own turret, target to the north' },
  {
    id: 's6_smoke', mode: 'smoke', covers: ['S6'], x: 31.5, y: 3, zoom: 1.5,
    why: 'an apc_eitan lays a screen across the line while the carrier dwells; the sim breaks the beam, the draw must follow',
  },
  {
    id: 's8_dive', mode: 'dive', covers: ['S8'], x: 40.6, y: 3, zoom: 2.5,
    why: 'a swarm member dives onto a parked, disarmed apc_eitan: no missile body or trail, and the diver is drawn',
  },
];

/** What the console watcher does with one message. */
export type ConsoleClass = 'fatal' | 'note' | 'ignore';

/** The shader / program / compile / link vocabulary. Matches three's own `THREE.WebGLProgram: Shader Error`, ANGLE's
 *  `GL_` link logs and Chrome's `WebGL: INVALID_OPERATION: useProgram`. */
const SHADER_WORDS = /shader|glsl|webglprogram|program\b|compile|link(?:ed|ing|age)?\b|uniform|varying|GL_INVALID|INVALID_OPERATION/i;
/** SwiftShader's own readback note is not a defect of ours (`routes-check`'s exemption). */
const EXEMPT = /GPU stall due to ReadPixels/i;
/** The harness's own staging spawns a type no roster fielded, and the app's 1 Hz sweep says so. Not a defect. */
const STAGING = /reached the field with no mesh queued/i;

/**
 * Classifies one console message. `error` and a page error are FATAL; so is any message of any
 * level that names a shader, program, compile or link problem; a `warning` or the staging line
 * is a NOTE (recorded in the sheet); `log`/`info`/`debug` that name nothing are ignored.
 */
export function classifyConsole(type: string, text: string): ConsoleClass {
  if (EXEMPT.test(text)) return 'note';
  if (type === 'error' || type === 'pageerror') return 'fatal';
  if (SHADER_WORDS.test(text) && !STAGING.test(text)) return type === 'log' || type === 'info' || type === 'debug' ? 'ignore' : 'fatal';
  if (STAGING.test(text) || type === 'warning' || type === 'warn') return 'note';
  return 'ignore';
}

export interface DrawSample {
  readonly tick: number;
  readonly members: number;
  readonly drawn: number;
}

export interface ReadbackVerdict {
  readonly ok: boolean;
  readonly frames: number;
  readonly mismatches: readonly DrawSample[];
  readonly distinctMembers: readonly number[];
  readonly reasons: readonly string[];
}

/**
 * S2: the batch's own drawn count equals the sim's live members at EVERY sampled frame, and the
 * run actually thinned the swarm (a readback over a swarm that never changed would pass for any
 * draw, including one that ignores `swarmMembers`). `minDistinct` distinct member counts are
 * required, the first of them the full `count`.
 */
export function readbackVerdict(samples: readonly DrawSample[], count: number, minDistinct: number): ReadbackVerdict {
  const mismatches = samples.filter((s) => s.drawn !== s.members);
  const distinct = [...new Set(samples.map((s) => s.members))];
  const reasons: string[] = [];
  if (samples.length === 0) reasons.push('no frames sampled');
  if (mismatches.length > 0) {
    const m = mismatches[0];
    reasons.push(`${mismatches.length} of ${samples.length} frames drew a count the sim does not have (first: tick ${m.tick}, drawn ${m.drawn}, sim ${m.members})`);
  }
  if (samples.length > 0 && samples[0].members !== count) reasons.push(`the first frame has ${samples[0].members} members, not the full ${count}`);
  if (distinct.length < minDistinct) reasons.push(`the swarm showed ${distinct.length} distinct counts (${distinct.join(', ')}), need ${minDistinct}: a readback over a swarm that never thinned proves nothing`);
  return { ok: reasons.length === 0, frames: samples.length, mismatches, distinctMembers: distinct, reasons };
}

/** The tolerance for "the beam ends on the member that falls": tiles in the ground plane, and in height. */
export const COINCIDE_XZ_TILES = 0.2;
export const COINCIDE_Y_TILES = 0.3;

export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** S4: the last beam end before a strike and the member that then tumbles are the same drone. */
export function coincide(beamEnd: Point3, fall: Point3): { ok: boolean; xz: number; y: number } {
  const xz = Math.hypot(beamEnd.x - fall.x, beamEnd.z - fall.z);
  const y = Math.abs(beamEnd.y - fall.y);
  return { ok: xz <= COINCIDE_XZ_TILES && y <= COINCIDE_Y_TILES, xz, y };
}

/** Ports that are somebody else's: a human's own dev server and the lead's everyday `ui:routes` server. */
export const FORBIDDEN_PORTS: readonly number[] = [5173, 5177];

/** Refuses a forbidden port. Asked BEFORE `claimPort`, which prints its claim as it goes. */
export function portRefusal(port: number): string | null {
  return FORBIDDEN_PORTS.includes(port) ? `refusing port ${port}: it is somebody else's server` : null;
}

/** What `window.__e6.programs()` returns. */
export interface ProgramReport {
  readonly named: Readonly<Record<string, { present: boolean; compiled?: boolean; linked?: boolean; log?: string }>>;
  readonly all: { readonly count: number; readonly failed: readonly string[] };
}

/**
 * The shader judgement: every failure of the GL-level check. A report with no programs at all is a
 * FAILURE (a context that compiled nothing links nothing, and "no failed program" over an empty list is
 * a green nobody earned), and so is a lost WebGL context (every program of a lost context reads as
 * unlinked or absent, or worse, as the last good frame).
 */
export function shaderVerdict(pr: ProgramReport | null, opts: { full: boolean; contextLost: boolean }): string[] {
  const out: string[] = [];
  if (opts.contextLost) out.push('the WebGL context was lost during the run');
  if (pr === null) {
    out.push('the shader link check never ran');
    return out;
  }
  if (pr.all.count === 0) out.push('the renderer reports 0 programs: nothing compiled, so nothing was checked');
  for (const f of pr.all.failed) out.push(`program failed to link: ${f}`);
  for (const [k, v] of Object.entries(pr.named)) {
    if (v.compiled === true && v.linked !== true) out.push(`${k}: program did not link: ${v.log ?? ''}`);
    if (opts.full && (v.present !== true || v.compiled !== true)) out.push(`${k}: no program was ever compiled for it in a full run`);
  }
  return out;
}

/**
 * The floors were calibrated on ANGLE/Metal. A run that asked for Metal and got something else (a driver
 * fallback to software, a different adapter) is not comparable and FAILS; a deliberate SwiftShader run is
 * stamped so its sheet cannot be read as a Metal one.
 */
export function backendVerdict(backend: GpuBackend, gl: string): { failure: string | null; stamp: string | null } {
  if (backend === 'metal') {
    return /Metal/i.test(gl)
      ? { failure: null, stamp: null }
      : { failure: `--gpu=metal resolved, but the renderer string is "${gl}", not Metal: these floors were calibrated on Metal`, stamp: null };
  }
  return { failure: null, stamp: 'floors calibrated on Metal (ANGLE Metal, Apple M3 Pro); this run is SwiftShader, so its readings are not comparable with them' };
}

/** The slice of `process` the signal handler needs, so a spec can drive it with an emitter. */
export interface SignalHost {
  once(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  removeListener(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
}

/**
 * Stops the dev server on SIGINT and SIGTERM, then exits 130: a Ctrl-C mid-run must not leave vite's
 * process group listening on the harness's port. Returns the function that takes the handlers off again.
 */
export function installSignalStop(stop: () => void, host: SignalHost, exit: (code: number) => void): () => void {
  const handler = (): void => {
    stop();
    exit(130);
  };
  host.once('SIGINT', handler);
  host.once('SIGTERM', handler);
  return () => {
    host.removeListener('SIGINT', handler);
    host.removeListener('SIGTERM', handler);
  };
}

/**
 * Launch inside the guard: a launch that fails still stops the server, and a body that throws still closes
 * the browser, then stops the server. (The browser used to launch BEFORE the `try`, so a failed launch
 * leaked vite's process group.)
 */
export async function guarded<B extends { close(): Promise<void> }, T>(
  launch: () => Promise<B>,
  stop: () => void,
  body: (browser: B) => Promise<T>
): Promise<T> {
  let browser: B | undefined;
  try {
    browser = await launch();
    return await body(browser);
  } finally {
    try {
      await browser?.close();
    } finally {
      stop();
    }
  }
}

/** A run's output directory: `<root>/<label>`, refused if it already holds anything, so frames of two runs never mix. */
export function freshRunDir(root: string, label: string): string {
  const dir = path.join(root, label);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
    throw new Error(`${dir} is not empty: every run writes to a fresh directory, so pick another --label (or --out)`);
  }
  return dir;
}

/** The sheet's verdict word for a check row: a report-only row reads INFO and is never counted as a pass. */
export function checkLabel(k: { ok: boolean; info?: boolean }): 'INFO' | 'PASS' | 'FAIL' {
  return k.info === true ? 'INFO' : k.ok ? 'PASS' : 'FAIL';
}

/** A single-sentence summary of a check for the sheet. */
export interface CheckRow {
  readonly id: string;
  readonly subject: string;
  readonly ok: boolean;
  readonly detail: string;
  /** Report-only: printed as INFO, never counted as a pass. */
  readonly info?: boolean;
}

export interface ToggleRow {
  readonly key: string;
  readonly subject: string;
  readonly layer: string;
  readonly rung: string;
  readonly zoom: number;
  readonly reading: Reading;
  /** The repaint control's own movement: a scene that never holds still contaminates a floor. */
  readonly drift: Reading;
  /** What the hide call resolved (`setDebugLayerVisible`'s return): 0 means nothing was hidden. */
  readonly hidden: number;
  readonly verdict: Verdict | null;
  readonly note: string;
}

export interface Cell {
  readonly subject: string;
  readonly tMs: number;
  readonly tick: number;
  readonly zoom: number;
  readonly rung: string;
  readonly file: string;
}

/** One self-contained page that plays frames at their REAL timestamps, holds a second, and loops. */
export function e6FlipHtml(label: string, frames: readonly { file: string; tMs: number }[]): string {
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const files = JSON.stringify(frames.map((f) => f.file)).replace(/</g, '\\u003c');
  const times = JSON.stringify(frames.map((f) => f.tMs));
  const first = frames.length > 0 ? esc(frames[0].file) : '';
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>E6 flip -- ${esc(label)}</title>
<style>body{margin:16px;font:14px sans-serif}img{display:block;image-rendering:pixelated;max-width:100%}</style>
</head><body>
<h1>E6 flip -- ${esc(label)}</h1>
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

/**
 * The in-page half, as a STRING (never a function): tsx runs this file through esbuild with
 * `keepNames`, which wraps a named inner function in a `__name(...)` call that does not exist in
 * the page. It reads `__lions` only through what the app exposes and the renderer's public members,
 * plus three PRIVATE fields it reads and never writes (`swarmBatches`, `vehicleMeshEntities`,
 * `fogPass`/`beamBatch`/`renderer` for the shader link check).
 */
export const PAGE_API = `(() => {
  const L = window.__lions, r = L.renderer, sim = L.sim;
  const FRAMES = ${JSON.stringify(TICK_FRAMES)}, FIXED = 65536;
  const KEEP = { beam: 1, fire: 1, destroyed: 1, smokeLaid: 1, impact: 1 };
  const api = { alpha: 1, lost: false };
  // A lost context reads as unlinked programs or, worse, as the last good frame: listen for it.
  const cv0 = document.querySelector('canvas');
  if (cv0) cv0.addEventListener('webglcontextlost', () => { api.lost = true; });
  api.clear = () => {
    let n = 0;
    for (let e = 0; e < sim.entityCount; e++) if (sim.state.alive[e] === 1) { sim.removeFromPlay(e); n++; }
    return n;
  };
  api.spawn = (id, side, x, y) => {
    const i = sim.unitTypes.findIndex((t) => t.id === id);
    if (i < 0) throw new Error('no unit type ' + id + ' in this build');
    return sim.spawn(i, side, Math.round(x * FIXED), Math.round(y * FIXED));
  };
  api.disarm = (id) => { sim.debugDisableFirepower(id); };
  api.smoke = (id, x, y) => { sim.queueCommand({ kind: 'smoke', ids: [id], x: Math.round(x * FIXED), y: Math.round(y * FIXED) }); };
  api.tick = (n) => {
    const seen = [];
    for (let k = 0; k < n; k++) {
      const events = sim.tick();
      r.snapshot();
      r.onEvents(events);
      for (const e of events) {
        if (KEEP[e.kind] === 1) seen.push({ kind: e.kind, phase: e.phase, shooter: e.shooter, target: e.target, entity: e.entity, by: e.by, weaponId: e.weaponId, tick: e.tick });
      }
      // The frames of one tick carry alpha as the app's own loop does: the fraction of the tick elapsed.
      let acc = 0;
      for (const f of FRAMES) { acc += f; r.frame(acc / ${TICK_MS}, f); }
    }
    return { tick: sim.tickCount, events: seen };
  };
  // A repaint at ZERO elapsed presentation time (no clock moves) at the current alpha, and a layer
  // toggle that repaints the same way: REPAINT_SCRIPT and layerToggleScript with an alpha.
  api.repaint = () => { r.frame(api.alpha, 0); return sim.tickCount; };
  api.layer = (name, visible) => { const n = r.setDebugLayerVisible(name, visible); r.frame(api.alpha, 0); return n; };
  api.read = (carrier, swarm) => {
    const out = { tick: sim.tickCount, missiles: r.missileFx ? r.missileFx.missiles.length : -1 };
    if (swarm >= 0) {
      out.alive = sim.state.alive[swarm] === 1;
      out.members = sim.swarmMembers(swarm);
      out.drawn = L.swarmDrawn(swarm);
      const b = r.swarmBatches.get('drone_swarm');
      if (b) {
        out.dives = b.dives.length;
        out.falls = b.falls.length;
        out.wrecks = b.wrecks ? b.wrecks.count : -1;
        const f = b.falls.length ? b.falls[b.falls.length - 1] : null;
        out.fall = f ? { x: f.x, y: f.groundY + f.h0, z: f.z, age: f.age } : null;
      }
    }
    if (carrier >= 0) {
      out.beam = sim.beamState(carrier, 0);
      out.beamDrawn = L.beamDrawn(carrier, 0);
      out.sites = L.beamShimmerSites();
    }
    return out;
  };
  api.meshReady = (id) => r.vehicleMeshEntities.has(id);
  api.swarmReady = () => r.swarmBatches.has('drone_swarm');
  api.frameOn = (x, y, zoom) => {
    const c = r.camera;
    c.x = x; c.y = y; c.zoom = zoom;
    r.frame(api.alpha, 0);
    const s = r.worldToScreen(x, y);
    return { sx: s.x, sy: s.y, tick: sim.tickCount };
  };
  api.project = (x, y, z) => {
    const cam = r.viewCamera;
    const v = new cam.position.constructor(x, y, z).project(cam);
    const cv = document.querySelector('canvas');
    return { x: (v.x * 0.5 + 0.5) * cv.clientWidth, y: (1 - (v.y * 0.5 + 0.5)) * cv.clientHeight };
  };
  api.programs = () => {
    const rr = r.renderer, gl = rr.getContext();
    const b = r.swarmBatches.get('drone_swarm');
    const mats = {
      fog: r.fogPass ? r.fogPass.material : null,
      beam: r.beamBatch ? r.beamBatch.mesh.material : null,
      rotors: b ? b.rotors.material : null,
      bodies: b ? b.bodies.material : null,
      wrecks: b && b.wrecks ? b.wrecks.material : null,
    };
    const out = { named: {}, all: { count: 0, failed: [] } };
    for (const k of Object.keys(mats)) {
      const m = mats[k];
      if (!m) { out.named[k] = { present: false }; continue; }
      const prog = rr.properties.get(m).currentProgram;
      if (!prog) { out.named[k] = { present: true, compiled: false }; continue; }
      const linked = !!gl.getProgramParameter(prog.program, gl.LINK_STATUS);
      out.named[k] = { present: true, compiled: true, linked, name: prog.name, log: linked ? '' : String(gl.getProgramInfoLog(prog.program) || '').slice(0, 400) };
    }
    const all = rr.info.programs || [];
    out.all.count = all.length;
    for (const p of all) {
      if (!gl.getProgramParameter(p.program, gl.LINK_STATUS)) out.all.failed.push(String(p.name) + ': ' + String(gl.getProgramInfoLog(p.program) || '').slice(0, 200));
    }
    return out;
  };
  api.gl = () => {
    const gl = r.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), version: gl.getParameter(gl.VERSION), lost: gl.isContextLost() || api.lost };
  };
  return api;
})()`;

// ---------------------------------------------------------------------------
// The browser half. Nothing below is imported by the spec.
// ---------------------------------------------------------------------------

const PORT = 5179;
const VIEWPORT = { width: 1400, height: 900 } as const;
const SETTLE_VIEWPORT = { width: 320, height: 200 } as const;
const CROP = { width: 600, height: 400 } as const;
const HERO = { width: 960, height: 600 } as const;
const CROP_LIFT_PX = 50;
const MAP = 'beit_sahwan_outskirts';
const STEP_TIMEOUT_MS = 120_000;
const MESH_WAIT_MS = 300_000;
const STILL_ATTEMPTS = 8;
const STILL_WAIT_MS = 250;
const SETTLE_TIMEOUT_MS = 30_000;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

interface TickEvent {
  kind: string;
  phase?: string;
  shooter?: number;
  target?: number;
  entity?: number;
  by?: number;
  weaponId?: string;
  tick?: number;
}
interface TickResult {
  tick: number;
  events: TickEvent[];
}
interface Beam {
  target: number;
  dwell: number;
  heat: number;
  locked: boolean;
  lockUntil: number;
}
interface BeamDrawn {
  origin: [number, number, number];
  end: [number, number, number];
  ribbon: boolean;
  corePx: number;
  coreAlpha: number;
  sheathPx: number;
  sheathAlpha: number;
  targetGlowTiles: number;
  lensGlowAlpha: number;
  shimmerAmp: number;
  focus: number;
  pulse: number;
}
interface ReadResult {
  tick: number;
  missiles: number;
  alive?: boolean;
  members?: number;
  drawn?: number;
  dives?: number;
  falls?: number;
  wrecks?: number;
  fall?: { x: number; y: number; z: number; age: number } | null;
  beam?: Beam;
  beamDrawn?: BeamDrawn | null;
  sites?: number;
}

function arg(name: string, fallback = ''): string {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
function has(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}
function load(): string {
  const [a, b, c] = os.loadavg();
  return `load ${a.toFixed(2)}/${b.toFixed(2)}/${c.toFixed(2)} on ${os.cpus().length} cpus`;
}
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
function pad(n: number): string {
  return String(n).padStart(5, '0');
}
function mdSafe(s: string): string {
  return s.replace(/\|/g, '/');
}

type Page = import('playwright').Page;

interface Ctx {
  page: Page;
  out: string;
  shots: string;
  togglesOnly: boolean;
  calibrate: boolean;
  computeDiff: (a: string, b: string, o?: { outDir?: string; threshold?: number; diffFileName?: string }) => { diffPixels: number; meanAbsChannelDelta: number };
  cells: Cell[];
  toggles: ToggleRow[];
  checks: CheckRow[];
  notes: string[];
  samples: Record<string, unknown[]>;
  /** Subjects that could not be driven to their event: the run fails at the end, the sheet is still written. */
  skipped: string[];
  heroes: string[];
}

async function ev<T>(page: Page, expr: string): Promise<T> {
  return (await page.evaluate(expr)) as T;
}
const tick = (page: Page, n = 1): Promise<TickResult> => ev<TickResult>(page, `window.__e6.tick(${n})`);
const repaint = (page: Page): Promise<number> => ev<number>(page, 'window.__e6.repaint()');
const layer = (page: Page, name: string, visible: boolean): Promise<number> => ev<number>(page, `window.__e6.layer(${JSON.stringify(name)}, ${visible})`);
const setAlpha = (page: Page, alpha: number): Promise<number> => ev<number>(page, `(window.__e6.alpha = ${alpha}, window.__e6.repaint())`);
const read = (page: Page, carrier: number, swarm: number): Promise<ReadResult> => ev<ReadResult>(page, `window.__e6.read(${carrier}, ${swarm})`);
const spawn = (page: Page, id: string, side: number, x: number, y: number): Promise<number> =>
  ev<number>(page, `window.__e6.spawn(${JSON.stringify(id)}, ${side}, ${x}, ${y})`);

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Centres the camera on a tile at `zoom`, repaints at zero elapsed time, and returns the crop around it. */
async function frameCrop(page: Page, x: number, y: number, zoom: number, size: { width: number; height: number } = CROP): Promise<Rect> {
  const at = await ev<{ sx: number; sy: number }>(page, `window.__e6.frameOn(${x}, ${y}, ${zoom})`);
  return {
    x: Math.min(Math.max(0, at.sx - size.width / 2), VIEWPORT.width - size.width),
    y: Math.min(Math.max(0, at.sy - size.height / 2 - CROP_LIFT_PX), VIEWPORT.height - size.height),
    w: size.width,
    h: size.height,
  };
}

const clipOf = (r: Rect) => ({ x: r.x, y: r.y, width: r.w, height: r.h });

/** One ladder photograph: the subject's crop at its zoom, no toggle. */
async function ladder(ctx: Ctx, s: E6Subject, tMs: number, rung: string, focus?: { x: number; y: number }): Promise<void> {
  if (ctx.togglesOnly) return;
  const f = focus ?? { x: s.x, y: s.y };
  const rect = await frameCrop(ctx.page, f.x, f.y, s.zoom);
  const file = `${s.id}-${pad(tMs)}ms-${rung}.png`;
  await ctx.page.screenshot({ path: path.join(ctx.out, file), clip: clipOf(rect) });
  const t = await ev<number>(ctx.page, 'window.__lions.sim.tickCount');
  ctx.cells.push({ subject: s.id, tMs, tick: t, zoom: s.zoom, rung, file });
}

/** A hero still, larger than a ladder crop, for the lead's screenshots directory. */
async function hero(ctx: Ctx, name: string, x: number, y: number, zoom: number): Promise<void> {
  if (ctx.togglesOnly) return;
  const rect = await frameCrop(ctx.page, x, y, zoom, HERO);
  fs.mkdirSync(path.dirname(path.join(ctx.shots, `${name}.png`)), { recursive: true });
  await ctx.page.screenshot({ path: path.join(ctx.shots, `${name}.png`), clip: clipOf(rect) });
  ctx.heroes.push(`${name}.png`);
  console.log(`  hero ${name}.png (zoom ${zoom})`);
}

/**
 * The R-M toggle A/B: hide `layer`, repaint at zero elapsed time, photograph, compare. The reference
 * photograph is taken only once the scene holds STILL under a zero-time repaint (the last comparison
 * is the rung's CONTROL), and a drift that clears a floor by itself is refused as a measurement.
 */
async function toggle(
  ctx: Ctx,
  subject: string,
  key: FloorKey,
  focus: { x: number; y: number },
  zoom: number
): Promise<ToggleRow> {
  const spec = E6_KEYS[key];
  const rect = await frameCrop(ctx.page, focus.x, focus.y, zoom);
  const dir = path.join(ctx.out, 'toggles');
  fs.mkdirSync(dir, { recursive: true });
  const tag = key.replace(/[^A-Za-z0-9@]+/g, '_');
  const shown = path.join(dir, `${tag}-shown.png`);
  const control = path.join(dir, `${tag}-control.png`);
  const hidden = path.join(dir, `${tag}-hidden.png`);
  const clipArg = clipOf(rect);
  await repaint(ctx.page);
  await ctx.page.screenshot({ path: shown, clip: clipArg });
  let drift: Reading = { diffPixels: 0, meanAbsChannelDelta: 0 };
  for (let attempt = 1; attempt <= STILL_ATTEMPTS; attempt++) {
    await ctx.page.waitForTimeout(STILL_WAIT_MS);
    await repaint(ctx.page);
    await ctx.page.screenshot({ path: control, clip: clipArg });
    drift = ctx.computeDiff(shown, control, { outDir: dir, diffFileName: `${tag}-control-diff.png` });
    if (drift.diffPixels === 0 && drift.meanAbsChannelDelta === 0) break;
    console.log(`  ${key}: repaint ${attempt} moved ${drift.diffPixels} px / ${drift.meanAbsChannelDelta.toFixed(4)}; waiting for a still scene`);
    fs.copyFileSync(control, shown);
  }
  const hiddenObjects = await layer(ctx.page, spec.layer, false);
  await ctx.page.screenshot({ path: hidden, clip: clipArg });
  await layer(ctx.page, spec.layer, true);
  const d = ctx.computeDiff(shown, hidden, { outDir: dir, diffFileName: `${tag}-diff.png` });
  const reading: Reading = { diffPixels: d.diffPixels, meanAbsChannelDelta: d.meanAbsChannelDelta };
  let verdict: Verdict | null = null;
  let note = '';
  if (!ctx.calibrate || spec.kind !== 'floor') verdict = checkVerdict(key, reading, E6_FLOORS, hiddenObjects);
  // A drift that would clear this key's floor by itself is not a measurement of the layer.
  if (spec.kind === 'floor' && verdict !== null && verdict.ok && (drift.diffPixels > 0 || drift.meanAbsChannelDelta > 0)) {
    const fl = E6_FLOORS[key];
    if (fl !== undefined && drift.diffPixels >= fl.minDiffPixels && drift.meanAbsChannelDelta >= fl.minMeanAbsChannelDelta) {
      verdict = { ok: false, key, reasons: [`repaint control moved ${drift.diffPixels} px / ${drift.meanAbsChannelDelta.toFixed(4)}, enough to clear this floor by itself`] };
      note = 'contaminated by drift';
    }
  }
  const row: ToggleRow = { key, subject, layer: spec.layer, rung: spec.rung, zoom, reading, drift, hidden: hiddenObjects, verdict, note };
  ctx.toggles.push(row);
  console.log(
    `  toggle ${key.padEnd(18)} ${String(reading.diffPixels).padStart(7)} px / ${reading.meanAbsChannelDelta.toFixed(4)}` +
      `  drift ${drift.diffPixels} px / ${drift.meanAbsChannelDelta.toFixed(4)}  ${verdict === null ? 'CALIBRATING' : verdict.ok ? 'PASS' : `FAIL (${verdict.reasons.join('; ')})`}`
  );
  return row;
}

function check(ctx: Ctx, id: string, subject: string, ok: boolean, detail: string): void {
  ctx.checks.push({ id, subject, ok, detail });
  console.log(`  check ${id}: ${ok ? 'PASS' : 'FAIL'} -- ${detail}`);
}

/** Ticks until `pred(read)` or `cap` ticks; returns the last read, or null at the cap. */
async function tickUntil(
  ctx: Ctx,
  carrier: number,
  swarm: number,
  cap: number,
  pred: (r: ReadResult, t: TickResult) => boolean,
  each?: (r: ReadResult, t: TickResult) => Promise<void>
): Promise<{ r: ReadResult; t: TickResult } | null> {
  for (let n = 0; n < cap; n++) {
    const t = await tick(ctx.page, 1);
    const r = await read(ctx.page, carrier, swarm);
    if (each !== undefined) await each(r, t);
    if (pred(r, t)) return { r, t };
  }
  return null;
}

// --- staging ----------------------------------------------------------------

/** Everything the sandbox placed leaves the field, so nothing of its own shoots, lases, or lifts fog. */
async function clearField(page: Page): Promise<void> {
  await ev(page, 'window.__e6.clear()');
  await tick(page, 2);
}

/**
 * Puts the camera on the subject BEFORE anything is spawned, in every mode. The frames a tick pumps
 * are painted wherever the camera happens to be, and two things read what they painted: the fog
 * (a hostile is drawn only once the shroud has been refreshed over its tile) and the shimmer feed
 * (a site off the frame is not fed). A `--toggles-only` run, which takes no ladder photographs, left
 * the camera on the previous subject, so its first two swarm frames read `drawn 0` and its shimmer
 * sites read 0 -- the full run read 12 and 1 -- and the same subject measured two different things.
 */
async function aim(ctx: Ctx, s: E6Subject): Promise<void> {
  await ev(ctx.page, `window.__e6.frameOn(${s.x}, ${s.y}, ${s.zoom})`);
}

/**
 * Both templates must be loaded before anything is photographed: the carrier's (a vehicle mesh) and the
 * swarm's (its instanced batch). Neither type is in the sandbox roster, so the app's own 1 Hz sweep
 * loads them once something of that type is alive; the sweep runs in `__lions.step` (not in a hand
 * tick), so the wait uses `step(20)`. The swarm decoy is a hostile 40 tiles from the carrier and out of
 * everyone's sight, and both leave the field afterwards.
 */
async function waitForMeshes(ctx: Ctx, types: readonly string[]): Promise<void> {
  const ids: number[] = [];
  const vehicleIds: number[] = [];
  let swarmWanted = false;
  const y = 6;
  for (const t of types) {
    if (t === 'drone_swarm') {
      swarmWanted = true;
      ids.push(await spawn(ctx.page, t, 1, 45, 7));
    } else {
      const id = await spawn(ctx.page, t, 0, 3 + vehicleIds.length * 4, y);
      vehicleIds.push(id);
      ids.push(id);
    }
  }
  const deadline = Date.now() + MESH_WAIT_MS;
  for (;;) {
    await ev(ctx.page, 'window.__lions.step(20)');
    const ready = await ev<boolean>(
      ctx.page,
      `(${JSON.stringify(vehicleIds)}.every((id) => window.__e6.meshReady(id))) && (${swarmWanted ? 'window.__e6.swarmReady()' : 'true'})`
    );
    if (ready) break;
    if (Date.now() > deadline) {
      ctx.notes.push(`meshes for ${types.join(', ')} never finished loading -- captured anyway`);
      break;
    }
    await ctx.page.waitForTimeout(400);
  }
  await clearField(ctx.page);
}

/** The vehicle clone of a freshly spawned vehicle attaches on the first frames after the spawn. */
async function waitForClone(ctx: Ctx, id: number, cap = 40): Promise<boolean> {
  for (let n = 0; n < cap; n++) {
    if (await ev<boolean>(ctx.page, `window.__e6.meshReady(${id})`)) return true;
    await tick(ctx.page, 1);
  }
  return false;
}

// --- the subjects -------------------------------------------------------------

async function runHover(ctx: Ctx, s: E6Subject): Promise<void> {
  await clearField(ctx.page);
  await aim(ctx, s);
  const spotter = await spawn(ctx.page, 'dozer_d9', 0, s.x + 3, s.y);
  const swarm = await spawn(ctx.page, 'drone_swarm', 1, s.x, s.y);
  await waitForClone(ctx, spotter);
  const first = await tickUntil(ctx, -1, swarm, 80, (r) => (r.drawn ?? 0) > 0);
  if (first === null) {
    ctx.skipped.push(s.id);
    ctx.notes.push(`${s.id}: the swarm was never drawn in 80 ticks (side 0 never identified it) -- subject skipped`);
    return;
  }
  // Tick-pinned: twenty ticks of hover after it first draws.
  await tick(ctx.page, 20);
  const r = await read(ctx.page, -1, swarm);
  check(ctx, 'S1.full', 's1', r.members === 12 && r.drawn === 12 && r.alive === true, `members ${r.members}, drawn ${r.drawn}, alive ${r.alive} at tick ${r.tick}`);
  await toggle(ctx, 'S1', 'S1/swarm', { x: s.x, y: s.y }, s.zoom);
  await hero(ctx, '01-full-swarm', s.x, s.y, 2.5);
  // The rotor discs spin on the sim clock: a second of every-tick stills at the top of the zoom clamp.
  for (let k = 0; k <= 10; k++) {
    if (k > 0) await tick(ctx.page, 1);
    await ladder(ctx, { ...s, zoom: 2.5 }, k * TICK_MS, 'hover');
  }
  await repaint(ctx.page);
}

interface SeqState {
  struck: number[];
  lockoutTick: number;
}

async function runBeamSequence(ctx: Ctx, s: E6Subject): Promise<void> {
  await clearField(ctx.page);
  await aim(ctx, s);
  const carrier = await spawn(ctx.page, 'aa_remetz', 0, 4, 3);
  const swarm = await spawn(ctx.page, 'drone_swarm', 1, 4 + BEAM_GAP_TILES, 3);
  await waitForClone(ctx, carrier);
  const samples: DrawSample[] = [];
  /** Frames between the spawn and the swarm's first draw: the fog has to see it first (not a draw fault). */
  let unseenFrames = 0;
  const named: { label: string; dtTicks: number; members: number; drawn: number }[] = [];
  const timeline: unknown[] = [];
  const st: SeqState = { struck: [], lockoutTick: -1 };
  let t0 = -1;
  let lastEnd: Point3 | null = null;
  let tickN = 0;
  /** Every tick of the sequence goes through here: the S2 sample, the flip ladder, the event bookkeeping. */
  const advance = async (): Promise<{ r: ReadResult; t: TickResult }> => {
    const t = await tick(ctx.page, 1);
    const r = await read(ctx.page, carrier, swarm);
    tickN++;
    if (r.members !== undefined && r.drawn !== undefined) {
      // A hostile is drawn once side 0 sees its tile; until then `drawn` is rightly 0, so the readback
      // starts at the first frame it is drawn and counts the frames before it separately.
      if (samples.length === 0 && r.drawn === 0) unseenFrames++;
      else samples.push({ tick: r.tick, members: r.members, drawn: r.drawn });
    }
    timeline.push({ tick: r.tick, members: r.members, drawn: r.drawn, dwell: r.beam?.dwell, locked: r.beam?.locked, ribbon: r.beamDrawn?.ribbon ?? null, falls: r.falls, wrecks: r.wrecks, sites: r.sites });
    for (const e of t.events) {
      if (e.kind === 'beam' && e.shooter === carrier && e.phase === 'struck') st.struck.push(r.tick);
      if (e.kind === 'beam' && e.shooter === carrier && e.phase === 'lockout') st.lockoutTick = r.tick;
    }
    if (t0 >= 0) {
      const since = r.tick - t0;
      // Every tick through the first two strikes (the pulse, the tumble), every second tick after.
      if (since <= 75 || since % 2 === 0) await ladder(ctx, s, since * TICK_MS, 'seq');
    }
    return { r, t };
  };
  const centre = { x: s.x, y: s.y };

  // 1. Acquisition: the carrier must see the swarm, identify it, and start to dwell.
  let cur: { r: ReadResult; t: TickResult } | null = null;
  for (let n = 0; n < 200; n++) {
    cur = await advance();
    if ((cur.r.beam?.dwell ?? 0) >= 1) break;
  }
  if (cur === null || (cur.r.beam?.dwell ?? 0) < 1) {
    ctx.skipped.push(s.id);
    ctx.notes.push(`${s.id}: the carrier never began to dwell in 200 ticks (members ${cur?.r.members}, drawn ${cur?.r.drawn}) -- subject skipped`);
    return;
  }
  t0 = cur.r.tick;
  ctx.notes.push(`${s.id}: dwell began on tick ${t0} (${t0 - (t0 - tickN)} ticks after the spawn)`);
  if (cur.r.beamDrawn?.end) lastEnd = { x: cur.r.beamDrawn.end[0], y: cur.r.beamDrawn.end[1], z: cur.r.beamDrawn.end[2] };
  const nameRung = (label: string): void => {
    const last = samples[samples.length - 1];
    named.push({ label, dtTicks: last.tick - t0, members: last.members, drawn: last.drawn });
  };

  // 2. S3: mid-dwell (dwell 22 of 30, focus 0.73). Six S2 rungs ride the same run.
  const s2Rungs = [10, 40, 80, 120, 160, 200];
  let s2Next = 0;
  const trackS2 = (r: ReadResult): void => {
    while (s2Next < s2Rungs.length && r.tick - t0 >= s2Rungs[s2Next]) {
      nameRung(`+${(s2Rungs[s2Next] * TICK_MS) / 1000} s`);
      s2Next++;
    }
  };
  while ((cur.r.beam?.dwell ?? 0) < 22 && st.struck.length === 0) {
    cur = await advance();
    trackS2(cur.r);
    if (cur.r.beamDrawn?.end) lastEnd = { x: cur.r.beamDrawn.end[0], y: cur.r.beamDrawn.end[1], z: cur.r.beamDrawn.end[2] };
  }
  await frameCrop(ctx.page, centre.x, centre.y, s.zoom);
  const mid = await read(ctx.page, carrier, swarm);
  check(
    ctx,
    'S3.drawn',
    's3',
    mid.beamDrawn?.ribbon === true && (mid.sites ?? 0) >= 1 && mid.beam?.dwell === 22,
    `dwell ${mid.beam?.dwell}, ribbon ${mid.beamDrawn?.ribbon}, shimmer sites ${mid.sites}, focus ${mid.beamDrawn?.focus.toFixed(3)}, corePx ${mid.beamDrawn?.corePx.toFixed(2)}, shimmerAmp ${mid.beamDrawn?.shimmerAmp.toFixed(3)}`
  );
  const s3 = await toggle(ctx, 'S3', 'S3/beam', centre, s.zoom);
  await toggle(ctx, 'S3', 'S3/beam-shimmer', centre, s.zoom);
  await hero(ctx, '03-beam-mid-dwell', centre.x, centre.y, 2);
  // The shimmer at the three zooms (recorded, not floor-voted: one framing votes, S3/beam-shimmer above).
  if (!ctx.togglesOnly) {
    const target = mid.beamDrawn ? { x: mid.beamDrawn.end[0], y: mid.beamDrawn.end[2] } : centre;
    for (const z of [0.35, 1, 2.5]) {
      const rect = await frameCrop(ctx.page, target.x, target.y, z);
      const dir = path.join(ctx.out, 'toggles');
      const a = path.join(dir, `shimmer-z${z}-shown.png`);
      const b = path.join(dir, `shimmer-z${z}-hidden.png`);
      await repaint(ctx.page);
      await ctx.page.screenshot({ path: a, clip: clipOf(rect) });
      await layer(ctx.page, 'beam-shimmer', false);
      await ctx.page.screenshot({ path: b, clip: clipOf(rect) });
      await layer(ctx.page, 'beam-shimmer', true);
      const d = ctx.computeDiff(a, b, { outDir: dir, diffFileName: `shimmer-z${z}-diff.png` });
      const sites = await ev<number>(ctx.page, 'window.__lions.beamShimmerSites()');
      ctx.notes.push(`${s.id}: shimmer A/B at zoom ${z}: ${d.diffPixels} px / ${d.meanAbsChannelDelta.toFixed(4)} (sites fed ${sites}) -- recorded, not floor-voted`);
      console.log(`  shimmer zoom ${z}: ${d.diffPixels} px / ${d.meanAbsChannelDelta.toFixed(4)} sites ${sites}`);
      fs.mkdirSync(path.join(ctx.shots, 'extra'), { recursive: true });
      fs.copyFileSync(a, path.join(ctx.shots, 'extra', `shimmer-zoom-${z}.png`));
      ctx.heroes.push(`extra/shimmer-zoom-${z}.png`);
    }
  }

  // 3. S4: the first strike. The pulse frame is the frame the strike lands on.
  for (let n = 0; n < 60 && st.struck.length < 1; n++) {
    cur = await advance();
    trackS2(cur.r);
    if (st.struck.length < 1 && cur.r.beamDrawn?.end) lastEnd = { x: cur.r.beamDrawn.end[0], y: cur.r.beamDrawn.end[1], z: cur.r.beamDrawn.end[2] };
  }
  // The strike frame at the PEAK of the pulse: the app's first frame after the tick has alpha near 0,
  // and `struckAtMs` is the event's own tick, so alpha 0 is pulse 1 and the end-of-tick frame is 0.583.
  await setAlpha(ctx.page, 0);
  const pulse = await read(ctx.page, carrier, swarm);
  const coin =
    lastEnd !== null && pulse.fall ? coincide(lastEnd, pulse.fall) : { ok: false, xz: Number.NaN, y: Number.NaN };
  check(
    ctx,
    'S4.coincide',
    's4',
    coin.ok,
    lastEnd === null || !pulse.fall
      ? `no beam end (${lastEnd === null}) or no tumbling member (${!pulse.fall}) on the strike frame`
      : `the beam ended ${coin.xz.toFixed(3)} tiles (xz) and ${coin.y.toFixed(3)} (y) from the member that tumbles (tolerance ${COINCIDE_XZ_TILES} / ${COINCIDE_Y_TILES})`
  );
  check(
    ctx,
    'S4.pulse',
    's4',
    (pulse.beamDrawn?.pulse ?? 0) >= 0.99 && pulse.beamDrawn != null && mid.beamDrawn != null && pulse.beamDrawn.corePx > mid.beamDrawn.corePx,
    `strike frame pulse ${pulse.beamDrawn?.pulse.toFixed(3)}, corePx ${pulse.beamDrawn?.corePx.toFixed(2)} against mid-dwell ${mid.beamDrawn?.corePx.toFixed(2)}, sheathPx ${pulse.beamDrawn?.sheathPx.toFixed(2)} against ${mid.beamDrawn?.sheathPx.toFixed(2)}`
  );
  const s4beam = await toggle(ctx, 'S4', 'S4/beam', centre, s.zoom);
  check(
    ctx,
    'S4.above-S3',
    's4',
    s4beam.reading.meanAbsChannelDelta > s3.reading.meanAbsChannelDelta,
    `the pulse frame's beam A/B reads ${s4beam.reading.meanAbsChannelDelta.toFixed(4)} against mid-dwell ${s3.reading.meanAbsChannelDelta.toFixed(4)} (pixels ${s4beam.reading.diffPixels} against ${s3.reading.diffPixels})`
  );
  await hero(ctx, '04-strike-pulse', centre.x, centre.y, 2.5);
  await setAlpha(ctx.page, 1);
  for (let k = 0; k < 4; k++) {
    cur = await advance();
    trackS2(cur.r);
  }
  const plus200 = await read(ctx.page, carrier, swarm);
  check(ctx, 'S4.tumbling', 's4', (plus200.falls ?? 0) >= 1, `${plus200.falls} member(s) tumbling 200 ms after the strike, members ${plus200.members}, drawn ${plus200.drawn}`);
  await toggle(ctx, 'S4', 'S4/swarm', centre, s.zoom);

  // 4. S7: two seconds after the third member is shot down.
  while (st.struck.length < 3) {
    cur = await advance();
    trackS2(cur.r);
  }
  for (let k = 0; k < 40; k++) {
    cur = await advance();
    trackS2(cur.r);
  }
  const wr = await read(ctx.page, carrier, swarm);
  check(ctx, 'S7.wrecks', 's7', (wr.wrecks ?? 0) === 3, `${wr.wrecks} wreck(s) on the ground 2 s after the third strike (members ${wr.members})`);
  await toggle(ctx, 'S7', 'S7/swarm-wrecks', centre, s.zoom);
  await hero(ctx, '02-thinned-swarm-wrecks', centre.x, centre.y, 2);

  // 5. S5: the lockout (the eighth strike and the heat limit land on one tick, and the lockout wins).
  while (st.lockoutTick < 0) {
    cur = await advance();
    trackS2(cur.r);
    if (cur.r.tick - t0 > 400) break;
  }
  if (st.lockoutTick < 0) {
    ctx.skipped.push(s.id);
    ctx.notes.push(`${s.id}: no lockout within 400 ticks of dwell (struck ${st.struck.length}) -- the rest of the subject skipped`);
  } else {
    const lock = await read(ctx.page, carrier, swarm);
    ctx.notes.push(`${s.id}: lockout on tick ${st.lockoutTick}, ${st.lockoutTick - t0} ticks after the first dwell; ${st.struck.length} strikes by then (ticks ${st.struck.join(', ')})`);
    check(ctx, 'S5.dark@0', 's5', lock.beamDrawn === null && lock.beam?.locked === true, `beamDrawn ${lock.beamDrawn === null ? 'null' : 'LIVE'}, locked ${lock.beam?.locked}, target ${lock.beam?.target}`);
    await toggle(ctx, 'S5', 'S5/beam@0', centre, s.zoom);
    for (let k = 0; k < 5; k++) {
      cur = await advance();
      trackS2(cur.r);
    }
    const lock250 = await read(ctx.page, carrier, swarm);
    check(ctx, 'S5.dark@250', 's5', lock250.beamDrawn === null, `beamDrawn ${lock250.beamDrawn === null ? 'null' : 'LIVE'} 250 ms into the lockout`);
    await toggle(ctx, 'S5', 'S5/beam@250ms', centre, s.zoom);
    await hero(ctx, '05-lockout-vent-puffs', 4, 3, 2.5);
    for (let k = 0; k < 55; k++) {
      cur = await advance();
      trackS2(cur.r);
    }
    const lock3 = await read(ctx.page, carrier, swarm);
    check(ctx, 'S5.dark@3s', 's5', lock3.beamDrawn === null && lock3.beam?.locked === true, `beamDrawn ${lock3.beamDrawn === null ? 'null' : 'LIVE'}, locked ${lock3.beam?.locked}, 3 s into the lockout`);
    await toggle(ctx, 'S5', 'S5/beam@3s', centre, s.zoom);
    // 6. Recovery: the cooldown ends, the beam comes back (the sequence's last rung, a note not a vote).
    let recovered = false;
    for (let n = 0; n < 120; n++) {
      cur = await advance();
      trackS2(cur.r);
      if (!(cur.r.beam?.locked ?? true) && (cur.r.beam?.dwell ?? 0) >= 10) {
        recovered = true;
        break;
      }
    }
    const rec = await read(ctx.page, carrier, swarm);
    check(ctx, 'S5.recovery', 's5', recovered && rec.beamDrawn?.ribbon === true, `after the 6 s cooldown: locked ${rec.beam?.locked}, dwell ${rec.beam?.dwell}, ribbon ${rec.beamDrawn?.ribbon}, tick ${rec.tick} (${rec.tick - st.lockoutTick} ticks after the lockout)`);
  }

  // S2: the six rungs and the every-frame readback.
  const rb = readbackVerdict(samples, 12, 4);
  const rungText = named.map((n) => `${n.label}: sim ${n.members} drawn ${n.drawn}`).join('; ');
  check(ctx, 'S2.readback', 's2', rb.ok && named.length === s2Rungs.length && unseenFrames <= 3, `${rb.frames} frames from the first draw (${unseenFrames} before it, fog), ${rb.mismatches.length} mismatches, counts seen ${rb.distinctMembers.join(',')}; rungs ${rungText}${rb.reasons.length > 0 ? ' -- ' + rb.reasons.join('; ') : ''}`);
  ctx.samples[s.id] = timeline;
  ctx.samples[`${s.id}.s2`] = named;
}

async function runRoot(ctx: Ctx, s: E6Subject): Promise<void> {
  await clearField(ctx.page);
  await aim(ctx, s);
  const [bx, by] = s.bearing ?? [1, 0];
  const carrier = await spawn(ctx.page, 'aa_remetz', 0, s.x, s.y);
  const swarm = await spawn(ctx.page, 'drone_swarm', 1, s.x + bx * ROOT_GAP_TILES, s.y + by * ROOT_GAP_TILES);
  await waitForClone(ctx, carrier);
  const got = await tickUntil(ctx, carrier, swarm, 200, (r) => (r.beam?.dwell ?? 0) >= 22);
  if (got === null) {
    ctx.skipped.push(s.id);
    ctx.notes.push(`${s.id}: no dwell 22 within 200 ticks -- subject skipped`);
    return;
  }
  const bd = got.r.beamDrawn;
  if (bd === null || bd === undefined) {
    check(ctx, `root.${s.bearingName}`, 'root', false, 'dwell 22 reached but no beam was drawn');
    return;
  }
  // The root: the origin projected through the renderer's own camera, and a 96 px square around it.
  const mid = { x: s.x + (bx * ROOT_GAP_TILES) / 2, y: s.y + (by * ROOT_GAP_TILES) / 2 };
  await ev(ctx.page, `window.__e6.frameOn(${mid.x}, ${mid.y}, ${s.zoom})`);
  const o = await ev<{ x: number; y: number }>(ctx.page, `window.__e6.project(${bd.origin[0]}, ${bd.origin[1]}, ${bd.origin[2]})`);
  const half = 48;
  const box: Rect = {
    x: Math.min(Math.max(0, Math.round(o.x - half)), VIEWPORT.width - 2 * half),
    y: Math.min(Math.max(0, Math.round(o.y - half)), VIEWPORT.height - 2 * half),
    w: 2 * half,
    h: 2 * half,
  };
  const dir = path.join(ctx.out, 'toggles');
  fs.mkdirSync(dir, { recursive: true });
  const a = path.join(dir, `${s.id}-root-shown.png`);
  const b = path.join(dir, `${s.id}-root-hidden.png`);
  await repaint(ctx.page);
  await ctx.page.screenshot({ path: a, clip: clipOf(box) });
  await layer(ctx.page, 'beam', false);
  await ctx.page.screenshot({ path: b, clip: clipOf(box) });
  await layer(ctx.page, 'beam', true);
  const d = ctx.computeDiff(a, b, { outDir: dir, diffFileName: `${s.id}-root-diff.png` });
  ctx.checks.push({
    id: `root.${s.bearingName}`,
    subject: 'root',
    ok: true,
    info: true,
    detail:
      `INFORMATION (judged by eye on the stills): the 96 px square at the projected muzzle (${o.x.toFixed(0)}, ${o.y.toFixed(0)}) reads beam A/B ` +
      `${d.diffPixels} px / ${d.meanAbsChannelDelta.toFixed(4)}; lensGlowAlpha ${bd.lensGlowAlpha.toFixed(2)}, origin y ${bd.origin[1].toFixed(3)}`,
  });
  console.log(`  root ${s.bearingName}: ${d.diffPixels} px / ${d.meanAbsChannelDelta.toFixed(4)} at (${o.x.toFixed(0)}, ${o.y.toFixed(0)})`);
  if (!ctx.togglesOnly) {
    fs.mkdirSync(path.join(ctx.shots, 'extra'), { recursive: true });
    const rect = await frameCrop(ctx.page, s.x, s.y, s.zoom, { width: 700, height: 460 });
    await ctx.page.screenshot({ path: path.join(ctx.shots, 'extra', `root-${s.bearingName}.png`), clip: clipOf(rect) });
    ctx.heroes.push(`extra/root-${s.bearingName}.png`);
  }
}

async function runSmoke(ctx: Ctx, s: E6Subject): Promise<void> {
  await clearField(ctx.page);
  await aim(ctx, s);
  const cx = 28;
  const carrier = await spawn(ctx.page, 'aa_remetz', 0, cx, 3);
  const eitan = await spawn(ctx.page, 'apc_eitan', 0, cx + 3.5, 5.5);
  await ev(ctx.page, `window.__e6.disarm(${eitan})`);
  const swarm = await spawn(ctx.page, 'drone_swarm', 1, cx + BEAM_GAP_TILES, 3);
  await waitForClone(ctx, carrier);
  await waitForClone(ctx, eitan);
  const up = await tickUntil(ctx, carrier, swarm, 200, (r) => (r.beam?.dwell ?? 0) >= 10 && r.beamDrawn?.ribbon === true);
  if (up === null) {
    ctx.skipped.push(s.id);
    ctx.notes.push(`${s.id}: the beam never reached dwell 10 in 200 ticks -- subject skipped`);
    return;
  }
  await toggle(ctx, 'S6', 'S6/beam-lit', { x: s.x, y: s.y }, s.zoom);
  await ladder(ctx, s, 0, 'lit');
  await ev(ctx.page, `window.__e6.smoke(${eitan}, ${cx + 3.5}, 3)`);
  let laid = -1;
  let broke = -1;
  let struck = 0;
  const startTick = up.r.tick;
  for (let n = 0; n < 80; n++) {
    const t = await tick(ctx.page, 1);
    const r = await read(ctx.page, carrier, swarm);
    for (const e of t.events) {
      if (e.kind === 'smokeLaid' && laid < 0) laid = r.tick;
      if (e.kind === 'beam' && e.phase === 'struck') struck++;
    }
    await ladder(ctx, s, (r.tick - startTick) * TICK_MS, 'smoke');
    if (r.beam !== undefined && r.beam.target < 0) {
      broke = r.tick;
      break;
    }
  }
  if (broke < 0) {
    check(ctx, 'S6.broke', 's6', false, `the sim never broke the beam within 80 ticks of the smoke command (smokeLaid ${laid})`);
    return;
  }
  // Fade finishes within 80 ms (env) and 150 ms (lens): 5 ticks (250 ms) is past both.
  for (let k = 0; k < 5; k++) {
    await tick(ctx.page, 1);
    const r = await read(ctx.page, carrier, swarm);
    await ladder(ctx, s, (r.tick - startTick) * TICK_MS, 'smoke');
  }
  const r = await read(ctx.page, carrier, swarm);
  check(
    ctx,
    'S6.broke',
    's6',
    laid >= 0 && struck === 0 && r.beam?.target === -1 && r.beam?.locked === false && r.beamDrawn === null && r.members === 12,
    `smokeLaid on tick ${laid}, the sim broke the beam on tick ${broke} (${broke - laid} ticks later) with no lockout (locked ${r.beam?.locked}); strikes ${struck}, members ${r.members}, beamDrawn ${r.beamDrawn === null ? 'null' : 'LIVE'}, swarm still drawn ${r.drawn}`
  );
  await toggle(ctx, 'S6', 'S6/beam', { x: s.x, y: s.y }, s.zoom);
  await hero(ctx, 'extra/06b-smoke-breaks-beam', s.x, s.y, 2);
}

async function runDive(ctx: Ctx, s: E6Subject): Promise<void> {
  await clearField(ctx.page);
  await aim(ctx, s);
  const eitan = await spawn(ctx.page, 'apc_eitan', 0, 40, 3);
  await ev(ctx.page, `window.__e6.disarm(${eitan})`);
  const swarm = await spawn(ctx.page, 'drone_swarm', 1, 41.2, 3);
  await waitForClone(ctx, eitan);
  let fireTick = -1;
  const startTick = await ev<number>(ctx.page, 'window.__lions.sim.tickCount');
  for (let n = 0; n < 300 && fireTick < 0; n++) {
    const t = await tick(ctx.page, 1);
    if (t.events.some((e) => e.kind === 'fire' && e.shooter === swarm)) fireTick = t.tick;
  }
  if (fireTick < 0) {
    ctx.skipped.push(s.id);
    ctx.notes.push(`${s.id}: the swarm never dived in 300 ticks -- subject skipped`);
    return;
  }
  ctx.notes.push(`${s.id}: the first dive on tick ${fireTick}, ${fireTick - startTick} ticks after the spawn`);
  await ladder(ctx, s, 0, 'dive');
  // The rung is FIXED at +50 ms, one tick after the dive's `fire`: a diver (or, were the dive routed
  // through `missile`, a missile) is in the air then and not later. A rung chosen by waiting for the
  // diver would slide to the end of the run when there is none, and read a missile that had already
  // landed -- the first falsification of this check did exactly that and read 0 on `missiles`.
  const rung = TICK_MS;
  await tick(ctx.page, 1);
  const r = await read(ctx.page, -1, swarm);
  await ladder(ctx, s, rung, 'dive');
  check(ctx, 'S8.diving', 's8', (r.dives ?? 0) > 0 && r.missiles === 0, `+${rung} ms: ${r.dives} diver(s) in flight, ${r.missiles} missile(s) in missileFx, members ${r.members}`);
  await toggle(ctx, 'S8', 'S8/swarm', { x: s.x, y: s.y }, s.zoom);
  await toggle(ctx, 'S8', 'S8/missiles@50ms', { x: s.x, y: s.y }, s.zoom);
  await toggle(ctx, 'S8', 'S8/bloom@50ms', { x: s.x, y: s.y }, s.zoom);
  await hero(ctx, 'extra/07-dive-in-flight', s.x, s.y, 2.5);
  for (let n = 0; n < 16; n++) {
    await tick(ctx.page, 1);
    await ladder(ctx, s, rung + (n + 1) * TICK_MS, 'dive');
  }
}

async function runScale(ctx: Ctx, s: E6Subject): Promise<void> {
  await clearField(ctx.page);
  await aim(ctx, s);
  const carrier = await spawn(ctx.page, 'aa_remetz', 0, 14, 3);
  const eitan = await spawn(ctx.page, 'apc_eitan', 0, 17.5, 3);
  await waitForClone(ctx, carrier);
  await waitForClone(ctx, eitan);
  await tick(ctx.page, 10);
  const ok = (await ev<boolean>(ctx.page, `window.__e6.meshReady(${carrier})`)) && (await ev<boolean>(ctx.page, `window.__e6.meshReady(${eitan})`));
  check(ctx, 'scale.meshes', 'scale', ok, 'both the carrier and the Eitan drew their meshes (not proxy boxes)');
  await hero(ctx, '06-carrier-beside-eitan', s.x + 0.5, s.y, 2.5);
}

// --- the driver --------------------------------------------------------------

async function main(): Promise<void> {
  const { chromium } = await import('playwright');
  const { ensureDevServer, devServerStopper, readUnmaskedRenderer } = await import('../golden-diff/browser');
  const { FREEZE_FRAME_LOOP_SCRIPT } = await import('../golden-diff/capture-protocol');
  const { computeDiff } = await import('../golden-diff/diff');

  const label = arg('label', 'run');
  // Resolved and refused BEFORE `claimPort`, which prints its claim as it goes.
  const wantedPort = resolvePort(process.argv, process.env, 'E6_CAPTURE_PORT', PORT).port;
  const refused = portRefusal(wantedPort);
  if (refused !== null) throw new Error(refused);
  const port = await claimPort('e6-captures', 'E6_CAPTURE_PORT', PORT);
  const backend = resolveGpuBackend(process.argv, process.platform);
  // `--out` is the PARENT: each run writes to a fresh `<out>/<label>` (refused when it holds anything),
  // so the frames of two runs never mix in one directory.
  const outRoot = path.resolve(REPO_ROOT, arg('out', path.join('.superpowers', 'art-captures', 'e6')));
  const out = freshRunDir(outRoot, label);
  const shotsArg = arg('shots', '');
  const shots = shotsArg === '' ? path.join(out, 'hero') : (() => { const d = path.resolve(REPO_ROOT, shotsArg); return freshRunDir(path.dirname(d), path.basename(d)); })();
  const togglesOnly = has('toggles-only');
  const calibrate = has('calibrate');
  const onlyIds = arg('only', '').split(',').map((v) => v.trim()).filter((v) => v.length > 0);
  for (const id of onlyIds) if (!E6_SUBJECTS.some((s) => s.id === id)) throw new Error(`--only=${id} names no subject (have: ${E6_SUBJECTS.map((s) => s.id).join(', ')})`);
  const wanted = onlyIds.length > 0 ? E6_SUBJECTS.filter((s) => onlyIds.includes(s.id)) : E6_SUBJECTS;
  const settleMs = Number(arg('settle-ms', String(SETTLE_TIMEOUT_MS)));
  fs.mkdirSync(path.join(out, 'toggles'), { recursive: true });

  const consoleFatal: string[] = [];
  const consoleNotes: string[] = [];
  const server = await ensureDevServer(port, REPO_ROOT, 'e6-captures');
  if (server === null) {
    console.error(`port ${port} is not ours -- refusing to drive somebody else's server`);
    process.exitCode = 2;
    return;
  }
  const stopServer = devServerStopper(server, 'e6-captures');
  const removeSignals = installSignalStop(stopServer, process as unknown as SignalHost, (code) => process.exit(code));
  const notes: string[] = [`machine at start: ${load()}`];
  const ctx: Ctx = {
    page: undefined as unknown as Page,
    out,
    shots,
    togglesOnly,
    calibrate,
    computeDiff,
    cells: [],
    toggles: [],
    checks: [],
    notes,
    samples: {},
    skipped: [],
    heroes: [],
  };
  let gl = '';
  let programs: unknown = null;
  let glPage: unknown = null;
  let glEnd: unknown = null;
  try {
    await guarded(() => chromium.launch({ headless: true, args: gpuLaunchArgs(backend) }), stopServer, async (browser) => {
    gl = await readUnmaskedRenderer(browser);
      console.log(`GPU renderer: ${gl}`);
      const page = await browser.newPage({ viewport: { ...SETTLE_VIEWPORT }, deviceScaleFactor: 1 });
      ctx.page = page;
      await page.addInitScript(musicOffInitScript());
      page.setDefaultTimeout(STEP_TIMEOUT_MS);
      page.on('console', (m) => {
        const text = m.text();
        const cls = classifyConsole(m.type(), text);
        if (cls === 'fatal') {
          consoleFatal.push(`[${m.type()}] ${text.slice(0, 600)}`);
          console.error(`  CONSOLE ${m.type()}: ${text.slice(0, 300)}`);
        } else if (cls === 'note') consoleNotes.push(`[${m.type()}] ${text.slice(0, 300)}`);
      });
      page.on('pageerror', (err) => {
        consoleFatal.push(`[pageerror] ${err.message.slice(0, 600)}`);
        console.error('  PAGE ERROR:', err.message);
      });
      await page.goto(`http://localhost:${port}/?sandbox=${MAP}&renderer=three`, { waitUntil: 'load' });
      await page.waitForFunction(() => typeof (window as unknown as { __lions?: unknown }).__lions !== 'undefined');
      await page.evaluate(() => document.fonts.ready);
      const settle = parseSettleResult(await page.evaluate(settleScript(settleMs)));
      const settleNote = settleLine(MAP, settle);
      console.log(`  ${settleNote}`);
      notes.push(settleNote);
        await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);
      await page.setViewportSize({ ...VIEWPORT });
      await page.waitForFunction(
        ([w, h]) => {
          const c = document.querySelector('canvas');
          return c !== null && c.clientWidth === w && c.clientHeight === h;
        },
        [VIEWPORT.width, VIEWPORT.height] as const
      );
      await page.evaluate(`window.__e6 = ${PAGE_API}`);
      await page.evaluate(() => (window as unknown as { __lions: { renderer: { frame(a: number, d: number): void } } }).__lions.renderer.frame(1, 0));
      glPage = await ev(page, 'window.__e6.gl()');
      console.log(`  context: ${JSON.stringify(glPage)}`);

      const types = ['aa_remetz', 'drone_swarm', 'apc_eitan', 'dozer_d9'];
      await clearField(page);
      await waitForMeshes(ctx, types);

      for (const s of wanted) {
        console.log(`\n=== ${s.id} (${s.covers.join(' ') || 'look'}): ${s.why.slice(0, 110)}`);
        try {
          if (s.mode === 'hover') await runHover(ctx, s);
          else if (s.mode === 'beam_sequence') await runBeamSequence(ctx, s);
          else if (s.mode === 'root') await runRoot(ctx, s);
          else if (s.mode === 'smoke') await runSmoke(ctx, s);
          else if (s.mode === 'dive') await runDive(ctx, s);
          else await runScale(ctx, s);
        } catch (err) {
          const message = err instanceof Error ? err.stack ?? err.message : String(err);
          console.error(`  ${s.id} threw: ${message}`);
          notes.push(`${s.id}: THREW ${message.split('\n')[0]}`);
          ctx.skipped.push(s.id);
        }
      }
      // The shaders: ask the GL context itself, after everything has drawn at least once.
      programs = await ev(page, 'window.__e6.programs()');
      console.log(`  programs: ${JSON.stringify(programs)}`);
      glEnd = await ev(page, 'window.__e6.gl()');
      await page.close();
    });
  } finally {
    removeSignals();
  }
  notes.push(`machine at end: ${load()}`);

  // --- judgement -------------------------------------------------------------
  const failures: string[] = [];
  for (const m of consoleFatal) failures.push(`console: ${m}`);
  const pr = programs as ProgramReport | null;
  const full = onlyIds.length === 0;
  const endState = glEnd as { lost?: boolean } | null;
  if (endState === null) failures.push('the WebGL context state was never read at the end of the run');
  for (const f of shaderVerdict(pr, { full, contextLost: endState?.lost !== false })) failures.push(f);
  const backendCheck = backendVerdict(backend, gl);
  if (backendCheck.failure !== null) failures.push(backendCheck.failure);
  for (const c of ctx.checks) if (!c.ok) failures.push(`check ${c.id}: ${c.detail}`);
  for (const t of ctx.toggles) if (t.verdict !== null && !t.verdict.ok) failures.push(`toggle ${t.key}: ${t.verdict.reasons.join('; ')}`);
  for (const s of ctx.skipped) failures.push(`subject ${s} could not be driven to its event`);
  if (full) {
    for (const key of E6_KEY_LIST) if (!ctx.toggles.some((t) => t.key === key)) failures.push(`key ${key} was never read`);
  }

  writeSheet(ctx, label, { gl, glPage, backend, backendStamp: backendCheck.stamp, port, togglesOnly, calibrate, programs: pr, consoleFatal, consoleNotes, failures, wanted });
  if (calibrate) {
    console.log('\nCALIBRATION readings (paste into E6_RUNS):');
    for (const t of ctx.toggles) console.log(`  ${JSON.stringify(t.key)}: { diffPixels: ${t.reading.diffPixels}, meanAbsChannelDelta: ${round4(t.reading.meanAbsChannelDelta)} },`);
  }
  if (failures.length > 0) {
    console.error(`\n${failures.length} failure(s):\n${failures.map((f) => `  ${f}`).join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log('\nall checks green');
  }
}

function writeSheet(
  ctx: Ctx,
  label: string,
  c: {
    gl: string;
    glPage: unknown;
    backend: GpuBackend;
    backendStamp: string | null;
    port: number;
    togglesOnly: boolean;
    calibrate: boolean;
    programs: unknown;
    consoleFatal: readonly string[];
    consoleNotes: readonly string[];
    failures: readonly string[];
    wanted: readonly E6Subject[];
  }
): void {
  const machine = `${process.platform}-${process.arch}, node ${process.version}`;
  const bySubject = new Map<string, Cell[]>();
  for (const cell of ctx.cells) bySubject.set(cell.subject, [...(bySubject.get(cell.subject) ?? []), cell]);
  const flips: string[] = [];
  for (const [subject, cells] of bySubject) {
    const frames = cells.map((x) => ({ file: x.file, tMs: x.tMs }));
    if (frames.length < 2) continue;
    const file = `flip-${subject}.html`;
    fs.writeFileSync(path.join(ctx.out, file), e6FlipHtml(`${label} / ${subject}`, frames));
    flips.push(file);
  }
  // The 10 s thinning ladder the spec asks for: the sequence's frames up to 10 s.
  const seq = bySubject.get('beam_sequence') ?? [];
  const ten = seq.filter((x) => x.tMs <= 10_000).map((x) => ({ file: x.file, tMs: x.tMs }));
  if (ten.length > 1) {
    fs.writeFileSync(path.join(ctx.out, 'flip-swarm-thinning-10s.html'), e6FlipHtml(`${label} / the swarm thinning, first 10 s`, ten));
    flips.push('flip-swarm-thinning-10s.html');
  }
  const verdictText = (t: ToggleRow): string =>
    E6_KEYS[t.key as FloorKey].kind === 'info' ? 'INFO (report-only)' : t.verdict === null ? 'calibrating' : t.verdict.ok ? 'PASS' : 'FAIL';
  const md = [
    `# E6 capture sheet -- ${label}`,
    ``,
    c.failures.length === 0 ? `**RESULT: every check green.**` : `**RESULT: ${c.failures.length} FAILURE(S)** -- see "Failures".`,
    ``,
    `## Capture conditions`,
    ``,
    `- machine: ${machine}`,
    `- GPU renderer: ${mdSafe(c.gl)} (backend ${c.backend})`,
    ...(c.backendStamp === null ? [] : [`- **${c.backendStamp}**`]),
    `- GL context: \`${mdSafe(JSON.stringify(c.glPage))}\``,
    `- viewport ${VIEWPORT.width}x${VIEWPORT.height}, deviceScaleFactor 1, headless chromium, dev server on :${c.port}`,
    `- map: \`${MAP}\` sandbox, \`&renderer=three\`, music off, frame loop frozen; lockstep ${TICK_MS} ms ticks pumped as ${TICK_FRAMES.join(' + ')} ms frames with alpha rising across them as the app loop's does (a photograph is a tick's last frame, alpha 1; the S4 pulse frame is alpha 0, the app's first frame after the tick)`,
    `- ladder crop ${CROP.width}x${CROP.height} lifted ${CROP_LIFT_PX} px; hero stills ${HERO.width}x${HERO.height}`,
    `- mode: ${c.togglesOnly ? '`--toggles-only`' : 'full'}${c.calibrate ? ', `--calibrate` (floor keys read, not judged)' : ''}`,
    `- subjects: ${c.wanted.map((s) => s.id).join(', ')}`,
    `- calibration of the floors in force: ${E6_CALIBRATION === '' ? '(none)' : E6_CALIBRATION}`,
    ``,
    `## Failures`,
    ``,
    ...(c.failures.length === 0 ? ['(none)'] : c.failures.map((f) => `- ${f}`)),
    ``,
    `## Shaders (the first compile of these programs on a GPU)`,
    ``,
    `Console messages that failed the run: ${c.consoleFatal.length}.`,
    ``,
    '```json',
    JSON.stringify(c.programs, null, 2),
    '```',
    ``,
    ...(c.consoleNotes.length > 0 ? [`Console notes (not failures):`, ``, ...[...new Set(c.consoleNotes)].map((n) => `- \`${mdSafe(n)}\``), ``] : []),
    `## Checks (readbacks and relations)`,
    ``,
    `| id | subject | verdict | detail |`,
    `|---|---|---|---|`,
    ...ctx.checks.map((k) => `| ${k.id} | ${k.subject} | ${checkLabel(k)} | ${mdSafe(k.detail)} |`),
    ``,
    `## Toggle A/B (R-M)`,
    ``,
    `A zero FAILS a floor key. A \`zero\` key must read exactly 0 px / 0.0000 and is paired with a floor key read in the same run.`,
    ``,
    `| key | subject | layer | rung | zoom | diff px | mean abs channel delta | repaint drift | objects hidden | verdict |`,
    `|---|---|---|---|---|---|---|---|---|---|`,
    ...ctx.toggles.map(
      (t) =>
        `| \`${t.key}\` | ${t.subject} | \`${t.layer}\` | ${mdSafe(t.rung)} | ${t.zoom} | ${t.reading.diffPixels} | ${t.reading.meanAbsChannelDelta.toFixed(4)} | ` +
        `${t.drift.diffPixels} px / ${t.drift.meanAbsChannelDelta.toFixed(4)} | ${t.hidden} | ${verdictText(t)}${t.verdict && !t.verdict.ok ? ': ' + mdSafe(t.verdict.reasons.join('; ')) : ''} |`
    ),
    ``,
    `Floors in force:`,
    ``,
    ...(Object.keys(E6_FLOORS).length === 0 ? ['(none: uncalibrated)'] : (Object.entries(E6_FLOORS) as [FloorKey, NonNullable<(typeof E6_FLOORS)[FloorKey]>][]).map(([k, f]) => floorLine(k, f))),
    ``,
    `Zero keys: ${E6_KEY_LIST.filter((k) => E6_KEYS[k].kind === 'zero').map((k) => `\`${k}\``).join(', ')}. Report-only keys: ${E6_KEY_LIST.filter((k) => E6_KEYS[k].kind === 'info').map((k) => `\`${k}\``).join(', ')}.`,
    ``,
    `## Falsifications run against these floors`,
    ``,
    ...(E6_FALSIFICATIONS.length === 0
      ? ['(none recorded yet)']
      : E6_FALSIFICATIONS.map(
          (f) =>
            `- ${f.id}: \`${f.mutation}\` -> \`${f.key}\` read ${typeof f.reading === 'string' ? f.reading : `${f.reading.diffPixels} px / ${f.reading.meanAbsChannelDelta.toFixed(4)}`}`
        )),
    ``,
    `## Flip pages (judge on motion)`,
    ``,
    ...flips.map((f) => `- \`${f}\``),
    ``,
    `## Hero stills`,
    ``,
    ...ctx.heroes.map((h) => `- \`${path.relative(ctx.out, path.join(ctx.shots, h))}\``),
    ``,
    `## Notes`,
    ``,
    ...ctx.notes.map((n) => `- ${mdSafe(n)}`),
    ``,
    `## Frames`,
    ``,
    `| subject | t (ms) | tick | zoom | rung | file |`,
    `|---|---|---|---|---|---|`,
    ...ctx.cells.map((x) => `| \`${x.subject}\` | ${x.tMs} | ${x.tick} | ${x.zoom} | ${x.rung} | \`${x.file}\` |`),
    ``,
  ].join('\n');
  fs.writeFileSync(path.join(ctx.out, 'sheet.md'), md);
  fs.writeFileSync(
    path.join(ctx.out, 'sheet.json'),
    JSON.stringify(
      {
        label,
        machine,
        gl: c.gl,
        glContext: c.glPage,
        programs: c.programs,
        failures: c.failures,
        toggles: ctx.toggles,
        checks: ctx.checks,
        cells: ctx.cells,
        samples: ctx.samples,
        notes: ctx.notes,
      },
      null,
      2
    ) + '\n'
  );
  console.log(`sheet at ${path.join(ctx.out, 'sheet.md')} (${ctx.cells.length} frames, ${ctx.toggles.length} toggles, ${ctx.checks.length} checks)`);
}

// Only when run as a script: the spec imports the pure half.
const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().then(
    () => process.exit(process.exitCode ?? 0),
    (err: unknown) => {
      console.error(err);
      process.exit(1);
    }
  );
}
