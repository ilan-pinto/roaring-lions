/**
 * Look uplift L3 (GH-943): the team-colour MASK on a vehicle's own bake.
 *
 * Team colour has never reached a textured body: only outlines, rings, flashes, minimap and icons
 * carry it, and the lead rejected a solid fill on silhouettes as "too loud". The mask is small
 * (about 2% of the Lavi: a roof recognition panel and a turret-side band) and it lives in the
 * INVERTED ALPHA of the ORM map (`maps-pass.ts`): 255 is the bake, 0 is team colour, so a
 * premultiply or an optimiser can only ever damage the band, never the hull's roughness. The
 * loader pins `premultiplyAlpha: 'none'`.
 *
 * The hook sits at `color_fragment`, AFTER `map_fragment` and the running-gear tread shading and
 * BEFORE lighting, so grime survives:
 *
 *     diffuse = mix(bake, teamLinear * luma(bake) / rl_team_luma, strength * (1 - A))
 *
 * **Clones.** A material cannot be recoloured per unit without a draw cost, so one VARIANT per
 * (template material x colour slot) is cut lazily (`VehicleTeamMaterials`): own, hostile and
 * neutral, +0 draw calls, +0 textures, +0 programs beyond the one `TEAM_MASK_PROGRAM_KEY`. The
 * colour is a SHARED linear uniform per slot, so a colour-vision switch (`setTeamColors`) is one
 * write plus `needsUpdate`, never a rebuild.
 *
 * **Re-hooking.** `Material.clone()` drops `onBeforeCompile` and `customProgramCacheKey`, and a
 * scar clone (`vehicle-damage.ts`) or a running-gear clone (`running-gear-material.ts`) is cut with
 * `clone()`. `carryAuthored` re-applies the hook on such a clone, composing with whatever hook the
 * clone already carries. A clone whose KEY says "team mask" but whose shader lacks the patch would
 * poison the program cache for every material sharing that key, so the key is only ever added
 * together with the patch.
 *
 * **Not on a wreck.** A wreck has no side. `charredTexturedMaterial` never calls this, and the
 * soot shader replaces `map_fragment` and carries no hook.
 */
import * as THREE from 'three';
import { hexToLinear } from '../terrain/shared';
import { isAuthoredMaterial, prepareAuthoredMaps, registerAuthored, setNormalMapsPass } from './authored-maps';
import type { VehicleMeshEntity } from './mesh-vehicle';

/** The lead's ruling (2 Nov, GH-943): strength 0.85. */
export const TEAM_MASK_STRENGTH = 0.85;
/** The material extras key `maps-pass.ts` writes. */
export const TEAM_LUMA_USERDATA_KEY = 'rl_team_luma';
export const TEAM_MASK_PROGRAM_KEY = 'rl-team-mask-1';
/** `colorSlot`'s three: own, hostile, neutral. */
export const TEAM_SLOT_COUNT = 3;

interface Uniform<T> {
  value: T;
}

export interface TeamHook {
  readonly color: Uniform<THREE.Vector3>;
  readonly strength: Uniform<number>;
  readonly luma: Uniform<number>;
}

/** The fragment patch. Exported so a test can compile the exact text. */
export const TEAM_MASK_HEAD = /* glsl */ `#include <common>
uniform vec3 uTeamColor;
uniform float uTeamStrength;
uniform float uTeamLuma;`;

export const TEAM_MASK_FRAGMENT = /* glsl */ `#include <color_fragment>
#ifdef USE_ROUGHNESSMAP
{
  float rlTeamMask = uTeamStrength * ( 1.0 - texture2D( roughnessMap, vRoughnessMapUv ).a );
  float rlBakeY = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec3 rlPanel = min( uTeamColor * ( rlBakeY / uTeamLuma ), vec3( 1.0 ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, rlPanel, rlTeamMask );
}
#endif`;

export function patchTeamMask(fragment: string): string {
  if (!fragment.includes('#include <color_fragment>') || !fragment.includes('#include <common>')) {
    throw new Error('team-mask: the fragment shader has no <common> or <color_fragment> to patch (three changed its chunks?)');
  }
  return fragment.replace('#include <common>', TEAM_MASK_HEAD).replace('#include <color_fragment>', TEAM_MASK_FRAGMENT);
}

/** The strength EVERY hooked material shares: the `team-mask` debug layer writes it. */
const sharedStrength: Uniform<number> = { value: TEAM_MASK_STRENGTH };

/** Which hook (if any) a material carries, so a clone can carry it on. */
const hooks = new WeakMap<THREE.Material, TeamHook>();
const liveVariants = new Set<WeakRef<THREE.Material>>();

export function teamHookOf(m: THREE.Material): TeamHook | undefined {
  return hooks.get(m);
}

function installHook(mat: THREE.MeshStandardMaterial, hook: TeamHook, addKey: boolean): void {
  const prior = mat.onBeforeCompile;
  if (addKey) {
    const baseKey = mat.customProgramCacheKey();
    mat.customProgramCacheKey = () => `${baseKey}|${TEAM_MASK_PROGRAM_KEY}`;
  }
  mat.onBeforeCompile = (shader, renderer) => {
    prior.call(mat, shader, renderer);
    shader.uniforms.uTeamColor = hook.color;
    shader.uniforms.uTeamStrength = hook.strength;
    shader.uniforms.uTeamLuma = hook.luma;
    shader.fragmentShader = patchTeamMask(shader.fragmentShader);
  };
  hooks.set(mat, hook);
  mat.needsUpdate = true;
}

/**
 * A clone cut from `source`: keep what `source` carries. Registers the clone for the `normal-maps`
 * layer when its maps are authored, and re-applies the team hook when `source` has one. The clone's
 * own `onBeforeCompile` (the running gear's) runs first. A no-op for an ordinary material.
 */
export function carryAuthored(clone: THREE.Material, source: THREE.Material): void {
  if (!isAuthoredMaterial(clone)) return;
  const std = clone as THREE.MeshStandardMaterial;
  registerAuthored(std, source);
  const hook = hooks.get(source);
  if (!hook || hooks.has(clone)) return;
  const key = clone.customProgramCacheKey();
  installHook(std, hook, !key.includes(TEAM_MASK_PROGRAM_KEY));
}

/** The mean linear luma the maps pass stamped on the bake's team texels, or null. */
export function teamLumaOf(m: THREE.Material): number | null {
  const v = (m.userData as Record<string, unknown> | undefined)?.[TEAM_LUMA_USERDATA_KEY];
  return typeof v === 'number' && v > 0 ? v : null;
}

/** The three shared slot colours (linear). One per renderer; every variant of a slot reads the same uniform. */
export class TeamMaskSlots {
  readonly colors: readonly Uniform<THREE.Vector3>[];
  constructor(hexes: readonly string[]) {
    if (hexes.length < TEAM_SLOT_COUNT) throw new Error(`TeamMaskSlots: need ${TEAM_SLOT_COUNT} colours, got ${hexes.length}`);
    this.colors = Array.from({ length: TEAM_SLOT_COUNT }, (_, i) => ({ value: new THREE.Vector3(...hexToLinear(hexes[i])) }));
  }

  /** Write the slot colours; a variant switch (colour vision) is this and nothing else. */
  set(hexes: readonly string[]): void {
    for (let i = 0; i < TEAM_SLOT_COUNT; i++) this.colors[i].value.set(...hexToLinear(hexes[i]));
  }
}

/**
 * The variants of a template's materials, one per colour slot, minted on first use and memoised.
 * The renderer keeps one per template key (like `VehicleScarMaterials`); the garage keeps one.
 */
export class VehicleTeamMaterials {
  private readonly byBase = new Map<THREE.Material, Map<number, THREE.MeshStandardMaterial>>();

  constructor(
    private readonly slots: TeamMaskSlots,
    /** Called once per variant minted, so the renderer can hand it to the environment registry. */
    private readonly onMint?: (m: THREE.MeshStandardMaterial) => void
  ) {}

  /** `base` itself when it has no mask (not authored, or no team luma); else the slot's variant. */
  materialFor(base: THREE.Material, slot: number): THREE.Material {
    const luma = teamLumaOf(base);
    if (luma === null || !isAuthoredMaterial(base)) return base;
    const std = base as THREE.MeshStandardMaterial;
    if (!(slot >= 0 && slot < TEAM_SLOT_COUNT)) throw new Error(`VehicleTeamMaterials: colour slot ${slot} is not 0..${TEAM_SLOT_COUNT - 1}`);
    let perSlot = this.byBase.get(base);
    if (!perSlot) {
      perSlot = new Map();
      this.byBase.set(base, perSlot);
    }
    let v = perSlot.get(slot);
    if (!v) {
      prepareAuthoredMaps(std);
      v = std.clone();
      installHook(v, { color: this.slots.colors[slot], strength: sharedStrength, luma: { value: luma } }, true);
      v.userData = { ...(v.userData as Record<string, unknown>), rlTeamSlot: slot };
      registerAuthored(v, base);
      liveVariants.add(new WeakRef(v));
      perSlot.set(slot, v);
      this.onMint?.(v);
    }
    return v;
  }

  /** Swap every LIVE mesh of `entity` onto its slot's variant. A wreck (`deathRoot`) is not in `liveTop`. */
  applyTo(entity: VehicleMeshEntity, slot: number): number {
    let n = 0;
    for (const top of entity.liveTop) {
      top.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || Array.isArray(mesh.material)) return;
        const next = this.materialFor(mesh.material, slot);
        if (next !== mesh.material) {
          mesh.material = next;
          n++;
        }
      });
    }
    return n;
  }

  /** How many variants exist (what the memo is measured by). */
  get size(): number {
    let n = 0;
    for (const per of this.byBase.values()) n += per.size;
    return n;
  }

  /** The variants themselves, for the renderer's `needsUpdate` after a colour switch. */
  variants(): THREE.MeshStandardMaterial[] {
    const out: THREE.MeshStandardMaterial[] = [];
    for (const per of this.byBase.values()) out.push(...per.values());
    return out;
  }

  /** Releases every variant. Their textures belong to the template (`clone` copies the reference). */
  dispose(): void {
    for (const per of this.byBase.values()) for (const m of per.values()) m.dispose();
    this.byBase.clear();
  }
}

/** The `team-mask` debug layer: the shared strength to 0 and back. Returns how many variants exist. */
export function setTeamMaskPass(on: boolean): number {
  sharedStrength.value = on ? TEAM_MASK_STRENGTH : 0;
  let n = 0;
  for (const ref of [...liveVariants]) {
    if (ref.deref()) n++;
    else liveVariants.delete(ref);
  }
  return n;
}

export { setNormalMapsPass };
