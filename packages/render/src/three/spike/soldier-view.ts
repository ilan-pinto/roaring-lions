/**
 * SPIKE — viewing a supplied rigged soldier in this game's own camera.
 * Throwaway, alongside the rest of `spike/`. Not wired into `ThreeRenderer`.
 *
 * The asset is a Meshy AI biped: 13,910 verts, a 24-joint humanoid rig with
 * Mixamo-style bone names, feet at the origin, 1.67 m tall, and one animation
 * per file across six files sharing the same mesh and skeleton.
 *
 * ## What this is actually for
 *
 * Two questions, and they need different pictures:
 *
 *   1. **What does the asset look like?** Its own textured material, in our
 *      dimetric camera, at the sizes the game draws at. That is the "is this
 *      art any good" question.
 *   2. **What would it look like IN THIS GAME?** Through the palette toon LUT,
 *      which is the only way colour reaches the screen in the three backend.
 *      `data/palette.json` is 42 locked colours and `validate:assets` rejects
 *      anything else, so a 4096px albedo texture cannot ship as-is however
 *      good it looks. This mode is the honest preview.
 *
 * Showing only (1) would flatter the asset; showing only (2) would hide what
 * was bought. So the viewer toggles, and the difference between the two IS the
 * integration cost, made visible rather than argued about.
 *
 * ## The scale chain, which differs from our own art
 *
 * `kit.py` builds at real metres and the three backend draws one unit per
 * tile, so our own figures scale by `1 / UNITS_PER_TILE` (3.0). This asset is
 * also authored in metres (1.67 m tall, feet at y=0), so it takes the same
 * divisor — but it is 1.67 where our soldier is 1.8, so it will read slightly
 * short beside one. That is a real difference, not a bug, and it is left
 * uncorrected here so it is visible rather than silently normalised away.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { dimetricCamera } from '../camera';
import { applyPalettePipeline } from '../palette-material';
import { readRamp } from '../units/mesh-role';
import { toonRampSkinnedMaterial } from '../units/mesh-material';

/** `tools/dimetric.py`'s `UNITS_PER_TILE`: a tile is 3 m, three draws 1 unit
 *  per tile, and this asset is authored in metres like our own. */
const UNITS_PER_TILE = 3.0;

export type SoldierShading = 'textured' | 'palette';

export interface SoldierView {
  frame(dtSeconds: number): void;
  setZoom(zoom: number): void;
  setShading(mode: SoldierShading): void;
  setYaw(radians: number): void;
  setPaused(paused: boolean): void;
  /** On-screen height in CSS pixels — the number that decides whether any of
   *  this detail survives to the player. The rig contract measured infantry at
   *  25 px wide. */
  figurePixels(): number;
  clipName(): string;
  dispose(): void;
}

export async function mountSoldierView(
  host: HTMLElement,
  glbUrl: string
): Promise<SoldierView> {
  const renderer = new THREE.WebGLRenderer({
    // Off, matching the shipping backend: a blended edge pixel is by
    // definition not a palette colour (Phase 0's second finding).
    antialias: false,
  });
  renderer.setPixelRatio(1);
  const vp = { width: host.clientWidth, height: host.clientHeight };
  renderer.setSize(vp.width, vp.height, false);
  applyPalettePipeline(renderer, readRamp('limestone')[3]);
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  // Ground in the game's own limestone, so the silhouette is judged against
  // the tone it would actually sit on rather than against a void.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 8),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color().setStyle(readRamp('limestone')[3], THREE.LinearSRGBColorSpace),
    })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const gltf = await new GLTFLoader().loadAsync(glbUrl);
  const root = gltf.scene;
  root.scale.setScalar(1 / UNITS_PER_TILE);
  scene.add(root);

  // Keep both materials alive so the toggle is instant and neither is rebuilt
  // per switch. The originals are the asset's own PBR; the palette pair is one
  // shared toon ramp, since this mesh has ONE material and no `rl_role` parts
  // to shade separately -- unlike our own figures, which carry seven.
  const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const paletteMat = toonRampSkinnedMaterial(readRamp('olive'));
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) originals.set(m, m.material);
  });

  const mixer = new THREE.AnimationMixer(root);
  const clip = gltf.animations[0];
  if (clip) mixer.clipAction(clip).play();

  let zoom = 1;
  let yaw = 0;
  let paused = false;
  let shading: SoldierShading = 'textured';

  function applyShading(): void {
    for (const [mesh, original] of originals) {
      mesh.material = shading === 'palette' ? paletteMat : original;
    }
  }

  function draw(): void {
    const camera = dimetricCamera({ x: 0, y: 0, zoom }, vp);
    root.rotation.y = yaw;
    renderer.render(scene, camera);
  }

  return {
    frame(dt) {
      if (!paused) mixer.update(dt);
      draw();
    },
    setZoom(z) {
      zoom = z;
    },
    setShading(m) {
      shading = m;
      applyShading();
    },
    setYaw(r) {
      yaw = r;
    },
    setPaused(p) {
      paused = p;
    },
    figurePixels() {
      const box = new THREE.Box3().setFromObject(root);
      const cam = dimetricCamera({ x: 0, y: 0, zoom }, vp);
      return ((box.max.y - box.min.y) / (cam.top - cam.bottom)) * vp.height;
    },
    clipName() {
      return clip ? clip.name : '(no clip)';
    },
    dispose() {
      mixer.stopAllAction();
      paletteMat.dispose();
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    },
  };
}
