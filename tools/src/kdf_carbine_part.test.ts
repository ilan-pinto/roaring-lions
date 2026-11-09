/**
 * The `kdf_carbine` part's pistol grip, guard and trigger, and the stations a hand closes on
 * (GH-826 F4, spec 1.6 and 1.10). The instrument is `kdf_carbine_part.ts`; the limits are the
 * spec's numbers, literals in `GRIP_LIMITS`.
 *
 * FALSIFICATION (run and watched red, 31 Oct 2026):
 *  - the pre-GH-826 part (`art/parts/kdf_carbine/pre_gh826/`, the exporter's `--no-reshape`
 *    output, whose vertices equal the shipped bytes to 0.0 m) reads 'grip not found ... a 0.130 x
 *    0.070 x 0.163 m fist-sized block': red here, every run;
 *  - mutations of `kdf_carbine_grip.py` re-exported to a scratch directory and read with this
 *    instrument: see the commit message for the numbers.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BUTT_X, distanceToLine, distanceToSurface, GRIP_LIMITS, gripViolations, measureGrip, sectionAt, type GripReading,
} from './kdf_carbine_part';

const PART = fileURLToPath(new URL('../../art/parts/kdf_carbine/', import.meta.url));
const NEW = `${PART}kdf_carbine.glb`;
const OLD = `${PART}pre_gh826/kdf_carbine.glb`;
const stations = JSON.parse(readFileSync(`${PART}stations.json`, 'utf8')).stations;

describe('the reshaped kdf_carbine grip', () => {
  const r = measureGrip(NEW);

  it('passes every limit of the spec', () => {
    expect(gripViolations(r)).toEqual([]);
  });

  it('is a 0.030 x 0.050 grip raked 20 degrees, under 380 triangles', () => {
    expect(r.found).toBe(true);
    expect(r.triangles).toBeLessThanOrEqual(380);
    expect(r.widthM).toBeGreaterThan(0.027); expect(r.widthM).toBeLessThan(0.033);
    expect(r.depthM).toBeGreaterThan(0.046); expect(r.depthM).toBeLessThan(0.054);
    expect(r.rakeDeg).toBeGreaterThan(17); expect(r.rakeDeg).toBeLessThan(23);
  });

  it('has a real trigger guard, 0.015 clear of the magazine, and a length of pull of 0.33 to 0.38', () => {
    expect(r.guardRunM).toBeGreaterThanOrEqual(0.045);
    expect(r.magClearM!).toBeGreaterThan(0.010); expect(r.magClearM!).toBeLessThan(0.025);
    expect(r.lengthOfPullM!).toBeGreaterThan(0.33); expect(r.lengthOfPullM!).toBeLessThan(0.38);
  });

  it('keeps the part 0.85 m long, so the importer still takes it as canonical', () => {
    expect(r.lengthM).toBeGreaterThan(0.84); expect(r.lengthM).toBeLessThan(0.86);
  });
});

describe('the stations a hand closes on', () => {
  const r = measureGrip(NEW);

  it('puts the grip station on the grip\'s own axis, measured here, not read back from the exporter', () => {
    expect(distanceToLine(stations.grip.point, r.axisPoint!, r.axisDir!)).toBeLessThan(GRIP_LIMITS.stationTolM);
  });

  it('puts the support station on the handguard\'s underside, within 3 mm of the surface', () => {
    expect(distanceToSurface(NEW, stations.support.point)).toBeLessThan(GRIP_LIMITS.stationTolM);
  });

  it('names the handguard\'s real section, which is not the spec\'s 0.046 cylinder', () => {
    const [w, h] = stations.support.section as [number, number];
    const s = sectionAt(NEW, BUTT_X + stations.support.u);
    expect(Math.abs(s.widthM - w)).toBeLessThan(0.005);
    expect(Math.abs(s.heightM - h)).toBeLessThan(0.005);
    expect(Math.min(s.widthM, s.heightM)).toBeGreaterThan(0.06);       // the spec's 0.046 would put 12 mm of weapon inside the hand
  });

  it('sets the grip station 0.045 below where the grip leaves the receiver, behind the guard', () => {
    expect(stations.grip.u).toBeGreaterThan(0.24); expect(stations.grip.u).toBeLessThan(0.30);
    expect(stations.support.u).toBeGreaterThanOrEqual(0.53);          // the magazine well's front plus 2 cm
  });
});

describe('falsification: the part as shipped before GH-826', () => {
  const r = measureGrip(OLD);
  it('is red: the grip is a fist-sized block, part of the body, with no guard or trigger', () => {
    const v = gripViolations(r);
    expect(v.length).toBeGreaterThan(0);
    expect(v.join(' ')).toMatch(/grip not found/);
    expect(r.blockM![0]).toBeGreaterThan(0.12);            // 0.130 m long
    expect(r.blockM![1]).toBeGreaterThan(0.065);           // 0.070 m wide: a second fist beside the hand
  });
  it('has no trigger guard to find', () => {
    expect(r.guardRunM).toBe(0);
  });
});

describe('the instrument can fail', () => {
  const good = measureGrip(NEW);
  const wider: GripReading = { ...good, widthM: good.widthM * 1.3 };
  it('flags a grip a third too wide', () => expect(gripViolations(wider).join()).toMatch(/grip width/));
  it('flags a grip with no rake', () => expect(gripViolations({ ...good, rakeDeg: 0 }).join()).toMatch(/grip rake/));
  it('flags a guard pressed against the magazine', () => expect(gripViolations({ ...good, magClearM: 0.002 }).join()).toMatch(/clearance/));
  it('flags a length of pull outside the band', () => expect(gripViolations({ ...good, lengthOfPullM: 0.41 }).join()).toMatch(/length of pull/));
  it('flags a part over 380 triangles', () => expect(gripViolations({ ...good, triangles: 381 }).join()).toMatch(/triangles/));
});
