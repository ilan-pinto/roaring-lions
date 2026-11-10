/**
 * G4 -- hands visible in battle (GH-746 follow-up, the 1 Nov infantry audit; scoped by the lead to the GAME camera on
 * 1 Nov, the store being replaced by painted cards). Every shown figure's two hands each show at least 3 unoccluded pixels
 * at the game's own maximum zoom, in at least 6 of 8 facings, in `idle` (frame 0) and `fire` (mid-clip).
 *
 * Why it exists. Every earlier judgement of a hand was made with the body removed, in a cutaway, at a distance in
 * millimetres. The Rifle Squad's firing hand is the proof: it grips, closed, in every clip, and at the low ready it sits
 * behind the magazine, the pouches and its own upper arm. No instrument had ever asked whether the PLAYER can see a hand.
 *
 * The camera is the game's: `updateDimetricCamera` (the orthographic 30-degree dimetric the renderer uses), at the zoom
 * ceiling `ZOOM_MAX` 2.5 (`app/src/ui/camera-input.ts`; pinned against its source below), rasterised at 4x that zoom so a
 * hand of a handful of pixels is not lost to rounding, and the threshold scaled back (48 px = 3 px at 2.5). The figures
 * are built the way a mission builds them (`buildMeshUnitTemplate`) with the MAXIMUM bought kit, the worst case for
 * occlusion, and rotated through 8 facings about the vertical.
 *
 * What a hand is: triangles on `{p}_hand_{L|R}` and its trigger finger when the hands pass has run; otherwise the Meshy
 * claw, taken as the forearm bone's triangles within 0.12 m of its farthest point from the posed elbow (an approximation
 * the audit's wrist table refines; held and worn roles excluded). A hand with no geometry (fused into the torso) reads 0.
 *
 * Self-occlusion (the lead's rulings, 1 and 9 Nov): "directions where the figure's own torso hides the hand do not count;
 * the bar stays strict for every other direction". The reading looks through the figure's own TORSO -- its triangles on
 * its own `spine` and `pelvis` bones that are not a held role, the kit worn there included (a plate carrier is the
 * torso's surface) -- and keeps everything else as an occluder: its own arms and head, the held weapon (the magazine),
 * another figure of the team, any unskinned object. So a facing counts as seen when nothing but the torso stands between
 * the camera and the hand, and still needs the 3 pixels; the 6 of 8 bar is unchanged. `selfOcclusion: 'count'` is the
 * old reading, kept to show the exclusion does work; `occluder` puts a box in front of a hand to show a foreign object
 * still hides it; `torsoOnly: false` looks through the whole own body, to show the arm is still an occluder.
 *
 * Zoom 1 is not gated: a hand is 2 px there by construction. The bar of 6 of 8 is the audit's A8, awaiting the lead's
 * word; most claw hands sit at 4-5.
 *
 * Every team that fails is a named exemption with a demotion assertion.
 */
import { readFileSync, readdirSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { updateDimetricCamera } from '../camera';
import { collectTriangles, visibleSubject, type SceneTriangles } from '../garage/garage-focus';
import { parseGlbHeadless } from './headless-gltf';
import { MESH_SCALE } from './mesh-anim';
import { buildMeshUnitTemplate } from './mesh-unit';

const DIR = new URL('../../../../../art/meshes/', import.meta.url);

/** The game's zoom ceiling, restated; pinned against `camera-input.ts` below. */
const ZOOM_MAX = 2.5;
const SUPERSAMPLE = 4;
const VIEWPORT = 640;
const MIN_PIXELS = 3;
const FACINGS = 8;
const FACINGS_NEEDED = 6;
/**
 * The lead, 9 Nov 2026 (GH-746): a figure with REAL-SIZE fists -- the Meshy figure, its fists scaled to ANSUR size
 * (`rl_hands.source` "meshy") -- must show each hand in 4 of 8 facings, not 6. At the zoom ceiling a real fist is 1-2 px
 * from more facings than the 1.4x fists the bar of 6 was set on; the bar still holds a hand that is not there (below).
 */
const FACINGS_NEEDED_REAL_SIZE = 4;
const realSizeFists = (id: string): boolean => {
  const b = readFileSync(new URL(`${id}.glb`, DIR));
  const jl = b.readUInt32LE(12);
  const js = JSON.parse(b.subarray(20, 20 + jl).toString('utf8')) as { scenes?: { extras?: { rl_hands?: { source?: string } } }[] };
  return js.scenes?.[0]?.extras?.rl_hands?.source === 'meshy';
};
const facingsNeeded = (id: string): number => (realSizeFists(id) ? FACINGS_NEEDED_REAL_SIZE : FACINGS_NEEDED);
const CLAW_REACH_M = 0.12;
const FULL_KIT = { armour: 3, sensors: 3, firepower: 3 } as const;
const HELD_OR_WORN = new Set(['weapon', 'metal', 'charge', 'wood', 'webbing', 'face']);
/** A thing in the hand: never "the figure's own torso" for the self-occlusion exclusion. */
const HELD = new Set(['weapon', 'metal', 'charge', 'wood']);
/** The figure's own torso, by bone (after the `{p}_` prefix): what the self-occlusion exclusion looks through. */
const TORSO_BONES = new Set(['spine', 'pelvis']);
/** The constructed foreign occluder: a cube this wide (metres) at the hand's centroid. */
const OCCLUDER_M = 0.3;
const NOT_A_TEAM = /^(wounded_|ugv_)/;

interface HandReading {
  /** `{build}_{L|R}` */
  readonly hand: string;
  readonly kind: 'modelled' | 'claw' | 'none';
  /** Facings of 8 in which the hand shows at least `MIN_PIXELS` at zoom 2.5. */
  readonly facings: number;
}

/**
 * `tris` without figure `p`'s own torso: its triangles on its own `spine`/`pelvis` that are not a held role (the worn kit
 * there included), the hand's own (`keep`) excepted. What the camera sees of the hand when the figure's own torso is looked
 * through; its arms and head, another figure, the held weapon and any unskinned object stay. `torsoOnly: false` looks
 * through the whole own body (a constructed input: the arm must still hide a hand). Returns the subset and `keep`
 * remapped onto it.
 */
function withoutOwnTorso(tris: SceneTriangles, p: string, keep: Uint8Array, torsoOnly = true): { tris: SceneTriangles; mask: Uint8Array } {
  const idx: number[] = [];
  for (let i = 0; i < tris.count; i++) {
    const b = tris.bone[i];
    // a KIT part on the torso is worn, never held, whichever role mesh carries it (round 5, 9 Nov: the EUD, a phone flat
    // on the plate, rides the `weapon` role mesh for its glass; read as held, it hid the firing fist in idle once the
    // round-5 base seated it on the chest -- round 4's f0 EUD had hit a stray face 32 cm in front of the chest)
    const wornKit = tris.kit[i] === 1 && TORSO_BONES.has(b.slice(p.length + 1));
    const own = b.startsWith(`${p}_`) && (!HELD.has(tris.role[i]) || wornKit);
    const looked = own && (!torsoOnly || TORSO_BONES.has(b.slice(p.length + 1)));
    if (keep[i] || !looked) idx.push(i);
  }
  const pos = new Float32Array(idx.length * 9);
  idx.forEach((t, k) => pos.set(tris.pos.subarray(t * 9, t * 9 + 9), k * 9));
  return {
    tris: {
      pos, count: idx.length, role: idx.map((t) => tris.role[t]), name: idx.map((t) => tris.name[t]),
      kit: Uint8Array.from(idx, (t) => tris.kit[t]), owner: Int16Array.from(idx, (t) => tris.owner[t]), bone: idx.map((t) => tris.bone[t])
    },
    mask: Uint8Array.from(idx, (t) => keep[t]),
  };
}

/**
 * Every shown figure's hands in `clip`, at `zoom` (default the game's ceiling), as facings seen of 8. `hide` names bones to
 * scale away after the pose (a constructed failing input); `occluder` names a hand (`{build}_{L|R}`) to put a foreign cube
 * in front of (another); `selfOcclusion: 'count'` counts the figure's own torso as an occluder (the pre-ruling reading);
 * `torsoOnly: false` looks through the whole own body, arms and head too (wider than the ruling: a constructed input).
 */
async function readHands(
  id: string, clip: 'idle' | 'fire',
  opts: { zoom?: number; hide?: readonly string[]; occluder?: string; selfOcclusion?: 'exclude' | 'count'; torsoOnly?: boolean } = {}
): Promise<HandReading[] | null> {
  const zoom = (opts.zoom ?? ZOOM_MAX) * SUPERSAMPLE;
  const gltf = await parseGlbHeadless(readFileSync(new URL(`${id}.glb`, DIR)));
  const tpl = buildMeshUnitTemplate(gltf as never, 'kdf', `${id}.glb`, true, FULL_KIT);
  const root = tpl.root;
  const clipData = tpl.clips.get(clip);
  if (!clipData) return null;
  const bones: THREE.Bone[] = [];
  root.traverse((o) => { if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone); });
  const builds = [...new Set(bones.map((b) => /^(.*)_forearm_L$/.exec(b.name)?.[1]).filter((x): x is string => !!x))];
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clipData).play();
  mixer.setTime(clip === 'idle' ? 0 : clipData.duration * 0.5);
  for (const h of opts.hide ?? []) bones.find((b) => b.name === h)?.scale.setScalar(0);
  const seen = new Map<string, { kind: HandReading['kind']; facings: number }>();
  const handMask = (tris: SceneTriangles, p: string, s: 'L' | 'R'): { kind: HandReading['kind']; mask: boolean[] } => {
    let kind: HandReading['kind'] = 'modelled';
    let mask = tris.bone.map((b) => b === `${p}_hand_${s}` || b === `${p}_finger_${s}`);
    if (!mask.some(Boolean)) {
      kind = 'claw';
      const fb = `${p}_forearm_${s}`;
      const elbow = root.getObjectByName(fb)?.getWorldPosition(new THREE.Vector3());
      const idx = elbow ? [...Array(tris.count).keys()].filter((i) => tris.bone[i] === fb && !HELD_OR_WORN.has(tris.role[i])) : [];
      const d = idx.map((i) => Math.hypot(
        (tris.pos[i * 9] + tris.pos[i * 9 + 3] + tris.pos[i * 9 + 6]) / 3 - elbow!.x,
        (tris.pos[i * 9 + 1] + tris.pos[i * 9 + 4] + tris.pos[i * 9 + 7]) / 3 - elbow!.y,
        (tris.pos[i * 9 + 2] + tris.pos[i * 9 + 5] + tris.pos[i * 9 + 8]) / 3 - elbow!.z));
      const far = d.length > 0 ? Math.max(...d) : 0;
      const keep = new Set(idx.filter((_, j) => d[j] >= far - CLAW_REACH_M * MESH_SCALE));
      mask = tris.bone.map((_, i) => keep.has(i));
    }
    return { kind, mask };
  };
  let occluderPlaced = false;
  for (let k = 0; k < FACINGS; k++) {
    root.rotation.y = (k * Math.PI * 2) / FACINGS;
    root.updateMatrixWorld(true);
    let tris = collectTriangles(root, []);
    if (opts.occluder && !occluderPlaced) {
      // a foreign cube at the hand's centroid, a child of the root so it turns with the facings; unskinned, so no bone
      const [p, s] = [opts.occluder.slice(0, -2), opts.occluder.slice(-1) as 'L' | 'R'];
      const { mask } = handMask(tris, p, s);
      const c = new THREE.Vector3();
      let n = 0;
      mask.forEach((m, i) => { if (m) { for (let j = 0; j < 3; j++) c.add(new THREE.Vector3(tris.pos[i * 9 + j * 3], tris.pos[i * 9 + j * 3 + 1], tris.pos[i * 9 + j * 3 + 2])); n += 3; } });
      if (n === 0) throw new Error(`${opts.occluder}: no hand triangles to occlude`);
      c.divideScalar(n);
      const ws = root.getWorldScale(new THREE.Vector3()).x;
      const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
      cube.scale.setScalar((OCCLUDER_M * MESH_SCALE) / ws);
      cube.position.copy(root.worldToLocal(c.clone()));
      root.add(cube);
      root.updateMatrixWorld(true);
      occluderPlaced = true;
      tris = collectTriangles(root, []);
    }
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (let i = 0; i < tris.count * 3; i++) box.expandByPoint(v.set(tris.pos[i * 3], tris.pos[i * 3 + 1], tris.pos[i * 3 + 2]));
    const c = box.getCenter(new THREE.Vector3());
    const cam = updateDimetricCamera({ x: c.x, y: c.z, zoom } as never, { width: VIEWPORT, height: VIEWPORT } as never, new THREE.OrthographicCamera());
    for (const p of builds) {
      if (!tris.bone.some((b) => b.startsWith(`${p}_`))) continue; // not drawn in this clip: a posture twin, a corpse rig
      for (const s of ['L', 'R'] as const) {
        const key = `${p}_${s}`;
        const { kind, mask } = handMask(tris, p, s);
        const prev = seen.get(key) ?? { kind: mask.some(Boolean) ? kind : 'none', facings: 0 };
        if (mask.some(Boolean)) {
          const m = Uint8Array.from(mask, (x) => (x ? 1 : 0));
          const seenBy = opts.selfOcclusion === 'count' ? { tris, mask: m } : withoutOwnTorso(tris, p, m, opts.torsoOnly ?? true);
          const px = visibleSubject(seenBy.tris, seenBy.mask, cam, VIEWPORT, VIEWPORT).pixels;
          if (px / (SUPERSAMPLE * SUPERSAMPLE) >= MIN_PIXELS) prev.facings += 1;
          prev.kind = kind;
        }
        seen.set(key, prev);
      }
    }
  }
  return [...seen].map(([hand, r]) => ({ hand, kind: r.kind, facings: r.facings }));
}

/** What is wrong, as a list: every shown hand in each clip that shows in fewer than 6 facings. */
async function violations(id: string, opts: Parameters<typeof readHands>[2] = {}): Promise<string[]> {
  const out: string[] = [];
  for (const clip of ['idle', 'fire'] as const) {
    const hands = await readHands(id, clip, opts);
    if (hands === null) {
      if (clip === 'idle') out.push(`no idle clip`);
      continue;
    }
    if (hands.length === 0) out.push(`${clip}: no figure drawn`);
    const need = facingsNeeded(id);
    for (const h of hands) if (h.facings < need) out.push(`${clip} ${h.hand} (${h.kind}): ${h.facings} of ${FACINGS} facings`);
  }
  return out;
}

/**
 * Teams with a hand that does not show in 6 of 8 facings at the zoom ceiling. Worst readings from the bytes on 1 Nov 2026
 * (facings of 8, idle / fire; `_L` is the figure's anatomical right). The art backlog.
 */
const HAND_VISIBILITY_EXEMPT: Readonly<Record<string, string>> = {
  at_nlos_team: 'nl_gun R 4; nl_load R 4: hands hang behind the body or the launcher',
  at_team: 'at_fire: 2 and 0 of 8 in idle (the launcher hides both hands); at_spot fine',
  atgm_cell: 'atgm_crew1 L 0 (the missing left hand); atgm_crew0 R 4',
  breach_team: 'left hand 0 of 8 on both men (fused firing arm, support hand behind the shield); brc_point R 3',
  charge_squad: 'every hand 5 of 8 in idle, fire',
  // demo_squad left 9 Nov: with its own torso looked through (the lead's ruling) every hand reads 6-7 of 8; counted, demo_b L
  // read 0 in idle. Its palette rifle (role weapon, on demo_b_weapon) still occludes.
  digger_crew: 'both hands 0 of 8: the arm is fused into the torso (and the team has no fire clip)',
  inf_grenadier: 'gre0 and gre2 R 0 of 8: the launcher hides the support claw; gre1 R 4',
  // inf_squad (the Meshy pilot, real-size fists) is held to its own bar of 4 (FACINGS_NEEDED_REAL_SIZE), no exemption.
  inf_medic_squad: 'med_a R 5, med_b R 5 and 4 (block hands)',
  manpad_team: 'mpd_fire L shows in 4 of 8 facings',
  militia_cell: 'every hand 5 of 8 in idle',
  mortar_crew: 'emtr_crew0 R 5 and 4, emtr_crew1 L 5',
  mortar_team: 'mtr_crew0 R 5, mtr_crew1 L 5, mtr_no3 L 5 in idle',
  officer_engineer: 'sap L 0 of 8 (the Combat Engineer body: the firing claw is behind the rifle); dalia R 5',
  officer_fires: 'sagi both hands 0 of 8: the arm is fused into the torso',
  recoilless_team: 'rcl_fire both hands 4; rcl_load L 4-5',
  recon_zikit: 'zk_spot L 3, zk_rifle L 3 in idle, zk_radio 3-5',
  rpg_team: 'rpg_load L shows in 3 of 8 facings in idle',
  sarim_rifles: 'every hand 5 of 8 in idle',
  sniper_team: 'both men, both hands 0 of 8: the arms are welded to the torso',
  yahalom_squad: 'yah_a L shows in 4 of 8 facings',
};

const teams = readdirSync(DIR)
  .filter((n) => n.endsWith('.glb') && !NOT_A_TEAM.test(n))
  .map((n) => n.replace(/\.glb$/, ''))
  .filter((t) => t !== 'moto_rpg');

describe('G4: every hand is seen by the battle camera', () => {
  it('restates the game\'s zoom ceiling correctly (camera-input.ts)', () => {
    const src = readFileSync(new URL('../../../../app/src/ui/camera-input.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/export const ZOOM_MAX = 2\.5;/);
  });

  it('reads the population: 23 teams, exemptions all real', () => {
    expect(teams.length).toBe(23);
    for (const k of Object.keys(HAND_VISIBILITY_EXEMPT)) expect(teams, k).toContain(k);
  });

  it.each(teams.filter((t) => !(t in HAND_VISIBILITY_EXEMPT)))('%s: every hand shows in 6 of 8 facings', async (id) => {
    expect(await violations(id)).toEqual([]);
  }, 120_000);

  it.each(teams.filter((t) => t in HAND_VISIBILITY_EXEMPT))('%s: still fails (else delete it from HAND_VISIBILITY_EXEMPT)', async (id) => {
    const v = await violations(id);
    expect(v.length, `${id}: every hand now shows in 6 of 8 facings. Delete its exemption.`).toBeGreaterThan(0);
    expect(HAND_VISIBILITY_EXEMPT[id].length, 'a reason, not a name').toBeGreaterThan(20);
  }, 120_000);
});

describe('G4 can fail (constructed inputs)', () => {
  it('officer_infantry passes at the zoom ceiling', async () => {
    expect(await violations('officer_infantry')).toEqual([]);
  }, 120_000);
  it('...and fails at zoom 0.5, where a hand is under 3 px', async () => {
    expect((await violations('officer_infantry', { zoom: 0.5 })).length).toBeGreaterThan(0);
  }, 120_000);
  it('...and fails with one forearm scaled away (a hand that is not there)', async () => {
    const v = await violations('officer_infantry', { hide: ['maya_forearm_L'] });
    expect(v.join(' | ')).toMatch(/maya_L/);
  }, 120_000);
  it('...and fails with a foreign cube in front of a hand: only the figure\'s OWN body is looked through', async () => {
    const v = await violations('officer_infantry', { occluder: 'maya_L' });
    expect(v.join(' | ')).toMatch(/maya_L/);
  }, 120_000);
  it('the real-size bar of 4 still fails a hand that is not there: inf_squad with f0\'s firing forearm scaled away', async () => {
    expect(realSizeFists('inf_squad')).toBe(true);
    expect(await violations('inf_squad')).toEqual([]);
    const v = await violations('inf_squad', { hide: ['f0_forearm_L'] });
    expect(v.join(' | ')).toMatch(/f0_L/);
  }, 240_000);
  it('the self-occlusion exclusion does work: counted, a figure\'s own torso hides a hand it otherwise shows', async () => {
    // demo_squad in idle (9 Nov): demo_b's firing claw reads 0 of 8 counted and 6 with its own torso looked through
    const worst = (r: HandReading[] | null) => Math.min(...(r ?? []).map((h) => h.facings));
    const counted = worst(await readHands('demo_squad', 'idle', { selfOcclusion: 'count' }));
    const excluded = worst(await readHands('demo_squad', 'idle'));
    expect(counted).toBeLessThan(excluded);
    expect(excluded).toBeGreaterThanOrEqual(FACINGS_NEEDED);
  }, 240_000);
  it('...and only the TORSO: looked through the whole own body, a hand the ruling still counts as hidden would pass', async () => {
    // sarim_rifles sar0_R in idle: 5 of 8 with the torso looked through (his own arm and the rifle hide it), 7 with the
    // whole own body. Widening the exclusion to the whole body would pass a hand its own arm hides.
    const hand = (r: HandReading[] | null) => (r ?? []).find((h) => h.hand === 'sar0_R')?.facings ?? -1;
    const torso = hand(await readHands('sarim_rifles', 'idle'));
    const whole = hand(await readHands('sarim_rifles', 'idle', { torsoOnly: false }));
    expect(torso).toBeLessThan(FACINGS_NEEDED);
    expect(whole).toBeGreaterThanOrEqual(FACINGS_NEEDED);
  }, 240_000);
});
