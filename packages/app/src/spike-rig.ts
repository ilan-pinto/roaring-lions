/**
 * SPIKE (Phase R0). Entry for `spike-rig.html`. Throwaway alongside
 * `packages/render/src/three/spike/`.
 *
 * Thin on purpose: every line of scene, camera and palette work lives in
 * `@lions/render/three-spike`, because `three` belongs to the render package
 * and `app` holds renderers through an interface (CLAUDE.md's one-way
 * `app -> render -> sim`). An `import * as THREE` here would be the first
 * crack in that, and eslint's `no-restricted-imports` guard does not currently
 * cover `packages/app` -- so the discipline has to be kept by hand in this
 * one file rather than by the linter.
 */
import { mountRigSpike } from '@lions/render/three-spike';

// Vite rewrites `new URL(..., import.meta.url)` to a served asset URL, so the
// GLB stays in `art/spike/` rather than being copied into `assets/` (the
// publicDir) where it would read as shipped art.
const GLB_URL = new URL('../../../art/spike/inf_squad_rigged.glb', import.meta.url).href;
// publicDir is the repo-root `assets/`, so `assets/sprites/X` serves at
// `/sprites/X` -- the same path the shipping renderer loads sheets from.
const SHEET_BASE = '/sprites/INF_SQUAD';

const stage = document.getElementById('stage') as HTMLDivElement;
const readout = document.getElementById('readout') as HTMLSpanElement;

const spike = await mountRigSpike(stage, GLB_URL, SHEET_BASE);

// Exposed the way the game exposes `window.__lions`, and for the same kind of
// reason: R0's Q1 is a BETWEEN-FRAMES property. Every single frame is in
// palette by construction -- the LUT cannot emit anything else -- so a
// one-frame census proves nothing about band crawl. Measuring it means
// advancing exactly one frame and diffing the pixels, deterministically, which
// `requestAnimationFrame` cannot give you (a backgrounded tab throttles it to
// a standstill, and a foregrounded one advances by real elapsed time).
// `spike.step()` is that instrument; this makes it reachable from a console or
// a driver script.
(window as unknown as { __rig: typeof spike }).__rig = spike;

const zoomEl = document.getElementById('zoom') as HTMLInputElement;
const clipEl = document.getElementById('clip') as HTMLSelectElement;
const pauseEl = document.getElementById('pause') as HTMLButtonElement;
const stepEl = document.getElementById('step') as HTMLButtonElement;
const yawEl = document.getElementById('yaw') as HTMLInputElement;
const liftEl = document.getElementById('lift') as HTMLInputElement;

let paused = false;

zoomEl.addEventListener('input', () => spike.setZoom(Number(zoomEl.value)));
clipEl.addEventListener('change', () => spike.setClip(clipEl.value as 'move' | 'idle'));
yawEl.addEventListener('input', () => spike.setMeshYaw((Number(yawEl.value) * Math.PI) / 180));
liftEl.addEventListener('input', () => spike.setSpriteLift(Number(liftEl.value)));
pauseEl.addEventListener('click', () => {
  paused = !paused;
  spike.setPaused(paused);
  pauseEl.textContent = paused ? 'play' : 'pause';
});
// Stepping is the instrument Q1 needs: band crawl is a property of the
// difference between two adjacent frames, and it is invisible at 60 fps.
stepEl.addEventListener('click', () => {
  if (!paused) {
    paused = true;
    spike.setPaused(true);
    pauseEl.textContent = 'play';
  }
  spike.step();
});

let last = performance.now();
function loop(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  spike.frame(dt);
  readout.textContent = `figure ${spike.figurePixels().toFixed(0)} px tall · left = rigged mesh · right = shipping INF_SQUAD sheet`;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
