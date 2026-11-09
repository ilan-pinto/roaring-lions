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
import type { ArmId } from './webgpu-refusals';

interface BatchedLike {
  isBatchedMesh?: boolean;
  perObjectFrustumCulled?: boolean;
  _multiDrawCount?: number;
}

interface NodeBackendLike {
  render(scene: unknown, camera: unknown): void;
  whenSubmitted(): Promise<void>;
  stats(): { calls: number; triangles: number };
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
  // Wrap the render call alone.
  let renderMs = 0;
  let restore: () => void;
  if (node) {
    const orig = node.render;
    node.render = (...a: [unknown, unknown]) => {
      const t = performance.now();
      orig.apply(node, a);
      renderMs += performance.now() - t;
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
    return { synced: stats(synced), cpuFrame: stats(cpuFrame), cpuRender: stats(cpuRender), triangles, frameTriangles, calls, entries };
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
}): Promise<ArmRun> {
  const legacyScene = o.legacyScene ?? 'matched';
  const capacity = Math.max(...o.counts) + 50;
  const { sim, map, typeOf } = buildWorld(capacity, o.mapId);
  // `environmentLight: false` on every arm: the L1 sky is a legacy PMREM the node backend does not draw until P1.
  const opts = { ...buildRendererOptions(), environmentLight: false, gpu: GPU_OF[o.arm] };
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
