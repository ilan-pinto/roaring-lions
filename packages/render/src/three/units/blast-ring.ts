/**
 * GH-1197: the two-part blast ring, drawn for every landing that has a reach.
 *
 * - The INNER shock grows from the burst to the weapon's splash `S` exactly --
 *   the sim's damage reach -- with an ease-out over the class's `inner_ms`. Its
 *   alpha is HELD at 0.6 to 70% of that time and then falls linearly to 0 (the
 *   approved mock v2: a linear fade from the start left it near 0.05 at its own
 *   reach). A white-hot leading edge, 0.07 t wide at `HDR_GAINS.shockRingEdge`,
 *   draws at 1.6x the body's alpha for the first 120 ms and then fades with the
 *   body (its factor eases to 1 by the ring's end).
 * - The OUTER pressure wave starts when the inner ring peaks and grows from `S`
 *   to `outer_k x S` by `outer_end_ms`, a 0.45-tile band that never reaches back
 *   inside `S`, at alpha 0.3 falling linearly to 0. It is NOT damage, and it is
 *   drawn non-additive and under the inner ring so it never reads as one.
 *
 * Two meshes, one draw each and only while a ring is live: every additive band
 * (`FX_RENDER_ORDER_ADDITIVE`) and every normal-blend band (`FX_RENDER_ORDER`).
 * Each is ONE dynamic geometry the live rings are written into once a frame,
 * vertex colour with alpha, so the material is a stock `MeshBasicMaterial`: no
 * GLSL, so both backends draw it with no node twin. Every vertex stands on the
 * ground under it (`heightAt`), lifted clear of the decals.
 *
 * Aged on the FRAME clock (`step(dtMs)`) like the flash lights: hit-stop
 * freezes it, and it is a one-shot burst, not world state. Presentation only.
 */
import * as THREE from 'three';
import type { RingSpec } from '../munitions';
import { hexToLinear } from '../terrain/shared';
import { HDR_GAINS } from './hdr-gains';
import { FX_RENDER_ORDER, FX_RENDER_ORDER_ADDITIVE } from './render-order';

/** Rings live at once; the oldest is reused when a fresh one needs its slot. */
export const BLAST_RING_CAPACITY = 48;
/** Segments around a ring. */
export const BLAST_RING_SEGMENTS = 64;
/** World-Y above the ground, so the ring never z-fights the decals. */
export const BLAST_RING_LIFT = 0.04;
/** The inner band's width as a fraction of its current radius (the strike ring's 0.22 since GH-748). */
export const INNER_BAND_FRACTION = 0.22;
export const INNER_ALPHA = 0.6;
export const INNER_HOLD_FRACTION = 0.7;
export const EDGE_WIDTH_TILES = 0.07;
export const EDGE_ALPHA_FACTOR = 1.6;
export const EDGE_HOLD_MS = 120;
export const OUTER_ALPHA = 0.3;
export const OUTER_BAND_TILES = 0.45;

export interface InnerRingState {
  /** Outer edge of the band, tiles. */
  readonly radius: number;
  readonly alpha: number;
  /** The leading edge's alpha; 0 for a ring with no edge. */
  readonly edgeAlpha: number;
}

export interface OuterRingState {
  readonly radius: number;
  /** The band's inner edge, never inside `S`. */
  readonly innerRadius: number;
  readonly alpha: number;
}

/** The inner shock at `ageMs`, or null outside its life. */
export function innerRingState(ageMs: number, spec: RingSpec): InnerRingState | null {
  if (!(spec.innerMs > 0) || !(spec.splash > 0) || ageMs < 0 || ageMs >= spec.innerMs) return null;
  const k = ageMs / spec.innerMs;
  const grow = 1 - (1 - k) * (1 - k);
  const alpha = k <= INNER_HOLD_FRACTION ? INNER_ALPHA : INNER_ALPHA * (1 - (k - INNER_HOLD_FRACTION) / (1 - INNER_HOLD_FRACTION));
  let factor = EDGE_ALPHA_FACTOR;
  if (ageMs > EDGE_HOLD_MS && spec.innerMs > EDGE_HOLD_MS) {
    factor = EDGE_ALPHA_FACTOR + (1 - EDGE_ALPHA_FACTOR) * ((ageMs - EDGE_HOLD_MS) / (spec.innerMs - EDGE_HOLD_MS));
  }
  return {
    radius: Math.max(0.05, spec.splash * grow),
    alpha,
    edgeAlpha: spec.edge ? Math.min(1, alpha * factor) : 0,
  };
}

/** The outer wave at `ageMs` (since the burst), or null outside its life or for a class with none. */
export function outerRingState(ageMs: number, spec: RingSpec): OuterRingState | null {
  if (!(spec.outerK > 1) || !(spec.splash > 0)) return null;
  const dur = spec.outerEndMs - spec.innerMs;
  const a = ageMs - spec.innerMs;
  if (!(dur > 0) || a < 0 || a >= dur) return null;
  const k = a / dur;
  const grow = 1 - (1 - k) * (1 - k);
  const radius = spec.splash + (spec.outerK * spec.splash - spec.splash) * grow;
  return { radius, innerRadius: Math.max(spec.splash, radius - OUTER_BAND_TILES), alpha: OUTER_ALPHA * (1 - k) };
}

/** How long a ring lives, ms. */
export function ringLifeMs(spec: RingSpec): number {
  return spec.outerK > 1 ? Math.max(spec.innerMs, spec.outerEndMs) : spec.innerMs;
}

interface Ring {
  x: number;
  z: number;
  ageMs: number;
  spec: RingSpec | null;
}

const VERTS_PER_BAND = (BLAST_RING_SEGMENTS + 1) * 2;
const INDICES_PER_BAND = BLAST_RING_SEGMENTS * 6;
/** Bands a ring may write into one mesh: body and edge (additive), or inner and outer (normal). */
const BANDS_PER_RING = 2;

/** One of the two meshes: a dynamic band list. */
class BandMesh {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly pos: THREE.BufferAttribute;
  private readonly col: THREE.BufferAttribute;
  bands = 0;

  constructor(name: string, capacityBands: number, blending: THREE.Blending, renderOrder: number) {
    const geometry = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(capacityBands * VERTS_PER_BAND * 3), 3);
    this.col = new THREE.BufferAttribute(new Float32Array(capacityBands * VERTS_PER_BAND * 4), 4);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.col.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.pos);
    geometry.setAttribute('color', this.col);
    const index = new Uint32Array(capacityBands * INDICES_PER_BAND);
    for (let b = 0; b < capacityBands; b++) {
      const v0 = b * VERTS_PER_BAND;
      for (let i = 0; i < BLAST_RING_SEGMENTS; i++) {
        const o = b * INDICES_PER_BAND + i * 6;
        const a = v0 + i * 2;
        // (inner_i, outer_i, inner_i+1) and (outer_i, outer_i+1, inner_i+1).
        index[o] = a;
        index[o + 1] = a + 1;
        index[o + 2] = a + 2;
        index[o + 3] = a + 1;
        index[o + 4] = a + 3;
        index[o + 5] = a + 2;
      }
    }
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.setDrawRange(0, 0);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      blending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.visible = false;
  }

  begin(): void {
    this.bands = 0;
  }

  /** An annulus `r0..r1` about (x, z), every vertex on the ground. */
  band(
    x: number, z: number, r0: number, r1: number,
    r: number, g: number, b: number, a: number,
    heightAt: (x: number, z: number) => number
  ): void {
    if (!(r1 > r0) || !(a > 0)) return;
    const cap = this.pos.count / VERTS_PER_BAND;
    if (this.bands >= cap) return;
    const p = this.pos.array as Float32Array;
    const c = this.col.array as Float32Array;
    let v = this.bands * VERTS_PER_BAND;
    for (let i = 0; i <= BLAST_RING_SEGMENTS; i++) {
      const th = (i / BLAST_RING_SEGMENTS) * Math.PI * 2;
      const cs = Math.cos(th);
      const sn = Math.sin(th);
      for (const rad of [r0, r1]) {
        const px = x + cs * rad;
        const pz = z + sn * rad;
        p[v * 3] = px;
        p[v * 3 + 1] = heightAt(px, pz) + BLAST_RING_LIFT;
        p[v * 3 + 2] = pz;
        c[v * 4] = r;
        c[v * 4 + 1] = g;
        c[v * 4 + 2] = b;
        c[v * 4 + 3] = a;
        v++;
      }
    }
    this.bands++;
  }

  end(hidden: boolean): void {
    const verts = this.bands * VERTS_PER_BAND;
    if (verts > 0) {
      this.pos.clearUpdateRanges();
      this.col.clearUpdateRanges();
      this.pos.addUpdateRange(0, verts * 3);
      this.col.addUpdateRange(0, verts * 4);
      this.pos.needsUpdate = true;
      this.col.needsUpdate = true;
    }
    this.mesh.geometry.setDrawRange(0, this.bands * INDICES_PER_BAND);
    this.mesh.visible = this.bands > 0 && !hidden;
  }

  /** The written vertex at index `v`, for a test. */
  vertex(v: number): { x: number; y: number; z: number; r: number; g: number; b: number; a: number } {
    const p = this.pos.array as Float32Array;
    const c = this.col.array as Float32Array;
    return { x: p[v * 3], y: p[v * 3 + 1], z: p[v * 3 + 2], r: c[v * 4], g: c[v * 4 + 1], b: c[v * 4 + 2], a: c[v * 4 + 3] };
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/** A ring's palette keys resolved to LINEAR colours (vertex colours are not decoded). */
export type RingColorResolver = (paletteKey: string) => THREE.Color;

/** A palette hex as the LINEAR colour a ring's vertex buffer carries: `hexToLinear`, set without any
 *  colour-management conversion (CLAUDE.md: vertex and uniform colours are linear). */
export function ringColorLinear(hex: string): THREE.Color {
  const [r, g, b] = hexToLinear(hex);
  return new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);
}

export class BlastRingPool {
  readonly group = new THREE.Group();
  /** The white-hot inner bands and their edges. */
  readonly additive: BandMesh;
  /** The outer waves, and any inner ring a class draws dust-toned (demolition). */
  readonly normal: BandMesh;
  private readonly rings: Ring[] = [];
  private next = 0;
  private debugHidden = false;
  private readonly colors = new Map<string, THREE.Color>();
  private resolve: RingColorResolver;

  constructor(resolve: RingColorResolver, capacity = BLAST_RING_CAPACITY) {
    this.resolve = resolve;
    this.group.name = 'blast-rings';
    this.additive = new BandMesh('blast-rings-additive', capacity * BANDS_PER_RING, THREE.AdditiveBlending, FX_RENDER_ORDER_ADDITIVE);
    this.normal = new BandMesh('blast-rings-normal', capacity * BANDS_PER_RING, THREE.NormalBlending, FX_RENDER_ORDER);
    this.group.add(this.normal.mesh, this.additive.mesh);
    for (let i = 0; i < capacity; i++) this.rings.push({ x: 0, z: 0, ageMs: 0, spec: null });
  }

  /** The colour cache is per key; a colour-vision change re-resolves it. */
  setResolver(resolve: RingColorResolver): void {
    this.resolve = resolve;
    this.colors.clear();
  }

  /** A ring at (x, z), tiles, starting now. A spec with no reach draws nothing. */
  spawn(x: number, z: number, spec: RingSpec | null): void {
    if (spec === null || !(spec.splash > 0)) return;
    // Prefer a dead slot; otherwise reuse the oldest.
    let slot = -1;
    for (let i = 0; i < this.rings.length; i++) {
      const k = (this.next + i) % this.rings.length;
      if (this.rings[k].spec === null) {
        slot = k;
        break;
      }
    }
    if (slot < 0) slot = this.next;
    this.next = (slot + 1) % this.rings.length;
    const r = this.rings[slot];
    r.x = x;
    r.z = z;
    r.ageMs = 0;
    r.spec = spec;
  }

  /** Live rings (a harness and test read). */
  get liveCount(): number {
    let n = 0;
    for (const r of this.rings) if (r.spec !== null) n++;
    return n;
  }

  /** Each live ring's position and state, oldest slot first (a test read). */
  liveRings(): { x: number; z: number; ageMs: number; spec: RingSpec; inner: InnerRingState | null; outer: OuterRingState | null }[] {
    const out = [];
    for (const r of this.rings) {
      if (r.spec === null) continue;
      out.push({ x: r.x, z: r.z, ageMs: r.ageMs, spec: r.spec, inner: innerRingState(r.ageMs, r.spec), outer: outerRingState(r.ageMs, r.spec) });
    }
    return out;
  }

  /** Ages every ring by `dtMs` and rewrites both meshes. `heightAt` is the ground's world Y. */
  step(dtMs: number, heightAt: (x: number, z: number) => number): void {
    for (const r of this.rings) {
      if (r.spec === null) continue;
      r.ageMs += dtMs;
      if (r.ageMs >= ringLifeMs(r.spec)) r.spec = null;
    }
    this.write(heightAt);
  }

  setDebugHidden(hidden: boolean): void {
    this.debugHidden = hidden;
    this.additive.mesh.visible = this.additive.bands > 0 && !hidden;
    this.normal.mesh.visible = this.normal.bands > 0 && !hidden;
  }

  private color(key: string): THREE.Color {
    let c = this.colors.get(key);
    if (c === undefined) {
      c = this.resolve(key);
      this.colors.set(key, c);
    }
    return c;
  }

  private write(heightAt: (x: number, z: number) => number): void {
    this.additive.begin();
    this.normal.begin();
    for (const r of this.rings) {
      const spec = r.spec;
      if (spec === null) continue;
      const outer = outerRingState(r.ageMs, spec);
      if (outer) {
        const c = this.color(spec.outerColor);
        this.normal.band(r.x, r.z, outer.innerRadius, outer.radius, c.r, c.g, c.b, outer.alpha, heightAt);
      }
      const inner = innerRingState(r.ageMs, spec);
      if (inner) {
        const c = this.color(spec.innerColor);
        const r0 = inner.radius * (1 - INNER_BAND_FRACTION);
        const target = spec.innerAdditive ? this.additive : this.normal;
        const edgeW = inner.edgeAlpha > 0 ? Math.min(EDGE_WIDTH_TILES, inner.radius - r0) : 0;
        target.band(r.x, r.z, r0, inner.radius - edgeW, c.r, c.g, c.b, inner.alpha, heightAt);
        if (edgeW > 0) {
          const g = HDR_GAINS.shockRingEdge;
          target.band(r.x, r.z, inner.radius - edgeW, inner.radius, c.r * g, c.g * g, c.b * g, inner.edgeAlpha, heightAt);
        }
      }
    }
    this.additive.end(this.debugHidden);
    this.normal.end(this.debugHidden);
  }

  dispose(): void {
    this.additive.dispose();
    this.normal.dispose();
  }
}
