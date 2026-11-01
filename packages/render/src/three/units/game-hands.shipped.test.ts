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
 * Zoom 1 is not gated: a hand is 2 px there by construction. The bar of 6 of 8 is the audit's A8, awaiting the lead's
 * word; most claw hands sit at 4-5.
 *
 * Every team that fails is a named exemption with a demotion assertion.
 */
import { readFileSync, readdirSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { updateDimetricCamera } from '../camera';
import { collectTriangles, visibleSubject } from '../garage/garage-focus';
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
const CLAW_REACH_M = 0.12;
const FULL_KIT = { armour: 3, sensors: 3, firepower: 3 } as const;
const HELD_OR_WORN = new Set(['weapon', 'metal', 'charge', 'wood', 'webbing', 'face']);
const NOT_A_TEAM = /^(wounded_|ugv_)/;

interface HandReading {
  /** `{build}_{L|R}` */
  readonly hand: string;
  readonly kind: 'modelled' | 'claw' | 'none';
  /** Facings of 8 in which the hand shows at least `MIN_PIXELS` at zoom 2.5. */
  readonly facings: number;
}

/**
 * Every shown figure's hands in `clip`, at `zoom` (default the game's ceiling), as facings seen of 8. `hide` names bones to
 * scale away after the pose (a constructed failing input).
 */
async function readHands(
  id: string, clip: 'idle' | 'fire', opts: { zoom?: number; hide?: readonly string[] } = {}
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
  for (let k = 0; k < FACINGS; k++) {
    root.rotation.y = (k * Math.PI * 2) / FACINGS;
    root.updateMatrixWorld(true);
    const tris = collectTriangles(root, []);
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (let i = 0; i < tris.count * 3; i++) box.expandByPoint(v.set(tris.pos[i * 3], tris.pos[i * 3 + 1], tris.pos[i * 3 + 2]));
    const c = box.getCenter(new THREE.Vector3());
    const cam = updateDimetricCamera({ x: c.x, y: c.z, zoom } as never, { width: VIEWPORT, height: VIEWPORT } as never, new THREE.OrthographicCamera());
    for (const p of builds) {
      if (!tris.bone.some((b) => b.startsWith(`${p}_`))) continue; // not drawn in this clip: a posture twin, a corpse rig
      for (const s of ['L', 'R'] as const) {
        const key = `${p}_${s}`;
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
        const prev = seen.get(key) ?? { kind: mask.some(Boolean) ? kind : 'none', facings: 0 };
        if (mask.some(Boolean)) {
          const m = Uint8Array.from(mask, (x) => (x ? 1 : 0));
          const px = visibleSubject(tris, m, cam, VIEWPORT, VIEWPORT).pixels;
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
    for (const h of hands) if (h.facings < FACINGS_NEEDED) out.push(`${clip} ${h.hand} (${h.kind}): ${h.facings} of ${FACINGS} facings`);
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
  demo_squad: 'demo_b L 0 of 8 in idle (the firing claw behind the palette rifle), 5 in fire; demo_a 5',
  digger_crew: 'both hands 0 of 8: the arm is fused into the torso (and the team has no fire clip)',
  inf_grenadier: 'gre0 and gre2 R 0 of 8: the launcher hides the support claw; gre1 R 4',
  inf_medic_squad: 'med_a R 5, med_b R 5 and 4 (block hands)',
  inf_squad: 'the firing hand (bone _L) 0 of 8 in idle, 3-4 in fire: behind the magazine, the pouches and the upper arm. The support hand shows 7',
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
});
