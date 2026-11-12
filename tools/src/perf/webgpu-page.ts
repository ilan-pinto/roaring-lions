// The in-page half of the P0 measurement (GH-943 WebGPU-primary; `webgpu-abba-run.ts` and `webgpu-raf-hypothesis.ts` drive it).
//
// Dynamically imported by a page from the app's own Vite dev server through `/@fs/`. PRESENTATION measurement only: it reads
// frame time from a renderer and writes the sim only to spawn units on a PRIVATE Sim of its own (the figure curve).
//
// One timing contract for all three arms, so a difference is the renderer and nothing else:
//   cpuFrame  = `renderer.frame()` return time
//   cpuRender = the time inside the render call alone (`post.render()` on L, the node backend's `render()` on F and G)
//   synced    = frame start to GPU idle (a 1x1 `readPixels` on L, `onSubmittedWorkDone` on F and G)
// `onSubmittedWorkDone` carries an IPC round trip `readPixels` does not, so on the node arms `synced` is an upper bound by that
// latency; the L/F/G ratio is the figure the bars (1.05 / 1.10) are read on, and the lead sees both numbers.
import type { Sim } from '@lions/sim';
import { buildWorld, buildRendererOptions, createHost, loadAllMeshes, computeAnchors, createSpawner, spawnUpTo, livingCount } from './three-units';
import type { maps, ParsedMap } from '@lions/data';
import { DECOR_LOD1, DECOR_MESHES, PROP_MESHES, meshPlanFor } from '../../../packages/app/src/mesh-catalogue';
import { censusUnported } from '../../../packages/render/src/three/backend/unported';
import { resolveNodeDraw, type NodeDrawOptions } from '../../../packages/render/src/three/backend/node-draw-options';
import type { ArmId } from './webgpu-refusals';
import { drawTypeOf, emptyByType, medianOrNull, type DrawObjectLike, type DrawType, type FullReason, type PerPass, type RenderPassId, type SubmitReading, type Uploads, type VariantId } from './webgpu-submit-probe-lib';

interface BatchedLike {
  isBatchedMesh?: boolean;
  perObjectFrustumCulled?: boolean;
  _multiDrawCount?: number;
}

interface NodeBackendLike {
  render(scene: unknown, camera: unknown): void;
  whenSubmitted(): Promise<void>;
  /** `perPass` and `censusMs` from GH-943 P3 T13; absent on an older tree (H6's before arm runs this file's `runArm` there). */
  stats(): { calls: number; triangles: number; perPass?: PerPass; censusMs?: number };
  gpuTimeMs?(): Promise<number | null>;
  post?: { pipeline?: { renderer?: unknown } } | null;
  /** GH-943 P3 T14b: the run-time draw switches (absent on an older tree). */
  drawSwitches?: {
    get(): { refreshPolicy: string; matrixWalk: string; uploads: string };
    setRefresh(m: 'three' | 'parked' | 'unsafe-shared'): void;
    setMatrixWalk(w: 'every-pass' | 'once'): void;
    takeCounts(): { full: number; downgraded: number; walks: number; walksSkipped: number };
    undeclared(): readonly string[];
  };
}

interface RendererLike {
  camera: { x: number; y: number; zoom: number };
  canvas: HTMLCanvasElement;
  frame(alpha: number, dtMs: number): void;
  backendInfo(): { kind: string; adapter: string; reason?: string };
  whenGpuIdle(): Promise<void>;
  unportedHooks(): { kind: string; key: string; objects: number }[];
  nodeBackend: NodeBackendLike | null;
  post?: { render: () => void } | null;
  scene: { traverse(f: (o: BatchedLike) => void): void };
  renderer: { info: { autoReset: boolean; reset(): void; render: { calls: number; triangles: number } } };
  loadDecorMeshes(urls: ReadonlyMap<string, string>): Promise<void>;
  loadPropMeshes(urls: ReadonlyMap<string, string>): Promise<void>;
}

/**
 * The map's decor and prop batches, the way `main.ts` loads them (`meshPlanFor`'s `decor`/`props`), from `art/meshes/` through
 * `/@fs/` like `loadAllMeshes`. Without this the scene has NO BatchedMesh at all (the decor and prop batches are the only ones),
 * so the harness timed a ground-and-units scene the game never draws, and the entries refusal read 0 on every arm.
 */
async function loadDecorAndProps(r: RendererLike, map: ParsedMap): Promise<void> {
  const root = new URL(import.meta.url).pathname.replace(/^\/@fs/, '').replace(/\/tools\/src\/perf\/webgpu-page\.ts$/, '');
  const url = (file: string): string => `/@fs${root}/art/meshes/${file}`;
  const plan = meshPlanFor(map, new Set());
  const decor = new Map<string, string>();
  for (const fam of plan.decor) {
    DECOR_MESHES[fam].forEach((file, v) => decor.set(`${fam}_${v}`, url(file)));
    const lod1 = DECOR_LOD1[fam];
    if (lod1 !== undefined) decor.set(`${fam}_lod1`, url(lod1));
  }
  const props = new Map<string, string>([...plan.props].map((k): [string, string] => [k, url(PROP_MESHES[k])]));
  await Promise.all([r.loadDecorMeshes(decor), r.loadPropMeshes(props)]);
}

/**
 * One animation tick. WebGPURenderer advances `nodeFrame.frameId` ONLY in its own internal rAF loop (`Animation.start`), and the
 * scene `PassNode` is `updateBeforeType = FRAME`: it redraws the scene at most once per frameId. Frames pumped inside one task
 * (the old loop never yielded on F: `whenSubmitted` is `Promise.resolve()` on the WebGL backend) drew only the output quad, so
 * F's CPU render read 0 ms and its triangles did not follow zoom. The same tick also RESETS `renderer.info` on the node arms
 * (`info.autoReset`), so the stats are read synchronously after the frame, before anything can yield. Every arm waits the same
 * tick, so the timing contract stays one contract: the app's own loop draws once per rAF too.
 */
const tick = (): Promise<void> => new Promise((res) => requestAnimationFrame(() => res()));

/**
 * Warm-up frames before the stats frame. One more than the node backend's `CENSUS_EVERY_FRAMES` (60, `node-backend.ts`), so a
 * census has run since the last spawn on F and G: newly spawned units' occlusion outlines are hidden by then, and the stats
 * frame sees the scene the timed frames see.
 */
const WARM_FRAMES = 61;

/**
 * What legacy L is timed as. `shipped`: the player's frame. `matched` (the default): the scene the P0 node chain draws, which is
 * legacy MINUS what the node arms cannot draw yet (measured on wadi_halam_4 z1, 300 figures, 5 Nov). The GTAO normal pre-pass
 * (a third draw of the scene: 10.54 M -> 7.80 M triangles) USED to be switched off here; P1 T7 gave the node chain its own AO, so
 * matched L keeps it on and the arms draw the same three scene passes. What is still removed:
 *  - every `ShaderMaterial` object (and, until GH-943 P3 T5 gave it a twin, the occlusion outline), which `censusUnported` hides on
 *    the node arms: the SAME function is run on L's scene here, so the hidden set is the node arms' by construction (7.58 M -> 5.312005 M,
 *    against the node arms' 5.311988 M: 17 triangles apart).
 * The screen-space post passes (fog, bloom, SMAA, grade, vignette) stay on L: they cost fragments, not triangles, and they are
 * stated with the result as the bias they are (in the node arms' favour). With `shipped`, the triangle refusal refuses, correctly.
 */
export type LegacyScene = 'matched' | 'shipped';

function matchNodeScene(r: RendererLike): void {
  censusUnported(r.scene as unknown as Parameters<typeof censusUnported>[0]);
}

export interface Stats {
  med: number;
  p95: number;
}
const stats = (v: number[]): Stats => {
  const s = [...v].sort((a, b) => a - b);
  return { med: s[Math.floor(s.length / 2)] as number, p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] as number };
};

export interface Row {
  synced: Stats;
  cpuFrame: Stats;
  cpuRender: Stats;
  /** Triangles of the passes every arm draws (shadow + scene); legacy's GTAO pre-pass excluded. */
  triangles: number;
  /** Every triangle the frame drew (legacy: with the GTAO pre-pass). Report-only. */
  frameTriangles: number;
  calls: number;
  entries: number;
  /** GH-943 P3 T13 (H5): the census's mean cost per timed frame, left out of `cpuRender` (0 on L). */
  censusMs: number;
}

function batches(r: RendererLike): BatchedLike[] {
  const out: BatchedLike[] = [];
  r.scene.traverse((o) => {
    if (o.isBatchedMesh) out.push(o);
  });
  return out;
}

const entriesNow = (r: RendererLike): number => batches(r).reduce((n, b) => n + (b._multiDrawCount ?? 0), 0);

/** Times `frames` frames of the current view/config, after warm-up frames (pipelines, uploads, cull memo). */
export async function timeFrames(r: RendererLike, frames: number, beforeMeasure: () => void = () => {}): Promise<Row> {
  const node = r.nodeBackend;
  // GPU idle by a 1x1 readPixels on both WebGL arms (L and F): the node backend's `whenSubmitted` resolves at once on its WebGL2
  // backend (no device), so F's "synced" was CPU time only. `onSubmittedWorkDone` on G alone.
  const gl = r.backendInfo().kind === 'node-webgpu' ? null : (r.canvas.getContext('webgl2') as WebGL2RenderingContext | null);
  if (r.backendInfo().kind !== 'node-webgpu' && gl === null) throw new Error('no webgl2 context on a WebGL arm');
  const px = new Uint8Array(4);
  const sync = async (): Promise<void> => {
    if (gl) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    else await r.whenGpuIdle();
  };
  // Wrap the render call alone. GH-943 P3 T13 (H5): the census walk the node backend runs inside `render` every 60th frame is LEFT
  // OUT of cpuRender and summed into `censusMs` (`stats().censusMs`, what it cost inside that frame's call; 0 on an older tree).
  let renderMs = 0;
  let censusMs = 0;
  let restore: () => void;
  if (node) {
    const orig = node.render;
    node.render = (...a: [unknown, unknown]) => {
      const t = performance.now();
      orig.apply(node, a);
      const dt = performance.now() - t;
      const c = node.stats().censusMs ?? 0;
      renderMs += dt - c;
      censusMs += c;
    };
    restore = () => {
      node.render = orig;
    };
  } else if (r.post) {
    const post = r.post;
    const orig = post.render;
    post.render = () => {
      const t = performance.now();
      orig.call(post);
      renderMs += performance.now() - t;
    };
    restore = () => {
      post.render = orig;
    };
  } else throw new Error('no render call to wrap');
  try {
    for (let i = 0; i < WARM_FRAMES; i++) {
      await tick();
      r.frame(1, 16);
      await sync();
    }
    beforeMeasure();
    let calls = 0;
    let triangles = 0;
    let frameTriangles = 0;
    await tick();
    if (node) {
      r.frame(1, 0);
      // Before any await: the next animation tick resets the node renderer's info (G read 0 when this followed the sync).
      const i = node.stats();
      calls = i.calls;
      triangles = i.triangles;
      frameTriangles = i.triangles;
      await sync();
    } else {
      // Legacy draws the scene a third time, GTAO's normal pre-pass (`WorldGTAOPass`), and since P1 T7 the node chain does too
      // (`AoPrePass`). Both arms now count it, so `triangles` and `frameTriangles` are the same whole-frame number.
      const info = r.renderer.info;
      info.autoReset = false;
      info.reset();
      r.frame(1, 0);
      triangles = info.render.triangles;
      calls = info.render.calls;
      info.autoReset = true;
      frameTriangles = triangles;
      await sync();
    }
    const entries = entriesNow(r);
    const synced: number[] = [];
    const cpuFrame: number[] = [];
    const cpuRender: number[] = [];
    censusMs = 0;
    for (let i = 0; i < frames; i++) {
      await tick();
      renderMs = 0;
      const t0 = performance.now();
      r.frame(1, 0);
      const t1 = performance.now();
      await sync();
      const t2 = performance.now();
      synced.push(t2 - t0);
      cpuFrame.push(t1 - t0);
      cpuRender.push(renderMs);
    }
    return { synced: stats(synced), cpuFrame: stats(cpuFrame), cpuRender: stats(cpuRender), triangles, frameTriangles, calls, entries, censusMs: frames > 0 ? censusMs / frames : 0 };
  } finally {
    restore();
  }
}

export interface ProbeView {
  zoom: number;
  cpuRenderMs: number;
  triangles: number;
  frameTriangles: number;
  syncedMs: number;
  cpuFrameMs: number;
  entriesCullOn: number;
  entriesCullOff: number;
}

/** The harness-refusal probes (z1 and z2.5): triangles, BatchedMesh entries with the cull on and off, CPU render. */
export async function probeViews(r: RendererLike, zooms: number[], frames: number, beforeMeasure: () => void = () => {}): Promise<ProbeView[]> {
  const out: ProbeView[] = [];
  for (const z of zooms) {
    r.camera.zoom = z;
    const on = await timeFrames(r, frames, beforeMeasure);
    const bs = batches(r);
    for (const b of bs) b.perObjectFrustumCulled = false;
    await tick();
    r.frame(1, 0);
    await r.whenGpuIdle();
    const entriesCullOff = entriesNow(r);
    for (const b of bs) b.perObjectFrustumCulled = true;
    out.push({ zoom: z, cpuRenderMs: on.cpuRender.med, triangles: on.triangles, frameTriangles: on.frameTriangles, syncedMs: on.synced.med, cpuFrameMs: on.cpuFrame.med, entriesCullOn: on.entries, entriesCullOff });
  }
  return out;
}

export interface ArmRun {
  arm: ArmId;
  backendKind: string;
  adapter: string;
  rafSource: string;
  legacyScene: LegacyScene;
  unportedCount: number;
  points: { target: number; living: number; row: Row }[];
  views: ProbeView[];
}

const GPU_OF: Record<ArmId, 'legacy' | 'webgl2' | 'webgpu'> = { L: 'legacy', F: 'webgl2', G: 'webgpu' };

/** One arm of the figure curve: a private Sim + ThreeRenderer on `mapId`, the all-mesh roster, the sim held still. */
export async function runArm(o: {
  mapId: keyof typeof maps;
  arm: ArmId;
  counts: number[];
  frames: number;
  viewFrames: number;
  legacyScene?: LegacyScene;
  /** GH-943 P3 T14b: the node draw switches for a node arm (`--node-opts=`); never passed on L. */
  nodeDraw?: NodeDrawOptions;
}): Promise<ArmRun> {
  const legacyScene = o.legacyScene ?? 'matched';
  const capacity = Math.max(...o.counts) + 50;
  const { sim, map, typeOf } = buildWorld(capacity, o.mapId);
  // `environmentLight: false` on every arm: the L1 sky is a legacy PMREM the node backend does not draw until P1.
  const opts = { ...buildRendererOptions(), environmentLight: false, gpu: GPU_OF[o.arm], ...(o.nodeDraw !== undefined && o.arm !== 'L' ? { nodeDraw: o.nodeDraw } : {}) };
  const { ThreeRenderer } = await import('../../../packages/render/src/three/ThreeRenderer');
  const renderer = new ThreeRenderer(sim, opts);
  renderer.setDecor(map.decor);
  renderer.setElevation(map.elevation);
  const host = createHost();
  await renderer.init(host);
  await loadAllMeshes(renderer, map);
  const r = renderer as unknown as RendererLike;
  await loadDecorAndProps(r, map);
  const info = r.backendInfo();
  const anchors = computeAnchors(map);
  const spawner = createSpawner(sim as Sim, typeOf, anchors.friendly, anchors.hostile);
  r.camera.x = (anchors.friendly[0] + anchors.hostile[0]) / 2;
  r.camera.y = (anchors.friendly[1] + anchors.hostile[1]) / 2;
  r.camera.zoom = 0.5;
  const points: ArmRun['points'] = [];
  let views: ProbeView[] = [];
  // After the warm-up, before the stats frame: newly spawned units' outlines exist by then.
  const beforeMeasure = o.arm === 'L' && legacyScene === 'matched' ? () => matchNodeScene(r) : () => {};
  for (const target of o.counts) {
    spawnUpTo(sim, spawner, target);
    renderer.snapshot();
    r.camera.zoom = 0.5;
    const row = await timeFrames(r, o.frames, beforeMeasure);
    points.push({ target, living: livingCount(sim), row });
    if (views.length === 0) views = await probeViews(r, [1, 2.5], o.viewFrames, beforeMeasure);
  }
  const result: ArmRun = {
    arm: o.arm,
    backendKind: info.kind,
    adapter: info.adapter,
    rafSource: String(window.requestAnimationFrame),
    legacyScene,
    unportedCount: r.unportedHooks().length,
    points,
    views,
  };
  renderer.dispose();
  host.remove();
  return result;
}

// ---------------------------------------------------------------------------------------------------------------------------
// GH-943 P3 T13 (GH-1152): the draw-submission probe's page half (`webgpu-submit-probe.ts` drives it, `webgpu-submit-probe-lib.ts`
// decides). One world per page (`submitSetup`), then one reading per (count, variant) (`submitMeasure`), the toggles applied on top
// of the base scene and taken back after. Kept here, beside `runArm`, so the two share one world, one spawn and one timing contract.
// ---------------------------------------------------------------------------------------------------------------------------

interface SubmitRendererLike extends RendererLike {
  setDebugLayerVisible(name: string, visible: boolean): number;
  snapshot(): void;
  dispose(): void;
}
interface GlRendererLike {
  info: { render: { calls: number; triangles: number } };
  shadowMap: { render: (...a: unknown[]) => unknown };
  renderBufferDirect: (camera: unknown, scene: unknown, geometry: unknown, material: unknown, object: unknown, group: unknown) => unknown;
}
interface NodeRendererInternals {
  info: { update: (object: unknown, count: number, instanceCount: number) => void };
  _nodes: { needsRefresh: (ro: NodeRenderObject) => number };
  /** The backend's upload entries (T14's counts): every vertex-attribute, uniform-buffer and texture upload three asks for. */
  backend: Record<UploadMethod, (...a: unknown[]) => unknown>;
}
type UploadMethod = 'updateAttribute' | 'updateBinding' | 'updateTexture';
const UPLOAD_KIND: Readonly<Record<UploadMethod, keyof Uploads>> = { updateAttribute: 'attribute', updateBinding: 'binding', updateTexture: 'texture' };
interface NodeRenderObject {
  object: DrawObjectLike;
  getMonitor(): { hasNode?: boolean; hasAnimation?: boolean };
}
interface MeshLike {
  isMesh?: boolean;
  visible: boolean;
  castShadow: boolean;
  traverse(f: (o: MeshLike) => void): void;
}

interface SubmitState {
  r: SubmitRendererLike;
  sim: Sim;
  spawner: ReturnType<typeof createSpawner>;
  arm: ArmId;
  host: HTMLElement;
  /** The private unit roots (`meshUnitEntities`, `vehicleMeshEntities`), read for H3's castShadow toggle. */
  unitRoots: () => MeshLike[];
  /** The node switches as the page booted (what an H7-H9 toggle puts back). */
  boot: { refreshPolicy: 'three' | 'parked'; matrixWalk: 'every-pass' | 'once' };
}

const SUBMIT_KEY = '__lionsSubmitProbe';
const submitState = (): SubmitState => {
  const s = (window as unknown as Record<string, SubmitState | undefined>)[SUBMIT_KEY];
  if (s === undefined) throw new Error('submit probe: submitSetup was not called on this page');
  return s;
};

/** `RenderObjectRefreshType.FULL` (three 0.186.1 `constants.js`). */
const REFRESH_FULL = 2;

/** One world on this page: the arm's ThreeRenderer, the all-mesh roster, decor and props, the camera on the line, z0.5. */
export async function submitSetup(o: { mapId: keyof typeof maps; arm: ArmId; capacity: number; timestamps: boolean; nodeDraw?: NodeDrawOptions }): Promise<{ backendKind: string; adapter: string; rafSource: string; unported: number; drawSwitches: string }> {
  const { sim, map, typeOf } = buildWorld(o.capacity, o.mapId);
  const opts = { ...buildRendererOptions(), environmentLight: false, gpu: GPU_OF[o.arm], ...(o.timestamps ? { timestamps: true } : {}), ...(o.nodeDraw !== undefined && o.arm !== 'L' ? { nodeDraw: o.nodeDraw } : {}) };
  const { ThreeRenderer } = await import('../../../packages/render/src/three/ThreeRenderer');
  const renderer = new ThreeRenderer(sim, opts);
  renderer.setDecor(map.decor);
  renderer.setElevation(map.elevation);
  const host = createHost();
  await renderer.init(host);
  await loadAllMeshes(renderer, map);
  const r = renderer as unknown as SubmitRendererLike;
  await loadDecorAndProps(r, map);
  const anchors = computeAnchors(map);
  const spawner = createSpawner(sim as Sim, typeOf, anchors.friendly, anchors.hostile);
  r.camera.x = (anchors.friendly[0] + anchors.hostile[0]) / 2;
  r.camera.y = (anchors.friendly[1] + anchors.hostile[1]) / 2;
  r.camera.zoom = 0.5;
  const priv = renderer as unknown as { meshUnitEntities: Map<number, { root: MeshLike }>; vehicleMeshEntities: Map<number, { root: MeshLike }> };
  const unitRoots = (): MeshLike[] => [...priv.meshUnitEntities.values(), ...priv.vehicleMeshEntities.values()].map((e) => e.root);
  const draw = resolveNodeDraw(o.arm === 'L' ? undefined : o.nodeDraw);
  (window as unknown as Record<string, SubmitState>)[SUBMIT_KEY] = { r, sim: sim as Sim, spawner, arm: o.arm, host, unitRoots, boot: { refreshPolicy: draw.refreshPolicy, matrixWalk: draw.matrixWalk } };
  const info = r.backendInfo();
  const sw = (r as unknown as RendererLike).nodeBackend?.drawSwitches?.get();
  return { backendKind: info.kind, adapter: info.adapter, rafSource: String(window.requestAnimationFrame), unported: r.unportedHooks().length, drawSwitches: sw === undefined ? 'n/a' : `refreshPolicy=${sw.refreshPolicy},matrixWalk=${sw.matrixWalk},uploads=${sw.uploads}` };
}

/** Applies a variant (on = the toggle in force) and returns what it changed; `off` puts back exactly what `on` changed. */
function applyVariant(s: SubmitState, variant: VariantId, on: boolean, undo: MeshLike[]): number {
  switch (variant) {
    case 'base':
      return 0;
    case 'decor-props-hidden':
      return s.r.setDebugLayerVisible('decor', !on) + s.r.setDebugLayerVisible('props', !on);
    case 'ao-hidden':
      return s.r.setDebugLayerVisible('ao', !on);
    // GH-943 P3 T14b: the node switches. `off` puts back the page's boot value; a no-op on L (no node backend).
    case 'refresh-unsafe':
    case 'refresh-three':
    case 'walk-every-pass': {
      const sw = (s.r as unknown as RendererLike).nodeBackend?.drawSwitches;
      if (sw === undefined) return 0;
      if (variant === 'walk-every-pass') sw.setMatrixWalk(on ? 'every-pass' : s.boot.matrixWalk);
      else sw.setRefresh(on ? (variant === 'refresh-unsafe' ? 'unsafe-shared' : 'three') : s.boot.refreshPolicy);
      return 1;
    }
    case 'unit-shadow-off': {
      // Nothing per-frame writes a unit mesh's castShadow (grepped: only the builders do), so a plain write holds.
      if (!on) {
        for (const m of undo) m.castShadow = true;
        const n = undo.length;
        undo.length = 0;
        return n;
      }
      for (const root of s.unitRoots()) {
        root.traverse((m) => {
          if (m.isMesh === true && m.castShadow) {
            m.castShadow = false;
            undo.push(m);
          }
        });
      }
      return undo.length;
    }
  }
}

/** The stats frame's per-type and per-pass tallies on L: one `renderBufferDirect` is one draw (a BatchedMesh's multi-draw included). */
function legacyTallies(gl: GlRendererLike, mainScene: unknown): { done: () => { perPass: PerPass; byType: Record<DrawType, number> } } {
  const perPass: PerPass = { shadow: { calls: 0, objects: 0 }, scene: { calls: 0, objects: 0 }, ao: { calls: 0, objects: 0 }, post: { calls: 0, objects: 0 } };
  const byType = emptyByType();
  const last: Record<RenderPassId, unknown> = { shadow: undefined, scene: undefined, ao: undefined, post: undefined };
  const orig = gl.renderBufferDirect;
  gl.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    // The shadow map draws with a null scene (`WebGLShadowMap`); the GTAO normal pre-pass is the main scene under an override
    // material (`WorldGTAOPass`); the composer's quads are another scene.
    const pass: RenderPassId = scene === null ? 'shadow' : scene !== mainScene ? 'post' : (mainScene as { overrideMaterial: unknown }).overrideMaterial !== null ? 'ao' : 'scene';
    perPass[pass].calls++;
    if (last[pass] !== object) {
      perPass[pass].objects++;
      last[pass] = object;
    }
    byType[drawTypeOf(object as DrawObjectLike)]++;
    return orig.call(this, camera, scene, geometry, material, object, group);
  };
  return {
    done: () => {
      gl.renderBufferDirect = orig;
      return { perPass, byType };
    },
  };
}

/** The stats frame's per-type draws and FULL refreshes on a node arm: counting wraps of `info.update` and `_nodes.needsRefresh`. */
function nodeTallies(nr: NodeRendererInternals): { done: () => { byType: Record<DrawType, number>; full: Record<DrawType, number>; reason: FullReason; uploads: Uploads } } {
  const uploads: Uploads = { attribute: 0, binding: 0, texture: 0 };
  const be = nr.backend;
  const restoreUploads = (Object.keys(UPLOAD_KIND) as UploadMethod[]).map((k) => {
    const own = Object.prototype.hasOwnProperty.call(be, k);
    const orig = be[k];
    be[k] = function (this: unknown, ...a: unknown[]) {
      uploads[UPLOAD_KIND[k]]++;
      return orig.apply(this, a);
    };
    return (): void => {
      if (own) be[k] = orig;
      else delete (be as Partial<Record<UploadMethod, unknown>>)[k];
    };
  });
  const byType = emptyByType();
  const full = emptyByType();
  const reason: FullReason = { hasNode: 0, hasAnimation: 0, other: 0 };
  const info = nr.info;
  const nodes = nr._nodes;
  const ownUpdate = Object.prototype.hasOwnProperty.call(info, 'update');
  const ownRefresh = Object.prototype.hasOwnProperty.call(nodes, 'needsRefresh');
  const update = info.update;
  const refresh = nodes.needsRefresh;
  info.update = function (object, count, instanceCount) {
    byType[drawTypeOf(object as DrawObjectLike)]++;
    update.call(this, object, count, instanceCount);
  };
  nodes.needsRefresh = function (ro) {
    const t = refresh.call(this, ro);
    if (t === REFRESH_FULL) {
      full[drawTypeOf(ro.object)]++;
      const m = ro.getMonitor();
      if (m.hasNode === true) reason.hasNode++;
      else if (m.hasAnimation === true) reason.hasAnimation++;
      else reason.other++;
    }
    return t;
  };
  return {
    done: () => {
      if (ownUpdate) info.update = update;
      else delete (info as { update?: unknown }).update;
      if (ownRefresh) nodes.needsRefresh = refresh;
      else delete (nodes as { needsRefresh?: unknown }).needsRefresh;
      for (const r of restoreUploads) r();
      return { byType, full, reason, uploads };
    },
  };
}

/**
 * One reading: spawn up to `n`, apply `variant`, `warmFrames` warm-up frames (61 after a spawn, so a node census has run), the stats
 * frame (counts), then `frames` timed frames (0 on a counts-only run) and `gpuFrames` GPU-time frames (a timestamps page only), then
 * the toggle is taken back. On L-matched the census hides the node set before the stats frame, as `runArm` does.
 */
export async function submitMeasure(o: { n: number; variant: VariantId; frames: number; warmFrames: number; gpuFrames: number }): Promise<SubmitReading> {
  const s = submitState();
  const { r, sim, spawner, arm } = s;
  // ONE snapshot per spawn, as `runArm` does. The Metal hold (2026-11-10) and both CI runs called `snapshot()` before EVERY reading,
  // and the drawn scene grew with the calls, with no sim tick between them (n300: 435 skinned draws at the 1st and 2nd call, 708 at
  // the 3rd, 1295 at the 4th, on L and G alike, byte-identical across runs), so every toggle after the second read a bigger scene than
  // its base. Why repeated snapshots change the drawn set is not diagnosed here (GH-1152 T13 report).
  const before = sim.entityCount;
  spawnUpTo(sim, spawner, o.n);
  if (sim.entityCount !== before) r.snapshot();
  r.camera.zoom = 0.5;
  const undo: MeshLike[] = [];
  const applied = applyVariant(s, o.variant, true, undo);
  try {
    const node = r.nodeBackend;
    const isGpu = r.backendInfo().kind === 'node-webgpu';
    const gl = isGpu ? null : (r.canvas.getContext('webgl2') as WebGL2RenderingContext | null);
    const px = new Uint8Array(4);
    const sync = async (): Promise<void> => {
      if (gl) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      else await r.whenGpuIdle();
    };
    const settled = await settleScene(s, o.warmFrames, sync);
    if (arm === 'L') matchNodeScene(r);
    // The stats frame.
    let perPass: PerPass;
    let byType: Record<DrawType, number>;
    let fullRefresh: Record<DrawType, number> | null = null;
    let fullReason: FullReason | null = null;
    let uploads: Uploads | null = null;
    let drawCounts: SubmitReading['drawCounts'] = null;
    let calls: number;
    let triangles: number;
    await tick();
    if (node) {
      const nr = node.post?.pipeline?.renderer as NodeRendererInternals | undefined;
      if (nr === undefined) throw new Error('submit probe: the node post chain is not built (no pipeline renderer)');
      const t = nodeTallies(nr);
      node.drawSwitches?.takeCounts();
      r.frame(1, 0);
      const st = node.stats();
      drawCounts = node.drawSwitches?.takeCounts() ?? null;
      const got = t.done();
      if (st.perPass === undefined) throw new Error('submit probe: the node backend has no per-pass counter (an older tree)');
      perPass = st.perPass;
      calls = st.calls;
      triangles = st.triangles;
      byType = got.byType;
      fullRefresh = got.full;
      fullReason = got.reason;
      uploads = got.uploads;
    } else {
      const glr = r.renderer as unknown as GlRendererLike;
      const info = r.renderer.info;
      info.autoReset = false;
      info.reset();
      const t = legacyTallies(glr, r.scene);
      r.frame(1, 0);
      const got = t.done();
      calls = info.render.calls;
      triangles = info.render.triangles;
      info.autoReset = true;
      perPass = got.perPass;
      byType = got.byType;
    }
    await sync();
    // The timed frames: the same contract as `timeFrames` (the census left out of cpuRender on the node arms).
    let cpuRenderMs: number | null = null;
    let cpuRenderInclCensusMs: number | null = null;
    let censusMs: number | null = null;
    if (o.frames > 0) {
      const t = await timedOnly(s, o.frames);
      cpuRenderMs = t.cpuRenderMs;
      cpuRenderInclCensusMs = t.cpuRenderInclCensusMs;
      censusMs = t.censusMs;
    }
    const gpu: number[] = [];
    if (o.gpuFrames > 0 && node?.gpuTimeMs !== undefined) {
      await node.gpuTimeMs();
      for (let i = 0; i < o.gpuFrames; i++) {
        await tick();
        r.frame(1, 0);
        await r.whenGpuIdle();
        const ms = await node.gpuTimeMs();
        if (ms !== null) gpu.push(ms);
      }
    }
    return { arm, n: o.n, living: livingCount(sim), variant: o.variant, applied, settleFrames: settled.frames, settled: settled.ok, perPass, calls, triangles, byType, fullRefresh, fullReason, uploads, drawCounts, cpuRenderMs, cpuRenderInclCensusMs, censusMs, gpuMs: medianOrNull(gpu), profileTop: [] };
  } finally {
    applyVariant(s, o.variant, false, undo);
  }
}

/** The longest a reading waits for the scene to stop changing (frames). */
const SETTLE_MAX_FRAMES = 900;
/** Frames the unit signature must hold unchanged. */
const SETTLE_STILL_FRAMES = 20;

/**
 * The unit scene's signature: how many unit roots exist and how many meshes under them are visible. The first CI run (GH-1152 T13,
 * run 42728357786) read the base 61 frames after a spawn and the variants after it, and the figures were STILL being realised
 * (n300: 435 skinned draws in the base, 1295 three readings later, on both arms), so the toggles' count deltas were the scene
 * filling in, not the toggles: H4 "moved" while the AO pre-pass drew nothing.
 */
function unitSignature(s: SubmitState): string {
  const roots = s.unitRoots();
  let visible = 0;
  for (const root of roots) {
    root.traverse((m) => {
      if (m.isMesh === true && m.visible) visible++;
    });
  }
  return `${roots.length}:${visible}`;
}

/**
 * Warm-up until the unit scene has stopped changing: at least `minFrames`, then until the signature holds for
 * `SETTLE_STILL_FRAMES` frames, and on a node arm until one census has run after the last change (it hides what a newly realised
 * mesh brought). Gives up at `SETTLE_MAX_FRAMES`; `ok` false is a refusal (a reading of a moving scene).
 */
async function settleScene(s: SubmitState, minFrames: number, sync: () => Promise<void>): Promise<{ frames: number; ok: boolean }> {
  const { r } = s;
  const node = r.nodeBackend;
  let last = '';
  let still = 0;
  let censusSinceChange = node === null;
  for (let i = 0; i < SETTLE_MAX_FRAMES; i++) {
    await tick();
    r.frame(1, 16);
    if (node !== null && (node.stats().censusMs ?? 0) > 0) censusSinceChange = true;
    await sync();
    const sig = unitSignature(s);
    if (sig === last) still++;
    else {
      last = sig;
      still = 0;
      censusSinceChange = node === null;
    }
    if (i + 1 >= minFrames && still >= SETTLE_STILL_FRAMES && censusSinceChange) return { frames: i + 1, ok: true };
  }
  return { frames: SETTLE_MAX_FRAMES, ok: false };
}

/** `frames` timed frames of the current state and nothing else (the profile window wraps exactly this call). */
export async function submitTimeOnly(frames: number): Promise<{ cpuRenderMs: number; cpuRenderInclCensusMs: number; censusMs: number }> {
  return timedOnly(submitState(), frames);
}

async function timedOnly(s: SubmitState, frames: number): Promise<{ cpuRenderMs: number; cpuRenderInclCensusMs: number; censusMs: number }> {
  const { r } = s;
  const node = r.nodeBackend;
  const isGpu = r.backendInfo().kind === 'node-webgpu';
  const gl = isGpu ? null : (r.canvas.getContext('webgl2') as WebGL2RenderingContext | null);
  const px = new Uint8Array(4);
  let renderMs = 0;
  let censusFrame = 0;
  let restore: () => void;
  if (node) {
    const orig = node.render;
    node.render = (...a: [unknown, unknown]) => {
      const t = performance.now();
      orig.apply(node, a);
      renderMs += performance.now() - t;
      censusFrame += node.stats().censusMs ?? 0;
    };
    restore = () => {
      node.render = orig;
    };
  } else if (r.post) {
    const post = r.post;
    const orig = post.render;
    post.render = () => {
      const t = performance.now();
      orig.call(post);
      renderMs += performance.now() - t;
    };
    restore = () => {
      post.render = orig;
    };
  } else throw new Error('no render call to wrap');
  const excl: number[] = [];
  const incl: number[] = [];
  let census = 0;
  try {
    for (let i = 0; i < frames; i++) {
      await tick();
      renderMs = 0;
      censusFrame = 0;
      r.frame(1, 0);
      if (gl) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      else await r.whenGpuIdle();
      incl.push(renderMs);
      excl.push(renderMs - censusFrame);
      census += censusFrame;
    }
  } finally {
    restore();
  }
  return { cpuRenderMs: stats(excl).med, cpuRenderInclCensusMs: stats(incl).med, censusMs: frames > 0 ? census / frames : 0 };
}

/** One row of the upload census: what was uploaded, by whom, how often and how many bytes in the frame. */
export interface UploadRow {
  readonly kind: 'attribute' | 'texture' | 'gl-buffer' | 'gl-texture' | 'app-bump' | 'hidden';
  readonly what: string;
  readonly calls: number;
  readonly bytes: number;
}

/**
 * GH-1152 (12 Nov): ONE frame of the current state, every GPU upload named. Node arms: `backend.updateAttribute` (attributed to the
 * object whose geometry `_geometries.updateForRender` is updating, and its attribute name) and `backend.updateTexture` (by texture
 * name, class and size). L: the WebGL2 context's `bufferSubData` / `bufferData` / `texSubImage2D` / `texImage2D`, by call only.
 */
export async function submitUploadCensus(): Promise<UploadRow[]> {
  const s = submitState();
  const { r } = s;
  const node = r.nodeBackend;
  const rows = new Map<string, { kind: UploadRow['kind']; what: string; calls: number; bytes: number }>();
  const add = (kind: UploadRow['kind'], what: string, bytes: number): void => {
    const k = `${kind}|${what}`;
    const cur = rows.get(k) ?? { kind, what, calls: 0, bytes: 0 };
    cur.calls++;
    cur.bytes += bytes;
    rows.set(k, cur);
  };
  const restores: (() => void)[] = [];
  const wrap = <O extends object>(o: O, k: string, f: (orig: (...a: unknown[]) => unknown) => (...a: unknown[]) => unknown): void => {
    const rec = o as unknown as Record<string, (...a: unknown[]) => unknown>;
    const own = Object.prototype.hasOwnProperty.call(o, k);
    const orig = rec[k] as (...a: unknown[]) => unknown;
    rec[k] = f(orig);
    restores.push(() => {
      if (own) rec[k] = orig;
      else delete rec[k];
    });
  };
  type Attr = { array?: ArrayLike<number> & { byteLength?: number }; isInterleavedBufferAttribute?: boolean; data?: { array?: { byteLength?: number } }; name?: string };
  type Obj = {
    type?: string;
    name?: string;
    visible?: boolean;
    material?: { name?: string; type?: string } | unknown[];
    geometry?: { attributes?: Record<string, unknown>; index?: unknown; drawRange?: { count: number } };
    instanceMatrix?: unknown;
    instanceColor?: unknown;
    parent?: Obj | null;
  };
  const label = (o: Obj | null): string => {
    if (o === null) return '(no object)';
    let named: Obj | null | undefined = o;
    for (let i = 0; i < 4 && named && (named.name ?? '') === ''; i++) named = named.parent;
    const m = Array.isArray(o.material) ? undefined : (o.material as { name?: string; type?: string } | undefined);
    return `${o.type ?? '?'}:${(named?.name ?? '') || '?'} [${m?.name || m?.type || '?'}]`;
  };
  // Arm-agnostic: which attributes the APP bumped this frame (version delta over the frame), whoever draws them.
  type VAttr = { version?: number; count?: number; usage?: number; updateRanges?: unknown[]; array?: { byteLength?: number } };
  const versions = new Map<VAttr, { at: number; what: string }>();
  (r.scene as unknown as { traverse(f: (o: Obj) => void): void }).traverse((o) => {
    for (const [k, v] of Object.entries(o.geometry?.attributes ?? {})) versions.set(v as VAttr, { at: (v as VAttr).version ?? 0, what: `${label(o)} .${k}` });
    if (o.instanceMatrix !== undefined) versions.set(o.instanceMatrix as VAttr, { at: (o.instanceMatrix as VAttr).version ?? 0, what: `${label(o)} .instanceMatrix` });
  });
  if (node) {
    const nr = node.post?.pipeline?.renderer as unknown as { backend: object; _geometries: object } | undefined;
    if (nr === undefined) throw new Error('upload census: the node post chain is not built');
    let cur: Obj | null = null;
    wrap(nr._geometries, 'updateForRender', (orig) =>
      function (this: unknown, ...a: unknown[]) {
        const prev = cur;
        cur = ((a[0] as { object?: Obj }).object ?? null) as Obj | null;
        try {
          return orig.apply(this, a);
        } finally {
          cur = prev;
        }
      }
    );
    wrap(nr.backend, 'updateAttribute', (orig) =>
      function (this: unknown, ...a: unknown[]) {
        const at = a[0] as Attr;
        let name = '?';
        if (cur !== null) {
          if (cur.instanceMatrix === at) name = 'instanceMatrix';
          else if (cur.instanceColor === at) name = 'instanceColor';
          else if (cur.geometry?.index === at) name = 'index';
          else for (const [k, v] of Object.entries(cur.geometry?.attributes ?? {})) if (v === at) name = k;
        }
        const bytes = (at.isInterleavedBufferAttribute === true ? at.data?.array?.byteLength : at.array?.byteLength) ?? 0;
        const ranges = (at as { updateRanges?: { count: number }[] }).updateRanges ?? [];
        const ranged = ranges.reduce((n, g) => n + g.count * ((at.array as { BYTES_PER_ELEMENT?: number } | undefined)?.BYTES_PER_ELEMENT ?? 4), 0);
        add('attribute', `${label(cur)} .${name} (drawRange ${cur?.geometry?.drawRange?.count ?? '?'}, ${ranges.length} update ranges)`, ranges.length > 0 ? ranged : bytes);
        return orig.apply(this, a);
      }
    );
    wrap(nr.backend, 'updateTexture', (orig) =>
      function (this: unknown, ...a: unknown[]) {
        const t = a[0] as { name?: string; constructor: { name: string }; image?: { width?: number; height?: number; data?: { byteLength?: number } } };
        add('texture', `${t.constructor.name}:${t.name ?? ''} ${t.image?.width ?? '?'}x${t.image?.height ?? '?'}`, t.image?.data?.byteLength ?? 0);
        return orig.apply(this, a);
      }
    );
  } else {
    const gl = r.canvas.getContext('webgl2') as WebGL2RenderingContext | null;
    if (gl === null) throw new Error('upload census: no webgl2 context on L');
    const g = gl as unknown as object;
    for (const k of ['bufferSubData', 'bufferData'] as const)
      wrap(g, k, (orig) =>
        function (this: unknown, ...a: unknown[]) {
          // bufferData(target, srcData | size, usage); bufferSubData(target, dstByteOffset, srcData, srcOffset?, length?) (elements).
          const src = (k === 'bufferData' ? a[1] : a[2]) as { byteLength?: number; BYTES_PER_ELEMENT?: number } | number;
          const bpe = typeof src === 'number' ? 1 : (src?.BYTES_PER_ELEMENT ?? 1);
          const bytes = typeof src === 'number' ? src : typeof a[4] === 'number' ? a[4] * bpe : (src?.byteLength ?? 0) - (typeof a[3] === 'number' ? a[3] * bpe : 0);
          add('gl-buffer', k, bytes);
          return orig.apply(this, a);
        }
      );
    for (const k of ['texSubImage2D', 'texImage2D'] as const)
      wrap(g, k, (orig) =>
        function (this: unknown, ...a: unknown[]) {
          const w = typeof a[4] === 'number' ? `${a[4]}x${String(a[5])}` : '?';
          add('gl-texture', `${k} ${w}`, 0);
          return orig.apply(this, a);
        }
      );
  }
  try {
    await tick();
    r.frame(1, 0);
  } finally {
    for (const f of restores.reverse()) f();
  }
  // What this arm leaves hidden (a mesh with `visible` false), by material: L's `matchNodeScene` hides every legacy ShaderMaterial,
  // while G draws a node twin of many, so the two drawn sets can differ.
  (r.scene as unknown as { traverse(f: (o: Obj & { isMesh?: boolean }) => void): void }).traverse((o) => {
    if (o.isMesh === true && o.visible === false) add('hidden', label(o), 0);
  });
  for (const [a, v] of versions) {
    if ((a.version ?? 0) === v.at) continue;
    const ranges = a.updateRanges?.length ?? 0;
    add('app-bump', `${v.what} (+${(a.version ?? 0) - v.at}, usage ${a.usage}, ${ranges} update ranges)`, a.array?.byteLength ?? 0);
  }
  return [...rows.values()].sort((a, b) => b.bytes - a.bytes || b.calls - a.calls);
}

/** Takes the page's world down. */
export function submitDispose(): void {
  const s = submitState();
  s.r.dispose();
  s.host.remove();
  delete (window as unknown as Record<string, SubmitState | undefined>)[SUBMIT_KEY];
}
