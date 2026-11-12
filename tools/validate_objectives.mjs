// GH-2 and GH-4: the authoring-time cross-checks for the `escort` and `no_collateral_above` objective types, and for the two
// fields that belong to them alone (`zone`, `threshold`).
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
    // Already there at tick zero completes on the first tick (the runtime throws). Mirrored here for the case that is
    // exact on `at` alone: every tagged placement is ONE unit (a larger one spreads from `at` and the runtime reads the
    // bodies), standing on a tile inside the zone.
    const zr = map?.zones?.[o.zone];
    if (
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
