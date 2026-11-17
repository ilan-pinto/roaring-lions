// @lions/data/content -- the EAGER map and mission registries: every data/maps/*.json and data/missions/*.json, imported
// statically and keyed by id, exactly the objects `@lions/data` exported as `maps` and `missions` until B6-6.
//
// Node only, and lazily loaded app chunks: tools, tests and the sim harnesses read it synchronously. The app's ENTRY must
// never reach this module (the entry chunk has a byte ceiling, `pnpm --filter @lions/tools webgpu:bundle`): the entry
// reads the generated synchronous manifest (`content-manifest.ts`, re-exported by `@lions/data`) and loads a map or a
// mission by id through `@lions/data/content-lazy`. `packages/app/src/content-wiring.test.ts` walks the entry's static
// import graph and goes red if it reaches this file or any map or mission JSON.
//
// Hand-kept, like the rest of the package's registries: `index.test.ts` pins both to their directories, and the ORDER of
// each registry is the order the manifest (`pnpm content:manifest -- --write`) and so the Free Play picker list.

import beitSahwanOutskirts from '../../../data/maps/beit_sahwan_outskirts.json';
// Beit Sahwan's per-mission variants (docs/campaign/map-variants-design.md
// §3.2): same 48x48 frame, same markers/zones, same `tunnels` block, same
// structure tiles a `garrison` stance points at by tile -- obstacles bent
// around the town's own roads and buildings per mission. The base file is
// untouched; I and the breach stay on it (recon learns the town as it is;
// the yard's eight raid axes are the mission's own shape).
import beitSahwan2Map from '../../../data/maps/beit_sahwan_2.json';
import beitSahwan3Map from '../../../data/maps/beit_sahwan_3.json';
import beitSahwan4Map from '../../../data/maps/beit_sahwan_4.json';
import khanRafidMap from '../../../data/maps/khan_rafid.json';
import khanRafid2Map from '../../../data/maps/khan_rafid_2.json';
import khanRafid3Map from '../../../data/maps/khan_rafid_3.json';
import deirAmunMap from '../../../data/maps/deir_amun.json';
import deirAmun2Map from '../../../data/maps/deir_amun_2.json';
import deirAmun3Map from '../../../data/maps/deir_amun_3.json';
import einQasab from '../../../data/maps/ein_qasab.json';
import einQasab3 from '../../../data/maps/ein_qasab_3.json';
import jebelMatar from '../../../data/maps/jebel_matar.json';
import marjPerimeter from '../../../data/maps/marj_perimeter.json';
import qarnHadid from '../../../data/maps/qarn_hadid.json';
import qarnHadid2Map from '../../../data/maps/qarn_hadid_2.json';
import qarnHadid3Map from '../../../data/maps/qarn_hadid_3.json';
import telMarum from '../../../data/maps/tel_marum.json';
// Tel Marum's per-mission variants (docs/campaign/map-variants-design.md):
// same 48x48 frame, same markers/zones, same rows 12-17 (the wall), obstacles
// and elevation bent around it per mission. The base file is untouched.
import telMarum1 from '../../../data/maps/tel_marum_1.json';
import telMarum2 from '../../../data/maps/tel_marum_2.json';
import telMarum3 from '../../../data/maps/tel_marum_3.json';
// The two dedicated 1v1 versus maps (2026-10-14): point-symmetric about the
// map centre, each seat's start named `versus_0` / `versus_1` (read by name by
// `sandboxAnchors`). No mission references either.
import milhFlats from '../../../data/maps/milh_flats.json';
import wadiTarfan from '../../../data/maps/wadi_tarfan.json';
import wadiTarfanL from '../../../data/maps/wadi_tarfan_l.json';
import milhFlatsL from '../../../data/maps/milh_flats_l.json';
// The large 80x80 network map (GH-913 L4, 2026-11-01): point-symmetric, seats named as above.
// Registered so free play can walk it; no room offers it until L5's fairness runs and the lead.
import rujmSawda from '../../../data/maps/rujm_sawda.json';
// The four tile-study sandboxes (2026-09-03). Not campaign ground and no
// mission references any of them: each exists to put ONE of the ground
// albedos in front of the player at gameplay zoom, reachable from the
// `?sandboxes` picker, which builds its list from this registry.
import tileGreen from '../../../data/maps/tile_green.json';
import tileKnoll from '../../../data/maps/tile_knoll.json';
import tileOrchard from '../../../data/maps/tile_orchard.json';
import tileRoad from '../../../data/maps/tile_road.json';
import tileScrub from '../../../data/maps/tile_scrub.json';
import tutorialGround from '../../../data/maps/tutorial_ground.json';
import ummZeitoun from '../../../data/maps/umm_zeitoun.json';
// Umm Zeitoun's per-mission variants (docs/campaign/map-variants-design.md
// §3.4): same 48x48 frame, same markers/zones, same `stockpile`, `crest_top`,
// `post_stone` and `hamlet` contents -- obstacles bent around them per
// mission. The base file is untouched; I and II stay on it (the basin's
// "no wall, no gate, crossable anywhere" briefing is the point of both).
import ummZeitoun2 from '../../../data/maps/umm_zeitoun_2.json';
import ummZeitoun3 from '../../../data/maps/umm_zeitoun_3.json';
import ummZeitoun4 from '../../../data/maps/umm_zeitoun_4.json';
import wadiHalamBasin from '../../../data/maps/wadi_halam_basin.json';
// Wadi Halam's per-mission variants (docs/campaign/map-variants-design.md
// §3.3): same 48x48 frame, same markers/zones, same depot compound and
// poplar gallery, obstacles (and, for II, a first elevation grid) bent
// around them per mission. I stays on the base file (the fords are the lesson
// the base map already teaches); since GH-161 the base file carries its own east-bank crest
// (a sparse elevation grid).
import wadiHalam2 from '../../../data/maps/wadi_halam_2.json';
import wadiHalam3 from '../../../data/maps/wadi_halam_3.json';
import wadiHalam4 from '../../../data/maps/wadi_halam_4.json';
import wadiHalam5 from '../../../data/maps/wadi_halam_5.json';
import beitSahwanBreach from '../../../data/missions/beit_sahwan_breach.json';
import beitSahwan0 from '../../../data/missions/beit_sahwan_0_tutorial.json';
import beitSahwan1 from '../../../data/missions/beit_sahwan_1_recon.json';
import beitSahwan2 from '../../../data/missions/beit_sahwan_2_foothold.json';
import beitSahwan3 from '../../../data/missions/beit_sahwan_3_clearance.json';
import beitSahwan4 from '../../../data/missions/beit_sahwan_4_subterranean.json';
import telMarum1Recon from '../../../data/missions/tel_marum_1_recon.json';
import telMarum2Foothold from '../../../data/missions/tel_marum_2_foothold.json';
import telMarum3Clearance from '../../../data/missions/tel_marum_3_clearance.json';
import qarnHadid1Recon from '../../../data/missions/qarn_hadid_1_recon.json';
import qarnHadid2Foothold from '../../../data/missions/qarn_hadid_2_foothold.json';
import qarnHadid3Clearance from '../../../data/missions/qarn_hadid_3_clearance.json';
import ummZeitoun1Recon from '../../../data/missions/umm_zeitoun_1_recon.json';
import ummZeitoun2Buildup from '../../../data/missions/umm_zeitoun_2_buildup.json';
import ummZeitoun3Clearance from '../../../data/missions/umm_zeitoun_3_clearance.json';
import ummZeitoun4Clearance from '../../../data/missions/umm_zeitoun_4_clearance.json';
import einQasab1Recon from '../../../data/missions/ein_qasab_1_recon.json';
import einQasab2Foothold from '../../../data/missions/ein_qasab_2_foothold.json';
import einQasab3Buildup from '../../../data/missions/ein_qasab_3_buildup.json';
import wadiHalam1Fords from '../../../data/missions/wadi_halam_1_fords.json';
import wadiHalam2Laager from '../../../data/missions/wadi_halam_2_laager.json';
import wadiHalam3Counterraid from '../../../data/missions/wadi_halam_3_counterraid.json';
import wadiHalam4Village from '../../../data/missions/wadi_halam_4_village.json';
import wadiHalam5Depot from '../../../data/missions/wadi_halam_5_depot.json';
import khanRafid1Recon from '../../../data/missions/khan_rafid_1_recon.json';
import khanRafid2Foothold from '../../../data/missions/khan_rafid_2_foothold.json';
import khanRafid3Clearance from '../../../data/missions/khan_rafid_3_clearance.json';
import deirAmun1Recon from '../../../data/missions/deir_amun_1_recon.json';
import deirAmun2Foothold from '../../../data/missions/deir_amun_2_foothold.json';
import deirAmun3Subterranean from '../../../data/missions/deir_amun_3_subterranean.json';

/** Battlefield maps, keyed by map id. Shapes match map.schema.json. */
export const maps = {
  beit_sahwan_outskirts: beitSahwanOutskirts,
  beit_sahwan_2: beitSahwan2Map,
  beit_sahwan_3: beitSahwan3Map,
  beit_sahwan_4: beitSahwan4Map,
  khan_rafid: khanRafidMap,
  khan_rafid_2: khanRafid2Map,
  khan_rafid_3: khanRafid3Map,
  deir_amun: deirAmunMap,
  deir_amun_2: deirAmun2Map,
  deir_amun_3: deirAmun3Map,
  ein_qasab: einQasab,
  ein_qasab_3: einQasab3,
  jebel_matar: jebelMatar,
  marj_perimeter: marjPerimeter,
  milh_flats: milhFlats,
  milh_flats_l: milhFlatsL,
  qarn_hadid: qarnHadid,
  qarn_hadid_2: qarnHadid2Map,
  qarn_hadid_3: qarnHadid3Map,
  rujm_sawda: rujmSawda,
  tel_marum: telMarum,
  tel_marum_1: telMarum1,
  tel_marum_2: telMarum2,
  tel_marum_3: telMarum3,
  tile_green: tileGreen,
  tile_knoll: tileKnoll,
  tile_orchard: tileOrchard,
  tile_road: tileRoad,
  tile_scrub: tileScrub,
  tutorial_ground: tutorialGround,
  umm_zeitoun: ummZeitoun,
  umm_zeitoun_2: ummZeitoun2,
  umm_zeitoun_3: ummZeitoun3,
  umm_zeitoun_4: ummZeitoun4,
  wadi_halam_basin: wadiHalamBasin,
  wadi_halam_2: wadiHalam2,
  wadi_halam_3: wadiHalam3,
  wadi_halam_4: wadiHalam4,
  wadi_halam_5: wadiHalam5,
  wadi_tarfan: wadiTarfan,
  wadi_tarfan_l: wadiTarfanL,
} as const;

export type MapId = keyof typeof maps;

/** Missions, keyed by mission id. Shapes match mission.schema.json. */
export const missions = {
  beit_sahwan_breach: beitSahwanBreach,
  beit_sahwan_0_tutorial: beitSahwan0,
  beit_sahwan_1_recon: beitSahwan1,
  beit_sahwan_2_foothold: beitSahwan2,
  beit_sahwan_3_clearance: beitSahwan3,
  beit_sahwan_4_subterranean: beitSahwan4,
  khan_rafid_1_recon: khanRafid1Recon,
  khan_rafid_2_foothold: khanRafid2Foothold,
  khan_rafid_3_clearance: khanRafid3Clearance,
  deir_amun_1_recon: deirAmun1Recon,
  deir_amun_2_foothold: deirAmun2Foothold,
  deir_amun_3_subterranean: deirAmun3Subterranean,
  tel_marum_1_recon: telMarum1Recon,
  tel_marum_2_foothold: telMarum2Foothold,
  tel_marum_3_clearance: telMarum3Clearance,
  qarn_hadid_1_recon: qarnHadid1Recon,
  qarn_hadid_2_foothold: qarnHadid2Foothold,
  qarn_hadid_3_clearance: qarnHadid3Clearance,
  umm_zeitoun_1_recon: ummZeitoun1Recon,
  umm_zeitoun_2_buildup: ummZeitoun2Buildup,
  umm_zeitoun_3_clearance: ummZeitoun3Clearance,
  umm_zeitoun_4_clearance: ummZeitoun4Clearance,
  ein_qasab_1_recon: einQasab1Recon,
  ein_qasab_2_foothold: einQasab2Foothold,
  ein_qasab_3_buildup: einQasab3Buildup,
  wadi_halam_1_fords: wadiHalam1Fords,
  wadi_halam_2_laager: wadiHalam2Laager,
  wadi_halam_3_counterraid: wadiHalam3Counterraid,
  wadi_halam_4_village: wadiHalam4Village,
  wadi_halam_5_depot: wadiHalam5Depot,
} as const;

export type MissionId = keyof typeof missions;
