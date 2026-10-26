import { describe, expect, it } from 'vitest';
import { FakeStorage } from './fake-do';
import { LOG_FROM_SQL, SNAP_CREATE_SQL, SNAP_GET_SQL, SNAP_PUT_SQL, SNAP_TICK_SQL } from './snapshot-sql';
import { gzip, snapshotBytes, bomb } from './snapshot-fixture';

const BATCH_CREATE = 'CREATE TABLE IF NOT EXISTS batch (first_tick INTEGER PRIMARY KEY, frames TEXT NOT NULL)';
const BATCH_PUT = 'INSERT OR REPLACE INTO batch (first_tick, frames) VALUES (?, ?)';
const SHA = 'ab'.repeat(32);
const ab = (...n: number[]): ArrayBuffer => new Uint8Array(n).buffer;

describe('FakeStorage: the snapshot table and the windowed log read (snapshot S3)', () => {
  it('still refuses a statement it does not know', () => {
    const s = new FakeStorage();
    s.sql.exec(BATCH_CREATE);
    expect(() => s.sql.exec('SELECT * FROM snapshot')).toThrow(/unsupported SQL/);
    expect(() => s.sql.exec('DROP TABLE batch')).toThrow(/unsupported SQL/);
  });

  it('the snapshot statements throw "no such table" before the CREATE', () => {
    const s = new FakeStorage();
    expect(() => s.sql.exec(SNAP_TICK_SQL)).toThrow('no such table: snapshot');
    expect(() => s.sql.exec(SNAP_GET_SQL)).toThrow('no such table: snapshot');
    expect(() => s.sql.exec(SNAP_PUT_SQL, 39, SHA, 1, ab(1))).toThrow('no such table: snapshot');
    expect(s.hasSnapshotTable).toBe(false);
    s.sql.exec(SNAP_CREATE_SQL);
    expect(s.hasSnapshotTable).toBe(true);
    expect(s.sql.exec(SNAP_TICK_SQL).toArray()).toEqual([]);
    expect(s.rowsWritten).toBe(0);   // a CREATE counts no row
  });

  it('a put counts one row, is one row per room, and reads back cloned bytes', () => {
    const s = new FakeStorage();
    s.sql.exec(SNAP_CREATE_SQL);
    const src = ab(1, 2, 3);
    s.sql.exec(SNAP_PUT_SQL, 39, SHA, 3735928559, src);
    expect(s.rowsWritten).toBe(1);
    new Uint8Array(src)[0] = 99;   // the caller's buffer is not the stored one
    const [row] = s.sql.exec(SNAP_GET_SQL).toArray();
    expect(row.frame_tick).toBe(39);
    expect(row.sha).toBe(SHA);
    expect(row.digest).toBe(3735928559);
    expect(row.bytes).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(row.bytes as ArrayBuffer)]).toEqual([1, 2, 3]);
    s.sql.exec(SNAP_PUT_SQL, 79, SHA, 5, ab(7));
    expect(s.rowsWritten).toBe(2);
    expect(s.sql.exec(SNAP_GET_SQL).toArray().length).toBe(1);
    expect(s.sql.exec(SNAP_TICK_SQL).toArray()).toEqual([{ frame_tick: 79 }]);
  });

  it('a put validates its bindings as workerd would bind them', () => {
    const s = new FakeStorage();
    s.sql.exec(SNAP_CREATE_SQL);
    expect(() => s.sql.exec(SNAP_PUT_SQL, 39.5, SHA, 1, ab(1))).toThrow(/bad bindings/);
    expect(() => s.sql.exec(SNAP_PUT_SQL, 39, 'xyz', 1, ab(1))).toThrow(/bad bindings/);
    expect(() => s.sql.exec(SNAP_PUT_SQL, 39, SHA, -1, ab(1))).toThrow(/bad bindings/);
    expect(() => s.sql.exec(SNAP_PUT_SQL, 39, SHA, 2 ** 32, ab(1))).toThrow(/bad bindings/);
    expect(() => s.sql.exec(SNAP_PUT_SQL, 39, SHA, 1, new Uint8Array([1]))).toThrow(/bad bindings/);   // a view is not an ArrayBuffer
    expect(() => s.sql.exec(SNAP_PUT_SQL, 39, SHA, 1)).toThrow(/bad bindings/);
    expect(s.rowsWritten).toBe(0);
  });

  it('deleteAll counts the snapshot row and removes the table', async () => {
    const s = new FakeStorage();
    s.sql.exec(BATCH_CREATE);
    s.sql.exec(SNAP_CREATE_SQL);
    s.sql.exec(SNAP_PUT_SQL, 39, SHA, 1, ab(1));
    s.sql.exec(BATCH_PUT, 0, '[]');
    await s.put('state', {});
    const before = s.rowsWritten;   // 3 writes so far
    await s.deleteAll();
    expect(s.rowsWritten - before).toBe(3);   // the key, the batch row and the snapshot row
    expect(s.hasSnapshotTable).toBe(false);
    expect(s.snapshotRow).toBeNull();
    expect(() => s.sql.exec(SNAP_TICK_SQL)).toThrow('no such table: snapshot');
  });

  it('LOG_FROM_SQL returns only batches with first_tick > the binding, in order, and meters the rows read', () => {
    const s = new FakeStorage();
    s.sql.exec(BATCH_CREATE);
    for (const t of [40, 0, 20, 60]) s.sql.exec(BATCH_PUT, t, `[${t}]`);
    const got = (after: number): number[] => s.sql.exec(LOG_FROM_SQL, after).toArray().map((r) => r.first_tick as number);
    expect(got(19)).toEqual([20, 40, 60]);
    expect(got(20)).toEqual([40, 60]);
    expect(got(-20)).toEqual([0, 20, 40, 60]);
    expect(got(60)).toEqual([]);
    expect(s.rowsRead).toBe(3 + 2 + 4 + 0);
    expect(() => s.sql.exec(LOG_FROM_SQL)).toThrow(/bad bindings/);
  });
});

describe('snapshot-fixture', () => {
  it('writes the header words and varies the SHA with the filler', () => {
    const b = snapshotBytes({ frameTick: 1199, matchDigest: 0xdeadbeef, fill: 7 });
    expect([...b.subarray(0, 4)]).toEqual([0x52, 0x4c, 0x53, 0x53]);
    const v = new DataView(b.buffer);
    expect(v.getUint16(4, true)).toBe(1);
    expect(v.getUint32(10, true)).toBe(3735928559);
    expect(v.getUint32(18, true)).toBe(1199);
    expect(snapshotBytes({ frameTick: 1199, matchDigest: 0xdeadbeef, fill: 8 })).not.toEqual(b);
  });

  it('gzips to something the platform inflates back, and a bomb is small', async () => {
    const b = snapshotBytes({ frameTick: 39, matchDigest: 1 });
    const gz = await gzip(b);
    expect(gz[0]).toBe(0x1f);
    expect(gz[1]).toBe(0x8b);
    const out = await new Response(new Blob([gz as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    expect([...new Uint8Array(out)]).toEqual([...b]);
    expect((await bomb(4 * 1024 * 1024)).byteLength).toBeLessThan(8 * 1024);
  }, 20_000);
});
