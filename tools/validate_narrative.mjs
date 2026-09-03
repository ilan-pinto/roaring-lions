// The narrative layer's cross-file guards (2026-09-03 spec): `remove`
// triggers, the story voice's 240-character ceiling, and commander.json's
// rank ordering.
//
// Pure functions, exactly like tools/validate_map_grid.mjs's
// elevationFailures and for the same reason: validate_data.mjs runs its
// whole sweep at import time and exits the process, so a test cannot import
// it. Each function here takes plain data (a mission doc, or a commander doc
// plus a world doc) and returns an array of failure strings, so a test can
// call it directly against a bare fixture object.

const MAX_SAY_LENGTH = 240;

/**
 * Every `group` any placement in this mission declares -- enemy garrison,
 * civilian groups, wave units, spawn/reinforce units, and starting_force
 * alike. Walks the whole mission object looking for anything shaped like a
 * placement (a string `.unit`), the same generic walk validate_data.mjs's
 * own `declaredGroups` sweep already does for the commit/withdraw_to/dismount
 * checks below it. Duplicated rather than shared so this stays a pure
 * function a test can call with a bare fixture -- the same trade the FOOT_ROLES
 * and PROTECTED_ROE constants above already make, and for the same reason.
 */
function collectGroups(node, out) {
  if (Array.isArray(node)) {
    for (const v of node) collectGroups(v, out);
  } else if (node && typeof node === 'object') {
    if (typeof node.unit === 'string' && typeof node.group === 'string') out.add(node.group);
    for (const v of Object.values(node)) collectGroups(v, out);
  }
}

/**
 * `remove` trigger guards.
 *
 * - `do.group` must name a group some placement in this mission actually
 *   declares. An unknown group is a silent no-op at runtime -- `this.groups`
 *   has nothing under that name to remove -- the identical failure shape
 *   `commit`/`withdraw_to`/`dismount` are already guarded against elsewhere
 *   in validate_data.mjs.
 * - A `remove` whose group covers EVERY starting_force entry is refused
 *   outright: it would take the player's whole force off the board at once,
 *   which reads as a mission wipe, not a scripted narrative beat. Scoped to
 *   starting_force on purpose (not reinforcements) -- that is the force the
 *   player actually deployed with.
 *
 * Silent on a `remove` with no `group` at all: the schema's own `if`/`then`
 * on `do` already requires one for this kind, so ajv reports that failure on
 * its own pass over the same file.
 */
export function removeTriggerFailures(mission, label) {
  const out = [];
  const groups = new Set();
  collectGroups(mission, groups);
  const startingForce = mission.starting_force ?? [];
  for (const t of mission.triggers ?? []) {
    if (t.do?.kind !== 'remove') continue;
    const group = t.do.group;
    if (!group) continue;
    const name = t.id ?? '(unnamed)';
    if (!groups.has(group)) {
      out.push(`${label}: remove trigger "${name}" names group "${group}", which no placement declares`);
      continue;
    }
    if (startingForce.length > 0 && startingForce.every((p) => p.group === group)) {
      out.push(
        `${label}: remove trigger "${name}" names group "${group}", which covers every ` +
          `starting_force entry — removing it would take the whole player force off the ` +
          `board, which reads as a mission wipe rather than a scripted beat`
      );
    }
  }
  return out;
}

/**
 * The story voice's 240-character ceiling. mission.schema.json's own
 * `maxLength` on `say.text`/`dispatch`/`aftermath`/`debrief` already
 * enforces this through ajv on every real mission file; this hand-rolled
 * copy exists purely so the limit has a direct, importable test, the same
 * reason every other function in this module exists.
 */
export function narrativeTextFailures(mission, label) {
  const out = [];
  const check = (text, where) => {
    if (typeof text === 'string' && text.length > MAX_SAY_LENGTH) {
      out.push(`${label}: ${where} is ${text.length} characters, over the ${MAX_SAY_LENGTH} limit`);
    }
  };
  check(mission.dispatch, 'dispatch');
  check(mission.aftermath, 'aftermath');
  check(mission.debrief, 'debrief');
  for (const t of mission.triggers ?? []) {
    if (t.say) check(t.say.text, `trigger "${t.id ?? '(unnamed)'}" say.text`);
  }
  for (const o of mission.objectives ?? []) {
    if (o.say) check(o.say.text, `objective "${o.id}" say.text`);
    if (o.say_on_fail) check(o.say_on_fail.text, `objective "${o.id}" say_on_fail.text`);
  }
  return out;
}

/**
 * commander.json's ranks must reference real missions, in ascending campaign
 * order (world.json's town arrays, regions in order) -- the resolution rule
 * ("the rank for a mission is the first entry whose until_mission is that
 * mission or later in campaign order") only makes sense if the array is
 * sorted that way. Only the LAST rank may omit `until_mission`: it is the
 * default for everything after it, and the resolver has no answer if an
 * earlier entry omits it or the last one does not.
 */
export function commanderRankFailures(commander, world, label) {
  const out = [];
  const order = [];
  for (const region of world?.regions ?? []) {
    for (const town of region.towns ?? []) {
      for (const m of town.missions ?? []) order.push(m);
    }
  }
  const indexOf = new Map(order.map((id, i) => [id, i]));
  const ranks = commander?.ranks ?? [];
  let lastIndex = -1;
  ranks.forEach((r, i) => {
    const isLast = i === ranks.length - 1;
    if (r.until_mission === undefined) {
      if (!isLast) {
        out.push(
          `${label}: rank "${r.rank}" has no "until_mission" but is not the last entry — ` +
            `only the final (default) rank may omit it`
        );
      }
      return;
    }
    if (isLast) {
      out.push(
        `${label}: rank "${r.rank}" is the last entry but declares "until_mission" ` +
          `"${r.until_mission}" — the last entry is the default and must have none`
      );
    }
    const idx = indexOf.get(r.until_mission);
    if (idx === undefined) {
      out.push(
        `${label}: rank "${r.rank}" names until_mission "${r.until_mission}", which is not ` +
          `a mission listed in world.json's campaign order`
      );
      return;
    }
    if (idx <= lastIndex) {
      out.push(
        `${label}: rank "${r.rank}"'s until_mission "${r.until_mission}" is not later in ` +
          `campaign order than the previous rank's`
      );
    }
    lastIndex = idx;
  });
  return out;
}
