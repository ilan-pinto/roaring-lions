// @lions/app — shell. Composes sim + render + data.
// Two modes: the M0 sandbox (default) and mission mode
// (?mission=<id>), where a MissionRuntime interprets declarative mission
// JSON. The app owns the real-time loop: the sim ticks at a fixed 20 Hz from
// an accumulator; the renderer interpolates between ticks (invariant 1).

import { objectiveZonesFor } from './objective-zones';
import { activeRefuge, evacuationTargets, refugePoint, withEvacuationProgress } from './evacuation';
import { unitsJustOutside, withOutsideCounts } from './hold-outside';
import { deadlineWarningLine, deadlineWarnings, failureReason } from './ui/mission-failure';
import { nameKind, type NamesJson } from './names';
import { applyRosterCarryover } from './roster-carryover';
import { logDestroyed, logMissionEvent, newMissionLog, type MissionLog } from './mission-log';
import { lostRecordFor, predecessorOf } from './roster-lost';
import {
  Sim,
  fx,
  HALF,
  TICKS_PER_SECOND,
  CivilianFlight,
  CIV_FLEE_AT,
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
} from '@lions/sim';
// ThreeRenderer is deliberately NOT imported here: it arrives by dynamic
// import below, and eslint bans a static import of `@lions/render/three` --
// the barrel imported here is three-free.
import {
  DebugOverlay,
  BattleAudio,
  TERRAIN_DECOR,
  type AudioManifest,
  type EmitterSpec,
  type Renderer,
  type RendererOptions,
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
  parseMap,
  applyTerrain,
  applyMissionLocale,
  DECOR,
  paletteColor,
  audioManifest,
  vfxEmitters,
  menuDiorama,
  structures as structureCatalogue,
  type KitLevel,
  type MapJson,
  type MissionLocaleOverlay,
  type UpgradableUnit,
  firstUseHints,
} from '@lions/data';
import './ui/theme.css';
import { Hud, type HudCommanderInfo, type MissionView, type OrderHandlers, type Tone } from './ui/hud';
import { hintFor, loadSeen, markSeen } from './ui/hint-model';
import { createShownTimer, loadHintsSeen, markHintSeen, owedRule, type HintContext } from './ui/hint-rules';
import { portraitIds, unitIcon, unitPlate } from './ui/portrait';
import { trackCloseup } from './ui/garage-closeup';
import { Minimap, MINIMAP_SIZE, flipRows } from './ui/minimap';
import { alertsForTick, initAlertState, missionEventTier, nextJump, type Alert, type AlertState, type JumpTarget } from './ui/alerts';
import { sandboxAlertsForTick } from './ui/sandbox-feed';
import { PinnedSince } from './ui/pinned-since';
import { alertWorldFor } from './ui/alert-world';
import { placeOnScreen } from './ui/alert-place';
import { ALERT_CUE, CRITICAL_CUES, OUTCOME_CUE, tickCue } from './ui/cues';
import { ambienceBedToPlay } from './ambience';
import { installConfirmCue } from './ui/confirm-cue';
import { CivFlightWatch, type CivObservation } from './ui/civ-flight';
import { refugeJump, sayFlight } from './ui/refuge-ping';
import { INITIAL_PINNED_NOTE, pinnedOrderNote } from './ui/pinned-order';
import { isPinned } from './ui/pinned';
import { showMenu, showCampaign, showSandbox } from './ui/menu';
import { showBrigade, type BrigadeUnit, type GarageState } from './ui/brigade';
import { accountView } from './account-view';
import { kdfUnlockGate } from './kdf-gate';
import { coinTiers, grantTestCoins, seedTestCoins, testCoinsParam } from './roar-test';
import { buyWithTestCoins, type CoinHalf } from './ui/stores-model';
import { CUE_SET } from './ui/garage-model';
import { upgradePrepass } from './upgrade-prepass';
import { clock as missionClock, showDebrief, type DebriefOptions, type ReportSpeaker } from './ui/debrief';
import { campaignComplete, closingExchange } from './campaign-close';
import { feedbackDialog } from './ui/feedback-dialog';
import { ratingPrompt, type RatingPrompt } from './ui/feedback-prompt';
import { browserFeedbackSession, type FeedbackSession, type SessionNote } from './feedback/session';
import { collectContext, type ContextInput } from './feedback/context';
import { installErrorRing, recentErrors } from './feedback/errors';
import { isClosed as feedbackClosed } from './feedback/gate';
import { gpuName } from './feedback/gpu';
import { takePicture } from './feedback/picture';
import { answered as promptAnswered, asked as promptAsked, ignored as promptIgnored, readPromptState, shouldAsk, writePromptState } from './feedback/prompt-policy';
import { ReplayRecorder } from './feedback/replay';
import { afterAction, promotionsBetween } from './ui/after-action';
import { livingHostiles } from './ui/withdrew';
import { outcomeMoment, outcomeMomentOptions } from './ui/outcome-moment';
import { beatCamera, beatFocus, beatPose, beatThenReport, hideForBeat, type BeatCamera } from './ui/outcome-beat';
import { showSettings, type SettingsDeps } from './ui/settings-panel';
import { keymapRows } from './ui/settings-keymap';
import {
  EDGE_MARGIN_PX,
  clampCamera,
  clampZoom,
  createPanDrag,
  edgeVector,
  isPanDragButton,
  panning,
  planZoom,
  stepPan,
  stepZoomGlide,
  wheelZoomFactor,
  zoomAnchor,
  type PanVelocity,
  type ZoomGlide,
} from './ui/camera-input';
import { closeOpenDialog, confirmDialog, isDialogOpen } from './ui/confirm';
import { leaveCopy, leaveHref } from './ui/leave-copy';
import { closeTip } from './ui/tooltip';
import { objectiveStatusShout } from './ui/objective-status';
import { pauseMenu } from './ui/pause';
import { advance as advanceClock, type Clock } from './shell/clock';
import { applySettings, loadSettings, saveSettings, settingsBus, type Settings } from './settings';
import { anyArmed, bindingsFrom, escapeTarget, heldAction, isAction, isTextEntry, keyLabel, overridesOf, passesThroughModal, resolveKey, shouldYieldSpace } from './input/keymap';
import { buyUnlock, buyUpgrade } from './brigade-account';
import { payVictory } from './campaign-pay';
import { tierLine } from './ui/grade-copy';
import { clocklessObjectives, speakerPlate, speakerPortrait, withoutHiddenClocks } from './ui/hud-model';
import { briefingBeats, broughtFor, showDownloadProgress, showLoading, type FieldOrder } from './ui/loading';
import { briefingGlance, objectiveClock } from './ui/briefing-glance';
import { groundMarks } from './ui/ground-marks';
import { briefingSections, pickBriefingImage } from './ui/briefing-sections';
import { deployRosterView } from './ui/deploy-roster';
import { deployedLedger, type DeploySelection } from './ui/deploy-select';
import { startMission } from './mission-start';
import { initTelemetry, telemetry, NOOP_TELEMETRY, type Loadout, type MissionTelemetry, type RuntimeView } from './telemetry';
import { startLoadout } from './telemetry/loadout';
import { screenFor } from './telemetry/events';
import { objectivesPanel, type ObjectiveRow } from './ui/objectives';
import { focusTrap } from './ui/focus-trap';
import { showKeysOverlay } from './ui/keys-overlay';
import { groupBar, groupChips } from './ui/group-bar';
import { isIdle, nextIdle, type IdleFacts } from './ui/idle';
import { escapeHtml } from './ui/escape-html';
import { watchSmallScreen } from './ui/small-screen';
import { bootFailureCard, bootFailureKind, guardBoot, mountErrorCard, mountInterrupted, watchContextLoss } from './ui/boot-failure';
import { webgl2Available } from './ui/webgl-probe';
import { alertNotice, evacuatedNotice, reinforceTrigger, removedNotice, ledgerSavedNotice, triggerLabel, unknownSandboxMapNotice } from './ui/mission-notice';
import { ReinforcementDock } from './ui/production';
import { doctrineTags } from './ui/dock-model';
import {
  applyIntent,
  issueOrder,
  haltNote,
  orderDenied,
  resolvePointer,
  resolveKeyVerb,
  type OrderSink,
  type PlayerIntent,
  type IntentWorld,
} from './input/intents';
import { ANIMATED_CURSORS, type CursorName } from './input/cursor';
import { cursorAt, pointerPoint, simIntentWorld } from './input/pointer';
import { cursorAnimDriver } from './input/cursor-anim';
import { prefersReducedMotion } from './ui/motion';
import { roleBucket } from './ui/role';
import { rosterLanguages, voiceClassOf } from './voice/lines';
import { VoiceRuntime, voicePlaceholderOn } from './voice/voice-runtime';
import { roeNotice } from './ui/roe-notice';
import {
  invoiceLines,
  placeNamesFor,
  reasonLabel,
  type Deduction,
  type PlaceNames,
} from './ui/conduct-invoice';
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
  bootTiers,
  sandboxUnitTypes,
  type SandboxExtras,
} from './sandbox-force';
import {
  RIGGED_UNIT_MESHES,
  VEHICLE_UNIT_MESHES,
  BUILDING_MESHES,
  VFX_MESHES,
  meshUrl,
  missionUnitTypes,
  hasUnitMesh,
  meshPlanFor,
  meshManifestFor,
  dracoDecoderPath,
} from './mesh-catalogue';
import { rendererOptionsFor } from './renderer-options';
import { bindLiveTeamColors } from './live-team-colors';
import { garageColors, garageGroundTexture, garageModelSource } from './garage-model-source';
import { standMapStructures } from './map-sim';
import { readFlags, sandboxHelp, unknownParams } from './sandbox-help';
import { lightOverrideOf, timeOfDayOf } from './time-of-day';
import { buildingFitOf } from './building-fit-flag';
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
import { forgetRetiredKeys } from './retired-keys';
// The menu's scene host (scene-host plan, Task 6): the lit diorama behind the
// column. `ui/scene-host.ts` is the only thing that reaches its three.js door,
// by a dynamic import, so neither import below pulls three into this chunk.
import { sceneHost } from './ui/scene-host';
import { dioramaSceneOptions } from './front/diorama';
import { initTutorial, advance, type TutorialState, type StepJson } from './tutorial/runtime';
import { tutorialPanel, type TutorialPanel } from './tutorial/panel';
import { hudVisibility, type MissionHudJson, type TutorialHudJson } from './tutorial/hud-visibility';
import type { HudElement } from './ui/hud-elements';
import { fireState, type FireState } from './ui/fire-state';
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
import { browserLedgerStore, newCampaign, type CampaignLedger, type LostRecord } from './ledger-store';
import { showSaves, type SavesDeps } from './ui/saves';
import { showCredits, type CreditsDeps } from './ui/credits';
import { LOCALES, applyLocale, loadLocale } from './i18n/locales';
import { currentLocale, missingKeys, setCatalogue, t } from './i18n/t';
import { pseudo } from './i18n/pseudo';

/** Deploy base ('/' locally, '/<repo>/' on GitHub Pages) — every asset URL
 *  is built from it so the same bundle works in both places. */
const BASE = import.meta.env.BASE_URL;
/** Every battlefield's `Sim` seed. A constant, so a feedback replay can rebuild
 *  the battle from the start and the orders alone (GH-464 §4.3). */
const SIM_SEED = 20260727;

/** The deploy screen's sections and image, with every path resolved against
 *  BASE (GH-119). A pool picks once, here, at mount. */
function briefingLayout(
  mission: MissionJson | undefined
): { sections: ReturnType<typeof briefingSections>; image?: string } | undefined {
  if (mission === undefined) return undefined;
  const sections = briefingSections(mission.briefing, mission.briefing_sections);
  const resolved = sections?.map((s) => (s.image !== undefined ? { ...s, image: `${BASE}${s.image}` } : s)) ?? null;
  const image = pickBriefingImage(mission.briefing_image);
  return image !== undefined ? { sections: resolved, image: `${BASE}${image}` } : { sections: resolved };
}

const MS_PER_TICK = 1000 / TICKS_PER_SECOND;

/** The briefing's ground photograph, px a side: a 48-tile map at about 13 px
 *  a tile, sharp on the ~580 px frame a 1400x900 screen gives it and on the
 *  ~900 px one at 2560. */
const BRIEFING_GROUND_PX = 960;

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
  narratedRoeReasons: Set<string> = new Set(),
  /** GH-345: names the places an ROE reason mentions, for the invoice-style
   *  feed line. Absent, the line falls back to the sim's reason. */
  places?: PlaceNames
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
      // A labelled `reinforce` is the alert layer's: it says the label once,
      // with where the units arrive (WP-P5, `ui/alerts.ts`).
      if (reinforceTrigger(mission, e.id) !== null) return null;
      const label = triggerLabel(mission, e.id);
      return label === null ? null : [escapeHtml(label), 'warn'];
    }
    case 'wave':
      // WP-P5: the alert layer words a wave now, with the direction it
      // enters from (`ui/alerts.ts`); a second line here would say it twice.
      return null;
    case 'roe': {
      const first = !narratedRoeReasons.has(e.reason);
      narratedRoeReasons.add(e.reason);
      return roeNotice(
        e.penalty,
        e.reason,
        e.score,
        mission.roe?.fail_below,
        first,
        places ? reasonLabel(e.reason, places) : e.reason
      );
    }
    case 'built':
      // WP-P5: likewise -- `alert.arrived` names the unit and where it stands.
      return null;
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

function bootError(stage: HTMLElement, title: string, body: string, next: string, home = routes.menu()): void {
  mountErrorCard(stage, { title, body, next, reload: false }, home);
}

/** A screen that could not be mounted (pass K): the error goes to the
 *  console whole, and the player gets `ui/boot-failure.ts`'s card -- what
 *  happened, why and what next, in the game's words -- never the exception's
 *  message or its stack. */
function bootFailure(stage: HTMLElement, err: unknown): void {
  console.error('boot failed:', err);
  stage.replaceChildren();
  mountErrorCard(stage, bootFailureCard(bootFailureKind(err, webgl2Available())), routes.menu());
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
    // The render package cannot read this build's flag; a thrown voice decode
    // pass is noted (one `console.info`) in any dev build, not only under
    // `?voicetick` (R-9).
    mixer.setDev(import.meta.env.DEV);
    mixer.useManifest(audioManifest as AudioManifest, `${BASE}audio/`);
    mixer.attach();
  }
  return mixer;
}

/**
 * The voice lines already noted as missing, for the whole DOCUMENT (R-9): one
 * `[voice]` info line per key, however many battlefields the router boots.
 * Each boot's `VoiceRuntime` is new, so a set of its own would repeat every
 * note on the second mission.
 */
const voiceNoted = new Set<string>();

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
  balance: number;
} {
  // A blocked store reads as the empty account (`ledger-store.ts`), which has
  // no unlocks and no upgrades -- the same two values the `storage ? ... :
  // null` this used to carry produced. The handle itself is no longer returned:
  // callers that need to know whether there is anywhere to WRITE ask
  // `ledgerStore.available`, and the rest just read.
  // Earned (the brigade account) joined with coin-bought (the Roar coin TEST
  // wallet, GH-317): single-player plays `earned OR coins`. One read, so every
  // surface below sees a coin-bought unit as open by construction.
  return accountView(ledgerStore);
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
/**
 * The half of a feedback note's context every screen has (GH-464, spec §4.1):
 * the renderer and its quality, the GPU, the window, the locale, the route,
 * the accessibility settings and the last errors. A battlefield adds the
 * mission's own facts on top (`fbWhere`).
 */
function shellContextInput(s: Settings): ContextInput {
  const gpu = gpuName();
  return {
    renderer: 'three',
    quality: s.video.quality,
    ...(gpu === null ? {} : { gpu }),
    viewport: [window.innerWidth, window.innerHeight],
    dpr: window.devicePixelRatio,
    locale: currentLocale(),
    ua: navigator.userAgent,
    route: stripBase(BASE, window.location.pathname),
    settings: {
      uiScale: String(s.video.uiScale),
      textSize: s.video.textSize,
      motion: s.accessibility.motion,
      colorVision: s.accessibility.colorVision,
    },
    errors: recentErrors(),
  };
}

function purgeCampaign(): void {
  // Minor 5: through the store, not the global. `window.localStorage` can throw
  // on the PROPERTY ACCESS itself in a private window or with site data blocked
  // (`safeStorage()`'s own doc comment), and this one runs on the `fresh`
  // landing -- so a player in that state met a thrown boot error instead of a
  // menu, for a store that has nothing in it to purge. Both calls REMOVE their
  // key rather than writing an empty value, exactly as before.
  // `newCampaign` (ledger-store.ts): the ledger key and the tutorial flag removed,
  // and since GH-330 the account's per-campaign improvement record cleared, so a
  // new campaign pays again. Balance, purchases and the lifetime record stay.
  newCampaign(ledgerStore);
}

/**
 * A unit type's portrait for the brigade screen: its Blender portrait
 * (`unitIcon`, GH-153), whole team -- every brigade slot is larger than a
 * chip -- or `null`, for which the caller draws the reserved hatch, as the
 * HUD's card does (`civilians` is the one shipped type with none). Until
 * WP-A3.3 a type with no portrait fell back to a frame of its sprite sheet,
 * through `SPRITE_MAP`; the sheets are retired, and every unit with a mesh
 * has a portrait (`portrait.test.ts`, "unit portrait coverage").
 */
const loadBrigadePortrait = (id: string): { url: string; isIcon: boolean } | null => {
  const icon = unitIcon(id, 'full');
  return icon === null ? null : { url: icon.url, isIcon: true };
};

async function main(): Promise<void> {
  // The first statement, so the shell's own question -- did that navigation
  // reload the page? -- has an answer. One `rl:boot` mark per document,
  // however many screens the player walks through.
  performance.mark('rl:boot');
  // GH-464: the last few errors, for a feedback note. Listening from the very
  // first statement, so a boot failure is one of them.
  installErrorRing(window);
  const stage = document.getElementById('stage');
  if (!stage) throw new Error('no #stage');

  // --- audio, on every screen ----------------------------------------------
  // Built before the route table so the menu, the campaign board and the
  // free-play picker carry the music too, not just a mission -- and now it
  // outlives all of them, since a route change no longer reloads the page.
  const audio = battleAudio();
  // UI confirm (polish pass F, A8): one listener for the whole document;
  // primary actions mark themselves (`markConfirm`) and nothing else sounds.
  installConfirmCue(document, () => audio.playCue(CRITICAL_CUES.uiConfirm));

  // --- settings, on every screen --------------------------------------------
  // Loaded and applied before anything else mounts: `applySettings` (settings.ts)
  // is the ONLY writer of the `--ui-scale`/`--text-size` inline overrides and
  // the `data-motion`/`data-cvd` attributes the whole sheet reads off
  // `document.documentElement`, so the menu itself has to carry a saved scale
  // or motion preference, not just a mission. The mixer needs its gains before
  // the first screen's music starts for the same reason.
  // A returning player's `lions.renderer=pixi` is removed once, never read
  // (`retired-keys.ts`; the Pixi backend was retired, WP-A3.3).
  forgetRetiredKeys();
  const settingsStore = safeStorage();
  let settings: Settings = loadSettings(settingsStore);
  applySettings(settings, document.documentElement);
  audio.setGains(settings.audio);
  audio.setRadioEffect(settings.audio.radio);
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
      // Read by the NEXT radio line as it starts (N17); nothing sounding is touched.
      audio.setRadioEffect(next.audio.radio);
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
    // GH-464: whether this menu offers feedback, asked per mount.
    const menuFeedback = browserFeedbackSession();
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
      // GH-464: the menu's feedback modal -- the pause form without a picture
      // or a replay. `closeOpenDialog()` takes it down with the screen.
      feedbackAvailable: menuFeedback.shown ? menuFeedback.open() : undefined,
      feedback: menuFeedback.shown && !feedbackClosed()
        ? () => {
            feedbackDialog(host, {
              who: menuFeedback.who,
              build: menuFeedback.build,
              storage: menuFeedback.storage,
              send: async (sub, signal) =>
                menuFeedback.send(
                  {
                    source: 'menu',
                    category: sub.kind,
                    text: sub.text,
                    ...(sub.contact === undefined ? {} : { contact: sub.contact }),
                    where: { context: collectContext(shellContextInput(settingsDeps.get())) },
                  },
                  { signal }
                ),
            });
          }
        : undefined,
      // The host decides its own path (live, plate or off) and builds the
      // diorama's world only on the live one. Settings are read when that
      // world is built, like a mission's at its boot: the colour-vision
      // variant and quality preset the player has right now.
      backdrop: (into, column) =>
        sceneHost(into, column, {
          plateUrl: `${BASE}${menuDiorama.plate}`,
          world: () => {
            const now = settingsDeps.get();
            return dioramaSceneOptions(
              menuDiorama,
              { colorVision: now.accessibility.colorVision, quality: now.video.quality },
              BASE
            );
          },
        }),
    });
  }

  /** The saves screen (Task 7): every slot under `lions.saves`, over the SAME
   *  door the active campaign already reads and writes through -- see
   *  `profile.ts`'s own header. No storage means no screen: a save slot with
   *  nowhere durable to live is worse than an error card naming why, and
   *  `available` is that question asked once. */
  function mountSaves(host: HTMLElement): Disposer {
    if (!ledgerStore.available) {
      bootError(host, t('boot.savesUnavailable.title'), t('boot.savesUnavailable.body'), t('boot.savesUnavailable.next'), routes.menu());
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
      // So a click on the 3D board's ground changes screen without reloading
      // the document. The flat board's town pins are real anchors and go
      // through `interceptLinks` instead.
      navigate: (h) => void router.navigate(h),
      // Aborted when this screen is left, so the 3D board can decline to
      // make a WebGL context for a player who has already gone.
      signal: req.signal,
    });
  }

  /** The roster: every KDF unit the campaign knows about, and what still gates
   *  the ones not yet earned. `possibleStars` (campaign.ts, F10) walks the same
   *  towns the campaign map itself walks, counting only missions whose own
   *  ledger contract can carry a star at all -- a town added to `world.json`
   *  counts itself in without an edit here (the tutorial is deliberately off
   *  the map, so it is never in this sum at all). */
  async function mountBrigade(host: HTMLElement, req: RouteRequest): Promise<Disposer> {
    const worldData = parseWorld(world);
    const { boughtUnits, ownedTiers, balance } = accountState();
    /** The KDF roster as the garage draws it, off one account's bought set.
     *  Called at mount and again for every answer: a purchase can open a
     *  unit (`bought`), and nothing else about the roster moves. */
    const garageUnits = (bought: ReadonlySet<string>): BrigadeUnit[] =>
      Object.values(units)
        .filter((u) => u.faction === 'kdf')
        .map((u) => ({
          id: u.id,
          name: u.name,
          role: u.role,
          unlock: kdfUnlockGate(u, bought),
          ...kdfBrigadeTraits(u),
          upgrades: 'upgrades' in u ? u.upgrades : undefined,
        }));
    const kdfUnits = garageUnits(boughtUnits);
    // Loaded once: the set of ids never changes, whatever is bought.
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
    /** The answer to every purchase and to the reset: the account as the
     *  store holds it NOW, read through `accountState()` (which reads
     *  `ledgerStore.readAccount()`), never a copy this mount kept. A refusal
     *  answers the same way -- the store is the truth either way. */
    const now = (): GarageState => {
      const a = accountState();
      return { units: garageUnits(a.boughtUnits), credits: a.balance, owned: a.ownedTiers };
    };
    // `?testcoins=<n>` (GH-317, a TEST tool): the first visit seeds the TEST
    // wallet with n coins, once; the Stores' Grant button adds n more.
    const testGrant = testCoinsParam(req.query);
    if (testGrant !== null && ledgerStore.available) {
      ledgerStore.writeRoarTest(seedTestCoins(ledgerStore.readRoarTest(), testGrant, Date.now()));
    }
    /** Which part of the single-player account came from coins. */
    const coinHalf = (): CoinHalf => {
      const account = ledgerStore.readAccount();
      const roar = ledgerStore.readRoarTest();
      return {
        earnedUnits: new Set(account.unlocks),
        coinUnits: new Set(Object.keys(roar.entitlements.units)),
        earnedTiers: account.upgrades,
        coinTiers: coinTiers(roar),
      };
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
      // bay draws its reserved hatch -- never a broken <img>. From kit level 2
      // a kitted vehicle's plate is its kitted photograph (GH-238); the plate
      // is what the bay keeps when the model cannot be drawn.
      plate: (typeId, kitLevel) => unitPlate(`${BASE}ui/plates/units/`, typeId, kitLevel),
      // A track's close-up from the bay's own turntable (GH-238 K11), in the
      // board's track head; a missing one keeps the hatch.
      closeup: (typeId, track) => trackCloseup(`${BASE}ui/garage/closeups/`, typeId, track),
      // GH-316: the unit's own GLB, turnable, over the plate above -- which
      // stays the picture until the model's first frame, and whenever the
      // model cannot be drawn.
      model: {
        source: (typeId) => garageModelSource(typeId),
        dracoDecoderPath: dracoDecoderPath(),
        groundTextureUrl: garageGroundTexture(BASE),
        colors: garageColors(),
      },
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
      credits: ledgerStore.available ? balance : undefined,
      // A purchase that landed is heard (WP-S3g T11, spec §3.5). The mixer is
      // the document's one, built at boot, so its `pointerdown` listener has
      // made the AudioContext before this click's handler runs -- the Buy is
      // its own first gesture. Mute and the volume sliders are honoured
      // inside `playUi`; a set with no decoded clip plays its synth arm.
      onCue: (cue) => battleAudio().playUi(CUE_SET[cue]),
      // The Stores tab (GH-317). For everyone it is a preview: a zero coin
      // balance and every Buy disabled. With `?testcoins=<n>` (a TEST tool,
      // the lead's go-ahead on 2 Oct; remove or gate it before release) a
      // local TEST wallet buys what credits buy. Packs stay disabled.
      stores: {
        coinSrc: (size) => `${BASE}ui/roar_coin/roar_coin_${size}.png`,
        paid: ledgerStore.readAccount().paid,
        open: testGrant !== null,
        read: () => {
          const r = ledgerStore.readRoarTest();
          return {
            coin: coinHalf(),
            test: testGrant !== null ? { coins: r.coins, grant: testGrant, receipts: r.receipts } : undefined,
          };
        },
        onBuy:
          testGrant !== null && ledgerStore.available
            ? (ask) => {
                const a = accountState();
                const { account, ok } = buyWithTestCoins(
                  {
                    units: garageUnits(a.boughtUnits),
                    ledger: ledgerStore.readLedger(),
                    credits: a.balance,
                    owned: a.ownedTiers,
                    coin: coinHalf(),
                  },
                  ledgerStore.readRoarTest(),
                  ask,
                  Date.now()
                );
                if (ok) ledgerStore.writeRoarTest(account);
                return now();
              }
            : undefined,
        onGrant:
          testGrant !== null && ledgerStore.available
            ? () => ledgerStore.writeRoarTest(grantTestCoins(ledgerStore.readRoarTest(), testGrant, Date.now()))
            : undefined,
      },
      onReset: ledgerStore.available
        ? () => {
            telemetry().account('reset', ledgerStore.resetAccount());
            return now();
          }
        : undefined,
      onBuy: ledgerStore.available
        ? (unitId, price) => {
            const { account, ok } = buyUnlock(ledgerStore.readAccount(), unitId, price);
            // A refusal here is only reachable with a stale account (e.g. two
            // tabs on the same origin both showing this row as affordable) --
            // the control disabled itself against the balance THIS render
            // read, so `!ok` means the account on disk has since moved.
            // Answering `now()` re-renders off the true, current state instead
            // of leaving the row showing a purchase that did not happen.
            // `landed` is THIS ask's own outcome (final review M1): the
            // current state can own the tier a refused ask asked for (another
            // tab bought it), so the screen must not read it off the account.
            if (!ok) return { ...now(), landed: false };
            ledgerStore.writeAccount(account);
            telemetry().account('purchase', account, { item: unitId, price });
            return { ...now(), landed: true };
          }
        : undefined,
      owned: ownedTiers,
      onBuyUpgrade: ledgerStore.available
        ? (unitId, track, tier, price) => {
            const { account, ok } = buyUpgrade(ledgerStore.readAccount(), unitId, track, tier, price);
            // Same reasoning as `onBuy` above: the control disabled itself
            // against a stale read, so answer with the true state instead of
            // returning silently. `landed` as above (M1).
            if (!ok) return { ...now(), landed: false };
            ledgerStore.writeAccount(account);
            telemetry().account('purchase', account, { item: `${unitId}.${track}.${tier}`, price });
            return { ...now(), landed: true };
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
      { name: 'brigade', pattern: '/brigade', mount: (host, req) => mountBrigade(host, req) },
      // The picker. Nothing is passed in: the screen reads the map enumeration
      // and SANDBOX_FLAGS itself, so a new map cannot be missing from it.
      { name: 'free-play', pattern: '/free-play', mount: (host) => showSandbox(host) },
      {
        name: 'sandbox',
        pattern: '/free-play/:map',
        mount: (host, req) =>
          guardBoot(host, req.signal, (err) => bootFailure(host, err), bootBattlefield(host, {
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
          })),
      },
      {
        name: 'mission',
        pattern: '/mission/:id',
        mount: (host, req) =>
          guardBoot(host, req.signal, (err) => bootFailure(host, err), bootBattlefield(host, {
            missionId: req.params.id,
            sandboxMap: null,
            query: req.query,
            signal: req.signal,
            navigate: (href, opts) => void router.navigate(href, opts),
            settings: settingsDeps,
            restart: () => void router.navigate(router.href(req.path, req.query), { replace: true, force: true }),
          })),
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
      bootError(host, t('boot.notFound.title'), t('boot.notFound.body', { path: req.path }), t('boot.notFound.next'), routes.menu());
      return () => host.replaceChildren();
    },
  });
  // Same-origin anchors become navigations, for the whole life of the
  // document -- there is no point at which this page stops wanting them, so
  // its disposer is dropped rather than stored.
  interceptLinks(document, router);
  // The small-screen notice (K-17): app-wide like the line above, so its
  // disposer is dropped for the same reason -- but it has one, and a test
  // proves it removes everything the notice adds.
  watchSmallScreen({ navigate: (href) => void router.navigate(href), menuHref: routes.menu() });
  // `fresh` has done its work above and is not a route parameter, so it comes
  // off the URL -- except on the way into a mission, where it still means "run
  // this one against an empty ledger" and `bootBattlefield` reads it back off
  // `req.query`, exactly as the pre-router code read it off the query string.
  // `landingPath` (computed above, pre-router) is what a legacy `?sandbox=`/
  // `?mission=` query rewrites to -- `location.pathname` here would still be
  // the raw pre-rewrite path and misclassify those links as `menu`.
  const telemetryScreen = screenFor(landingPath, '/', 'beit_sahwan_0_tutorial');
  // `renderer` is always 'three' since WP-A3.3: the field stays so old D1
  // rows and `packages/worker/QUERIES.sql` group the same way.
  initTelemetry({ dev: telemetryScreen === 'sandbox' }).sessionStart(telemetryScreen, 'three');
  // GH-464 (spec §12.2): ask the server's switch once a boot, so the lead can
  // close feedback without an app deploy. Cached for the session; every entry
  // point checks `isClosed()` when it is built, and the menu takes its button
  // down if the answer lands after it mounted. Never asked where nothing can
  // be sent (dev, tests, CI, a local host).
  const bootFeedback = browserFeedbackSession();
  if (bootFeedback.shown) void bootFeedback.open();
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
  /** The bought kit, read ONCE from the account through `accountState()`
   *  (WP-S3g §3.4): tiers are type-wide and fixed for the mission (brigade
   *  D3). `upgradePrepass` is one loop that yields both the unit types
   *  registered with the sim below and the HUD card's kit per type, from the
   *  same per-type read, so the card shows the kit this mission actually
   *  runs with -- never the account as it stands later, which a garage visit
   *  can change. */
  const roster = Object.values(units);
  /** `&kit` (sandbox only, WP-S3g plan 2) swaps the account's tiers for the
   *  fixed ladder BEFORE the one prepass, so the swap reaches the sim, the HUD
   *  card and the unit icons together; a mission never takes it (`bootTiers`). */
  const bootKit = bootTiers(ownedTiers, { mission: req.missionId !== null, kitFlag: readFlags(params).kit }, roster);
  const prepass = upgradePrepass(roster, bootKit);
  const kitByType = prepass.kitByType;
  /** The one level every unit ICON reads (WP-S3g plan 2b): the prepass's own
   *  `unitKit`, never re-derived -- the loop that registered the sim's types
   *  and filled the card's pips. 0 for any type the prepass did not see. */
  const kitLevelOf = (typeId: string): KitLevel => prepass.unitKit[typeId] ?? 0;
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
      bootError(stage, t('boot.unknownMission.title'), t('boot.unknownMission.body'), t('boot.unknownMission.next'));
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
  // The ground-mark showcase (Task 15, `three/decal-showcase.ts`): a fixed,
  // dated set of craters, scorch, oil, rubble, tread and tyre stamped near
  // the friendly anchor. Sandbox-only and three-only, like every flag beside
  // it -- a real mission's ground must remember only its own battle.
  const wantDecals = flags.decals;
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
  const sim = new Sim({ seed: SIM_SEED, width: map.width, height: map.height, capacity: 256 });
  // Cover AND blocked terrain, through the one function all three world
  // builders share. Rock ridges arrive here; before this existed, `map.blocked`
  // was filled by parseMap and read by nobody.
  applyTerrain(map, sim);
  // Buildings are entities, not terrain: each contiguous run of identical
  // symbols becomes one structure with HP, a garrison and rubble.
  standMapStructures(sim, map);

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
  // The pre-pass's own output (`upgradePrepass`, above): enemy units pass
  // through untouched -- only a KDF unit can carry a bought tier -- and
  // `unitInfo` (cost/gate lookup) below still reads the raw JSON, never this
  // patched copy, because cost is not patchable.
  for (const registered of prepass.registered) {
    typeOf.set(registered.id, sim.addUnitType(registered));
  }

  // Which ROE reasons have already been narrated, so the advice attached to a
  // protected-zone violation is offered once rather than on every cooldown
  // expiry. One mission, one set — it lives as long as the runtime does.
  const narratedRoeReasons = new Set<string>();
  /** Every Conduct deduction this mission, for the debrief. The sim keeps no
   *  presentation log; the events are the record. */
  const deductions: Deduction[] = [];
  /** The memorial half of this mission's service records (WP-G-E4), captured
   *  one `unitLost` event at a time and appended to `roster.lost` on victory
   *  only -- a defeat writes nothing to the ledger at all (M4, no ironman),
   *  so a lost unit on a losing run is not memorialised: the run did not
   *  happen as far as the campaign is concerned. */
  const lostThisMission: LostRecord[] = [];
  /** GH-417 (L-6): what happened, where and when, for the after-action
   *  report -- losses with the tile they fell on, deductions pinned to the
   *  zone they name, objective outcomes, the hostile kill count. Read off
   *  events and sim state; never written back. */
  const missionLog: MissionLog = newMissionLog();
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
  /**
   * GH-279: the flight rule, SHOWN. The refuge the families walk to (a
   * mission's own `civilians.refuge` marker, or the sandbox's synthesised
   * one), every `evacuate_before` and the tally it is scored on, and the
   * watcher that turns a family breaking into one feed line. All of it read
   * off the mission JSON, the map, `sim.state` and the `evacuated` events --
   * nothing reaches into the runtime's private flight state (`evacuation.ts`,
   * `ui/civ-flight.ts`).
   */
  const refugeAt = mission
    ? refugePoint(mission, map.markers)
    : civRefuge
      ? { x: civRefuge.at[0] + 0.5, y: civRefuge.at[1] + 0.5 }
      : null;
  const evacTargets = evacuationTargets(mission);
  /** One per `evacuated` MissionEvent -- the runtime's own tally, counted
   *  from the outside. */
  let evacuatedSoFar = 0;
  // PR 361: deadlines already warned a minute out, and why a lost mission
  // was lost (`ui/mission-failure.ts`).
  let deadlinesWarned: ReadonlySet<string> = new Set();
  let missionFailure: string | null = null;
  /** No refuge, no flight: `CivilianFlight.step` is never run without one. */
  const civWatch = refugeAt ? new CivFlightWatch() : null;
  /** `sim.entityCount` at the watch's last observation. */
  let civWatchSeen = -1;
  /**
   * Null until the player deploys (shell Phase 3, Task 4; plan R-5). The
   * runtime copies its roster pool at construction (`mission.ts:550`) and
   * `start()` spawns the starting force at once, so it cannot be built before
   * the deploy screen has been answered -- it is built right after
   * `loading.done()` below, from the ledger the player's choice permuted.
   * Nothing between here and there reads the RUNTIME, and the loading bar's
   * workload is derived from the mission JSON (`missionUnitTypes`), not from
   * anything the runtime spawns. The renderers are another matter:
   * `renderer.init()` below seeds its interpolation, its fog and its
   * structure instancers from the sim, and on a mission it now does that on a
   * sim with no units and none of the mission's own structures in it.
   * `startMission` (`mission-start.ts`) calls `renderer.reseed()` after the
   * spawn, and the backend owns what that re-derives (`api.ts`). The sandbox
   * spawns in the `else` branch below, BEFORE `init()`, so its seeding is
   * what it always was.
   */
  let runtime: MissionRuntime | null = null;
  let missionTelemetry: MissionTelemetry | null = null;
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
  } else {
    sandboxForce = sandboxSpawns(sim, typeOf, anchors, {
      tunnel: wantTunnel,
      sur: wantSur,
      civ: wantCiv,
    });
  }

  // --- renderer + overlay --------------------------------------------------
  // The options object itself is `./renderer-options`'s `rendererOptionsFor`
  // (Task 2 of the scene-host plan) -- extracted so the menu's own diorama can
  // ask for exactly the same options a mission gets, rather than a second,
  // drifting copy of this literal. What stays here is construction-time:
  // `quality` is read ONCE (like the renderer backend choice below), because
  // it takes effect from the next boot, which its settings hint says.
  // `colorVision` is read here for the boot and then followed live
  // (`bindLiveTeamColors`, below the minimap -- VR-01). `teamColors` and
  // `resolveColor` -- what the renderer, either backend, asks for a palette
  // key by STRING -- have to agree on the same `colorVision` value, or the
  // silhouette outline, the HP bars, the objective-zone tints and the
  // min-range ring would keep drawing the default palette regardless of the
  // setting; `rendererOptionsFor` is what now holds that agreement.
  const cvdVariant = req.settings.get().accessibility.colorVision;
  // R-12/N-23: a mission's own `map.time_of_day` always wins; the sandbox
  // reads `&tod=` instead. `mission` is cast the same way `missionTown` is
  // above -- `MissionJson` (`@lions/sim`) does not model `map.time_of_day`,
  // since the sim never reads it.
  const tod = timeOfDayOf((mission as { map: object } | undefined) ?? null, params);
  if (tod.warning) console.warn(`[lions] ${tod.warning}`);
  const lightOverride = lightOverrideOf((mission as { map: object } | undefined) ?? null);
  // `&fitbuildings=<rule>` (lead ruling 7 Oct): compare building fits, on a
  // mission as well as the sandbox. Absent leaves the renderer's default.
  const fit = buildingFitOf(params);
  if (fit.warning) console.warn(`[lions] ${fit.warning}`);
  const opts: RendererOptions = {
    ...rendererOptionsFor(
      map,
      { colorVision: cvdVariant, quality: req.settings.get().video.quality },
      BASE
    ),
    timeOfDay: tod.value,
    // PA-24: a mission's own `map.light` (First Light's lifted dawn fill).
    ...(lightOverride !== undefined ? { lightOverride } : {}),
    ...(fit.value !== undefined ? { buildingFit: fit.value } : {}),
    // Pass C2/C4 (P5): asked live, so the settings panel's motion switch
    // reaches the near-miss flinch mid-mission.
    reducedMotion: prefersReducedMotion,
    // GH-238: the bought kit each vehicle wears, from the one prepass that
    // registered the sim's types and drew the card -- so the hull on the
    // field is the hull the sim is running.
    unitKitTiers: prepass.unitKitTiers,
    // Sandbox only: a mission brings its own battle, and a dev flag must
    // never change how one looks.
    ...(!mission && wantDecals
      ? { decalShowcase: { x: anchors.friendly[0], y: anchors.friendly[1] } }
      : {}),
  };
  // --- which meshes this mission needs -------------------------------------
  //
  // The whole mesh library used to load at boot, before the loading screen was
  // even on screen: 65 GLB fetches and 40.04 MiB, the same for every mission
  // and every sandbox, measured against a production build served from disk.
  // This is the roster that replaces it. `./mesh-catalogue` owns the tables and
  // the arithmetic; what is decided HERE is only which roster to ask about.
  //
  // GH-469: walked over the RESOLVED mission -- `upgrades_to` already
  // decided above -- so the variant a placement did not take (a Shachaf the
  // brigade has not bought, a `gate_only` jeep the gate dropped) is not loaded
  // and decoded for a unit that cannot appear. On a `resources` mission it is
  // still buildable, and so lands in `meshDeferred` below like any other.
  const meshRoster = mission
    ? missionUnitTypes(resolvedMission ?? mission, new Set(Object.keys(units)))
    : sandboxUnitTypes({ tunnel: wantTunnel, sur: wantSur, civ: wantCiv });
  // Only the roster's languages decode (N16). The roster is the one the mesh
  // plan already trusts; a unit it misses still plays -- as `missing` -- and
  // the dev note names the key. Set here, before the deploy gate's click, so
  // a first gesture on this page decodes ui -> voice -> battle in that order.
  const voiceLangs = (audioManifest as AudioManifest).voices?.languages ?? {};
  const unitJson = units as Record<string, { id: string; faction: string; role: string; voice?: unknown } | undefined>;
  audio.setVoiceLanguages(rosterLanguages(meshRoster, (id) => unitJson[id]?.faction, voiceLangs));
  audio.setVoicePlaceholder(voicePlaceholderOn(params, import.meta.env.DEV));
  // Registered where it is set, not with the runtime below: a boot abandoned
  // before the runtime exists must not leave the next screen ticking.
  onDispose(() => audio.setVoicePlaceholder(false));
  // `./mesh-catalogue`'s `meshPlanFor` (Task 2 of the scene-host plan): which
  // meshes this roster and this map's own buildings actually need, so the
  // menu's own diorama can ask the same question about its own roster.
  const meshPlan = meshPlanFor(map, meshRoster, (mission?.structures ?? []).map((s) => s.type));
  // Resolved once, beside `meshPlan` and BEFORE `new ThreeRenderer` below --
  // nothing between here and the renderer's construction may throw, because
  // its teardown is not registered until the context exists.
  const meshManifest = meshManifestFor(meshPlan);
  /**
   * Types whose mesh is fetched AFTER the mission is running rather than
   * before it starts.
   *
   * A mission with `resources` lets the player build any KDF unit the ledger
   * has unlocked, so its true roster is "what it fields" plus "the whole KDF
   * catalogue" -- which on `beit_sahwan_3_clearance` is most of the library
   * again and would give the change back. They are deferred instead: a build
   * takes seconds of game time to deploy, and the GLB is fetched from the
   * moment the art gate clears. A unit deployed before its GLB lands draws
   * NOTHING until it does -- no sprite placeholder since WP-A3.3 (the lead's
   * ruling 1) -- and its dock tile shows a "deploying" chip meanwhile
   * (`meshReady`). Measuring the alternative (loading every buildable before
   * deploy) is in the PR for the lead.
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
  /** Unit type ids whose mesh failed (boot or deferred), for the HUD note. */
  const failedMesh: string[] = [];
  /** Unit types whose mesh has LANDED (template built). A deferred buildable
   *  is "pending" until it appears here -- the dock's deploying chip reads
   *  it (WP-A3.3, ruling 1). Failed types never appear: they draw a proxy box
   *  (`units/proxy-box.ts`) and are reported through `failedMesh`. */
  const meshReady = new Set<string>([...meshPlan.rigged, ...meshPlan.vehicles]);

  // The map's decor layer goes to the renderer as `TERRAIN_DECOR` indices, and
  // the two enums are declared separately because @lions/render must not import
  // @lions/data. This is the one module that imports both, so it is where they
  // are held to agree; a silent divergence would draw roads as trees. Checked
  // HERE, before a renderer exists: it reads only imports, and a throw after
  // construction would have left a WebGL context with no `teardown()` to free it.
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

  // One backend since WP-A3.3 (the Pixi backend and `?renderer=pixi` are
  // deleted; `?renderer=` is accepted and ignored, `sandbox-help.ts`). It
  // still arrives by dynamic import from its own entry point, so three.js
  // never lands in the main chunk: a static `import { ThreeRenderer } from
  // '@lions/render'` once put its whole runtime -- 1,081 kB -- there.
  const { ThreeRenderer } = await import('@lions/render/three');
  // `three` is the CONCRETE type and is used only for the mesh loading below.
  // `renderer` stays the `Renderer` interface, so `app` still cannot reach a
  // backend-only member anywhere else in this file -- the compiler keeps that,
  // not a grep.
  const three = new ThreeRenderer(sim, opts);
  const renderer: Renderer = three;
  // Its teardown is registered HERE, the moment the WebGL context exists,
  // not after `init()`: the mesh downloads below are awaited first, and a
  // boot that failed on one used to throw with the context held and no
  // disposer to give it back. Safe this early because `dispose()` works
  // before `init()` and is idempotent, and it runs ONCE -- there is no
  // second registration below. `teardown()` drains in reverse, so this
  // runs after everything built on top of the renderer, the frame loop's
  // `cancelAnimationFrame` (registered last of all) included.
  //
  // The CANVAS is taken off in the same breath, and that half is not
  // redundant. `init()` puts it in the stage, and the router only clears
  // the stage for a screen that actually MOUNTED -- `Router.unmount()`
  // returns early at `if (!m) return` when the mount is still in flight. So
  // a battlefield abandoned on its deploy screen left its canvas behind in
  // the stage, under the campaign board, and the route walk photographed
  // exactly that: two canvases where the board needs one. Measured, not
  // assumed; a teardown that relies on the router to clean up after it is
  // the rule this file states at the top, broken.
  onDispose(() => {
    three.dispose();
    three.canvas.remove();
  });
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
  // A UNIT mesh that fails does not fail the boot (WP-A3.3, ruling 2): the
  // renderer logs a console.error naming the GLB and draws that type as a
  // team-coloured proxy box at its footprint (`units/proxy-box.ts`), and
  // `failedMesh` puts it in front of the player as a HUD note. Before the
  // billboard path was retired, the same failure quietly drew the sprite.
  // Every OTHER asset here still propagates, as it always did -- after the
  // teardown, like the other awaits below that can throw: a registered
  // disposer is no use to a boot that throws past it.
  // The renderer has already named the GLB in its own console.error.
  const unitMeshFailed = (id: string) => (): void => {
    meshReady.delete(id);
    failedMesh.push(id);
  };
  // K-15: the blank wait. The briefing below cannot be built until the ground
  // and the force are known, but the player can be told something is
  // happening: the loading screen's own bar and count, one step per model.
  const download = showDownloadProgress(stage, mission?.name ?? mission?.id ?? 'M0 sandbox');
  onDispose(() => download.dispose());
  const counted = <T>(job: Promise<T>): Promise<T> => job.finally(() => download.step());
  const jobs: Promise<unknown>[] = [
    ...meshManifest.rigged.map((m) => three.loadMeshUnit(m.id, m.urls, m.faction).catch(unitMeshFailed(m.id))),
    ...meshManifest.vehicles.map((m) => three.loadVehicleMesh(m.id, m.url).catch(unitMeshFailed(m.id))),
    // Building meshes: the STANDING state only, for the structure types
    // this map actually stands. `colour_key`/`wallColorKey` is resolved
    // inside `loadBuildingMesh` itself off `Sim.structureTypes[...].color`
    // -- nothing here needs to know it.
    //
    // `null` for the wreck, deliberately: it is fetched after the first
    // frame instead (below, `afterFirstFrame`). Level load time,
    // step 3 -- on `beit_sahwan_outskirts` the five wreck GLBs are 9.62
    // MiB of a 47.0 MiB level and `hall_wreck` alone is 3.77, while the
    // earliest a building can fall is minutes of play away.
    ...meshManifest.buildings.map((m) => three.loadBuildingMesh(m.id, m.url, null)),
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
    three.loadDecorMeshes(meshManifest.decor),
    // Props (ground plan 2): one call for the kit, keyed by kind. Empty on
    // a map with no road and no building tile (`propKindsFor`), which
    // loads nothing and places nothing.
    three.loadPropMeshes(meshManifest.props),
  ];
  download.total(jobs.length);
  await Promise.all(jobs.map(counted))
    .catch((err: unknown) => {
      teardown();
      throw err;
    })
    // Whether it landed or failed: the failure card (K-01) or the briefing
    // takes the stage next, and neither should find this screen under it.
    .finally(() => download.dispose());

  // The late arrivals. `loadMeshUnit`/`loadVehicleMesh` are safe to call
  // after the first frame -- both replace a template and tear down every
  // live clone of it first. Until one lands, a unit of that type draws
  // NOTHING (WP-A3.3, ruling 1: no sprite placeholder any more); the dock
  // tile carries a "deploying" chip meanwhile (`meshReady`, below). If it
  // FAILS, the renderer draws a proxy box and `failedMesh` reports it.
  // `civilians` is never deferred: `missionUnitTypes` puts it in the
  // blocking set above whenever a mission fields any.
  const ensureUnitMesh = (typeId: string, cold = false): void => {
    // A mesh started before the player left would otherwise be handed to a
    // disposed renderer whenever it lands. Guarded at the start AND in the
    // handler: `loadMeshUnit` is a fetch plus a GLTF parse, so the window
    // between the two is seconds wide on a cold cache.
    if (disposed || !hasUnitMesh(typeId) || meshLoaded.has(typeId)) return;
    meshLoaded.add(typeId);
    const rigged = RIGGED_UNIT_MESHES[typeId];
    // `cold` (GH-469): a deferred buildable's textures stay encoded until the
    // player orders one (`warmUnitMesh`, per tick below) -- most are never
    // ordered, and each costs 16-48 MiB decoded.
    const job = rigged
      ? three.loadMeshUnit(typeId, rigged.files.map(meshUrl), rigged.faction, { cold })
      : three.loadVehicleMesh(typeId, meshUrl(VEHICLE_UNIT_MESHES[typeId]), { cold });
    job.then(
      () => {
        if (!disposed) meshReady.add(typeId);
      },
      () => {
        // The renderer has already named the GLB in a console.error.
        if (disposed) return;
        failedMesh.push(typeId);
      }
    );
  };
  // The wreck half of every building this map stands, started after the
  // first frame. Failing is survivable in the strongest sense available
  // here: the type simply keeps the procedural wreck `updateStructures`
  // is already drawing for it, so the warning is the whole cost.
  const wreckMeshLoader = (structureId: string): void => {
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
  // Left during the mesh download (or the backend's import). Everything
  // below until the next abandon check -- the loading screen, `init()` --
  // would otherwise run for a screen the player has gone from: measured,
  // `init()` appended the battlefield's canvas into the NEXT screen's stage
  // and fetched five ground textures before that check tore it down.
  if (req.signal.aborted) abandon('left while the meshes were downloading');

  // The map's decor layer -- road, olive grove, rocky knoll -- goes straight to
  // the renderer. It deliberately does NOT travel through the sim: whether a tile
  // draws a tree or a rock changes no outcome, and invariant 4 keeps presentation
  // data out of simulation state. The mechanical half of the same tile, its cover
  // level, went through sim.setCover above. The two enums it is indexed by are
  // held to agree before the renderer is constructed -- see there.
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
      clock: objectiveClock(o) ?? undefined,
    })
  );
  // The same gate `main.ts` puts on `payMission` below (`mission.ledger.
  // produces.length > 0`) -- the tutorial produces no ledger keys and never
  // reaches that call, so its briefing must not promise a secondary pays
  // credits when nothing will pay them.
  const paysCredits = mission !== undefined && mission.ledger.produces.length > 0;
  const unitName = (id: string): string => units[id as keyof typeof units]?.name ?? id;
  // Deploy as a decision (spec Decision 4; plan R-3). The view reads
  // `resolvedMission` for the same reason `broughtFor` does: `upgrades_to` and
  // `gate_only` change which placements draw from the ledger (pre-flight P3).
  // Null for a sandbox and for any mission whose contract reads no roster.
  const deployView = resolvedMission ? deployRosterView(resolvedMission, ledger, unitName) : null;
  // The player's pick, as the spread last reported it. Null means the screen
  // was never touched -- or never drawn, which is the case for a sandbox, the
  // tutorial and a campaign that has no roster yet -- and `deployedLedger`
  // then hands the runtime the original ledger object itself.
  let deploySelection: DeploySelection | null = null;
  // Up before the canvas exists, so the player never sees the terrain draw
  // itself in or the units stand around as procedural boxes waiting for their
  // sheets. It comes down once the art gate below has settled.
  // The Field order briefing (GH-417, direction A): the glance card, the
  // marked ground and the attached units, every one DERIVED from what the
  // mission already declares (ruling L-3). A sandbox has no mission and keeps
  // the plain screen.
  const briefPlaces = placeNamesFor(map, structureCatalogue as Readonly<Record<string, { name: string } | undefined>>);
  const field: FieldOrder | undefined = resolvedMission
    ? (() => {
        const m = resolvedMission;
        const mapMeta = m.map as { time_of_day?: string; player_start?: number[] };
        const sections = briefingLayout(mission)?.sections ?? null;
        const glanceObjectives = m.objectives.map((o) => ({ type: o.type, primary: o.primary, carries: o.carries, text: o.text, seconds: o.seconds, target: o.target }));
        return {
          glance: briefingGlance({
            mapName: (mapJson as { name?: string }).name,
            timeOfDay: mapMeta.time_of_day,
            targetMinutes: (m as { target_minutes?: number }).target_minutes,
            beats: m.briefing ? briefingBeats(m.briefing) : [],
            sections,
            objectives: glanceObjectives,
            roe: m.roe,
            zoneName: briefPlaces.zone,
          }),
          marks: groundMarks({
            playerStart: mapMeta.player_start,
            zones: (mapJson as { zones?: Record<string, number[]> }).zones ?? {},
            // In the order the briefing's objective list draws them: primaries first, stable.
            objectives: [...glanceObjectives].sort((a, b) => Number(b.primary) - Number(a.primary)),
            flaggedZones: m.roe?.flagged_zones,
            zoneName: briefPlaces.zone,
          }),
          attached: (m.starting_force ?? [])
            .filter((p) => p.from_ledger !== true)
            .map((p) => ({ type: p.unit, name: unitName(p.unit), count: p.count })),
          unitName,
        };
      })()
    : undefined;
  const loading = showLoading(
    stage,
    mission?.name ?? mission?.id ?? 'M0 sandbox',
    mission?.briefing,
    { rank: hudCommander.shai.rank, plate: hudCommander.shai.plate, portrait: hudCommander.shai.portrait },
    mission?.briefing_video !== undefined ? `${BASE}${mission.briefing_video}` : undefined,
    resolvedMission ? (broughtFor(resolvedMission, ledger, unitName) ?? undefined) : undefined,
    // A sandbox has no briefing to go back to -- only a real mission gets an
    // Escape/back edge (task 6). A router navigation now, not a page load:
    // this is the earliest soft exit from a battlefield, and it fires while
    // this very function is still parked on `loading.done()` below.
    mission ? () => req.navigate(routes.campaign()) : undefined,
    objectiveRows,
    paysCredits,
    deployView
      ? {
          view: deployView,
          onChange: (sel) => {
            deploySelection = sel;
          },
        }
      : undefined,
    // The ground the orders are about (pre-flight P6): the parsed map and the
    // same resolved tones the minimap paints with. The screen draws it only
    // when there are orders to read, and goes without it where the canvas has
    // no 2D context.
    { map, tones: opts.terrainTones },
    // Named sections and the image slot (GH-119). `briefingSections` returns
    // null -- the plain beats -- unless the sections still spell the briefing,
    // which a locale overlay translating `briefing` alone breaks on purpose.
    briefingLayout(mission),
    field
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
  // Torn down on a throw like the mesh downloads above: on three the
  // renderer's disposer is already registered, and it only runs if something
  // runs `teardown()`.
  try {
    await renderer.init(stage);
  } catch (err) {
    teardown();
    throw err;
  }
  // `ThreeRenderer` holds a WebGL context, a 4096 shadow map, every geometry
  // and material for the map, and a ResizeObserver on the canvas; its
  // teardown was registered where it was constructed, above, and loses the
  // context.
  if (req.signal.aborted) abandon('left while the renderer was starting');
  renderer.useEmitters(vfxEmitters as EmitterSpec[], paletteColor);

  // No sprite sheets load any more (WP-A3.3): every unit and structure draws
  // a mesh, loaded above. The loading bar has nothing to count and reads
  // "ready" (`ui/loading.ts`).
  loading.total(0);

  // The briefing's ground, photographed (ruling L-2): the minimap's own call,
  // rows flipped as the minimap flips them. Every GLB the map stands was
  // awaited above, so the town is in the picture. Optional on `Renderer` and
  // null on anything it cannot do: the painted tiles simply stay.
  if (field) {
    try {
      const shot = renderer.captureGroundAlbedo?.(BRIEFING_GROUND_PX) ?? null;
      if (shot) loading.setGroundPhoto(new ImageData(flipRows(shot.data, shot.width, shot.height), shot.width, shot.height));
    } catch (err) {
      console.warn('briefing: the ground photograph failed; the painted ground stays', err);
    }
  }

  /**
   * The picture each unit type shows in the HUD's selection cluster, card and
   * dock (GH-153): its Blender portrait (`unitIcon`), resolved from the
   * bundle with no fetch. A type with none has no picture and the HUD draws
   * its role mark on the reserved hatch -- `civilians` is the one shipped
   * type in that position, and a click-select can reach it. (A sprite-sheet
   * frame was the fallback until the sheets were retired, WP-A3.3.)
   */
  const portraits: Record<string, string> = {};
  /** Which ids in `portraits` above came from `unitIcon` (a Blender portrait
   *  or a cropped icon) rather than a whole sheet frame -- read by the HUD and
   *  the dock to set `data-icon`. */
  const portraitIcons = new Set<string>();
  /** The HUD selection chip's picture where it differs from `portraits`: a
   *  figure team's ONE lead figure (GH-153; the lead's call, 2 Oct -- at
   *  <= 48 px a team shows one man). Every larger slot reads `portraits`. */
  const chipPortraits: Record<string, string> = {};

  for (const id of portraitIds()) {
    const full = unitIcon(id, 'full');
    if (full === null) continue;
    portraits[id] = full.url;
    portraitIcons.add(id);
    const chip = unitIcon(id, 'chip');
    if (chip !== null && chip.url !== full.url) chipPortraits[id] = chip.url;
  }

  // The buildables, now that the blocking meshes are in. Deliberately NOT
  // awaited: these are meshes for units the player MIGHT build, and the whole
  // point of deferring them is that the mission starts without them.
  //
  // This line sits BETWEEN the two waits on purpose. Started any earlier it
  // would compete with the blocking meshes and delay the mission for
  // everyone, including a player who never builds anything.
  // Started any later it would begin only when `loading.done()` returns, which
  // for a mission with a briefing is the moment the player clicks Begin --
  // throwing away the one stretch of wall-clock time in the whole boot where
  // the human is reading and the network is idle.
  for (const id of meshDeferred) ensureUnitMesh(id, true);

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

  // The mission starts HERE, after the player has answered the deploy screen
  // (plan R-5). It used to be built four hundred lines up, before that screen
  // existed, which is why no choice made on it could reach the map. After the
  // abandon check rather than before it: a boot the player has already left
  // must not spawn a force into a sim that is being torn down, and `abandon`
  // reads nothing the runtime owns.
  //
  // `deployedLedger` is the one place the choice meets the sim. It hands the
  // runtime a shallow copy of `ledger` whose roster pool is PERMUTED so the
  // spawner's first-of-type draw takes the chosen bodies -- never filtered
  // (R-3), so a benched veteran stays in the runtime's pool and comes back
  // out of `checkEnd` unchanged. `ledger` itself is untouched: the debrief and
  // the victory write read it as the roster this mission was sent in with,
  // and a player who quits after deploying leaves the save exactly as it was.
  //
  // `startMission` (`mission-start.ts`) also RE-SEEDS the renderer
  // (`renderer.reseed()`), and that is not optional: `renderer.init()` above
  // ran on a sim with no units in it yet, and without it the whole force drew
  // at world (0, 0) until tick 1, every vehicle threw a dust burst as it
  // lerped out, and the map stayed under full shroud until tick 3. The sandbox branch
  // spawns before `init()` and needs none of this.
  //
  // Wrapped like the await above it: this used to throw before the renderer
  // existed, and now runs after it, so a malformed mission must not strand one.
  // GH-464: the player's orders since mission start, for a Bug note's replay
  // (spec §4.3). In memory only, and only for a mission: a sandbox has no
  // start a replay could rebuild.
  const replayLog = new ReplayRecorder();
  if (resolvedMission) {
    try {
      // One ledger for the runtime and the loadout (GH-254), so the roster
      // draw telemetry reports can never read a different pool than the one
      // the spawner drew from.
      const sentLedger = deployedLedger(ledger, deploySelection);
      runtime = startMission(sim, resolvedMission, {
        typeIdOf: (id) => {
          const t = typeOf.get(id);
          if (t === undefined) throw new Error(`mission references unknown unit ${id}`);
          return t;
        },
        markers: map.markers,
        zones: map.zones,
        tunnels: tunnelRoutes,
        ledger: sentLedger,
        unitInfo: (id) => {
          const u = (units as Record<string, (typeof units)[keyof typeof units] | undefined>)[id];
          if (!u || u.faction !== 'kdf') return null;
          return {
            logistics: u.cost.logistics,
            buildTimeS: 'build_time_s' in u.cost ? u.cost.build_time_s : 20,
            unlock: kdfUnlockGate(u, boughtUnits),
          };
        },
      }, renderer);
      // Everything `startMission` consumed, so a replay can rebuild it. The
      // cast: TypeScript narrows `deploySelection` to its initial null, since
      // it is assigned only inside the deploy screen's callback.
      const picks = deploySelection as DeploySelection | null;
      replayLog.begin({
        mission: resolvedMission.id,
        build: __APP_BUILD__,
        ...(__APP_COMMIT__ === '' ? {} : { commit: __APP_COMMIT__ }),
        seed: SIM_SEED,
        ledger: sentLedger,
        tiers: bootKit,
        unlocks: [...boughtUnits],
        deploy: picks === null ? null : [...picks.chosen],
      });
      // Read after `startMission` has spawned the force: living side-0 units
      // by type, and how many the placements drew from the roster (R-3, R-4).
      // Only when telemetry is on -- the no-op does no work -- and a throw
      // here (a hand-edited roster entry) drops the loadout, never the
      // mission: this sits inside the boot's own try, whose catch tears down.
      const telOn = telemetry() !== NOOP_TELEMETRY;
      let loadout: Loadout | undefined;
      if (telOn) {
        try {
          loadout = startLoadout(
            { count: sim.entityCount, side: sim.state.side, alive: sim.state.alive, typeIdx: sim.state.typeIdx, typeId: (k) => sim.unitTypes[k]?.id },
            sentLedger['roster.surviving_units'],
            resolvedMission.starting_force
          );
        } catch {
          loadout = undefined;
        }
      }
      const missionTel: MissionTelemetry = telemetry().missionStarted(
        resolvedMission.id,
        (ledger['campaign.mission_results'] ?? {})[resolvedMission.id] !== undefined,
        (): RuntimeView => ({
          tick: sim.tickCount,
          result: runtime?.result ?? 'ongoing',
          defeatCause: runtime?.defeatCause,
          roe: runtime?.roeScore ?? 0,
          fielded: runtime?.fieldedCount ?? 0,
          lost: Object.values(runtime?.lostByType() ?? {}).reduce((a, b) => a + b, 0),
          objectives: runtime?.objectiveList ?? [],
        }),
        loadout
      );
      onDispose(() => missionTel.end());
      missionTelemetry = missionTel;
      // The account the player walks in with (R-5).
      if (telOn && ledgerStore.available) telemetry().account('mission_start', ledgerStore.readAccount(), { mission: resolvedMission.id });
    } catch (err) {
      teardown();
      throw err;
    }
  }

  // The art the game may still need but nobody is waiting for -- a mesh
  // vehicle's wreck sprite, a deferred buildable's billboard fallback, and
  // every BUILDING WRECK mesh -- starts two frames after deploy, so the first
  // picture the player sees is not competing with 40 PNG decodes and 9.6 MiB
  // of collapsed masonry. Deliberately after `loading.done()`, not between the
  // two waits like the deferred unit meshes: a briefing is read for seconds
  // and a wreck is minutes away, so nothing is lost by waiting.
  //
  // It fails soft and cannot draw a hole: a wreck mesh that is still in
  // flight leaves `buildingMeshWreckTemplates` without the type,
  // which is exactly the state in which `updateStructures` keeps drawing the
  // procedural wreck -- see `loadBuildingWreckMesh`'s own doc comment.
  const afterFirstFrame: Array<() => void> = [];
  afterFirstFrame.push(() => {
    for (const id of meshPlan.buildings) wreckMeshLoader(id);
  });
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

  /** The runtime's objective list with each active evacuation's tally and
   *  refuge folded in (GH-279, `evacuation.ts`). What the strip, the tracker
   *  and the pause list read. NOT what `objectiveZonesFor` reads: the refuge
   *  is never drawn in the 3D world (the lead's ruling). */
  // GH-345: objectives authored `clock: false` (First Light's relief hold)
  // keep their countdown out of the strip; read once, it is mission data.
  const clockless = clocklessObjectives(
    (mission?.objectives ?? []) as readonly { id: string; clock?: boolean }[]
  );
  const liveObjectives = () =>
    runtime
      ? withoutHiddenClocks(
          withOutsideCounts(
            withEvacuationProgress(runtime.objectiveList, evacTargets, evacuatedSoFar, refugeAt),
            map.zones,
            (zone) => unitsJustOutside(sim.state, sim.entityCount, zone)
          ),
          clockless
        )
      : [];
  const getMission = (): MissionView | null =>
    runtime && mission
      ? {
          name: mission.name ?? mission.id,
          objectives: liveObjectives(),
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
  // PA-07: the held beat between the mission's end and the report. While it
  // is set the tick accumulator is held (the mission has ended; the sim is
  // never slowed and never ticked by the beat), the renderer's presentation
  // time eases down and the camera eases to the deciding ground
  // (`ui/outcome-beat.ts`). Cleared when the moment hands over.
  let beat: { t0: number; reduced: boolean; from: BeatCamera; focus: { x: number; y: number } | null } | null = null;
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
      const none = haltNote(mine.length);
      if (none) hud.note(none.text, none.tone);
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
  // Task 8 (R-9, P19): a fourth overlay `focusTrap` closes, and the one whose
  // wiring point is NOT "at mount" -- `objectivesHandle` above is built once
  // and toggled with `.hidden` from then on, so a trap installed alongside
  // it would stay live (and keep capturing Tab) for the rest of the mission
  // after the tracker's first open. Installed in `openObjectives`, disposed
  // in `closeObjectives`, so it exists only while the panel is actually
  // visible -- and the `onDispose` below is a safety net for a soft leave
  // that tears the whole battlefield down while the tracker happens to be
  // open, so this `window` listener can never outlive the mission that
  // created it.
  let objectivesTrapDispose: Disposer | null = null;
  onDispose(() => objectivesTrapDispose?.());
  const closeObjectives = (): void => {
    if (!objectivesOpen) return;
    objectivesOpen = false;
    if (objectivesHandle) objectivesHandle.el.hidden = true;
    hud.setObjectivesOpen(false);
    objectivesTrapDispose?.();
    objectivesTrapDispose = null;
  };
  const openObjectives = (): void => {
    if (!objectivesHandle) {
      objectivesHandle = objectivesPanel(document.body, {
        // A closure, not a snapshot, exactly like `rosterEntryOf` below --
        // `runtime` does not exist yet on every path this function can run.
        rows: liveObjectives,
        paysCredits,
        onClose: closeObjectives,
        // The refuge button on an active evacuation (GH-279): the camera,
        // like the jump key, and the refuge ring on where it lands
        // (`ui/refuge-ping.ts`; three draws it, Pixi has none).
        onJump: refugeJump(renderer.camera, (x, y) => renderer.pingRefuge?.(x, y)),
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
    objectivesTrapDispose = focusTrap(objectivesHandle.el);
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
  /** WP-P5: did this session show the order-row line (`hintFor`)? */
  let showedOrderRowHint = false;
  // GH-345 follow-up: first-use one-liners for the lessons the nine-beat
  // tutorial cut (`data/hints/first_use.json`, `ui/hint-rules.ts`). Never in
  // the tutorial itself and never in a sandbox, so a sandbox walk cannot spend
  // a player's one showing. A line counts as shown, and is remembered, once it
  // has been the hint line for six seconds running -- the dock's own hint
  // included, which used to stay up until the key was pressed.
  const hintsSeen = loadHintsSeen(settingsStore);
  const hintTimer = createShownTimer(6000);
  const contextualHint = () => {
    if (mission === undefined || mission.id === 'beit_sahwan_0_tutorial') return null;
    const sel = renderer.selection.filter((i) => sim.state.side[i] === 0 && sim.state.alive[i] === 1);
    const ctx: HintContext = {
      missionId: mission.id,
      hasResources: mission.resources !== undefined,
      selectedCount: sel.length,
      selectedTypes: () => new Set(sel.map((i) => sim.unitTypes[sim.state.typeIdx[i]].id)),
      forceSize: () => {
        let n = 0;
        for (let i = 0; i < sim.entityCount; i++) if (sim.state.side[i] === 0 && sim.state.alive[i] === 1) n++;
        return n;
      },
      carrierEmptySeat: () =>
        sel.some((i) => {
          const slots = sim.unitTypes[sim.state.typeIdx[i]].transportSlots;
          return slots > 0 && sim.passengerCount(i) < slots;
        }),
      enemyPinned: () => {
        for (let i = 0; i < sim.entityCount; i++) {
          if (sim.state.side[i] === 1 && sim.state.alive[i] === 1 && sim.state.pinned[i] === 1) return true;
        }
        return false;
      },
    };
    const r = owedRule(firstUseHints, hintsSeen, ctx);
    return r ? { key: r.key, id: r.id, ...(r.keys ? { keys: r.keys } : {}) } : null;
  };

  // GH-345: the HUD disclosure set. Seeded from the mission's own
  // `hud.hidden` (everything, for every mission that declares none);
  // `refreshHudShown` below folds a running tutorial in once one exists.
  // Read by the Hud, the minimap, the dock, the group bar and the two
  // keyboard paths those surfaces own (production, ctrl+N), so a hidden
  // surface is inert everywhere at once.
  // GH-345: names for the places Conduct deductions mention -- a flagged
  // zone's structure ("Clinic"), a destroyed structure's catalogue name.
  const placeNames: PlaceNames = placeNamesFor(
    map,
    structureCatalogue as Readonly<Record<string, { name: string } | undefined>>
  );
  let hudShown: ReadonlySet<HudElement> = hudVisibility(null, null, (mission ?? null) as MissionHudJson | null);
  const isShown = (el: HudElement): boolean => hudShown.has(el);

  /** The cursor `updateHover` last chose, bare (no badge). The fire panel
   *  reads it to say what a right-click there does (PA-08), so its line and
   *  the cursor are one decision rather than two that could disagree. */
  let hoverCursorName: CursorName = 'default';
  // Pass C2/C4 (D3): when each unit went to ground, off the sim's own
  // `pinned` events, for the card's break clock.
  const pinnedSince = new PinnedSince();
  const hud = new Hud(document.body, {
    sim,
    isShown,
    pinnedTicks: (id) => pinnedSince.ticksPinned(id, sim.tickCount),
    // GH-345: the running Conduct invoice, worded from the sim's own reasons.
    conductInvoice: () => ({ lines: invoiceLines(deductions, placeNames), floor: mission?.roe?.fail_below }),
    getSelection: () => renderer.selection,
    getMission,
    hoverStructure: () => renderer.hoverStructure,
    hoverEntity: () => renderer.hoverEntity,
    hoverCursor: () => hoverCursorName,
    gameVersion: __GAME_VERSION__,
    // PA-25: a sandbox's strip names the map it walks, as a mission's names
    // the mission; the same name the Free Play picker lists it by.
    placeName: mission ? undefined : mapJson.name,
    commander: hudCommander,
    orders,
    armedOrder: () => armedOrder,
    // `row.key` is an `input/keymap.ts` action id for every bound order and
    // the literal `'RMB'` for `attackMove` -- `isAction` tells the two apart,
    // and `bindings` (declared below, alongside the keydown listener that
    // reads the same table) is closed over rather than copied, so a rebind
    // repaints the button the next time the HUD ticks.
    keyFor: (id) => (isAction(id) ? keyLabel(bindings[id]) : id),
    portrait: (typeId, slot) => (slot === 'chip' ? chipPortraits[typeId] : undefined) ?? portraits[typeId] ?? null,
    portraitIsIcon: (typeId) => portraitIcons.has(typeId),
    kitOf: (typeId) => kitByType.get(typeId) ?? null,
    kitLevelOf,
    // A closure over `runtime`, not a snapshot of it: the Hud is constructed
    // before a runtime exists on some paths (`runtime` is set only `if
    // (mission)`, above), so this must read the variable at call time.
    rosterEntryOf: (id) => runtime?.rosterEntryOf(id),
    // Reads `ledger`, this battlefield's own `const`: the campaign as it was
    // read at boot, never rebound. That is the right ledger mid-mission, when
    // the card is read: this mission's own losses reach `roster.lost` only
    // through the victory write at mission end, so every record a slot can
    // point to mid-mission is already in it.
    // `type` is resolved to a display name here, through the same
    // `units[type]?.name ?? type` lookup the debrief's own memorial rows use
    // (`unitLost`'s `unit` field, and `lostRecordFor`'s `type`, are both the
    // sim's raw type id) -- the card must never show a raw sim id to the player.
    predecessorOf: (slot) => {
      const record = predecessorOf(ledger['roster.lost'] ?? [], slot);
      if (record === undefined) return undefined;
      return {
        ...(record.name !== undefined ? { name: record.name } : {}),
        type: units[record.type as keyof typeof units]?.name ?? record.type,
      };
    },
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
    leave: () => req.navigate(leaveHref(!mission)),
    freePlay: !mission,
    openObjectives,
    // Task 9: facts only the shell has, handed to the pure priority list in
    // `hint-model.ts`. `renderer.hoverEntity >= 0` is the same "over a
    // hostile" signal the cursor resolver already reads further down
    // (`hints.hostile`) -- one definition of "hovering a hostile" for both.
    hint: () => {
      const line = hintFor({
        selected: renderer.selection.length,
        hoveringHostile: renderer.hoverEntity >= 0,
        sawProjectedFire: seen.projectedFire,
        sawDock: seen.dock,
        dockAvailable: mission?.resources !== undefined,
        contextual: contextualHint(),
        sawOrderRow: seen.orderRow,
      });
      if (line?.key === 'hud.hint.selected') showedOrderRowHint = true;
      const shown = hintTimer.tick(line?.id ?? null, performance.now());
      if (shown === 'dock') {
        seen.dock = true;
        markSeen(settingsStore, 'dock');
      } else if (shown !== null) {
        hintsSeen.add(shown);
        markHintSeen(settingsStore, shown);
      }
      return line;
    },
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
  // Pass K: a /free-play/<id> link naming no shipped map still loads the
  // default ground (a typo in a dev URL should not look like a broken build),
  // but the PLAYER is told, by name -- it used to be a console line only, and
  // the sandbox strip names no map, so a different battlefield just appeared.
  const unknownMap = unknownSandboxMapNotice(sandboxMap, maps, mapJson.name);
  if (unknownMap) hud.note(...unknownMap, { tier: 'important' });
  // WP-P5 (PA-16): a session that showed the order-row line has done its
  // teaching, so the next one does not show it. Marked on LEAVING rather than
  // on first sight, so the line stays for the whole of that first session --
  // retiring it mid-mission would be a line that vanished for no reason.
  onDispose(() => {
    if (showedOrderRowHint && !seen.orderRow) markSeen(settingsStore, 'orderRow');
  });

  // Unit voices (WP-AU1 §7). Read-only on the sim (invariant 4): `look` and
  // `onTick` only read state and events the sim already produced. Its intents
  // arrive through `intentListeners` below; the pointing sites call `hint`
  // before they dispatch (R-3).
  const voice = new VoiceRuntime({
    now: () => performance.now(),
    // A microtask, never rAF or a timer: both are throttled in a hidden tab,
    // and a clamped timer would let a LATER input join this gesture.
    schedule: (fn) => queueMicrotask(fn),
    languages: voiceLangs,
    look: {
      unitOf: (id) => {
        const u = unitJson[sim.unitTypes[sim.state.typeIdx[id]].id];
        return u ? { faction: u.faction, voice: voiceClassOf(u) } : null;
      },
      side: (id) => sim.state.side[id],
      pos: (id) => ({ x: fx.toNumber(sim.state.posX[id]), y: fx.toNumber(sim.state.posY[id]) }),
      isVisible: (x, y) => renderer.isVisible(x, y),
      camera: () => renderer.camera,
      // GH-262: a move/attack order to a pinned unit gets the pinned call
      // instead of the ordinary line.
      isPinned: (id) => isPinned(sim.state, id),
    },
    play: (cue) => audio.playVoice({ key: cue.key, priority: cue.priority, at: cue.at ?? undefined }),
    // A bark follows the captions setting; an announcement shows always
    // (polish pass F, A5) -- it is mission information, and a Hebrew line
    // nobody understands is noise.
    caption: (text, seconds, always) => {
      if (always === true || req.settings.get().accessibility.captions) hud.caption(text, seconds);
    },
    // AU-5: a line cut short, or the verdict, takes its caption with it.
    clearCaption: () => hud.clearCaption(),
    info: import.meta.env.DEV ? (m) => console.info(m) : () => {},
    text: (k, params) => t(k, params),
    noted: voiceNoted,
    // GH-110: the EVA half. The radio net speaks the player faction's
    // language; captions carry it until a line is recorded (D5).
    announcements: (audioManifest as AudioManifest).voices?.announcements,
    announceLang: voiceLangs['kdf'] ?? 'he',
    labelOf: (id) => mission?.objectives.find((o) => o.id === id)?.text ?? id,
  });
  onDispose(() => {
    voice.dispose();
    // Every voice, every cue hold, the ambience bed, and the music back to
    // the menu's level.
    audio.leaveMission();
  });

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
  // GH-464: feedback. One session per boot -- the gate, who a note is sent
  // as, the client -- and the pause menu's tab and the debrief's prompt
  // appear only when it says so. `fbWhere` reads the live world for a note's
  // context at the moment it is SENT, read-only (invariant 4).
  const fb: FeedbackSession = browserFeedbackSession();
  const fbWhere = (): SessionNote['where'] => {
    const s = req.settings.get();
    let alive = 0;
    const fielded = new Set<string>();
    for (let i = 0; i < sim.entityCount; i++) {
      if (sim.state.side[i] !== 0 || sim.state.alive[i] !== 1) continue;
      alive++;
      fielded.add(sim.unitTypes[sim.state.typeIdx[i]].id);
    }
    const selected = new Set<string>();
    for (const i of renderer.selection) {
      if (i >= 0 && i < sim.entityCount) selected.add(sim.unitTypes[sim.state.typeIdx[i]].id);
    }
    const input: ContextInput = {
      ...shellContextInput(s),
      paused,
      force: { alive, lost: Object.values(runtime?.lostByType() ?? {}).reduce((a, b) => a + b, 0), fielded: [...fielded], selected: [...selected] },
      camera: { x: renderer.camera.x, y: renderer.camera.y, zoom: renderer.camera.zoom },
      feed: hud.feedLines(),
    };
    if (runtime) {
      input.objectives = runtime.objectiveList.map((o) => ({ id: o.id, status: o.status, primary: o.primary }));
      input.conduct = runtime.roeScore;
    }
    if (mission) input.floor = starRoeFloor(mission.roe?.fail_below);
    return {
      context: collectContext(input),
      ...(mission ? { mission: mission.id } : {}),
      map: mapId,
      tick: sim.tickCount,
    };
  };
  const pause = (): void => {
    if (paused) return;
    paused = true;
    // The mix's pause row: every voice stops, the music steps 6 dB down.
    audio.setPaused(true);
    // Repainted here, not on the next tick: at `paused` no tick ever comes,
    // so a strip that waits for one never dims.
    hud.paintSpeed();
    pauseHandle = pauseMenu(document.body, {
      objectives: liveObjectives,
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
        const leaveText = leaveCopy(!mission);
        void confirmDialog(document.body, {
          title: leaveText.title,
          body: leaveText.body,
          confirm: leaveText.confirm,
          danger: true,
        }).answer.then((ok) => {
          if (ok) req.navigate(leaveHref(!mission));
        });
      },
      settings: req.settings,
      build: __APP_BUILD__,
      feedback:
        fb.shown && !feedbackClosed()
          ? {
              who: fb.who,
              build: fb.build,
              storage: fb.storage,
              ...(mission ? { where: { mission: mission.name ?? mission.id, clock: missionClock(sim.tickCount) } } : {}),
              // Taken when the tab first opens: the frame the player paused on.
              picture: () => takePicture(renderer),
              replay: {
                available: () => replayLog.available,
                approxBytes: () => replayLog.approxBytes,
                log: () => replayLog.log(sim.tickCount, sim.hash()),
              },
              send: async (sub, signal) =>
                fb.send(
                  {
                    source: 'pause',
                    category: sub.kind,
                    text: sub.text,
                    ...(sub.contact === undefined ? {} : { contact: sub.contact }),
                    where: fbWhere(),
                    shot: sub.shot,
                    replay: sub.replay,
                  },
                  { signal }
                ),
            }
          : undefined,
    });
  };
  const resume = (): void => {
    if (!paused) return;
    paused = false;
    audio.setPaused(false);
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
    // GH-279: the refuge, only while an evacuation is still being scored.
    refuge: () => (runtime ? activeRefuge(runtime.objectiveList, evacTargets, refugeAt) : null),
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
        keepOnMap();
      },
      // The SAME resolver AND the same carrying-out as the canvas
      // contextmenu below: one `issueOrder`, called twice. A minimap order
      // that resolved differently from the identical click on the field
      // would be two answers to one question, and the one that would drift
      // first is the protected-structure refusal -- invisible on open ground
      // and only reported in the debrief.
      // The minimap has no hover: its order is never "over a hostile" (R-3).
      order: (x, y, mods) => {
        voice.hint({ hostile: false });
        issueOrder(intentWorld, orderSink, myLiving(), x, y, mods);
      },
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
  // VR-01: a colour-vision change re-colours the world and the minimap at
  // once, as `theme.css` already does the HUD. Registered here, beside the
  // two sinks it drives, and unsubscribed by the battlefield's own disposer.
  onDispose(bindLiveTeamColors((fn) => req.settings.onChange(fn), cvdVariant, { renderer, minimap }));
  /** A unit mesh that failed -- at boot or arriving late -- as a HUD note,
   *  once per type, from the 1 Hz sweep. Loud beside the renderer's own
   *  console.error and the proxy box it draws (WP-A3.3, ruling 2). (A
   *  `failedArt` batch note for sprite sheets stood beside this until the
   *  sheets were retired.) */
  const reportedMeshFailures = new Set<string>();
  const reportMeshFailures = (): void => {
    for (const id of failedMesh) {
      if (reportedMeshFailures.has(id)) continue;
      reportedMeshFailures.add(id);
      // By the unit's NAME, never its id (PA-01). A structure or wreck id
      // has no unit type to name it by, so it gets the scenery sentence.
      const unitName = sim.unitTypes.find((u) => u.id === id)?.name;
      hud.note(
        unitName !== undefined ? t('main.note.meshFailed', { name: unitName }) : t('main.note.sceneryFailed'),
        'bad'
      );
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
  // Polish pass F (A10): the music steps down to the battle level as the
  // deploy gate clears, and the start cue says the clock is running.
  audio.setMusicScene('battle');
  // A11: the ground's own bed fades in under it -- picked from the map
  // (ambience.ts), stopped by the pause menu and by `leaveMission` above.
  // SWITCHED OFF (AMBIENCE_ENABLED, the lead's ruling 2026-10-09): null here,
  // so no bed starts and none is fetched.
  audio.setAmbience(ambienceBedToPlay(map));
  if (mission) {
    audio.playCue(CRITICAL_CUES.missionStart);
    // AU-5: no bark while the start cue and the title card own the moment.
    voice.hush('start');
    // Shai on the net (A4): caption-only until the line is recorded.
    voice.onMission([], [{ event: 'mission_start' }]);
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
      onBought: (id) => {
        missionTelemetry?.onBought(id);
        replayLog.buy(sim.tickCount, id);
      },
      // Ruling 1 (WP-A3.3): a deferred buildable whose GLB has not landed --
      // or not been asked for yet -- draws nothing, so its tile says
      // "deploying" once bought. A FAILED type is not pending: it draws a
      // proxy box and has its own HUD note.
      meshPending: (id) => hasUnitMesh(id) && !meshReady.has(id) && !failedMesh.includes(id),
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
            // The same one read the chips and the card make.
            kit: kitLevelOf(u.id),
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
      // GH-229 bug 2: the same `ledgerStore.readAccount()` seam the garage
      // screen reads its own wallet through (line ~1001 above) -- never
      // `localStorage` directly. `undefined` when the store itself is
      // unavailable, which `ProductionOptions.credits`' doc comment says is
      // the one state with no number to show.
      credits: ledgerStore.available ? ledgerStore.readAccount().balance : undefined,
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
  // K-16: a lost graphics context used to leave a silent black canvas. Hold the
  // battle (nothing is drawn, so nothing should play out unseen) and put the
  // boot-failure card over it with Reload and the main menu. The listener comes
  // off in this screen's own disposer, which also runs before the renderer's
  // teardown releases the context on purpose -- that release must not read as
  // a loss.
  let contextCard: HTMLElement | null = null;
  const unwatchContext = watchContextLoss(canvas, () => {
    if (disposed) return;
    console.error('[lions] the graphics context was lost mid-mission');
    gameSpeed = 0;
    contextCard = mountInterrupted(document.body, routes.menu());
  });
  onDispose(() => {
    unwatchContext();
    contextCard?.remove();
    contextCard = null;
  });
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
   *  animated cursor is actually showing: `cursorAnim.show` is called every
   *  `updateHover` tick (every rAF, ~60Hz) regardless of whether the state
   *  key changed that frame, but for every non-animated cursor -- the large
   *  majority of hover time -- its cost is one object-property lookup and an
   *  already-false comparison, no DOM write. The cost while an animated
   *  cursor *is* showing: one attribute write (`data-cursor-frame`) and its
   *  style invalidation, on this one canvas element, every `intervalMs` --
   *  each cursor's own rate, derived from `ORDER_SIGHT` as `round(periodMs /
   *  frames)` for the sight-driven names (225ms for `attack`) and authored
   *  directly for `charge`/`demolish` (200ms/300ms) -- see ANIMATED_CURSORS
   *  in cursor.ts for the full set -- not once per rendered frame.
   *
   *  The driver itself (cursor-anim.ts) additionally pauses -- writing frame
   *  0, the rest pose -- under `prefers-reduced-motion` and while the tab is
   *  hidden. `refresh()` is what notices a change in either: the
   *  `visibilitychange` listener below, and the settings bus, since a motion
   *  preference can change mid-mission from the settings panel and cannot
   *  wait for the next cursor-name change to take effect. */
  const cursorAnim = cursorAnimDriver(ANIMATED_CURSORS, {
    writeFrame: (frame) => {
      canvas.dataset.cursorFrame = String(frame);
    },
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    reducedMotion: prefersReducedMotion,
    hidden: () => document.visibilityState === 'hidden',
  });
  // A `setInterval` outlives the document's attention span, not just the
  // frame loop: left running it writes `data-cursor-frame` to a detached
  // canvas several times a second for the rest of the session.
  onDispose(() => cursorAnim.dispose());
  const onVisibilityChange = (): void => cursorAnim.refresh();
  document.addEventListener('visibilitychange', onVisibilityChange);
  onDispose(() => document.removeEventListener('visibilitychange', onVisibilityChange));
  // The settings bus already notifies on every change (`applySettings`
  // writes `data-motion` first, so `prefersReducedMotion()` sees the new
  // value by the time this fires). `bus` itself lives in `main()`'s own
  // scope, one level up from `bootBattlefield` -- but `req.settings.onChange`
  // (settings.ts's `SettingsDeps`, passed into every battlefield request) is
  // that same bus's `onChange`, and IS reachable here, already relied on for
  // the `bindings` keymap subscription further down (a rebind made from the
  // pause menu must reach the key listener without a re-boot). Subscribing it
  // means a motion toggle mid-mission pauses the cursor immediately rather
  // than waiting for the next name change to notice.
  onDispose(req.settings.onChange(() => cursorAnim.refresh()));
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
  intentListeners.push((intent) => voice.observe(intent));
  // The feed line for a pinned or broken unit's order (GH-262). `applyIntent`
  // above only queues the command; `sim.state` is still pre-order here, which
  // is exactly the state the rule wants to read.
  let pinnedNoteState = INITIAL_PINNED_NOTE;
  intentListeners.push((intent) => {
    const result = pinnedOrderNote(
      pinnedNoteState,
      intent,
      {
        pinned: (id) => isPinned(sim.state, id),
        routed: (id) => sim.state.routed[id] === 1,
        soft: (id) => sim.unitTypes[sim.state.typeIdx[id]].isSoft,
      },
      performance.now()
    );
    pinnedNoteState = result.state;
    if (result.line) hud.note(...alertNotice(result.line));
  });
  // Counted after `applyIntent` has run: an observer, like the voice (GH-254).
  intentListeners.push((intent) => missionTelemetry?.onIntent(intent));
  // GH-464: and recorded, at the tick it was issued, for a Bug note's replay.
  intentListeners.push((intent) => replayLog.record(sim.tickCount, intent));
  /** Where a resolved right-click's three effects land. Built once and passed
   *  to `issueOrder` by both pointing surfaces. */
  const orderSink: OrderSink = {
    dispatch,
    note: (text, tone) => hud.note(text, tone),
    marker: (x, y) => renderer.addOrderMarker(x, y),
    // Polish pass F: an order that resolved to nothing says so.
    deny: () => audio.playCue(CRITICAL_CUES.uiDeny),
  };

  // The tutorial gets read-only lookups, never the sim itself — it must not be
  // able to queue a command (invariant 4).
  // `tutorials` is keyed by tutorial id (e.g. "beit_sahwan_0"), not by mission
  // id — the mission each entry teaches is its own `.mission` field, so the
  // match has to search by that rather than index directly by `missionId`.
  const stepList = Object.values(
    tutorials as Record<
      string,
      ({ mission: string; steps: StepJson[]; completes?: string } & TutorialHudJson) | undefined
    >
  ).find((t) => t?.mission === missionId);
  let tut: TutorialState | null = null;
  /** GH-345: recompute the disclosure set from the tutorial as it stands.
   *  Cheap (a set of at most eighteen), and called wherever `tut` changes. */
  const refreshHudShown = (): void => {
    hudShown = hudVisibility(tut, stepList ?? null, (mission ?? null) as MissionHudJson | null);
  };
  /** Where the camera stood when the tutorial first ticked, for beat 1's
   *  `camera` predicate. Captured lazily on that first tick rather than at
   *  init, so a boot-time camera placement is not counted as the player's. */
  let tutCameraStart: { x: number; y: number } | null = null;
  /** The last hover the tutorial was told about, projection included: an
   *  enemy that becomes identified under a still cursor is a new fact. */
  let lastHoverProjection: FireState | null = null;
  /** Whether tutorial beat 9 currently holds the Conduct invoice open. */
  let tutInvoiceOpen = false;
  let telemetryTutIndex = -1;
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
    refreshHudShown();
    tutPanel = tutorialPanel(document.body, {
      onSkip: () => {
        tut = null;
        refreshHudShown();
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
        else audio.playCue(CRITICAL_CUES.uiDeny);
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
            // The right-click's own point (PA-14): a building's wall is the
            // building, here as on the contextmenu path.
            const at = pointerPoint(renderer, sim, p.x, p.y);
            const move = resolvePointer(intentWorld, {
              ids: mine,
              x: at.x,
              y: at.y,
              append: ev.shiftKey,
              armed: null,
              confirm: ev.altKey,
            });
            voice.hint({ hostile: renderer.hoverEntity >= 0 });
            for (const intent of move.intents) dispatch(intent);
            if (move.note) hud.note(move.note.text, move.note.tone);
            if (move.marker) renderer.addOrderMarker(at.x, at.y);
            if (orderDenied(move, mine.length)) audio.playCue(CRITICAL_CUES.uiDeny);
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
  // The resolver's view of the world. One adapter (`simIntentWorld`,
  // input/pointer.ts), so the click and the hover cursor ask the same object
  // the same questions -- and so does pointer.test.ts.
  const intentWorld: IntentWorld = simIntentWorld(sim, (x, y) => {
    // zoneContains is shared with stepRoe's fire/strike branches (task 1) so
    // the warning here and the ROE penalty in the sim cannot drift by a tile.
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
  });
  /**
   * Everything the alert layer may ask about the world (`ui/alerts.ts`'s own
   * `AlertWorld`), built once beside `intentWorld` above and for the same
   * reason: the model stays a pure function over a fixture. The adapter is
   * `ui/alert-world.ts`'s since WP-P5, so a test can drive it with a real
   * runtime; the one thing only this file has is the camera, which is what
   * `placeOf` asks -- through the renderer's own projection, never a copy of
   * it (CLAUDE.md), against the canvas the player is looking at.
   */
  const alertWorld = alertWorldFor({
    sim,
    runtime: () => runtime,
    mission: resolvedMission ?? null,
    map,
    units: units as Readonly<Record<string, { name?: string } | undefined>>,
    placeOf: (x, y) => placeOnScreen(renderer.worldToScreen(x, y), canvas.clientWidth, canvas.clientHeight),
  });
  /** Carried across ticks: when each entity last made the feed, and which
   *  waves have been announced. Copy-on-write inside `alertsForTick`, so this
   *  is only ever reassigned, never mutated. */
  let alertState = initAlertState();
  /** Where the jump key goes: the latest important or major alert, or a
   *  minor one while nothing heavier has happened (`nextJump`, WP-P5). A
   *  plain local: presentation state read by exactly one keydown case. */
  let jumpTarget: JumpTarget | null = null;

  canvas.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    // PA-14: the point the hover cursor read, so a click on a building's
    // upper wall orders onto the building, not the ground hidden behind it.
    const w = pointerPoint(renderer, sim, ev.clientX - rect.left, ev.clientY - rect.top);
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
    voice.hint({ hostile: renderer.hoverEntity >= 0 });
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
  /** The pan's own velocity, eased by `stepPan` in the frame loop. */
  const panVel: PanVelocity = { right: 0, down: 0 };
  /**
   * Keep the camera on the map (WP-P1, PA-04): applied after every PLAYER
   * camera move -- pan, wheel zoom, the minimap, the alert and idle-unit
   * jumps and control-group centring -- and nowhere else. The dev and tool
   * paths (`__lions.goto`, `__lions.camera`, a capture's own placement) set
   * the camera exactly where they say, so a capture framed past an edge is
   * not silently moved, and nothing clamps a camera nobody touched.
   */
  const keepOnMap = (): void => {
    const c = clampCamera(renderer.camera, sim, { width: renderer.width, height: renderer.height });
    renderer.camera.x = c.x;
    renderer.camera.y = c.y;
  };
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
      keepOnMap();
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
    // D18 (GH-464): a focused text field owns its keys. The pause menu's capture
    // guard already stops them (`pause.ts`); this is the line for a field on
    // no modal at all -- the debrief's one-line rating note -- where `h` would
    // otherwise still halt and `w` still pan while the player types.
    if (isTextEntry(ev.target)) return;
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
        // Final review, ruling 2: nothing while the objectives tracker is
        // open. Tab there belongs to the tracker's own focus trap
        // (`openObjectives` installs it), which has already moved focus by the
        // time this bubble listener runs -- and `isDialogOpen()` does not know
        // the tracker, so the handler-wide guard above lets Tab through. Left
        // alone, one keypress moved focus inside the tracker AND walked the
        // lime frame along the chips behind it: two answers to one key, one
        // of them on a surface the player is not looking at.
        if (objectivesOpen) break;
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
        // GH-345: a hidden dock is inert, its key included.
        if (!isShown('dock')) break;
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
        if (jumpTarget) {
          renderer.camera.x = jumpTarget.at.x;
          renderer.camera.y = jumpTarget.at.y;
          keepOnMap();
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
          keepOnMap();
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
        const target = escapeTarget(objectivesOpen, isDialogOpen(), anyArmed(armedOrder, armedSupport));
        if (target === 'closeTracker') {
          closeObjectives();
          break;
        }
        if (target === 'none') break;
        // GH-264, widened: Escape used to do nothing once a sweep/strike was
        // armed from the dock, OR an attack-move/smoke order was armed from
        // the order row -- only clicking the same control again disarmed it.
        // The issue that opened this fix named only the support half and
        // assumed the other two already had a rung; they did not, so all
        // three are cancelled together here. `production?.setArmed(null)` is
        // the same call the dock's own tile-toggle makes (clears the lime
        // highlight and calls `onArm(null)`, which nulls `armedSupport`);
        // nulling `armedOrder` directly is the same reset `armOrder` and the
        // mutual-exclusion branches above already do. Both are unconditional
        // -- disarming whichever one was NOT armed is a no-op -- so this one
        // rung covers all three without needing to know which fired. The
        // cursor (`updateCursor` below reads both every frame) falls back to
        // normal on the next frame; the order row's highlight follows on the
        // HUD's own 4 Hz repaint, so within about 250 ms.
        if (target === 'disarm') {
          armedOrder = null;
          production?.setArmed(null);
          break;
        }
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
    // GH-345: a hidden group bar is inert -- no assign, no recall.
    if (ev.key >= '1' && ev.key <= '9' && isShown('groups')) {
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
  /** Set the camera zoom to `z` (clamped), keeping the point under the cursor
   *  fixed when zoom-to-cursor is on, and the view on the map. The one place a
   *  wheel zoom lands, whether it is instant (reduced motion) or one frame of
   *  a glide. */
  const applyZoom = (z: number): void => {
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
    // Zooming out near an edge would otherwise open up empty ground.
    keepOnMap();
  };
  /** The zoom in flight, if any (`stepZoomGlide`, eased in the frame loop). */
  let zoomGlide: ZoomGlide | null = null;
  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    // Proportional to how far the wheel turned (one mouse notch is still
    // 1.1x): a trackpad's stream of small deltas zooms smoothly instead of
    // stepping 10% per event. A notch glides over ~150 ms; under reduced
    // motion it lands at once.
    const plan = planZoom(
      zoomGlide,
      renderer.camera.zoom,
      wheelZoomFactor(ev.deltaY, ev.deltaMode),
      prefersReducedMotion()
    );
    zoomGlide = plan.glide;
    if (plan.glide === null) applyZoom(plan.zoom);
  });

  // Middle-mouse drag grabs the ground (`createPanDrag`): position-based, so
  // frame-rate independent, and it stops the moment the cursor does. It kills
  // any key-pan momentum on the way in, so the two never fight.
  const panDrag = createPanDrag();
  canvas.addEventListener('pointerdown', (ev) => {
    if (!isPanDragButton(ev.button)) return;
    ev.preventDefault();
    const p = canvasXY(ev);
    panDrag.start(p.x, p.y);
    panVel.right = 0;
    panVel.down = 0;
  });
  // Middle-click also starts the browser's autoscroll on some platforms.
  canvas.addEventListener('mousedown', (ev) => {
    if (isPanDragButton(ev.button)) ev.preventDefault();
  });
  onWindow('pointermove', (ev) => {
    if (!panDrag.active) return;
    const p = canvasXY(ev);
    const d = panDrag.move(p.x, p.y, renderer.camera.zoom);
    if (d === null) return;
    renderer.camera.x += d.dx;
    renderer.camera.y += d.dy;
    keepOnMap();
  });
  onWindow('pointerup', (ev) => {
    if (isPanDragButton(ev.button)) panDrag.end();
  });
  onWindow('blur', () => panDrag.end());

  /** Where one tick's alerts land (`ui/alerts.ts` decides WHAT is worth
   *  saying; this decides WHERE it goes): the feed line, the minimap ring, the
   *  jump key, and one cue. Shared by a mission and a Free Play sandbox, so
   *  the two can never word or place the same loss differently. */
  const announceAlerts = (result: { state: AlertState; alerts: Alert[] }): void => {
    alertState = result.state;
    // One cue for the tick, the most urgent (`tickCue`): two chimes at once
    // read as noise. The feed below still carries every line.
    const cue = tickCue(result.alerts.map((a) => a.cue));
    if (cue) audio.playCue(cue);
    // AU-5 (audio plan §5.1): nothing at or below a death call talks over a
    // major alert for the next moment.
    if (cue === ALERT_CUE.major) voice.hush('major');
    for (const a of result.alerts) {
      // `alertNotice` escapes the unit NAME `alert.unitLost` interpolates
      // (shell upgrade Phase 3, Task 10); this was `t(key, params)`, raw.
      // The tier styles the line (WP-P5, C3) and ranks the jump key.
      if (a.line) hud.note(...alertNotice(a.line), { tier: a.tier });
      if (a.marks.length > 0) minimap.flash(a.marks, performance.now(), { tier: a.tier, tone: a.tone });
      jumpTarget = nextJump(jumpTarget, a.tier, a.at);
    }
  };

  // --- fixed-tick loop with render interpolation ---------------------------
  const runTick = (): void => {
    const events = sim.tick();
    renderer.snapshot();
    renderer.onEvents(events);
    audio.setListener(renderer.camera);
    audio.onEvents(events, sim);
    pinnedSince.onEvents(events);
    voice.onTick(events);
    // PA-25: a Free Play sandbox has no runtime, and the alert layer below
    // used to run only beside one -- so a sandbox fight left the feed empty.
    // The sim half of the layer needs nothing a mission has; the one mission
    // event it reads, a loss of ours, is derived by the runtime's own rule.
    // Nothing is scored: no objective, wave or Conduct line exists here.
    if (!mission) announceAlerts(sandboxAlertsForTick(alertState, events, alertWorld, sim.tickCount));
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
      voice.onMission(missionEvents);

      // The alert layer (spec acceptance (a)): one classification of the tick,
      // four consequences, all in one place so a line, a cue and a mark can
      // never disagree about what just happened. `ui/alerts.ts` decides WHAT
      // is worth saying; this decides WHERE it goes.
      //
      // `performance.now()` and not `sim.tickCount`: the flash is a
      // presentation fade on the frame clock, and nothing here writes to the
      // sim (invariant 4). The tick count goes the other way -- into the
      // model, as the cooldown's own clock.
      announceAlerts(alertsForTick(alertState, events, missionEvents, alertWorld, sim.tickCount));

      for (const e of events) if (e.kind === 'destroyed') logDestroyed(missionLog, sim.state.side[e.entity]);
      for (const me of missionEvents) {
        missionTelemetry?.onEvent(me);
        logMissionEvent(missionLog, me, {
          // Sim positions are tile CENTRES; the log keeps the tile.
          positionOf: (id) => ({ x: Math.floor(fx.toNumber(sim.state.posX[id])), y: Math.floor(fx.toNumber(sim.state.posY[id])) }),
          rosterOf: (id) => runtime?.rosterEntryOf(id),
          zone: (id) => map.zones[id],
        });
        if (tut) tut = advance(tut, { kind: 'mission', event: me }, performance.now());
        if (me.kind === 'roe') deductions.push({ penalty: me.penalty, reason: me.reason, tick: me.tick });
        if (me.kind === 'evacuated') evacuatedSoFar++;
        // The memorial half of the service record (WP-G-E4). `unitLost` is already
        // side-0-only (mission.ts:1018) and `entityRoster` is only ever added to, so the
        // dead unit's ledger entry is still readable here -- which is the whole reason
        // this can be a read at the event rather than a diff after checkEnd.
        if (me.kind === 'unitLost' && runtime) {
          const record = lostRecordFor(runtime.rosterEntryOf(me.entity), me.unit, mission.id, me.tick);
          if (record) lostThisMission.push(record);
        }
        const described = describeMissionEvent(me, mission, narratedRoeReasons, placeNames);
        if (described) hud.note(described[0], described[1], { tier: missionEventTier(me) ?? undefined });
        // The story voice (GDD §11): the commander bar is the one surface for
        // it now -- `describeMissionEvent`'s own `case 'say'` returns null,
        // so this is the only place a `say` event lands. See `Hud.say`'s own
        // doc comment for why this call is independent of `brief()`.
        if (me.kind === 'say') hud.say(me.speaker, me.text);
        if (me.kind === 'missionEnd') {
          // PR 361: a lost mission names the primary that lost it, at once,
          // in the feed and on the outcome card -- never a bare verdict over
          // clocks that have simply stopped.
          missionFailure = me.result === 'defeat' ? failureReason(runtime?.defeatCause, liveObjectives(), me.tick) : null;
          if (missionFailure) hud.note(escapeHtml(missionFailure), 'bad');
          // The end screen must not land over a live step panel — an early
          // mission end (e.g. destroy_all completing before lesson 12) is not
          // tutorial completion, so the completion flag is deliberately not
          // set here.
          tut = null;
          refreshHudShown();
          tutPanel?.destroy();
          tutPanel = null;
          renderer.clearTutorialFocus();
          // The roster half of the victory write (WP-G-E2 + E4): R-13's pipeline
          // and the debrief's two memorial rows, as one pure function driven
          // through two consecutive missions by roster-carryover.test.ts. Victory
          // only -- a defeat writes nothing to the ledger (M4, no ironman), so
          // `lostThisMission`'s records are discarded with the rest of the run and
          // the debrief must not claim a replacement that was never written
          // (R-11). Names are issued inside it, on this path only, from table
          // order and the `campaign.names_issued` counter (spec §4.7); nothing
          // there draws from the sim's RNG. `ledger` is the one this mission was
          // sent IN with, which is the `before` the slot reattachment compares
          // against.
          const carryover =
            me.result === 'victory'
              ? applyRosterCarryover(ledger, me.ledger, lostThisMission, {
                  missionId: mission.id,
                  kindOf: (typeId) => nameKind(unitFor(typeId), names as NamesJson),
                  names: names as NamesJson,
                  // The same lookup `alertWorld.unitName` uses (spec §4.7's own
                  // convention), so a feed line, a briefing line and a debrief row
                  // all name a unit the same way.
                  displayName: (typeId) => units[typeId as keyof typeof units]?.name ?? typeId,
                })
              : null;
          const updatedLedger: CampaignLedger = carryover ? carryover.ledger : { ...ledger, ...me.ledger };
          if (me.result === 'victory')
            telemetry().campaignProgress(mission.id, Object.keys(updatedLedger['campaign.mission_results'] ?? {}).length);
          let payout: ReturnType<typeof payVictory> | null = null;
          // Who took a fallen place (WP-G-E4). Empty on a defeat, like `payout`.
          // The fallen themselves are named from the mission log (GH-417).
          const replacements = carryover ? carryover.replacements : [];
          if (me.result === 'victory') {
            // Read BEFORE the ledger write (GH-330): a version-1 account migrates its
            // per-campaign record against the ledger's completed missions, and after
            // the write this very victory would count as already won this campaign.
            const accountBefore = ledgerStore.readAccount();
            // Pass K: a refused write (storage full, site data blocked) used to
            // throw out of this handler and take the end screen with it, and a
            // browser with no storage at all was still told "campaign saved".
            let ledgerSaved = ledgerStore.available;
            try {
              ledgerStore.writeLedger(updatedLedger);
            } catch (err) {
              console.error('campaign ledger write refused:', err);
              ledgerSaved = false;
            }
            // The brigade account (spec 2026-09-15 §4.2): what this run is worth, paid
            // only for improvement over what this mission has paid IN THIS CAMPAIGN
            // (GH-330; a mission not open in the campaign the run booted in is held to
            // its lifetime best instead -- `campaign-pay.ts`). Read from the
            // runtime's own counters -- the same numbers the debrief prints -- and the
            // wall clock is taken here, never in the sim.
            // R5: a mission that produces no ledger key pays nothing -- the tutorial
            // (`beit_sahwan_0_tutorial`) is the only one, sits outside `world.json`
            // and therefore outside the pinned ladder, and CLAUDE.md already says it
            // is not a campaign mission. Gate on the mission's own contract rather
            // than a name list, the same test `validate_data.mjs` already applies.
            if (mission.ledger.produces.length > 0 && ledgerStore.available) {
              const runValue = creditsFor(creditInputFrom(runtime, me.roeRating, mission.roe?.fail_below));
              payout = missionId
                ? payVictory(accountBefore, parseWorld(world), missionId, ledger, runValue, Date.now())
                : null;
              if (payout) ledgerStore.writeAccount(payout.account);
              if (payout) telemetry().account('payout', payout.account, { mission: mission.id, paid: payout.paid });
            }
            hud.note(...ledgerSavedNotice(ledgerSaved));
          }
          // GH-234: computed once, here, and handed to both the outcome moment
          // (below) and the debrief (`debriefOpts.credits`) -- the payment
          // already ran above this point (victory only), so both surfaces read
          // the same `{ paid, balance }` rather than each re-deriving it.
          const creditsInfo = payout ? { paid: payout.paid, balance: payout.account.balance } : undefined;
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
            // The end of the war: said on the report of the victory that
            // finished the campaign, and never again (`campaign-close.ts`).
            const closing = closingExchange(worldData, ledger, updatedLedger, me.result);
            const nextJson = nextMissionId ? (missions as Record<string, MissionJson | undefined>)[nextMissionId] : undefined;
            const region = enemyRegion;
            const villain = region ? commanderData.villains?.[region.id] : undefined;
            // `hostagesAccount` is null for a world that declares no `taken` at
            // all, which is not the same as a world where nobody was taken --
            // that distinction is the whole reason the field is optional, so the
            // line is skipped rather than printed as "Nobody still out."
            const account = hostagesAccount(worldData, updatedLedger);
            // A defeat writes nothing, so nobody "came back" on one.
            const cameBack = me.result === 'victory' ? (me.ledger['civ.hostages_recovered']?.[missionId] ?? 0) : 0;
            const place = (mission as { hostages_place?: string }).hostages_place;
            // Truthiness rather than `!== undefined`: the schema puts no
            // `minLength` on `hostages_place`, so an empty string is authorable
            // and would render "Four came back at ." rather than dropping the
            // clause.
            const takenAccount = account
              ? hostagesLine(account, place ? { count: cameBack, place } : undefined)
              : undefined;
            // A victory that left hostiles standing says so ("6 withdrew"). A READ of
            // the sim at the end tick; `after-action.ts` shows it on a victory only.
            const withdrew = livingHostiles(sim.state, sim.entityCount);
            // G11: the mission's own closing word, outcome-aware, resolved to a
            // plate/portrait the way the commander bar resolves one.
            const say = me.result === 'victory' ? mission.debrief?.victory : mission.debrief?.defeat;
            const speaker: ReportSpeaker | undefined = say
              ? {
                  plate: speakerPlate(hudCommander, say.speaker),
                  text: say.text,
                  portrait: speakerPortrait(hudCommander, say.speaker),
                  speaker: say.speaker,
                }
              : undefined;
            // Spec §4.5's WHY for an unlock, kept: the stars or the campaign
            // Conduct that opened it. Through `t()` now (it was raw English).
            const unlocks =
              me.result === 'victory'
                ? newlyUnlocked(kdfUnits, ledger, updatedLedger).map((u) => {
                    if (u.gate === 'stars') return { name: u.name, why: t('aar.unlock.stars', { n: starsEarned(updatedLedger) }) };
                    if (u.gate !== 'conduct') return { name: u.name };
                    const was = campaignRoe(ledger)?.mean;
                    const now = campaignRoe(updatedLedger)?.mean;
                    return was === undefined || now === undefined
                      ? { name: u.name }
                      : { name: u.name, why: t('aar.unlock.conduct', { was, now }) };
                  })
                : [];
            const typeName = (id: string): string => units[id as keyof typeof units]?.name ?? id;
            // GH-417 (H5): the after-action report. Its words are
            // `after-action.ts`'s; the log is what this run remembered.
            const report = afterAction({
              result: me.result,
              stars: runtime.stars,
              roe: me.roeRating,
              roeFloor: starRoeFloor(mission.roe?.fail_below),
              ticks: sim.tickCount,
              targetMinutes: (mission as { target_minutes?: number }).target_minutes,
              objectives: runtime.objectiveList.map((o) => ({ id: o.id, text: o.text, primary: o.primary, carries: o.carries, status: o.status })),
              log: missionLog,
              invoice: invoiceLines(deductions, placeNames),
              failure: missionFailure,
              withdrew,
              credits: creditsInfo,
              promotions:
                me.result === 'victory'
                  ? promotionsBetween(ledger['roster.surviving_units'] ?? [], updatedLedger['roster.surviving_units'] ?? [])
                  : [],
              replacements,
              unlocks,
              next: nextMissionId ? { name: nextJson?.name ?? nextMissionId } : undefined,
              campaignOver: campaignComplete(worldData, updatedLedger),
              taken: takenAccount,
              marked: runtime.markedCount,
              typeName,
            });
            const debriefOpts: DebriefOptions = {
              result: me.result,
              stars: runtime.stars,
              report,
              speaker,
              aftermath: undefined,
              tierLine: tier ? { plate: speakerPlate(hudCommander, tier.speaker), text: tier.text } : undefined,
              promotion: promotion
                ? {
                    rank: promotion.rank,
                    stars: promotion.stars,
                    line: promotion.line ? { plate: speakerPlate(hudCommander, promotion.line.speaker), text: promotion.line.text } : undefined,
                  }
                : undefined,
              ...(closing ? { closing: closing.map((l) => ({ plate: speakerPlate(hudCommander, l.speaker), text: l.text })) } : {}),
              ground: field ? { map, tones: opts.terrainTones, marks: field.marks } : undefined,
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
            missionEnded = true;
            if (paused) {
              paused = false;
              audio.setPaused(false);
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
            // PA-11: and the Conduct invoice tutorial beat 9 left open. The
            // HUD closes it on its own 4 Hz rebuild once the result is in;
            // this takes it down on the same frame the moment mounts.
            hud.setInvoiceOpen(false);
            // Task 6: the held victory/defeat moment (`ui/outcome-moment.ts`)
            // goes in front of the end screen, behind the ledger write above
            // -- `writeLedger`/`payMission` already ran (victory only) before
            // this point, so the moment can never delay a write that has
            // already happened, and a player who closes the tab during the
            // hold loses nothing. What it says comes from
            // `outcomeMomentOptions` (`ui/outcome-moment.ts`), the testable
            // half of this handler: the verdict, the mission's own
            // outcome-specific sentence (the same `say` resolved into
            // `debrief` above), and on a victory the mission's `aftermath`,
            // which the HUD banner (suppressed just below) used to be the only
            // thing to draw. The handler is synchronous inside the event loop up to
            // this point, so the moment mounts NOW; `showEndScreen` is
            // deferred to `moment.done`'s `.then()`, guarded by `disposed` the
            // same way the deferred art block guards its own late callbacks
            // (see `bootBattlefield`'s header) -- a player who leaves during
            // the hold has already run this battlefield's teardown, which
            // drains `screenDisposers` (dismissing the still-open moment) and
            // sets `disposed`, so the end screen must not mount on a stage the
            // router has already cleared.
            // One value for both surfaces: the moment previews the
            // `aftermath` for its hold, and the end screen below carries the
            // same one where it can be read (the second correction to ruling 9).
            const momentOptions = outcomeMomentOptions(me.result, mission, creditsInfo, missionFailure);
            const moment = outcomeMoment(document.body, momentOptions);
            // PA-07: the HUD steps back for the beat and stays back under the
            // report; the battlefield's teardown brings it back.
            screenDisposers.push(hideForBeat(document.body, [stage, moment.el]));
            {
              const statusOf = new Map(runtime.objectiveList.map((o) => [o.id, o.status] as const));
              const civilians: { x: number; y: number }[] = [];
              const force: { x: number; y: number }[] = [];
              for (let i = 0; i < sim.entityCount; i++) {
                if (sim.state.alive[i] !== 1) continue;
                const p = { x: fx.toNumber(sim.state.posX[i]), y: fx.toNumber(sim.state.posY[i]) };
                if (unitJson[sim.unitTypes[sim.state.typeIdx[i]].id]?.faction === 'civilian') civilians.push(p);
                else if (sim.state.side[i] === 0) force.push(p);
              }
              beat = {
                t0: performance.now(),
                reduced: prefersReducedMotion(),
                from: { x: renderer.camera.x, y: renderer.camera.y, zoom: renderer.camera.zoom },
                focus: beatFocus({
                  result: me.result,
                  objectives: mission.objectives.map((o) => ({
                    type: o.type,
                    primary: o.primary,
                    status: statusOf.get(o.id) ?? 'active',
                    ...(typeof o.target === 'string' ? { target: o.target } : {}),
                  })),
                  zones: map.zones,
                  civilians,
                  force,
                }),
              };
            }
            // Polish pass F: the verdict is heard. The stinger stops every
            // voice, fades combat and the music under itself, and holds every
            // other cue off; the music comes back at the menu's level.
            audio.playCue(OUTCOME_CUE[me.result]);
            // AU-5: the verdict is the last word -- no bark or call after it.
            voice.hush('outcome');
            audio.setMusicScene('menu');
            // Final review, ruling 9: the moment is the verdict, so the HUD's
            // own "Mission accomplished"/"Mission failed" banner stands down
            // rather than sit behind it and stay up over the end screen after
            // it. Called here, in the same tick's event loop and BEFORE
            // `hud.onTick()` at the end of `runTick`, which is the call that
            // would otherwise put the banner up. The banner's second line, a
            // victory's `aftermath`, did not go with it: the moment carries
            // it now (`outcomeMomentOptions`, the correction to ruling 9).
            hud.suppressEndBanner();
            screenDisposers.push(() => moment.dismiss());
            void moment.done.then(() => {
              beat = null;
            });
            beatThenReport(moment, () => disposed, () => {
              // L-7: the moment hands over straight to the after-action report;
              // the small end panel it used to lead to is folded into the
              // report's verdict and closing word.
              // The ground after the fight, photographed now rather than at
              // the missionEnd event: by the time the moment ends, the renderer
              // has drawn the last tick, so a building that fell on it is rubble.
              let photo: ImageData | null = null;
              if (debriefOpts.ground) {
                try {
                  const shot = renderer.captureGroundAlbedo?.(BRIEFING_GROUND_PX) ?? null;
                  if (shot) photo = new ImageData(flipRows(shot.data, shot.width, shot.height), shot.width, shot.height);
                } catch (err) {
                  console.warn('debrief: the ground photograph failed; the painted ground stays', err);
                }
              }
              // GH-464: "How was that mission?", at most once per mission
              // (`prompt-policy.ts`). Asked is recorded now, so a reload on
              // this screen does not ask twice.
              let prompt: RatingPrompt | null = null;
              if (fb.shown && !feedbackClosed()) {
                const asking = readPromptState(fb.storage, __APP_BUILD__);
                if (shouldAsk(asking, mission.id, { sandbox: false })) {
                  writePromptState(fb.storage, promptAsked(asking, mission.id));
                  prompt = ratingPrompt({
                    send: async (rating, line, o) =>
                      fb.send({ source: 'debrief', category: 'rating', rating, text: line, where: fbWhere() }, { keepalive: o.keepalive }),
                    onAnswered: () => writePromptState(fb.storage, promptAnswered(readPromptState(fb.storage, __APP_BUILD__))),
                    onIgnored: () => writePromptState(fb.storage, promptIgnored(readPromptState(fb.storage, __APP_BUILD__))),
                  });
                }
              }
              screenDisposers.push(
                showDebrief(document.body, {
                  ...debriefOpts,
                  aftermath: momentOptions.aftermath,
                  ground: debriefOpts.ground ? { ...debriefOpts.ground, photo } : undefined,
                  ...(prompt ? { prompt: prompt.el } : {}),
                })
              );
              if (prompt) screenDisposers.push(prompt.dispose);
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
        // Beat 1's camera predicate: how far the view's centre has travelled
        // from where it stood on the tutorial's first tick.
        if (tutCameraStart === null) tutCameraStart = { x: renderer.camera.x, y: renderer.camera.y };
        tut = advance(
          tut,
          {
            kind: 'camera',
            tilesFromStart: Math.hypot(renderer.camera.x - tutCameraStart.x, renderer.camera.y - tutCameraStart.y),
          },
          now
        );
        tut = advance(tut, { kind: 'tick' }, now);
        refreshHudShown();
        // GH-345 beat 9: the beat that reveals Conduct opens its invoice, and
        // it stays open past the last beat (the index clamps to it) until the
        // player clicks Conduct -- it is the last thing the tutorial teaches.
        // Only on a CHANGE, so a player who closes it is not overruled four
        // times a second.
        const invoiceBeat = (tut.steps[Math.min(tut.index, tut.steps.length - 1)]?.reveal ?? []).includes('conduct');
        if (invoiceBeat !== tutInvoiceOpen) {
          tutInvoiceOpen = invoiceBeat;
          hud.setInvoiceOpen(invoiceBeat);
        }
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
          refreshHudShown();
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
    // GH-279: a family breaking for the refuge, said once and with its cause.
    // Here, after BOTH callers of the flight rule have run this tick (the
    // runtime's, inside the mission block above, and the sandbox's just
    // before this), so the suppression recorded now is the suppression the
    // rule saw -- `CivFlightWatch` reads the cause one observation back.
    // Read-only: `sim.state` in, a feed line out (invariant 4).
    //
    // Skipped once the watch is idle -- every civilian latched or dead, no line
    // waiting -- and nothing new has been spawned since: only a new entity can
    // wake it, and without this a finished evacuation built one observation
    // per civilian per tick for the rest of the mission.
    if (civWatch && refugeAt && !(civWatch.idle && sim.entityCount === civWatchSeen)) {
      civWatchSeen = sim.entityCount;
      const st = sim.state;
      const civs: CivObservation[] = [];
      for (let i = 0; i < sim.entityCount; i++) {
        if (st.side[i] !== 2) continue;
        civs.push({
          id: i,
          alive: st.alive[i] === 1,
          buried: st.tunnelIn[i] >= 0,
          moving: st.moving[i] === 1,
          carried: st.carriedBy[i] >= 0,
          suppressed: st.suppression[i] > CIV_FLEE_AT,
          x: fx.toNumber(st.posX[i]),
          y: fx.toNumber(st.posY[i]),
        });
      }
      const flight = civWatch.observe(civs, sim.tickCount);
      if (flight) {
        // The feed line; the minimap flash on where they broke and where they
        // are going; and the refuge ring, once per LINE, not per family
        // (`ui/refuge-ping.ts`). The jump key takes where they broke, the way
        // every other alert's does.
        // A family running is important: it is the evacuation the mission is
        // scored on, and the jump key should take the player there.
        const fled = sayFlight(
          flight,
          refugeAt,
          {
            note: (line) => hud.note(...alertNotice(line), { tier: 'important' }),
            flash: (points, nowMs) => minimap.flash(points, nowMs, { tier: 'important', tone: flight.line.tone }),
            ping: (x, y) => renderer.pingRefuge?.(x, y),
          },
          performance.now()
        );
        jumpTarget = nextJump(jumpTarget, 'important', fled);
      }
    }
    // GH-345: the surfaces main.ts owns follow the same set the Hud reads in
    // its own onTick. Every tick, for the same reason: a beat's reveal lands
    // on the tick it opens.
    minimap.setShown(isShown('minimap'));
    production?.setShown(isShown('dock'));
    groupsBar.el.toggleAttribute('data-hud-hidden', !isShown('groups'));
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
    // GH-469: a queued build is the cue to decode that type's textures -- at
    // least 12 s of sim time before the unit exists (`warmUnitMesh`).
    // Idempotent; a warm type returns at once.
    if (runtime) for (const p of runtime.production) three.warmUnitMesh(p.unit);
    if (sim.tickCount % TICKS_PER_SECOND === 0) {
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
    // PR 361: a deadline that loses the mission warns once, a minute out,
    // with the alert chime the feed's other warnings use. GH-110 adds its
    // announcement (caption now, audio once recorded).
    if (runtime && runtime.result === 'ongoing' && sim.tickCount % 5 === 0) {
      const due = deadlineWarnings(liveObjectives(), deadlinesWarned);
      deadlinesWarned = due.warned;
      for (const row of due.warn) {
        hud.note(escapeHtml(deadlineWarningLine(row)), 'warn');
        audio.playCue(ALERT_CUE.important);
        voice.onMission([], [{ event: 'deadline', params: { label: row.text } }]);
      }
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
    if (tut && tut.index !== telemetryTutIndex) {
      telemetryTutIndex = tut.index;
      if (tut.index < tut.steps.length) telemetry().tutorialStep(tut.index, tut.steps.length, tut.steps[tut.index]?.id);
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

      /** Every voiced decision this battlefield made, and the mixer's own
       *  voice stats (WP-AU1 R-10). Read back, never recomputed: the log is
       *  the runtime's ring and the stats are what the MIXER holds, so a
       *  wiring fault shows here rather than agreeing with the logic. */
      voiceLog: () => ({ entries: voice.log(), stats: audio.voiceStats() }),

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
          // The building whose wall this pixel shows (PA-14), which an order
          // here resolves to instead of `landed`; -1 on open ground.
          facade: renderer.structureAtScreen(lastCursor.x, lastCursor.y),
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
  // One read of the pointer for the cursor AND the click (input/pointer.ts):
  // the ground point, the enemy under it, and -- PA-14 -- the building whose
  // wall the pixel shows, which an order resolves to instead of the hidden
  // ground behind it. `hw` is that order point; `pp.ground` stays the
  // ground, for the friendly hover below, which is about units, not orders.
  const pp = pointerPoint(renderer, sim, lastCursor.x, lastCursor.y);
  const hw = { x: pp.x, y: pp.y };
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

  // Nearest living enemy within half a tile of the cursor's GROUND point,
  // fog-gated -- `hostileUnder`'s own comment has the rule.
  const he = pp.hostile;
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
    const dx = ex - pp.ground.x;
    const dy = ey - pp.ground.y;
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
  // GH-345: what the fire panel says about this hover -- the same word
  // (`fireState`) the panel's own wording is chosen by, so "hover the one in
  // cover" is satisfied by exactly the hover the panel calls cover.
  const projection =
    tut && he >= 0
      ? fireState(
          renderer.selection
            .filter((i) => sim.state.side[i] === 0 && sim.state.alive[i] === 1)
            .map((i) => sim.projectHit(i, he))
        )
      : null;
  if (tut && (he !== lastHoverEntity || hs !== lastHoverStructure || projection !== lastHoverProjection)) {
    lastHoverEntity = he;
    lastHoverStructure = hs;
    lastHoverProjection = projection;
    tut = advance(
      tut,
      { kind: 'hover', entity: he, structure: hs, sideOf: (e) => sim.state.side[e], projection },
      performance.now()
    );
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
  // adapter (intentWorld) at the same point (`pp`) -- so the click and the
  // cursor that predicts it can never give different answers. `cursorAt`
  // (input/pointer.ts) is also what pointer.test.ts reads at a fixed pixel.
  const mine = renderer.selection.filter((i) => sim.state.side[i] === 0 && sim.state.alive[i] === 1);
  const { name, key } = cursorAt(sim, intentWorld, pp, {
    ids: mine,
    armed: armedSupport,
    confirm: altHeld,
    armedSmoke: armedOrder === 'smoke',
  });
  hoverCursorName = name;
  // Guard the write: a dataset attribute set every frame forces needless
  // style invalidation even when the cursor hasn't changed.
  if (key !== lastCursorKey) {
    canvas.dataset.cursor = key;
    lastCursorKey = key;
  }
  // Keyed on `name` (the bare verb), not `key`: a badge change alone --
  // `advance` to `advance-kamikaze` from a selection change while still
  // hovering the same target -- must not restart the pulse, only a change
  // of *which* animation (or none) should be running does.
  cursorAnim.show(name);
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
  // prevX == curX already holds the force's real starting positions: for a
  // sandbox, from `renderer.init()`'s own seeding, which ran after
  // `sandboxSpawns`; for a mission, from `startMission`'s `renderer.reseed()`
  // (`mission-start.ts`), because on that path `init()` ran before the
  // runtime existed and seeded from an empty sim.
  // Alpha is irrelevant here as a result, but `1` matches `__lions.step()`'s own
  // call for the same reason: on a still frame, prevX + (curX - prevX) * alpha
  // reduces to curX regardless.
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
    // PA-07: the held beat holds the accumulator (the mission has ended) and
    // eases the PRESENTATION clock alone; the sim is neither slowed nor
    // ticked by it.
    const now = performance.now();
    const pose = beat ? beatPose(now - beat.t0, beat.reduced) : null;
    const { ticks, frameMs } = advanceClock(clock, now, gameSpeed, paused || beat !== null, MS_PER_TICK);
    lastFrameMs = frameMs;
    for (let i = 0; i < ticks; i++) runTick();
    // Read live off the settings store, not snapshotted at boot: `set()`
    // reaches every open battlefield the moment the player changes it,
    // pause menu included (Task 6) -- `get()` is a plain getter, so this
    // costs nothing extra per frame.
    // `keys` holds PHYSICAL keys (Task 5 fix round 1) -- W and the physical
    // Up arrow are two different keys that both mean `panUp`, so `held`
    // asks whether ANY held key currently resolves to that action rather
    // than testing one fixed spelling. Holding W and ArrowUp together and
    // releasing only one keeps the camera panning.
    const held = (action: 'panUp' | 'panDown' | 'panLeft' | 'panRight'): boolean =>
      heldAction(bindings, keys, action);
    // The pan INTENT, in screen directions: keys and edge pan add, and
    // `stepPan` clamps and normalises the sum, so the two never disagree
    // about how fast the camera moves, only about what starts it moving.
    const intent: PanVelocity = { right: 0, down: 0 };
    if (held('panUp')) intent.down -= 1;
    if (held('panDown')) intent.down += 1;
    if (held('panLeft')) intent.right -= 1;
    if (held('panRight')) intent.right += 1;
    // Edge pan: gated on its own setting (default off -- see settings.ts) AND
    // the pointer actually being over the canvas AND the window holding
    // focus, so a player reaching for the minimap or the dock never finds the
    // map scrolling under them.
    if (req.settings.get().controls.edgePan && pointerInside) {
      const e = edgeVector(lastCursor.x, lastCursor.y, canvas.clientWidth, canvas.clientHeight, EDGE_MARGIN_PX);
      intent.right += e.right;
      intent.down += e.down;
    }
    // Time-based and eased (WP-P1, PA-03): tiles a SECOND from the frame's own
    // elapsed time, ramping up and down, where it used to be 0.5 tiles a
    // FRAME -- twice as fast on a 120 Hz display, and instant on and off.
    // `frameMs` is the wall-clock frame, not sim time: the camera pans in a
    // pause and at every game speed. The camera speed setting is read live,
    // pause menu included (Task 6).
    if (intent.right !== 0 || intent.down !== 0 || panning(panVel)) {
      const d = stepPan(panVel, intent, frameMs, req.settings.get().controls.cameraSpeed, renderer.camera.zoom);
      renderer.camera.x += d.dx;
      renderer.camera.y += d.dy;
      // Pushing into an edge just stops there: the velocity left over points
      // INTO the wall and dies in its own 90 ms, so nothing slides back out.
      keepOnMap();
    }
    // A wheel zoom's glide (~150 ms, eased on elapsed time like the pan). The
    // outcome beat owns the camera while it runs, so a glide in flight is
    // dropped rather than fought with.
    if (zoomGlide !== null) {
      if (beat) {
        zoomGlide = null;
      } else {
        const g = stepZoomGlide(zoomGlide, frameMs);
        applyZoom(g.zoom);
        if (g.done) zoomGlide = null;
      }
    }
    if (beat && pose && beat.focus) {
      const c = beatCamera(beat.from, beat.focus, pose.camera);
      renderer.camera.x = c.x;
      renderer.camera.y = c.y;
      renderer.camera.zoom = c.zoom;
    }
    renderer.frame(clock.acc / MS_PER_TICK, lastFrameMs * (pose?.timeScale ?? 1));

    updateHover();
  };
  rafId = requestAnimationFrame(loop);
  // The load-bearing line of this whole teardown, and the one the route walk
  // is calibrated against: without it the loop re-requests itself forever,
  // ticking the sim and asking a disposed renderer for frames from behind
  // whatever screen the player went to. `pnpm ui:routes` was run with exactly
  // this line commented out and fails on its tick counter -- the left
  // mission's sim read 140 then 146 over 1200 ms (2473f688) -- which is what
  // makes its green run evidence rather than an assumption. Not on console
  // errors: `ThreeRenderer.frame()` refuses once disposed, so the draws are
  // silent and the ticks are the only symptom.
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
  const stage = document.getElementById('stage');
  if (stage) {
    // t() is safe even here, before main()'s own locale boot: the module
    // starts on the bundled `en` catalogue (`i18n/t.ts`), so a failure that
    // early still reads in English rather than as raw keys.
    bootFailure(stage, err);
  } else {
    console.error('boot failed:', err);
  }
});
