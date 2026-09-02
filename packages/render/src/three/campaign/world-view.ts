/**
 * The campaign board: `art/meshes/campaign/sahar_basin.glb` on screen, turning
 * on one axis, pickable by object.
 *
 * `packages/app` reaches this through `@lions/render/three-campaign` and a
 * DYNAMIC import, for the same reason `ThreeRenderer` and `PixiRenderer` are
 * reached that way: a static import would put three.js into the main chunk
 * for every player, including one who chose `?renderer=pixi` and will never
 * see this screen. eslint's `no-restricted-imports` block names this entry
 * point alongside the other four.
 *
 * ## What the app owns and what this owns
 *
 * This owns the canvas, the camera, the board's orientation, and the answer
 * to "what did the pointer land on". The app owns every word on screen: the
 * town names and their mission counts, the region cards, the sentence a
 * locked region says when you click it, and the links those all are. Two
 * consequences worth stating, because both were choices:
 *
 *   * **The town pins are DOM, not sprites.** They come back out of here as
 *     canvas pixels (`onFrame`) and the app positions real anchors over
 *     them. That keeps them crisp at any orientation, keeps them selectable,
 *     and keeps middle-click and keyboard focus behaving the way they do on
 *     the flat board -- a canvas cannot be tabbed into.
 *   * **Nothing here reads the ledger.** A region's state arrives as a
 *     `CampaignRegionStatus` the app derived. `@lions/render` may not import
 *     `@lions/app`, and more to the point the screen must not be able to
 *     disagree with the flat board about what is locked.
 *
 * ## Rotation is one axis, and cannot lose the map
 *
 * Drag horizontally, or press the arrow keys, or use the app's two buttons.
 * There is no pitch, no pan and no zoom. The frustum is fitted once for the
 * WORST yaw (`world-camera.ts`), so the board is fully on screen at every
 * orientation and does not change size as it turns. A free orbit was the
 * alternative and it loses the map: pitch to the horizon and the board is a
 * line, spin past the poles and it is upside down, and there is no way back
 * except a reset button admitting the interaction was wrong.
 *
 * ## Colour space
 *
 * `applyPalettePipeline` is deliberately NOT used here, and that is not an
 * oversight. It does two things: sets `outputColorSpace` to pass-through,
 * and puts the CLEAR colour through the same non-converting path so the
 * background lands on-palette. This canvas has no clear colour -- it is
 * transparent, and the campaign page's own theme is the ground behind it --
 * so the second half has nothing to do. The first half is done directly
 * below, and it is the half `prepareTexturedMap`'s `NoColorSpace` is paired
 * with: get either wrong and the whole board renders dark and still looks
 * like a plausible diorama.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import {
  fitHalfHeight,
  footprintCandidates,
  projectToCanvas,
  worldViewCamera,
} from './world-camera';
import {
  campaignWorldMaterial,
  HOVER_BRIGHT,
  REGION_VISUALS,
  SCENERY_VISUAL,
} from './world-material';
import { readWorldScene, type CampaignRegionStatus, type WorldScene } from './world-scene';

/** Where one town marker landed on the canvas, in CSS pixels. */
export interface TownScreen {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export interface WorldViewOptions {
  /** Served URL of the world GLB. Paths are the app's business; this takes
   *  the resolved URL, exactly as `loadBuildingMeshTemplate` does. */
  meshUrl: string;
  /** Region id -> state, as the app derived it from the ledger. A region the
   *  GLB carries and this omits is drawn `locked`: the safe direction, since
   *  the failure it guards is a region becoming clickable by accident. */
  statuses: Readonly<Record<string, CampaignRegionStatus>>;
  /** Which regions are a control. Hover feedback and the pointer cursor are
   *  gated on this and not on `statuses`, mirroring the flat board's own
   *  rule (`worldmap.ts`): a region that lights up under the cursor and then
   *  does nothing when clicked is worse than one that never lit up. */
  clickable: ReadonlySet<string>;
  /** A click that landed on region ground. Scenery and empty space report
   *  `null` -- the app decides whether that means anything. */
  onPick: (regionId: string | null) => void;
  /** Called after every frame the view actually drew, with where the town
   *  markers are now. The app moves its DOM pins to match. */
  onFrame: (towns: readonly TownScreen[], bearingDegrees: number) => void;
}

export interface WorldView {
  readonly canvas: HTMLCanvasElement;
  /** Turn by `deltaDegrees`, eased. The app's rotate buttons and the arrow
   *  keys both come through here. */
  nudge(deltaDegrees: number): void;
  /** Back to the authored orientation, eased. */
  reset(): void;
  /** The region under the pointer, or null. Readable so a browser check can
   *  assert the hover without recomputing it. */
  readonly hovered: string | null;
  /** Compass bearing of the board, 0-359, 0 being as authored. */
  readonly bearingDegrees: number;
  dispose(): void;
}

/** Degrees of turn per pixel of horizontal drag. At 0.35 a full turn is
 *  ~1,030 px -- about one 1440-wide screen, so the whole board is reachable
 *  in one gesture without a flick spinning it past where the hand stopped. */
const DEGREES_PER_PIXEL = 0.35;

/** One arrow-key press, and one press of the app's rotate buttons. A twelfth
 *  of a turn: enough that the board visibly moves, small enough that the
 *  ground you were looking at is still on screen. */
export const NUDGE_DEGREES = 30;

/** Fraction of the remaining angle closed per 60 fps frame while easing.
 *  A nudge lands in ~10 frames and a drag is not eased at all (the board
 *  tracks the finger exactly, which is the whole point of dragging). */
const EASE_PER_FRAME = 0.22;

/** How far the pointer may move between down and up and still count as a
 *  click rather than a drag. */
const CLICK_SLOP_PX = 4;

const TAU = Math.PI * 2;

/**
 * Load the world and mount it into `host`.
 *
 * Rejects if the GLB cannot be fetched or parsed, if WebGL is unavailable,
 * or if the scene graph does not carry the campaign contract
 * (`world-scene.ts` throws by node name). The app catches all of those the
 * same way -- by falling back to the flat PNG board -- because none of them
 * should cost a player their campaign screen.
 */
export async function mountWorldView(
  host: HTMLElement,
  opts: WorldViewOptions
): Promise<WorldView> {
  const gltf = await new GLTFLoader().loadAsync(opts.meshUrl);

  const renderer = new THREE.WebGLRenderer({
    // Transparent: the campaign page's own ground shows through, so the
    // board is an object on the page rather than a rectangle cut out of it.
    alpha: true,
    // ON, unlike every other surface in this backend. `ThreeRenderer` turns
    // it off because a blended edge pixel is by definition not one of
    // `data/palette.json`'s 42 colours (Phase 0's second finding) -- but
    // this asset is the named exemption from that palette entirely, its
    // colours are a photographic bake, and its silhouette is a hex rim that
    // turns. Aliasing on a rotating diagonal edge is the single most visible
    // artefact this screen could have, and there is no palette guarantee
    // here for it to cost.
    antialias: true,
  });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  // Pass-through output, pairing with `prepareTexturedMap`'s `NoColorSpace`.
  // See this file's header for why `applyPalettePipeline` is not the call.
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearAlpha(0);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.touchAction = 'none';
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const statuses: Record<string, CampaignRegionStatus> = { ...opts.statuses };
  const clickable = opts.clickable;

  let world: WorldScene;
  try {
    // Every mesh is built with the scenery visual and the REGION ones are
    // then given their own state by `applyVisuals` below. Scenery keeps it:
    // it is never a region and must never be tinted as one, because
    // `outland_scenery` carries the diorama's whole underside and rim.
    world = readWorldScene(gltf.scene, (map) => campaignWorldMaterial(map, SCENERY_VISUAL));
  } catch (err) {
    renderer.dispose();
    renderer.domElement.remove();
    throw err;
  }

  // The board turns about its own horizontal centre. Not the origin (the
  // exporter centres X/Z on it, but a re-export need not) and not the
  // bounding-box centre (that is half way up the board's own thickness, and
  // turning about it makes the diorama wobble like a tossed coin).
  const pivot = new THREE.Group();
  const size = world.bounds.getSize(new THREE.Vector3());
  const centre = world.bounds.getCenter(new THREE.Vector3());
  world.root.position.set(-centre.x, 0, -centre.z);
  pivot.add(world.root);
  scene.add(pivot);

  // In pivot space the board is centred horizontally; the camera looks at
  // its mid-height so it sits vertically centred on screen too.
  const boardBox = new THREE.Box3(
    new THREE.Vector3(-size.x / 2, world.bounds.min.y, -size.z / 2),
    new THREE.Vector3(size.x / 2, world.bounds.max.y, size.z / 2)
  );
  const target = new THREE.Vector3(0, (boardBox.min.y + boardBox.max.y) / 2, 0);
  const origin = new THREE.Vector3(0, 0, 0);

  const regionMeshes: THREE.Mesh[] = [];
  for (const meshes of world.regions.values()) regionMeshes.push(...meshes);

  // The board's real plan shape, not its bounding box: a hexagon's box has
  // four corners with no board under them, and reserving screen for them
  // costs 25% of the board's drawn size (`footprintCandidates`' own comment
  // has the measurement). Computed once, at yaw 0, with the matrices the
  // pivot has just been given.
  pivot.updateMatrixWorld(true);
  const frame = footprintCandidates([...regionMeshes, ...world.scenery]);

  let camera = worldViewCamera(target, 1, 1);
  let width = 0;
  let height = 0;
  let yaw = 0;
  let yawTarget = 0;
  let hovered: string | null = null;
  let dirty = true;
  let disposed = false;
  let pointer: { x: number; y: number } | null = null;
  let pointerMoved = false;
  let needsResize = true;

  const applyVisuals = (): void => {
    for (const [id, meshes] of world.regions) {
      const status = statuses[id] ?? 'locked';
      const visual = REGION_VISUALS[status];
      const lift = hovered === id && clickable.has(id) ? HOVER_BRIGHT : 1;
      for (const m of meshes) {
        const u = (m.material as THREE.ShaderMaterial).uniforms;
        u.uSat.value = visual.sat;
        u.uBright.value = visual.bright * lift;
      }
    }
    dirty = true;
  };

  const resize = (): void => {
    needsResize = false;
    const w = Math.max(1, Math.round(host.clientWidth));
    const h = Math.max(1, Math.round(host.clientHeight));
    if (w === width && h === height) return;
    width = w;
    height = h;
    renderer.setSize(w, h, false);
    camera = worldViewCamera(target, fitHalfHeight(frame, origin, w / h, target), w / h);
    dirty = true;
  };

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  /** Put the board where `yaw` says it is. Both the raycast and the draw
   *  need it, and a raycast against last frame's matrices picks the region
   *  that WAS under the cursor -- visible as a one-frame-stale highlight
   *  while dragging. */
  const syncPivot = (): void => {
    pivot.rotation.y = yaw;
    pivot.updateMatrixWorld(true);
  };

  const regionAt = (px: number, py: number): string | null => {
    if (width === 0 || height === 0) return null;
    syncPivot();
    ndc.set((px / width) * 2 - 1, 1 - (py / height) * 2);
    raycaster.setFromCamera(ndc, camera);
    // Region meshes only. Scenery is deliberately not pickable: it is not a
    // control, and a click that hits the snow wall must read as "you clicked
    // nothing", not as a near miss on whatever region is behind it.
    const hit = raycaster.intersectObjects(regionMeshes, false)[0];
    if (!hit) return null;
    const id = (hit.object.userData as { rl_region?: unknown }).rl_region;
    return typeof id === 'string' ? id : null;
  };

  const canvasPoint = (ev: PointerEvent | MouseEvent): { x: number; y: number } => {
    const r = renderer.domElement.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };

  // --- pointer: drag turns the board, a click without a drag picks --------
  let down: { x: number; y: number; yaw: number } | null = null;
  let dragged = false;

  const onPointerDown = (ev: PointerEvent): void => {
    const p = canvasPoint(ev);
    down = { x: p.x, y: p.y, yaw };
    dragged = false;
    renderer.domElement.setPointerCapture(ev.pointerId);
    renderer.domElement.style.cursor = 'grabbing';
  };

  const onPointerMove = (ev: PointerEvent): void => {
    const p = canvasPoint(ev);
    pointer = p;
    pointerMoved = true;
    if (!down) return;
    const dx = p.x - down.x;
    if (Math.abs(dx) > CLICK_SLOP_PX || Math.abs(p.y - down.y) > CLICK_SLOP_PX) dragged = true;
    if (!dragged) return;
    // The board tracks the finger exactly while dragging -- no easing, no
    // inertia. Both were tried on paper and both make "put that ridge under
    // the cursor" a thing you approach rather than a thing you do.
    yaw = down.yaw + (dx * DEGREES_PER_PIXEL * Math.PI) / 180;
    yawTarget = yaw;
    dirty = true;
  };

  const onPointerUp = (ev: PointerEvent): void => {
    const wasDown = down;
    down = null;
    if (renderer.domElement.hasPointerCapture(ev.pointerId)) {
      renderer.domElement.releasePointerCapture(ev.pointerId);
    }
    renderer.domElement.style.cursor = hovered && clickable.has(hovered) ? 'pointer' : 'grab';
    if (!wasDown || dragged) return;
    const p = canvasPoint(ev);
    opts.onPick(regionAt(p.x, p.y));
  };

  const onPointerLeave = (): void => {
    pointer = null;
    if (hovered !== null) {
      hovered = null;
      applyVisuals();
    }
  };

  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key === 'ArrowLeft') nudge(-NUDGE_DEGREES);
    else if (ev.key === 'ArrowRight') nudge(NUDGE_DEGREES);
    else if (ev.key === 'Home') reset();
    else return;
    ev.preventDefault();
  };

  const el = renderer.domElement;
  el.style.cursor = 'grab';
  el.tabIndex = 0;
  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointerleave', onPointerLeave);
  el.addEventListener('keydown', onKeyDown);

  function nudge(deltaDegrees: number): void {
    yawTarget += (deltaDegrees * Math.PI) / 180;
    dirty = true;
  }

  function reset(): void {
    // Toward the NEAREST authored orientation, not toward zero: after two
    // and a half turns the board is one nudge from north, and unwinding 900
    // degrees to prove it would be a punishment for having rotated.
    yawTarget = Math.round(yaw / TAU) * TAU;
    dirty = true;
  }

  const townEntries = [...world.towns.entries()];
  const townOut: TownScreen[] = [];
  const scratch = new THREE.Vector3();

  const draw = (): void => {
    syncPivot();
    renderer.render(scene, camera);
    townOut.length = 0;
    for (const [id, node] of townEntries) {
      node.getWorldPosition(scratch);
      const p = projectToCanvas(scratch, camera, width, height);
      townOut.push({ id, x: p.x, y: p.y });
    }
    const deg = ((((yaw * 180) / Math.PI) % 360) + 360) % 360;
    opts.onFrame(townOut, deg);
  };

  let raf = 0;
  const tick = (): void => {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    if (needsResize) resize();

    if (pointerMoved && !down) {
      pointerMoved = false;
      const next = pointer ? regionAt(pointer.x, pointer.y) : null;
      if (next !== hovered) {
        hovered = next;
        el.style.cursor = next && clickable.has(next) ? 'pointer' : 'grab';
        applyVisuals();
      }
    }

    const gap = yawTarget - yaw;
    if (Math.abs(gap) > 1e-4) {
      yaw += gap * EASE_PER_FRAME;
      dirty = true;
    } else if (yaw !== yawTarget) {
      yaw = yawTarget;
      dirty = true;
    }

    if (!dirty) return;
    dirty = false;
    draw();
  };

  applyVisuals();
  resize();
  // One synchronous draw before returning, so the app's town pins have real
  // positions the moment the board is on screen rather than one frame later
  // -- a rAF is throttled to zero in a hidden tab, and a screen whose labels
  // appear only after you look at it reads as broken.
  draw();
  dirty = false;
  raf = requestAnimationFrame(tick);

  // The host is sized by CSS, so its box changes with the window and with
  // nothing this file can see. An observer rather than a per-frame
  // `clientWidth` read: that read forces layout, and doing it 60 times a
  // second on a menu that is usually not moving is a cost with no payer.
  const observer =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          needsResize = true;
        });
  observer?.observe(host);

  return {
    canvas: el,
    nudge,
    reset,
    get hovered() {
      return hovered;
    },
    get bearingDegrees() {
      return ((((yaw * 180) / Math.PI) % 360) + 360) % 360;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointerleave', onPointerLeave);
      el.removeEventListener('keydown', onKeyDown);
      for (const meshes of world.regions.values()) {
        for (const m of meshes) {
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
      }
      for (const m of world.scenery) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
      world.map.dispose();
      renderer.dispose();
      el.remove();
    },
  };
}

export type { CampaignRegionStatus } from './world-scene';
