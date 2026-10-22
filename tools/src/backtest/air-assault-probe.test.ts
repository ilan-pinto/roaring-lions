// The air-assault probe's own mechanics (GH-698). The probe is report-only -- no number it
// prints fails anything -- so what is pinned here is the HARNESS: that arm C really lands to
// load, carries six, unloads on the LZ, and that every arm shares one set of entity ids. Each
// check was seen red under a one-line mutation of air-assault-probe.ts (listed in the commit).
import { describe, expect, it } from 'vitest';
import { AIR_LAND_TICKS } from '../../../packages/sim/src/tuning';
import { ARMS, LAYOUTS, checkLayout, run, seedOf } from './air-assault-probe';

// CPU-bound sim runs with no I/O; each is under a second on a quiet machine. The margin is for
// a loaded machine running the whole suite in parallel, as versus-probe.test.ts's is.
const RUN_TIMEOUT_MS = 30_000;
const SEED = seedOf(0);

describe('air-assault probe: the layouts', () => {
  it('every objective is a foot- and vehicle-open tile and every spawn stands on open ground', () => {
    expect(checkLayout('tel_marum')).toEqual([]);
    expect(checkLayout('qarn_hadid')).toEqual([]);
  }, RUN_TIMEOUT_MS);
});

describe('air-assault probe: arm C, the cold landing zone', () => {
  it('lands to load, carries all six squads, unloads ON the LZ and gets them there', () => {
    for (const m of ['tel_marum', 'qarn_hadid'] as const) {
      const r = run(m, 'C', SEED);
      expect(r.landedToLoad, `${m}: first rider seated while LANDED`).toBe(true);
      expect(r.maxAboard, `${m}: riders aboard at once`).toBe(6);
      // Two landings, each the full AIR_LAND_TICKS: one to load, one to unload.
      expect(r.stateTicks[1], `${m}: ticks LANDING`).toBe(2 * AIR_LAND_TICKS);
      expect(r.unloadTile, `${m}: the tile it unloaded on`).toEqual([...LAYOUTS[m].objective]);
      expect(r.arrivedS, `${m}: arrival`).not.toBeNull();
      expect(r.squadsLost).toBe(0);
      expect(r.yanshufLost).toBe(false);
    }
  }, RUN_TIMEOUT_MS);
});

describe('air-assault probe: a hostile case, the kill attribution', () => {
  // Seed 1, not 0 (fix/air-pathing). Since the Yanshuf flies the straight line rather than the
  // foot route, seed 0's reaches its LZ and is killed while LANDING (state 1, riders bail out);
  // seed 1's is still downed AIRBORNE, which is the case this witness exists for.
  it('Tel Marum arm E (ZU-23 at standoff), seed 1: shot down AIRBORNE with six aboard, all six lost with it', () => {
    const r = run('tel_marum', 'E', seedOf(1));
    expect(r.yanshufLost).toBe(true);
    expect(r.yanshufKillState).toBe(0); // AIR_AIRBORNE, as a literal
    expect(r.yanshufKillAboard).toBe(6);
    expect(r.squadsLostAboard).toBe(6);
    expect(r.squadsLost).toBe(6);
    expect(r.arrivedS).toBeNull();
  }, RUN_TIMEOUT_MS);

  // The airborne case alone cannot see a mutant that hardcodes AIRBORNE (it is 0): this one can.
  it('Tel Marum arm D (MANPAD at standoff), seed 0: killed while LANDING with six aboard, who bail out and arrive', () => {
    const r = run('tel_marum', 'D', SEED);
    expect(r.yanshufLost).toBe(true);
    expect(r.yanshufKillState).toBe(1); // AIR_LANDING, as a literal
    expect(r.yanshufKillAboard).toBe(6);
    expect(r.squadsLostAboard).toBe(0);
    expect(r.squadsLost).toBe(0);
    expect(r.arrivedS).not.toBeNull();
  }, RUN_TIMEOUT_MS);
});

describe('air-assault probe: one world for every arm', () => {
  it('spawns the same ids in every arm, and a debugKilled unit keeps its id and is dead from t=0', () => {
    // Squads 0-5, Kipod 6, Yanshuf 7, Peten 8, MANPAD 9, gun truck 10.
    const removed: Record<string, number[]> = {
      A: [6, 7, 8, 9, 10], B: [7, 8, 9, 10], C: [6, 8, 9, 10], D: [6, 8, 10], E: [6, 8, 9], F: [6, 8], G: [6],
    };
    for (const a of ARMS) {
      const r = run('qarn_hadid', a, SEED, { capTicks: 1 });
      expect(r.ids, a).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(r.removed, a).toEqual(removed[a]);
    }
  }, RUN_TIMEOUT_MS);

  it('arm A (foot) fields no carrier: the Kipod and the Yanshuf are removed, the squads walk in', () => {
    const r = run('tel_marum', 'A', SEED);
    expect(r.maxAboard).toBe(0);
    expect(r.stateTicks).toEqual([0, 0, 0, 0]);
    expect(r.arrivedS).not.toBeNull();
  }, RUN_TIMEOUT_MS);
});
