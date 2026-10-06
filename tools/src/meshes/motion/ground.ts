/**
 * Ground contact in the living clips (ground-fix, 6 Oct): nothing a team
 * draws while it is alive and standing, walking or firing sits under the
 * ground. Under it, the occlusion outline (`units/silhouette.ts`) draws the
 * buried geometry as a speck; and a boot in the ground reads as a man
 * standing in a hole.
 *
 * Read on main's bytes (b44df7aa) by `measureLowestVertex` -- every skinned
 * vertex, at every key and every midpoint between two keys:
 *
 *   idle      rig.py's idle sways the pelvis over FK legs, so a standing foot
 *             goes 5.5-12.9 mm under (militia_cell, rpg_team, demo_squad,
 *             manpad_team, at_team, recon_zikit); the captured crews read
 *             -0.0017..-0.0065 mm, a seat that is rounding under, not on
 *   move      the replanted legs (`replant.ts`) are keyed at 30 fps against
 *             an upper body keyed at 24, and between two keys that both stand
 *             a sole on the ground the slerped leg dips 2.1-4.2 mm under it
 *   idle,     manpad_team's static kneeling spotter `mpd_spot` -- the
 *   fire      importer's, with no ankle -- 12 mm under at rest, and his
 *             pelvis sway takes the shin to 23.5 mm
 *   all       recon_zikit's tripod: each leg's end cap is a ring round a foot
 *             point ON the ground, so the ring's lower half is under it
 *             (2.7 mm)
 *
 * Three rules, one for each kind of thing that touches the ground:
 *
 *   - a standing or walking figure (a leg with an ankle, `feet.ts`): a foot
 *     whose lowest vertex is under `GROUND_CLEAR` is PLANTED at it --
 *     `kneel.ts`'s `plantLeg`: the ankle moves by exactly what the boot is
 *     off, by two-bone IK, and the boot keeps its world rotation. A leg it
 *     moved is re-keyed at `GROUND_FPS` AND at every key the clip already
 *     had (`denseTimes`), because the dip this fixes in `move` lives
 *     BETWEEN keys: keys that all stood on the ground slerped a sole under
 *     between them, and a root keyed coarser bends at its own keys.
 *   - a figure with no ankle (the static kneeler): its root rises, frame by
 *     frame, until its lowest vertex is at `GROUND_CLEAR` -- the knee stays
 *     on the ground and the body's sway goes on above it.
 *   - a ground prop (the team's `prop` bone): seated at `GROUND_CLEAR` --
 *     its vertices, its rest and every key moved by the same amount and its
 *     bind rebuilt (`formation.ts`'s rule), so every clip agrees.
 *
 * Runs before `kneel.ts`, which builds all three kneel clips from this
 * team's `idle`: a figure the kneel does not pose (the spotter, the tripod)
 * inherits the grounded one, and `kneelIn` starts from the grounded stance.
 *
 * The pass refuses (throws) when anything of a grounded figure is still under
 * the ground afterwards -- a hand, a knee, a held item: that needs a pose, not
 * a lift (`carry.ts` is the one there is). It is a guard on the pass's own
 * arithmetic; the gate is `mesh_gait.test.ts`, reading the bytes.
 */
import type { Animation, Document, Node } from '@gltf-transform/core';
import { shiftNode, writeTrack } from './edit';
import { legOf, lowestY, plantLeg, type Leg, type Pt } from './kneel';
import { invert, qconj, qrot, scale, toMat4, type V3 } from './math';
import { denseTimes, restVertices, Rig, tracksOf, type Pose, type RestVertex } from './rig';
import type { MotionTeam } from './teams';

/**
 * Where a grounded foot, knee or prop's lowest vertex sits, metres: 1 mm,
 * not the kneel's 3 (`KNEEL_GROUND_CLEAR`), and the reason is the gait pass.
 * `pnpm gait:meshes` declares a clip's stride from the speed of boot material
 * near the clip's own lowest sole, weighted by height over it -- so lifting a
 * walk's stance onto a plateau draws the landing and toe-off frames into
 * that weight and the declared stride drops under what the replant actually
 * slides the foot at. Measured on inf_squad, militia_cell and rpg_team:
 * main's declarations sat 1.4-2.9% under the replant's target, a 3 mm
 * plateau 4.8-6.8% (foot skate 0.05-0.08), 1 mm 3.5-5.3% (0.04-0.06; the
 * gate's ceiling is 0.25). Under 1 mm the slerp between two 120 fps keys
 * sags through the ground: 0.5 mm read -0.09 mm on inf_squad's move.
 */
export const GROUND_CLEAR = 0.001;
/** A clip a foot was planted in is re-keyed this densely (`KNEEL_TRANSITION_FPS`'s
 *  reason: a slerped leg sags between keys, the chord under the arc). */
export const GROUND_FPS = 120;
/** The living clips this pass does not build itself. The kneel clips are
 *  `kneel.ts`'s (grounded there); the deaths and `work` are not standing. */
export const GROUND_CLIPS: readonly string[] = ['idle', 'fire', 'move', 'moveFire'];

const HIDDEN_SCALE = 1e-6;

interface Figure {
  readonly prefix: string;
  readonly root: Node;
  /** Both legs with their boots (the foot bone's vertices), or null for a
   *  figure with no ankle. */
  readonly legs: { readonly leg: Leg; readonly pts: Pt[] }[] | null;
  /** Every vertex the figure carries: body, kit, held items. */
  readonly body: Pt[];
}

/** The outermost `*_root` above a joint (`measureLowestVertex`'s grouping). */
function rootOf(rig: Rig, n: Node): Node | null {
  let best: Node | null = null;
  for (let k: Node | null = n; k; k = rig.parent.get(k) ?? null) if (/_root$/.test(k.getName())) best = k;
  return best;
}

function figuresOf(rig: Rig, verts: readonly RestVertex[]): Figure[] {
  const byRoot = new Map<Node, Pt[]>();
  for (const v of verts) {
    const r = rootOf(rig, v.joint);
    if (!r || /_death_root$/.test(r.getName())) continue;
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r)!.push({ joint: v.joint, p: v.p });
  }
  return [...byRoot].map(([root, body]) => {
    const prefix = root.getName().replace(/_root$/, '');
    const standing = (['L', 'R'] as const).every((s) => ['thigh', 'shin', 'foot'].every((b) => rig.has(`${prefix}_${b}_${s}`)));
    const legs = standing
      ? (['L', 'R'] as const).map((s) => {
          const leg = legOf(rig, prefix, s);
          return { leg, pts: body.filter((b) => b.joint === leg.foot) };
        })
      : null;
    return { prefix, root, legs, body };
  });
}

/** Raise `root` by `dy` world metres, through its parent's frame. */
function raiseRoot(rig: Rig, pose: Pose, root: Node, dy: number): void {
  const r = pose.get(root)!;
  const parent = rig.parent.get(root) ?? null;
  const pw = parent ? rig.worldOf(parent, pose) : { r: [0, 0, 0, 1] as [number, number, number, number], s: 1 };
  const d = scale(qrot(qconj(pw.r), [0, dy, 0]), 1 / pw.s);
  pose.set(root, { ...r, t: [r.t[0] + d[0], r.t[1] + d[1], r.t[2] + d[2]] });
}

function groundClip(doc: Document, id: string, rig: Rig, anim: Animation, figs: readonly Figure[]): string[] {
  const lines: string[] = [];
  const tracks = tracksOf(anim);
  const times = denseTimes(tracks, GROUND_FPS);
  for (const f of figs) {
    const poses: Pose[] = [];
    const movedLeg = f.legs ? f.legs.map(() => false) : [];
    let raised = false;
    let before = Infinity;
    let after = Infinity;
    let drawn = 0;
    for (const t of times) {
      const p = rig.sample(tracks, t);
      poses.push(p);
      if (rig.worldOf(f.root, p).s <= HIDDEN_SCALE) continue;
      drawn++;
      before = Math.min(before, lowestY(rig, p, f.body));
      if (f.legs) {
        f.legs.forEach(({ leg, pts }, i) => {
          if (lowestY(rig, p, pts) >= GROUND_CLEAR) return;
          plantLeg(rig, p, leg, pts, GROUND_CLEAR);
          movedLeg[i] = true;
        });
      } else {
        const lo = lowestY(rig, p, f.body);
        if (lo < GROUND_CLEAR) {
          raiseRoot(rig, p, f.root, GROUND_CLEAR - lo);
          raised = true;
        }
      }
      const lo = lowestY(rig, p, f.body);
      if (lo < 0) {
        throw new Error(`${id} ${anim.getName()} ${f.prefix}: lowest vertex ${lo.toFixed(4)} m at ${t.toFixed(3)} s after grounding -- not a foot; it needs a pose`);
      }
      after = Math.min(after, lo);
    }
    if (drawn === 0) continue;
    const written: Node[] = [];
    f.legs?.forEach(({ leg }, i) => {
      if (!movedLeg[i]) return;
      for (const node of [leg.thigh, leg.shin, leg.foot]) {
        writeTrack(doc, anim, node, 'rotation', times, poses.flatMap((p) => [...p.get(node)!.r]));
        written.push(node);
      }
    });
    if (raised) {
      writeTrack(doc, anim, f.root, 'translation', times, poses.flatMap((p) => [...p.get(f.root)!.t]));
      written.push(f.root);
    }
    if (written.length === 0) continue;
    lines.push(
      `ground ${f.prefix} ${anim.getName()}: lowest vertex ${(before * 1000).toFixed(1)} -> ${(after * 1000).toFixed(1)} mm, ` +
        (raised ? 'root raised' : `${movedLeg.filter(Boolean).length} leg(s) planted`) +
        `, ${times.length} keys (${GROUND_FPS} fps and the clip's own)`
    );
  }
  return lines;
}

/**
 * Seat the team's `prop` bone (a tripod, a charge) at `GROUND_CLEAR`: its
 * vertices and its rest and every key rise together, and its inverse bind
 * matrix is rebuilt from the new rest -- `formation.ts`'s rule, so the file's
 * rest pose still agrees with its bind pose for every later stage.
 */
function seatProp(doc: Document, id: string): string[] {
  const rig = new Rig(doc);
  if (!rig.has('prop')) return [];
  const prop = rig.node('prop');
  const subtree = new Set<Node>();
  const walk = (n: Node): void => {
    subtree.add(n);
    for (const c of n.listChildren()) walk(c);
  };
  walk(prop);
  const pts = restVertices(rig).filter((v) => subtree.has(v.joint));
  if (pts.length === 0) return [];
  const lo = Math.min(...pts.map((v) => v.p[1]));
  if (lo >= GROUND_CLEAR) return [];
  const joints = rig.skin.listJoints();
  const ibm = rig.skin.getInverseBindMatrices()!;
  const arr = (ibm.getArray() as Float32Array).slice();
  for (const j of subtree) {
    const i = joints.indexOf(j);
    if (i < 0) continue;
    const want = toMat4(invert(rig.restWorld.get(j)!));
    for (let k = 0; k < 16; k++) {
      if (Math.abs(arr[i * 16 + k] - want[k]) > 2e-4) throw new Error(`${id}: ${j.getName()}'s inverse bind matrix is not its rest`);
    }
  }
  for (const n of rig.skinNode) {
    const t = n.getTranslation();
    const r = n.getRotation();
    if (Math.hypot(t[0], t[1], t[2]) > 1e-6 || Math.abs(r[3]) < 0.999999) throw new Error(`${id}: skinned node ${n.getName()} is not at the origin`);
  }
  const dy = GROUND_CLEAR - lo;
  // The vertices: bind == rest and the meshes sit at the origin (checked
  // above), so a vertex's stored position is its world rest position.
  const idx = new Set([...subtree].map((j) => joints.indexOf(j)).filter((i) => i >= 0));
  for (const node of rig.skinNode) {
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      const pa = prim.getAttribute('POSITION')!;
      const pos = pa.getArray()!;
      const J = prim.getAttribute('JOINTS_0')!.getArray()!;
      const W = prim.getAttribute('WEIGHTS_0')!.getArray()!;
      let touched = false;
      for (let i = 0; i < pos.length / 3; i++) {
        let b = 0;
        for (let k = 1; k < 4; k++) if (W[i * 4 + k] > W[i * 4 + b]) b = k;
        if (!idx.has(J[i * 4 + b])) continue;
        pos[i * 3 + 1] += dy;
        touched = true;
      }
      if (touched) pa.setArray(pos);
    }
  }
  // The bone: rest and every key, in its parent's frame.
  const parent = rig.parent.get(prop) ?? null;
  const pw = parent ? rig.restWorld.get(parent)! : { r: [0, 0, 0, 1] as [number, number, number, number], s: 1 };
  shiftNode(doc, prop, scale(qrot(qconj(pw.r), [0, dy, 0]), 1 / pw.s) as V3);
  const after = new Rig(doc);
  for (const j of subtree) {
    const i = joints.indexOf(j);
    if (i >= 0) arr.set(toMat4(invert(after.restWorld.get(after.node(j.getName()))!)), i * 16);
  }
  ibm.setArray(arr);
  const now = Math.min(...restVertices(new Rig(doc)).filter((v) => subtree.has(v.joint)).map((v) => v.p[1]));
  if (Math.abs(now - GROUND_CLEAR) > 1e-5) throw new Error(`${id}: prop seated at ${now.toFixed(5)} m, not ${GROUND_CLEAR}`);
  return [`ground prop: lowest vertex ${(lo * 1000).toFixed(1)} -> ${(now * 1000).toFixed(1)} mm (vertices, rest and every key)`];
}

export function applyGround(doc: Document, id: string, spec: MotionTeam): string[] {
  if (!spec.ground) return [];
  const lines = seatProp(doc, id);
  const rig = new Rig(doc);
  const figs = figuresOf(rig, restVertices(rig));
  for (const anim of doc.getRoot().listAnimations()) {
    if (!GROUND_CLIPS.includes(anim.getName())) continue;
    lines.push(...groundClip(doc, id, rig, anim, figs));
  }
  return lines;
}
