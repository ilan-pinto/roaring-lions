/**
 * GH-943 P3 (T14b, GH-1152) F2: the refresh policy for PARKED objects on the node renderer.
 *
 * three 0.186.1's `NodeMaterialObserver.needsRefresh` returns FULL for every render object whose material holds a node (`hasNode`),
 * before it reads `object.static` or a bundle, so every twinned and every converted stock mesh takes the whole per-object refresh in
 * every pass of every frame: `_geometries.updateForRender` and every binding group, moved or still (T13: 1732 non-skinned FULL a frame
 * at n600). SHARED runs `updateBefore`, the node updates and the SHARED groups only (`Renderer._renderObjectDirect`,
 * `Bindings.updateSharedForRender`); it skips the geometry update and every non-shared group: the object group (the model matrices,
 * the material references, a twin's per-object uniforms) and the sampled textures.
 *
 * So this wraps the renderer's own `_nodes.needsRefresh` and turns FULL into SHARED (never NONE: NONE also skips `updateAfter` and the
 * shared groups) when, and only when:
 *  - the observer said FULL because of `hasNode` ALONE: not `hasAnimation` (skinned or morphed), not velocity;
 *  - the object is a plain `Mesh` (no skinning, instancing, batching or morph targets);
 *  - its PROGRAM is downgradable (`classifyUpdateNodes`): every per-object update node is three's own matrix, reference or texture
 *    node, a uniform in a shared group, or one the material DECLARES (`object-inputs.ts`). Anything else makes the program NEVER
 *    downgrade, and its name goes on the census (G2c);
 *  - this render object has been seen before (a WeakMap keyed by the RENDER OBJECT, so the shadow pass's own render object is keyed on
 *    its own: keying by the mesh would let the shadow call read the scene pass's fresh key and keep a moving unit's shadow stale);
 *  - its key is unchanged since its last call (`refreshVerdict`): the world matrix, the camera's world and projection matrices (the
 *    object group's model-view and normal matrices are camera-derived), the material version, the geometry and every attribute's
 *    version and draw range, every explicit Object3D node's matrix, every material reference's value, every per-object texture node's
 *    transform, every sampled texture's id and version, and the declared inputs' values.
 *
 * A moving unit changes its matrix and stays FULL; a fading one changes its legacy material's opacity (declared) and stays FULL.
 *
 * Presentation only. Nothing here is read by the sim. Installed on the node renderer instance (`createNodeBackend`); `dispose` puts
 * the instance's own `needsRefresh` back.
 */
import { objectInputsOf, pushValue, type ObjectInputs } from './object-inputs';

/** `RenderObjectRefreshType` (three 0.186.1 `constants.js`). */
export const REFRESH = { NONE: 0, SHARED: 1, FULL: 2 } as const;

/** Why the observer said what it said, as far as the policy may act on it. Only `hasNode` may be downgraded. */
export type RefreshReason = 'hasNode' | 'hasAnimation' | 'other' | 'ineligible';

/**
 * Pure. The verdict for one render object: `observer` is three's verdict, `reason` why (`'hasNode'` only for a plain mesh whose
 * program is downgradable), `prev` the key from its last call (null at first sight), `now` its key this call.
 */
export function refreshVerdict(observer: number, reason: RefreshReason, prev: ArrayLike<number> | null, now: ArrayLike<number>): number {
  if (observer !== REFRESH.FULL) return observer;
  if (reason !== 'hasNode') return REFRESH.FULL;
  if (prev === null || prev.length !== now.length) return REFRESH.FULL;
  for (let i = 0; i < now.length; i++) if (prev[i] !== now[i]) return REFRESH.FULL;
  return REFRESH.SHARED;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The program classifier (G2c).

/** The parts of a node the classifier reads. */
export interface UpdateNodeLike {
  readonly type?: string;
  readonly name?: string;
  readonly updateType?: string;
  readonly isUniformNode?: boolean;
  readonly isTextureNode?: boolean;
  readonly groupNode?: { readonly shared?: boolean } | null;
  readonly object3d?: { readonly matrixWorld: { readonly elements: ArrayLike<number> } } | null;
  readonly object?: object | null;
  readonly material?: object | null;
  readonly value?: unknown;
  getValueFromReference?(o: object): unknown;
}

export interface ProgramPlan {
  /** Every per-object input is one this policy keys. */
  readonly downgradable: boolean;
  /** The update nodes that block it, as `type:name` (the G2c census). */
  readonly undeclared: readonly string[];
  readonly object3dNodes: readonly UpdateNodeLike[];
  readonly referenceNodes: readonly UpdateNodeLike[];
  readonly textureNodes: readonly UpdateNodeLike[];
  readonly inputs: ObjectInputs | undefined;
}

const REFERENCE_TYPES = new Set(['ReferenceNode', 'ReferenceBaseNode', 'MaterialReferenceNode']);
const MATRIX_TYPES = new Set(['Object3DNode', 'ModelNode']);

/**
 * Pure over the nodes. `matrixSingletons` are three's anonymous matrix uniforms (`modelNormalMatrix`, `modelWorldMatrixInverse`),
 * derived from the object's world matrix, which is in the key. `inputs` is the material's declaration, if any.
 */
export function classifyUpdateNodes(updateNodes: Iterable<UpdateNodeLike>, inputs: ObjectInputs | undefined, matrixSingletons: ReadonlySet<unknown>): ProgramPlan {
  const undeclared: string[] = [];
  const object3dNodes: UpdateNodeLike[] = [];
  const referenceNodes: UpdateNodeLike[] = [];
  const textureNodes: UpdateNodeLike[] = [];
  for (const n of updateNodes) {
    const type = n.type ?? '?';
    if (matrixSingletons.has(n)) continue;
    if (MATRIX_TYPES.has(type)) {
      if (n.object3d != null) object3dNodes.push(n);
      continue;
    }
    if (REFERENCE_TYPES.has(type)) {
      referenceNodes.push(n);
      continue;
    }
    if (n.isTextureNode === true) {
      textureNodes.push(n);
      continue;
    }
    if (type === 'EventNode' && inputs?.events === true) continue;
    if (inputs?.nodes.has(n) === true) continue;
    // A uniform GROUP's own update only flags the group for a re-check; its members are classified one by one.
    if (type === 'UniformGroupNode') continue;
    // A uniform in a SHARED group is written on the SHARED path too.
    if (n.isUniformNode === true && n.groupNode?.shared === true) continue;
    undeclared.push(`${type}:${n.name !== undefined && n.name !== '' ? n.name : '?'}`);
  }
  return { downgradable: undeclared.length === 0, undeclared, object3dNodes, referenceNodes, textureNodes, inputs };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The key.

interface MatrixLike {
  readonly elements: ArrayLike<number>;
}
interface AttributeLike {
  readonly version?: number;
  readonly isInterleavedBufferAttribute?: boolean;
  readonly data?: { readonly version: number };
}
export interface KeyObjectLike {
  readonly matrixWorld: MatrixLike;
  readonly isMesh?: boolean;
  readonly isSkinnedMesh?: boolean;
  readonly isInstancedMesh?: boolean;
  readonly isBatchedMesh?: boolean;
  readonly morphTargetInfluences?: readonly number[];
}
export interface KeyRenderObjectLike {
  readonly object: KeyObjectLike;
  readonly material: { readonly version: number };
  readonly geometry: {
    readonly id: number;
    readonly index: AttributeLike | null;
    readonly attributes: Readonly<Record<string, AttributeLike>>;
    readonly drawRange: { readonly start: number; readonly count: number };
  };
  readonly camera: { readonly matrixWorld: MatrixLike; readonly projectionMatrix: MatrixLike };
}
export interface BindingGroupLike {
  readonly bindings: readonly {
    readonly isSampledTexture?: boolean;
    readonly isStorageBuffer?: boolean;
    readonly textureNode?: { readonly value?: unknown };
    readonly groupNode?: { readonly shared?: boolean } | null;
  }[];
}

const pushMatrix = (m: MatrixLike, out: number[]): void => {
  const e = m.elements;
  for (let i = 0; i < e.length; i++) out.push(e[i] as number);
};
const attrVersion = (a: AttributeLike | null): number => (a === null ? -1 : a.isInterleavedBufferAttribute === true && a.data !== undefined ? a.data.version : (a.version ?? -1));

interface TextureStateLike {
  readonly id?: number;
  readonly version?: number;
  readonly flipY?: boolean;
  readonly rotation?: number;
  readonly offset?: { x: number; y: number };
  readonly repeat?: { x: number; y: number };
  readonly center?: { x: number; y: number };
}
function pushTexture(t: unknown, out: number[]): void {
  pushValue(t, out);
  const s = t as TextureStateLike | null | undefined;
  if (s == null || typeof s !== 'object') return;
  out.push(s.flipY === true ? 1 : 0, s.rotation ?? 0, s.offset?.x ?? 0, s.offset?.y ?? 0, s.repeat?.x ?? 1, s.repeat?.y ?? 1, s.center?.x ?? 0, s.center?.y ?? 0);
}

/** Writes the render object's key onto `out` (cleared first). */
export function writeKey(ro: KeyRenderObjectLike, plan: ProgramPlan, textures: readonly { readonly value?: unknown }[], out: number[]): void {
  out.length = 0;
  pushMatrix(ro.object.matrixWorld, out);
  pushMatrix(ro.camera.matrixWorld, out);
  pushMatrix(ro.camera.projectionMatrix, out);
  out.push(ro.material.version);
  const g = ro.geometry;
  out.push(g.id, attrVersion(g.index), g.drawRange.start, g.drawRange.count);
  for (const k in g.attributes) out.push(attrVersion(g.attributes[k] ?? null));
  for (const n of plan.object3dNodes) if (n.object3d != null) pushMatrix(n.object3d.matrixWorld, out);
  for (const n of plan.referenceNodes) {
    const ref = n.type === 'MaterialReferenceNode' ? (n.material ?? ro.material) : (n.object ?? ro.object);
    pushValue(n.getValueFromReference !== undefined ? n.getValueFromReference(ref as object) : undefined, out);
  }
  for (const n of plan.textureNodes) pushTexture(n.value, out);
  for (const t of textures) pushValue(t.value, out);
  plan.inputs?.read(ro.object, out);
}

/** The sampled textures of the render object's NON-shared groups (SHARED skips them), or null when a group holds a storage buffer. */
export function objectTextures(groups: readonly BindingGroupLike[]): { readonly value?: unknown }[] | null {
  const out: { readonly value?: unknown }[] = [];
  for (const g of groups) {
    for (const b of g.bindings) {
      if (b.groupNode?.shared === true) continue;
      if (b.isStorageBuffer === true) return null;
      if (b.isSampledTexture === true && b.textureNode !== undefined) out.push(b.textureNode);
    }
  }
  return out;
}

/** A plain mesh: skinning, instancing, batching and morph targets refresh their own way. */
export function plainMesh(o: KeyObjectLike): boolean {
  return o.isMesh === true && o.isSkinnedMesh !== true && o.isInstancedMesh !== true && o.isBatchedMesh !== true && o.morphTargetInfluences === undefined;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The installer.

/** The run-time mode: the boot options' two values, plus the probe page's H7 ceiling (no key check: timing only, never shipped). */
export type RefreshMode = 'three' | 'parked' | 'unsafe-shared';

export interface RenderObjectLike extends KeyRenderObjectLike {
  getMonitor(): { readonly hasNode?: boolean; readonly hasAnimation?: boolean; needsVelocity?(renderer: unknown): boolean };
  getNodeBuilderState(): { readonly updateNodes: Iterable<UpdateNodeLike> };
  getBindings(): readonly BindingGroupLike[];
}
export interface NodesLike {
  needsRefresh(ro: RenderObjectLike): number;
}

export interface RefreshTally {
  /** Calls where three said FULL. */
  full: number;
  /** Of those, the ones this turned into SHARED. */
  downgraded: number;
}

export interface RefreshPolicyHandle {
  mode(): RefreshMode;
  setMode(m: RefreshMode): void;
  /** The tally since the last call, then reset. */
  takeTally(): RefreshTally;
  /** The distinct `type:name` update nodes that kept a program FULL (G2c's census), cumulative. */
  undeclared(): readonly string[];
  dispose(): void;
}

interface Entry {
  state: object;
  plan: ProgramPlan;
  textures: { readonly value?: unknown }[] | null;
  prev: number[] | null;
}

export function installRefreshPolicy(nodes: NodesLike, renderer: unknown, initial: RefreshMode, matrixSingletons: ReadonlySet<unknown>): RefreshPolicyHandle {
  const hadOwn = Object.prototype.hasOwnProperty.call(nodes, 'needsRefresh');
  const orig = nodes.needsRefresh;
  let mode: RefreshMode = initial;
  let tally: RefreshTally = { full: 0, downgraded: 0 };
  // Replaced on every mode change: a key kept across a stretch of FULL frames could match `now` while the last FULL wrote a value
  // in between, so a new mode starts every render object from first sight.
  let seen = new WeakMap<object, Entry>();
  const blocked = new Set<string>();
  const scratch: number[] = [];
  nodes.needsRefresh = function (this: NodesLike, ro: RenderObjectLike): number {
    const t = orig.call(this, ro);
    if (t !== REFRESH.FULL) return t;
    tally.full++;
    if (mode === 'three') return t;
    const mon = ro.getMonitor();
    const hasNodeOnly = mon.hasNode === true && mon.hasAnimation !== true && mon.needsVelocity?.(renderer) !== true && plainMesh(ro.object);
    const state = ro.getNodeBuilderState();
    let e = seen.get(ro);
    if (e === undefined || e.state !== state) {
      // First sight of this render object, or a new program: FULL, and the plan for next time.
      const plan = classifyUpdateNodes(state.updateNodes, objectInputsOf(ro.material), matrixSingletons);
      for (const u of plan.undeclared) blocked.add(u);
      e = { state, plan, textures: null, prev: null };
      seen.set(ro, e);
      return t;
    }
    if (!hasNodeOnly) return t;
    if (mode === 'unsafe-shared') {
      tally.downgraded++;
      return REFRESH.SHARED;
    }
    // The bindings exist from the first FULL refresh on; read once.
    if (e.textures === null) e.textures = objectTextures(ro.getBindings());
    const reason: RefreshReason = e.plan.downgradable && e.textures !== null ? 'hasNode' : 'ineligible';
    if (reason !== 'hasNode') return t;
    writeKey(ro, e.plan, e.textures ?? [], scratch);
    const v = refreshVerdict(t, reason, e.prev, scratch);
    if (v === REFRESH.SHARED) tally.downgraded++;
    else if (e.prev === null || e.prev.length !== scratch.length) e.prev = scratch.slice();
    else for (let i = 0; i < scratch.length; i++) e.prev[i] = scratch[i] as number;
    return v;
  };
  return {
    mode: () => mode,
    setMode: (m) => {
      if (m !== mode) seen = new WeakMap<object, Entry>();
      mode = m;
    },
    takeTally: () => {
      const out = tally;
      tally = { full: 0, downgraded: 0 };
      return out;
    },
    undeclared: () => [...blocked].sort(),
    dispose: () => {
      if (hadOwn) nodes.needsRefresh = orig;
      else delete (nodes as { needsRefresh?: unknown }).needsRefresh;
    },
  };
}
