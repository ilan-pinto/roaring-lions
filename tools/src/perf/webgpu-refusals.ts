// GH-943 WebGPU-primary P0 (design section 6): the harness refusals. A timing taken while one of these holds is not a timing, so
// the ABBA runner REFUSES to report it (exit 2) instead of printing a number. Pure, so each can be driven red by a constructed input
// in `webgpu-refusals.test.ts`.
//
// An "arm" is L (legacy WebGLRenderer), F (node on WebGL2) or G (node on WebGPU).

export type ArmId = 'L' | 'F' | 'G';

export const ARM_KIND: Readonly<Record<ArmId, string>> = { L: 'legacy-gl', F: 'node-webgl2', G: 'node-webgpu' };

/** One measured view on one arm. */
export interface ViewReading {
  readonly zoom: number;
  readonly cpuRenderMs: number;
  /** Triangles of the passes EVERY arm draws (shadow + scene). Legacy's GTAO normal pre-pass is excluded: the P0 node chain has
   *  no AO, so a whole-frame count differs by that pass for every scene and says nothing about whether the scenes match. */
  readonly triangles: number;
  /** The whole frame's triangles, report-only (legacy includes the GTAO pre-pass). */
  readonly frameTriangles?: number;
  /** Median frame-start-to-GPU-idle and frame-call times. A synced time no longer than the CPU frame waited for no GPU at all. */
  readonly syncedMs: number;
  readonly cpuFrameMs: number;
  /** Sum of the BatchedMesh `_multiDrawCount` with the per-object frustum cull ON and OFF. */
  readonly entriesCullOn: number;
  readonly entriesCullOff: number;
}

export interface ArmReading {
  readonly arm: ArmId;
  /** `backendInfo().kind` read from the page. */
  readonly backendKind: string;
  /** `String(window.requestAnimationFrame)` read from the page, after the harness has done everything it will do. */
  readonly rafSource: string;
  /** What the page draws on: `WEBGL_debug_renderer_info`'s unmasked renderer on L and F, the WebGPU adapter on G. */
  readonly gpu: string;
  /** Console lines (error and warning) the page produced during the run. */
  readonly consoleLines: readonly string[];
  readonly views: readonly ViewReading[];
  /** GPU time from timestamp queries in ms, when the adapter offers them; undefined when it does not. */
  readonly gpuTimestampMs?: number | undefined;
  readonly timestampQueryAvailable: boolean;
}

export const TRIANGLE_AGREEMENT = 0.01;
const BAD_CONSOLE = [/GPUValidationError/i, /Destroyed texture/i, /uploaded again/i];

const NATIVE_RAF = /\[native code\]/;

/** Every reason these readings must not be reported. Empty is "report them". */
export function harnessRefusals(arms: readonly ArmReading[], lowZoom = 1, highZoom = 2.5): string[] {
  const out: string[] = [];
  for (const a of arms) {
    // backendInfo().kind equals the arm.
    if (a.backendKind !== ARM_KIND[a.arm]) out.push(`arm ${a.arm}: backendInfo().kind is "${a.backendKind}", expected "${ARM_KIND[a.arm]}" (a fallback is evidence about the fallback)`);
    // Hardware Metal on every arm (this measures SPEED; a player never runs on SwiftShader).
    if (!/metal/i.test(a.gpu) || /swiftshader/i.test(a.gpu)) out.push(`arm ${a.arm}: draws on "${a.gpu}", not hardware Metal`);
    // Native rAF on every arm.
    if (!NATIVE_RAF.test(a.rafSource)) out.push(`arm ${a.arm}: window.requestAnimationFrame is not native code (a stub or wrapper is installed); native rAF is required on every arm`);
    // CPU render > 0.
    for (const v of a.views) {
      if (!(v.cpuRenderMs > 0)) out.push(`arm ${a.arm} z${v.zoom}: CPU render reads ${v.cpuRenderMs} ms; a render call that took no time did not run`);
      // The GPU sync waited for something (F's `whenSubmitted` resolves at once on its WebGL2 backend: synced read cpuFrame).
      if (!(v.syncedMs > v.cpuFrameMs)) out.push(`arm ${a.arm} z${v.zoom}: synced ${v.syncedMs} ms is not above the CPU frame ${v.cpuFrameMs} ms; the sync waited for no GPU`);
    }
    // Zero GPUValidationError, Destroyed texture, uploaded again.
    for (const re of BAD_CONSOLE) {
      const hit = a.consoleLines.find((l) => re.test(l));
      if (hit !== undefined) out.push(`arm ${a.arm}: console carries ${re.source}: "${hit.slice(0, 120)}"`);
    }
    // Triangle counts change between z1 and z2.5 (the view really moved).
    const lo = a.views.find((v) => v.zoom === lowZoom);
    const hi = a.views.find((v) => v.zoom === highZoom);
    if (lo !== undefined && hi !== undefined) {
      if (lo.triangles === hi.triangles) out.push(`arm ${a.arm}: triangle count is ${lo.triangles} at z${lowZoom} and z${highZoom}; the view did not change`);
      // BatchedMesh entries follow zoom and the cull flag.
      if (lo.entriesCullOn === hi.entriesCullOn) out.push(`arm ${a.arm}: BatchedMesh entries are ${lo.entriesCullOn} at z${lowZoom} and z${highZoom} with the cull on; they must follow zoom`);
    }
    for (const v of a.views) {
      if (v.entriesCullOn === v.entriesCullOff) out.push(`arm ${a.arm} z${v.zoom}: BatchedMesh entries are ${v.entriesCullOn} with the cull on AND off; they must follow the cull flag`);
    }
    // Timestamp-query GPU time where available.
    if (a.timestampQueryAvailable && !(typeof a.gpuTimestampMs === 'number' && a.gpuTimestampMs > 0)) {
      out.push(`arm ${a.arm}: timestamp-query is available but no GPU time was read`);
    }
  }
  // Triangle counts agree across arms within 1%.
  const zooms = new Set(arms.flatMap((a) => a.views.map((v) => v.zoom)));
  for (const z of zooms) {
    const t = arms.map((a) => ({ arm: a.arm, tris: a.views.find((v) => v.zoom === z)?.triangles })).filter((x): x is { arm: ArmId; tris: number } => x.tris !== undefined);
    const base = t[0];
    if (base === undefined) continue;
    for (const x of t) {
      if (Math.abs(x.tris - base.tris) > base.tris * TRIANGLE_AGREEMENT) {
        out.push(`z${z}: triangles ${x.arm}=${x.tris} vs ${base.arm}=${base.tris} differ by more than ${TRIANGLE_AGREEMENT * 100}% (the arms are not drawing the same scene)`);
      }
    }
  }
  return out;
}
