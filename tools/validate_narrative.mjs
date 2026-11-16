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

/** The keys one mission's overlay entry may carry: everything `applyMissionLocale` (`@lions/data`) reads. Anything else is a typo that
 *  would no-op for ever, so it is a failure. */
const OVERLAY_ENTRY_KEYS = new Set([
  'name', 'briefing', 'objectives', 'triggers', 'dispatch', 'aftermath', 'hostages_place', 'debrief', 'sections',
  'objective_say', 'objective_say_on_fail', 'trigger_say', 'wave_say',
]);
const SECTION_IDS = ['situation', 'mission', 'execution', 'notes'];
/** `mission.schema.json`'s own caps, held on a translated string too: `dispatch` and `aftermath` 240, `hostages_place` 40. */
const MAX_DISPATCH = 240;
const MAX_AFTERMATH = 240;
const MAX_HOSTAGES_PLACE = 40;

const isText = (v) => typeof v === 'string' && v.trim().length > 0;
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Cross-checks one mission-text locale overlay (`data/locales/<lang>/missions.json`,
 * `@lions/data`'s `MissionLocaleOverlay` shape) against the real missions it
 * overlays. `applyMissionLocale` (`packages/data/src/index.ts`) silently
 * no-ops anything that does not resolve, so a translator's typo would
 * otherwise ship invisibly, doing nothing, forever. Every one of these is a failure:
 *
 * - a mission id that is not a mission; a key the overlay does not read (`dispach`);
 * - an objective, trigger or wave key that is not on THAT mission, or a `*_say` key naming one with no line of that kind;
 * - `dispatch`, `aftermath`, `hostages_place` or a `debrief` line the mission does not have;
 * - a string that is not a non-empty string, or that overflows its cap (a trigger label 48, a radio line 240, `dispatch` and
 *   `aftermath` 240, `hostages_place` 40: the caps the SOURCE text is held to);
 * - `sections` naming a section the mission lacks, giving only some of them, or giving them without a `briefing` that equals them
 *   joined with one space (`validate_briefing.mjs`'s own rule, which the deploy screen falls back on).
 *
 * `missions` is a `Map` from mission id to its parsed JSON, the same shape `validate_data.mjs`'s own
 * sweep builds.
 */
export function overlayFailures(file, overlay, missions) {
  const out = [];
  for (const [missionId, o] of Object.entries(overlay ?? {})) {
    const mission = missions.get(missionId);
    if (!mission) {
      out.push(`${file}: overlay names mission "${missionId}", which is not a mission in data/missions`);
      continue;
    }
    const at = `${file}: mission "${missionId}"`;
    if (!isRecord(o)) {
      out.push(`${at} overlay is not an object`);
      continue;
    }
    for (const key of Object.keys(o)) {
      if (!OVERLAY_ENTRY_KEYS.has(key)) out.push(`${at} overlay carries "${key}", which the overlay does not read`);
    }
    const text = (what, v, max) => {
      if (!isText(v)) out.push(`${at} overlay ${what} is not a non-empty string`);
      else if (max !== undefined && v.length > max) out.push(`${at} overlay ${what} is ${v.length} characters (max ${max})`);
    };
    for (const key of ['name', 'briefing']) if (o[key] !== undefined) text(key, o[key]);
    for (const [key, max] of [['dispatch', MAX_DISPATCH], ['aftermath', MAX_AFTERMATH], ['hostages_place', MAX_HOSTAGES_PLACE]]) {
      if (o[key] === undefined) continue;
      if (typeof mission[key] !== 'string') out.push(`${at} overlay translates ${key}, which the mission does not have`);
      text(key, o[key], max);
    }
    // objectives and trigger labels, as before
    const objectiveIds = new Set((mission.objectives ?? []).map((ob) => ob.id));
    for (const [obId, v] of Object.entries(o.objectives ?? {})) {
      if (!objectiveIds.has(obId)) {
        out.push(`${at} overlay names objective "${obId}", which is not an objective on that mission`);
      } else text(`objective "${obId}"`, v);
    }
    const triggerIds = new Set((mission.triggers ?? []).map((t) => t.id).filter((id) => id !== undefined));
    for (const [trId, trLabel] of Object.entries(o.triggers ?? {})) {
      if (!triggerIds.has(trId)) {
        out.push(`${at} overlay names trigger "${trId}", which is not a trigger on that mission`);
        continue;
      }
      if (typeof trLabel === 'string' && trLabel.length > MAX_TRIGGER_LABEL) {
        out.push(`${at} trigger "${trId}" overlay label is ${trLabel.length} characters (max ${MAX_TRIGGER_LABEL})`);
      } else if (typeof trLabel !== 'string') text(`trigger "${trId}"`, trLabel);
    }
    // radio lines: each key must name something that HAS a line of that kind
    const sayMap = (key, what, hasLine) => {
      for (const [k, v] of Object.entries(o[key] ?? {})) {
        if (!hasLine(k)) out.push(`${at} overlay ${key} names ${what} "${k}", which has no such line on that mission`);
        else text(`${key} "${k}"`, v, MAX_SAY_LENGTH);
      }
    };
    const objectiveBy = (id) => (mission.objectives ?? []).find((ob) => ob.id === id);
    sayMap('objective_say', 'objective', (k) => objectiveBy(k)?.say !== undefined);
    sayMap('objective_say_on_fail', 'objective', (k) => objectiveBy(k)?.say_on_fail !== undefined);
    sayMap('trigger_say', 'trigger', (k) => (mission.triggers ?? []).some((t) => t.id === k && t.say !== undefined));
    const waves = mission.enemy?.waves ?? [];
    sayMap('wave_say', 'wave index', (k) => /^(0|[1-9]\d*)$/.test(k) && waves[Number(k)]?.say !== undefined);
    // debrief
    if (o.debrief !== undefined) {
      if (!isRecord(o.debrief)) out.push(`${at} overlay debrief is not an object`);
      else {
        for (const [side, v] of Object.entries(o.debrief)) {
          if (side !== 'victory' && side !== 'defeat') out.push(`${at} overlay debrief carries "${side}", which is not victory or defeat`);
          else if (mission.debrief?.[side] === undefined) out.push(`${at} overlay translates the ${side} debrief line, which the mission does not have`);
          else text(`debrief ${side}`, v, MAX_SAY_LENGTH);
        }
      }
    }
    // sections: all of them or none, naming real ones, and joining to the translated briefing
    if (o.sections !== undefined) {
      const have = mission.briefing_sections ?? [];
      if (!isRecord(o.sections)) out.push(`${at} overlay sections is not an object`);
      else if (have.length === 0) out.push(`${at} overlay translates sections, which the mission does not have`);
      else {
        for (const [id, v] of Object.entries(o.sections)) {
          if (!SECTION_IDS.includes(id) || !have.some((sec) => sec.id === id)) out.push(`${at} overlay names section "${id}", which is not a section of that mission`);
          else text(`section "${id}"`, v);
        }
        const missing = have.filter((sec) => o.sections[sec.id] === undefined).map((sec) => sec.id);
        if (missing.length > 0) out.push(`${at} overlay gives some sections but not "${missing.join('", "')}": all or none, or the briefing and its sections stop agreeing`);
        else if (o.briefing === undefined) out.push(`${at} overlay translates the sections but not the briefing: they must join to it`);
        else if (have.map((sec) => o.sections[sec.id]).join(' ') !== o.briefing) {
          out.push(`${at} overlay sections joined with one space do not spell the overlay briefing exactly`);
        }
      }
    }
  }
  return out;
}

/**
 * The English mission-text catalogue (GH-1406 parts 2 and 3): `data/locales/en/missions.json`, GENERATED from `data/missions/*.json`
 * and never authored. It is a translator's template, not an overlay the game loads (`main.ts`'s `loadMissionOverlay` short-circuits
 * `en`): one entry per mission with every string `applyMissionLocale` can replace, so a translator copies the file, translates the
 * values, and sees at once what is missing. Missions are by id, and each entry's fields are in a fixed order with the mission file's own
 * order inside each group, so the output is stable and `locales:en --check` is a plain comparison.
 *
 * Covers exactly what the overlay covers: `name`, `briefing`, the briefing's named `sections`, `dispatch`, `aftermath`,
 * `hostages_place`, the two `debrief` lines' text, an objective's `text`, `say` and `say_on_fail`, a trigger's `label` and `say`, and a
 * wave's `say` (by its index). A radio line's speaker, a section's image and every id stay out: they are not text a translator owns.
 */
export function englishMissionText(mission) {
  const entry = {};
  const put = (key, v) => {
    if (typeof v === 'string') entry[key] = v;
  };
  put('name', mission.name);
  put('briefing', mission.briefing);
  const sections = {};
  for (const sec of mission.briefing_sections ?? []) if (typeof sec.id === 'string' && typeof sec.text === 'string') sections[sec.id] = sec.text;
  if (Object.keys(sections).length > 0) entry.sections = sections;
  put('dispatch', mission.dispatch);
  put('aftermath', mission.aftermath);
  put('hostages_place', mission.hostages_place);
  const debrief = {};
  for (const side of ['victory', 'defeat']) if (typeof mission.debrief?.[side]?.text === 'string') debrief[side] = mission.debrief[side].text;
  if (Object.keys(debrief).length > 0) entry.debrief = debrief;
  const group = (key, items, id, pick) => {
    const g = {};
    for (const it of items) {
      const k = id(it);
      const v = pick(it);
      if (typeof k === 'string' && typeof v === 'string') g[k] = v;
    }
    if (Object.keys(g).length > 0) entry[key] = g;
  };
  const objectives = mission.objectives ?? [];
  const triggers = mission.triggers ?? [];
  group('objectives', objectives, (o) => o.id, (o) => o.text);
  group('objective_say', objectives, (o) => o.id, (o) => o.say?.text);
  group('objective_say_on_fail', objectives, (o) => o.id, (o) => o.say_on_fail?.text);
  group('triggers', triggers, (t) => t.id, (t) => t.label);
  group('trigger_say', triggers, (t) => t.id, (t) => t.say?.text);
  const g = {};
  (mission.enemy?.waves ?? []).forEach((w, i) => {
    if (typeof w.say?.text === 'string') g[String(i)] = w.say.text;
  });
  if (Object.keys(g).length > 0) entry.wave_say = g;
  return entry;
}

/** The whole catalogue for a list of missions: ids sorted, each through `englishMissionText`. */
export function buildEnglishCatalogue(missions) {
  const out = {};
  for (const m of [...missions].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) out[m.id] = englishMissionText(m);
  return out;
}

/**
 * Checks `data/locales/en/missions.json` against the missions it was generated from: an entry for every mission, every string present and
 * equal to the source, nothing left over (a deleted mission, a renamed objective, a removed trigger or line). `catalogue` may be null
 * or not an object (a missing or unreadable file), which is one failure and not a pass.
 */
export function englishCatalogueFailures(file, catalogue, missions) {
  if (catalogue === null || typeof catalogue !== 'object' || Array.isArray(catalogue)) {
    return [`${file}: is missing or is not a JSON object -- run \`pnpm locales:en\``];
  }
  const out = [];
  const want = buildEnglishCatalogue(missions);
  for (const id of Object.keys(catalogue)) {
    if (!(id in want)) out.push(`${file}: has an entry for "${id}", which is not a mission in data/missions (stale)`);
  }
  for (const [id, w] of Object.entries(want)) {
    const have = catalogue[id];
    if (have === undefined) {
      out.push(`${file}: no entry for mission "${id}"`);
      continue;
    }
    const at = `${file}: mission "${id}"`;
    for (const key of Object.keys(have)) if (!OVERLAY_ENTRY_KEYS.has(key)) out.push(`${at} carries "${key}", which the overlay does not read`);
    for (const key of OVERLAY_ENTRY_KEYS) {
      const wantV = w[key];
      const haveV = have[key];
      if (typeof wantV === 'string' || (typeof haveV === 'string' && wantV === undefined)) {
        if (wantV !== haveV) out.push(`${at} ${key} ${haveV === undefined ? 'is missing' : wantV === undefined ? 'is not in the mission file (stale)' : 'differs from the mission file'}`);
        continue;
      }
      const wantG = wantV ?? {};
      const haveG = haveV ?? {};
      for (const [k, text] of Object.entries(wantG)) {
        if (haveG[k] === undefined) out.push(`${at} ${key} "${k}" is missing`);
        else if (haveG[k] !== text) out.push(`${at} ${key} "${k}" differs from the mission file`);
      }
      for (const k of Object.keys(haveG)) if (!(k in wantG)) out.push(`${at} ${key} "${k}" is not in the mission file (stale)`);
    }
  }
  return out;
}

/**
 * The English mission-text catalogue (GH-1406 part 2): `data/locales/en/missions.json`, GENERATED from `data/missions/*.json` and never
 * authored. It is a translator's template, not an overlay the game loads (`main.ts`'s `loadMissionOverlay` short-circuits `en`): one
 * entry per mission with every string `applyMissionLocale` can replace, so a translator copies the file, translates the values, and sees
 * at once what is missing. Order is the mission file's own (objectives and triggers in file order), missions by id, so the output is
 * stable and `locales:en --check` is a plain comparison.
 *
 * Covers exactly what the overlay covers: `name`, `briefing`, an objective's `text`, a trigger's `label`. Not `dispatch`, `aftermath`,
 * `debrief`, a `say`, `hostages_place` or `briefing_sections`: `applyMissionLocale` does not replace them, so a template row for one
 * would be a promise the loader does not keep.
 */
export function englishMissionText(mission) {
  const entry = {};
  if (typeof mission.name === 'string') entry.name = mission.name;
  if (typeof mission.briefing === 'string') entry.briefing = mission.briefing;
  const objectives = {};
  for (const ob of mission.objectives ?? []) if (typeof ob.id === 'string' && typeof ob.text === 'string') objectives[ob.id] = ob.text;
  if (Object.keys(objectives).length > 0) entry.objectives = objectives;
  const triggers = {};
  for (const t of mission.triggers ?? []) if (typeof t.id === 'string' && typeof t.label === 'string') triggers[t.id] = t.label;
  if (Object.keys(triggers).length > 0) entry.triggers = triggers;
  return entry;
}

/** The whole catalogue for a list of missions: ids sorted, each through `englishMissionText`. */
export function buildEnglishCatalogue(missions) {
  const out = {};
  for (const m of [...missions].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) out[m.id] = englishMissionText(m);
  return out;
}

/**
 * Checks `data/locales/en/missions.json` against the missions it was generated from: an entry for every mission, every string present and
 * equal to the source, nothing left over (a deleted mission, a renamed objective, a removed trigger). `catalogue` may be null or not an
 * object (a missing or unreadable file), which is one failure and not a pass.
 */
export function englishCatalogueFailures(file, catalogue, missions) {
  if (catalogue === null || typeof catalogue !== 'object' || Array.isArray(catalogue)) {
    return [`${file}: is missing or is not a JSON object -- run \`pnpm locales:en\``];
  }
  const out = [];
  const want = buildEnglishCatalogue(missions);
  for (const id of Object.keys(catalogue)) {
    if (!(id in want)) out.push(`${file}: has an entry for "${id}", which is not a mission in data/missions (stale)`);
  }
  for (const [id, w] of Object.entries(want)) {
    const have = catalogue[id];
    if (have === undefined) {
      out.push(`${file}: no entry for mission "${id}"`);
      continue;
    }
    for (const key of ['name', 'briefing']) {
      if (w[key] !== have[key]) out.push(`${file}: mission "${id}" ${key} ${have[key] === undefined ? 'is missing' : 'differs from the mission file'}`);
    }
    for (const group of ['objectives', 'triggers']) {
      const wantG = w[group] ?? {};
      const haveG = have[group] ?? {};
      for (const [k, text] of Object.entries(wantG)) {
        if (haveG[k] === undefined) out.push(`${file}: mission "${id}" ${group} "${k}" is missing`);
        else if (haveG[k] !== text) out.push(`${file}: mission "${id}" ${group} "${k}" differs from the mission file`);
      }
      for (const k of Object.keys(haveG)) if (!(k in wantG)) out.push(`${file}: mission "${id}" ${group} "${k}" is not in the mission file (stale)`);
    }
    for (const k of Object.keys(have)) if (!['name', 'briefing', 'objectives', 'triggers'].includes(k)) out.push(`${file}: mission "${id}" carries "${k}", which the overlay does not read`);
  }
  return out;
}

/**
 * Cross-checks one unit-text locale overlay (`data/locales/<lang>/units.json`, `@lions/data`'s `UnitLocaleOverlay` shape) against the real
 * units: every id it names must be a unit in data/units, it may carry only `name` and `blurb`, and both must be non-empty strings.
 * `applyUnitLocale` silently no-ops an unknown id at runtime, so a translator's typo would otherwise ship invisibly, doing nothing, forever.
 * `unitIds` is a Set of the shipped unit ids.
 */
export function unitOverlayFailures(file, overlay, unitIds) {
  const out = [];
  for (const [unitId, o] of Object.entries(overlay ?? {})) {
    if (!unitIds.has(unitId)) {
      out.push(`${file}: overlay names unit "${unitId}", which is not a unit in data/units`);
      continue;
    }
    for (const [k, v] of Object.entries(o ?? {})) {
      if (k !== 'name' && k !== 'blurb') {
        out.push(`${file}: unit "${unitId}" overlay carries "${k}"; a unit overlay may carry only name and blurb`);
      } else if (typeof v !== 'string' || v.trim() === '') {
        out.push(`${file}: unit "${unitId}" overlay ${k} must be a non-empty string`);
      }
    }
  }
  return out;
}
