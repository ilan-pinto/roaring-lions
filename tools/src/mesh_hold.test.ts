/**
 * The hold, gated on the shipped bytes (the motion pass, 5 Oct; finding #1 of
 * the motion checkpoint): both hands ON the weapon, and on an aimed clip the
 * eye over the bore -- the cheek on the stock.
 *
 * Measured before the pass, by this file's own instrument (`measureHold`) on
 * `c28de4d7`: a rifleman's worse hand 0.195-0.279 m from his weapon, his eye
 * 0.516-0.646 m above its bore, in idle, fire and moveFire alike (the rifle
 * at the hip, the support hand hanging). After: hands 0.025-0.074 m (the
 * distance from a glove's own centroid to the weapon's surface), eye
 * 0.064-0.075 m on every aimed rifle, 0.03 on the RPG (its sight sits beside
 * the cheek, the bore lower than a rifle's). The bands below sit in those gaps.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { measureHold } from './mesh_gait';
import { MOTION_TEAMS } from './meshes/motion/teams';

const MESHES = fileURLToPath(new URL('../../art/meshes/', import.meta.url));

/** Worse hand to the weapon's nearest vertex, metres. */
const HAND_GAP_MAX_M = 0.1;
/** Eye above the bore on an aimed clip, metres. */
const EYE_ABOVE_BORE: readonly [number, number] = [0.02, 0.12];
/**
 * The Spike (spike-walk, 6 Oct) has no cheek weld: its command-launch unit
 * sits on top of the REAR of the tube, in front of the eye, so the cloud's
 * long axis runs above the bore and the eye reads just BELOW it -- -0.047 m
 * on every sample of fire, moveFire and kneel, the importer's own seat. The
 * chest carry it walks with puts that axis 0.25-0.26 m under the eye.
 */
const EYE_AT_SPIKE: readonly [number, number] = [-0.1, 0.0];

const HELD = Object.entries(MOTION_TEAMS).flatMap(([team, spec]) =>
  spec.figures.filter((f) => f.weapon).map((f) => ({ team, prefix: f.prefix, kind: f.weapon!, kneels: !!f.kneels }))
);

describe('the hold: hands on the weapon, eye over the bore', () => {
  it('reads every held figure the motion pass places', () => {
    // Rule 1 of mesh_gait.test.ts: the population first. 3 + 3 + 2 + 1 + 2 +
    // 1 + 1 + 1 + 1 + 1: inf, sarim, militia, yahalom, rpg (rifle and RPG),
    // demo, mortar No.3, MANPAD, and since spike-walk (6 Oct) the Spike and
    // the Zikit's rifleman.
    expect(HELD).toHaveLength(16);
  });

  for (const h of HELD) {
    // A tube keeps the importer's own carry in idle/move (apply-hold.ts), so
    // only its aimed clips are the hold's.
    const aimed = ['fire', 'moveFire', ...(h.kneels ? ['kneel'] : [])];
    // ...except the Spike, whose carry is the hold's too (apply-hold.ts).
    const ready = h.kind === 'rifle' || h.kind === 'spike' ? ['idle', 'move'] : [];
    const eyeClips = h.kind === 'manpad' ? [] : aimed; // a MANPAD aims 35 deg up: no cheek weld
    for (const clip of [...ready, ...aimed]) {
      // One measurement per clip, both gates read from it.
      it(`${h.team} ${h.prefix} ${clip}: both hands on the weapon${eyeClips.includes(clip) ? ', the eye on the bore' : ''}`, () => {
        const r = measureHold(`${MESHES}${h.team}.glb`, clip, h.prefix);
        expect(r.instants, 'instants with the weapon drawn').toBeGreaterThan(0);
        expect(r.handGapM, 'worse hand to the weapon').toBeLessThan(HAND_GAP_MAX_M);
        if (!eyeClips.includes(clip)) return;
        const band = h.kind === 'spike' ? EYE_AT_SPIKE : EYE_ABOVE_BORE;
        expect(r.eyeAboveBoreMin, 'eye above bore, lowest').toBeGreaterThan(band[0]);
        expect(r.eyeAboveBoreMax, 'eye above bore, highest').toBeLessThan(band[1]);
      }, 60_000);
    }
  }
});
