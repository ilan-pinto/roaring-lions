/**
 * Damage states for a MESH building (GH-31, the A3.2 remainder,
 * `docs/art/a32-remainder-plan.md` section 2) -- the material route.
 *
 * Until this, `ThreeRenderer.updateBuildingMeshes` read `st.alive` and
 * nothing else: a building at 1 hp drew pixel-identical to one at full HP
 * until the tick it died. The darkening GH-31 names as "the pattern to
 * follow" (`structureAliveAlpha`, `units/structures.ts`) runs on the
 * billboard path alone, which no mesh building takes on `three`.
 *
 * Three visible states on the living clone plus the existing wreck, all
 * presentation on the frame clock, nothing read back by the sim, no new GLB:
 *
 *   band 8-6  clean    the template's own materials, untouched
 *   band 5-3  scarred  `scarredMaterial`: the charring treatment at a
 *                      FRACTION -- `color` lerped from the material's own
 *                      toward the wreck tint by `(1 - band/8) * SCAR_MIX`,
 *                      roughness lerped toward 1 by the same mix
 *   band 2-1  burning  the scarred treatment at that band, plus the
 *                      `structure_burning` emitter on the renderer's timer
 *   band 0    wreck    unchanged: the `_wreck` clone, the settle and the
 *                      collapse FX; the emitter is handed to the wreck for
 *                      `WRECK_BURN_SECONDS` and then stops
 *
 * The band is `structureHpBand` (`../../grind.ts`), the SAME eighths the
 * billboard path and the overlay log already cut HP into, so a log line and
 * the material step it reports cannot fall a bite out of step. Stepped per
 * band and not continuous, deliberately: one memoised clone per (template
 * material x band), so a type costs at most five extra materials for the
 * whole map rather than one per instance, and a frozen gate frame cannot
 * drift between two captures of the same tick.
 *
 * Zero movement at full HP by construction: band 8 maps to the untouched
 * template, so every gated scenario (none of which damages a building
 * before its capture tick) reads 0 px. The assertion is the PR's `visual`
 * job, not this comment.
 *
 * The treatment is the vehicle wreck's own (`charredTexturedMaterial`,
 * `../world-materials.ts`) applied partially: a textured bake keeps its
 * photograph and is tinted toward `CHARRED_TINT_HEX`; a palette material has
 * no map and is lerped toward the charred ramp's lit tone instead
 * (`CHARRED_RAMP`, the same slice a palette vehicle wreck takes). Both are
 * CLONES, never mutations -- a template material is shared by every clone of
 * that type, so darkening it in place would scar every building of the type
 * at once.
 */
import * as THREE from 'three';
import { structureHpBand } from '../../grind';
import { CHARRED_TINT_HEX, liftTone } from '../world-materials';
import { CHARRED_RAMP } from './vehicle-mesh-role';

/** The highest band that shows any scarring; 8..6 are clean. */
export const SCAR_BAND_MAX = 5;
/** The highest band that burns; 2..1 burn, and the wreck for a while. */
export const BURN_BAND_MAX = 2;
/** How far toward the wreck tint a building sits at band 0, before the band
 *  factor: band 3 lands at `0.6 x (1 - 3/8)` = 0.375 of the way. */
export const SCAR_MIX = 0.6;
/** How long a wreck keeps its fire after the structure dies burning. */
export const WRECK_BURN_SECONDS = 20;
/** The renderer's own timer for `structure_burning`: one spawn of every
 *  layer per interval per burning structure. */
export const STRUCTURE_BURN_INTERVAL_MS = 650;
/** The particle magnitude of the flame layer (`ParticleSystem.spawn`'s
 *  size and count scale): embers, not a burst. */
export const STRUCTURE_BURN_MAGNITUDE = 0.3;
/** How long each smoke plume a burning building throws lives. */
export const STRUCTURE_BURN_PLUME_MS = 2600;
/** A wreck's fire sits lower than a standing building's: the roof band it is
 *  anchored at is scaled by this once the building is down. */
export const WRECK_BURN_HEIGHT_FRACTION = 0.35;

/** `structureHpBand` under its own name here, so the renderer's three
 *  readers of the band (this module, the overlay log and the billboard
 *  wear step) are one expression. */
export function buildingDamageBand(hp: number, maxHp: number): number {
  return structureHpBand(hp, maxHp);
}

/** How far toward the wreck tint a band sits: 0 for a clean band, and
 *  `(1 - band/8) * SCAR_MIX` from `SCAR_BAND_MAX` down. Band 0 is the wreck,
 *  which takes its own clone and never asks. */
export function scarMixForBand(band: number): number {
  if (band > SCAR_BAND_MAX || band <= 0) return 0;
  return (1 - band / 8) * SCAR_MIX;
}

/** Bands 1..`BURN_BAND_MAX` burn. Band 0 is the wreck's own hand-off, decided
 *  by whether the structure was burning when it died, not by this. */
export function isBurningBand(band: number): boolean {
  return band >= 1 && band <= BURN_BAND_MAX;
}

/**
 * The scarred clone of one template material at one band. Pure: a fresh
 * clone every call -- `BuildingScarMaterials` below is the memo.
 */
export function scarredMaterial(base: THREE.Material, band: number): THREE.MeshStandardMaterial {
  const mix = scarMixForBand(band);
  const std = base as THREE.MeshStandardMaterial;
  if (!std.isMeshStandardMaterial) {
    throw new Error(`building-damage: ${base.type} is not a MeshStandardMaterial`);
  }
  const scarred = std.clone();
  const target = new THREE.Color(std.map ? CHARRED_TINT_HEX : liftTone(CHARRED_RAMP));
  scarred.color.lerp(target, mix);
  scarred.roughness = std.roughness + (1 - std.roughness) * mix;
  scarred.needsUpdate = true;
  return scarred;
}

/**
 * The per-type memo: one scarred clone per (template material x band),
 * minted on first use, plus the record of which template material each
 * clone MESH started with so a later band can be derived from the base and
 * not from the previous band's clone (which would compound the lerp).
 *
 * The base record is a `WeakMap` on the mesh, never `userData`:
 * `Object3D.copy` deep-copies `userData` through `JSON.stringify`, and a
 * material in there would be cloned into a dead object or throw on the
 * texture's own cycles.
 */
export class BuildingScarMaterials {
  private readonly byBase = new Map<THREE.Material, Map<number, THREE.MeshStandardMaterial>>();
  private readonly baseOf = new WeakMap<THREE.Mesh, THREE.Material>();

  /** The material a mesh should draw at `band`: its own base for a clean
   *  band, else the memoised scarred clone. */
  materialFor(mesh: THREE.Mesh, band: number): THREE.Material {
    const current = mesh.material as THREE.Material;
    let base = this.baseOf.get(mesh);
    if (!base) {
      base = current;
      this.baseOf.set(mesh, base);
    }
    if (scarMixForBand(band) === 0) return base;
    let perBand = this.byBase.get(base);
    if (!perBand) {
      perBand = new Map();
      this.byBase.set(base, perBand);
    }
    let scarred = perBand.get(band);
    if (!scarred) {
      scarred = scarredMaterial(base, band);
      perBand.set(band, scarred);
    }
    return scarred;
  }

  /** How many scarred clones exist -- what the memo is measured by. */
  get size(): number {
    let n = 0;
    for (const perBand of this.byBase.values()) n += perBand.size;
    return n;
  }

  /** Releases every clone. The maps they share with their base are the
   *  base's to release (`disposeBuildingMeshTemplate`), not this memo's:
   *  `Material.clone` copies the texture REFERENCE, so disposing it here
   *  would pull the photograph out from under the living template. */
  dispose(): void {
    for (const perBand of this.byBase.values()) {
      for (const scarred of perBand.values()) scarred.dispose();
    }
    this.byBase.clear();
  }
}

/** Sets every mesh under `root` to the material `scars` answers for `band`.
 *  Idempotent, and a clean band restores each mesh's own base. */
export function applyBuildingDamageBand(root: THREE.Object3D, band: number, scars: BuildingScarMaterials): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = scars.materialFor(mesh, band);
  });
}
