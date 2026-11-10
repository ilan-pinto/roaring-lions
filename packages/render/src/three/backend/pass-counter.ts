/**
 * GH-943 P3 (T13, GH-1152): the node frame's draw calls split by pass, for `RenderBackend.stats().perPass`.
 *
 * WebGPURenderer counts every draw in ONE frame counter (`info.render.drawCalls`, bumped by `info.update` inside the backend's `draw`).
 * The four passes a frame makes (the sun's shadow map, the scene pass, the AO normal pre-pass, and the screen-space post quads) all go
 * through `renderer.render(object, camera)`: `ShadowNode.renderShadow`, `PassNode.updateBefore` (scene and AO pre-pass) and
 * `QuadMesh.render`. The shadow render NESTS inside whichever scene-drawing pass first draws a shadow receiver. So this wraps the
 * instance's `render` with a pass stack and attributes the counter's growth to the pass on top of it:
 *  - `info.autoReset = false`, and `beginFrame` resets the counter once, so the frame's own counter holds the whole frame;
 *  - at every pass boundary (entering or leaving a render call) the growth since the last boundary goes to the pass that was on top, and
 *    the baseline is RESET to the counter's current value. The counter itself is never zeroed mid-frame: the sum of the passes must
 *    equal `info.render.drawCalls` (G1), which is three's number, not this file's.
 *  - `objects` counts the distinct objects a pass drew, consecutively deduplicated through a wrap of `info.update` (a BatchedMesh draws
 *    one call per ENTRY on WebGPU, `WebGPUBackend.js` 2124-2146, all for the same object), so `calls - objects` is the per-entry excess.
 *
 * Presentation measurement only. The cost is a closure call per render call (about 20 a frame) and a compare per draw.
 */

export type RenderPassId = 'shadow' | 'scene' | 'ao' | 'post';
export const RENDER_PASSES: readonly RenderPassId[] = ['shadow', 'scene', 'ao', 'post'];

export interface PassTally {
  calls: number;
  objects: number;
}
export type PerPass = Record<RenderPassId, PassTally>;

/** The members of three's `Info` this reads and wraps. */
export interface PassInfoLike {
  autoReset: boolean;
  reset(): void;
  update(object: unknown, count: number, instanceCount: number): void;
  readonly render: { readonly drawCalls: number };
}
export interface PassRendererLike {
  readonly info: PassInfoLike;
  render(object: unknown, camera: unknown): unknown;
}

export interface PassCounter {
  /** Zeroes the frame counter and the tallies. Call before the frame's first render call. */
  beginFrame(): void;
  /** The tallies since the last `beginFrame` (a copy). */
  perPass(): PerPass;
  /** Puts `render`, `info.update` and `info.autoReset` back. */
  dispose(): void;
}

const emptyPerPass = (): PerPass => ({ shadow: { calls: 0, objects: 0 }, scene: { calls: 0, objects: 0 }, ao: { calls: 0, objects: 0 }, post: { calls: 0, objects: 0 } });

/**
 * Wraps `renderer.render` and `renderer.info.update` (instance properties; the prototype is untouched). `classify` names the pass of one
 * render call from its arguments, read at entry (the caller's render target is already set by then).
 */
export function installPassCounter(renderer: PassRendererLike, classify: (object: unknown, camera: unknown) => RenderPassId): PassCounter {
  const info = renderer.info;
  const hadOwnRender = Object.prototype.hasOwnProperty.call(renderer, 'render');
  const hadOwnUpdate = Object.prototype.hasOwnProperty.call(info, 'update');
  const origRender = renderer.render;
  const origUpdate = info.update;
  const autoReset = info.autoReset;
  info.autoReset = false;
  let tally = emptyPerPass();
  const stack: { pass: RenderPassId; last: unknown }[] = [];
  /** The counter's value at the last pass boundary. */
  let mark = 0;
  /** The growth since the last boundary goes to the pass on top (`post` outside any render call). The caller then resets `mark`. */
  const credit = (): void => {
    const top = stack[stack.length - 1];
    tally[top?.pass ?? 'post'].calls += info.render.drawCalls - mark;
  };
  const wrappedRender = function (this: unknown, object: unknown, camera: unknown): unknown {
    const pass = classify(object, camera);
    credit();
    // The reset before this pass (G1's falsification skips it before the AO pre-pass, and the sum double-counts).
    mark = info.render.drawCalls;
    stack.push({ pass, last: undefined });
    try {
      return origRender.call(this, object, camera);
    } finally {
      credit();
      mark = info.render.drawCalls;
      stack.pop();
    }
  };
  const wrappedUpdate = function (this: unknown, object: unknown, count: number, instanceCount: number): void {
    const top = stack[stack.length - 1];
    if (top === undefined) tally.post.objects++;
    else if (top.last !== object) {
      tally[top.pass].objects++;
      top.last = object;
    }
    origUpdate.call(this, object, count, instanceCount);
  };
  (renderer as { render: PassRendererLike['render'] }).render = wrappedRender;
  (info as { update: PassInfoLike['update'] }).update = wrappedUpdate;
  return {
    beginFrame() {
      info.reset();
      tally = emptyPerPass();
      stack.length = 0;
      mark = info.render.drawCalls;
    },
    perPass() {
      // The growth after the last boundary (nothing, unless a draw happened outside every render call) belongs to `post`.
      if (stack.length === 0) {
        credit();
        mark = info.render.drawCalls;
      }
      const out = emptyPerPass();
      for (const p of RENDER_PASSES) out[p] = { ...tally[p] };
      return out;
    },
    dispose() {
      if (hadOwnRender) (renderer as { render: PassRendererLike['render'] }).render = origRender;
      else delete (renderer as { render?: unknown }).render;
      if (hadOwnUpdate) (info as { update: PassInfoLike['update'] }).update = origUpdate;
      else delete (info as { update?: unknown }).update;
      info.autoReset = autoReset;
    },
  };
}
