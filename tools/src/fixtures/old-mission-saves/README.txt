dev-78e6cefbd.<mission>.json -- a suspended mission save (`SuspendedMission`, as a store holds it) that dev made at commit
78e6cefbd (PR 1639, the last dev commit before E8 pacing, GH-1438), with the hashes of the same run carried on unbroken for
`after.ticks` more ticks on that build. `runtime_digest_shipped.test.ts` loads each with the current code, requires it to
restore (`restoreMission` ok), and requires the restored world to reach the same hashes: the proof that a save made before
the `when: 'abduct'` row existed still loads and still plays the same. A save the current code refuses turns it red.

Made with this script, run with `npx tsx` from `tools/` of a worktree at 78e6cefbd, as `<mission> 2400 <out.json>`:

  import { writeFileSync } from 'node:fs';
  import { HARNESS_SEED, missionWorld } from './mission-harness';
  import { serializeSuspended, suspendMission } from '../../packages/app/src/mission-save';
  import { shippedContentDigest } from '../../packages/app/src/net/content-digest';
  const [id, ticksArg, out] = process.argv.slice(2);
  const AFTER = 400;
  const w = missionWorld(id, {});
  for (let t = 0; t < Number(ticksArg); t++) w.runtime.step(w.sim.tick());
  const r = await suspendMission({ sim: w.sim, runtime: w.runtime, contentDigest: shippedContentDigest(), missionId: id,
    seed: HARNESS_SEED, build: 'dev 78e6cefbd', savedAt: 1_795_564_800_000, campaign: { ledger: {} } });
  if (!r.ok) throw new Error(`${r.reason} ${r.detail}`);
  for (let t = 0; t < AFTER; t++) w.runtime.step(w.sim.tick());
  writeFileSync(out, JSON.stringify({ record: JSON.parse(serializeSuspended(r.record)),
    after: { ticks: AFTER, sim: w.sim.hash() >>> 0, runtime: w.runtime.digest() >>> 0 } }) + '\n');

A new sim epoch, snapshot format or state table legitimately refuses these: then the test is red on purpose, and the
fixtures are retired with the change that refuses them, saying so.
