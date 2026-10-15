/**
 * Damage states for a living MESH vehicle (GH-31, the vehicle half) -- the
 * building route (`building-damage.ts`) applied to a hull. Approved on the
 * mock sheet (`_coord/vehicle-damage/`, 2026-10-14) with the lead's four
 * rulings: mix 0.75 for hulls (buildings stay 0.6), the existing wisp on any
 * badly damaged hull, helicopters scar and nothing else that flies does, and
 * no sim change.
 *
 *   band 8-6  clean    the template's own materials, untouched
 *   band 5-3  scarred  colour lerped toward the scar tint (`CHARRED_TINT_HEX`,
 *                      the wreck's tint until the soot recolour) by
 *                      `(1 - band/8) * VEHICLE_SCAR_MIX`, roughness toward 1
 *                      by the same mix -- the building formula
 *   band 2-1  wisp     the same scar, plus the existing thin
 *                      `vehicle_damaged_smoke` wisp (`vehicleTrailsDamageSmoke`,
 *                      `exhaust-slots.ts`). NO fire on a living hull: one
 *                      smoke source per hull, and the wisp stops at death,
 *                      where `wreck_smoulder` takes over
 *   band 0    wreck    unchanged: `mesh-vehicle-death.ts`
 *
 * The band is `structureHpBand` -- the SAME eighths a building is cut into.
 *
 * Who scars: every ground vehicle, and of the air vehicles only those whose
 * mesh carries a main rotor (`template.hasRotorPivot`: `heli_peten`,
 * `heli_peten_gunship`). The drones and the paramotor stay clean -- they die
 * in a hit or two and are too small to read a tint.
 *
 * Two material owners, one rule.
 *  - A hull that has never moved draws the TEMPLATE's materials, shared by
 *    every clone of its type, so it takes a memoised scarred clone per
 *    (template material x band), exactly as a building does: at most three
 *    bands x one or two materials per type for the whole map, never one per
 *    hull.
 *  - A hull that HAS moved draws a per-vehicle running-gear clone
 *    (`running-gear-binding.ts`, one per live vehicle, measured necessary for
 *    its wheel uniforms). Swapping that out would freeze the wheels, so the
 *    scar is WRITTEN onto the clone's own `color`/`roughness` -- plain
 *    uniforms, no new program, no new draw call. A bind that happens after a
 *    scar clones the scarred material and so inherits the band.
 *  Every lerp is taken from the TEMPLATE material, never from the previous
 *  band's state (`scarBase` unwraps a scar clone back to its template), so a
 *  hull that steps down three bands is not darkened three times.
 *
 * Only `entity.liveTop` is touched: `death_root`'s `WRECK_` twins keep their
 * own charred materials. Only lit materials are touched: the occlusion
 * outline's `MeshBasicMaterial` hangs under the same subtree
 * (`attachMeshSilhouette`) and is shared by every unit on a side.
 */
import * as THREE from 'three';
import { structureHpBand } from '../../grind';
import { CHARRED_TINT_HEX, liftTone } from '../world-materials';
import { BURN_BAND_MAX, SCAR_BAND_MAX } from './building-damage';
import { CHARRED_RAMP } from './vehicle-mesh-role';
import { runningGearBinding } from './running-gear-binding';
import type { VehicleMeshEntity } from './mesh-vehicle';

/** A clean hull's band, and the band of anything never processed. */
export const VEHICLE_BAND_CLEAN = 8;
/** The highest band that shows a scar: the building's own, 5 (8..6 clean). */
export const VEHICLE_SCAR_BAND_MAX = SCAR_BAND_MAX;
/** The highest band that trails the wisp: the building's burning band, 2. */
export const VEHICLE_WISP_BAND_MAX = BURN_BAND_MAX;
/** How far toward the wreck tone a hull sits before the band factor. The
 *  lead's ruling, 2026-10-14: 0.75 for hulls (buildings stay at 0.6), because
 *  at 0.6 the dark hulls (D9, jeep, Lavi, Eitan, Kipod, Grad) barely moved at
 *  zoom 1 until band 1. Band 3 lands at 0.469, band 1 at 0.656. */
export const VEHICLE_SCAR_MIX = 0.75;

export function vehicleDamageBand(hp: number, maxHp: number): number {
  return structureHpBand(hp, maxHp);
}

/** 0 for a clean band (and for band 0, the wreck's own), else
 *  `(1 - band/8) * VEHICLE_SCAR_MIX`. */
export function vehicleScarMixForBand(band: number): number {
  if (band > VEHICLE_SCAR_BAND_MAX || band <= 0) return 0;
  return (1 - band / 8) * VEHICLE_SCAR_MIX;
}

/** Bands 1..`VEHICLE_WISP_BAND_MAX` trail the wisp. */
export function vehicleWispsAtBand(band: number): boolean {
  return band >= 1 && band <= VEHICLE_WISP_BAND_MAX;
}

/** Ground vehicles scar; of the air vehicles, helicopters (a main rotor) only. */
export function vehicleTakesDamageStates(isAir: boolean, hasRotorPivot: boolean): boolean {
  return !isAir || hasRotorPivot;
}

function charTarget(std: THREE.MeshStandardMaterial): THREE.Color {
  return new THREE.Color(std.map ? CHARRED_TINT_HEX : liftTone(CHARRED_RAMP));
}

/** Writes the scar for `mix` onto `out`, derived from `base` alone. */
function writeScar(out: THREE.MeshStandardMaterial, base: THREE.MeshStandardMaterial, mix: number): void {
  out.color.copy(base.color).lerp(charTarget(base), mix);
  out.roughness = base.roughness + (1 - base.roughness) * mix;
}

/** Every scar clone -> the template material it was cut from. */
const scarBase = new WeakMap<THREE.Material, THREE.Material>();
/** The band each entity is DRAWN at -- what the wisp reads, so the smoke and
 *  the scar cannot disagree. Keyed by entity, so a rebuilt clone starts clean
 *  with its own clean materials. */
const drawnBand = new WeakMap<VehicleMeshEntity, number>();

/** The band `applyVehicleDamageBand` last drew `entity` at; clean if never. */
export function vehicleDrawnBand(entity: VehicleMeshEntity): number {
  return drawnBand.get(entity) ?? VEHICLE_BAND_CLEAN;
}

/**
 * The per-type memo: one scarred clone per (template material x band),
 * minted on first use. The renderer keeps one per vehicle type.
 */
export class VehicleScarMaterials {
  private readonly byBase = new Map<THREE.Material, Map<number, THREE.MeshStandardMaterial>>();

  /** The material a template-sharing mesh draws at `band`: `base` itself for
   *  a clean band or an unlit material, else the memoised scarred clone. */
  materialFor(base: THREE.Material, band: number): THREE.Material {
    const mix = vehicleScarMixForBand(band);
    const std = base as THREE.MeshStandardMaterial;
    if (mix === 0 || !std.isMeshStandardMaterial) return base;
    let perBand = this.byBase.get(base);
    if (!perBand) {
      perBand = new Map();
      this.byBase.set(base, perBand);
    }
    let scarred = perBand.get(band);
    if (!scarred) {
      scarred = std.clone();
      writeScar(scarred, std, mix);
      scarred.needsUpdate = true;
      perBand.set(band, scarred);
      scarBase.set(scarred, base);
    }
    return scarred;
  }

  /** How many scarred clones exist -- what the memo is measured by. */
  get size(): number {
    let n = 0;
    for (const perBand of this.byBase.values()) n += perBand.size;
    return n;
  }

  /** Releases every clone. Their textures belong to the template
   *  (`Material.clone` copies the reference), so they are not disposed. */
  dispose(): void {
    for (const perBand of this.byBase.values()) for (const m of perBand.values()) m.dispose();
    this.byBase.clear();
  }
}

/**
 * Draws `entity`'s live meshes at `band`. Idempotent, and a clean band puts
 * each mesh's template material back. Called by `ThreeRenderer` when the band
 * moves, and again after `releaseRunningGear` hands a dying hull its
 * pre-bind materials back.
 */
export function applyVehicleDamageBand(entity: VehicleMeshEntity, band: number, scars: VehicleScarMaterials): void {
  drawnBand.set(entity, band);
  const rg = runningGearBinding(entity);
  const rgOriginal = new Map<THREE.Material, THREE.Material>();
  if (rg) for (const s of rg.swaps) rgOriginal.set(s.mesh.material as THREE.Material, s.original);
  const mix = vehicleScarMixForBand(band);
  for (const top of entity.liveTop) {
    top.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const current = mesh.material;
      const original = rgOriginal.get(current);
      if (original) {
        // This vehicle's own running-gear clone: written in place.
        const base = (scarBase.get(original) ?? original) as THREE.MeshStandardMaterial;
        if (base.isMeshStandardMaterial && (current as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
          writeScar(current as THREE.MeshStandardMaterial, base, mix);
        }
        return;
      }
      mesh.material = scars.materialFor(scarBase.get(current) ?? current, band);
    });
  }
}
