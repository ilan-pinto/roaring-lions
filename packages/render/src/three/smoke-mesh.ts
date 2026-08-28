/**
 * Phase D readiness fix: smoke on screen. `sim.smoke` is a real, working
 * mechanic -- a player-driven ability (`canSmoke`, the `f` key), a genuine
 * line-of-sight block (`raySmoke`/`losRay`, `@lions/sim/sim.ts`) -- and until
 * this file existed, three.js drew nothing for it at all: `grep -rn smoke
 * packages/render/src/three/` returned zero hits. A player who pops smoke
 * paid the ability, got the LOS block, and saw no change on screen
 * whatsoever -- "the worst failure class available: a working mechanic
 * rendered invisible" (Phase D readiness audit, blocker #2). This module is
 * the fix: it draws what `sim.smoke` already computes, the same way
 * `fog-mesh.ts` draws `Sim`'s own fog array -- that file is this one's
 * direct structural template (per-tile `Uint8Array`, `groundWorldY`-lifted
 * instanced quad, pure write function separated from GPU construction), not
 * merely similar in spirit.
 *
 * ## Ported from `renderer.ts:2576-2591`, not redesigned
 *
 * Pixi's smoke loop:
 *
 *   for (y, x): const d = this.sim.smoke[y * w + x]; if (d === 0) continue;
 *   g.poly([diamond around (isoX,isoY)]).fill({ color: '#C9CBC4', alpha:
 *   (d / 255) * 0.72 });
 *
 * `d` is the raw `Uint8Array` byte (0-255, `SMOKE_MAX` in `@lions/sim` is
 * 255), and Pixi's own comment: "drawn over the ground and under the units
 * so troops inside one still read -- it obscures, it does not delete them."
 * `(d / 255) * 0.72` is reproduced verbatim below -- `writeSmokeInstances`'s
 * own alpha line is that same expression, not a rescaled or clamped variant.
 *
 * ## `'#C9CBC4'` is NOT run through `resolveColor`, and does NOT equal a
 * single palette swatch exactly -- ported as a literal anyway
 *
 * `fog-mesh.ts`'s own top comment already establishes the precedent this
 * follows: Pixi's smoke fill, like its fog fill, is a raw hex literal with
 * no `resolveColor` call at that line (`renderer.ts:2589` -- unlike terrain
 * tones, which genuinely vary per map theme, smoke's tint does not). Unlike
 * fog's `#0A0A08` (byte-identical to `shadow.2`), smoke's `#C9CBC4` is not
 * an exact palette entry -- the nearest ramp swatch (`gunmetal.0`,
 * `#C3C7C4`) sits a Euclidean RGB distance of ~7 away, not 0. That is a fact
 * about the ALREADY-SHIPPED Pixi renderer, which this phase's own brief
 * pins as the reference ("Pixi is the reference -- port, do not redesign"):
 * inventing a palette key this literal does not actually belong to would be
 * redesigning Pixi's colour choice, not porting it. `SMOKE_COLOR` below is
 * therefore hardcoded, exactly like `FOG_COLOR`, with this paragraph
 * standing in for a `resolveColor` call Pixi itself never makes.
 *
 * ## Band: `SMOKE_RENDER_ORDER` (5), not `OVERLAY_RENDER_ORDER` (4)
 *
 * See `units/render-order.ts`'s own band-5 row for the full argument: Pixi's
 * smoke block draws into the same `unitsG` container the whole overlay tier
 * does, but LATER in the same per-frame method, so on screen it paints OVER
 * HP bars/selection rings/order markers, not merely alongside them. A
 * dedicated band above `OVERLAY_RENDER_ORDER` (and below `FOG_RENDER_ORDER`,
 * matching `unitsG` sitting below `fogG`) reproduces that relationship
 * without relying on `Object3D.id` construction-order tiebreaking between
 * two independently-built meshes.
 */
import * as THREE from 'three';
import { hexToUnit } from './terrain/shared';
import { groundWorldY } from './ground-height';
import { fogQuadGeometry } from './fog-mesh';
import { SMOKE_RENDER_ORDER } from './units/render-order';

// ---------------------------------------------------------------------------
// Pure: no THREE.* below this line yet -- mirrors fog-mesh.ts's own split.
// ---------------------------------------------------------------------------

/** Pixi's own smoke-fill literal (`renderer.ts:2589`), `#C9CBC4` -- see this
 *  file's own top comment for why it is hardcoded, not resolved from a
 *  palette key, and why it is NOT the same case as `FOG_COLOR` (which does
 *  equal one exactly). */
export const SMOKE_COLOR = '#C9CBC4';

/** Pixi's own alpha multiplier -- `(d / 255) * SMOKE_ALPHA_MAX`, `d` the raw
 *  smoke byte (`renderer.ts:2589`'s `(d / 255) * 0.72`). */
export const SMOKE_ALPHA_MAX = 0.72;

/** Per-instance GPU attribute arrays `writeSmokeInstances` fills, sized (by
 *  the caller) to the map's own tile count -- the worst case, every tile
 *  smoked at once, is unlikely but not impossible (a full box barrage), and
 *  costs nothing to provision for up front, the identical reasoning
 *  `FogInstanceBuffers` already uses for the boot-state (all-fogged) case. */
export interface SmokeInstanceBuffers {
  /** xyz triples, world space -- the tile's own `(x, groundWorldY, y)`. */
  positions: Float32Array;
  /** One alpha per instance: `(d / 255) * SMOKE_ALPHA_MAX`. */
  alphas: Float32Array;
}

/**
 * Visits every tile with `smoke[t] !== 0` and writes its world position and
 * alpha. Pure aside from `groundWorldY` (itself pure) -- no `THREE.*` -- the
 * direct analogue of `writeFogInstances`, differing only in the source array
 * (`smoke`, not `fog`) and the alpha formula (a continuous `d/255` fade, not
 * `fog`'s two-value level switch).
 *
 * Returns the number of instances written, which the caller sets `mesh.count`
 * to -- the only "hide an instance" mechanism an `InstancedMesh` has,
 * matching `writeFogInstances`'s own contract.
 */
export function writeSmokeInstances(
  smoke: Uint8Array,
  width: number,
  height: number,
  elevation: Uint8Array | null,
  out: SmokeInstanceBuffers
): number {
  const capacity = out.alphas.length;
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = smoke[y * width + x];
      if (d === 0) continue;
      if (count >= capacity) return count;
      out.positions[count * 3] = x;
      out.positions[count * 3 + 1] = groundWorldY(elevation, width, height, x, y);
      out.positions[count * 3 + 2] = y;
      out.alphas[count] = (d / 255) * SMOKE_ALPHA_MAX;
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// GPU-facing: everything below touches THREE.* GPU-side construction.
// ---------------------------------------------------------------------------

/**
 * Flat-shaded, per-instance-alpha material -- structurally `createFogMaterial`
 * verbatim (`fog-mesh.ts`), one shared `uColor` uniform and a per-instance
 * `aAlpha` attribute, `depthTest: false`/`depthWrite: false` for the same
 * "unconditional overlay" reason fog needs it: a flat quad coplanar with the
 * ground would lose the depth comparison to any unit standing on that same
 * tile, which is exactly backwards from "the smoke still shows over a unit
 * standing in it" (Pixi's own comment, "it obscures, it does not delete
 * them" -- alpha does that job, but only if the quad is not itself occluded
 * first).
 */
function createSmokeMaterial(): THREE.ShaderMaterial {
  const [r, g, b] = hexToUnit(SMOKE_COLOR);
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Vector3(r, g, b) },
    },
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(uColor, vAlpha);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.FrontSide,
  });
}

/**
 * Every smoked tile, one `THREE.InstancedMesh`, one draw call -- `FogMesh`'s
 * own shape, sized to the map's own tile count. Reuses `fogQuadGeometry()`
 * directly rather than a second copy: a smoke quad is the identical unit
 * tile footprint a fog quad is, just translated and given a different
 * material/alpha.
 */
export class SmokeMesh {
  readonly mesh: THREE.InstancedMesh;
  private readonly alphaAttr: THREE.InstancedBufferAttribute;
  private readonly scratchPositions: Float32Array;
  private readonly scratchMatrix = new THREE.Matrix4();

  constructor(width: number, height: number) {
    const capacity = Math.max(1, width * height);
    const geo = fogQuadGeometry();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(geo.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(geo.indices, 1));

    this.alphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    geometry.setAttribute('aAlpha', this.alphaAttr);

    this.mesh = new THREE.InstancedMesh(geometry, createSmokeMaterial(), capacity);
    this.mesh.count = 0;
    this.mesh.renderOrder = SMOKE_RENDER_ORDER;
    // Smoke can drift anywhere on the map, exactly like fog/units/particles
    // -- see UnitInstancer's identical field and comment.
    this.mesh.frustumCulled = false;

    this.scratchPositions = new Float32Array(capacity * 3);
  }

  /** Rebuilds every instance from the current `smoke` array. Called once per
   *  `frame()`, matching Pixi's own per-frame smoke loop (smoke has no
   *  `fogDirty`-style dirty flag in Pixi -- it is redrawn every frame there,
   *  so it is here too, rather than gated to the 5 Hz fog cadence). */
  update(smoke: Uint8Array, elevation: Uint8Array | null, width: number, height: number): void {
    const count = writeSmokeInstances(smoke, width, height, elevation, {
      positions: this.scratchPositions,
      alphas: this.alphaAttr.array as Float32Array,
    });
    for (let i = 0; i < count; i++) {
      this.scratchMatrix.makeTranslation(
        this.scratchPositions[i * 3],
        this.scratchPositions[i * 3 + 1],
        this.scratchPositions[i * 3 + 2]
      );
      this.mesh.setMatrixAt(i, this.scratchMatrix);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
