/**
 * GH-943 WebGPU P3 T2: the units/fx probe. A REPORT, not a gate: for every unit and effect no gated scenario shows, it reads the
 * shown-minus-hidden delta of one debug layer on each arm and prints the table every later P3 port is judged on (plan, "Parity method",
 * ungated rows). Everything it decides is in `webgpu-units-probe-lib.ts`.
 *
 *   pnpm --filter @lions/tools exec tsx src/perf/webgpu-units-probe.ts --kind=units|fx --out-dir=<dir> [--hw=swiftshader]
 *       [--arms=L,F,G] [--only=id,id] [--port=5194]
 *
 * Per moment (subjects with the same page state share one page) and per arm: boot the sandbox with the arm's freeze, settle, aim the
 * camera, run the setup (a scripted moment from `blast-captures.ts` / `e6-captures.ts` is IMPORTED and replayed, never copied), advance
 * the frame clock, then for each subject's layer: two zero-time repaints of the shown state (the control; pixels that differ are
 * UNSTABLE and every delta skips them), hide the layer, repaint, photograph, show it, repaint. The L arm reads twice on one page: plain
 * (the witness) and then matched (`matchNodeStatements`, the denominator). Rain is P4: the `rain` layer is hidden on every arm.
 *
 * REFUSES (exit 2): an empty subject list; a subject whose plain-legacy delta is 0; a node frame with a visible ShaderMaterial object;
 * a run mixing backends; a node subject whose two zero-time repaints differ; a moment whose setup threw. SwiftShader only: this is a
 * CI instrument and takes no Metal (`--hw=metal` refuses).
 */
import { chromium, type Browser, type Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import {
  BOOT_SETTLE_SCRIPT,
  CAPTURE_PRECONDITION_STATEMENTS,
  FREEZE_FRAME_LOOP_SCRIPT,
  HIDE_ALERT_FEED_STATEMENTS,
  HUD_WALL_CLOCK_SETTLE_MS,
  bootFreezeRefusal,
  bootFreezeScriptFor,
  hideHudExceptCanvas,
  matchNodeStatements,
  threeUrl,
  type Scenario,
} from '../golden-diff/capture-protocol';
import { devServerStopper, ensureDevServer } from '../golden-diff/browser';
import type { GpuArm } from '../golden-diff/backend';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPort } from '../ui-review/port';
import { resolveCensusGpu } from './bloom-census-args';
import { BLAST_SUBJECTS, cameraTileOf, spawnSubjects, stageFirefight, triggerCollapse, triggerImpact, triggerKill, triggerTriggerFx, waitForMeshes, type Placed } from './blast-captures';
import { BEAM_GAP_TILES, PAGE_API } from './e6-captures';
import { abDelta, unstableMask, type Frame } from './webgpu-banding-probe-lib';
import {
  PROBE_ARM_KIND,
  allRefusals,
  groupMoments,
  probeTable,
  selectSubjects,
  visibleShaderObjects,
  type BackendReading,
  type ProbeArm,
  type ProbeKind,
  type ProbeSubject,
  type ReadingArm,
  type SubjectReading,
} from './webgpu-units-probe-lib';
import { grassCondition, hideGrassOnPage } from './webgpu-grass-lib';

const args = process.argv.slice(2);
const arg = (n: string, d: string): string => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROOT = path.resolve(TOOLS, '..');
const KIND = arg('kind', '') as ProbeKind;
const HW = arg('hw', 'swiftshader');
const ARMS = arg('arms', 'L,F,G').split(',') as ProbeArm[];
const FRAME_STEPS_OVERRIDE = arg('frame-steps', ''); // DEBUG ONLY, `n:dtMs`: replaces every moment's frameSteps (never used by CI)
const QUIET = arg('quiet', 'particles,wind').split(',').filter((l) => l.length > 0); // layers hidden on every unit subject (noise sources)
const ONLY = arg('only', '').split(',').filter((s) => s.length > 0);
const OUT = path.resolve(arg('out-dir', ''));
const VIEWPORT = { width: 1000, height: 640 } as const;
const ARM_OF: Record<ProbeArm, GpuArm> = { L: 'legacy', G: 'webgpu', F: 'webgl2' };

function refuse(msg: string): never {
  console.error(`webgpu-units-probe: REFUSED: ${msg}`);
  process.exit(2);
}
if (args.find((a) => a.startsWith('--out-dir=')) === undefined) refuse('--out-dir=<dir> is required');
if (KIND !== 'units' && KIND !== 'fx') refuse(`--kind=${KIND} is not units or fx`);
if (HW !== 'swiftshader') refuse(`--hw=${HW}: this probe runs on CI SwiftShader and takes no Metal`);
for (const a of ARMS) if (!(a in ARM_OF)) refuse(`--arms: "${a}" is not L, F or G`);
mkdirSync(OUT, { recursive: true });

const subjects: ProbeSubject[] = selectSubjects(KIND, ONLY);

// ---------------------------------------------------------------------------------------------------------------------------------
// In-page scripts.
// ---------------------------------------------------------------------------------------------------------------------------------

/** `window.__probe`: what a subject's `setup` statements call. Plain JS (an injected string). Frames only, never ticks, while waiting. */
const PROBE_HELPERS = `(() => {
  const L = window.__lions, R = L.renderer, F = 65536;
  const node = R.nodeBackend !== null && R.nodeBackend !== undefined;
  const raf = () => new Promise((r) => window.requestAnimationFrame(() => r()));
  const idxOf = (id) => {
    const i = L.sim.unitTypes.findIndex((t) => t.id === id);
    if (i < 0) throw new Error('probe: no unit type ' + id + ' in this build');
    return i;
  };
  window.__probe = {
    spawn: (id, side, x, y) => L.sim.spawn(idxOf(id), side, Math.round(x * F), Math.round(y * F)),
    follow: (id, zoom) => {
      R.camera.x = L.sim.state.posX[id] / F;
      R.camera.y = L.sim.state.posY[id] / F;
      R.camera.zoom = zoom;
    },
    goto: (x, y, zoom) => {
      R.camera.x = x; R.camera.y = y; R.camera.zoom = zoom;
    },
    // Frames at \`dtMs\` and NO sim tick: the frame clock advances, the world does not. A node arm waits a native rAF before each (its
    // scene pass redraws once per frameId).
    settle: async (n, dtMs) => {
      for (let i = 0; i < n; i++) {
        if (node) await raf();
        R.frame(1, dtMs);
      }
    },
    // Wait (frames only) until every id holds a real mesh; a GLB fetch needs wall time, hence the sleep.
    meshes: async (ids, vehicle) => {
      const deadline = performance.now() + 60000;
      for (;;) {
        const missing = ids.filter((id) => (vehicle ? !R.vehicleMeshEntities.has(id) : !(R.meshUnitEntities.get(id) && R.meshUnitEntities.get(id).actions.size > 0)));
        if (missing.length === 0) return ids.length;
        if (performance.now() > deadline) throw new Error('probe: no mesh arrived for ' + missing.join(','));
        if (node) await raf();
        // A unit spawned mid-mission is SEEDED BY snapshot() (CLAUDE.md); a frame alone never instantiates its mesh.
        R.snapshot();
        R.frame(1, 100);
        await new Promise((r) => setTimeout(r, 200));
      }
    },
    // No combat in a unit subject: a fight keeps the infantry's poses changing between two zero-time repaints (a squad firing is not a
    // fixed frame), so every hostile is taken off the field (\`removeFromPlay\`, the blast harness's own hook) before the setup.
    peace: () => {
      let n = 0;
      for (let e = 0; e < L.sim.entityCount; e++) if (L.sim.state.alive[e] === 1 && L.sim.state.side[e] === 1) { L.sim.removeFromPlay(e); n++; }
      return n;
    },
    // Takes the sandbox's foot squads (except \`keep\`) off the field: two zero-time repaints of a frame with a squad in it differ (its pose
    // is not a fixed function of the tick and the alpha), so a subject that is not about infantry has none.
    clearFoot: (keep) => {
      let n = 0;
      for (let e = 0; e < L.sim.entityCount; e++) {
        if (L.sim.state.alive[e] !== 1 || L.sim.state.side[e] !== 0 || keep.includes(e)) continue;
        const t = L.sim.unitTypes[L.sim.state.typeIdx[e]].id;
        if (t === 'inf_squad' || t === 'at_team' || t === 'mortar_team') { L.sim.removeFromPlay(e); n++; }
      }
      return n;
    },
    // The spoil a digger leaves (\`Sim.stampTrail\`): a pre-dug route digs nothing, so the trail is stamped along it, tile by tile, with the
    // density \`stampTrail\` writes (TRAIL_MAX). A probe instrument on a throwaway sim; nothing reads the page back.
    stampTrail: (route) => {
      const len = L.sim.tnLength[route] / F;
      let n = 0;
      for (let d = 0; d <= len; d += 0.5) {
        const p = L.sim.tunnelPointAt(route, Math.round(d * F));
        const tx = p[0] >> 16, ty = p[1] >> 16;
        if (tx >= 0 && ty >= 0 && tx < L.sim.width && ty < L.sim.height) { L.sim.trail[ty * L.sim.width + tx] = 255; n++; }
      }
      // The trail mesh rebuilds on the renderer's 5 Hz fog cadence (every fourth snapshot).
      for (let i = 0; i < 4; i++) R.snapshot();
      return n;
    },
    // A splash of \`frac\` of each unit's hull on that unit alone (the dev hook the sandbox has), checked: a probe that damaged nothing throws.
    // Soft targets only: a splash does nothing to a hard hull.
    damage: (ids, frac) => {
      for (const id of ids) {
        const type = L.sim.unitTypes[L.sim.state.typeIdx[id]];
        const before = L.sim.state.hp[id];
        L.sim.debugSplash(L.sim.state.posX[id], L.sim.state.posY[id], F / 2, Math.round(type.hp * frac), 0, -1, -1);
        if (!(L.sim.state.hp[id] < before)) throw new Error('probe: damage(' + id + ') did not reduce hp (' + before + ' -> ' + L.sim.state.hp[id] + ')');
      }
    },
  };
  return 'ok';
})()`;

/** Two zero-time repaints (a node arm waits a native rAF before each), then the GPU idle. */
const repaintScript = (arm: ProbeArm): string => `(async () => {
  const R = window.__lions.renderer;
  for (let i = 0; i < 2; i++) {
${arm === 'L' ? '' : '    await new Promise(function (r) { window.requestAnimationFrame(function () { r(); }); });\n'}    R.frame(1, 0);
  }
${arm === 'L' ? '' : '  await R.whenGpuIdle();\n'}  return 'ok';
})()`;

const stepsScript = (n: number, dtMs: number, arm: ProbeArm): string => `(async () => {
  const R = window.__lions.renderer;
  for (let i = 0; i < ${n}; i++) {
${arm === 'L' ? '' : '    await new Promise(function (r) { window.requestAnimationFrame(function () { r(); }); });\n'}    R.frame(1, ${dtMs});
  }
  return 'ok';
})()`;

// ---------------------------------------------------------------------------------------------------------------------------------
// The driver.
// ---------------------------------------------------------------------------------------------------------------------------------

const toFrame = (png: Buffer): Frame => {
  const p = PNG.sync.read(png);
  return { w: p.width, h: p.height, data: p.data };
};
const fileSafe = (s: string): string => s.replace(/[^a-z0-9_-]+/gi, '_');

function writeFrame(f: Frame, file: string): void {
  const out = new PNG({ width: f.w, height: f.h, colorType: 2 });
  for (let i = 0; i < f.w * f.h; i++) {
    out.data[i * 4] = f.data[i * 4] as number;
    out.data[i * 4 + 1] = f.data[i * 4 + 1] as number;
    out.data[i * 4 + 2] = f.data[i * 4 + 2] as number;
    out.data[i * 4 + 3] = 255;
  }
  writeFileSync(file, PNG.sync.write(out, { colorType: 2 }));
}

interface PartialReading {
  id: string;
  layer: string;
  band: ProbeSubject['band'];
  deltas: Partial<Record<ReadingArm, { meanAbsChannelDelta: number; changedPixels: number }>>;
  controlPx: Partial<Record<ProbeArm, number>>;
  visibleShaders: Partial<Record<'F' | 'G', string[]>>;
  objects: Partial<Record<ReadingArm, number>>;
  notRestored: ReadingArm[];
}

/** Where a node arm's visible ShaderMaterial objects stand at four points of one moment (the Review Focus 5 triage). */
interface ShaderDiagnosis {
  moment: string;
  arm: ProbeArm;
  /** After setup, before the backend's census. */
  beforeCensus: string[];
  /** Straight after the backend's own census (`nodeBackend.prepare`), no frame yet. */
  afterCensus: string[];
  /** After the settle repaints, i.e. the state the photograph sees. */
  afterRepaint: string[];
}
const shaderDiagnoses: ShaderDiagnosis[] = [];
const readings = new Map<string, PartialReading>();
const backends: BackendReading[] = [];
const failures: string[] = [];
const notes: string[] = [];

function readingOf(s: ProbeSubject): PartialReading {
  let r = readings.get(s.id);
  if (r === undefined) {
    r = { id: s.id, layer: s.layer, band: s.band, deltas: {}, controlPx: {}, visibleShaders: {}, objects: {}, notRestored: [] };
    readings.set(s.id, r);
  }
  return r;
}

/** The scripted-moment tags, replayed by import. A raw statement run is flushed before each tag so the order is the subject's. */
async function runSetup(page: Page, s: ProbeSubject): Promise<void> {
  let raw: string[] = [];
  const flush = async (): Promise<void> => {
    if (raw.length === 0) return;
    const body = raw.join('\n');
    raw = [];
    await page.evaluate(`(async () => {\n${body}\nreturn 'ok';\n})()`);
  };
  for (const stmt of s.setup) {
    if (!stmt.startsWith('@')) {
      raw.push(stmt);
      continue;
    }
    await flush();
    const [tag, id = ''] = stmt.split(':');
    if (tag === '@e6') {
      await runE6Beam(page);
      continue;
    }
    const bs = BLAST_SUBJECTS.find((b) => b.id === id);
    if (bs === undefined) throw new Error(`setup ${stmt}: no BLAST_SUBJECTS entry`);
    if (tag === '@firefight') {
      // The firefight alone (no kill): the pooled muzzle lights and the tracers it leaves.
      await stageFirefight(page, { subject: bs, entity: -1, shooter: -1 } as Placed, notes);
    } else if (tag === '@blast') {
      const placed = await spawnSubjects(page, [bs]);
      await waitForMeshes(page, placed, notes);
      const p = placed[0] as Placed;
      if (bs.firefight === true) await stageFirefight(page, p, notes);
      const trigger =
        bs.mode === 'kill' ? await triggerKill(page, p, 0) : bs.mode === 'collapse' ? await triggerCollapse(page, p) : bs.mode === 'impact' ? await triggerImpact(page, p, notes) : await triggerTriggerFx(page, p, notes);
      if (trigger === null) throw new Error(`setup ${stmt}: the moment never fired (see the notes)`);
    } else throw new Error(`setup ${stmt}: unknown tag`);
    // The moment fired; put the camera where the blast subject is photographed (its own framing, imported).
    const [cx, cy] = cameraTileOf(bs);
    await page.evaluate(`window.__probe.goto(${cx}, ${cy}, ${s.camera.zoom})`);
  }
  await flush();
}

/** The E6 beam moment (`e6-captures.ts` `beam_sequence`, acquisition to mid-dwell), through its own exported `PAGE_API`. */
async function runE6Beam(page: Page): Promise<void> {
  await page.evaluate(`(async () => {
  const api = ${PAGE_API};
  window.__e6 = api;
  const L = window.__lions, R = L.renderer;
  const raf = () => new Promise((r) => window.requestAnimationFrame(() => r()));
  const node = R.nodeBackend !== null && R.nodeBackend !== undefined;
  // E6's own order (its waitForMeshes): the types are spawned FIRST and the sim ticked (a spawned type's mesh is queued by the app's sweep,
  // which a frame alone never runs), the field cleared, then the sequence spawned again onto loaded templates.
  const first = api.spawn('aa_remetz', 0, 3, 6);
  api.spawn('drone_swarm', 1, 45, 7);
  const deadline = performance.now() + 120000;
  for (;;) {
    if (node) await raf();
    L.step(20);
    if (api.meshReady(first) && api.swarmReady()) break;
    if (performance.now() > deadline) throw new Error('e6: the carrier and swarm meshes never loaded');
    await new Promise((r) => setTimeout(r, 400));
  }
  api.clear();
  const carrier = api.spawn('aa_remetz', 0, 4, 3);
  api.spawn('drone_swarm', 1, ${4 + BEAM_GAP_TILES}, 3);
  for (let n = 0; n < 40 && !api.meshReady(carrier); n++) api.tick(1);
  if (!api.meshReady(carrier)) throw new Error('e6: the carrier clone never attached');
  let dwell = 0;
  for (let n = 0; n < 200 && dwell < 22; n++) {
    api.tick(1);
    const b = L.sim.beamState(carrier, 0);
    dwell = b ? b.dwell : 0;
  }
  if (dwell < 22) throw new Error('e6: the carrier never reached mid-dwell (dwell ' + dwell + ')');
  api.frameOn(${7.5}, ${3}, ${1.5});
  return 'ok';
})()`);
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function probeMoment(browser: Browser, port: number, arm: ProbeArm, group: ProbeSubject[]): Promise<void> {
  const first = group[0] as ProbeSubject;
  const tag = `${first.id}@${arm}`;
  const page = await browser.newPage({ viewport: { ...VIEWPORT }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.setDefaultTimeout(300_000);
  try {
    const scenario: Scenario = { id: 'units-probe', description: 'the units/fx probe', sandboxMap: first.map, sandboxFlags: first.flags, ticks: 0, cameraTile: first.camera.tile };
    await page.addInitScript(musicOffInitScript({}, { quality: 'high' }));
    await page.addInitScript('window.__name = (f) => f;');
    await page.addInitScript(bootFreezeScriptFor(ARM_OF[arm]));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(threeUrl(port, scenario, ARM_OF[arm]), { waitUntil: 'load', timeout: 180_000 });
    await page.waitForFunction(() => typeof (window as unknown as { __lions?: unknown }).__lions !== 'undefined', undefined, { timeout: 240_000 });
    await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);
    await page.evaluate(() => document.fonts.ready);
    const settled = JSON.parse((await page.evaluate(BOOT_SETTLE_SCRIPT)) as string) as { tick: number };
    const fr = bootFreezeRefusal(settled.tick);
    if (fr !== null) throw new Error(`${tag}: ${fr}`);
    const info = (await page.evaluate('window.__lions.renderer.backendInfo()')) as { kind: string; adapter: string };
    const gpu = (await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(gl?.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    })) as string;
    backends.push({ arm, backendKind: info.kind, gpu: arm === 'G' ? info.adapter : gpu });
    if (info.kind !== PROBE_ARM_KIND[arm]) throw new Error(`${tag}: backendInfo().kind is "${info.kind}", expected "${PROBE_ARM_KIND[arm]}"`);
    await page.evaluate(`(async () => { ${HIDE_ALERT_FEED_STATEMENTS}\n await new Promise(function (r) { setTimeout(r, ${HUD_WALL_CLOCK_SETTLE_MS}); }); ${CAPTURE_PRECONDITION_STATEMENTS} })()`);
    await page.evaluate(hideHudExceptCanvas);

    // The camera and the absolute tick, then the helpers; rain is P4, so it is hidden on every arm (0 on a dry map).
    await page.evaluate(`(async () => {
  const L = window.__lions;
  L.goto(${first.camera.tile[0]}, ${first.camera.tile[1]});
  L.renderer.camera.zoom = ${first.camera.zoom};
  L.step(Math.max(0, ${first.tick} - L.sim.tickCount));
  return L.sim.tickCount;
})()`);
    await page.evaluate(PROBE_HELPERS);
    if (KIND === 'units' && !first.setup.some((x) => x.includes('NEEDS_HOSTILE'))) await page.evaluate('window.__probe.peace()');
    await page.evaluate(`window.__lions.renderer.setDebugLayerVisible('rain', false)`);
    // GH-1167 S6: the 3D grass field is hidden on every arm too (the `valley` subject frames wadi_halam_4's L-vs-G; the grass cost is its own column).
    await hideGrassOnPage(page, `units-probe ${arm}`);

    await runSetup(page, first);
    const steps = FRAME_STEPS_OVERRIDE === '' ? first.frameSteps : { n: Number(FRAME_STEPS_OVERRIDE.split(':')[0]), dtMs: Number(FRAME_STEPS_OVERRIDE.split(':')[1]) };
    if (steps !== undefined && steps.n > 0) await page.evaluate(stepsScript(steps.n, steps.dtMs, arm));
    // The unit subjects measure one layer on a QUIET frame: the ambient dust and exhaust particles are re-emitted by every frame, so two
    // zero-time repaints differ by them and the delta would contain the noise. Hidden on every arm, for every unit subject.
    if (KIND === 'units') for (const q of QUIET) if (q !== first.layer) await page.evaluate(`window.__lions.renderer.setDebugLayerVisible(${JSON.stringify(q)}, false)`);

    for (const q of first.alsoHide ?? []) await page.evaluate(`window.__lions.renderer.setDebugLayerVisible(${JSON.stringify(q)}, false)`);

    const node = arm !== 'L';
    const listShaders = async (): Promise<string[]> => (await page.evaluate(`(${String(visibleShaderObjects)})(window.__lions.renderer.scene)`)) as string[];
    const diag: ShaderDiagnosis = { moment: first.id, arm, beforeCensus: [], afterCensus: [], afterRepaint: [] };
    if (node) {
      diag.beforeCensus = await listShaders();
      // The backend's OWN census, through its own entry, so a ShaderMaterial object made since boot is hidden as the backend hides it.
      await page.evaluate('window.__lions.renderer.nodeBackend.prepare(window.__lions.renderer.scene, window.__lions.renderer.viewCamera)');
      diag.afterCensus = await listShaders();
    }
    const rect = (await page.evaluate(() => {
      const r = document.querySelector('canvas')?.getBoundingClientRect();
      return { x: r?.x ?? 0, y: r?.y ?? 0, width: r?.width ?? 0, height: r?.height ?? 0 };
    })) as Rect;
    const grab = async (): Promise<Frame> => toFrame(await page.screenshot({ clip: rect }));
    const same = (a: Frame, b: Frame): boolean => a.data.length === b.data.length && a.data.every((v, i) => v === b.data[i]);
    // Settle: the capture protocol's rule (two zero-time repaints byte-identical), a few tries; what never settles is reported by its control.
    for (let i = 0; i < 6; i++) {
      await page.evaluate(repaintScript(arm));
      const a = await grab();
      await page.evaluate(repaintScript(arm));
      if (same(a, await grab())) break;
    }
    if (node) diag.afterRepaint = await listShaders();
    if (node) shaderDiagnoses.push(diag);

    const phases: ReadingArm[] = arm === 'L' ? ['L', 'Lm'] : [arm];
    for (const phase of phases) {
      if (phase === 'Lm') {
        await page.evaluate(`(async () => {\n${matchNodeStatements(ROOT)}\nreturn 'ok';\n})()`);
      }
      for (const s of group) {
        const rd = readingOf(s);
        await page.evaluate(repaintScript(arm));
        const base = await grab();
        await page.evaluate(repaintScript(arm));
        const again = await grab();
        const unstable = unstableMask(base, again);
        const region = s.crop === undefined ? undefined : { x: s.crop[0], y: s.crop[1], w: s.crop[2], h: s.crop[3] };
        if (phase !== 'Lm') rd.controlPx[arm] = abDelta(base, again, null, region).changed;
        if (phase !== 'Lm' && (rd.controlPx[arm] ?? 0) > 0) {
          // Where the unsettled pixels are: the bounding box and the frame itself, so the noise's source can be named.
          let x0 = base.w, y0 = base.h, x1 = -1, y1 = -1;
          for (let y = 0; y < base.h; y++) for (let x = 0; x < base.w; x++) {
            const i = (y * base.w + x) * 4;
            if (base.data[i] !== again.data[i] || base.data[i + 1] !== again.data[i + 1] || base.data[i + 2] !== again.data[i + 2]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
          }
          console.log(`[units-probe] ${s.id} ${phase} unsettled bbox x ${x0}..${x1}, y ${y0}..${y1}`);
          writeFrame(again, path.join(OUT, `${fileSafe(s.id)}-${phase}-control-again.png`));
        }
        if (node && phase === arm) rd.visibleShaders[arm as 'F' | 'G'] = await listShaders();
        const objects = (await page.evaluate(`window.__lions.renderer.setDebugLayerVisible(${JSON.stringify(s.layer)}, false)`)) as number;
        await page.evaluate(repaintScript(arm));
        const hid = await grab();
        const shownCount = (await page.evaluate(`window.__lions.renderer.setDebugLayerVisible(${JSON.stringify(s.layer)}, true)`)) as number;
        // A layer that clears its own list on a hide (smoke-outline) returns 0 from the hide; the show's count is the list it put back.
        const objectsHid = Math.max(objects, shownCount);
        if (node || phase === 'Lm') {
          // A layer's plain show can re-show what the census hid (the overlay batches, say): counted here, and the node render's own
          // re-assert (P3-R13) must have hidden them again by the repaint below, which is checked after it (a node bug otherwise).
          const before = rd.visibleShaders[arm as 'F' | 'G']?.length ?? 0;
          if (node) {
            const after = (await listShaders()).length;
            if (after > before) notes.push(`${tag}/${s.id}: showing \`${s.layer}\` re-showed ${after - before} census-hidden ShaderMaterial object(s) until the next node render`);
          } else await page.evaluate(`(async () => {\n${matchNodeStatements(ROOT)}\nreturn 'ok';\n})()`);
        }
        await page.evaluate(repaintScript(arm));
        const back = await grab();
        if (node) {
          // After the render the re-assert ran in: nothing a toggle re-showed may still be drawing.
          const final = await listShaders();
          if (final.length > (rd.visibleShaders[arm as 'F' | 'G']?.length ?? 0)) rd.visibleShaders[arm as 'F' | 'G'] = final;
        }
        const d = abDelta(base, hid, unstable, region);
        rd.deltas[phase] = { meanAbsChannelDelta: d.meanAbs, changedPixels: d.changed };
        rd.objects[phase] = objectsHid;
        if (abDelta(base, back, unstable, region).changed !== 0) rd.notRestored.push(phase);
        writeFrame(base, path.join(OUT, `${fileSafe(s.id)}-${phase}-shown.png`));
        writeFrame(hid, path.join(OUT, `${fileSafe(s.id)}-${phase}-hidden.png`));
        console.log(`[units-probe] ${s.id} ${phase}: ${s.layer} objects ${objectsHid}, delta ${d.meanAbs.toFixed(4)} (${d.changed} px of ${d.pixels}); control ${rd.controlPx[arm] ?? '-'} px${rd.notRestored.includes(phase) ? '; NOT RESTORED' : ''}${rd.visibleShaders[arm as 'F' | 'G'] ? `; ${rd.visibleShaders[arm as 'F' | 'G']?.length} visible ShaderMaterial` : ''}`);
      }
    }
    const bad = errors.filter((l) => /GPUValidationError|Destroyed texture|uploaded again/i.test(l));
    if (bad.length > 0) notes.push(`${tag}: console carries ${bad.length} validation line(s): ${bad[0]?.slice(0, 160)}`);
  } catch (e) {
    const msg = `${tag}: ${e instanceof Error ? e.message : String(e)}`;
    failures.push(msg);
    console.error(`[units-probe] FAILED ${msg}`);
    try {
      await page.screenshot({ path: path.join(OUT, `failed-${fileSafe(tag)}.png`) });
    } catch {
      // The page may be gone.
    }
  } finally {
    await page.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------------------------------------------------------------

const startedAt = new Date().toISOString();
const emptyRefusal = subjects.length === 0 ? allRefusals(KIND, subjects, [], []) : [];
if (emptyRefusal.length > 0) refuse(emptyRefusal.join('; '));

const port = await claimPort('webgpu-units-probe', 'WEBGPU_UNITS_PROBE_PORT', 5194);
const stop = devServerStopper(await ensureDevServer(port, ROOT, 'webgpu-units-probe'), 'webgpu-units-probe');
const groups = groupMoments(subjects);
try {
  for (const arm of ARMS) {
    const gpu = resolveCensusGpu([`--gpu=${ARM_OF[arm]}`, '--hw=swiftshader'], process.platform);
    const browser = await chromium.launch(gpu.launchArgs.length === 0 ? { headless: true } : { headless: true, args: gpu.launchArgs });
    try {
      for (const [i, group] of groups.entries()) {
        console.log(`[units-probe] ${arm}: moment ${i + 1}/${groups.length} (${group.map((g) => g.id).join(', ')}), load ${os.loadavg()[0]?.toFixed(2)}`);
        await probeMoment(browser, port, arm, group);
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  stop();
}

const final: SubjectReading[] = subjects.map((s) => {
  const r = readingOf(s);
  return { id: r.id, layer: r.layer, band: r.band, deltas: r.deltas, controlPx: r.controlPx, visibleShaders: r.visibleShaders, hidObjects: r.objects, notRestored: r.notRestored };
});
const refusals = [...allRefusals(KIND, subjects, final, backends), ...failures.map((f) => `a moment failed: ${f}`)];
const conditions = `${KIND}: ${VIEWPORT.width}x${VIEWPORT.height} DPR 1, quality high, music off, reduced motion, hw=${HW}, arms ${ARMS.join(',')}, rain hidden on every arm, ${grassCondition('hidden')} on every arm; L = plain legacy, L-matched = the node census on the legacy scene; ${backends.map((b) => `${b.arm}=${b.backendKind} on ${b.gpu}`).filter((v, i, a) => a.indexOf(v) === i).join('; ')}`;
const md = [
  `# WebGPU P3 T2: the ${KIND} probe (${HW})`,
  '',
  `Run ${startedAt}. Machine: ${os.cpus()[0]?.model ?? 'unknown'}, ${os.platform()}.`,
  '',
  `Conditions: ${conditions}`,
  '',
  'Cells are the shown-minus-hidden mean absolute channel delta (0..255) and the changed-pixel count. DEAD: the node delta is 0 (no floor exists yet for these keys): the object is census-hidden. pre-port: a stock material draws the subject on node without its hook; r is node / L-matched against the subject band.',
  '',
  ...probeTable(final),
  '',
  '## Notes',
  '',
  ...(notes.length === 0 ? ['none'] : notes.map((n) => `- ${n}`)),
  '',
  '## Layer objects reported by setDebugLayerVisible (hide call), per reading',
  '',
  ...[...readings.values()].map((r) => `- ${r.id} (${r.layer}): ${Object.entries(r.objects).map(([k, v]) => `${k} ${v}`).join(', ')}${r.notRestored.length > 0 ? `; NOT RESTORED on ${r.notRestored.join(', ')}` : ''}`),
  '',
  '## ShaderMaterial triage (Review Focus 5): visible ShaderMaterial objects on a node arm, by point',
  '',
  'before = after setup, before the backend census; census = straight after `nodeBackend.prepare`; repaint = after the settle repaints (the photographed state).',
  '',
  '| moment | arm | before census | after census | after repaint |',
  '|---|---|---|---|---|',
  ...shaderDiagnoses.map((d) => `| ${d.moment} | ${d.arm} | ${d.beforeCensus.length} | ${d.afterCensus.length} | ${d.afterRepaint.length} |`),
  '',
  ...shaderDiagnoses.filter((d) => d.afterRepaint.length > 0).flatMap((d) => [`### ${d.moment} (${d.arm}) after repaint`, '', ...[...new Set(d.afterRepaint)].slice(0, 12).map((n) => `- ${n}`), '']),
  '## Refusals',
  '',
  ...(refusals.length === 0 ? ['none'] : refusals.map((r) => `- ${r}`)),
];
writeFileSync(path.join(OUT, `${KIND}-probe.md`), md.join('\n') + '\n');
writeFileSync(path.join(OUT, `${KIND}-probe.json`), JSON.stringify({ startedAt, kind: KIND, hw: HW, conditions, readings: final, backends, notes, failures, refusals, shaderDiagnoses }, null, 2));
console.log(md.join('\n'));
if (refusals.length > 0) refuse(`${refusals.length} refusal(s); the table above is what was read`);
process.exit(0);
