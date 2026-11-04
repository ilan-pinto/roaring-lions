// The checks on data/arena/results.json that plain node can run (GH-954 public-arena P2). Its own module because
// validate_data.mjs runs its whole sweep at import time, and because the publisher (tools/src/net/arena-publish.ts)
// and the test import the SAME canonical form, digest and deny scan: a second copy could drift from the first.
import { createHash } from 'node:crypto';

/** JSON with every object's keys sorted, no whitespace: the form the digest is taken over. */
export function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (typeof v === 'object' && v !== null) {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** sha256 (hex) of the canonical body: the document without its own `digest`. */
export function digestOf(doc) {
  const body = { ...doc };
  delete body.digest;
  return createHash('sha256').update(canonicalJson(body)).digest('hex');
}

/** Strings that must never appear anywhere in the published text: a command template, a home path, a key, an address, a link. */
export const DENY = [
  ['cmd:', /cmd:/],
  ['/Users/', /\/Users\//],
  ['~/', /~\//],
  ['a backslash', /\\/],
  ['sk-', /sk-/],
  ['@', /@/],
  ['http', /http/i],
  ['ANTHROPIC', /ANTHROPIC/],
];

/** The deny list's hits in a piece of text, by name. Run over the serialised document, so a key, a value or an array item all count. */
export function denyHits(text) {
  return DENY.filter(([, re]) => re.test(text)).map(([name]) => name);
}

/** Failures for a parsed results document: a changed body (the digest), and the deny scan over the text as it will be committed. */
export function arenaResultsFailures(doc, file = 'data/arena/results.json') {
  const out = [];
  if (typeof doc !== 'object' || doc === null) return [`${file}: not an object`];
  const want = digestOf(doc);
  if (doc.digest !== want) out.push(`${file}: digest ${String(doc.digest).slice(0, 12)}... is not the sha256 of the body (${want.slice(0, 12)}...); the file was edited by hand`);
  for (const hit of denyHits(JSON.stringify(doc))) out.push(`${file}: contains ${hit}`);
  return out;
}
