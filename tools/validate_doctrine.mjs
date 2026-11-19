// N3 prep (network lane; lead rulings LD2 and LD3, 16 Oct): the cross-file rules for
// data/doctrines/*.json that doctrine.schema.json cannot see.
//
//   - every menu id is a unit in data/units;
//   - a KDF doctrine's menu is KDF units only, and a Sarim doctrine's is opposition units only
//     (sarim, rif or ashwar -- the same set versus-force.test.ts holds VERSUS_SARIM to);
//   - no menu holds `loiter_drone` (LD3: population 0, which the cap never refuses, plus a
//     kamikaze, is a spam risk with no balance behind it);
//   - a doctrine's id is its faction (N3 looks doctrines up by faction, never by file order);
//   - exactly one KDF and one Sarim doctrine, and the Sarim start purse is 1.6x the KDF's
//     (G3 Q7, network design §2.3), compared by integer cross-multiplication (8/5).
//
// That the Sarim menu is VERSUS_SARIM's types plus `recoilless_team` (LD3) needs app code, which
// this plain-node sweep cannot import; tools/src/validate_doctrine.test.ts checks it against the
// shipped constant.
//
// Its own module because validate_data.mjs runs its whole sweep at import time and exits.

/** Unit factions a Sarim doctrine may build. */
export const OPPOSITION_FACTIONS = ['sarim', 'rif', 'ashwar'];

/** LD3: never on any menu. */
export const BANNED_MENU_UNITS = ['loiter_drone'];

/** G3 Q7: Sarim's budget over the KDF's, as [numerator, denominator] (1.6 = 8/5). */
export const SARIM_BUDGET_RATIO = [8, 5];

/**
 * @param {{ file: string, doc: any }[]} doctrines every parsed doctrine file
 * @param {Map<string, { faction?: string }>} unitsById every unit in data/units
 * @returns {string[]} one line per failure
 */
export function doctrineFailures(doctrines, unitsById) {
  const out = [];
  const byFaction = new Map();
  for (const { file, doc } of doctrines) {
    if (!doc || typeof doc !== 'object') continue; // the schema check reports it
    const faction = doc.faction;
    // N3 looks a doctrine up by FACTION (KDF is side 0, LD1), never by file order, so the id
    // must name the faction it serves: one doctrine per faction, id === faction.
    if (typeof doc.id === 'string' && doc.id !== faction) {
      out.push(`${file}: id "${doc.id}" is not its faction "${faction}" -- a doctrine's id is its faction`);
    }
    if (faction === 'kdf' || faction === 'sarim') {
      if (byFaction.has(faction)) {
        out.push(
          `${file}: a second "${faction}" doctrine (after ${byFaction.get(faction).file}) -- ` +
            `the 1.6x budget ratio (G3 Q7) binds one KDF and one Sarim doctrine`
        );
      } else byFaction.set(faction, { file, doc });
    }
    for (const id of Array.isArray(doc.menu) ? doc.menu : []) {
      if (BANNED_MENU_UNITS.includes(id)) {
        out.push(`${file}: menu holds "${id}", which no doctrine may build (LD3, 16 Oct)`);
      }
      const unit = unitsById.get(id);
      if (!unit) {
        out.push(`${file}: menu names "${id}", which is not a unit id in data/units`);
        continue;
      }
      if (faction === 'kdf' && unit.faction !== 'kdf') {
        out.push(`${file}: menu names "${id}" (faction ${unit.faction}) on a KDF doctrine -- KDF units only`);
      }
      if (faction === 'sarim' && !OPPOSITION_FACTIONS.includes(unit.faction)) {
        out.push(
          `${file}: menu names "${id}" (faction ${unit.faction}) on a Sarim doctrine -- ` +
            `opposition units only (${OPPOSITION_FACTIONS.join(', ')})`
        );
      }
    }
  }
  const kdf = byFaction.get('kdf');
  const sarim = byFaction.get('sarim');
  if (!kdf) out.push('data/doctrines: no KDF doctrine (N3 needs one per seat faction)');
  if (!sarim) out.push('data/doctrines: no Sarim doctrine (N3 needs one per seat faction)');
  if (kdf && sarim) {
    const k = kdf.doc.budget?.logistics_start;
    const s = sarim.doc.budget?.logistics_start;
    const [num, den] = SARIM_BUDGET_RATIO;
    if (Number.isInteger(k) && Number.isInteger(s) && s * den !== k * num) {
      out.push(
        `${sarim.file}: budget.logistics_start ${s} is not ${num}/${den} of ${kdf.file}'s ${k} ` +
          `(Sarim at 1.6x the KDF, G3 Q7 and network design §2.3)`
      );
    }
  }
  return out;
}

// --- doctrine picks (GH-1383 slice 1): data/doctrines/picks/<id>.json --------------------------
// A pick extends its faction's base doctrine above with a closed list of four ops (menu_remove,
// menu_add, set_pop_cap, set_price; the lead's Q5, 19 Nov 2026). The rules doctrine_pick.schema.json
// cannot see, numbered as the design names them (docs/superpowers/specs/2026-11-17-doctrines-design.md
// §2.2):
//
//   P1  `extends` names a base doctrine, the id's prefix is that faction, and the id is its file's name;
//   P2  exactly PICKS_PER_FACTION picks per faction (the lead's "three");
//   P3  ops in canonical order (menu_remove, menu_add, set_pop_cap, set_price sorted by unit), each kind
//       at most once except set_price, at most once per unit;
//   P4  every removed id is on the base menu; every added id is a unit of the doctrine's side, not on the
//       base menu, not `loiter_drone` (LD3) and not a Store special (bought-only, the lead's Q7);
//   P5  each pick removes at least one base unit and adds at least one;
//   P6  no superset: for two menus of one faction, base included, neither contains the other;
//   P7  a set_price unit is on the RESOLVED menu, and its price is within PRICE_STEP_PCT of its own JSON price;
//   P8  the resolved cap (set_pop_cap, else the base's) is the neutral cap (§3.2; the lead's Q6);
//   P9  (slice 1 part) the signature formation id is unique to its pick and is no shipped formation's id;
//   P10 `label`, `blurb` and `gives_up` are keys in en.json.
//
// The cost-curve half of the bar (|delta| <= 0.005 and the +/-18% band, Q6) is Python's
// (tools/doctrine_balance.py, which imports validate_balance.py's fit); validate_data.mjs runs both.
//
// P9 is HALF here on purpose (decision (b)(i) of the slice-1 PR, for the lead to confirm): the design's
// full P9 names a file in data/formations/doctrine/ carrying a `doctrines` list, and both the folder and
// the formation-schema field are slice 5's. Until then the schema requires `signature.formation` as an
// id and this checks only what holds without the file.
//
// Two P4 facts need app code and live in tools/src/validate_doctrine.test.ts: an added id is in
// versusRoster() (not VERSUS_HELD_UNITS), and `storeSpecialIds` equals the Worker's STORE_SPECIALS.

/** P2: the lead's "three per side". A constant to change, not a loop bound. */
export const PICKS_PER_FACTION = 3;

/** P3: the one resolution order. */
export const OP_ORDER = ['menu_remove', 'menu_add', 'set_pop_cap', 'set_price'];

/** P7: a set_price may move a unit's own price by at most this percentage, either way (design §2.2). */
export const PRICE_STEP_PCT = 10;

/** Whether a unit is a Store special: its `unlock` is bought-only, a price and no earned field
 *  (`isBoughtOnly` in packages/sim/src/unlock.ts, the predicate the Worker's STORE_SPECIALS is built by). */
export function isStoreSpecial(unit) {
  const g = unit?.unlock;
  if (!g || typeof g !== 'object') return false;
  const earned = g.roe_rating_min !== undefined || g.stars_min !== undefined || g.after_mission !== undefined;
  return !earned && g.price !== undefined;
}

/** Every Store special's id, in `unitsById` order. */
export function storeSpecialIds(unitsById) {
  return [...unitsById.values()].filter(isStoreSpecial).map((u) => u.id);
}

/** A pick's resolved menu, prices and cap: base order, removals dropped, additions appended in op order
 *  (@lions/data's resolveDoctrine reads it the same way; tools/src/validate_doctrine.test.ts pins the two). */
export function resolvePick(base, pick) {
  let menu = [...(base?.menu ?? [])];
  const prices = {};
  let popCap = base?.pop_cap ?? null;
  for (const op of Array.isArray(pick?.ops) ? pick.ops : []) {
    if (op?.op === 'menu_remove') {
      menu = menu.filter((u) => !op.units.includes(u));
    } else if (op?.op === 'menu_add') {
      for (const u of op.units) if (!menu.includes(u)) menu.push(u);
    } else if (op?.op === 'set_pop_cap') {
      popCap = op.value;
    } else if (op?.op === 'set_price') {
      prices[op.unit] = op.logistics;
    }
  }
  return { menu, prices, popCap };
}

/** §3.2: round(baseCap x meanPop(menu) / meanPop(baseMenu)), half up, in integers. Population is each
 *  unit's `cost.population` (0 when absent: a drone). */
export function neutralCap(baseCap, baseMenu, menu, unitsById) {
  const pop = (ids) => ids.reduce((s, id) => s + (unitsById.get(id)?.cost?.population ?? 0), 0);
  const num = baseCap * pop(menu) * baseMenu.length;
  const den = menu.length * pop(baseMenu);
  if (den === 0) return null;
  return Math.floor((2 * num + den) / (2 * den));
}

const isSuperset = (a, b) => b.every((u) => a.includes(u));

/**
 * @param {{ file: string, doc: any }[]} picks every parsed data/doctrines/picks file
 * @param {{ file: string, doc: any }[]} bases every parsed base doctrine (data/doctrines/*.json, picks/ skipped)
 * @param {Map<string, any>} unitsById every unit in data/units
 * @param {Record<string, string>} en the en.json chrome catalogue
 * @param {string[]} formationIds the ids of the shipped data/formations files
 * @returns {string[]} one line per failure
 */
export function doctrinePickFailures(picks, bases, unitsById, en, formationIds) {
  const out = [];
  const baseById = new Map();
  for (const { doc } of bases) if (doc && typeof doc.id === 'string') baseById.set(doc.id, doc);
  const perFaction = new Map([...baseById.keys()].map((f) => [f, []]));
  const signatures = new Map();
  const ids = new Map();

  for (const { file, doc } of picks) {
    if (!doc || typeof doc !== 'object') continue; // the schema check reports it
    const stem = String(file).replace(/^.*[\\/]/, '').replace(/\.json$/, '');
    const ops = Array.isArray(doc.ops) ? doc.ops : [];

    // P1
    const base = baseById.get(doc.extends);
    if (!base) {
      out.push(`${file}: P1 extends "${doc.extends}", which is no base doctrine (${[...baseById.keys()].join(', ')})`);
    } else if (typeof doc.id !== 'string' || !doc.id.startsWith(`${doc.extends}_`)) {
      out.push(`${file}: P1 id "${doc.id}" does not start with its faction "${doc.extends}_"`);
    }
    if (doc.id !== stem) out.push(`${file}: P1 id "${doc.id}" is not its filename "${stem}"`);
    if (ids.has(doc.id)) out.push(`${file}: P1 a second pick with id "${doc.id}" (after ${ids.get(doc.id)})`);
    else ids.set(doc.id, file);

    // P3
    let last = -1;
    const kinds = new Map();
    let lastPrice = null;
    for (const op of ops) {
      const at = OP_ORDER.indexOf(op?.op);
      if (at < last) out.push(`${file}: P3 op "${op?.op}" after "${OP_ORDER[last]}" -- the order is ${OP_ORDER.join(', ')}`);
      last = Math.max(last, at);
      kinds.set(op?.op, (kinds.get(op?.op) ?? 0) + 1);
      if (op?.op === 'set_price') {
        if (lastPrice !== null && !(op.unit > lastPrice)) {
          out.push(`${file}: P3 set_price "${op.unit}" after "${lastPrice}" -- set_price ops are sorted by unit id, one per unit`);
        }
        lastPrice = op.unit;
      }
    }
    for (const kind of ['menu_remove', 'menu_add', 'set_pop_cap']) {
      if ((kinds.get(kind) ?? 0) > 1) out.push(`${file}: P3 ${kinds.get(kind)} "${kind}" ops -- at most one`);
    }

    if (!base) continue; // P4-P8 read the base
    const baseMenu = Array.isArray(base.menu) ? base.menu : [];
    const removed = ops.filter((o) => o?.op === 'menu_remove').flatMap((o) => o.units ?? []);
    const added = ops.filter((o) => o?.op === 'menu_add').flatMap((o) => o.units ?? []);

    // P4
    for (const id of removed) {
      if (!baseMenu.includes(id)) out.push(`${file}: P4 menu_remove "${id}" is not on the ${base.id} base menu`);
    }
    for (const id of added) {
      const unit = unitsById.get(id);
      if (!unit) {
        out.push(`${file}: P4 menu_add "${id}" is not a unit id in data/units`);
        continue;
      }
      if (base.faction === 'kdf' && unit.faction !== 'kdf') {
        out.push(`${file}: P4 menu_add "${id}" (faction ${unit.faction}) on a KDF pick -- KDF units only`);
      }
      if (base.faction === 'sarim' && !OPPOSITION_FACTIONS.includes(unit.faction)) {
        out.push(`${file}: P4 menu_add "${id}" (faction ${unit.faction}) on a Sarim pick -- opposition units only (${OPPOSITION_FACTIONS.join(', ')})`);
      }
      if (baseMenu.includes(id)) out.push(`${file}: P4 menu_add "${id}" is already on the ${base.id} base menu`);
      if (BANNED_MENU_UNITS.includes(id)) out.push(`${file}: P4 menu_add "${id}", which no doctrine may build (LD3, 16 Oct)`);
      if (isStoreSpecial(unit)) out.push(`${file}: P4 menu_add "${id}" is a Store special (bought-only unlock) -- no pick hands one out (Q7)`);
    }

    // P5
    if (removed.length === 0) out.push(`${file}: P5 removes no base unit -- a pick gives something up`);
    if (added.length === 0) out.push(`${file}: P5 adds no unit -- a pick gets something`);

    const resolved = resolvePick(base, doc);
    perFaction.get(base.id)?.push({ file, id: doc.id, menu: resolved.menu });

    // P7
    for (const op of ops.filter((o) => o?.op === 'set_price')) {
      if (!resolved.menu.includes(op.unit)) {
        out.push(`${file}: P7 set_price "${op.unit}" is not on the resolved menu`);
        continue;
      }
      const own = unitsById.get(op.unit)?.cost?.logistics;
      if (Number.isInteger(own) && Math.abs(op.logistics - own) * 100 > PRICE_STEP_PCT * own) {
        out.push(`${file}: P7 set_price "${op.unit}" ${own} -> ${op.logistics} moves its own price by more than ${PRICE_STEP_PCT}%`);
      }
    }

    // P8
    const capOp = ops.find((o) => o?.op === 'set_pop_cap');
    if (typeof base.pop_cap !== 'number') {
      if (capOp) out.push(`${file}: P8 set_pop_cap on a base with no cap -- there is no neutral cap to match`);
    } else {
      const want = neutralCap(base.pop_cap, baseMenu, resolved.menu, unitsById);
      if (resolved.popCap !== want) {
        out.push(
          `${file}: P8 cap ${resolved.popCap}${capOp ? '' : ` (the base's, no set_pop_cap)`} is not the neutral cap ${want} ` +
            `(${base.pop_cap} x mean population of the resolved menu / the base's, rounded)`
        );
      }
    }

    // P9 (slice 1 part)
    const sig = doc.signature?.formation;
    if (typeof sig === 'string') {
      if (signatures.has(sig)) out.push(`${file}: P9 signature formation "${sig}" is already ${signatures.get(sig)}'s -- one doctrine to a signature`);
      else signatures.set(sig, doc.id);
      if (formationIds.includes(sig)) out.push(`${file}: P9 signature formation "${sig}" is a shipped data/formations id, open to every seat -- a signature is gated to one doctrine`);
    }

    // P10
    for (const field of ['label', 'blurb', 'gives_up']) {
      if (typeof doc[field] === 'string' && !Object.hasOwn(en, doc[field])) out.push(`${file}: P10 ${field} key "${doc[field]}" is not in en.json`);
    }
  }

  // P2
  for (const [faction, list] of perFaction) {
    if (list.length !== PICKS_PER_FACTION) {
      out.push(`data/doctrines/picks: P2 ${list.length} "${faction}" picks -- exactly ${PICKS_PER_FACTION} per faction`);
    }
  }

  // P6: every ordered pair of one faction's menus, the base included
  for (const [faction, list] of perFaction) {
    const base = baseById.get(faction);
    const menus = [{ file: `${faction} base`, id: faction, menu: base?.menu ?? [] }, ...list];
    for (const a of menus) {
      for (const b of menus) {
        if (a === b) continue;
        if (isSuperset(a.menu, b.menu)) out.push(`${a.file}: P6 its menu contains all of ${b.id}'s -- no doctrine is a superset of another`);
      }
    }
  }
  return out;
}
