/**
 * GH-1393 slice 2: the save library against real CAMPAIGN missions, at the app's capacity (256), mid-fight.
 *
 * Slice 1 proved the round trip on a versus economy room and left two things open: the size cap had only been measured on that room, and no
 * campaign mission had been cut and resumed. The world here is the playtest harness's own (`playtest-run.ts`'s `run`, the same terrain,
 * structures, tunnels, unit types and `MissionRuntime` setup `main.ts` mirrors), driven with an idle player so the enemy's scripted
 * behaviour is what happens. Run A cuts the mission at tick T and carries on; run B builds the same world afresh, restores the record at
 * tick 0 and carries on. They must agree on the sim hash and the runtime digest at every second after T, and end byte-equal.
 *
 * NOT proved here, and said so: `bootBattlefield`'s own world build (the briefing, the deploy choice, the loaned force, the dock) is not
 * this harness. The boot's inputs are frozen in the record and rebuilt by `main.ts`; that path has no headless witness yet (design S3).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { encodeSim, type MissionRuntime, type Sim } from '@lions/sim';
import { run, setSweep } from './backtest/playtest-run';
import { MISSION_SAVE_MAX_COMPRESSED_BYTES, cutMission, parseSuspended, prepareResume, restoreMission, sealMission, serializeSuspended, type SuspendedMission } from '../../packages/app/src/mission-save';

const SECONDS_BEFORE = 90;   // the cut, in mission seconds
const SECONDS_AFTER = 20;    // how long both runs are compared afterwards
const ALWAYS = { knownMission: () => true };

interface Probe { sim: number; runtime: number; enc: string }
const probe = (sim: Sim, rt: MissionRuntime): Probe => ({ sim: sim.hash() >>> 0, runtime: rt.digest() >>> 0, enc: Buffer.from(encodeSim(sim, {}, rt)).toString('base64') });

beforeAll(() => {
  // run() prints a line a run and sets the exit code when its expectation fails; this test has no expectation of how the idle player ends.
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  setSweep(undefined, true);
});
afterEach(() => { process.exitCode = 0; });

interface Witness { id: string; tag: string }
const MISSIONS: Witness[] = [
  { id: 'tel_marum_2_foothold', tag: 'production lines and a 1,000-unit-scale map' },
  { id: 'beit_sahwan_4_subterranean', tag: 'tunnels, civilians and a production line' },
  { id: 'khan_rafid_3_clearance', tag: 'the largest shipped starting force, civilians' },
];

async function witness(id: string): Promise<{ record: SuspendedMission; a: Probe[]; b: Probe[]; raw: number; gz: number; tick: number }> {
  let record: SuspendedMission | null = null;
  let cutError = '';
  const a: Probe[] = [];
  let pending: Promise<void> = Promise.resolve();
  // Run A: the mission, an idle player; cut at SECONDS_BEFORE, then probe every second.
  run(id as never, (sim, rt, _ids, at) => {
    at(SECONDS_BEFORE, () => {
      const c = cutMission({ sim, runtime: rt, missionId: id, seed: 424242, build: 'test', savedAt: 1, campaign: { ledger: {}, tiers: {}, unlocks: [], deploy: null } });
      if (!c.ok) { cutError = c.detail; return; }
      pending = sealMission(c.cut).then((r) => { if (r.ok) record = r.record; else cutError = `${r.reason}: ${r.detail}`; });
    });
    for (let k = 1; k <= SECONDS_AFTER; k++) at(SECONDS_BEFORE + k, () => { a.push(probe(sim, rt)); });
  }, {}, 'defeat');
  await pending;
  if (record === null) throw new Error(`${id}: no record was cut (${cutError})`);
  const rec: SuspendedMission = record;
  // Run B: a fresh world, the record restored before the first tick, probed every second after the cut.
  const prepared = await prepareResume(parseOk(rec));
  if (!prepared.ok) throw new Error(`${id}: ${prepared.reason}`);
  const b: Probe[] = [];
  let restored = '';
  let atCut: Probe | null = null;
  run(id as never, (sim, rt, _ids, at) => {
    at(0, () => {
      const r = restoreMission(prepared, { sim, runtime: rt });
      restored = r.ok ? 'ok' : r.reason;
      atCut = probe(sim, rt);
    });
    for (let k = 1; k <= SECONDS_AFTER; k++) at(k, () => { b.push(probe(sim, rt)); });
  }, {}, 'defeat');
  expect(restored, `${id}: the restore`).toBe('ok');
  expect(atCut).not.toBeNull();
  return { record: rec, a, b, raw: rec.rawBytes, gz: Buffer.from(rec.snapshot, 'base64').length, tick: rec.simTick };
}

const parseOk = (rec: SuspendedMission): SuspendedMission => {
  const p = parseSuspended(serializeSuspended(rec), ALWAYS);
  if (!p.ok) throw new Error(p.reason);
  return p.record;
};

describe('a campaign mission, cut mid-fight and resumed in a fresh world (capacity 256)', () => {
  for (const { id, tag } of MISSIONS) {
    it(`${id} (${tag}): equal sim hash, runtime digest and canonical encoding every second for ${SECONDS_AFTER} s after the cut`, async () => {
      const w = await witness(id);
      expect(w.tick).toBe(SECONDS_BEFORE * 20);
      expect(w.a).toHaveLength(SECONDS_AFTER);
      expect(w.b).toHaveLength(SECONDS_AFTER);
      for (let k = 0; k < SECONDS_AFTER; k++) {
        expect(w.b[k]?.sim, `${id} +${k + 1}s sim`).toBe(w.a[k]?.sim);
        expect(w.b[k]?.runtime, `${id} +${k + 1}s runtime`).toBe(w.a[k]?.runtime);
      }
      expect(w.b.at(-1)?.enc).toBe(w.a.at(-1)?.enc);
      // The world moved after the cut, or "equal" proves nothing (a fight is on).
      expect(new Set(w.a.map((p) => p.sim)).size).toBeGreaterThan(3);
    }, 240_000);
  }

  it('the size cap holds with room to spare on all three (the S0 re-measure the review asked for)', async () => {
    const rows: string[] = [];
    for (const { id } of MISSIONS) {
      const w = await witness(id);
      rows.push(`${id}: raw ${w.raw} gz ${w.gz} stored ${serializeSuspended(w.record).length}`);
      expect(w.gz, id).toBeLessThan(MISSION_SAVE_MAX_COMPRESSED_BYTES / 4);
      expect(serializeSuspended(w.record).length, id).toBeLessThan(250 * 1024);
    }
    process.stderr.write(rows.join('\n') + '\n');
  }, 600_000);
});
