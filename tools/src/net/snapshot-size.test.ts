import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { SNAPSHOT_MAX_COMPRESSED_BYTES } from '@lions/net';
import { encodeSim } from '../../../packages/sim/src/snapshot';
import { economyWorld, stressWorld, type SnapWorld } from './snapshot-witness';

// The upload cap's headroom (snapshot S3, task 13). The room refuses a body over 64 KiB; this holds the two
// worst real snapshots the repository can build to half of it, at the compressor a browser uses.
//
// The level matters: `CompressionStream('gzip')` is zlib's default, level 6, and the 15.4 KiB the stress world
// measured at level 9 (spec 12.3) is the smaller figure. `zlib.gzipSync` with no options is that same default,
// so the numbers here are the browser's.

/** Plays `world` to `tick` exactly as the witness plays it, then encodes it (with its runtime, when it has one). */
function encodeAt(world: SnapWorld, tick: number): Uint8Array {
  for (let t = 0; t < tick; t++) {
    world.driveAt(t);
    world.advanceOnce();
  }
  return world.runtime === null ? encodeSim(world.sim, { frameTick: tick - 1 }) : encodeSim(world.sim, { frameTick: tick - 1 }, world.runtime);
}

describe('the snapshot cap has headroom at the default gzip level', () => {
  const HALF = SNAPSHOT_MAX_COMPRESSED_BYTES / 2;

  it('the 256-entity stress world at tick 600, and the wadi_tarfan economy room (a runtime) at tick 1,200, each gzip to at most half the cap', () => {
    const cases = [
      { id: 'stress tel_marum 256 entities 1000 @600', raw: encodeAt(stressWorld('tel_marum', 1000), 600) },
      { id: 'economy wadi_tarfan kdf/sarim 8919 @1200', raw: encodeAt(economyWorld('wadi_tarfan', ['kdf', 'sarim'], 8919), 1200) },
    ];
    const sizes = cases.map((c) => ({ id: c.id, raw: c.raw.length, gz: gzipSync(c.raw).length }));
    console.info(`snapshot sizes at gzip level 6: ${sizes.map((s) => `${s.id}: ${s.raw} B raw, ${s.gz} B gzip`).join('; ')}; the cap is ${SNAPSHOT_MAX_COMPRESSED_BYTES} B and half of it ${HALF} B`);
    for (const s of sizes) {
      expect(s.raw, `${s.id} inflates inside the cap's raw bound`).toBeLessThanOrEqual(1024 * 1024);
      expect(s.gz, `${s.id}: ${s.gz} B gzip against half the cap, ${HALF} B`).toBeLessThanOrEqual(HALF);
    }
  }, 30_000);   // measured 4.2 s (two worlds played to tick 600 and tick 1,200); 7x headroom for a loaded CI box
});
