/**
 * Defilade T4 (GH-705), Task 4: a GPU-instanced, GPU-aged billboard flipbook
 * for explosions, dirt kick-ups and smoke.
 *
 * One `InstancedBufferGeometry` drawn by TWO meshes with two copies of one
 * program: `mesh` (smoke and dirt, depth-tested, band 5) and `fireMesh`
 * (fire, `depthTest: false`, band 5.5 -- a fireball engulfs the hull it came
 * from). Each instance carries its own start time, duration, scale, type,
 * seed and tint; the vertex shader ages it off ONE uniform clock (the frame
 * clock the explosion-burst mesh already steps on, so hit-stop freezes it),
 * and an instance of the other pass's type is collapsed off-screen there. A
 * live puff costs the CPU nothing after spawn: `push` uploads only the slot
 * it wrote (`addUpdateRange`), never the 2048-slot buffers.
 *
 * Types:
 *   0 FIRE  -- dual-phase colour curve: HDR white_hot/fire x
 *              `HDR_GAINS.fireball` for the first ~16% of its life, through
 *              ember, to soot (`shadow.0`) and grey smoke (`gunmetal.1`).
 *   1 SMOKE -- lit soot -> grey (or, by its tint, dust), drifting, lingering.
 *   2 DIRT  -- ballistic kick-up in the ground's own dust tones, lit.
 *
 * The billow itself is SAMPLED, not computed: FIRE reads
 * `assets/textures/vfx/flipbook_fire.png`, SMOKE and DIRT read
 * `flipbook_smoke.png` (Task 3, `tools/vfx/bake_flipbook_atlases.py`). Each is
 * an 8x8 atlas of 128 px frames, frame k at life k/63, row 0 at the TOP of the
 * image. Channels are DATA, not colour: R density, G/B the density gradient
 * (`(GB*2-1)*4` per unit of frame half-width, +B up), A heat for fire. So the
 * textures load `NoColorSpace` with `premultiplyAlpha` off (a premultiply
 * would zero R/G/B wherever A is 0, which is most of smoke's rim and every
 * fire frame past t~0.45). The billow is drawn inside the inner `ATLAS_FIT`
 * (0.85) of each frame with an 8 px empty margin, so the quad is scaled by
 * 1/ATLAS_FIT to keep the mock's on-screen size and the margin keeps mips
 * 0-3 from bleeding between frames. Until both atlases are in, a spawn is
 * accepted (it ages like any other) but nothing draws: no fallback billow.
 *
 * Authored colours are palette keys resolved to linear (`setColors`); the
 * fire phase is that colour times `HDR_GAINS.fireball` (the one gain table,
 * `hdr-gains.ts`), which is what lets it cross the bloom threshold. Smoke and
 * dirt are multiplied by `hazeRadiance` of the active light preset
 * (`setLighting`), so they sit at lit ground's scene-referred level and never
 * reach it. Each quad is lifted by 0.32 of its size so a puff stands ON the
 * ground rather than cutting into it (D10: soft ground intersection deferred).
 *
 * IDLE COSTS 0 DRAW CALLS, PER PASS. Each mesh keeps the latest expiry ever
 * spawned of its own types (`fireLiveUntilMs`, `smokeLiveUntilMs`); once the
 * clock passes it that mesh goes `visible = false`, and a spawn of its types
 * makes it visible again -- so a kill's fire mesh stops drawing when its last
 * cook-off is out, while the soot column's mesh draws on. `visible` is DERIVED -- atlases in, not debug-hidden,
 * something live -- in one place (`syncVisible`), so the `flipbook` debug
 * layer is a flag that derivation consults rather than a `visible` write the
 * next `step` would re-assert (the `unitsDebugHidden` lesson,
 * `../debug-layers.ts`).
 *
 * RECIPES ARE DATA (Task 5): an emitter's `flipbook` array in
 * `data/vfx/*.json` (`shell_impact`, `missile_impact`, `catastrophic_kill`,
 * `fire_apfsds`, `fire_heat`), interpreted by `spawnRecipe`. Their numbers
 * are the mock's (`mock/defilade-t4` @ `1bd2814b`) verbatim at D3/D4 = 1x,
 * pinned by `flipbook-fx.test.ts` against a literal transcription of it.
 */
import * as THREE from 'three';
import { COLLAPSE_FLASH_RENDER_ORDER, SMOKE_RENDER_ORDER } from './render-order';
import { HDR_GAINS } from './hdr-gains';
import type { FlipbookLayerSpec } from '../../vfx/emitters';

export const FLIPBOOK_CAPACITY = 2048;
export const FLIP_FIRE = 0;
export const FLIP_SMOKE = 1;
export const FLIP_DIRT = 2;
/** Frames per atlas side; the atlas holds `FLIPBOOK_GRID ** 2` frames. */
export const FLIPBOOK_GRID = 8;
/** The fraction of a frame's half-width the baked billow is fitted to (Task 3). */
export const ATLAS_FIT = 0.85;
/** Smoke alpha (D3, 1x). */
export const FLIPBOOK_SMOKE_ALPHA = 0.85;
/** The xorshift32 state a fresh `FlipbookFx` starts from. */
export const FLIPBOOK_RNG_SEED = 0x9e3779b9;

const FLIP_TYPE: Readonly<Record<FlipbookLayerSpec['type'], number>> = Object.freeze({
  fire: FLIP_FIRE,
  smoke: FLIP_SMOKE,
  dirt: FLIP_DIRT,
});

const VERT = /* glsl */ `
  attribute vec3 aOrigin;
  attribute vec3 aVel;
  attribute vec4 aParams; // start ms, duration ms, scale (tiles), type
  attribute float aSeed;
  attribute float aTint;
  uniform float uTime;
  uniform float uFirePass;
  uniform float uQuadScale;
  varying float vTint;
  varying vec2 vUv;
  varying float vT;
  varying float vType;
  varying float vSeed;
  void main() {
    float ageMs = uTime - aParams.x;
    float t = ageMs / aParams.y;
    if (t < 0.0 || t > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float age = ageMs / 1000.0;
    float type = aParams.w;
    if ((uFirePass > 0.5) != (type < 0.5)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec3 p = aOrigin;
    float size;
    if (type < 0.5) {
      float grow = 1.0 - pow(1.0 - min(t * 4.0, 1.0), 3.0);
      size = aParams.z * (0.6 + 0.6 * grow + 0.5 * t);
      p += aVel * (1.0 - exp(-age * 4.0)) / 4.0 + vec3(0.0, 0.45 * age, 0.0);
    } else if (type < 1.5) {
      size = aParams.z * (0.55 + 1.3 * sqrt(t));
      p += aVel * (1.0 - exp(-age * 1.2)) / 1.2 + vec3(0.10, 0.22, 0.04) * age;
    } else {
      size = aParams.z * (0.45 + 0.9 * sqrt(t));
      p += aVel * age + vec3(0.0, -4.9 * age * age, 0.0);
      p.y = max(p.y, aOrigin.y);
    }
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec2 c = position.xy;
    // The quad is the whole frame, 1/ATLAS_FIT of the billow; the lift is
    // of the billow's own size, as in the mock.
    vec3 world = p + (right * c.x + up * c.y) * size * uQuadScale + up * size * 0.32;
    vUv = c * 2.0;
    vT = t;
    vType = type;
    vSeed = aSeed;
    vTint = aTint;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uFireAtlas;
  uniform sampler2D uSmokeAtlas;
  uniform vec3 uHot;
  uniform vec3 uFire;
  uniform vec3 uEmber;
  uniform vec3 uSoot;
  uniform vec3 uSmoke;
  uniform vec3 uDirt;
  uniform vec3 uDirtDark;
  uniform float uFireGain;
  uniform float uLight;
  uniform float uSmokeAlpha;
  uniform vec2 uSun;
  varying vec2 vUv;
  varying float vT;
  varying float vType;
  varying float vSeed;
  varying float vTint;

  const float GRID = ${FLIPBOOK_GRID.toFixed(1)};
  const float LAST = ${(FLIPBOOK_GRID * FLIPBOOK_GRID - 1).toFixed(1)};

  // Frame k's cell, row 0 at the TOP of the image: with flipY the image's top
  // row is v = 1, so the row index is inverted.
  vec4 frameSample(sampler2D atlas, float k, vec2 local) {
    float col = mod(k, GRID);
    float row = floor(k / GRID);
    vec2 uv = (vec2(col, GRID - 1.0 - row) + local) / GRID;
    return texture2D(atlas, uv);
  }

  void main() {
    // The circle of radius 1 (in frame half-widths) survives any rotation
    // inside its own frame, so a rotated corner never samples a neighbour.
    if (dot(vUv, vUv) > 1.0) discard;
    float ang = vSeed * 6.2831853;
    float cs = cos(ang);
    float sn = sin(ang);
    // Per-instance rotation about the frame's centre.
    vec2 a = vec2(cs * vUv.x - sn * vUv.y, sn * vUv.x + cs * vUv.y);
    vec2 local = a * 0.5 + 0.5;
    float f = clamp(vT, 0.0, 1.0) * LAST;
    float k0 = floor(f);
    float k1 = min(k0 + 1.0, LAST);
    float w = f - k0;
    vec4 s;
    if (vType < 0.5) {
      s = mix(frameSample(uFireAtlas, k0, local), frameSample(uFireAtlas, k1, local), w);
    } else {
      s = mix(frameSample(uSmokeAtlas, k0, local), frameSample(uSmokeAtlas, k1, local), w);
    }
    float density = s.r;
    if (density < 0.01) discard;
    // The baked gradient is in the atlas frame; the screen sees the frame
    // rotated by ang, so the screen-space gradient is its inverse rotation.
    vec2 ga = (s.gb * 2.0 - 1.0) * 4.0;
    vec2 g = vec2(cs * ga.x + sn * ga.y, -sn * ga.x + cs * ga.y);
    // Denser toward the sun is self-shadowed; the rim facing it is lit.
    float shade = clamp(0.85 - 0.12 * dot(g, uSun) + 0.30 * dot(vUv, uSun), 0.45, 1.3);
    vec3 col;
    float alpha;
    if (vType < 0.5) {
      float heat = clamp(1.0 - vT / 0.16, 0.0, 1.0);
      float core = s.a;
      vec3 hot = mix(uFire, uHot, pow(core * heat, 4.0)) * uFireGain * (0.35 + 0.65 * core);
      vec3 ember = uEmber * (1.0 + 1.2 * core);
      vec3 fire = mix(ember, hot, heat);
      vec3 smoke = mix(uSoot, uSmoke, smoothstep(0.5, 1.0, vT)) * uLight * shade;
      // Embers survive a little longer in the hot core of the soot.
      float cool = smoothstep(0.10, 0.42, vT - 0.10 * core);
      col = mix(fire, smoke, cool);
      alpha = density * (1.0 - smoothstep(0.55, 1.0, vT));
    } else if (vType < 1.5) {
      vec3 soot = mix(uSoot, uSmoke, smoothstep(0.1, 1.0, vT));
      vec3 dusty = mix(uDirtDark, uDirt, smoothstep(0.0, 0.75, vT)) * 0.85;
      col = mix(soot, dusty, vTint) * uLight * shade;
      alpha = density * uSmokeAlpha * smoothstep(0.0, 0.06, vT) * (1.0 - smoothstep(0.40, 1.0, vT));
    } else {
      col = mix(uDirtDark, uDirt, smoothstep(0.0, 0.6, vT)) * uLight * shade;
      alpha = density * 0.95 * (1.0 - smoothstep(0.45, 1.0, vT));
    }
    gl_FragColor = vec4(col, alpha);
  }
`;

/** Palette keys for every colour the flipbook draws (resolved to linear). */
export interface FlipbookColors {
  hot: string;
  fire: string;
  ember: string;
  soot: string;
  smoke: string;
  dirt: string;
  dirtDark: string;
}

export const FLIPBOOK_COLOR_KEYS: Readonly<FlipbookColors> = Object.freeze({
  hot: 'vfx.white_hot',
  fire: 'vfx.fire',
  ember: 'vfx.ember',
  soot: 'shadow.0',
  smoke: 'gunmetal.1',
  dirt: 'dust.2',
  dirtDark: 'dust.5',
});

/** One instance, in world units (x east, y up, z south) and milliseconds. */
export interface FlipbookSpawn {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  /** Start this long after now. */
  delayMs?: number;
  durationMs: number;
  /** Billow size, in world units. */
  scale: number;
  type: typeof FLIP_FIRE | typeof FLIP_SMOKE | typeof FLIP_DIRT;
  /** SMOKE only: 0 soot, 1 dust. */
  tint?: number;
}

/** Prepares an atlas as DATA: no colour decode, no premultiply, clamped,
 *  mipmapped, and flipped on upload -- the fragment shader's row inversion
 *  (`GRID - 1 - row`) assumes the image's top row lands at v = 1, so `flipY`
 *  is set here rather than inherited from whichever loader made the texture
 *  (`ImageBitmapLoader`'s bitmaps ignore it). */
export function prepareFlipbookAtlas(tex: THREE.Texture): THREE.Texture {
  tex.colorSpace = THREE.NoColorSpace;
  tex.flipY = true;
  tex.premultiplyAlpha = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

type FlipbookMesh = THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;

export class FlipbookFx {
  /** Smoke and dirt: depth-tested, so a building in front hides them. */
  readonly mesh: FlipbookMesh;
  /** Fire: the same instances, not depth-tested -- a fireball engulfs the hull it came from. */
  readonly fireMesh: FlipbookMesh;
  private readonly origin: THREE.InstancedBufferAttribute;
  private readonly vel: THREE.InstancedBufferAttribute;
  private readonly params: THREE.InstancedBufferAttribute;
  private readonly seed: THREE.InstancedBufferAttribute;
  private readonly tint: THREE.InstancedBufferAttribute;
  private head = 0;
  private written = 0;
  private timeMs = 0;
  /** The latest `start + duration` ever spawned, PER PASS: fire for
   *  `fireMesh`, smoke and dirt for `mesh`. Each mesh's live window ends on
   *  its own, so a kill's fire mesh stops drawing once its last fireball is
   *  out even while the 9 s column lives on. */
  private fireLiveUntilMs = -Infinity;
  private smokeLiveUntilMs = -Infinity;
  private rngState = FLIPBOOK_RNG_SEED;
  private readonly capacity: number;
  private debugHidden = false;
  private atlases: { fire: THREE.Texture; smoke: THREE.Texture } | null = null;
  private disposed = false;

  constructor(capacity = FLIPBOOK_CAPACITY) {
    this.capacity = capacity;
    const geometry = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.getAttribute('position'));
    this.origin = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.vel = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.params = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    // Start every slot long dead.
    for (let i = 0; i < capacity; i++) {
      this.params.array[i * 4] = -1e9;
      this.params.array[i * 4 + 1] = 1;
    }
    this.seed = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    for (const a of [this.origin, this.vel, this.params, this.seed, this.tint]) a.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aOrigin', this.origin);
    geometry.setAttribute('aVel', this.vel);
    geometry.setAttribute('aParams', this.params);
    geometry.setAttribute('aSeed', this.seed);
    geometry.setAttribute('aTint', this.tint);
    geometry.instanceCount = 0;
    const uniforms = (firePass: number): Record<string, THREE.IUniform> => ({
      uTime: { value: 0 },
      uFirePass: { value: firePass },
      uQuadScale: { value: 1 / ATLAS_FIT },
      uFireAtlas: { value: null },
      uSmokeAtlas: { value: null },
      uHot: { value: new THREE.Color(1, 1, 1) },
      uFire: { value: new THREE.Color(1, 0.6, 0.2) },
      uEmber: { value: new THREE.Color(0.8, 0.1, 0.02) },
      uSoot: { value: new THREE.Color(0.03, 0.03, 0.03) },
      uSmoke: { value: new THREE.Color(0.3, 0.3, 0.3) },
      uDirt: { value: new THREE.Color(0.5, 0.4, 0.3) },
      uDirtDark: { value: new THREE.Color(0.3, 0.25, 0.2) },
      uFireGain: { value: HDR_GAINS.fireball },
      uLight: { value: 1 },
      uSmokeAlpha: { value: FLIPBOOK_SMOKE_ALPHA },
      uSun: { value: new THREE.Vector2(-0.7, 0.7) },
    });
    const material = (firePass: number): THREE.ShaderMaterial =>
      new THREE.ShaderMaterial({
        uniforms: uniforms(firePass),
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthTest: firePass === 0,
        depthWrite: false,
        blending: THREE.NormalBlending,
      });
    this.mesh = new THREE.Mesh(geometry, material(0));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = SMOKE_RENDER_ORDER;
    this.mesh.name = 'flipbook-smoke';
    this.fireMesh = new THREE.Mesh(geometry, material(1));
    this.fireMesh.frustumCulled = false;
    this.fireMesh.renderOrder = COLLAPSE_FLASH_RENDER_ORDER;
    this.fireMesh.name = 'flipbook-fire';
    this.syncVisible();
  }

  /** Both meshes, for the caller's scene. */
  get meshes(): readonly [FlipbookMesh, FlipbookMesh] {
    return [this.mesh, this.fireMesh];
  }

  /** True once both atlases are bound. */
  get ready(): boolean {
    return this.atlases !== null;
  }

  setColors(resolveLinear: (key: string) => THREE.Color, c: FlipbookColors = FLIPBOOK_COLOR_KEYS): void {
    for (const u of [this.mesh.material.uniforms, this.fireMesh.material.uniforms]) {
      (u.uHot.value as THREE.Color).copy(resolveLinear(c.hot));
      (u.uFire.value as THREE.Color).copy(resolveLinear(c.fire));
      (u.uEmber.value as THREE.Color).copy(resolveLinear(c.ember));
      (u.uSoot.value as THREE.Color).copy(resolveLinear(c.soot));
      (u.uSmoke.value as THREE.Color).copy(resolveLinear(c.smoke));
      (u.uDirt.value as THREE.Color).copy(resolveLinear(c.dirt));
      (u.uDirtDark.value as THREE.Color).copy(resolveLinear(c.dirtDark));
    }
  }

  /** `radiance`: `hazeRadiance` of the active lights. `sunScreen`: the sun's
   *  direction projected on the camera's right/up axes, normalised. */
  setLighting(radiance: number, sunScreen: THREE.Vector2): void {
    for (const u of [this.mesh.material.uniforms, this.fireMesh.material.uniforms]) {
      u.uLight.value = radiance;
      (u.uSun.value as THREE.Vector2).copy(sunScreen);
    }
  }

  /** Binds both atlases (already prepared, or prepared here) and lets the
   *  meshes draw. */
  setAtlases(fire: THREE.Texture, smoke: THREE.Texture): void {
    if (this.disposed) return;
    prepareFlipbookAtlas(fire);
    prepareFlipbookAtlas(smoke);
    this.atlases = { fire, smoke };
    for (const u of [this.mesh.material.uniforms, this.fireMesh.material.uniforms]) {
      u.uFireAtlas.value = fire;
      u.uSmokeAtlas.value = smoke;
    }
    this.syncVisible();
  }

  /** Fetches both atlases. Fail-soft: a missing one leaves the flipbook
   *  drawing nothing, with a warning naming the URL. Resolves either way. */
  load(fireUrl: string, smokeUrl: string): Promise<void> {
    const loader = new THREE.TextureLoader();
    const one = (url: string): Promise<THREE.Texture | null> =>
      new Promise((resolve) => {
        loader.load(
          url,
          (tex) => resolve(tex),
          undefined,
          () => {
            console.warn(`[lions] flipbook atlas ${url} failed to load; explosions and smoke draw no billows`);
            resolve(null);
          }
        );
      });
    return Promise.all([one(fireUrl), one(smokeUrl)]).then(([fire, smoke]) => {
      if (fire && smoke && !this.disposed) this.setAtlases(fire, smoke);
      else {
        fire?.dispose();
        smoke?.dispose();
      }
    });
  }

  /** The `flipbook` debug layer: a flag `syncVisible` consults, so a
   *  zero-time `step` cannot re-assert the meshes. Returns 2, the meshes. */
  setDebugHidden(hidden: boolean): number {
    this.debugHidden = hidden;
    this.syncVisible();
    return 2;
  }

  /** Slots still inside their life. Scans every slot: tests and debugging
   *  only, never the frame path. */
  get liveCount(): number {
    let n = 0;
    const a = this.params.array as Float32Array;
    for (let i = 0; i < Math.min(this.written, this.capacity); i++) {
      const age = this.timeMs - a[i * 4];
      if (age >= 0 && age <= a[i * 4 + 1]) n++;
    }
    return n;
  }

  /** The frame clock now, in ms. */
  get nowMs(): number {
    return this.timeMs;
  }

  step(dtMs: number): void {
    this.timeMs += dtMs;
    this.mesh.material.uniforms.uTime.value = this.timeMs;
    this.fireMesh.material.uniforms.uTime.value = this.timeMs;
    this.syncVisible();
  }

  /** Restarts the presentation RNG (tests). */
  reseed(state: number): void {
    this.rngState = state >>> 0 || FLIPBOOK_RNG_SEED;
  }

  /** One instance. */
  spawn(o: FlipbookSpawn): void {
    this.push(o.x, o.y, o.z, o.vx ?? 0, o.vy ?? 0, o.vz ?? 0, o.delayMs ?? 0, o.durationMs, o.scale, o.type, o.tint ?? 0);
  }

  private syncVisible(): void {
    const can = this.atlases !== null && !this.debugHidden;
    this.mesh.visible = can && this.timeMs <= this.smokeLiveUntilMs;
    this.fireMesh.visible = can && this.timeMs <= this.fireLiveUntilMs;
  }

  private rand(): number {
    // xorshift32: presentation only, never the sim.
    let x = this.rngState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rngState = x >>> 0;
    return this.rngState / 4294967296;
  }

  private push(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    delayMs: number, durMs: number, scale: number, type: number, tint = 0
  ): void {
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    this.written++;
    const o = this.origin.array as Float32Array;
    o[i * 3] = x; o[i * 3 + 1] = y; o[i * 3 + 2] = z;
    const v = this.vel.array as Float32Array;
    v[i * 3] = vx; v[i * 3 + 1] = vy; v[i * 3 + 2] = vz;
    const p = this.params.array as Float32Array;
    const start = this.timeMs + delayMs;
    p[i * 4] = start; p[i * 4 + 1] = durMs; p[i * 4 + 2] = scale; p[i * 4 + 3] = type;
    (this.seed.array as Float32Array)[i] = this.rand();
    (this.tint.array as Float32Array)[i] = tint;
    // Upload only the touched slot.
    for (const [attr, size] of [[this.origin, 3], [this.vel, 3], [this.params, 4], [this.seed, 1], [this.tint, 1]] as const) {
      attr.addUpdateRange(i * size, size);
      attr.needsUpdate = true;
    }
    this.mesh.geometry.instanceCount = Math.min(this.written, this.capacity);
    const end = start + durMs;
    if (type === FLIP_FIRE) {
      if (end > this.fireLiveUntilMs) this.fireLiveUntilMs = end;
    } else if (end > this.smokeLiveUntilMs) this.smokeLiveUntilMs = end;
    this.syncVisible();
  }

  /**
   * Spawns a recipe authored as an emitter's `flipbook` array
   * (`vfx_emitter.schema.json`'s `flipbook_layer`), at origin (x, h, z) in
   * world units, at `power`, with the bore along `dirRad` (x = cos, z = sin)
   * and the ground at `groundH` for an `at_ground` layer. The numbers live in
   * `data/vfx/*.json`; this is the one interpreter. Returns the instance count.
   */
  spawnRecipe(
    layers: readonly FlipbookLayerSpec[],
    x: number, h: number, z: number, power: number,
    dirRad = 0, groundH = h
  ): number {
    const dx = Math.cos(dirRad);
    const dz = Math.sin(dirRad);
    const between = (r: readonly [number, number]): number => (r[0] === r[1] ? r[0] : r[0] + (r[1] - r[0]) * this.rand());
    const first = layers[0];
    const fireball = first ? first.scale.base + (first.scale.per_power ?? 0) * power : 0;
    let n = 0;
    for (const L of layers) {
      const type = FLIP_TYPE[L.type];
      if (type === undefined) continue;
      const off = L.offset ?? {};
      const v = L.velocity;
      const y0 = (L.at_ground ? groundH : h) + (off.up ?? 0);
      for (let k = 0; k < L.count; k++) {
        const a = v.ring
          ? (k / L.count) * Math.PI * 2 + (v.ring_jitter_rad ? this.rand() * v.ring_jitter_rad : 0)
          : this.rand() * Math.PI * 2;
        const radial = between(v.radial);
        const along = v.along_bore ? between(v.along_bore) : 0;
        const up = between(v.up);
        const bore = (off.along_bore ?? 0) + (off.along_bore_per_index ?? 0) * k;
        let px = x + dx * bore;
        let pz = z + dz * bore;
        if (off.scatter) {
          px += (this.rand() - 0.5) * off.scatter;
          pz += (this.rand() - 0.5) * off.scatter;
        }
        const s = L.scale;
        let scale = s.base + (s.per_power ?? 0) * power + (s.per_index_power ?? 0) * k * power + (s.rand ? s.rand * this.rand() : 0);
        if (L.scale_from === 'fireball') scale *= fireball;
        this.push(
          px, y0, pz,
          Math.cos(a) * radial + dx * along, up, Math.sin(a) * radial + dz * along,
          L.delay_ms[0] + L.delay_ms[1] * k, between(L.duration_ms), scale, type, L.tint ?? 0
        );
        n++;
      }
    }
    return n;
  }

  dispose(): void {
    this.disposed = true;
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.fireMesh.material.dispose();
    this.atlases?.fire.dispose();
    this.atlases?.smoke.dispose();
    this.atlases = null;
    this.syncVisible();
  }
}
