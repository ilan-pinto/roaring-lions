/**
 * GH-1226 (S4): the height-blend RECORD, what the node ground reads to draw the blend. Design 3.3
 * (`docs/superpowers/specs/2026-11-12-gh1226-height-blend-design.md`).
 *
 * It rides on the legacy `GroundMaterial` under a NON-enumerable `userData` key (the `DECAL_LIGHTS_KEY` pattern), written only on a node
 * boot, before the node ground twin is built (S5 wires that). The legacy `uniforms` table is never touched, so the legacy program and its
 * cache key cannot move (pin L2), and a legacy boot never has one (pin L3). The node twin reads it by reference every render: the field
 * texture (replaced by a rebuild or a late load), the three tones, the amplitudes and `amp`. `options` is the exception: it picks the
 * GRAPH (`low` leaves out the texture edge and the joints; arid has no joint tone), so it is read once, when the twin is built.
 *
 * Imports no field module, on purpose: `ThreeRenderer` (the chunk a legacy boot loads) imports this file for the debug layer, and the
 * bundle census (pin L1) arms on any non-test import of `height-blend-field` / `height-blend-texture`.
 *
 * Presentation only. Nothing here is read by the sim.
 */
import * as THREE from 'three';
import type { HeightBlendOptions } from './height-blend';

/** `userData` key on the legacy ground material: its `HeightBlendRecord`. Absent means today's graph. */
export const HEIGHT_BLEND_KEY = 'rlHeightBlendRecord';
/** `userData` key the node ground twin writes on its owner when it is built: a record installed after that would be ignored, so it throws. */
export const HEIGHT_BLEND_BUILT_KEY = 'rlHeightBlendBuilt';

export interface HeightBlendRecord {
  /** The field texture (RGBA8, Linear, clamp, no mips). A rebuild or a late load REPLACES it; the twin re-reads it each render. */
  field: THREE.Texture;
  /**
   * The ground's OWN `uControlA` uniform object (shared by reference, so a terrain rebuild's new control A reaches every reader with the one
   * write). The node decal twin taps `.value` for its soil weight (GH-1226: the decal has no control A of its own); the ground twin reads
   * its own uniform and ignores this.
   */
  readonly controlA: { value: THREE.Texture };
  /** LINEAR rgb. Mutated or replaced; the twin re-reads the reference each render. */
  rockTone: THREE.Color;
  /** Absent exactly when `options.joints` is false (arid): `installHeightBlend` throws on `joints: true` without both this and `aJ`. */
  jointTone?: THREE.Color;
  hollowTone: THREE.Color;
  /** `aR`, `aJ`, `aH`, `kH` (design 2.2). */
  aR: number;
  aJ?: number;
  aH: number;
  kH: number;
  /** 1 shipped, 0 hides the layer (the `height-blend` debug layer). */
  amp: number;
  /**
   * The graph choice, read ONCE at twin build: `low` sets both false (no texture edge, no joints). A theme with NO joint tone (arid) MUST set
   * `joints: false` too: with joints compiled and `aJ` 0 the stage still mixes toward PURE rock tone at the joint weight, which is not an
   * identity. With joints off the twin makes no joint uniforms at all.
   */
  readonly options: HeightBlendOptions;
}

/** What the record and the seal live on: a material's `userData`. */
export interface HasUserData {
  userData: Record<string, unknown>;
}

function hidden(target: HasUserData, key: string, value: unknown): void {
  Object.defineProperty(target.userData, key, { value, enumerable: false, configurable: true, writable: true });
}

/** Installs `record` on `owner`. Throws if the node ground twin was already built from `owner` (it would never see it). */
export function installHeightBlend(owner: HasUserData, record: HeightBlendRecord): void {
  if (owner.userData[HEIGHT_BLEND_BUILT_KEY] === true) {
    throw new Error('height blend: the node ground twin is already built, so a record installed now would be silently ignored; install before the first adoption');
  }
  if (record.options.joints && (record.jointTone === undefined || record.aJ === undefined)) {
    throw new Error('height blend: options.joints is true but the record has no jointTone / aJ; joints compiled with aJ 0 would mix toward pure rock tone');
  }
  hidden(owner, HEIGHT_BLEND_KEY, record);
}

/** The record on `owner`, or undefined (every legacy boot, and every theme without `heightBlend`). */
export function heightBlendOf(owner: HasUserData): HeightBlendRecord | undefined {
  return owner.userData[HEIGHT_BLEND_KEY] as HeightBlendRecord | undefined;
}

/** The amplitude to put back, per record, while the layer is hidden. */
const shownAmp = new WeakMap<HeightBlendRecord, number>();

/**
 * Backs `setDebugLayerVisible('height-blend', ...)`: `amp` to 0 and back, the `setMacroVisible` contract (1 when it changed, 0 when it
 * was already there). Returns 0 and creates nothing when there is no record: the layer is a no-op on legacy. Nothing per frame writes
 * `amp`, so the write holds across the gate's repaint.
 */
export function setHeightBlendVisible(owner: HasUserData, visible: boolean): number {
  const record = heightBlendOf(owner);
  if (record === undefined) return 0;
  if (!visible) {
    if (shownAmp.has(record)) return 0;
    shownAmp.set(record, record.amp);
    record.amp = 0;
    return 1;
  }
  const stash = shownAmp.get(record);
  if (stash === undefined) return 0;
  record.amp = stash;
  shownAmp.delete(record);
  return 1;
}

/**
 * The 1x1 stand-in for the field until the bake lands: slope 0, tpi 128 (0 exactly), patch 128, so the stage contributes nothing. LINEAR
 * filtered, never Nearest: WGSL bakes a texture's filterability into the first build (the P2 T3 lesson), and the real field is Linear.
 */
export function heightBlendPlaceholder(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([0, 128, 128, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.NoColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}
