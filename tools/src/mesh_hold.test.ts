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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { measureHold, readGlb } from './mesh_gait';
import { MOTION_TEAMS } from './meshes/motion/teams';

const MESHES = fileURLToPath(new URL('../../art/meshes/', import.meta.url));

const scratch = mkdtempSync(path.join(tmpdir(), 'hold-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
/** A copy of `file` with every key of `node`'s translation track in `clip` moved `dx` metres along its parent's x. */
function withWeaponMoved(file: string, clip: string, node: string, dx: number): string {
  const raw = readFileSync(file);
  const glb = readGlb(file);
  const bin = Buffer.from(glb.bin);
  const ni = (glb.json.nodes ?? []).findIndex((n) => n.name === node);
  const anim = glb.json.animations!.find((a) => a.name === clip)!;
  const ch = anim.channels.find((c) => c.target.node === ni && c.target.path === 'translation');
  if (!ch) throw new Error(`${file}: ${node} has no translation track in ${clip}`);
  const acc = glb.json.accessors![anim.samplers[ch.sampler].output];
  const bv = glb.json.bufferViews![acc.bufferView!];
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const stride = bv.byteStride ?? 12;
  for (let k = 0; k < acc.count; k++) bin.writeFloatLE(bin.readFloatLE(base + k * stride) + dx, base + k * stride);
  const out = Buffer.from(raw);
  bin.copy(out, 20 + raw.readUInt32LE(12) + 8);
  const f = path.join(scratch, `moved_${node}_${clip}.glb`);
  writeFileSync(f, out);
  return f;
}

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

/**
 * A reading that fails for a REAL defect, named with its reading and a demotion (it must still fail, or the entry goes).
 * GH-746 Meshy pilot (9 Nov, round-3 bytes): the skinned f2 (the 1.72 m body) runs with the rifle up and his lean kept,
 * and his eye dips to 0.018 m over the bore at the low point of the stride (f0 0.029, f1 0.027; the motion pass prints
 * -0.019..0.004 by its own measure): the cheek leaves the stock in the run. Fire, kneel and pinned read 0.063-0.084.
 */
const EYE_OPEN_DEFECT: Readonly<Record<string, string>> = {
  'inf_squad f2 moveFire': 'eye 0.018 m over the bore at its lowest (band from 0.02): the run keeps its lean and the cheek leaves the stock',
};

const HELD = Object.entries(MOTION_TEAMS).flatMap(([team, spec]) =>
  spec.figures.filter((f) => f.weapon).map((f) => ({ team, prefix: f.prefix, kind: f.weapon!, kneels: !!f.kneels }))
);

describe('the hold can fail on a fused (Meshy) hand', () => {
  // The fused-hand reading (the hand bone's own vertices, measureHold) must still see a hand off the gun: the shipped
  // inf_squad with f1's weapon bone carried 0.25 m along x in fire reads past HAND_GAP_MAX_M. A constructed input.
  it('f1 fire with the weapon bone moved 0.25 m reads the worse hand past the limit, and the shipped bytes do not', () => {
    const file = `${MESHES}inf_squad.glb`;
    expect(measureHold(file, 'fire', 'f1').handGapM).toBeLessThan(HAND_GAP_MAX_M);
    expect(measureHold(withWeaponMoved(file, 'fire', 'f1_weapon', 0.25), 'fire', 'f1').handGapM).toBeGreaterThan(HAND_GAP_MAX_M);
  }, 60_000);
  it('every open eye defect names a held figure and clip this file reads', () => {
    for (const k of Object.keys(EYE_OPEN_DEFECT)) {
      const [team, prefix] = k.split(' ');
      expect(HELD.some((h) => h.team === team && h.prefix === prefix), k).toBe(true);
      expect(EYE_OPEN_DEFECT[k].length, 'a reason, not a name').toBeGreaterThan(20);
    }
  });
});

describe('the hold: hands on the weapon, eye over the bore', () => {
  it('reads every held figure the motion pass places', () => {
    // Rule 1 of mesh_gait.test.ts: the population first. 3 + 3 + 2 + 1 + 2 +
    // 1 + 1 + 1 + 1 + 1: inf, sarim, militia, yahalom, rpg (rifle and RPG),
    // demo, mortar No.3, MANPAD, and since spike-walk (6 Oct) the Spike and
    // the Zikit's rifleman; GH-707 P2 (22 Oct): + 2, the medics' carbines;
    // GH-709 phase 3 (22 Oct) the Chomet grenadier squad, 3: two launchers and a
    // carbine, all `rifle`-kind holds; and GH-709 Phase 7 the Zaron team's leader.
    expect(HELD).toHaveLength(22);
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
        if (`${h.team} ${h.prefix} ${clip}` in EYE_OPEN_DEFECT) {
          expect(r.eyeAboveBoreMin, `still under the band (else delete its EYE_OPEN_DEFECT entry)`).toBeLessThanOrEqual(band[0]);
          expect(r.eyeAboveBoreMax, 'eye above bore, highest').toBeLessThan(band[1]);
          return;
        }
        expect(r.eyeAboveBoreMin, 'eye above bore, lowest').toBeGreaterThan(band[0]);
        expect(r.eyeAboveBoreMax, 'eye above bore, highest').toBeLessThan(band[1]);
      }, 60_000);
    }
  }
});
