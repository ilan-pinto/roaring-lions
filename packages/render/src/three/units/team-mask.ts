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
 *
 * **The insignia (GH-1096 S1) rides the SAME hook** (`insignia.ts`): a second term spliced after the mark, never a second
 * `onBeforeCompile`, so the three clone sites keep their one `carryTeamMark`. The program key is `rl-unit-mark-3` and names
 * the features it actually patched: `|rl-unit-mark-3|team`, `|rl-unit-mark-3|ins` or `|rl-unit-mark-3|team+ins` (the spec's
 * decision 8). A team-only material compiles L3's program byte for byte; only its key moved. A vehicle TYPE with an insignia
 * frame (`insignia-frames.ts`) gets it on every hull-role material it mints: an insignia-only material has ONE variant (the
 * colour is the faction's, nothing is per slot), memoised under slot -1.
 */
import * as THREE from 'three';
import { hexToLinear } from '../terrain/shared';
import type { VehicleMeshEntity } from './mesh-vehicle';
import { legacyOf } from '../twin-identity';
import type { Ops } from '../fog-ops';
import {
  INSIGNIA_FRAGMENT,
  INSIGNIA_FRAGMENT_HEAD,
  INSIGNIA_VARYINGS,
  bindInsigniaUniforms,
  insigniaHookFor,
  setInsigniaStrength,
  type InsigniaFrame,
  type InsigniaHook,
  type InsigniaShared,
} from './insignia';

/** The lead's ruling (2 Nov, GH-943): strength 0.85. */
export const TEAM_MASK_STRENGTH = 0.85;
/** The material extras key `mark-pass.ts` writes. */
export const TEAM_MARK_USERDATA_KEY = 'rl_team_mark';
/**
 * The one unit-mark hook's program-key segment (GH-1096 S1: the team mark and the insignia; L3's `rl-team-mark-2` before it).
 * The name `TEAM_MASK_PROGRAM_KEY` stays for the callers that test "does this material carry the mark hook".
 */
export const UNIT_MARK_PROGRAM_KEY = 'rl-unit-mark-3';
export const TEAM_MASK_PROGRAM_KEY = UNIT_MARK_PROGRAM_KEY;
/** What the hook patched, after the segment: `|rl-unit-mark-3|team`, `|ins` or `|team+ins`. Never a segment itself (no `rl-`). */
export type UnitMarkFeature = 'team' | 'ins' | 'team+ins';
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

/** The chunk's luminance weights (Rec. 709 of a LINEAR colour). */
export const TEAM_LUMA_WEIGHTS = [0.2126, 0.7152, 0.0722] as const;
/** How much of the bake's grime a panel keeps (`mix(1, luma / uTeamLuma, 0.3)`). */
export const TEAM_PANEL_GRIME = 0.3;
/** Half the soft band the normal tests ease over (`smoothstep(min - 0.04, min + 0.04, n)`). */
export const TEAM_NORMAL_SOFT = 0.04;
/** The coverage's smallest edge width (`max(fwidth(v) * uMarkEdge, 1e-5)`). */
export const MARK_MIN_WIDTH = 1e-5;

/** Three or four components, as `Ops<T>` sees a vector. */
type V2<T> = readonly [T, T];
type V3<T> = readonly [T, T, T];
type V4<T> = readonly [T, T, T, T];

/**
 * GH-943 P3 (T3): what the fragment chunk reads, as `Ops<T>` inputs. `rate` is each tested coordinate's screen-space rate times
 * `uMarkEdge` (`fwidth(p.x)`, `fwidth(abs(p.z))`, `fwidth(p.y)`): a derivative is graph-only, so the caller computes it.
 */
export interface TeamMarkInput<T> {
  /** `vMarkPos`, `vMarkNrm`: the OBJECT-space position and the (unnormalised) object-space normal. */
  readonly p: V3<T>;
  readonly n: V3<T>;
  /** The map uv the kit exclusion tests (`vMapUv`). */
  readonly uv: V2<T>;
  readonly rate: V3<T>;
  /** `uMarkA` (roof x0, x1, z_half, min_ny), `uMarkB` (roof y0, y1; band min_nz; kit radius), `uMarkC` (band x0, x1, y0, y1). */
  readonly a: V4<T>;
  readonly b: V4<T>;
  readonly c: V4<T>;
  /** `uMarkKit[0..2]`. */
  readonly kit: readonly V2<T>[];
  readonly strength: T;
  readonly luma: T;
  readonly team: V3<T>;
  /** The diffuse colour before the mark (after the map and the tread). */
  readonly diffuse: V3<T>;
}

/**
 * GH-943 P3 (T3): `TEAM_MASK_FRAGMENT`, written once against `Ops<T>`: the roof and band box coverage, the kit exclusion, the
 * strength, and the painted panel mixed into the diffuse colour. `NUMBER_OPS` runs it in the tests; the node twin
 * (`team-mask.node.ts`) runs it on TSL nodes. Returns the mask and the colour after it.
 */
export function teamMarkOps<T>(o: Ops<T>, i: TeamMarkInput<T>): { mask: T; rgb: [T, T, T] } {
  const one = o.lit(1);
  const half = o.lit(0.5);
  const cov = (v: T, lo: T, hi: T, rate: T): T => {
    const w = o.max(rate, o.lit(MARK_MIN_WIDTH));
    return o.mul(o.clamp01(o.add(o.div(o.sub(v, lo), w), half)), o.clamp01(o.add(o.div(o.sub(hi, v), w), half)));
  };
  const soft = (edge: T, x: T): T => o.smoothstep(o.sub(edge, o.lit(TEAM_NORMAL_SOFT)), o.add(edge, o.lit(TEAM_NORMAL_SOFT)), x);
  const [px, py, pz] = i.p;
  const len = o.sqrt(o.add(o.add(o.mul(i.n[0], i.n[0]), o.mul(i.n[1], i.n[1])), o.mul(i.n[2], i.n[2])));
  const ny = o.div(i.n[1], len);
  const nz = o.div(i.n[2], len);
  const [rx, rz, ry] = i.rate;
  const roof = o.mul(
    o.mul(o.mul(cov(px, i.a[0], i.a[1], rx), cov(o.abs(pz), o.lit(-1), i.a[2], rz)), cov(py, i.b[0], i.b[1], ry)),
    soft(i.a[3], ny)
  );
  const band = o.mul(o.mul(cov(px, i.c[0], i.c[1], rx), cov(py, i.c[2], i.c[3], ry)), soft(i.b[2], o.abs(nz)));
  let kit = one;
  for (const k of i.kit) kit = o.mul(kit, o.step(i.b[3], o.length2(o.sub(i.uv[0], k[0]), o.sub(i.uv[1], k[1]))));
  const mask = o.mul(o.mul(i.strength, o.max(roof, band)), kit);
  const bakeY = o.add(
    o.add(o.mul(i.diffuse[0], o.lit(TEAM_LUMA_WEIGHTS[0])), o.mul(i.diffuse[1], o.lit(TEAM_LUMA_WEIGHTS[1]))),
    o.mul(i.diffuse[2], o.lit(TEAM_LUMA_WEIGHTS[2]))
  );
  const grime = o.mix(one, o.div(bakeY, i.luma), o.lit(TEAM_PANEL_GRIME));
  const rgb = [0, 1, 2].map((c) => o.mix(i.diffuse[c] as T, o.min(o.mul(i.team[c] as T, grime), one), mask)) as [T, T, T];
  return { mask, rgb };
}

function replaceOnce(src: string, find: string, by: string, what: string): string {
  if (!src.includes(find)) throw new Error(`team-mask: the ${what} shader has no "${find}" to patch (three changed its chunks?)`);
  return src.replace(find, by);
}

/** The fragment half of an insignia-only material: the varyings the team head would have declared, then the insignia's. */
export function patchInsigniaOnly(fragment: string): string {
  return replaceOnce(
    replaceOnce(fragment, '#include <common>', `#include <common>\n${INSIGNIA_VARYINGS}\n${INSIGNIA_FRAGMENT_HEAD}`, 'fragment'),
    '#include <color_fragment>',
    `#include <color_fragment>\n#ifdef USE_MAP${INSIGNIA_FRAGMENT}\n#endif`,
    'fragment'
  );
}

/** The fragment half of a material carrying both: the team mark's patch, then the insignia, inside the same `#ifdef USE_MAP`. */
export function patchTeamMaskAndInsignia(fragment: string): string {
  const both = TEAM_MASK_FRAGMENT.replace(/\n#endif$/, `${INSIGNIA_FRAGMENT}\n#endif`);
  if (both === TEAM_MASK_FRAGMENT) throw new Error('team-mask: the team chunk no longer ends in #endif');
  return replaceOnce(
    replaceOnce(fragment, '#include <common>', `${TEAM_MASK_FRAGMENT_HEAD}\n${INSIGNIA_FRAGMENT_HEAD}`, 'fragment'),
    '#include <color_fragment>',
    both,
    'fragment'
  );
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

/** One material's unit-mark hook: the team term, the insignia term, or both. Never neither. */
export interface UnitMarkHook {
  readonly team: TeamHook | null;
  readonly ins: InsigniaHook | null;
}

/** Which hook (if any) a material carries, so a clone can carry it on. */
const hooks = new WeakMap<THREE.Material, UnitMarkHook>();
const liveVariants = new Set<WeakRef<THREE.Material>>();

/** The team half of a material's hook (undefined when it carries none, or only the insignia). */
export function teamHookOf(m: THREE.Material): TeamHook | undefined {
  return hooks.get(m)?.team ?? undefined;
}

/** The insignia half of a material's hook (undefined when it carries none). */
export function insigniaHookOf(m: THREE.Material): InsigniaHook | undefined {
  return hooks.get(m)?.ins ?? undefined;
}

/** The whole hook record, for the node twin's one segment. */
export function unitMarkHookOf(m: THREE.Material): UnitMarkHook | undefined {
  return hooks.get(m);
}

export function unitMarkFeature(h: UnitMarkHook): UnitMarkFeature {
  if (h.team !== null && h.ins !== null) return 'team+ins';
  if (h.team !== null) return 'team';
  if (h.ins !== null) return 'ins';
  throw new Error('team-mask: a unit-mark hook with neither a team mark nor an insignia');
}

/** The mark a material declares, or null. */
export function teamMarkOf(m: THREE.Material): TeamMark | null {
  const v = (m.userData as Record<string, unknown> | undefined)?.[TEAM_MARK_USERDATA_KEY] as TeamMark | undefined;
  if (!v || typeof v !== 'object' || !(v.luma > 0) || !v.roof || !v.band || !Array.isArray(v.exclude_uv) || v.exclude_uv.length !== 3) return null;
  return v;
}

function installHook(mat: THREE.MeshStandardMaterial, hook: UnitMarkHook, addKey: boolean): void {
  const prior = mat.onBeforeCompile;
  const feature = unitMarkFeature(hook);
  if (addKey) {
    const baseKey = mat.customProgramCacheKey();
    mat.customProgramCacheKey = () => `${baseKey}|${UNIT_MARK_PROGRAM_KEY}|${feature}`;
  }
  const team = hook.team;
  const ins = hook.ins;
  mat.onBeforeCompile = (shader, renderer) => {
    prior.call(mat, shader, renderer);
    if (team !== null) {
      shader.uniforms.uTeamColor = team.color;
      shader.uniforms.uTeamStrength = team.strength;
      shader.uniforms.uTeamLuma = team.luma;
      shader.uniforms.uMarkA = team.a;
      shader.uniforms.uMarkB = team.b;
      shader.uniforms.uMarkC = team.c;
      shader.uniforms.uMarkKit = team.kit;
      shader.uniforms.uMarkEdge = team.edgePx;
    }
    if (ins !== null) bindInsigniaUniforms(shader.uniforms, ins);
    shader.vertexShader = patchTeamMaskVertex(shader.vertexShader);
    shader.fragmentShader =
      team !== null && ins !== null
        ? patchTeamMaskAndInsignia(shader.fragmentShader)
        : team !== null
          ? patchTeamMask(shader.fragmentShader)
          : patchInsigniaOnly(shader.fragmentShader);
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
  installHook(std, hook, !key.includes(UNIT_MARK_PROGRAM_KEY));
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

/** What a vehicle TYPE's insignia needs: its frame (`insignia-frames.ts`) and the owner's shared texture, colour and ratio. */
export interface VehicleInsignia {
  readonly frame: InsigniaFrame;
  readonly shared: InsigniaShared;
}

/** The slot an insignia-only variant is memoised under: it has one, whatever the side. */
export const INSIGNIA_ONLY_SLOT = -1;

/**
 * The variants of a template's materials, one per colour slot, minted on first use and memoised.
 * The renderer keeps one per template key (like `VehicleScarMaterials`); the garage keeps one.
 *
 * `slots` null: no team term (the garage with no team colour), and a material's `rl_team_mark` is ignored. `insignia` null: no
 * insignia term (every type without a frame). With neither, every material is returned as it is.
 */
export class VehicleTeamMaterials {
  private readonly byBase = new Map<THREE.Material, Map<number, THREE.MeshStandardMaterial>>();

  constructor(
    private readonly slots: TeamMaskSlots | null,
    /** Called once per variant minted, so the renderer can hand it to the environment registry. */
    private readonly onMint?: (m: THREE.MeshStandardMaterial) => void,
    private readonly insignia: VehicleInsignia | null = null
  ) {}

  /** `base` itself when it carries neither a mark nor an insignia; else the slot's variant (slot -1 for an insignia-only one). */
  materialFor(base: THREE.Material, slot: number): THREE.Material {
    const std = base as THREE.MeshStandardMaterial;
    if (std.isMeshStandardMaterial !== true || !std.map) return base;
    const mark = this.slots !== null ? teamMarkOf(base) : null;
    const ins = this.insignia;
    if (mark === null && ins === null) return base;
    if (mark !== null && !(slot >= 0 && slot < TEAM_SLOT_COUNT)) throw new Error(`VehicleTeamMaterials: colour slot ${slot} is not 0..${TEAM_SLOT_COUNT - 1}`);
    const key = mark !== null ? slot : INSIGNIA_ONLY_SLOT;
    let perSlot = this.byBase.get(base);
    if (!perSlot) {
      perSlot = new Map();
      this.byBase.set(base, perSlot);
    }
    let v = perSlot.get(key);
    if (!v) {
      v = std.clone();
      const team = mark !== null && this.slots !== null ? hookFor(this.slots.colors[slot], mark) : null;
      installHook(v, { team, ins: ins !== null ? insigniaHookFor(ins.shared, ins.frame) : null }, true);
      v.userData = { ...(v.userData as Record<string, unknown>), rlTeamSlot: key };
      liveVariants.add(new WeakRef(v));
      perSlot.set(key, v);
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
        // GH-943 P3 (T1): on a node boot `mesh.material` is a twin; the variant is minted from (and compared with) the LEGACY
        // material, and the caller queues the entity for adoption. Never a separate base per variant: each slot's hook reads its
        // own colour uniform, so variants must not share a twin.
        const current = legacyOf(mesh.material, mesh);
        const next = this.materialFor(current, slot);
        if (next !== current) {
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

/** Live variants whose hook has the given half. */
function countLive(has: (h: UnitMarkHook) => boolean): number {
  let n = 0;
  for (const ref of [...liveVariants]) {
    const m = ref.deref();
    if (!m) liveVariants.delete(ref);
    else {
      const h = hooks.get(m);
      if (h !== undefined && has(h)) n++;
    }
  }
  return n;
}

/** The `team-mask` debug layer: the shared strength to 0 and back. Returns how many team-marked variants exist. */
export function setTeamMaskPass(on: boolean): number {
  sharedStrength.value = on ? TEAM_MASK_STRENGTH : 0;
  return countLive((h) => h.team !== null);
}

/**
 * GH-1096 S1: the `insignia` debug layer: the insignia's OWN shared strength to 0 and back (never the team mark's, so the gated
 * `team-mask` check keeps measuring what it was calibrated on). Returns how many insignia variants exist.
 */
export function setInsigniaPass(on: boolean): number {
  setInsigniaStrength(on);
  return countLive((h) => h.ins !== null);
}
