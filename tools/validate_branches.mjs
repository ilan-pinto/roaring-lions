// GH-1384 slice 1: the cross-field rules for a BRANCHED upgrade tier that unit.schema.json cannot
// see (design docs/superpowers/specs/2026-11-17-branched-upgrade-tiers-design.md §1.1). Its own
// module for the reason every validate_*.mjs is one: validate_data.mjs runs its whole sweep at
// import time and exits, so a test cannot import it. tools/src/branches.test.ts drives it.
//
// A tier is `{ price, patch }` or `{ price, branches: [a, b] }`. The rules apply to EACH branched
// track of a unit on its own (the lead, Q3), and every error names the unit AND the track. The
// walk is a `filter` over every branched track, never a `find` that stops at the first.
//
//   B1  only a track's LAST tier may be branched;
//   B2  the two branch ids differ, and both `label` keys exist in en.json;
//   B3  both branches patch exactly the set of paths the tier below patches;
//   B4  the FLOOR: per path, the smaller branch value equals the tier below's, the larger is at least it;
//   B5  no dominance: each branch is strictly above the tier below on some path, and strictly below
//       the other branch on some path;
//   B6  the per-path maximum over the two branches (the envelope) is the budget;
//   B7  the CEILING: per path, the envelope is at most `BRANCH_CEILING[unit][track][path]`, a table
//       written BY HAND from the shipped tier-3 deltas before branching (the lead, R13), never read
//       from the unit JSON it guards. A branched track with no row is refused, and so is a row for a
//       track that is not branched (a dead row would hide a later edit);
//   C1  the content cap: a unit branches at most `BRANCHED_TRACKS_MAX` tracks (1 for slice 1).
//
// `tierPatches` is the one reader of a tier's patch(es) in plain node: the one patch of a plain
// tier, or both branch patches of a branched one; it THROWS on a tier with neither or both, so a
// caller can never read a branched tier as `{}` (the casebook's "empty input, every caller passes").

/** C1: the most branched tracks a shipped unit may carry. Raising it is a content slice (Q3). */
export const BRANCHED_TRACKS_MAX = 1;

/**
 * B7, R13: the hand-written ceiling per (unit, track, path), copied BY HAND from each unit's
 * shipped tier-3 patch as it stood before branching (`origin/dev` e1845a77e, the "T3 today" column of
 * the design's §2.1). Raising a number here is a reviewed edit that still has to pass both balance
 * gates. Never derive it from the unit JSON: an oracle takes literals.
 */
export const BRANCH_CEILING = {
  mbt_lavi: { firepower: { 'weapons[0].accuracy': 0.1, 'weapons[0].penetration': 325 } },
  ifv_namer: { firepower: { 'weapons[0].accuracy': 0.1, 'weapons[0].penetration': 30 } },
  apc_eitan: { firepower: { 'weapons[0].accuracy': 0.1, 'weapons[0].penetration': 6 } },
  sniper_team: { firepower: { 'weapons[0].accuracy': 0.1, 'weapons[0].penetration': 11 } },
  heli_peten: { firepower: { 'weapons[0].accuracy': 0.1, 'weapons[0].penetration': 30 } },
  inf_squad: { firepower: { 'weapons[0].accuracy': 0.1, 'weapons[0].penetration': 2 } },
  jeep_shoded: { armour: { 'hull.hp': 130, 'hull.armor.front': 4, 'hull.armor.side': 2, 'hull.armor.rear': 2 } },
  dozer_d9: { armour: { 'hull.hp': 600, 'hull.armor.front': 60, 'hull.armor.side': 42, 'hull.armor.rear': 28 } },
  apc_kipod: { armour: { 'hull.hp': 438, 'hull.armor.front': 65, 'hull.armor.side': 40, 'hull.armor.rear': 25 } },
  at_team: { sensors: { 'sensors.optics': 0.28, 'sensors.sight_tiles': 3 } },
  scout_shachaf: { sensors: { 'sensors.optics': 0.47, 'sensors.sight_tiles': 3 } },
  mortar_team: { sensors: { 'sensors.optics': 0.23, 'sensors.sight_tiles': 3 } },
  recon_drone: { sensors: { 'sensors.optics': 0.5, 'sensors.sight_tiles': 3 } },
};

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Whether a tier is branched (carries `branches`). */
export function isBranched(tier) {
  return isObj(tier) && 'branches' in tier;
}

/**
 * The patch(es) a tier carries: `[patch]` for a plain tier, `[a.patch, b.patch]` for a branched
 * one. Throws on a tier with neither `patch` nor `branches`, or with both, or on a branch with no
 * patch: a shape this reader does not know is an error, never `{}`.
 */
export function tierPatches(tier) {
  if (!isObj(tier)) throw new Error('tier is not an object');
  const hasPatch = 'patch' in tier;
  const hasBranches = 'branches' in tier;
  if (hasPatch && hasBranches) throw new Error('tier has both "patch" and "branches"');
  if (hasPatch) {
    if (!isObj(tier.patch)) throw new Error('tier "patch" is not an object');
    return [tier.patch];
  }
  if (hasBranches) {
    if (!Array.isArray(tier.branches)) throw new Error('tier "branches" is not an array');
    return tier.branches.map((b, i) => {
      if (!isObj(b) || !isObj(b.patch)) throw new Error(`branch ${i + 1} has no "patch"`);
      return b.patch;
    });
  }
  throw new Error('tier has neither "patch" nor "branches"');
}

/** The tracks of a unit whose tiers include a branched one, sorted. */
function tracksWithBranches(doc) {
  return Object.entries(doc.upgrades ?? {})
    .filter(([, track]) => Array.isArray(track?.tiers) && track.tiers.some(isBranched))
    .map(([name]) => name)
    .sort();
}

/** One branched track's failures (B1 to B7), each naming the unit and the track. */
function trackFailures(where, unitId, trackName, track, en, ceiling) {
  const out = [];
  const at = `${where}: upgrades.${trackName}`;
  const tiers = track.tiers;
  tiers.forEach((tier, i) => {
    if (isBranched(tier) && i !== tiers.length - 1) out.push(`${at} tier ${i + 1} is branched, but only a track's last tier may be (B1)`);
  });
  const last = tiers[tiers.length - 1];
  if (!isBranched(last)) return out; // a non-last branched tier: B1 said so; nothing else to measure
  const n = tiers.length;
  const branches = Array.isArray(last.branches) ? last.branches : [];
  if (branches.length !== 2) {
    out.push(`${at} tier ${n} has ${branches.length} branches; a branched tier has exactly two`);
    return out;
  }
  const [a, b] = branches;
  // B2
  if (a.id === b.id) out.push(`${at} tier ${n}: both branches have id "${a.id}" (B2)`);
  for (const br of branches) {
    if (typeof br.label !== 'string' || !Object.hasOwn(en, br.label)) {
      out.push(`${at} tier ${n} branch "${br.id}": label key "${br.label}" is not in en.json (B2)`);
    }
  }
  if (n < 2 || isBranched(tiers[n - 2])) {
    out.push(`${at} tier ${n} is branched but has no plain tier below it to split from (B3)`);
    return out;
  }
  const below = tiers[n - 2].patch ?? {};
  const pa = a.patch ?? {};
  const pb = b.patch ?? {};
  // B3
  const want = Object.keys(below).sort().join(',');
  for (const br of branches) {
    const got = Object.keys(br.patch ?? {}).sort().join(',');
    if (got !== want) out.push(`${at} tier ${n} branch "${br.id}" patches [${got}], not the tier below's [${want}] (B3)`);
  }
  if (out.length > 0) return out;
  // B4, B5, B6, B7
  const ceil = ceiling?.[unitId]?.[trackName];
  if (ceil === undefined) out.push(`${at} is branched but has no BRANCH_CEILING row (B7)`);
  let aUp = false;
  let bUp = false;
  let aBelowB = false;
  let bBelowA = false;
  for (const path of Object.keys(below)) {
    const lo = Math.min(pa[path], pb[path]);
    const hi = Math.max(pa[path], pb[path]);
    if (lo !== below[path]) {
      out.push(`${at} tier ${n} ${path}: the smaller branch value ${lo} is not the tier below's ${below[path]} (B4)`);
    }
    if (hi < below[path]) out.push(`${at} tier ${n} ${path}: ${hi} is below the tier below's ${below[path]} (B4)`);
    if (pa[path] > below[path]) aUp = true;
    if (pb[path] > below[path]) bUp = true;
    if (pa[path] < pb[path]) aBelowB = true;
    if (pb[path] < pa[path]) bBelowA = true;
    if (ceil !== undefined) {
      const c = ceil[path];
      if (typeof c !== 'number') out.push(`${at} tier ${n} ${path}: no BRANCH_CEILING value for this path (B7)`);
      else if (hi > c) out.push(`${at} tier ${n} ${path}: the envelope ${hi} is above the BRANCH_CEILING ${c} (B7)`);
    }
  }
  if (!aUp || !aBelowB) out.push(`${at} tier ${n} branch "${a.id}" dominates or is dominated: it must raise one path and give one up (B5)`);
  if (!bUp || !bBelowA) out.push(`${at} tier ${n} branch "${b.id}" dominates or is dominated: it must raise one path and give one up (B5)`);
  return out;
}

/**
 * @param {{ file: string, doc: any }[]} units every parsed unit file
 * @param {{ en: Record<string, string>, tracksMax?: number, ceiling?: Record<string, Record<string, Record<string, number>>> }} opts
 * @returns {string[]} one line per failure
 */
export function validateBranches(units, { en, tracksMax = BRANCHED_TRACKS_MAX, ceiling = BRANCH_CEILING }) {
  const out = [];
  const branched = new Set();
  for (const { file, doc } of units) {
    if (!isObj(doc) || !isObj(doc.upgrades)) continue;
    const tracks = tracksWithBranches(doc);
    for (const name of tracks) {
      branched.add(`${doc.id}\u0000${name}`);
      out.push(...trackFailures(`${file} (${doc.id})`, doc.id, name, doc.upgrades[name], en, ceiling));
    }
    if (tracks.length > tracksMax) {
      out.push(`${file} (${doc.id}): branches ${tracks.length} tracks (${tracks.join(', ')}); BRANCHED_TRACKS_MAX is ${tracksMax} (C1)`);
    }
  }
  for (const [unit, rows] of Object.entries(ceiling ?? {})) {
    for (const track of Object.keys(rows)) {
      if (!branched.has(`${unit}\u0000${track}`)) out.push(`BRANCH_CEILING has a row for ${unit}.${track}, which is not a branched track (B7)`);
    }
  }
  return out;
}
