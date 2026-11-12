/**
 * GH-943 WebGPU P3 (T3): the NODE twin of every hooked unit material, the backend's `unit` factory. One `MeshStandardNodeMaterial`
 * composes a TERM per hook segment of the legacy material's program key (`hookSegments`): the soot (`world-materials.node.ts`),
 * the running gear (`running-gear.node.ts`), the team mark (`team-mask.node.ts`), the rain rim (`rain-rim.node.ts`) and the wounded
 * floor (`wounded-read.node.ts`) here. A segment with no term is drawn without it and named in `userData.rlUnportedTerms`
 * (`rl-unit: <segment>`), the census's `partial` kind.
 *
 * **The chain order is the legacy one, whatever the key's order.** The legacy splices compose at fixed chunks: the soot replaces
 * the map, the tread multiplies right after it, the mark mixes after the colour chunk, the rim's exposure after the emissive map,
 * the floor on the lit colour. A moving marked hull's key reads `...|rl-unit-mark-3|team|rl-running-gear-1` (the clone appends its own),
 * yet the tread is under the mark. `UNIT_TERM_ORDER` is that order, and the composer applies terms in it.
 *
 * **One twin serves many entities (ruling P3-R3).** Adoption memoises a unit twin by the base legacy material, the segments and the
 * pipeline state (`node-material-adoption.ts`), so every vehicle's running-gear clone, every entity's fade and every scar of one
 * template draws ONE twin. What differs per entity is read per drawn OBJECT (`onObjectUpdate`), from that mesh's own legacy material
 * (`legacyMaterialOf(mesh)`, ruling P3-R2): `color`, `opacity`, `roughness` and `metalness` (`OBJECT_SCOPED_FIELDS`), and each
 * term's per-entity uniforms (the wheels). The material-wide fields (`map`, `envMap`, `envMapIntensity`) are mirrored from the BASE
 * every render; `transparent` and the rest of the pipeline state are in the memo key, copied once by adoption.
 *
 * **Late textures.** The twin's `map` IS the legacy texture object, and the colour taps it through the material reference, so a cold
 * GLB texture whose image lands after adoption (`warmColdTextures`, which walks `mesh.material`, the twin) is the image drawn.
 *
 * **The rest pose outside the colour pass**, as on legacy, where the running gear lives only in the material's own program: the
 * shadow pass draws `castShadowPositionNode` (the rest position), and an override pass three hands this `positionNode` to (the node
 * AO pre-pass, P2 T6's finding) gets the rest position from the graph itself.
 *
 * Imports the backend's own addon-free modules and TYPES of the legacy files: the maths arrives as values (`UnitMaths`, through
 * `MATERIAL_MATHS.unit`), or the node chunk would statically load the ThreeRenderer chunk (`MATERIAL_MATHS_MARKER`).
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type * as THREE from 'three';
import type { Material } from 'three';
import { tslOps, type N, type Tsl } from '../fog-pass.node';
import type { Ops } from '../fog-ops';
import { UNPORTED_TERMS_KEY } from '../backend/unported';
import { declareObjectInputs, pushValue } from '../backend/object-inputs';
import { hookSegments } from '../material-names';
import { legacyBaseOf, legacyMaterialOf, type HasUserData } from '../twin-identity';
import { teamMarkTerms, type TeamMarkMaths } from './team-mask.node';
import { insigniaTerms, type InsigniaMaths } from './insignia.node';
import { runningGearTerms, type RunningGearMaths } from './running-gear.node';
import { sootTerms, type SootMaths } from '../world-materials.node';
import { rimTerms, type RimMaths } from './rain-rim.node';
import { floorTerms, type FloorMaths } from './wounded-read.node';

/** The unit twin's shared maths, injected (`material-maths.ts`'s `MATERIAL_MATHS.unit`). */
export interface UnitMaths {
  readonly team: TeamMarkMaths;
  /** GH-1096 S1: the insignia, the unit-mark segment's second term. */
  readonly insignia: InsigniaMaths;
  readonly rg: RunningGearMaths;
  readonly soot: SootMaths;
  readonly rim: RimMaths;
  readonly floor: FloorMaths;
}

export interface NodeUnitDeps {
  readonly W: typeof import('three/webgpu');
  readonly TSL: typeof import('three/tsl');
  readonly maths: UnitMaths;
}

/** The twin's `name` prefix (`NODE_MATERIAL_MARKER`, `tools/src/perf/bundle-census.ts`). */
const NAME_PREFIX = 'rl-node-material-unit';

/**
 * The legacy chain order (see the header), by program-key segment. Pinned literal by literal against the legacy constants
 * (`unit-material.node.test.ts`): `SOOT_PROGRAM_KEY`, `RG_PROGRAM_KEY`, `TEAM_MASK_PROGRAM_KEY`, `RAIN_RIM_PROGRAM_KEY`,
 * `WOUNDED_FLOOR_PROGRAM_KEY`.
 */
export const UNIT_TERM_ORDER = ['rl-soot', 'rl-running-gear-1', 'rl-unit-mark-3', 'rl-unit-rain-rim', 'rl-wounded-floor'] as const;
export type UnitSegment = (typeof UNIT_TERM_ORDER)[number];

/** The census term a segment with no node term is named by. */
export const unportedUnitTerm = (segment: string): string => `rl-unit: ${segment}`;

/** The slice of the node builder the position graph reads at build time. */
interface BuilderLike {
  readonly material: (Material & { isShadowPassMaterial?: boolean }) | null;
  readonly camera?: { readonly isOrthographicCamera?: boolean };
}

/** A frame as `onObjectUpdate` hands it over. */
interface ObjectFrame {
  readonly object: (THREE.Object3D & HasUserData & { material?: unknown }) | null;
}

/** `N` plus the members a term reads beyond `fog-pass.node.ts`'s handle. */
export interface UN extends N {
  readonly g: N;
  readonly b: N;
  element(i: N | number): UN;
  toVar(name?: string): UN;
  toVarying(name?: string): UN;
  onObjectUpdate(cb: (frame: ObjectFrame) => unknown): UN;
  onRenderUpdate(cb: () => unknown): UN;
  setName(name: string): UN;
  array: unknown;
}

/** The TSL members the unit twin and its terms use, as a structural handle, cast once. */
export interface UnitTsl {
  Fn(body: (builder: BuilderLike) => N | void): () => UN;
  uniform(v: unknown): UN;
  uniformArray(v: unknown, type: string): UN;
  attribute(name: string, type: string): UN;
  materialReference(name: string, type: string): UN;
  /** A sampled texture at `uv` (GH-1096 S1: the insignia's distance field). */
  texture(value: unknown, uv: N): UN;
  vec2(...a: Array<N | number>): UN;
  fwidth(a: N): UN;
  abs(a: N): UN;
  max(a: N, b: N): UN;
  int(a: N | number): UN;
  float(a: N | number): UN;
  vec3(...a: Array<N | number>): UN;
  vec4(...a: Array<N | number>): UN;
  uv(index?: number): UN;
  OnBeforeMaterialUpdate(cb: () => void): void;
  readonly positionLocal: UN;
  readonly normalLocal: UN;
  readonly positionGeometry: UN;
  readonly normalGeometry: UN;
  readonly materialEmissive: UN;
  /** The lit output (`outgoingLight` plus fog, as a vec4), what the OUTPUT slot's terms read. */
  readonly output: UN;
  readonly normalView: UN;
  readonly positionViewDirection: UN;
  dot(a: N, b: N): UN;
  normalize(a: N): UN;
}

/**
 * What a term builds against. Each term writes ONE slot: the colour (soot, tread, mark, rim exposure), the position and normal
 * (running gear), the emissive (rim) or the output (floor). The colour starts as the object's legacy colour times the map texel
 * (alpha = the texel's alpha; the opacity is applied by three after it), the position and normal as three's local ones.
 */
export interface UnitTermContext {
  readonly W: typeof import('three/webgpu');
  readonly TSL: typeof import('three/tsl');
  /** The same TSL as a structural handle (the members above). */
  readonly T: UnitTsl;
  /** `Ops<N>` over the TSL: the legacy maths runs on nodes through it. */
  readonly o: Ops<N>;
  /** The node twin being built. */
  readonly twin: Material;
  /** The legacy material the twin is built from (its first user: it carries the segments). Read at BUILD time only. */
  readonly legacy: THREE.MeshStandardMaterial;
  /** The memo base (`legacyBaseOf(legacy)`): what the material-wide fields are mirrored from. */
  readonly base: THREE.MeshStandardMaterial;
  /** A uniform re-read every render from `read()` (material-wide: the slot colours, the shared strength, the boxes). */
  renderUniform(read: () => unknown, name: string): UN;
  /** A uniform array re-read every render from `read()`. */
  renderArray(read: () => readonly unknown[], type: string, name: string): UN;
  /** A texture sampled at `uv` whose image is re-read every render from `read()` (a late load swaps it with no rebuild). */
  renderTexture(read: () => unknown, uv: N, name: string): UN;
  /**
   * The OBJECT-space position and normal as the varyings `vMarkPos` and `vMarkNrm`, made once per twin: the team mark and the
   * insignia (one hook segment, two terms) read the same pair, as the legacy hook declares it once.
   */
  markVaryings(): { readonly p: UN; readonly n: UN };
  /** A uniform re-read for every drawn OBJECT, from that object's own legacy material (ruling P3-R3); `fallback` when it has none. */
  objectUniform(read: (legacy: Material) => unknown, fallback: unknown, name: string): UN;
  /** A uniform array re-read for every drawn object, likewise. */
  objectArray(read: (legacy: Material) => readonly unknown[] | undefined, fallback: readonly unknown[], type: string, name: string): UN;
  /** The map tap (`vec4`, the twin's own `map` through the material reference), or null for a material with no map. */
  readonly texel: UN | null;
  /** The object's legacy `color` (`vec3`, object-scoped). */
  readonly materialColor: UN;
  color: UN;
  position: UN;
  normal: UN;
  emissive: UN | null;
  output: UN | null;
}

/** One hook segment's contribution: it reads `ctx` and replaces the slot it owns. */
export interface UnitTerm {
  readonly segment: string;
  apply(ctx: UnitTermContext): void;
}

/**
 * The terms each segment draws, in `UNIT_TERM_ORDER`. `null`: a segment with no node term yet (drawn without it, and named). T4 adds
 * the rim and the floor here, built from `maths.rim` and `maths.floor`.
 */
export function unitTermTable(maths: UnitMaths): ReadonlyArray<readonly [UnitSegment, readonly UnitTerm[] | null]> {
  return [
    ['rl-soot', sootTerms(maths.soot)],
    ['rl-running-gear-1', runningGearTerms(maths.rg)],
    ['rl-unit-mark-3', [...teamMarkTerms(maths.team), ...insigniaTerms(maths.insignia)]],
    ['rl-unit-rain-rim', rimTerms(maths.rim)],
    ['rl-wounded-floor', floorTerms(maths.floor)],
  ];
}

/** What a unit twin binds, for the record gates (null for any other material). */
export interface UnitBindings {
  /** Every uniform the twin and its terms made, by name. */
  readonly uniforms: ReadonlyMap<string, UN>;
  /** The per-render mirror of the material-wide fields from the base (run by the colour graph before each render). */
  readonly sync: () => void;
  /** The segments drawn, in the order applied. */
  readonly applied: readonly string[];
}

const BINDINGS = new WeakMap<Material, UnitBindings>();

export function nodeUnitBindings(twin: Material): UnitBindings | null {
  return BINDINGS.get(twin) ?? null;
}

/** The material-wide fields mirrored from the base every render (ruling P3-R3). */
export const UNIT_MATERIAL_WIDE_FIELDS = ['map', 'envMap', 'envMapIntensity'] as const;

/**
 * The twin of one hooked legacy unit material (`legacy` is the first legacy user of the memo entry, carrying its segments).
 */
export function createNodeUnitMaterial(deps: NodeUnitDeps, legacy: THREE.MeshStandardMaterial): THREE.Material {
  const { W, maths } = deps;
  const T = deps.TSL as unknown as UnitTsl;
  const o = tslOps(deps.TSL as unknown as Tsl);
  const base = legacyBaseOf(legacy) as THREE.MeshStandardMaterial;
  const segments = hookSegments(legacy);

  const twin = new W.MeshStandardNodeMaterial();
  // The stock standard fields, field for field (maps, normal map, emissive, AO, flat shading, fog...): three's own copy of the
  // standard material, which reads no node slot. The node slots are set below; adoption copies the pipeline state after this.
  (W.MeshStandardMaterial.prototype.copy as (this: unknown, source: THREE.Material) => unknown).call(twin, legacy);

  const table = unitTermTable(maths);
  const known = new Map(table);
  const unported = segments.filter((s) => (known.get(s as UnitSegment) ?? null) === null).map(unportedUnitTerm);
  const applied = UNIT_TERM_ORDER.filter((s) => segments.includes(s) && (known.get(s) ?? null) !== null);
  twin.name = `${NAME_PREFIX}:${segments.map((s) => s.replace(/^rl-/, '')).join('+')}`;
  // A fresh object: the env class tag and the extras travel, the twin's own terms never land on the legacy material.
  twin.userData = { ...(legacy.userData as Record<string, unknown>), [UNPORTED_TERMS_KEY]: unported };

  const uniforms = new Map<string, UN>();
  const named = (n: UN, name: string): UN => {
    if (uniforms.has(name)) throw new Error(`node unit: two terms bind a uniform named ${name}`);
    uniforms.set(name, n);
    return n.setName(name);
  };
  /**
   * GH-943 P3 (T14b, GH-1152): every uniform this twin updates per object or per render, with what it will read, so the parked
   * refresh policy can see a change (`backend/object-inputs.ts`). A uniform made below without passing through `declared` is not
   * declared, and the policy never downgrades the twin (G2c).
   */
  const declared: { readonly node: UN; readonly value: (object: ObjectFrame['object']) => unknown }[] = [];
  const ownLegacy = (frame: ObjectFrame): Material | null => {
    const obj = frame.object;
    if (obj === null || obj.material === undefined || Array.isArray(obj.material)) return null;
    return legacyMaterialOf(obj as unknown as HasUserData & { material: Material & HasUserData });
  };

  // GH-1270: three builds a mesh's SHADOW material from `material.colorNode.a` (`Renderer._getShadowNodes`), so this graph is also
  // compiled with the shadow material as `builder.material`, which has no `map`: a bare `materialReference('map')` there threw
  // "texture( value ) expects a valid instance of THREE.Texture()" once per textured hull, at boot. A material with no map reads
  // the neutral 1 (opaque white: exactly the no-map colour); the shadow's own alpha cut-out is three's `reference('map', .., twin)`.
  const texel = base.map
    ? T.Fn((builder) => ((builder.material as { map?: unknown } | null)?.map ? T.materialReference('map', 'texture') : T.vec4(1, 1, 1, 1)))()
    : null;
  let markVarying: { readonly p: UN; readonly n: UN } | null = null;
  const ctxBase = {
    W,
    TSL: deps.TSL,
    T,
    o,
    twin: twin as unknown as Material,
    legacy,
    base,
    renderUniform: (read: () => unknown, name: string): UN => {
      const n = T.uniform(read());
      n.onRenderUpdate(() => read());
      declared.push({ node: n, value: () => read() });
      return named(n, name);
    },
    markVaryings: (): { readonly p: UN; readonly n: UN } =>
      (markVarying ??= { p: T.positionGeometry.toVarying('vMarkPos'), n: T.normalGeometry.toVarying('vMarkNrm') }),
    renderTexture: (read: () => unknown, uv: N, name: string): UN => {
      const n = T.texture(read(), uv);
      n.onRenderUpdate(() => read());
      declared.push({ node: n, value: () => read() });
      return named(n, name);
    },
    renderArray: (read: () => readonly unknown[], type: string, name: string): UN => {
      const n = T.uniformArray(read(), type);
      n.onRenderUpdate(() => {
        n.array = read();
      });
      declared.push({ node: n, value: () => read() });
      return named(n, name);
    },
    objectUniform: (read: (l: Material) => unknown, fallback: unknown, name: string): UN => {
      const n = T.uniform(read(legacy) ?? fallback);
      n.onObjectUpdate((frame) => {
        const l = ownLegacy(frame);
        return (l !== null ? read(l) : undefined) ?? fallback;
      });
      declared.push({
        node: n,
        value: (object) => {
          const l = ownLegacy({ object });
          return (l !== null ? read(l) : undefined) ?? fallback;
        },
      });
      return named(n, name);
    },
    objectArray: (read: (l: Material) => readonly unknown[] | undefined, fallback: readonly unknown[], type: string, name: string): UN => {
      const n = T.uniformArray(read(legacy) ?? fallback, type);
      n.onObjectUpdate((frame) => {
        const l = ownLegacy(frame);
        n.array = (l !== null ? read(l) : undefined) ?? fallback;
      });
      declared.push({
        node: n,
        value: (object) => {
          const l = ownLegacy({ object });
          return (l !== null ? read(l) : undefined) ?? fallback;
        },
      });
      return named(n, name);
    },
    texel,
  };
  // Ruling P3-R3: the per-entity fields, per drawn object, from that object's own legacy material.
  const materialColor = ctxBase.objectUniform((l) => (l as THREE.MeshStandardMaterial).color, new W.Color(1, 1, 1), 'uUnitColor');
  const opacity = ctxBase.objectUniform((l) => l.opacity, 1, 'uUnitOpacity');
  const roughness = ctxBase.objectUniform((l) => (l as THREE.MeshStandardMaterial).roughness, 1, 'uUnitRoughness');
  const metalness = ctxBase.objectUniform((l) => (l as THREE.MeshStandardMaterial).metalness, 0, 'uUnitMetalness');

  const ctx: UnitTermContext = {
    ...ctxBase,
    materialColor,
    // The map chunk: `diffuseColor *= texel` (alpha included; the opacity is three's own multiply after the colour).
    color: (texel !== null ? T.vec4(materialColor.mul(texel.rgb), texel.a) : T.vec4(materialColor, 1)).toVar('rlUnitColorMap'),
    position: T.positionLocal,
    normal: T.normalLocal,
    emissive: null,
    output: null,
  };
  for (const [segment, terms] of table) {
    if (terms === null || !segments.includes(segment)) continue;
    for (const term of terms) term.apply(ctx);
  }

  /** The material-wide fields from the base. An envMap that appears or goes changes the program, so it bumps the version. */
  const sync = (): void => {
    if (twin.map !== base.map) twin.map = base.map;
    if (twin.envMap !== base.envMap) {
      if ((twin.envMap === null) !== (base.envMap === null)) twin.needsUpdate = true;
      twin.envMap = base.envMap;
    }
    if (twin.envMapIntensity !== base.envMapIntensity) twin.envMapIntensity = base.envMapIntensity;
  };
  sync();
  const colour = ctx.color;
  twin.colorNode = T.Fn(() => {
    T.OnBeforeMaterialUpdate(sync);
    return colour;
  })() as never;
  twin.opacityNode = (base.alphaMap ? opacity.mul(T.materialReference('alphaMap', 'texture').g) : opacity) as never;
  twin.roughnessNode = (base.roughnessMap ? roughness.mul(T.materialReference('roughnessMap', 'texture').g) : roughness) as never;
  twin.metalnessNode = (base.metalnessMap ? metalness.mul(T.materialReference('metalnessMap', 'texture').b) : metalness) as never;
  if (ctx.emissive !== null) twin.emissiveNode = T.materialEmissive.add(ctx.emissive) as never;
  if (ctx.output !== null) twin.outputNode = ctx.output as never;
  if (ctx.position !== T.positionLocal || ctx.normal !== T.normalLocal) {
    const position = ctx.position;
    const normal = ctx.normal;
    const self = twin as unknown as Material;
    twin.positionNode = T.Fn((builder) => {
      const mat = builder.material;
      // Not this twin's own colour program, and not the shadow pass (which draws `castShadowPositionNode`): an override pass three
      // handed this `positionNode` to (the AO pre-pass). The rest pose, as every legacy override material draws.
      if (mat !== self && mat?.isShadowPassMaterial !== true) return T.positionLocal;
      if (normal !== T.normalLocal) T.normalLocal.assign(normal);
      return position;
    })() as never;
    // The shadow keeps the rest pose, as on legacy.
    twin.castShadowPositionNode = T.positionLocal as never;
  }
  BINDINGS.set(twin as unknown as Material, { uniforms, sync, applied });
  // The declaration (T14b). `sync` mirrors the base's map, envMap and envMapIntensity in `OnBeforeMaterialUpdate`, which runs AFTER
  // the refresh decision, so the reader keys the base's own fields: a late map lands in the same frame, not one later.
  declareObjectInputs(twin, {
    nodes: new Set<unknown>(declared.map((d) => d.node)),
    events: true,
    read(object, out) {
      pushValue(base.map, out);
      pushValue(base.envMap, out);
      pushValue(base.envMapIntensity, out);
      for (const d of declared) pushValue(d.value(object as ObjectFrame['object']), out);
    },
  });
  return twin as unknown as THREE.Material;
}
