/**
 * Look uplift L1 (GH-943): the scene's first environment, and the registry that
 * hands it to the material classes that may see it.
 *
 * Spec `docs/superpowers/specs/2026-11-01-look-uplift-design.md` §2. The class
 * table and its reasons are `environment-classes.ts`; this file is the sky and
 * the bookkeeping.
 *
 * THE SKY. A gradient, coloured from palette KEYS (never a raw hex): the
 * preset's own sky key overhead, its sun key at the horizon, the shared
 * ground-bounce key below. No sun disc: the directional sun already supplies
 * the sun's specular lobe, and a disc here would count it twice. No downloaded
 * asset, so no licence question, and a palette revision reaches it.
 * It is built on the CPU as a small equirectangular HalfFloat texture
 * (`skyEquirectFloats`, pure and tested) and run once through
 * `PMREMGenerator.fromEquirectangular`. Colours are LINEAR (`hexToLinear`),
 * the texture is `NoColorSpace` data, the PMREM target is linear half-float.
 *
 * THE REGISTRY. `EnvironmentRegistry` owns the PMREM texture and gives it to
 * each adopted material as `material.envMap`, with that class's
 * `envMapIntensity`. `scene.environment` is NEVER set (see
 * `environment-classes.ts`). Three things it guarantees, each pinned by
 * `environment.test.ts`:
 *
 *  - REBUILT ONLY ON A PRESET CHANGE. `setPreset` with the preset it already
 *    has does nothing. A different one repaints the PMREM INTO THE SAME render
 *    target, so the texture's identity never changes: a scar, running-gear,
 *    wounded or death-fade clone cut earlier holds the very texture the
 *    registered materials hold and sees the new sky with them. (The spec's
 *    wording was "swap the texture on registered materials, dispose the old
 *    one"; reusing the target makes the swap unnecessary and removes the
 *    dangling-clone hazard it created. The superseded equirect source is
 *    disposed each build.)
 *  - `clone()` KEEPS THE ENVMAP. `Material.copy` copies `envMap`,
 *    `envMapIntensity` and `userData` (where the class tag lives).
 *  - A MATERIAL OF A NON-RECEIVING CLASS IS STRIPPED, NOT SKIPPED. If it
 *    carried an `envMap` it loses it, so a clone memoised on a shared GLB
 *    material and reused by a flag-off renderer comes back neutral.
 *
 * Materials are held WEAKLY (a strong set would keep every mission's textures
 * alive, the leak `unit-surface.ts` documents).
 *
 * Presentation only: nothing here is read by the sim.
 */
import * as THREE from 'three';
import { ENV_USERDATA_KEY, envSpecFor, type EnvClass } from './environment-classes';
import { paletteHex } from './palette-hex';
import { TIME_OF_DAY_PRESETS, BOUNCE_KEY, type LitTimeOfDay } from './time-of-day';
import { hexToLinear } from './terrain/shared';

export type Rgb = readonly [number, number, number];

/** The three linear colours a sky is made of. */
export interface SkyColors {
  readonly zenith: Rgb;
  readonly horizon: Rgb;
  readonly ground: Rgb;
}

/** The palette key behind each of the three, per preset. */
export function skyKeysFor(preset: LitTimeOfDay): { zenith: string; horizon: string; ground: string } {
  const p = TIME_OF_DAY_PRESETS[preset];
  return { zenith: p.skyKey, horizon: p.sunKey, ground: BOUNCE_KEY };
}

/** The sky's linear colours for a preset, through `resolveHex` (the renderer's `overlayColor`) or the palette. */
export function skyColorsFor(preset: LitTimeOfDay, resolveHex: (key: string) => string = paletteHex): SkyColors {
  const k = skyKeysFor(preset);
  return {
    zenith: hexToLinear(resolveHex(k.zenith)),
    horizon: hexToLinear(resolveHex(k.horizon)),
    ground: hexToLinear(resolveHex(k.ground)),
  };
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** The sky's linear radiance looking along a direction of elevation `y` (sin of the angle above the horizon, -1..1). */
export function skyRadiance(y: number, c: SkyColors): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  if (y >= 0) {
    const t = smoothstep(0, 0.6, y);
    for (let i = 0; i < 3; i++) out[i] = c.horizon[i] + (c.zenith[i] - c.horizon[i]) * t;
  } else {
    const t = smoothstep(0, 0.15, -y);
    for (let i = 0; i < 3; i++) out[i] = c.horizon[i] + (c.ground[i] - c.horizon[i]) * t;
  }
  return out;
}

/**
 * An equirectangular RGBA float image of the sky, `width` x `height`, row 0 at
 * the bottom (a `DataTexture` has `flipY` false, so row j sits at v = (j+0.5)/h,
 * elevation `sin((v - 0.5) * pi)`). The sky is symmetric about the vertical, so
 * every texel of a row is the same.
 */
export function skyEquirectFloats(c: SkyColors, width: number, height: number): Float32Array {
  const data = new Float32Array(width * height * 4);
  for (let j = 0; j < height; j++) {
    const v = (j + 0.5) / height;
    const y = Math.sin((v - 0.5) * Math.PI);
    const [r, g, b] = skyRadiance(y, c);
    for (let i = 0; i < width; i++) {
      const o = (j * width + i) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 1;
    }
  }
  return data;
}

/** 512 x 256 equirect -> a 128-texel cube face (`PMREMGenerator` reads width / 4). */
export const SKY_WIDTH = 512;
export const SKY_HEIGHT = 256;

/** What a bake returns: the PMREM texture and a way to free it. Injectable so a GL-free test can stand in. */
export interface EnvironmentBake {
  readonly texture: THREE.Texture;
  dispose(): void;
}
export type BakeSky = (gl: THREE.WebGLRenderer, colors: SkyColors, previous: EnvironmentBake | null) => EnvironmentBake;

/**
 * GH-943 P1 (T6): what the registry is attached to on the NODE backend. There is no `WebGLRenderer` there, and the PMREM
 * generator is `three/webgpu`'s, which only the lazy node chunk may import, so the node backend hands over a host that carries
 * its own bake (`environment.node.ts`, `createNodePmremHost`). Its presence also switches the registry's toggle to intensity
 * (see `EnvironmentRegistry.setEnabled`).
 */
export interface NodePmremHost {
  readonly isNodePmremHost: true;
  readonly bake: (sky: SkyImage, previous: EnvironmentBake | null) => EnvironmentBake;
}
/**
 * The sky as the registry hands it to a node bake: the SAME `skyEquirectFloats` image the legacy bake uses, already converted to
 * half floats. The registry supplies it so the node twin imports NOTHING at runtime from this module: a module both the legacy
 * ThreeRenderer chunk and the lazy node chunk import is placed in the ThreeRenderer chunk, which a node boot must not load
 * (the bundle census refuses it).
 */
export interface SkyImage {
  readonly half: Uint16Array;
  readonly width: number;
  readonly height: number;
}
export type PmremHost = THREE.WebGLRenderer | NodePmremHost;
export function isNodePmremHost(h: PmremHost | null): h is NodePmremHost {
  return h !== null && (h as NodePmremHost).isNodePmremHost === true;
}

/** The sky image as half floats (what both the legacy and the node bake upload). */
export function skyHalfImage(colors: SkyColors): SkyImage {
  const floats = skyEquirectFloats(colors, SKY_WIDTH, SKY_HEIGHT);
  const half = new Uint16Array(floats.length);
  for (let i = 0; i < floats.length; i++) half[i] = THREE.DataUtils.toHalfFloat(floats[i]);
  return { half, width: SKY_WIDTH, height: SKY_HEIGHT };
}

/** The real bake: CPU gradient -> `fromEquirectangular`, repainting `previous`'s target when there is one. */
export const pmremBake: BakeSky = (gl, colors, previous) => {
  const { half } = skyHalfImage(colors);
  const source = new THREE.DataTexture(half, SKY_WIDTH, SKY_HEIGHT, THREE.RGBAFormat, THREE.HalfFloatType);
  source.mapping = THREE.EquirectangularReflectionMapping;
  source.colorSpace = THREE.NoColorSpace;
  source.magFilter = THREE.LinearFilter;
  source.minFilter = THREE.LinearFilter;
  source.generateMipmaps = false;
  source.needsUpdate = true;
  const reuse = previous as (EnvironmentBake & { target?: THREE.WebGLRenderTarget; pmrem?: THREE.PMREMGenerator }) | null;
  const pmrem = reuse?.pmrem ?? new THREE.PMREMGenerator(gl);
  const target = pmrem.fromEquirectangular(source, reuse?.target ?? null);
  source.dispose();
  return {
    texture: target.texture,
    target,
    pmrem,
    dispose() {
      target.dispose();
      pmrem.dispose();
    },
  } as EnvironmentBake;
};

/**
 * The registry. One per `ThreeRenderer`, built in its constructor (no GL), given
 * a `WebGLRenderer` by `attach` in `init()` (the PMREM needs one). Materials
 * adopted before `attach` are held and receive the texture when it exists.
 */
export class EnvironmentRegistry {
  private preset: LitTimeOfDay;
  private bake: EnvironmentBake | null = null;
  private gl: PmremHost | null = null;
  private readonly live = new Set<WeakRef<THREE.MeshStandardMaterial>>();
  /** Each registered material's class, resolved once at adoption (its tag, else the template's fallback). */
  private readonly classOf = new WeakMap<THREE.Material, EnvClass>();
  private enabled = true;
  private disposed = false;
  /** How many times the sky has been painted (the test seam: "rebuilt only on a preset change"). */
  builds = 0;

  constructor(
    preset: LitTimeOfDay,
    private readonly resolveHex: (key: string) => string = paletteHex,
    private readonly bakeSky: BakeSky = pmremBake
  ) {
    this.preset = preset;
  }

  get currentPreset(): LitTimeOfDay {
    return this.preset;
  }

  /** The shared PMREM texture, or null before `attach`. */
  get texture(): THREE.Texture | null {
    return this.bake?.texture ?? null;
  }

  /** Give the registry its GL context and paint the sky. Idempotent. */
  attach(gl: PmremHost): void {
    if (this.disposed || this.gl !== null) return;
    this.gl = gl;
    this.paint();
    this.reapply();
  }

  /**
   * The debug layer: false strips the environment from every registered
   * material (the frame is then lit by the hemisphere alone), true puts it back.
   * On the NODE backend it zeroes `envMapIntensity` and keeps the `envMap`: a
   * null/non-null flip changes the material's node program and would rebuild it,
   * an intensity is a uniform (GH-943 P1 T6).
   * Returns how many live materials it wrote.
   */
  setEnabled(on: boolean): number {
    this.enabled = on;
    return this.reapply();
  }

  /**
   * A different preset repaints the sky into the same target; the same preset
   * does nothing. Returns whether it repainted.
   */
  setPreset(preset: LitTimeOfDay): boolean {
    if (this.disposed || preset === this.preset) return false;
    this.preset = preset;
    if (this.gl !== null) this.paint();
    return this.gl !== null;
  }

  private paint(): void {
    if (this.gl === null) return;
    const colors = skyColorsFor(this.preset, this.resolveHex);
    this.bake = isNodePmremHost(this.gl) ? this.gl.bake(skyHalfImage(colors), this.bake) : this.bakeSky(this.gl, colors, this.bake);
    this.builds++;
  }

  /**
   * Adopt a template's materials. A material's class is its own tag
   * (`userData[ENV_USERDATA_KEY]`, written by its producer), else `fallback`.
   * Returns how many it gave an `envMap`.
   */
  adopt(materials: Iterable<THREE.Material>, fallback: EnvClass): number {
    if (this.disposed) return 0;
    let n = 0;
    for (const m of materials) {
      const std = m as THREE.MeshStandardMaterial;
      if (!std.isMeshStandardMaterial) continue;
      const tag = (std.userData as Record<string, unknown> | undefined)?.[ENV_USERDATA_KEY];
      const cls = typeof tag === 'string' ? tag : fallback;
      envSpecFor(cls); // an unknown class throws here, at the producer's door
      if (!this.classOf.has(std)) this.live.add(new WeakRef(std));
      this.classOf.set(std, cls as EnvClass);
      if (this.assign(std)) n++;
    }
    return n;
  }

  private assign(m: THREE.MeshStandardMaterial): boolean {
    const cls = this.classOf.get(m);
    if (cls === undefined) return false;
    const spec = envSpecFor(cls);
    // Node backend: the toggle is an intensity, never a null envMap (a program rebuild).
    const byIntensity = isNodePmremHost(this.gl);
    const tex = this.enabled || byIntensity ? this.texture : null;
    if (spec.receives && tex !== null) {
      if (m.envMap !== tex) {
        m.envMap = tex;
        m.needsUpdate = true;
      }
      m.envMapIntensity = this.enabled ? spec.intensity : 0;
      return true;
    }
    if (m.envMap !== null) {
      m.envMap = null;
      m.needsUpdate = true;
    }
    return false;
  }

  /** Re-run `assign` over every live material. Returns how many it touched. */
  private reapply(): number {
    let n = 0;
    for (const ref of [...this.live]) {
      const m = ref.deref();
      if (!m) {
        this.live.delete(ref);
        continue;
      }
      this.assign(m);
      n++;
    }
    return n;
  }

  /** The number of registered materials that currently carry the texture (test seam). */
  carriers(): number {
    let n = 0;
    const tex = this.texture;
    for (const ref of this.live) {
      const m = ref.deref();
      if (m && tex !== null && m.envMap === tex) n++;
    }
    return n;
  }

  /**
   * Live registered materials by resolved class: how many are registered and how
   * many currently carry the texture. The census the mock's probe reads, so a
   * class that must carry nothing (`ground`, `decal`, ...) can be seen to.
   */
  classCensus(): Record<string, { registered: number; carrying: number }> {
    const out: Record<string, { registered: number; carrying: number }> = {};
    const tex = this.texture;
    for (const ref of this.live) {
      const m = ref.deref();
      const cls = m ? this.classOf.get(m) : undefined;
      if (!m || cls === undefined) continue;
      const row = (out[cls] ??= { registered: 0, carrying: 0 });
      row.registered++;
      if (tex !== null && m.envMap === tex) row.carrying++;
    }
    return out;
  }

  /** Strip every registered material, free the texture. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const ref of this.live) {
      const m = ref.deref();
      if (m && m.envMap !== null) {
        m.envMap = null;
        m.needsUpdate = true;
      }
    }
    this.live.clear();
    this.bake?.dispose();
    this.bake = null;
  }
}
