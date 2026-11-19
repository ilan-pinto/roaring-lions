/**
 * Key-sorted JSON text: the canonical form `content-digest.ts` hashes and `mission-save.ts`'s `digestOf` hashes. It lives on its own,
 * with no import, because the Save and Resume kit needs the form but must NOT reach `@lions/data/content` (every map and mission JSON):
 * the kit loads at every mission boot and on the board, and a JS module once evaluated stays in the realm for its life, so the whole
 * eager registry rode along into every "menu after a mission" heap (`content-wiring.test.ts` pins the kit's static graph).
 *
 * Canonical form: every object's keys sorted (UTF-16 code-unit order, `Array.prototype.sort`'s default), arrays in order, numbers
 * written as ECMAScript writes them -- the shortest round-trip text, the serialisation RFC 8785 (JCS) builds on.
 */

/** Key-sorted JSON text. Throws on anything JSON content cannot hold
 *  (a non-finite number, `undefined`, a function), rather than hash it one
 *  arbitrary way. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`canonicalJson: ${v} is not a JSON number`);
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  throw new Error(`canonicalJson: a ${typeof v} is not JSON content`);
}
