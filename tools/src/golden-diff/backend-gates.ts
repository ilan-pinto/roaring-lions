// GH-943 P0: two verdicts of the node-backend gate, pure so a test can drive each red.

/** Bit-identical captures: every run of one scenario on one arm must hash the same. */
export function bitIdenticalVerdict(hashes: readonly string[], required: number): { ok: boolean; message: string } {
  if (hashes.length < required) {
    return { ok: false, message: `only ${hashes.length} of the ${required} required captures completed: a capture that did not run cannot agree with the others` };
  }
  const distinct = [...new Set(hashes)];
  if (distinct.length === 1) return { ok: true, message: `${hashes.length} of ${hashes.length} captures are byte-identical (sha256 ${distinct[0]?.slice(0, 12)})` };
  const counts = distinct.map((h) => `${h.slice(0, 12)} x${hashes.filter((x) => x === h).length}`);
  return { ok: false, message: `${distinct.length} distinct pictures in ${hashes.length} captures (${counts.join(', ')}): a bimodal reading is a bug to find, not a band to widen` };
}

export interface UnportedRow {
  readonly kind: string;
  readonly key: string;
  readonly objects: number;
}

/**
 * The zero-unported gate (design section 4: `censusUnported` must read 0 on the node path). REPORT-ONLY in P0: it prints the whole
 * list and says it does not vote. `reportOnly: false` is the P5 setting, and then a non-empty list is a failure.
 */
export function unportedVerdict(rows: readonly UnportedRow[], reportOnly: boolean): { ok: boolean; lines: string[] } {
  const lines = [`unported GLSL hooks on the node path: ${rows.length}${reportOnly ? ' (REPORT-ONLY in P0: does not vote)' : ''}`];
  for (const r of rows) lines.push(`  ${r.kind} "${r.key}" x${r.objects}`);
  return { ok: rows.length === 0 || reportOnly, lines };
}
