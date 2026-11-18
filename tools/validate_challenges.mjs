// GH-1395 slice 1: the cross-file rules for data/challenges/ that amendments.schema.json and challenge.schema.json
// cannot see. Its own module for the reason every validate_*.mjs is one: validate_data.mjs runs its whole sweep at
// import time and exits, so a test cannot import it.
//
//   - amendment ids are unique; every operation of every amendment, in the library and in a mission's `own`, points
//     the RESTRICTING way (rule A1, `restrictionFailure` below: a check per operation of the closed set, because the
//     schema's `ratio` allows 1..16 for both terms and would take a x1/16 purse or a x1/16 wave), and no amendment
//     moves the clock at all (the lead dropped Tight clock, PR 1524: `scale_time_limit` is a posture's alone);
//   - each per-mission file is named for its `mission`, which is a shipped CAMPAIGN mission (it produces a ledger
//     key: the tutorial pays nothing and has no challenge);
//   - its three offers are library ids or its own (D8's mission-specific amendment: the same restricting operations,
//     an id the library does not use, and offered), and the challenge's amendments are among them;
//   - challenge ids are unique across the pilot;
//   - every label and blurb is non-empty English text that never says "withdrawn" (PA-01); it is data text, as a
//     mission's name is, so the copy rides the lazily loaded challenge chunk and not the entry chunk's en.json;
//   - an offer that is the identity on its mission is refused: `clean_hands` needs a declared `roe.fail_below`,
//     `thin_purse` a declared purse, `no_eyes` a non-zero `intel_start`, `remove_starting` enough untagged bodies.
//
// What it cannot do without the TypeScript applier (applying the ops, the overlaid clock floor, building a runtime)
// is tools/src/challenges.test.ts (checks C1 to C5).

/**
 * Why an AMENDMENT operation would make a mission easier (or change how it grades), or null when it restricts. One
 * case per operation of overlay_ops.schema.json's closed set; an operation this does not know is refused, so a new
 * operation cannot reach an amendment until its direction is written here.
 *   the purse shrinks (num < den); waves grow (num > den) and come sooner (seconds < 0); the Conduct floor rises
 *   (by > 0); bodies are removed (count > 0); intel only goes down (min); an added enemy wave has bodies.
 *   `scale_time_limit` is refused in either direction: the lead dropped Tight clock (PR 1524), so the clock is a
 *   difficulty posture's lever and never an amendment's. `reinforce_player` adds player bodies, and `uncarry` takes
 *   the third star away, which an amended win must keep (D6).
 * @param {any} op
 * @returns {string | null}
 */
export function restrictionFailure(op) {
  switch (op?.op) {
    case 'scale_time_limit':
      return 'scale_time_limit moves the clock, which no amendment does (the lead dropped Tight clock, PR 1524)';
    case 'scale_resources':
      return op.num < op.den ? null : `${op.op} ${op.num}/${op.den} is not below 1`;
    case 'scale_waves':
      return op.num > op.den ? null : `scale_waves ${op.num}/${op.den} is not above 1`;
    case 'shift_waves':
      return op.seconds < 0 ? null : `shift_waves ${op.seconds} s does not bring the waves sooner`;
    case 'raise_fail_below':
      return op.by > 0 ? null : `raise_fail_below by ${op.by} does not raise the floor`;
    case 'remove_starting':
      return op.count > 0 ? null : `remove_starting ${op.count} removes nothing`;
    case 'set_intel_start':
      return Number.isInteger(op.value) && op.value >= 0 ? null : `set_intel_start ${op.value} is not a whole number`;
    case 'add_wave':
      return (op.wave?.units ?? []).some((u) => u.count > 0) ? null : 'add_wave brings no enemy';
    case 'reinforce_player':
      return 'reinforce_player adds player bodies';
    case 'uncarry':
      return 'uncarry changes how an amended win grades (D6)';
    default:
      return `"${op?.op}" is an operation with no written direction`;
  }
}

/**
 * @param {{ library: any, files: { file: string, doc: any }[], missions: Record<string, any> }} a
 * @returns {string[]} one line per failure
 */
export function challengeFailures({ library, files, missions }) {
  const out = [];
  const lib = new Map();
  /** Player-facing text: a non-empty label and blurb, and never the internal word for a timed-out defeat (PA-01,
   *  `player-wording.test.ts` holds en.json to the same rule; this text is data, so that test cannot see it). */
  const textFailures = (x, where) => {
    for (const k of ['label', 'blurb']) {
      if (typeof x[k] !== 'string' || x[k].trim() === '') out.push(`${where}: no ${k} text`);
      else if (/withdrawn/i.test(x[k])) out.push(`${where}: its ${k} says "withdrawn", an internal id no player-facing string uses (PA-01)`);
    }
  };
  /** One amendment's own rules, wherever it is declared. */
  const amendmentRules = (a, where) => {
    textFailures(a, `${where}: ${a.id}`);
    for (const op of a.ops ?? []) {
      const why = restrictionFailure(op);
      if (why !== null) out.push(`${where}: ${a.id}: ${why}, so it is not a restriction (rule A1: an amendment never makes a mission easier)`);
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
    textFailures(c, `${file}: challenge "${c.id}"`);
  }
  return out;
}

/** Why `op` would leave mission `m` exactly as it is, or null when it bites. */
function identityOn(m, op) {
  switch (op.op) {
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
