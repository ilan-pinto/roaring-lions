// GH-1389: the cross-file rules for data/computer/levels.json that computer_levels.schema.json cannot see, and the one
// derivation of what a level boosts (`levelBoosts`), which the ladder prints and this sweep refuses.
//
//   - the levels are easy, medium, hard, in that order (the order the ladder gates);
//   - every withheld unit is a KDF unit in data/units (the computer seat plays the mirror, KDF v KDF), named once a level;
//   - the levels are STRICTLY ordered by the force they field: the value left at home (count x cost.logistics) falls
//     from easy to medium to hard;
//   - no level boosts income or vision: `levelBoosts` finds no key, at any depth, in the income or the vision vocabulary.
//     The schema already refuses any field it does not name (`additionalProperties: false`); this is the second lock, so a
//     schema loosened later still cannot carry a hidden boost past `validate:data`.
//
// That each count is at most what the placed force (`VERSUS_KDF`, app code) fields needs app code, which this plain-node
// sweep cannot import: tools/src/computer_levels.test.ts checks it against the shipped constant.
//
// Its own module because validate_data.mjs runs its whole sweep at import time and exits.

export const LEVEL_ORDER = ['easy', 'medium', 'hard'];

/** Key vocabulary that would mean the computer gets more to spend than the player. */
export const INCOME_VOCABULARY = /income|purse|logistic|credit|resource|economy|budget|coin|money|subsid|bonus/i;
/** Key vocabulary that would mean the computer sees more than its own fog shows. */
export const VISION_VOCABULARY = /vision|sight|fog|reveal|shroud|intel|detect|spot|scout|hack|omnisc/i;

function keysOf(v, out = []) {
  if (Array.isArray(v)) for (const x of v) keysOf(x, out);
  else if (v !== null && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      keysOf(x, out);
    }
  }
  return out;
}

/**
 * What a level boosts, derived from its own data: `income` when any key at any depth is in the income vocabulary,
 * `vision` when any is in the vision vocabulary. A shipped level names only `id`, `label_key`, `blurb_key`, `withhold`,
 * `unit` and `count`, so both read false; a level that carried, say, `income_share` or `reveal_map` would read true.
 * @param {unknown} level
 * @returns {{ income: boolean, vision: boolean, keys: string[] }}
 */
export function levelBoosts(level) {
  const keys = keysOf(level);
  return { income: keys.some((k) => INCOME_VOCABULARY.test(k)), vision: keys.some((k) => VISION_VOCABULARY.test(k)), keys };
}

/**
 * The value a level leaves at home: sum of count x cost.logistics over its `withhold`. NaN when a unit has no cost.
 * @param {{ withhold?: { unit: string, count: number }[] }} level
 * @param {Map<string, { cost?: { logistics?: number } }>} unitsById
 */
export function withheldValue(level, unitsById) {
  let v = 0;
  for (const { unit, count } of level?.withhold ?? []) v += count * (unitsById.get(unit)?.cost?.logistics ?? NaN);
  return v;
}

/**
 * @param {{ file: string, doc: any }} levels the parsed data/computer/levels.json
 * @param {Map<string, { faction?: string, cost?: { logistics?: number } }>} unitsById every unit in data/units
 * @returns {string[]} one line per failure
 */
export function computerLevelFailures({ file, doc }, unitsById) {
  const out = [];
  const list = Array.isArray(doc?.levels) ? doc.levels : null;
  if (list === null) return [`${file}: no "levels" array`];
  const ids = list.map((l) => l?.id);
  if (ids.join(',') !== LEVEL_ORDER.join(',')) out.push(`${file}: levels are [${ids.join(', ')}], not [${LEVEL_ORDER.join(', ')}] in that order`);
  for (const level of list) {
    const id = level?.id ?? '?';
    const b = levelBoosts(level);
    if (b.income) out.push(`${file}: level "${id}" carries an income field (${b.keys.filter((k) => INCOME_VOCABULARY.test(k)).join(', ')}) -- a level is a stated force handicap, never an income boost`);
    if (b.vision) out.push(`${file}: level "${id}" carries a vision field (${b.keys.filter((k) => VISION_VOCABULARY.test(k)).join(', ')}) -- the computer reads its own fog at every level`);
    const seen = new Set();
    for (const w of Array.isArray(level?.withhold) ? level.withhold : []) {
      if (seen.has(w.unit)) out.push(`${file}: level "${id}" names "${w.unit}" twice -- one row a unit`);
      seen.add(w.unit);
      const u = unitsById.get(w.unit);
      if (!u) out.push(`${file}: level "${id}" withholds "${w.unit}", which is not a unit id in data/units`);
      else if (u.faction !== 'kdf') out.push(`${file}: level "${id}" withholds "${w.unit}" (faction ${u.faction}) -- the computer fields the KDF mirror force`);
      else if (!Number.isInteger(u.cost?.logistics)) out.push(`${file}: level "${id}" withholds "${w.unit}", which has no cost.logistics to order the levels by`);
    }
  }
  for (let i = 1; i < list.length; i++) {
    const lo = withheldValue(list[i - 1], unitsById);
    const hi = withheldValue(list[i], unitsById);
    if (!(hi < lo)) out.push(`${file}: level "${list[i]?.id}" leaves ${hi} of value at home, not less than "${list[i - 1]?.id}"'s ${lo} -- the levels must be strictly ordered by the force they field`);
  }
  return out;
}
