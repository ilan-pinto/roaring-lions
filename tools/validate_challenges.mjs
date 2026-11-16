// GH-1395 slice 1: the cross-file rules for data/challenges/ that amendments.schema.json and challenge.schema.json
// cannot see. Its own module for the reason every validate_*.mjs is one: validate_data.mjs runs its whole sweep at
// import time and exits, so a test cannot import it.
//
//   - amendment ids are unique; every amendment is a RESTRICTION (rule A1): a `scale_*` ratio is below 1, and no
//     amendment uses an operation that can only add (`reinforce_player`, `add_wave` are the posture's and the
//     per-mission `own` list's, never the generic library's; `uncarry` takes the third star away, which a challenge
//     must not do because an amended win grades normally, D6);
//   - each per-mission file is named for its `mission`, which is a shipped CAMPAIGN mission (it produces a ledger
//     key: the tutorial pays nothing and has no challenge);
//   - its three offers are library ids or its own (D8's mission-specific amendment: the same restricting operations,
//     an id the library does not use, and offered), and the challenge's amendments are among them;
//   - challenge ids are unique across the pilot;
//   - every label and blurb key is in en.json;
//   - an offer that is the identity on its mission is refused: `clean_hands` needs a declared `roe.fail_below`,
//     `thin_purse` a declared purse, `no_eyes` a non-zero `intel_start`, `remove_starting` enough untagged bodies.
//
// What it cannot do without the TypeScript applier (applying the ops, the overlaid clock floor, building a runtime)
// is tools/src/challenges.test.ts (checks C1 to C5).

/** Operations the generic library may use: each moves one field the restricting way. */
const LIBRARY_OPS = new Set(['scale_time_limit', 'raise_fail_below', 'remove_starting', 'scale_resources', 'set_intel_start']);

/**
 * @param {{ library: any, files: { file: string, doc: any }[], missions: Record<string, any>, en: Record<string, string> }} a
 * @returns {string[]} one line per failure
 */
export function challengeFailures({ library, files, missions, en }) {
  const out = [];
  const lib = new Map();
  /** One amendment's own rules, wherever it is declared. */
  const amendmentRules = (a, where) => {
    for (const k of [a.label_key, a.blurb_key]) if (typeof en[k] !== 'string') out.push(`${where}: ${a.id}: "${k}" is not an en.json key`);
    for (const op of a.ops ?? []) {
      if (!LIBRARY_OPS.has(op.op)) out.push(`${where}: ${a.id}: "${op.op}" is not a restricting operation (rule A1)`);
      if ((op.op === 'scale_time_limit' || op.op === 'scale_resources') && !(op.num < op.den)) {
        out.push(`${where}: ${a.id}: ${op.op} ${op.num}/${op.den} is not below 1 (rule A1: an amendment never makes a mission easier)`);
      }
    }
  };
  for (const a of library?.amendments ?? []) {
    if (lib.has(a.id)) out.push(`data/challenges/amendments.json: amendment "${a.id}" is declared twice`);
    lib.set(a.id, a);
    amendmentRules(a, 'data/challenges/amendments.json');
  }
  const challengeIds = new Map();
  for (const { file, doc } of files) {
    const base = file.split('/').pop()?.replace(/\.json$/, '');
    if (doc.mission !== base) out.push(`${file}: names mission "${doc.mission}" but the file is ${base}.json`);
    const m = missions[doc.mission];
    if (m === undefined) {
      out.push(`${file}: no shipped mission "${doc.mission}"`);
      continue;
    }
    if (!(m.ledger?.produces?.length > 0)) out.push(`${file}: ${doc.mission} produces no ledger key (the tutorial pays nothing and offers no challenge)`);
    const own = new Map();
    for (const a of doc.own ?? []) {
      if (lib.has(a.id)) out.push(`${file}: own amendment "${a.id}" shadows the library's`);
      own.set(a.id, a);
      amendmentRules(a, file);
      if (!(doc.offers ?? []).includes(a.id)) out.push(`${file}: own amendment "${a.id}" is not offered`);
    }
    for (const id of doc.offers ?? []) {
      const a = lib.get(id) ?? own.get(id);
      if (a === undefined) {
        out.push(`${file}: offers "${id}", which is neither in data/challenges/amendments.json nor the mission's own`);
        continue;
      }
      for (const op of a.ops) {
        const why = identityOn(m, op);
        if (why !== null) out.push(`${file}: offers "${id}", which changes nothing on ${doc.mission}: ${why}`);
      }
    }
    const c = doc.challenge ?? {};
    for (const id of c.amendments ?? []) {
      if (!(doc.offers ?? []).includes(id)) out.push(`${file}: challenge "${c.id}" needs "${id}", which the mission does not offer`);
    }
    if (challengeIds.has(c.id)) out.push(`${file}: challenge id "${c.id}" is also ${challengeIds.get(c.id)}'s`);
    challengeIds.set(c.id, file);
    for (const k of [c.label_key, c.blurb_key]) if (typeof en[k] !== 'string') out.push(`${file}: "${k}" is not an en.json key`);
  }
  return out;
}

/** Why `op` would leave mission `m` exactly as it is, or null when it bites. */
function identityOn(m, op) {
  switch (op.op) {
    case 'scale_time_limit':
      return typeof m.time_limit_s === 'number' ? null : 'it declares no time_limit_s';
    case 'raise_fail_below':
      return typeof m.roe?.fail_below === 'number' && m.roe.fail_below < 80 ? null : 'it declares no roe.fail_below below 80';
    case 'scale_resources': {
      const r = m.resources ?? {};
      return (r.logistics_start ?? 0) > 0 || (r.logistics_rate_per_min ?? 0) > 0 ? null : 'it has no logistics purse';
    }
    case 'set_intel_start':
      return (m.resources?.intel_start ?? 0) > op.value ? null : `its intel_start is not above ${op.value}`;
    case 'remove_starting': {
      const have = (m.starting_force ?? []).filter((p) => p.unit === op.unit && p.tag === undefined).reduce((n, p) => n + p.count, 0);
      return have >= op.count ? null : `it starts with ${have} untagged ${op.unit}, fewer than ${op.count}`;
    }
    default:
      return null;
  }
}
