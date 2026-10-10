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
 * The thirteen files PR #414 left as debt (ground-debt, 6 Oct), read the same
 * way on main's bytes (70a9fbde), worst per file over the living clips:
 *
 *   idle,     the crews kneeling at their weapons -- the importer's static
 *   fire      kneelers, no ankle -- sunk at REST: atgm_cell 28.3 mm (36.5 with
 *             the idle sway), mortar_team 29.0 (36.2), recoilless_team 20.6
 *             (26.8), digger_crew 30.3 (37.7); mortar_crew's sits on its thigh
 *             at -0.4 and sways to 12.2
 *   all       charge_squad's two men stand 26.4 mm in the ground at REST --
 *             the sprint lean (`teams._lean_forward`, 20 deg about the ground
 *             line under each man) is baked into the rest geometry, and it
 *             turns the toes ahead of that line down into the ground -- and
 *             26-38 mm in every living clip, the replant included (it walks
 *             the ankle at its rest height)
 *   move      sniper_team, never through this pass: rig.py's pendulum walk
 *             with the boot rigid on the shin, a toe 31-36 mm in at the
 *             bottom of the bob
 *   move      moto_rpg: the bike bobs 20 mm and dips 1.6 deg as one rigid
 *             piece (rig.py's `MOTO_BOB`/`MOTO_DIP`), so the rear wheel's
 *             axle goes 41 mm down and the tyre 37 mm into the ground
 *   move      breach_team's brc_point: his 1.2 m shield is worn on the spine
 *             and hangs to 30 mm off the ground standing; the run's lean and
 *             hip drop drove it 54-148 mm in (`carry.ts` lifts it)
 *   idle,     the civilians, captured Mixamo bipeds -- skinned SMOOTHLY, the
 *   move      one rig here that is -- 7-23 mm under at a toe or a heel
 *   all       mtr_no3, breach_team's two men, every crew-served team's
 *             walkers: the idle sway and the replant's between-key dip, 2-12 mm
 *
 * Five rules, one for each kind of thing that touches the ground:
 *
 *   - a standing figure buried at REST (a leg with an ankle, its rest
 *     lowest vertex under by more than `SEAT_TOLERANCE`): SEATED first --
 *     raised rigidly until that vertex is at `GROUND_CLEAR`, its root's rest
 *     and every key, its vertices and its binds together (`formation.ts`'s
 *     rule), so the pose the file was built in is on the ground and the per
 *     frame rule below only takes the clips' own dips. Planting a 26 mm
 *     burial instead would bend a sprinter's knees 27-39 mm in every frame.
 *   - a standing or walking figure (a leg with an ankle, `feet.ts`; or a
 *     captured biped's own `{Left,Right}UpLeg`/`Leg`/`Foot`): a foot
 *     whose lowest vertex is under `GROUND_CLEAR` is PLANTED at it --
 *     `kneel.ts`'s `plantLeg`: the ankle moves by exactly what the boot is
 *     off, by two-bone IK, and the boot keeps its world rotation. A leg it
 *     moved is re-keyed at `GROUND_FPS` AND at every key the clip already
 *     had (`denseTimes`), because the dip this fixes in `move` lives
 *     BETWEEN keys: keys that all stood on the ground slerped a sole under
 *     between them, and a root keyed coarser bends at its own keys. A
 *     biped's vertices are read through every weight they carry
 *     (`restSkinnedVertices`), the blend `measureLowestVertex` reads.
 *   - a figure with no ankle (the static kneeler): its root rises, frame by
 *     frame, until its lowest vertex is at `GROUND_CLEAR` -- the knee stays
 *     on the ground and the body's sway goes on above it.
 *   - a ground prop (the team's `prop` bone): seated at `GROUND_CLEAR` --
 *     its vertices, its rest and every key moved by the same amount and its
 *     bind rebuilt (`formation.ts`'s rule), so every clip agrees.
 *   - a wheel (a `*_wheel<n>` bone): a wheel the clip spins keeps its AXLE at
 *     least its own radius plus `GROUND_CLEAR` up -- so whichever vertex of
 *     the polygon is at the bottom between two keys, it is not under -- and
 *     one it does not spin has its lowest vertex held at `GROUND_CLEAR`. The
 *     wheel moves up on its parent, frame by frame, and keeps its spin: the
 *     frame bobs and dips above it on its suspension, as rig.py authored.
 *
 * Runs before `kneel.ts`, which builds all three kneel clips from this
 * team's `idle`: a figure the kneel does not pose (the spotter, the tripod)
 * inherits the grounded one, and `kneelIn` starts from the grounded stance.
 *
 * The pass refuses (throws) when anything of a grounded figure is still under
 * the ground afterwards -- a hand, a knee, a held item: that needs a pose, not
 * a lift (`carry.ts` has the two there are: yah_a's mast, brc_point's shield).
 * It is a guard on the pass's own arithmetic; the gate is `mesh_gait.test.ts`,
 * reading the bytes.
 */
import type { Animation, Document, Node } from '@gltf-transform/core';
import { shiftNode, writeTrack } from './edit';
import { legOf, lowestY, plantLeg, type Leg, type Pt } from './kneel';
import { figureRoot, legNames } from './replant';
import { invert, qconj, qrot, scale, toMat4, type V3 } from './math';
import { denseTimes, restSkinnedVertices, restVertices, Rig, tracksOf, type Pose, type RestVertex } from './rig';
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

/** A captured biped (the civilians: `stride.ts`'s `walkers` rule) is ONE
 *  figure on its own leg bones, read through every weight its vertices carry.
 *  A leg's points are everything below the knee -- the shin, the foot and
 *  the toe -- since a smooth-skinned boot's heel is half on the shin. */
function bipedFigure(rig: Rig): Figure {
  const body: Pt[] = restSkinnedVertices(rig).map((v) => ({ joint: v.joint, p: v.p, ...(v.influences ? { influences: v.influences } : {}) }));
  const below = (n: Node): Set<Node> => {
    const out = new Set<Node>();
    const walk = (k: Node): void => {
      out.add(k);
      for (const c of k.listChildren()) walk(c);
    };
    walk(n);
    return out;
  };
  const legs = (['L', 'R'] as const).map((side) => {
    const n = legNames(rig, '', side);
    const leg: Leg = { thigh: rig.node(n.thigh), shin: rig.node(n.shin), foot: rig.node(n.foot), ankleRest: rig.restWorld.get(rig.node(n.foot))!.t };
    const joints = below(leg.shin);
    return { leg, pts: body.filter((b) => joints.has(b.joint)) };
  });
  return { prefix: 'biped', root: figureRoot(rig, ''), legs, body };
}

/** Bones named `*_wheel<n>` that carry geometry: moto_rpg's two. */
function wheelNodes(rig: Rig): Node[] {
  return rig.nodes.filter((n) => /_wheel\d+$/.test(n.getName()));
}

function figuresOf(rig: Rig, verts: readonly RestVertex[]): Figure[] {
  if (rig.has('LeftUpLeg') && rig.has('RightUpLeg')) return [bipedFigure(rig)];
  // A wheel is grounded by its own rule (`groundWheels`), not by its root's.
  const wheels = new Set(wheelNodes(rig));
  const byRoot = new Map<Node, Pt[]>();
  for (const v of verts) {
    const r = rootOf(rig, v.joint);
    if (!r || /_death_root$/.test(r.getName()) || wheels.has(v.joint)) continue;
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

/**
 * A sample between two keys of the grounded clip that reads under this is
 * keyed itself (`groundClip`). 0.1 mm -- `plantLeg`'s own tolerance -- not
 * zero, so the pass's arithmetic and the gate's agree about which side of
 * the ground a midpoint is on; every walker #414 grounded reads 0.4 mm or
 * more at every midpoint, so none of them is refined.
 */
export const REFINE_BELOW = 1e-4;
/** Rounds of refinement before the pass gives up and says where. */
const REFINE_ROUNDS = 4;

/**
 * Ground every figure in `anim` (`groundAt`), then read the clip the way the
 * gate does -- every figure drawn, at the midpoint of every pair of keys the
 * clip now has -- and where one reads under `REFINE_BELOW`, key that
 * midpoint too and ground again from the clip as it came in. The 120 fps
 * grid is not dense enough for a sprinter's foot (charge_squad, 5.7 m/s) or
 * the sniper's pendulum leg: both read 1.2 mm under their own keys between
 * them, -0.2 mm at the gate's midpoints.
 */
function groundClip(doc: Document, id: string, rig: Rig, anim: Animation, figs: readonly Figure[]): string[] {
  const tracks = tracksOf(anim);
  let times = denseTimes(tracks, GROUND_FPS);
  for (let round = 0; ; round++) {
    const lines = groundAt(doc, id, rig, anim, figs, tracks, times);
    const sag = sagging(rig, anim, figs);
    if (sag.length === 0) {
      if (round > 0) lines.push(`ground ${anim.getName()}: ${round} round(s) of refinement, ${times.length} keys`);
      return lines;
    }
    if (round >= REFINE_ROUNDS) {
      throw new Error(`${id} ${anim.getName()}: still under between keys after ${round} rounds, at ${sag.slice(0, 4).map((t) => t.toFixed(4)).join(', ')} s`);
    }
    times = [...times, ...sag].sort((a, b) => a - b);
  }
}

/** The midpoints of `anim`'s keys at which a drawn figure reads under `REFINE_BELOW`. */
function sagging(rig: Rig, anim: Animation, figs: readonly Figure[]): number[] {
  const tracks = tracksOf(anim);
  const keys = [...new Set([...tracks.values()].flatMap((t) => Array.from(t.times)))].sort((a, b) => a - b);
  const out: number[] = [];
  for (let i = 0; i + 1 < keys.length; i++) {
    const t = (keys[i] + keys[i + 1]) / 2;
    const p = rig.sample(tracks, t);
    for (const f of figs) {
      if (rig.worldOf(f.root, p).s <= HIDDEN_SCALE) continue;
      if (lowestY(rig, p, f.body) < REFINE_BELOW) {
        out.push(t);
        break;
      }
    }
  }
  return out;
}

function groundAt(
  doc: Document,
  id: string,
  rig: Rig,
  anim: Animation,
  figs: readonly Figure[],
  tracks: ReturnType<typeof tracksOf>,
  times: readonly number[]
): string[] {
  const lines: string[] = [];
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
        writeTrack(doc, anim, node, 'rotation', [...times], poses.flatMap((p) => [...p.get(node)!.r]));
        written.push(node);
      }
    });
    if (raised) {
      writeTrack(doc, anim, f.root, 'translation', [...times], poses.flatMap((p) => [...p.get(f.root)!.t]));
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

/** `top` and every node under it. */
function subtreeOf(top: Node): Set<Node> {
  const out = new Set<Node>();
  const walk = (n: Node): void => {
    out.add(n);
    for (const c of n.listChildren()) walk(c);
  };
  walk(top);
  return out;
}

/**
 * Raise `top` and everything under it by `dy` world metres, for good: its
 * vertices and its rest and every key rise together, and the subtree's
 * inverse bind matrices are rebuilt from the new rest -- `formation.ts`'s
 * rule, so the file's rest pose still agrees with its bind pose for every
 * later stage. Returns the subtree's lowest rest vertex afterwards.
 */
function seatSubtree(doc: Document, id: string, topName: string, dy: number): number {
  const rig = new Rig(doc);
  const top = rig.node(topName);
  const subtree = subtreeOf(top);
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
  const parent = rig.parent.get(top) ?? null;
  const pw = parent ? rig.restWorld.get(parent)! : { r: [0, 0, 0, 1] as [number, number, number, number], s: 1 };
  shiftNode(doc, top, scale(qrot(qconj(pw.r), [0, dy, 0]), 1 / pw.s) as V3);
  const after = new Rig(doc);
  for (const j of subtree) {
    const i = joints.indexOf(j);
    if (i >= 0) arr.set(toMat4(invert(after.restWorld.get(after.node(j.getName()))!)), i * 16);
  }
  ibm.setArray(arr);
  const now = new Rig(doc);
  const moved = subtreeOf(now.node(topName));
  return Math.min(...restVertices(now).filter((v) => moved.has(v.joint)).map((v) => v.p[1]));
}

/**
 * Seat the team's `prop` bone (a tripod, a charge) at `GROUND_CLEAR`
 * (`seatSubtree`), so every clip agrees.
 */
function seatProp(doc: Document, id: string): string[] {
  const rig = new Rig(doc);
  if (!rig.has('prop')) return [];
  const subtree = subtreeOf(rig.node('prop'));
  const pts = restVertices(rig).filter((v) => subtree.has(v.joint));
  if (pts.length === 0) return [];
  const lo = Math.min(...pts.map((v) => v.p[1]));
  if (lo >= GROUND_CLEAR) return [];
  const now = seatSubtree(doc, id, 'prop', GROUND_CLEAR - lo);
  if (Math.abs(now - GROUND_CLEAR) > 1e-5) throw new Error(`${id}: prop seated at ${now.toFixed(5)} m, not ${GROUND_CLEAR}`);
  return [`ground prop: lowest vertex ${(lo * 1000).toFixed(1)} -> ${(now * 1000).toFixed(1)} mm (vertices, rest and every key)`];
}

/**
 * A standing figure buried at REST by more than this is seated before the
 * clips are grounded; anything shallower is rounding (every standing figure
 * in the nine teams #414 grounded reads -3.6e-9 m at rest, and must not be
 * seated: the pass reproduces their committed bytes), and `plantLeg`'s own
 * convergence tolerance is the same 0.1 mm.
 */
export const SEAT_TOLERANCE = 1e-4;

/**
 * Seat every standing figure (a leg with an ankle, on a `*_root`) whose rest
 * pose is under the ground: its living root and everything under it rise
 * until the lowest rest vertex is at `GROUND_CLEAR` (`seatSubtree`). The
 * corpse (`*_death_root`) is its own figure and is not moved.
 */
function seatFigures(doc: Document, id: string): string[] {
  const lines: string[] = [];
  const rig = new Rig(doc);
  for (const f of figuresOf(rig, restVertices(rig))) {
    if (!f.legs || f.prefix === 'biped') continue;
    const lo = Math.min(...f.body.map((b) => b.p[1]));
    if (lo >= -SEAT_TOLERANCE) continue;
    const now = seatSubtree(doc, id, f.root.getName(), GROUND_CLEAR - lo);
    if (Math.abs(now - GROUND_CLEAR) > 1e-5) throw new Error(`${id}: ${f.prefix} seated at ${now.toFixed(5)} m, not ${GROUND_CLEAR}`);
    lines.push(`ground seat ${f.prefix}: rest lowest vertex ${(lo * 1000).toFixed(1)} -> ${(now * 1000).toFixed(1)} mm (vertices, rest and every key)`);
  }
  return lines;
}

/** A wheel: its bone, its vertices, and its radius about its own axle. */
interface Wheel {
  readonly node: Node;
  readonly pts: Pt[];
  readonly radius: number;
}

/**
 * Every wheel, measured from its own vertices: the axle is the bone's origin
 * and runs along the armature's Z (a vehicle faces +X), so the radius is the
 * furthest vertex from the origin in the X-Y plane. A wheel whose geometry is
 * not a thin disc across Z is refused -- the radius would be meaningless.
 */
function wheelsOf(id: string, rig: Rig, verts: readonly RestVertex[]): Wheel[] {
  return wheelNodes(rig).flatMap((node) => {
    const pts = verts.filter((v) => v.joint === node).map((v) => ({ joint: v.joint, p: v.p }));
    if (pts.length === 0) return [];
    const o = rig.restWorld.get(node)!.t;
    const radius = Math.max(...pts.map((b) => Math.hypot(b.p[0] - o[0], b.p[1] - o[1])));
    const half = Math.max(...pts.map((b) => Math.abs(b.p[2] - o[2])));
    if (half > radius / 2) throw new Error(`${id}: ${node.getName()} is not a disc across Z (half-width ${half.toFixed(3)} m, radius ${radius.toFixed(3)})`);
    return [{ node, pts, radius }];
  });
}

/** True when `anim` turns `node` (its rotation keys are not all one value). */
function spins(anim: Animation, node: Node): boolean {
  const tr = tracksOf(anim).get(`${node.getName()}.rotation`);
  if (!tr) return false;
  for (let i = 4; i < tr.values.length; i++) if (Math.abs(tr.values[i] - tr.values[i % 4]) > 1e-6) return true;
  return false;
}

function groundWheels(doc: Document, id: string, rig: Rig, anim: Animation, wheels: readonly Wheel[]): string[] {
  const lines: string[] = [];
  for (const w of wheels) {
    const tracks = tracksOf(anim);
    const times = denseTimes(tracks, GROUND_FPS);
    const turning = spins(anim, w.node);
    const poses: Pose[] = [];
    let before = Infinity;
    let after = Infinity;
    let lifted = false;
    for (const t of times) {
      const p = rig.sample(tracks, t);
      poses.push(p);
      if (rig.worldOf(w.node, p).s <= HIDDEN_SCALE) continue;
      // A turning wheel: whichever vertex comes to the bottom between two
      // keys, it is no lower than the axle less the radius.
      const floor = (): number => (turning ? rig.worldOf(w.node, p).t[1] - w.radius : lowestY(rig, p, w.pts));
      const f0 = floor();
      before = Math.min(before, lowestY(rig, p, w.pts));
      if (f0 < GROUND_CLEAR) {
        raiseRoot(rig, p, w.node, GROUND_CLEAR - f0);
        lifted = true;
      }
      const lo = lowestY(rig, p, w.pts);
      if (lo < 0 || floor() < GROUND_CLEAR - 1e-6) {
        throw new Error(`${id} ${anim.getName()} ${w.node.getName()}: wheel at ${lo.toFixed(4)} m (floor ${floor().toFixed(4)}) at ${t.toFixed(3)} s after grounding`);
      }
      after = Math.min(after, lo);
    }
    if (!lifted) continue;
    writeTrack(doc, anim, w.node, 'translation', times, poses.flatMap((p) => [...p.get(w.node)!.t]));
    lines.push(
      `ground ${w.node.getName()} ${anim.getName()}: lowest vertex ${(before * 1000).toFixed(1)} -> ${(after * 1000).toFixed(1)} mm, ` +
        `${turning ? `axle held ${(w.radius * 1000).toFixed(0)} mm (its radius) + ${GROUND_CLEAR * 1000} mm up` : 'wheel lifted'}, ` +
        `${times.length} keys (${GROUND_FPS} fps and the clip's own)`
    );
  }
  return lines;
}

export function applyGround(doc: Document, id: string, spec: MotionTeam): string[] {
  if (!spec.ground) return [];
  const lines = seatProp(doc, id);
  lines.push(...seatFigures(doc, id));
  const rig = new Rig(doc);
  const verts = restVertices(rig);
  const figs = figuresOf(rig, verts);
  const wheels = wheelsOf(id, rig, verts);
  for (const anim of doc.getRoot().listAnimations()) {
    if (!GROUND_CLIPS.includes(anim.getName())) continue;
    lines.push(...groundWheels(doc, id, rig, anim, wheels));
    lines.push(...groundClip(doc, id, rig, anim, figs));
  }
  return lines;
}
