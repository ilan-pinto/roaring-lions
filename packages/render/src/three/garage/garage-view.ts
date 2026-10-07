/**
 * The garage's turnable model, `@lions/render/three-garage` (GH-316): one
 * unit standing on a patch of the mission's own sand, lit by a key on the
 * sun's side, in the bay where the screenshot plate used to be.
 *
 * ## What the door does and what it does not
 *
 * It draws. It never decides WHEN: there is no frame loop here at all. The
 * app calls `draw(yaw)` -- on input, on each frame of the auto-turn while it
 * runs, and after a resize -- and the door's own first frame is drawn before
 * the promise resolves. An idle garage therefore costs nothing per frame,
 * which is what "renders on demand" means and what `stats()` lets a harness
 * prove. The turn, the auto-turn's clock and the keyboard are the app's
 * (`packages/app/src/ui/garage-turn.ts`); this file only turns the model to
 * the angle it is handed.
 *
 * ## The same colour as a mission, by construction
 *
 * The meshes go through the SHIPPED builders -- `buildMeshUnitTemplate` and
 * `buildVehicleMeshTemplate`, so `rampMaterial`/`texturedMaterial` from
 * `world-materials.ts`, the faction ramps, and the named textured lists --
 * and the renderer is set up the way `ThreeRenderer` sets up its own: sRGB
 * output, ACES filmic, antialias on, PCF-soft shadows. The sand is the
 * ground's own image applied the ground's own way: `prepareGroundTexture`
 * (`NoColorSpace`), and an albedo of the map's open-ground tone DIVIDED by
 * the image's measured mean, exactly as `terrain/skirt.ts` does it, so the
 * patch averages to the tone a mission draws rather than to the photograph's
 * raw hue.
 *
 * ## Lifecycle, and the soft-leave rule
 *
 * 1. **Fetch with no context.** The GLB and the sand load under the caller's
 *    `AbortSignal`; a player who pages on (or leaves) before they land
 *    leaves nothing to release, and the promise rejects with an
 *    `AbortError` the app recognises by the SIGNAL, never by the error.
 * 2. **Pose, sweep and fit, still with no context** -- all CPU work.
 * 3. **Construct the context.** From here an abort releases at once, from
 *    the signal's own listener, because the router mounts the next screen
 *    right after it unmounts this one (the scene host's rule).
 * 4. **Draw the first frame, then resolve.**
 * 5. **`dispose()`**: free every geometry, material and texture this view
 *    made, then `disposeAndReleaseContext` -- `WebGLRenderer.dispose()`
 *    alone leaves the context alive until the canvas is collected, and a
 *    browser caps live contexts at about sixteen. Idempotent.
 *
 * ## Kit (GH-238, plan 3)
 *
 * A vehicle wears the tiers the brigade bought (`kitTiers`), merged into its
 * hosts by the SHIPPED `buildVehicleMeshTemplate`, the same as in a mission.
 * Three things about it are deliberate:
 *
 * - **The loaded scene is a pristine source and is never built from.**
 *   `buildVehicleMeshTemplate` mutates what it is handed (kit nodes removed,
 *   hosts re-merged, materials normalised, the merge's leftovers disposed),
 *   so every build -- the first one included -- runs on a fresh clone whose
 *   geometries AND materials are clones too (`cloneForBuild`). A purchase
 *   (`setKit`) is therefore a re-merge with no re-fetch, and every template
 *   owns exactly what it disposes. What a clone SHARES is the textures: a
 *   cloned material keeps the loaded material's `map` (the bake, a 2048
 *   image), so no template disposes one; the view does, once, at
 *   `dispose()`.
 * - **The frame is fitted to the MAXIMUM-kit model**, every kit node the GLB
 *   carries, and the footprint is centred on it too. Buying kit then never
 *   resizes the frame, never moves the camera and never moves the turn
 *   axis; the model shown is built from the bought tiers afterwards.
 * - **A swap draws before it releases.** The new template draws one frame,
 *   THEN the old one is disposed: its materials share a program with the
 *   new ones, and disposing first would drop that program's last user and
 *   compile it again.
 */
import * as THREE from 'three';
import { disposeAndReleaseContext } from '../context-release';
import { gltfLoader, setDracoDecoderPath } from '../units/gltf-loader';
import { buildMeshUnitTemplate, disposeMeshUnitTemplate } from '../units/mesh-unit';
import {
  buildVehicleMeshTemplate,
  disposeVehicleMeshEntity,
  disposeVehicleMeshTemplate,
  instantiateVehicleMesh,
} from '../units/mesh-vehicle';
import type { VehicleKitTiers } from '../units/vehicle-kit';
import type { MeshFaction } from '../units/mesh-role';
import { TEXTURED_INFANTRY_TYPES } from '../units/textured-infantry';
import { TEXTURED_VEHICLE_TYPES } from '../units/textured-vehicle';
import { GROUND_ALBEDOS, prepareGroundTexture, type GroundAlbedoId } from '../terrain/mesh';
import { WORLD_ROUGHNESS } from '../world-materials';
import {
  FILL_INTENSITY,
  GARAGE_ELEVATION_DEG,
  GARAGE_EXPOSURE,
  GARAGE_FOV_DEG,
  HEMI_INTENSITY,
  KEY_INTENSITY,
  SAND_FADE_START,
  SAND_RADIUS_OF_SWEEP,
  clearSpacing,
  defaultYawDeg,
  fitCamera,
  stageLights,
  type GarageClass,
} from './garage-frame';
import {
  bonesOf,
  figureTurner,
  lineOrder,
  livingFigureRoots,
  poseRigged,
  respaceLine,
  splitShowcase,
  visiblePoints,
  type PoseSource,
} from './garage-pose';

/** Every colour the stage uses, already resolved from palette keys by the
 *  app (`data/palette.json` is the app's to read, the same as
 *  `RendererOptions`): the key and fill lights, the sky/ground bounce, and
 *  the open-ground tone the sand averages to. */
export interface GarageColors {
  readonly key: string;
  readonly fill: string;
  readonly sky: string;
  readonly bounce: string;
  readonly ground: string;
}

export interface GarageViewOptions {
  readonly typeId: string;
  /** `rigged`: a team, through `buildMeshUnitTemplate`. `vehicle`: the rigid
   *  vehicle path, aircraft included. */
  readonly kind: 'rigged' | 'vehicle';
  readonly meshUrl: string;
  /** The ramp pair a rigged team is shaded through. Ignored for a vehicle. */
  readonly faction?: MeshFaction;
  /** Every shipped GLB is Draco-compressed; see `gltf-loader.ts`. */
  readonly dracoDecoderPath?: string;
  /** The open-ground albedo tile (`desert_sand_tile.jpg`). Fail-soft: absent
   *  or failed, the patch draws its flat tone. */
  readonly groundTextureUrl?: string;
  readonly colors: GarageColors;
  /** A vehicle's bought kit, by track (`armour`, `sensors`, `firepower`):
   *  the brigade account's tiers for this type. Absent reads as no kit.
   *  Ignored for a rigged team. See "Kit" in this file's header. */
  readonly kitTiers?: Readonly<Record<string, number>>;
  readonly signal?: AbortSignal;
  /** Called once if the browser takes the context away. The view draws
   *  nothing after that; the app puts the plate back. */
  readonly onContextLost?: () => void;
}

/** What the view measured and decided, for a report or a test harness. */
export interface GarageViewInfo {
  readonly typeId: string;
  readonly cls: GarageClass;
  readonly pose: PoseSource;
  /** Figures that turn on their own spot (0 for a vehicle). */
  readonly figures: number;
  readonly figureRoots: readonly string[];
  /** Line spacing between a team's figures, world units (0: not re-spaced). */
  readonly spacing: number;
  /** The model's furthest visible point from the turn axis, world units. */
  readonly sweepRadius: number;
  /** Where "0" sits: the broad face toward the key. */
  readonly defaultYawDeg: number;
  readonly camera: { readonly fovDeg: number; readonly elevationDeg: number; readonly distance: number };
  readonly sand: boolean;
}

export interface GarageViewStats {
  /** Frames drawn since mount, the first one included. */
  readonly frames: number;
  /** The last frame's draw calls and triangles, shadow pass included. */
  readonly calls: number;
  readonly triangles: number;
}

export interface GarageView {
  readonly canvas: HTMLCanvasElement;
  readonly info: GarageViewInfo;
  stats(): GarageViewStats;
  /** Draw ONE frame with the model turned `yawDeg` from its default. */
  draw(yawDeg: number): void;
  /** Re-read the host's size and re-fit the camera. Draws nothing; the
   *  caller draws next. */
  resize(): void;
  /** Re-merge the vehicle with these tiers from the pristine loaded scene
   *  (no fetch), swap it onto the turntable at the same angle and offset,
   *  and draw one frame. The camera and the frame do not move: they were
   *  fitted to the maximum kit. A no-op for a rigged team, and for tiers
   *  that draw the same parts as the model already shown. */
  setKit(tiers: Readonly<Record<string, number>>): void;
  dispose(): void;
}

const leftEarly = (): DOMException => new DOMException('the garage was left before its model mounted', 'AbortError');

/** Model sampled every this many degrees for the fit. */
const SWEEP_STEP_DEG = 15;
/** The key's shadow map: one model on a small patch needs nothing like the
 *  mission's map-wide 4096. */
const SHADOW_MAP = 2048;
/** A team's patch, squashed along the camera axis: the line's swept depth
 *  times this, plus this, is the sand kept in frame in front of the line,
 *  and the patch's depth radius is that again times the scale. The approved
 *  mock's numbers (1.6 and 0.04 world units). */
const TEAM_DEPTH_SCALE = 1.6;
const TEAM_DEPTH_PAD = 0.04;

/**
 * The sand patch's alpha: opaque out to `SAND_FADE_START` of its radius,
 * then a smoothstep to nothing at the rim. A `DataTexture` rather than a
 * canvas gradient so it is the same bytes in every browser and in a test.
 */
export function sandAlpha(size = 128): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = ((x + 0.5) / size) * 2 - 1;
      const dy = ((y + 0.5) / size) * 2 - 1;
      const r = Math.hypot(dx, dy);
      const t = Math.min(1, Math.max(0, (r - SAND_FADE_START) / (1 - SAND_FADE_START)));
      const a = Math.round(255 * (1 - t * t * (3 - 2 * t)));
      const o = (y * size + x) * 4;
      data[o] = a;
      data[o + 1] = a;
      data[o + 2] = a;
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** The ground image's basename, as `ThreeRenderer.loadGroundTexture` keys it. */
function albedoIdOf(url: string): GroundAlbedoId | null {
  const id = (url.split('?')[0].split('/').pop() ?? '').replace(/\.[a-z0-9]+$/i, '');
  return id in GROUND_ALBEDOS ? (id as GroundAlbedoId) : null;
}

async function loadSand(url: string | undefined): Promise<{ tex: THREE.Texture; id: GroundAlbedoId } | null> {
  if (!url) return null;
  const id = albedoIdOf(url);
  if (id === null) {
    console.warn(`[lions] garage: ${url} is not in GROUND_ALBEDOS, so its mean is unknown; the sand draws flat`);
    return null;
  }
  try {
    const tex = await new THREE.TextureLoader().loadAsync(url);
    return { tex: prepareGroundTexture(tex), id };
  } catch (err) {
    console.warn(`[lions] garage: the sand texture ${url} failed; the patch draws its flat tone:`, err);
    return null;
  }
}

/** Everything a staged model owns that is not GPU state. */
interface Staged {
  /** Everything drawn, the sand excluded. */
  readonly model: THREE.Object3D;
  /** The node the footprint is centred by: the whole rig for a team (whose
   *  figures turn on their own bones), and the vehicle INSIDE its turntable
   *  (so the turn axis is the footprint's centre, not the GLB's origin). */
  readonly offset: THREE.Object3D;
  readonly cls: GarageClass;
  readonly pose: PoseSource;
  readonly figures: THREE.Bone[];
  readonly spacing: number;
  /** Turns the model `deg` past its default. */
  readonly applyYaw: (deg: number) => void;
  /** Called once the frame is fitted: a vehicle staged at its maximum kit
   *  for the fit swaps to the bought tiers here. */
  readonly settle?: () => void;
  /** Swap to a model built with `tiers`; returns the old model's release,
   *  which the caller runs AFTER drawing the new one. `null`: nothing to do. */
  readonly setKit?: (tiers: VehicleKitTiers) => (() => void) | null;
  /** Every texture the staged source holds that the drawn model may not
   *  reach (the pristine scene's), for the view's one disposal pass. */
  readonly sourceTextures?: () => Iterable<THREE.Texture>;
  readonly release: () => void;
}

function stageRigged(gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] }, opts: GarageViewOptions): Staged {
  const { showcase, rest } = splitShowcase(gltf.animations);
  const tpl = buildMeshUnitTemplate(
    { scene: gltf.scene, animations: rest },
    opts.faction ?? 'kdf',
    opts.meshUrl,
    TEXTURED_INFANTRY_TYPES.has(opts.typeId)
  );
  const rig = tpl.root;
  const { source, mixer } = poseRigged(rig, { showcase, idle: tpl.clips.get('idle') ?? null });
  const figures = lineOrder(livingFigureRoots(bonesOf(rig)));
  let spacing = 0;
  if (figures.length > 1) {
    // Each figure's points as offsets from its own turn axis. A figure's
    // reach does not depend on where it stands, so one sample at the posed
    // default serves every pair.
    const { points, owner } = visiblePoints(rig, figures, 1500);
    const centres = figures.map((b) => b.getWorldPosition(new THREE.Vector3()));
    const local = figures.map(() => [] as { x: number; z: number }[]);
    points.forEach((p, i) => {
      const f = owner[i];
      if (f >= 0) local[f].push({ x: p.x - centres[f].x, z: p.z - centres[f].z });
    });
    // `clearSpacing` sweeps the whole turn, so where it starts is moot.
    for (let i = 1; i < figures.length; i++) spacing = Math.max(spacing, clearSpacing(local[i - 1], local[i]));
    respaceLine(figures, spacing);
  }
  const turnFigures = figures.length > 0 ? figureTurner(figures) : null;
  // A rig with no figure root this can name turns as one piece, on a
  // turntable whose origin is the footprint's centre.
  const turntable = new THREE.Group();
  turntable.add(rig);
  const base = defaultYawDeg('figures');
  return {
    model: turntable,
    offset: rig,
    cls: 'figures',
    pose: source,
    figures,
    spacing,
    applyYaw: (deg) => {
      if (turnFigures) turnFigures(base + deg);
      else turntable.rotation.y = THREE.MathUtils.degToRad(base + deg);
    },
    release: () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(rig);
      disposeMeshUnitTemplate(tpl);
    },
  };
}

/** The highest tier of each track any kit node in `scene` carries -- the
 *  maximum kit this GLB can wear. Empty for a GLB with no kit. */
export function kitCeiling(scene: THREE.Object3D): Record<string, number> {
  const out: Record<string, number> = {};
  scene.traverse((o) => {
    const tag = (o.userData as { rl_kit?: { track?: unknown; tier?: unknown } }).rl_kit;
    if (!tag || typeof tag.track !== 'string' || typeof tag.tier !== 'number') return;
    out[tag.track] = Math.max(out[tag.track] ?? 0, tag.tier);
  });
  return out;
}

/** `tiers` as far as this GLB can show them: each track clamped to the
 *  ceiling, tracks with no kit dropped, as a stable key. Two tier sets with
 *  one key draw the same parts. */
function kitKey(tiers: VehicleKitTiers | undefined, ceiling: Readonly<Record<string, number>>): string {
  return Object.keys(ceiling)
    .sort()
    .map((track) => `${track}:${Math.max(0, Math.min(ceiling[track], tiers?.[track] ?? 0))}`)
    .join(',');
}

/**
 * A copy of the pristine scene a build may mutate: nodes, geometries and
 * materials all fresh, so the template built from it owns everything it
 * disposes. Sharing is preserved WITHIN the copy -- a `WRECK_` twin still
 * shares its host's geometry (the merge swaps both) and four meshes over one
 * material still share one clone (the template dedupes by identity) -- and
 * the one thing shared WITH the source is every texture, since
 * `Material.clone()` keeps its maps by reference.
 */
export function cloneForBuild(pristine: THREE.Object3D): THREE.Group {
  const root = pristine.clone(true) as THREE.Group;
  const geometries = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  const materials = new Map<THREE.Material, THREE.Material>();
  const cloneMaterial = (m: THREE.Material): THREE.Material => {
    let c = materials.get(m);
    if (!c) {
      c = m.clone();
      materials.set(m, c);
    }
    return c;
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    let g = geometries.get(mesh.geometry);
    if (!g) {
      g = mesh.geometry.clone();
      geometries.set(mesh.geometry, g);
    }
    mesh.geometry = g;
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mesh.material = mat.map(cloneMaterial);
    else if (mat) mesh.material = cloneMaterial(mat);
  });
  return root;
}

interface BuiltVehicle {
  readonly root: THREE.Object3D;
  readonly pose: PoseSource;
  readonly key: string;
  readonly release: () => void;
}

function stageVehicle(gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] }, opts: GarageViewOptions): Staged {
  const { rest } = splitShowcase(gltf.animations);
  // Never built from, never mutated: see "Kit" in this file's header.
  const pristine = gltf.scene;
  const ceiling = kitCeiling(pristine);
  const textured = TEXTURED_VEHICLE_TYPES.has(opts.typeId);
  const build = (tiers: VehicleKitTiers | undefined): BuiltVehicle => {
    const tpl = buildVehicleMeshTemplate({ scene: cloneForBuild(pristine), animations: rest }, opts.typeId, textured, tiers);
    const ent = instantiateVehicleMesh(tpl, opts.typeId);
    if (ent.deathRoot) ent.deathRoot.visible = false;
    let pose: PoseSource = 'bind';
    const idle = ent.actions.get('idle');
    if (ent.mixer && idle) {
      idle.play();
      ent.mixer.setTime(0);
      pose = 'idle0';
    }
    ent.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
    });
    return {
      root: ent.root,
      pose,
      key: kitKey(tiers, ceiling),
      release: () => {
        disposeVehicleMeshEntity(ent);
        disposeVehicleMeshTemplate(tpl);
      },
    };
  };
  const base = defaultYawDeg('vehicle');
  const turntable = new THREE.Group();
  // The footprint offset lives on this holder, not on the vehicle, so a
  // swapped-in vehicle sits exactly where the last one did.
  const holder = new THREE.Group();
  turntable.add(holder);
  // Staged at the MAXIMUM kit for the fit; `settle` swaps to the bought one.
  let current = build(ceiling);
  holder.add(current.root);
  const swap = (tiers: VehicleKitTiers): (() => void) | null => {
    if (kitKey(tiers, ceiling) === current.key) return null;
    const old = current;
    current = build(tiers);
    holder.remove(old.root);
    holder.add(current.root);
    return old.release;
  };
  return {
    model: turntable,
    offset: holder,
    cls: 'vehicle',
    get pose() {
      return current.pose;
    },
    figures: [],
    spacing: 0,
    applyYaw: (deg) => {
      turntable.rotation.y = THREE.MathUtils.degToRad(base + deg);
    },
    settle: () => {
      // Nothing drew the maximum-kit build, so it is released at once.
      swap(opts.kitTiers ?? {})?.();
    },
    setKit: swap,
    sourceTextures: () => {
      const out = new Set<THREE.Texture>();
      pristine.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        for (const mat of Array.isArray(m) ? m : m ? [m] : []) for (const t of texturesOf(mat)) out.add(t);
      });
      return out;
    },
    // The pristine scene's own geometries and materials were never drawn,
    // so never uploaded: there is nothing of theirs on the GPU to free, and
    // the garbage collector takes them with the view. Its textures WERE
    // uploaded (through the clones) and go in the view's one pass.
    release: () => current.release(),
  };
}

/** Every texture a material holds, for disposal: three frees a texture only
 *  when told to, and a GLB bake is a 2048 image. */
function texturesOf(m: THREE.Material): THREE.Texture[] {
  const out: THREE.Texture[] = [];
  for (const v of Object.values(m as unknown as Record<string, unknown>)) {
    if (v && (v as THREE.Texture).isTexture) out.push(v as THREE.Texture);
  }
  return out;
}

/** Load, pose and frame the unit, then mount its view into `host`. */
export async function mountGarageView(host: HTMLElement, opts: GarageViewOptions): Promise<GarageView> {
  if (opts.dracoDecoderPath) setDracoDecoderPath(opts.dracoDecoderPath);
  else console.warn('[lions] garage: no dracoDecoderPath given, so a Draco-compressed GLB cannot parse');
  if (opts.signal?.aborted) throw leftEarly();

  const [gltf, sand] = await Promise.all([gltfLoader().loadAsync(opts.meshUrl), loadSand(opts.groundTextureUrl)]);
  if (opts.signal?.aborted) {
    sand?.tex.dispose();
    throw leftEarly();
  }

  const staged =
    opts.kind === 'vehicle'
      ? stageVehicle(gltf as unknown as { scene: THREE.Group; animations: THREE.AnimationClip[] }, opts)
      : stageRigged(gltf as unknown as { scene: THREE.Group; animations: THREE.AnimationClip[] }, opts);
  const { model, cls } = staged;
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    // Skinned bounds are the BIND pose's; the showcase pose and the turn move
    // vertices outside them. One model in a fixed frame has nothing to cull.
    m.frustumCulled = false;
  });

  // Feet on y = 0, the posed footprint centred on the turn axis.
  const scene = new THREE.Scene();
  const stage = new THREE.Group();
  stage.add(model);
  scene.add(stage);
  // Measured BEFORE any turn is applied, so the stage's frame and the
  // offset node's parent frame agree.
  {
    const { points } = visiblePoints(model);
    const box = new THREE.Box3().setFromPoints(points);
    const c = box.getCenter(new THREE.Vector3());
    staged.offset.position.x -= c.x;
    staged.offset.position.z -= c.z;
    staged.offset.position.y -= box.min.y;
  }
  staged.applyYaw(0);

  // The sweep: every visible point at every 15 degrees of a full turn, so
  // the frame fits the WHOLE turn once and the model never resizes. A
  // vehicle is at its MAXIMUM kit here (and was for the centring above), so
  // no purchase can resize the frame either; `settle` then shows the
  // bought tiers.
  const swept: THREE.Vector3[] = [];
  let top = 0;
  for (let a = 0; a < 360; a += SWEEP_STEP_DEG) {
    staged.applyYaw(a);
    for (const p of visiblePoints(model, [], 500).points) {
      swept.push(p);
      top = Math.max(top, p.y);
    }
  }
  staged.applyYaw(0);
  staged.settle?.();
  let sweepRadius = 0;
  let depth = 0;
  for (const p of swept) {
    sweepRadius = Math.max(sweepRadius, Math.hypot(p.x, p.z));
    depth = Math.max(depth, Math.abs(p.x));
  }

  // The stage: one sand patch for every class (Q5). A team's line is wide
  // and shallow, so its patch is squashed along the camera axis to the
  // figures' own depth rather than running off the panel's sides.
  const team = staged.figures.length > 1;
  const sandR = Math.max(0.2, sweepRadius * SAND_RADIUS_OF_SWEEP);
  // How far in front of the turn axis the sand must stay in frame: the
  // line's own depth with room for a shadow (`TEAM_DEPTH_*`, the approved
  // mock's), or, for one model, four fifths of the patch -- past its opaque
  // core and into the fade, so the frame's bottom edge is soft sand.
  const nearEdge = team ? depth * TEAM_DEPTH_SCALE + TEAM_DEPTH_PAD : sandR * 0.8;
  const squash = team ? Math.min(1, (nearEdge * TEAM_DEPTH_SCALE) / sandR) : 1;
  const fitPoints = swept.filter((_, i) => i % 3 === 0);
  fitPoints.push(new THREE.Vector3(nearEdge, 0, 0));
  const elevationDeg = GARAGE_ELEVATION_DEG[cls];
  const size = (): { w: number; h: number } => ({ w: Math.max(1, host.clientWidth), h: Math.max(1, host.clientHeight) });
  let { w, h } = size();
  let fit = fitCamera(fitPoints, GARAGE_FOV_DEG, elevationDeg, w / h);

  if (opts.signal?.aborted) {
    staged.release();
    sand?.tex.dispose();
    throw leftEarly();
  }

  // --- the context exists from here --------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  const owned: { geometries: THREE.BufferGeometry[]; materials: THREE.Material[]; textures: THREE.Texture[] } = {
    geometries: [],
    materials: [],
    textures: [],
  };
  let key: THREE.DirectionalLight | null = null;
  let disposed = false;
  let lost = false;
  let frames = 0;
  /** The angle the last frame was drawn at, so a kit swap redraws there. */
  let lastYaw = 0;
  const onAbort = (): void => dispose();
  const onLost = (ev: Event): void => {
    ev.preventDefault();
    if (lost || disposed) return;
    lost = true;
    opts.onContextLost?.();
  };
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    opts.signal?.removeEventListener('abort', onAbort);
    renderer.domElement.removeEventListener('webglcontextlost', onLost);
    try {
      // Every texture once, by identity: a bake is shared by a live
      // material, its charred wreck clone and the pristine source's.
      const textures = new Set<THREE.Texture>(owned.textures);
      model.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        for (const mat of Array.isArray(m) ? m : m ? [m] : []) for (const t of texturesOf(mat)) textures.add(t);
      });
      for (const t of staged.sourceTextures?.() ?? []) textures.add(t);
      staged.release();
      for (const g of owned.geometries) g.dispose();
      for (const m of owned.materials) m.dispose();
      for (const t of textures) t.dispose();
      key?.shadow.dispose();
    } finally {
      disposeAndReleaseContext(renderer);
      renderer.domElement.remove();
    }
  }

  try {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = GARAGE_EXPOSURE;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    renderer.setClearAlpha(0);
    renderer.setSize(w, h, false);
    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.addEventListener('webglcontextlost', onLost);
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    // Sand.
    const geo = new THREE.CircleGeometry(sandR, 96);
    owned.geometries.push(geo);
    const alpha = sandAlpha();
    owned.textures.push(alpha);
    const ground = new THREE.Color(opts.colors.ground);
    const mat = new THREE.MeshStandardMaterial({
      color: ground,
      alphaMap: alpha,
      transparent: true,
      depthWrite: false,
      roughness: WORLD_ROUGHNESS,
      metalness: 0,
    });
    if (sand) {
      // Same image, same scale as a mission: `tiles` world units per repeat.
      const tiles = GROUND_ALBEDOS[sand.id].tiles;
      sand.tex.repeat.set((2 * sandR) / tiles, (2 * sandR) / tiles);
      mat.map = sand.tex;
      const mean = GROUND_ALBEDOS[sand.id].mean;
      mat.color.setRGB(
        ground.r / (mean[0] / 255),
        ground.g / (mean[1] / 255),
        ground.b / (mean[2] / 255),
        THREE.LinearSRGBColorSpace
      );
      owned.textures.push(sand.tex);
    }
    owned.materials.push(mat);
    const patch = new THREE.Mesh(geo, mat);
    patch.rotation.x = -Math.PI / 2;
    patch.scale.x = squash;
    patch.receiveShadow = true;
    // A team's patch stays put while each figure turns; a vehicle's sits on
    // the turntable's own origin -- the turn axis -- and turns with it, so
    // the sand's grain shows the turn.
    (cls === 'vehicle' ? model : stage).add(patch);

    // Lights, fixed in the ROOM.
    const dirs = stageLights();
    const reach = Math.max(4, sweepRadius * 4);
    key = new THREE.DirectionalLight(new THREE.Color(opts.colors.key), KEY_INTENSITY);
    key.position.copy(dirs.key).multiplyScalar(reach);
    key.castShadow = true;
    key.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    const sr = Math.max(sandR * 1.3, top * 1.5);
    Object.assign(key.shadow.camera, { left: -sr, right: sr, top: sr, bottom: -sr, near: 0.1, far: reach * 3 });
    key.shadow.camera.updateProjectionMatrix();
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 6;
    const fill = new THREE.DirectionalLight(new THREE.Color(opts.colors.fill), FILL_INTENSITY);
    fill.position.copy(dirs.fill).multiplyScalar(reach);
    const hemi = new THREE.HemisphereLight(new THREE.Color(opts.colors.sky), new THREE.Color(opts.colors.bounce), HEMI_INTENSITY);
    scene.add(key, key.target, fill, hemi);

    const camera = new THREE.PerspectiveCamera(GARAGE_FOV_DEG, w / h, 0.01, 200);
    const placeCamera = (): void => {
      camera.aspect = w / h;
      camera.position.copy(fit.position);
      camera.lookAt(fit.target);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
    };
    placeCamera();
    host.appendChild(canvas);

    const view: GarageView = {
      canvas,
      info: {
        typeId: opts.typeId,
        cls,
        pose: staged.pose,
        figures: staged.figures.length,
        figureRoots: staged.figures.map((b) => b.name),
        spacing: +staged.spacing.toFixed(3),
        sweepRadius: +sweepRadius.toFixed(3),
        defaultYawDeg: defaultYawDeg(cls),
        camera: { fovDeg: GARAGE_FOV_DEG, elevationDeg, distance: +fit.distance.toFixed(3) },
        sand: sand !== null,
      },
      stats: () => ({ frames, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
      draw(yawDeg) {
        if (disposed || lost) return;
        lastYaw = yawDeg;
        staged.applyYaw(yawDeg);
        scene.updateMatrixWorld(true);
        renderer.render(scene, camera);
        frames += 1;
      },
      resize() {
        if (disposed || lost) return;
        const next = size();
        if (next.w === w && next.h === h) return;
        w = next.w;
        h = next.h;
        renderer.setSize(w, h, false);
        fit = fitCamera(fitPoints, GARAGE_FOV_DEG, elevationDeg, w / h);
        placeCamera();
      },
      setKit(tiers) {
        if (disposed || lost || !staged.setKit) return;
        const releaseOld = staged.setKit(tiers);
        if (releaseOld === null) return;
        // Draw first, release after: see "Kit" in this file's header.
        view.draw(lastYaw);
        releaseOld();
      },
      dispose,
    };
    view.draw(0);
    return view;
  } catch (err) {
    dispose();
    throw err;
  }
}
