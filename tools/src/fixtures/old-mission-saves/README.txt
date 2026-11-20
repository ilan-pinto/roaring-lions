e6-merge.<mission>.json -- a suspended mission save (`SuspendedMission`, as a store holds it) made on the merge of dev into
the E6 branch (fires on civilians, GH-1438, PR 1652; sim epoch 3), with the hashes of the same run carried on unbroken for
`after.ticks` more ticks on that build. `runtime_digest_shipped.test.ts` loads each with the current code, requires it to
restore (`restoreMission` ok), and requires the restored world to reach the same hashes: the proof that a save made before
the next change still loads and still plays the same. A save the current code refuses turns it red.

History. The first pair, dev-78e6cefbd.<mission>.json, was made at 78e6cefbd (PR 1639, the last dev commit before E8
pacing) under sim epoch 2. E6 bumped the epoch to 3 (its two sim snapshot rows `civFire` and `civFireLive` move the
snapshot schema digest, so the epoch moves with it), which refuses every epoch-2 save as `older_version`: the lead
accepted that on 20 Nov 2026 (a mission saved or paused before E6 restarts instead of resuming). So that pair was retired
in the E6 merge and this pair made in its place, by the script below with the build string `E6 merge, PR 1652`. Both
missions' `hashAtSave` and `after` hashes are byte for byte the retired pair's: E6 changes no shipped mission's play, only
the snapshot's size (+265 bytes raw, the two rows).

Made with this script, run with `npx tsx` from `tools/` of a worktree at the build named, as `<mission> 2400 <out.json> <build>`:

  import { writeFileSync } from 'node:fs';
  import { HARNESS_SEED, missionWorld } from './mission-harness';
  import { serializeSuspended, suspendMission } from '../../packages/app/src/mission-save';
  import { shippedContentDigest } from '../../packages/app/src/net/content-digest';
  const [id, ticksArg, out, build] = process.argv.slice(2);
  const AFTER = 400;
  const w = missionWorld(id, {});
  for (let t = 0; t < Number(ticksArg); t++) w.runtime.step(w.sim.tick());
  const r = await suspendMission({ sim: w.sim, runtime: w.runtime, contentDigest: shippedContentDigest(), missionId: id,
    seed: HARNESS_SEED, build, savedAt: 1_795_564_800_000, campaign: { ledger: {} } });
  if (!r.ok) throw new Error(`${r.reason} ${r.detail}`);
  for (let t = 0; t < AFTER; t++) w.runtime.step(w.sim.tick());
  writeFileSync(out, JSON.stringify({ record: JSON.parse(serializeSuspended(r.record)),
    after: { ticks: AFTER, sim: w.sim.hash() >>> 0, runtime: w.runtime.digest() >>> 0 } }) + '\n');

A new sim epoch, snapshot format or state table legitimately refuses these: then the test is red on purpose, and the
fixtures are retired with the change that refuses them, saying so.
