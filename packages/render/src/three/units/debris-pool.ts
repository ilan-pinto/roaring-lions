/**
 * GH-1197 P2: the debris pool -- terrain clods and chunks thrown by a landing.
 *
 * Three shared procedural shapes, built here in code (slab 12 triangles, block
 * 20, shard 8), one `InstancedMesh` each, so the pool costs three draws in the
 * colour pass (and three in the shadow pass on `high`) however many pieces fly.
 * The material is the world's own `MeshStandardMaterial`, lit, shadowed, with
 * the piece's colour as a LINEAR instance colour (`hexToLinear` of a palette
 * key, `debris-tone.ts`).
 *
 * GPU-AGED, like the flipbook: the CPU writes a slot once, at spawn -- the
 * closed-form plan (`debris-flight.ts`) as instance attributes, and the REST
 * pose as the instance matrix -- and the vertex shader evaluates the flight
 * from the frame clock (`uDebTime`, the FX clock: hit-stop freezes debris
 * mid-air) and the fade from the SIM clock (`uDebSimMs`: settled debris
 * shrinks into the ground 90 s after it landed, the lead's ruling 4). A
 * capture therefore reproduces: nothing integrates frame by frame.
 *
 * The flight is an `onBeforeCompile` hook (program key `rl-debris`), applied to
 * the depth material too so the shadow follows the piece. The node backend has
 * no twin for it yet: it draws the stock material, which reads the instance
 * matrix, so there a piece appears at rest with no flight and no fade.
 *
 * Budget (the design's debris cost table): `capacity` pieces in all, a third
 * per shape, so `high`'s 1024 submit at most 342 x (12 + 20 + 8) = 13,680
 * triangles a pass, `medium`'s 512 half that, and `low` builds no pool at all.
 * A full pool never steals a live piece: a landing throws only what fits in
 * the slots whose fade has finished.
 *
 * Opaque world geometry: `WORLD_RENDER_ORDER`, kept out of the AO pre-pass
 * (`userData.rlAoExempt`). Presentation only.
 */
import * as THREE from 'three';
import {
  DEBRIS_FADE_MS,
  DEBRIS_FADE_START_MS,
  DEBRIS_GRAVITY,
  DEBRIS_REST_HEIGHT_FRACTION,
  type DebrisPlan,
} from './debris-flight';
import { WORLD_RENDER_ORDER } from './render-order';
import type { DebrisQuality } from '../../quality';

/** The three shapes: name, triangles. */
export const DEBRIS_SHAPES = ['slab', 'block', 'shard'] as const;
export type DebrisShape = (typeof DEBRIS_SHAPES)[number];
export const DEBRIS_SHAPE_TRIANGLES: Readonly<Record<DebrisShape, number>> = { slab: 12, block: 20, shard: 8 };
/** The material's roughness: dry soil and broken stone. */
export const DEBRIS_ROUGHNESS = 0.92;
export const DEBRIS_PROGRAM_KEY = 'rl-debris';

/** A shape at unit size: its largest extent 1, its height `DEBRIS_REST_HEIGHT_FRACTION`, resting on its thin axis. */
export function debrisGeometry(shape: DebrisShape): THREE.BufferGeometry {
  const h = DEBRIS_REST_HEIGHT_FRACTION;
  let g: THREE.BufferGeometry;
  if (shape === 'slab') {
    g = new THREE.BoxGeometry(1, h, 0.62);
  } else if (shape === 'block') {
    g = new THREE.IcosahedronGeometry(0.5, 0);
    g.computeBoundingBox();
    const b = g.boundingBox!;
    g.scale(1 / (b.max.x - b.min.x), h / (b.max.y - b.min.y), 0.8 / (b.max.z - b.min.z));
  } else {
    g = new THREE.OctahedronGeometry(0.5, 0);
    g.scale(1, h, 0.45);
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Triangles a geometry submits. */
export function triangleCount(g: THREE.BufferGeometry): number {
  return (g.index ? g.index.count : g.getAttribute('position').count) / 3;
}


/** Per-slot capacity of each shape's mesh. */
export function perShapeCapacity(pool: number): number {
  return Math.ceil(pool / DEBRIS_SHAPES.length);
}

const PARS = /* glsl */ `
attribute vec4 aDebT;
attribute vec4 aDebP0;
attribute vec3 aDebV0;
attribute vec3 aDebP1;
attribute vec3 aDebV1;
attribute vec3 aDebP2;
attribute vec4 aDebSpin;
uniform float uDebTime;
uniform float uDebSimMs;
vec3 rlDebrisOffset;
mat3 rlDebrisSpin;
float rlDebrisScale;
mat3 rlDebrisRot(vec3 a, float t) {
  float c = cos(t);
  float s = sin(t);
  float k = 1.0 - c;
  return mat3(
    c + a.x * a.x * k, a.y * a.x * k + a.z * s, a.z * a.x * k - a.y * s,
    a.x * a.y * k - a.z * s, c + a.y * a.y * k, a.z * a.y * k + a.x * s,
    a.x * a.z * k + a.y * s, a.y * a.z * k - a.x * s, c + a.z * a.z * k
  );
}
void rlDebrisPrep() {
  float g = ${DEBRIS_GRAVITY.toFixed(4)};
  float ms = uDebTime - aDebT.x;
  vec3 rest = vec3(instanceMatrix[3]);
  vec3 pos = rest;
  if (ms < aDebT.y) {
    float t = max(ms, 0.0) / 1000.0;
    pos = aDebP0.xyz + aDebV0 * t + vec3(0.0, -0.5 * g * t * t, 0.0);
  } else if (ms < aDebT.z) {
    float tb = (aDebT.z - aDebT.y) / 1000.0;
    float t = (ms - aDebT.y) / 1000.0;
    float f = tb > 0.0 ? t / tb : 1.0;
    pos = aDebP1 + aDebV1 * t + vec3(0.0, -0.5 * g * t * t + (aDebP2.y - aDebP1.y) * f, 0.0);
  } else if (ms < aDebT.w) {
    float ts = aDebT.w - aDebT.z;
    float f = ts > 0.0 ? (ms - aDebT.z) / ts : 1.0;
    float e = 1.0 - (1.0 - f) * (1.0 - f);
    pos = vec3(mix(aDebP2.x, rest.x, e), mix(aDebP2.y, rest.y, f), mix(aDebP2.z, rest.z, e));
  }
  float spin = ms >= aDebT.z ? 0.0 : aDebSpin.w * (aDebT.z - max(ms, 0.0)) / 1000.0;
  rlDebrisSpin = rlDebrisRot(aDebSpin.xyz, spin);
  float fade = clamp((uDebSimMs - aDebP0.w - ${DEBRIS_FADE_START_MS.toFixed(1)}) / ${DEBRIS_FADE_MS.toFixed(1)}, 0.0, 1.0);
  rlDebrisScale = 1.0 - fade * fade * (3.0 - 2.0 * fade);
  float size = length(vec3(instanceMatrix[0]));
  rlDebrisOffset = pos - rest - vec3(0.0, 0.5 * ${DEBRIS_REST_HEIGHT_FRACTION.toFixed(4)} * size * (1.0 - rlDebrisScale), 0.0);
}
`;

/** The flight hook, as a pure function of a vertex shader's text: the colour and the depth programs share it. */
export function debrisVertexHook(src: string): string {
  const swap = (chunk: string, from: string, to: string): string => {
    const body = THREE.ShaderChunk[chunk as keyof typeof THREE.ShaderChunk] as string;
    if (!body.includes(from)) throw new Error(`debris hook: chunk ${chunk} no longer holds "${from}"`);
    return body.replace(from, to);
  };
  let out = src.replace('#include <common>', `#include <common>\n${PARS}`);
  out = out.replace(/void main\(\)\s*\{/, (m) => `${m}\n  rlDebrisPrep();`);
  out = out.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  objectNormal = rlDebrisSpin * objectNormal;');
  out = out.replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed = rlDebrisSpin * transformed * rlDebrisScale;');
  out = out.replace(
    '#include <project_vertex>',
    swap('project_vertex', 'mvPosition = instanceMatrix * mvPosition;', 'mvPosition = instanceMatrix * mvPosition;\n\tmvPosition.xyz += rlDebrisOffset;')
  );
  if (out.includes('#include <worldpos_vertex>')) {
    out = out.replace(
      '#include <worldpos_vertex>',
      swap('worldpos_vertex', 'worldPosition = instanceMatrix * worldPosition;', 'worldPosition = instanceMatrix * worldPosition;\n\t\tworldPosition.xyz += rlDebrisOffset;')
    );
  }
  return out;
}

interface Clocks {
  uDebTime: { value: number };
  uDebSimMs: { value: number };
}

function hook(material: THREE.Material, clocks: Clocks, key: string): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDebTime = clocks.uDebTime;
    shader.uniforms.uDebSimMs = clocks.uDebSimMs;
    shader.vertexShader = debrisVertexHook(shader.vertexShader);
  };
  material.customProgramCacheKey = () => key;
}

interface ShapeMesh {
  readonly mesh: THREE.InstancedMesh;
  /** Sim ms each slot's fade ends (free once the sim clock passes it); -Infinity never used. */
  readonly freeAt: Float64Array;
  cursor: number;
  used: number;
  readonly attrs: Record<'aDebT' | 'aDebP0' | 'aDebV0' | 'aDebP1' | 'aDebV1' | 'aDebP2' | 'aDebSpin', THREE.InstancedBufferAttribute>;
}

export class DebrisPool {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshStandardMaterial;
  readonly depthMaterial: THREE.MeshDepthMaterial;
  private readonly shapes: ShapeMesh[] = [];
  private readonly clocks: Clocks = { uDebTime: { value: 0 }, uDebSimMs: { value: 0 } };
  private next = 0;
  private debugHidden = false;
  /** The latest sim ms any piece is still drawn until (its fade's end). */
  private liveUntilSimMs = -Infinity;
  private readonly scratch = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();

  constructor(readonly quality: DebrisQuality) {
    this.group.name = 'debris';
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: DEBRIS_ROUGHNESS, metalness: 0 });
    this.material.name = 'rl-debris';
    hook(this.material, this.clocks, DEBRIS_PROGRAM_KEY);
    this.depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    hook(this.depthMaterial, this.clocks, `${DEBRIS_PROGRAM_KEY}-depth`);
    const cap = perShapeCapacity(quality.pool);
    if (cap === 0) return;
    for (const shape of DEBRIS_SHAPES) {
      const geometry = debrisGeometry(shape);
      const mesh = new THREE.InstancedMesh(geometry, this.material, cap);
      mesh.name = `debris-${shape}`;
      mesh.count = 0;
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = WORLD_RENDER_ORDER;
      mesh.castShadow = quality.shadows;
      mesh.receiveShadow = true;
      mesh.customDepthMaterial = this.depthMaterial;
      mesh.userData.rlAoExempt = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      const attr = (size: number): THREE.InstancedBufferAttribute => {
        const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size);
        a.setUsage(THREE.DynamicDrawUsage);
        return a;
      };
      const attrs = { aDebT: attr(4), aDebP0: attr(4), aDebV0: attr(3), aDebP1: attr(3), aDebV1: attr(3), aDebP2: attr(3), aDebSpin: attr(4) };
      for (const [name, a] of Object.entries(attrs)) geometry.setAttribute(name, a);
      this.group.add(mesh);
      this.shapes.push({ mesh, freeAt: new Float64Array(cap).fill(-Infinity), cursor: 0, used: 0, attrs });
    }
  }

  /** The three meshes (none at a pool of 0). */
  get meshes(): readonly THREE.InstancedMesh[] {
    return this.shapes.map((s) => s.mesh);
  }

  /** The frame clock now (ms), as the shader reads it. */
  get nowMs(): number {
    return this.clocks.uDebTime.value;
  }

  /** The sim clock (ms) the fade reads, as last stepped. */
  get simMs(): number {
    return this.clocks.uDebSimMs.value;
  }

  /** Pieces whose fade has not ended at the current sim clock. */
  get liveCount(): number {
    let n = 0;
    const sim = this.clocks.uDebSimMs.value;
    for (const s of this.shapes) for (let i = 0; i < s.used; i++) if (s.freeAt[i] > sim) n++;
    return n;
  }

  /**
   * Throws `plans` with their LINEAR colours, at the current frame and sim clocks. Returns how many were placed:
   * a piece with no free slot (every slot of every shape still live) is dropped, never a live one stolen.
   */
  spawn(plans: readonly DebrisPlan[], colors: readonly THREE.Color[], simSpawnMs?: number): number {
    if (this.shapes.length === 0) return 0;
    // `simSpawnMs` dates the pieces (their fade) on the sim clock; absent, now. A showcase dates its rubble 0.
    const sim = simSpawnMs ?? this.clocks.uDebSimMs.value;
    const now = this.clocks.uDebTime.value;
    let placed = 0;
    for (let k = 0; k < plans.length; k++) {
      const shapeStart = this.next;
      this.next = (this.next + 1) % this.shapes.length;
      let done = false;
      for (let tries = 0; tries < this.shapes.length && !done; tries++) {
        const s = this.shapes[(shapeStart + tries) % this.shapes.length];
        const slot = this.freeSlot(s, sim);
        if (slot < 0) continue;
        this.write(s, slot, plans[k], colors[k] ?? colors[0], now, sim);
        done = true;
        placed++;
      }
    }
    this.syncVisible();
    return placed;
  }

  /** Advances the frame clock by `frameDtMs` (the FX clock) and sets the sim clock. */
  step(frameDtMs: number, simMs: number): void {
    this.clocks.uDebTime.value += frameDtMs;
    this.clocks.uDebSimMs.value = simMs;
    this.syncVisible();
  }

  /** The `debris` debug layer: a flag `syncVisible` consults. Returns the mesh count. */
  setDebugHidden(hidden: boolean): number {
    this.debugHidden = hidden;
    this.syncVisible();
    return this.shapes.length;
  }

  /** The slot's written plan values, for a test. */
  slot(shape: number, i: number): { t: number[]; p0: number[]; v0: number[]; rest: THREE.Vector3; color: THREE.Color } {
    const s = this.shapes[shape];
    const m = new THREE.Matrix4();
    s.mesh.getMatrixAt(i, m);
    const c = new THREE.Color();
    s.mesh.getColorAt(i, c);
    const at = (a: THREE.InstancedBufferAttribute): number[] => Array.from((a.array as Float32Array).slice(i * a.itemSize, (i + 1) * a.itemSize));
    return { t: at(s.attrs.aDebT), p0: at(s.attrs.aDebP0), v0: at(s.attrs.aDebV0), rest: new THREE.Vector3().setFromMatrixPosition(m), color: c };
  }

  private freeSlot(s: ShapeMesh, sim: number): number {
    const cap = s.freeAt.length;
    for (let i = 0; i < cap; i++) {
      const k = (s.cursor + i) % cap;
      if (s.freeAt[k] <= sim) {
        s.cursor = (k + 1) % cap;
        return k;
      }
    }
    return -1;
  }

  private write(s: ShapeMesh, i: number, p: DebrisPlan, color: THREE.Color, now: number, sim: number): void {
    this.q.setFromAxisAngle(this.up, p.yaw);
    this.scratch.compose(this.pos.set(p.rest[0], p.rest[1], p.rest[2]), this.q, this.scl.setScalar(p.size));
    s.mesh.setMatrixAt(i, this.scratch);
    s.mesh.setColorAt(i, color);
    const put = (a: THREE.InstancedBufferAttribute, values: readonly number[]): void => {
      (a.array as Float32Array).set(values, i * a.itemSize);
      a.addUpdateRange(i * a.itemSize, a.itemSize);
      a.needsUpdate = true;
    };
    put(s.attrs.aDebT, [now + (p.delayMs ?? 0), p.t1, p.t2, p.t3]);
    put(s.attrs.aDebP0, [p.p0[0], p.p0[1], p.p0[2], sim]);
    put(s.attrs.aDebV0, p.v0);
    put(s.attrs.aDebP1, p.p1);
    put(s.attrs.aDebV1, p.v1);
    put(s.attrs.aDebP2, p.p2);
    put(s.attrs.aDebSpin, [p.spinAxis[0], p.spinAxis[1], p.spinAxis[2], p.spinRate]);
    s.mesh.instanceMatrix.addUpdateRange(i * 16, 16);
    s.mesh.instanceMatrix.needsUpdate = true;
    if (s.mesh.instanceColor) {
      s.mesh.instanceColor.addUpdateRange(i * 3, 3);
      s.mesh.instanceColor.needsUpdate = true;
    }
    const end = sim + DEBRIS_FADE_START_MS + DEBRIS_FADE_MS;
    s.freeAt[i] = end;
    if (end > this.liveUntilSimMs) this.liveUntilSimMs = end;
    if (i + 1 > s.used) s.used = i + 1;
    s.mesh.count = s.used;
  }

  private syncVisible(): void {
    const live = this.clocks.uDebSimMs.value <= this.liveUntilSimMs;
    for (const s of this.shapes) s.mesh.visible = !this.debugHidden && live && s.used > 0;
  }

  dispose(): void {
    for (const s of this.shapes) {
      s.mesh.geometry.dispose();
      s.mesh.dispose();
    }
    this.material.dispose();
    this.depthMaterial.dispose();
  }
}
