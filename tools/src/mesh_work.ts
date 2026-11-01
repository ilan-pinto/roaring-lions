/**
 * The Demolition engineer's `work` clip (GH-826 step 3), read off the shipped bytes: where his hands are against the
 * satchel, and what the body does to it. Shares no arithmetic with the motion pass (`motion/work.ts`).
 *
 *   hands   For each hand bone of the worker, over the clip at `hz`, the nearest any of its vertices comes to the charge's
 *           box, metres: negative is DEPTH inside the box. The charge is the file's `charge` role, static on the `prop` bone.
 *   body    The deepest any vertex of the worker that is NOT a hand sinks into the charge box, and the lowest vertex of the
 *           worker (a man leaning 48 degrees over a satchel can put a shoulder through the ground).
 */
import { computeSkinMats, nodeWorlds, readAccessor, readClip, readGlb, skinPoint } from './mesh_gait';

export interface WorkContact {
  readonly instants: number;
  /** Per hand bone: the smallest signed distance to the charge over the clip (negative = depth), and the largest. */
  readonly hands: Record<string, { readonly minM: number; readonly maxM: number }>;
  /** Deepest a non-hand vertex of the worker sits inside the charge's box, metres (0 when none does). */
  readonly bodyInChargeM: number;
  /** Lowest vertex of the worker over the clip, metres. */
  readonly lowestM: number;
  readonly charge: { readonly lo: [number, number, number]; readonly hi: [number, number, number] };
}

export function measureWorkContact(path: string, figure: string, clip = 'work', hz = 60): WorkContact {
  const glb = readGlb(path);
  const nodes = glb.json.nodes ?? [];
  const meshes = glb.json.meshes ?? [];
  const { tracks, start, end } = readClip(glb, clip);
  type Acc = ReturnType<typeof readAccessor>;
  interface Part { pos: Acc; joints: Acc; weights: Acc; skin: { joints: number[] }; ibm: Acc | null; dom: string[]; role: string }
  const parts: Part[] = [];
  for (const node of nodes) {
    if (node.mesh === undefined || node.skin === undefined) continue;
    const skin = glb.json.skins?.[node.skin];
    if (!skin) continue;
    const role = node.name ?? meshes[node.mesh]?.name ?? '';
    for (const prim of meshes[node.mesh].primitives) {
      const pos = readAccessor(glb, prim.attributes.POSITION);
      const joints = readAccessor(glb, prim.attributes.JOINTS_0);
      const weights = readAccessor(glb, prim.attributes.WEIGHTS_0);
      const ibm = skin.inverseBindMatrices === undefined ? null : readAccessor(glb, skin.inverseBindMatrices);
      const dom: string[] = [];
      for (let v = 0; v < pos.count; v++) {
        let best = -1, bw = 0;
        for (let k = 0; k < 4; k++) { const w = weights.data[v * 4 + k]; if (w > bw) { bw = w; best = joints.data[v * 4 + k]; } }
        dom.push(best < 0 ? '' : (nodes[skin.joints[best]]?.name ?? ''));
      }
      parts.push({ pos, joints, weights, skin, ibm, dom, role });
    }
  }
  // the charge: static, so read once at the clip's start
  const w0 = nodeWorlds(glb, tracks, start);
  const cpts: [number, number, number][] = [];
  for (const p of parts) {
    if (p.role !== 'charge') continue;
    const mats = computeSkinMats(p.skin, w0, p.ibm);
    for (let v = 0; v < p.pos.count; v++) cpts.push(skinPoint(p.pos, p.joints, p.weights, v, mats));
  }
  if (cpts.length === 0) throw new Error(`${path}: no charge vertex`);
  const lo = [0, 1, 2].map((a) => Math.min(...cpts.map((q) => q[a]))) as [number, number, number];
  const hi = [0, 1, 2].map((a) => Math.max(...cpts.map((q) => q[a]))) as [number, number, number];
  const signed = (q: readonly number[]): number => {
    const d = [0, 1, 2].map((a) => Math.max(lo[a] - q[a], 0, q[a] - hi[a]));
    const out = Math.hypot(d[0], d[1], d[2]);
    if (out > 0) return out;
    return -Math.min(...[0, 1, 2].flatMap((a) => [q[a] - lo[a], hi[a] - q[a]]));
  };
  const handNames = [`${figure}_hand_L`, `${figure}_hand_R`, `${figure}_finger_L`];
  const hands: Record<string, { minM: number; maxM: number }> = {};
  let bodyIn = 0, lowest = Infinity, instants = 0;
  const n = Math.max(2, Math.round((end - start) * hz));
  for (let i = 0; i <= n; i++) {
    const t = start + ((end - start) * i) / n;
    const worlds = nodeWorlds(glb, tracks, t);
    instants++;
    const perHand: Record<string, number> = {};
    for (const p of parts) {
      const mats = computeSkinMats(p.skin, worlds, p.ibm);
      for (let v = 0; v < p.pos.count; v++) {
        const j = p.dom[v];
        if (!j.startsWith(`${figure}_`) || j.includes('death') || j.endsWith('_fist_L') || j.endsWith('_fist_R') || j.endsWith('_weapon')) continue;
        const q = skinPoint(p.pos, p.joints, p.weights, v, mats);
        if (handNames.includes(j)) {
          // `finger_L` belongs to the firing hand
          const key = j === `${figure}_finger_L` ? `${figure}_hand_L` : j;
          perHand[key] = Math.min(perHand[key] ?? Infinity, signed(q));
          continue;
        }
        lowest = Math.min(lowest, q[1]);
        const s = signed(q);
        if (s < 0) bodyIn = Math.max(bodyIn, -s);
      }
    }
    for (const [k, d] of Object.entries(perHand)) {
      const cur = hands[k] ?? { minM: Infinity, maxM: -Infinity };
      hands[k] = { minM: Math.min(cur.minM, d), maxM: Math.max(cur.maxM, d) };
    }
  }
  return { instants, hands, bodyInChargeM: bodyIn, lowestM: lowest, charge: { lo, hi } };
}
