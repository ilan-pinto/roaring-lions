// GH-1438 E8 pacing, the PM ruling of 19 Nov 2026 (option b): the escort's pacing word `abductPace` is a `when: 'abduct'`
// runtime row, so it exists in the snapshot only for a mission with an `abduct` trigger. No shipped mission authors one, so
// every shipped mission's runtime schema digest, read where the SAVE PATH writes it (the snapshot header `cutMission` seals),
// is still the one an earlier build wrote, 65675699, and a mission save made before the next change still loads (the second
// half here, against the saves in `fixtures/old-mission-saves/`; its README says which build made them: the E6 merge, since
// E6's epoch bump retired dev's 78e6cefbd pair, as the lead accepted on 20 Nov 2026). The sim half (the section, the
// refusal, the poison) is `packages/sim/src/abduct-snapshot-row.test.ts`.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { missions } from '@lions/data/content';
import { cutMission, parseSuspended, prepareResume, restoreMission, type SuspendedMission } from '../../packages/app/src/mission-save';
import { shippedContentDigest } from '../../packages/app/src/net/content-digest';
import { abductWorld } from '../../packages/sim/src/runtime-abduct-world.test-helper';
import { SNAPSHOT_FIXED_HEADER_BYTES } from '../../packages/sim/src/snapshot';
import { HARNESS_SEED, missionWorld } from './mission-harness';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

/** The runtime schema digest of every runtime but a works-only one before E8 (the table at 93448908f; versus-works.test.ts). */
const DIGEST_BEFORE_E8 = 65675699;
/** An abduct runtime's (`abduct-snapshot-row.test.ts` pins the same number). */
const DIGEST_ABDUCT = 1626469548;

const headerDigest = (raw: Uint8Array): number => new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(SNAPSHOT_FIXED_HEADER_BYTES - 4, true);

/** The runtime schema digest the save path writes for `world` (the header of the snapshot `cutMission` encodes). */
function savedDigest(world: Pick<ReturnType<typeof missionWorld>, 'sim' | 'runtime'>, missionId: string): number {
  const c = cutMission({ sim: world.sim, runtime: world.runtime, missionId, seed: HARNESS_SEED, build: 'test', savedAt: 0, campaign: {}, contentDigest: 0 });
  if (!c.ok) throw new Error(`${missionId}: the cut was refused: ${c.detail}`);
  return headerDigest(c.cut.raw);
}

const SHIPPED = Object.keys(missions).sort();

describe('every shipped mission keeps the runtime schema digest it had before E8', () => {
  it('the catalogue is the directory, and not empty', () => {
    const files = readdirSync(join(ROOT, 'data', 'missions')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
    expect(SHIPPED.length).toBeGreaterThan(0);
    expect(SHIPPED).toEqual(files);
  });

  it.each(SHIPPED)('%s: 65675699 in the saved header', (id) => {
    expect(savedDigest(missionWorld(id, {}), id)).toBe(DIGEST_BEFORE_E8);
  });

  it('an abduct mission (the sim\'s abduct world) gets the gated digest instead', () => {
    const w = abductWorld();
    expect(savedDigest({ sim: w.sim, runtime: w.rt }, 'abduct_world')).toBe(DIGEST_ABDUCT);
    expect(DIGEST_ABDUCT).not.toBe(DIGEST_BEFORE_E8);
  });
});

interface OldSave {
  readonly record: SuspendedMission;
  /** The uninterrupted run on the build that saved it, `ticks` past the save. */
  readonly after: { readonly ticks: number; readonly sim: number; readonly runtime: number };
}

const OLD_DIR = join(HERE, 'fixtures', 'old-mission-saves');
const OLD = readdirSync(OLD_DIR).filter((f) => f.endsWith('.json')).sort();

describe('a mission save an earlier build made still loads, and plays on as that build played it', () => {
  it('there are old saves to read', () => {
    expect(OLD.length).toBeGreaterThan(0);
  });

  it.each(OLD)('%s', async (file) => {
    const old = JSON.parse(readFileSync(join(OLD_DIR, file), 'utf8')) as OldSave;
    const parsed = parseSuspended(JSON.stringify(old.record));
    if (!parsed.ok) throw new Error(`${file}: refused at parse: ${parsed.reason}`);
    const prepared = await prepareResume(parsed.record, { contentDigest: shippedContentDigest() });
    if (!prepared.ok) throw new Error(`${file}: refused at prepare: ${prepared.reason}`);
    expect(headerDigest(prepared.raw)).toBe(DIGEST_BEFORE_E8);
    const world = missionWorld(parsed.record.missionId, {}, parsed.record.seed);
    expect(restoreMission(prepared, world)).toEqual({ ok: true });
    for (let t = 0; t < old.after.ticks; t++) world.runtime.step(world.sim.tick());
    expect({ sim: world.sim.hash() >>> 0, runtime: world.runtime.digest() >>> 0 }).toEqual({ sim: old.after.sim, runtime: old.after.runtime });
  });
});
