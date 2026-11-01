/**
 * The instrument behind `mesh_forearm.test.ts` (GH-826 step 2, R1 fix 2): what a Rifle Squad forearm looks like, read off the
 * shipped bytes. It shares nothing with `hands-pass.ts`: the forearm tube is found by where its UVs sit in the atlas (the
 * old forearm's own sleeve cloth, a literal rectangle per side), and its section, its texel statistics and its colour
 * distance to the review's measured sleeve are computed here.
 */
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { readAccessor, readGlb, type GlbFile } from './mesh_gait';

type V3 = [number, number, number];

/** The atlas pixel rectangle (x, y, w, h) of the old forearm's sleeve cloth the tube is stretched over, per bone side. */
export const SLEEVE_RECT: Readonly<Record<'L' | 'R', readonly [number, number, number, number]>> = { L: [474, 620, 64, 90], R: [284, 408, 44, 78] };
/** The review's measured sleeve colours (CIELAB D65): the left/firing side's and the right/support side's. */
export const SLEEVE_LAB: Readonly<Record<'L' | 'R', V3>> = { L: [36.0, -8.4, 8.7], R: [32.2, -9.1, 9.2] };

/** The Demolition squad's (GH-826 step 3): the rectangle of the atlas the sleeve cloth is taken from (one for both sides, 64 x 32 px
 *  at (749, 363): the old forearm's own islands are fragments) and the review's sleeve mean (34.3, -5.7, 17.0) for both. */
export const DEMO_SLEEVE_RECT: Readonly<Record<'L' | 'R', readonly [number, number, number, number]>> = { L: [749, 363, 64, 32], R: [749, 363, 64, 32] };
export const DEMO_SLEEVE_LAB: Readonly<Record<'L' | 'R', V3>> = { L: [34.3, -5.7, 17.0], R: [34.3, -5.7, 17.0] };
export interface ForearmReference {
  readonly rect: Readonly<Record<'L' | 'R', readonly [number, number, number, number]>>;
  readonly lab: Readonly<Record<'L' | 'R', V3>>;
}
export const DEMO_REFERENCE: ForearmReference = { rect: DEMO_SLEEVE_RECT, lab: DEMO_SLEEVE_LAB };

export interface ForearmReading {
  readonly vertices: number;
  /** Per ring, elbow end first: the section's extent along its two principal axes, metres, major then minor. */
  readonly rings: readonly [number, number][];
  /** Mean over R, G, B of the per-channel standard deviation of the atlas texels under the tube's vertices, 0 to 255. */
  readonly texelStd: number;
  readonly distinctUvs: number;
  /** CIELAB of the mean of those texels, and its CIE76 distance to the review's sleeve for this side. */
  readonly meanLab: V3;
  readonly deltaE: number;
}

interface Atlas { readonly w: number; readonly h: number; readonly rgba: Uint8Array }

function atlasOf(glb: GlbFile): Atlas {
  const j = glb.json as unknown as { images?: { bufferView?: number; mimeType?: string }[]; bufferViews?: { byteOffset?: number; byteLength: number }[] };
  const bvIdx = j.images?.[0]?.bufferView;
  if (bvIdx === undefined) throw new Error('forearm: the file carries no embedded atlas');
  const bv = j.bufferViews![bvIdx];
  const bytes = Buffer.from(glb.bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength));
  if (j.images![0].mimeType === 'image/png') {
    const png = PNG.sync.read(bytes);
    return { w: png.width, h: png.height, rgba: png.data };
  }
  const img = jpeg.decode(bytes, { useTArray: true });
  return { w: img.width, h: img.height, rgba: img.data };
}

const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export function labOf(r: number, g: number, b: number): V3 {
  const R = lin(r / 255), G = lin(g / 255), B = lin(b / 255);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

/**
 * The forearm tube of `{figure}_forearm_{side}`: its vertices are the ones whose dominant joint is that forearm and whose UV
 * lies inside the old sleeve's rectangle, on the tube's lattice of 7 columns and 5 rings. `uvTweak` rewrites a vertex's UV before it is read (a constructed failing input).
 */
export function measureForearm(path: string, figure: string, side: 'L' | 'R', uvTweak?: (uv: [number, number], i: number) => [number, number], reference?: ForearmReference): ForearmReading {
  const glb = readGlb(path);
  const nodes = glb.json.nodes ?? [];
  const uni = nodes.find((n) => n.name === 'uniform' && n.mesh !== undefined && n.skin !== undefined);
  if (!uni) throw new Error(`${path}: no skinned uniform node`);
  const skin = glb.json.skins![uni.skin!];
  const ibm = readAccessor(glb, skin.inverseBindMatrices!).data;
  const jointName = (k: number): string => nodes[skin.joints[k]]?.name ?? '';
  const head = (name: string): V3 => {
    const k = skin.joints.findIndex((j) => nodes[j]?.name === name);
    if (k < 0) throw new Error(`${path}: no joint ${name}`);
    const m = ibm.subarray(k * 16, k * 16 + 16);
    const t = [m[12], m[13], m[14]];
    return [-(m[0] * t[0] + m[1] * t[1] + m[2] * t[2]), -(m[4] * t[0] + m[5] * t[1] + m[6] * t[2]), -(m[8] * t[0] + m[9] * t[1] + m[10] * t[2])];
  };
  const prim = glb.json.meshes![uni.mesh!].primitives[0];
  const P = readAccessor(glb, prim.attributes.POSITION);
  const UV = readAccessor(glb, prim.attributes.TEXCOORD_0);
  const J = readAccessor(glb, prim.attributes.JOINTS_0);
  const W = readAccessor(glb, prim.attributes.WEIGHTS_0);
  const atlas = atlasOf(glb);
  const [rx, ry, rw, rh] = (reference?.rect ?? SLEEVE_RECT)[side];
  const name = `${figure}_forearm_${side}`;
  const idx: number[] = [];
  for (let v = 0; v < P.count; v++) {
    let best = 0;
    for (let k = 1; k < 4; k++) if (W.data[v * 4 + k] > W.data[v * 4 + best]) best = k;
    if (jointName(J.data[v * 4 + best]) !== name) continue;
    const u = UV.data[v * 2] * atlas.w - 0.5, w = UV.data[v * 2 + 1] * atlas.h - 0.5;
    if (!(u >= rx - 0.01 && u <= rx + rw - 1 + 0.01 && w >= ry - 0.01 && w <= ry + rh - 1 + 0.01)) continue;
    // ...and on the tube's lattice: 7 columns across the mirrored half turn, 5 rings along it. A vertex of the old sleeve that
    // the pass re-bound to the forearm keeps its own UV, which can fall inside the same rectangle, and is not the tube.
    const fu = (u - rx) / (rw - 1) * 6, fv = (w - ry) / (rh - 1) * 4;
    if (Math.abs(fu - Math.round(fu)) > 0.02 || Math.abs(fv - Math.round(fv)) > 0.02) continue;
    idx.push(v);
  }
  // the rings are the distinct v values, elbow end first (the sleeve cloth runs either way up the rectangle)
  const uvOf = (v: number): [number, number] => {
    const t: [number, number] = [UV.data[v * 2], UV.data[v * 2 + 1]];
    return uvTweak ? uvTweak(t, v) : t;
  };
  const E = head(name), H = head(`${figure}_hand_${side}`);
  const ax = ((): V3 => { const d: V3 = [H[0] - E[0], H[1] - E[1], H[2] - E[2]]; const l = Math.hypot(...d); return [d[0] / l, d[1] / l, d[2] / l]; })();
  const along = (v: number): number => (P.data[v * 3] - E[0]) * ax[0] + (P.data[v * 3 + 1] - E[1]) * ax[1] + (P.data[v * 3 + 2] - E[2]) * ax[2];
  const byT = [...idx].sort((a, b) => along(a) - along(b));
  const rings: [number, number][] = [];
  if (byT.length > 0 && byT.length % 12 === 0) {
    for (let r = 0; r < byT.length / 12; r++) {
      const ring = byT.slice(r * 12, r * 12 + 12);
      const pts = ring.map((v) => [P.data[v * 3], P.data[v * 3 + 1], P.data[v * 3 + 2]] as V3);
      const c = pts.reduce((s, p) => [s[0] + p[0] / 12, s[1] + p[1] / 12, s[2] + p[2] / 12] as V3, [0, 0, 0] as V3);
      const flat = pts.map((p) => {
        const d: V3 = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
        const a = d[0] * ax[0] + d[1] * ax[1] + d[2] * ax[2];
        return [d[0] - a * ax[0], d[1] - a * ax[1], d[2] - a * ax[2]] as V3;
      });
      // principal axes of the ring in its plane: the covariance's eigenvector by the closed form of a 2x2 in an orthonormal basis
      const e1: V3 = ((): V3 => { const a: V3 = Math.abs(ax[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1]; const d = a[0] * ax[0] + a[1] * ax[1] + a[2] * ax[2]; const q: V3 = [a[0] - d * ax[0], a[1] - d * ax[1], a[2] - d * ax[2]]; const l = Math.hypot(...q); return [q[0] / l, q[1] / l, q[2] / l]; })();
      const e2: V3 = [ax[1] * e1[2] - ax[2] * e1[1], ax[2] * e1[0] - ax[0] * e1[2], ax[0] * e1[1] - ax[1] * e1[0]];
      const xy = flat.map((p) => [p[0] * e1[0] + p[1] * e1[1] + p[2] * e1[2], p[0] * e2[0] + p[1] * e2[1] + p[2] * e2[2]]);
      let sxx = 0, syy = 0, sxy = 0;
      for (const [x, y] of xy) { sxx += x * x; syy += y * y; sxy += x * y; }
      const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      const pa = xy.map(([x, y]) => x * Math.cos(th) + y * Math.sin(th)), pb = xy.map(([x, y]) => -x * Math.sin(th) + y * Math.cos(th));
      const ea = Math.max(...pa) - Math.min(...pa), eb = Math.max(...pb) - Math.min(...pb);
      rings.push(ea >= eb ? [ea, eb] : [eb, ea]);
    }
  }
  // the texels under the vertices
  const texels = idx.map((v) => {
    const [u, w] = uvOf(v);
    const px = Math.min(atlas.w - 1, Math.max(0, Math.floor(u * atlas.w))), py = Math.min(atlas.h - 1, Math.max(0, Math.floor(w * atlas.h)));
    const o = (py * atlas.w + px) * 4;
    return [atlas.rgba[o], atlas.rgba[o + 1], atlas.rgba[o + 2]] as V3;
  });
  const n = Math.max(1, texels.length);
  const mean = [0, 1, 2].map((c) => texels.reduce((s, t) => s + t[c], 0) / n);
  const std = [0, 1, 2].map((c) => Math.sqrt(texels.reduce((s, t) => s + (t[c] - mean[c]) ** 2, 0) / n));
  const meanLab = labOf(mean[0], mean[1], mean[2]);
  const ref = (reference?.lab ?? SLEEVE_LAB)[side];
  return {
    vertices: idx.length,
    rings,
    texelStd: (std[0] + std[1] + std[2]) / 3,
    distinctUvs: new Set(idx.map((v) => uvOf(v).map((x) => x.toFixed(5)).join(','))).size,
    meanLab,
    deltaE: Math.hypot(meanLab[0] - ref[0], meanLab[1] - ref[1], meanLab[2] - ref[2]),
  };
}
