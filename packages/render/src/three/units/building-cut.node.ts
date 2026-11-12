/**
 * GH-1225 slice 3 (design `2026-11-11-roof-cutaway-design.md`, "TSL twin (WebGPU)"; decision L7): the NODE twin of a clone-drawn
 * building's holed and/or cut colour clone, the backend's `building` factory. One `MeshStandardNodeMaterial` per legacy clone, keyed
 * by the legacy program-key segments `rl-cut` and `rl-holes` (`BUILDING_HOOK_SEGMENTS`), in the pattern of the T9 x-ray and the P3
 * unit twins:
 *
 * - **Discard:** ONE `maskNode`, holes OR cut, the same fragments the legacy colour clone and its depth and AO masks discard
 *   (`buildingFragmentOps`, `building-cut-maths.ts`, the one body the number specs run).
 * - **Colour:** a `colorNode` over the stock base (`materialColor`, the colour times the map): the cap and the interior are chosen by
 *   `faceDirection`, the cut's splice first and the holes' over it, as the legacy hooks compose.
 * - **Maths:** `cutawayOps` (through `buildingFragmentOps`) arrives as a VALUE, `MATERIAL_MATHS.building`, so the two backends cannot
 *   drift and the node chunk never statically loads the ThreeRenderer chunk.
 * - **Uniforms:** the volume block is a `uniformArray` over the legacy record's `Float32Array`, BY REFERENCE (three copies it into its
 *   padded buffer every render), and ONE node per record, shared by every twin, so every cut building compiles the same program text.
 *   The count is re-read every render, so the minimap's forced 0 (`photographGround`) suspends the cut here too. The holes are twelve
 *   named `vec4` uniforms over the legacy record's own vectors (not an array: a uniform buffer is named by its node id, which would
 *   give every holed building its own program text).
 * - **Shadow:** r186's shadow pass applies `maskShadowNode || maskNode` to the caster (`Renderer._getShadowNodes`), so this one
 *   `maskNode` cuts the shadow, with no second copy of the mask. `castShadowNode` IS honoured on r186 (it becomes the caster's
 *   colour), but it is the TRANSMITTED-shadow channel: without `shadowMap.transmitted` it warns and its colour is ignored, so the
 *   twin leaves it null (`building-cut.node.test.ts` pins both facts on r186).
 *
 * Every other look field (map, colour, roughness, metalness, emissive, side, ...) is the legacy clone's own, copied once at adoption:
 * a clone is minted per building and band and never edited (a band change mints a new clone, and so a new twin).
 *
 * - **AO (GH-1248):** the node AO pre-pass draws a cut mesh through a mask material built over this same `maskNode`
 *   (`post-chain.node.ts`, `NodeAoStage.cutAoFor`), so the G-buffer discards with the colour, as the legacy `userData.rlCutAo`.
 *
 * ADDON-FREE: `three/webgpu` and `three/tsl` arrive injected, the maths as values. Presentation only.
 */
import type * as THREE from 'three';
import type * as WEBGPU from 'three/webgpu';
import { tslIntOps, tslOps, type N, type Tsl } from '../fog-pass.node';
import type { IntOps, Ops } from '../fog-ops';
import { hookSegments } from '../material-names';
import type { buildingFragmentOps, CutInput, Flow, HolesInput } from './building-cut-maths';
import type { cutHookOf } from './cut-material';
import type { holesHookOf } from './holed-material';

/** The twin's shared maths and the legacy readers, INJECTED (`material-maths.ts`'s `building` slot). */
export interface BuildingCutMaths {
  readonly fragmentOps: typeof buildingFragmentOps;
  readonly cutHookOf: typeof cutHookOf;
  readonly holesHookOf: typeof holesHookOf;
  /** `CUT_VOLUME_CAP * CUT_FLOATS_PER_VOLUME`: the block's length. */
  readonly cutBlockFloats: number;
  /** `HOLE_CAP`. */
  readonly holeCap: number;
}

export interface BuildingTwinDeps {
  readonly W: typeof WEBGPU;
  readonly TSL: Tsl;
  readonly maths: BuildingCutMaths;
}

/** The legacy program-key segments this twin draws. COPIES of `CUT_PROGRAM_KEY` and `HOLES_PROGRAM_KEY` (a value import would drag the
 *  legacy chunk in); `building-cut.node.test.ts` pins them equal. */
export const CUT_SEGMENT = 'rl-cut';
export const HOLES_SEGMENT = 'rl-holes';
/** The name every building twin carries (`NODE_MATERIAL_MARKER`'s prefix, `tools/src/perf/bundle-census.ts`). */
export const NODE_BUILDING_MATERIAL_NAME = 'rl-node-material-building';
/** The nodes a spec may read back, on `userData`. */
export const BUILDING_BOUND_KEY = 'rlBuildingBound';

export interface BuildingTwinBound {
  readonly uRlCutV?: N;
  readonly uRlCutN?: N;
  readonly uRlCutCap?: N;
  readonly uRlCutInterior?: N;
  readonly uRlHoleC?: readonly N[];
  readonly uRlHoleA?: readonly N[];
  readonly uRlHoleN?: N;
  readonly uRlLip?: N;
  readonly uRlHalo?: N;
  readonly uRlCrack?: N;
  readonly uRlInterior?: N;
  /** The mask, 1 kept and 0 discarded (`maskNode` is `keep > 0.5`). */
  readonly keep: N;
}

/** The TSL names this twin uses beyond `Tsl`. */
interface BuildingTsl extends Tsl {
  readonly positionWorld: N;
  readonly faceDirection: N;
  readonly materialColor: N;
}

/**
 * `Flow<N>` as TSL control flow: the state becomes variables, and `body` runs inside an `If`, assigning them. So a volume past
 * `uRlCutN`, a hole past `uRlHoleN` or a fragment outside a hole's depth costs one branch on the GPU, as in the GLSL, not the whole
 * body. Only valid inside a `Fn` (the stack `If` writes to).
 */
export function tslFlow(T: Tsl): Flow<N> {
  return {
    when(cond, state, body) {
      const vars = state.map((v) => T.float(v).toVar());
      T.If(cond.greaterThan(0.5), () => {
        const out = body(vars);
        out.forEach((v, k) => (vars[k] as N).assign(v));
      });
      return vars;
    },
  };
}

/** Fields never copied from the legacy clone: identity, bookkeeping and the GLSL hook itself. */
const NOT_COPIED: ReadonlySet<string> = new Set(['uuid', 'id', 'name', 'type', 'userData', 'version', 'defines', 'onBeforeCompile', 'customProgramCacheKey']);

/** The shared volume block's nodes, one pair per legacy record (every twin of every cut building reads the same two). */
const sharedBlocks = new WeakMap<object, { readonly v: N; readonly n: N }>();

/** A number re-read from `read()` every render. */
function liveNumber(T: Tsl, read: () => number): N {
  const n = T.uniform(read());
  n.onRenderUpdate(() => {
    n.value = read();
  });
  return n;
}

export function createNodeBuildingMaterial(deps: BuildingTwinDeps, legacy: THREE.MeshStandardMaterial): WEBGPU.MeshStandardNodeMaterial {
  const { W, maths } = deps;
  const T = deps.TSL as BuildingTsl;
  const segments = hookSegments(legacy);
  const stray = segments.filter((s) => s !== CUT_SEGMENT && s !== HOLES_SEGMENT);
  if (segments.length === 0 || stray.length > 0) {
    throw new Error(`node building twin: "${legacy.name}" carries [${segments.join(', ')}], not only ${HOLES_SEGMENT} / ${CUT_SEGMENT}`);
  }
  const cutHook = segments.includes(CUT_SEGMENT) ? maths.cutHookOf(legacy) : undefined;
  if (segments.includes(CUT_SEGMENT) && cutHook === undefined) throw new Error(`node building twin: a ${CUT_SEGMENT} material ("${legacy.name}") carries no cut hook`);
  const holesRec = segments.includes(HOLES_SEGMENT) ? maths.holesHookOf(cutHook?.base ?? legacy) : undefined;
  if (segments.includes(HOLES_SEGMENT) && holesRec === undefined) throw new Error(`node building twin: a ${HOLES_SEGMENT} material ("${legacy.name}") carries no holes hook`);

  const o = tslOps(T) as Ops<N>;
  const io = tslIntOps(T) as IntOps<N>;
  const bound: { -readonly [K in keyof BuildingTwinBound]: BuildingTwinBound[K] } = { keep: T.float(1) };
  const rgb3 = (u: N): [N, N, N] => [u.x, u.y, u.z];

  let cut: CutInput<N> | null = null;
  if (cutHook !== undefined) {
    const rec = cutHook.uniforms;
    let block = sharedBlocks.get(rec.uRlCutV);
    if (block === undefined) {
      if (rec.uRlCutV.value.length !== maths.cutBlockFloats) throw new Error(`node building twin: the cut block holds ${rec.uRlCutV.value.length} floats, not ${maths.cutBlockFloats}`);
      block = { v: T.uniformArray(rec.uRlCutV.value, 'float'), n: liveNumber(T, () => rec.uRlCutN.value) };
      sharedBlocks.set(rec.uRlCutV, block);
    }
    const uRlCutCap = T.uniform(rec.uRlCutCap.value);
    const uRlCutInterior = T.uniform(rec.uRlCutInterior.value);
    Object.assign(bound, { uRlCutV: block.v, uRlCutN: block.n, uRlCutCap, uRlCutInterior });
    const v = Array.from({ length: maths.cutBlockFloats }, (_, i) => block.v.element(i));
    cut = { v, n: block.n, cap: rgb3(uRlCutCap), interior: rgb3(uRlCutInterior) };
  }

  let holes: HolesInput<N> | null = null;
  if (holesRec !== undefined) {
    if (holesRec.uRlHoleC.value.length !== maths.holeCap) throw new Error(`node building twin: ${holesRec.uRlHoleC.value.length} hole centres, not ${maths.holeCap}`);
    const uRlHoleC = holesRec.uRlHoleC.value.map((vec) => T.uniform(vec));
    const uRlHoleA = holesRec.uRlHoleA.value.map((vec) => T.uniform(vec));
    const uRlHoleN = liveNumber(T, () => holesRec.uRlHoleN.value);
    const uRlLip = T.uniform(holesRec.uRlLip.value);
    const uRlHalo = T.uniform(holesRec.uRlHalo.value);
    const uRlCrack = T.uniform(holesRec.uRlCrack.value);
    const uRlInterior = T.uniform(holesRec.uRlInterior.value);
    Object.assign(bound, { uRlHoleC, uRlHoleA, uRlHoleN, uRlLip, uRlHalo, uRlCrack, uRlInterior });
    const v4 = (u: N): [N, N, N, N] => [u.x, u.y, u.z, u.w];
    holes = {
      c: uRlHoleC.map(v4),
      a: uRlHoleA.map(v4),
      n: uRlHoleN,
      lip: rgb3(uRlLip),
      halo: rgb3(uRlHalo),
      crack: rgb3(uRlCrack),
      interior: rgb3(uRlInterior),
    };
  }

  const m = new W.MeshStandardNodeMaterial();
  // The look: every field of the legacy clone the node material also has, once (the stock conversion's `fromMaterial` rule, minus
  // identity and the hook). Objects (colour, maps) are shared by reference, as that conversion does.
  const from = legacy as unknown as Record<string, unknown>;
  const to = m as unknown as Record<string, unknown>;
  for (const k of Object.keys(from)) {
    if (NOT_COPIED.has(k) || k.startsWith('_') || !(k in to) || typeof from[k] === 'function') continue;
    to[k] = from[k];
  }
  m.name = NODE_BUILDING_MATERIAL_NAME;

  const wp = T.positionWorld;
  const base = T.vec4(T.materialColor);
  const front = o.selectLt(o.lit(0), T.faceDirection, o.lit(1), o.lit(0));
  // ONE call: the colour and the mask are its two halves (rgb, keep), so the mask the colour pass and the shadow pass discard on is
  // the very node the colour was gated by.
  const flow = tslFlow(T);
  const res = T.Fn(() => {
    const f = maths.fragmentOps(o, io, flow, { p: [wp.x, wp.y, wp.z], front, base: [base.x, base.y, base.z], cut, holes });
    return T.vec4(f.rgb[0], f.rgb[1], f.rgb[2], f.keep);
  })();
  bound.keep = res.w;
  m.colorNode = T.vec4(res.x, res.y, res.z, base.w) as never;
  m.maskNode = res.w.greaterThan(0.5) as never;
  m.userData[BUILDING_BOUND_KEY] = bound as BuildingTwinBound;
  return m;
}
