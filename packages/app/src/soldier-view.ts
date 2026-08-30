/**
 * SPIKE entry for `soldier.html`. Thin on purpose: all scene, camera and
 * palette work lives in `@lions/render/three-soldier`, because `three`
 * belongs to the render package (CLAUDE.md's one-way `app -> render -> sim`).
 */
import { mountSoldierView, type SoldierShading } from '@lions/render/three-soldier';

const CLIPS = ['Walking', 'Running', 'Gun_Hold_Left_Turn', 'Side_Shot', 'Shot_and_Blown_Back'] as const;
const urlFor = (name: string) =>
  new URL(`../../../art/blend/soldier/${name}.glb`, import.meta.url).href;

const stage = document.getElementById('stage') as HTMLDivElement;
const readout = document.getElementById('readout') as HTMLSpanElement;
const clipEl = document.getElementById('clip') as HTMLSelectElement;
const shadingEl = document.getElementById('shading') as HTMLButtonElement;
const zoomEl = document.getElementById('zoom') as HTMLInputElement;
const yawEl = document.getElementById('yaw') as HTMLInputElement;
const pauseEl = document.getElementById('pause') as HTMLButtonElement;

let view = await mountSoldierView(stage, urlFor(CLIPS[0]));
let shading: SoldierShading = 'textured';
let paused = false;

function applyControls(): void {
  view.setShading(shading);
  view.setZoom(Number(zoomEl.value));
  view.setYaw((Number(yawEl.value) * Math.PI) / 180);
  view.setPaused(paused);
}

clipEl.addEventListener('change', async () => {
  // Each clip is its own GLB sharing one mesh and skeleton, so switching means
  // reloading rather than swapping an AnimationClip.
  view.dispose();
  view = await mountSoldierView(stage, urlFor(clipEl.value));
  applyControls();
});
shadingEl.addEventListener('click', () => {
  shading = shading === 'textured' ? 'palette' : 'textured';
  shadingEl.textContent = `shading: ${shading}`;
  shadingEl.dataset.on = shading === 'palette' ? '1' : '0';
  view.setShading(shading);
});
zoomEl.addEventListener('input', () => view.setZoom(Number(zoomEl.value)));
yawEl.addEventListener('input', () => view.setYaw((Number(yawEl.value) * Math.PI) / 180));
pauseEl.addEventListener('click', () => {
  paused = !paused;
  view.setPaused(paused);
  pauseEl.textContent = paused ? 'play' : 'pause';
});

let last = performance.now();
function loop(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  view.frame(dt);
  readout.textContent = `${view.clipName()} · ${view.figurePixels().toFixed(0)} px tall · game draws infantry at ~25 px`;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
