// GH-859 P1a Task 1: the cross-file rules for data/formations/*.json that
// formation.schema.json cannot see. Its own module for the reason every validate_*.mjs is one:
// validate_data.mjs runs its whole sweep at import time and exits, so a test cannot import it.
//
//   - ids are unique, and each is its file's name;
//   - `label` and `blurb` are keys in en.json;
//   - `hud.formation.face.<face>` exists for the arrival face (`none` has nothing to say), and
//     `hud.formation.drill.<drill>` for every drill except `none` (P1a kept `halt` out until it was true,
//     plan Ruling 16; GH-859 P1b Task 4 makes it true, so it is required now);
//   - a file with a ring has `hud.formation.shape.ring`;
//   - `factions` are `kdf` or `sarim`;
//   - `ring.radius[0] <= radius[1]`;
//   - `(files - 1) * file_gap` is even, so the schematic's centre is an integer;
//   - `rest` appears at most once, and only in the last element;
//   - `arrival.stance` is `ambush` only with a ring element and the `spring` drill;
//   - at most one ring element;
//   - at most 255 formations in all: the sim keeps a group's type in one byte (`fgType`) and a
//     256th would wrap onto the first.
//
// The placement run (every shipped formation places N = 2..24 units on open ground with no tile
// twice) is a vitest test, tools/src/formations_place.test.ts: this module is plain node with no
// build step and cannot import the sim's generator (plan Ruling 14).

const FACTIONS = new Set(['kdf', 'sarim']);
/** Mirrors MAX_FORMATION_TYPES in packages/sim/src/tuning.ts (a plain-node module cannot import it;
 *  the sim's own test pins the two together). */
const MAX_FORMATION_TYPES = 255;

/**
 * @param {{ file: string, doc: any }[]} files every parsed data/formations file
 * @param {Record<string, string>} en the en.json catalogue
 * @returns {string[]} one line per failure
 */
export function formationFailures(files, en) {
  const out = [];
  const seen = new Map();
  const has = (key) => Object.hasOwn(en, key);
  if (files.length > MAX_FORMATION_TYPES) out.push(`${files.length} formations; at most ${MAX_FORMATION_TYPES} (the sim keeps a group's type in one byte)`);
  for (const { file, doc } of files) {
    if (!doc || typeof doc !== 'object') continue; // the schema check reports it
    const stem = String(file).replace(/^.*[\\/]/, '').replace(/\.json$/, '');
    if (doc.id !== stem) out.push(`${file}: id "${doc.id}" is not its filename "${stem}"`);
    if (seen.has(doc.id)) out.push(`${file}: a second formation with id "${doc.id}" (after ${seen.get(doc.id)})`);
    else seen.set(doc.id, file);

    for (const field of ['label', 'blurb']) {
      if (typeof doc[field] === 'string' && !has(doc[field])) out.push(`${file}: ${field} key "${doc[field]}" is not in en.json`);
    }
    const face = doc.arrival?.face;
    if (typeof face === 'string' && face !== 'none' && !has(`hud.formation.face.${face}`)) {
      out.push(`${file}: arrival.face "${face}" has no en.json key hud.formation.face.${face}`);
    }
    const drill = doc.contact?.drill;
    if (typeof drill === 'string' && drill !== 'none' && !has(`hud.formation.drill.${drill}`)) {
      out.push(`${file}: contact.drill "${drill}" has no en.json key hud.formation.drill.${drill}`);
    }
    for (const f of doc.factions ?? []) {
      if (!FACTIONS.has(f)) out.push(`${file}: faction "${f}" is not kdf or sarim`);
    }

    const elements = Array.isArray(doc.elements) ? doc.elements : [];
    let rings = 0;
    let rests = 0;
    elements.forEach((el, i) => {
      const shape = el?.shape ?? {};
      if (shape.kind === 'ring') {
        rings++;
        const [lo, hi] = shape.radius ?? [];
        if (lo > hi) out.push(`${file}: element ${i} ring radius [${lo}, ${hi}] has min above max`);
      }
      if (shape.kind === 'files' && ((shape.files - 1) * (shape.file_gap ?? 1)) % 2 !== 0) {
        out.push(`${file}: element ${i} files (${shape.files} - 1) x file_gap ${shape.file_gap ?? 1} is odd, so the schematic has no integer centre`);
      }
      const classes = Array.isArray(el?.classes) ? el.classes : [];
      if (classes.includes('rest')) {
        rests++;
        if (i !== elements.length - 1) out.push(`${file}: element ${i} names "rest" but is not the last element`);
      }
    });
    if (rests > 1) out.push(`${file}: "rest" appears in ${rests} elements; at most one`);
    if (rings > 1) out.push(`${file}: ${rings} ring elements; at most one`);
    if (rings > 0 && !has('hud.formation.shape.ring')) out.push(`${file}: has a ring but en.json has no hud.formation.shape.ring`);
    if (doc.arrival?.stance === 'ambush' && (rings === 0 || drill !== 'spring')) {
      out.push(`${file}: arrival.stance "ambush" needs a ring element and the "spring" drill (ring: ${rings}, drill: ${drill})`);
    }
  }
  return out;
}
