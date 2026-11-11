/**
 * GH-943 P3 (T14b, GH-1152) F8: one world-matrix walk per frame on the node renderer.
 *
 * three 0.186.1's `Renderer._renderScene` calls `scene.updateMatrixWorld()` at the top of EVERY `render(scene, camera)` when
 * `scene.matrixWorldAutoUpdate` is set, and a node frame renders the same scene more than once: the scene pass, the sun's shadow map
 * NESTED inside it (`ShadowNode.renderShadow`), and the AO pre-pass when it draws. Legacy's `WebGLShadowMap` reads the one walk the
 * scene render did. T13's G profile at n600: `updateMatrixWorld` 142 ms self over 60 frames against legacy's 80.5.
 *
 * So, inside a FRAME (`run`, which `createNodeBackend.render` wraps around the chain's render), the first `render` of a scene walks it
 * and every later `render` of that scene in the same frame does not: the flag is cleared for the call and put back after it. A
 * render outside a frame (a photograph, a capture) is three's own, untouched. The camera's own update (`camera.parent === null`) is
 * not gated on the scene's flag in three, so the shadow camera still updates.
 *
 * The second walk is redundant unless something writes a transform between the two renders. Nothing in `packages/render/src/three`
 * moves an object in `onBeforeRender` (grepped for T14b: the soft-depth sentinel blits depth, the smoke writes a uniform, the batch
 * cull sorts entries). An `onBeforeRender` that moves its object and calls its own `updateMatrixWorld()` still reaches the shadow pass
 * with its new matrix (G2d's second clause, `matrix-walk.test.ts`): only the SCENE-wide walk is skipped.
 *
 * Presentation only. Nothing here is read by the sim.
 */
export interface WalkSceneLike {
  readonly isScene?: boolean;
  matrixWorldAutoUpdate: boolean;
}
export interface WalkRendererLike {
  render(object: unknown, camera: unknown): unknown;
}

export interface MatrixWalk {
  /** `'once'` skips the repeat walks; `'every-pass'` is three's own. */
  setOnce(once: boolean): void;
  once(): boolean;
  /** Runs `f` as one frame: the walk is done at most once per scene inside it. */
  run<T>(f: () => T): T;
  /** Scene renders inside frames that skipped the walk since the last call (the probe's count), then reset. */
  takeSkipped(): number;
  /** Scene renders inside frames that walked since the last call, then reset. */
  takeWalks(): number;
  dispose(): void;
}

export function installMatrixWalk(renderer: WalkRendererLike, initialOnce: boolean): MatrixWalk {
  const hadOwn = Object.prototype.hasOwnProperty.call(renderer, 'render');
  const orig = renderer.render;
  let once = initialOnce;
  let inFrame = false;
  const walked = new Set<WalkSceneLike>();
  let skipped = 0;
  let walks = 0;
  const wrapped = function (this: unknown, object: unknown, camera: unknown): unknown {
    const scene = object as WalkSceneLike | null;
    if (!inFrame || scene === null || typeof scene !== 'object' || scene.isScene !== true || scene.matrixWorldAutoUpdate !== true) return orig.call(this, object, camera);
    if (!once || !walked.has(scene)) {
      walked.add(scene);
      walks++;
      return orig.call(this, object, camera);
    }
    skipped++;
    scene.matrixWorldAutoUpdate = false;
    try {
      return orig.call(this, object, camera);
    } finally {
      scene.matrixWorldAutoUpdate = true;
    }
  };
  renderer.render = wrapped;
  return {
    setOnce: (v) => {
      once = v;
    },
    once: () => once,
    run<T>(f: () => T): T {
      // Re-entrant: a frame inside a frame is the same frame.
      if (inFrame) return f();
      inFrame = true;
      walked.clear();
      try {
        return f();
      } finally {
        inFrame = false;
        walked.clear();
      }
    },
    takeSkipped: () => {
      const n = skipped;
      skipped = 0;
      return n;
    },
    takeWalks: () => {
      const n = walks;
      walks = 0;
      return n;
    },
    dispose: () => {
      if (hadOwn) renderer.render = orig;
      else delete (renderer as { render?: unknown }).render;
    },
  };
}
