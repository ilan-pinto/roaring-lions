/**
 * The held-building banner (lead ruling 2026-10-14: option B of the
 * held-building mock, `_coord/flag-mock/sheet.png`): a plain cloth banner in
 * the holder's team colour, hung from a rod on the building's camera-facing
 * wall. No insignia and no real flag -- the fictional-army rule.
 *
 * It replaces the held badge (a house glyph and a pip per man, drawn in the
 * overlay tier over the roof). Who holds a building is now a world object;
 * how many are inside is the HUD's (`ui/hud.ts`, "2 / 4 inside").
 *
 * WHERE: `banner-placement.ts` reads each building TYPE's standing template
 * once, when it loads, and returns the spot in template space. A structure
 * is that template scaled to its plot (`building-fit.ts`), so its banner is
 * the same spot scaled the same way -- `bannerMatrix` below -- and the cloth
 * keeps to the clean wall the search found, whatever the fit.
 *
 * HOW MANY DRAW CALLS: one `InstancedMesh` for every banner on the map, rod
 * and cloth merged (the cloth takes the per-instance team colour, the steel
 * its own vertex colour), so the cost is fixed whatever the count: one call
 * in the main pass, one in the sun's shadow pass and one in the AO pre-pass,
 * and none at all with no held building (the mesh hides). The mock measured
 * +3 for three banners; `tools/src/perf/garrison-banner-captures.ts` measures
 * the shipped one.
 *
 * Opaque, depth-tested world geometry stuck to a building, so it draws in the
 * buildings' own band (`GARRISON_BANNER_RENDER_ORDER`, an alias of
 * `WORLD_RENDER_ORDER`; `render-order.ts`'s table).
 *
 * THE SWAY is the foliage's (`../terrain/sway.ts`): the same sim clock,
 * shared by reference, and the same gust, as a slow swing out from the wall
 * growing toward the hem. A pinned tick repeats and a zero-time repaint
 * moves nothing. The shadow and AO passes keep the rest pose, as the crowns'
 * do (R-11). Presentation only -- nothing here reads or writes sim state.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { VIEW_DIRECTION } from '../camera';
import { paletteHex } from '../palette-hex';
import { WORLD_ROUGHNESS } from '../world-materials';
import { SWAY_GUST_EVERY_S, SWAY_GUST_GAIN, SWAY_GUST_WIDTH_S, SWAY_PHASE_X, SWAY_PHASE_Z } from '../terrain/sway';
import { BANNER_STANDOFF, placeBanner, type BannerSpot } from './banner-placement';
import type { FitScale } from './building-fit';
import { GARRISON_BANNER_RENDER_ORDER } from './render-order';

/** The rod and its brackets. */
const STEEL_KEY = 'gunmetal.1';
const STEEL_DARK_KEY = 'gunmetal.2';

/** Fold count across the cloth and their depth, unit cloth. */
const BANNER_FOLDS = 3;
const BANNER_FOLD_DEPTH = 0.012;
/** The swing out from the wall at the hem, world units, and its period. */
export const BANNER_SWAY = 0.03;
export const BANNER_SWAY_PERIOD_S = 3.8;

/**
 * The cloth's self-lit floor: emissive at this share of its own team-colour
 * albedo, cloth only (never the steel). A banner exists to say whose a
 * building is, and shade swallows team colour: the clinic's lands on its
 * shaded `+x` wall (its sunlit face is a porch), and a neighbour's shadow
 * does the same to any banner. Measured at zoom 2.5 on `khan_rafid`, mean
 * sRGB of the KDF cloth: the shaded clinic's (1, 12, 48) unlit becomes
 * (1, 43, 119) at 0.25 -- about what a SUNLIT banner reads with no floor,
 * (2, 50, 117) on the house, which itself goes to (4, 74, 160). At 0.4 the
 * sunlit cloth reads (12, 87, 177): more glow than shade needs.
 */
export const BANNER_GLOW = 0.25;

/** Every building can hold one; a map has a few dozen at most. */
const CAPACITY = 128;

/**
 * Stamps the per-vertex attributes every part carries, so the parts merge:
 * `color` (the steel's own, ignored where `aTeam` is 1), `aTeam` (0 steel,
 * 1 team cloth) and `aHem` (0 at the rod, 1 at the hem: how far the cloth
 * swings). Linear colour: `THREE.Color` decodes the palette's sRGB hex.
 */
function stamp(g: THREE.BufferGeometry, colorKey: string | null, team: number, hemOf: (y: number) => number): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const col = new Float32Array(n * 3);
  const c = colorKey ? new THREE.Color(paletteHex(colorKey)) : new THREE.Color(1, 1, 1);
  const aTeam = new Float32Array(n);
  const aHem = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    aTeam[i] = team;
    aHem[i] = hemOf(pos.getY(i));
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aTeam', new THREE.BufferAttribute(aTeam, 1));
  geo.setAttribute('aHem', new THREE.BufferAttribute(aHem, 1));
  return geo;
}

/**
 * The banner at UNIT size in its own frame: the rod along x at y = 0, the
 * cloth one unit wide (x in [-0.5, 0.5]) hanging one unit down (-y), its
 * face toward +z and `BANNER_STANDOFF` proud of the wall at z = 0. Each
 * instance scales x by the cloth's width and y by its drop
 * (`bannerMatrix`), so one geometry serves every building.
 */
export function buildBannerGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rigid = (): number => 0;
  const rodL = 1.08;
  const rod = new THREE.CylinderGeometry(0.012, 0.012, rodL, 12);
  rod.rotateZ(Math.PI / 2);
  rod.translate(0, 0, BANNER_STANDOFF);
  parts.push(stamp(rod, STEEL_KEY, 0, rigid));
  for (const side of [-1, 1]) {
    const cap = new THREE.SphereGeometry(0.018, 12, 8);
    cap.translate((side * rodL) / 2, 0, BANNER_STANDOFF);
    parts.push(stamp(cap, STEEL_KEY, 0, rigid));
    const bracket = new THREE.CylinderGeometry(0.008, 0.008, BANNER_STANDOFF, 8);
    bracket.rotateX(Math.PI / 2);
    bracket.translate((side * (rodL - 0.05)) / 2, 0, BANNER_STANDOFF / 2);
    parts.push(stamp(bracket, STEEL_DARK_KEY, 0, rigid));
  }
  // The sleeve the rod runs through (team colour, rigid).
  const sleeve = new THREE.CylinderGeometry(0.02, 0.02, 1, 16, 1, true);
  sleeve.rotateZ(Math.PI / 2);
  sleeve.translate(0, 0, BANNER_STANDOFF);
  parts.push(stamp(sleeve, null, 1, rigid));
  // The cloth: folds baked in, deeper toward the hem, 16 x 32 quads.
  const cloth = new THREE.PlaneGeometry(1, 1, 16, 32);
  cloth.translate(0, -0.5 - 0.015, BANNER_STANDOFF);
  const pos = cloth.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const v = Math.min(1, Math.max(0, -pos.getY(i)));
    const fold = Math.sin((x + 0.5) * Math.PI * 2 * BANNER_FOLDS) * BANNER_FOLD_DEPTH * (0.35 + 0.65 * v);
    // The hem's weight draws the bottom edge in a touch.
    pos.setZ(i, pos.getZ(i) + fold - 0.006 * v * v);
  }
  cloth.computeVertexNormals();
  parts.push(stamp(cloth, null, 1, (y) => Math.min(1, Math.max(0, -y))));
  // A weighted hem: a slim rod sewn into the bottom edge.
  const hem = new THREE.CylinderGeometry(0.008, 0.008, 1, 10);
  hem.rotateZ(Math.PI / 2);
  hem.translate(0, -1 - 0.015, BANNER_STANDOFF - 0.006);
  parts.push(stamp(hem, null, 1, () => 1));
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error('garrison-banner: banner parts did not merge');
  return merged;
}

/** A GLSL float literal (`../terrain/sway.ts`'s own rule: eight digits). */
function glsl(k: number): string {
  return k.toFixed(8);
}

/** The swing, in GLSL: out from the wall (never into it), a touch sideways,
 *  growing with the square of the distance down the cloth. The foliage's
 *  gust and per-instance phase, so a street of banners does not swing in
 *  lockstep. */
function swayChunk(): string {
  return `
  float rlPh = ${glsl(SWAY_PHASE_X)} * instanceMatrix[3].x + ${glsl(SWAY_PHASE_Z)} * instanceMatrix[3].z;
  float rlGustT = mod(uBannerTime, ${glsl(SWAY_GUST_EVERY_S)});
  float rlBump = 0.0;
  if (rlGustT < ${glsl(SWAY_GUST_WIDTH_S)}) {
    float rlB = sin(PI * rlGustT / ${glsl(SWAY_GUST_WIDTH_S)});
    rlBump = rlB * rlB;
  }
  float rlGust = 1.0 + (${glsl(SWAY_GUST_GAIN)} - 1.0) * rlBump;
  float rlS = uBannerAmp * ${glsl(BANNER_SWAY)} * rlGust * sin(PI2 * uBannerTime / ${glsl(BANNER_SWAY_PERIOD_S)} + rlPh);
  transformed.z += max(0.0, rlS) * aHem * aHem;
  transformed.x += 0.4 * rlS * aHem * aHem;
`;
}

export class GarrisonBannerBatch {
  readonly mesh: THREE.InstancedMesh;
  /** Sim-clock seconds, shared by reference with the crowns' sway. */
  readonly time: { value: number };
  /** 1 in play; 0 holds every cloth at rest. */
  readonly amp = { value: 1 };
  /** The cloth's self-lit floor, a share of its own albedo: see
   *  `BANNER_GLOW`. */
  readonly glow = { value: BANNER_GLOW };
  private readonly color = new THREE.Color();
  private debugHidden = false;
  /** What the buffers hold, so an unchanged frame uploads nothing. */
  private shown: { s: number; hex: string }[] = [];

  constructor(time: { value: number }, capacity = CAPACITY) {
    this.time = time;
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: WORLD_ROUGHNESS,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uBannerTime = this.time;
      shader.uniforms.uBannerAmp = this.amp;
      shader.uniforms.uBannerGlow = this.glow;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float uBannerTime;\nuniform float uBannerAmp;\nattribute float aTeam;\nattribute float aHem;\nvarying float vRlTeam;'
        )
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n#ifdef USE_INSTANCING\n${swayChunk()}\n#endif`)
        // The cloth takes the instance's team colour; the steel keeps its own.
        .replace('#include <color_vertex>', 'vColor = vec3(1.0);\nvColor *= mix(color, instanceColor.xyz, aTeam);\nvRlTeam = aTeam;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uBannerGlow;\nvarying float vRlTeam;')
        .replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * (uBannerGlow * vRlTeam);'
        );
    };
    material.customProgramCacheKey = () => 'rl-garrison-banner';
    this.mesh = new THREE.InstancedMesh(buildBannerGeometry(), material, capacity);
    this.mesh.name = 'garrison-banners';
    this.mesh.renderOrder = GARRISON_BANNER_RENDER_ORDER;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    // Instances are spread over the whole map; the bounding sphere of the
    // unit geometry at the origin would cull them all.
    this.mesh.frustumCulled = false;
    for (let i = 0; i < capacity; i++) this.mesh.setColorAt(i, this.color.setRGB(1, 1, 1));
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  /**
   * This frame's banners: a world matrix and a team-colour hex each, keyed
   * by structure index. Uploads only when the set, or a colour, changed --
   * a building never moves, so the matrix of a structure that stays held
   * never does either.
   */
  update(entries: readonly { readonly s: number; readonly matrix: THREE.Matrix4; readonly hex: string }[]): void {
    const n = Math.min(entries.length, this.mesh.instanceMatrix.count);
    let same = n === this.shown.length;
    for (let i = 0; same && i < n; i++) {
      if (entries[i].s !== this.shown[i].s || entries[i].hex !== this.shown[i].hex) same = false;
    }
    if (!same) {
      this.shown = [];
      for (let i = 0; i < n; i++) {
        this.mesh.setMatrixAt(i, entries[i].matrix);
        this.mesh.setColorAt(i, this.color.set(entries[i].hex));
        this.shown.push({ s: entries[i].s, hex: entries[i].hex });
      }
      this.mesh.count = n;
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
    this.mesh.visible = n > 0 && !this.debugHidden;
  }

  /** The `garrison-banner` debug layer: a FLAG, because `update` writes
   *  `visible` every frame (`debug-layers.ts`, the `units` rule). Returns 1,
   *  the one mesh it governs. */
  setDebugHidden(hidden: boolean): number {
    this.debugHidden = hidden;
    this.mesh.visible = this.mesh.count > 0 && !hidden;
    return 1;
  }

  /** How many banners the last `update` drew. */
  get count(): number {
    return this.mesh.count;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}

/** A template's triangles in template space (its root's world matrix, which
 *  carries `MESH_SCALE`), as the flat list `placeBanner` reads. */
export function templateTriangles(root: THREE.Object3D): Float32Array {
  root.updateMatrixWorld(true);
  const chunks: Float32Array[] = [];
  let total = 0;
  const v = new THREE.Vector3();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position');
    if (!pos) return;
    const index = geo.getIndex();
    const count = index ? index.count : pos.count;
    const out = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
      out[i * 3] = v.x;
      out[i * 3 + 1] = v.y;
      out[i * 3 + 2] = v.z;
    }
    chunks.push(out);
    total += out.length;
  });
  const tris = new Float32Array(total);
  let at = 0;
  for (const c of chunks) {
    tris.set(c, at);
    at += c.length;
  }
  return tris;
}

/** The banner spot for a standing template, lit by `sun` (toward the sun,
 *  normalised: `sunDirectionFor` of the map's light). */
export function bannerSpotFor(root: THREE.Object3D, sun: readonly [number, number, number]): BannerSpot | null {
  return placeBanner(templateTriangles(root), {
    view: [VIEW_DIRECTION.x, VIEW_DIRECTION.y, VIEW_DIRECTION.z],
    sun,
  });
}

const YAW = { '+z': 0, '+x': Math.PI / 2 } as const;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * One structure's banner, as an instance matrix: its template `spot` moved
 * to the clone standing at `at` and scaled by the clone's own `fit`. The
 * cloth's width follows the face's own plan scale, its drop the height
 * scale, so it covers exactly the wall the search cleared on the fitted
 * building too.
 */
export function bannerMatrix(spot: BannerSpot, at: THREE.Vector3, fit: FitScale, out = new THREE.Matrix4()): THREE.Matrix4 {
  const lateral = spot.face === '+z' ? fit.sx : fit.sz;
  return out.compose(
    new THREE.Vector3(at.x + spot.x * fit.sx, at.y + spot.y * fit.sy, at.z + spot.z * fit.sz),
    new THREE.Quaternion().setFromAxisAngle(UP, YAW[spot.face]),
    new THREE.Vector3(spot.width * lateral, spot.drop * fit.sy, 1)
  );
}
