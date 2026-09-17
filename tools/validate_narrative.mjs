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

/** `triggerLabelFailures`'s own 48-character cap on a trigger `label`,
 *  applied a second time below to an OVERLAY's label override — a
 *  translated line is exactly as reachable in a 60px tile as the source one,
 *  and nothing else checks its length. */
const MAX_TRIGGER_LABEL = 48;

const MAX_SAY_LENGTH = 240;
/** `$defs/say`'s own `speaker` enum in mission.schema.json, copied here for
 *  the same reason MAX_SAY_LENGTH is: a direct, importable test rather than
 *  one that can only be exercised through ajv. */
const LEGAL_SPEAKERS = new Set(['shai', 'idit', 'net', 'enemy']);

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
 * T1-a: throws when `mission` is not a plausible mission object, rather
 * than letting a swapped-argument call degrade to `mission.triggers ?? []`
 * -> `[]` -> a gate that silently passes. A mission is always the parsed
 * JSON of a mission file -- a non-null, non-array object -- and never a
 * bare string, which is exactly what a `(file, mission)` call reversed to
 * `(mission, file)` would pass as the first argument instead.
 */
function mustBeMissionObject(mission, fnName) {
  if (mission === null || typeof mission !== 'object' || Array.isArray(mission)) {
    const got = typeof mission === 'string' ? JSON.stringify(mission) : String(mission);
    throw new TypeError(`${fnName}: expected a mission object as the first argument, got ${got} -- check the argument order`);
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

/** Every trigger a player can see fire carries a human label (spec §5: no id
 *  reaches the DOM). `remove` is silent housekeeping and is exempt.
 *
 *  `(mission, file)` -- T1-a (shell-upgrade Phase 0 final review): this used
 *  to take `(file, mission)`, the one function in this module reversing its
 *  siblings' `(mission, label)` order (`removeTriggerFailures`,
 *  `narrativeTextFailures` above and below). The one call site
 *  (`validate_data.mjs`) is plain JS and untypechecked, so a swap there
 *  would have `mission.triggers` read as `undefined` on a STRING argument
 *  and `?? []` silently produce an empty array -- a gate that passes on
 *  every unlabelled trigger in the tree rather than naming the mismatch.
 *  `mustBeMissionObject` below is the guard for exactly that shape of
 *  failure, so a future swap fails loudly instead of returning `[]`. */
export function triggerLabelFailures(mission, file) {
  mustBeMissionObject(mission, 'triggerLabelFailures');
  const out = [];
  for (const [i, t] of (mission.triggers ?? []).entries()) {
    const name = t.id ?? `trigger_${i}`;
    if (t.do?.kind === 'remove') continue;
    if (typeof t.label !== 'string' || t.label.length === 0) {
      out.push(`${file}: trigger "${name}" (${t.do?.kind}) has no label`);
      continue;
    }
    if (t.label.length > 48) out.push(`${file}: trigger "${name}" label is ${t.label.length} characters (max 48)`);
    if (t.label.endsWith('.')) out.push(`${file}: trigger "${name}" label ends in a full stop`);
  }
  return out;
}

/**
 * The story voice's 240-character ceiling, plus (G11) the `$defs/say`
 * speaker vocabulary for `debrief`'s two variants. mission.schema.json's own
 * `maxLength` on `say.text`/`dispatch`/`aftermath` and `$defs/say`'s
 * `speaker` enum already enforce both through ajv on every real mission
 * file; this hand-rolled copy exists purely so the limits have a direct,
 * importable test, the same reason every other function in this module
 * exists.
 *
 * `debrief` stopped being a plain string at G11 -- it is now
 * `{ victory?: say, defeat?: say }`, one line per outcome, either or both
 * absent -- so it is checked like a `say` (text AND speaker) rather than
 * like `dispatch`/`aftermath`, which stay bare strings with no speaker of
 * their own.
 */
export function narrativeTextFailures(mission, label) {
  const out = [];
  const check = (text, where) => {
    if (typeof text === 'string' && text.length > MAX_SAY_LENGTH) {
      out.push(`${label}: ${where} is ${text.length} characters, over the ${MAX_SAY_LENGTH} limit`);
    }
  };
  const checkSay = (say, where) => {
    if (!say) return;
    check(say.text, `${where}.text`);
    if (typeof say.speaker === 'string' && !LEGAL_SPEAKERS.has(say.speaker)) {
      out.push(
        `${label}: ${where}.speaker is "${say.speaker}", not one of ${[...LEGAL_SPEAKERS].join('/')}`
      );
    }
  };
  check(mission.dispatch, 'dispatch');
  check(mission.aftermath, 'aftermath');
  checkSay(mission.debrief?.victory, 'debrief.victory');
  checkSay(mission.debrief?.defeat, 'debrief.defeat');
  for (const t of mission.triggers ?? []) {
    if (t.say) check(t.say.text, `trigger "${t.id ?? '(unnamed)'}" say.text`);
  }
  for (const o of mission.objectives ?? []) {
    if (o.say) check(o.say.text, `objective "${o.id}" say.text`);
    if (o.say_on_fail) check(o.say_on_fail.text, `objective "${o.id}" say_on_fail.text`);
  }
  // G12 (2026-09-06): a wave can speak. Checked like a trigger's say -- text
  // AND speaker, since the wave has no id of its own to name it by, the clock
  // does.
  for (const w of mission.enemy?.waves ?? []) {
    checkSay(w.say, `wave @${w.at_seconds}s say`);
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

/**
 * Cross-checks one mission-text locale overlay (`data/locales/<lang>/missions.json`,
 * `@lions/data`'s `MissionLocaleOverlay` shape) against the real missions it
 * overlays: every mission id it names, and every objective/trigger id under
 * that mission, must exist, and a trigger label override may not overflow
 * the 48-character cap the SOURCE label is already held to
 * (`triggerLabelFailures` above). `applyMissionLocale`
 * (`packages/data/src/index.ts`) silently no-ops an unknown id at runtime —
 * a translator's typo would otherwise ship invisibly, doing nothing, forever.
 *
 * `missions` is a `Map` from mission id to its parsed JSON, the same shape
 * `validate_data.mjs`'s own tutorial cross-check already builds — a plain
 * object would work too, but a `Map` is what every other cross-check in this
 * file's caller already has lying around by the time an overlay is checked.
 */
export function overlayFailures(file, overlay, missions) {
  const out = [];
  for (const [missionId, o] of Object.entries(overlay ?? {})) {
    const mission = missions.get(missionId);
    if (!mission) {
      out.push(`${file}: overlay names mission "${missionId}", which is not a mission in data/missions`);
      continue;
    }
    const objectiveIds = new Set((mission.objectives ?? []).map((ob) => ob.id));
    for (const obId of Object.keys(o.objectives ?? {})) {
      if (!objectiveIds.has(obId)) {
        out.push(
          `${file}: mission "${missionId}" overlay names objective "${obId}", which is not ` +
            `an objective on that mission`
        );
      }
    }
    const triggerIds = new Set((mission.triggers ?? []).map((t) => t.id).filter((id) => id !== undefined));
    for (const [trId, trLabel] of Object.entries(o.triggers ?? {})) {
      if (!triggerIds.has(trId)) {
        out.push(
          `${file}: mission "${missionId}" overlay names trigger "${trId}", which is not ` +
            `a trigger on that mission`
        );
        continue;
      }
      if (typeof trLabel === 'string' && trLabel.length > MAX_TRIGGER_LABEL) {
        out.push(
          `${file}: mission "${missionId}" trigger "${trId}" overlay label is ` +
            `${trLabel.length} characters (max ${MAX_TRIGGER_LABEL})`
        );
      }
    }
  }
  return out;
}
