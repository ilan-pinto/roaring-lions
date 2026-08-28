/**
 * SPIKE (Phase R0, `docs/superpowers/specs/2026-08-28-rigged-infantry-design.md`).
 * R0 returned GO (`docs/superpowers/specs/2026-08-28-phase-r0-verdict.md`), so
 * this file's own two load-bearing pieces -- the skinned toon material and the
 * `rl_role` -> ramp-slice table -- were promoted out of this directory into
 * `../units/mesh-material.ts` and `../units/mesh-role.ts`, which the shipped
 * mesh-unit path (`../units/mesh-unit.ts`) now uses too. This file imports
 * both rather than keeping its own copy. What remains here -- the side-by-side
 * judging rig itself -- is still throwaway: a dev-only comparison harness, not
 * wired into `ThreeRenderer`, deletable on its own schedule.
 *
 * A side-by-side judging rig: the code-authored rigged infantry mesh on the
 * left, the SHIPPING `INF_SQUAD` billboard sheet on the right, same camera,
 * same ground, same world scale, same clip. R0 asks two questions and neither
 * is answerable from one figure alone:
 *
 *   Q1 -- does the palette survive skeletal deformation? Specifically: do band
 *         boundaries CRAWL frame to frame at a scale that reads as noise? Use
 *         Pause + Step: a boundary that jumps a whole band between adjacent
 *         frames on a surface that barely moved is the failure. Bands that
 *         travel smoothly across the figure as it walks are correct and are
 *         the entire point of shading it in real time.
 *   Q2 -- does rigged motion read better than the shipping four-frame stride?
 *         The right-hand figure IS that stride (`move`, 4 frames at 10 fps).
 *         Judge at zoom 1 first -- that is gameplay size, and the whole
 *         "blocky is the correct budget" argument in `tools/units/kit.py`
 *         lives there -- then zoom in.
 *
 * ## Why the comparison is built this way
 *
 * Both figures are drawn by the SAME `dimetricCamera` the shipping backend
 * uses, not an approximation of it. A spike that invented its own camera
 * would answer a question about a projection the game does not have.
 *
 * The mesh carries no materials from Blender (the GLB exports zero) -- every
 * colour on it comes from `toonRampSkinnedMaterial` and `rampForRole`
 * (imported above). That is deliberate: it keeps the palette guarantee
 * entirely on this side, where it can be reasoned about, rather than
 * splitting it across an art tool and a shader.
 *
 * ## The scale chain, which is easy to get wrong in two places
 *
 * `tools/units/kit.py` builds at REAL METRES with object scale always 1, and
 * `dimetric.UNITS_PER_TILE` is 3.0 -- so in Blender a tile is 3 units and a
 * standing figure is 1.8. The three.js backend uses ONE unit per tile
 * (`fog-mesh.ts`: "every tile is exactly one unit square"). So the mesh needs
 * `1 / UNITS_PER_TILE`, and the sprite quad needs `frameMetres /
 * UNITS_PER_TILE` -- 3.949 / 3 -- not `frameMetres` and not `realMetres`.
 * Getting either wrong makes one figure bigger than the other and silently
 * turns a fair comparison into a rigged one.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { dimetricCamera } from '../camera';
import { applyPalettePipeline } from '../palette-material';
import { toonRampSkinnedMaterial } from '../units/mesh-material';
import { readRamp, rampForRole, isMeshRole } from '../units/mesh-role';

/** `tools/dimetric.py`'s `UNITS_PER_TILE`. Blender builds at metres; three
 *  draws one unit per tile; a tile is 3 m. */
const UNITS_PER_TILE = 3.0;

export interface RigSpike {
  /** Drive one frame. `dtSeconds` is real frame time -- this is a renderer
   *  spike, there is no sim and no fixed tick to respect. */
  frame(dtSeconds: number): void;
  setZoom(zoom: number): void;
  setClip(clip: 'move' | 'idle'): void;
  setPaused(paused: boolean): void;
  /** Advance exactly one sprite frame and one mixer step while paused --
   *  the instrument Q1 needs, since band crawl is a between-frames property
   *  and cannot be seen at speed. */
  step(): void;
  setMeshYaw(radians: number): void;
  setSpriteLift(worldY: number): void;
  /** On-screen height of the mesh figure in CSS pixels, for judging at
   *  gameplay size rather than by feel. */
  figurePixels(): number;
  dispose(): void;
}

interface SheetManifest {
  size: number;
  scale: number;
  facings: number;
  frameMetres: number;
  clips: Record<string, { frames: number; fps: number; loop: boolean }>;
}

const MESH_X = -0.75;
const SPRITE_X = 0.75;

export async function mountRigSpike(
  host: HTMLElement,
  glbUrl: string,
  sheetBase: string
): Promise<RigSpike> {
  const renderer = new THREE.WebGLRenderer({
    // Off, and not negotiable: a blended edge pixel is by definition not a
    // palette colour (Phase 0's second finding). The shipping backend does
    // the same.
    antialias: false,
    // Spike-only, and the reason is Q1. Phase 0 answered "does shading stay
    // in palette?" by CENSUSING PIXELS, not by looking -- 207 of 207 colours
    // off palette under ordinary lighting, 10 of 10 on it through the LUT.
    // Reproducing that census on a DEFORMED figure needs the drawing buffer
    // to survive past its own frame, which is off by default. The shipping
    // backend must never set this (it forces the driver to keep a second
    // copy of every frame); here the whole point is to read the frame back.
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  const vp = { width: host.clientWidth, height: host.clientHeight };
  renderer.setSize(vp.width, vp.height, false);
  // Sets outputColorSpace AND the clear colour, in that order, so neither
  // lands off-palette. See `palette-material.ts` on why this is one call.
  applyPalettePipeline(renderer, readRamp('limestone')[3]);
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  // Ground, so both silhouettes are judged against the tone they will sit on
  // in the game rather than against the void. Phase 0 measured on limestone
  // for the same reason.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 6),
    new THREE.MeshBasicMaterial({ color: new THREE.Color().setStyle(readRamp('limestone')[3], THREE.LinearSRGBColorSpace) })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // --- the rigged mesh -----------------------------------------------------
  const gltf = await new GLTFLoader().loadAsync(glbUrl);
  const rigRoot = gltf.scene;
  rigRoot.scale.setScalar(1 / UNITS_PER_TILE);
  rigRoot.position.set(MESH_X, 0, 0);
  scene.add(rigRoot);

  const ownedMaterials: THREE.Material[] = [];
  const unmapped = new Set<string>();
  rigRoot.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const role = (mesh.userData as { rl_role?: string }).rl_role;
    if (!role) {
      // kit.py raises on a part with no role and so does this: guessing a
      // colour would make the figure look plausible and be wrong.
      throw new Error(`rig-scene: mesh ${mesh.name} carries no rl_role`);
    }
    if (!isMeshRole(role)) {
      unmapped.add(role);
      return;
    }
    const mat = toonRampSkinnedMaterial(rampForRole(role));
    mesh.material = mat;
    ownedMaterials.push(mat);
  });
  if (unmapped.size > 0) {
    throw new Error(`rig-scene: no ramp for rl_role ${[...unmapped].join(', ')}`);
  }

  const mixer = new THREE.AnimationMixer(rigRoot);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const clip of gltf.animations) {
    actions.set(clip.name, mixer.clipAction(clip));
  }

  // --- the shipping billboard ---------------------------------------------
  const manifest = (await (await fetch(`${sheetBase}/manifest.json`)).json()) as SheetManifest;
  const texLoader = new THREE.TextureLoader();
  const spriteFrames = new Map<string, THREE.Texture[]>();
  for (const clipName of ['move', 'idle'] as const) {
    const spec = manifest.clips[clipName];
    const frames: THREE.Texture[] = [];
    for (let f = 0; f < spec.frames; f++) {
      // `{clip}_f{FACING}_{FRAME}.png` -- facing first, frame second. The
      // obvious reading of `f00` as "frame 0" is wrong and produces a
      // sixteen-frame animation of a figure rotating on the spot.
      const file = `${clipName}_f00_${String(f).padStart(3, '0')}.png`;
      const tex = await texLoader.loadAsync(`${sheetBase}/${file}`);
      // Nearest, always: the sheet is quantized art, and any filtering
      // blends palette entries into values that are not in the palette.
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.colorSpace = THREE.LinearSRGBColorSpace;
      frames.push(tex);
    }
    spriteFrames.set(clipName, frames);
  }

  const spriteSide = manifest.frameMetres / UNITS_PER_TILE;
  const spriteMat = new THREE.MeshBasicMaterial({
    map: spriteFrames.get('move')![0],
    transparent: true,
    alphaTest: 0.5,
  });
  const spriteQuad = new THREE.Mesh(new THREE.PlaneGeometry(spriteSide, spriteSide), spriteMat);
  scene.add(spriteQuad);

  // --- state ---------------------------------------------------------------
  let zoom = 1;
  let clip: 'move' | 'idle' = 'move';
  let paused = false;
  let spriteT = 0;
  let spriteFrame = 0;
  let meshYaw = 0;
  let spriteLift = spriteSide / 2;

  actions.get('move')?.play();

  function applyClip(): void {
    for (const [name, action] of actions) {
      if (name === clip) {
        action.reset().play();
      } else {
        action.stop();
      }
    }
    spriteFrame = 0;
    spriteT = 0;
    spriteMat.map = spriteFrames.get(clip)![0];
    spriteMat.needsUpdate = true;
  }

  function advanceSprite(dt: number): void {
    const spec = manifest.clips[clip];
    if (spec.fps <= 0) return;
    spriteT += dt;
    const per = 1 / spec.fps;
    while (spriteT >= per) {
      spriteT -= per;
      spriteFrame = (spriteFrame + 1) % spec.frames;
    }
    spriteMat.map = spriteFrames.get(clip)![spriteFrame];
    spriteMat.needsUpdate = true;
  }

  function draw(): void {
    const camera = dimetricCamera({ x: 0, y: 0, zoom }, vp);
    rigRoot.rotation.y = meshYaw;
    // Camera-facing, upright: the shipping backend billboards the same way.
    spriteQuad.quaternion.copy(camera.quaternion);
    spriteQuad.position.set(SPRITE_X, spriteLift, 0);
    renderer.render(scene, camera);
  }

  return {
    frame(dtSeconds) {
      if (!paused) {
        mixer.update(dtSeconds);
        advanceSprite(dtSeconds);
      }
      draw();
    },
    setZoom(z) {
      zoom = z;
    },
    setClip(c) {
      clip = c;
      applyClip();
    },
    setPaused(p) {
      paused = p;
    },
    step() {
      const spec = manifest.clips[clip];
      const per = spec.fps > 0 ? 1 / spec.fps : 1 / 10;
      mixer.update(per);
      spriteFrame = (spriteFrame + 1) % spec.frames;
      spriteMat.map = spriteFrames.get(clip)![spriteFrame];
      spriteMat.needsUpdate = true;
      draw();
    },
    setMeshYaw(r) {
      meshYaw = r;
    },
    setSpriteLift(y) {
      spriteLift = y;
    },
    figurePixels() {
      // A 1.8 m figure, in tiles, through the camera's own vertical scale.
      const box = new THREE.Box3().setFromObject(rigRoot);
      const worldH = box.max.y - box.min.y;
      const cam = dimetricCamera({ x: 0, y: 0, zoom }, vp);
      return (worldH / (cam.top - cam.bottom)) * vp.height;
    },
    dispose() {
      for (const m of ownedMaterials) m.dispose();
      for (const frames of spriteFrames.values()) for (const t of frames) t.dispose();
      spriteMat.dispose();
      spriteQuad.geometry.dispose();
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      rigRoot.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
      mixer.stopAllAction();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    },
  };
}
