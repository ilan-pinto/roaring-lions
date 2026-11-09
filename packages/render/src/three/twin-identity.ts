/**
 * GH-943 WebGPU P3 (T1): which LEGACY material a node twin stands for, read back at every clone site, and the render state a twin
 * copies from it.
 *
 * On a node boot `mesh.material` is the TWIN once adoption has run. The unit clone sites (`bindRunningGear`, `beginMeshDeathFade`,
 * the scar swap, the team variant) clone `mesh.material`; cloning a twin would lose every hook. They clone `legacyOf(...)` instead,
 * and the clone is adopted at its own swap site. On a legacy boot nothing is a twin, so `legacyOf(m)` is `m` and no line moves.
 *
 * Two records (ruling P3-R2), both written by adoption (`node-material-adoption.ts`):
 *  - on the twin, `userData[TWIN_LEGACY_KEY]`: the legacy material it was made for. A shared unit twin (one per base, hook segments
 *    and pipeline state) records its memo BASE (the template material its users were cloned from);
 *  - on the mesh, `userData[TWIN_LEGACY_KEY]`: the legacy material THAT mesh held when it was adopted. Two vehicles sharing one twin
 *    but scarred differently therefore resolve to their own scar clone.
 *
 * Both are written NON-ENUMERABLE: `Material.clone`, `Object3D.clone` and `toJSON` copy `userData` through `JSON.stringify`, which
 * would otherwise serialise a whole material into every clone of a template mesh. A clone therefore never inherits a record: a
 * cloned mesh falls back to its twin's base, which is exactly the template material a template clone holds.
 *
 * THREE-FREE and import-free (the bundle census, G9): the legacy clone sites (ThreeRenderer chunk) and the twins (node chunk) both
 * read it. Structural types only.
 *
 * Presentation only. Nothing here is read by the sim.
 */

/** `userData` key: on a twin, its legacy material (the memo base for a shared unit twin); on a mesh, the legacy it held. */
export const TWIN_LEGACY_KEY = 'rlLegacy';
/** `userData` key on a legacy material: the twin adoption gave it (validates a mesh record against the mesh's current twin). */
export const TWIN_OF_KEY = 'rlTwinOf';
/** `userData` key on a legacy CLONE: the legacy material it was cloned from (the shared-twin memo's base, `legacyBaseOf`). */
export const LEGACY_BASE_KEY = 'rlLegacyBase';

/** What a material and a mesh share here: a `userData` record. */
export interface HasUserData {
  userData: Record<string, unknown>;
}

function hidden(target: HasUserData, key: string, value: unknown): void {
  Object.defineProperty(target.userData, key, { value, enumerable: false, configurable: true, writable: true });
}

/** Marks `twin` as the node twin of `legacy` (every twin factory, and adoption, call this). */
export function markTwin(twin: HasUserData, legacy: HasUserData): void {
  hidden(twin, TWIN_LEGACY_KEY, legacy);
}

/** True for a node twin. */
export function isTwin(m: HasUserData): boolean {
  return m.userData[TWIN_LEGACY_KEY] !== undefined;
}

/** Adoption swapped `mesh`'s `legacy` for `twin`: the per-mesh record (ruling P3-R2). */
export function recordAdoption(mesh: HasUserData, legacy: HasUserData, twin: HasUserData): void {
  hidden(mesh, TWIN_LEGACY_KEY, legacy);
  hidden(legacy, TWIN_OF_KEY, twin);
}

/**
 * The legacy material behind `m`: `m` itself when it is not a twin; else, with `mesh`, the legacy material that mesh held when it
 * was adopted (if the record still describes the mesh's current twin); else the twin's own record (its memo base). Every clone
 * site passes the mesh.
 */
export function legacyOf<M extends HasUserData>(m: M, mesh?: HasUserData): M {
  const own = m.userData[TWIN_LEGACY_KEY];
  if (own === undefined) return m;
  const rec = mesh?.userData[TWIN_LEGACY_KEY] as HasUserData | undefined;
  if (rec !== undefined && rec.userData[TWIN_OF_KEY] === m) return rec as M;
  return own as M;
}

/** `legacyOf(mesh.material, mesh)` for a single-material mesh. */
export function legacyMaterialOf<M extends HasUserData>(mesh: HasUserData & { material: M }): M {
  return legacyOf(mesh.material, mesh);
}

/** A clone site made `clone` from the legacy `base`: the shared unit twin is memoised by the root of this chain. */
export function recordLegacyBase(clone: HasUserData, base: HasUserData): void {
  hidden(clone, LEGACY_BASE_KEY, base);
}

/** The material `m` was ultimately cloned from (itself when no clone site recorded one). */
export function legacyBaseOf<M extends HasUserData>(m: M): M {
  let cur: HasUserData = m;
  for (let guard = 0; guard < 64; guard++) {
    const next = cur.userData[LEGACY_BASE_KEY] as HasUserData | undefined;
    if (next === undefined) break;
    cur = next;
  }
  return cur as M;
}

/**
 * The pipeline state a twin copies whole from its legacy material (`copyRenderState`). Pinned: G6 holds this list against a
 * literal and greps every legacy file for the stencil, depth-function, blend and polygon-offset fields it sets.
 */
export const RENDER_STATE_KEYS = [
  'side',
  'transparent',
  'depthTest',
  'depthWrite',
  'depthFunc',
  'blending',
  'blendSrc',
  'blendDst',
  'blendEquation',
  'blendSrcAlpha',
  'blendDstAlpha',
  'blendEquationAlpha',
  'polygonOffset',
  'polygonOffsetFactor',
  'polygonOffsetUnits',
  'stencilWrite',
  'stencilFunc',
  'stencilRef',
  'stencilFuncMask',
  'stencilWriteMask',
  'stencilFail',
  'stencilZFail',
  'stencilZPass',
  'alphaTest',
  'vertexColors',
] as const;
export type RenderStateKey = (typeof RENDER_STATE_KEYS)[number];

/** Copies every `RENDER_STATE_KEYS` field of `legacy` onto `twin` (adoption runs it on every P3 twin it makes). */
export function copyRenderState(legacy: object, twin: object): void {
  const from = legacy as Record<string, unknown>;
  const to = twin as Record<string, unknown>;
  for (const k of RENDER_STATE_KEYS) to[k] = from[k];
}

/**
 * The mutable legacy MATERIAL fields a twin draws, mirrored legacy -> twin (the plan's pinned list, plus `visible`, ruling P3-R4).
 * `visible` is mirrored BEFORE scene traversal (`ThreeRenderer.flushNodeAdoption`), because traversal skips a hidden material and
 * its own per-render update would never run; the rest per render, by the twin.
 */
export const MIRRORED_FIELDS = ['color', 'map', 'roughness', 'metalness', 'envMap', 'envMapIntensity', 'opacity', 'transparent', 'visible'] as const;
export type MirroredField = (typeof MIRRORED_FIELDS)[number];

/**
 * Ruling P3-R3: the per-entity fields of a SHARED unit twin. Two entities sharing one twin can hold different values (a fade's
 * opacity, a scar's colour and roughness), so these are read per OBJECT, from that mesh's own legacy material (`legacyOf(m, mesh)`),
 * never mirrored material-wide. T3 wires them; `mirrorLegacyFields` leaves them alone on a shared twin.
 */
export const OBJECT_SCOPED_FIELDS: ReadonlySet<MirroredField> = new Set<MirroredField>(['opacity', 'color', 'roughness', 'metalness']);

interface Copyable {
  copy(from: unknown): unknown;
}

/**
 * Mirrors the `MIRRORED_FIELDS` the twin draws from `legacy` (for a shared twin: its base). A field `twin` does not have is skipped;
 * `color` is copied in place, anything else assigned. `shared`: skip `OBJECT_SCOPED_FIELDS` (P3-R3).
 */
export function mirrorLegacyFields(legacy: object, twin: object, shared: boolean): void {
  const from = legacy as Record<string, unknown>;
  const to = twin as Record<string, unknown>;
  for (const k of MIRRORED_FIELDS) {
    if (shared && OBJECT_SCOPED_FIELDS.has(k)) continue;
    if (!(k in to) || !(k in from)) continue;
    const v = from[k];
    const cur = to[k] as Copyable | null | undefined;
    // A colour is copied in place: the twin's own object may be referenced by its graph.
    if (k === 'color' && cur !== null && typeof cur === 'object' && typeof cur.copy === 'function' && v !== null && typeof v === 'object') {
      cur.copy(v);
    } else if (cur !== v) {
      to[k] = v;
    }
  }
}
