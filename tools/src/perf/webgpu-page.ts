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
import type { maps } from '@lions/data';
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
  triangles: number;
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
export async function timeFrames(r: RendererLike, frames: number): Promise<Row> {
  const node = r.nodeBackend;
  const gl = node === null ? (r.canvas.getContext('webgl2') as WebGL2RenderingContext) : null;
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
    for (let i = 0; i < 25; i++) {
      r.frame(1, 16);
      await sync();
    }
    let calls = 0;
    let triangles = 0;
    if (node) {
      r.frame(1, 0);
      await sync();
      const i = node.stats();
      calls = i.calls;
      triangles = i.triangles;
    } else {
      const info = r.renderer.info;
      info.autoReset = false;
      info.reset();
      r.frame(1, 0);
      calls = info.render.calls;
      triangles = info.render.triangles;
      info.autoReset = true;
      await sync();
    }
    const entries = entriesNow(r);
    const synced: number[] = [];
    const cpuFrame: number[] = [];
    const cpuRender: number[] = [];
    for (let i = 0; i < frames; i++) {
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
    return { synced: stats(synced), cpuFrame: stats(cpuFrame), cpuRender: stats(cpuRender), triangles, calls, entries };
  } finally {
    restore();
  }
}

export interface ProbeView {
  zoom: number;
  cpuRenderMs: number;
  triangles: number;
  entriesCullOn: number;
  entriesCullOff: number;
}

/** The harness-refusal probes (z1 and z2.5): triangles, BatchedMesh entries with the cull on and off, CPU render. */
export async function probeViews(r: RendererLike, zooms: number[], frames: number): Promise<ProbeView[]> {
  const out: ProbeView[] = [];
  for (const z of zooms) {
    r.camera.zoom = z;
    const on = await timeFrames(r, frames);
    const bs = batches(r);
    for (const b of bs) b.perObjectFrustumCulled = false;
    r.frame(1, 0);
    await r.whenGpuIdle();
    const entriesCullOff = entriesNow(r);
    for (const b of bs) b.perObjectFrustumCulled = true;
    out.push({ zoom: z, cpuRenderMs: on.cpuRender.med, triangles: on.triangles, entriesCullOn: on.entries, entriesCullOff });
  }
  return out;
}

export interface ArmRun {
  arm: ArmId;
  backendKind: string;
  adapter: string;
  rafSource: string;
  unportedCount: number;
  points: { target: number; living: number; row: Row }[];
  views: ProbeView[];
}

const GPU_OF: Record<ArmId, 'legacy' | 'webgl2' | 'webgpu'> = { L: 'legacy', F: 'webgl2', G: 'webgpu' };

/** One arm of the figure curve: a private Sim + ThreeRenderer on `mapId`, the all-mesh roster, the sim held still. */
export async function runArm(o: { mapId: keyof typeof maps; arm: ArmId; counts: number[]; frames: number; viewFrames: number }): Promise<ArmRun> {
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
  const info = r.backendInfo();
  const anchors = computeAnchors(map);
  const spawner = createSpawner(sim as Sim, typeOf, anchors.friendly, anchors.hostile);
  r.camera.x = (anchors.friendly[0] + anchors.hostile[0]) / 2;
  r.camera.y = (anchors.friendly[1] + anchors.hostile[1]) / 2;
  r.camera.zoom = 0.5;
  const points: ArmRun['points'] = [];
  let views: ProbeView[] = [];
  for (const target of o.counts) {
    spawnUpTo(sim, spawner, target);
    renderer.snapshot();
    r.camera.zoom = 0.5;
    const row = await timeFrames(r, o.frames);
    points.push({ target, living: livingCount(sim), row });
    if (views.length === 0) views = await probeViews(r, [1, 2.5], o.viewFrames);
  }
  const result: ArmRun = {
    arm: o.arm,
    backendKind: info.kind,
    adapter: info.adapter,
    rafSource: String(window.requestAnimationFrame),
    unportedCount: r.unportedHooks().length,
    points,
    views,
  };
  renderer.dispose();
  host.remove();
  return result;
}
