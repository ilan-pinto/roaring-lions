/**
 * The valley backdrop: relief BEYOND the map, so a Wadi Halam frame reads as
 * the floor of a mountain valley (PROTOTYPE, Lane B "Wadi Halam look",
 * 2026-10-25; `_coord/wadi-halam-look/proposal.md` is the record).
 *
 * Presentation only. Nothing here is read by the sim, by picking or by any
 * gate pin: it replaces `skirt.ts`'s flat dark ring on a map whose JSON
 * carries a `backdrop` block, and on every other map nothing changes.
 *
 * Four rules shape it, each the answer to a way it could hurt play.
 *
 * 1. **It never covers the playable lozenge.** The camera looks down at 30
 *    degrees along (+1, +1) in world x/z (`camera.ts`'s VIEW_DIRECTION). A
 *    point beyond the FAR edges (x < 0 or z < 0) can never stand between the
 *    camera and the map, so the walls there rise as steeply as they like. A
 *    point beyond the NEAR edges can, exactly when the ray from it back along
 *    (-1, 0, -1) enters the map: it then hides map ground at the entry point
 *    once it stands more than `t0 * sqrt2 * tan30 = 0.816 t0` above it, `t0`
 *    tiles out. `NEAR_CAP_SLOPE` holds those points to 0.45 t0 -- 55% of the
 *    limit, which leaves a 2-tile-tall unit's head clear at t0 >= 6 and the
 *    ground clear everywhere. The near walls therefore read as a long rising
 *    foreground slope, and the far walls carry the cliffs.
 * 2. **It casts no shadow and takes none**, like the skirt: the shadow box is
 *    fitted to the view, and a 14-unit wall beyond the west edge under the
 *    side sun (from -x) would lay a 7-tile band of shade across play.
 * 3. **It is the fog of war's "explored" ground, not never-seen.** The fog
 *    pass's off-map fade goes to `BACKDROP_OFFMAP_SEEN` instead of 0 when a
 *    backdrop is on (see `fog-pass.ts`), so the valley walls are lit scenery
 *    -- dimmed and desaturated a little, which also pushes them back behind
 *    play -- rather than a black frame. No information lives out there.
 * 4. **It is cheap and built once.** One 1-tile grid mesh (~37k triangles on
 *    a 48x48 map, one draw call, no AO-relevant transparency), one baked
 *    colour texture at `TEXELS_PER_TILE`, and one instanced batch of
 *    village houses (one more draw call). Built when the map's elevation
 *    arrives; never touched per frame.
 *
 * Colour: every tone is a palette key (`paletteHex`), mixed in sRGB in the
 * bake, and the texture is `SRGBColorSpace` like every base-colour map.
 * Noise is the repo's own hand-rolled value noise (`noise.ts`), seeded from
 * the map's block, so a backdrop is identical on every load.
 */
import * as THREE from 'three';
import { fbm2, valueNoise2 } from './noise';
import { tileHash } from '../../tile-hash';
import { hexToUnit, hexToLinear, WORLD_PER_LEVEL } from './shared';
import { paletteHex } from '../palette-hex';
import { WORLD_RENDER_ORDER } from '../units/render-order';

/** A map's `backdrop` block (map.schema.json), as the renderer reads it. */
export interface BackdropSpec {
  /** The valley's axis in MAP terms. `ns` runs along the rows (world z): the
   *  walls rise beyond the west and east edges, the valley climbs to a gorge
   *  beyond the north edge and opens beyond the south. `ew` swaps them. */
  readonly valley: 'ns' | 'ew';
  /** Crest height above the valley floor, in elevation levels. */
  readonly crest: number;
  /** Noise seed. */
  readonly seed: number;
  /** Hamlets of red-roofed houses on the lower slopes. */
  readonly hamlets: number;
}

/** World Y of the map's drawn ground at a point inside `[0,w]x[0,h]`. */
export type RimHeight = (x: number, z: number) => number;

/** How far the backdrop reaches past each edge, in map widths (the skirt's
 *  own extent, `skirt.ts`'s SKIRT_EXTENT 3 => one map out each way). */
const MARGIN_MAPS = 1;
/** Colour texels per tile in the bake. 6 => 864x864 on a 48x48 map. */
export const TEXELS_PER_TILE = 6;
/** See rule 1 in the header: 55% of the 0.816 occlusion slope. */
export const NEAR_CAP_SLOPE = 0.45;
/** The fog pass's off-map value while a backdrop is on (0 never seen, 0.5
 *  explored, 1 in sight). 0.5 is a rule, not a taste: scenery is shown as
 *  explored ground -- dimmer than anything in sight, brighter than ground the
 *  player has never seen, so the unexplored play area never reads as a hole
 *  in a brighter frame. */
export const BACKDROP_OFFMAP_SEEN = 0.5;

/** Tiles past the north end before the gorge is shut by its head wall. */
const HEAD_GAP = 5;
/** Tiles past the south end before the floor climbs. */
const MOUTH_GAP = 8;
/** How fast each wall closes in per tile beyond the upstream end (and opens
 *  out downstream). */
const narrowAt = (v: number, V: number): number => (v < 0 ? 0.5 * Math.min(-v, 24) : v > V ? -0.25 * (v - V) : 0);

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
type Rgb = [number, number, number];
const mix3 = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const tone = (key: string): Rgb => hexToUnit(paletteHex(key));

/** The fields one point of the backdrop carries: height, and what the bake
 *  needs to colour it. */
interface Sample {
  y: number;
  /** Height above the valley floor under it. */
  rel: number;
  /** Tiles up the wall (0 on the valley floor). */
  up: number;
  /** Tiles from the map rectangle. */
  out: number;
  /** Along-valley coordinate (streaks run across it). */
  along: number;
  /** 1 where the near-side cap bit. */
  capped: number;
}

/**
 * The height field. Pure: the same spec, rim and map size always give the
 * same surface.
 */
export function backdropField(spec: BackdropSpec, rim: RimHeight, w: number, h: number): (x: number, z: number) => Sample {
  const seed = spec.seed | 0;
  const ns = spec.valley === 'ns';
  const U = ns ? w : h;
  const V = ns ? h : w;
  // The rim's mean along the four edges: where the floor settles a few tiles
  // out, so a building pad or a one-tile spike on the edge does not run on
  // across the whole backdrop.
  let rimSum = 0;
  let rimN = 0;
  for (let i = 0; i <= w; i++) {
    rimSum += rim(i, 0) + rim(i, h);
    rimN += 2;
  }
  for (let j = 0; j <= h; j++) {
    rimSum += rim(0, j) + rim(w, j);
    rimN += 2;
  }
  const rimMean = rimSum / rimN;
  // The authored crest over the profile's own raw crest (13.4 at scale 1).
  const scale = (Math.max(4, spec.crest) * WORLD_PER_LEVEL) / 13.4;

  const wall = (up: number, v: number): number => {
    if (up <= 0) return 0;
    const c1 = 7.5 + 2.0 * valueNoise2(v, 0.5, 1 / 23, seed + 11);
    const c2 = 15 + 3.0 * valueNoise2(v, 1.5, 1 / 31, seed + 12);
    let y = 0.3 * Math.min(up, 6); // the terraced foot
    y += 3.5 * smooth(c1 - 0.7, c1 + 0.7, up); // the first limestone cliff
    y += 0.42 * clamp(up - c1, 0, 22 - c1); // the scrub slope above it
    y += 2.0 * smooth(c2 - 0.5, c2 + 0.5, up); // the upper band
    y += 0.08 * Math.max(0, up - 22); // the back of the crest
    y += 1.5 * fbm2(up, v, 14, 3, seed + 3) * smooth(18, 26, up);
    y *= 1 + 0.22 * fbm2(v, 7.5, 40, 2, seed + 4);
    // Ravines: narrow cuts where an along-valley noise crosses zero, deeper
    // up the wall, never in the foot -- the gorges of the reference photos.
    const q = valueNoise2(v, 3.5, 1 / 11, seed + 5);
    const gully = smooth(0.86, 1, 1 - Math.abs(q));
    y -= gully * 0.38 * y * smooth(3, 12, up);
    return y * scale;
  };

  return (x: number, z: number): Sample => {
    const u = ns ? x : z;
    const v = ns ? z : x;
    // The valley narrows to a gorge upstream (v < 0, always a far side) and
    // opens downstream (v > V, always a near side). Past HEAD_GAP tiles the
    // gorge is shut by a head wall, so the upstream end is a cirque and not
    // a plain running off the frame; downstream the floor climbs again past
    // MOUTH_GAP, the long foreground ramp rule 1 allows.
    const narrow = narrowAt(v, V);
    const lo = narrow;
    const hi = U - narrow;
    const sideUp = Math.max(lo - u, u - hi, 0);
    const headUp = v < -HEAD_GAP ? -v - HEAD_GAP : 0;
    const mouthUp = v > V + MOUTH_GAP ? (v - V - MOUTH_GAP) * 0.7 : 0;
    // The tallest of the three decides the wall; its own along-coordinate
    // keeps ravines and strata running the right way on each.
    const up = Math.max(sideUp, headUp, mouthUp);
    const coord = up === sideUp ? v : u + 31.7;
    const ox = Math.max(-x, x - w, 0);
    const oz = Math.max(-z, z - h, 0);
    const out = Math.hypot(ox, oz);
    const cx = clamp(x, 0, w);
    const cz = clamp(z, 0, h);
    const base = rim(cx, cz) + (rimMean - rim(cx, cz)) * smooth(0, 10, out);
    const floorY = base + (v < 0 ? 0.1 * Math.min(-v, HEAD_GAP) : v > V ? -0.05 * Math.min(v - V, MOUTH_GAP) : 0) + 0.3 * fbm2(x, z, 18, 2, seed + 6) * smooth(0, 6, out);
    let y = floorY + wall(up, coord) + 0.25 * fbm2(x, z, 5, 3, seed + 7) * smooth(0, 3, out);
    // Rule 1: hold a near-side point under the camera's line to the map.
    let capped = 0;
    const t0 = Math.max(x - w, z - h);
    if (t0 > 0) {
      const ex = x - t0;
      const ez = z - t0;
      const miss = Math.min(ex, ez); // < 0: the ray passes beside the map
      const weight = smooth(-6, 0, miss);
      if (weight > 0) {
        const cap = rim(clamp(ex, 0, w), clamp(ez, 0, h)) + NEAR_CAP_SLOPE * t0;
        if (y > cap) {
          capped = weight;
          y += (cap - y) * weight;
        }
      }
    }
    return { y, rel: y - floorY, up, out, along: coord, capped };
  };
}

/** The highest a house top may stand at `(x, z)` (rule 1), or Infinity. */
function nearCap(rim: RimHeight, w: number, h: number, x: number, z: number): number {
  const t0 = Math.max(x - w, z - h);
  if (t0 <= 0) return Infinity;
  const ex = x - t0;
  const ez = z - t0;
  if (Math.min(ex, ez) < -6) return Infinity;
  return rim(clamp(ex, 0, w), clamp(ez, 0, h)) + NEAR_CAP_SLOPE * t0;
}

export interface Backdrop {
  readonly group: THREE.Group;
  readonly stats: { readonly triangles: number; readonly houses: number; readonly bakeMs: number; readonly texels: number };
}

/**
 * Build the backdrop for a `w` x `h` map. `rim` samples the map's drawn
 * ground; call again (and dispose the old one) if the elevation changes.
 */
export function buildBackdrop(spec: BackdropSpec, rim: RimHeight, w: number, h: number, background: string): Backdrop {
  const t0 = performance.now();
  const field = backdropField(spec, rim, w, h);
  const M = Math.round(Math.max(w, h) * MARGIN_MAPS);
  const x0 = -M;
  const z0 = -M;
  const nx = w + 2 * M + 1;
  const nz = h + 2 * M + 1;
  const samples: Sample[] = new Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) samples[j * nx + i] = field(x0 + i, z0 + j);
  }
  const at = (i: number, j: number): Sample => samples[clamp(j, 0, nz - 1) * nx + clamp(i, 0, nx - 1)];

  // --- geometry: the grid minus the map's own footprint ----------------
  const positions = new Float32Array(nx * nz * 3);
  const normals = new Float32Array(nx * nz * 3);
  const uvs = new Float32Array(nx * nz * 2);
  const n = new THREE.Vector3();
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = x0 + i;
      const z = z0 + j;
      const s = samples[k];
      // The ring that meets the map sits a hair under its rim, so the two
      // never z-fight along the boundary (`skirt.ts`'s MARK_EPSILON reason).
      const onRim = x >= 0 && x <= w && z >= 0 && z <= h;
      positions[k * 3] = x;
      positions[k * 3 + 1] = onRim ? s.y - 0.01 : s.y;
      positions[k * 3 + 2] = z;
      const dx = at(i + 1, j).y - at(i - 1, j).y;
      const dz = at(i, j + 1).y - at(i, j - 1).y;
      n.set(-dx, 2, -dz).normalize();
      normals[k * 3] = n.x;
      normals[k * 3 + 1] = n.y;
      normals[k * 3 + 2] = n.z;
      uvs[k * 2] = i / (nx - 1);
      uvs[k * 2 + 1] = j / (nz - 1);
    }
  }
  const index: number[] = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const cx = x0 + i;
      const cz = z0 + j;
      if (cx >= 0 && cx < w && cz >= 0 && cz < h) continue; // the map's own tile
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      // Front faces up (+Y), the winding `skirt.ts` documents.
      index.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(index), 1));

  // --- the colour bake ---------------------------------------------------
  const T = TEXELS_PER_TILE;
  const tw = (nx - 1) * T;
  const th = (nz - 1) * T;
  const data = new Uint8Array(tw * th * 4);
  const scrubDark = tone('scrub.1');
  const scrub = tone('scrub.0');
  const oliveDark = tone('olive.2');
  const pasture0 = tone('grass.0');
  const pasture1 = tone('grass.1');
  const grass = tone('grass.3');
  const grassDeep = tone('grass.4');
  const terraceWall = tone('limestone.5');
  const rockLit = tone('limestone.2');
  const rock = tone('limestone.3');
  const rockDeep = tone('limestone.5');
  const bare = tone('karst.1');
  const bareDeep = tone('karst.2');
  const scree = tone('limestone.2');
  const sky = tone('water.0');
  const crestWu = Math.max(4, spec.crest) * WORLD_PER_LEVEL;
  // Slope per vertex (central difference), box-blurred twice: a per-quad
  // gradient made the 'steep face' switch step along the 1-tile grid, which
  // read as pixel staircases on every cliff edge.
  let slopeGrid = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      slopeGrid[j * nx + i] = Math.hypot((at(i + 1, j).y - at(i - 1, j).y) / 2, (at(i, j + 1).y - at(i, j - 1).y) / 2);
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        let acc = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) acc += slopeGrid[clamp(j + dj, 0, nz - 1) * nx + clamp(i + di, 0, nx - 1)];
        next[j * nx + i] = acc / 9;
      }
    }
    slopeGrid = next;
  }
  for (let ty = 0; ty < th; ty++) {
    const gj = ty / T;
    const j = Math.floor(gj);
    const fj = gj - j;
    for (let tx = 0; tx < tw; tx++) {
      const gi = tx / T;
      const i = Math.floor(gi);
      const fi = gi - i;
      const s00 = at(i, j);
      const s10 = at(i + 1, j);
      const s01 = at(i, j + 1);
      const s11 = at(i + 1, j + 1);
      const bl = (f: (s: Sample) => number): number =>
        (f(s00) * (1 - fi) + f(s10) * fi) * (1 - fj) + (f(s01) * (1 - fi) + f(s11) * fi) * fj;
      const y = bl((s) => s.y);
      const rel = bl((s) => s.rel);
      const up = bl((s) => s.up);
      const out = bl((s) => s.out);
      const along = bl((s) => s.along);
      const slope = (slopeGrid[j * nx + i] * (1 - fi) + slopeGrid[j * nx + Math.min(nx - 1, i + 1)] * fi) * (1 - fj) +
        (slopeGrid[Math.min(nz - 1, j + 1) * nx + i] * (1 - fi) + slopeGrid[Math.min(nz - 1, j + 1) * nx + Math.min(nx - 1, i + 1)] * fi) * fj;
      const wx = x0 + gi;
      const wz = z0 + gj;
      const n1 = fbm2(wx, wz, 9, 2, spec.seed + 21);
      const n2 = valueNoise2(wx, wz, 1 / 3.5, spec.seed + 22);
      // Maquis: dark scrub with lighter patches and olive-grey clearings.
      let col = mix3(scrubDark, scrub, smooth(-0.3, 0.5, n1));
      col = mix3(col, oliveDark, smooth(0.35, 0.7, n2) * 0.6);
      // The valley floor beyond the map: pasture, with the odd tree.
      const floorish = 1 - smooth(0.2, 1.5, up);
      // Fine grain so zoom 2.5 at the rim does not meet a smooth wash: a
      // ~1-tile mottle and a sparse flecking of darker sward.
      const n3 = valueNoise2(wx, wz, 1 / 1.1, spec.seed + 26);
      let pas = mix3(pasture0, pasture1, smooth(-0.4, 0.4, n1));
      pas = mix3(pas, grassDeep, smooth(0.25, 0.7, n3) * 0.28);
      col = mix3(col, pas, floorish * 0.9);
      // The terraced foot: treads of grass, dry-stone risers, olive dots.
      const foot = smooth(0.4, 1.2, up) * (1 - smooth(5.5, 7, up)) * (1 - smooth(0.7, 1.1, slope));
      if (foot > 0) {
        // Terraces follow the wall's own contour (distance up the wall plus a
        // slow wobble), not the noisy height, whose 1-tile bumps made the
        // risers step like pixel stairs.
        const phase = up / 1.5 + 0.6 * valueNoise2(along, up, 1 / 9, spec.seed + 30);
        const tIdx = Math.floor(phase);
        const tf = phase - tIdx;
        const tread = tileHash(tIdx, Math.floor(along / 9)) < 0.5 ? grass : grassDeep;
        let t = tf < 0.16 ? terraceWall : tread;
        if (tf >= 0.16) {
          // Olive trees: one soft dot per 1.7-tile cell (hash-jittered), not a
          // per-texel scatter -- that read as a checkerboard at zoom 1.
          const cx = Math.floor(wx / 1.7);
          const cz = Math.floor(wz / 1.7);
          if (tileHash(cx, cz + 91) < 0.55) {
            const px = (cx + 0.2 + 0.6 * tileHash(cx + 7, cz)) * 1.7;
            const pz = (cz + 0.2 + 0.6 * tileHash(cx, cz + 13)) * 1.7;
            const d = Math.hypot(wx - px, wz - pz);
            t = mix3(t, d < 0.3 ? oliveDark : scrubDark, 1 - smooth(0.2, 0.42, d));
          }
        }
        col = mix3(col, t, foot);
      }
      // Limestone: steep faces, banded by strata.
      const rocky = smooth(1.0, 1.7, slope);
      if (rocky > 0) {
        const band = (y / 0.55) % 1;
        const r = band < 0.33 ? rockLit : band < 0.8 ? rock : rockDeep;
        col = mix3(col, r, rocky);
      }
      // The bare upper wall: grey karst over the crest band.
      const high = smooth(0.5, 0.85, rel / crestWu) * smooth(4, 14, up);
      col = mix3(col, mix3(bare, bareDeep, smooth(-0.2, 0.6, n1)), high * 0.85);
      // Scree: pale streaks running down the wall below the cliffs and on
      // the bare crest, a narrow across-valley stripe broken by noise.
      const streakZone = smooth(5, 9, up) * (1 - rocky * 0.7);
      if (streakZone > 0) {
        const lane = Math.floor(along * 1.6 + 1.2 * valueNoise2(up, along, 1 / 6, spec.seed + 23));
        const on = tileHash(lane, spec.seed + 77) > 0.84 ? 1 : 0;
        const broken = smooth(-0.1, 0.4, valueNoise2(along, up, 1 / 4, spec.seed + 24));
        col = mix3(col, scree, on * broken * streakZone * 0.6);
      }
      // Macro value variation, then aerial perspective toward the sky tone.
      const macro = 1 + 0.07 * fbm2(wx, wz, 22, 2, spec.seed + 25);
      col = [col[0] * macro, col[1] * macro, col[2] * macro];
      col = mix3(col, sky, 0.3 * smooth(10, 60, out));
      const o = (ty * tw + tx) * 4;
      data[o] = clamp(Math.round(col[0] * 255), 0, 255);
      data[o + 1] = clamp(Math.round(col[1] * 255), 0, 255);
      data[o + 2] = clamp(Math.round(col[2] * 255), 0, 255);
      data[o + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, tw, th, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  // DataTexture rows run bottom-up in GL; the uv above already maps j -> v.
  texture.flipY = false;

  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 });
  fadeToBackground(material, w, h, M, background);
  const ground = new THREE.Mesh(geometry, material);
  ground.name = 'backdrop-ground';
  ground.renderOrder = WORLD_RENDER_ORDER;
  ground.castShadow = false;
  ground.receiveShadow = false;
  ground.frustumCulled = false;

  const group = new THREE.Group();
  group.name = 'backdrop';
  group.add(ground);

  // --- hamlets ------------------------------------------------------------
  const houses = placeHouses(spec, field, rim, w, h, M);
  if (houses.length > 0) {
    const houseGeo = houseGeometry();
    const houseMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    fadeToBackground(houseMat, w, h, M, background);
    const inst = new THREE.InstancedMesh(houseGeo, houseMat, houses.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (let k = 0; k < houses.length; k++) {
      const hs = houses[k];
      q.setFromAxisAngle(up, hs.yaw);
      m.compose(new THREE.Vector3(hs.x, hs.y, hs.z), q, new THREE.Vector3(hs.size, hs.tall, hs.size));
      inst.setMatrixAt(k, m);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.name = 'backdrop-houses';
    inst.renderOrder = WORLD_RENDER_ORDER;
    inst.castShadow = false;
    inst.receiveShadow = false;
    inst.frustumCulled = false;
    group.add(inst);
  }

  return {
    group,
    stats: { triangles: index.length / 3 + houses.length * 14, houses: houses.length, bakeMs: performance.now() - t0, texels: tw * th },
  };
}

/**
 * The mesh ends `M` tiles out and the camera, at minimum zoom, sees past that
 * on the near sides (the ramp lifts its own far edge up the screen), so an
 * unfaded edge is a hard line against the clear colour. Fade the lit colour
 * to the scene background over the outer 40% of the margin, in the fragment
 * shader and in linear light (the colour pass is HalfFloat, tone-mapped
 * later), so the edge is exactly the background and never a step.
 */
function fadeToBackground(mat: THREE.MeshStandardMaterial, w: number, h: number, M: number, background: string): void {
  const bg = hexToLinear(background);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uBdBg = { value: new THREE.Vector3(bg[0], bg[1], bg[2]) };
    shader.uniforms.uBdSize = { value: new THREE.Vector2(w, h) };
    shader.uniforms.uBdFade = { value: new THREE.Vector2(M * 0.55, M * 0.98) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vBdXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\n  vBdXZ = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xz;\n#else\n  vBdXZ = (modelMatrix * vec4(position, 1.0)).xz;\n#endif');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vBdXZ;\nuniform vec3 uBdBg;\nuniform vec2 uBdSize;\nuniform vec2 uBdFade;')
      .replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\n  {\n    vec2 bdOut = max(vec2(0.0), max(-vBdXZ, vBdXZ - uBdSize));\n    float bdF = smoothstep(uBdFade.x, uBdFade.y, length(bdOut));\n    gl_FragColor.rgb = mix(gl_FragColor.rgb, uBdBg, bdF);\n  }'
      );
  };
}

interface House {
  x: number;
  y: number;
  z: number;
  yaw: number;
  size: number;
  tall: number;
}

/** Hamlets on the lower slopes of both walls and on the open floor
 *  downstream, each 6-13 houses stepping up the slope. Deterministic. */
function placeHouses(spec: BackdropSpec, field: (x: number, z: number) => Sample, rim: RimHeight, w: number, h: number, M: number): House[] {
  const out: House[] = [];
  const ns = spec.valley === 'ns';
  const U = ns ? w : h;
  const V = ns ? h : w;
  const rnd = (a: number, b: number): number => tileHash(a * 131 + spec.seed, b * 197 - spec.seed);
  for (let k = 0; k < spec.hamlets; k++) {
    // Alternate walls; spread along the valley from the gorge to the mouth.
    const side = k % 2 === 0 ? -1 : 1;
    const along = -M * 0.55 + (V + M * 1.1) * ((k + 0.5) / spec.hamlets) + (rnd(k, 1) - 0.5) * 8;
    const narrow = narrowAt(along, V);
    const across = side < 0 ? narrow - (2.5 + rnd(k, 2) * 3) : U - narrow + (2.5 + rnd(k, 2) * 3);
    const count = 6 + Math.floor(rnd(k, 3) * 8);
    for (let m = 0; m < count; m++) {
      const du = (rnd(k * 17 + m, 4) - 0.5) * 6;
      const dv = (rnd(k * 17 + m, 5) - 0.5) * 7;
      const u = across + du;
      const v = along + dv;
      const x = ns ? u : v;
      const z = ns ? v : u;
      if (x > -1 && x < w + 1 && z > -1 && z < h + 1) continue; // never on or at the map
      const s = field(x, z);
      if (s.up < 0.6 || s.up > 7.5) continue; // the foot only
      const g = Math.abs(field(x + 0.7, z).y - field(x - 0.7, z).y) + Math.abs(field(x, z + 0.7).y - field(x, z - 0.7).y);
      if (g > 1.4) continue; // not on a cliff
      const size = 0.85 + rnd(k * 17 + m, 6) * 0.5;
      const tall = 0.6 + rnd(k * 17 + m, 7) * 0.4;
      if (s.y + tall + 0.6 > nearCap(rim, w, h, x, z)) continue; // rule 1
      out.push({ x, y: s.y - 0.12, z, yaw: (ns ? 0 : Math.PI / 2) + (rnd(k * 17 + m, 8) - 0.5) * 0.5, size, tall });
    }
  }
  return out;
}

/** A unit house: a limestone box with a terracotta hip roof, vertex
 *  coloured (linear, like every vertex colour in this backend), one
 *  geometry for the whole instanced batch. 14 triangles. */
function houseGeometry(): THREE.BufferGeometry {
  const wall = hexToLinear(paletteHex('limestone.2'));
  const wallShade = hexToLinear(paletteHex('limestone.4'));
  const roof = hexToLinear(paletteHex('terracotta.0'));
  const pos: number[] = [];
  const col: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], cc: readonly number[]): void => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < 6; i++) col.push(cc[0], cc[1], cc[2]);
  };
  const H = 1;
  const r = 0.5;
  // Four walls, outward-facing.
  quad([-r, 0, r], [r, 0, r], [r, H, r], [-r, H, r], wall);
  quad([r, 0, -r], [-r, 0, -r], [-r, H, -r], [r, H, -r], wallShade);
  quad([r, 0, r], [r, 0, -r], [r, H, -r], [r, H, r], wall);
  quad([-r, 0, -r], [-r, 0, r], [-r, H, r], [-r, H, -r], wallShade);
  // The hip roof: four triangles to a ridge point, with a small overhang.
  const o = 0.58;
  const top = [0, H + 0.55, 0];
  const e = [
    [-o, H, o],
    [o, H, o],
    [o, H, -o],
    [-o, H, -o],
  ];
  for (let k = 0; k < 4; k++) {
    pos.push(...e[k], ...e[(k + 1) % 4], ...top);
    for (let i = 0; i < 3; i++) col.push(roof[0], roof[1], roof[2]);
  }
  // Roof underside, so a low camera never sees through the eaves.
  pos.push(...e[0], ...e[2], ...e[1], ...e[0], ...e[3], ...e[2]);
  for (let i = 0; i < 6; i++) col.push(wallShade[0], wallShade[1], wallShade[2]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** Geometry, textures and materials, in the one place that owns them. */
export function disposeBackdrop(b: Backdrop): void {
  b.group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m instanceof THREE.MeshStandardMaterial) m.map?.dispose();
        m.dispose();
      }
    }
  });
}
