/**
 * GH-471: the x-ray reveal of an identified tunnel -- the GPU half. The rules
 * (when a route draws, how it fades, the discovery sweep, where a fighter
 * stands) live in `./tunnel-xray-state.ts` and are tested there as numbers.
 *
 * ## What draws
 *
 *  - the BORE: an arched tube 0.62 tile under the drawn ground, along a
 *    3-tile moving average of the surface and never closer than a bore height
 *    to it, so it neither climbs a cliff face nor breaks through a crest;
 *  - a SHAFT from the bore up to the surface at the mouth and at the vent,
 *    merged into the bore's geometry;
 *  - a flat COLLAR on the surface at each end; the vent's breathes, because
 *    that is where fighters come up;
 *  - one FIGURE per fighter inside an identified route;
 *  - for 1.2 s after a first discovery, a BEAM from the finder down to the
 *    point of the route it found.
 *
 * ## Through the ground, never over a unit
 *
 * The bore and the figures use the occlusion silhouette's own flags
 * (`SILHOUETTE_MATERIAL_FLAGS`, `units/silhouette.ts`): `GreaterDepth`, so a
 * fragment draws only where something already in the depth buffer is
 * NEARER -- the ground over it, or a roof or ridge in front of it, which the
 * lead accepted (decision 3, 2026-10-08) -- plus the unit stencil, so a unit
 * standing on the route is never painted over.
 *
 * BACK faces only: the far wall and floor are what the eye sees of a tunnel
 * through a cutaway. The mock drew the near wall too, as glass, and its
 * silhouette and the far wall's disagreed by a sliver at every 0.25-tile
 * ring, which photographed as a sawtooth along the bore's lower edge. The
 * rim the glass gave is computed on the back faces from the same normal.
 *
 * Fog is a post pass that dims by the GROUND's position in front of a pixel,
 * so the bore under unexplored ground is dimmed with it (decision 3).
 *
 * ## Cost
 *
 * At most FOUR draw calls whatever the number of routes or fighters: one
 * merged bore-and-shafts mesh, one collar mesh, one figure InstancedMesh and
 * the beam while it shows -- and NONE while no route is identified. Per-route state rides in uniform arrays indexed
 * by an `aRoute` attribute. None of it reaches the shadow or AO passes. A
 * map with no tunnel draws nothing at all.
 *
 * Colour comes in as palette-resolved hex from the caller and is linearised
 * here (`hexToLinear`): the output pass encodes once.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hexToLinear } from './terrain/shared';
import { SILHOUETTE_MATERIAL_FLAGS } from './units/silhouette';
import { VIEW_DIRECTION } from './camera';
import {
  TUNNEL_XRAY_BEAM_RENDER_ORDER,
  TUNNEL_XRAY_FIGURE_RENDER_ORDER,
  TUNNEL_XRAY_RENDER_ORDER,
} from './units/render-order';
import { XrayRouteClock, XRAY_MAX_FIGURES, XRAY_MAX_ROUTES, figureAlongRoute, nearestSample } from './tunnel-xray-state';
import type { Ops } from './fog-ops';

/** Bore centre below the drawn ground, world units (1 tile = 1 wu = 3 m). */
export const XRAY_BORE_DEPTH = 0.62;
/** Half-width and half-height of the bore: an arched gallery ~1.2 m x 1.7 m. */
const RH = 0.2;
const RV = 0.28;
const RING = 16;
/** Route sampling step, tiles. */
export const XRAY_STEP = 0.25;
const SHAFT_R = 0.15;
/** Moving-average half window over the ground, in samples (1.5 tiles). */
const SMOOTH = 6;

/** Palette keys, resolved by the caller through `resolveColor`. */
export const XRAY_COLOR_KEYS = {
  rim: 'vfx.interceptor',
  core: 'shadow.1',
  hot: 'vfx.white_hot',
  figure: 'team.hostile',
} as const;

export type XrayColors = Record<keyof typeof XRAY_COLOR_KEYS, string>;

/**
 * GH-943 P3 (T9): the x-ray's per-fragment maths, written ONCE against `Ops<T>` for the node twin (`tunnel-xray.node.ts`), which gets
 * it as a value (`material-maths.ts`'s `xray` slot); the vitest runs the same bodies on numbers. The GLSL below is unchanged and is
 * pinned to these constants by `tunnel-xray.node.test.ts`. Three places where the text differs, none in value:
 *  - `smoothstep(f + 0.4, f - 0.4, d)` has its edges REVERSED, which WGSL does not define. It is written `1 - smoothstep(f - 0.4,
 *    f + 0.4, d)`, which is the same curve (smoothstep(1 - t) = 1 - smoothstep(t)).
 *  - `pow(x, 2.0)` of a signed value is `x * x` (WGSL's `pow` is undefined for a negative base).
 *  - `grazing` is floored at 0, so rounding on a unit dot product cannot hand `pow` a negative base.
 * `mod` is not an `Ops` member: the scan band derives it from `floor` here, as GLSL defines it, `x - y * floor(x / y)`.
 */
const XRAY_SCAN_SPEED = 6;
const XRAY_SCAN_SPAN = 30;

/** The reveal front on route arc length `s`: distance from the sweep's origin, the fade behind the front, and the gaussian edge ON it. */
export function xrayRevealOps<T>(o: Ops<T>, s: T, origin: T, front: T, flash: T): { d: T; revealed: T; edge: T } {
  const d = o.abs(o.sub(s, origin));
  const revealed = o.sub(o.lit(1), o.smoothstep(o.sub(front, o.lit(0.4)), o.add(front, o.lit(0.4)), d));
  const k = o.mul(o.sub(front, d), o.lit(2.2));
  const edge = o.mul(o.exp(o.sub(o.lit(0), o.mul(k, k))), flash);
  return { d, revealed, edge };
}

/** The scan band: one gaussian at a time sweeping mouth to vent (30 tiles at 6 tiles/s, 5 s) of SIM time (`time`), on the bore only (`kind` 0). */
export function xrayScanOps<T>(o: Ops<T>, s: T, time: T, kind: T): T {
  const x = o.mul(time, o.lit(XRAY_SCAN_SPEED));
  const span = o.lit(XRAY_SCAN_SPAN);
  const band = o.sub(o.sub(x, o.mul(o.floor(o.div(x, span)), span)), o.lit(3));
  const k = o.mul(o.sub(s, band), o.lit(1.6));
  return o.mul(o.exp(o.sub(o.lit(0), o.mul(k, k))), o.sub(o.lit(1), kind));
}

/** What a style's fragment hands the output: linear rgb, alpha, and `keep` (1 draws, 0 is the shader's `discard`). */
export interface XrayOut<T> {
  readonly rgb: T;
  readonly a: T;
  readonly keep: T;
}

export interface XrayTubeIn<T> {
  /** The route's strength, then the reveal's three terms (`xrayRevealOps`). */
  readonly st: T;
  readonly revealed: T;
  readonly edge: T;
  readonly flash: T;
  /** `1 - abs(dot(n, toCam))`. */
  readonly grazing: T;
  /** `xrayScanOps`. */
  readonly scan: T;
  readonly rim: T;
  readonly core: T;
  readonly hot: T;
}

/** The bore and its shafts. */
export function xrayTubeOps<T>(o: Ops<T>, i: XrayTubeIn<T>): XrayOut<T> {
  const g = o.max(i.grazing, o.lit(0));
  const rim = o.pow(g, o.lit(4));
  const edgeIn = o.pow(g, o.lit(3));
  const lit = (n: number): T => o.lit(n);
  const t = o.clamp01(o.add(o.add(o.mul(edgeIn, lit(0.9)), rim), o.mul(i.scan, lit(0.7))));
  const base = o.mix(i.core, i.rim, t);
  const shown = o.mul(i.st, i.revealed);
  const a0 = o.mul(shown, o.add(o.add(o.add(lit(0.62), o.mul(edgeIn, lit(0.3))), o.mul(rim, lit(0.35))), o.mul(i.scan, lit(0.3))));
  const col = o.mix(base, i.hot, o.clamp01(i.edge));
  const a1 = o.max(o.mul(a0, o.add(lit(1), o.mul(lit(0.5), i.flash))), o.mul(i.edge, lit(0.9)));
  const gain = o.add(o.add(lit(1), o.mul(lit(1.4), i.edge)), o.mul(o.mul(lit(0.4), i.flash), i.revealed));
  return {
    rgb: o.mul(col, gain),
    a: o.clamp(a1, 0, 0.9),
    keep: o.max(o.step(lit(0.003), shown), o.step(lit(0.01), i.edge)),
  };
}

/** The surface collars; the vent's (`kind` 1) breathes on the sim clock. */
export function xrayCollarOps<T>(o: Ops<T>, st: T, d: T, front: T, kind: T, time: T, flash: T, rim: T, hot: T): XrayOut<T> {
  const revealed = o.step(d, front);
  const breathe = o.selectLt(o.lit(0.5), kind, o.add(o.lit(0.65), o.mul(o.lit(0.35), o.sin(o.mul(time, o.lit(3.4))))), o.lit(0.8));
  const a = o.mul(o.mul(st, revealed), breathe);
  return { rgb: o.mix(rim, hot, o.mul(flash, o.lit(0.6))), a, keep: o.step(o.lit(0.01), a) };
}

/** A fighter in the bore: a fresnel mix of his team colour. `alpha` is the instance's (`aAlpha`). */
export function xrayFigureOps<T>(o: Ops<T>, grazing: T, fig: T, alpha: T): XrayOut<T> {
  const fres = o.pow(o.max(grazing, o.lit(0)), o.lit(1.3));
  return {
    rgb: o.mix(o.mul(fig, o.lit(0.55)), o.mul(fig, o.lit(1.35)), fres),
    a: o.mul(alpha, o.add(o.lit(0.62), o.mul(o.lit(0.38), fres))),
    keep: o.step(o.lit(0.01), alpha),
  };
}

/** The finder's beam: a gradient on the cylinder's own `position.y` (0 at the finder, 1 at the route), `uA` its fading alpha. */
export function xrayBeamOps<T>(o: Ops<T>, y: T, hot: T, rim: T, uA: T): XrayOut<T> {
  return { rgb: o.mix(hot, rim, y), a: o.mul(uA, o.add(o.lit(0.35), o.mul(o.lit(0.65), y))), keep: o.lit(1) };
}

export interface XrayRoute {
  /** Samples XRAY_STEP apart along the route, in world tiles (tile centre). */
  readonly points: readonly (readonly [number, number])[];
  readonly length: number;
}

interface RouteGeom {
  centres: Float32Array; // xyz per sample
  xy: Float32Array; // xz per sample, for nearest-point search
  tangents: Float32Array;
  length: number;
}

export class TunnelXray {
  readonly group = new THREE.Group();
  readonly clock = new XrayRouteClock();
  private readonly tubeMat: THREE.ShaderMaterial;
  private readonly collarMat: THREE.ShaderMaterial;
  private readonly figureMat: THREE.ShaderMaterial;
  private readonly beamMat: THREE.ShaderMaterial;
  private tube: THREE.Mesh | null = null;
  private collars: THREE.Mesh | null = null;
  readonly figures: THREE.InstancedMesh;
  private readonly figureAlpha: THREE.InstancedBufferAttribute;
  readonly beam: THREE.Mesh;
  private routes: RouteGeom[] = [];
  private readonly beamFrom = new THREE.Vector3();
  private readonly beamTo = new THREE.Vector3();
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly scale = new THREE.Vector3(1.15, 1.15, 1.15);
  /** `setDebugLayerVisible('tunnel-xray')`: held here because `update`
   *  rewrites the figures' and beam's `visible` every frame. */
  private debugHidden = false;
  /** Some route has strength (or a sweep) this frame. */
  private anyLit = false;

  constructor(colors: XrayColors) {
    const lin = (h: string): THREE.Vector3 => new THREE.Vector3(...hexToLinear(h));
    const c = this.clock;
    const shared = {
      uRim: { value: lin(colors.rim) },
      uCore: { value: lin(colors.core) },
      uHot: { value: lin(colors.hot) },
      uTime: { value: 0 },
      uToCam: { value: VIEW_DIRECTION.clone().normalize() },
      // By reference: the clock's own arrays ARE the uniforms.
      uStrength: { value: c.strength },
      uOrigin: { value: c.origin },
      uFront: { value: c.front },
      uFlash: { value: c.flash },
    };
    const routeLookup = /* glsl */ `
      #define N ${XRAY_MAX_ROUTES}
      uniform float uStrength[N]; uniform float uOrigin[N]; uniform float uFront[N]; uniform float uFlash[N];
      void routeState(float route, out float st, out float o, out float f, out float fl) {
        int r = int(route + 0.5);
        st = 0.0; o = 0.0; f = 0.0; fl = 0.0;
        for (int i = 0; i < N; i++) { if (i == r) { st = uStrength[i]; o = uOrigin[i]; f = uFront[i]; fl = uFlash[i]; } }
      }`;
    this.tubeMat = new THREE.ShaderMaterial({
      // GH-943 P3 (T1): the legacy name the node twin table and the census key it by (`material-names.ts`); no program moves.
      name: 'rl-xray-tube',
      ...SILHOUETTE_MATERIAL_FLAGS,
      side: THREE.BackSide,
      uniforms: shared,
      vertexShader: /* glsl */ `
        attribute float aS; attribute float aRoute; attribute float aKind;
        varying float vS; varying float vKind; varying vec3 vN; varying float vRoute;
        void main() {
          vS = aS; vKind = aKind; vRoute = aRoute;
          vN = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uRim; uniform vec3 uCore; uniform vec3 uHot; uniform float uTime; uniform vec3 uToCam;
        ${routeLookup}
        varying float vS; varying float vKind; varying vec3 vN; varying float vRoute;
        void main() {
          float st; float o; float f; float fl;
          routeState(vRoute, st, o, f, fl);
          float d = abs(vS - o);
          float revealed = smoothstep(f + 0.4, f - 0.4, d);
          float edge = exp(-pow((f - d) * 2.2, 2.0)) * fl;
          if (st * revealed < 0.003 && edge < 0.01) discard;
          // One view vector for the whole ortho frame (camera.ts).
          float grazing = 1.0 - abs(dot(vN, uToCam));
          float rim = pow(grazing, 4.0);
          float edgeIn = pow(grazing, 3.0);
          // One scan band at a time, mouth -> vent, every 2.5 s.
          float band = mod(uTime * 6.0, 30.0) - 3.0;
          float scan = exp(-pow((vS - band) * 1.6, 2.0)) * (1.0 - vKind);
          vec3 col = mix(uCore, uRim, clamp(edgeIn * 0.9 + rim + scan * 0.7, 0.0, 1.0));
          float a = st * revealed * (0.62 + 0.3 * edgeIn + 0.35 * rim + 0.3 * scan);
          col = mix(col, uHot, clamp(edge, 0.0, 1.0));
          a = max(a * (1.0 + 0.5 * fl), edge * 0.9);
          gl_FragColor = vec4(col * (1.0 + 1.4 * edge + 0.4 * fl * revealed), clamp(a, 0.0, 0.9));
        }`,
    });
    this.collarMat = new THREE.ShaderMaterial({
      // GH-943 P3 (T1): the legacy name the node twin table and the census key it by (`material-names.ts`); no program moves.
      name: 'rl-xray-collar',
      transparent: true,
      depthTest: true,
      depthWrite: false,
      uniforms: shared,
      vertexShader: /* glsl */ `
        attribute float aRoute; attribute float aKind; attribute float aS;
        varying float vRoute; varying float vKind; varying float vS;
        void main() { vRoute = aRoute; vKind = aKind; vS = aS;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uRim; uniform vec3 uHot; uniform float uTime;
        ${routeLookup}
        varying float vRoute; varying float vKind; varying float vS;
        void main() {
          float st; float o; float f; float fl;
          routeState(vRoute, st, o, f, fl);
          float revealed = step(abs(vS - o), f);
          float breathe = vKind > 0.5 ? 0.65 + 0.35 * sin(uTime * 3.4) : 0.8;
          float a = st * revealed * breathe;
          if (a < 0.01) discard;
          gl_FragColor = vec4(mix(uRim, uHot, fl * 0.6), a);
        }`,
    });
    this.figureMat = new THREE.ShaderMaterial({
      // GH-943 P3 (T1): the legacy name the node twin table and the census key it by (`material-names.ts`); no program moves.
      name: 'rl-xray-figure',
      ...SILHOUETTE_MATERIAL_FLAGS,
      side: THREE.FrontSide,
      uniforms: { uFig: { value: lin(colors.figure) }, uToCam: shared.uToCam },
      vertexShader: /* glsl */ `
        attribute float aAlpha; varying float vAlpha; varying vec3 vN;
        void main() { vAlpha = aAlpha;
          vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uFig; uniform vec3 uToCam; varying float vAlpha; varying vec3 vN;
        void main() {
          if (vAlpha < 0.01) discard;
          float fres = pow(1.0 - abs(dot(vN, uToCam)), 1.3);
          gl_FragColor = vec4(mix(uFig * 0.55, uFig * 1.35, fres), vAlpha * (0.62 + 0.38 * fres));
        }`,
    });
    const fig = figureGeometry();
    this.figureAlpha = new THREE.InstancedBufferAttribute(new Float32Array(XRAY_MAX_FIGURES), 1);
    fig.setAttribute('aAlpha', this.figureAlpha);
    this.figures = new THREE.InstancedMesh(fig, this.figureMat, XRAY_MAX_FIGURES);
    this.figures.count = 0;
    this.figures.visible = false;
    this.figures.frustumCulled = false;
    this.figures.renderOrder = TUNNEL_XRAY_FIGURE_RENDER_ORDER;
    this.group.add(this.figures);

    const beamGeo = new THREE.CylinderGeometry(0.035, 0.11, 1, 8, 1, true);
    beamGeo.translate(0, 0.5, 0);
    this.beamMat = new THREE.ShaderMaterial({
      // GH-943 P3 (T1): the legacy name the node twin table and the census key it by (`material-names.ts`); no program moves.
      name: 'rl-xray-beam',
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: { uRim: shared.uRim, uHot: shared.uHot, uA: { value: 0 } },
      vertexShader: `varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: `uniform vec3 uRim; uniform vec3 uHot; uniform float uA; varying float vY;
        void main(){ gl_FragColor = vec4(mix(uHot, uRim, vY), uA * (0.35 + 0.65 * vY)); }`,
    });
    this.beam = new THREE.Mesh(beamGeo, this.beamMat);
    this.beam.visible = false;
    this.beam.frustumCulled = false;
    this.beam.renderOrder = TUNNEL_XRAY_BEAM_RENDER_ORDER;
    this.group.add(this.beam);
  }

  get routeCount(): number {
    return this.routes.length;
  }

  /** Route geometry is load-time data: built once per route set. */
  build(routes: readonly XrayRoute[], groundY: (x: number, y: number) => number): void {
    this.disposeRouteMeshes();
    const tubes: THREE.BufferGeometry[] = [];
    const collars: THREE.BufferGeometry[] = [];
    this.routes = [];
    routes.slice(0, XRAY_MAX_ROUTES).forEach((route, r) => {
      const n = route.points.length;
      const centres = new Float32Array(n * 3);
      const xy = new Float32Array(n * 2);
      const tangents = new Float32Array(n * 2);
      const gy = route.points.map(([x, y]) => groundY(x, y));
      for (let i = 0; i < n; i++) {
        const [x, y] = route.points[i];
        let sum = 0;
        let cnt = 0;
        for (let j = Math.max(0, i - SMOOTH); j <= Math.min(n - 1, i + SMOOTH); j++) {
          sum += gy[j];
          cnt++;
        }
        centres[i * 3] = x;
        centres[i * 3 + 1] = Math.min(sum / cnt - XRAY_BORE_DEPTH, gy[i] - RV - 0.12);
        centres[i * 3 + 2] = y;
        xy[i * 2] = x;
        xy[i * 2 + 1] = y;
        const a = route.points[Math.max(0, i - 1)];
        const b = route.points[Math.min(n - 1, i + 1)];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        tangents[i * 2] = (b[0] - a[0]) / l;
        tangents[i * 2 + 1] = (b[1] - a[1]) / l;
      }
      this.routes.push({ centres, xy, tangents, length: route.length });
      tubes.push(boreGeometry(centres, tangents, r));
      for (const [end, kind] of [
        [0, 0],
        [n - 1, 1],
      ] as const) {
        const cx = centres[end * 3];
        const cz = centres[end * 3 + 2];
        const top = groundY(cx, cz);
        const s = kind === 0 ? 0 : route.length;
        tubes.push(shaftGeometry(cx, centres[end * 3 + 1], top - 0.02, cz, r, s));
        collars.push(collarGeometry(cx, top + 0.03, cz, r, kind, s));
      }
    });
    if (tubes.length === 0) return;
    this.tube = new THREE.Mesh(mergeGeometries(tubes), this.tubeMat);
    this.tube.renderOrder = TUNNEL_XRAY_RENDER_ORDER;
    this.tube.frustumCulled = false;
    this.collars = new THREE.Mesh(mergeGeometries(collars), this.collarMat);
    this.collars.renderOrder = TUNNEL_XRAY_RENDER_ORDER;
    this.collars.frustumCulled = false;
    for (const g of [...tubes, ...collars]) g.dispose();
    this.group.add(this.tube, this.collars);
    this.applyDebugHidden();
  }

  /** The `tunnelContact` identified event for side 0. `finder` is where the
   *  observer stands, in world tiles and lift, or null for a route found
   *  through its spoil. */
  discover(r: number, nowS: number, finder: { x: number; y: number; liftY: number } | null): void {
    const rt = this.routes[r];
    if (!rt) return;
    const n = rt.centres.length / 3;
    const i = finder ? nearestSample(rt.xy, finder.x, finder.y) : Math.floor(n / 2);
    const first = this.clock.discover(r, nowS, Math.min(rt.length, i * XRAY_STEP));
    if (first && finder) {
      this.beamFrom.set(finder.x, finder.liftY, finder.y);
      this.beamTo.set(rt.centres[i * 3], rt.centres[i * 3 + 1] + RV, rt.centres[i * 3 + 2]);
    } else if (first) {
      this.clock.beamStartS = -1e9;
    }
  }

  /** Per frame, on the sim clock. `occupants` are (route, entity) pairs read
   *  from `state.tunnelIn`. */
  update(nowS: number, occupants: readonly (readonly [number, number])[]): void {
    const c = this.clock;
    c.step(nowS, this.routes.length);
    this.tubeMat.uniforms.uTime.value = nowS;
    // Nothing identified, nothing submitted: the bore and collars are one
    // draw each only while some route has strength or a sweep in flight.
    let any = false;
    for (let r = 0; r < this.routes.length; r++) if (c.strength[r] > 0.003 || c.flash[r] > 0.01) any = true;
    this.anyLit = any;
    this.applyDebugHidden();
    let n = 0;
    for (const [r, id] of occupants) {
      const rt = this.routes[r];
      if (!rt || n >= XRAY_MAX_FIGURES || c.strength[r] < 0.01) continue;
      const p = figureAlongRoute(id, r, rt.length, nowS);
      if (!c.revealed(r, p.s)) continue;
      const ns = rt.centres.length / 3;
      const fi = (p.s / Math.max(rt.length, 1e-6)) * (ns - 1);
      const i0 = Math.min(ns - 1, Math.floor(fi));
      const i1 = Math.min(ns - 1, i0 + 1);
      const w = fi - i0;
      const x = rt.centres[i0 * 3] * (1 - w) + rt.centres[i1 * 3] * w;
      const y = rt.centres[i0 * 3 + 1] * (1 - w) + rt.centres[i1 * 3 + 1] * w - RV * 0.82;
      const z = rt.centres[i0 * 3 + 2] * (1 - w) + rt.centres[i1 * 3 + 2] * w;
      this.q.setFromAxisAngle(this.up, Math.atan2(rt.tangents[i0 * 2] * p.dir, rt.tangents[i0 * 2 + 1] * p.dir));
      this.m4.compose(this.v.set(x, y + p.bob, z), this.q, this.scale);
      this.figures.setMatrixAt(n, this.m4);
      this.figureAlpha.array[n] = c.strength[r];
      n++;
    }
    this.figures.count = n;
    this.figures.visible = n > 0 && !this.debugHidden;
    this.figures.instanceMatrix.needsUpdate = true;
    this.figureAlpha.needsUpdate = true;

    const a = c.beamAlpha(nowS);
    if (a > 0 && !this.debugHidden) {
      const dir = this.v.subVectors(this.beamTo, this.beamFrom);
      const len = dir.length();
      this.beam.position.copy(this.beamFrom);
      this.beam.quaternion.setFromUnitVectors(this.up, dir.normalize());
      this.beam.scale.set(1, Math.max(1e-3, len), 1);
      this.beamMat.uniforms.uA.value = a;
      this.beam.visible = true;
    } else {
      this.beam.visible = false;
    }
  }

  /** How many meshes would be submitted this frame (each is one draw). */
  get drawCalls(): number {
    let n = 0;
    this.group.traverseVisible((o) => {
      if ((o as THREE.Mesh).isMesh) n++;
    });
    return n;
  }

  /** The `tunnel-xray` debug layer. Returns the meshes it governs (4). */
  setDebugHidden(hidden: boolean): number {
    this.debugHidden = hidden;
    this.applyDebugHidden();
    if (hidden) {
      this.figures.visible = false;
      this.beam.visible = false;
    }
    return 4;
  }

  private applyDebugHidden(): void {
    const show = this.anyLit && !this.debugHidden;
    if (this.tube) this.tube.visible = show;
    if (this.collars) this.collars.visible = show;
  }

  private disposeRouteMeshes(): void {
    for (const m of [this.tube, this.collars]) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.tube = null;
    this.collars = null;
  }

  dispose(): void {
    this.disposeRouteMeshes();
    this.figures.geometry.dispose();
    this.figures.dispose();
    this.beam.geometry.dispose();
    for (const m of [this.tubeMat, this.collarMat, this.figureMat, this.beamMat]) m.dispose();
  }
}

function withRouteAttrs(g: THREE.BufferGeometry, r: number, kind: number, sOf: (i: number) => number): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const aS = new Float32Array(n);
  for (let i = 0; i < n; i++) aS[i] = sOf(i);
  g.setAttribute('aRoute', new THREE.BufferAttribute(new Float32Array(n).fill(r), 1));
  g.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(n).fill(kind), 1));
  g.setAttribute('aS', new THREE.BufferAttribute(aS, 1));
  if (!g.getAttribute('normal')) g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  return g;
}

function boreGeometry(centres: Float32Array, tangents: Float32Array, r: number): THREE.BufferGeometry {
  const n = centres.length / 3;
  const pos = new Float32Array(n * RING * 3);
  const nor = new Float32Array(n * RING * 3);
  for (let i = 0; i < n; i++) {
    const sx = -tangents[i * 2 + 1];
    const sz = tangents[i * 2];
    for (let j = 0; j < RING; j++) {
      const a = (j / RING) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const o = (i * RING + j) * 3;
      pos[o] = centres[i * 3] + sx * c * RH;
      pos[o + 1] = centres[i * 3 + 1] + s * RV;
      pos[o + 2] = centres[i * 3 + 2] + sz * c * RH;
      const nx = (sx * c) / RH;
      const ny = s / RV;
      const nz = (sz * c) / RH;
      const l = Math.hypot(nx, ny, nz) || 1;
      nor[o] = nx / l;
      nor[o + 1] = ny / l;
      nor[o + 2] = nz / l;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < RING; j++) {
      const a = i * RING + j;
      const b = i * RING + ((j + 1) % RING);
      const c = (i + 1) * RING + j;
      const d = (i + 1) * RING + ((j + 1) % RING);
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  return withRouteAttrs(g, r, 0, (v) => Math.floor(v / RING) * XRAY_STEP);
}

function shaftGeometry(x: number, y0: number, y1: number, z: number, r: number, s: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(SHAFT_R, SHAFT_R, Math.max(0.05, y1 - y0), 12, 1, true);
  g.translate(x, (y0 + y1) / 2, z);
  return withRouteAttrs(g, r, 1, () => s);
}

function collarGeometry(x: number, y: number, z: number, r: number, kind: number, s: number): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(kind === 1 ? 0.3 : 0.22, kind === 1 ? 0.4 : 0.29, 24);
  g.rotateX(-Math.PI / 2);
  g.translate(x, y, z);
  return withRouteAttrs(g, r, kind, () => s);
}

/** A crouched figure, ~1.5 m (0.5 wu): torso, head, legs and a rifle. */
function figureGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const torso = new THREE.CylinderGeometry(0.055, 0.065, 0.2, 8);
  torso.rotateX(0.35);
  torso.translate(0, 0.27, 0.03);
  parts.push(torso);
  const head = new THREE.SphereGeometry(0.05, 10, 8);
  head.translate(0, 0.42, 0.08);
  parts.push(head);
  for (const side of [-1, 1]) {
    const leg = new THREE.CylinderGeometry(0.028, 0.03, 0.19, 6);
    leg.rotateX(side * 0.3);
    leg.translate(side * 0.04, 0.1, side * 0.03);
    parts.push(leg);
  }
  const rifle = new THREE.BoxGeometry(0.018, 0.018, 0.26);
  rifle.rotateX(-0.2);
  rifle.translate(0.06, 0.3, 0.12);
  parts.push(rifle);
  const flat = parts.map((p) => {
    p.deleteAttribute('uv');
    const out = p.index ? p.toNonIndexed() : p;
    if (out !== p) p.dispose();
    return out;
  });
  const merged = mergeGeometries(flat);
  for (const p of flat) p.dispose();
  return merged;
}
