/**
 * The garage's track close-ups (GH-238 plan 3, K11): which part of a model a
 * track is ABOUT, which way to turn the model so that part faces the camera,
 * and where the camera goes to frame it. Pure: three's maths classes and a
 * small software depth buffer, no `WebGLRenderer`, so every rule here is
 * tested in `environment: 'node'`. The door (`garage-view.ts`) calls it only
 * when `GarageViewOptions.focus` is set, which only `pnpm closeups:garage`
 * does; the app never passes it.
 *
 * ## What a track is about
 *
 * - **A kitted vehicle** (the eight with `kit_*` nodes, GH-238): the kit
 *   itself. The model is built with that track at `FOCUS_TIER` and every
 *   other track at 0, so every kit triangle on it is that track's. A kit
 *   triangle is one the runtime merge put AFTER the host's own
 *   (`rlKitBaseCount`, `units/vehicle-kit.ts`: indices at and beyond it are
 *   kit).
 * - **Any other vehicle** (the drones, the gunship): by role, from the roles
 *   the shipped GLBs carry (`hull`, `glass`, `metal`): armour is the `hull`,
 *   sensors the `glass` (canopy, sensor ball, camera), firepower the `metal`
 *   except a rotor, which is not a weapon (`ROTOR`).
 * - **A rigged team**: by role, on ONE figure. The team GLBs carry one mesh
 *   per role across every figure (`uniform`, `webbing`, `face`, `boot`,
 *   `weapon`, `metal`, `charge`), so a vertex's figure is its bone's
 *   (`visiblePoints`' own owner rule). Armour is the body: `uniform` and
 *   `webbing` between `TORSO_BAND` of the figure's own height. Sensors are
 *   the head and optics: every triangle on the figure's own head bone
 *   (`HEAD_BONE`: the face, the helmet, goggles and anything clipped to
 *   them), plus any `glass`. A figure drawn with no head bone -- the sniper
 *   pair's showcase is their PRONE death geometry, bound rigidly to one
 *   root -- takes everything within `HEAD_REACH` of its own `face` instead,
 *   and a figure with neither falls back to `HEAD_BAND` of its height. Not
 *   height first, because the top fifth of a man lying down is his pack,
 *   which is what the first run framed; and not the face first, because a
 *   `face` role that also covers the hands spans a whole man. Firepower is the weapon:
 *   `weapon` and `metal` (two of the eight team GLBs carry no `metal` role
 *   at all -- the rifle is `weapon` -- so `metal` alone would frame nothing
 *   on them). The figure is the team's LEAD for that track: the one owning
 *   the most of the region's triangles, so a Spike team's firepower is the
 *   man holding the launcher rather than whoever stands first in the line.
 *   (The breach team's point man leads it with his shield, which the GLB
 *   carries as `weapon`. Measured, choosing the lead by `metal` instead
 *   handed the Spike team's firepower to the spotter's 12 metal triangles and
 *   the sniper's to 22 pixels of bolt, so the shield stays.)
 *
 * A region that comes out empty falls back to the WHOLE model, warned by
 * name, so a close-up is never of nothing.
 *
 * ## Which way round
 *
 * The model is turned through `FOCUS_YAWS_DEG` (the default face and seven
 * more; a team only through those that keep its faces toward the camera,
 * `figureFacingYaws`), and at each yaw a software depth buffer of the whole model is drawn
 * through the bay's OWN camera (the turntable's fit). The yaw that shows the
 * most subject pixels wins; a tie keeps the earlier yaw, so the default face
 * wins a tie. Counting VISIBLE pixels rather than summing projected area
 * matters on a vehicle: a slat cage on the far flank projects exactly as
 * large as the near one, and is hidden behind the hull.
 *
 * ## Where the camera goes
 *
 * At the chosen yaw the frame is fitted, by the turntable's own
 * `fitCamera` at the turntable's own FOV and elevation, to the subject
 * triangles that showed at least one pixel -- a part hidden behind the hull
 * at that yaw does not stretch the frame -- with `CLOSEUP_PAD` (15%) of
 * margin.
 */
import * as THREE from 'three';
import { KIT_BASE_COUNT_KEY } from '../units/vehicle-kit';

/** The frame is the subject's extent times this. */
export const CLOSEUP_PAD = 1.15;
/** The close-up's aspect, 480 x 320. */
export const CLOSEUP_ASPECT = 3 / 2;
/** The tier a kitted vehicle's focused track is shown at. */
export const FOCUS_TIER = 3;
/** The yaws tried, in degrees past the turntable's default face. */
export const FOCUS_YAWS_DEG: readonly number[] = [0, 45, 90, 135, 180, 225, 270, 315];
/**
 * The yaws a TEAM is scored at: only those that leave the figures' faces at
 * least side-on to the camera. A plate carrier's back panel projects as many
 * pixels as its front, and the first Rifle Squad armour close-up (7 Oct)
 * chose the back -- a man photographed from behind reads as walking away,
 * not as kitted. The camera sits on `+X` and a figure faces local `+X`, so a
 * figure faces the camera square on at a total turn of 0; `defaultYawDeg` is
 * the turn yaw 0 already carries.
 */
export function figureFacingYaws(defaultYawDeg: number, yaws: readonly number[] = FOCUS_YAWS_DEG): number[] {
  return yaws.filter((y) => {
    const total = (((defaultYawDeg + y) % 360) + 540) % 360 - 180;
    return Math.abs(total) <= 90;
  });
}
/** The software depth buffer's size (the bay's own aspect). */
export const FOCUS_RASTER_W = 240;
export const FOCUS_RASTER_H = 160;
/** A figure's body, as fractions of its own height above its lowest point. */
export const TORSO_BAND: readonly [number, number] = [0.42, 0.86];
/** A figure's head (helmet included). */
export const HEAD_BAND: readonly [number, number] = [0.8, 1.01];
/** A figure's head bone: every shipped team rig names one `<figure>_head`. */
export const HEAD_BONE = /_head$/;
/** The head, as a multiple of the `face`'s own radius about its centre. */
export const HEAD_REACH = 2.2;
/** A rotor is `metal` on the aircraft, and not a weapon. */
const ROTOR = /^(WRECK_)?rotor/;

export type FocusSubject = 'kit' | 'role' | 'whole';

/** What a track concerns on a model that is not kitted for it. */
interface RoleRule {
  /** Roles in the region; `null` is any role. */
  readonly roles: readonly string[] | null;
  /** Height band on the lead figure (figures only); `null` is no band. */
  readonly band: readonly [number, number] | null;
  /** Roles taken wherever they are on the lead figure, band or not. */
  readonly extra?: readonly string[];
  /** Node names never in the region. */
  readonly exclude?: RegExp;
  /** Figures only: the region is every triangle within `reach` times the
   *  anchor role's own radius of its centre, on each figure that carries
   *  that role (`roles` and `band` then do not apply to it). */
  readonly anchor?: { readonly role: string; readonly reach: number };
  /** Figures only, and ahead of `anchor`: the region is every triangle on
   *  a bone this matches, on each figure that has one drawn. */
  readonly bones?: RegExp;
}

export const FIGURE_REGIONS: Readonly<Record<string, RoleRule>> = {
  armour: { roles: ['uniform', 'webbing'], band: TORSO_BAND },
  sensors: {
    roles: null,
    band: HEAD_BAND,
    extra: ['glass'],
    bones: HEAD_BONE,
    anchor: { role: 'face', reach: HEAD_REACH },
  },
  firepower: { roles: ['weapon', 'metal'], band: null },
};

export const VEHICLE_REGIONS: Readonly<Record<string, RoleRule>> = {
  armour: { roles: ['hull'], band: null },
  sensors: { roles: ['glass'], band: null },
  firepower: { roles: ['metal'], band: null, exclude: ROTOR },
};

/** Every drawn triangle of a model, in world space, with what it is. */
export interface SceneTriangles {
  /** 9 floats a triangle. */
  readonly pos: Float32Array;
  readonly count: number;
  /** Role of each triangle's mesh (`rl_role`, else the mesh's name). */
  readonly role: readonly string[];
  /** The mesh's own name, for `RoleRule.exclude`. */
  readonly name: readonly string[];
  /** 1 where the triangle is kit (beyond its geometry's `rlKitBaseCount`). */
  readonly kit: Uint8Array;
  /** The figure (index into the `figures` passed in) owning the triangle's
   *  first vertex, or -1. */
  readonly owner: Int16Array;
  /** The name of the bone carrying most of the triangle's first vertex, or
   *  `''` for a mesh that is not skinned. */
  readonly bone: readonly string[];
}

function hidden(o: THREE.Object3D | null): boolean {
  for (let n = o; n; n = n.parent) {
    if (!n.visible) return true;
    if (Math.abs(n.scale.x) < 1e-6 && Math.abs(n.scale.y) < 1e-6 && Math.abs(n.scale.z) < 1e-6) return true;
  }
  return false;
}

/**
 * Every triangle `root` draws, posed: a skinned vertex goes through its bones
 * the way `visiblePoints` takes it (a vertex mostly on a scaled-to-nothing
 * bone, a death root, is not drawn and drops its triangles), and a mesh under
 * a hidden or zero-scaled ancestor (a `WRECK_` twin) is skipped.
 */
export function collectTriangles(root: THREE.Object3D, figures: readonly THREE.Object3D[] = []): SceneTriangles {
  root.updateMatrixWorld(true);
  const pos: number[] = [];
  const role: string[] = [];
  const name: string[] = [];
  const kit: number[] = [];
  const owner: number[] = [];
  const boneName: string[] = [];
  const ownerOf = (o: THREE.Object3D | null): number => {
    for (let n = o; n; n = n.parent) {
      const i = figures.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || hidden(o)) return;
    const geo = mesh.geometry;
    const p = geo.getAttribute('position');
    if (!p) return;
    const r = (mesh.userData as { rl_role?: unknown }).rl_role;
    const meshRole = typeof r === 'string' && r.length > 0 ? r : mesh.name;
    const skinned = (mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh ? (mesh as unknown as THREE.SkinnedMesh) : null;
    const si = skinned ? geo.getAttribute('skinIndex') : null;
    const sw = skinned ? geo.getAttribute('skinWeight') : null;
    let dead: boolean[] = [];
    let boneOwner: number[] = [];
    if (skinned) {
      const s = new THREE.Vector3();
      const tp = new THREE.Vector3();
      const tq = new THREE.Quaternion();
      dead = skinned.skeleton.bones.map((b) => {
        b.matrixWorld.decompose(tp, tq, s);
        return Math.abs(s.x) < 1e-4;
      });
      boneOwner = skinned.skeleton.bones.map((b) => ownerOf(b));
    }
    const meshOwner = ownerOf(mesh);
    // Every vertex once: world position (NaN when it is not drawn) and owner.
    const world = new Float32Array(p.count * 3);
    const vOwner = new Int16Array(p.count);
    const vBone = new Int16Array(p.count).fill(-1);
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      let who = meshOwner;
      if (skinned && si && sw) {
        let live = 0;
        let best = -1;
        let bestW = 0;
        for (let k = 0; k < 4; k++) {
          const w = sw.getComponent(i, k);
          const bi = si.getComponent(i, k);
          if (w !== 0 && !dead[bi]) live += w;
          if (w > bestW) {
            bestW = w;
            best = bi;
          }
        }
        if (live < 0.5) {
          world[i * 3] = Number.NaN;
          vOwner[i] = -1;
          continue;
        }
        skinned.applyBoneTransform(i, v);
        if (best >= 0 && boneOwner[best] !== undefined && boneOwner[best] >= 0) who = boneOwner[best];
        vBone[i] = best;
      }
      v.applyMatrix4(mesh.matrixWorld);
      world[i * 3] = v.x;
      world[i * 3 + 1] = v.y;
      world[i * 3 + 2] = v.z;
      vOwner[i] = who;
    }
    const base = (geo.userData as Record<string, unknown>)[KIT_BASE_COUNT_KEY];
    const kitFrom = typeof base === 'number' ? base : Infinity;
    const index = geo.index;
    // Within the geometry's draw range, like the renderer.
    const n = index ? index.count : p.count;
    const start = Math.max(0, geo.drawRange.start);
    const end = Math.min(n, geo.drawRange.start + geo.drawRange.count);
    for (let k = start; k + 2 < end; k += 3) {
      const a = index ? index.getX(k) : k;
      const b = index ? index.getX(k + 1) : k + 1;
      const c = index ? index.getX(k + 2) : k + 2;
      if (Number.isNaN(world[a * 3]) || Number.isNaN(world[b * 3]) || Number.isNaN(world[c * 3])) continue;
      for (const vi of [a, b, c]) pos.push(world[vi * 3], world[vi * 3 + 1], world[vi * 3 + 2]);
      role.push(meshRole);
      name.push(mesh.name);
      kit.push(k >= kitFrom ? 1 : 0);
      owner.push(vOwner[a]);
      boneName.push(skinned && vBone[a] >= 0 ? (skinned.skeleton.bones[vBone[a]]?.name ?? '') : '');
    }
  });
  return {
    pos: Float32Array.from(pos),
    count: role.length,
    role,
    name,
    kit: Uint8Array.from(kit),
    owner: Int16Array.from(owner),
    bone: boneName,
  };
}

/** The lowest and highest drawn point of each figure (index = owner). */
function figureHeights(tris: SceneTriangles, figures: number): { lo: number[]; hi: number[] } {
  const lo = new Array<number>(figures).fill(Infinity);
  const hi = new Array<number>(figures).fill(-Infinity);
  for (let t = 0; t < tris.count; t++) {
    const f = tris.owner[t];
    if (f < 0) continue;
    for (let j = 0; j < 3; j++) {
      const y = tris.pos[t * 9 + j * 3 + 1];
      if (y < lo[f]) lo[f] = y;
      if (y > hi[f]) hi[f] = y;
    }
  }
  return { lo, hi };
}

export interface SubjectMask {
  readonly mask: Uint8Array;
  readonly subject: FocusSubject;
  /** The lead figure, or -1 (a vehicle, or a rig with no figure roots). */
  readonly figure: number;
  /** Subject triangles, before visibility. */
  readonly triangles: number;
}

/**
 * Which triangles a track is about -- see "What a track is about" in this
 * file's header. `figures` is how many figure roots the triangles' `owner`
 * indexes (0 for a vehicle). `kitted`: the model is a kitted vehicle built
 * for this track, so the subject is its kit.
 */
export function subjectMask(
  tris: SceneTriangles,
  track: string,
  opts: { readonly figures: number; readonly kitted: boolean; readonly label?: string; readonly warn?: (msg: string) => void }
): SubjectMask {
  const mask = new Uint8Array(tris.count);
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  const whole = (why: string): SubjectMask => {
    warn(`[lions] garage close-up: ${opts.label ?? '(model)'} ${track}: ${why} -- framing the whole model`);
    mask.fill(1);
    return { mask, subject: 'whole', figure: -1, triangles: tris.count };
  };
  if (opts.kitted) {
    let n = 0;
    for (let t = 0; t < tris.count; t++) {
      if (!tris.kit[t]) continue;
      mask[t] = 1;
      n++;
    }
    return n > 0 ? { mask, subject: 'kit', figure: -1, triangles: n } : whole('no kit triangle drawn');
  }
  const rule = (opts.figures > 0 ? FIGURE_REGIONS : VEHICLE_REGIONS)[track];
  if (rule === undefined) return whole('no region rule for this track');
  const { lo, hi } = figureHeights(tris, opts.figures);
  const centroid = (t: number, axis: number): number =>
    (tris.pos[t * 9 + axis] + tris.pos[t * 9 + 3 + axis] + tris.pos[t * 9 + 6 + axis]) / 3;
  // Each figure's anchor: the centre of its anchor-role vertices and their
  // furthest distance from it. A figure without one keeps the band rule.
  const anchors: ({ c: THREE.Vector3; r: number } | null)[] = new Array(opts.figures).fill(null);
  if (rule.anchor && opts.figures > 0) {
    const sum = Array.from({ length: opts.figures }, () => ({ c: new THREE.Vector3(), n: 0 }));
    for (let t = 0; t < tris.count; t++) {
      const f = tris.owner[t];
      if (f < 0 || tris.role[t] !== rule.anchor.role) continue;
      for (let j = 0; j < 3; j++) sum[f].c.add(new THREE.Vector3(tris.pos[t * 9 + j * 3], tris.pos[t * 9 + j * 3 + 1], tris.pos[t * 9 + j * 3 + 2]));
      sum[f].n += 3;
    }
    const v = new THREE.Vector3();
    sum.forEach((s, f) => {
      if (s.n > 0) anchors[f] = { c: s.c.divideScalar(s.n), r: 0 };
    });
    for (let t = 0; t < tris.count; t++) {
      const f = tris.owner[t];
      const a = f >= 0 ? anchors[f] : null;
      if (!a || tris.role[t] !== rule.anchor.role) continue;
      for (let j = 0; j < 3; j++) {
        a.r = Math.max(a.r, v.set(tris.pos[t * 9 + j * 3], tris.pos[t * 9 + j * 3 + 1], tris.pos[t * 9 + j * 3 + 2]).distanceTo(a.c));
      }
    }
  }
  // Which figures have a drawn triangle on a `bones` match.
  const boned = new Array<boolean>(opts.figures).fill(false);
  if (rule.bones) {
    for (let t = 0; t < tris.count; t++) {
      if (tris.owner[t] >= 0 && rule.bones.test(tris.bone[t])) boned[tris.owner[t]] = true;
    }
  }
  const inRegion = (t: number): boolean => {
    if (rule.exclude?.test(tris.name[t])) return false;
    const r = tris.role[t];
    if (rule.extra?.includes(r)) return true;
    const owner = tris.owner[t];
    if (rule.bones && owner >= 0 && boned[owner]) return rule.bones.test(tris.bone[t]);
    const a = owner >= 0 ? anchors[owner] : null;
    if (a && rule.anchor) {
      const d = Math.hypot(centroid(t, 0) - a.c.x, centroid(t, 1) - a.c.y, centroid(t, 2) - a.c.z);
      return d <= rule.anchor.reach * a.r;
    }
    if (rule.roles !== null && !rule.roles.includes(r)) return false;
    if (rule.band === null) return true;
    const f = tris.owner[t];
    if (f < 0) return false;
    const h = hi[f] - lo[f];
    const y = (tris.pos[t * 9 + 1] + tris.pos[t * 9 + 4] + tris.pos[t * 9 + 7]) / 3;
    return y >= lo[f] + rule.band[0] * h && y <= lo[f] + rule.band[1] * h;
  };
  // The lead: whichever figure owns the most of the region.
  let figure = -1;
  if (opts.figures > 0) {
    const per = new Array<number>(opts.figures).fill(0);
    for (let t = 0; t < tris.count; t++) if (tris.owner[t] >= 0 && inRegion(t)) per[tris.owner[t]]++;
    let best = 0;
    per.forEach((c, i) => {
      if (c > best) {
        best = c;
        figure = i;
      }
    });
  }
  let n = 0;
  for (let t = 0; t < tris.count; t++) {
    if ((figure < 0 || tris.owner[t] === figure) && inRegion(t)) {
      mask[t] = 1;
      n++;
    }
  }
  if (n === 0) {
    const roles = rule.roles === null ? 'any role' : rule.roles.join('/');
    return whole(`no ${roles} triangle in the region`);
  }
  return { mask, subject: 'role', figure, triangles: n };
}

/**
 * A software depth buffer of `tris` through `camera`, `w` x `h` pixels: how
 * many pixels a subject triangle wins, and which subject triangles won any.
 * A triangle with a vertex outside the depth range is dropped, which only
 * the near plane can do to a model the camera was fitted to.
 */
export function visibleSubject(
  tris: SceneTriangles,
  mask: Uint8Array,
  camera: THREE.Camera,
  w = FOCUS_RASTER_W,
  h = FOCUS_RASTER_H
): { pixels: number; visible: Uint8Array } {
  camera.updateMatrixWorld(true);
  const depth = new Float32Array(w * h).fill(Infinity);
  const id = new Int32Array(w * h).fill(-1);
  const v = new THREE.Vector3();
  const sx = [0, 0, 0];
  const sy = [0, 0, 0];
  const sz = [0, 0, 0];
  for (let t = 0; t < tris.count; t++) {
    let ok = true;
    for (let j = 0; j < 3; j++) {
      v.set(tris.pos[t * 9 + j * 3], tris.pos[t * 9 + j * 3 + 1], tris.pos[t * 9 + j * 3 + 2]).project(camera);
      if (!(v.z >= -1 && v.z <= 1)) {
        ok = false;
        break;
      }
      sx[j] = ((v.x + 1) / 2) * w;
      sy[j] = ((1 - v.y) / 2) * h;
      sz[j] = v.z;
    }
    if (!ok) continue;
    const area = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0]);
    if (area === 0) continue;
    const x0 = Math.max(0, Math.floor(Math.min(sx[0], sx[1], sx[2])));
    const x1 = Math.min(w - 1, Math.ceil(Math.max(sx[0], sx[1], sx[2])));
    const y0 = Math.max(0, Math.floor(Math.min(sy[0], sy[1], sy[2])));
    const y1 = Math.min(h - 1, Math.ceil(Math.max(sy[0], sy[1], sy[2])));
    for (let py = y0; py <= y1; py++) {
      const cy = py + 0.5;
      for (let px = x0; px <= x1; px++) {
        const cx = px + 0.5;
        // Barycentrics; either winding (no back-face cull: a kit plate is
        // seen from both sides by some yaw, and the hull occludes anyway).
        const w0 = ((sx[1] - cx) * (sy[2] - cy) - (sx[2] - cx) * (sy[1] - cy)) / area;
        const w1 = ((sx[2] - cx) * (sy[0] - cy) - (sx[0] - cx) * (sy[2] - cy)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * sz[0] + w1 * sz[1] + w2 * sz[2];
        const o = py * w + px;
        if (z < depth[o]) {
          depth[o] = z;
          id[o] = t;
        }
      }
    }
  }
  const visible = new Uint8Array(tris.count);
  let pixels = 0;
  for (let o = 0; o < id.length; o++) {
    const t = id[o];
    if (t >= 0 && mask[t]) {
      pixels++;
      visible[t] = 1;
    }
  }
  return { pixels, visible };
}

/** The vertices of every triangle `which` marks. */
export function trianglePoints(tris: SceneTriangles, which: Uint8Array): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let t = 0; t < tris.count; t++) {
    if (!which[t]) continue;
    for (let j = 0; j < 3; j++) {
      out.push(new THREE.Vector3(tris.pos[t * 9 + j * 3], tris.pos[t * 9 + j * 3 + 1], tris.pos[t * 9 + j * 3 + 2]));
    }
  }
  return out;
}

export interface FocusChoice {
  readonly yawDeg: number;
  /** Subject pixels at each yaw tried, in `FOCUS_YAWS_DEG` order. */
  readonly pixelsByYaw: readonly number[];
  readonly subject: FocusSubject;
  readonly figure: number;
  readonly triangles: number;
  /** The points the close-up frames. */
  readonly points: THREE.Vector3[];
}

/**
 * Turn the model through `yaws`, score each by visible subject pixels through
 * `bayCamera`, and return the winner's framing points. `applyYaw` turns the
 * model (the door's own); it is left at the winning yaw.
 */
export function chooseFocus(args: {
  readonly model: THREE.Object3D;
  readonly figures: readonly THREE.Object3D[];
  readonly track: string;
  readonly kitted: boolean;
  readonly applyYaw: (deg: number) => void;
  readonly bayCamera: THREE.Camera;
  readonly yaws?: readonly number[];
  readonly label?: string;
  readonly warn?: (msg: string) => void;
}): FocusChoice {
  const yaws = args.yaws ?? FOCUS_YAWS_DEG;
  const figures = args.figures.length;
  let best = { i: 0, pixels: -1 };
  const pixelsByYaw: number[] = [];
  // The region is chosen ONCE, at the default face (which figure leads, the
  // height bands), so every yaw scores the same triangles.
  args.applyYaw(yaws[0]);
  const first = collectTriangles(args.model, args.figures);
  const subject = subjectMask(first, args.track, {
    figures,
    kitted: args.kitted,
    label: args.label,
    warn: args.warn,
  });
  yaws.forEach((yaw, i) => {
    args.applyYaw(yaw);
    // Same meshes, same order: the mask indexes every yaw's triangles alike.
    const tris = i === 0 ? first : collectTriangles(args.model, args.figures);
    const { pixels } = visibleSubject(tris, subject.mask, args.bayCamera);
    pixelsByYaw.push(pixels);
    if (pixels > best.pixels) best = { i, pixels };
  });
  const yawDeg = yaws[best.i];
  args.applyYaw(yawDeg);
  const tris = collectTriangles(args.model, args.figures);
  const { visible } = visibleSubject(tris, subject.mask, args.bayCamera);
  let any = false;
  for (let t = 0; t < visible.length && !any; t++) any = visible[t] === 1;
  const points = trianglePoints(tris, any ? visible : subject.mask);
  return { yawDeg, pixelsByYaw, subject: subject.subject, figure: subject.figure, triangles: subject.triangles, points };
}
