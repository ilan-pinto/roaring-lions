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
  type RendererOptions,
  type MissionView,
  type AudioManifest,
} from '@lions/render';
import {
  units,
  maps,
  missions,
  structures as structureCatalogue,
  parseMap,
  paletteColor,
  audioManifest,
  type MapJson,
} from '@lions/data';

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

function describeMissionEvent(e: MissionEvent, mission: MissionJson): [string, string] | null {
  switch (e.kind) {
    case 'objective': {
      const def = mission.objectives.find((o) => o.id === e.id);
      const label = def?.text ?? e.id;
      return e.status === 'complete'
        ? [`<b>OBJECTIVE COMPLETE</b> — ${label}`, '#6B8A4A']
        : [`<b>OBJECTIVE ${e.status.toUpperCase()}</b> — ${label}`, '#D93A2B'];
    }
    case 'trigger':
      return [`<b>enemy reacts</b> (${e.id})`, '#E8C33A'];
    case 'wave':
      return [`<b>enemy reinforcements</b> — ${e.count} unit(s) inbound`, '#D93A2B'];
    case 'roe':
      return [`<b>ROE −${e.penalty}</b> (${e.reason}) → ${e.score}`, '#D93A2B'];
    case 'built':
      return [`<b>reinforcement deployed</b> — ${e.unit}`, '#A9C4D1'];
    case 'missionEnd':
      return [
        e.result === 'victory'
          ? `<b>MISSION ACCOMPLISHED</b> — ROE ${e.roeRating}, ${e.survivors.length} units survive`
          : '<b>MISSION FAILED</b>',
        e.result === 'victory' ? '#6B8A4A' : '#D93A2B',
      ];
    default:
      return null;
  }
}

const PANEL =
  'background:rgba(20,21,15,0.92);color:#F2E8D5;border:1px solid #5C625F;border-radius:6px;' +
  'font:14px ui-monospace,Menlo,monospace;';

/** Campaign menu: title, the three missions, the sandbox. Pure navigation. */
function showMenu(stage: HTMLElement, ledger: LedgerData): void {
  const div = document.createElement('div');
  div.style.cssText =
    'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);padding:28px 40px;' + PANEL;
  const rows = [
    '<div style="font-size:26px;font-weight:bold;letter-spacing:2px">ROARING LIONS</div>',
    '<div style="color:#8E9491;margin-bottom:14px">Beit Sahwan — M1</div>',
    `<div style="color:#A9C4D1;margin-bottom:14px">${campaignSummary(ledger)}</div>`,
  ];
  div.innerHTML = rows.join('');
  const add = (label: string, href: string): void => {
    const a = document.createElement('a');
    a.textContent = label;
    a.href = href;
    a.style.cssText =
      'display:block;margin:6px 0;padding:8px 12px;color:#F2E8D5;text-decoration:none;' +
      'border:1px solid #5C625F;border-radius:4px;';
    div.appendChild(a);
  };
  for (const [id, m] of Object.entries(missions)) add(m.name, `?mission=${id}`);
  add('M0 sandbox (no mission)', '?sandbox=1');
  add('reset campaign ledger', `?fresh=1`);
  stage.appendChild(div);
}

/** Mission end screen: result, ROE, survivors, and where to next. */
function showEndScreen(result: 'victory' | 'defeat', roe: number, survivors: number, missionId: string): void {
  const order = Object.keys(missions);
  const next = order[order.indexOf(missionId) + 1];
  const div = document.createElement('div');
  div.style.cssText =
    'position:absolute;top:62%;left:50%;transform:translate(-50%,0);padding:16px 28px;text-align:center;' + PANEL;
  div.innerHTML =
    `<div style="font-weight:bold;margin-bottom:8px">${result === 'victory' ? 'town is quiet' : 'withdraw and regroup'}</div>` +
    `<div style="color:#8E9491;margin-bottom:10px">ROE ${roe} · ${survivors} unit(s) walking out</div>`;
  const link = (label: string, href: string): void => {
    const a = document.createElement('a');
    a.textContent = label;
    a.href = href;
    a.style.cssText = 'margin:0 8px;color:#B8FF5A;';
    div.appendChild(a);
  };
  if (result === 'victory' && next) link('next mission →', `?mission=${next}`);
  link(result === 'victory' ? 'replay' : 'try again', `?mission=${missionId}`);
  link('menu', '?');
  document.body.appendChild(div);
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
    showMenu(stage, loadLedger());
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
  await renderer.init(stage);

  // Load sprite sheets for unit types that have rendered art (non-blocking).
  // facingOffset: which sprite index looks along world +x. The render rig's
  // start rotation decides it per sheet — calibrate by pointing a unit due
  // east and checking the barrel agrees with the tracer.
  type SpriteSpec = {
    path: string;
    frames?: number;
    turretPath?: string;
    facingOffset?: number;
    facingReverse?: boolean;
  };
  // Measured off the sheets themselves: world bearing ≈ (5 - k) mod 16, i.e.
  // the rig rotates the object the other way with frame 5 looking east.
  const TANK: SpriteSpec = {
    path: `${BASE}sprites/TNK_HULL/`,
    turretPath: `${BASE}sprites/TNK_TURR/`,
    facingOffset: 5,
    facingReverse: true,
  };
  const FOOT: SpriteSpec = { path: `${BASE}sprites/INF/`, frames: 5, facingOffset: 5, facingReverse: true };
  const SPRITE_MAP: Record<string, SpriteSpec> = {
    mbt_lavi: TANK,
    inf_squad: FOOT,
    at_team: FOOT,
    mortar_team: FOOT,
    militia_cell: FOOT,
    rpg_team: FOOT,
    atgm_cell: FOOT,
    mortar_crew: FOOT,
  };
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
  const overlay = new DebugOverlay(
    document.body,
    sim,
    () => renderer.selection,
    getMission,
    () => renderer.hoverStructure
  );

  // Always-visible escape hatch back to the campaign menu.
  // Top bar: menu and audio, laid out side by side so neither can collide.
  const topBar = document.createElement('div');
  topBar.style.cssText =
    'position:absolute;top:8px;left:50%;transform:translateX(-50%);display:flex;gap:8px;';
  document.body.appendChild(topBar);

  const menuBtn = document.createElement('a');
  menuBtn.textContent = '⌂ menu';
  menuBtn.href = '?';
  menuBtn.style.cssText = 'padding:5px 12px;color:#F2E8D5;text-decoration:none;' + PANEL;
  topBar.appendChild(menuBtn);

  // Audio toggle, next to the menu. Mirrors the `m` key both ways.
  const muteBtn = document.createElement('button');
  muteBtn.style.cssText = 'padding:5px 12px;cursor:pointer;' + PANEL;
  const paintMute = (muted: boolean): void => {
    muteBtn.textContent = muted ? '🔇 muted' : '🔊 sound';
    muteBtn.style.opacity = muted ? '0.6' : '1';
  };
  paintMute(false);
  muteBtn.addEventListener('click', () => {
    paintMute(audio.toggle());
    muteBtn.blur(); // keep the keyboard on the battlefield, not the button
  });
  topBar.appendChild(muteBtn);

  const start = mission?.map.player_start;
  if (start) {
    renderer.camera.x = start[0];
    renderer.camera.y = start[1];
  }

  // Refreshed a few times a second from the game loop when production exists.
  let productionTick: (() => void) | null = null;

  // Field production bar: reinforcements deploy at player_start after their
  // build time, paid from mission logistics.
  if (runtime && mission?.resources) {
    const rt = runtime;
    const bar = document.createElement('div');
    bar.style.cssText =
      'position:absolute;bottom:8px;left:8px;display:flex;gap:6px;' +
      'font:11px ui-monospace,Menlo,monospace;';
    for (const u of Object.values(units)) {
      if (u.faction !== 'kdf') continue;
      const btn = document.createElement('button');
      const locked = rt.buildBlockedReason(u.id);
      btn.textContent = locked ? `🔒 ${u.name}` : `${u.name} (${u.cost.logistics})`;
      btn.title = locked ?? `${u.cost.logistics} logistics`;
      btn.style.cssText =
        'background:rgba(20,21,15,0.88);color:#F2E8D5;border:1px solid #5C625F;' +
        'border-radius:4px;padding:6px 8px;cursor:pointer;' +
        (locked ? 'opacity:0.5;' : '');
      btn.addEventListener('click', () => {
        const why = rt.buildBlockedReason(u.id);
        if (why !== null) {
          overlay.note(`<b>${u.name}</b> is locked — ${why}`, '#E8C33A');
          return;
        }
        if (rt.requestBuild(u.id)) {
          overlay.note(`<b>building</b> ${u.name} — deploys at the start line`, '#A9C4D1');
        } else {
          overlay.note(`cannot build ${u.name} — insufficient logistics`, '#B8A182');
        }
      });
      bar.appendChild(btn);
    }
    document.body.appendChild(bar);

    // Production queue: one progress bar per unit under construction.
    const queueUi = document.createElement('div');
    queueUi.style.cssText =
      'position:absolute;bottom:46px;left:8px;display:flex;flex-direction:column;gap:4px;' +
      'font:11px ui-monospace,Menlo,monospace;color:#F2E8D5;';
    document.body.appendChild(queueUi);
    const nameOf = new Map(Object.values(units).map((u) => [u.id, u.name]));
    const refreshQueue = (): void => {
      const q = rt.production;
      queueUi.replaceChildren();
      for (const item of q) {
        const row = document.createElement('div');
        row.style.cssText =
          'background:rgba(20,21,15,0.88);border:1px solid #5C625F;border-radius:4px;' +
          'padding:4px 8px;width:210px;';
        const label = document.createElement('div');
        const secs = Math.ceil(item.ticksLeft / TICKS_PER_SECOND);
        label.textContent = `${nameOf.get(item.unit) ?? item.unit} — ${secs}s`;
        const pct = item.totalTicks > 0 ? (item.doneTicks / item.totalTicks) * 100 : 100;
        const track = document.createElement('div');
        track.style.cssText = 'margin-top:3px;height:5px;background:#14150F;border-radius:2px;';
        const fill = document.createElement('div');
        fill.style.cssText = `height:100%;width:${pct.toFixed(1)}%;background:#B8FF5A;border-radius:2px;`;
        track.appendChild(fill);
        row.appendChild(label);
        row.appendChild(track);
        queueUi.appendChild(row);
      }
    };
    productionTick = refreshQueue;
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
  dragBox.style.cssText =
    'position:absolute;display:none;border:1px dashed #B8FF5A;background:rgba(184,255,90,0.08);pointer-events:none;';
  document.body.appendChild(dragBox);
  let dragStart: { x: number; y: number } | null = null;
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
    sim.queueCommand({ kind: 'attackMove', ids: mine, x: fx.from(w.x), y: fx.from(w.y) });
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
    if (ev.key === 'm') {
      const muted = audio.toggle();
      paintMute(muted);
      overlay.note(muted ? 'audio muted' : 'audio on', '#8E9491');
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
        overlay.note(
          mine.length ? `<b>group ${slot}</b> — ${mine.length} unit(s)` : `group ${slot} cleared`,
          '#B8FF5A'
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
        if (described) overlay.note(described[0], described[1]);
        if (me.kind === 'missionEnd') {
          if (me.result === 'victory') {
            saveLedger({ ...ledger, ...me.ledger });
            overlay.note('<b>campaign ledger updated</b> — survivors and ROE carried forward', '#A9C4D1');
          }
          if (missionId) showEndScreen(me.result, me.roeRating, me.survivors.length, missionId);
        }
      }
    }
    overlay.onTick(events);
    if (productionTick && sim.tickCount % 5 === 0) productionTick();
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
    pre.style.cssText = 'color:#D93A2B;padding:2rem;white-space:pre-wrap;';
    pre.textContent = `boot failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`;
    stage.appendChild(pre);
  }
});
