// GH-1438 E5 (docs/campaign/civilian-drama.md §10.2, N24 and L-2): a trigger's `do.zone`. The runtime reads it on
// three kinds: `remove` takes only the group members standing in it, and `commit` and `withdraw_to` order only the
// members standing in it (`MissionRuntime.stepTriggers`). On any other kind it would be accepted by the schema and
// ignored by the runtime, which is the footgun N24 names: refuse it. And a name the map lacks resolves to no zone,
// which every one of the three reads as "the whole group", so a typo takes or moves everyone: refuse that too (the
// runtime's `start()` throws on it as well; this is the same rule at authoring time, with the file named).
//
// Its own module because validate_data.mjs runs its whole sweep at import time and exits.

/** The `do.kind`s whose runtime reads `do.zone`. */
export const ZONED_TRIGGER_KINDS = new Set(['remove', 'commit', 'withdraw_to']);

export function triggerZoneFailures(mission, map, file) {
  const out = [];
  const zoneNames = new Set(Object.keys(map?.zones ?? {}));
  for (const [i, t] of (mission?.triggers ?? []).entries()) {
    const zone = t?.do?.zone;
    if (zone === undefined) continue;
    const name = t.id ?? `trigger_${i}`;
    const kind = t.do.kind;
    if (!ZONED_TRIGGER_KINDS.has(kind)) {
      out.push(`${file}: trigger "${name}" (${kind}) carries do.zone "${zone}", which only remove, commit and withdraw_to read (GH-1438 E5)`);
      continue;
    }
    if (!zoneNames.has(zone)) {
      out.push(`${file}: trigger "${name}" (${kind}) do.zone names unknown zone "${zone}"; with no zone it would act on the whole group`);
    }
  }
  return out;
}
