/**
 * G3 -- each hand closed on its declared object, in every clip (GH-746 follow-up, the 1 Nov infantry audit).
 *
 * For each figure and each living clip, each hand has a DECLARED object (a literal manifest below), is a closed modelled
 * hand (the hands pass wrote it a pose: `extras.rl_hands.stations` names the grip and the support station), and has at
 * least 20% of its palm-side surface within 8 mm of that object, by area, at every sampled instant (30 Hz; the Rifle
 * Squad's own grip gate, `mesh_grip.test.ts`, samples at 60 and 120).
 *
 * Why it exists. The grip gates measured millimetres to a station for the hands a file HAS. An open claw 2 cm from a rifle
 * passes a distance band; an empty claw beside a mortar passes because there is no station to be off. "Holding" was a
 * proxy (the audit's root cause 6). Here a hand either exists as a closed assembly and closes on the declared object, or
 * the team is a named exemption.
 *
 * Scope, stated: the contact is `measureGrip`'s (palm-side area within 8 mm of the WEAPON cloud), so the only declared
 * object it can read is `weapon`; a team item (a mortar round, a litter handle, a shield) needs the object cloud extended
 * when its hands land. The test therefore REFUSES a team that has hands but no measurement route (see the last test of the
 * census block) rather than passing it. NOT done: "the object lies between the thumb and the fingers".
 *
 * Every team whose hands are still open claws is a named exemption with a demotion assertion.
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { measureGrip, readGlb, type GlbFile } from './mesh_gait';
import { figureBuilds, handAssembly, handsExtras, infantryTeams, isTwin, readRoleMeshes } from './mesh_figures';

const MESHES = fileURLToPath(new URL('../../art/meshes/', import.meta.url));

/** Palm-side surface within 8 mm of the object, by area (the audit's 20%; the Rifle Squad's own gate holds 25%). */
const CONTACT_MIN = 0.2;
const CLIPS = ['idle', 'move', 'fire', 'moveFire', 'kneel', 'kneelIn', 'kneelOut', 'pinned'] as const;
const HZ = 30;

/**
 * The manifest: who holds what, both hands, every clip in `CLIPS`. Literals. A figure with no entry holds nothing, and a
 * team with no entry at all must be in `HOLD_EXEMPT`.
 */
export const HOLDS: Readonly<Record<string, { figures: readonly string[]; object: 'weapon' }>> = {
  inf_squad: { figures: ['f0', 'f1', 'f2'], object: 'weapon' },
};

/** A team is a closed-hands team when every figure has both hands as modelled assemblies AND the pass declared the poses. */
export function hasClosedHands(glb: GlbFile): boolean {
  if (handsExtras(glb) === null) return false;
  const meshes = readRoleMeshes(glb);
  const builds = figureBuilds(glb);
  return builds
    .filter((b) => !isTwin(b, builds))
    .every((b) => (['L', 'R'] as const).every((s) => handAssembly(glb, b, s, meshes).triangles > 0));
}

/** Lowest palm-side contact of either hand over `clip`, for one figure. */
export function lowestContact(glb: GlbFile, clip: string, fig: string): { fire: number; support: number } {
  const r = measureGrip('', clip, fig, { glb, hz: HZ });
  return { fire: r.fire.contact ?? 0, support: r.support.contact ?? 0 };
}

export const HOLD_EXEMPT: Readonly<Record<string, string>> = Object.fromEntries(
  [
    ['at_nlos_team', 'open claws: nl_load holds nothing, nl_gun\'s launcher stands apart from him in the store'],
    ['at_team', 'open claws: at_fire\'s support hand hides behind the launcher, at_spot holds only binoculars'],
    ['atgm_cell', 'one claw per man; atgm_crew1 holds nothing'],
    ['breach_team', 'one separable claw, empty in every clip; the support hand is behind the shield'],
    ['charge_squad', 'open claws; chg0 holds no charge'],
    ['demo_squad', 'open orange claws; demo_a holds nothing in any clip (work included), demo_b one-handed on a palette rifle'],
    ['digger_crew', 'arm fused into the torso: the pick is in no separable hand'],
    ['inf_grenadier', 'open tan claws on the launchers, the firing claw hidden'],
    ['inf_medic_squad', 'block hands; empty in treat'],
    ['manpad_team', 'open claws; mpd_spot holds nothing'],
    ['militia_cell', 'open claws on the AK'],
    ['mortar_crew', 'open claws; emtr_crew1 holds no round'],
    ['mortar_team', 'open pink claws: the two crewmen hold nothing in any clip'],
    ['officer_engineer', 'the Combat Engineer body: open claws'],
    ['officer_fires', 'open claws; the observer\'s arm is fused'],
    ['officer_infantry', 'open claws on both officers'],
    ['recoilless_team', 'open claws; rcl_load holds no round'],
    ['recon_zikit', 'open black claws; zk_radio and zk_spot hold nothing'],
    ['rpg_team', 'open claws; rpg_load carries no rocket'],
    ['sarim_rifles', 'open claws on the AK'],
    ['sniper_team', 'arms welded to the torso: no separable hand'],
    ['yahalom_squad', 'open black claws; yah_a holds only a detector pole'],
  ] as const
);

const teams = infantryTeams(MESHES, (d) => readdirSync(d));

describe('G3: each hand closed on its object', () => {
  it('reads the population: every team is a held team xor a named exemption', () => {
    expect(teams.length).toBe(23);
    const names = teams.map(([t]) => t);
    for (const k of [...Object.keys(HOLDS), ...Object.keys(HOLD_EXEMPT)]) expect(names, k).toContain(k);
    expect(names.filter((t) => t in HOLDS && t in HOLD_EXEMPT)).toEqual([]);
    expect(names.filter((t) => !(t in HOLDS) && !(t in HOLD_EXEMPT))).toEqual([]);
  });

  it.each(Object.keys(HOLDS))('%s: the manifest names every figure, and the team has closed hands', (team) => {
    const glb = teams.find(([t]) => t === team)![1];
    const builds = figureBuilds(glb);
    expect(HOLDS[team].figures.slice().sort()).toEqual(builds.filter((b) => !isTwin(b, builds)).sort());
    expect(hasClosedHands(glb), `${team}: no closed hands to measure`).toBe(true);
  });

  for (const [team, h] of Object.entries(HOLDS)) {
    const glb = readGlb(`${MESHES}${team}.glb`);
    for (const fig of h.figures) {
      for (const clip of CLIPS) {
        it(`${team} ${fig} ${clip}: both hands closed on the ${h.object}, at least ${CONTACT_MIN * 100}% of the palm within 8 mm`, () => {
          const c = lowestContact(glb, clip, fig);
          expect(c.fire, 'firing hand contact').toBeGreaterThanOrEqual(CONTACT_MIN);
          expect(c.support, 'support hand contact').toBeGreaterThanOrEqual(CONTACT_MIN);
        }, 120_000);
      }
    }
  }

  it.each(teams.filter(([t]) => t in HOLD_EXEMPT))(
    '%s: still has no closed hands (else delete it from HOLD_EXEMPT and give it a HOLDS entry)',
    (team, glb) => {
      expect(hasClosedHands(glb), `${team} now has closed hands on every figure: its exemption has expired. Delete it.`).toBe(false);
      expect(HOLD_EXEMPT[team].length, 'a reason, not a name').toBeGreaterThan(15);
    }
  );
});

// ---- constructed failing inputs --------------------------------------------------------------------------------------

/** A copy of `glb` with every key of `node`'s `prop` track in `clip` passed through `edit` (in memory; nothing is written). */
function patched(glb: GlbFile, clip: string, node: string, prop: 'rotation' | 'translation', edit: (v: number[]) => number[]): GlbFile {
  const json = JSON.parse(JSON.stringify(glb.json)) as GlbFile['json'];
  const bin = new Uint8Array(glb.bin);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const nodes = json.nodes ?? [];
  const ni = nodes.findIndex((n) => n.name === node);
  const anim = json.animations!.find((a) => a.name === clip)!;
  const ch = anim.channels.find((c) => c.target.node === ni && c.target.path === prop);
  if (!ch) throw new Error(`no ${prop} track on ${node} in ${clip}`);
  const acc = json.accessors![anim.samplers[ch.sampler].output];
  const bv = json.bufferViews![acc.bufferView!];
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const n = prop === 'rotation' ? 4 : 3;
  for (let k = 0; k < acc.count; k++) {
    const v = [0, 1, 2, 3].slice(0, n).map((c) => dv.getFloat32(base + (k * n + c) * 4, true));
    edit(v).forEach((x, c) => dv.setFloat32(base + (k * n + c) * 4, x, true));
  }
  return { json, bin };
}

describe('G3 can fail (constructed inputs)', () => {
  const squad = readGlb(`${MESHES}inf_squad.glb`);
  it('the shipped Rifle Squad holds in fire (so the reds below are the patch)', () => {
    const c = lowestContact(squad, 'fire', 'f1');
    expect(c.fire).toBeGreaterThanOrEqual(CONTACT_MIN);
    expect(c.support).toBeGreaterThanOrEqual(CONTACT_MIN);
  }, 60_000);
  it('the weapon moved 10 cm off both hands in fire reads below the floor (5 cm still reads 22%: the contact is a weak instrument)', () => {
    const off = patched(squad, 'fire', 'f1_weapon', 'translation', (v) => [v[0], v[1] - 0.1, v[2]]);
    const c = lowestContact(off, 'fire', 'f1');
    expect(Math.min(c.fire, c.support)).toBeLessThan(CONTACT_MIN);
  }, 60_000);
  it('a Meshy claw team has no closed hands at all (the pose is not declared, there is no hand bone)', () => {
    expect(hasClosedHands(teams.find(([t]) => t === 'mortar_team')![1])).toBe(false);
    expect(hasClosedHands(squad)).toBe(true);
  });
});
