/**
 * GH-1096 S1 and S2: the Roaring Lion insignia's placement, held to the bytes that ship (spec section 9, gates 2 and 10).
 *
 * Gate 2, geometry: an INDEPENDENT measurement of each framed vehicle's GLB (`art/meshes/vehicles/<id>.glb`, read with
 * gltf-transform: no python, no UV maths shared with `tools/vehicles/insignia.py`). Every live mesh triangle is SUBDIVIDED 12 x 12
 * (a Meshy hull's triangles are huge, the carriers' lesson), and the sub-triangle centroids are tested with the interpolated
 * normal, which is what the fragment shader does:
 *  - on each flank, at least 90% of the disc's area lands on host `rl_role: hull` faces that pass the normal test inside the slab;
 *  - the disc does not meet either team-mark box (the vehicle's own `rl_team_mark`);
 *  - no `rubber`, `metal` or `plate` face sits in the disc and slab (the shader paints only hull-role meshes, but a track or a
 *    barrel in the box would mean the frame is in the wrong place);
 *  - every kit face, of every tier, in the disc and slab passes the normal test (decision 14: the lion paints the outermost FLAT
 *    plate, so a non-flat kit face in the box would take a slice of lion);
 *  - the bake's luminance spread under the disc, on the VISIBLE surface (the front-most face at each 1 cm point), is under a
 *    measured ceiling, which catches baked windows and hatches. The Lavi's forward skirt reads 0.030; the ceiling is 0.045. A
 *    literal witness on the Lavi's own turret flank (0.20, 2.10), baked detail, reads 0.073 (insignia.py's sampler), so the check can fail on this bake.
 *  - the host hull hash the table recorded is the hash of these bytes, computed a third way (TypeScript, from gltf-transform's
 *    arrays), beside the generator's numpy and the validator's struct.
 *
 * GH-1096 S2 (the ground fleet, twelve frames) adds four checks the pilot did not need:
 *  - the bake's LOCAL CONTRAST under the disc (relative to the flank's mean, high-pass) is under a measured ceiling. The absolute
 *    spread above cannot fail on a dark or plain hull: the spec's planned Namer mutation read std 0.031, and the D9's cab windows
 *    read 0.029, both under 0.045. Three literal witnesses on baked detail read over the contrast ceiling;
 *  - what the player SEES is painted: the front-most face of every drawn part, of ANY role, at L0 and at every kit tier of every
 *    track, near and far LOD. A track, a wheel or a slat cage standing outboard of the slab hides the lion, and the host-area check
 *    cannot see it;
 *  - the frame paints ONE body, the hull or the turret, so the emblem cannot tear when the turret turns (the two Te'o paint the
 *    turret, decision 11);
 *  - the team-marked framed vehicles are a literal list, the one gate 5 (`team-mask.test.ts`) builds its team + insignia cases from.
 *
 * Gate 10, the art gate: `check_insignia_frames` (validate_mesh_assets.py) passes the shipped table and is falsified on scratch
 * copies of it (a missing entry, one flipped hash byte), and its `INSIGNIA_REQUIRED` is pinned to the table's keys.
 *
 * The one-line falsifications are run by hand and listed in the commit messages.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO, type Node as GNode } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import jpeg from 'jpeg-js';
import { afterAll, describe, expect, it } from 'vitest';
import { INSIGNIA_FRAMES } from '../../packages/render/src/three/units/insignia-frames';
import { INSIGNIA_NORMAL_SOFT, type InsigniaFrame } from '../../packages/render/src/three/units/insignia';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const VEHICLES = path.join(REPO, 'art', 'meshes', 'vehicles');
const TABLE = path.join(REPO, 'packages', 'render', 'src', 'three', 'units', 'insignia-frames.ts');
const SUBDIV = 12;
/** The share of the disc each flank must paint. */
const AREA_FLOOR = 0.9;
/** Linear-luma standard deviation under the disc. Measured: the Lavi's forward skirt 0.030 (insignia.py's `luma_std`). */
const LUMA_STD_CEILING = 0.045;
/**
 * The local contrast under the disc (`lumaSpread`), relative to the flank's mean. Measured by this file on the twelve shipped frames:
 * 0.006 (the Tzav) to 0.050 (the jeep's door, the roughest); on the three witnesses below, 0.19 (the D9's cab windows) to 0.25 (the
 * Lavi's turret flank). The ceiling sits at twice the roughest shipped disc and about half the smallest witness.
 */
const CONTRAST_CEILING = 0.1;

const scratch = mkdtempSync(path.join(os.tmpdir(), 'rl-insignia-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

type V3 = [number, number, number];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const docs = new Map<string, Document>();
async function load(id: string): Promise<Document> {
  let d = docs.get(id);
  if (!d) {
    d = await io.read(path.join(VEHICLES, `${id}.glb`));
    docs.set(id, d);
  }
  return d;
}

interface Extras {
  rl_role?: string;
  rl_kit?: unknown;
  rl_wreck?: boolean;
}
const extrasOf = (n: GNode): Extras => n.getExtras() as Extras;
const isHost = (n: GNode): boolean => extrasOf(n).rl_role === 'hull' && extrasOf(n).rl_kit === undefined && extrasOf(n).rl_wreck !== true;
const isLive = (n: GNode): boolean => n.getMesh() !== null && extrasOf(n).rl_wreck !== true && !n.getName().startsWith('WRECK_');
/**
 * True when the renderer can paint the node: `VehicleTeamMaterials.materialFor` installs the insignia hook only on a MeshStandardMaterial
 * with a base-colour map and returns any other material unchanged. A hull face without one still OCCLUDES, but it paints nothing.
 */
const paintEligible = (n: GNode): boolean => n.getMesh()?.listPrimitives()[0]?.getMaterial()?.getBaseColorTexture() != null;

/** A mesh's triangles in its OWN attribute space (what the shader reads), with normals and uvs. The node chain must net to the
 *  identity (the turret: pivot +T, mesh -T), or the attribute space is not the vehicle's frame and this says so. */
interface Tri {
  readonly P: [V3, V3, V3];
  readonly N: [V3, V3, V3];
  readonly U: [[number, number], [number, number], [number, number]];
  /** False for a mesh with no TEXCOORD_0 (the Remetz's radar turret body): it occludes, but it carries no bake to read. */
  readonly hasUv: boolean;
}
function trianglesOf(node: GNode): Tri[] {
  const m = node.getWorldMatrix();
  const off = Math.hypot(m[12], m[13], m[14]);
  const rot = Math.abs(m[0] - 1) + Math.abs(m[5] - 1) + Math.abs(m[10] - 1) + Math.abs(m[1]) + Math.abs(m[2]) + Math.abs(m[4]);
  if (off > 1e-5 || rot > 1e-6) throw new Error(`${node.getName()}: its node chain is not the identity; the frame would be in the wrong space`);
  const prim = node.getMesh()!.listPrimitives()[0]!;
  const pos = prim.getAttribute('POSITION')!;
  const nrm = prim.getAttribute('NORMAL')!;
  const uv = prim.getAttribute('TEXCOORD_0');
  const idx = prim.getIndices()!.getArray()!;
  const out: Tri[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const k = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
    out.push({
      P: k.map((i) => pos.getElement(i, [0, 0, 0]) as V3) as Tri['P'],
      N: k.map((i) => nrm.getElement(i, [0, 0, 0]) as V3) as Tri['N'],
      U: k.map((i) => (uv ? (uv.getElement(i, [0, 0]) as [number, number]) : [0, 0])) as Tri['U'],
      hasUv: uv !== null,
    });
  }
  return out;
}

/** Every sub-triangle centroid of `tris` (SUBDIV^2 per triangle) with its interpolated normal and its projected XY area. */
function* subCentroids(tris: readonly Tri[]): Generator<{ c: V3; n: V3; areaXY: number }> {
  for (const { P, N } of tris) {
    const ax = P[1][0] - P[0][0];
    const ay = P[1][1] - P[0][1];
    const bx = P[2][0] - P[0][0];
    const by = P[2][1] - P[0][1];
    const areaXY = Math.abs(ax * by - ay * bx) / 2 / (SUBDIV * SUBDIV);
    for (let i = 0; i < SUBDIV; i++) {
      for (let j = 0; j < SUBDIV - i; j++) {
        for (const up of [true, false]) {
          if (!up && j >= SUBDIV - i - 1) continue;
          const bu = up ? (i + 1 / 3) / SUBDIV : (i + 2 / 3) / SUBDIV;
          const bv = up ? (j + 1 / 3) / SUBDIV : (j + 2 / 3) / SUBDIV;
          const bw = 1 - bu - bv;
          const c = [0, 1, 2].map((a) => bw * P[0][a] + bu * P[1][a] + bv * P[2][a]) as V3;
          const n = [0, 1, 2].map((a) => bw * N[0][a] + bu * N[1][a] + bv * N[2][a]) as V3;
          yield { c, n, areaXY };
        }
      }
    }
  }
}

const inDisc = (f: InsigniaFrame, c: V3): boolean => Math.hypot(c[0] - f.centre[0], c[1] - f.centre[1]) <= f.d / 2;
const inSlab = (f: InsigniaFrame, c: V3): boolean => Math.abs(c[2]) >= f.slab[0] && Math.abs(c[2]) <= f.slab[1];
/** Half the shader's soft band on the normal test, as a LITERAL (a test pins it to `INSIGNIA_NORMAL_SOFT`): the shader's smoothstep
 *  starts painting at min_n - 0.04 (0.56 for the 0.60 frames), so that is where the gates' normal test starts too. */
const NORMAL_SOFT = 0.04;
const flankFacing = (f: InsigniaFrame, n: V3): boolean => Math.abs(n[2]) / Math.hypot(n[0], n[1], n[2]) >= f.min_n - NORMAL_SOFT;

async function nodesOf(id: string): Promise<GNode[]> {
  return (await load(id)).getRoot().listNodes().filter(isLive);
}

/** The painted share of the disc on each flank: projected area of host-hull sub-triangles passing every test, over pi r^2. */
async function coverage(id: string, f: InsigniaFrame): Promise<{ plus: number; minus: number }> {
  const out = { plus: 0, minus: 0 };
  for (const node of (await nodesOf(id)).filter(isHost)) {
    for (const s of subCentroids(trianglesOf(node))) {
      if (inDisc(f, s.c) && inSlab(f, s.c) && flankFacing(f, s.n)) out[s.c[2] > 0 ? 'plus' : 'minus'] += s.areaXY;
    }
  }
  const disc = Math.PI * (f.d / 2) ** 2;
  return { plus: out.plus / disc, minus: out.minus / disc };
}

/** The base colour as LINEAR luma (jpeg-js; the base-colour texture, never a normal map). */
function bakeLumaOf(doc: Document): { w: number; h: number; luma: Float64Array } {
  const tex = doc.getRoot().listMaterials()[0]!.getBaseColorTexture()!;
  if (tex.getMimeType() !== 'image/jpeg') throw new Error(`spec: the bake is ${tex.getMimeType()}, not a JPEG`);
  const img = jpeg.decode(tex.getImage()!, { useTArray: true });
  const luma = new Float64Array(img.width * img.height);
  const lin = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  for (let i = 0; i < luma.length; i++) {
    luma[i] = 0.2126 * lin(img.data[i * 4]!) + 0.7152 * lin(img.data[i * 4 + 1]!) + 0.0722 * lin(img.data[i * 4 + 2]!);
  }
  return { w: img.width, h: img.height, luma };
}

/** The triangles of `tris` whose XY bounds meet the disc's bounding square. */
function nearDisc(tris: readonly Tri[], centre: readonly [number, number], d: number): Tri[] {
  const r = d / 2;
  return tris.filter((t) => {
    const xs = t.P.map((p) => p[0]);
    const ys = t.P.map((p) => p[1]);
    return Math.max(...xs) >= centre[0] - r && Math.min(...xs) <= centre[0] + r && Math.max(...ys) >= centre[1] - r && Math.min(...ys) <= centre[1] + r;
  });
}

/** The 1 cm grid over the disc's bounding square, row-major, `round(d * 100)` a side; `inside` is the disc. */
function discGrid(centre: readonly [number, number], d: number): Array<{ xi: number; yi: number; x: number; y: number; inside: boolean }> {
  const r = d / 2;
  const steps = Math.round(d * 100);
  const out: Array<{ xi: number; yi: number; x: number; y: number; inside: boolean }> = [];
  for (let yi = 0; yi < steps; yi++) {
    for (let xi = 0; xi < steps; xi++) {
      const x = centre[0] - r + (xi + 0.5) / 100;
      const y = centre[1] - r + (yi + 0.5) / 100;
      out.push({ xi, yi, x, y, inside: Math.hypot(x - centre[0], y - centre[1]) <= r });
    }
  }
  return out;
}

/** The front-most (largest `side * z`) triangle of `tris` over (x, y), with its barycentrics, or null. */
function frontAt(tris: readonly Tri[], x: number, y: number, side: number): { t: Tri; z: number; w: V3 } | null {
  let best: { t: Tri; z: number; w: V3 } | null = null;
  for (const t of tris) {
    const [a, b, c] = t.P;
    const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(den) < 1e-12) continue;
    const l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / den;
    const l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / den;
    const l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    const z = l1 * a[2] + l2 * b[2] + l3 * c[2];
    if (best !== null && side * z <= side * best.z) continue;
    best = { t, z, w: [l1, l2, l3] };
  }
  return best;
}

/** Half the window of the local-contrast measure, in 1 cm grid steps: a 9 x 9 cm box mean. */
const CONTRAST_HALF = 4;

/**
 * The bake's luma at the VISIBLE host-hull surface (the front-most face on each flank at each 1 cm point of the disc): its mean, its
 * plain spread (`std`), and its LOCAL CONTRAST. The contrast is, on each flank, the RMS of (luma minus its 9 x 9 cm box mean over
 * the disc) divided by that flank's mean luma; the larger flank is returned. It is relative and high-pass, so it reads a baked
 * hatch or window outline on a DARK hull, where an absolute spread cannot (the D9's cab windows: std 0.029, under the 0.045
 * ceiling), and it ignores a smooth camouflage band (the Lavi's skirt: std 0.030, all of it the band).
 */
async function lumaSpread(
  id: string,
  centre: readonly [number, number],
  d: number
): Promise<{ mean: number; std: number; points: number; contrast: number }> {
  const doc = await load(id);
  const bake = bakeLumaOf(doc);
  const near = nearDisc((await nodesOf(id)).filter(isHost).flatMap(trianglesOf), centre, d);
  const steps = Math.round(d * 100);
  const grid = discGrid(centre, d);
  const values: number[] = [];
  let contrast = 0;
  for (const side of [1, -1]) {
    const luma = new Float64Array(steps * steps).fill(Number.NaN);
    for (const g of grid) {
      if (!g.inside) continue;
      const hit = frontAt(near, g.x, g.y, side);
      if (hit === null || !hit.t.hasUv) continue;
      const u = hit.w[0] * hit.t.U[0][0] + hit.w[1] * hit.t.U[1][0] + hit.w[2] * hit.t.U[2][0];
      const v = hit.w[0] * hit.t.U[0][1] + hit.w[1] * hit.t.U[1][1] + hit.w[2] * hit.t.U[2][1];
      const px = Math.min(bake.w - 1, Math.max(0, Math.floor(u * bake.w)));
      const py = Math.min(bake.h - 1, Math.max(0, Math.floor(v * bake.h)));
      const l = bake.luma[py * bake.w + px]!;
      luma[g.yi * steps + g.xi] = l;
      values.push(l);
    }
    let sum = 0;
    let sq = 0;
    let n = 0;
    for (let yi = 0; yi < steps; yi++) {
      for (let xi = 0; xi < steps; xi++) {
        const l = luma[yi * steps + xi]!;
        if (Number.isNaN(l)) continue;
        let bs = 0;
        let bn = 0;
        for (let yy = Math.max(0, yi - CONTRAST_HALF); yy <= Math.min(steps - 1, yi + CONTRAST_HALF); yy++) {
          for (let xx = Math.max(0, xi - CONTRAST_HALF); xx <= Math.min(steps - 1, xi + CONTRAST_HALF); xx++) {
            const q = luma[yy * steps + xx]!;
            if (Number.isNaN(q)) continue;
            bs += q;
            bn++;
          }
        }
        sq += (l - bs / bn) ** 2;
        sum += l;
        n++;
      }
    }
    if (n > 0) contrast = Math.max(contrast, Math.sqrt(sq / n) / (sum / n));
  }
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  return { mean, std, points: values.length, contrast };
}

interface KitTag {
  track: string;
  tier: number;
  lod?: 'near' | 'far';
}
const kitOf = (n: GNode): KitTag | undefined => extrasOf(n).rl_kit as KitTag | undefined;

/** One drawn configuration: its name, the ARMOUR-track tier it wears, and which nodes it draws. */
interface Config {
  name: string;
  armour: number;
  keep: (n: GNode) => boolean;
}

/**
 * The types whose insignia the renderer switches OFF from an armour tier (`hide_from_tier`), as a LITERAL: the table is pinned to
 * it, so a mutated rule goes red here and not only in the table. A type absent here is never hidden.
 */
const HIDE_FROM_TIER: Readonly<Record<string, number>> = { scout_shachaf: 2 };
/** True when `id` draws no insignia in `cfg`: the renderer's rule (`insigniaHiddenAt`) over the SHIPPED table (a test pins the table to the literal above). */
const hiddenIn = (id: string, cfg: Config): boolean => {
  const from = INSIGNIA_FRAMES[id]?.hide_from_tier;
  return from !== undefined && cfg.armour >= from;
};

/**
 * Every configuration a living vehicle can draw (`vehicle-kit.ts`): no kit (L0); each track at each of its tiers (cumulative within
 * a track), with the near LOD and with the far; and every track at its top tier, near and far.
 */
function kitConfigs(nodes: readonly GNode[]): Config[] {
  const kits = nodes.map(kitOf).filter((k): k is KitTag => k !== undefined);
  const tracks = [...new Set(kits.map((k) => k.track))].sort();
  const out: Config[] = [{ name: 'L0', armour: 0, keep: (n) => kitOf(n) === undefined }];
  const drawn = (lod: 'near' | 'far', pick: (k: KitTag) => boolean) => (n: GNode): boolean => {
    const k = kitOf(n);
    return k === undefined || (pick(k) && (k.lod === undefined || k.lod === lod));
  };
  for (const lod of ['near', 'far'] as const) {
    for (const track of tracks) {
      for (const tier of [...new Set(kits.filter((k) => k.track === track).map((k) => k.tier))].sort()) {
        out.push({ name: `${track} ${tier} (${lod})`, armour: track === 'armour' ? tier : 0, keep: drawn(lod, (k) => k.track === track && k.tier <= tier) });
      }
    }
    out.push({ name: `every track at its top tier (${lod})`, armour: Math.max(0, ...kits.filter((k) => k.track === 'armour').map((k) => k.tier)), keep: drawn(lod, () => true) });
  }
  return out;
}

/**
 * What the player SEES painted, per kit configuration. At each 1 cm point of the disc on each flank, the front-most face of EVERY
 * drawn part of any role: a track, a wheel, a slat cage or a plate standing OUTBOARD of the slab hides the lion, and the area check
 * above (host faces only, any depth) cannot see that. The point counts as painted when that face is a hull-role mesh (the host, or a
 * kit part the graft merges into it), inside the slab, passing the normal test. Returns the worst flank share and where it was.
 */
async function visibleCoverage(
  id: string,
  f: InsigniaFrame
): Promise<{ worst: number; at: string; configs: number; byConfig: Array<{ name: string; share: number; hidden: boolean }> }> {
  const nodes = await nodesOf(id);
  const centre = [f.centre[0], f.centre[1]] as const;
  const points = discGrid(centre, f.d).filter((g) => g.inside);
  // Per node and flank, the node's own front-most face at each point; a configuration is then a max over its drawn nodes.
  const per = new Map<GNode, Map<number, Array<{ z: number; painted: boolean } | null>>>();
  for (const node of nodes) {
    const near = nearDisc(trianglesOf(node), centre, f.d);
    const bySide = new Map<number, Array<{ z: number; painted: boolean } | null>>();
    for (const side of [1, -1]) {
      bySide.set(
        side,
        points.map((g) => {
          const hit = near.length > 0 ? frontAt(near, g.x, g.y, side) : null;
          if (hit === null) return null;
          const n = [0, 1, 2].map((a) => hit.w[0] * hit.t.N[0][a] + hit.w[1] * hit.t.N[1][a] + hit.w[2] * hit.t.N[2][a]) as V3;
          return { z: hit.z, painted: extrasOf(node).rl_role === 'hull' && paintEligible(node) && inSlab(f, [0, 0, hit.z]) && flankFacing(f, n) };
        })
      );
    }
    per.set(node, bySide);
  }
  let worst = 1;
  let at = '';
  const configs = kitConfigs(nodes);
  const byConfig: Array<{ name: string; share: number; hidden: boolean }> = [];
  for (const cfg of configs) {
    const drawn = nodes.filter(cfg.keep);
    let cfgWorst = 1;
    for (const side of [1, -1]) {
      let painted = 0;
      points.forEach((_g, i) => {
        let best: { z: number; painted: boolean } | null = null;
        for (const node of drawn) {
          const h = per.get(node)!.get(side)![i]!;
          if (h !== null && (best === null || side * h.z > side * best.z)) best = h;
        }
        if (best?.painted) painted++;
      });
      cfgWorst = Math.min(cfgWorst, painted / points.length);
      if (!hiddenIn(id, cfg) && painted / points.length < worst) {
        worst = painted / points.length;
        at = `${cfg.name}, ${side > 0 ? '+z' : '-z'} flank`;
      }
    }
    byConfig.push({ name: cfg.name, share: cfgWorst, hidden: hiddenIn(id, cfg) });
  }
  return { worst, at, configs: configs.length, byConfig };
}

/** True when `node` hangs off `turret_pivot`, so it turns with the turret. */
function onTurret(node: GNode): boolean {
  for (let p = node.getParentNode(); p !== null; p = p.getParentNode()) if (p.getName() === 'turret_pivot') return true;
  return false;
}

/** Projected area of hull-role faces (every tier of kit included) that the frame would paint, split by the body they ride on. */
async function paintedByBody(id: string, f: InsigniaFrame): Promise<{ hull: number; turret: number }> {
  const out = { hull: 0, turret: 0 };
  for (const node of (await nodesOf(id)).filter((n) => extrasOf(n).rl_role === 'hull' && paintEligible(n))) {
    const body = onTurret(node) ? 'turret' : 'hull';
    for (const s of subCentroids(trianglesOf(node))) if (inDisc(f, s.c) && inSlab(f, s.c) && flankFacing(f, s.n)) out[body] += s.areaXY;
  }
  return out;
}

// ---- gate: the oblique views (GH-1096 S2, lead ruling 13 Nov) ------------------------------------------------------------------
// The fragment shader paints every fragment that is in the frame's box and passes the normal test, WHATEVER stands in front of it. Seen
// broadside the part in front hides the paint; seen from a camera above the flank (the game's elevation is 30 degrees) a point
// that is recessed behind a plate, or the inward face of that plate, can show through the channel. So: for every drawn configuration
// and every camera (elevation 18 and 30, azimuth every 10 degrees, minus the edge-on ones), a painted point that is VISIBLE from that
// camera must also be visible broadside from its own flank. The share that is not, over the disc's area, must stay under a ceiling.

/** Camera elevations the game can frame a vehicle at, and the azimuth step, in degrees. */
const OBLIQUE_ELEVATIONS = [18, 30] as const;
const OBLIQUE_AZIMUTH_STEP = 10;
/** A camera whose horizontal direction is within this of the flank plane sees the flank edge-on: not walked. |v.z| below it. */
const EDGE_ON = 0.17;
/** A point is the front-most when its depth is within this of the nearest drawn face (m); a thin plate's inward face is further. */
const DEPTH_EPS = 0.005;
/** The most the recessed share of the disc may read. The shipped fleet reads under 0.5%; the Shachaf's old two-surface slab read 34-59%. */
const OBLIQUE_CEILING = 0.02;
/** Lead-approved, named, measured exceptions (13 Nov): the Lavi's host lion shows 7 cm past its tier-2/3 skirt at glancing cameras (0.0227). */
const NAMED_OBLIQUE_CEILING: Readonly<Record<string, number>> = { mbt_lavi: 0.023 };
const MAX_POINTS = 1500;
/** Cameras walked: 2 elevations x 36 azimuths, less those within EDGE_ON of the flank plane (az 0, 10, 170, 180, 190, 350, so 30 each). A literal. */
const OBLIQUE_VIEWS = 60;

interface PaintPt {
  node: GNode;
  c: V3;
  /** The unit surface normal at the point. */
  n: V3;
  w: number;
}

const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const dot3 = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function viewBasis(v: V3): { a: V3; b: V3 } {
  // a = normalize(up x v), b = v x a: an orthonormal screen frame for a camera looking back along v
  const ax = v[2];
  const az = -v[0];
  const l = Math.hypot(ax, az);
  const a: V3 = [ax / l, 0, az / l];
  const b: V3 = [v[1] * a[2] - v[2] * a[1], v[2] * a[0] - v[0] * a[2], v[0] * a[1] - v[1] * a[0]];
  return { a, b };
}

/** Per node, per point: the greatest depth (toward the camera `v`) of any triangle of `tris` that covers the point on screen, else -Infinity. */
function depthsAlong(tris: readonly Tri[], pts: readonly PaintPt[], v: V3): Float64Array {
  const { a, b } = viewBasis(v);
  const n = pts.length;
  const pu = new Float64Array(n);
  const pv = new Float64Array(n);
  const pd = new Float64Array(n);
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  pts.forEach((p, i) => {
    pu[i] = dot3(p.c, a);
    pv[i] = dot3(p.c, b);
    pd[i] = dot3(p.c, v);
    u0 = Math.min(u0, pu[i]!);
    u1 = Math.max(u1, pu[i]!);
    v0 = Math.min(v0, pv[i]!);
    v1 = Math.max(v1, pv[i]!);
  });
  const out = new Float64Array(n).fill(-Infinity);
  for (const t of tris) {
    const ua = dot3(t.P[0], a), ub = dot3(t.P[1], a), uc = dot3(t.P[2], a);
    if (Math.max(ua, ub, uc) < u0 || Math.min(ua, ub, uc) > u1) continue;
    const va = dot3(t.P[0], b), vb = dot3(t.P[1], b), vc = dot3(t.P[2], b);
    if (Math.max(va, vb, vc) < v0 || Math.min(va, vb, vc) > v1) continue;
    const da = dot3(t.P[0], v), db = dot3(t.P[1], v), dc = dot3(t.P[2], v);
    const den = (vb - vc) * (ua - uc) + (uc - ub) * (va - vc);
    if (Math.abs(den) < 1e-12) continue;
    for (let i = 0; i < n; i++) {
      const l1 = ((vb - vc) * (pu[i]! - uc) + (uc - ub) * (pv[i]! - vc)) / den;
      const l2 = ((vc - va) * (pu[i]! - uc) + (ua - uc) * (pv[i]! - vc)) / den;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
      const d = l1 * da + l2 * db + l3 * dc;
      if (d > out[i]!) out[i] = d;
    }
  }
  return out;
}

/**
 * The share of the disc (per flank) that is painted, visible from a camera, and NOT visible broadside from its own flank, worst over
 * every configuration, flank and camera. `painted` is exactly the shader's test: a hull-role face in the box, past the soft start of
 * the normal test. Visibility is two-sided (the Lavi's -z flank is a mirrored double-sided mesh), by depth at the point's own screen position.
 */
async function obliqueRecess(
  id: string,
  f: InsigniaFrame,
  honourHide = true
): Promise<{ worst: number; at: string; views: number; configs: number; painted: number }> {
  const nodes = await nodesOf(id);
  const tris = new Map<GNode, Tri[]>(nodes.map((n) => [n, trianglesOf(n)]));
  let pts: PaintPt[] = [];
  for (const node of nodes.filter((n) => extrasOf(n).rl_role === 'hull' && paintEligible(n))) {
    for (const s of subCentroids(tris.get(node)!)) if (inDisc(f, s.c) && inSlab(f, s.c) && flankFacing(f, s.n)) pts.push({ node, c: s.c, n: unit(s.n), w: s.areaXY });
  }
  const stride = Math.max(1, Math.ceil(pts.length / MAX_POINTS));
  pts = pts.filter((_p, i) => i % stride === 0).map((p) => ({ ...p, w: p.w * stride }));
  const disc = Math.PI * (f.d / 2) ** 2;
  const views: V3[] = [];
  for (const el of OBLIQUE_ELEVATIONS) {
    for (let az = 0; az < 360; az += OBLIQUE_AZIMUTH_STEP) {
      const e = (el * Math.PI) / 180;
      const v: V3 = [Math.cos(e) * Math.cos((az * Math.PI) / 180), Math.sin(e), Math.cos(e) * Math.sin((az * Math.PI) / 180)];
      if (Math.abs(v[2]) >= EDGE_ON) views.push(v);
    }
  }
  const broad: Record<string, V3> = { '1': [0, 0, 1], '-1': [0, 0, -1] };
  // depth of each node at each point, per view (the configuration is then a max over its drawn nodes)
  const depthOf = (v: V3): Map<GNode, Float64Array> => new Map(nodes.map((n) => [n, depthsAlong(tris.get(n)!, pts, v)]));
  const broadDepth = new Map<number, Map<GNode, Float64Array>>([[1, depthOf(broad['1']!)], [-1, depthOf(broad['-1']!)]]);
  const configs = kitConfigs(nodes);
  const visibleIn = (cfg: { keep: (n: GNode) => boolean }, perNode: Map<GNode, Float64Array>, v: V3): boolean[] => {
    const best = new Float64Array(pts.length).fill(-Infinity);
    for (const n of nodes) {
      if (!cfg.keep(n)) continue;
      const d = perNode.get(n)!;
      for (let i = 0; i < pts.length; i++) if (d[i]! > best[i]!) best[i] = d[i]!;
    }
    return pts.map((p, i) => cfg.keep(p.node) && dot3(p.c, v) >= best[i]! - DEPTH_EPS);
  };
  const broadVisible = new Map<number, Map<string, boolean[]>>();
  for (const side of [1, -1]) {
    broadVisible.set(side, new Map(configs.map((c) => [c.name, visibleIn(c, broadDepth.get(side)!, broad[String(side)]!)])));
  }
  let worst = 0;
  let at = '';
  for (const v of views) {
    const perNode = depthOf(v);
    for (const cfg of configs) {
      if (honourHide && hiddenIn(id, cfg)) continue; // the renderer draws no insignia here: nothing is painted to recess
      const seen = visibleIn(cfg, perNode, v);
      for (const side of [1, -1]) {
        const bv = broadVisible.get(side)!.get(cfg.name)!;
        let bad = 0;
        pts.forEach((p, i) => {
          if (Math.sign(p.c[2]) === side && seen[i] && !bv[i]) {
            bad += p.w * Math.min(1, Math.abs(dot3(p.n, v)));
          }
        });
        if (bad / disc > worst) {
          worst = bad / disc;
          at = `${cfg.name}, ${side > 0 ? '+z' : '-z'} flank, camera (${v.map((x) => x.toFixed(2)).join(', ')})`;
        }
      }
    }
  }
  return { worst, at, views: views.length, configs: configs.length, painted: pts.length };
}

interface TeamMarkBoxes {
  roof: { x: [number, number]; y: [number, number] };
  band: { x: [number, number]; y: [number, number] };
}

const FRAMED = Object.keys(INSIGNIA_FRAMES).sort();
/** The frames whose box holds an outer kit plate the lion paints at tiers (decision 14). A literal, never derived. */
const PLATE_IN_BOX: readonly string[] = ['mbt_lavi'];

describe('gate 2: each frame stands on its hull (independent, subdivided)', () => {
  it('measures something: the table is not empty', () => {
    expect(FRAMED.length).toBeGreaterThan(0);
  });

  it.each(FRAMED)('%s: at least 90% of the disc on each flank lands on host hull faces passing the normal test in the slab', async (id) => {
    const c = await coverage(id, INSIGNIA_FRAMES[id]!);
    expect(c.plus, '+z flank').toBeGreaterThanOrEqual(AREA_FLOOR);
    expect(c.minus, '-z flank').toBeGreaterThanOrEqual(AREA_FLOOR);
  }, 60_000);

  it.each(FRAMED)('%s: the disc meets neither team-mark box', async (id) => {
    const f = INSIGNIA_FRAMES[id]!;
    const mark = ((await load(id)).getRoot().listMaterials()[0]!.getExtras() as { rl_team_mark?: TeamMarkBoxes }).rl_team_mark;
    if (mark === undefined) return;
    const r = f.d / 2;
    for (const box of [mark.roof, mark.band]) {
      const overlap = f.centre[0] + r > box.x[0] && f.centre[0] - r < box.x[1] && f.centre[1] + r > box.y[0] && f.centre[1] - r < box.y[1];
      expect(overlap, `the disc overlaps the team box x ${box.x} y ${box.y}`).toBe(false);
    }
  });

  it.each(FRAMED)('%s: no rubber, metal or plate face stands in the disc and slab', async (id) => {
    const f = INSIGNIA_FRAMES[id]!;
    const strays: string[] = [];
    for (const node of await nodesOf(id)) {
      if (extrasOf(node).rl_role === 'hull') continue;
      for (const s of subCentroids(trianglesOf(node))) {
        if (inDisc(f, s.c) && inSlab(f, s.c)) {
          strays.push(`${node.getName()} (${extrasOf(node).rl_role}) at ${s.c.map((v) => v.toFixed(2)).join(', ')}`);
          break;
        }
      }
    }
    expect(strays).toEqual([]);
  }, 60_000);

  it.each(FRAMED)('%s: every kit face of every tier in the disc and slab is flank-facing (a flat plate takes the lion)', async (id) => {
    const f = INSIGNIA_FRAMES[id]!;
    let seen = 0;
    const bent: string[] = [];
    for (const node of (await nodesOf(id)).filter((n) => extrasOf(n).rl_kit !== undefined)) {
      for (const s of subCentroids(trianglesOf(node))) {
        if (!inDisc(f, s.c) || !inSlab(f, s.c)) continue;
        seen++;
        if (!flankFacing(f, s.n)) bent.push(`${node.getName()} at ${s.c.map((v) => v.toFixed(2)).join(', ')}`);
      }
    }
    expect(bent.slice(0, 5)).toEqual([]);
    // Decision 14 in force: exactly these frames have an outer kit plate standing in the box (the Lavi's tier-2 skirt; the
    // Shachaf's plate is outside its hull-only box and the type draws no insignia at tiers 2-3), so this checked something on them; every other frame keeps clear of its kit.
    if (PLATE_IN_BOX.includes(id)) expect(seen, 'the plate is in the box').toBeGreaterThan(100);
    else expect(seen, 'no kit face in the box').toBe(0);
  }, 60_000);

  it.each(FRAMED)('%s: the bake under the disc is plain (luma spread under the measured ceiling), and its mean is the table\'s', async (id) => {
    const f = INSIGNIA_FRAMES[id]!;
    const s = await lumaSpread(id, [f.centre[0], f.centre[1]], f.d);
    expect(s.points).toBeGreaterThan(2000);
    expect(s.std).toBeLessThan(LUMA_STD_CEILING);
    // jpeg-js against PIL, nearest texel each: the two decoders agree to well under a percent of the mean
    expect(Math.abs(s.mean - f.luma) / f.luma).toBeLessThan(0.02);
  }, 60_000);

  it('the witness: the Lavi\'s turret flank (0.20, 2.10), baked detail, reads ABOVE the ceiling, so the check can fail on this bake', async () => {
    const s = await lumaSpread('mbt_lavi', [0.2, 2.1], 0.6);
    expect(s.points).toBeGreaterThan(5000);
    expect(s.std).toBeGreaterThan(LUMA_STD_CEILING);
  }, 60_000);

  it.each(FRAMED)('%s: the bake under the disc has no baked outline (local contrast under the measured ceiling)', async (id) => {
    const f = INSIGNIA_FRAMES[id]!;
    const s = await lumaSpread(id, [f.centre[0], f.centre[1]], f.d);
    expect(s.contrast).toBeLessThan(CONTRAST_CEILING);
  }, 60_000);

  // The witnesses: each a literal disc on baked detail, every one of them over the contrast ceiling. The D9's cab windows and the
  // Namer's vision block are UNDER the absolute std ceiling, which is why the contrast check exists (S1's note: the spec's planned
  // Namer mutation, 0.3 m up, read std 0.031 and could not go red).
  it.each([
    ['mbt_lavi', 'the turret flank', [0.2, 2.1], 0.6, false],
    ['dozer_d9', 'the cab windows', [-1.3, 2.45], 0.5, true],
    ['ifv_namer', 'an aft vision block', [-2.25, 2.45], 0.45, true],
  ] as const)('the witness: %s, %s, reads OVER the contrast ceiling, so the check can fail on that bake', async (id, _what, c, d, underStd) => {
    const s = await lumaSpread(id, c, d);
    expect(s.points).toBeGreaterThan(2000);
    expect(s.contrast).toBeGreaterThan(CONTRAST_CEILING);
    if (underStd) expect(s.std, 'a dark-hull witness the absolute spread cannot see').toBeLessThan(LUMA_STD_CEILING);
  }, 60_000);

  /**
   * How many kit configurations `kitConfigs` walks per framed vehicle, as literals (measured on the shipped GLBs, 12 Nov): a vehicle with
   * no kit gets 3 (L0, and the all-tracks config at each LOD); the kitted ones get 21 or 15 (each track at each tier, near and far, plus
   * those). A bare lower bound could not tell a vehicle whose kit tags were lost from one that never had a kit.
   */
  const KIT_CONFIGS: Record<string, number> = {
    aa_remetz: 3, apc_eitan: 21, apc_kipod: 21, demo_tzav: 3, dozer_d9: 15, ifv_namer: 21, jeep_shoded: 21,
    mbt_lavi: 21, officer_armour: 3, scout_shachaf: 21, spg_cluster: 3, spg_long_range: 3,
  };

  it.each(FRAMED)('%s: the VISIBLE disc is painted on each flank at L0 and at every kit tier, near and far LOD', async (id) => {
    const v = await visibleCoverage(id, INSIGNIA_FRAMES[id]!);
    expect(v.configs, `${id}: kit configurations walked`).toBe(KIT_CONFIGS[id]);
    expect(v.worst, `worst at ${v.at}`).toBeGreaterThanOrEqual(AREA_FLOOR);
    // Per configuration: a configuration the rule HIDES must be one where the lion would not be seen broadside anyway (the plate
    // covers it: nothing is lost), and one it does not hide must show it. A mutated rule moves a configuration across this line.
    for (const c of v.byConfig) {
      if (c.hidden) expect(c.share, `${id}, ${c.name}: hidden, so the lion must not be visible there anyway`).toBeLessThan(AREA_FLOOR);
      else expect(c.share, `${id}, ${c.name}: shown, so it must be visible`).toBeGreaterThanOrEqual(AREA_FLOOR);
    }
  }, 120_000);

  it('the frames\' hide_from_tier is exactly the literal HIDE_FROM_TIER (a mutated rule goes red here)', () => {
    for (const id of FRAMED) expect(INSIGNIA_FRAMES[id]!.hide_from_tier, id).toBe(HIDE_FROM_TIER[id]);
  });

  it('the gates\' soft normal start is the shader\'s (min_n - INSIGNIA_NORMAL_SOFT), pinned as a literal', () => {
    expect(INSIGNIA_NORMAL_SOFT).toBe(NORMAL_SOFT);
    expect(flankFacing({ ...INSIGNIA_FRAMES.mbt_lavi!, min_n: 0.6 }, [Math.sqrt(1 - 0.57 ** 2), 0, 0.57])).toBe(true);
    expect(flankFacing({ ...INSIGNIA_FRAMES.mbt_lavi!, min_n: 0.6 }, [Math.sqrt(1 - 0.55 ** 2), 0, 0.55])).toBe(false);
  });

  it.each(FRAMED)('%s: from the oblique cameras (elevation 18 and 30, every azimuth not edge-on) no recessed or hidden painted point shows', async (id) => {
    const r = await obliqueRecess(id, INSIGNIA_FRAMES[id]!);
    expect(r.configs, 'kit configurations walked').toBe(KIT_CONFIGS[id]);
    expect(r.views, 'cameras walked').toBe(OBLIQUE_VIEWS);
    expect(r.painted, 'painted points measured').toBeGreaterThan(50);
    const named = NAMED_OBLIQUE_CEILING[id];
    expect(r.worst, `worst: ${r.at}`).toBeLessThan(named ?? OBLIQUE_CEILING);
    // The ratchet: a named ceiling is the measurement plus a rounding margin and may only fall. If the vehicle improves, lower it.
    if (named !== undefined) expect(r.worst, `${id}'s named ceiling ${named} is stale: lower it to the measurement`).toBeGreaterThan(named - 0.0015);
  }, 300_000);

  it('the witness: the Shachaf with its hide rule IGNORED (a lion on the host behind the tier-2 plate) reads far OVER the oblique ceiling, so the gate can fail', async () => {
    const r = await obliqueRecess('scout_shachaf', INSIGNIA_FRAMES.scout_shachaf!, false);
    expect(r.worst, `worst: ${r.at}`).toBeGreaterThan(0.2);
  }, 300_000);

  it.each(FRAMED)('%s: the frame paints ONE body: the hull or the turret, never both (it must not tear when the turret turns)', async (id) => {
    const b = await paintedByBody(id, INSIGNIA_FRAMES[id]!);
    expect(b.hull + b.turret).toBeGreaterThan(0);
    expect(Math.min(b.hull, b.turret), `hull ${b.hull.toFixed(4)} m2, turret ${b.turret.toFixed(4)} m2`).toBe(0);
  }, 60_000);

  it('the two Te\'o paint their TURRET (decision 11), and every other framed vehicle its hull', async () => {
    const onTurret: string[] = [];
    for (const id of FRAMED) if ((await paintedByBody(id, INSIGNIA_FRAMES[id]!)).turret > 0) onTurret.push(id);
    expect(onTurret).toEqual(['spg_cluster', 'spg_long_range']);
  }, 120_000);

  it('the team-marked framed vehicles are exactly the literal list gate 5 builds them from (team + insignia)', async () => {
    const marked: string[] = [];
    for (const id of FRAMED) {
      if ((await load(id)).getRoot().listMaterials()[0]!.getExtras().rl_team_mark !== undefined) marked.push(id);
    }
    expect(marked).toEqual(['apc_eitan', 'apc_kipod', 'ifv_namer', 'mbt_lavi', 'officer_armour']);
  });

  it.each(FRAMED)('%s: the recorded host hash is these bytes\' (a third implementation: gltf-transform arrays)', async (id) => {
    const hosts = (await nodesOf(id)).filter(isHost).sort((a, b) => (a.getName() < b.getName() ? -1 : 1));
    expect(hosts.length).toBeGreaterThan(0);
    const h = createHash('sha256');
    for (const n of hosts) {
      const a = n.getMesh()!.listPrimitives()[0]!.getAttribute('POSITION')!.getArray() as Float32Array;
      h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
    }
    expect(h.digest('hex')).toBe(INSIGNIA_FRAMES[id]!.host_sha256);
  });
});

function pythonJson(code: string): unknown {
  const r = spawnSync('python3', ['-c', `import sys, json\nsys.path.insert(0, ${JSON.stringify(path.join(REPO, 'tools'))})\nsys.argv = ["x"]\nimport validate_mesh_assets as v\n${code}`], {
    cwd: REPO,
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`python failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop()!);
}

function checkTable(table: string): { failures: string[]; lines: string[] } {
  return pythonJson(
    `f, lines = v.check_insignia_frames(${JSON.stringify(VEHICLES)}, table_path=${JSON.stringify(table)})\nprint(json.dumps({"failures": f, "lines": lines}))`
  ) as { failures: string[]; lines: string[] };
}

describe('gate 10: check_insignia_frames (validate:meshes)', () => {
  it('INSIGNIA_REQUIRED (python) equals the table\'s keys (TypeScript)', () => {
    const required = (pythonJson('print(json.dumps(list(v.INSIGNIA_REQUIRED)))') as string[]).sort();
    expect(required).toEqual(FRAMED);
    expect(required).toEqual([
      'aa_remetz',
      'apc_eitan',
      'apc_kipod',
      'demo_tzav',
      'dozer_d9',
      'ifv_namer',
      'jeep_shoded',
      'mbt_lavi',
      'officer_armour',
      'scout_shachaf',
      'spg_cluster',
      'spg_long_range',
    ]);
  }, 60_000);

  it('the shipped table passes, and really read each vehicle', () => {
    const r = checkTable(TABLE);
    expect(r.failures).toEqual([]);
    expect(r.lines).toHaveLength(FRAMED.length);
  }, 60_000);

  it('a table with one flipped hash byte fails: the hull "changed since its frame was measured"', () => {
    const text = readFileSync(TABLE, 'utf8');
    const hash = INSIGNIA_FRAMES.mbt_lavi!.host_sha256;
    const flipped = `${hash.slice(0, 10)}${hash[10] === '0' ? '1' : '0'}${hash.slice(11)}`;
    const file = path.join(scratch, 'flipped.ts');
    writeFileSync(file, text.replace(hash, flipped));
    expect(checkTable(file).failures.join('\n')).toMatch(/mbt_lavi: the host hull changed since its frame was measured/);
  }, 60_000);

  it('a table without the Lavi fails: INSIGNIA_REQUIRED names it', () => {
    const file = path.join(scratch, 'empty.ts');
    const text = readFileSync(TABLE, 'utf8');
    const a = text.indexOf('= {', text.indexOf('// BEGIN rl-insignia-frames'));
    const b = text.indexOf('};', a);
    writeFileSync(file, `${text.slice(0, a)}= {}${text.slice(b + 1)}`);
    expect(checkTable(file).failures.join('\n')).toMatch(/mbt_lavi has no frame/);
  }, 60_000);
});
