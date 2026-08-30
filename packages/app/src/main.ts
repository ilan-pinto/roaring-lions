// @lions/app — shell. Composes sim + render + data.
// Two modes: the M0 sandbox (default) and mission mode
// (?mission=<id>), where a MissionRuntime interprets declarative mission
// JSON. The app owns the real-time loop: the sim ticks at a fixed 20 Hz from
// an accumulator; the renderer interpolates between ticks (invariant 1).

import {
  Sim,
  fx,
  TICKS_PER_SECOND,
  MissionRuntime,
  zoneContains,
  type LedgerData,
  type MissionEvent,
  type MissionJson,
  type TunnelRouteJson,
} from '@lions/sim';
// PixiRenderer is deliberately NOT imported here (see the dynamic import
// below, and `@lions/render/pixi`'s own comment): a static import of it,
// even alongside pixi-free names like DebugOverlay/TERRAIN_DECOR below,
// pulls pixi.js into this file's module graph and back into the main chunk
// for every player -- the same shape ThreeRenderer's own static-import ban
// (eslint, `@lions/render/three`) already guards against.
import {
  DebugOverlay,
  BattleAudio,
  TERRAIN_DECOR,
  type RendererOptions,
  type AudioManifest,
  type EmitterSpec,
  type Renderer,
} from '@lions/render';
import {
  units,
  maps,
  missions,
  tutorials,
  world,
  countries,
  structures as structureCatalogue,
  parseMap,
  applyTerrain,
  DECOR,
  paletteColor,
  audioManifest,
  vfxEmitters,
  type MapJson,
} from '@lions/data';
import { TERRAIN_THEMES } from './terrain-themes';
import './ui/theme.css';
import { Hud, type MissionView, type Tone } from './ui/hud';
import { showMenu, showCampaign, showEndScreen } from './ui/menu';
import { showLoading } from './ui/loading';
import { ProductionBar } from './ui/production';
import {
  applyIntent,
  resolvePointer,
  resolveKeyVerb,
  type PlayerIntent,
  type IntentWorld,
} from './input/intents';
import { cursorFor, cursorKey, badgeFor, type BadgeHints } from './input/cursor';
import { roleBucket } from './ui/role';
import { roeNotice } from './ui/roe-notice';
import { sandboxAnchors, type SandboxAnchors } from './sandbox-anchors';
import { sandboxFlaggedZones, sandboxTunnelRoute } from './sandbox-extras';
import { readFlags, sandboxHelp, unknownParams } from './sandbox-help';
import { resolveRendererChoice, RENDERER_STORAGE_KEY } from './renderer-choice';
import { initTutorial, advance, type TutorialState, type StepJson } from './tutorial/runtime';
import { tutorialPanel, type TutorialPanel } from './tutorial/panel';
import { parseWorld, parseCountries, nextMissionAfter } from './campaign';

/** Deploy base ('/' locally, '/<repo>/' on GitHub Pages) — every asset URL
 *  is built from it so the same bundle works in both places. */
const BASE = import.meta.env.BASE_URL;

const MS_PER_TICK = 1000 / TICKS_PER_SECOND;

// Campaign persistence: victories merge their produced ledger keys here;
// defeats write nothing — replaying a mission for a better ledger is free.
const LEDGER_KEY = 'lions.campaign.ledger';

/** Whether this human has been through the tutorial — a fact about the person,
 *  not the campaign, so it survives a ledger reset. Clearing your ledger should
 *  not re-teach you right-click. */
const TUTORIAL_DONE_KEY = 'lions.tutorial.done';

function loadLedger(): LedgerData {
  try {
    return JSON.parse(window.localStorage.getItem(LEDGER_KEY) ?? '{}') as LedgerData;
  } catch {
    return {};
  }
}

function saveLedger(ledger: LedgerData): void {
  window.localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
}

function campaignSummary(ledger: LedgerData): string {
  const roster = ledger['roster.surviving_units'];
  const roe = ledger['roe.cumulative_rating'];
  const parts: string[] = [];
  if (Array.isArray(roster) && roster.length > 0) {
    const vets = roster.filter((r) => r.veterancy > 0).length;
    parts.push(`roster ${roster.length}${vets > 0 ? ` (${vets}★)` : ''}`);
  }
  if (typeof roe === 'number') parts.push(`ROE ${roe}`);
  return parts.length > 0 ? `campaign: ${parts.join(' · ')}` : 'campaign: fresh start';
}

/** The task force, as offsets from the friendly anchor. */
const SANDBOX_KDF: readonly (readonly [string, number, number])[] = [
  ['mbt_lavi', 0, -3],
  ['mbt_lavi', 0, 3],
  ['ifv_namer', -1, -7],
  ['ifv_namer', -1, 7],
  ['apc_eitan', -2, 0],
  ['inf_squad', 2, -5],
  ['inf_squad', 2, 0],
  ['inf_squad', 2, 5],
  ['at_team', 1, -2],
  ['mortar_team', -2, 2],
  ['jeep_shoded', 1, 3],
  ['recon_drone', 4, 0],
  // The D9 and the Apache both sit behind the line of contact, for different
  // reasons: the D9 is slow and unarmed, so sending it forward would just feed
  // it to the militia before it has done any work. The Apache is fast enough
  // to reach the front on its own, so holding it back gives the player a beat
  // to notice their most powerful asset before committing it.
  ['dozer_d9', -1, -3],
  ['heli_peten', 2, 8],
];

/** The opposition, as offsets from the hostile anchor. */
const SANDBOX_ENEMY: readonly (readonly [string, number, number])[] = [
  ['militia_cell', -4, -10],
  ['militia_cell', 2, -7],
  ['militia_cell', -2, 3],
  ['militia_cell', -6, 15],
  ['rpg_team', -4, 2],
  ['rpg_team', -12, -3],
  ['atgm_cell', 7, 0],
  ['technical', 11, -8],
  ['technical', 11, 10],
  ['mortar_crew', 13, 2],
  // The raider set. The sandbox is the only place these appear — no mission
  // places them yet — so this is what makes their art reachable in play at
  // all, and what the art was verified against. They sit inside the band
  // rather than beyond it: a hostile draws no sprite until a friendly unit
  // sees its tile, so anything parked past the opposition is invisible for
  // the whole opening, and scouting it with the drone does not work either
  // since the gun truck kills the drone before the fog lifts.
  ['gun_truck', 1, -5],
  ['charge_squad', 0, -2],
  ['loiter_drone', -1, 0],
  ['moto_rpg', -5, 6],
  ['paramotor', 2, 7],
];

/**
 * The sandbox force, placed relative to the map's own anchors.
 *
 * The offsets are the coordinates the hardcoded version used, expressed
 * against beit_sahwan_outskirts' `kdf_assembly` and `town_center` — so that
 * map's sandbox is unchanged, and every other map gets the same formation
 * translated onto its own ground.
 */
/** The Sarim roster, as offsets from the hostile anchor. `atgm_cell` and
 *  `loiter_drone` are already in the base set, so only the four the sandbox
 *  could not otherwise reach are here. No mission fields any of them yet. */
const SANDBOX_SUR: readonly (readonly [string, number, number])[] = [
  ['sarim_rifles', -3, -4],
  ['sarim_rifles', -3, 4],
  ['recoilless_team', 3, -3],
  ['manpad_team', 5, 4],
  ['rocket_battery', 9, 1],
];

/** What `&tunnel` adds to the player's side: something that can find a route,
 *  and something that can bring it down. The base force already carries a
 *  `recon_drone`, which marks tunnels — the yahalom is what makes the charge
 *  cursor reachable at all. */
const SANDBOX_TUNNEL_KDF: readonly (readonly [string, number, number])[] = [
  ['yahalom_squad', 3, -1],
  ['yahalom_squad', 3, 1],
];

function sandboxSpawns(
  sim: Sim,
  typeOf: Map<string, number>,
  anchors: SandboxAnchors,
  extras: { tunnel: boolean; sur: boolean } = { tunnel: false, sur: false }
): void {
  // Terrain the formation knows nothing about: an offset that lands in rock
  // or a wall would strand a unit inside it, and Tel Marum's ridge sits right
  // where the opposition's band falls. Spiral out to the nearest open tile.
  const open = (x: number, y: number): [number, number] => {
    const cx = Math.min(Math.max(Math.round(x), 0), sim.width - 1);
    const cy = Math.min(Math.max(Math.round(y), 0), sim.height - 1);
    for (let r = 0; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = cx + dx;
          const ty = cy + dy;
          if (tx < 0 || ty < 0 || tx >= sim.width || ty >= sim.height) continue;
          if (sim.blocked[ty * sim.width + tx] === 0) return [tx, ty];
        }
      }
    }
    return [cx, cy];
  };

  const spawn = (id: string, side: number, x: number, y: number, facing = 0): number => {
    const t = typeOf.get(id);
    if (t === undefined) throw new Error(`unknown unit ${id}`);
    const [ox, oy] = open(x, y);
    return sim.spawn(t, side, fx.from(ox + 0.5), fx.from(oy + 0.5), facing);
  };

  const [fxA, fyA] = anchors.friendly;
  const [hxA, hyA] = anchors.hostile;
  // Hostiles face the friendly anchor rather than a fixed compass direction:
  // "west" was right for one map and is meaningless on any other. A full turn
  // is 1.0 in this fixed-point angle (WEST, a half turn, is 32768), so the
  // radians are converted to turns and normalised into [0, 1) before the
  // conversion rather than relying on a negative angle wrapping.
  const turns = Math.atan2(fyA - hyA, fxA - hxA) / (Math.PI * 2);
  const facing = fx.from(turns - Math.floor(turns));

  for (const [id, dx, dy] of SANDBOX_KDF) spawn(id, 0, fxA + dx, fyA + dy);
  if (extras.tunnel) {
    for (const [id, dx, dy] of SANDBOX_TUNNEL_KDF) spawn(id, 0, fxA + dx, fyA + dy);
  }
  for (const [id, dx, dy] of SANDBOX_ENEMY) spawn(id, 1, hxA + dx, hyA + dy, facing);
  if (extras.sur) {
    for (const [id, dx, dy] of SANDBOX_SUR) spawn(id, 1, hxA + dx, hyA + dy, facing);
  }
}

/** Mission narration for the HUD notice stack: what to say, and how it lands. */
function describeMissionEvent(
  e: MissionEvent,
  mission: MissionJson,
  /** Reasons already narrated this mission, so the ROE advice is offered once
   *  rather than every time the zone cooldown expires. Owned by the caller
   *  because `describeMissionEvent` is otherwise a pure translation. */
  narratedRoeReasons: Set<string> = new Set()
): [string, Tone] | null {
  switch (e.kind) {
    case 'objective': {
      const def = mission.objectives.find((o) => o.id === e.id);
      const label = def?.text ?? e.id;
      return e.status === 'complete'
        ? [`<b>OBJECTIVE COMPLETE</b> — ${label}`, 'good']
        : [`<b>OBJECTIVE ${e.status.toUpperCase()}</b> — ${label}`, 'bad'];
    }
    case 'trigger':
      return [`<b>enemy reacts</b> (${e.id})`, 'warn'];
    case 'wave':
      return [`<b>enemy reinforcements</b> — ${e.count} unit(s) inbound`, 'bad'];
    case 'roe': {
      const first = !narratedRoeReasons.has(e.reason);
      narratedRoeReasons.add(e.reason);
      return roeNotice(e.penalty, e.reason, e.score, mission.roe?.fail_below, first);
    }
    case 'built':
      return [`<b>reinforcement deployed</b> — ${e.unit}`, 'info'];
    case 'missionEnd':
      return [
        e.result === 'victory'
          ? `<b>MISSION ACCOMPLISHED</b> — ROE ${e.roeRating}, ${e.survivors.length} units survive`
          : '<b>MISSION FAILED</b>',
        e.result === 'victory' ? 'good' : 'bad',
      ];
    default:
      return null;
  }
}

async function main(): Promise<void> {
  const stage = document.getElementById('stage');
  if (!stage) throw new Error('no #stage');

  // --- mode selection ------------------------------------------------------
  const params = new URLSearchParams(window.location.search);
  if (params.get('fresh') !== null && params.get('mission') === null) {
    window.localStorage.removeItem(LEDGER_KEY);
    // Starting the campaign over restores the lessons with it. Without this
    // the flag is a one-way door: finish the tutorial once and Beit Sahwan 0
    // replays with no step panel at all, which reads as the tutorial being
    // broken rather than already learned.
    window.localStorage.removeItem(TUTORIAL_DONE_KEY);
  }
  if (params.get('mission') === null && params.get('sandbox') === null) {
    const worldData = parseWorld(world);
    if (params.get('campaign') !== null) {
      // The map page. publicDir is the repo-root assets/ dir (vite.config.ts), so
      // the world render is served rather than bundled; the per-country overlay is
      // built by worldMap from the generated geometry in countries.json.
      showCampaign(stage, {
        base: BASE,
        world: worldData,
        countries: parseCountries(countries),
        ledger: loadLedger(),
      });
      return;
    }
    const tutorialDone = window.localStorage.getItem(TUTORIAL_DONE_KEY) !== null;
    showMenu(stage, {
      base: BASE,
      version: __GAME_VERSION__,
      world: worldData,
      tutorial: {
        id: 'beit_sahwan_0_tutorial',
        name: missions.beit_sahwan_0_tutorial.name ?? 'Tutorial',
        done: tutorialDone,
      },
    });
    return;
  }
  const missionId = params.get('mission');
  let mission: MissionJson | undefined;
  if (missionId !== null) {
    mission = (missions as Record<string, MissionJson | undefined>)[missionId];
    if (!mission) {
      console.warn(`unknown mission "${missionId}" — available: ${Object.keys(missions).join(', ')}`);
    }
  }
  const ledger: LedgerData = params.get('fresh') !== null ? {} : loadLedger();

  // --- world ---------------------------------------------------------------
  // `?sandbox=<map id>` walks any shipped map. Bare `?sandbox` keeps loading
  // beit_sahwan_outskirts, so the M0 sandbox is unchanged.
  //
  // This exists because verifying anything visual on a new map used to mean
  // authoring a throwaway mission and deleting it afterwards — Tel Marum's
  // terrain was walked exactly that way. An unknown id falls back rather than
  // failing, and names what it did: a typo in a dev URL should not look like
  // a broken build.
  const sandboxMap = params.get('sandbox');
  if (sandboxMap && !(sandboxMap in maps)) {
    console.warn(
      `unknown sandbox map "${sandboxMap}" — available: ${Object.keys(maps).join(', ')}`
    );
  }
  // Opt-in extras, so the default sandbox stays exactly what it has always
  // been and a check for one subsystem is not buried under three others.
  // Parsed from SANDBOX_FLAGS rather than named here, so the banner below
  // cannot document a different set than this line reads.
  const flags = readFlags(params);
  const wantRoe = flags.roe;
  const wantTunnel = flags.tunnel;
  const wantSur = flags.sur;
  // A misspelled flag (`&tunel`) otherwise does nothing at all, silently,
  // which reads as a broken feature rather than as a typo.
  const strays = unknownParams(params);
  if (strays.length > 0) {
    console.warn(
      `[lions] ignoring unknown URL parameter(s): ${strays.join(', ')} — ` +
        `see __lions.help() for what this build reads`
    );
  }
  const mapId = mission?.map.file ?? (sandboxMap && sandboxMap in maps ? sandboxMap : 'beit_sahwan_outskirts');
  /** The boot banner and the body of `__lions.help()` — one text, so what a
   *  sandbox prints on load and what the console answers can never disagree. */
  const helpText = (): string =>
    sandboxHelp({
      mapId,
      mapIds: Object.keys(maps),
      on: Object.entries(flags)
        .filter(([, on]) => on)
        .map(([name]) => name),
    });
  // Printed only in the sandbox: a mission brings its own zones and tunnels,
  // and none of these flags apply to it.
  if (!mission) console.info(`[lions] ${helpText()}`);
  const mapJson =
    (maps as Record<string, MapJson | undefined>)[mapId] ?? maps.beit_sahwan_outskirts;
  const map = parseMap(mapJson);
  // 256, not 128: `spawn` never reuses a dead unit's slot, so capacity is a
  // budget for everyone who ever draws breath in a mission rather than for how
  // many stand at once. First Light puts 104 attackers, 7 defenders and 11
  // civilians through it before the player buys anything, and running out is a
  // thrown error mid-mission, not a graceful cap.
  const sim = new Sim({ seed: 20260727, width: map.width, height: map.height, capacity: 256 });
  // Cover AND blocked terrain, through the one function all three world
  // builders share. Rock ridges arrive here; before this existed, `map.blocked`
  // was filled by parseMap and read by nobody.
  applyTerrain(map, sim);
  // Buildings are entities, not terrain: each contiguous run of identical
  // symbols becomes one structure with HP, a garrison and rubble.
  const structTypeIdx = new Map<string, number>();
  for (const [id, spec] of Object.entries(structureCatalogue)) {
    structTypeIdx.set(id, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  }
  for (const b of map.structures) {
    const t = structTypeIdx.get(b.type);
    if (t === undefined) throw new Error(`map references unknown structure type ${b.type}`);
    sim.addStructure(t, b.tiles);
  }

  // Tunnels: registered from ONE array in ONE loop, and that same array is
  // what the mission context receives. `ctx.tunnels` is positional — entry r
  // IS the sim's route index — and a count guard alone cannot catch an
  // equal-count permutation, which would silently bury units in the wrong
  // route. Asserting `addTunnel(route) === i` on the single shared array is
  // what makes the positional contract impossible to violate from here.
  const anchors = sandboxAnchors(mapJson);
  // Only ever non-empty in the sandbox: a mission brings its own flagged
  // zones, and mixing the two would let a dev flag quietly change how a
  // real mission scores.
  const sandboxZones: readonly number[][] = !mission && wantRoe
    ? sandboxFlaggedZones(mapJson, anchors)
    : [];

  const tunnelRoutes: TunnelRouteJson[] = map.tunnels.map((t) => ({
    id: t.id,
    points: t.points,
    dig_tiles_per_s: t.digTilesPerS,
    pre_dug: t.preDug,
  }));
  // A synthesised route goes on the END of the array, so every route the map
  // declared keeps its index -- the positional contract asserted below is
  // what stops a unit being buried in the wrong tunnel.
  if (!mission && wantTunnel) {
    const r = sandboxTunnelRoute(mapJson, anchors);
    tunnelRoutes.push({
      id: r.id,
      points: r.points.map((p) => [p[0], p[1]] as [number, number]),
      dig_tiles_per_s: r.dig_tiles_per_s,
      pre_dug: r.pre_dug,
    });
  }
  for (let i = 0; i < tunnelRoutes.length; i++) {
    const got = sim.addTunnel(tunnelRoutes[i]);
    if (got !== i) {
      throw new Error(`tunnel "${tunnelRoutes[i].id}" registered as route ${got}, expected ${i}`);
    }
  }

  const typeOf = new Map<string, number>();
  for (const u of Object.values(units)) typeOf.set(u.id, sim.addUnitType(u));

  // Which ROE reasons have already been narrated, so the advice attached to a
  // protected-zone violation is offered once rather than on every cooldown
  // expiry. One mission, one set — it lives as long as the runtime does.
  const narratedRoeReasons = new Set<string>();
  let runtime: MissionRuntime | null = null;
  if (mission) {
    runtime = new MissionRuntime(sim, mission, {
      typeIdOf: (id) => {
        const t = typeOf.get(id);
        if (t === undefined) throw new Error(`mission references unknown unit ${id}`);
        return t;
      },
      markers: map.markers,
      zones: map.zones,
      tunnels: tunnelRoutes,
      ledger,
      unitInfo: (id) => {
        const u = (units as Record<string, (typeof units)[keyof typeof units] | undefined>)[id];
        if (!u || u.faction !== 'kdf') return null;
        const unlock = 'unlock' in u ? (u.unlock as { roe_rating_min?: number; after_mission?: string }) : undefined;
        return {
          logistics: u.cost.logistics,
          buildTimeS: 'build_time_s' in u.cost ? u.cost.build_time_s : 20,
          unlock: unlock
            ? { roeMin: unlock.roe_rating_min, afterMission: unlock.after_mission }
            : undefined,
        };
      },
    });
    runtime.start();
  } else {
    sandboxSpawns(sim, typeOf, anchors, { tunnel: wantTunnel, sur: wantSur });
  }

  // --- renderer + overlay --------------------------------------------------
  // Terrain tones by theme -- `./terrain-themes` (Task B3.1: was declared here
  // verbatim AND, separately, in `terrain-parity.test.ts`; the parity test
  // could not import this function-local declaration, and this function could
  // not import a test file, so each kept its own copy until both moved to a
  // shared module neither of those constraints applies to).
  const opts: RendererOptions = {
    background: paletteColor('shadow.1'),
    teamColors: [paletteColor('team.kedem'), paletteColor('team.hostile'), paletteColor('team.neutral')],
    hullColors: [paletteColor('olive.1'), paletteColor('dust.2'), paletteColor('limestone.1')],
    infantryColors: [paletteColor('olive.0'), paletteColor('dust.0'), paletteColor('limestone.1')],
    groupColors: [
      paletteColor('group.g1'),
      paletteColor('group.g2'),
      paletteColor('group.g3'),
      paletteColor('group.g4'),
      paletteColor('group.g5'),
      paletteColor('group.g6'),
      paletteColor('group.g7'),
      paletteColor('group.g8'),
      paletteColor('group.g9'),
    ],
    terrainTones: TERRAIN_THEMES[map.terrain],
    tracerColors: [paletteColor('vfx.tracer'), paletteColor('vfx.ember')],
    flashColor: paletteColor('vfx.fire'),
    nearMissColor: paletteColor('dust.0'),
    interceptColor: paletteColor('vfx.interceptor'),
    resolveColor: paletteColor,
  };
  // Three is the default as of Phase D; Pixi remains reachable through
  // `?renderer=pixi`, which `renderer-choice.ts` persists so it survives the
  // navigation links `menu.ts` builds. The annotation is what makes this a
  // real choice: both branches must satisfy `Renderer` or this does not
  // compile.
  //
  // BOTH backends arrive by dynamic import, from their own entry points --
  // this used to be true only of three. A static `import { ThreeRenderer }
  // from '@lions/render'` used in a live ternary is not tree-shakeable, and
  // it once put three.js's whole runtime into the main chunk -- 1,081 kB --
  // for every player who never passed the flag; `@lions/render`'s barrel
  // never named ThreeRenderer to fix that. But `PixiRenderer` stayed a
  // static barrel export, which was invisible while Pixi was the only
  // backend that ever ran eagerly -- once three shipped, that export became
  // the mirror-image bug: importing the barrel AT ALL, on either backend,
  // pulled pixi.js into the main chunk, because a module import cannot
  // partially execute (`renderer.ts`'s own `import 'pixi.js'` runs
  // regardless of which of its exports are used). `PixiRenderer` now has its
  // own entry point too, `@lions/render/pixi` (`pixi.ts`), so which backend
  // a player downloads is symmetric: only the one actually chosen.
  // `?renderer=pixi` and `?renderer=three` are both real, parsed values --
  // not `=== 'three'` with everything else falling through to Pixi, which
  // only ever looked like a working escape hatch because Pixi happens to be
  // the default. An explicit choice is also written to storage, so it
  // survives every `menu.ts` link (they hard-code their own query string
  // and drop this one) and a reload with no `?renderer` at all. See
  // `renderer-choice.ts`.
  const rendererDecision = resolveRendererChoice(
    params.get('renderer'),
    window.localStorage.getItem(RENDERER_STORAGE_KEY)
  );
  if (rendererDecision.persist) {
    window.localStorage.setItem(RENDERER_STORAGE_KEY, rendererDecision.persist);
  }
  let renderer: Renderer;
  if (rendererDecision.choice === 'three') {
    const { ThreeRenderer } = await import('@lions/render/three');
    // Held at its CONCRETE type only inside this branch. `renderer` stays the
    // `Renderer` interface, so `app` still cannot reach a backend-only member
    // anywhere else in this file -- the compiler keeps that, not a grep. But
    // `loadMeshUnit` IS backend-only and always will be (a Pixi billboard has
    // no mesh to load), so the honest place to call it is the one branch that
    // already knows which backend it built.
    const three = new ThreeRenderer(sim, opts);
    renderer = three;
    if (flags.mesh) {
      // Every team with a shipped GLB, paired with the side it fights for.
      // The faction is NOT decorative: `mesh-role.ts` shades `uniform` and
      // `webbing` through inverted ramps per side (KDF grey-over-olive, the
      // militia olive-over-tan), so getting it wrong reads as the wrong ARMY,
      // not a wrong tint.
      //
      // Kept in step with `tools/units/teams.py`'s own `TEAMS` table, which is
      // where the faction is actually decided. Team id and unit type id happen
      // to be the same string for all nine; that is a convention this list
      // relies on, not a guarantee, which is why both appear here as one pair
      // rather than being derived from each other.
      //
      // Only `moto_rpg` has no GLB now -- its vehicle-plus-rider rig is its
      // own slice. A type with no entry here keeps its billboard, which is the
      // whole point of the mesh path being additive.
      // `as const` rather than an imported `MeshFaction` annotation, and that
      // is deliberate: eslint forbids ANY static import from
      // `@lions/render/three` in this package -- including a type-only one --
      // because the rule cannot tell them apart and the bundle regression it
      // guards against is the one that survived undetected longest. `as const`
      // makes these string literals, and `loadMeshUnit`'s own parameter type
      // still rejects a wrong faction at the call site below. So the union is
      // enforced by the compiler without a second copy of it living here and
      // without weakening the guard.
      const MESH_TEAMS = [
        // `inf_squad` is deliberately absent -- it is loaded below from the
        // Meshy asset rather than from `tools/units/teams.py`'s own GLB.
        ['demo_squad', 'kdf'],
        ['at_team', 'kdf'],
        ['mortar_team', 'kdf'],
        ['sniper_team', 'kdf'],
        ['yahalom_squad', 'kdf'],
        ['militia_cell', 'enemy'],
        ['rpg_team', 'enemy'],
        ['atgm_cell', 'enemy'],
        ['mortar_crew', 'enemy'],
        ['charge_squad', 'enemy'],
        ['digger_crew', 'enemy'],
      ] as const;
      // Vite rewrites `new URL(..., import.meta.url)` to a served asset URL, so
      // the GLBs stay in `art/meshes/` rather than being copied into the
      // publicDir. The literal must stay statically analysable -- a fully
      // computed URL is not rewritten and 404s at runtime -- hence the
      // template inside `new URL` rather than a precomputed string.
      //
      // Loaded in parallel, and errors propagate: `loadMeshUnit`'s own doc
      // comment says a missing or malformed GLB fails loudly for this caller
      // to report, and swallowing it would leave the flag looking like it did
      // nothing at all.
      await Promise.all(
        MESH_TEAMS.map(([id, faction]) =>
          three.loadMeshUnit(
            id,
            new URL(`../../../art/meshes/${id}.glb`, import.meta.url).href,
            faction
          )
        )
      );

      // The Meshy-generated (AI, disclosed in this PR) rigged biped, drawing
      // KDF's own rifle squad. It cannot join `MESH_TEAMS` above because that
      // list's "team id == unit type id == file basename" convention does not
      // hold here -- the file is `meshy_soldier.glb`, not `inf_squad.glb` --
      // so `inf_squad` is dropped from the list and loaded explicitly here.
      //
      // This was first wired to enemy-side `sarim_rifles`, reasoning that a
      // Middle-Eastern rifleman was a thematic fit KDF was not. That reasoning
      // was wrong, and the project lead corrected it: the asset was supplied as
      // OUR infantry. Which side an asset fights for is a design call, not one
      // the renderer or a naming heuristic gets to infer.
      //
      // The side is load-bearing for colour, which is what made the error
      // visible. Per `mesh-role.ts`, the two factions are INVERTED rather than
      // tinted: KDF wear an olive `uniform` with gunmetal `webbing`, the enemy
      // tan cloth with olive gear. On the wrong side this figure rendered flat
      // tan and read as an irregular.
      await three.loadMeshUnit(
        'inf_squad',
        new URL('../../../art/meshes/meshy_soldier.glb', import.meta.url).href,
        'kdf'
      );

      // Vehicle meshes (mesh-unit-contract v2): `art/meshes/vehicles/<id>.glb`,
      // no faction parameter -- unlike infantry, a vehicle GLB is
      // faction-specific by construction, so `three.loadVehicleMesh` takes
      // none (`vehicle-mesh-role.ts`'s own top comment has the full
      // argument). Same "team id == unit type id == file basename"
      // convention `MESH_TEAMS` relies on for infantry.
      //
      // `mbt_lavi` matters beyond looks: it is a supplied replacement for
      // the tank whose source `.blend` is missing from the repo and whose
      // sprite sheets are the only two of 35 with no credit -- it cannot
      // retire that old art until it draws here.
      //
      // `ifv_namer` matters the same way: it replaces NAMER_HULL/NAMER_TURR,
      // rendered from a third-party CC BY 3.0 model (`art/src/ifv_dmm08.blend`,
      // "VEHICLE IFV DMM08 by Mutte", BlendSwap #75225) -- the repository's
      // only third-party attribution obligation. That sheet cannot be retired
      // until this mesh draws here; see `.superpowers/namer-integration-report.md`.
      const MESH_VEHICLES = ['apc_eitan', 'dozer_d9', 'mbt_lavi', 'technical', 'ifv_namer'] as const;
      await Promise.all(
        MESH_VEHICLES.map((id) =>
          three.loadVehicleMesh(id, new URL(`../../../art/meshes/vehicles/${id}.glb`, import.meta.url).href)
        )
      );

      // Building meshes (mesh-unit-contract v2): `art/meshes/buildings/
      // <type>.glb` (standing) and `<type>_wreck.glb` (destroyed) -- every
      // type in `STRUCTURE_SPRITES` below has shipped both. `colour_key`/
      // `wallColorKey` is resolved inside `loadBuildingMesh` itself, off
      // `Sim.structureTypes[...].color` -- nothing here needs to know it.
      const MESH_BUILDINGS = ['shanty', 'house', 'warehouse', 'apartment', 'concrete', 'mosque', 'wall'] as const;
      await Promise.all(
        MESH_BUILDINGS.map((id) =>
          three.loadBuildingMesh(
            id,
            new URL(`../../../art/meshes/buildings/${id}.glb`, import.meta.url).href,
            new URL(`../../../art/meshes/buildings/${id}_wreck.glb`, import.meta.url).href
          )
        )
      );
    }
  } else {
    // Same shape as the three branch above: PixiRenderer's own entry point,
    // reached only when actually chosen, so pixi.js never lands in this
    // file's static module graph.
    const { PixiRenderer } = await import('@lions/render/pixi');
    renderer = new PixiRenderer(sim, opts);
    if (flags.mesh) {
      // The `&tunel` lesson, applied to a flag that is real but backend-only:
      // `&mesh` on the Pixi backend otherwise does nothing at all, silently,
      // and reads as a broken feature rather than as a missing `?renderer=
      // three`. Warn by name, the way `unknownParams` warns for a typo.
      console.warn('&mesh needs ?renderer=three — the Pixi backend has no mesh path; ignoring it');
    }
  }

  // The map's decor layer -- road, olive grove, rocky knoll -- goes straight to
  // the renderer. It deliberately does NOT travel through the sim: whether a tile
  // draws a tree or a rock changes no outcome, and invariant 4 keeps presentation
  // data out of simulation state. The mechanical half of the same tile, its cover
  // level, went through sim.setCover above.
  //
  // The two enums are declared separately because @lions/render must not import
  // @lions/data. This is the one module that imports both, so it is where they are
  // held to agree; a silent divergence would draw roads as trees.
  if (
    DECOR.none !== TERRAIN_DECOR.none ||
    DECOR.road !== TERRAIN_DECOR.road ||
    DECOR.grove !== TERRAIN_DECOR.grove ||
    DECOR.knoll !== TERRAIN_DECOR.knoll ||
    DECOR.ridge !== TERRAIN_DECOR.ridge
  ) {
    throw new Error('decor enums have diverged between @lions/data and @lions/render');
  }
  renderer.setDecor(map.decor);
  renderer.setElevation(map.elevation);
  // Up before the canvas exists, so the player never sees the terrain draw
  // itself in or the units stand around as procedural boxes waiting for their
  // sheets. It comes down once the art gate below has settled.
  const loading = showLoading(stage, mission?.name ?? mission?.id ?? 'M0 sandbox', mission?.briefing);
  await renderer.init(stage);
  renderer.useEmitters(vfxEmitters as EmitterSpec[], paletteColor);

  // Load sprite sheets for unit types that have rendered art (non-blocking).
  // Which sheet a unit uses is the only decision left here: facing convention,
  // frame counts, clip list and draw scale all come from the sheet's own
  // manifest, written by the rig that produced the files.
  type SpriteSpec = { path: string; turretPath?: string };
  const TANK: SpriteSpec = {
    path: `${BASE}sprites/TNK_HULL/`,
    turretPath: `${BASE}sprites/TNK_TURR/`,
  };
  const EITAN: SpriteSpec = {
    path: `${BASE}sprites/EITAN_HULL/`,
    turretPath: `${BASE}sprites/EITAN_TURR/`,
  };
  const NAMER: SpriteSpec = {
    path: `${BASE}sprites/NAMER_HULL/`,
    turretPath: `${BASE}sprites/NAMER_TURR/`,
  };
  // Hull only: the model carries no separately modelled weapon station, so
  // there is no turret sheet to composite.
  const JEEP: SpriteSpec = { path: `${BASE}sprites/JEEP_HULL/` };
  // The enemy's armed pickup. Its turret manifest carries `turretAxisPx`, which
  // no other sheet does: a pintle gun on a bed sits well off the model's centre,
  // and without that the renderer would swing it off the truck while tracking.
  const TECHNICAL: SpriteSpec = {
    path: `${BASE}sprites/TECH_HULL/`,
    turretPath: `${BASE}sprites/TECH_TURR/`,
  };
  // No shared infantry sheet. Seven types used to point at one directory, which
  // meant a rifle squad and an enemy militia cell were the same PNG and the
  // silhouette gate could never compare them -- it cannot compare a file with
  // itself. Each type now names its own sheet, so a sheet that fails to load is
  // a visible gap rather than something masked by an alias.
  // The only animated sheet: four frames of hover per facing, looping. Nothing
  // here says so -- the frame count, rate and loop flag all come from the
  // sheet's own manifest, same as every other property of every other sheet.
  const DRONE: SpriteSpec = { path: `${BASE}sprites/DRONE_RECON/` };
  const SPRITE_MAP: Record<string, SpriteSpec> = {
    mbt_lavi: TANK,
    apc_eitan: EITAN,
    ifv_namer: NAMER,
    jeep_shoded: JEEP,
    technical: TECHNICAL,
    recon_drone: DRONE,
    dozer_d9: { path: `${BASE}sprites/D9_HULL/` },
    heli_peten: { path: `${BASE}sprites/APACHE_HULL/` },
    // One sheet per infantry type, composed from tools/units/kit.py. Each is a
    // distinct silhouette rather than a distinct texture: posture, weapon axis
    // and figure count are what survive downsampling to a 64px black shape.
    inf_squad: { path: `${BASE}sprites/INF_SQUAD/` },
    demo_squad: { path: `${BASE}sprites/INF_DEMO/` },
    at_team: { path: `${BASE}sprites/INF_AT/` },
    mortar_team: { path: `${BASE}sprites/INF_MORTAR/` },
    sniper_team: { path: `${BASE}sprites/INF_SNIPER/` },
    // The Yahalom sheet is the one carrying a `work` clip — what resolveClip
    // shows for the whole of a tunnel charge.
    yahalom_squad: { path: `${BASE}sprites/INF_YAHALOM/` },
    militia_cell: { path: `${BASE}sprites/INF_MILITIA/` },
    rpg_team: { path: `${BASE}sprites/INF_RPG/` },
    atgm_cell: { path: `${BASE}sprites/INF_ATGM/` },
    mortar_crew: { path: `${BASE}sprites/INF_MORTAR_E/` },
    // The Sarim set. These three shipped complete, gate-passing sheets and
    // still drew NOTHING, because art existing and art being LOADED are
    // different things and only the first has a gate.
    sarim_rifles: { path: `${BASE}sprites/INF_SARIM/` },
    recoilless_team: { path: `${BASE}sprites/INF_RECOILLESS/` },
    manpad_team: { path: `${BASE}sprites/INF_MANPAD/` },
    // The raider set. Like the technical, the gun truck's turret manifest
    // carries `turretAxisPx`: its cannon sits 1.65 m behind the model centre,
    // so without the correction the renderer swings it off the bed while
    // tracking.
    gun_truck: {
      path: `${BASE}sprites/GUNTRUCK_HULL/`,
      turretPath: `${BASE}sprites/GUNTRUCK_TURR/`,
    },
    charge_squad: { path: `${BASE}sprites/INF_CHARGE/` },
    moto_rpg: { path: `${BASE}sprites/MOTO_RPG/` },
    digger_crew: { path: `${BASE}sprites/INF_DIGGER/` },
    // Hull only: the rack is fixed to the bed, not a separately traversing
    // weapon station, so there is no turret sheet to composite -- same shape
    // as dozer_d9 above.
    rocket_battery: { path: `${BASE}sprites/ROCKETBATTERY_HULL/` },
    // Two air sheets whose flight is presentational: the sim has no altitude,
    // so these move on the ground plane like anything else. The paramotor's
    // `down` clip is its landed state, authored against a land-and-dismount
    // behaviour that does not exist yet.
    paramotor: { path: `${BASE}sprites/PARA_MOTOR/` },
    loiter_drone: { path: `${BASE}sprites/DRONE_LOITER/` },
    // attack_drone shares loiter_drone's shape of unit -- KDF's own loitering
    // munition -- but not its source: reusing loitering_munition.blend would
    // have been an identical silhouette (IoU ~= 1.0, guaranteed, not merely a
    // risk), so it renders from its own hull, art/src/drones/attack_drone.blend.
    attack_drone: { path: `${BASE}sprites/DRONE_ATTACK/` },
  };
  // Structures with art. A building has one sprite, not sixteen: it is placed
  // with a fixed orientation under a fixed camera and never turns. Types without
  // a sheet keep the procedural extrusion, so art lands one building at a time.
  // Every type in data/structures.json has art, and the Marj perimeter places
  // both '#' (concrete) and '=' (wall). `wall` is per_tile: its one sprite is
  // stamped on every tile of the run rather than once per footprint.
  const STRUCTURE_SPRITES: Record<string, string> = {
    shanty: `${BASE}sprites/BLD_SHANTY/`,
    house: `${BASE}sprites/BLD_HOUSE/`,
    warehouse: `${BASE}sprites/BLD_WAREHOUSE/`,
    apartment: `${BASE}sprites/BLD_APARTMENT/`,
    concrete: `${BASE}sprites/BLD_CONCRETE/`,
    mosque: `${BASE}sprites/BLD_MOSQUE/`,
    wall: `${BASE}sprites/BLD_WALL/`,
  };
  // Every sheet is fetched in parallel, but the mission does not start until
  // all of them have settled — see the gate below.
  const artJobs: Promise<unknown>[] = [];
  // Every id whose art failed to load, surfaced once the HUD exists (below)
  // rather than left as a console.warn a completed loading bar buries. On
  // Pixi a failed load still leaves the unit visible — its procedural
  // placeholder, the pre-existing fallback for un-authored art. The three.js
  // backend has no such fallback: a unit type whose sheet failed to load is
  // not drawn at all, so a swallowed failure there means an entire unit type
  // is silently invisible on the battlefield, differently on each reload
  // (the underlying fetch race is nondeterministic). console.warn stays for
  // developers reading the console; this array is what makes the same
  // failure unmissable to a player.
  const failedArt: string[] = [];
  loading.total(Object.keys(STRUCTURE_SPRITES).length + Object.keys(SPRITE_MAP).length);

  for (const [id, path] of Object.entries(STRUCTURE_SPRITES)) {
    artJobs.push(
      renderer
        .loadStructureSprite(id, path)
        .catch((err) => {
          console.warn(`[lions] structure sprite FAILED for ${id}:`, err);
          failedArt.push(id);
        })
        .then(() => loading.step())
    );
  }

  for (const [id, spec] of Object.entries(SPRITE_MAP)) {
    const { path, ...rest } = spec;
    artJobs.push(
      renderer
        .loadSprites(id, path, rest)
        .catch((err) => {
          console.warn(`[lions] sprites FAILED for ${id}:`, err);
          failedArt.push(id);
        })
        .then(() => loading.step())
    );
  }

  // The art gate. Nothing below this line — the HUD, the mission title card,
  // the first tick — happens until the sheets are in, so the opening seconds
  // of a mission are the real art rather than the procedural fallback that
  // stands in for units whose sheets were never authored.
  //
  // Each job swallows its own rejection above, so this waits for every fetch
  // to be *decided*, not to succeed. A sheet that 404s still lets the player
  // in — that unit falls back to its placeholder on Pixi, or (on three.js)
  // to not being drawn — either way far better than a permanent loading
  // screen, and now also reported to the player once the HUD exists, via
  // `failedArt` above.
  await Promise.all(artJobs);
  // Waits for the player when there are orders to read; resolves at once when
  // there are none, which is every sandbox and the tutorial.
  await loading.done();

  const getMission = (): MissionView | null =>
    runtime && mission
      ? {
          name: mission.name ?? mission.id,
          objectives: runtime.objectiveList,
          result: runtime.result,
          campaign: campaignSummary(ledger),
          roe: runtime.roeScore,
          resources: mission.resources ? `logistics ${runtime.logistics} · intel ${runtime.intel}` : undefined,
        }
      : null;
  const hud = new Hud(document.body, {
    sim,
    getSelection: () => renderer.selection,
    getMission,
    hoverStructure: () => renderer.hoverStructure,
    hoverEntity: () => renderer.hoverEntity,
    gameVersion: __GAME_VERSION__,
  });
  // Loud, not a console.warn behind a completed loading bar: `failedArt`
  // (collected above, before the HUD existed to report through) names every
  // structure or unit type whose art never loaded. One notice for the whole
  // batch — a burst of individually-failed fetches is one incident, not one
  // per id.
  if (failedArt.length > 0) {
    hud.note(
      `<b>art failed to load</b> for ${failedArt.length} type${failedArt.length === 1 ? '' : 's'}` +
        ` (${failedArt.join(', ')}) — see the console for details`,
      'bad'
    );
  }
  // The instrument, off by default now that the HUD is not built on top of it.
  const overlay = new DebugOverlay(document.body, sim, () => renderer.selection, __GAME_VERSION__);
  // DebugOverlay does not expose its own visibility, so the intent that
  // reports it is tracked here, kept in lockstep with every `toggle()` call.
  let overlayOn = false;

  // Always-visible escape hatch back to the campaign menu.
  // Top bar: menu and audio, laid out side by side so neither can collide.
  const topBar = document.createElement('div');
  topBar.className = 'rl-topbar';
  document.body.appendChild(topBar);

  const menuBtn = document.createElement('a');
  menuBtn.textContent = '⌂ menu';
  menuBtn.href = '?';
  menuBtn.className = 'rl-btn';
  topBar.appendChild(menuBtn);

  // Audio toggle, next to the menu. Mirrors the `m` key both ways.
  const muteBtn = document.createElement('button');
  muteBtn.className = 'rl-btn';
  const paintMute = (muted: boolean): void => {
    muteBtn.textContent = muted ? '🔇 muted' : '🔊 sound';
    muteBtn.dataset.locked = muted ? '1' : '0';
  };
  paintMute(false);
  muteBtn.addEventListener('click', () => {
    paintMute(audio.toggle());
    muteBtn.blur(); // keep the keyboard on the battlefield, not the button
  });
  topBar.appendChild(muteBtn);

  // Mission start punctuation: the operation names itself before the first
  // order is given. Skippable — a replay for a better ROE should not have to
  // sit through it again.
  if (mission) {
    const primaries = mission.objectives.filter((o) => o.primary !== false).length;
    hud.announce(mission.name ?? mission.id, `${primaries} primary objective(s)`);
  }

  const start = mission?.map.player_start;
  if (start) {
    renderer.camera.x = start[0];
    renderer.camera.y = start[1];
  }

  // Field production, fire support and the build queue: one panel, bottom left.
  let production: ProductionBar | null = null;
  /** Armed fire-support purchase awaiting a target, if any. */
  let armedSupport: 'sweep' | 'strike' | null = null;

  if (runtime && mission?.resources) {
    production = new ProductionBar(document.body, {
      units: Object.values(units)
        .filter((u) => u.faction === 'kdf')
        .map((u) => ({ id: u.id, name: u.name, logistics: u.cost.logistics })),
      runtime,
      note: (html, tone) => hud.note(html, tone),
      onArm: (kind) => {
        armedSupport = kind;
      },
    });
  }

  const audio = new BattleAudio();
  // Recorded clips when they exist, procedural synth per-sound where they
  // don't — so the library can be filled in one file at a time.
  audio.useManifest(audioManifest as AudioManifest, `${BASE}audio/`);
  audio.attach();

  // --- input ---------------------------------------------------------------
  const canvas = renderer.canvas;
  // Left drag = box select; a short click = single select.
  const dragBox = document.createElement('div');
  dragBox.className = 'rl-marquee';
  document.body.appendChild(dragBox);
  let dragStart: { x: number; y: number } | null = null;
  /** Last cursor position over the map, for keyboard-issued orders. */
  const lastCursor = { x: 0, y: 0 };
  /** Alt/Option state as of the last pointer event — the resolver's `confirm`
   *  for the per-frame hover cursor. The click handlers read `ev.altKey`
   *  directly instead, since the event's own state is authoritative at the
   *  moment of the click. */
  let altHeld = false;
  /** The cursor key last written to the DOM, so the per-frame ticker only
   *  touches `canvas.dataset.cursor` when it actually changes. Compares the
   *  composite key (name plus badge), not the base name -- two badges over
   *  the same name would otherwise look unchanged and the write would be
   *  suppressed. */
  let lastCursorKey: string | null = null;
  const canvasXY = (ev: PointerEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  };
  // Every command the player issues goes through here. The tutorial subscribes
  // to the same stream, which is the only way it learns about selection and
  // overlay — facts the sim does not have.
  const intentListeners: ((intent: PlayerIntent) => void)[] = [];
  const dispatch = (intent: PlayerIntent): void => {
    applyIntent(sim, intent);
    for (const fn of intentListeners) fn(intent);
  };

  // The tutorial gets read-only lookups, never the sim itself — it must not be
  // able to queue a command (invariant 4).
  // `tutorials` is keyed by tutorial id (e.g. "beit_sahwan_0"), not by mission
  // id — the mission each entry teaches is its own `.mission` field, so the
  // match has to search by that rather than index directly by `missionId`.
  const stepList = Object.values(
    tutorials as Record<string, { mission: string; steps: StepJson[]; completes?: string } | undefined>
  ).find((t) => t?.mission === missionId);
  let tut: TutorialState | null = null;
  let tutPanel: TutorialPanel | null = null;
  // Two ways to be taught: you have not been yet, or you asked to be again.
  // Without the second, the done flag is a one-way door — the lesson is gone
  // for good and only ?fresh=1 brings it back, at the cost of the campaign.
  const tutorialReplay = params.get('tutorial') !== null;
  if (
    mission &&
    stepList &&
    (tutorialReplay || window.localStorage.getItem(TUTORIAL_DONE_KEY) === null)
  ) {
    tut = initTutorial(stepList.steps, performance.now());
    tutPanel = tutorialPanel(document.body, {
      onSkip: () => {
        tut = null;
        tutPanel?.destroy();
        tutPanel = null;
        renderer.clearTutorialFocus();
      },
    });
    intentListeners.push((intent) => {
      if (!tut) return;
      tut = advance(tut, { kind: 'intent', intent }, performance.now());
    });
  }

  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.button === 0) dragStart = canvasXY(ev);
  });
  window.addEventListener('pointermove', (ev) => {
    // Position and modifier state only. The hover work this used to do
    // inline — screenToWorld, structureAt, the garrison check, and the O(N)
    // entity scan — moved to the ticker (below), which runs it once per
    // frame instead of once per raw pointer event. lastCursor still has to
    // update here: the 'f' smoke key reads it for the live pointer position.
    const hp = canvasXY(ev);
    lastCursor.x = hp.x;
    lastCursor.y = hp.y;
    altHeld = ev.altKey;

    if (!dragStart) return;
    const p = canvasXY(ev);
    const rect = canvas.getBoundingClientRect();
    dragBox.style.display = 'block';
    dragBox.style.left = `${rect.left + Math.min(dragStart.x, p.x)}px`;
    dragBox.style.top = `${rect.top + Math.min(dragStart.y, p.y)}px`;
    dragBox.style.width = `${Math.abs(p.x - dragStart.x)}px`;
    dragBox.style.height = `${Math.abs(p.y - dragStart.y)}px`;
  });
  window.addEventListener('pointerup', (ev) => {
    if (ev.button !== 0 || !dragStart) return;
    const p = canvasXY(ev);
    const moved = Math.hypot(p.x - dragStart.x, p.y - dragStart.y);
    if (moved < 6) {
      const w = renderer.screenToWorld(p.x, p.y);
      // Ask the resolver what this click means, rather than reading
      // armedSupport directly — the same question slice 2's cursor will ask.
      // The resolver only names the call (it cannot know whether the
      // runtime will accept it), so pointerup still owns making the call,
      // dispatching the real outcome, and choosing the note from it.
      const res = resolvePointer(intentWorld, {
        ids: [],
        x: w.x,
        y: w.y,
        append: false,
        armed: armedSupport,
        confirm: ev.altKey,
      });
      if (res.armed && runtime) {
        const call = res.armed;
        const ok =
          call === 'sweep'
            ? runtime.requestSweep(fx.from(w.x), fx.from(w.y))
            : runtime.requestStrike(fx.from(w.x), fx.from(w.y));
        dispatch({ kind: 'support', call, x: w.x, y: w.y, accepted: ok });
        hud.note(
          ok
            ? `<b>${call === 'sweep' ? 'sweep' : 'strike'} called</b> on (${w.x.toFixed(0)}, ${w.y.toFixed(0)})`
            : 'support call refused — not enough intel',
          ok ? 'info' : 'mute'
        );
        if (ok) renderer.addOrderMarker(w.x, w.y);
        production?.setArmed(null);
        dragStart = null;
        dragBox.style.display = 'none';
        return;
      }
      const hit = renderer.pickUnit(w.x, w.y);
      renderer.selection = hit >= 0 ? [hit] : [];
      dispatch({ kind: 'select', ids: renderer.selection, via: 'click' });
    } else {
      renderer.selection = renderer
        .unitsInScreenRect(dragStart.x, dragStart.y, p.x, p.y)
        .filter((i) => sim.state.side[i] === 0);
      dispatch({ kind: 'select', ids: renderer.selection, via: 'box' });
    }
    dragStart = null;
    dragBox.style.display = 'none';
  });
  // The resolver's view of the world. One adapter, so the click and (in slice
  // 2) the hover cursor ask the same object the same questions.
  //
  // Both structureAt and tunnelAt take integer tile coordinates; screenToWorld
  // returns fractional world coordinates, so both calls floor here rather
  // than in the sim (Math is banned in packages/sim/src — invariant 2).
  const intentWorld: IntentWorld = {
    structureAt: (x, y) => sim.structureAt(Math.floor(x), Math.floor(y)),
    tunnelAt: (x, y) => sim.tunnelAt(Math.floor(x), Math.floor(y)),
    isProtected: (s) => sim.isProtected(s),
    structureRoePenalty: (s) => sim.structureRoePenalty(s),
    garrisonFree: (s) => sim.garrisonFree(s),
    canDemolish: (i) => sim.unitTypes[sim.state.typeIdx[i]].canDemolish,
    canGarrison: (i) => sim.unitTypes[sim.state.typeIdx[i]].canGarrison,
    canTunnelCharge: (i) => sim.unitTypes[sim.state.typeIdx[i]].canTunnelCharge,
    // zoneContains is shared with stepRoe's fire/strike branches (task 1) so
    // the warning here and the ROE penalty in the sim cannot drift by a tile.
    inFlaggedZone: (x, y) => {
      const tx = Math.floor(x);
      const ty = Math.floor(y);
      for (const name of mission?.roe?.flagged_zones ?? []) {
        if (zoneContains(map.zones[name], tx, ty)) return true;
      }
      // The sandbox has no mission and therefore no declared no-fire ground,
      // so `?sandbox=<map>&roe` supplies some. Without it the protected X is
      // unreachable on four of the five shipped maps -- only
      // wadi_halam_basin contains a mosque.
      for (const z of sandboxZones) {
        if (zoneContains(z, tx, ty)) return true;
      }
      return false;
    },
  };
  canvas.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const w = renderer.screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top);
    const mine = renderer.selection.filter((i) => sim.state.side[i] === 0 && sim.state.alive[i] === 1);
    // armed is always null here: a right-click issues an ordinary order and
    // must never spend an armed support call — only pointerup's left-click
    // can do that. Passing anything else would let a right-click made while
    // a call is armed silently consume it instead of giving the move it
    // looks like.
    // Alt held means the player is deliberately confirming fire on a
    // protected structure. Ctrl is not it: on macOS, Ctrl+left-click fires
    // this same contextmenu with ctrlKey true, and ctrl-click is the
    // standard Mac idiom for opening a context menu — that click already
    // means "confirmed attack," not "let me reconsider."
    const res = resolvePointer(intentWorld, {
      ids: mine,
      x: w.x,
      y: w.y,
      append: ev.shiftKey,
      armed: null,
      confirm: ev.altKey,
    });
    for (const intent of res.intents) dispatch(intent);
    if (res.note) hud.note(res.note.text, res.note.tone);
    if (res.marker) renderer.addOrderMarker(w.x, w.y);
  });
  const keys = new Set<string>();
  // Control groups 1–9, and double-tap tracking for camera centring.
  const groups = new Map<number, number[]>();
  let lastGroupKey = -1;
  let lastGroupAt = 0;
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('keydown', (ev) => {
    // macOS swallows keyups released under Cmd — never track modified keys,
    // or Cmd+A leaves 'a' stuck and the camera pans forever.
    if (!ev.metaKey && !ev.ctrlKey) keys.add(ev.key.toLowerCase());
    if (ev.key === 'h') {
      const mine = renderer.selection.filter((i) => sim.state.side[i] === 0);
      if (mine.length) dispatch({ kind: 'halt', ids: mine });
    }
    if (ev.key.toLowerCase() === 'a' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault(); // browser select-all
      renderer.selection = [];
      for (let i = 0; i < sim.entityCount; i++) {
        if (sim.state.side[i] === 0 && sim.state.alive[i] === 1) renderer.selection.push(i);
      }
    }
    if (ev.key === 'o') {
      overlay.toggle();
      overlayOn = !overlayOn;
      dispatch({ kind: 'overlay', on: overlayOn });
    }
    // Mount up / dismount / smoke: the same resolver the right-click uses,
    // asked with a KeyContext instead of a PointerContext. The keys are
    // unchanged; what moved is where the eligibility rules live.
    if (ev.key === 'g') {
      const mine = renderer.selection.filter((i) => sim.state.side[i] === 0 && sim.state.alive[i] === 1);
      const res = resolveKeyVerb(intentWorld, 'mount', {
        ids: mine,
        x: 0,
        y: 0,
        isCarrier: (i) => sim.unitTypes[sim.state.typeIdx[i]].transportSlots > 0,
        canEmbark: (i) => sim.unitTypes[sim.state.typeIdx[i]].canEmbark,
        canSmoke: () => false,
        passengerCount: () => 0,
      });
      for (const intent of res.intents) dispatch(intent);
      if (res.note) hud.note(res.note.text, res.note.tone);
    }
    if (ev.key === 'u') {
      const mine = renderer.selection.filter((i) => sim.state.side[i] === 0 && sim.state.alive[i] === 1);
      const res = resolveKeyVerb(intentWorld, 'dismount', {
        ids: mine,
        x: 0,
        y: 0,
        isCarrier: () => false,
        canEmbark: () => false,
        canSmoke: () => false,
        passengerCount: (i) => sim.passengerCount(i),
      });
      for (const intent of res.intents) dispatch(intent);
      if (res.note) hud.note(res.note.text, res.note.tone);
    }
    if (ev.key === 'f') {
      // Screen the ground ahead: laid where the cursor is, by whoever in the
      // selection carries smoke and is off cooldown.
      const mine = renderer.selection.filter((i) => sim.state.side[i] === 0 && sim.state.alive[i] === 1);
      const w = renderer.screenToWorld(lastCursor.x, lastCursor.y);
      const res = resolveKeyVerb(intentWorld, 'smoke', {
        ids: mine,
        x: w.x,
        y: w.y,
        isCarrier: () => false,
        canEmbark: () => false,
        canSmoke: (i) => sim.unitTypes[sim.state.typeIdx[i]].canSmoke,
        passengerCount: () => 0,
      });
      for (const intent of res.intents) dispatch(intent);
      if (res.note) hud.note(res.note.text, res.note.tone);
      if (res.marker) renderer.addOrderMarker(w.x, w.y);
    }
    if (ev.key === 'm') {
      const muted = audio.toggle();
      paintMute(muted);
      hud.note(muted ? 'audio muted' : 'audio on', 'mute');
    }

    // Control groups: Ctrl/Cmd+digit assigns the selection, digit recalls it,
    // double-tap centres the camera on the group.
    if (ev.key >= '1' && ev.key <= '9') {
      const slot = Number(ev.key);
      if (ev.ctrlKey || ev.metaKey) {
        ev.preventDefault();
        const mine = renderer.selection.filter(
          (i) => sim.state.side[i] === 0 && sim.state.alive[i] === 1
        );
        for (let g = 1; g <= 9; g++) {
          if (g !== slot) groups.set(g, (groups.get(g) ?? []).filter((i) => !mine.includes(i)));
        }
        groups.set(slot, mine);
        for (let i = 0; i < sim.capacity; i++) {
          if (renderer.unitGroup[i] === slot) renderer.unitGroup[i] = 0;
        }
        for (const i of mine) renderer.unitGroup[i] = slot;
        dispatch({ kind: 'group', slot, action: 'assign' });
        hud.note(
          mine.length ? `<b>group ${slot}</b> — ${mine.length} unit(s)` : `group ${slot} cleared`,
          'live'
        );
      } else {
        const members = (groups.get(slot) ?? []).filter((i) => sim.state.alive[i] === 1);
        groups.set(slot, members);
        if (members.length > 0) {
          renderer.selection = members;
          dispatch({ kind: 'group', slot, action: 'recall' });
          const now = performance.now();
          if (lastGroupKey === slot && now - lastGroupAt < 400) {
            let cx = 0;
            let cy = 0;
            for (const i of members) {
              cx += fx.toNumber(sim.state.posX[i]);
              cy += fx.toNumber(sim.state.posY[i]);
            }
            renderer.camera.x = cx / members.length;
            renderer.camera.y = cy / members.length;
          }
          lastGroupKey = slot;
          lastGroupAt = now;
        }
      }
    }
  });
  window.addEventListener('keyup', (ev) => keys.delete(ev.key.toLowerCase()));
  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const z = renderer.camera.zoom * (ev.deltaY > 0 ? 0.9 : 1.1);
    renderer.camera.zoom = Math.min(2.5, Math.max(0.35, z));
  });

  // --- fixed-tick loop with render interpolation ---------------------------
  const runTick = (): void => {
    const events = sim.tick();
    renderer.snapshot();
    renderer.onEvents(events);
    audio.setListener(renderer.camera);
    audio.onEvents(events, sim);
    if (runtime && mission) {
      for (const me of runtime.step(events)) {
        if (tut) tut = advance(tut, { kind: 'mission', event: me }, performance.now());
        const described = describeMissionEvent(me, mission, narratedRoeReasons);
        if (described) hud.note(described[0], described[1]);
        if (me.kind === 'missionEnd') {
          // The end screen must not land over a live step panel — an early
          // mission end (e.g. destroy_all completing before lesson 12) is not
          // tutorial completion, so the completion flag is deliberately not
          // set here.
          tut = null;
          tutPanel?.destroy();
          tutPanel = null;
          renderer.clearTutorialFocus();
          const updatedLedger = { ...ledger, ...me.ledger };
          if (me.result === 'victory') {
            saveLedger(updatedLedger);
            hud.note('<b>campaign ledger updated</b> — survivors and ROE carried forward', 'info');
          }
          if (missionId) {
            // Campaign order lives in world.json, not in the order data/missions files
            // happen to be imported.
            const nextMissionId = nextMissionAfter(parseWorld(world), missionId, updatedLedger);
            showEndScreen(document.body, {
              result: me.result,
              roe: me.roeRating,
              survivors: me.survivors.length,
              missionId,
              nextMissionId,
            });
          }
        }
      }
      if (tut) {
        const now = performance.now();
        for (const e of events) {
          tut = advance(
            tut,
            {
              kind: 'sim',
              event: e,
              sideOf: (id) => sim.state.side[id],
              typeIdOf: (id) => sim.unitTypes[sim.state.typeIdx[id]].id,
            },
            now
          );
        }
        tut = advance(tut, { kind: 'tick' }, now);
        tutPanel?.render(tut);
        const step = tut.steps[tut.index];
        const focus = step?.focus;
        if (focus?.kind === 'marker' && focus.marker) {
          const p = map.markers[focus.marker];
          if (p) renderer.setTutorialFocus(p[0], p[1], 1.5);
        } else if (focus?.kind === 'zone' && focus.zone) {
          const z = map.zones[focus.zone];
          if (z) renderer.setTutorialFocus(z[0] + z[2] / 2, z[1] + z[3] / 2, Math.max(z[2], z[3]) / 2);
        } else {
          renderer.clearTutorialFocus();
        }
        if (tut.done) {
          window.localStorage.setItem(TUTORIAL_DONE_KEY, '1');
          hud.note('<b>working up complete</b> — the town is next', 'good');
          if (stepList?.completes !== undefined) runtime.completeObjective(stepList.completes);
          tut = null;
          tutPanel?.destroy();
          tutPanel = null;
          renderer.clearTutorialFocus();
        }
      }
    }
    hud.onTick();
    overlay.onTick(events);
    if (production && sim.tickCount % 5 === 0) production.refresh();
    // Show the ground a timed objective is about, and how it is going.
    if (runtime && sim.tickCount % 5 === 0) {
      const timed = runtime.objectiveList.find((o) => o.status === 'active' && o.zone !== undefined);
      const rect = timed?.zone !== undefined ? map.zones[timed.zone] : undefined;
      renderer.objectiveZone = rect ?? null;
      renderer.objectiveZoneState =
        timed?.paused === 'contested' ? 'contested' : timed?.paused === 'unheld' ? 'unheld' : 'held';
    }
  };

  // How long the last presented frame took, in ms. The renderer needs it for
  // presentation-only animation and no longer has a ticker of its own to ask.
  // Seeded with a nominal 60 fps frame, which is exactly what Pixi's ticker
  // reported before its first update.
  let lastFrameMs = 1000 / 60;

  // Dev hook: deterministic headless stepping from the console
  // (`__lions.step(1200)` fast-forwards a minute of battle).
  Object.assign(window as unknown as Record<string, unknown>, {
    __lions: {
      sim,
      renderer,
      runtime,
      audio,

      /** What this build reads off the URL, and what the console offers.
       *  The three sandbox flags used to be reachable only by reading
       *  CLAUDE.md, which is a poor place for an instrument you reach for
       *  from the URL bar. */
      help: () => {
        console.info(`[lions] ${helpText()}`);
      },
      step: (n: number) => {
        for (let i = 0; i < n; i++) runTick();
        renderer.frame(1, lastFrameMs);
        return sim.tickCount;
      },

      /** Jump the camera to a named marker, or to a tile. Walking to the far
       *  corner of a 48×48 map to look at one ridge is most of the cost of
       *  checking anything visual. */
      goto: (where: string | number, y?: number) => {
        if (typeof where === 'number') {
          renderer.camera.x = where;
          renderer.camera.y = y ?? where;
          return [renderer.camera.x, renderer.camera.y];
        }
        const markers = (mapJson.markers ?? {}) as Record<string, readonly number[] | undefined>;
        const p = markers[where];
        if (!p) {
          console.warn(
            `unknown marker "${where}" — this map has: ${Object.keys(markers).join(', ') || '(none)'}`
          );
          return null;
        }
        renderer.camera.x = p[0];
        renderer.camera.y = p[1];
        return [p[0], p[1]];
      },

      /** Set the selection, so a specific unit can be put under the pointer
       *  without hunting for it. Ids come from `sim`, or from `units()` below. */
      sel: (ids: number[]) => {
        renderer.selection = ids.filter((i) => sim.state.alive[i] === 1);
        return renderer.selection;
      },

      /** Living units with their type id and tile, for finding something to
       *  select. Side 0 unless asked otherwise. */
      units: (side = 0) => {
        const out: { id: number; type: string; x: number; y: number }[] = [];
        for (let i = 0; i < sim.entityCount; i++) {
          if (sim.state.alive[i] !== 1 || sim.state.side[i] !== side) continue;
          out.push({
            id: i,
            type: sim.unitTypes[sim.state.typeIdx[i]].id,
            x: Math.floor(fx.toNumber(sim.state.posX[i])),
            y: Math.floor(fx.toNumber(sim.state.posY[i])),
          });
        }
        return out;
      },

      /** What cursor is actually applied right now.
       *
       *  Deliberately a READ of the DOM attribute rather than a recomputation:
       *  the whole failure this exists to catch is a cursor whose logic is
       *  right and whose wiring is not. Recomputing would agree with the logic
       *  and tell you nothing. A previous slice shipped a selector that could
       *  never match, behind a fully green suite. */
      cursorKey: () => canvas.dataset.cursor ?? '(unset)',

      /** Put the pointer somewhere and run the REAL hover read, returning the
       *  cursor key it produced.
       *
       *  Takes WORLD tiles, not screen pixels, so a check reads the way a map
       *  is authored. The hover path used to be reachable only through Pixi's
       *  ticker, which is rAF-backed and therefore dead in a hidden tab --
       *  every automated look at the cursor saw `(unset)` and concluded the
       *  feature was broken. This calls the same `updateHover` the ticker
       *  does, so what it reports is what a frame would have written. */
      hover: (wx: number, wy: number) => {
        // Forward projection, the inverse of screenToWorld's flat path. It
        // does NOT undo terrain lift -- screenToWorld only approximates that
        // itself (see its comment), so rather than pretend, this reports the
        // tile it actually landed on and lets the caller see any drift.
        //
        // Asked of the renderer rather than recomputed here: in a 3D backend
        // the projection is the camera, and a second copy of the arithmetic
        // would drift from it silently.
        const p = renderer.worldToScreen(wx, wy);
        lastCursor.x = p.x;
        lastCursor.y = p.y;
        updateHover();
        const landed = renderer.screenToWorld(lastCursor.x, lastCursor.y);
        return {
          cursor: canvas.dataset.cursor ?? '(unset)',
          asked: [wx, wy] as [number, number],
          landed: [Math.floor(landed.x), Math.floor(landed.y)] as [number, number],
        };
      },
    },
  });

  /** The hover read: pointer position -> resolver -> cursor name -> DOM.
   *
   *  Extracted from the rAF callback so it is reachable without one. It ran
   *  ONLY inside requestAnimationFrame, and Chrome runs rAF zero times in a
   *  hidden tab -- so every headless or automated check of the cursor found
   *  `dataset.cursor` absent and the sim at tick 0, which reads as a broken
   *  cursor and is not one. That is why three slices of cursor work shipped
   *  without anything ever having looked at them.
   *
   *  `__lions.hover(x, y)` below calls THIS function, not a copy of it: the
   *  instrument and the loop share one body, so a check cannot pass against
   *  code the real frame does not run. */
  const updateHover = (): void => {
  // Hover work runs once per frame rather than once per pointer event. A
  // high-poll mouse fires several moves a frame, and this loop includes an
  // O(N) scan over every entity, so this is strictly cheaper than before.
  const hw = renderer.screenToWorld(lastCursor.x, lastCursor.y);
  const hs = sim.structureAt(Math.floor(hw.x), Math.floor(hw.y));
  renderer.hoverStructure = hs;
  renderer.hoverCanGarrison =
    hs >= 0 &&
    sim.structures.occupants[hs] < sim.structureTypes[sim.structures.typeIdx[hs]].garrisonSlots &&
    renderer.selection.some(
      (i) =>
        sim.state.side[i] === 0 &&
        sim.state.alive[i] === 1 &&
        sim.unitTypes[sim.state.typeIdx[i]].canGarrison &&
        sim.state.garrisonedIn[i] !== hs
    );

  // Nearest living enemy within half a tile of the cursor — the same
  // generosity the click-to-select test uses. Restricted to side 1 (real
  // enemies, never civilians — side 2 is never an aimpoint) and gated on
  // renderer.isVisible so the scan can only pick up an entity that is
  // actually drawn on screen right now. That mirrors the exact condition
  // the renderer itself uses to decide whether to draw a non-friendly
  // sprite at all (see PixiRenderer's entity loop) — anything the fog
  // currently hides must not be able to surface through the hover panel
  // either, or sweeping the cursor across unexplored ground locates every
  // hidden defender.
  let he = -1;
  let bestD = 0.5 * 0.5;
  for (let i = 0; i < sim.entityCount; i++) {
    if (sim.state.alive[i] === 0 || sim.state.side[i] !== 1) continue;
    const ex = fx.toNumber(sim.state.posX[i]);
    const ey = fx.toNumber(sim.state.posY[i]);
    if (!renderer.isVisible(ex, ey)) continue;
    const dx = ex - hw.x;
    const dy = ey - hw.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      he = i;
    }
  }
  renderer.hoverEntity = he;

  // The hover cursor asks the same resolver the click uses, with the same
  // adapter (intentWorld) — one object, so the click and the cursor that
  // predicts it can never give different answers. append is always false:
  // the hover cursor does not depend on Shift, and passing the live Shift
  // state would make the cursor flicker while a player queues waypoints.
  const mine = renderer.selection.filter((i) => sim.state.side[i] === 0 && sim.state.alive[i] === 1);
  const res = resolvePointer(intentWorld, {
    ids: mine,
    x: hw.x,
    y: hw.y,
    append: false,
    armed: armedSupport,
    confirm: altHeld,
  });
  const tx = Math.floor(hw.x);
  const ty = Math.floor(hw.y);
  const inBounds = tx >= 0 && ty >= 0 && tx < sim.width && ty < sim.height;
  const hints = {
    hostile: renderer.hoverEntity >= 0,
    blocked: inBounds && sim.blocked[ty * sim.width + tx] !== 0,
  };
  const badges: BadgeHints = {
    bucketOf: (id) => roleBucket(sim.unitTypes[sim.state.typeIdx[id]]),
  };
  const name = cursorFor(res, hints);
  const key = cursorKey(name, badgeFor(res, hints, badges, name));
  // Guard the write: a dataset attribute set every frame forces needless
  // style invalidation even when the cursor hasn't changed.
  if (key !== lastCursorKey) {
    canvas.dataset.cursor = key;
    lastCursorKey = key;
  }
  };

  let last = performance.now();
  let acc = 0;
  // The app owns the frame loop, not the renderer.
  //
  // Pixi's ticker is backend-specific, and a renderer that schedules the
  // application's work is the wrong way round: the app decides when a frame
  // happens and asks the renderer to draw it. A three.js backend has no
  // ticker to offer at all.
  //
  // This is the only rAF loop in the app. The renderer's backend is
  // constructed with its own scheduler stopped, and `frame` presents before it
  // returns, so the order within a frame is still tick -> draw -> present.
  let rafId = 0;
  const loop = (): void => {
    rafId = requestAnimationFrame(loop);
    const now = performance.now();
    lastFrameMs = now - last;
    acc += lastFrameMs;
    last = now;
    if (acc > 250) acc = 250; // don't spiral after a background tab
    while (acc >= MS_PER_TICK) {
      runTick();
      acc -= MS_PER_TICK;
    }
    const panSpeed = 0.5 / renderer.camera.zoom;
    if (keys.has('w') || keys.has('arrowup')) {
      renderer.camera.x -= panSpeed;
      renderer.camera.y -= panSpeed;
    }
    if (keys.has('s') || keys.has('arrowdown')) {
      renderer.camera.x += panSpeed;
      renderer.camera.y += panSpeed;
    }
    if (keys.has('a') || keys.has('arrowleft')) {
      renderer.camera.x -= panSpeed;
      renderer.camera.y += panSpeed;
    }
    if (keys.has('d') || keys.has('arrowright')) {
      renderer.camera.x += panSpeed;
      renderer.camera.y -= panSpeed;
    }
    renderer.frame(acc / MS_PER_TICK, lastFrameMs);

    updateHover();
  };
  rafId = requestAnimationFrame(loop);
  // `rafId` is a local of main(), and main() has no shutdown path, so nothing
  // ever reads it -- a teardown would have to lift the handle out of this
  // scope anyway, which is a restructuring this line does not save anyone.
  // It exists so the loop's self-re-request has somewhere to land, and is
  // voided so lint does not report a variable that is only ever written.
  void rafId;
}

main().catch((err: unknown) => {
  console.error('boot failed:', err);
  const stage = document.getElementById('stage');
  if (stage) {
    const pre = document.createElement('pre');
    pre.className = 'rl-boot-error';
    pre.textContent = `boot failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`;
    stage.appendChild(pre);
  }
});
