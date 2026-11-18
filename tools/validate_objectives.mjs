// GH-2 and GH-4: the authoring-time cross-checks for the `escort` and `no_collateral_above` objective types, and for the fields that
// belong to them alone (`zone`, `threshold`, and since GH-1439 an escort's `fail_after_losses` and `until`).
//
// The runtime (`MissionRuntime`'s constructor and `start()`) throws on the same faults at load; this is the same refusal
// before a mission ships, and it names the mission file. Its own module, like `validate_income.mjs`, because
// `validate_data.mjs` runs its whole sweep at import time and exits, so a test cannot import a function from it.

/**
 * @param {Record<string, any>} o   one objective of the mission
 * @param {Record<string, any>} mi  the parsed mission
 * @param {Record<string, any>} map the parsed map JSON the mission plays on
 * @param {string} file             for messages
 * @returns {string[]}
 */
export function objectiveFailures(o, mi, map, file) {
  const out = [];
  const zoneNames = new Set(Object.keys(map?.zones ?? {}));
  // GH-2: an escort names the player's own tagged units (`target`) and a destination zone (`zone`). `zone` belongs to
  // escort alone.
  if (o.type === 'escort') {
    if (!o.zone || !zoneNames.has(o.zone)) {
      out.push(`${file}: escort "${o.id}" references unknown zone "${o.zone}"`);
    }
    // A tag may sit on a placement or on a PASSENGER of one (the runtime tags a rider like any spawn: an escort of riders in a carrier
    // is legal and is how a convoy is escorted). A tag only a rider carries still names units, so it is not a missing tag.
    const tagged = (mi.starting_force ?? []).filter((p) => p.tag === o.target || (p.passengers ?? []).some((q) => q.tag === o.target));
    if (!o.target || tagged.length === 0) {
      out.push(`${file}: escort "${o.id}" needs a tag on a starting_force placement, not "${o.target}"`);
    }
    // GH-1439 R3: a loss tolerance past the number of tagged units could never be reached. The runtime gives EACH carrier the whole
    // declared load, so a placement of `count` carriers fields count x (passengers' counts) tagged riders on top of its own count
    // when it is tagged itself; the runtime reads the bodies and refuses the same.
    if (o.fail_after_losses !== undefined && Number.isInteger(o.fail_after_losses) && o.fail_after_losses >= 1 && tagged.length > 0) {
      // A `from_ledger` placement's body count depends on the player's roster, so the runtime check could throw for one player and
      // not another: refused at authoring time for a tolerance above 1.
      if (o.fail_after_losses > 1 && tagged.some((p) => p.from_ledger === true)) {
        out.push(`${file}: escort "${o.id}" fail_after_losses ${o.fail_after_losses} is refused: tag "${o.target}" is carried by a from_ledger placement, whose unit count depends on the player's roster`);
      }
      const total = (mi.starting_force ?? []).reduce(
        (n, p) => n + (p.tag === o.target ? (p.count ?? 1) : 0) + (p.count ?? 1) * (p.passengers ?? []).reduce((m, q) => m + (q.tag === o.target ? (q.count ?? 1) : 0), 0),
        0,
      );
      if (total > 0 && o.fail_after_losses > total) {
        out.push(`${file}: escort "${o.id}" fail_after_losses ${o.fail_after_losses} cannot exceed the ${total} units tagged "${o.target}"`);
      }
    }
    // Already there at tick zero completes on the first tick (the runtime throws). Mirrored here for the case that is
    // exact on `at` alone: every tagged placement is ONE unit (a larger one spreads from `at` and the runtime reads the
    // bodies), standing on a tile inside the zone. GH-1439 R7: not for an escort with an `until`, whose work is still to do
    // (a protect-in-place escort).
    const zr = map?.zones?.[o.zone];
    if (
      o.until === undefined &&
      zr &&
      tagged.length > 0 &&
      tagged.every(
        (p) =>
          p.tag === o.target && // a rider-only tag is exact on no `at` of ours: the runtime reads the bodies
          p.count === 1 &&
          Array.isArray(p.at) &&
          Math.floor(p.at[0]) >= zr[0] &&
          Math.floor(p.at[0]) < zr[0] + zr[2] &&
          Math.floor(p.at[1]) >= zr[1] &&
          Math.floor(p.at[1]) < zr[1] + zr[3],
      )
    ) {
      out.push(`${file}: escort "${o.id}" starts inside zone "${o.zone}", so it would complete on the first tick`);
    }
  } else if (o.zone !== undefined) {
    out.push(`${file}: objective "${o.id}" is a ${o.type}, which takes no zone (only escort does)`);
  }
  // GH-1439: the two escort-only fields.
  if (o.type !== 'escort') {
    if (o.fail_after_losses !== undefined) out.push(`${file}: objective "${o.id}" is a ${o.type}, which takes no fail_after_losses (only escort does)`);
    if (o.until !== undefined) out.push(`${file}: objective "${o.id}" is a ${o.type}, which takes no until (only escort does)`);
  } else {
    if (o.fail_after_losses !== undefined && (!Number.isInteger(o.fail_after_losses) || o.fail_after_losses < 1)) {
      out.push(`${file}: escort "${o.id}" needs a whole fail_after_losses of at least 1, not ${o.fail_after_losses}`);
    }
    if (o.until !== undefined) {
      if (!Array.isArray(o.until) || o.until.length === 0 || new Set(o.until).size !== o.until.length) {
        out.push(`${file}: escort "${o.id}" needs an until of one or more distinct objective ids`);
      } else {
        for (const u of o.until) {
          if (u === o.id) {
            out.push(`${file}: escort "${o.id}" until names itself`);
            continue;
          }
          const waits = (mi.objectives ?? []).find((x) => x.id === u);
          if (waits === undefined) out.push(`${file}: escort "${o.id}" until names unknown objective "${u}"`);
          else if (!waits.primary) out.push(`${file}: escort "${o.id}" until waits on a secondary ("${u}"), which could fail and leave the escort active for ever`);
          else if (waits.type === 'escort' || waits.type === 'no_collateral_above' || waits.type === 'score') {
            out.push(`${file}: escort "${o.id}" until waits on a type that waits on it ("${u}" is ${waits.type === 'escort' ? 'an' : 'a'} ${waits.type})`);
          }
        }
      }
    }
  }
  // GH-4: a hard ceiling on the ROE score.
  if (o.type === 'no_collateral_above') {
    if (!Number.isInteger(o.threshold) || o.threshold < 0 || o.threshold > 100) {
      out.push(`${file}: no_collateral_above "${o.id}" needs a whole threshold from 0 to 100, not ${o.threshold}`);
    }
    if (mi.roe?.enabled === false) {
      out.push(`${file}: no_collateral_above "${o.id}" reads the ROE score, which this mission switches off`);
    }
    if (!(mi.objectives ?? []).some((x) => x.primary && x.type !== 'no_collateral_above')) {
      out.push(`${file}: no_collateral_above "${o.id}" needs another primary objective (not a ceiling) to complete alongside`);
    }
  } else if (o.threshold !== undefined) {
    out.push(`${file}: objective "${o.id}" is a ${o.type}, which takes no threshold (only no_collateral_above does)`);
  }
  // GH-1438: `by_order` belongs to raze alone (the schema refuses it elsewhere; this is the same refusal naming the file).
  if (o.by_order !== undefined && o.type !== 'raze') {
    out.push(`${file}: objective "${o.id}" is a ${o.type}, which takes no by_order (only raze does)`);
  }
  return out;
}

/**
 * A `raze` objective's zone (the checks that used to sit inline in `validate_data.mjs`, moved here so a test can import them).
 *
 * `stepDemolition` consults `roePenalty` and `lowProfile` only when a demolisher picks a target on its own initiative; `per_tile`
 * appears nowhere in the sim. So a low-profile or per-tile work in a raze zone is not unrazeable, it is razed only by an explicit
 * `demolish` order, one per structure (one per TILE for a per-tile type). The default is to refuse it, because on almost every
 * mission that is a trap the author did not mean to set.
 *
 * `by_order: true` (GH-1438, Bir Tarsha IV: the fence works are 13 berm and sandbag tiles) is the author saying they meant it. It
 * lifts the `low_profile` and `per_tile` refusals ONLY. A protected work (roe_penalty at or past `protectedRoe`) is refused with
 * or without it: levelling one is a Conduct loss, never an objective. The flag is read here and nowhere else; the sim never sees it.
 *
 * @param {Record<string, any>} o   the raze objective
 * @param {Record<string, any>} mi  the parsed mission
 * @param {Record<string, any>} map the parsed map JSON
 * @param {{ types: Record<string, any> }} catalogue  data/structures.json
 * @param {Map<string, string>} symbols  map symbol -> structure type id
 * @param {number} protectedRoe  mirrors PROTECTED_ROE in packages/sim/src/structures.ts
 * @param {string} file             for messages
 * @returns {string[]}
 */
export function razeZoneFailures(o, mi, map, catalogue, symbols, protectedRoe, file) {
  const out = [];
  const rect = map.zones?.[o.target];
  if (!rect) {
    out.push(`${file}: raze "${o.id}" names zone "${o.target}", which map "${mi.map?.file}" does not declare`);
    return out;
  }
  const [zx, zy, zw, zh] = rect;
  // Keyed by "typeId:reason" so a type that trips more than one reason (today only `wall`, which is both low_profile and
  // per_tile) gets a message for each reason instead of the first reason found silently winning.
  const bad = new Map();
  // One check for both sources of a structure inside the zone. `via` names where the structure came from, because the fix
  // differs: a map symbol is edited in the map, a placed body in the mission.
  const flag = (typeId, x, y, via) => {
    const spec = catalogue.types[typeId];
    if (spec.low_profile && o.by_order !== true && !bad.has(`${typeId}:low_profile`)) {
      bad.set(
        `${typeId}:low_profile`,
        `${file}: raze "${o.id}" zone "${o.target}" contains "${typeId}" -- low_profile at (${x},${y})${via}. ` +
          `A demolisher will not level it unattended (set "by_order": true if one demolish order each is meant).`
      );
    }
    if ((spec.roe_penalty ?? 0) >= protectedRoe && !bad.has(`${typeId}:protected`)) {
      bad.set(
        `${typeId}:protected`,
        `${file}: raze "${o.id}" zone "${o.target}" contains "${typeId}" -- protected (roe_penalty ${spec.roe_penalty}) at ` +
          `(${x},${y})${via}. A demolisher will not level it unattended.`
      );
    }
    if (spec.per_tile && o.by_order !== true && !bad.has(`${typeId}:per_tile`)) {
      bad.set(
        `${typeId}:per_tile`,
        `${file}: raze "${o.id}" zone "${o.target}" contains "${typeId}" -- per_tile at (${x},${y})${via}: every tile is its ` +
          `own structure, so this raze zone is N separate demolish orders, not one (set "by_order": true if that is meant).`
      );
    }
  };
  for (let y = zy; y < zy + zh; y++) {
    for (let x = zx; x < zx + zw; x++) {
      const typeId = symbols.get(map.rows?.[y]?.[x]);
      if (!typeId) continue;
      flag(typeId, x, y, '');
    }
  }
  // Mission-placed bodies too (2026-09-07, Qarn Hadid design G1): the runtime raises `structures[]` BEFORE the objective snapshot
  // (`MissionRuntime.raiseMissionStructures`), so a wall or fence a mission drops inside its own raze zone is exactly as unrazeable
  // as one drawn in the map rows. `at` is the top-left tile, `size` the footprint (default 1x1).
  for (const placed of mi.structures ?? []) {
    if (!placed?.type || !Array.isArray(placed.at)) continue;
    const [px, py] = placed.at;
    const [pw, ph] = placed.size ?? [1, 1];
    const ox = Math.max(px, zx);
    const oy = Math.max(py, zy);
    if (ox >= Math.min(px + pw, zx + zw) || oy >= Math.min(py + ph, zy + zh)) continue;
    if (!catalogue.types[placed.type]) continue; // the schema check reports that
    flag(placed.type, ox, oy, ', placed by the mission\'s "structures"');
  }
  for (const msg of bad.values()) out.push(msg);
  return out;
}
