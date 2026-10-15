/**
 * The data digest a versus client folds into every hash it reports (ruling
 * L4, N2-P3): a digest of THIS client's own shipped content -- the unit,
 * structure and map JSON -- so two clients on different data are a desync on
 * the first hash tick, even while their sims still agree (an `hp` that has
 * not been shot at yet moves no sim hash). The room-minted
 * `MatchConfig.dataDigest` is not what is folded: the room has no content of
 * its own to vouch for, and the same number on both seats catches nothing.
 *
 * Canonical form: JSON with every object's keys sorted (UTF-16 code-unit
 * order, `Array.prototype.sort`'s default) and arrays in order, numbers
 * written as ECMAScript writes them -- the shortest round-trip text, the
 * serialisation RFC 8785 (JCS) builds on for exactly this cross-engine
 * reason. The text is hashed with `fnv1a32` over its UTF-8 bytes: integer
 * arithmetic only from there on. Insertion order never reaches the hash, so a
 * bundler or a JSON loader that orders keys differently cannot desync a match.
 *
 * Every engine must agree on this number: Node and Chromium, Firefox and
 * WebKit are compared on the real data by CI's `net:engines` job
 * (`tools/src/net/two-engine.ts`, reading `__lions.contentDigest()`).
 */
import { maps, structures, units } from '@lions/data';
import { fnv1a32 } from '@lions/net';

/** What the digest covers. Plain JSON values, keyed as `@lions/data` keys them. */
export interface Content {
  readonly units: Readonly<Record<string, unknown>>;
  readonly structures: Readonly<Record<string, unknown>>;
  readonly maps: Readonly<Record<string, unknown>>;
}

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

/** The digest of `content`: pure, and the same in every engine. */
export function contentDigest(content: Content): number {
  return fnv1a32(canonicalJson({ maps: content.maps, structures: content.structures, units: content.units }));
}

/** The content this build ships. */
export function shippedContent(): Content {
  return { units, structures, maps };
}

let shipped: number | null = null;

/** `contentDigest(shippedContent())`, computed once per process (the shipped
 *  content is fixed for the life of a build). */
export function shippedContentDigest(): number {
  shipped ??= contentDigest(shippedContent());
  return shipped;
}
