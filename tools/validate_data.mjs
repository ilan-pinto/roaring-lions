#!/usr/bin/env node
// Roaring Lions — content gate: JSON Schema check on all data-driven content.
//
//     pnpm validate:data
//
// Validates:
//   data/units/**    against data/schemas/unit.schema.json
//   data/missions/** against data/schemas/mission.schema.json
//   data/vfx/**      against data/schemas/vfx_emitter.schema.json
//   data/maps/**     against data/schemas/map.schema.json, plus grid
//                    dimensions and marker/zone bounds
//   data/tutorial/** against data/schemas/tutorial.schema.json
//   tools/fixtures/units/** against the unit schema (synthetic, but must parse)
//   data/palette.json structural sanity (32 locked colours)
//   every vfx palette_ref resolves to a real palette key — raw hex is how
//   one contributor quietly breaks the contrast rule for the whole game.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import AjvModule from 'ajv/dist/2020.js';

const Ajv2020 = AjvModule.default ?? AjvModule;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Roles whose entire purpose is carrying infantry. One of these without
 *  hull.transport_slots is a unit that cannot do the job it is named for. */
const CARRIER_ROLES = new Set(['apc', 'ifv']);
// Mirrors FOOT_ROLES in packages/sim/src/sim.ts, which is what `can_embark`
// defaults from. Duplicated because the gate is plain node with no build step and
// cannot import from the sim package; if the sim's list changes, this must too,
// and the `passengers` check below is what would start disagreeing.
const FOOT_ROLES = new Set(['infantry', 'at_team', 'artillery', 'engineer', 'sniper', 'support']);
// Mirrors PROTECTED_ROE in packages/sim/src/structures.ts — the roe_penalty
// threshold at or above which a demolisher will not level a structure on its
// own initiative. Duplicated for the same reason FOOT_ROLES is: this is plain
// node with no build step and cannot import from the sim package.
const PROTECTED_ROE = 20;

const ajv = new Ajv2020({ allErrors: true, strict: false });

const failures = [];

function loadJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    failures.push(`${rel(path)}: unparseable JSON — ${err.message}`);
    return null;
  }
}

function rel(p) {
  return relative(ROOT, p);
}

function jsonFilesIn(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith('.json')) {
      out.push(join(entry.parentPath, entry.name));
    }
  }
  return out.sort();
}

function validateDir(dir, validate, schemaName) {
  const files = jsonFilesIn(dir);
  for (const file of files) {
    const doc = loadJson(file);
    if (doc === null) continue;
    if (!validate(doc)) {
      for (const err of validate.errors ?? []) {
        failures.push(`${rel(file)}: ${err.instancePath || '/'} ${err.message} [${schemaName}]`);
      }
    }
  }
  return files.length;
}

function validateFile(file, validate, schemaName) {
  if (!existsSync(file)) {
    failures.push(`${rel(file)}: missing [${schemaName}]`);
    return 0;
  }
  const doc = loadJson(file);
  if (doc !== null && !validate(doc)) {
    for (const err of validate.errors ?? []) {
      failures.push(`${rel(file)}: ${err.instancePath || '/'} ${err.message} [${schemaName}]`);
    }
  }
  return 1;
}

// --- schema validation ------------------------------------------------------
const schemas = {
  unit: loadJson(join(ROOT, 'data/schemas/unit.schema.json')),
  mission: loadJson(join(ROOT, 'data/schemas/mission.schema.json')),
  vfx: loadJson(join(ROOT, 'data/schemas/vfx_emitter.schema.json')),
  map: loadJson(join(ROOT, 'data/schemas/map.schema.json')),
  tutorial: loadJson(join(ROOT, 'data/schemas/tutorial.schema.json')),
  world: loadJson(join(ROOT, 'data/schemas/world.schema.json')),
  countries: loadJson(join(ROOT, 'data/schemas/countries.schema.json')),
};

let checked = 0;
if (schemas.unit && schemas.mission && schemas.vfx && schemas.map && schemas.tutorial && schemas.world && schemas.countries) {
  const validators = {
    unit: ajv.compile(schemas.unit),
    mission: ajv.compile(schemas.mission),
    vfx: ajv.compile(schemas.vfx),
    map: ajv.compile(schemas.map),
    tutorial: ajv.compile(schemas.tutorial),
    world: ajv.compile(schemas.world),
    countries: ajv.compile(schemas.countries),
  };
  checked += validateDir(join(ROOT, 'data/units'), validators.unit, 'unit.schema');
  checked += validateDir(join(ROOT, 'data/missions'), validators.mission, 'mission.schema');
  checked += validateDir(join(ROOT, 'data/vfx'), validators.vfx, 'vfx_emitter.schema');
  checked += validateDir(join(ROOT, 'data/maps'), validators.map, 'map.schema');
  checked += validateDir(join(ROOT, 'data/tutorial'), validators.tutorial, 'tutorial.schema');
  checked += validateDir(join(ROOT, 'tools/fixtures/units'), validators.unit, 'unit.schema');
  // data/campaign is a mixed directory: world.json is hand-authored, countries.json
  // is generated geometry. Each gets its own schema.
  checked += validateFile(join(ROOT, 'data/campaign/world.json'), validators.world, 'world.schema');
  checked += validateFile(join(ROOT, 'data/campaign/countries.json'), validators.countries, 'countries.schema');
} else {
  failures.push('schema files missing or unparseable — cannot validate content');
}

// Hoisted above the mission cross-check block below, which needs the symbol ->
// structure-type lookup for the `raze` check. The map-symbol block further
// down (data/structures.json sanity, map row legality) also uses these — do
// not re-declare them there.
const structureCatalogue = loadJson(join(ROOT, 'data/structures.json'));
const structureSymbols = new Map(
  Object.entries(structureCatalogue?.types ?? {}).map(([id, spec]) => [spec.symbol, id])
);

// --- mission cross-checks ----------------------------------------------------
// A mission's map.file must be a real map, and its markers/zones/units must
// resolve — a typo here is a broken mission a contributor ships blind.
{
  const mapsById = new Map();
  for (const file of jsonFilesIn(join(ROOT, 'data/maps'))) {
    const m = loadJson(file);
    if (m?.id) mapsById.set(m.id, m);
  }
  const unitIds = new Set();
  const unitsById = new Map();
  for (const file of jsonFilesIn(join(ROOT, 'data/units'))) {
    const u = loadJson(file);
    if (u?.id) {
      unitIds.add(u.id);
      unitsById.set(u.id, u);
    }
    // A carrier that cannot carry is a contradiction the schema cannot see.
    // The sim, the input layer and the unit plate all support transport, so a
    // vehicle whose whole role is carrying infantry but which declares no
    // slots leaves the player pressing `g` at a unit that silently refuses.
    if (u && CARRIER_ROLES.has(u.role) && !(u.hull?.transport_slots > 0)) {
      failures.push(
        `${rel(file)}: role "${u.role}" carries infantry but declares no ` +
          `hull.transport_slots — the player cannot load anyone into it`
      );
    }
  }
  for (const file of jsonFilesIn(join(ROOT, 'data/missions'))) {
    const mi = loadJson(file);
    if (!mi) continue;
    const map = mapsById.get(mi.map?.file);
    if (!map) {
      failures.push(`${rel(file)}: map.file "${mi.map?.file}" is not a map in data/maps`);
      continue;
    }
    const markerNames = new Set(Object.keys(map.markers ?? {}));
    const zoneNames = new Set(Object.keys(map.zones ?? {}));
    const tunnelsById = new Map((map.tunnels ?? []).map((t) => [t.id, t]));
    const hasAbility = (unitId, ability) =>
      (unitsById.get(unitId)?.abilities ?? []).includes(ability);

    // Side-aware placement lists. The walkPlacements sweep further down sees
    // every placement but not whose it is; the tunnel checks need to know who
    // fields what -- burial is enemy/civilian-only, and whether anything can
    // ever dig or charge a route decides whether buried bodies can enter play.
    const flatten = (list, out) => {
      for (const p of list ?? []) {
        out.push(p);
        flatten(p.passengers, out);
      }
    };
    const enemyPlacements = [];
    const playerPlacements = [];
    const civPlacements = [];
    flatten(mi.enemy?.garrison, enemyPlacements);
    for (const w of mi.enemy?.waves ?? []) flatten(w.units, enemyPlacements);
    flatten(mi.starting_force, playerPlacements);
    for (const t of mi.triggers ?? []) {
      if (t.do?.kind === 'spawn') flatten(t.do.units, enemyPlacements);
      if (t.do?.kind === 'reinforce') flatten(t.do.units, playerPlacements);
    }
    flatten(mi.civilians?.groups, civPlacements);

    // Digger assignment has no declarative form -- no schema field, no trigger
    // kind, nothing calls sim.assignDigger from mission data -- so "will this
    // route be dug" cannot be answered per route. What IS visible is whether
    // the mission fields any unit that could ever dig at all; when it fields
    // none and the route is not authored pre_dug, burial is provably a grave.
    const anyoneCanDig = [...enemyPlacements, ...playerPlacements, ...civPlacements].some((p) =>
      hasAbility(p.unit, 'dig_tunnel')
    );

    // Can the player ever field a unit that works a tunnel charge? Fielded
    // units are visible; a mission with an economy (resources + player_start)
    // can also BUILD -- the production bar offers every kdf unit, gated only
    // by campaign unlock state the validator cannot see, so an economy counts
    // as capability rather than false-failing missions a veteran can win.
    let chargeCapable = playerPlacements.some((p) => hasAbility(p.unit, 'tunnel_charge'));
    if (!chargeCapable && mi.resources && mi.map?.player_start) {
      chargeCapable = [...unitsById.values()].some(
        (u) => u.faction === 'kdf' && (u.abilities ?? []).includes('tunnel_charge')
      );
    }

    // Player-side burial is refused outright. starting_force's inline schema
    // already rejects the key; reinforce triggers use the shared placement
    // $def, so this is the check that closes the other player-side spawn path.
    // A buried player unit can never be ordered or surface, and its living
    // body holds off the wipe-loss check -- an unlosable, unplayable state.
    for (const p of playerPlacements) {
      if (p.in_tunnel !== undefined) {
        failures.push(
          `${rel(file)}: "${p.unit}" is player-side and declares in_tunnel "${p.in_tunnel}" — ` +
            `a buried player unit can never be ordered or surface, and its living body ` +
            `blocks the wipe-loss check`
        );
      }
    }

    // A buried enemy is alive, untargetable, and reachable only by collapsing
    // its route. destroy_all counts it; eliminate_hvt counts it when it carries
    // the objective's tag. Neither objective type can fail, so if the player
    // can never field a charge the mission is unwinnable and unlosable at once
    // -- the same checkEnd trap the raze deadline exists to close, except these
    // types have no deadline mechanism, so the lever has to be authoring-time.
    const buriedEnemy = enemyPlacements.filter((p) => p.in_tunnel !== undefined);
    if (buriedEnemy.length > 0 && !chargeCapable) {
      for (const o of mi.objectives ?? []) {
        if (!o.primary) continue;
        if (o.type === 'destroy_all') {
          failures.push(
            `${rel(file)}: destroy_all "${o.id}" is primary, the enemy fields ` +
              `${buriedEnemy.length} in_tunnel placement(s), and no player unit can work a ` +
              `tunnel charge — buried units count as alive and only a collapse reaches them, ` +
              `so the mission would be unwinnable and unlosable at once`
          );
        }
        if (o.type === 'eliminate_hvt' && buriedEnemy.some((p) => p.tag === o.target)) {
          failures.push(
            `${rel(file)}: eliminate_hvt "${o.id}" targets tag "${o.target}" on an in_tunnel ` +
              `placement, and no player unit can work a tunnel charge — the HVT is alive ` +
              `underground and only a collapse reaches it, so the mission would be ` +
              `unwinnable and unlosable at once`
          );
        }
      }
    }
    const wantMarker = (name, where) => {
      if (name && !markerNames.has(name)) failures.push(`${rel(file)}: ${where} references unknown marker "${name}"`);
    };
    const wantUnit = (name, where) => {
      if (name && !unitIds.has(name)) failures.push(`${rel(file)}: ${where} references unknown unit "${name}"`);
    };
    for (const p of mi.starting_force ?? []) wantUnit(p.unit, 'starting_force');
    for (const p of mi.enemy?.garrison ?? []) {
      wantUnit(p.unit, 'garrison');
      wantMarker(p.marker, 'garrison');
      // A garrison stance must point at an actual building on this map.
      if (p.stance?.kind === 'garrison') {
        const b = p.stance.building;
        const sym = b && map.rows?.[Math.floor(b[1])]?.[Math.floor(b[0])];
        if (!sym || !'#hawsm'.includes(sym)) {
          failures.push(
            `${rel(file)}: ${p.unit} garrison stance points at (${b?.join(',')}) which is not a building`
          );
        }
      }
    }
    for (const w of mi.enemy?.waves ?? []) {
      wantMarker(w.to, 'wave');
      for (const u of w.units ?? []) {
        wantUnit(u.unit, 'wave');
        wantMarker(u.from, 'wave');
      }
    }
    for (const t of mi.triggers ?? []) {
      wantMarker(t.do?.to, 'trigger');
      if (t.on?.zone && !zoneNames.has(t.on.zone)) {
        failures.push(`${rel(file)}: trigger references unknown zone "${t.on.zone}"`);
      }
      for (const u of t.do?.units ?? []) wantUnit(u.unit, 'trigger spawn');
    }
    for (const o of mi.objectives ?? []) {
      if ((o.type === 'capture' || o.type === 'hold_for') && o.target && !zoneNames.has(o.target)) {
        failures.push(`${rel(file)}: objective "${o.id}" references unknown zone "${o.target}"`);
      }
      // stepDemolition (sim.ts:2914-2919) consults `roePenalty` and `lowProfile` only
      // when a demolisher is picking a target on its own initiative -- `per_tile`
      // appears nowhere in sim.ts. The two are independent booleans in
      // structure.schema.json and only coincide today because `wall` happens to be
      // both, so each is checked here separately rather than merged into one test.
      // `per_tile` is checked too, but for an unrelated reason: it is not a refusal
      // at all, just a click-count trap (every tile is its own structure).
      if (o.type === 'raze') {
        // A primary raze with no deadline is a softlock generator. The only way a
        // player levels an unoccupied building is the `demolish` order, so losing
        // every unit with the ability makes the objective permanently impossible --
        // and with no way to fail it, `checkEnd` reaches no end condition and the
        // mission is unwinnable and unlosable at once. `seconds` gives the runtime
        // something to fail on. A secondary needs none: one that quietly never
        // completes costs the player nothing.
        if (o.primary && o.seconds === undefined) {
          failures.push(
            `${rel(file)}: raze "${o.id}" is primary but declares no "seconds" deadline. ` +
              `Losing every demolisher would make it impossible with no way to fail it, ` +
              `leaving the mission unwinnable and unlosable at once.`
          );
        }
        const rect = map.zones?.[o.target];
        if (!rect) {
          failures.push(
            `${rel(file)}: raze "${o.id}" names zone "${o.target}", which map "${mi.map.file}" does not declare`
          );
        } else {
          const [zx, zy, zw, zh] = rect;
          // Keyed by "typeId:reason" so a type that trips more than one reason (today
          // only `wall`, which is both low_profile and per_tile) gets a message for
          // each reason instead of the first reason found silently winning.
          const bad = new Map();
          for (let y = zy; y < zy + zh; y++) {
            for (let x = zx; x < zx + zw; x++) {
              const sym = map.rows?.[y]?.[x];
              const typeId = structureSymbols.get(sym);
              if (!typeId) continue;
              const spec = structureCatalogue.types[typeId];
              if (spec.low_profile && !bad.has(`${typeId}:low_profile`)) {
                bad.set(
                  `${typeId}:low_profile`,
                  `${rel(file)}: raze "${o.id}" zone "${o.target}" contains "${typeId}" -- low_profile ` +
                    `at (${x},${y}). A demolisher will not level it unattended.`
                );
              }
              if ((spec.roe_penalty ?? 0) >= PROTECTED_ROE && !bad.has(`${typeId}:protected`)) {
                bad.set(
                  `${typeId}:protected`,
                  `${rel(file)}: raze "${o.id}" zone "${o.target}" contains "${typeId}" -- protected ` +
                    `(roe_penalty ${spec.roe_penalty}) at (${x},${y}). A demolisher will not level it unattended.`
                );
              }
              if (spec.per_tile && !bad.has(`${typeId}:per_tile`)) {
                bad.set(
                  `${typeId}:per_tile`,
                  `${rel(file)}: raze "${o.id}" zone "${o.target}" contains "${typeId}" -- per_tile ` +
                    `at (${x},${y}): every tile is its own structure, so this raze zone is N separate ` +
                    `demolish orders, not one.`
                );
              }
            }
          }
          for (const msg of bad.values()) failures.push(msg);
        }
      }
      if (o.type === 'collapse') {
        // A primary collapse needs a deadline for the same reason a primary
        // raze does (see above): the only way a route comes down is a charge
        // worked by a unit with the ability, so losing every such unit makes
        // it permanently impossible -- and with no way to fail it, checkEnd
        // reaches no end condition and the mission is unwinnable and
        // unlosable at once.
        if (o.primary && o.seconds === undefined) {
          failures.push(
            `${rel(file)}: collapse "${o.id}" is primary but declares no "seconds" deadline. ` +
              `Losing every unit that can work a tunnel charge would make it impossible ` +
              `with no way to fail it, leaving the mission unwinnable and unlosable at once.`
          );
        }
        const rect = map.zones?.[o.target];
        if (!rect) {
          failures.push(
            `${rel(file)}: collapse "${o.id}" names zone "${o.target}", which map "${mi.map.file}" does not declare`
          );
        } else {
          const [zx, zy, zw, zh] = rect;
          // Membership is by MOUTH, matching the runtime: a route that merely
          // passes under the zone belongs to someone else's mission.
          const inZone = (map.tunnels ?? []).filter(
            (t) => t.mouth[0] >= zx && t.mouth[0] < zx + zw && t.mouth[1] >= zy && t.mouth[1] < zy + zh
          );
          if (inZone.length === 0) {
            failures.push(
              `${rel(file)}: collapse "${o.id}" zone "${o.target}" contains no tunnel mouths, ` +
                `so it can never complete. The runtime's targets.length guard keeps an empty ` +
                `set from instant-winning, so this would sit active until its deadline fails it.`
            );
          }
        }
      }
    }
    for (const p of mi.civilians?.groups ?? []) {
      wantUnit(p.unit, 'civilians');
      wantMarker(p.marker, 'civilians');
    }
    wantMarker(mi.civilians?.refuge, 'civilians.refuge');
    for (const z of mi.roe?.flagged_zones ?? []) {
      if (!zoneNames.has(z)) failures.push(`${rel(file)}: roe.flagged_zones references unknown zone "${z}"`);
    }

    // Mounted delivery. JSON Schema cannot do any of this: capacity needs the
    // carrier's transport_slots from unit data, and whether a passenger can ride
    // needs its role. Left to runtime these throw mid-mission, which means the
    // failure surfaces in a playtest rather than in CI.
    const declaredGroups = new Set();
    const declaredTags = new Set();
    const walkPlacements = (node, visit) => {
      if (Array.isArray(node)) {
        for (const v of node) walkPlacements(v, visit);
      } else if (node && typeof node === 'object') {
        if (typeof node.unit === 'string') visit(node);
        for (const v of Object.values(node)) walkPlacements(v, visit);
      }
    };
    walkPlacements(mi, (pl) => {
      if (pl.group) declaredGroups.add(pl.group);
      if (pl.tag) declaredTags.add(pl.tag);
      if (pl.in_tunnel !== undefined) {
        const route = tunnelsById.get(pl.in_tunnel);
        if (!route) {
          failures.push(
            `${rel(file)}: placement "${pl.unit}" declares in_tunnel "${pl.in_tunnel}", ` +
              `which map "${mi.map.file}" does not declare`
          );
        }
        // A unit cannot be underground and in a building at once. The runtime
        // does not throw: the command filter silently swallows the garrison
        // walk-in, so the authored intent evaporates without a trace.
        if (pl.stance?.kind === 'garrison') {
          failures.push(
            `${rel(file)}: "${pl.unit}" declares in_tunnel "${pl.in_tunnel}" AND a garrison ` +
              `stance — a unit cannot be underground and garrisoned at once, and the runtime ` +
              `silently drops the stance`
          );
        }
        // A tag on a buried body is intent the runtime must ignore: pre-marked
        // recon carry-over would identify a unit through three metres of earth,
        // and locate/eliminate_hvt would act on a unit nobody can see or reach.
        if (pl.tag !== undefined) {
          failures.push(
            `${rel(file)}: "${pl.unit}" declares in_tunnel "${pl.in_tunnel}" AND tag ` +
              `"${pl.tag}" — a tag on a buried unit is either silently ignored (recon ` +
              `pre-marking) or acts through the earth (locate/eliminate_hvt)`
          );
        }
        // Mirrors the runtime's load-time throw, so it fails in CI instead.
        if (pl.passengers) {
          failures.push(
            `${rel(file)}: "${pl.unit}" declares in_tunnel "${pl.in_tunnel}" AND passengers — ` +
              `a placement is either in_tunnel or loaded, never both`
          );
        }
        // Authored routes start undug with the vent shut, and digger assignment
        // is runtime AI with no declarative form. So unless the route is
        // authored pre_dug or the mission fields something able to dig, these
        // bodies can never surface, never be seen, and never be reached -- not
        // even by a collapse, since an undug route stamps no trail to charge.
        if (route && route.pre_dug !== true && !anyoneCanDig) {
          failures.push(
            `${rel(file)}: "${pl.unit}" is in_tunnel "${pl.in_tunnel}", but the route is not ` +
              `pre_dug and nothing in this mission has the dig_tunnel ability — the bodies ` +
              `can never surface or be reached, so the placement can never enter play`
          );
        }
      }
      if (!pl.passengers) return;
      const carrier = unitsById.get(pl.unit);
      const slots = carrier?.hull?.transport_slots ?? 0;
      let seats = 0;
      for (const q of pl.passengers) {
        seats += q.count ?? 1;
        if (q.passengers) {
          failures.push(
            `${rel(file)}: "${q.unit}" is a passenger and cannot carry passengers itself`
          );
        }
        // Aboard and underground at once: spawnPlacement would bury the body,
        // then embarkAtSpawn would seat it — two containers, one unit.
        if (q.in_tunnel !== undefined) {
          failures.push(
            `${rel(file)}: "${q.unit}" is a passenger and cannot also start in_tunnel ` +
              `"${q.in_tunnel}" — aboard and underground at once`
          );
        }
        const pu = unitsById.get(q.unit);
        if (!pu) continue; // the unknown-unit check above already reports this
        const canEmbark = pu.hull?.can_embark ?? FOOT_ROLES.has(pu.role ?? '');
        if (!canEmbark) {
          failures.push(
            `${rel(file)}: "${q.unit}" (role "${pu.role}") cannot ride in "${pl.unit}" — ` +
              `only dismounted elements embark`
          );
        }
      }
      if (slots === 0) {
        failures.push(
          `${rel(file)}: "${pl.unit}" is given passengers but declares no ` +
            `hull.transport_slots`
        );
      } else if (seats > slots) {
        failures.push(
          `${rel(file)}: "${pl.unit}" carries ${seats} passenger(s) into ${slots} seat(s) — ` +
            `each carrier in a count>1 placement gets the whole load, not a share`
        );
      }
    });
    // A mission that declares it consumes intel but tags nothing is a no-op: the
    // requirement reads a list that can never match anything it spawns. Invisible in
    // play, which is the whole failure the carry-over spine exists to remove.
    const consumesIntel = (mi.ledger?.requires ?? []).includes('intel.marked_positions');
    const producesIntel = (mi.ledger?.produces ?? []).includes('intel.marked_positions');
    if ((consumesIntel || producesIntel) && declaredTags.size === 0) {
      failures.push(
        `${rel(file)}: declares intel.marked_positions in its ledger contract but no ` +
          `placement carries a "tag" — nothing can be marked or matched`
      );
    }

    for (const t of mi.triggers ?? []) {
      const kind = t.do?.kind;
      const name = t.id ?? '(unnamed)';
      // A commit or withdraw_to with no destination is a silent no-op: the
      // runtime only queues the order when `to` is present, so the trigger
      // fires, latches, and moves nobody. Verified in play — the breach's
      // infiltrators sat at their tunnels all mission. Fail here, by name.
      if ((kind === 'commit' || kind === 'withdraw_to') && !t.do.to) {
        failures.push(
          `${rel(file)}: ${kind} trigger "${name}" has no "to" — it would fire and move nobody`
        );
      }
      // Same silent-no-op family: these three act on a group, and a group no
      // placement declares filters to an empty id list at runtime.
      if (kind !== 'commit' && kind !== 'withdraw_to' && kind !== 'dismount') continue;
      if (!t.do.group) {
        failures.push(`${rel(file)}: a ${kind} trigger needs "group"`);
      } else if (!declaredGroups.has(t.do.group)) {
        failures.push(
          `${rel(file)}: ${kind} trigger "${name}" names group "${t.do.group}", which no placement declares`
        );
      }
    }
  }
}

// --- tutorial cross-checks ---------------------------------------------------
// A tutorial step list's `mission` must name a real mission, and every
// focus.marker / focus.zone it points the camera at must exist on that
// mission's map — a typo here is a tutorial step that silently points at
// nothing, same failure shape as the mission->map check above.
{
  const missionsById = new Map();
  for (const file of jsonFilesIn(join(ROOT, 'data/missions'))) {
    const mi = loadJson(file);
    if (mi?.id) missionsById.set(mi.id, mi);
  }
  const mapsById = new Map();
  for (const file of jsonFilesIn(join(ROOT, 'data/maps'))) {
    const m = loadJson(file);
    if (m?.id) mapsById.set(m.id, m);
  }
  for (const file of jsonFilesIn(join(ROOT, 'data/tutorial'))) {
    const tu = loadJson(file);
    if (!tu) continue;
    const mission = missionsById.get(tu.mission);
    if (!mission) {
      failures.push(`${rel(file)}: mission "${tu.mission}" is not a mission in data/missions`);
      continue;
    }
    const map = mapsById.get(mission.map?.file);
    if (!map) continue; // already reported by the mission cross-check above
    const markerNames = new Set(Object.keys(map.markers ?? {}));
    const zoneNames = new Set(Object.keys(map.zones ?? {}));
    for (const step of tu.steps ?? []) {
      const marker = step.focus?.marker;
      if (marker && !markerNames.has(marker)) {
        failures.push(`${rel(file)}: step "${step.id}" focus.marker "${marker}" is not a marker on "${mission.map?.file}"`);
      }
      const zone = step.focus?.zone;
      if (zone && !zoneNames.has(zone)) {
        failures.push(`${rel(file)}: step "${step.id}" focus.zone "${zone}" is not a zone on "${mission.map?.file}"`);
      }
    }
  }
}

// --- the campaign world -----------------------------------------------------
// JSON Schema validates world.json's shape; these four checks are the cross-file
// facts it cannot see. Each one is a failure that would otherwise be invisible:
// a menu entry that starts nothing, a mission nothing can reach, a progression
// that locks itself, or a region with no shape on the map.
{
  const worldPath = join(ROOT, 'data/campaign/world.json');
  const world = loadJson(worldPath);
  if (world) {
    const missionIds = new Set(
      readdirSync(join(ROOT, 'data/missions')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))
    );
    const listed = new Map();          // mission id -> town that lists it
    const regionOrder = [];            // region ids, in campaign order
    for (const region of world.regions) {
      regionOrder.push(region.id);
      for (const town of region.towns) {
        for (const m of town.missions) {
          if (!missionIds.has(m)) {
            failures.push(`data/campaign/world.json: town "${town.id}" lists mission "${m}", which has no file in data/missions/`);
          }
          const already = listed.get(m);
          if (already !== undefined) {
            failures.push(`data/campaign/world.json: mission "${m}" is listed by both "${already}" and "${town.id}" — a mission belongs to exactly one town`);
          }
          listed.set(m, town.id);
        }
      }
    }

    // Every mission must be reachable from the map, or it is unplayable content. The
    // tutorial is the one exception: it is deliberately not on the map, because it
    // teaches the mouse rather than the war.
    const OFF_MAP = new Set(['beit_sahwan_0_tutorial']);
    for (const m of missionIds) {
      if (!listed.has(m) && !OFF_MAP.has(m)) {
        failures.push(`data/missions/${m}.json: no town in world.json lists it, so nothing can start it`);
      }
    }

    // An unlock may name an unauthored mission -- the campaign is authored front to
    // back -- but if that mission exists it must sit in an EARLIER region, or the
    // progression contains a cycle and locks itself permanently.
    for (let i = 0; i < world.regions.length; i++) {
      const after = world.regions[i].unlock?.after_mission;
      if (after === undefined || !listed.has(after)) continue;
      const ownerRegion = world.regions.findIndex((r) => r.towns.some((t) => t.missions.includes(after)));
      if (ownerRegion >= i) {
        failures.push(
          `data/campaign/world.json: region "${world.regions[i].id}" unlocks after "${after}", which is in ` +
            `"${world.regions[ownerRegion].id}" — that region is not earlier, so the progression cannot advance`
        );
      }
    }

    // The art must exist, every region must have a country shape in the generated
    // geometry, and every town must actually sit INSIDE its region's country --
    // a containment check the old SVG art could not express. A town outside its
    // outline hovers the wrong ground and glows the wrong border.
    const artPath = join(ROOT, 'assets', world.art);
    if (!existsSync(artPath)) {
      failures.push(`data/campaign/world.json: art "${world.art}" not found at assets/${world.art}`);
    }
    const countriesDoc = loadJson(join(ROOT, 'data/campaign/countries.json'));
    if (countriesDoc) {
      const byId = new Map(countriesDoc.countries.map((c) => [c.id, c]));
      const inside = (x, y, poly) => {
        let odd = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const [xi, yi] = poly[i];
          const [xj, yj] = poly[j];
          if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
        }
        return odd;
      };
      if (![...byId.values()].some((c) => c.home)) {
        failures.push('data/campaign/countries.json: no home country');
      }
      for (const region of world.regions) {
        const country = byId.get(region.id);
        if (!country) {
          failures.push(`data/campaign/countries.json: no country with id "${region.id}" for region "${region.name}"`);
          continue;
        }
        for (const town of region.towns) {
          if (!inside(town.at[0], town.at[1], country.outline)) {
            failures.push(
              `data/campaign/world.json: town "${town.id}" at [${town.at}] is outside country "${region.id}"'s outline`
            );
          }
        }
      }
    }
  }
}

// --- map grid + bounds checks (beyond what JSON Schema can express) ---------
//
// Map symbols used to be listed in map.schema.json's row pattern, which meant the
// legal set was hardcoded in three places -- the regex, packages/data/src/map.ts,
// and the `symbol` field in data/structures.json that nothing read. A regex cannot
// know what the catalogue declares, so it silently accepted symbols the loader
// would reject. This cross-checks against the catalogue instead, the same shape of
// check already done below for vfx palette_refs.
//
// Terrain symbols are duplicated here on purpose: they live in map.ts's
// TERRAIN_LEGEND, which is TypeScript this Node script does not load. The two
// lists agreeing is asserted by packages/data/src/map.test.ts.
const TERRAIN_SYMBOLS = new Set(['.', '1', '2', '3', 'r', 'o', 'n']);
for (const [sym, id] of structureSymbols) {
  if (TERRAIN_SYMBOLS.has(sym)) {
    failures.push(
      `data/structures.json: type "${id}" claims symbol "${sym}", which is a terrain symbol`
    );
  }
}
{
  const seen = new Map();
  for (const [id, spec] of Object.entries(structureCatalogue?.types ?? {})) {
    if (seen.has(spec.symbol)) {
      failures.push(
        `data/structures.json: "${id}" and "${seen.get(spec.symbol)}" both claim symbol "${spec.symbol}"`
      );
    }
    seen.set(spec.symbol, id);
  }
}

for (const file of jsonFilesIn(join(ROOT, 'data/maps'))) {
  const m = loadJson(file);
  if (!m) continue;
  if (Array.isArray(m.rows)) {
    const bad = new Map();
    m.rows.forEach((row, y) => {
      if (typeof row !== 'string') return;
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (TERRAIN_SYMBOLS.has(ch) || structureSymbols.has(ch)) continue;
        if (!bad.has(ch)) bad.set(ch, `(${x},${y})`);
      }
    });
    for (const [ch, where] of bad) {
      failures.push(
        `${rel(file)}: unknown symbol "${ch}" first at ${where} — not a terrain symbol ` +
          `(${[...TERRAIN_SYMBOLS].join(' ')}) and not declared in data/structures.json ` +
          `(${[...structureSymbols.keys()].join(' ')})`
      );
    }
  }
  if (Array.isArray(m.rows)) {
    if (m.rows.length !== m.height) {
      failures.push(`${rel(file)}: ${m.rows.length} rows but declared height ${m.height}`);
    }
    m.rows.forEach((row, y) => {
      if (typeof row === 'string' && row.length !== m.width) {
        failures.push(`${rel(file)}: row ${y} has ${row.length} tiles but declared width ${m.width}`);
      }
    });
  }
  for (const [name, pt] of Object.entries(m.markers ?? {})) {
    if (pt[0] >= m.width || pt[1] >= m.height) {
      failures.push(`${rel(file)}: marker "${name}" (${pt[0]},${pt[1]}) out of bounds`);
    }
  }
  for (const [name, z] of Object.entries(m.zones ?? {})) {
    if (z[0] + z[2] > m.width || z[1] + z[3] > m.height || z[2] <= 0 || z[3] <= 0) {
      failures.push(`${rel(file)}: zone "${name}" [${z.join(',')}] out of bounds`);
    }
  }
}

// --- palette sanity ---------------------------------------------------------
const palettePath = join(ROOT, 'data/palette.json');
const palette = loadJson(palettePath);
const paletteKeys = new Set();
if (palette) {
  let count = 0;
  for (const [ramp, spec] of Object.entries(palette.ramps ?? {})) {
    (spec.colors ?? []).forEach((_, i) => paletteKeys.add(`${ramp}.${i}`));
    count += (spec.colors ?? []).length;
  }
  for (const [band, spec] of Object.entries(palette.reserved ?? {})) {
    Object.keys(spec.colors ?? {}).forEach((name) => paletteKeys.add(`${band}.${name}`));
    count += Object.keys(spec.colors ?? {}).length;
  }
  if (count !== palette.total_colors) {
    failures.push(
      `${rel(palettePath)}: declares total_colors=${palette.total_colors} but defines ${count}`
    );
  }
  checked += 1;
}

// --- vfx palette_ref cross-check -------------------------------------------
function collectPaletteRefs(node, path, out) {
  if (typeof node === 'string') {
    if (/^[a-z_]+\.[a-z0-9_]+$/.test(node)) out.push({ ref: node, path });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => collectPaletteRefs(v, `${path}[${i}]`, out));
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'color' || k === 'color_over_life') collectPaletteRefs(v, `${path}.${k}`, out);
      else if (typeof v === 'object') collectPaletteRefs(v, `${path}.${k}`, out);
    }
  }
}

if (palette) {
  for (const file of jsonFilesIn(join(ROOT, 'data/vfx'))) {
    const doc = loadJson(file);
    if (!doc) continue;
    const refs = [];
    collectPaletteRefs(doc, '', refs);
    for (const { ref, path } of refs) {
      if (!paletteKeys.has(ref)) {
        failures.push(`${rel(file)}: ${path} references unknown palette key "${ref}"`);
      }
    }
  }
}

// --- verdict ----------------------------------------------------------------
if (failures.length > 0) {
  console.error(`\nDATA GATE FAILED — ${failures.length} issue(s):\n`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`data gate passed: ${checked} file(s) validated, palette keys resolved`);
