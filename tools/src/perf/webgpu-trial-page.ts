// The in-page half of the WebGPU trial's measurement (GH-943 L5, option (b); `webgpu-trial.ts` drives it).
//
// Dynamically imported by a page, from the app's own Vite dev server, through `/@fs/`. Everything here is
// PRESENTATION measurement: it reads frame time from a renderer and never writes the sim except to spawn
// units for the figure curve (on a private `Sim` of its own).
//
// One shared timing contract for both arms, so a difference is the renderer and nothing else:
//   cpuFrame  = `renderer.frame()` return time (everything on the CPU, sim presentation included)
//   cpuRender = the time inside the render call alone (`post.render()` on WebGL2, the trial's `render()` on WebGPU)
//   synced    = frame start to GPU idle: a 1x1 `readPixels` on WebGL2, `queue.onSubmittedWorkDone()` on WebGPU
//   gpuWait   = synced - cpuFrame
// `onSubmittedWorkDone` carries an IPC round trip that `readPixels` does not, so on WebGPU `synced` is an upper
// bound by that latency; the cadence rows (rAF-to-rAF, app loop live) are free of it and are reported beside.
import type { Sim } from '@lions/sim';
import { buildWorld, buildRendererOptions, createHost, loadAllMeshes, computeAnchors, createSpawner, spawnUpTo, livingCount } from './three-units';
import type { maps } from '@lions/data';

/** Layers hidden in BOTH arms: the sheet skips fog, decals, VFX, rain, the L1 sky and the L2 grade. */
export const HIDDEN_LAYERS = [
  'fog',
  'haze',
  'decals',
  'blast-light',
  'flipbook',
  'missiles',
  'overlays',
  'tunnel-xray',
  'supply-route',
  'smoke-screen',
  'swarm',
  'swarm-wrecks',
  'beam',
  'beam-shimmer',
  'garrison-banner',
  'wounded-read',
  'rain',
  'vignette',
  'environment',
  'grade',
] as const;

interface RendererLike {
  camera: { x: number; y: number; zoom: number };
  canvas: HTMLCanvasElement;
  frame(alpha: number, dtMs: number): void;
  setDebugLayerVisible(name: string, visible: boolean): number;
  gpuTrialState?: string;
  gpuTrialReason?: string;
  gpuTrialHandle?(): {
    render: (...a: unknown[]) => void;
    syncGpu(): Promise<void>;
    info(): { calls: number; triangles: number };
    adapter: string;
    unported(): { kind: string; key: string; objects: number }[];
    setPost(on: boolean): void;
  } | null;
  post?: { render: () => void; composer: { passes: { constructor: { name: string }; enabled: boolean }[] } } | null;
  scene: { traverse(f: (o: BatchedLike) => void): void };
  renderer: { info: { autoReset: boolean; reset(): void; render: { calls: number; triangles: number } } };
}

interface BatchedLike {
  isBatchedMesh?: boolean;
  perObjectFrustumCulled?: boolean;
  _multiDrawCount?: number;
}

export interface Stats {
  med: number;
  p95: number;
  mean: number;
}

const stats = (v: number[]): Stats => {
  const s = [...v].sort((a, b) => a - b);
  return { med: s[Math.floor(s.length / 2)] as number, p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] as number, mean: v.reduce((a, b) => a + b, 0) / v.length };
};

export interface Row {
  synced: Stats;
  cpuFrame: Stats;
  cpuRender: Stats;
  gpuWait: Stats;
  calls: number;
  tris: number;
  entries: number;
}

export interface Arm {
  gpu: boolean;
  /** `WEBGL_debug_renderer_info` or the WebGPU adapter description. */
  backend: string;
  /** Hooks the trial could not port (empty on the WebGL arm). */
  unported: { kind: string; key: string; objects: number }[];
}

/** Hides the layers both arms skip, and (WebGL arm) disables the fog pass; checks the arm is what it says. */
export function prepareArm(r: RendererLike, gpu: boolean): Arm {
  for (const l of HIDDEN_LAYERS) r.setDebugLayerVisible(l, false);
  const handle = r.gpuTrialHandle?.() ?? null;
  if (gpu) {
    if (r.gpuTrialState !== 'active' || !handle) throw new Error(`webgpu arm is not active (state ${r.gpuTrialState}, ${r.gpuTrialReason ?? ''})`);
    return { gpu, backend: handle.adapter, unported: handle.unported() };
  }
  if (r.gpuTrialState !== 'off' || handle) throw new Error(`webgl2 arm carries a trial (state ${r.gpuTrialState})`);
  for (const p of r.post?.composer.passes ?? []) if (p.constructor.name === 'FogOfWarPass') p.enabled = false;
  const gl = r.canvas.getContext('webgl2') as WebGL2RenderingContext;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return { gpu, backend: ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown', unported: [] };
}

function batches(r: RendererLike): BatchedLike[] {
  const out: BatchedLike[] = [];
  r.scene.traverse((o) => {
    if (o.isBatchedMesh) out.push(o);
  });
  return out;
}

/** Times `frames` frames of the current view/config. Warm-up frames first (pipelines, uploads, cull memo). */
export async function timeFrames(r: RendererLike, gpu: boolean, frames: number): Promise<Row> {
  const handle = r.gpuTrialHandle?.() ?? null;
  const gl = gpu ? null : (r.canvas.getContext('webgl2') as WebGL2RenderingContext);
  const px = new Uint8Array(4);
  const sync = async (): Promise<void> => {
    if (gl) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    else await handle!.syncGpu();
  };
  // Wrap the render call alone, once per call of this function.
  let renderMs = 0;
  let restore: () => void;
  if (gpu && handle) {
    const orig = handle.render;
    handle.render = (...a: unknown[]) => {
      const t = performance.now();
      orig.apply(handle, a);
      renderMs += performance.now() - t;
    };
    restore = () => {
      handle.render = orig;
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
    // Draw calls and triangles of one frame.
    let calls = 0;
    let tris = 0;
    if (gpu && handle) {
      r.frame(1, 0);
      await sync();
      const i = handle.info();
      calls = i.calls;
      tris = i.triangles;
    } else {
      const info = r.renderer.info;
      info.autoReset = false;
      info.reset();
      r.frame(1, 0);
      calls = info.render.calls;
      tris = info.render.triangles;
      info.autoReset = true;
      await sync();
    }
    const entries = batches(r).reduce((n, b) => n + (b._multiDrawCount ?? 0), 0);
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
    return {
      synced: stats(synced),
      cpuFrame: stats(cpuFrame),
      cpuRender: stats(cpuRender),
      gpuWait: stats(synced.map((s, i) => s - (cpuFrame[i] as number))),
      calls,
      tris,
      entries,
    };
  } finally {
    restore();
  }
}

/** Decor cost: the same view with the decor and prop batches hidden, culled (shipped), and with the cull off. */
export async function timeDecor(r: RendererLike, gpu: boolean, frames: number): Promise<{ hidden: Row; cullOn: Row; cullOff: Row }> {
  r.setDebugLayerVisible('decor', false);
  r.setDebugLayerVisible('props', false);
  const hidden = await timeFrames(r, gpu, frames);
  r.setDebugLayerVisible('decor', true);
  r.setDebugLayerVisible('props', true);
  const cullOn = await timeFrames(r, gpu, frames);
  const bs = batches(r);
  for (const b of bs) b.perObjectFrustumCulled = false;
  const cullOff = await timeFrames(r, gpu, frames);
  for (const b of bs) b.perObjectFrustumCulled = true;
  return { hidden, cullOn, cullOff };
}

export interface ViewResult {
  zoom: number;
  base: Row;
  decor: { hidden: Row; cullOn: Row; cullOff: Row };
}

export async function measureViews(r: RendererLike, gpu: boolean, zooms: number[], frames: number): Promise<ViewResult[]> {
  const out: ViewResult[] = [];
  for (const z of zooms) {
    r.camera.zoom = z;
    const decor = await timeDecor(r, gpu, frames);
    out.push({ zoom: z, base: decor.cullOn, decor });
  }
  return out;
}

/** rAF-to-rAF cadence with the app's own loop live (so BEFORE the loop is frozen). */
export async function cadence(r: RendererLike, zooms: number[], frames: number): Promise<Record<string, { med: number; p95: number; over20: number }>> {
  const out: Record<string, { med: number; p95: number; over20: number }> = {};
  for (const z of zooms) {
    r.camera.zoom = z;
    await new Promise<void>((res) => requestAnimationFrame(() => res()));
    const d: number[] = [];
    let last = performance.now();
    for (let i = 0; i < frames; i++) {
      const now = await new Promise<number>((res) => requestAnimationFrame((t) => res(t)));
      d.push(now - last);
      last = now;
    }
    const s = stats(d);
    out[`z${z}`] = { med: s.med, p95: s.p95, over20: d.filter((v) => v > 20).length / d.length };
  }
  return out;
}

export interface CurvePoint {
  target: number;
  living: number;
  row: Row;
}

/** The figure curve: one private Sim + ThreeRenderer on `mapId`, the all-mesh roster of `three-units.ts`, sim held still. */
export async function runCurve(o: { mapId: keyof typeof maps; counts: number[]; gpu: boolean; frames: number }): Promise<{ arm: Arm; points: CurvePoint[] }> {
  const capacity = Math.max(...o.counts) + 50;
  const { sim, map, typeOf } = buildWorld(capacity, o.mapId);
  const opts = { ...buildRendererOptions(), environmentLight: false, ...(o.gpu ? { gpuTrial: 'webgpu' as const } : {}) };
  const { ThreeRenderer } = await import('../../../packages/render/src/three/ThreeRenderer');
  const renderer = new ThreeRenderer(sim, opts);
  renderer.setDecor(map.decor);
  renderer.setElevation(map.elevation);
  const host = createHost();
  await renderer.init(host);
  await loadAllMeshes(renderer, map);
  const r = renderer as unknown as RendererLike;
  const arm = prepareArm(r, o.gpu);
  const anchors = computeAnchors(map);
  const spawner = createSpawner(sim as Sim, typeOf, anchors.friendly, anchors.hostile);
  r.camera.x = (anchors.friendly[0] + anchors.hostile[0]) / 2;
  r.camera.y = (anchors.friendly[1] + anchors.hostile[1]) / 2;
  r.camera.zoom = 0.5;
  const points: CurvePoint[] = [];
  for (const target of o.counts) {
    spawnUpTo(sim, spawner, target);
    renderer.snapshot();
    const row = await timeFrames(r, o.gpu, o.frames);
    points.push({ target, living: livingCount(sim), row });
  }
  // Re-read after the run: units spawned mid-run bring new materials.
  const after = r.gpuTrialHandle?.()?.unported() ?? [];
  renderer.dispose();
  host.remove();
  return { arm: { ...arm, unported: after }, points };
}
