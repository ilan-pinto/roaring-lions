// N3 prep (network lane; lead rulings LD2 and LD3, 16 Oct): the cross-file rules for
// data/doctrines/*.json that doctrine.schema.json cannot see.
//
//   - every menu id is a unit in data/units;
//   - a KDF doctrine's menu is KDF units only, and a Sarim doctrine's is opposition units only
//     (sarim, rif or ashwar -- the same set versus-force.test.ts holds VERSUS_SARIM to);
//   - no menu holds `loiter_drone` (LD3: population 0, which the cap never refuses, plus a
//     kamikaze, is a spam risk with no balance behind it);
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
