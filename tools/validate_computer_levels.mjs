// GH-1389: the cross-file rules for data/computer/levels.json that computer_levels.schema.json cannot see, and the one
// derivation of what a level boosts (`levelBoosts`), which the ladder prints and this sweep refuses.
//
//   - the levels are easy, medium, hard, in that order (the order the ladder gates);
//   - a level states a withhold for EVERY faction the computer can play (`kdf`, `sarim`: lead ruling, 19 Nov 2026), and
//     each withheld unit is a placement of THAT faction's placed force (`VERSUS_KDF` / `VERSUS_SARIM`), withheld at most as
//     many times as the force fields it, named once a row. Membership in the placed force, never the unit's `faction` id:
//     the Sarim force fields `gun_truck`, whose faction is `rif`;
//   - per faction, each level withholds at least everything the level above it does (easy ⊇ medium ⊇ hard);
//   - per faction, the levels are STRICTLY ordered by the force they field: the value left at home
//     (count x cost.logistics) falls from easy to medium to hard;
//   - no level boosts income or vision: `levelBoosts` finds no key, at any depth, in the income or the vision vocabulary.
//     The schema already refuses any field it does not name (`additionalProperties: false`); this is the second lock, so a
//     schema loosened later still cannot carry a hidden boost past `validate:data`.
//
// The placed forces are app code, which this plain-node sweep cannot import, so `placedForcesFromSource` reads the two
// array literals out of their source files (and refuses, loudly, any shape it does not understand);
// tools/src/computer_levels.test.ts pins that reading against the shipped constants.
//
// Its own module because validate_data.mjs runs its whole sweep at import time and exits.

export const LEVEL_ORDER = ['easy', 'medium', 'hard'];
/** The factions the computer seat can play, each with its own withhold row. */
export const LEVEL_FACTIONS = ['kdf', 'sarim'];
/** The app constant each faction's placed force is, for the failure lines. */
export const PLACED_FORCE_NAME = { kdf: 'VERSUS_KDF', sarim: 'VERSUS_SARIM' };
/** The source files that hold the placed forces' array literals (repo-relative). */
export const PLACED_FORCE_SOURCES = ['packages/app/src/sandbox-force.ts', 'packages/app/src/net/versus-force.ts'];

/**
 * Each faction's placed force as one unit id per placement, read from the SOURCE of `VERSUS_KDF` and `VERSUS_SARIM`: an
 * `export const NAME: readonly SandboxPlacement[] = [...]` literal whose elements are `['unit', dx, dy]` tuples or
 * `...OTHER` spreads of another such literal. Anything else in a literal, a missing literal or an unresolved spread
 * throws: a reading that came back empty would pass every membership check vacuously.
 * @param {string[]} sources the text of each file in `PLACED_FORCE_SOURCES`
 * @returns {{ kdf: string[], sarim: string[] }}
 */
export function placedForcesFromSource(sources) {
  const literals = new Map();
  for (const text of sources) {
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const m of code.matchAll(/export const (\w+): readonly SandboxPlacement\[\] = \[([\s\S]*?)\];/g)) literals.set(m[1], m[2]);
  }
  const resolve = (name, depth = 0) => {
    const body = literals.get(name);
    if (body === undefined) throw new Error(`placed force: no \`export const ${name}: readonly SandboxPlacement[] = [...]\` in ${PLACED_FORCE_SOURCES.join(' or ')}`);
    if (depth > 8) throw new Error(`placed force: ${name} spreads too deep`);
    const out = [];
    const token = /\s*(?:\[\s*'([a-z0-9_]+)'\s*,\s*-?\d+\s*,\s*-?\d+\s*\]|\.\.\.(\w+))\s*(?:,|$)/y;
    let at = 0;
    while (at < body.length && body.slice(at).trim() !== '') {
      token.lastIndex = at;
      const t = token.exec(body);
      if (t === null) throw new Error(`placed force: ${name} holds something that is not a ['unit', dx, dy] tuple or a ...spread: "${body.slice(at).trim().slice(0, 40)}"`);
      if (t[1] !== undefined) out.push(t[1]);
      else out.push(...resolve(t[2], depth + 1));
      at = token.lastIndex;
    }
    if (out.length === 0) throw new Error(`placed force: ${name} is empty`);
    return out;
  };
  return { kdf: resolve(PLACED_FORCE_NAME.kdf), sarim: resolve(PLACED_FORCE_NAME.sarim) };
}

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
 * The value a level leaves at home for one faction: sum of count x cost.logistics over its `withhold[faction]`. NaN when
 * a unit has no cost.
 * @param {{ withhold?: Record<string, { unit: string, count: number }[]> }} level
 * @param {Map<string, { cost?: { logistics?: number } }>} unitsById
 * @param {string} faction
 */
export function withheldValue(level, unitsById, faction) {
  let v = 0;
  const rows = level?.withhold?.[faction];
  for (const { unit, count } of Array.isArray(rows) ? rows : []) v += count * (unitsById.get(unit)?.cost?.logistics ?? NaN);
  return v;
}

/**
 * @param {{ file: string, doc: any }} levels the parsed data/computer/levels.json
 * @param {Map<string, { faction?: string, cost?: { logistics?: number } }>} unitsById every unit in data/units
 * @param {{ kdf: string[], sarim: string[] }} placed each faction's placed force, one unit id a placement (`placedForcesFromSource`)
 * @returns {string[]} one line per failure
 */
export function computerLevelFailures({ file, doc }, unitsById, placed) {
  const out = [];
  const list = Array.isArray(doc?.levels) ? doc.levels : null;
  if (list === null) return [`${file}: no "levels" array`];
  const ids = list.map((l) => l?.id);
  if (ids.join(',') !== LEVEL_ORDER.join(',')) out.push(`${file}: levels are [${ids.join(', ')}], not [${LEVEL_ORDER.join(', ')}] in that order`);
  const fielded = {};
  for (const f of LEVEL_FACTIONS) {
    const force = placed?.[f];
    if (!Array.isArray(force) || force.length === 0) {
      out.push(`${file}: no placed force (${PLACED_FORCE_NAME[f]}) was given for "${f}" -- nothing to check its withholds against`);
      continue;
    }
    fielded[f] = new Map();
    for (const u of force) fielded[f].set(u, (fielded[f].get(u) ?? 0) + 1);
  }
  const rowsOf = (level, f) => (Array.isArray(level?.withhold?.[f]) ? level.withhold[f] : []);
  for (const level of list) {
    const id = level?.id ?? '?';
    const b = levelBoosts(level);
    if (b.income) out.push(`${file}: level "${id}" carries an income field (${b.keys.filter((k) => INCOME_VOCABULARY.test(k)).join(', ')}) -- a level is a stated force handicap, never an income boost`);
    if (b.vision) out.push(`${file}: level "${id}" carries a vision field (${b.keys.filter((k) => VISION_VOCABULARY.test(k)).join(', ')}) -- the computer reads its own fog at every level`);
    for (const f of LEVEL_FACTIONS) {
      if (!Array.isArray(level?.withhold?.[f])) {
        out.push(`${file}: level "${id}" states no "${f}" withhold -- a level says what it does whichever faction the computer plays`);
        continue;
      }
      const seen = new Set();
      for (const w of rowsOf(level, f)) {
        if (seen.has(w.unit)) out.push(`${file}: level "${id}" names "${w.unit}" twice in its ${f} withhold -- one row a unit`);
        seen.add(w.unit);
        const u = unitsById.get(w.unit);
        const n = fielded[f]?.get(w.unit) ?? 0;
        if (!u) out.push(`${file}: level "${id}" withholds "${w.unit}" (${f}), which is not a unit id in data/units`);
        else if (fielded[f] !== undefined && n === 0) out.push(`${file}: level "${id}" withholds "${w.unit}" for ${f}, which ${PLACED_FORCE_NAME[f]} does not field -- a withheld unit is one of that faction's placements`);
        else if (fielded[f] !== undefined && w.count > n) out.push(`${file}: level "${id}" withholds ${w.count} "${w.unit}" for ${f}, but ${PLACED_FORCE_NAME[f]} fields only ${n}`);
        else if (!Number.isInteger(u.cost?.logistics)) out.push(`${file}: level "${id}" withholds "${w.unit}", which has no cost.logistics to order the levels by`);
      }
    }
  }
  for (const f of LEVEL_FACTIONS) {
    for (let i = 1; i < list.length; i++) {
      const above = new Map(rowsOf(list[i - 1], f).map((w) => [w.unit, w.count]));
      for (const w of rowsOf(list[i], f)) {
        if ((above.get(w.unit) ?? 0) < w.count) out.push(`${file}: level "${list[i]?.id}" withholds ${w.count} "${w.unit}" for ${f}, more than "${list[i - 1]?.id}"'s ${above.get(w.unit) ?? 0} -- each level withholds at least everything the level above it does`);
      }
      const lo = withheldValue(list[i - 1], unitsById, f);
      const hi = withheldValue(list[i], unitsById, f);
      if (!(hi < lo)) out.push(`${file}: level "${list[i]?.id}" leaves ${hi} of ${f} value at home, not less than "${list[i - 1]?.id}"'s ${lo} -- the levels must be strictly ordered by the force they field`);
    }
  }
  return out;
}
