/** An in-memory R2Like, for tests only (the R2 twin of test-d1.ts). `fail`
 *  makes the named operation throw, for the rollback paths. */
import type { R2Like, R2ObjectLike } from './d1';

export interface TestR2 extends R2Like {
  objects: Map<string, { bytes: Uint8Array; contentType?: string }>;
  fail: { put?: boolean; delete?: boolean };
}

export function openTestR2(): TestR2 {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  const fail: TestR2['fail'] = {};
  const toBytes = (v: ArrayBuffer | Uint8Array | string): Uint8Array =>
    typeof v === 'string' ? new TextEncoder().encode(v) : v instanceof Uint8Array ? new Uint8Array(v) : new Uint8Array(v);
  const obj = (o: { bytes: Uint8Array; contentType?: string }): R2ObjectLike => ({
    size: o.bytes.byteLength,
    httpMetadata: { contentType: o.contentType },
    arrayBuffer: async () => o.bytes.slice().buffer,
    text: async () => new TextDecoder().decode(o.bytes),
  });
  return {
    objects,
    fail,
    put: async (key, value, options) => {
      if (fail.put) throw new Error('r2 put failed');
      objects.set(key, { bytes: toBytes(value), contentType: options?.httpMetadata?.contentType });
      return {};
    },
    get: async (key) => {
      const o = objects.get(key);
      return o ? obj(o) : null;
    },
    head: async (key) => {
      const o = objects.get(key);
      return o ? { size: o.bytes.byteLength } : null;
    },
    delete: async (keys) => {
      if (fail.delete) throw new Error('r2 delete failed');
      for (const k of Array.isArray(keys) ? keys : [keys]) objects.delete(k);
    },
  };
}
