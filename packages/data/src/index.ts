// @lions/data — typed access to game content JSON.
// Leaf package: imports no other @lions package (enforced by lint).
// Content JSON lives at repo-root data/ — the path CONTRIBUTING.md, the
// Python validators, and the art pipeline all reference.

import palette from '../../../data/palette.json';
import audioManifest from '../../../data/audio.json';
import videoManifest from '../../../data/video.json';
import worldJson from '../../../data/campaign/world.json';
import countriesJson from '../../../data/campaign/countries.json';
import commanderJson from '../../../data/campaign/commander.json';
import namesJson from '../../../data/campaign/names.json';
import kdfDoctrine from '../../../data/doctrines/kdf.json';
import sarimDoctrine from '../../../data/doctrines/sarim.json';
import rujmSawdaVersus from '../../../data/versus/rujm_sawda.json';
import telMarumVersus from '../../../data/versus/tel_marum.json';
import wadiTarfanVersus from '../../../data/versus/wadi_tarfan.json';
import wadiTarfanLVersus from '../../../data/versus/wadi_tarfan_l.json';
import milhFlatsLVersus from '../../../data/versus/milh_flats_l.json';
import beitSahwanOutskirtsModes from '../../../data/versus/modes/beit_sahwan_outskirts.json';
import milhFlatsLModes from '../../../data/versus/modes/milh_flats_l.json';
import milhFlatsModes from '../../../data/versus/modes/milh_flats.json';
import rujmSawdaModes from '../../../data/versus/modes/rujm_sawda.json';
import telMarumModes from '../../../data/versus/modes/tel_marum.json';
import wadiTarfanLModes from '../../../data/versus/modes/wadi_tarfan_l.json';
import wadiTarfanModes from '../../../data/versus/modes/wadi_tarfan.json';
// GH-859 P1a: the combat formations, registered in sorted directory order.
import formationAmbush from '../../../data/formations/ambush.json';
import formationAttack from '../../../data/formations/attack.json';
import formationColumn from '../../../data/formations/column.json';
// GH-1360 S3a: starting layouts live in data/layouts/, a different directory, and are NEVER in `formations` (the HUD picker).
import layoutAssembly from '../../../data/layouts/assembly.json';
// Look uplift L2 (GH-943): the colour grades, one file per shipped time of day. Day is the identity and has no file.
import gradeDawn from '../../../data/grades/dawn.json';
import gradeDusk from '../../../data/grades/dusk.json';
import type { DoctrineJson, VersusModeFileJson, VersusRulesJson } from './versus';
import structureCatalogue from '../../../data/structures.json';
import couponsJson from '../../../data/coupons.json';
import minWinSecondsJson from '../../../data/accounts/min_win_seconds.json';
import tutorialBeitSahwan0 from '../../../data/tutorial/beit_sahwan_0.json';
import firstUseHintsJson from '../../../data/hints/first_use.json';

import mbtLavi from '../../../data/units/kdf/mbt_lavi.json';
import ifvNamer from '../../../data/units/kdf/ifv_namer.json';
import apcEitan from '../../../data/units/kdf/apc_eitan.json';
import infSquad from '../../../data/units/kdf/inf_squad.json';
import atTeam from '../../../data/units/kdf/at_team.json';
import mortarTeam from '../../../data/units/kdf/mortar_team.json';
import reconDrone from '../../../data/units/kdf/recon_drone.json';
import demoSquad from '../../../data/units/kdf/demo_squad.json';
import attackDrone from '../../../data/units/kdf/attack_drone.json';
import sniperTeam from '../../../data/units/kdf/sniper_team.json';
import jeepShoded from '../../../data/units/kdf/jeep_shoded.json';
import dozerD9 from '../../../data/units/kdf/dozer_d9.json';
import heliPeten from '../../../data/units/kdf/heli_peten.json';
import yahalomSquad from '../../../data/units/kdf/yahalom_squad.json';
// The three star-gated units (docs/campaign/special_units/design.md):
// `unlock.stars_min` opens each on the campaign's earned-stars total rather
// than the ROE rating the units above gate on.
import breachTeam from '../../../data/units/kdf/breach_team.json';
import scoutShachaf from '../../../data/units/kdf/scout_shachaf.json';
import apcKipod from '../../../data/units/kdf/apc_kipod.json';
// E5 bought-only special forces (GH-181): `unlock` is `{ price }` alone, credits, no star gate.
import reconZikit from '../../../data/units/kdf/recon_zikit.json';
import heliPetenGunship from '../../../data/units/kdf/heli_peten_gunship.json';
// GH-698: the UH-60 Yanshuf, an air carrier (role apc, air domain). Conduct 84 / 500 credits.
import heliYanshuf from '../../../data/units/kdf/heli_yanshuf.json';
// GH-709 special units, credit-only like E5 (`unlock` is `{ price }` alone). Phase 2: the
// Lavi Ambush Tank and the Te'o Howitzer.
import mbtLaviCamo from '../../../data/units/kdf/mbt_lavi_camo.json';
import spgLongRange from '../../../data/units/kdf/spg_long_range.json';
// Phase 8: the Chadaf Recon Robot, a four-legged walker (role drone, ground domain, foot).
import ugvReconDog from '../../../data/units/kdf/ugv_recon_dog.json';
// GH-709 Phase 7: the Te'o Cluster Howitzer (E2 indirect + E3 submunitions, landed GH-733).
import spgCluster from '../../../data/units/kdf/spg_cluster.json';
// GH-709 Phase 7: the Zaron Missile Team.
import atNlosTeam from '../../../data/units/kdf/at_nlos_team.json';
// Phase 3: the Chomet Grenadier Squad.
import infGrenadier from '../../../data/units/kdf/inf_grenadier.json';
// GH-274 (closes GH-156): the Shiryonan Demolition Carrier, bought-only, with its placed charge.
import demoTzav from '../../../data/units/kdf/demo_tzav.json';
import militiaCell from '../../../data/units/enemy/militia_cell.json';
import rpgTeam from '../../../data/units/enemy/rpg_team.json';
import atgmCell from '../../../data/units/enemy/atgm_cell.json';
import technical from '../../../data/units/enemy/technical.json';
import mortarCrew from '../../../data/units/enemy/mortar_crew.json';
import gunTruck from '../../../data/units/enemy/gun_truck.json';
import motoRpg from '../../../data/units/enemy/moto_rpg.json';
import chargeSquad from '../../../data/units/enemy/charge_squad.json';
import paramotor from '../../../data/units/enemy/paramotor.json';
import loiterDrone from '../../../data/units/enemy/loiter_drone.json';
// E6 (GH-274) chunk A1: the Sarim swarm, one entity standing for twelve drones.
import droneSwarm from '../../../data/units/enemy/drone_swarm.json';
// E6 (GH-274) chunk A2: the Remetz Laser Carrier, the first unit with a `directed_energy` beam.
import aaRemetz from '../../../data/units/kdf/aa_remetz.json';
import diggerCrew from '../../../data/units/enemy/digger_crew.json';
import rocketBattery from '../../../data/units/enemy/rocket_battery.json';
import sarimRifles from '../../../data/units/enemy/sarim_rifles.json';
import manpadTeam from '../../../data/units/enemy/manpad_team.json';
import recoillessTeam from '../../../data/units/enemy/recoilless_team.json';
import civilians from '../../../data/units/civilians.json';
// GH-707 P2: the wounded, role `wounded`. Not buildable, in no store; a casualty the sim makes.
import woundedKdf from '../../../data/units/kdf/wounded_kdf.json';
import woundedSarim from '../../../data/units/enemy/wounded_sarim.json';
// GH-709 / GH-707 P2: the armoured ambulance and the medevac, both `can_carry: ['wounded']`.
// GH-707 P2: the Nemala Medic Team (`rescue` block: it treats and carries the wounded).
import infMedicSquad from '../../../data/units/kdf/inf_medic_squad.json';
import vehAmbulance from '../../../data/units/kdf/veh_ambulance.json';
import airMedevacHeli from '../../../data/units/kdf/air_medevac_heli.json';

import catastrophicKill from '../../../data/vfx/catastrophic_kill.json';
import fireApfsds from '../../../data/vfx/fire_apfsds.json';
import fireAutocannon from '../../../data/vfx/fire_autocannon.json';
import fireHeat from '../../../data/vfx/fire_heat.json';
import rpgBackblast from '../../../data/vfx/rpg_backblast.json';
import fireHmg from '../../../data/vfx/fire_hmg.json';
import fireMissile from '../../../data/vfx/fire_missile.json';
import fireMortar from '../../../data/vfx/fire_mortar.json';
import mortarBaseDust from '../../../data/vfx/mortar_base_dust.json';
import fireSmallArms from '../../../data/vfx/fire_small_arms.json';
import missileImpact from '../../../data/vfx/missile_impact.json';
import missileTrail from '../../../data/vfx/missile_trail.json';
import rocketTrail from '../../../data/vfx/rocket_trail.json';
import shellImpact from '../../../data/vfx/shell_impact.json';
import clusterAirburst from '../../../data/vfx/cluster_airburst.json';
import barrageImpact from '../../../data/vfx/barrage_impact.json';
import airStrikeImpact from '../../../data/vfx/air_strike_impact.json';
import structureBurning from '../../../data/vfx/structure_burning.json';
import structureCollapse from '../../../data/vfx/structure_collapse.json';
import collapseFlash from '../../../data/vfx/collapse_flash.json';
import tunnelCollapse from '../../../data/vfx/tunnel_collapse.json';
import rotorWash from '../../../data/vfx/rotor_wash.json';
import vehicleDust from '../../../data/vfx/vehicle_dust.json';
import vehicleMud from '../../../data/vfx/vehicle_mud.json';
import vehicleClods from '../../../data/vfx/vehicle_clods.json';
import vehicleExhaust from '../../../data/vfx/vehicle_exhaust.json';
import vehicleDamagedSmoke from '../../../data/vfx/vehicle_damaged_smoke.json';
import gunOutPuff from '../../../data/vfx/gun_out_puff.json';
import gunOutFire from '../../../data/vfx/gun_out_fire.json';
import armorRicochet from '../../../data/vfx/armor_ricochet.json';
import armorPenetration from '../../../data/vfx/armor_penetration.json';
import wreckSmoulder from '../../../data/vfx/wreck_smoulder.json';
import apsLaunch from '../../../data/vfx/aps_launch.json';
import demolitionBlast from '../../../data/vfx/demolition_blast.json';
// GH-1197 P3: masonry dust at a building's hit face, spawned by name on an explosive direct-fire hit.
import buildingHitDust from '../../../data/vfx/building_hit_dust.json';
import smokeDischarge from '../../../data/vfx/smoke_discharge.json';
// E6 (GH-274) chunk B: a swarm member shot down, thrown by id where it was hit.
import swarmMemberDown from '../../../data/vfx/swarm_member_down.json';
// E6 (GH-274) chunk C: the laser carrier's beam. `beam_strike` where a dwell completed, `beam_vent` on a lockout.
import beamStrike from '../../../data/vfx/beam_strike.json';
import beamVent from '../../../data/vfx/beam_vent.json';
// GH-1197: the munition-class table (not an emitter; `vfx_munitions.schema.json`).
import munitions from '../../../data/vfx/munitions.json';

// The scene-host diorama (2026-09-24-scene-host §3.2/§10): a real map, a
// camera and a few idle units, standing behind the main menu. One file, one
// export -- unlike maps/missions/units it is not a directory of many.
import menuDioramaJson from '../../../data/front/menu_diorama.json';

export { palette };
export type Palette = typeof palette;

/** Battle audio manifest — clips are served from assets/audio/. */
export { audioManifest };

/** Provenance for every shipped cinematic under `assets/video/`
 *  (`data/video.json`). The data gate holds it to the directory both ways --
 *  a file with no entry and an entry with no file both fail `validate:data` --
 *  so an entry here IS a shipped file, and the app plays only what this lists
 *  (`ui/cinematics-model.ts`). */
export { videoManifest };

export {
  parseMap,
  applyTerrain,
  roadMaskOf,
  DECOR,
  STRUCTURE_SYMBOLS,
  TERRAIN_LEGEND,
  THEME_SYMBOLS,
  WIND_SKEW_MAX_DEG,
  WIND_STRENGTH_MAX,
  type MapJson,
  type MapWind,
  type ParsedMap,
  type DecorKind,
  type TerrainCell,
  type TerrainSink,
  type TerrainTheme,
  type GroveSpecies,
} from './map';

/** Brigade economy step 3 (spec 2026-09-15 §4.3): patches a unit's JSON
 *  with its bought upgrade tiers before @lions/sim registers the type. */
export {
  applyUpgrades,
  kitCounts,
  kitLevel,
  maxTiers,
  nextTierPrice,
  readPath,
  UPGRADE_PATHS,
  type KitCounts,
  type KitLevel,
  type UpgradableUnit,
  type UpgradeTier,
  type UpgradeTrack,
  type UpgradeTracks,
} from './upgrades';

/** GH-1394/GH-1395: the one pure pre-pass over a mission's JSON (difficulty postures, then amendments),
 *  run before the runtime is built so the sim never learns a posture exists. */
export {
  applyOverlays,
  applyOps,
  postureOf,
  postureOps,
  postureApplies,
  postures,
  reliefTriggerIndices,
  POSTURE_IDS,
  DIFFICULTY_LEDGER_KEY,
  RELIEF_TRIGGER_ID,
  type OverlayOp,
  type OverlayChoice,
  type OverlayMission,
  type OverlayOptions,
  type OverlayWave,
  type PostureId,
  type PostureJson,
  type PostureCatalogue,
  FAIL_BELOW_CEILING,
} from './overlays';

/** GH-1395: amendments to the orders and the named challenge (slice 1, no UI): the library, the six-mission pilot,
 *  the challenge index the coin rules share, and the pure predicate. */
export {
  amendments,
  amendmentOps,
  betterMark,
  challengeArmed,
  challengeMet,
  challengeOf,
  missionChallenges,
  TICKS_PER_TARGET_MINUTE,
  type AmendmentCatalogue,
  type AmendmentJson,
  type ChallengeMark,
  type ChallengeRun,
  type ChallengeWin,
  type MissionChallengeJson,
} from './challenges';
// The coin rules' index and the ledger key, from their own module so @lions/economy (on the entry chunk) never pulls
// the catalogue's JSON in (the posture-ids.ts arrangement).
export { CHALLENGE_LEDGER_KEY, challengeMissionIds, hasChallenge } from './challenge-ids';

export {
  versusMissionOf,
  versusCapacityOf,
  versusCapMinutesOf,
  VERSUS_CAP_MINUTES_DEFAULT,
  VERSUS_CAP_MINUTES_MIN,
  VERSUS_CAP_MINUTES_MAX,
  VERSUS_CAPACITY_DEFAULT,
  VERSUS_CAPACITY_MIN,
  VERSUS_CAPACITY_MAX,
  versusTunnelsOf,
  versusZonesOf,
  versusModeMissionOf,
  campYardZone,
  flagZone,
  WIN_MODES,
  SETUP_KIT_PIECES,
  SETUP_KIT,
  SETUP_SECONDS,
  FLAG_SETUP_CAP_MINUTES,
  FLAG_BACKSTOP_MINUTES,
  SETUP_BAND_TILES_48,
  SETUP_BAND_TILES_LARGE,
  setupRegionOf,
  setupLineOf,
  flagBlockOf,
  type SetupKitPiece,
  type FlagSetupJson,
  type WinModeId,
  type VersusModeFileJson,
  type VersusModeMissionJson,
  type VersusModeObjectiveJson,
  type PointsZoneJson,
  type DoctrineJson,
  type VersusEndJson,
  type VersusMissionJson,
  type VersusRulesJson,
  type VersusTunnelJson,
  type VersusTunnelRoute,
} from './versus';

/** Skirmish doctrines (N3, LD2/LD3), keyed by faction: what a seat may build and its start
 *  purse. data/doctrines/*.json against doctrine.schema.json. */
export const doctrines: Readonly<Record<'kdf' | 'sarim', DoctrineJson>> = {
  kdf: kdfDoctrine as DoctrineJson,
  sarim: sarimDoctrine as DoctrineJson,
};

/** Versus rules files (N3 Task 1), keyed by map id: each faction-matchup map's camps and
 *  income zones. data/versus/*.json against versus_rules.schema.json. */
export const versusRules: Readonly<Record<string, VersusRulesJson>> = {
  milh_flats_l: milhFlatsLVersus as unknown as VersusRulesJson,
  rujm_sawda: rujmSawdaVersus as unknown as VersusRulesJson,
  tel_marum: telMarumVersus as unknown as VersusRulesJson,
  wadi_tarfan: wadiTarfanVersus as unknown as VersusRulesJson,
  wadi_tarfan_l: wadiTarfanLVersus as unknown as VersusRulesJson,
};

/** Versus WIN-MODE files (GH-976), keyed by map id: the camps and the points race a room that picks a mode
 *  plays. data/versus/modes/*.json against versus_mode.schema.json. Hand-kept, so `index.test.ts` pins it to
 *  the directory: an unregistered file would be a mode no room can reach. */
export const versusModes: Readonly<Record<string, VersusModeFileJson>> = {
  beit_sahwan_outskirts: beitSahwanOutskirtsModes as unknown as VersusModeFileJson,
  milh_flats: milhFlatsModes as unknown as VersusModeFileJson,
  milh_flats_l: milhFlatsLModes as unknown as VersusModeFileJson,
  rujm_sawda: rujmSawdaModes as unknown as VersusModeFileJson,
  tel_marum: telMarumModes as unknown as VersusModeFileJson,
  wadi_tarfan: wadiTarfanModes as unknown as VersusModeFileJson,
  wadi_tarfan_l: wadiTarfanLModes as unknown as VersusModeFileJson,
};

/** Combat formations (GH-859 P1a): data/formations/*.json against formation.schema.json, in
 *  sorted directory order. Hand-kept, so `index.test.ts` pins it to the directory: an
 *  unregistered file would be silently unorderable. The sim's `addFormationType` compiles each. */
export const formations = [formationAmbush, formationAttack, formationColumn] as const;

/** The starting-force layouts (GH-1360 S3a): data/layouts/*.json, written in formation.schema.json's vocabulary and compiled
 *  by the sim's `compileFormation`, but never registered with the sim (`addFormationType`) and never in `formations`, so
 *  they never reach the HUD picker. `index.test.ts` pins this array to its directory. */
export const layouts = [layoutAssembly] as const;

/** The assembly layout: vehicles in the front rank, infantry behind, support weapons, medics and drones at the rear. */
export const assemblyLayout = layoutAssembly;

// Avatar presets (GH-1075 P1): the catalogue, the frozen default pool, the shared default rule.
export { avatarPresets, defaultAvatarPool, defaultAvatar, resolveAvatar, isAvatarPreset, fnv1a32, LAST_RESORT_AVATAR } from './avatar';
export type { AvatarPreset, AvatarView, AvatarInput } from './avatar';

/** Colour grades (look uplift L2, GH-943): data/grades/*.json against grade.schema.json, in sorted
 *  directory order. Hand-kept, so `index.test.ts` pins it to the directory: an unregistered file
 *  would be silently inert. The renderer bakes the one the app picks (`gradeOf`) into a 32^3 LUT. */
export const grades = [gradeDawn, gradeDusk] as const;

/** Building types, keyed by id. Shapes match structure.schema.json. */
export const structures = structureCatalogue.types;
export type StructureId = keyof typeof structures;

/** Brigade coupons (hashed codes; see coupons.schema.json). */
/**
 * GH-1075 A2: the win floor, one non-negative integer per world mission: floor(fastest 30-seed scripted win / 4), generated by
 * `pnpm playtest -- --min-win` (Lead decision 9: a quarter, so a player at 2x speed keeps a factor of 2). A mission not named has floor 0.
 */
export const minWinSeconds: Readonly<Record<string, number>> = minWinSecondsJson.min_win_seconds;

export const coupons: readonly { id: string; sha256: string; credits?: number; coins?: number }[] = couponsJson.coupons;

/** The SYNCHRONOUS content manifest (B6-6): every map's name, and per mission the few fields the shell reads before one is
 *  chosen. GENERATED from data/ by `pnpm content:manifest -- --write` (`validate:data` fails on drift). The JSON itself is no
 *  longer here: the app loads a map or a mission by id through `@lions/data/content-lazy`, and Node (tools, tests, the sim
 *  harnesses) reads every one synchronously from `@lions/data/content`'s `maps` and `missions`. */
export { mapManifest, missionManifest, type MapId, type MapSummary, type MissionId, type MissionSummary } from './content-manifest';

/** The campaign world. Shape matches world.schema.json; parsed by app/src/campaign.ts. */
export const world = worldJson;

/** Generated country geometry for the world render. Shape matches
 *  countries.schema.json; parsed by app/src/campaign.ts. */
export const countries = countriesJson;

/** The chain of command (GDD §11): the two named voices behind `say` and
 *  Shai's rank per campaign span. Shape matches commander.schema.json;
 *  parsed by app/src/campaign.ts (`parseCommander`). */
export const commander = commanderJson;

/** The screened tables units are named from (spec §4.7): squads, vehicles and
 *  task units, plus the `kinds` block that sorts a unit type into one of the
 *  three. Shape matches `@lions/app`'s `NamesJson`; the app assigns names,
 *  never the sim. */
export const names = namesJson;

/** Tutorial step lists, keyed by id. Shapes match tutorial.schema.json.
 *
 *  Read by @lions/app only. A step's gate may test player input, which the sim
 *  does not know about — putting these in the mission runtime would mean
 *  pushing selection state into @lions/sim.
 */
export const tutorials = {
  beit_sahwan_0: tutorialBeitSahwan0,
} as const;

export type TutorialId = keyof typeof tutorials;

/** One first-use hint rule. Shape matches first_use_hints.schema.json. */
export interface FirstUseHintRule {
  id: string;
  key: string;
  keys?: Record<string, string>;
  mission?: string[];
  selected_type?: string[];
  selected_over?: number;
  force_over?: number;
  carrier_empty_seat?: true;
  enemy_pinned?: true;
  resources?: true;
  income_held?: true;
}

/** The one-line hints for lessons the tutorial no longer teaches (GH-345
 *  follow-up). Read by @lions/app only; the sim never sees them. */
export const firstUseHints: readonly FirstUseHintRule[] = firstUseHintsJson.rules as readonly FirstUseHintRule[];

/** The full unit roster, keyed by unit id. Shapes match unit.schema.json. */
export const units = {
  mbt_lavi: mbtLavi,
  ifv_namer: ifvNamer,
  apc_eitan: apcEitan,
  inf_squad: infSquad,
  at_team: atTeam,
  mortar_team: mortarTeam,
  recon_drone: reconDrone,
  demo_squad: demoSquad,
  attack_drone: attackDrone,
  sniper_team: sniperTeam,
  jeep_shoded: jeepShoded,
  dozer_d9: dozerD9,
  heli_peten: heliPeten,
  yahalom_squad: yahalomSquad,
  breach_team: breachTeam,
  scout_shachaf: scoutShachaf,
  apc_kipod: apcKipod,
  recon_zikit: reconZikit,
  heli_peten_gunship: heliPetenGunship,
  militia_cell: militiaCell,
  rpg_team: rpgTeam,
  atgm_cell: atgmCell,
  technical: technical,
  mortar_crew: mortarCrew,
  gun_truck: gunTruck,
  moto_rpg: motoRpg,
  charge_squad: chargeSquad,
  paramotor: paramotor,
  loiter_drone: loiterDrone,
  digger_crew: diggerCrew,
  rocket_battery: rocketBattery,
  sarim_rifles: sarimRifles,
  manpad_team: manpadTeam,
  recoilless_team: recoillessTeam,
  civilians: civilians,
  heli_yanshuf: heliYanshuf,
  wounded_kdf: woundedKdf,
  wounded_sarim: woundedSarim,
  inf_medic_squad: infMedicSquad,
  veh_ambulance: vehAmbulance,
  air_medevac_heli: airMedevacHeli,
  mbt_lavi_camo: mbtLaviCamo,
  spg_long_range: spgLongRange,
  ugv_recon_dog: ugvReconDog,
  spg_cluster: spgCluster,
  at_nlos_team: atNlosTeam,
  inf_grenadier: infGrenadier,
  // E6 (GH-274) chunk A1, registered last so no earlier type index moves.
  drone_swarm: droneSwarm,
  // E6 chunk A2, registered after it so no earlier type index moves.
  aa_remetz: aaRemetz,
  // GH-274 (closes GH-156), registered last so no earlier type index moves.
  demo_tzav: demoTzav,
} as const;

export type UnitId = keyof typeof units;

/**
 * A scene-host diorama: which map, where the camera looks, who stands where
 * (each at a tile's own coordinate, facing in degrees the way a mission
 * placement's `facing_deg` does), and which photographed plate stands in for
 * it before the real render arrives. Shape matches
 * `data/schemas/diorama.schema.json`.
 */
export interface DioramaJson {
  id: string;
  map: string;
  camera: { at: [number, number]; zoom_at_1080p: number };
  units: { unit: string; at: [number, number]; facing_deg?: number }[];
  plate: string;
}

/** The main menu's own diorama. The cast narrows plain `number[]` tuples read
 *  back off JSON to `DioramaJson`'s `[number, number]`s; `tsc` still rejects
 *  the object if a required field goes missing. */
export const menuDiorama: DioramaJson = menuDioramaJson as DioramaJson;

/** Every emitter the renderer may need.
 *
 * Weapon-fire ones are indexed by weapon class; the `ambient_idle` ones
 * (`vehicle_exhaust`, `structure_burning`) are looked up by
 * name, because idling is not a sim event and must not become one.
 * `structure_collapse` is looked up by name too, off the `structureDestroyed`
 * event — the sim says a building fell, the renderer decides what that looks
 * like. `tunnel_collapse` follows the same arrangement off `tunnelCollapsed`,
 * aimed at the route's vent. `vehicle_dust` is the same "renderer decides,
 * no sim event" arrangement as the ambient pair, but keyed off the
 * renderer's own measured ground speed instead of a clip phase — see
 * `three/units/vehicle-fx.ts`'s top comment. Three-only: `renderer.ts` never
 * looks either vehicle emitter up, by design (VFX now live in three; see
 * CLAUDE.md's "VFX are exempt from this diff as of 2026-08-30").
 * `structure_burning` is looked up by name as well, on the renderer's own
 * timer for a mesh building in its lowest two HP bands and for its wreck's
 * first seconds (GH-31, A3.2 remainder): a building on fire is a
 * presentation of `hp`, not an event, exactly the ambient shape.
 * `catastrophic_kill` is looked up by name too, off a `destroyed` event
 * whose type is a vehicle: the blast's light, screen shake and hit-stop
 * (WP-A1.2). It was the ONE file in `data/vfx/` this array did not carry,
 * and because `blastLightSpec`/`blastShake`/`blastHitStopMs` each answer
 * `null`/`0` for a missing emitter by design, three fifths of that package
 * were silently inert on every vehicle kill in the shipping app while every
 * unit test passed -- those call `useEmitters` with the JSON directly. The
 * toggle A/B in `tools/src/perf/blast-captures.ts` measured it at 0 px /
 * 0.0000 against the mortar's 14224 px / 5.4091 through the same code on
 * the same frame. `index.test.ts` now pins this array against the
 * DIRECTORY, so a file that ships without being registered is a red spec
 * rather than an effect nobody can see.
 */
export const vfxEmitters = [
  catastrophicKill,
  fireSmallArms,
  fireHmg,
  fireAutocannon,
  fireApfsds,
  fireHeat,
  // The motion pass (5 Oct): a shoulder-fired tube's backblast, thrown
  // behind the gunner by the renderer on the shot (not indexed by class:
  // it rides on top of the class's own muzzle emitter).
  rpgBackblast,
  fireMissile,
  fireMortar,
  // Unit polish (14 Oct): a mortar's baseplate slamming dust up on the shot,
  // thrown at mortar_crew's measured baseplate (`rl_fire.base`); by id.
  mortarBaseDust,
  missileTrail,
  // A Grad rocket's smoke, laid along its arc through the missile trail's
  // lifted pool (GH-85): looked up by id, not by weapon class.
  rocketTrail,
  missileImpact,
  shellImpact,
  // GH-709 (E3): the carrier shell opening in the air over a cluster round,
  // looked up by id (`CLUSTER_AIRBURST_EMITTER_ID`).
  clusterAirburst,
  // GH-748: the two fire-support detonations, looked up by id
  // (`BARRAGE_IMPACT_EMITTER_ID`, `AIR_STRIKE_IMPACT_EMITTER_ID`).
  barrageImpact,
  airStrikeImpact,
  structureBurning,
  structureCollapse,
  collapseFlash,
  tunnelCollapse,
  vehicleDust,
  // GH-871 P4: what a vehicle throws on a map that rains, in place of `vehicle_dust`;
  // swapped BY NAME in the renderer (nothing dispatches by the `vehicle_move` trigger).
  vehicleMud,
  // GH-984 N2: the clods a tracked hull throws on a pivot and a launch, spawned BY NAME by the renderer
  // from the tick that detected them (`vehicle_clods`); unregistered, it is silently inert.
  vehicleClods,
  vehicleExhaust,
  // Pass C2/C4 (P3): a living vehicle with a mobility or firepower kill.
  vehicleDamagedSmoke,
  // The lead's ruling of 4 Nov: a knocked-out main gun puffs once and burns small for 8-15 s; spawned BY NAME by the
  // renderer (`units/gun-out-fx.ts`) on the sim clock; unregistered, both are silently inert.
  gunOutPuff,
  gunOutFire,
  rotorWash,
  // GH-85: the triggers the schema declared and nothing dispatched. A direct-
  // fire round glancing off (impact_armor) or punching through (penetration)
  // a hull, a burnt-out hull smouldering on the sim clock (catastrophic_kill),
  // a Trophy launch (interceptor_launch), a demolition charge going off
  // (eod_breach) and a smoke launcher's pop (smoke_screen).
  armorRicochet,
  armorPenetration,
  wreckSmoulder,
  apsLaunch,
  demolitionBlast,
  // GH-1197 P3: by id (`BUILDING_HIT_DUST_EMITTER_ID`), at the hit face of a building an explosive round struck.
  buildingHitDust,
  smokeDischarge,
  // E6 (GH-274) chunk B: a swarm member shot down (`SwarmBatch`'s 'down' event), by id.
  swarmMemberDown,
  // E6 (GH-274) chunk C: the beam's strike sparks and its overheat vent, by id.
  beamStrike,
  beamVent,
];

/**
 * GH-1197: `data/vfx/munitions.json`, the munition classes that size a weapon's
 * DRAWN blast from its own `splash_tiles` (`vfx_munitions.schema.json`). It sits
 * in `data/vfx/` beside the emitters but is not one, so it is not in
 * `vfxEmitters`; `index.test.ts` pins that it is the only non-emitter file there
 * and that this export is the file. The renderer reads the same file
 * (`packages/render/src/three/munitions.ts`).
 */
export const vfxMunitions = munitions;

/** The one file in `data/vfx/` that is not an emitter (GH-1197). */
export const VFX_MUNITIONS_FILE = 'munitions.json';

/** Resolve a palette key like "vfx.fire" or "dust.2" to its hex colour. */
export function paletteColor(key: string): string {
  const dot = key.indexOf('.');
  const band = key.slice(0, dot);
  const name = key.slice(dot + 1);
  const ramps = palette.ramps as Record<string, { colors: string[] }>;
  const reserved = palette.reserved as Record<string, { colors: Record<string, string> }>;
  if (band in ramps) return ramps[band].colors[Number(name)] ?? '#FF00FF';
  if (band in reserved) return reserved[band].colors[name] ?? '#FF00FF';
  return '#FF00FF';
}

/** Mirrors `packages/app/src/settings.ts`'s `ColorVision` -- redeclared here
 *  rather than imported, since `@lions/data` is a leaf package that imports
 *  no other `@lions` package. The two stay in sync by
 *  `packages/app/src/main.ts` passing a real `ColorVision` value straight
 *  through: a widened caller would be a type error at that call site. */
export type ColorVisionVariant = 'default' | 'deuteranopia' | 'protanopia' | 'tritanopia';

/**
 * The palette key civilians draw in -- the third slot of `paletteTeamColors`
 * and the silhouette's side-2 key -- the SAME pale `limestone.0` in every
 * colour-vision variant (VR-04, option 1). Civilians used to share
 * `team.neutral` with every warning (HP mid, an unheld zone, halt, the `--warn`
 * feed); that yellow keeps meaning caution and nothing else now. A plain ramp
 * key, deliberately NOT a `reserved.team` entry: that would make `limestone.0`
 * a reserved colour and the static-art gates would reject it. The renderer
 * (`silhouette.ts`) cannot import this package and restates the key; a test
 * in `tools/src/civilian_colour.test.ts` pins the two together.
 */
export const CIVILIAN_COLOR_KEY = 'limestone.0';

/** The four `reserved.team` colours (`kedem`/`hostile`/`hostile_text`/
 *  `neutral`) for one variant -- `'default'` is the plain `colors` entry,
 *  every other variant its matching `variants` entry. The one place either
 *  `paletteTeamColors` or `variantAwareResolver` below reads the palette's
 *  team band, so the two can never read two different entries for the same
 *  variant. */
function teamColorsFor(variant: ColorVisionVariant): Record<string, string> {
  const team = palette.reserved.team as { colors: Record<string, string>; variants: Record<string, Record<string, string>> };
  // Minor 18 (final review): `team.variants[variant]` is an index into JSON,
  // not into a type -- a variant the palette has not grown yet reads
  // `undefined`, and the caller's `.kedem` then throws. Unreachable through the
  // typed path (`main.ts` passes a real `ColorVision`), but this is data on
  // disk and the union is a hand-kept mirror of it, so the two CAN part. The
  // default set is the honest answer to "this variant does not exist": the
  // colours the game shipped with, rather than a crash on a screen the player
  // reached by turning an accessibility setting on.
  return (variant === 'default' ? team.colors : team.variants[variant]) ?? team.colors;
}

/**
 * The three team colours -- kedem, hostile, civilian -- for a colour-vision
 * variant. Slot 2 is `CIVILIAN_COLOR_KEY` in every variant (VR-04); the
 * variant's own `neutral` is the WARNING yellow, reached by key through
 * `variantAwareResolver('team.neutral')`, not through this tuple.
 *
 * `'default'` reads `reserved.team.colors`, the plain palette; any
 * other variant reads the matching entry of `reserved.team.variants`
 * (`tools/src/cvd.ts`'s gate is what keeps every one of those pairs apart
 * under simulated deficiency). Read once at construction, the same as the
 * renderer backend choice -- `main.ts` calls this when it builds
 * `RendererOptions` and the minimap, not on every settings change, so a
 * variant switched mid-mission takes effect from the next one.
 */
export function paletteTeamColors(variant: ColorVisionVariant): [kedem: string, hostile: string, civilian: string] {
  const c = teamColorsFor(variant);
  return [c.kedem, c.hostile, paletteColor(CIVILIAN_COLOR_KEY)];
}

/**
 * A `resolveColor`-shaped function -- the shape `RendererOptions.resolveColor`
 * takes, `(key: string) => string` -- for one colour-vision variant. Both
 * renderer backends ask for a team colour by STRING KEY rather than by
 * reading `teamColors` directly, in several places that are not the unit
 * body tint `teamColors` itself covers: the occlusion-silhouette outline
 * (`packages/render/src/three/units/silhouette.ts`'s
 * `SILHOUETTE_COLOR_KEY_BY_SIDE`, which feeds every billboard
 * `UnitInstancer`'s own shader uniform AND the mesh path's shared
 * silhouette materials), the HP bar fill (`hpBarColorKey`) and the
 * objective-zone tint (`objectiveZoneColorKey`). A
 * plain `paletteColor` passed as `resolveColor` resolves `'team.hostile'`
 * to the DEFAULT hex regardless of the player's setting, which is exactly
 * the bug this function closes -- Task 12's `teamColors` tuple alone was
 * not enough, because most of the renderer's own team-coloured draws never
 * read that tuple.
 *
 * The four `team.*` keys route through `variant`'s own entry (matching
 * `paletteTeamColors` plus `hostile_text`, which nothing currently calls
 * `resolveColor` for but is included for the same reason the palette
 * declares it: a caller that starts asking for readable red text on a
 * variant should get that variant's own readable red, not the default's).
 * Every other key falls through to the plain `paletteColor`, unaffected by
 * the setting -- exactly `paletteColor`'s own current behaviour for
 * `variant === 'default'`.
 */
export function variantAwareResolver(variant: ColorVisionVariant): (key: string) => string {
  const team = teamColorsFor(variant);
  return (key: string): string => {
    if (key === 'team.kedem') return team.kedem;
    if (key === 'team.hostile') return team.hostile;
    if (key === 'team.neutral') return team.neutral;
    if (key === 'team.hostile_text') return team.hostile_text;
    return paletteColor(key);
  };
}

// --- mission-text locale overlay --------------------------------------------
//
// A mission's `name`/`briefing`/objective `text`/trigger `label` are DATA
// (CLAUDE.md's own line: "Data text stays data"), authored in `en` on every
// file under `data/missions/`. A shipped translation of that text is a
// separate, optional file — `data/locales/<lang>/missions.json`
// (`data/locales/README.md` states the shape) — layered onto the `en`
// mission at the point `@lions/app` resolves it, never edited into the
// mission JSON itself: `en` stays the one source `mission-author` and
// `narrative-designer` write against, and a translator's file can go stale
// or missing without touching it.

/** The four named blocks of a sectioned briefing (`mission.schema.json` `briefing_sections[].id`), in their fixed order. */
export const BRIEFING_SECTION_IDS = ['situation', 'mission', 'execution', 'notes'] as const;
export type BriefingSectionId = (typeof BRIEFING_SECTION_IDS)[number];

/**
 * One mission's translatable text (GH-1406 parts 2 and 3). Every field is optional and falls back to the `en` source per field.
 * Beyond the first four, which have been here from the start: `dispatch`, `aftermath` and `hostages_place` are the mission's own
 * strings; `debrief` carries the two closing lines' TEXT (the speaker is never translated); `sections` the named blocks of a sectioned
 * briefing; `objective_say`, `objective_say_on_fail` and `trigger_say` the radio lines of an objective's completion, its failure and a
 * trigger, keyed by that objective's or trigger's own id; `wave_say` the line a wave speaks, keyed by the wave's INDEX in
 * `enemy.waves` (a wave has no id), as a string. A key naming something the mission does not have is a validator failure, never a
 * silent no-op (`tools/validate_narrative.mjs`).
 */
export interface MissionLocaleEntry {
  name?: string;
  briefing?: string;
  objectives?: Record<string, string>;
  triggers?: Record<string, string>;
  dispatch?: string;
  aftermath?: string;
  hostages_place?: string;
  debrief?: { victory?: string; defeat?: string };
  sections?: Partial<Record<BriefingSectionId, string>>;
  objective_say?: Record<string, string>;
  objective_say_on_fail?: Record<string, string>;
  trigger_say?: Record<string, string>;
  wave_say?: Record<string, string>;
  /**
   * The stale-translation guard (GH-1406 part 5): `{ "<path of a translated string>": "<8 hex of its English source>" }`, written by
   * the English generator and checked by `validate:data`. NOT text, and never read at runtime; it is declared so a typed overlay file
   * may carry it.
   */
  src?: Record<string, string>;
}

/**
 * One locale's mission text, keyed by mission id. `objectives`/`triggers`
 * are keyed by THEIR OWN ids — an objective or trigger with no id of its own
 * cannot be named here, the same identity `tools/validate_narrative.mjs`'s
 * `overlayFailures` (and `mission.ts`'s own trigger/objective lookups
 * elsewhere) already key everything else off.
 */
export interface MissionLocaleOverlay {
  [missionId: string]: MissionLocaleEntry;
}

/** A radio line as the schema has it (`$defs/say`): the speaker is a fixed enum and is never translated. */
interface SayJson {
  speaker: string;
  text: string;
}

/**
 * A mission's JSON as far as this module needs to see it — not `@lions/sim`'s
 * own `MissionJson` (this package is a leaf: it imports nothing from another
 * `@lions` package, enforced by lint). `applyMissionLocale` below is generic
 * over `T extends MissionJson`, the same shape `upgrades.ts`'s
 * `applyUpgrades<T extends UpgradableUnit>` already uses and for the
 * identical reason: a caller holding a real `@lions/sim` `MissionJson` gets
 * one back, with no cast at its own call site, rather than this file's
 * narrower structural type leaking out through the return value.
 */
export interface MissionJson {
  id: string;
  name?: string;
  briefing?: string;
  dispatch?: string;
  aftermath?: string;
  hostages_place?: string;
  debrief?: { victory?: SayJson; defeat?: SayJson };
  briefing_sections?: readonly { id: string; text: string; image?: unknown }[];
  objectives: readonly { id: string; text?: string; say?: SayJson; say_on_fail?: SayJson }[];
  triggers?: readonly { id?: string; label?: string; say?: SayJson }[];
  enemy?: { waves?: readonly { say?: SayJson }[] };
}

/** `say` with its text replaced, speaker and every other field kept. */
function withSayText<S extends SayJson | undefined>(say: S, text: string | undefined): S {
  return say !== undefined && text !== undefined ? ({ ...say, text } as S) : say;
}

/**
 * Overlays a locale's mission text onto a mission's own JSON, id-matched:
 * `name`/`briefing` replace whole-string, `objectives`/`triggers` by their
 * own ids, and (part 3) `dispatch`, `aftermath`, `hostages_place`, the two
 * `debrief` lines, the briefing's `sections` and every radio line by the same
 * rule. A field the overlay does not carry falls back to the mission's
 * own `en` text, so a partial translation degrades to English per-field
 * rather than per-mission. A `say`'s speaker and a section's image are never
 * touched.
 *
 * A missing mission id in the overlay, or a null overlay (`main.ts`'s own
 * loader returns null for `en` and for a 404, rather than fetching a file
 * that would just be the source text again), is a no-op that returns
 * `mission` BY REFERENCE, unchanged — the common case (every mission, on
 * `en`) costs nothing.
 *
 * A translated `briefing` over a mission with `briefing_sections` that the
 * overlay does not also translate leaves the sections in English; the deploy
 * screen already falls back to the unsectioned beats whenever the sections
 * no longer join to the briefing (`ui/briefing-sections.ts`).
 */
export function applyMissionLocale<T extends MissionJson>(
  mission: T,
  overlay: MissionLocaleOverlay | null
): T {
  const o = overlay?.[mission.id];
  if (!o) return mission;
  const out: Record<string, unknown> = {
    ...(mission as Record<string, unknown>),
    name: o.name ?? mission.name,
    briefing: o.briefing ?? mission.briefing,
    objectives: mission.objectives.map((ob) => {
      const text = o.objectives?.[ob.id];
      const say = withSayText(ob.say, o.objective_say?.[ob.id]);
      const sayOnFail = withSayText(ob.say_on_fail, o.objective_say_on_fail?.[ob.id]);
      if (text === undefined && say === ob.say && sayOnFail === ob.say_on_fail) return ob;
      return {
        ...ob,
        ...(text === undefined ? {} : { text }),
        ...(say === ob.say ? {} : { say }),
        ...(sayOnFail === ob.say_on_fail ? {} : { say_on_fail: sayOnFail }),
      };
    }),
    triggers: mission.triggers?.map((tr) => {
      if (tr.id === undefined) return tr;
      const label = o.triggers?.[tr.id];
      const say = withSayText(tr.say, o.trigger_say?.[tr.id]);
      if (label === undefined && say === tr.say) return tr;
      return { ...tr, ...(label === undefined ? {} : { label }), ...(say === tr.say ? {} : { say }) };
    }),
  };
  if (o.dispatch !== undefined && mission.dispatch !== undefined) out.dispatch = o.dispatch;
  if (o.aftermath !== undefined && mission.aftermath !== undefined) out.aftermath = o.aftermath;
  if (o.hostages_place !== undefined && mission.hostages_place !== undefined) out.hostages_place = o.hostages_place;
  if (o.debrief !== undefined && mission.debrief !== undefined) {
    out.debrief = {
      ...mission.debrief,
      ...(mission.debrief.victory === undefined || o.debrief.victory === undefined ? {} : { victory: withSayText(mission.debrief.victory, o.debrief.victory) }),
      ...(mission.debrief.defeat === undefined || o.debrief.defeat === undefined ? {} : { defeat: withSayText(mission.debrief.defeat, o.debrief.defeat) }),
    };
  }
  if (o.sections !== undefined && mission.briefing_sections !== undefined) {
    out.briefing_sections = mission.briefing_sections.map((sec) => {
      const text = (o.sections as Record<string, string | undefined>)[sec.id];
      return text === undefined ? sec : { ...sec, text };
    });
  }
  if (o.wave_say !== undefined && mission.enemy?.waves !== undefined) {
    out.enemy = {
      ...mission.enemy,
      waves: mission.enemy.waves.map((w, i) => {
        const say = withSayText(w.say, o.wave_say?.[String(i)]);
        return say === w.say ? w : { ...w, say };
      }),
    };
  }
  return out as T;
}

// --- unit-text locale overlay -----------------------------------------------
//
// A unit's `name` and `blurb` are DATA like a mission's text, authored in `en` on every file under `data/units/`. A shipped translation is
// a separate optional file, `data/locales/<lang>/units.json` (`data/locales/README.md`), layered on at the point `@lions/app` REGISTERS a
// unit for display. It is never written into `units` itself: the net content digest hashes `units` (names included), so two players in
// different languages would otherwise disagree about the content and be refused a room. A unit's `role` label is chrome and already goes
// through `t()` (`ui/role.ts`).

/** One locale's unit text, keyed by unit id. A field the overlay does not carry keeps the `en` text, per field. */
export interface UnitLocaleOverlay {
  [unitId: string]: { name?: string; blurb?: string; src?: { name?: string; blurb?: string } };
}

/**
 * Overlays a locale's name and blurb onto a unit's JSON. No entry for the unit, or a null overlay (`en`, or a locale nothing ships a file
 * for), returns `unit` BY REFERENCE, unchanged. Generic, like `applyMissionLocale`, so a caller holding `@lions/sim`'s own unit type gets
 * one back with no cast.
 */
export function applyUnitLocale<T extends { id: string; name?: string; blurb?: string }>(unit: T, overlay: UnitLocaleOverlay | null): T {
  const o = overlay?.[unit.id];
  if (!o || (o.name === undefined && o.blurb === undefined)) return unit;
  return {
    ...unit,
    ...(o.name === undefined ? {} : { name: o.name }),
    ...(o.blurb === undefined || unit.blurb === undefined ? {} : { blurb: o.blurb }),
  };
}
