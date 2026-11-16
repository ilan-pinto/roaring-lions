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
    const tagged = (mi.starting_force ?? []).filter((p) => p.tag === o.target);
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
  return out;
}
