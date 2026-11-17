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

import { createHash } from 'node:crypto';

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
  // GH-1406 part 5: the stale-translation guard. Not text: `{ "<path of a translated string>": "<8 hex of the English it was translated from>" }`.
  'src',
]);
/** The keys of an entry that hold text (everything but `src`); a flat string, or a group of strings keyed by id, section, side or wave index. */
const TEXT_ENTRY_KEYS = [...OVERLAY_ENTRY_KEYS].filter((k) => k !== 'src');

/**
 * The source hash of one English string (GH-1406 part 5): the first 8 hex characters of its SHA-256, over the exact UTF-8 bytes, no
 * trimming. 32 bits is a stale-text tripwire, not a signature: it asks "did this string change since it was translated", and an edit
 * that leaves the hash alone is a 1 in 4.3 billion chance per edit.
 */
export function sourceHash(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 8);
}

/** Every string of one entry by its path (`name`, `debrief.victory`, `wave_say.0`, `objectives.<id>`), as a Map in file order. Strings only. */
export function entryPaths(entry) {
  const out = new Map();
  for (const key of TEXT_ENTRY_KEYS) {
    const v = entry?.[key];
    if (typeof v === 'string') out.set(key, v);
    else if (isRecord(v)) for (const [k, t] of Object.entries(v)) if (typeof t === 'string') out.set(`${key}.${k}`, t);
  }
  return out;
}

/** `{ path: sourceHash }` for every string of an English entry: the `src` block a translator carries over unchanged with a fresh translation. */
export function sourceHashes(englishEntry) {
  const out = {};
  for (const [path, t] of entryPaths(englishEntry)) out[path] = sourceHash(t);
  return out;
}
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
    out.push(...sourceHashFailures(at, o, mission));
  }
  return out;
}

/**
 * The stale-translation guard (GH-1406 part 5). A translation is matched to the mission by KEY (an id, a section, a wave INDEX), and
 * nothing in a key says which English sentence the translator read. So a wave list reordered, a wave inserted, or a line reworded
 * leaves every key valid and the overlay shows the player the wrong sentence, silently. Every translated string therefore carries, in the
 * entry's `src` block, the hash of the English it was translated from (`sourceHash`), and this fails when that is absent or no longer
 * the mission's current English. Strings with no English source on the mission (an objective with no `text` in a bare test fixture)
 * have nothing to be stale against and need no hash; `src` may name only paths the entry translates.
 */
function sourceHashFailures(at, o, mission) {
  const out = [];
  if (o.src !== undefined && !isRecord(o.src)) return [`${at} overlay src is not an object`];
  const src = o.src ?? {};
  const translated = new Map([...entryPaths(o)].filter(([, t]) => isText(t)));
  const english = sourceHashes(englishMissionText(mission));
  for (const path of translated.keys()) {
    const want = english[path];
    if (want === undefined) continue;
    const have = src[path];
    if (have === undefined) {
      out.push(`${at} overlay translates "${path}" but carries no src hash for it: copy src "${path}" (${want}) from data/locales/en/missions.json`);
    } else if (have !== want) {
      out.push(`${at} overlay "${path}" is stale: it was translated from English ${have}, and the English is now ${want}; re-translate it, then set src "${path}" to ${want}`);
    }
  }
  for (const [path, h] of Object.entries(src)) {
    if (!translated.has(path)) out.push(`${at} overlay src names "${path}", which this entry does not translate`);
    else if (typeof h !== 'string' || !/^[0-9a-f]{8}$/.test(h)) out.push(`${at} overlay src "${path}" is not 8 lowercase hex characters`);
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

/** The whole catalogue for a list of missions: ids sorted, each through `englishMissionText`, plus its `src` block (GH-1406 part 5) as the
 *  last key, so a translator who copies the file and translates the values carries the hashes of the English they read. */
export function buildEnglishCatalogue(missions) {
  const out = {};
  for (const m of [...missions].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const text = englishMissionText(m);
    out[m.id] = { ...text, src: sourceHashes(text) };
  }
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
 * Cross-checks one unit-text locale overlay (`data/locales/<lang>/units.json`, `@lions/data`'s `UnitLocaleOverlay` shape) against the real
 * units: every id it names must be a unit in data/units, it may carry only `name`, `blurb` and the `src` hash block, and each text must be
 * a non-empty string. `applyUnitLocale` silently no-ops an unknown id at runtime, so a translator's typo would otherwise ship invisibly,
 * doing nothing, forever.
 *
 * GH-1406 part 5, the stale-translation guard: a translated `name` or `blurb` must carry `src.name` / `src.blurb`, the `sourceHash` of the
 * unit's English text, and it fails when that is absent or the English has since been edited. A `blurb` for a unit that has none is a
 * failure too (`applyUnitLocale` drops it). `units` is a Map from unit id to its parsed JSON.
 */
export function unitOverlayFailures(file, overlay, units) {
  const out = [];
  for (const [unitId, o] of Object.entries(overlay ?? {})) {
    const unit = units.get(unitId);
    if (unit === undefined) {
      out.push(`${file}: overlay names unit "${unitId}", which is not a unit in data/units`);
      continue;
    }
    const at = `${file}: unit "${unitId}"`;
    for (const [k, v] of Object.entries(o ?? {})) {
      if (k === 'src') continue;
      if (k !== 'name' && k !== 'blurb') {
        out.push(`${at} overlay carries "${k}"; a unit overlay may carry only name, blurb and src`);
      } else if (typeof v !== 'string' || v.trim() === '') {
        out.push(`${at} overlay ${k} must be a non-empty string`);
      } else if (typeof unit[k] !== 'string') {
        out.push(`${at} overlay translates ${k}, which the unit does not have`);
      }
    }
    const srcAt = o?.src;
    if (srcAt !== undefined && !isRecord(srcAt)) {
      out.push(`${at} overlay src is not an object`);
      continue;
    }
    const src = srcAt ?? {};
    for (const k of ['name', 'blurb']) {
      if (!isText(o?.[k]) || typeof unit[k] !== 'string') continue;
      const want = sourceHash(unit[k]);
      if (src[k] === undefined) out.push(`${at} overlay translates ${k} but carries no src hash for it: copy src.${k} (${want}) from data/locales/en/units.json`);
      else if (src[k] !== want) out.push(`${at} overlay ${k} is stale: it was translated from English ${src[k]}, and the English is now ${want}; re-translate it, then set src.${k} to ${want}`);
    }
    for (const [k, h] of Object.entries(src)) {
      if (k !== 'name' && k !== 'blurb') out.push(`${at} overlay src carries "${k}"; it may carry only name and blurb`);
      else if (typeof o?.[k] !== 'string') out.push(`${at} overlay src names ${k}, which this entry does not translate`);
      else if (typeof h !== 'string' || !/^[0-9a-f]{8}$/.test(h)) out.push(`${at} overlay src.${k} is not 8 lowercase hex characters`);
    }
  }
  return out;
}

/**
 * The English unit-text catalogue (GH-1406 part 5): `data/locales/en/units.json`, GENERATED from `data/units/**` like the mission one and
 * never authored or fetched. Per unit (ids sorted): its `name`, its `blurb` when it has one, and `src`, the hash of each, so a translator
 * who copies the file and translates the values carries the hashes of the English they read.
 */
export function buildEnglishUnits(units) {
  const out = {};
  for (const u of [...units].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const e = {};
    const src = {};
    for (const k of ['name', 'blurb']) {
      if (typeof u[k] === 'string') {
        e[k] = u[k];
        src[k] = sourceHash(u[k]);
      }
    }
    out[u.id] = { ...e, src };
  }
  return out;
}

/** Checks `data/locales/en/units.json` against the units it was generated from: an entry per unit, every text and hash equal, nothing left over. */
export function englishUnitFailures(file, catalogue, units) {
  if (!isRecord(catalogue)) return [`${file}: is missing or is not a JSON object -- run \`pnpm locales:en -- --write\``];
  const out = [];
  const want = buildEnglishUnits(units);
  for (const id of Object.keys(catalogue)) if (!(id in want)) out.push(`${file}: has an entry for "${id}", which is not a unit in data/units (stale)`);
  for (const [id, w] of Object.entries(want)) {
    const have = catalogue[id];
    if (!isRecord(have)) {
      out.push(`${file}: no entry for unit "${id}"`);
      continue;
    }
    for (const k of ['name', 'blurb']) {
      if (have[k] !== w[k]) out.push(`${file}: unit "${id}" ${k} ${have[k] === undefined ? 'is missing' : w[k] === undefined ? 'is not in the unit file (stale)' : 'differs from the unit file'}`);
      if (have.src?.[k] !== w.src[k]) out.push(`${file}: unit "${id}" src.${k} is ${have.src?.[k] === undefined ? 'missing' : 'not the hash of the unit file'}`);
    }
    for (const k of Object.keys(have)) if (k !== 'name' && k !== 'blurb' && k !== 'src') out.push(`${file}: unit "${id}" carries "${k}", which the overlay does not read`);
  }
  return out;
}
