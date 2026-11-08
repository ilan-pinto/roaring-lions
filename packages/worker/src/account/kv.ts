/** The slice of Workers KV the accounts code uses (tombstones, GH-1075), declared here for the same reason
 *  as `D1Like`: @lions/workers-types collides with the DOM lib. */
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, o?: { expirationTtl?: number }): Promise<void>;
  list(o: { prefix: string; cursor?: string }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
}

/** An in-memory KV for tests. `failPut` makes every put reject, to prove a tombstone failure aborts a delete.
 *  `ttl(key)` reads back the `expirationTtl` the put carried. */
export function memoryKV(opts: { failPut?: boolean } = {}): KVLike & { ttl(key: string): number | undefined } {
  const store = new Map<string, { value: string; ttl: number | undefined }>();
  return {
    get: async (key) => store.get(key)?.value ?? null,
    put: async (key, value, o) => {
      if (opts.failPut === true) throw new Error('kv put failed');
      store.set(key, { value, ttl: o?.expirationTtl });
    },
    list: async ({ prefix }) => ({
      keys: [...store.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })),
      list_complete: true,
    }),
    ttl: (key) => store.get(key)?.ttl,
  };
}
