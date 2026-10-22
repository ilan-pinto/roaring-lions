/**
 * GH-748: draws the aircraft over a fire-support call -- the Peten gunship
 * on station over a mortar barrage, the strike jet's pass over an air strike
 * -- from the pure poses in `../support-air.ts`.
 *
 * Not a unit. Nothing here is in the sim, selectable, ringed, fogged or on the
 * minimap: the plans come from `Renderer.supportCalled` (the app, when a call
 * is accepted) and the clock is the sim clock the caller hands `update`.
 *
 * Both meshes load ONCE per renderer (`load`), not per call. The helicopter is
 * its own copy of `heli_peten_gunship`'s vehicle template, deliberately not
 * the one a mission that fields the gunship draws its units from: that one is
 * replaced and torn down with its type, and an aircraft mid-pass must not be.
 * The jet is a rigid GLB with its own bake (`art/meshes/vfx/strike_jet.glb`).
 *
 * The `support-air` debug layer hides `group` through a FLAG that `update`
 * consults, because `update` writes `group.visible` every frame (the
 * `missiles` layer's shape).
 */
import * as THREE from 'three';
import {
  bombFallFraction,
  isFirstRound,
  makeSupportAirPlan,
  profileOf,
  reanchor,
  supportAirPose,
  planSpanMs,
  type SupportAirKind,
  type SupportAirPlan,
} from '../support-air';
import { gltfLoader } from './gltf-loader';
import { MESH_SCALE, meshYawFromFacing } from './mesh-anim';
import {
  disposeVehicleMeshEntity,
  disposeVehicleMeshTemplate,
  instantiateVehicleMesh,
  loadVehicleMeshTemplate,
  type VehicleMeshEntity,
  type VehicleMeshTemplate,
} from './mesh-vehicle';
import { rotorSpinPhase } from './rotor-spin';
import { texturedMaterial } from '../world-materials';
import { FX_RENDER_ORDER_ADDITIVE } from './render-order';

/** The gunship's own unit id: its vehicle-role ramp and textured-bake rule. */
export const SUPPORT_HELI_TYPE = 'heli_peten_gunship';
/** One full turn a second, `ThreeRenderer`'s own unit rotor rate. */
const ROTOR_RAD_PER_SEC = Math.PI * 2;
/** At most this many calls fly at once; the oldest is dropped past it. */
export const MAX_SUPPORT_FLIGHTS = 4;
/** The bomb: length and radius in world units (tiles). */
const BOMB_LENGTH = 0.55;
const BOMB_RADIUS = 0.06;
/** How near (tiles) a `strike` must land to a plan's aim point to re-anchor it:
 *  the barrage's 1.5-tile scatter plus slack. */
const REANCHOR_REACH_TILES = 2.5;

/** The world-Y of the ground under (x, y), tiles in and out. */
export type GroundYAt = (x: number, y: number) => number;

interface Flight {
  readonly plan: SupportAirPlan;
  heli: VehicleMeshEntity | null;
  jet: THREE.Object3D | null;
  bomb: THREE.Mesh | null;
}

/** Releases a parsed scene nothing adopted: every geometry, material and map. */
function disposeLoadedScene(scene: THREE.Object3D): void {
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial;
      for (const t of [std.map, std.normalMap, std.roughnessMap, std.metalnessMap, std.emissiveMap]) t?.dispose();
      m.dispose();
    }
  });
}

export class SupportAircraftManager {
  readonly group = new THREE.Group();
  private heliTemplate: VehicleMeshTemplate | null = null;
  private jetTemplate: THREE.Object3D | null = null;
  private readonly jetOwned: {
    materials: THREE.Material[];
    geometries: THREE.BufferGeometry[];
    textures: Set<THREE.Texture>;
  } = { materials: [], geometries: [], textures: new Set() };
  private readonly flights: Flight[] = [];
  private readonly bombGeometry = new THREE.CylinderGeometry(BOMB_RADIUS, BOMB_RADIUS * 0.7, BOMB_LENGTH, 8);
  private readonly bombMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3d3f, roughness: 0.6, metalness: 0 });
  private readonly glowGeometry = new THREE.SphereGeometry(1, 10, 8);
  private readonly glowMaterial: THREE.MeshBasicMaterial;
  private debugHidden = false;
  private disposed = false;

  constructor(glowColor: THREE.ColorRepresentation) {
    this.group.name = 'support-air';
    this.glowMaterial = new THREE.MeshBasicMaterial({
      color: glowColor,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }

  /** Loads both meshes. Either may fail alone: a call then flies what loaded. */
  async load(heliUrl: string, jetUrl: string): Promise<void> {
    const [heli, jet] = await Promise.allSettled([
      loadVehicleMeshTemplate(heliUrl, SUPPORT_HELI_TYPE, true),
      gltfLoader().loadAsync(jetUrl),
    ]);
    if (this.disposed) {
      if (heli.status === 'fulfilled') disposeVehicleMeshTemplate(heli.value);
      if (jet.status === 'fulfilled') disposeLoadedScene(jet.value.scene);
      return;
    }
    if (heli.status === 'fulfilled') this.heliTemplate = heli.value;
    else console.error(`support aircraft: ${heliUrl} failed to load`, heli.reason);
    if (jet.status === 'fulfilled') this.jetTemplate = this.adoptJet(jet.value.scene);
    else console.error(`support aircraft: ${jetUrl} failed to load`, jet.reason);
  }

  get ready(): { heli: boolean; jet: boolean } {
    return { heli: this.heliTemplate !== null, jet: this.jetTemplate !== null };
  }

  /** How many calls are in flight (a test and harness read). */
  get flightCount(): number {
    return this.flights.length;
  }

  private adoptJet(scene: THREE.Object3D): THREE.Object3D {
    scene.scale.setScalar(MESH_SCALE);
    const box = new THREE.Box3().setFromObject(scene);
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const before = mesh.material as THREE.Material;
      const mat = texturedMaterial(before);
      if (mat !== before) before.dispose();
      mesh.material = mat;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      this.jetOwned.materials.push(mat);
      for (const t of [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap, mat.emissiveMap]) {
        if (t) this.jetOwned.textures.add(t);
      }
      this.jetOwned.geometries.push(mesh.geometry);
    });
    // The afterburner: one additive glow at the tail, in the root's own
    // (scaled) space so it rides every clone. Measured off the bounds, so a
    // re-export cannot leave it floating.
    const glow = new THREE.Mesh(this.glowGeometry, this.glowMaterial);
    glow.name = 'afterburner';
    glow.renderOrder = FX_RENDER_ORDER_ADDITIVE;
    const tailX = box.min.x / MESH_SCALE;
    const midY = (box.min.y + box.max.y) / 2 / MESH_SCALE;
    glow.position.set(tailX, midY * 0.9, 0);
    glow.scale.set(0.45, 0.22, 0.32);
    scene.add(glow);
    return scene;
  }

  /** Starts a call's aircraft. `fromX/fromY`: the friendly centroid, tiles. */
  call(kind: SupportAirKind, callTick: number, x: number, y: number, fromX: number | null, fromY: number | null): void {
    if (this.flights.length >= MAX_SUPPORT_FLIGHTS) this.retire(this.flights[0]);
    this.flights.push({ plan: makeSupportAirPlan(kind, callTick, x, y, fromX, fromY), heli: null, jet: null, bomb: null });
  }

  /** A sim `strike` landed: re-anchor the oldest un-anchored plan of its kind near it. */
  onStrike(profile: number, tick: number, x: number, y: number): void {
    for (const f of this.flights) {
      const p = f.plan;
      if (profileOf(p.kind) !== profile || !isFirstRound(p, tick)) continue;
      if (Math.hypot(x - p.ax, y - p.ay) > REANCHOR_REACH_TILES) continue;
      reanchor(p, tick);
      return;
    }
  }

  setDebugHidden(hidden: boolean): number {
    this.debugHidden = hidden;
    this.group.visible = !hidden;
    return 1;
  }

  /** Poses every flight at sim time `nowMs`. */
  update(nowMs: number, groundY: GroundYAt): void {
    this.group.visible = !this.debugHidden;
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      const pose = supportAirPose(f.plan, nowMs);
      if (pose === null) {
        // Before its span it waits; after it, it is done.
        if (nowMs - f.plan.anchorMs > planSpanMs(f.plan.kind).end) this.retire(f);
        else this.hide(f);
        continue;
      }
      const root = this.ensureBody(f);
      if (root === null) continue;
      root.visible = true;
      root.position.set(pose.x, groundY(pose.x, pose.y) + pose.liftWu, pose.y);
      root.rotation.set(0, meshYawFromFacing(pose.facingTurns), pose.pitchRad, 'YZX');
      if (f.heli?.rotorPivot) f.heli.rotorPivot.rotation.y = rotorSpinPhase(nowMs, ROTOR_RAD_PER_SEC);
      this.poseBomb(f, nowMs, groundY);
    }
  }

  private poseBomb(f: Flight, nowMs: number, groundY: GroundYAt): void {
    const k = bombFallFraction(f.plan, nowMs);
    if (k === null || f.jet === null) {
      if (f.bomb) f.bomb.visible = false;
      return;
    }
    if (f.bomb === null) {
      f.bomb = new THREE.Mesh(this.bombGeometry, this.bombMaterial);
      f.bomb.castShadow = true;
      this.group.add(f.bomb);
    }
    const p = f.plan;
    const release = supportAirPose(p, nowMs - k * 400);
    const g = groundY(p.ax, p.ay);
    const topY = release ? g + release.liftWu : g + 2;
    // Released over the aim point, falling with an ease-in (gravity).
    const fall = k * k;
    f.bomb.visible = true;
    f.bomb.position.set(p.ax, topY + (g - topY) * fall, p.ay);
    // Nose down, tilted along the run-in.
    f.bomb.rotation.set(0, meshYawFromFacing(Math.atan2(-p.fy, -p.fx) / (2 * Math.PI)), -Math.PI / 2 + 0.5 * (1 - k), 'YZX');
  }

  private ensureBody(f: Flight): THREE.Object3D | null {
    if (f.plan.kind === 'barrage') {
      if (f.heli === null && this.heliTemplate !== null) {
        f.heli = instantiateVehicleMesh(this.heliTemplate, SUPPORT_HELI_TYPE);
        this.group.add(f.heli.root);
      }
      return f.heli?.root ?? null;
    }
    if (f.jet === null && this.jetTemplate !== null) {
      f.jet = this.jetTemplate.clone(true);
      this.group.add(f.jet);
    }
    return f.jet;
  }

  private hide(f: Flight): void {
    if (f.heli) f.heli.root.visible = false;
    if (f.jet) f.jet.visible = false;
    if (f.bomb) f.bomb.visible = false;
  }

  private retire(f: Flight): void {
    const i = this.flights.indexOf(f);
    if (i >= 0) this.flights.splice(i, 1);
    if (f.heli) {
      this.group.remove(f.heli.root);
      disposeVehicleMeshEntity(f.heli);
    }
    if (f.jet) this.group.remove(f.jet);
    if (f.bomb) this.group.remove(f.bomb);
  }

  dispose(): void {
    this.disposed = true;
    for (const f of [...this.flights]) this.retire(f);
    if (this.heliTemplate) disposeVehicleMeshTemplate(this.heliTemplate);
    this.heliTemplate = null;
    for (const m of this.jetOwned.materials) m.dispose();
    for (const g of this.jetOwned.geometries) g.dispose();
    for (const t of this.jetOwned.textures) t.dispose();
    this.jetTemplate = null;
    this.bombGeometry.dispose();
    this.bombMaterial.dispose();
    this.glowGeometry.dispose();
    this.glowMaterial.dispose();
  }
}
