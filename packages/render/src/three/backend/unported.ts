/**
 * GH-943 P0: the zero-unported census on the node backend.
 *
 * The node backend (WebGPURenderer) cannot run GLSL. A material carrying an `onBeforeCompile` splice draws as its stock self,
 * and a `ShaderMaterial` draws as an empty node material. Neither may happen silently, so every one is counted and named, and
 * the harness reads the full list (`Renderer.unportedHooks()`). In P0 the gate that wants the list EMPTY is report-only; each of
 * P1-P5 shrinks it, and the eslint ratchet (`lint/glsl-ratchet.ts`) keeps ported files from growing it back.
 *
 * Mutates the scene in exactly three ways, all only meaningful because the node backend cannot draw the thing: a `ShaderMaterial`
 * object is hidden, a `HIDE_WITHOUT_HOOK` object is hidden, and a render-target `envMap` (the L1 PMREM, which belongs to the
 * WebGLRenderer's context) is dropped. Copied from the L5 spike (`spike/webgpu-trial-gate.ts`).
 */
import * as THREE from 'three';
import { NODE_PMREM_TAG } from '../environment.node';
import { hookSegments } from '../material-names';

export type UnportedKind = 'shader-material' | 'on-before-compile' | 'env-map' | 'image-release' | 'partial' | 'unadopted';

export interface UnportedHook {
  readonly kind: UnportedKind;
  /** A name a reader can grep (`censusKey`): a hooked material's `rl-` program-key segments joined by `|`
   *  (`rl-running-gear-1|rl-team-mark-2`), else its `name`, a short program key, or the first object's name. A `partial`
   *  hook's key is the term itself, as its twin declares it (`rl-ground: wet terms`). */
  readonly key: string;
  /** How many scene objects carry it. */
  objects: number;
}

/** Hooked materials that draw WRONG (not just plainer) without their hook, so the node backend hides them. */
export const HIDE_WITHOUT_HOOK: ReadonlySet<string> = new Set(['rl-silhouette-outline']);

/**
 * GH-943 P2 (T1): the legacy material keys (as `censusUnported` names them) that have a node twin. Each port task APPENDS its key
 * in the PR that lands the twin (T3 the ground, T5 the ring, T6 the foliage). GH-943 P3 (T1): a HOOKED material is read per
 * program-key SEGMENT: it is exempt only when EVERY one of its `rl-` segments is listed, so porting the team mark alone leaves a
 * moving hull (`rl-running-gear-1|rl-team-mark-2`) reported. Read ONLY through the explicit `portedKeys` option
 * of `censusUnported`, which only `matchNodeStatements` (`tools/src/golden-diff/capture-protocol.ts`) passes, on the LEGACY
 * scene: there a listed key is drawn by legacy because node now draws it too, so it is neither hidden nor reported, and the parity
 * ratio of a ported layer measures something. The node backend's own census never passes it, so on node a legacy material that
 * escaped adoption is still hidden and named whatever list it is on: an adoption bug stays loud.
 */
export const PORTED_MATERIAL_KEYS: ReadonlySet<string> = new Set<string>([
  // T3: the ground (`terrain/mesh.node.ts`). The wet keys (`rl-ground-wet*`) stay off the list: node draws them dry (P4).
  'rl-ground',
  // T6: the foliage and trunk sway, dry and wet (`terrain/decor-mesh.node.ts`).
  'rl-foliage-sway', 'rl-foliage-sway-wet', 'rl-trunk-sway', 'rl-trunk-sway-wet',
  // GH-943 P2 (T5): the selection, team and wound rings (all three styles share the one material name).
  'rl-selection-ring',
]);

/** `userData` key on a node twin: the terms of its legacy material it does NOT draw (`['rl-ground: wet terms']`). */
export const UNPORTED_TERMS_KEY = 'rlUnportedTerms';

export interface CensusOptions {
  /** Legacy keys to leave visible and unreported (the L-matched arm only; see `PORTED_MATERIAL_KEYS`). Absent: none. */
  readonly portedKeys?: ReadonlySet<string>;
  /** GH-943 P3 (T2b, P3-R13): collects every object this census hides, for `reassertCensusHides`. The node backend's. */
  readonly hides?: CensusHides;
}

const STOCK_ON_BEFORE_COMPILE = THREE.Material.prototype.onBeforeCompile;
/** `Material.customProgramCacheKey()` of a material with no hook: the stock callback's own text, the same for every one of them. */
const STOCK_PROGRAM_KEY = String(STOCK_ON_BEFORE_COMPILE);

interface DrawLike extends THREE.Object3D {
  material?: THREE.Material | THREE.Material[];
}

/** P2's key, kept for a material with no `rl-` program-key segment (a `ShaderMaterial`, a stock or an unkeyed hook). */
function materialKey(m: THREE.Material, o: THREE.Object3D): string {
  let cache: string;
  try {
    cache = m.customProgramCacheKey();
  } catch {
    cache = '';
  }
  // `ShaderMaterial.customProgramCacheKey()` is the hook's own source text: never a usable name. Nor is the STOCK text (every
  // unnamed ShaderMaterial shares it, so a key list naming it would cover all of them): those fall through to the object's name.
  return m.name || (cache.length <= 60 && cache !== STOCK_PROGRAM_KEY ? cache : '') || o.name || o.parent?.name || m.type;
}

/**
 * GH-943 P3 (T1): the key the census names `m` by: its `rl-` program-key segments joined by `|`, in order, when it has any (a unit
 * hook's key is the stock text plus segments, 65+ characters, so P2's rule fell back to the GLB material name and could not say
 * WHICH hook was missing), else P2's `materialKey`.
 */
export function censusKey(m: THREE.Material, o: THREE.Object3D): string {
  const segments = hookSegments(m);
  return segments.length > 0 ? segments.join('|') : materialKey(m, o);
}

/** True when `ported` exempts `m`: every `rl-` segment listed (a hooked material), else its key listed. */
function isPorted(m: THREE.Material, o: THREE.Object3D, ported: ReadonlySet<string> | undefined): boolean {
  if (ported === undefined) return false;
  const segments = hookSegments(m);
  if (segments.length > 0) return segments.every((s) => ported.has(s));
  return ported.has(materialKey(m, o));
}

/** The objects a census hid (GH-943 P3 T2b, ruling P3-R13): the set `reassertCensusHides` holds hidden every node frame. */
export type CensusHides = Set<THREE.Object3D>;

/** True when the census would hide `o` today: a non-ported `ShaderMaterial`, or a non-ported `HIDE_WITHOUT_HOOK` hook. */
function censusWouldHide(o: THREE.Object3D, ported: ReadonlySet<string> | undefined): boolean {
  const mat = (o as DrawLike).material;
  if (!mat) return false;
  for (const m of Array.isArray(mat) ? mat : [mat]) {
    if ((m as THREE.ShaderMaterial).isShaderMaterial === true) {
      if (!isPorted(m, o, ported)) return true;
    } else if (m.onBeforeCompile !== STOCK_ON_BEFORE_COMPILE && HIDE_WITHOUT_HOOK.has(censusKey(m, o)) && !isPorted(m, o, ported)) return true;
  }
  return false;
}

/**
 * GH-943 P3 (T2b, ruling P3-R13): puts back the hide the census made. A per-frame writer (the tunnel x-ray, the flipbook meshes, a
 * layer's plain `visible` write) re-shows a census-hidden object between two censuses, and a node frame then draws an empty node
 * material. Called before every node render, node only. An object is re-hidden only while the census would STILL hide it (a mesh
 * adopted since, whose material is now a twin, is released and drawn), and one that left `root` is dropped. Returns the count re-hidden.
 */
export function reassertCensusHides(hides: CensusHides, root: THREE.Object3D, opts: CensusOptions = {}): number {
  let n = 0;
  for (const o of hides) {
    let up: THREE.Object3D | null = o;
    while (up !== null && up !== root) up = up.parent;
    if (up === null || !censusWouldHide(o, opts.portedKeys)) {
      hides.delete(o);
      continue;
    }
    if (o.visible) {
      o.visible = false;
      n++;
    }
  }
  return n;
}

/**
 * Walks `root` and reports every GLSL-only feature the WebGPU path cannot honour. Mutates the scene in
 * exactly two ways, both only meaningful because the WebGL path has stopped drawing it: a `ShaderMaterial`
 * object is hidden (`visible = false`: an unconvertible material would otherwise draw as an empty node
 * material), and a render-target `envMap` (the L1 PMREM, which belongs to the WebGL context) is dropped.
 * An `onBeforeCompile` hook is left in place: the material draws as its stock self, and the report names it.
 *
 * GH-943 P2 (T1): a node twin that draws only part of its legacy material lists the rest in `userData.rlUnportedTerms`, and each
 * term is reported as a `partial` hook. `opts.portedKeys` (OFF by default; see `PORTED_MATERIAL_KEYS`) exempts listed legacy keys.
 */
export function censusUnported(root: THREE.Object3D, opts: CensusOptions = {}): UnportedHook[] {
  const ported = opts.portedKeys;
  const hides = opts.hides;
  const found = new Map<string, UnportedHook>();
  const note = (kind: UnportedKind, key: string): void => {
    const id = `${kind}|${key}`;
    const hit = found.get(id);
    if (hit) hit.objects++;
    else found.set(id, { kind, key, objects: 1 });
  };
  root.traverse((o) => {
    const mat = (o as DrawLike).material;
    if (!mat) return;
    const list = Array.isArray(mat) ? mat : [mat];
    for (const m of list) {
      const terms = (m.userData as Record<string, unknown>)[UNPORTED_TERMS_KEY];
      if (Array.isArray(terms)) for (const t of terms) if (typeof t === 'string') note('partial', t);
      if ((m as THREE.ShaderMaterial).isShaderMaterial === true) {
        if (isPorted(m, o, ported)) continue;
        note('shader-material', censusKey(m, o));
        o.visible = false;
        hides?.add(o);
        continue;
      }
      if (m.onBeforeCompile !== STOCK_ON_BEFORE_COMPILE) {
        const key = censusKey(m, o);
        if (!isPorted(m, o, ported)) {
          note('on-before-compile', key);
          // The occlusion outline is a depth-fail trick in GLSL; as a stock material it would paint every unit a flat colour.
          if (HIDE_WITHOUT_HOOK.has(key)) {
            o.visible = false;
            hides?.add(o);
          }
        }
      }
      // GLB bitmaps are closed after their first upload (`units/gltf-loader.ts`); WebGPU uploads more than once and would
      // draw them black. Already-armed textures are disarmed here while their bitmap is still open.
      for (const v of Object.values(m)) {
        const t = v as THREE.Texture | null;
        const img = t && t.isTexture === true ? (t.image as { close?: unknown; width?: number } | null) : null;
        if (t && img && typeof img.close === 'function' && (img.width ?? 0) > 0 && t.onUpdate !== null) {
          t.onUpdate = null;
          note('image-release', censusKey(m, o));
        }
      }
      const env = (m as THREE.MeshStandardMaterial).envMap;
      // A PMREM baked BY the node renderer (`environment.node.ts`, tagged) is valid here; only the WebGLRenderer's is dropped.
      if (
        env &&
        (env as THREE.Texture & { isRenderTargetTexture?: boolean }).isRenderTargetTexture === true &&
        (env.userData as Record<string, unknown>)[NODE_PMREM_TAG] !== true
      ) {
        note('env-map', censusKey(m, o));
        (m as THREE.MeshStandardMaterial).envMap = null;
      }
    }
  });
  return [...found.values()].sort((a, b) => (a.kind + a.key < b.kind + b.key ? -1 : 1));
}

/**
 * GH-943 P3 (T1): the census backstop. Every material under `root` that `adoptable` says has a twin factory (its kit slot is filled
 * on this backend) but is still on a mesh is reported as `unadopted`, keyed by `censusKey`: a swap site that does not queue its
 * adoption draws the stock material until a site that does, and this makes it loud. Mutates nothing. Only the node backend calls it.
 */
export function censusUnadopted(root: THREE.Object3D, adoptable: (m: THREE.Material) => boolean): UnportedHook[] {
  const found = new Map<string, UnportedHook>();
  root.traverse((o) => {
    const mat = (o as DrawLike).material;
    if (!mat) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      if (!adoptable(m)) continue;
      const key = censusKey(m, o);
      const hit = found.get(key);
      if (hit) hit.objects++;
      else found.set(key, { kind: 'unadopted', key, objects: 1 });
    }
  });
  return [...found.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** One warning line per hook, in the shape a log reader greps for: `[lions] UNPORTED ...` (`[lions] UNADOPTED ...` for P3's backstop). */
export function unportedWarnings(hooks: readonly UnportedHook[], seen: Set<string>): string[] {
  const out: string[] = [];
  for (const h of hooks) {
    const id = `${h.kind}|${h.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (h.kind === 'unadopted') {
      out.push(`[lions] UNADOPTED "${h.key}" (${h.objects} object${h.objects === 1 ? '' : 's'}): its node twin exists but the legacy material is still on a mesh: a swap site does not queue its adoption`);
      continue;
    }
    const what =
      h.kind === 'shader-material'
        ? 'ShaderMaterial has no TSL port on the node backend: the object is HIDDEN'
        : h.kind === 'on-before-compile'
          ? 'onBeforeCompile GLSL has no TSL port on the node backend: it draws as the stock material WITHOUT the hook'
          : h.kind === 'image-release'
            ? 'the load-time bitmap release after first upload is WebGL-only (WebGPU uploads twice): DISARMED'
            : h.kind === 'partial'
              ? 'the node twin draws its material WITHOUT this term'
              : 'render-target envMap belongs to the WebGL context: DROPPED';
    out.push(`[lions] UNPORTED ${h.kind} "${h.key}" (${h.objects} object${h.objects === 1 ? '' : 's'}): ${what}`);
  }
  return out;
}
