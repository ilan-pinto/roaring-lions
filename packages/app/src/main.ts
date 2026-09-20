// @lions/app — shell. Composes sim + render + data.
// Two modes: the M0 sandbox (default) and mission mode
// (?mission=<id>), where a MissionRuntime interprets declarative mission
// JSON. The app owns the real-time loop: the sim ticks at a fixed 20 Hz from
// an accumulator; the renderer interpolates between ticks (invariant 1).

import { objectiveZonesFor } from './objective-zones';
import { assignNames, nameKind, type NameKind, type NamesJson } from './names';
import { SLOTS_ISSUED_KEY, issueSlots, reattachSlots } from './roster-slots';
import {
  Sim,
  fx,
  HALF,
  TICKS_PER_SECOND,
  CivilianFlight,
  MissionRuntime,
  resolveUpgrades,
  starRoeFloor,
  starsEarned,
  zoneContains,
  creditsFor,
  creditInputFrom,
  type MissionEvent,
  type MissionJson,
  type TunnelRouteJson,
  type UnlockGate,
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
  QUALITY_PRESETS,
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
  commander,
  names,
  structures as structureCatalogue,
  parseMap,
  applyTerrain,
  applyUpgrades,
  applyMissionLocale,
  DECOR,
  paletteColor,
  paletteTeamColors,
  variantAwareResolver,
  audioManifest,
  vfxEmitters,
  type MapJson,
  type MissionLocaleOverlay,
  type UpgradableUnit,
} from '@lions/data';
import { TERRAIN_GROUND_TEXTURE, TERRAIN_THEMES } from './terrain-themes';
import './ui/theme.css';
import { Hud, type HudCommanderInfo, type MissionView, type OrderHandlers, type Tone } from './ui/hud';
import { hintFor, loadSeen, markSeen } from './ui/hint-model';
import { portraitUrl, unitIcon, unitPlate, type SheetManifest } from './ui/portrait';
import { Minimap, MINIMAP_SIZE, flipRows, objectivePoint } from './ui/minimap';
import { alertsForTick, initAlertState, type AlertWorld } from './ui/alerts';
import { showMenu, showCampaign, showSandbox, showEndScreen, type EndScreenDebrief } from './ui/menu';
import { showBrigade } from './ui/brigade';
import { showDebrief, type DebriefOptions } from './ui/debrief';
import { showSettings, type SettingsDeps } from './ui/settings-panel';
import { keymapRows } from './ui/settings-keymap';
import { EDGE_MARGIN_PX, clampZoom, edgeVector, panDelta, zoomAnchor } from './ui/camera-input';
import { closeOpenDialog, confirmDialog, isDialogOpen } from './ui/confirm';
import { closeTip } from './ui/tooltip';
import { objectiveStatusShout } from './ui/objective-status';
import { pauseMenu } from './ui/pause';
import { advance as advanceClock, type Clock } from './shell/clock';
import { applySettings, loadSettings, saveSettings, settingsBus, type Settings } from './settings';
import { bindingsFrom, escapeTarget, heldAction, isAction, keyLabel, overridesOf, passesThroughModal, resolveKey, shouldYieldSpace } from './input/keymap';
import { buyUnlock, buyUpgrade, payMission } from './brigade-account';
import { tierLine } from './ui/grade-copy';
import { speakerPlate, speakerPortrait } from './ui/hud-model';
import { briefingBeats, broughtFor, showLoading } from './ui/loading';
import { objectivesPanel, type ObjectiveRow } from './ui/objectives';
import { showKeysOverlay } from './ui/keys-overlay';
import { groupBar, groupChips } from './ui/group-bar';
import { isIdle, nextIdle, type IdleFacts } from './ui/idle';
import { escapeHtml, evacuatedNotice, removedNotice, triggerLabel } from './ui/mission-notice';
import { ReinforcementDock } from './ui/production';
import { doctrineTags } from './ui/dock-model';
import {
  applyIntent,
  issueOrder,
  resolvePointer,
  resolveKeyVerb,
  type OrderSink,
  type PlayerIntent,
  type IntentWorld,
} from './input/intents';
import {
  ANIMATED_CURSORS,
  cursorFor,
  cursorKey,
  badgeFor,
  type BadgeHints,
  type CursorName,
} from './input/cursor';
import { roleBucket } from './ui/role';
import { roeNotice } from './ui/roe-notice';
import { sandboxAnchors, type SandboxAnchors } from './sandbox-anchors';
import {
  sandboxDitchRows,
  sandboxFlaggedZones,
  sandboxRefuge,
  sandboxTunnelRoute,
} from './sandbox-extras';
import {
  SANDBOX_CIV,
  SANDBOX_KDF,
  SANDBOX_ENEMY,
  SANDBOX_SUR,
  SANDBOX_TUNNEL_KDF,
  sandboxUnitTypes,
  type SandboxExtras,
} from './sandbox-force';
import {
  RIGGED_UNIT_MESHES,
  VEHICLE_UNIT_MESHES,
  BUILDING_MESHES,
  DECOR_MESHES,
  VFX_MESHES,
  meshUrl,
  dracoDecoderPath,
  missionUnitTypes,
  decorFamiliesFor,
  hasUnitMesh,
  spriteSheetPlan,
} from './mesh-catalogue';
import { readFlags, sandboxHelp, unknownParams } from './sandbox-help';
import { registerServiceWorker } from './service-worker';
import {
  Router,
  interceptLinks,
  legacyRedirect,
  stripBase,
  type Disposer,
  type RouteRequest,
} from './shell/router';
import { routes } from './shell/links';
import { resolveRendererChoice, RENDERER_STORAGE_KEY } from './renderer-choice';
import { initTutorial, advance, type TutorialState, type StepJson } from './tutorial/runtime';
import { tutorialPanel, type TutorialPanel } from './tutorial/panel';
import {
  parseWorld,
  parseCountries,
  parseCommander,
  campaignRoe,
  campaignSummary,
  commanderForMission,
  continueTarget,
  hostagesAccount,
  hostagesLine,
  nextMissionAfter,
  newlyUnlocked,
  promotionAfter,
  villainState,
  regionForTown,
  villainPortrait,
  possibleStars,
} from './campaign';
import { commanderPortraitUrl } from './portrait-catalogue';
import { browserLedgerStore, type CampaignLedger } from './ledger-store';
import { showSaves, type SavesDeps } from './ui/saves';
import { showCredits, type CreditsDeps } from './ui/credits';
import { LOCALES, applyLocale, loadLocale } from './i18n/locales';
import { currentLocale, missingKeys, setCatalogue, t } from './i18n/t';
import { pseudo } from './i18n/pseudo';

/** Deploy base ('/' locally, '/<repo>/' on GitHub Pages) — every asset URL
 *  is built from it so the same bundle works in both places. */
const BASE = import.meta.env.BASE_URL;

const MS_PER_TICK = 1000 / TICKS_PER_SECOND;

/** `window.localStorage` can throw on the PROPERTY ACCESS itself (private mode, site
 *  data blocked) rather than on a method call.
 *
 *  Two callers left, and both are deliberate (R-9): the SETTINGS store
 *  (`settings.ts`) and the hint line's first-use memory (`ui/hint-model.ts`).
 *  Those are facts about the person and the device, not about the campaign, so
 *  they stay on their own guarded access while WP-ST6 moves the campaign to a
 *  server. Everything to do with the ledger, the brigade account and the save
 *  slots goes through `ledgerStore` below instead -- one object, one decision
 *  about what a blocked store means, made once in `ledger-store.ts` rather
 *  than re-made at ten call sites in this file. */
function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The app's one door to the campaign ledger, the brigade account and the save
 *  slots (`ledger-store.ts`). One per page, because it is a handle on the
 *  browser's own store rather than a snapshot of anything -- every read below
 *  still goes to storage at the moment it is made. */
const ledgerStore = browserLedgerStore();

/** `{ id, role }` for `nameKind` (spec §4.7), from the same `units` catalogue every
 *  other lookup in this file reads. An unknown id (a future or removed unit type
 *  surviving in an old save) falls back to a plain squad rather than throwing. */
function unitFor(typeId: string): { id: string; role: string } {
  const u = units[typeId as keyof typeof units] as { id: string; role: string } | undefined;
  return u ?? { id: typeId, role: 'infantry' };
}

/** A KDF unit JSON entry's `unlock` gate, mapped from the authored
 *  `roe_rating_min`/`stars_min`/`after_mission`/`price` field names to `UnlockGate` --
 *  the one mapping `unitInfo`, `kdfUnits` and `resolveUpgrades`'s lookup all share.
 *  `bought` is resolved here and nowhere else (spec §4.4) -- a purchase opens the
 *  unit on every surface that reads this gate by construction. */
function kdfUnlockGate(u: (typeof units)[keyof typeof units], bought: ReadonlySet<string>): UnlockGate | undefined {
  const unlock = 'unlock' in u
    ? (u.unlock as { roe_rating_min?: number; stars_min?: number; after_mission?: string; price?: number })
    : undefined;
  if (!unlock) return undefined;
  return {
    roeMin: unlock.roe_rating_min,
    starsMin: unlock.stars_min,
    afterMission: unlock.after_mission,
    price: unlock.price,
    bought: bought.has(u.id),
  };
}

/** What `roleBucket` needs to pick a role mark for the brigade screen's
 *  mesh-only stand-in hatch (F2), reproduced from a unit's own JSON exactly
 *  as `sim.ts`'s `addUnitType` derives it (`abilities.includes('kamikaze')`,
 *  `hull.transport_slots ?? 0`, `hull.armor.front < 30` -- tuning.ts's
 *  `SOFT_ARMOR_LIMIT` pins the threshold at 30mm) rather than a new rule,
 *  since this screen has no running Sim to read the real fields off of. The
 *  `in` checks are the same union-narrowing `kdfUnlockGate` above uses --
 *  `(typeof units)[keyof typeof units]` is a union over every faction's unit
 *  JSON, and not every member declares `abilities` or `hull.transport_slots`
 *  at all. */
function kdfBrigadeTraits(
  u: (typeof units)[keyof typeof units]
): { isKamikaze: boolean; transportSlots: number; isSoft: boolean } {
  const abilities = 'abilities' in u ? (u.abilities as string[]) : [];
  const hull = u.hull as { transport_slots?: number; armor: { front: number } };
  return {
    isKamikaze: abilities.includes('kamikaze'),
    transportSlots: hull.transport_slots ?? 0,
    isSoft: hull.armor.front < 30,
  };
}

interface SandboxForce {
  /** Side 0. Who can shepherd a civilian, and who can carry one. */
  player: number[];
  /** Side 2. A CONTIGUOUS id block, which is what makes the four figures come
   *  out two apiece — `pickMeshVariant` is `entityId % variants.length`. */
  civilians: number[];
}

/**
 * The sandbox force, placed relative to the map's own anchors.
 *
 * The offsets are the coordinates the hardcoded version used, expressed
 * against beit_sahwan_outskirts' `kdf_assembly` and `town_center` — so that
 * map's sandbox is unchanged, and every other map gets the same formation
 * translated onto its own ground.
 *
 * The five placement TABLES moved to `./sandbox-force` when mesh loading
 * became roster-driven: `sandboxUnitTypes` there answers "which unit types
 * will this sandbox place" off the very arrays this function iterates, so the
 * mesh plan cannot fall behind the force. This function stayed here because it
 * needs `Sim`, `fx` and the open-tile spiral.
 *
 * Returns the ids it made, in two lists, because `&civ` needs both: the
 * civilian flight rule takes the crowd it steps and the force that shepherds
 * it. Nothing else reads them.
 */
function sandboxSpawns(
  sim: Sim,
  typeOf: Map<string, number>,
  anchors: SandboxAnchors,
  extras: SandboxExtras = { tunnel: false, sur: false, civ: false }
): SandboxForce {
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

  const force: SandboxForce = { player: [], civilians: [] };
  for (const [id, dx, dy] of SANDBOX_KDF) force.player.push(spawn(id, 0, fxA + dx, fyA + dy));
  if (extras.tunnel) {
    for (const [id, dx, dy] of SANDBOX_TUNNEL_KDF) {
      force.player.push(spawn(id, 0, fxA + dx, fyA + dy));
    }
  }
  for (const [id, dx, dy] of SANDBOX_ENEMY) spawn(id, 1, hxA + dx, hyA + dy, facing);
  if (extras.sur) {
    for (const [id, dx, dy] of SANDBOX_SUR) spawn(id, 1, hxA + dx, hyA + dy, facing);
  }
  // Civilians go LAST, on side 2, so their ids are one unbroken run whatever
  // the other flags added before them. The variant rotation is arithmetic on
  // the id, so a gap in the block is a repeated figure.
  //
  // They stand on the MIDPOINT of the two anchors: a mission puts civilians on
  // the ground being fought over, and anywhere else here would be a crowd the
  // player's advance never reaches — which is the whole of what `&civ` is for.
  if (extras.civ) {
    const cx = (fxA + hxA) / 2;
    const cy = (fyA + hyA) / 2;
    for (const [id, dx, dy] of SANDBOX_CIV) force.civilians.push(spawn(id, 2, cx + dx, cy + dy));
  }
  return force;
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
      // I10: the status word goes through the catalogue (shared with the
      // pause menu's objective list), not `e.status.toUpperCase()`.
      // Minor 6: `label` reaches an `innerHTML` sink -- `hud.note` ->
      // `hud.ts`'s notice row -- and its author is mission DATA, now including
      // a translator's `data/locales/<lang>/missions.json` overlay. The
      // `trigger` branch below has always escaped its label; this one did not.
      return e.status === 'complete'
        ? [t('mission.notice.objectiveComplete', { label: escapeHtml(label) }), 'good']
        : [t('mission.notice.objectiveStatus', { status: objectiveStatusShout(e.status), label: escapeHtml(label) }), 'bad'];
    }
    case 'trigger': {
      const label = triggerLabel(mission, e.id);
      return label === null ? null : [escapeHtml(label), 'warn'];
    }
    case 'wave':
      return [t('mission.notice.wave', { n: e.count }), 'bad'];
    case 'roe': {
      const first = !narratedRoeReasons.has(e.reason);
      narratedRoeReasons.add(e.reason);
      return roeNotice(e.penalty, e.reason, e.score, mission.roe?.fail_below, first);
    }
    case 'built':
      return [t('mission.notice.built', { unit: e.unit }), 'info'];
    case 'say':
      // The commander bar is the one surface for a story line now -- `hud.say`
      // already runs for every `say` event (see the mission-loop handler
      // below), and echoing it into the feed too meant one sentence with two
      // attributions on two unlinked timers: the bar's own dwell clock and
      // the feed's 9s note() timeout.
      return null;
    case 'removed':
      return removedNotice(e.side, e.unit);
    case 'evacuated':
      return evacuatedNotice();
    case 'missionEnd':
      return [
        e.result === 'victory'
          ? t('mission.notice.missionAccomplished', { roe: e.roeRating, n: e.survivors.length })
          : t('mission.notice.missionFailed'),
        e.result === 'victory' ? 'good' : 'bad',
      ];
    default:
      return null;
  }
}

function bootError(stage: HTMLElement, title: string, body: string, home = routes.menu()): void {
  const div = document.createElement('div');
  div.className = 'rl-boot-error';

  const h = document.createElement('h2');
  h.textContent = title;
  div.appendChild(h);

  const p = document.createElement('p');
  p.textContent = body;
  div.appendChild(p);

  const a = document.createElement('a');
  a.href = home;
  a.textContent = t('nav.backToMenu');
  div.appendChild(a);

  stage.appendChild(div);
}

/** `ui/saves.ts`'s `download`: a Blob URL and a click on an `<a download>`
 *  nobody sees, revoked right after -- the ordinary way a page hands the
 *  player a file with no server round trip. */
function downloadFile(name: string, json: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** `ui/saves.ts`'s `pickFile`: an `<input type=file>` nobody sees, opened by a
 *  synthetic click and read through `File.text()`. Resolves to null on a
 *  cancelled picker (a `change` with no file chosen), never rejects. */
function pickJsonFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      void file.text().then(resolve);
    });
    input.click();
  });
}

/** `ui/credits.ts`'s `fetchText`: a font's OFL body, fetched only when its
 *  `<details>` is opened. Rejects on a network failure or a non-OK response
 *  (a 404 for a licence file that moved) -- that screen turns either into
 *  "licence text unavailable offline" rather than an unhandled rejection. */
async function fetchLicenceText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
}

/**
 * The mission-text locale overlay (`data/locales/<lang>/missions.json`,
 * `data/locales/README.md`), for `applyMissionLocale`'s second argument.
 * `en` is the source text on every mission file already, so it is never
 * fetched -- the same short-circuit `i18n/locales.ts`'s `loadLocale` takes
 * for the chrome catalogue. Any OTHER id (an unshipped locale, a genuine
 * 404) is a no-op overlay rather than a boot failure: a translator's file
 * going missing must degrade to English, not break the mission.
 */
async function loadMissionOverlay(lang: string, base: string): Promise<MissionLocaleOverlay | null> {
  if (lang === 'en') return null;
  try {
    const res = await fetch(`${base}locales/${lang}/missions.json`);
    if (!res.ok) return null;
    return (await res.json()) as MissionLocaleOverlay;
  } catch {
    return null;
  }
}

/**
 * The mixer, one per document rather than one per screen. Recorded clips where
 * they exist, procedural synth per-sound where they do not — so the library
 * can be filled in one file at a time.
 *
 * It used to be built inside `main()`, and that was still one per screen,
 * because every screen was its own page load. The router makes the menu, the
 * campaign board, the free-play picker and a mission one document, so the music
 * has to survive a route change -- and a second `BattleAudio` on the way into a
 * mission would be a second manifest load and a second set of gesture
 * listeners. Lazy rather than module-eager only so that importing this module
 * constructs no audio graph. `attach()` still waits for the browser's first
 * gesture.
 */
let mixer: BattleAudio | null = null;
function battleAudio(): BattleAudio {
  if (mixer === null) {
    mixer = new BattleAudio();
    mixer.useManifest(audioManifest as AudioManifest, `${BASE}audio/`);
    mixer.attach();
  }
  return mixer;
}

/**
 * What the brigade account says RIGHT NOW: the units bought and the tiers
 * owned. Every surface that reads a KDF unit's unlock gate through
 * `kdfUnlockGate` starts here -- the dock's `unitInfo`, the brigade screen,
 * `resolveUpgrades`'s lookup and the debrief's `kdfUnits`.
 *
 * Read once per MOUNT, not once per page load, and that is the whole reason
 * it is a function. A purchase used to end in `window.location.reload()`,
 * which re-ran `main()` and with it this read; the brigade screen re-mounts
 * through the router now, so a value resolved once at boot would leave the
 * roster showing the unit the player has just bought as still locked.
 */
function accountState(): {
  boughtUnits: Set<string>;
  ownedTiers: Record<string, Record<string, number>>;
} {
  // A blocked store reads as the empty account (`ledger-store.ts`), which has
  // no unlocks and no upgrades -- the same two values the `storage ? ... :
  // null` this used to carry produced. The handle itself is no longer returned:
  // callers that need to know whether there is anywhere to WRITE ask
  // `ledgerStore.available`, and the rest just read.
  const account = ledgerStore.readAccount();
  return {
    boughtUnits: new Set(account.unlocks),
    // An empty account is `{}`, and `applyUpgrades` treats an absent track as
    // the identity, so that case registers the raw JSON unchanged -- today's
    // behaviour (spec 2026-09-15 §4.3, D5: the sim never learns a tier exists).
    ownedTiers: account.upgrades,
  };
}

/**
 * Start the campaign over: the ledger, and the tutorial's "already learned"
 * mark with it. Without the second line `?fresh` is a one-way door -- finish
 * the tutorial once and Beit Sahwan 0 replays with no step panel at all,
 * which reads as the tutorial being broken rather than already learned.
 *
 * A function because it now has two callers that used to be one: the `fresh`
 * landing flag, and the menu's confirmed "reset campaign ledger" button, which
 * was a navigation to `?fresh=1` purely so that this code would run.
 *
 * The brigade account (`brigade-account.ts`) deliberately survives it: spec
 * 2026-09-15 §4.1 -- a second campaign starts with the brigade you built.
 */
function purgeCampaign(): void {
  // Minor 5: through the store, not the global. `window.localStorage` can throw
  // on the PROPERTY ACCESS itself in a private window or with site data blocked
  // (`safeStorage()`'s own doc comment), and this one runs on the `fresh`
  // landing -- so a player in that state met a thrown boot error instead of a
  // menu, for a store that has nothing in it to purge. Both calls REMOVE their
  // key rather than writing an empty value, exactly as before.
  ledgerStore.clearLedger();
  ledgerStore.setTutorialDone(false);
}

// Which sheet a unit uses -- facing convention, frame counts, clip list and
// draw scale all come from the sheet's own manifest, written by the rig that
// produced the files. At module scope rather than inside a screen, because
// two of them read it: the brigade roster (for its portraits, with no map, sim
// or renderer of its own to have loaded a sheet through) and the battlefield.
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
  // The two star-gated vehicles (docs/campaign/special_units/design.md
  // §4-5). Hull only, like the jeep: each carries a fixed gun, not a
  // traversing station. Rendered from the same kit-authored sources their
  // GLBs were exported from, so the billboard, the portrait and the mesh
  // agree; the sheet is what gives a dead one a wreck instead of the grey
  // cross, since a mesh vehicle's death falls back to its sheet.
  scout_shachaf: { path: `${BASE}sprites/SHACHAF_HULL/` },
  apc_kipod: { path: `${BASE}sprites/KIPOD_HULL/` },
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
  // The star-gated Tzinah team (design.md §3): the upright shield is its
  // silhouette, the same kit the mesh was exported from.
  breach_team: { path: `${BASE}sprites/INF_BREACH/` },
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

/**
 * A unit type's portrait, resolved the same way the mission HUD resolves one
 * for its card (`portraits[typeId]`, built from `SPRITE_MAP` and each
 * sheet's own cropped `unitIcon` or, failing that, its manifest via
 * `portraitUrl`) -- fetched fresh here because the brigade screen has no
 * running renderer to have already fetched it for. A type absent from
 * `SPRITE_MAP`, or whose manifest 404s with no icon either, resolves to
 * `null`; the caller draws the reserved hatch for that, same as the HUD's
 * card does. `isIcon` tells the caller which of the two pictures it got, so
 * it can set `data-icon` the same way the mission HUD does.
 */
const loadBrigadePortrait = async (id: string): Promise<{ url: string; isIcon: boolean } | null> => {
  const spec = SPRITE_MAP[id];
  if (!spec) return null;
  const icon = unitIcon(spec.path);
  if (icon !== null) return { url: icon.url, isIcon: true };
  try {
    const res = await fetch(`${spec.path}manifest.json`);
    if (!res.ok) return null;
    const manifest = (await res.json()) as SheetManifest;
    const url = portraitUrl(spec.path, manifest);
    return url === null ? null : { url, isIcon: false };
  } catch (err) {
    console.warn(`[lions] portrait manifest FAILED for ${id}:`, err);
    return null;
  }
};

async function main(): Promise<void> {
  // The first statement, so the shell's own question -- did that navigation
  // reload the page? -- has an answer. One `rl:boot` mark per document,
  // however many screens the player walks through.
  performance.mark('rl:boot');
  const stage = document.getElementById('stage');
  if (!stage) throw new Error('no #stage');

  // --- audio, on every screen ----------------------------------------------
  // Built before the route table so the menu, the campaign board and the
  // free-play picker carry the music too, not just a mission -- and now it
  // outlives all of them, since a route change no longer reloads the page.
  const audio = battleAudio();

  // --- settings, on every screen --------------------------------------------
  // Loaded and applied before anything else mounts: `applySettings` (settings.ts)
  // is the ONLY writer of the `--ui-scale`/`--text-size` inline overrides and
  // the `data-motion`/`data-cvd` attributes the whole sheet reads off
  // `document.documentElement`, so the menu itself has to carry a saved scale
  // or motion preference, not just a mission. The mixer needs its gains before
  // the first screen's music starts for the same reason.
  const settingsStore = safeStorage();
  let settings: Settings = loadSettings(settingsStore);
  applySettings(settings, document.documentElement);
  audio.setGains(settings.audio);
  /** `settingsDeps.set` persists, applies and re-broadcasts through here --
   *  `onChange` is how a SECOND mount of the settings panel (Task 6's pause
   *  menu) and the keymap section (Task 5) learn a change happened without
   *  polling `get()` every frame. The bus itself lives in settings.ts (with
   *  its own tests) so a throwing subscriber can be proven not to starve the
   *  rest without booting the whole shell. */
  const bus = settingsBus();
  const settingsDeps: SettingsDeps = {
    get: () => settings,
    set: (next) => {
      settings = next;
      saveSettings(settingsStore, next);
      applySettings(next, document.documentElement);
      audio.setGains(next.audio);
      bus.notify(next);
    },
    onChange: bus.onChange,
    // `document.fullscreenEnabled` is the browser's own permission check
    // (iframe embeds without `allow="fullscreen"` read false) -- a row for a
    // control that would silently no-op is worse than no row.
    fullscreen: document.fullscreenEnabled
      ? {
          supported: () => true,
          active: () => document.fullscreenElement !== null,
          set: async (on) => {
            if (on) await document.documentElement.requestFullscreen();
            else if (document.fullscreenElement) await document.exitFullscreen();
          },
        }
      : null,
    audio,
    locales: LOCALES,
    // `bindings()` always answers the FULL table (defaults plus valid
    // overrides), never the raw override map settings.ts stores -- a rebind
    // row reads and writes bindings, not the sparse form. `set` round-trips
    // the other way: `overridesOf` strips it back to only what differs from
    // the shipped defaults before it is written into `settings.controls.bindings`,
    // which is the same sparse shape `bindingsFrom` reads back out.
    keymap: keymapRows({
      bindings: () => bindingsFrom(settings.controls.bindings),
      set: (next) =>
        settingsDeps.set({
          ...settings,
          controls: { ...settings.controls, bindings: overridesOf(next) },
        }),
    }),
    build: __APP_BUILD__,
  };

  // --- locale, before any screen mounts -------------------------------------
  // `?lang=<id>` overrides the saved `settings.language` for THIS load only
  // -- it is never written back to storage, so a shared link cannot silently
  // change what a returning player sees next time. `?pseudo=1` swaps the real
  // catalogue for the `en` one run through the pseudo-locale transform
  // (i18n/pseudo.ts) instead of a real language -- the fake-translation pass
  // a screen walk uses to catch a string that never went through `t()` at
  // all. Both are read off `window.location.search` for the same reason the
  // service worker escape hatch below is: before the router rewrites a
  // legacy query URL into a path. Both join `KNOWN_PARAMS` (sandbox-help.ts)
  // so `unknownParams` does not report either as a typo, and neither is in
  // `router.start`'s own `drop` list below, so a reload keeps carrying them.
  const q = new URLSearchParams(window.location.search);
  const lang = q.get('lang') ?? settings.language;
  const activeLocale = q.has('pseudo') ? 'pseudo' : lang;
  const cat = await loadLocale(activeLocale, BASE);
  setCatalogue(activeLocale, cat, q.has('pseudo') ? pseudo : undefined);
  applyLocale(document.documentElement, lang);
  // Dev-only: which keys a screen walk asked for and never got, without
  // scraping console output for `[i18n] missing key: …` lines.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__lionsI18n = { missingKeys };
  }

  // Level load time step 5. Fire-and-forget and deliberately NOT awaited: the
  // worker is a cache for the NEXT load, so making this boot wait on it would
  // trade the thing it is meant to buy. It never rejects (see its own doc
  // comment) -- a browser that refuses registration keeps the game exactly as
  // it is today.
  //
  // Read off `window.location.search` BEFORE the router rewrites a legacy
  // query URL into a path: `?nosw` is the recovery switch for a cached build
  // that has gone wrong, and a switch that only survives the redirects that
  // happen to carry it is not one.
  void registerServiceWorker(BASE, window.location.search);

  // --- where did we land? --------------------------------------------------
  // `?fresh` purges the campaign, but never on the way INTO a mission -- the
  // pre-router guard was `params.get('mission') === null`, and this asks the
  // same question of the path the router is about to mount, whether the player
  // typed a path or an old query URL.
  const landingSearch = window.location.search;
  const landingPath = legacyRedirect(landingSearch)?.path ?? stripBase(BASE, window.location.pathname);
  const landingIsMission = landingPath.startsWith('/mission/');
  if (new URLSearchParams(landingSearch).has('fresh') && !landingIsMission) purgeCampaign();

  /** The landing. The one screen that defines no `window.__lions`. */
  function mountMenu(host: HTMLElement): Disposer {
    const worldData = parseWorld(world);
    // Minor 4 + Minor 5: one predicate, through the store. This runs on every
    // menu MOUNT now rather than once per page load, so a store whose property
    // access throws would have thrown on every return to the menu.
    const tutorialIsDone = ledgerStore.tutorialDone();
    // Where the campaign is RIGHT NOW (Task 7): the tutorial while nothing has
    // been played, else the first open mission of wherever the map is live.
    // Null once every authored mission is done, which is `continue: undefined`
    // below -- the first nav item reverts to the plain "Campaign" link.
    const target = continueTarget(worldData, ledgerStore.readLedger(), {
      id: 'beit_sahwan_0_tutorial',
      done: tutorialIsDone,
    });
    return showMenu(host, {
      base: BASE,
      version: __GAME_VERSION__,
      world: worldData,
      audio: { isMuted: () => audio.isMuted(), toggle: () => audio.toggle() },
      tutorial: {
        id: 'beit_sahwan_0_tutorial',
        name: missions.beit_sahwan_0_tutorial.name ?? 'Tutorial',
        done: tutorialIsDone,
      },
      continue: target
        ? {
            missionId: target.missionId,
            name: (missions as Record<string, MissionJson | undefined>)[target.missionId]?.name ?? target.missionId,
            kind: target.kind,
          }
        : undefined,
      // Was `window.location.assign('?fresh=1')`: a whole page load whose only
      // jobs were to run the purge and redraw this screen. Both are explicit
      // now, and `force: true` is what redraws a menu the router already
      // considers mounted. Renamed from `reset` (Task 7): the brigade account
      // survives this, on purpose, and "New campaign" says so where "reset
      // campaign ledger" did not.
      newCampaign: () => {
        purgeCampaign();
        void router.navigate(routes.menu(), { replace: true, force: true });
      },
    });
  }

  /** The saves screen (Task 7): every slot under `lions.saves`, over the SAME
   *  door the active campaign already reads and writes through -- see
   *  `profile.ts`'s own header. No storage means no screen: a save slot with
   *  nowhere durable to live is worse than an error card naming why, and
   *  `available` is that question asked once. */
  function mountSaves(host: HTMLElement): Disposer {
    if (!ledgerStore.available) {
      bootError(host, t('boot.savesUnavailable.title'), t('boot.savesUnavailable.body'), routes.menu());
      return () => host.replaceChildren();
    }
    const deps: SavesDeps = {
      store: ledgerStore,
      build: __APP_BUILD__,
      now: () => Date.now(),
      back: routes.menu(),
      download: downloadFile,
      pickFile: pickJsonFile,
      // Nothing to re-read here today: the menu computes `continueTarget`
      // fresh off the ledger every time IT mounts (see `mountMenu` above), so
      // a slot mutation needs no signal beyond the router navigation away
      // from this screen. Kept as a real hook rather than removed from
      // `SavesDeps` -- see that interface's own doc comment.
      onChanged: () => {},
    };
    return showSaves(host, deps);
  }

  /** The map page. publicDir is the repo-root assets/ dir (vite.config.ts), so
   *  the world render is served rather than bundled; the per-country overlay is
   *  built by worldMap from the generated geometry in countries.json. */
  function mountCampaign(host: HTMLElement, req: RouteRequest): Disposer {
    return showCampaign(host, {
      base: BASE,
      world: parseWorld(world),
      countries: parseCountries(countries),
      ledger: ledgerStore.readLedger(),
      commander: parseCommander(commander),
      missionOf: (id) => (missions as Record<string, MissionJson | undefined>)[id],
      portraitUrl: commanderPortraitUrl,
      // The screen used to read `window.location.search` for this itself. No
      // screen reads `window.location` any more: the shell knows which
      // navigation this is and hands the value in.
      renderer: req.query.get('renderer'),
      // So a click on the 3D board's ground changes screen without reloading
      // the document. The flat board's town pins are real anchors and go
      // through `interceptLinks` instead.
      navigate: (h) => void router.navigate(h),
    });
  }

  /** The roster: every KDF unit the campaign knows about, and what still gates
   *  the ones not yet earned. `possibleStars` (campaign.ts, F10) walks the same
   *  towns the campaign map itself walks, counting only missions whose own
   *  ledger contract can carry a star at all -- a town added to `world.json`
   *  counts itself in without an edit here (the tutorial is deliberately off
   *  the map, so it is never in this sum at all). */
  async function mountBrigade(host: HTMLElement): Promise<Disposer> {
    const worldData = parseWorld(world);
    const { boughtUnits, ownedTiers } = accountState();
    const kdfUnits = Object.values(units)
      .filter((u) => u.faction === 'kdf')
      .map((u) => ({
        id: u.id,
        name: u.name,
        role: u.role,
        unlock: kdfUnlockGate(u, boughtUnits),
        ...kdfBrigadeTraits(u),
        upgrades: 'upgrades' in u ? u.upgrades : undefined,
      }));
    const portraits: Record<string, string> = {};
    const portraitIcons = new Set<string>();
    await Promise.all(
      kdfUnits.map(async ({ id }) => {
        const picture = await loadBrigadePortrait(id);
        if (picture === null) return;
        portraits[id] = picture.url;
        if (picture.isIcon) portraitIcons.add(id);
      })
    );
    // What `window.location.reload()` was for: re-read the account and redraw
    // the roster off it. This re-runs THIS mount, which re-reads the account
    // through `accountState()` above -- `force: true` because the URL has not
    // changed and the router would otherwise consider itself already there.
    const redraw = (): void => {
      void router.navigate(routes.brigade(), { replace: true, force: true });
    };
    return showBrigade(host, {
      units: kdfUnits,
      ledger: ledgerStore.readLedger(),
      missionName: (id) => (missions as Record<string, MissionJson | undefined>)[id]?.name,
      portrait: (typeId) => portraits[typeId] ?? null,
      iconIds: portraitIcons,
      // The garage's bay (Task 15/16). `unitPlate` resolves against the
      // plates manifest AND the eager glob of what is actually on disk, so a
      // unit `pnpm plates:units` has not photographed reads as absent and the
      // bay draws its reserved hatch -- never a broken <img>.
      plate: (typeId) => unitPlate(`${BASE}ui/plates/units/`, typeId),
      // The raw unit JSON, for the bay's stat panel and every rung's benefit
      // lines. Same `units` catalogue `kdfUnits` above is built from, so the
      // numbers the garage prints and the numbers `applyUpgrades` hands the
      // sim come from one file. An id this does not know (it cannot happen
      // for a `kdfUnits` entry, but the option is called with whatever the
      // screen selects) hands back a bare `{ id }`, which the panel reads as
      // em-dashes.
      baseOf: (typeId) =>
        ((units as Record<string, unknown>)[typeId] as UpgradableUnit | undefined) ?? { id: typeId },
      possibleStars: possibleStars(worldData, missions as Record<string, MissionJson | undefined>),
      credits: ledgerStore.available ? ledgerStore.readAccount().balance : undefined,
      onReset: ledgerStore.available
        ? () => {
            ledgerStore.resetAccount();
            redraw();
          }
        : undefined,
      onBuy: ledgerStore.available
        ? (unitId, price) => {
            const { account, ok } = buyUnlock(ledgerStore.readAccount(), unitId, price);
            // A refusal here is only reachable with a stale account (e.g. two
            // tabs on the same origin both showing this row as affordable) --
            // the control disabled itself against the balance THIS render
            // read, so `!ok` means the account on disk has since moved.
            // Redrawing re-renders off the true, current state instead of
            // leaving the row showing a purchase that did not happen.
            if (!ok) {
              redraw();
              return;
            }
            ledgerStore.writeAccount(account);
            redraw();
          }
        : undefined,
      owned: ownedTiers,
      onBuyUpgrade: ledgerStore.available
        ? (unitId, track, tier, price) => {
            const { account, ok } = buyUpgrade(ledgerStore.readAccount(), unitId, track, tier, price);
            // Same reasoning as `onBuy` above: the control disabled itself
            // against a stale read, so redraw off the true state instead of
            // returning silently.
            if (!ok) {
              redraw();
              return;
            }
            ledgerStore.writeAccount(account);
            redraw();
          }
        : undefined,
    });
  }

  // --- the screens ---------------------------------------------------------
  // One table. Every href in the UI comes from `shell/links.ts`, every path
  // this table declares is matched by `shell/router.ts`, and the old query
  // URLs (`?campaign`, `?mission=`, `?sandbox=`, `?sandboxes`, `?brigade`)
  // redirect onto these paths on boot and on click -- so the tools and
  // bookmarks that drive the app by query string keep working.
  const router = new Router({
    base: BASE,
    stage,
    routes: [
      { name: 'menu', pattern: '/', mount: (host) => mountMenu(host) },
      { name: 'campaign', pattern: '/campaign', mount: (host, req) => mountCampaign(host, req) },
      { name: 'brigade', pattern: '/brigade', mount: (host) => mountBrigade(host) },
      // The picker. Nothing is passed in: the screen reads the map enumeration
      // and SANDBOX_FLAGS itself, so a new map cannot be missing from it.
      { name: 'free-play', pattern: '/free-play', mount: (host) => showSandbox(host) },
      {
        name: 'sandbox',
        pattern: '/free-play/:map',
        mount: (host, req) =>
          bootBattlefield(host, {
            missionId: null,
            sandboxMap: req.params.map,
            query: req.query,
            signal: req.signal,
            navigate: (href, opts) => void router.navigate(href, opts),
            settings: settingsDeps,
            // Replacing, forced: a plain navigate() to the same path is a
            // no-op (the router only re-mounts on a real path/query change),
            // so Restart needs `force` to re-run this same route's mount --
            // and `replace` so the attempt that was just lost does not sit in
            // history as a back-button trap into a dead sim.
            restart: () => void router.navigate(router.href(req.path, req.query), { replace: true, force: true }),
          }),
      },
      {
        name: 'mission',
        pattern: '/mission/:id',
        mount: (host, req) =>
          bootBattlefield(host, {
            missionId: req.params.id,
            sandboxMap: null,
            query: req.query,
            signal: req.signal,
            navigate: (href, opts) => void router.navigate(href, opts),
            settings: settingsDeps,
            restart: () => void router.navigate(router.href(req.path, req.query), { replace: true, force: true }),
          }),
      },
      {
        name: 'settings',
        pattern: '/settings',
        mount: (host) => showSettings(host, { ...settingsDeps, back: routes.menu() }),
      },
      { name: 'saves', pattern: '/saves', mount: (host) => mountSaves(host) },
      {
        name: 'credits',
        pattern: '/credits',
        mount: (host) =>
          showCredits(host, {
            base: BASE,
            build: __APP_BUILD__,
            back: routes.menu(),
            fetchText: fetchLicenceText,
          } satisfies CreditsDeps),
      },
      // Reserved for Phase 1's briefing screen. Until that exists the path is
      // a redirect rather than a 404, so a link written against it today lands
      // the player in the mission rather than on an error card.
      {
        name: 'briefing',
        pattern: '/briefing/:id',
        mount: (_host, req) => {
          void router.navigate(routes.mission(req.params.id), { replace: true });
          return () => {};
        },
      },
    ],
    notFound: (host, req) => {
      bootError(host, t('boot.notFound.title'), t('boot.notFound.body', { path: req.path }), routes.menu());
      return () => host.replaceChildren();
    },
  });
  // Same-origin anchors become navigations, for the whole life of the
  // document -- there is no point at which this page stops wanting them, so
  // its disposer is dropped rather than stored.
  interceptLinks(document, router);
  // `fresh` has done its work above and is not a route parameter, so it comes
  // off the URL -- except on the way into a mission, where it still means "run
  // this one against an empty ledger" and `bootBattlefield` reads it back off
  // `req.query`, exactly as the pre-router code read it off the query string.
  await router.start({ drop: landingIsMission ? [] : ['fresh'] });
}

/** What `bootBattlefield` needs off the URL, already resolved by the router:
 *  a mission id or a sandbox map (never both), the residual query, the signal
 *  that goes off when a later navigation wins the race, and the one way out. */
export interface BattlefieldRequest {
  missionId: string | null;
  sandboxMap: string | null;
  query: URLSearchParams;
  signal: AbortSignal;
  /** Leave the battlefield. A ROUTER navigation, not `window.location.assign`:
   *  the exits below go through this so the shell keeps one JS realm across a
   *  mission boundary, which is the whole point of the disposer beneath it.
   *  Passed in rather than closed over so `bootBattlefield` stays a function of
   *  its request and the router stays `main()`'s business. */
  navigate: (href: string, opts?: { replace?: boolean; force?: boolean }) => void;
  /** The shell's one settings store -- read live (`req.settings.get()`) rather
   *  than snapshotted, since a pause-menu change (Task 6) must reach the
   *  camera pan speed and the mixer without a re-boot. */
  settings: SettingsDeps;
  /** Re-mount this same battlefield from scratch -- the pause menu's Restart
   *  (Task 6), confirmed by the caller first. A forced, replacing navigation
   *  to this route's own href rather than a bespoke re-init: the router's
   *  existing mount/dispose sequencing is what tears the old sim/renderer down
   *  and boots a fresh one, so there is no second teardown path to keep in
   *  step with the real one. */
  restart(): void;
}

/**
 * The mission and the sandbox: map, sim, renderer, HUD, and the real-time
 * loop. Everything below this line was the tail of `main()` before the router;
 * the boundary is what lets the shell mount a battlefield as one screen among
 * several rather than as the end of boot.
 *
 * The returned disposer really tears the battlefield down: the frame loop, the
 * renderer's GPU context, every window listener and timer below, and the HUD,
 * minimap, overlay, marquee, tutorial panel, end screen and debrief that mount
 * on `document.body` rather than on the stage the router clears. Exits are
 * router navigations now, so leaving a mission and entering another one is one
 * JS realm and no page load -- which `pnpm ui:routes` is the standing proof of.
 *
 * Three rules for anything added in here. Register its teardown with
 * `onDispose(...)` at the point it is CREATED, not in a list at the bottom that
 * drifts. Make the teardown idempotent and self-scoped -- a superseded mount's
 * disposer can run after the next battlefield has started booting, so a
 * teardown that reaches for something by name rather than by identity can take
 * the wrong one down (see the `__lions` registration).
 *
 * And **anything that can still COMPLETE after the teardown must consult
 * `disposed` before it touches `renderer`, `sim` or the DOM.** Cancelling the
 * frame loop stops the work this function drives; it does nothing about work
 * already in flight. The deferred art block below is the live case -- wreck
 * sprites, deferred buildables and building-wreck meshes are started two frames
 * after deploy and land whole seconds later, by which time the player may have
 * left and the renderer may be gone. A fetch has no signal to cancel it here,
 * so the guard is at the points where a resolution would reach back in.
 */
async function bootBattlefield(stage: HTMLElement, req: BattlefieldRequest): Promise<Disposer> {
  const params = req.query;
  const audio = battleAudio();
  const { boughtUnits, ownedTiers } = accountState();
  /** The end screen and the debrief mount on `document.body`, not on the
   *  stage, so the router cannot clear them: whoever tears a battlefield down
   *  has to. Collected here and drained by `teardown` below. */
  const screenDisposers: Disposer[] = [];

  /** Every teardown this boot has registered, in creation order. Drained in
   *  REVERSE by `teardown()`, so a thing is released before whatever it was
   *  built on top of. */
  const cleanup: Disposer[] = [];
  const onDispose = (f: Disposer): void => {
    cleanup.push(f);
  };
  /**
   * Set by `teardown()` before it runs anything, and read by every callback
   * that can outlive this battlefield -- see the third rule above.
   *
   * It is set FIRST, not last, and that ordering is the whole point: a
   * disposer partway down the list can itself settle a promise (the loading
   * screen's rejection is one), so a flag set at the end would be false for
   * exactly the callbacks the teardown is causing to run.
   */
  let disposed = false;
  /**
   * Run every registered teardown, once.
   *
   * `splice(0)` empties the list as it takes it, so a second call -- and both
   * happen, since an aborted boot tears down here and the router may still
   * call the disposer it eventually gets back -- finds nothing to do. Each
   * teardown is isolated: one that throws must not strand the rest, and a
   * half-torn-down battlefield is what leaks a WebGL context.
   */
  const teardown = (): void => {
    disposed = true;
    for (const f of cleanup.splice(0).reverse()) {
      try {
        f();
      } catch (err) {
        console.error('battlefield teardown:', err);
      }
    }
  };
  /** Bail out of a boot that has been superseded. The `AbortError` shape is
   *  what `Router.mountLocation` swallows for a stale mount; anything else
   *  would print a boot failure for a mission the player deliberately left. */
  const abandon = (why: string): never => {
    teardown();
    throw new DOMException(why, 'AbortError');
  };
  onDispose(() => {
    for (const d of screenDisposers.splice(0)) d();
  });
  /**
   * `window.addEventListener`, with the removal registered in the same
   * statement.
   *
   * Every listener this function puts on `window` outlives the battlefield
   * unless something takes it off -- `window` is not the stage, and the router
   * cannot clear it. Writing the add and the remove apart is how one of them
   * goes missing, so they are one call here and the listener's own identity is
   * captured rather than re-derived from a name.
   *
   * Listeners on `canvas` are deliberately NOT routed through this: the canvas
   * is the renderer's, it is a child of the stage the router replaces, and it
   * is unreachable and collectable the moment `renderer.dispose()` and that
   * replacement have run.
   */
  const onWindow = <K extends keyof WindowEventMap>(
    type: K,
    fn: (ev: WindowEventMap[K]) => void,
    opts?: AddEventListenerOptions
  ): void => {
    window.addEventListener(type, fn, opts);
    onDispose(() => window.removeEventListener(type, fn, opts));
  };
  /** The same shape for `req.signal`. Used for the one teardown that has to
   *  happen BEFORE this function returns its disposer -- see the loading
   *  screen below, which is the only thing that can park the boot
   *  indefinitely. `once` so it is a single shot; also removed by the ordinary
   *  teardown, so a mission played to its end leaves nothing on the signal.
   *
   *  An ALREADY-aborted signal never fires `abort` again, so it is answered
   *  inline instead. Reachable: several awaits sit between this function's
   *  first line and the registration below, and a navigation during any of
   *  them aborts the signal before this listener exists. */
  const onAbort = (signal: AbortSignal, fn: () => void): void => {
    if (signal.aborted) {
      fn();
      return;
    }
    signal.addEventListener('abort', fn, { once: true });
    onDispose(() => signal.removeEventListener('abort', fn));
  };

  const missionId = req.missionId;
  let mission: MissionJson | undefined;
  if (missionId !== null) {
    const rawMission = (missions as Record<string, MissionJson | undefined>)[missionId];
    if (!rawMission) {
      bootError(stage, t('boot.unknownMission.title', { id: missionId }), t('boot.unknownMission.body'));
      // `teardown`, not a fresh no-op: nothing has been registered yet, so it
      // does nothing today -- but an early return that opts OUT of the teardown
      // is how the next registration added above this line goes unreleased.
      return teardown;
    }
    // The mission-text locale overlay (`data/locales/<lang>/missions.json`,
    // `data/locales/README.md`): `name`/`briefing`/objective `text`/trigger
    // `label` in the current UI language, layered over the `en` source this
    // mission's own JSON carries. `currentLocale()` -- not the `pseudo`
    // wrapper `main()`'s own boot swaps in for chrome text -- because mission
    // text is DATA (CLAUDE.md: "Data text stays data") and never goes through
    // the pseudo-locale transform; under `?pseudo=1` this reads `'pseudo'`,
    // finds no `data/locales/pseudo/` directory, and `loadMissionOverlay`
    // falls back to `null` exactly as it does for `en` or a real 404.
    mission = applyMissionLocale(rawMission, await loadMissionOverlay(currentLocale(), BASE));
  }
  const ledger: CampaignLedger = params.get('fresh') !== null ? {} : ledgerStore.readLedger();

  // The chain of command (GDD §11): resolved once, here, off the mission id
  // alone -- world.json and commander.json are both static data, so rank and
  // plate need neither the mission JSON nor the ledger. A sandbox (`missionId`
  // null) resolves through the same "unknown mission id" path an unrecognised
  // one would (`commanderForMission`'s own doc comment) and is harmless: the
  // commander bar stays hidden without a briefing regardless of what rank it
  // would have shown (`ui/hud.ts`'s `brief`).
  //
  // The enemy's face (storyline.md G18) is the one piece of this that DOES
  // need the mission JSON: `town` is schema-required (`mission.schema.json`)
  // but, like `phase`, not modelled on `@lions/sim`'s `MissionJson` -- nothing
  // in the sim reads either field -- so it is read off the raw JSON here
  // rather than widening that type for a lookup only `app` makes.
  const commanderData = parseCommander(commander);
  const worldData = parseWorld(world);
  const missionTown = (mission as { town?: string } | undefined)?.town;
  const enemyRegion = regionForTown(worldData, missionTown);
  // `commanderForMission` never sets `portrait` -- it has no asset resolver
  // to call (`portrait-catalogue.ts`'s own doc comment). The resolved URL is
  // layered on here, once, for every voice the bar can show a face for.
  const hudCommander: HudCommanderInfo = {
    shai: {
      ...commanderForMission(commanderData, worldData, missionId ?? ''),
      portrait: commanderPortraitUrl(commanderData.people.shai.portrait),
    },
    idit: {
      name: commanderData.people.idit.name,
      plate: commanderData.people.idit.plate,
      portrait: commanderPortraitUrl(commanderData.people.idit.portrait),
    },
    enemy: {
      portrait: commanderPortraitUrl(villainPortrait(commanderData, enemyRegion?.id)),
    },
  };

  // --- world ---------------------------------------------------------------
  // `?sandbox=<map id>` walks any shipped map. Bare `?sandbox` keeps loading
  // beit_sahwan_outskirts, so the M0 sandbox is unchanged.
  //
  // This exists because verifying anything visual on a new map used to mean
  // authoring a throwaway mission and deleting it afterwards — Tel Marum's
  // terrain was walked exactly that way. An unknown id falls back rather than
  // failing, and names what it did: a typo in a dev URL should not look like
  // a broken build.
  const sandboxMap = req.sandboxMap;
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
  const wantCiv = flags.civ;
  const wantDitch = flags.ditch;
  // Meshes are what the game looks like now, so they load unless asked not to.
  // This was `flags.mesh` -- an opt-IN that `ui/menu.ts` never appended to any
  // link it builds, so no player reached by the menu ever saw a mesh. The
  // escape hatch inverts rather than disappearing: `&nomesh` still walks the
  // billboard path on `three`, and `?renderer=pixi` has no mesh path at all.
  const wantMesh = !flags.nomesh;
  // A misspelled flag (`&tunel`) otherwise does nothing at all, silently,
  // which reads as a broken feature rather than as a typo.
  // Level load time step 5. Fire-and-forget and deliberately NOT awaited: the
  // worker is a cache for the NEXT load, so making this boot wait on it would
  // trade the thing it is meant to buy. It never rejects (see its own doc
  // comment) -- a browser that refuses registration keeps the game exactly as
  // it is today.
  void registerServiceWorker(BASE, window.location.search);
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
  const baseMapJson =
    (maps as Record<string, MapJson | undefined>)[mapId] ?? maps.beit_sahwan_outskirts;
  // The ditch is cut into the ROWS, before `parseMap`, rather than poked into
  // the parsed arrays afterwards. That way the sandbox walks exactly the code
  // path an authored `d` walks -- legend lookup, the vehicle mask, the decor
  // layer and `applyTerrain` all see a real map -- so a bug anywhere in that
  // chain shows up here instead of being bypassed by a shortcut.
  //
  // Sandbox-only, like every flag beside it: a mission brings its own terrain,
  // and a dev flag must never change how a real mission is fought.
  const mapJson: MapJson =
    !mission && wantDitch
      ? { ...baseMapJson, rows: sandboxDitchRows(baseMapJson, sandboxAnchors(baseMapJson)) }
      : baseMapJson;
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
  for (const u of Object.values(units)) {
    // Enemy units never go through the pre-pass -- only a KDF unit can carry
    // a bought tier, and `unitInfo` (cost/gate lookup) below still reads the
    // raw JSON, never this patched copy, because cost is not patchable.
    const registered = u.faction === 'kdf' ? applyUpgrades(u, ownedTiers[u.id] ?? {}) : u;
    typeOf.set(u.id, sim.addUnitType(registered));
  }

  // Which ROE reasons have already been narrated, so the advice attached to a
  // protected-zone violation is offered once rather than on every cooldown
  // expiry. One mission, one set — it lives as long as the runtime does.
  const narratedRoeReasons = new Set<string>();
  /** Every Conduct deduction this mission, for the debrief. The sim keeps no
   *  presentation log; the events are the record. */
  const deductions: { penalty: number; reason: string }[] = [];
  /**
   * `&civ`: where the crowd is walked to, and the ground that counts as out.
   *
   * Only ever set in the sandbox, like every flag beside it — a mission brings
   * its own `civilians.refuge` and its own `evacuate_before` zone, and a dev
   * flag that supplied a second one would change how a real mission scores.
   */
  const civRefuge = !mission && wantCiv ? sandboxRefuge(mapJson, anchors) : null;
  /** The shared rule (`@lions/sim`'s `CivilianFlight`), not a copy of it. The
   *  runtime owns one for a mission; this is the sandbox's own. */
  const civFlight = civRefuge ? new CivilianFlight() : null;
  /** Who the sandbox spawned, for the two lists `CivilianFlight.step` takes. */
  let sandboxForce: SandboxForce = { player: [], civilians: [] };
  let runtime: MissionRuntime | null = null;
  /** The force `MissionRuntime` and the deploy panel (`broughtFor`) actually see:
   *  `upgrades_to` resolved once here (spec §4.6), before the runtime is built, so
   *  the spawner stays gate-blind. Every other reader of `mission` -- briefing,
   *  debrief, `getMission()` -- keeps the original JSON. */
  let resolvedMission: MissionJson | undefined;
  if (mission) {
    resolvedMission = resolveUpgrades(mission, ledger, (id) => {
      const u = (units as Record<string, (typeof units)[keyof typeof units] | undefined>)[id];
      return u ? kdfUnlockGate(u, boughtUnits) : undefined;
    });
    runtime = new MissionRuntime(sim, resolvedMission, {
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
        return {
          logistics: u.cost.logistics,
          buildTimeS: 'build_time_s' in u.cost ? u.cost.build_time_s : 20,
          unlock: kdfUnlockGate(u, boughtUnits),
        };
      },
    });
    runtime.start();
  } else {
    sandboxForce = sandboxSpawns(sim, typeOf, anchors, {
      tunnel: wantTunnel,
      sur: wantSur,
      civ: wantCiv,
    });
  }

  // --- renderer + overlay --------------------------------------------------
  // Terrain tones by theme -- `./terrain-themes` (Task B3.1: was declared here
  // verbatim AND, separately, in `terrain-parity.test.ts`; the parity test
  // could not import this function-local declaration, and this function could
  // not import a test file, so each kept its own copy until both moved to a
  // shared module neither of those constraints applies to).
  // Task 12: read once here (construction-time, like the renderer backend
  // choice) rather than live -- a variant switched mid-mission takes effect
  // from the next one, which the settings hint says explicitly. Both
  // `teamColors` (the minimap's own tuple) and `resolveColor` below (what
  // the renderer -- either backend -- asks for a palette key by STRING) have
  // to agree on this same value, or the silhouette outline, the HP bars, the
  // objective-zone tints and the min-range ring -- every one of which asks
  // `resolveColor('team.hostile')`/`'team.kedem'`/`'team.neutral'` rather
  // than reading `teamColors` directly -- would keep drawing the default
  // palette regardless of the setting.
  const cvdVariant = req.settings.get().accessibility.colorVision;
  const opts: RendererOptions = {
    background: paletteColor('shadow.1'),
    teamColors: paletteTeamColors(cvdVariant),
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
    // GH-149. Deliberately NOT `tracerColors` -- an arcing round is
    // ordnance, not a bullet, and drew green until now. See
    // `RendererOptions.shellColors`.
    shellColors: [paletteColor('vfx.fire'), paletteColor('vfx.ember')],
    flashColor: paletteColor('vfx.fire'),
    nearMissColor: paletteColor('dust.0'),
    interceptColor: paletteColor('vfx.interceptor'),
    // `variantAwareResolver` (@lions/data) is `paletteColor` for every key
    // except the four `team.*` ones, which it routes through this same
    // `cvdVariant` -- the silhouette outline (`silhouette.ts`'s
    // `SILHOUETTE_COLOR_KEY_BY_SIDE`, every billboard `UnitInstancer`'s
    // `uTeam` and the mesh path's shared materials), the HP bar
    // (`hpBarColorKey`), the objective-zone tint (`objectiveZoneColorKey`)
    // and the min-range ring all ask for a palette key by name rather than
    // reading `teamColors` above, so a bare `paletteColor` here would leave
    // every one of them on the default palette no matter what the player
    // picked.
    resolveColor: variantAwareResolver(cvdVariant),
    // The ground albedos, served out of the repo-root `assets/` publicDir
    // like every sprite sheet and font. Three-only and fail-soft: Pixi
    // ignores the fields and the three ground draws its flat palette tone if
    // an image never arrives. See `RendererOptions.groundTextureUrl`.
    //
    // Open ground is chosen by the map's own theme, the SAME read that picks
    // `terrainTones` two lines up -- `TERRAIN_GROUND_TEXTURE[map.terrain]`,
    // typed as a total `Record<TerrainTheme, ...>` so a new theme is a
    // compile error here rather than a map that silently draws sand.
    //
    // All six of these are requested UNCONDITIONALLY here -- main.ts has no
    // per-tile view of the map (and, since 2026-09-06, is expressly forbidden
    // from building one: `@lions/render/terrain` is production-app-restricted
    // by `eslint.config.mjs`, precisely because this package has no other use
    // for the pure builders). Deciding which of the six this map's own tiles
    // can actually sample -- and skipping a fetch for the rest -- is
    // `ThreeRenderer.loadGroundTexture`'s own job now: it already holds the
    // real `sim`/decor/elevation once `init()` runs, and building a second,
    // independent copy of that state here just to answer the same question
    // twice is exactly the risk of two answers drifting apart.
    groundTextureUrl: `${BASE}textures/${TERRAIN_GROUND_TEXTURE[map.terrain]}.jpg`,
    // Each of the five below is one surface, one image, and one independent
    // failure: a ridge that loses its texture is still a ridge, and a road
    // that loses its wheel track is still the authored road tone.
    rockTextureUrl: `${BASE}textures/rock_ground_tile.jpg`,
    roadTextureUrl: `${BASE}textures/road_track_tile.jpg`,
    scrubTextureUrl: `${BASE}textures/rough_scrub_tile.jpg`,
    groveTextureUrl: `${BASE}textures/orchard_floor_tile.jpg`,
    knollTextureUrl: `${BASE}textures/knoll_scree_tile.jpg`,
    // Where the Draco decoder is fetched from. Self-hosted in `assets/draco/`
    // like the fonts, never a CDN. Every shipped GLB is Draco-compressed
    // (level load time, step 4), so a mesh renderer without this loads no
    // mesh at all -- it is not a nicety, and `gltf-loader.ts` says so.
    dracoDecoderPath: dracoDecoderPath(),
    // Shell upgrade Phase 1: the video-quality setting, read once here like
    // `cvdVariant` above -- a change mid-mission takes effect from the next
    // one, which is what `settings.quality.hint` tells the player. Three-only
    // (see `RendererOptions.quality`); Pixi ignores it like every other field
    // in this stretch.
    quality: QUALITY_PRESETS[req.settings.get().video.quality],
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
  // --- which meshes this mission needs -------------------------------------
  //
  // The whole mesh library used to load at boot, before the loading screen was
  // even on screen: 65 GLB fetches and 40.04 MiB, the same for every mission
  // and every sandbox, measured against a production build served from disk.
  // This is the roster that replaces it. `./mesh-catalogue` owns the tables and
  // the arithmetic; what is decided HERE is only which roster to ask about.
  //
  // Computed unconditionally, outside the renderer branch, so a change to it
  // is not hidden inside a backend the reader may not be looking at. On Pixi
  // and under `&nomesh` it is simply never read.
  const meshRoster = mission
    ? missionUnitTypes(mission, new Set(Object.keys(units)))
    : sandboxUnitTypes({ tunnel: wantTunnel, sur: wantSur, civ: wantCiv });
  // Structure types this map actually stands, plus anything the mission
  // places itself (`camp` is the only one that arrives that way).
  const meshStructures = new Set(map.structures.map((b) => b.type));
  for (const s of mission?.structures ?? []) meshStructures.add(s.type);
  const meshPlan = {
    rigged: new Set([...meshRoster].filter((id) => id in RIGGED_UNIT_MESHES)),
    vehicles: new Set([...meshRoster].filter((id) => id in VEHICLE_UNIT_MESHES)),
    buildings: new Set([...meshStructures].filter((id) => id in BUILDING_MESHES)),
    decor: decorFamiliesFor(map),
  };
  /**
   * Types whose mesh is fetched AFTER the mission is running rather than
   * before it starts.
   *
   * A mission with `resources` lets the player build any KDF unit the ledger
   * has unlocked, so its true roster is "what it fields" plus "the whole KDF
   * catalogue" -- which on `beit_sahwan_3_clearance` is most of the library
   * again and would give the change back. They are deferred instead: a build
   * takes seconds of game time to deploy, `updateUnits` draws a
   * mesh-less type as its BILLBOARD in the meantime, and every KDF buildable
   * has a `SPRITE_MAP` entry, so the worst case is a sprite that becomes a
   * model rather than a unit that is missing.
   */
  const meshDeferred = mission?.resources
    ? new Set(
        Object.values(units)
          .filter((u) => u.faction === 'kdf' && hasUnitMesh(u.id) && !meshRoster.has(u.id))
          .map((u) => u.id)
      )
    : new Set<string>();
  /** Every type `ensureUnitMesh` has already started. Owned here rather than
   *  asked of the renderer: `ThreeRenderer` exposes no "is this loaded" read,
   *  and this file is the only thing that calls the loaders. */
  const meshLoaded = new Set<string>([...meshPlan.rigged, ...meshPlan.vehicles]);
  /** Type ids whose deferred mesh failed, surfaced beside `failedArt`. */
  const failedMesh: string[] = [];
  /** Starts one structure type's WRECK mesh, or null on a backend with no
   *  mesh path. Assigned in the three branch beside `ensureUnitMesh`, for
   *  the same reason: `three` is in scope only there, and this file is the
   *  only thing that calls the loaders. Deferred to after the first frame --
   *  see the call site below `loading.done()`. */
  let wreckMeshLoader: ((structureId: string) => void) | null = null;
  /** Load one unit type's mesh if it has one and has not been asked for yet.
   *  Assigned only on the three backend with meshes on; a no-op on Pixi and
   *  under `&nomesh`, where `meshPathActive` keeps the sweep off entirely. */
  let ensureUnitMesh: (typeId: string) => void = () => {};
  /** Whether anything on screen is drawing a mesh at all. Gates the
   *  living-unit sweep below: with the mesh path off, EVERY type is
   *  legitimately mesh-less and the sweep would warn about all of them once a
   *  second forever. */
  let meshPathActive = false;

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
    if (wantMesh) {
      // ROSTER-DRIVEN, not the whole library. Everything below is driven by
      // `meshPlan` above: this branch loads the meshes for the unit types this
      // mission or sandbox can actually field, the buildings its map actually
      // stands, and the decor families its terrain can actually place.
      //
      // Before this, the block here was ~300 lines of hand-written calls that
      // ran for every mission alike -- measured, in a production build served
      // from disk, at 65 GLB fetches and 40.04 MiB regardless of what was on
      // the map. `tel_marum_1_recon` fields nine unit types and downloaded all
      // thirty. The catalogue those calls became is `./mesh-catalogue`, whose
      // header carries the reasoning that used to live here: which faction
      // each rigged mesh is shaded through and why that is a design call
      // rather than a naming heuristic, why five Meshy assets cannot share the
      // "team id == unit type id == file basename" convention, why civilians
      // are four variants of one type in a fixed order, and which three
      // shipped GLBs are deliberately never loaded.
      //
      // `meshUrl` keeps the `new URL(..., import.meta.url)` template form Vite
      // rewrites into a glob, so `vite-plugin-asset-watch.ts` (GH-147) still
      // finds and watches all six mesh directories.
      //
      // Errors propagate, as they did before: `loadMeshUnit`'s own doc comment
      // says a missing or malformed GLB fails loudly for this caller to
      // report, and swallowing it would leave a unit type silently absent.
      await Promise.all([
        ...[...meshPlan.rigged].map((id) =>
          three.loadMeshUnit(
            id,
            RIGGED_UNIT_MESHES[id].files.map(meshUrl),
            RIGGED_UNIT_MESHES[id].faction
          )
        ),
        ...[...meshPlan.vehicles].map((id) =>
          three.loadVehicleMesh(id, meshUrl(VEHICLE_UNIT_MESHES[id]))
        ),
        // Building meshes: the STANDING state only, for the structure types
        // this map actually stands. `colour_key`/`wallColorKey` is resolved
        // inside `loadBuildingMesh` itself off `Sim.structureTypes[...].color`
        // -- nothing here needs to know it.
        //
        // `null` for the wreck, deliberately: it is fetched after the first
        // frame instead (below, beside `spritePlan.after`). Level load time,
        // step 3 -- on `beit_sahwan_outskirts` the five wreck GLBs are 9.62
        // MiB of a 47.0 MiB level and `hall_wreck` alone is 3.77, while the
        // earliest a building can fall is minutes of play away.
        ...[...meshPlan.buildings].map((id) =>
          three.loadBuildingMesh(id, meshUrl(BUILDING_MESHES[id].idle), null)
        ),
        // The three shared VFX meshes (`units/muzzle-flash.ts`,
        // `units/explosion-burst.ts`, `units/smoke-plume.ts`). Not keyed by
        // anything and wanted by every mission -- 0.46 MiB for the set, so
        // there is nothing to gain by making them conditional. Each falls back
        // to its authored particle layer until it resolves.
        three.loadMuzzleFlashMesh(meshUrl(VFX_MESHES.muzzleFlash)),
        three.loadExplosionBurstMesh(meshUrl(VFX_MESHES.explosionBurst)),
        three.loadSmokePlumeMesh(meshUrl(VFX_MESHES.smokePlume)),
        // Decor: one call for the whole set, so it is one entry rather than a
        // spread. `<family>_<variant>` keys, not unit type ids -- nothing in
        // the sim has a "bush", which is the point.
        three.loadDecorMeshes(
          new Map(
            [...meshPlan.decor].flatMap((fam) =>
              DECOR_MESHES[fam].map((file, v): [string, string] => [`${fam}_${v}`, meshUrl(file)])
            )
          )
        ),
      ]);

      // The late arrivals. `loadMeshUnit`/`loadVehicleMesh` are safe to call
      // after the first frame -- both replace a template and tear down every
      // live clone of it first -- and `updateUnits`' own
      // `meshUnitTemplates.has(type.id)` guard means a type with no template
      // yet draws its BILLBOARD rather than nothing, so a mesh arriving late
      // is a sprite becoming a model, never a hole in the battlefield. The one
      // type that has no billboard is `civilians`, and it is never deferred:
      // `missionUnitTypes` puts it in the blocking set above whenever a
      // mission fields any.
      meshPathActive = true;
      ensureUnitMesh = (typeId: string): void => {
        // A mesh started before the player left would otherwise be handed to a
        // disposed renderer whenever it lands. Guarded at the start AND in the
        // handler: `loadMeshUnit` is a fetch plus a GLTF parse, so the window
        // between the two is seconds wide on a cold cache.
        if (disposed || !hasUnitMesh(typeId) || meshLoaded.has(typeId)) return;
        meshLoaded.add(typeId);
        const rigged = RIGGED_UNIT_MESHES[typeId];
        const job = rigged
          ? three.loadMeshUnit(typeId, rigged.files.map(meshUrl), rigged.faction)
          : three.loadVehicleMesh(typeId, meshUrl(VEHICLE_UNIT_MESHES[typeId]));
        job.catch((err: unknown) => {
          if (disposed) return;
          console.warn(`[lions] mesh FAILED for ${typeId}:`, err);
          failedMesh.push(typeId);
        });
      };
      // The wreck half of every building this map stands, started after the
      // first frame. Failing is survivable in the strongest sense available
      // here: the type simply keeps the procedural wreck `updateStructures`
      // is already drawing for it, so the warning is the whole cost.
      wreckMeshLoader = (structureId: string): void => {
        const files = BUILDING_MESHES[structureId];
        // The longest-latency load in the boot -- 9.6 MiB of collapsed masonry
        // that nobody is waiting for -- and therefore the one most likely to
        // land after a leave.
        if (disposed || !files) return;
        three.loadBuildingWreckMesh(structureId, meshUrl(files.wreck)).catch((err: unknown) => {
          if (disposed) return;
          console.warn(`[lions] building wreck mesh FAILED for ${structureId}:`, err);
          failedMesh.push(`${structureId}_wreck`);
        });
      };
    }
  } else {
    // Same shape as the three branch above: PixiRenderer's own entry point,
    // reached only when actually chosen, so pixi.js never lands in this
    // file's static module graph.
    const { PixiRenderer } = await import('@lions/render/pixi');
    renderer = new PixiRenderer(sim, opts);
    if (wantMesh) {
      // The `&tunel` lesson, applied to a flag that is real but backend-only:
      // `&mesh` on the Pixi backend otherwise does nothing at all, silently,
      // and reads as a broken feature rather than as a missing `?renderer=
      // three`. Warn by name, the way `unknownParams` warns for a typo.
      console.warn('&mesh needs ?renderer=three — the Pixi backend has no mesh path; ignoring it');
    }
  }
  // The same lesson again, for the one unit type with no billboard to fall
  // back on. `civilians` is absent from `SPRITE_MAP` by design (the four
  // figures are mesh-only), so on Pixi or under `&nomesh` the crowd is spawned,
  // walks, is shot at and evacuates while drawing NOTHING -- which reads as
  // `&civ` being broken rather than as the wrong backend. The flag still does
  // everything else it says: this warns, it does not refuse.
  if (wantCiv && !meshPathActive) {
    console.warn(
      '&civ draws nothing without the mesh path — civilians have no billboard ' +
        '(no SPRITE_MAP entry). Use ?renderer=three without &nomesh to see them.'
    );
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
    DECOR.ridge !== TERRAIN_DECOR.ridge ||
    DECOR.ditch !== TERRAIN_DECOR.ditch
  ) {
    throw new Error('decor enums have diverged between @lions/data and @lions/render');
  }
  renderer.setDecor(map.decor);
  renderer.setElevation(map.elevation);
  // Task 5: the briefing's full objective list, off the mission's own JSON
  // rather than `runtime.objectiveList` -- the deploy screen is read before
  // the mission ticks at all, so every objective is 'active' and no clock has
  // started. `resolvedMission` (not `mission`) because `upgrades_to` can
  // change what a placement fields but never touches `objectives`; either
  // would read the same list here, and this keeps one reader for both.
  const objectiveRows: ObjectiveRow[] | undefined = resolvedMission?.objectives.map(
    (o): ObjectiveRow => ({
      id: o.id,
      text: o.text ?? '',
      primary: o.primary,
      carries: o.carries ?? false,
      status: 'active',
    })
  );
  // The same gate `main.ts` puts on `payMission` below (`mission.ledger.
  // produces.length > 0`) -- the tutorial produces no ledger keys and never
  // reaches that call, so its briefing must not promise a secondary pays
  // credits when nothing will pay them.
  const paysCredits = mission !== undefined && mission.ledger.produces.length > 0;
  // Up before the canvas exists, so the player never sees the terrain draw
  // itself in or the units stand around as procedural boxes waiting for their
  // sheets. It comes down once the art gate below has settled.
  const loading = showLoading(
    stage,
    mission?.name ?? mission?.id ?? 'M0 sandbox',
    mission?.briefing,
    { rank: hudCommander.shai.rank, plate: hudCommander.shai.plate, portrait: hudCommander.shai.portrait },
    mission?.briefing_video !== undefined ? `${BASE}${mission.briefing_video}` : undefined,
    resolvedMission ? (broughtFor(resolvedMission, ledger, (id) => units[id as keyof typeof units]?.name ?? id) ?? undefined) : undefined,
    // A sandbox has no briefing to go back to -- only a real mission gets an
    // Escape/back edge (task 6). A router navigation now, not a page load:
    // this is the earliest soft exit from a battlefield, and it fires while
    // this very function is still parked on `loading.done()` below.
    mission ? () => req.navigate(routes.campaign()) : undefined,
    objectiveRows,
    paysCredits
  );
  onDispose(() => loading.dispose());
  // The one teardown that cannot wait for this function to return.
  //
  // `loading.done()` parks on the player's click for as long as they care to
  // read. A navigation that supersedes this boot aborts `req.signal` (the
  // router's `unmount()` aborts an in-flight mount, not just a mounted one) --
  // but the disposer it would run is the value this function has not returned
  // yet, so nothing would unpark the await and the mount would hang forever
  // holding a renderer. Disposing the screen from the signal rejects that
  // parked promise with an `AbortError`; the `catch` below does the rest.
  //
  // Registered with `once` so it is a single shot, and removed by the ordinary
  // teardown so a mission played to its end leaves nothing on the signal.
  onAbort(req.signal, () => loading.dispose());
  await renderer.init(stage);
  // `ThreeRenderer` holds a WebGL context, a 4096 shadow map, every geometry
  // and material for the map, and a ResizeObserver on the canvas. A browser
  // hands out a bounded number of contexts, so walking in and out of missions
  // without this is a session that stops drawing after a handful of them.
  // Optional on the seam (`api.ts`): PixiRenderer's file is frozen and
  // implements nothing, so a Pixi battlefield still leaks here.
  //
  // The CANVAS is taken off in the same breath, and that half is not
  // redundant. `WebGLRenderer.dispose()` frees the context's resources and
  // leaves the element in the DOM, and the router only clears the stage for a
  // screen that actually MOUNTED -- `Router.unmount()` returns early at
  // `if (!m) return` when the mount is still in flight. So a battlefield
  // abandoned on its deploy screen left its canvas behind in the stage, under
  // the campaign board, and the route walk photographed exactly that: two
  // canvases where the board needs one. Measured, not assumed; a teardown that
  // relies on the router to clean up after it is the rule this file states at
  // the top, broken.
  onDispose(() => {
    renderer.dispose?.();
    renderer.canvas.remove();
  });
  if (req.signal.aborted) abandon('left while the renderer was starting');
  renderer.useEmitters(vfxEmitters as EmitterSpec[], paletteColor);

  // Load sprite sheets for unit types that have rendered art (non-blocking).
  // `SPRITE_MAP` itself is declared at module scope, above `main()`, because
  // the brigade screen is its other reader: the roster resolves a portrait
  // through the same table, so a unit's picture cannot differ between the
  // HUD's card and that screen.
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
  // Which sheets THIS boot needs, and when -- `spriteSheetPlan`'s own doc
  // comment has the rules and the measurement behind them (61 MiB and 3,665
  // requests of a 115 MiB level were sheets for types the mesh path draws
  // as models). Portrait manifests are still read for every type below,
  // because the HUD shows a face for a type whose sheet is not loaded.
  const spritePlan = spriteSheetPlan({
    meshPath: meshPathActive,
    roster: meshRoster,
    deferred: meshDeferred,
    spriteTypes: new Set(Object.keys(SPRITE_MAP)),
    structureTypes: meshStructures,
    structureSprites: new Set(Object.keys(STRUCTURE_SPRITES)),
  });
  console.log(
    `[lions] sheets: ${spritePlan.before.size} before deploy` +
      (spritePlan.before.size ? ` (${[...spritePlan.before].join(', ')})` : '') +
      `, ${spritePlan.after.size} after the first frame` +
      (spritePlan.after.size ? ` (${[...spritePlan.after].join(', ')})` : '') +
      `, ${spritePlan.structures.size} structure sprite(s)` +
      (meshPathActive ? '' : ' -- no mesh path, everything loads up front')
  );
  // The bar counts SHEETS, so it counts what this boot actually loads --
  // not the 2 KB portrait manifests, which would read "29 / 29 sheets" over
  // one real sheet. A mesh-only boot reads 'meshes only' (`ui/loading.ts`).
  loading.total(spritePlan.structures.size + spritePlan.before.size);

  for (const id of spritePlan.structures) {
    artJobs.push(
      renderer
        .loadStructureSprite(id, STRUCTURE_SPRITES[id])
        .catch((err) => {
          console.warn(`[lions] structure sprite FAILED for ${id}:`, err);
          failedArt.push(id);
        })
        .then(() => loading.step())
    );
  }

  /** One unit sheet, its own failure swallowed into `failedArt` -- shared by
   *  the deploy-gating loop below and the after-first-frame loads. */
  const loadUnitSheet = (id: string): Promise<void> => {
    // The deferred half of the sheet plan runs through here two frames after
    // deploy, so this can be called -- and can resolve -- after the player has
    // left. `loadSprites` decodes into the renderer's atlases, which is exactly
    // the kind of touch the third rule at the top of this function names.
    if (disposed) return Promise.resolve();
    const { path, ...rest } = SPRITE_MAP[id];
    return renderer.loadSprites(id, path, rest).catch((err) => {
      if (disposed) return;
      console.warn(`[lions] sprites FAILED for ${id}:`, err);
      failedArt.push(id);
    });
  };

  /**
   * The frame each unit type shows in the HUD's selection cluster (GH-153).
   *
   * `unitIcon` first -- the cropped icon needs no fetch at all, it is already
   * in the bundle -- and only when a sheet has none does this fall back to
   * fetching that sheet's own manifest and picking a frame from it the way it
   * always has. Resolving from the manifest rather than from a filename
   * template matters for exactly that fallback: there are already two naming
   * conventions in `assets/sprites/` (`idle_f03_000.png` where the sheet
   * declares clips, a bare `f03_000.png` where it does not) and a hand-kept map
   * of which sheet is which is the `SPRITE_MAP` failure mode all over again.
   *
   * A type absent from here has no picture and the HUD draws its role mark on
   * the reserved hatch instead — `civilians` is the one shipped type in that
   * position, and a click-select can reach it.
   */
  const portraits: Record<string, string> = {};
  /** Which ids in `portraits` above came from a cropped `unitIcon` rather than
   *  a whole sheet frame -- read by the HUD and the dock to set `data-icon`. */
  const portraitIcons = new Set<string>();

  for (const [id, spec] of Object.entries(SPRITE_MAP)) {
    const { path } = spec;
    const icon = unitIcon(path);
    if (icon !== null) {
      portraits[id] = icon.url;
      portraitIcons.add(id);
    }
    artJobs.push(
      Promise.all([
        spritePlan.before.has(id) ? loadUnitSheet(id) : Promise.resolve(),
        // Its own fetch and its own failure: a manifest that 404s costs the HUD
        // a picture, not the battlefield a unit, so it must not push onto
        // `failedArt` and must not hold up the art gate on its own. For a type
        // whose sheet loads, the renderer has just fetched the same URL and
        // this is a cache hit; for the rest it is the 2 KB the portrait needs.
        // Skipped entirely once an icon already answered the question above.
        icon !== null
          ? Promise.resolve()
          : fetch(`${path}manifest.json`)
              .then((r) => (r.ok ? (r.json() as Promise<SheetManifest>) : null))
              .then((m) => {
                const url = m === null ? null : portraitUrl(path, m);
                if (url !== null) portraits[id] = url;
              })
              .catch((err: unknown) => {
                console.warn(`[lions] portrait manifest FAILED for ${id}:`, err);
              }),
      ]).then(() => {
        if (spritePlan.before.has(id)) loading.step();
      })
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
  // The buildables, now that the art gate is behind us. Deliberately NOT
  // awaited: these are meshes for units the player MIGHT build, and the whole
  // point of deferring them is that the mission starts without them.
  //
  // This line sits BETWEEN the two waits on purpose. Started any earlier it
  // would compete with the sprite sheets for the gate above and delay the
  // mission for everyone, including a player who never builds anything.
  // Started any later it would begin only when `loading.done()` returns, which
  // for a mission with a briefing is the moment the player clicks Begin --
  // throwing away the one stretch of wall-clock time in the whole boot where
  // the human is reading and the network is idle.
  for (const id of meshDeferred) ensureUnitMesh(id);

  // Waits for the player when there are orders to read; resolves at once when
  // there are none, which is every sandbox and the tutorial.
  //
  // The one await in this function that can park indefinitely, so it is the
  // one with a catch: the signal listener above disposes the screen when this
  // boot is superseded, which rejects this promise with an `AbortError` rather
  // than leaving the mount hanging. Anything else that comes out of here is a
  // genuine boot failure and is rethrown untouched -- after the teardown, so a
  // failed boot does not strand a renderer either.
  try {
    await loading.done();
  } catch (err) {
    teardown();
    throw err;
  }
  if (req.signal.aborted) abandon('left before deploy');

  // The art the game may still need but nobody is waiting for -- a mesh
  // vehicle's wreck sprite, a deferred buildable's billboard fallback, and
  // every BUILDING WRECK mesh -- starts two frames after deploy, so the first
  // picture the player sees is not competing with 40 PNG decodes and 9.6 MiB
  // of collapsed masonry. Deliberately after `loading.done()`, not between the
  // two waits like the deferred unit meshes: a briefing is read for seconds
  // and a wreck is minutes away, so nothing is lost by waiting.
  //
  // Both halves fail soft and neither can draw a hole. A sheet that never
  // arrives leaves its type on the mesh it already has; a wreck mesh that is
  // still in flight leaves `buildingMeshWreckTemplates` without the type,
  // which is exactly the state in which `updateStructures` keeps drawing the
  // procedural wreck -- see `loadBuildingWreckMesh`'s own doc comment.
  const afterFirstFrame: Array<() => void> = [];
  if (spritePlan.after.size > 0) {
    afterFirstFrame.push(() => {
      for (const id of spritePlan.after) void loadUnitSheet(id);
    });
  }
  if (meshPathActive && wreckMeshLoader) {
    const loadWreck = wreckMeshLoader;
    afterFirstFrame.push(() => {
      for (const id of meshPlan.buildings) loadWreck(id);
    });
  }
  if (afterFirstFrame.length > 0) {
    // Guarded at BOTH hops, and neither is the frame loop. These two callbacks
    // are scheduled on their own, are not the `rafId` the disposer cancels, and
    // fire whether or not the battlefield is still there -- so a player who
    // leaves within two frames of deploying would otherwise start the whole
    // deferred art batch against a renderer that has just been disposed.
    requestAnimationFrame(() => {
      if (disposed) return;
      requestAnimationFrame(() => {
        if (disposed) return;
        for (const start of afterFirstFrame) start();
      });
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
          // Structured rather than the prose line this used to be: the strip
          // stamps logistics and intel as separate fields with their own
          // glyphs, and a renderer that has to split a sentence back apart is
          // how the two drift.
          logistics: mission.resources ? runtime.logistics : undefined,
          logisticsRate: mission.resources?.logistics_rate_per_min,
          intel: mission.resources ? runtime.intel : undefined,
          // The story voice's closing line (GDD §11) -- read straight off the
          // mission JSON, like `name`/`briefing` already are. The sim never
          // sees this field either (`mission.ts`'s own doc comment).
          aftermath: mission.aftermath,
        }
      : null;
  // Wall-clock pacing, not sim pacing: this multiplies how much real time the
  // accumulator is fed, never the tick itself (invariant 1 — the sim is 20 Hz
  // whatever this says, and a replay at 2x produces the same state hash).
  let gameSpeed = 1;
  // BattleAudio keeps `muted` private and reports the new state from
  // `toggle()`, so the strip's chip reads this mirror rather than the mixer.
  // Seeded from the mixer rather than `false`: the mute is remembered across
  // screens now, so a mission opened muted must paint its chip muted.
  let audioMuted = audio.isMuted();

  // --- the five orders, once ------------------------------------------------
  //
  // GH-153's order row draws a button per verb, and the ticket's requirement is
  // that the button "dispatches the same intents as the keys in intents.ts".
  // The way to make that true rather than merely intended is for there to be
  // ONE function per verb: the keydown listener below calls these, and the HUD
  // is handed the same object. There is no second implementation to drift.
  //
  // Every body reads state declared further down this function (`intentWorld`,
  // `dispatch`, `lastCursor`, `production`). That is safe and deliberate: all
  // of them run from a listener, long after main() has finished initialising,
  // so no temporal dead zone is ever entered — and the alternative, moving the
  // HUD's construction below the input block, would put the loading screen's
  // successor on screen after the pointer handlers instead of before them.
  /** The armed order waiting for a click on the map, if any. Only the two
   *  point-targeted orders can be armed; the other three act at once. */
  let armedOrder: 'attackMove' | 'smoke' | null = null;
  const myLiving = (): number[] =>
    renderer.selection.filter((i) => sim.state.side[i] === 0 && sim.state.alive[i] === 1);
  /**
   * The three verbs `intents.ts` resolves, through one call.
   *
   * The three keydown branches this replaces each passed stub predicates for
   * the fields their own verb ignores (`g` passed `canSmoke: () => false`).
   * Passing the real ones for all three is behaviourally identical —
   * `resolveKeyVerb` reads only the fields its verb needs — and removes three
   * chances to stub the wrong one.
   */
  const runVerb = (verb: 'mount' | 'dismount' | 'smoke', at?: { x: number; y: number }): void => {
    const w = at ?? renderer.screenToWorld(lastCursor.x, lastCursor.y);
    const res = resolveKeyVerb(intentWorld, verb, {
      ids: myLiving(),
      x: w.x,
      y: w.y,
      isCarrier: (i) => sim.unitTypes[sim.state.typeIdx[i]].transportSlots > 0,
      canEmbark: (i) => sim.unitTypes[sim.state.typeIdx[i]].canEmbark,
      canSmoke: (i) => sim.unitTypes[sim.state.typeIdx[i]].canSmoke,
      passengerCount: (i) => sim.passengerCount(i),
    });
    for (const intent of res.intents) dispatch(intent);
    if (res.note) hud.note(res.note.text, res.note.tone);
    if (res.marker) renderer.addOrderMarker(w.x, w.y);
  };
  /**
   * Arm (or disarm) a point-targeted order.
   *
   * Attack-move and smoke both need a PLACE, and a button has none — so
   * clicking one lights it lime and the next left click on the map spends it.
   * Without this the Smoke button lays its screen where the pointer is, which
   * after a click on the button is the button: measured on
   * `?sandbox=beit_sahwan_outskirts`, `f` at the cursor and the Smoke button
   * two seconds apart put the screen 1.3 tiles apart, the second one under the
   * HUD. The wireframe draws Smoke lime with a lone Namer selected and nothing
   * laid, which is this state.
   *
   * The KEYS are unchanged: `f` still quick-casts at the cursor, because a
   * hand already on the mouse has a place and does not need a mode. Both paths
   * end in the same `runVerb('smoke', …)` call, so what differs between a
   * button and its key is where the point comes from and nothing else.
   */
  const armOrder = (id: 'attackMove' | 'smoke'): void => {
    armedOrder = armedOrder === id ? null : id;
    // Two armed modes cannot both own the next click. Arming an order disarms
    // a fire-support call, and production's onArm does the reverse.
    if (armedOrder !== null && armedSupport !== null) {
      armedSupport = null;
      production?.setArmed(null);
    }
  };
  const orders: OrderHandlers = {
    attackMove: () => armOrder('attackMove'),
    // `side === 0` and not `myLiving()`: this is the pre-existing `h` binding
    // moved, not rewritten, and a dead unit's halt is a no-op in the sim.
    halt: () => {
      const mine = renderer.selection.filter((i) => sim.state.side[i] === 0);
      if (mine.length) dispatch({ kind: 'halt', ids: mine });
    },
    smoke: () => armOrder('smoke'),
    load: () => runVerb('mount'),
    unload: () => runVerb('dismount'),
  };

  // Task 6: Escape's target. Declared before `hud` so `isPaused` below closes
  // over it trivially; `pause`/`resume` (which need `hud.paintSpeed()`) are
  // defined just after the Hud exists.
  let paused = false;
  let pauseHandle: { close: Disposer } | null = null;
  // Fix round 1: set the moment `showEndScreen` shows (below, at the
  // `missionEnd` event) and read by `case 'pause':` -- Escape must do
  // nothing once the mission is over, win or lose, rather than open a menu
  // for an attempt that no longer exists.
  let missionEnded = false;

  // Task 6: the in-mission objective tracker -- the strip's own `+N` control
  // is the only caller of `openObjectives`. One `objectivesPanel`, mounted
  // lazily on `document.body` (not the stage: like the HUD and the minimap,
  // it has to survive a soft leave on its own, hence the disposer registered
  // the moment it exists) the first time this runs, and toggled open/closed
  // on every call after that -- `hud.ts`'s own doc comment on
  // `openObjectives` describes exactly this shape. Declared before `hud` for
  // the same reason `orders` above references `dispatch` (declared far later
  // in this same function): the closures only RUN on a later click or a
  // later `missionEnd`, long after every `const` below them has initialized.
  //
  // Fix round 1 (task 6 review, I1/I2): the popover had no reliable keyboard
  // dismiss path -- Escape opened the Pause menu ON TOP of it instead of
  // closing it (`isDialogOpen()` does not know about `.rl-obj-panel--tracker`),
  // and the only other way to close it, clicking `.rl-strip__more` again,
  // sits inside `stripBody`, which loses focus every ~250 ms to `renderStrip`'s
  // own 4 Hz rebuild. `closeObjectives` is the ONE function both the second
  // strip click and the popover's own close button (`onClose` below) now
  // call, so there is exactly one way this state ever goes false. It was
  // also never torn down at mission end, unlike `pauseHandle` -- left open,
  // it rendered over the victory/defeat panel, and once every objective
  // resolved the strip's own button vanished and nothing could close it.
  let objectivesHandle: { el: HTMLElement; refresh(): void; dispose: Disposer } | null = null;
  let objectivesOpen = false;
  const closeObjectives = (): void => {
    if (!objectivesOpen) return;
    objectivesOpen = false;
    if (objectivesHandle) objectivesHandle.el.hidden = true;
    hud.setObjectivesOpen(false);
  };
  const openObjectives = (): void => {
    if (!objectivesHandle) {
      objectivesHandle = objectivesPanel(document.body, {
        // A closure, not a snapshot, exactly like `rosterEntryOf` below --
        // `runtime` does not exist yet on every path this function can run.
        rows: () => runtime?.objectiveList ?? [],
        paysCredits,
        onClose: closeObjectives,
      });
      objectivesHandle.el.classList.add('rl-obj-panel--tracker');
      objectivesHandle.el.hidden = true;
      onDispose(() => objectivesHandle?.dispose());
    }
    if (objectivesOpen) {
      closeObjectives();
      return;
    }
    objectivesOpen = true;
    objectivesHandle.el.hidden = false;
    // Refreshed on the way IN, not the way out -- a closed tracker never
    // paints again until it is reopened, and the tick loop below only calls
    // `refresh()` again while `objectivesOpen` stays true.
    objectivesHandle.refresh();
    hud.setObjectivesOpen(true);
  };

  // Task 8: F1's overlay -- every binding from the same `ACTIONS` table
  // `settings-keymap.ts` renders. Unlike the tracker above, `showKeysOverlay`
  // hands back its own `Disposer` rather than a hide/show handle (`ui/
  // credits.ts`'s `showCredits` is the other caller of that shape): the
  // overlay's own row list is read once at mount from the live `bindings`
  // closure below, so there is nothing to refresh while it sits open, and a
  // second F1 tearing it down and a fresh mount rebuilding it costs nothing a
  // hide/show toggle would have saved. `closeKeysOverlay` is idempotent and
  // is what `onClose` (Escape, the scrim, the close button) calls, so there
  // is exactly one way this ever closes, same rule as `closeObjectives`.
  let keysOverlayDispose: Disposer | null = null;
  const closeKeysOverlay = (): void => {
    if (!keysOverlayDispose) return;
    const dispose = keysOverlayDispose;
    keysOverlayDispose = null;
    dispose();
  };
  const toggleKeysOverlay = (): void => {
    if (keysOverlayDispose) {
      closeKeysOverlay();
      return;
    }
    keysOverlayDispose = showKeysOverlay(document.body, {
      bindings: () => bindings,
      onClose: closeKeysOverlay,
    });
  };
  // Mirrors `pauseHandle`'s own `onDispose(() => pauseHandle?.close());`
  // below: registered ONCE, not on every open, since `closeKeysOverlay` is
  // idempotent and reads `keysOverlayDispose` by reference rather than
  // capturing a particular mount.
  onDispose(() => closeKeysOverlay());

  // Task 9: the hint line's own first-use memory -- one store read here,
  // reused by both the hint dep below and the `production` key handler
  // further down, rather than a fresh `safeStorage()` at each site (they are
  // the same global either way, but one call is what the task asked for).
  // `seen` is mutated in place the moment a first-use thing is actually
  // USED, not the moment its hint is merely shown -- showing it and
  // immediately un-showing it would teach the player nothing.
  const settingsStore = safeStorage();
  const seen = loadSeen(settingsStore);

  const hud = new Hud(document.body, {
    sim,
    getSelection: () => renderer.selection,
    getMission,
    hoverStructure: () => renderer.hoverStructure,
    hoverEntity: () => renderer.hoverEntity,
    gameVersion: __GAME_VERSION__,
    commander: hudCommander,
    orders,
    armedOrder: () => armedOrder,
    // `row.key` is an `input/keymap.ts` action id for every bound order and
    // the literal `'RMB'` for `attackMove` -- `isAction` tells the two apart,
    // and `bindings` (declared below, alongside the keydown listener that
    // reads the same table) is closed over rather than copied, so a rebind
    // repaints the button the next time the HUD ticks.
    keyFor: (id) => (isAction(id) ? keyLabel(bindings[id]) : id),
    portrait: (typeId) => portraits[typeId] ?? null,
    portraitIsIcon: (typeId) => portraitIcons.has(typeId),
    // A closure over `runtime`, not a snapshot of it: the Hud is constructed
    // before a runtime exists on some paths (`runtime` is set only `if
    // (mission)`, above), so this must read the variable at call time.
    rosterEntryOf: (id) => runtime?.rosterEntryOf(id),
    setSelection: (ids) => {
      renderer.selection = ids;
      dispatch({ kind: 'select', ids, via: 'click' });
    },
    getSpeed: () => gameSpeed,
    setSpeed: (s) => {
      gameSpeed = s;
    },
    isMuted: () => audioMuted,
    toggleMute: () => {
      audioMuted = audio.toggle();
    },
    isPaused: () => paused,
    // The in-mission exit, behind the strip's confirm dialog. A router
    // navigation since this task: the campaign screen mounts into the same
    // document, and the disposer registered below is what makes that safe --
    // before it, a soft leave left the HUD, the minimap and the frame loop
    // running over whatever screen came next.
    leave: () => req.navigate(routes.campaign()),
    openObjectives,
    // Task 9: facts only the shell has, handed to the pure priority list in
    // `hint-model.ts`. `renderer.hoverEntity >= 0` is the same "over a
    // hostile" signal the cursor resolver already reads further down
    // (`hints.hostile`) -- one definition of "hovering a hostile" for both.
    hint: () =>
      hintFor({
        selected: renderer.selection.length,
        hoveringHostile: renderer.hoverEntity >= 0,
        sawProjectedFire: seen.projectedFire,
        sawDock: seen.dock,
        dockAvailable: mission?.resources !== undefined,
      }),
    // Marked on USE, not on the hint merely showing -- see `hint-model.ts`'s
    // own header for why showing it once would teach nobody. `renderFire`
    // (hud.ts) calls this once per three-tick streak; `case 'production':`
    // below is the dock's own use site.
    onProjectedFireShown: () => {
      seen.projectedFire = true;
      markSeen(settingsStore, 'projectedFire');
    },
  });
  // Six panes on `document.body`, plus a title card that may still be holding.
  onDispose(() => hud.destroy());

  // Task 6: the pause menu. `pause`/`resume` are the only two writers of
  // `paused` -- the frame loop below reads it through `advanceClock`, and
  // `Hud.paintSpeed` reads it through `isPaused` above, so nothing else may
  // set it directly (the `missionEnd` handler below is the one exception,
  // and it closes `pauseHandle` without going through `resume`, since
  // "resumed" is not the right word for a mission that just ended). Both are
  // idempotent (`if (paused) return;` / `if (!paused) return;`) -- fix round
  // 1 removed the SECOND caller of `resume` this comment used to describe
  // (`case 'pause':` no longer resumes at all, see there), but idempotence
  // stays right: the modal's own Escape and its Resume button both still
  // reach `resume`, and either can fire first.
  const pause = (): void => {
    if (paused) return;
    paused = true;
    // Repainted here, not on the next tick: at `paused` no tick ever comes,
    // so a strip that waits for one never dims.
    hud.paintSpeed();
    pauseHandle = pauseMenu(document.body, {
      objectives: () => runtime?.objectiveList ?? [],
      paysCredits,
      onResume: resume,
      // Fix round 1: read from `bindings` (declared below, closed over --
      // safe, since this only runs from a captured keydown, long after
      // `bindings` exists) through the same `resolveKey` the game's own
      // keydown listener uses, so a rebind of w/a/s/d is honoured
      // immediately rather than the hardcoded default set this shipped
      // with first. No modifier: none of the four pan actions declares one.
      isPanKey: (ev) => {
        const a = resolveKey(bindings, ev);
        return a === 'panUp' || a === 'panDown' || a === 'panLeft' || a === 'panRight';
      },
      onRestart: () => {
        void confirmDialog(document.body, {
          title: t('pause.restart.confirm.title'),
          body: t('pause.restart.confirm.body'),
          confirm: t('pause.restart.confirm.action'),
          danger: true,
        }).answer.then((ok) => {
          if (ok) req.restart();
        });
      },
      onQuit: () => {
        // Same wording as the HUD's own "leave the mission" confirm
        // (hud.ts's leaveBtn) -- both ask the identical question.
        void confirmDialog(document.body, {
          title: t('hud.leave.confirm.title'),
          body: t('hud.leave.confirm.body'),
          confirm: t('hud.leave.confirm.action'),
          danger: true,
        }).answer.then((ok) => {
          if (ok) req.navigate(routes.campaign());
        });
      },
      settings: req.settings,
      build: __APP_BUILD__,
    });
  };
  const resume = (): void => {
    if (!paused) return;
    paused = false;
    pauseHandle?.close();
    pauseHandle = null;
    hud.paintSpeed();
  };
  // A superseded battlefield's teardown must close its own pause modal --
  // otherwise leaving a paused mission mid-fight would strand the modal (and
  // its capture-phase keydown guard) on `document.body` under whatever screen
  // the router mounts next.
  onDispose(() => pauseHandle?.close());
  // ...and its own confirm dialogs, which mount on `document.body` (the HUD's
  // leave button, and the pause menu's Restart/Quit) rather than on the stage,
  // so the router never clears them. Without this a battlefield left while one
  // was up would leave the scrim sitting over the next screen, still listening
  // -- the visible half of C1. Idempotent and safe if the router already closed
  // it on its way through `unmount()`.
  onDispose(() => closeOpenDialog());
  // Fix wave I2: `closeTip()` had no production caller at all -- the HUD and
  // the dock each release their OWN tooltip binding in their own `destroy()`
  // (see `hud.ts`'s and `production.ts`'s `tipDisposers`), but a tip shown
  // from a strip field or a chip at the moment the battlefield is torn down
  // (a mid-fight defeat, a leave) is a shared element on `document.body`
  // outside either one's own root, with a `keydown` Escape listener on
  // `window` -- exactly the class of leak C1 named for the pause modal.
  onDispose(() => closeTip());
  // The minimap (GH-153). Mounted here rather than inside the Hud because it
  // needs three things the Hud deliberately does not carry -- the parsed map,
  // the renderer, and this map's terrain tones -- and threading all three
  // through HudDeps to reach one corner of the screen would widen that
  // interface for no gain. It keeps its own 4 Hz counter, so it is driven from
  // the tick loop beside `hud.onTick()` and depends on hud.ts for nothing.
  //
  // `tones` and `teamColors` come straight off `opts`: the minimap paints the
  // ground and the sides in the colours the battlefield itself is painted in,
  // by construction rather than by a second lookup that could drift.
  // The flip's memo, so this thunk is as identity-stable as the renderer it
  // wraps. `flipRows` allocates, and a fresh `ImageData` every ask would tell
  // the minimap the picture had changed on every redraw and make it rebuild
  // its blit canvas four times a second forever. Keyed on the renderer's own
  // object identity, which is the freshness signal it promises
  // (`Renderer.captureGroundAlbedo`) -- not on the pixels, which would cost
  // more to compare than the work being avoided.
  let lastShot: ImageData | null = null;
  let lastFlipped: ImageData | null = null;
  const minimap = new Minimap(document.body, {
    sim,
    map,
    view: renderer,
    tones: opts.terrainTones,
    teamColors: opts.teamColors,
    // A thunk: objectives complete and drop off mid-mission, and a sandbox
    // has none at all.
    objectives: () => runtime?.objectiveList ?? [],
    // The map's own lit ground, photographed by the renderer (Task 15).
    // Called on every one of the minimap's 4 Hz redraws, which is NOT a
    // photograph per redraw: `captureGroundAlbedo` answers from its own memo
    // and hands back the same object until its picture changes, and the two
    // memos here make this wrapper do the same. What that buys is the race
    // against `loadGroundTexture`'s six fire-and-forget loads -- a tile that
    // lands after the first capture invalidates it, the next redraw gets a
    // new object, and the minimap re-blits once.
    //
    // `?.` and `?? null` are the whole of the fallback and are not defensive
    // padding: `captureGroundAlbedo` is OPTIONAL on `Renderer` because
    // `renderer.ts` is frozen, so on `?renderer=pixi` this expression is
    // `undefined ?? null` and the minimap paints its own terrain -- which is
    // not a degradation, it is exactly what shipped. `renderer` is held here
    // as a `Renderer`, never as a backend, so the compiler is what keeps
    // this honest rather than a grep.
    //
    // The flip is here rather than in the renderer: the photograph comes
    // back in GL's row order (bottom row first) and `flipRows` is a pure
    // function with its own tests, where a GL readback is untestable --
    // canvas readback is black by design and `preserveDrawingBuffer` stays
    // off.
    groundImage: () => {
      const shot = renderer.captureGroundAlbedo?.(MINIMAP_SIZE) ?? null;
      if (shot === null) return null;
      if (shot === lastShot && lastFlipped !== null) return lastFlipped;
      lastShot = shot;
      lastFlipped = new ImageData(
        flipRows(shot.data, shot.width, shot.height),
        shot.width,
        shot.height
      );
      return lastFlipped;
    },
    // The three player gestures (Task 10). FORWARD REFERENCES, deliberately
    // and not by accident: `orderSink`, `intentWorld` and `minimap` itself
    // are all declared further down this same function, and these three
    // closures name them (`myLiving` is not one of them -- it is declared
    // above, and it is the SAME reading of "whose order is this" the armed
    // left-click path uses, so the two cannot drift). That is safe because none of them RUNS until a
    // pointer event, which cannot be delivered before `bootBattlefield`
    // returns -- by which time every one is initialised. The options object
    // is built here rather than after the instance, and `minimap` is a
    // `const` rather than a `let`, because moving this mount below
    // `intentWorld` (400 lines down, among the input listeners) would put the
    // one piece of body-mounted UI somewhere nobody would look for it.
    input: {
      jumpTo: (x, y) => {
        // `boxToTile` and `screenToWorld` both answer in TILE space, which is
        // what `camera.x`/`camera.y` are measured in (`project.ts` feeds them
        // straight to `isoX`/`isoY`), so there is no conversion here and
        // there must not be one.
        renderer.camera.x = x;
        renderer.camera.y = y;
      },
      // The SAME resolver AND the same carrying-out as the canvas
      // contextmenu below: one `issueOrder`, called twice. A minimap order
      // that resolved differently from the identical click on the field
      // would be two answers to one question, and the one that would drift
      // first is the protected-structure refusal -- invisible on open ground
      // and only reported in the debrief.
      order: (x, y, mods) => issueOrder(intentWorld, orderSink, myLiving(), x, y, mods),
      // Local and silent to the sim (R-10): a mark on the minimap and a
      // marker on the field, nothing queued, nothing dispatched, no intent
      // kind. There is no second player to signal.
      ping: (x, y) => {
        minimap.ping(x, y, performance.now());
        renderer.addOrderMarker(x, y);
      },
    },
  });
  // Also on the body, and it carries its own pointer listeners and canvas.
  onDispose(() => minimap.destroy());
  // Loud, not a console.warn behind a completed loading bar: `failedArt`
  // (collected above, before the HUD existed to report through) names every
  // structure or unit type whose art never loaded. One notice for the whole
  // batch — a burst of individually-failed fetches is one incident, not one
  // per id.
  if (failedArt.length > 0) {
    hud.note(t('main.note.artFailed', { n: failedArt.length, ids: failedArt.join(', ') }), 'bad');
  }
  /** The same notice for a mesh that arrived late and failed. Separate from
   *  `failedArt` because it can happen minutes into a mission, long after that
   *  one batch was decided -- a mesh load started by `ensureUnitMesh` has no
   *  gate to be counted at. Reported once per type. */
  const reportedMeshFailures = new Set<string>();
  const reportMeshFailures = (): void => {
    for (const id of failedMesh) {
      if (reportedMeshFailures.has(id)) continue;
      reportedMeshFailures.add(id);
      hud.note(t('main.note.meshFailed', { id }), 'bad');
    }
  };
  // The instrument, off by default now that the HUD is not built on top of it.
  const overlay = new DebugOverlay(document.body, sim, () => renderer.selection, __GAME_VERSION__);
  // Two panes on the body -- the status pane and the roll feed -- whether or
  // not the instrument was ever opened.
  onDispose(() => overlay.destroy());
  // DebugOverlay does not expose its own visibility, so the intent that
  // reports it is tracked here, kept in lockstep with every `toggle()` call.
  let overlayOn = false;

  // The escape hatches -- back to the campaign map, and the audio toggle --
  // are stamps in the HUD's top strip now (GH-153). The floating `rl-topbar`
  // that used to hold them sat top-centre, which is where the hold clock goes.

  // The orders, handed to the commander so they stay reachable after the
  // deployment screen is gone. Split the same way loading.ts reads them out,
  // so the bar continues that conversation rather than opening a second,
  // differently-punctuated one.
  if (mission?.briefing) hud.brief(briefingBeats(mission.briefing));

  // Mission start punctuation: the operation names itself before the first
  // order is given. Skippable — a replay for a better ROE should not have to
  // sit through it again.
  if (mission) {
    const primaries = mission.objectives.filter((o) => o.primary !== false).length;
    // `dispatch` is the story voice (GDD §11); absent, this card behaves
    // exactly as it always has (`titleCard`'s own contract).
    hud.announce(mission.name ?? mission.id, t('main.announce.primaryObjectives', { n: primaries }), mission.dispatch);
  }

  const start = mission?.map.player_start;
  if (start) {
    renderer.camera.x = start[0];
    renderer.camera.y = start[1];
  }

  // Reinforcements and fire support: the dock, bottom left (GH-153 slice 3).
  let production: ReinforcementDock | null = null;
  /** Armed fire-support purchase awaiting a target, if any. */
  let armedSupport: 'sweep' | 'strike' | null = null;

  if (runtime && mission?.resources) {
    production = new ReinforcementDock(document.body, {
      units: Object.values(units)
        .filter((u) => u.faction === 'kdf')
        .map((u) => {
          // The role bucket comes from the SIM's unit type, through the very
          // `roleBucket` call the selection chips make, so a Namer badged as a
          // transport on its chip cannot be badged as armour on its tile while
          // both are on screen. `typeOf` was filled from the same `units`
          // object above, so the lookup cannot miss.
          const typeIdx = typeOf.get(u.id);
          const simType = typeIdx === undefined ? undefined : sim.unitTypes[typeIdx];
          // `in` rather than `??`: these are JSON module imports, so a field
          // absent from SOME units is absent from the union's type as well.
          // Same narrowing `unitInfo` above already uses for `build_time_s`.
          const abilities = 'abilities' in u ? (u.abilities as string[]) : [];
          const bucket = simType === undefined ? ('soft' as const) : roleBucket(simType);
          return {
            id: u.id,
            name: u.name,
            logistics: u.cost.logistics,
            // The runtime's own default when a unit declares none, so the
            // tooltip's `· 30s` and the bar it fills are one number.
            buildTimeS: 'build_time_s' in u.cost ? u.cost.build_time_s : 20,
            bucket,
            // The dock reads the SAME frame the chips do — `portraits` is
            // resolved from each sheet's own manifest, so the two cannot
            // disagree and neither goes stale when a rig renames its files.
            sprite: portraits[u.id] ?? null,
            spriteIsIcon: portraitIcons.has(u.id),
            tags: doctrineTags(bucket, abilities),
            blurb: 'blurb' in u ? (u.blurb as string) : undefined,
            // The same gate `unitInfo` above hands `MissionRuntime`, so the tile's
            // lock sentence (`gateSentence`, via `dock-model.ts`'s `tileState`) can
            // never disagree with what the runtime is actually enforcing.
            unlock: kdfUnlockGate(u, boughtUnits),
          };
        }),
      runtime,
      ledger,
      missionName: (id) => (missions as Record<string, MissionJson | undefined>)[id]?.name,
      note: (html, tone) => hud.note(html, tone),
      onArm: (kind) => {
        armedSupport = kind;
        // The other half of the mutual exclusion in `orders.attackMove`: only
        // one armed mode can own the next click, and the one just asked for
        // wins.
        if (kind !== null) armedOrder = null;
      },
    });
  }
  // Also on the body, and only on a `resources` mission -- which is exactly
  // why the route walk leaves its soft-booted mission too. The board's first
  // card is `beit_sahwan_breach`, one of the nineteen missions that field a
  // dock; a walk that only ever left the two recon missions could not have
  // seen this one, and did not.
  onDispose(() => production?.destroy());

  // --- input ---------------------------------------------------------------
  const canvas = renderer.canvas;
  // Left drag = box select; a short click = single select.
  const dragBox = document.createElement('div');
  dragBox.className = 'rl-marquee';
  // On the BODY, not the stage -- it is positioned in client coordinates
  // against the canvas's bounding rect -- so the router cannot clear it and
  // this has to.
  document.body.appendChild(dragBox);
  onDispose(() => dragBox.remove());
  let dragStart: { x: number; y: number } | null = null;
  /** Last cursor position over the map, for keyboard-issued orders. */
  const lastCursor = { x: 0, y: 0 };
  /** Whether the pointer is currently over the canvas -- edge pan (below) is
   *  gated on this AND the settings flag AND window focus (see the `blur`
   *  listener beside the canvas's own pointer listeners), so a pointer that
   *  is merely hovering some other part of the page, or one left behind by a
   *  window that lost focus mid-drag, never starts the camera moving. */
  let pointerInside = false;
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
  /** Advances `canvas.dataset.cursorFrame` for whichever cursor in
   *  ANIMATED_CURSORS is currently showing (`attack`, `charge`) -- separate
   *  from the `lastCursorKey` state write above on purpose. `cursor` is not
   *  reliably repainted by a CSS-only animation with the mouse held still
   *  (see ANIMATED_CURSORS's comment in cursor.ts for what was and was not
   *  verified), so this drives the frame index from a plain `setInterval` at
   *  each cursor's own authored rate instead, using the exact JS-dataset-
   *  write mechanism `lastCursorKey` already relies on. Runs only while an
   *  animated cursor is actually showing: `ensureCursorAnim` is called every
   *  `updateHover` tick (every rAF, ~60Hz) regardless of whether the state
   *  key changed that frame, but for every non-animated cursor -- the large
   *  majority of hover time -- its cost is one object-property lookup and an
   *  already-false comparison, no DOM write. The cost while an animated
   *  cursor *is* showing: one attribute write (`data-cursor-frame`) and its
   *  style invalidation, on this one canvas element, every `intervalMs` --
   *  300ms for `attack`, 200ms for `charge` -- not once per rendered frame. */
  let animFrame = 0;
  let animTimer: ReturnType<typeof setInterval> | null = null;
  let animName: CursorName | null = null;
  const stopCursorAnim = (): void => {
    if (animTimer !== null) {
      clearInterval(animTimer);
      animTimer = null;
    }
    animName = null;
  };
  // A `setInterval` outlives the document's attention span, not just the
  // frame loop: left running it writes `data-cursor-frame` to a detached
  // canvas several times a second for the rest of the session.
  onDispose(stopCursorAnim);
  const ensureCursorAnim = (name: CursorName): void => {
    const anim = ANIMATED_CURSORS[name];
    if (!anim) {
      if (animName !== null) stopCursorAnim();
      return;
    }
    if (animName === name) return; // already running the right animation
    stopCursorAnim();
    animName = name;
    animFrame = 0;
    canvas.dataset.cursorFrame = '0';
    animTimer = setInterval(() => {
      animFrame = (animFrame + 1) % anim.frames;
      canvas.dataset.cursorFrame = String(animFrame);
    }, anim.intervalMs);
  };
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
  /** Where a resolved right-click's three effects land. Built once and passed
   *  to `issueOrder` by both pointing surfaces. */
  const orderSink: OrderSink = {
    dispatch,
    note: (text, tone) => hud.note(text, tone),
    marker: (x, y) => renderer.addOrderMarker(x, y),
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
  // Companions for the hover dispatch in `updateHover`: it runs every frame,
  // and an unchanged hover is not a new thing the player did, so these hold
  // the last-dispatched values to gate on a real change.
  let lastHoverEntity = -1;
  let lastHoverStructure = -1;
  // Two ways to be taught: you have not been yet, or you asked to be again.
  // Without the second, the done flag is a one-way door — the lesson is gone
  // for good and only ?fresh=1 brings it back, at the cost of the campaign.
  const tutorialReplay = params.get('tutorial') !== null;
  if (
    mission &&
    stepList &&
    (tutorialReplay || !ledgerStore.tutorialDone())
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
    // Also on the body. `destroy()` is idempotent-by-nulling here: whichever
    // of Skip and the teardown runs first leaves the other with nothing.
    onDispose(() => {
      tutPanel?.destroy();
      tutPanel = null;
    });
    intentListeners.push((intent) => {
      if (!tut) return;
      tut = advance(tut, { kind: 'intent', intent }, performance.now());
    });
  }

  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.button === 0) dragStart = canvasXY(ev);
  });
  // Edge pan's own presence gate. `pointerleave` covers the ordinary case (the
  // mouse crosses back onto the HUD or off the window into the OS chrome);
  // `blur` covers the one it cannot -- a window that loses focus (Alt-Tab, a
  // dev-tools click) while the OS never delivers a `pointerleave` at all,
  // which would otherwise leave `pointerInside` stuck true and the camera
  // panning under an unfocused window.
  canvas.addEventListener('pointerenter', () => {
    pointerInside = true;
  });
  canvas.addEventListener('pointerleave', () => {
    pointerInside = false;
  });
  onWindow('blur', () => {
    pointerInside = false;
  });
  onWindow('pointermove', (ev) => {
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
  onWindow('pointerup', (ev) => {
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
        // Reuses the dock's own SUPPORT word keys (production.ts) so a call's
        // name reads the same on the tile and in the notice that confirms it.
        const wordKey = call === 'sweep' ? 'dock.support.sweep.word' : 'dock.support.strike.word';
        hud.note(
          ok
            ? t('main.note.supportCalled', { name: t(wordKey), x: w.x.toFixed(0), y: w.y.toFixed(0) })
            : t('main.note.supportRefused'),
          ok ? 'info' : 'mute'
        );
        if (ok) renderer.addOrderMarker(w.x, w.y);
        production?.setArmed(null);
        dragStart = null;
        dragBox.style.display = 'none';
        return;
      }
      // An armed order (GH-153's order row) spends this click instead of
      // selecting with it. Attack-move resolves through `resolvePointer` with
      // the same arguments the contextmenu handler passes, so the armed
      // left-click and the right-click are the same order and not two that
      // look alike — Shift still queues, Alt still confirms fire on a
      // protected site. Smoke goes through the same `runVerb` the `f` key
      // does, with this click's point instead of the cursor's.
      if (armedOrder !== null) {
        const spend = armedOrder;
        armedOrder = null;
        if (spend === 'smoke') {
          runVerb('smoke', w);
        } else {
          const mine = myLiving();
          if (mine.length > 0) {
            const move = resolvePointer(intentWorld, {
              ids: mine,
              x: w.x,
              y: w.y,
              append: ev.shiftKey,
              armed: null,
              confirm: ev.altKey,
            });
            for (const intent of move.intents) dispatch(intent);
            if (move.note) hud.note(move.note.text, move.note.tone);
            if (move.marker) renderer.addOrderMarker(w.x, w.y);
          }
        }
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
      // wadi_halam_basin contains a civic hall.
      for (const z of sandboxZones) {
        if (zoneContains(z, tx, ty)) return true;
      }
      return false;
    },
  };
  /**
   * Everything the alert layer may ask about the world (`ui/alerts.ts`'s own
   * `AlertWorld`), built once beside `intentWorld` above and for the same
   * reason: the model stays a pure function over a fixture, and this is the
   * one adapter that knows it is looking at a real `Sim`.
   *
   * `posOf` reads the position of an entity that is usually DEAD -- that is
   * the whole point of `unitLost` -- which is safe because the sim clears
   * `alive` and leaves `posX`/`posY` where the casualty fell. The bounds
   * guard is not defensive noise: `alertsForTick` is handed entity ids out of
   * an event stream, and an id past `entityCount` would read `undefined` out
   * of a typed array and turn into `NaN` through `fx.toNumber`, which draws a
   * flash nowhere and jumps the camera to nowhere, silently.
   *
   * `objectiveAt` goes through `minimap.ts`'s own `objectivePoint` rather
   * than resolving zones and markers a second time here: the camera lands on
   * the diamond the minimap drew, by construction.
   */
  const alertWorld: AlertWorld = {
    posOf: (entity) => {
      if (entity < 0 || entity >= sim.entityCount) return null;
      return { x: fx.toNumber(sim.state.posX[entity]), y: fx.toNumber(sim.state.posY[entity]) };
    },
    sideOf: (entity) => sim.state.side[entity],
    // The same lookup the deploy panel's `broughtFor` caller uses, so a feed
    // line and a briefing line name a unit the same way.
    unitName: (typeId) => units[typeId as keyof typeof units]?.name ?? typeId,
    objectiveAt: (id) => {
      const o = runtime?.objectiveList.find((x) => x.id === id);
      return o === undefined ? null : objectivePoint(o, map);
    },
  };
  /** Carried across ticks: when each entity last made the feed. Copy-on-write
   *  inside `alertsForTick`, so this is only ever reassigned, never mutated. */
  let alertState = initAlertState();
  /** Where the jump key goes. A plain local: it is presentation state about
   *  the last thing worth looking at, it is read by exactly one keydown case,
   *  and nothing outside this function has any business knowing it. */
  let lastAlertAt: { x: number; y: number } | null = null;

  canvas.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const w = renderer.screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top);
    // `issueOrder` rather than a resolve-and-dispatch written out here: since
    // Task 10 the minimap issues the same order from the same function, and
    // this call and that one are the whole of it.
    //
    // It passes `armed: null` for both of us, and that is not an omission: a
    // right-click issues an ordinary order and must never spend an armed
    // support call — only pointerup's left-click can do that.
    // Alt held means the player is deliberately confirming fire on a
    // protected structure. Ctrl is not it: on macOS, Ctrl+left-click fires
    // this same contextmenu with ctrlKey true, and ctrl-click is the
    // standard Mac idiom for opening a context menu — that click already
    // means "confirmed attack," not "let me reconsider."
    issueOrder(intentWorld, orderSink, myLiving(), w.x, w.y, {
      append: ev.shiftKey,
      confirm: ev.altKey,
    });
  });
  // The keyboard, as data (Task 5): `resolveKey` is the one place a raw
  // `KeyboardEvent` becomes an action id, and everything below dispatches on
  // the id rather than the letter. Read live off the settings store and
  // re-read on every change, the same way `panSpeed` already does below --
  // a rebind made from the pause menu (Task 6) over a running mission must
  // reach this listener without a re-boot.
  let bindings = bindingsFrom(req.settings.get().controls.bindings);
  onDispose(req.settings.onChange((next) => {
    bindings = bindingsFrom(next.controls.bindings);
  }));
  const keys = new Set<string>();
  // Control groups 1–9, and double-tap tracking for camera centring.
  const groups = new Map<number, number[]>();
  let lastGroupKey = -1;
  let lastGroupAt = 0;
  /**
   * The recall half of control groups: a bare digit selects the slot's
   * surviving members, and a second recall of the SAME slot inside 400ms
   * centres the camera on them. Extracted (Task 11) so the group bar's click
   * runs through this exact function rather than a second copy of it — R-2's
   * "not a second mechanism" is true in the code, not only in the plan. The
   * assign half (ctrl/cmd+digit) stays inline in the keydown case below,
   * since nothing else needs to trigger it.
   *
   * Sharing `lastGroupKey`/`lastGroupAt` with the keydown case means the
   * double-tap-to-centre gesture is input-agnostic: pressing digit `3` twice,
   * clicking the bar's slot-3 chip twice, or one of each within the window,
   * all centre the camera the same way, because this function does not know
   * or care which input reached it.
   */
  const recallGroup = (slot: number): void => {
    const members = (groups.get(slot) ?? []).filter((i) => sim.state.alive[i] === 1);
    groups.set(slot, members);
    if (members.length === 0) return;
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
  };
  // The control-group bar (Task 11, R-2): a surface over `groups` above, with
  // no state of its own. `groupColor` reads the exact palette entries
  // `renderer.unitGroup`'s own badge already draws with, so the chip and the
  // badge can never drift apart. `onRecall` is `recallGroup` itself -- not a
  // wrapper, not a second path.
  const groupUnitFacts = (id: number): { alive: boolean; hp: number; hpMax: number } | null => {
    if (id < 0 || id >= sim.capacity) return null;
    const type = sim.unitTypes[sim.state.typeIdx[id]];
    return {
      alive: sim.state.alive[id] === 1,
      hp: fx.toNumber(sim.state.hp[id]),
      hpMax: fx.toNumber(type.hp),
    };
  };
  const groupsBar = groupBar(document.body, {
    chips: () => groupChips(groups, groupUnitFacts),
    onRecall: recallGroup,
    groupColor: (slot) => opts.groupColors[slot - 1],
  });
  onDispose(() => groupsBar.dispose());
  onWindow('blur', () => keys.clear());
  onWindow('keydown', (ev) => {
    // The keydown listener used to be an if-chain of literals -- one per
    // bound key, and a second copy of each letter living in
    // `selection-model.ts`'s ORDERS with nothing keeping the two in step.
    // `resolveKey` is the one place a raw event becomes an action id now,
    // and this switch is the one place an action id becomes a call.
    const action = resolveKey(bindings, ev);
    // I1 (final review): ONE guard for the whole handler, not one per case.
    // With a modal up, the only key this listener may still act on is a camera
    // pan -- see `passesThroughModal` for why that one is not a game verb, and
    // for what Tab was doing behind an open dialog before this line existed.
    // It covers the control-group digits below the switch too, which are not a
    // `case` at all and so could never have been guarded case by case.
    //
    // This is a SECOND line of defence, deliberately: both modals already
    // `stopPropagation()` in the capture phase, so in the normal course this
    // listener never runs at all while one is open. What it defends against is
    // the abnormal course -- a modal whose listener is missing (C1) or one that
    // passes a key through on purpose (Tab, Enter, Escape, and the pause menu's
    // pan exemption).
    if (isDialogOpen() && !passesThroughModal(action)) return;
    switch (action) {
      case 'halt':
        // The four bound verbs go through `orders`, which is the very object
        // the HUD's order row calls (GH-153). A key and its button are one
        // function.
        orders.halt();
        break;
      case 'cycleChips':
        // Tab walks the lime frame along the selection chips. Swallowed only
        // when there is something to walk: taking the browser's own focus
        // traversal on a screen with no chips would be a key spent on
        // nothing.
        if (hud.cycleChipFocus()) ev.preventDefault();
        break;
      case 'selectAll':
        ev.preventDefault(); // browser select-all
        renderer.selection = [];
        for (let i = 0; i < sim.entityCount; i++) {
          if (sim.state.side[i] === 0 && sim.state.alive[i] === 1) renderer.selection.push(i);
        }
        break;
      case 'overlay':
        overlay.toggle();
        overlayOn = !overlayOn;
        dispatch({ kind: 'overlay', on: overlayOn });
        break;
      // Mount up / dismount / smoke: the same resolver the right-click uses,
      // asked with a KeyContext instead of a PointerContext. The keys are
      // unchanged; what moved is where the eligibility rules live -- and, as
      // of GH-153, WHERE THE CALL LIVES: `orders` above is the same object
      // the HUD's order row clicks, so Load's key and the Load button are one
      // code path rather than two that have to keep agreeing.
      case 'load':
        orders.load();
        break;
      case 'unload':
        orders.unload();
        break;
      case 'production':
        // The dock's label reads `Reinforcements · B`, and this is what makes
        // that true. It moves keyboard focus onto the first tile the player
        // could actually spend on; from there the tiles are ordinary
        // buttons, so Tab walks them and Enter buys. A label naming a key
        // that did nothing is the same drift slice 2 refused when it
        // declined to print `Attack-move A`.
        // Task 9: this key press IS using the dock, unlike merely reading its
        // hint -- the one place `lions.seen.dock` is ever earned. Gated on
        // `production` actually existing: the key is bound whether or not
        // this mission fields a dock, and a press that did nothing must not
        // be recorded as having taught anything.
        if (production) {
          seen.dock = true;
          markSeen(settingsStore, 'dock');
        }
        production?.focusFirst();
        break;
      case 'smoke':
        // Smoke quick-casts at the cursor rather than arming, which is what
        // it has always done and what a hand already on the mouse wants. The
        // Smoke BUTTON arms instead -- see `armOrder` for why a button
        // cannot quick-cast -- and both end in this same call.
        runVerb('smoke');
        break;
      case 'jumpToAlert':
        // Space is also the activation key of whatever holds focus, and the
        // dock's `focusFirst()` and a Tab onto a chip both leave a button
        // focused -- so the jump stands down and does NOT preventDefault,
        // leaving the control its own key (`shouldYieldSpace`, keymap.ts).
        if (shouldYieldSpace(document.activeElement)) break;
        // The camera, and nothing else: no selection change, no order. The
        // key answers "what just happened, and where" -- deciding what to do
        // about it is still the player's.
        if (lastAlertAt) {
          renderer.camera.x = lastAlertAt.x;
          renderer.camera.y = lastAlertAt.y;
        } else {
          // Not padding. A key that does nothing and says nothing is
          // indistinguishable from a key that is broken -- the lesson the
          // campaign board's locked-ground `aria-live` line records, and the
          // reason `?sandbox` warns an unknown flag by name rather than
          // ignoring it.
          hud.note(t('hud.jump.nothing'), 'mute');
        }
        break;
      case 'idleNext': {
        // The idle-unit finder (Task 11, GDD §6). `ids` is every living
        // side-0 entity, in ascending id order -- the same population and
        // order `selectAll` above walks -- and `nextIdle` cycles the search
        // forward from the currently selected unit (so pressing the key
        // again advances rather than re-selecting the same one), wrapping
        // once back to the front. A selection that is not a single unit
        // (nothing, or a box of several) has no "current" to continue from,
        // so the search starts at the front.
        const ids: number[] = [];
        for (let i = 0; i < sim.entityCount; i++) {
          if (sim.state.side[i] === 0 && sim.state.alive[i] === 1) ids.push(i);
        }
        const idleFactsOf = (id: number): IdleFacts => ({
          alive: sim.state.alive[id] === 1,
          side: sim.state.side[id],
          moving: sim.state.moving[id] === 1,
          waypoints: sim.waypointCount(id),
          curTarget: sim.state.curTarget[id],
          curStructure: sim.state.curStructure[id],
          demoTarget: sim.state.demoTarget[id],
          carriedBy: sim.state.carriedBy[id],
          garrisonedIn: sim.state.garrisonedIn[id],
        });
        const after = renderer.selection.length === 1 ? renderer.selection[0] : -1;
        const id = nextIdle(ids, after, (i) => isIdle(idleFactsOf(i)));
        if (id >= 0) {
          renderer.selection = [id];
          dispatch({ kind: 'select', ids: [id], via: 'click' });
          renderer.camera.x = fx.toNumber(sim.state.posX[id]);
          renderer.camera.y = fx.toNumber(sim.state.posY[id]);
        } else {
          // Same "say why" rule as the jump key just above: nothing found
          // and nothing said is indistinguishable from a broken key.
          hud.note(t('hud.idle.none'), 'mute');
        }
        break;
      }
      case 'keysOverlay':
        // F1 is the browser's own help key everywhere else on the page --
        // always swallowed here, on the open. Blocked over the pause menu by
        // the handler-wide guard above (`isDialogOpen()`, `keysOverlay` is
        // not a pan), the same way every other verb in this switch already
        // is. `toggleKeysOverlay` is a toggle, but fix round 1 (C1) moved the
        // CLOSE half off this case: `.rl-keys` is a dialog now
        // (`isDialogOpen()`, `ui/confirm.ts`), so once it is open this
        // handler-wide guard refuses `keysOverlay` too, and a second F1
        // never reaches this `case` at all -- it is `keys-overlay.ts`'s own
        // capture-phase guard that sees it and closes the card.
        ev.preventDefault();
        toggleKeysOverlay();
        break;
      case 'mute':
        audioMuted = audio.toggle();
        hud.paintMute(); // the key and the strip's chip are one state, both ways
        // Same wording as the strip's own mute chip title (`hud.ts`'s
        // `paintMute`, `hud.mute.muted`/`hud.mute.unmuted`): the key and the
        // chip say the same thing about the same state.
        hud.note(t(audioMuted ? 'hud.mute.muted' : 'hud.mute.unmuted'), 'mute');
        break;
      case 'pause': {
        // Fix wave I1: the in-mission objectives tracker (the strip's `+N`
        // popover, `openObjectives`/`closeObjectives` above) had no keyboard
        // dismiss of its own, so Escape used to fall straight through to the
        // logic below and stack the pause menu ON TOP of an open tracker
        // instead of closing it -- `isDialogOpen()` does not know about
        // `.rl-obj-panel--tracker`. `escapeTarget` (`input/keymap.ts`) is the
        // one place this priority is decided; it hands the tracker Escape
        // first, exclusively, so there is exactly one thing a bare Escape
        // does at a time.
        const target = escapeTarget(objectivesOpen, isDialogOpen());
        if (target === 'closeTracker') {
          closeObjectives();
          break;
        }
        if (target === 'none') break;
        // Fix round 1: this listener is the OLDEST bubble listener on
        // `window` (registered once at boot, long before any dialog
        // exists), so on a bare Escape it used to run BEFORE any dialog's
        // own Escape handler and act on Escape regardless of what was
        // already open -- resuming the game (and tearing the pause menu
        // down) while the player only meant to cancel a "Restart the
        // mission?" confirm stacked on top of it, or opening this menu
        // under the HUD's own "Leave the mission?" confirm. The game now
        // only OPENS the menu, and only when nothing else already owns
        // Escape: not already paused, no confirm or pause modal in the DOM
        // (`isDialogOpen`, `ui/confirm.ts`), and the mission has not ended.
        // Resuming stays exclusively the modal's own job (its bubble Escape
        // handler and its Resume button, both calling `resume` -- see the
        // comment above `pause`).
        //
        // `target === 'pause'` already implies `!isDialogOpen()` (folded into
        // `escapeTarget` above); `pause.test.ts`'s stand-in mirrors this exact
        // expression.
        if (!paused && !missionEnded) pause();
        break;
      }
      case 'panUp':
      case 'panDown':
      case 'panLeft':
      case 'panRight':
        // The PHYSICAL key, not the action -- W and the physical Up arrow are
        // two different keys that both resolve to `panUp`, and storing the
        // action here would collapse them onto one Set entry, so releasing
        // whichever key's `keyup` happens to fire first would stop the pan
        // while the other was still held. `heldAction` (below, in the render
        // loop) is what turns a set of physical keys back into "is this
        // direction held right now".
        keys.add(ev.key.toLowerCase());
        break;
      case null:
        break; // the digit branches below stay exactly as they are
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
          mine.length
            ? t('main.note.groupAssigned', { slot, n: mine.length })
            : t('main.note.groupCleared', { slot }),
          'live'
        );
      } else {
        recallGroup(slot);
      }
    }
  });
  // Deletes the physical key regardless of what it resolves to NOW -- `keys`
  // was populated by physical key, so removal has to match by physical key
  // too, and a delete of something never added is a harmless no-op.
  onWindow('keyup', (ev) => keys.delete(ev.key.toLowerCase()));
  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const z = renderer.camera.zoom * (ev.deltaY > 0 ? 0.9 : 1.1);
    if (req.settings.get().controls.zoomToCursor) {
      const before = renderer.screenToWorld(lastCursor.x, lastCursor.y);
      renderer.camera.zoom = clampZoom(z);
      const after = renderer.screenToWorld(lastCursor.x, lastCursor.y);
      const anchored = zoomAnchor(renderer.camera, before, after);
      renderer.camera.x = anchored.x;
      renderer.camera.y = anchored.y;
    } else {
      renderer.camera.zoom = clampZoom(z);
    }
  });

  // --- fixed-tick loop with render interpolation ---------------------------
  const runTick = (): void => {
    const events = sim.tick();
    renderer.snapshot();
    renderer.onEvents(events);
    audio.setListener(renderer.camera);
    audio.onEvents(events, sim);
    if (runtime && mission) {
      const missionEvents = runtime.step(events);
      // The renderer subscribes to the MISSION's events as well as the sim's.
      // The one it reads today is `evacuated`: `MissionRuntime` clears `alive`
      // for a civilian who reaches the refuge with the same write a casualty
      // gets, so without this the renderer played the crawl-and-fade death
      // pose for someone the player had just rescued. Called here, in the same
      // statement order `onEvents` above already follows, so the fact lands
      // before the frame that would otherwise mistake her for a corpse.
      // Optional on the interface (`api.ts`) -- Pixi draws no civilians at all
      // and implements nothing.
      renderer.onMissionEvents?.(missionEvents);

      // The alert layer (spec acceptance (a)): one classification of the tick,
      // four consequences, all in one place so a line, a cue and a mark can
      // never disagree about what just happened. `ui/alerts.ts` decides WHAT
      // is worth saying; this decides WHERE it goes.
      //
      // `performance.now()` and not `sim.tickCount`: the flash is a
      // presentation fade on the frame clock, and nothing here writes to the
      // sim (invariant 4). The tick count goes the other way -- into the
      // model, as the cooldown's own clock.
      const { state: nextAlerts, alerts } = alertsForTick(
        alertState,
        events,
        missionEvents,
        alertWorld,
        sim.tickCount
      );
      alertState = nextAlerts;
      for (const a of alerts) {
        if (a.line) hud.note(t(a.line.key, a.line.params), a.line.tone);
        if (a.sound) audio.playUi(a.sound);
        if (a.at) {
          minimap.flash([a.at], performance.now());
          lastAlertAt = a.at;
        }
      }

      for (const me of missionEvents) {
        if (tut) tut = advance(tut, { kind: 'mission', event: me }, performance.now());
        if (me.kind === 'roe') deductions.push({ penalty: me.penalty, reason: me.reason });
        const described = describeMissionEvent(me, mission, narratedRoeReasons);
        if (described) hud.note(described[0], described[1]);
        // The story voice (GDD §11): the commander bar is the one surface for
        // it now -- `describeMissionEvent`'s own `case 'say'` returns null,
        // so this is the only place a `say` event lands. See `Hud.say`'s own
        // doc comment for why this call is independent of `brief()`.
        if (me.kind === 'say') hud.say(me.speaker, me.text);
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
          let payout: ReturnType<typeof payMission> | null = null;
          if (me.result === 'victory') {
            // Names are issued here, on the victory path only -- a defeat writes
            // nothing to the ledger at all (see the comment above LEDGER_KEY), so
            // there is no roster to name and no counter to advance. Table order and
            // the `campaign.names_issued` counter are the whole mechanism (spec
            // §4.7); nothing here draws from the sim's RNG.
            const rosterIn = updatedLedger['roster.surviving_units'];
            if (Array.isArray(rosterIn)) {
              // Defaults first, then whatever the save already carried: no cast,
              // now that `LedgerData` declares the key, and a save written before
              // one of the three kinds existed still starts that kind at zero.
              const issuedIn: Record<NameKind, number> = {
                squad: 0,
                vehicle: 0,
                task: 0,
                ...updatedLedger['campaign.names_issued'],
              };
              // R-13's pipeline, step 1: the roster this mission was sent IN.
              // Read off `ledger` and never off `updatedLedger`, which already
              // holds what `checkEnd` produced -- the whole point is to compare
              // the two. It is also the callsign set the PREVIOUS save wrote,
              // which is the set `reattachSlots` matches against and the one
              // `assignNames` is about to extend.
              const before = ledger['roster.surviving_units'] ?? [];
              // R-13 steps 3 and 6, in that order and with `assignNames` after
              // both: `slot` first and `name` after, because identity is what a
              // unit IS and the callsign is what it is CALLED. `checkEnd`
              // rebuilds a FIELDED survivor's entry field by field and copies
              // only `name` (mission.ts:1874-1883), so step 3 is what puts the
              // slot back; step 6 numbers whatever is left -- a body new this
              // mission, or a whole pre-change save on its first write after
              // upgrade. Both halves of that asymmetry are pinned against a real
              // Sim in tools/src/roster-carry.test.ts. Task 5's memorial and
              // vacancy passes land between these two lines.
              const carried = issueSlots(reattachSlots(rosterIn, before), updatedLedger[SLOTS_ISSUED_KEY] ?? 0);
              updatedLedger[SLOTS_ISSUED_KEY] = carried.issued;
              const named = assignNames(carried.roster, issuedIn, (typeId) => nameKind(unitFor(typeId), names as NamesJson), names as NamesJson);
              updatedLedger['roster.surviving_units'] = named.roster;
              updatedLedger['campaign.names_issued'] = named.issued;
            }
            ledgerStore.writeLedger(updatedLedger);
            // The brigade account (spec 2026-09-15 §4.2): what this run is worth, paid
            // only for improvement over what this mission has paid before. Read from the
            // runtime's own counters -- the same numbers the debrief prints -- and the
            // wall clock is taken here, never in the sim.
            // R5: a mission that produces no ledger key pays nothing -- the tutorial
            // (`beit_sahwan_0_tutorial`) is the only one, sits outside `world.json`
            // and therefore outside the pinned ladder, and CLAUDE.md already says it
            // is not a campaign mission. Gate on the mission's own contract rather
            // than a name list, the same test `validate_data.mjs` already applies.
            if (mission.ledger.produces.length > 0 && ledgerStore.available) {
              const runValue = creditsFor(creditInputFrom(runtime, me.roeRating, mission.roe?.fail_below));
              payout = missionId ? payMission(ledgerStore.readAccount(), missionId, runValue, Date.now()) : null;
              if (payout) ledgerStore.writeAccount(payout.account);
            }
            hud.note(t('main.note.ledgerUpdated'), 'info');
          }
          if (missionId) {
            // Campaign order lives in world.json, not in the order data/missions files
            // happen to be imported.
            const nextMissionId = nextMissionAfter(parseWorld(world), missionId, updatedLedger);
            // The full debrief (Task 9's `ui/debrief.ts`), opened from the end panel's
            // `debrief` button. `kdfUnits` mirrors the `unitInfo` builder above's own
            // narrowing (`'unlock' in u`) -- not every kdf unit's JSON declares one.
            // `enemyRegion` is reused rather than a second `regionForTown` call: it is
            // already `regionForTown(worldData, missionTown)`, and `mission.town` is
            // deliberately not modelled on `@lions/sim`'s `MissionJson` (see the
            // comment above `missionTown`), so this is the one cast that already
            // exists rather than a second one. `target_minutes` gets that same
            // treatment -- the sim never reads it either (`grade.ts`).
            const kdfUnits = Object.values(units)
              .filter((u) => u.faction === 'kdf')
              .map((u) => ({
                id: u.id,
                name: u.name ?? u.id,
                unlock: kdfUnlockGate(u, boughtUnits),
              }));
            const tier = tierLine(runtime.stars);
            const promotion = me.result === 'victory' ? promotionAfter(commanderData, worldData, missionId) : null;
            const nextJson = nextMissionId ? (missions as Record<string, MissionJson | undefined>)[nextMissionId] : undefined;
            const region = enemyRegion;
            const villain = region ? commanderData.villains?.[region.id] : undefined;
            // `hostagesAccount` is null for a world that declares no `taken` at
            // all, which is not the same as a world where nobody was taken --
            // that distinction is the whole reason the field is optional, so the
            // line is skipped rather than printed as "Nobody still out."
            const account = hostagesAccount(worldData, updatedLedger);
            const cameBack = me.ledger['civ.hostages_recovered']?.[missionId] ?? 0;
            const place = (mission as { hostages_place?: string }).hostages_place;
            // Truthiness rather than `!== undefined`: the schema puts no
            // `minLength` on `hostages_place`, so an empty string is authorable
            // and would render "Four came back at ." rather than dropping the
            // clause.
            const takenAccount = account
              ? hostagesLine(account, place ? { count: cameBack, place } : undefined)
              : undefined;
            const debriefOpts: DebriefOptions = {
              result: me.result,
              stars: runtime.stars,
              tierLine: tier
                ? { plate: speakerPlate(hudCommander, tier.speaker), text: tier.text, portrait: speakerPortrait(hudCommander, tier.speaker) }
                : undefined,
              roe: me.roeRating,
              roeFloor: starRoeFloor(mission.roe?.fail_below),
              deductions,
              ticks: sim.tickCount,
              targetMinutes: (mission as { target_minutes?: number }).target_minutes,
              lost: Object.entries(runtime.lostByType()).map(([type, count]) => ({ type, count })),
              secondaries: runtime.objectiveList
                .filter((o) => !o.primary)
                .map((o) => ({ text: o.text, complete: o.status === 'complete', carries: o.carries })),
              marked: runtime.markedCount,
              promoted: runtime.promotedCount,
              credits: payout ? { paid: payout.paid, balance: payout.account.balance } : undefined,
              // The account of the taken (spec §4.4). The board prints only the
              // standing total, because the board does not know which mission was
              // just played -- so "N came back at <place>", the half that needs a
              // mission, is this screen's. The count is THIS run's entry off the
              // produced ledger rather than the merged best-of, since the sentence
              // is about what just happened; `hostagesLine` drops the clause on 0
              // and on a mission with no `hostages_place` to name.
              taken: takenAccount,
              // Spec §4.5 wants the WHY, not just the name: "Campaign Conduct
              // 58 → 62: Namer IFV available". The two figures are the campaign
              // mean before and after this mission's rating landed, so they are
              // read off the two ledgers this block already holds. Either being
              // null means there is no figure to show (a first mission has no
              // "before"), and the bare name is the honest fallback rather than
              // a sentence with a hole in it. A mission-gated unit never has a
              // figure at all -- the mission it was waiting for is the one the
              // player just finished, and this screen is already that news.
              unlocked:
                me.result === 'victory'
                  ? newlyUnlocked(kdfUnits, ledger, updatedLedger).map((u) => {
                      if (u.gate === 'stars') return `${starsEarned(updatedLedger)} stars: ${u.name} available`;
                      if (u.gate !== 'conduct') return `${u.name} available`;
                      const was = campaignRoe(ledger)?.mean;
                      const now = campaignRoe(updatedLedger)?.mean;
                      return was === undefined || now === undefined
                        ? `${u.name} available`
                        : `Campaign Conduct ${was} → ${now}: ${u.name} available`;
                    })
                  : [],
              promotion: promotion
                ? {
                    rank: promotion.rank,
                    stars: promotion.stars,
                    line: promotion.line ? { plate: speakerPlate(hudCommander, promotion.line.speaker), text: promotion.line.text } : undefined,
                  }
                : undefined,
              next: nextMissionId
                ? {
                    id: nextMissionId,
                    name: nextJson?.name ?? nextMissionId,
                    villainLine:
                      region && villain?.lines
                        ? villain.lines[villainState(region, updatedLedger, (id) => (missions as Record<string, MissionJson | undefined>)[id], villain.ends_at)]
                        : undefined,
                  }
                : undefined,
              missionId,
            };
            // G11: `debrief` is outcome-aware -- pick the variant for the
            // outcome that just happened, off the same `me.result` this
            // screen's own `result` is, and resolve its speaker into a
            // plate/portrait the same way `hud.ts`'s commander bar does
            // (`speakerPlate`/`speakerPortrait`, `hud-model.ts`), since
            // `menu.ts` has no `HudCommanderInfo` of its own to look one up
            // against. `mission` is still the same JSON object
            // `getMission()` reads `aftermath` off, above.
            const say = me.result === 'victory' ? mission.debrief?.victory : mission.debrief?.defeat;
            const debrief: EndScreenDebrief | undefined = say
              ? {
                  plate: speakerPlate(hudCommander, say.speaker),
                  text: say.text,
                  portrait: speakerPortrait(hudCommander, say.speaker),
                  speaker: say.speaker,
                }
              : undefined;
            // Fix round 1: set at the exact point `showEndScreen` is about
            // to show, per the review -- `case 'pause':` reads this and
            // Escape does nothing once the attempt is over. If the pause
            // menu happened to be open when the mission ended, close it
            // directly rather than through `resume()`: there is no clock to
            // resume any more (the mission is over, not merely unpaused),
            // so this only needs to take the modal off the screen and let
            // `paused` settle back to its resting `false`.
            missionEnded = true;
            if (paused) {
              paused = false;
              pauseHandle?.close();
              pauseHandle = null;
            }
            // Fix round 1 (task 6 review, I2): the tracker is independent of
            // `paused` (it can be open on an unpaused battlefield), so it
            // gets its own unconditional close rather than riding the branch
            // above -- otherwise it would render over the end screen about
            // to be pushed, and once every objective resolves the strip's
            // own button (its only other way to close) vanishes.
            closeObjectives();
            // Task 8: same reasoning as the tracker above -- F1 is independent
            // of `paused` too, and left open it would render over the end
            // screen about to be pushed.
            closeKeysOverlay();
            screenDisposers.push(
              showEndScreen(document.body, {
                result: me.result,
                roe: me.roeRating,
                survivors: me.survivors.length,
                missionId,
                nextMissionId,
                debrief,
                onDebrief: () => {
                  screenDisposers.push(showDebrief(document.body, debriefOpts));
                },
              })
            );
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
          ledgerStore.setTutorialDone(true);
          hud.note(t('main.note.tutorialComplete'), 'good');
          if (stepList?.completes !== undefined) runtime.completeObjective(stepList.completes);
          tut = null;
          tutPanel?.destroy();
          tutPanel = null;
          renderer.clearTutorialFocus();
        }
      }
    }
    // `&civ`: the same two calls `MissionRuntime.step` makes, in the same
    // order and at the same point in the tick, against the SAME rule object
    // from `@lions/sim` -- not a sandbox reimplementation of it. A sandbox has
    // no runtime, so without this the crowd stands still forever: nothing else
    // can order a side-2 unit (the player selects side 0), so `move` would be
    // a clip that ships and never plays, and the evacuation fade would stay
    // reachable only by launching a real mission.
    //
    // `evacuated` is built here rather than returned by the rule because the
    // two callers announce differently and only the identity matters: without
    // it the renderer sees the same `alive = 0` a casualty leaves and plays
    // the crawl-and-fade death pose for someone who walked to safety.
    if (civFlight && civRefuge) {
      const refuge = [
        fx.add(fx.fromInt(civRefuge.at[0]), HALF),
        fx.add(fx.fromInt(civRefuge.at[1]), HALF),
      ] as const;
      civFlight.step(sim, sandboxForce.civilians, sandboxForce.player, refuge);
      const out = civFlight
        .collect(sim, sandboxForce.civilians, civRefuge.zone)
        .map<MissionEvent>((entity) => ({ kind: 'evacuated', tick: sim.tickCount, entity }));
      if (out.length > 0) {
        renderer.onMissionEvents?.(out);
        hud.note(
          t('main.note.civEvacuated', { n: civFlight.evacuatedCount, total: sandboxForce.civilians.length }),
          'good'
        );
      }
    }
    hud.onTick();
    minimap.onTick();
    // Task 11: same cadence as the HUD's own chip row -- rebuilt wholesale
    // every tick from the `groups` map, which is why the bar's click has to
    // be delegated rather than bound per chip.
    groupsBar.refresh();
    overlay.onTick(events);
    if (production && sim.tickCount % 5 === 0) production.refresh();
    // Task 6: the same 4 Hz cadence `production.refresh()` above already uses
    // (Hud.onTick's own throttle, `tickN % 5`, is private -- this mirrors it
    // rather than reaching for it), and ONLY while the tracker is open: a
    // closed popover costs nothing, since `openObjectives` itself already
    // refreshed it once on the way in.
    if (objectivesOpen && sim.tickCount % 5 === 0) objectivesHandle?.refresh();
    // The safety net under roster-driven mesh loading, once a second.
    //
    // `missionUnitTypes` reads the mission JSON and `sandboxUnitTypes` reads
    // the placement tables; between them they should name every type that ever
    // stands on this map. If one is ever missed, the old failure was the worst
    // kind -- `SPRITE_MAP`'s: a unit that quietly draws the wrong thing, or
    // nothing, with no gate anywhere. This makes that case LOUD and
    // self-healing instead: whatever is actually alive gets its mesh, named in
    // the console so the roster can be fixed rather than lived with.
    //
    // Bounded by `sim.entityCount`, the same scan `__lions.units()` does, at
    // 1 Hz against a 20 Hz tick. `ensureUnitMesh` returns immediately for a
    // type already asked for, so the steady-state cost is the loop itself.
    if (meshPathActive && sim.tickCount % TICKS_PER_SECOND === 0) {
      for (let i = 0; i < sim.entityCount; i++) {
        if (sim.state.alive[i] !== 1) continue;
        const typeId = sim.unitTypes[sim.state.typeIdx[i]].id;
        if (meshLoaded.has(typeId) || !hasUnitMesh(typeId)) continue;
        console.warn(
          `[lions] ${typeId} reached the field with no mesh queued — loading it now. ` +
            `Its roster (mesh-catalogue.ts) missed it; that is the bug, not this line.`
        );
        ensureUnitMesh(typeId);
      }
      reportMeshFailures();
    }
    // Show the ground a timed objective is about, and how it is going.
    if (runtime && sim.tickCount % 5 === 0) {
      // The single zone is the Pixi backend's whole picture (renderer.ts is
      // frozen); three draws the full list beside it -- every active zone
      // objective, the cache's draw included (objective-zones.ts).
      const timed = runtime.objectiveList.find((o) => o.status === 'active' && o.zone !== undefined);
      const rect = timed?.zone !== undefined ? map.zones[timed.zone] : undefined;
      renderer.objectiveZone = rect ?? null;
      renderer.objectiveZoneState =
        timed?.paused === 'contested' ? 'contested' : timed?.paused === 'unheld' ? 'unheld' : 'held';
      renderer.objectiveZones = objectiveZonesFor(runtime.objectiveList, map.zones);
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
  /**
   * Take the dev hook off on the way out -- `window` is not the stage, so
   * nothing else would, and a `__lions` pointing at a disposed renderer and a
   * frozen sim is worse than none: `__lions.step()` on it draws into a lost
   * context. `pnpm ui:routes` asserts its absence after a leave, which is the
   * cheapest single question that distinguishes "the battlefield went away"
   * from "the battlefield is still running behind the screen you can see".
   *
   * Deleted BY IDENTITY, not by name. A superseded mount's disposer can run
   * after the next battlefield has already installed its own hook, and a bare
   * `delete window.__lions` would take that one down instead -- leaving a live
   * mission with no console API and no error to say why.
   */
  const lionsHandle = (window as unknown as Record<string, unknown>).__lions;
  onDispose(() => {
    const w = window as unknown as Record<string, unknown>;
    if (w.__lions === lionsHandle) delete w.__lions;
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

  // The FRIENDLY hover, for the range-ring preview (shell Phase 2 Task 16).
  // Its own field, never `hoverEntity`: that one is the HOSTILE hover and the
  // cursor hinting and the projected-fire panel both read it, so writing a
  // friendly id there would put a fire solution on the player's own squad.
  //
  // Same half-tile generosity as the enemy scan above, and the same
  // `renderer.isVisible` gate -- a unit the fog is hiding must not draw a
  // range envelope either, which for a side-0 unit only ever matters to a
  // spectator or a replay.
  //
  // A unit ALREADY in the selection is excluded, because a selected unit
  // draws its envelope at full strength and a preview over the top would be
  // the same shape drawn twice. BOTH sides check that, deliberately: here, so
  // the field never names a unit the preview does not mean; and again in
  // `ThreeRenderer`'s ring block, because the selection can change between
  // this write and the next frame that reads it -- `updateHover` runs per
  // frame but a click sets the selection whenever it lands.
  let hf = -1;
  let bestF = 0.5 * 0.5;
  for (let i = 0; i < sim.entityCount; i++) {
    if (sim.state.alive[i] === 0 || sim.state.side[i] !== 0) continue;
    const ex = fx.toNumber(sim.state.posX[i]);
    const ey = fx.toNumber(sim.state.posY[i]);
    if (!renderer.isVisible(ex, ey)) continue;
    const dx = ex - hw.x;
    const dy = ey - hw.y;
    const d = dx * dx + dy * dy;
    // The selection test sits INSIDE the distance test, not above it. It is a
    // linear scan of an array the player can fill with the whole roster, and
    // the outer loop runs over every living side-0 entity every frame; the
    // half-tile radius rejects all but a handful before it, so only those few
    // ever pay for it. Same answer, since neither test can change the other's.
    if (d < bestF && !renderer.selection.includes(i)) {
      bestF = d;
      hf = i;
    }
  }
  renderer.rangeRingPreview = hf;

  // Teach the hover, but only on a real change: `updateHover` runs every
  // frame, and an unchanged hover is not a new thing the player did.
  if (tut && (he !== lastHoverEntity || hs !== lastHoverStructure)) {
    lastHoverEntity = he;
    lastHoverStructure = hs;
    tut = advance(tut, { kind: 'hover', entity: he, structure: hs, sideOf: (e) => sim.state.side[e] }, performance.now());
  }

  // Keep the projected-fire panel beside the target it describes. Per frame
  // rather than per tick: the HUD rebuilds its CONTENT at 4 Hz, and a panel
  // anchored to a moving unit at 4 Hz visibly steps along behind it. Projection
  // is asked for, never recomputed here (CLAUDE.md: `renderer.worldToScreen`).
  if (he >= 0) {
    const p = renderer.worldToScreen(fx.toNumber(sim.state.posX[he]), fx.toNumber(sim.state.posY[he]));
    hud.placeFire(p.x, p.y);
  }

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
  // Keyed on `name` (the bare verb), not `key`: a badge change alone --
  // `attack` to `attack-kamikaze` from a selection change while still
  // hovering the same target -- must not restart the pulse, only a change
  // of *which* animation (or none) should be running does.
  ensureCursorAnim(name);
  };

  // Paint one real frame before the rAF loop ever gets a callback -- GitHub
  // GH-141. `renderer.frame()` already builds mesh entities (`updateMeshUnits`/
  // `updateVehicleMeshes`) from whatever is CURRENTLY alive in `sim`, with no
  // tick-based gate of its own; the templates (awaited above) and every
  // starting unit (spawned above, sandbox or mission) both already exist by
  // this point. The gap was never in what `frame()` does, only in nothing
  // having called it yet: `main.ts`'s only call site was inside `loop()`
  // below, reachable exclusively through `requestAnimationFrame`, and rAF is
  // throttled to near-zero the moment a tab is backgrounded or unfocused --
  // exactly the state a browser automated for an art check sits in, which is
  // how this shipped unnoticed. Until that first rAF callback landed,
  // `vehicleMeshEntities`/`meshUnitEntities` stayed empty and the billboard
  // sprite path drew instead, indefinitely.
  //
  // `sim.tick()` is deliberately NOT called here -- only `frame()`, the exact
  // call `__lions.step()` already makes after its own tick loop. `tickCount`
  // stays 0, so a page that boots this way still reads as tick 0 to anyone
  // asking, `__lions.step(n)` still means exactly n ticks from here, and this
  // is presentation-only: nothing about sim state changes, only what has
  // already been painted once before anything can observe it unpainted.
  // `renderer.init()` (`ThreeRenderer.init()`'s own comment) has already run
  // `snapshot()` twice, seeding prevX == curX from the sim's real starting
  // positions -- alpha is irrelevant here as a result, but `1` matches
  // `__lions.step()`'s own call for the same reason: on a still frame,
  // prevX + (curX - prevX) * alpha reduces to curX regardless.
  renderer.frame(1, lastFrameMs);

  // Task 6: the accumulator is `shell/clock.ts`'s pure `Clock`, so "paused"
  // (fed in below) is unit-tested without a browser. `paused` is READ here,
  // never written -- `pause`/`resume` above are the only writers.
  const clock: Clock = { acc: 0, last: performance.now() };
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
    // The speed control feeds the ACCUMULATOR, never the tick. A tick is 50 ms
    // of sim time at every setting (invariant 1); 2x runs two of them where one
    // would have run, and 0 runs none while the frame still draws, so the
    // camera and the selection stay live in a pause. `paused` stops the
    // accumulator itself (Task 6) -- `__lions.step` bypasses this whole loop
    // and calls `runTick` directly, so it still advances the sim while paused,
    // which the tools depend on.
    const { ticks, frameMs } = advanceClock(clock, performance.now(), gameSpeed, paused, MS_PER_TICK);
    lastFrameMs = frameMs;
    for (let i = 0; i < ticks; i++) runTick();
    // Read live off the settings store, not snapshotted at boot: `set()`
    // reaches every open battlefield the moment the player changes it,
    // pause menu included (Task 6) -- `get()` is a plain getter, so this
    // costs nothing extra per frame.
    const panSpeed = (0.5 * req.settings.get().controls.cameraSpeed) / renderer.camera.zoom;
    // `keys` holds PHYSICAL keys (Task 5 fix round 1) -- W and the physical
    // Up arrow are two different keys that both mean `panUp`, so `held`
    // asks whether ANY held key currently resolves to that action rather
    // than testing one fixed spelling. Holding W and ArrowUp together and
    // releasing only one keeps the camera panning.
    const held = (action: 'panUp' | 'panDown' | 'panLeft' | 'panRight'): boolean =>
      heldAction(bindings, keys, action);
    if (held('panUp')) {
      renderer.camera.x -= panSpeed;
      renderer.camera.y -= panSpeed;
    }
    if (held('panDown')) {
      renderer.camera.x += panSpeed;
      renderer.camera.y += panSpeed;
    }
    if (held('panLeft')) {
      renderer.camera.x -= panSpeed;
      renderer.camera.y += panSpeed;
    }
    if (held('panRight')) {
      renderer.camera.x += panSpeed;
      renderer.camera.y -= panSpeed;
    }
    // Edge pan: same speed term as the keys above, gated on its own setting
    // (default off -- see settings.ts) AND the pointer actually being over
    // the canvas AND the window holding focus, so a player reaching for the
    // minimap or the dock never finds the map scrolling under them.
    if (req.settings.get().controls.edgePan && pointerInside) {
      const e = edgeVector(lastCursor.x, lastCursor.y, canvas.clientWidth, canvas.clientHeight, EDGE_MARGIN_PX);
      const d = panDelta(e.right, e.down, panSpeed);
      renderer.camera.x += d.dx;
      renderer.camera.y += d.dy;
    }
    renderer.frame(clock.acc / MS_PER_TICK, lastFrameMs);

    updateHover();
  };
  rafId = requestAnimationFrame(loop);
  // The load-bearing line of this whole teardown, and the one the route walk
  // is calibrated against: without it the loop re-requests itself forever,
  // ticking the sim and drawing into a disposed renderer from behind whatever
  // screen the player went to. `pnpm ui:routes` was run with exactly this line
  // commented out and fails on the console errors that produces, which is what
  // makes its green run evidence rather than an assumption.
  //
  // `requestAnimationFrame` above is deliberately left as the bare global so
  // `capture-protocol.ts`'s `FREEZE_FRAME_LOOP_STATEMENTS` can still stop the
  // loop by replacing `window.requestAnimationFrame` -- the golden gate's
  // whole settle depends on that, and a captured local would be invisible to
  // it. `cancelAnimationFrame` is the global for the same reason.
  onDispose(() => cancelAnimationFrame(rafId));

  return teardown;
}

main().catch((err: unknown) => {
  console.error('boot failed:', err);
  const stage = document.getElementById('stage');
  if (stage) {
    const body = err instanceof Error ? (err.stack ?? err.message) : String(err);
    // Not t(): main() itself just threw, which can happen before its own
    // locale boot (loadLocale/setCatalogue) ever runs -- the catalogue is
    // not a safe thing to call into here. Every other bootError call site
    // in this file runs from a router callback or bootBattlefield, well
    // after main()'s boot sequence has completed successfully.
    bootError(stage, 'Boot failed', body); /* i18n-ok: boot failure before the catalogue */
  }
});
