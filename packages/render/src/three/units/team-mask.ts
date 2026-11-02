/**
 * Look uplift L3 (GH-943): the TEAM MARK on a vehicle's own bake.
 *
 * Team colour has never reached a textured body: only outlines, rings, flashes, minimap and icons carry it,
 * and the lead rejected a solid fill on silhouettes as "too loud". The mark is small (about 2% of the Lavi): a
 * clean rectangular roof recognition panel and a band on each flank of the turret, with hard straight edges.
 *
 * **It is procedural, not a texture.** The GLB carries two boxes (`material.extras.rl_team_mark`, written by
 * `tools/src/meshes/mark-pass.ts`) in the vehicle's own mesh-local frame, and the fragment shader tests its
 * OBJECT-space position and normal against them. So its edges are straight lines in that frame and cannot follow
 * a UV seam (the first cut stored the mark in a texture and read as ragged blotches along the islands), and it
 * costs no texture memory. The first cut's inverted-alpha ORM texture is gone with its maps.
 *
 * **It turns with the turret.** The turret's meshes hang off `turret_pivot`, whose rotation is a node transform;
 * the shader reads the `position` and `normal` ATTRIBUTES, which never see it. Nothing here reads a world matrix.
 *
 * **Which meshes carry it.** Only a mesh whose `rl_role` is `hull` (the hull and the turret body); the barrel, the
 * antennas and the tracks are other roles and keep their surface clone. A kit part merged into a hull mesh is
 * excluded by its UV: the kit pass pins every kit part to one of three bake texels, so a fragment whose UV is
 * within `exclude_radius` of one is a kit part. A wreck takes none: `charredTexturedMaterial` never calls this.
 *
 * The hook sits at `color_fragment`, AFTER `map_fragment` and the running-gear tread shading and BEFORE lighting,
 * so grime survives:
 *
 *     diffuse = mix(bake, teamLinear * mix(1, luma(bake) / rl_team_mark.luma, 0.3), strength * mark)
 *
 * A marking is PAINT: it keeps 30% of the bake's grime (the first cut kept all of it, and the camouflage under the panel read
 * through as dark blotches).
 *
 * **Clones.** One VARIANT per (template material x colour slot) is cut lazily (`VehicleTeamMaterials`): own,
 * hostile and neutral, +0 draw calls, +0 textures, one program (`TEAM_MASK_PROGRAM_KEY`). The colour is a SHARED
 * linear uniform per slot, so a colour-vision switch (`setTeamColors`) is one write plus `needsUpdate`.
 *
 * **Re-hooking.** `Material.clone()` drops `onBeforeCompile` and `customProgramCacheKey`, and a scar clone
 * (`vehicle-damage.ts`) or a running-gear clone (`running-gear-material.ts`) is cut with `clone()`.
 * `carryTeamMark` re-applies the hook, composing with whatever hook the clone already carries. A clone whose KEY
 * says "team mark" but whose shader lacks the patch would poison the program cache for every material sharing that
 * key, so the key is only ever added together with the patch.
 */
import * as THREE from 'three';
import { hexToLinear } from '../terrain/shared';
import type { VehicleMeshEntity } from './mesh-vehicle';

/** The lead's ruling (2 Nov, GH-943): strength 0.85. */
export const TEAM_MASK_STRENGTH = 0.85;
/** The material extras key `mark-pass.ts` writes. */
export const TEAM_MARK_USERDATA_KEY = 'rl_team_mark';
export const TEAM_MASK_PROGRAM_KEY = 'rl-team-mark-2';
/** `colorSlot`'s three: own, hostile, neutral. */
export const TEAM_SLOT_COUNT = 3;
/** Only a mesh with this `rl_role` carries the mark. */
export const MARK_ROLE = 'hull';

interface Uniform<T> {
  value: T;
}

/** What `material.extras.rl_team_mark` holds (`tools/src/meshes/mark-contract.ts`). */
export interface TeamMark {
  readonly roof: { readonly x: readonly [number, number]; readonly z_half: number; readonly y: readonly [number, number]; readonly min_ny: number };
  readonly band: { readonly x: readonly [number, number]; readonly y: readonly [number, number]; readonly min_nz: number };
  readonly exclude_uv: readonly (readonly [number, number])[];
  readonly exclude_radius: number;
  readonly luma: number;
}

export interface TeamHook {
  readonly color: Uniform<THREE.Vector3>;
  readonly strength: Uniform<number>;
  readonly luma: Uniform<number>;
  /** roof: x0, x1, z_half, min_ny. */
  readonly a: Uniform<THREE.Vector4>;
  /** roof y0, y1; band min_nz; kit exclusion radius. */
  readonly b: Uniform<THREE.Vector4>;
  /** band: x0, x1, y0, y1. */
  readonly c: Uniform<THREE.Vector4>;
  readonly kit: Uniform<THREE.Vector2[]>;
  readonly edgePx: Uniform<number>;
}

/** Hard edges, anti-aliased over about one screen pixel. */
export const MARK_EDGE_PX = 1;

export const TEAM_MASK_VERTEX_HEAD = /* glsl */ `#include <common>
varying vec3 vMarkPos;
varying vec3 vMarkNrm;`;
export const TEAM_MASK_VERTEX_BODY = /* glsl */ `#include <begin_vertex>
vMarkPos = position;
vMarkNrm = normal;`;

export const TEAM_MASK_FRAGMENT_HEAD = /* glsl */ `#include <common>
uniform vec3 uTeamColor;
uniform float uTeamStrength;
uniform float uTeamLuma;
uniform vec4 uMarkA;
uniform vec4 uMarkB;
uniform vec4 uMarkC;
uniform vec2 uMarkKit[3];
uniform float uMarkEdge;
varying vec3 vMarkPos;
varying vec3 vMarkNrm;
// Coverage of v in [lo, hi], with a hard edge anti-aliased over about uMarkEdge screen pixels.
float rlMarkCov( float v, float lo, float hi ) {
  float w = max( fwidth( v ) * uMarkEdge, 1e-5 );
  return clamp( ( v - lo ) / w + 0.5, 0.0, 1.0 ) * clamp( ( hi - v ) / w + 0.5, 0.0, 1.0 );
}`;

export const TEAM_MASK_FRAGMENT = /* glsl */ `#include <color_fragment>
#ifdef USE_MAP
{
  vec3 rlP = vMarkPos;
  vec3 rlN = normalize( vMarkNrm );
  float rlRoof = rlMarkCov( rlP.x, uMarkA.x, uMarkA.y ) * rlMarkCov( abs( rlP.z ), -1.0, uMarkA.z )
    * rlMarkCov( rlP.y, uMarkB.x, uMarkB.y ) * smoothstep( uMarkA.w - 0.04, uMarkA.w + 0.04, rlN.y );
  float rlBand = rlMarkCov( rlP.x, uMarkC.x, uMarkC.y ) * rlMarkCov( rlP.y, uMarkC.z, uMarkC.w )
    * smoothstep( uMarkB.z - 0.04, uMarkB.z + 0.04, abs( rlN.z ) );
  float rlKit = step( uMarkB.w, distance( vMapUv, uMarkKit[0] ) ) * step( uMarkB.w, distance( vMapUv, uMarkKit[1] ) )
    * step( uMarkB.w, distance( vMapUv, uMarkKit[2] ) );
  float rlTeamMask = uTeamStrength * max( rlRoof, rlBand ) * rlKit;
  float rlBakeY = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  // The panel is a PAINTED marking: it keeps a third of the bake's grime, no more, or the camouflage under it reads through as blotches.
  vec3 rlPanel = min( uTeamColor * mix( 1.0, rlBakeY / uTeamLuma, 0.3 ), vec3( 1.0 ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, rlPanel, rlTeamMask );
}
#endif`;

function replaceOnce(src: string, find: string, by: string, what: string): string {
  if (!src.includes(find)) throw new Error(`team-mask: the ${what} shader has no "${find}" to patch (three changed its chunks?)`);
  return src.replace(find, by);
}

/** The vertex half: the object-space position and normal, as varyings. */
export function patchTeamMaskVertex(vertex: string): string {
  return replaceOnce(replaceOnce(vertex, '#include <common>', TEAM_MASK_VERTEX_HEAD, 'vertex'), '#include <begin_vertex>', TEAM_MASK_VERTEX_BODY, 'vertex');
}

/** The fragment half. */
export function patchTeamMask(fragment: string): string {
  return replaceOnce(replaceOnce(fragment, '#include <common>', TEAM_MASK_FRAGMENT_HEAD, 'fragment'), '#include <color_fragment>', TEAM_MASK_FRAGMENT, 'fragment');
}

/** The strength EVERY hooked material shares: the `team-mask` debug layer writes it. */
const sharedStrength: Uniform<number> = { value: TEAM_MASK_STRENGTH };

/** Which hook (if any) a material carries, so a clone can carry it on. */
const hooks = new WeakMap<THREE.Material, TeamHook>();
const liveVariants = new Set<WeakRef<THREE.Material>>();

export function teamHookOf(m: THREE.Material): TeamHook | undefined {
  return hooks.get(m);
}

/** The mark a material declares, or null. */
export function teamMarkOf(m: THREE.Material): TeamMark | null {
  const v = (m.userData as Record<string, unknown> | undefined)?.[TEAM_MARK_USERDATA_KEY] as TeamMark | undefined;
  if (!v || typeof v !== 'object' || !(v.luma > 0) || !v.roof || !v.band || !Array.isArray(v.exclude_uv) || v.exclude_uv.length !== 3) return null;
  return v;
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
    shader.uniforms.uMarkA = hook.a;
    shader.uniforms.uMarkB = hook.b;
    shader.uniforms.uMarkC = hook.c;
    shader.uniforms.uMarkKit = hook.kit;
    shader.uniforms.uMarkEdge = hook.edgePx;
    shader.vertexShader = patchTeamMaskVertex(shader.vertexShader);
    shader.fragmentShader = patchTeamMask(shader.fragmentShader);
  };
  hooks.set(mat, hook);
  mat.needsUpdate = true;
}

function hookFor(color: Uniform<THREE.Vector3>, mark: TeamMark): TeamHook {
  const { roof, band } = mark;
  return {
    color,
    strength: sharedStrength,
    luma: { value: mark.luma },
    a: { value: new THREE.Vector4(roof.x[0], roof.x[1], roof.z_half, roof.min_ny) },
    b: { value: new THREE.Vector4(roof.y[0], roof.y[1], band.min_nz, mark.exclude_radius) },
    c: { value: new THREE.Vector4(band.x[0], band.x[1], band.y[0], band.y[1]) },
    kit: { value: mark.exclude_uv.map((uv) => new THREE.Vector2(uv[0], uv[1])) },
    edgePx: { value: MARK_EDGE_PX },
  };
}

/**
 * A clone cut from `source`: keep what `source` carries. Re-applies the team hook when `source` has one,
 * AFTER the clone's own `onBeforeCompile` (the running gear's), and adds the program key only when the clone's
 * key does not already name it. A no-op for an ordinary material.
 */
export function carryTeamMark(clone: THREE.Material, source: THREE.Material): void {
  const hook = hooks.get(source);
  if (!hook || hooks.has(clone)) return;
  const std = clone as THREE.MeshStandardMaterial;
  const key = std.customProgramCacheKey();
  installHook(std, hook, !key.includes(TEAM_MASK_PROGRAM_KEY));
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

  /** `base` itself when it declares no mark; else the slot's variant. */
  materialFor(base: THREE.Material, slot: number): THREE.Material {
    const mark = teamMarkOf(base);
    const std = base as THREE.MeshStandardMaterial;
    if (mark === null || std.isMeshStandardMaterial !== true || !std.map) return base;
    if (!(slot >= 0 && slot < TEAM_SLOT_COUNT)) throw new Error(`VehicleTeamMaterials: colour slot ${slot} is not 0..${TEAM_SLOT_COUNT - 1}`);
    let perSlot = this.byBase.get(base);
    if (!perSlot) {
      perSlot = new Map();
      this.byBase.set(base, perSlot);
    }
    let v = perSlot.get(slot);
    if (!v) {
      v = std.clone();
      installHook(v, hookFor(this.slots.colors[slot], mark), true);
      v.userData = { ...(v.userData as Record<string, unknown>), rlTeamSlot: slot };
      liveVariants.add(new WeakRef(v));
      perSlot.set(slot, v);
      this.onMint?.(v);
    }
    return v;
  }

  /**
   * Swap every LIVE hull-role mesh of `entity` onto its slot's variant. A wreck (`deathRoot`) is not in `liveTop`,
   * and the barrel, antennas and tracks are other roles.
   */
  applyTo(entity: VehicleMeshEntity, slot: number): number {
    let n = 0;
    for (const top of entity.liveTop) {
      top.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || Array.isArray(mesh.material)) return;
        if ((mesh.userData as { rl_role?: unknown }).rl_role !== MARK_ROLE) return;
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
