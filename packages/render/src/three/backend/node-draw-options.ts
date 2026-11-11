/**
 * GH-943 P3 (T14b, GH-1152): the node renderer's draw-submission switches, as plain data. Imports nothing, so `api.ts` can name the
 * type and the tools can parse `--node-opts=` without loading a renderer.
 *
 *  - `refreshPolicy` (F2, `refresh-policy.ts`): `'parked'` turns a `hasNode`-only FULL refresh into SHARED for a render object whose
 *    every per-object input is unchanged; `'three'` is three's own observer, untouched. Lead ruling D3: `'parked'` by default.
 *  - `matrixWalk` (F8, `matrix-walk.ts`): `'once'` walks the scene's world matrices once per frame, not again for the nested shadow
 *    render and the AO pre-pass; `'every-pass'` is three's own behaviour.
 *  - `uploads` (PR 1205, `attribute-uploads.ts` and `bone-texture.ts`): `'versioned'` installs both; `'three'` installs neither, so
 *    the main before 1205 is a switch, not a source revert (N2).
 *
 * The probe page's H7 ceiling (`'unsafe-shared'`) is a fourth refresh value it sets at RUN time only, never a boot option: it
 * downgrades with no key check, so it can draw a stale uniform, and is used for timing alone.
 */
export type RefreshPolicy = 'three' | 'parked';
export type MatrixWalk = 'every-pass' | 'once';
export type UploadsMode = 'three' | 'versioned';

export interface NodeDrawOptions {
  readonly refreshPolicy?: RefreshPolicy;
  readonly matrixWalk?: MatrixWalk;
  readonly uploads?: UploadsMode;
}
export type ResolvedNodeDraw = Required<NodeDrawOptions>;

export const NODE_DRAW_DEFAULTS: ResolvedNodeDraw = Object.freeze({ refreshPolicy: 'parked', matrixWalk: 'once', uploads: 'versioned' });

const VALUES: { readonly [K in keyof ResolvedNodeDraw]: readonly ResolvedNodeDraw[K][] } = {
  refreshPolicy: ['three', 'parked'],
  matrixWalk: ['every-pass', 'once'],
  uploads: ['three', 'versioned'],
};

/** The options with every absent field at its default. */
export function resolveNodeDraw(o: NodeDrawOptions | undefined): ResolvedNodeDraw {
  return { ...NODE_DRAW_DEFAULTS, ...(o ?? {}) };
}

/**
 * `k=v,k=v` (the ABBA runner's `--node-opts=`) to options. Throws on an unknown key or value, or a key given twice: a typo would
 * otherwise time the default arm under a non-default name.
 */
export function parseNodeDraw(s: string): NodeDrawOptions {
  const out: Record<string, string> = {};
  if (s.trim() === '') return out;
  for (const part of s.split(',')) {
    const [k, v, extra] = part.split('=').map((x) => x.trim());
    if (k === undefined || v === undefined || extra !== undefined || k === '' || v === '') throw new Error(`node-opts: "${part}" is not k=v`);
    if (!(k in VALUES)) throw new Error(`node-opts: unknown key "${k}" (expected ${Object.keys(VALUES).join(', ')})`);
    const allowed = VALUES[k as keyof ResolvedNodeDraw] as readonly string[];
    if (!allowed.includes(v)) throw new Error(`node-opts: ${k}=${v}: expected one of ${allowed.join(', ')}`);
    if (k in out) throw new Error(`node-opts: ${k} given twice`);
    out[k] = v;
  }
  return out as NodeDrawOptions;
}
