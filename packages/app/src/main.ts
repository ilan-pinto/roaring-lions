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
  type LedgerData,
  type MissionEvent,
  type MissionJson,
} from '@lions/sim';
import {
  PixiRenderer,
  DebugOverlay,
  BattleAudio,
  TERRAIN_DECOR,
  type RendererOptions,
  type AudioManifest,
  type EmitterSpec,
} from '@lions/render';
import {
  units,
  maps,
  missions,
  structures as structureCatalogue,
  parseMap,
  DECOR,
  paletteColor,
  audioManifest,
  vfxEmitters,
  type MapJson,
} from '@lions/data';
import './ui/theme.css';
import { Hud, type MissionView, type Tone } from './ui/hud';
import { showMenu, showEndScreen } from './ui/menu';
import { ProductionBar } from './ui/production';

/** Deploy base ('/' locally, '/<repo>/' on GitHub Pages) — every asset URL
 *  is built from it so the same bundle works in both places. */
const BASE = import.meta.env.BASE_URL;

const MS_PER_TICK = 1000 / TICKS_PER_SECOND;
const WEST = 32768; // half turn — garrisons face the expected KDF axis

// Campaign persistence: victories merge their produced ledger keys here;
// defeats write nothing — replaying a mission for a better ledger is free.
const LEDGER_KEY = 'lions.campaign.ledger';

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

function sandboxSpawns(sim: Sim, typeOf: Map<string, number>): void {
  const spawn = (id: string, side: number, x: number, y: number, facing = 0): number => {
    const t = typeOf.get(id);
    if (t === undefined) throw new Error(`unknown unit ${id}`);
    return sim.spawn(t, side, fx.from(x + 0.5), fx.from(y + 0.5), facing);
  };
  // KDF task force, west edge, facing east.
  spawn('mbt_lavi', 0, 4, 20);
  spawn('mbt_lavi', 0, 4, 26);
  spawn('ifv_namer', 0, 3, 16);
  spawn('ifv_namer', 0, 3, 30);
  spawn('apc_eitan', 0, 2, 23);
  spawn('inf_squad', 0, 6, 18);
  spawn('inf_squad', 0, 6, 23);
  spawn('inf_squad', 0, 6, 28);
  spawn('at_team', 0, 5, 21);
  spawn('mortar_team', 0, 2, 25);
  spawn('jeep_shoded', 0, 5, 26);
  spawn('recon_drone', 0, 8, 23);
  // Enemy garrison among the buildings, facing west.
  spawn('militia_cell', 1, 27, 12, WEST);
  spawn('militia_cell', 1, 33, 15, WEST);
  spawn('militia_cell', 1, 29, 25, WEST);
  spawn('militia_cell', 1, 25, 37, WEST);
  spawn('rpg_team', 1, 27, 24, WEST);
  spawn('rpg_team', 1, 19, 19, WEST);
  spawn('atgm_cell', 1, 38, 22, WEST);
  spawn('technical', 1, 42, 14, WEST);
  spawn('technical', 1, 42, 32, WEST);
  spawn('mortar_crew', 1, 44, 24, WEST);
}

/** Mission narration for the HUD notice stack: what to say, and how it lands. */
function describeMissionEvent(e: MissionEvent, mission: MissionJson): [string, Tone] | null {
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
    case 'roe':
      return [`<b>ROE −${e.penalty}</b> (${e.reason}) → ${e.score}`, 'bad'];
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
  }
  if (params.get('mission') === null && params.get('sandbox') === null) {
    showMenu(stage, {
      base: BASE,
      version: __GAME_VERSION__,
      missions: Object.entries(missions).map(([id, m]) => ({ id, name: m.name })),
      campaign: campaignSummary(loadLedger()),
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
  const mapJson =
    (maps as Record<string, MapJson | undefined>)[mission?.map.file ?? 'beit_sahwan_outskirts'] ??
    maps.beit_sahwan_outskirts;
  const map = parseMap(mapJson);
  const sim = new Sim({ seed: 20260727, width: map.width, height: map.height, capacity: 128 });
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = y * map.width + x;
      if (map.cover[t] !== 0) sim.setCover(x, y, map.cover[t]);
    }
  }
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

  const typeOf = new Map<string, number>();
  for (const u of Object.values(units)) typeOf.set(u.id, sim.addUnitType(u));

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
    sandboxSpawns(sim, typeOf);
  }

  // --- renderer + overlay --------------------------------------------------
  const opts: RendererOptions = {
    background: paletteColor('shadow.1'),
    teamColors: [paletteColor('team.kedem'), paletteColor('team.hostile'), paletteColor('team.neutral')],
    hullColors: [paletteColor('olive.1'), paletteColor('dust.2'), paletteColor('limestone.1')],
    infantryColors: [paletteColor('olive.0'), paletteColor('dust.0'), paletteColor('limestone.1')],
    terrainOpen: paletteColor('limestone.3'),
    terrainCover: [paletteColor('limestone.2'), paletteColor('dust.1'), paletteColor('dust.0')],
    terrainBlocked: paletteColor('limestone.4'),
    tracerColors: [paletteColor('vfx.tracer'), paletteColor('vfx.ember')],
    flashColor: paletteColor('vfx.fire'),
    nearMissColor: paletteColor('dust.0'),
    interceptColor: paletteColor('vfx.interceptor'),
    resolveColor: paletteColor,
  };
  const renderer = new PixiRenderer(sim, opts);

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
    DECOR.knoll !== TERRAIN_DECOR.knoll
  ) {
    throw new Error('decor enums have diverged between @lions/data and @lions/render');
  }
  renderer.setDecor(map.decor);
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
    recon_drone: DRONE,
    // One sheet per infantry type, composed from tools/units/kit.py. Each is a
    // distinct silhouette rather than a distinct texture: posture, weapon axis
    // and figure count are what survive downsampling to a 64px black shape.
    inf_squad: { path: `${BASE}sprites/INF_SQUAD/` },
    demo_squad: { path: `${BASE}sprites/INF_DEMO/` },
    at_team: { path: `${BASE}sprites/INF_AT/` },
    mortar_team: { path: `${BASE}sprites/INF_MORTAR/` },
    sniper_team: { path: `${BASE}sprites/INF_SNIPER/` },
    militia_cell: { path: `${BASE}sprites/INF_MILITIA/` },
    rpg_team: { path: `${BASE}sprites/INF_RPG/` },
    atgm_cell: { path: `${BASE}sprites/INF_ATGM/` },
    mortar_crew: { path: `${BASE}sprites/INF_MORTAR_E/` },
  };
  // Structures with art. A building has one sprite, not sixteen: it is placed
  // with a fixed orientation under a fixed camera and never turns. Types without
  // a sheet keep the procedural extrusion, so art lands one building at a time.
  // Every type in data/structures.json has art, so nothing falls back to the
  // procedural extrusion. `concrete` is included although no map places '#' yet.
  const STRUCTURE_SPRITES: Record<string, string> = {
    shanty: `${BASE}sprites/BLD_SHANTY/`,
    house: `${BASE}sprites/BLD_HOUSE/`,
    warehouse: `${BASE}sprites/BLD_WAREHOUSE/`,
    apartment: `${BASE}sprites/BLD_APARTMENT/`,
    concrete: `${BASE}sprites/BLD_CONCRETE/`,
    mosque: `${BASE}sprites/BLD_MOSQUE/`,
  };
  for (const [id, path] of Object.entries(STRUCTURE_SPRITES)) {
    renderer.loadStructureSprite(id, path).catch((err) => {
      console.warn(`[lions] structure sprite FAILED for ${id}:`, err);
    });
  }

  for (const [id, spec] of Object.entries(SPRITE_MAP)) {
    const { path, ...rest } = spec;
    renderer.loadSprites(id, path, rest).catch((err) => {
      console.warn(`[lions] sprites FAILED for ${id}:`, err);
    });
  }

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
  // The instrument, off by default now that the HUD is not built on top of it.
  const overlay = new DebugOverlay(document.body, sim, () => renderer.selection, __GAME_VERSION__);

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
  const canvas = renderer.app.canvas;
  // Left drag = box select; a short click = single select.
  const dragBox = document.createElement('div');
  dragBox.className = 'rl-marquee';
  document.body.appendChild(dragBox);
  let dragStart: { x: number; y: number } | null = null;
  /** Last cursor position over the map, for keyboard-issued orders. */
  const lastCursor = { x: 0, y: 0 };
  const canvasXY = (ev: PointerEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  };
  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.button === 0) dragStart = canvasXY(ev);
  });
  window.addEventListener('pointermove', (ev) => {
    // Track what the cursor is over so the renderer can offer the
    // enter-building affordance before the click.
    const hp = canvasXY(ev);
    lastCursor.x = hp.x;
    lastCursor.y = hp.y;
    const hw = renderer.screenToWorld(hp.x, hp.y);
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
      if (armedSupport !== null && runtime) {
        const ok =
          armedSupport === 'sweep'
            ? runtime.requestSweep(fx.from(w.x), fx.from(w.y))
            : runtime.requestStrike(fx.from(w.x), fx.from(w.y));
        hud.note(
          ok
            ? `<b>${armedSupport === 'sweep' ? 'sweep' : 'strike'} called</b> on (${w.x.toFixed(0)}, ${w.y.toFixed(0)})`
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
    } else {
      renderer.selection = renderer
        .unitsInScreenRect(dragStart.x, dragStart.y, p.x, p.y)
        .filter((i) => sim.state.side[i] === 0);
    }
    dragStart = null;
    dragBox.style.display = 'none';
  });
  canvas.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const w = renderer.screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top);
    const mine = renderer.selection.filter((i) => sim.state.side[i] === 0 && sim.state.alive[i] === 1);
    if (mine.length === 0) return;
    // Right-clicking a building sends whoever can garrison inside it, and
    // everyone else to attack toward it.
    const struct = sim.structureAt(Math.floor(w.x), Math.floor(w.y));
    if (struct >= 0) {
      const canEnter = mine.filter((i) => sim.unitTypes[sim.state.typeIdx[i]].canGarrison);
      const rest = mine.filter((i) => !sim.unitTypes[sim.state.typeIdx[i]].canGarrison);
      if (canEnter.length > 0) sim.queueCommand({ kind: 'garrison', ids: canEnter, structure: struct });
      if (rest.length > 0) {
        sim.queueCommand({ kind: 'attackMove', ids: rest, x: fx.from(w.x), y: fx.from(w.y) });
      }
      renderer.addOrderMarker(w.x, w.y);
      return;
    }
    // Shift queues the point onto the end of the route instead of replacing
    // it, so a player can draw a path around a block.
    sim.queueCommand({
      kind: 'attackMove',
      ids: mine,
      x: fx.from(w.x),
      y: fx.from(w.y),
      append: ev.shiftKey,
    });
    renderer.addOrderMarker(w.x, w.y);
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
      if (mine.length) sim.queueCommand({ kind: 'halt', ids: mine });
    }
    if (ev.key.toLowerCase() === 'a' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault(); // browser select-all
      renderer.selection = [];
      for (let i = 0; i < sim.entityCount; i++) {
        if (sim.state.side[i] === 0 && sim.state.alive[i] === 1) renderer.selection.push(i);
      }
    }
    if (ev.key === 'o') overlay.toggle();
    // Mount up / dismount: the selection sorts itself into riders and rides.
    if (ev.key === 'g') {
      const mine = renderer.selection.filter((i) => sim.state.side[i] === 0 && sim.state.alive[i] === 1);
      const carrier = mine.find((i) => sim.unitTypes[sim.state.typeIdx[i]].transportSlots > 0);
      // Passengers are dismounted elements. Filtering on "has no seats" put
      // tanks in the list, so a box-select over an armoured force loaded
      // Merkavas into the APC and left the infantry behind.
      const riders = mine.filter((i) => sim.unitTypes[sim.state.typeIdx[i]].canEmbark);
      if (carrier !== undefined && riders.length > 0) {
        sim.queueCommand({ kind: 'load', ids: riders, carrier });
        hud.note('<b>mount up</b> — infantry boarding', 'info');
      } else {
        hud.note('select a transport and the infantry to load', 'mute');
      }
    }
    if (ev.key === 'u') {
      const carriers = renderer.selection.filter(
        (i) => sim.state.side[i] === 0 && sim.state.alive[i] === 1 && sim.passengerCount(i) > 0
      );
      if (carriers.length > 0) {
        sim.queueCommand({ kind: 'unload', ids: carriers });
        hud.note('<b>dismount</b> — infantry debussing', 'info');
      }
    }
    if (ev.key === 'f') {
      // Screen the ground ahead: laid where the cursor is, by whoever in the
      // selection carries smoke and is off cooldown.
      const carriers = renderer.selection.filter(
        (i) => sim.state.side[i] === 0 && sim.state.alive[i] === 1 && sim.unitTypes[sim.state.typeIdx[i]].canSmoke
      );
      if (carriers.length === 0) {
        hud.note('nothing selected that carries smoke', 'mute');
      } else {
        const w = renderer.screenToWorld(lastCursor.x, lastCursor.y);
        sim.queueCommand({ kind: 'smoke', ids: carriers, x: fx.from(w.x), y: fx.from(w.y) });
        renderer.addOrderMarker(w.x, w.y);
      }
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
        hud.note(
          mine.length ? `<b>group ${slot}</b> — ${mine.length} unit(s)` : `group ${slot} cleared`,
          'live'
        );
      } else {
        const members = (groups.get(slot) ?? []).filter((i) => sim.state.alive[i] === 1);
        groups.set(slot, members);
        if (members.length > 0) {
          renderer.selection = members;
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
        const described = describeMissionEvent(me, mission);
        if (described) hud.note(described[0], described[1]);
        if (me.kind === 'missionEnd') {
          if (me.result === 'victory') {
            saveLedger({ ...ledger, ...me.ledger });
            hud.note('<b>campaign ledger updated</b> — survivors and ROE carried forward', 'info');
          }
          if (missionId) {
            const order = Object.keys(missions);
            showEndScreen(document.body, {
              result: me.result,
              roe: me.roeRating,
              survivors: me.survivors.length,
              missionId,
              nextMissionId: order[order.indexOf(missionId) + 1],
            });
          }
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

  // Dev hook: deterministic headless stepping from the console
  // (`__lions.step(1200)` fast-forwards a minute of battle).
  Object.assign(window as unknown as Record<string, unknown>, {
    __lions: {
      sim,
      renderer,
      runtime,
      audio,
      step: (n: number) => {
        for (let i = 0; i < n; i++) runTick();
        renderer.frame(1);
        return sim.tickCount;
      },
    },
  });

  let last = performance.now();
  let acc = 0;
  renderer.app.ticker.add(() => {
    const now = performance.now();
    acc += now - last;
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
    renderer.frame(acc / MS_PER_TICK);
  });
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
