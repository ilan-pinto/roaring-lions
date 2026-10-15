/**
 * S-F F2 C3: side 0's supply routes, drawn in the world on demand.
 *
 * What it is, and why each part:
 *
 * - **On demand only.** The app writes `Renderer.supplyRoutes` while the
 *   strip's logistics figure is hovered or focused, or for a moment after a
 *   Space jump lands on a supply alert, and `null` otherwise. `null` (or a
 *   set with nothing drawable in it) means NO mesh in the group at all, not
 *   an empty one: three.js submits a mesh with an empty draw range.
 * - **Ground, not overlay.** Depth-tested and not depth-writing, in its own
 *   band, `SUPPLY_ROUTE_RENDER_ORDER` (0.2), never the overlay tier (4):
 *   a roof between the camera and the road hides the line through the depth
 *   buffer. The decal pool's polygon offset keeps it off the ground it lies
 *   on, on top of the per-vertex lift (`supply-route-maths.ts`).
 * - **One draw call for the whole set.** Every route is merged into one
 *   geometry. A new set REPLACES that geometry whole and disposes the old
 *   one; the arrays are never patched, so no stale route outlives a recheck
 *   (Review Focus 3).
 * - **Colour from uniforms, linear.** The open line is `--info`'s key, the
 *   cut stretch `--warn`'s; `setColors` writes them every frame through
 *   `hexToLinear`, so a colour-vision switch reaches a route already drawn
 *   without a rebuild. The cut stretch is ALSO dashed, which carries it
 *   without colour (Review Focus 5). Nothing animates: no time uniform.
 *
 * No `normal` attribute, so the AO pre-pass skips it (`post-chain.ts`,
 * `isAoOccluder`), and it casts no shadow. The `supply-route` debug layer
 * toggles `group`, which nothing per-frame writes.
 */
import * as THREE from 'three';
import type { SupplyRouteView } from '../api';
import { DECAL_POLYGON_OFFSET_FACTOR, DECAL_POLYGON_OFFSET_UNITS, glslFloat } from './decal-pool';
import { buildSupplyRibbon, SUPPLY_ROUTE_DASH_DUTY, SUPPLY_ROUTE_DASH_TILES } from './supply-route-maths';
import { SUPPLY_ROUTE_RENDER_ORDER } from './units/render-order';
import { cachedHexToLinear } from './units/overlays';

/** The open line's palette key: `--info` (`theme.css`: `--rl-water-0`), the
 *  logistics colour (#454). */
export const SUPPLY_ROUTE_OPEN_COLOR_KEY = 'water.0';
/** The cut stretch's palette key: `--warn` (`--rl-team-neutral`), never
 *  `--bad` (P2-3). A `team.*` key, so the app's variant-aware resolver gives
 *  each colour-vision variant its own caution colour, as the HUD's `--warn`
 *  does. */
export const SUPPLY_ROUTE_CUT_COLOR_KEY = 'team.neutral';

/** The line's opacity: firm enough to read on sand, thin enough not to shout. */
export const SUPPLY_ROUTE_ALPHA = 0.9;

export function createSupplyRouteMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uOpen: { value: new THREE.Vector3(1, 1, 1) },
      uCut: { value: new THREE.Vector3(1, 1, 1) },
    },
    vertexShader: /* glsl */ `
      attribute float aDist;
      attribute float aCut;
      varying float vDist;
      varying float vCut;
      void main() {
        vDist = aDist;
        vCut = aCut;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uOpen;
      uniform vec3 uCut;
      varying float vDist;
      varying float vCut;
      void main() {
        bool cut = vCut > 0.5;
        if (cut && fract(vDist / ${glslFloat(SUPPLY_ROUTE_DASH_TILES)}) > ${glslFloat(SUPPLY_ROUTE_DASH_DUTY)}) discard;
        gl_FragColor = vec4(cut ? uCut : uOpen, ${glslFloat(SUPPLY_ROUTE_ALPHA)});
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: DECAL_POLYGON_OFFSET_FACTOR,
    polygonOffsetUnits: DECAL_POLYGON_OFFSET_UNITS,
    side: THREE.DoubleSide,
  });
}

export class SupplyRouteMesh {
  /** What the scene holds and the debug layer toggles. Holds the one mesh
   *  while routes are drawn, and nothing otherwise. */
  readonly group = new THREE.Group();
  readonly material = createSupplyRouteMaterial();
  private mesh: THREE.Mesh | null = null;
  private routes: readonly SupplyRouteView[] | null = null;
  private dirty = false;

  constructor() {
    this.group.name = 'supply-route-layer';
  }

  /** The routes to draw. The same array again is a no-op; anything else is
   *  rebuilt on the next `sync`. */
  set(routes: readonly SupplyRouteView[] | null): void {
    if (routes === this.routes) return;
    this.routes = routes;
    this.dirty = true;
  }

  get current(): readonly SupplyRouteView[] | null {
    return this.routes;
  }

  /** The ground under the routes changed (a new surface): rebuild them. */
  invalidate(): void {
    if (this.routes !== null) this.dirty = true;
  }

  /** Rebuilds the geometry if the routes or the ground changed since the
   *  last call. `groundY(x, y)` is the drawn ground's world height. */
  sync(width: number, groundY: (x: number, y: number) => number): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.clear();
    if (this.routes === null) return;
    const r = buildSupplyRibbon(this.routes, width, groundY);
    if (r.vertexCount === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(r.positions, 3));
    geometry.setAttribute('aDist', new THREE.BufferAttribute(r.dist, 1));
    geometry.setAttribute('aCut', new THREE.BufferAttribute(r.cut, 1));
    geometry.setIndex(new THREE.BufferAttribute(r.vertexCount > 65535 ? r.indices : Uint16Array.from(r.indices), 1));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.name = 'supply-route';
    mesh.renderOrder = SUPPLY_ROUTE_RENDER_ORDER;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.mesh = mesh;
    this.group.add(mesh);
  }

  /** The open line's and the cut stretch's colours, as hex; linearised here. */
  setColors(openHex: string, cutHex: string): void {
    const o = cachedHexToLinear(openHex);
    const c = cachedHexToLinear(cutHex);
    (this.material.uniforms.uOpen.value as THREE.Vector3).set(o[0], o[1], o[2]);
    (this.material.uniforms.uCut.value as THREE.Vector3).set(c[0], c[1], c[2]);
  }

  private clear(): void {
    if (this.mesh === null) return;
    this.group.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh = null;
  }

  dispose(): void {
    this.routes = null;
    this.dirty = false;
    this.clear();
    this.material.dispose();
  }
}
