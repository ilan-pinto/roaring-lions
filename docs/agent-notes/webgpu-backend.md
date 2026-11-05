# The node (WebGPURenderer) backend: P0 foundations (GH-943)

Design: `_coord/webgpu-primary/design.md` (lead-approved 5 Nov 2026). P0 only: LEGACY STAYS THE DEFAULT and a player sees no change.

- `RendererOptions.gpu` (`auto | webgpu | webgl2 | legacy`, `packages/render/src/gpu.ts`), read from `&gpu=` in the sandbox only (`packages/app/src/gpu-flag.ts`). Absent = legacy.
- `ThreeRenderer` builds a `THREE.WebGLRenderer` ONLY for legacy (`makeGlRenderer`). A node boot never constructs one: two renderers over one scene graph share `light.shadow.map`. `this.renderer` is a getter that throws if a legacy-only path runs on a node boot; every such path is guarded (`photographGround` returns null, `captureView` returns null, the sky environment is not attached) and P1 ports them.
- The node backend is `three/backend/node-backend.ts`, behind its OWN dynamic import. `forceWebGL` is set explicitly and `isWebGPUBackend` is asserted after init. `backendInfo()` says what draws; the one log line is `[lions] renderer: webgpu (<adapter>)` or `renderer: webgl2 fallback: <reason>`.
- P0 draws the scene pass and the output transform only. `three/backend/unported.ts` censuses every `onBeforeCompile` / `ShaderMaterial` / render-target envMap (`renderer.unportedHooks()`); `ShaderMaterial` objects are HIDDEN on the node path.
- Visual gate: `--gpu=legacy|webgl2|webgpu` on `golden-baseline`. The envKey backend term (`-wgl2`, `-wgpu`) comes from `backendInfo()` read on the page; legacy keys are unchanged (pinned against every committed baseline directory). Node arms freeze the loop with `window.__lionsFreezeLoop` (`packages/app/src/frame-freeze.ts`), never a stubbed rAF, and photograph only after two zero-time repaints read byte-identical. Mixed-backend runs are refused (exit 2). Nothing is blessed for a node key before P7.
- `tools/webgpu_ratchet.mjs`: the ESLint ratchet. `PORTED_FILES` starts empty and only gains entries.
- TODO(P7): the four synchronous `webgl2Available` screens switch to `ui/gpu-probe.ts`'s `drawableNow()`; the settings panel and the feedback note show `backendInfo()`.
