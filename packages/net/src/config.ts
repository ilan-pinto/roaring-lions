import { SPECIALS_MAX } from './specials';

/** The whole input to both simulations (spec §2.1). `mode: 'sandbox'` is
 *  N0's two-humans-on-side-0 room; `'versus'` arrives with N1. */
export type Seat = 0 | 1;
export type Faction = 'kdf' | 'sarim';

export interface SeatConfig {
  seat: Seat;
  side: 0 | 1;
  faction: Faction;
  kit: 'matched' | 'brigade';
  /** The seat's bought kit, the account's own `ownedTiers` shape and the one
   *  `upgradePrepass` takes: unit type id -> track -> tier. `{}` for a matched
   *  room. Structural checks only (`isTiers`); the room cannot check a claim
   *  against an account. */
  tiers: Record<string, Record<string, number>>;
  /** GH-1102: the Store specials this seat brings into a brigade room (`specials.ts`), as the
   *  room minted them: its cleaned claim minus `VERSUS_REFUSED_SPECIALS`, for a human KDF seat
   *  in a `brigade` room only. `[]` everywhere else, as it was in every room before. At most
   *  `SPECIALS_MAX` strings; the world cleans it again against the data (`seatSpecials`). */
  unlocks: string[];
  player: string;
  callsign: string;
  kind: 'human' | 'bot';
}

/** How a versus room is WON beside annihilation (GH-976): `camp` razes the enemy camp, `points` is a points race, `flag` is
 *  capture the flag, v1 a RAID (GH-976 P3): hold the enemy flag zone alone for the mode file's `hold_s`; no carried flag.
 *  A twin of @lions/data's `WIN_MODES` (the Worker imports net and not data), held to it by
 *  `tools/src/validate_versus_modes.test.ts`. Absent on a config is annihilation, the default, and every room
 *  that has ever been played. */
export const WIN_MODES = ['camp', 'points', 'flag'] as const;
export type WinMode = (typeof WIN_MODES)[number];

/** The maps each win mode has been READ fair on (GH-976 P1; `pnpm versus:probe -- --mode=...`, 288 held-out seeds, 4000-4287,
 *  both ends active and each end passive in turn): the lobby of a later phase offers a mode on these maps and no others
 *  (`winModeAllowed`). Nothing consults it in phase 1 -- no room offers a mode yet -- and `validateConfig` does not (the probe
 *  and the tests play modes anywhere a mode file stands).
 *
 *  - `points` reads fair on both: wadi_tarfan east 56.3% (within the 60/40 bar), 93.8% of games decided by the goal, the passive
 *    end lost 288 of 288 from each end; milh_flats west 57.3%, 98.3% by the goal, the passive end lost 288 of 288 from each end.
 *  - `camp` (GH-976 P1) read fair (53.5% and 58.0%) and FAILED the other two bars on both maps at the camps' first positions, so it was
 *    listed on none: 4.9% (wadi_tarfan) and 58.3% (milh_flats) of games were decided by the camp, against 70% required, because two
 *    blobs that attack-move on the other's camp meet and one wipes the other first; and a passive end won 29 and 8 of 288 games
 *    (wadi_tarfan), 47 and 38 (milh_flats), where it must lose them all. GH-976 camp-mode: the camp stands INSIDE the defender's
 *    reach, so a passive force beat an all-in attacker on the way to it. The camp is data (`camps` in the mode file, any open
 *    2x2 within `CAMP_REACH` of the seat's anchor), so it was moved forward, toward the enemy. **`milh_flats` only**, at (15,39) and
 *    (31,7) (it was (4,40) and (42,6)); fitted on seeds 0-191 (192 games a cell: 92 / 100, 96.4% by the goal, the passive end
 *    lost 384 of 384), read once on 4000-4287: west 137 / east 151 / draw 0 (52.4%), 96.5% by the goal, the passive end lost 288
 *    of 288 from each end. Not unfair for this probe's play, which is a race: the raid runs 32 s (east camp) to 82 s (west camp)
 *    and a defender that stands ON its camp (not the probe's passive seat) holds it 55 times of 96 in the west and 8 in the
 *    east. wadi_tarfan, rujm_sawda, wadi_tarfan_l, milh_flats_l, tel_marum and beit_sahwan_outskirts were screened over the camp
 *    ground the reach allows and none gets past 33% decided by the goal (best 22%, wadi_tarfan): their blobs meet, and the wipe
 *    ends the game before a camp falls. That needs an engine rule (annihilation off, or a goal-aware wipe), not data.
 *  - **GH-976, 5 Nov: `camp` on `wadi_tarfan` and `wadi_tarfan_l` too**, with forward camps and `modes.camp.wipe: after_camp` (a wiped side keeps
 *    playing while its camp stands; the screen over the ground the reach allows is above, and it now reads differently once the camp may stand 8-10
 *    tiles out; `MODE_CAMP_REACH` is 10 in `tools/validate_versus_modes.mjs`, the economy camps keep `CAMP_REACH` 6): wadi_tarfan (13,18) / (33,28) (the screened (12,18) / (34,28) put a spawned unit on a camp tile), wadi_tarfan_l (26,30) / (68,64),
 *    exits point-mirrored. The fresh-seed read (28000-28191, 192 per arm) is in the PR that added them; milh_flats_l, rujm_sawda and tel_marum stay out
 *    (no placement passed every gate there: GH-976).
 *  - `flag` (GH-976 P3; the raid probe: two infantry squads go for the flag, the rest of the force plays the base probe) reads
 *    fair on both, flag zones fitted on seeds 0-191 and read on 4000-4287 (288 each): wadi_tarfan east 164 / west 114 / draw 10,
 *    leader 56.9%, 96.5% decided by the goal, the passive end lost 288 of 288 from each end; milh_flats east 150 / west 134 /
 *    draw 4, leader 52.1%, 78.5% by the goal, the passive end lost 288 of 288 from each end. A same-tick double capture is a draw
 *    (the two raids are exact mirrors), not a goal win, in that share.
 *  - GH-976 P4 added the five other open maps, each fitted on seeds 0-191 and read once on 4000-4287 (288 each). The leader's
 *    share is over ALL the games, then over the DECISIVE games alone (a draw is nobody's), both inside 60/40 on every row below,
 *    and the passive end lost 288 of 288 from each end on every row:
 *
 *    | map | mode | west / east / draw | leader (all / decisive) | decided by the goal |
 *    |---|---|---|---|---|
 *    | tel_marum | points | 155 / 133 / 0 | 53.8% / 53.8% | 79.2% |
 *    | tel_marum | flag | 158 / 130 / 0 | 54.9% / 54.9% | 99.7% |
 *    | beit_sahwan_outskirts | points | 140 / 148 / 0 | 51.4% / 51.4% | 73.6% |
 *    | beit_sahwan_outskirts | flag | 148 / 140 / 0 | 51.4% / 51.4% | 100.0% |
 *    | rujm_sawda | points | 158 / 130 / 0 | 54.9% / 54.9% | 93.8% |
 *    | rujm_sawda | flag | 127 / 115 / 46 | 44.1% / 52.5% | 80.6% |
 *    | wadi_tarfan_l | points | 135 / 153 / 0 (12000-12287, see below) | 53.1% / 53.1% | 96.2% |
 *    | wadi_tarfan_l | flag | 122 / 129 / 37 | 44.8% / 51.4% | 87.2% |
 *    | milh_flats_l | points | 139 / 149 / 0 | 51.7% / 51.7% | 99.7% |
 *    | milh_flats_l | flag | 144 / 144 / 0 | 50.0% / 50.0% | 97.9% |
 *
 *    The fits are brittle in position and in the rates (a one-tile move of a flag, or one point of the kill weight on tel_marum,
 *    swings a cell by 5-30 points), so read each as "this ground, at these numbers, is not unfair for this probe's play".
 *    A second look on a range nobody had fitted or read (9000-9287, the PR 1020 review; same files except wadi_tarfan_l points,
 *    which was then at another weight, see below) passed every mirror row it re-read: tel_marum points 158 / 130 / 0, 54.9%,
 *    84.4% by the goal; wadi_tarfan_l flag 126 / 125 / 37, 43.8% / 50.2% decisive, 87.2%; beit_sahwan_outskirts points
 *    133 / 155 / 0, 53.8%, 74.3%. wadi_tarfan_l points (1 point per 100, target 600) was read on a third range, 12000-12287:
 *    135 / 153 / 0, 53.1% over all and decisive games, 96.2% by the goal, the passive end lost 288 of 288 from each end.
 *    KDF against Sarim is `WIN_MODE_FAIR_FACTION_CELLS`'s question.
 *
 *  - **GH-976, 12 Nov: `points` RELISTED on `beit_sahwan_outskirts` and `rujm_sawda` with re-fitted targets (300 and 250).** The lead
 *    delisted both on 12 Nov (PR 1287) after the probes machine's part-2 read (active arm, seeds 4000-4287) put them outside 60/40:
 *    beit_sahwan_outskirts 82 / 206 (71.5% east), rujm_sawda 188 / 100 (65.3% west). The cause is PR 1050 (finite APS, GH-884): after
 *    it about half of the beit_sahwan_outskirts games and a sixth of the rujm_sawda games end by annihilation before the target is
 *    reached. The probes machine's "Re-fit of the two delisted points cells with the finite APS kept" (12 Nov 12:57Z) found that a
 *    lower `target` alone passes the full bars (leader inside 60/40 over all and decisive games, the passive seat losing every game
 *    from either end, at least 70% decided by the goal): beit_sahwan_outskirts 600 -> 325 passes both ranges (55.6% / 95.5% on
 *    4000-4287, 56.6% / 93.4% on 32000-32287), 300 passes the fresh range with more margin (52.1% / 95.8%; not run on 4000-4287);
 *    rujm_sawda 350 -> 275 passes both (57.6% / 95.8%, 53.1% / 94.4%), 250 passes both with more margin (54.2% / 97.6%, 53.1% /
 *    96.9%). The shipped values are the MARGIN steps, 300 and 250, because the smallest passers sat close to the bar (350 on
 *    beit_sahwan_outskirts passed the first range by 0.3 points and failed the fresh one) and a read carries about 5 points of
 *    noise. The race gets shorter (mean game 345 s -> ~200 s and 227 s -> ~186 s). Camp, flag, zones, weights and every other map
 *    are unchanged. */
export const WIN_MODE_FAIR_MAPS: Readonly<Record<WinMode, readonly string[]>> = {
  camp: ['wadi_tarfan', 'milh_flats', 'wadi_tarfan_l'],
  points: ['beit_sahwan_outskirts', 'tel_marum', 'wadi_tarfan', 'milh_flats', 'rujm_sawda', 'wadi_tarfan_l', 'milh_flats_l'],
  // GH-976 (the lead's ruling of 12 Nov, relisting what GH-1139 pulled on 8 Nov): flag is offered on the five maps with a staged
  // `flag_setup` block, in the MIRROR only (KDF v KDF), and always with the set-up rules: these five are also `FLAG_SETUP_MAPS`, and the
  // two lists change together (a listed map missing from `FLAG_SETUP_MAPS` would offer the v1 raid GH-1139 pulled, which an opening
  // attack-move won in 32-62 s). The evidence is the "Flag-mode fairness audit" comment on GH-976 (11 Nov, base e8da511): every leader
  // 52-58%, no flag win under 2 minutes, no G1/G4 watch item. The lead's 11 Nov ruling is "ship as it is": capture the flag ships with the
  // shipped placements, the shipped hold, the minute-12 backstop of PR 1201 and the set-up rules. KDF v Sarim stays unlisted
  // (`WIN_MODE_FAIR_FACTION_CELLS.flag` is `{}`: the audit read the mirror only). tel_marum and beit_sahwan_outskirts have no staged
  // block and stay out. The per-map table above is NOT the relist's evidence: its flag rows are the v1 raid, which GH-1139 pulled. The
  // relist's rows are the audit's, in the next comment. Tools and tests build flag worlds directly (`validateConfig` does not read this
  // table), and a test that needs a flag ROOM on another map stands it here for its own duration (read at call time, like
  // `FLAG_SETUP_MAPS`).
  //
  // The audit's mirror rows (set-up rules on, KDF v KDF, strong scripted attacker both seats, early Ready, shipped placements, 45 s hold,
  // minute-12 backstop; seeds 53200-53295, 96 a cell; leader by DECISIVE games / by ALL games; flag wins under 2:00; draws):
  //
  //   | map | W/E decisive | leader (decisive / all) | flag / annihilation / rule | draws | flag wins < 2:00 |
  //   |---|---|---|---|---|---|
  //   | wadi_tarfan | 41 / 30 | 58% / 43% | 1% / 32% / 67% | 26% | 0 |
  //   | milh_flats | 35 / 48 | 58% / 50% | 11% / 25% / 64% | 14% | 0 |
  //   | rujm_sawda | 44 / 39 | 53% / 46% | 10% / 23% / 67% | 14% | 0 |
  //   | wadi_tarfan_l | 46 / 43 | 52% / 48% | 19% / 11% / 70% | 7% | 0 |
  //   | milh_flats_l | 50 / 44 | 53% / 52% | 29% / 21% / 50% | 2% | 0 |
  //
  // Caveats, from the audit: one scripted attacker that masses before it moves (a bot that attack-moves from the bell may still win
  // early, GH-1139's 0:55); each leader share carries 5-6 points of standard error; wadi_tarfan is a poor balance test (1% by the flag,
  // 26% draws).
  flag: ['wadi_tarfan', 'milh_flats', 'rujm_sawda', 'wadi_tarfan_l', 'milh_flats_l'],
};

/** The KDF-v-Sarim cells each win mode has been read fair on (GH-976 P4): per mode, per map, the HOSTS (the matchup is the
 *  host's faction, `kdf` or `sarim`, so the two entries are the two seat orders) whose cell passed every bar. The mirror's
 *  table is `WIN_MODE_FAIR_MAPS`; a faction cell is its own read, because a faction pairing in a mode room plays the two
 *  PLACED forces with no economy (`economyRoom` is false for it), and a mode that is fair between two KDF forces says
 *  nothing about KDF against Sarim.
 *
 *  A cell is in this table only if it passed the bars of the mirror's table on its own held-out seeds (4000-4287): the leader
 *  inside 60/40 over all the games and over the decisive games alone, the passive seat lost every game from either end,
 *  and at least 70% of the games decided by the goal.
 *
 *  - Nothing is listed (GH-976 P4 review). The one cell that passed, `points` on wadi_tarfan_l at 10 points per 100 value and a
 *    target of 400 (4000-4287: 130 / 158 and 125 / 163, 54.9% and 56.6%), was a kill race, not a points race: about 80% of its
 *    points came from kills (held ground 20%, against 87-91% on the other maps), and at the real race (1 per 100, target 600) the
 *    faction cells read Sarim 63.2% and 64.2% on 9000-9287. It was removed, and the mirror file went back to 1 per 100.
 *  - Read on 4000-4287 and NOT fair, so not listed (leader / decided by the goal, host KDF then host Sarim): `flag` on
 *    wadi_tarfan 100% and 100% / 100.0% (Sarim wins every raid), on tel_marum 88.9% and 100% / 99.7% and 100.0% (Sarim), on
 *    wadi_tarfan_l 100% and 100% / 100.0% (the KDF wins every raid); `points` on wadi_tarfan 88.9% and 93.8% / 15.3% and 17.7%
 *    (Sarim; the two forces annihilate each other first), on tel_marum 72.9% and 94.8% / 24.3% and 4.9% (Sarim). The full table,
 *    with the fitting reads and the levers screened, is in the PR that added this list.
 *
 *  Absent maps and absent hosts are not offered, and the Worker answers 400 for them (`winModeRequest`). */
export const WIN_MODE_FAIR_FACTION_CELLS: Readonly<Record<WinMode, Readonly<Record<string, readonly ('kdf' | 'sarim')[]>>>> = {
  camp: {},
  points: {},
  flag: {},
};

/** Whether `map` is one `mode` has been read fair on in `matchup` (the lobby's question): the mirror reads
 *  `WIN_MODE_FAIR_MAPS`, a faction pairing `WIN_MODE_FAIR_FACTION_CELLS` by the host's faction. */
export function winModeAllowed(mode: WinMode, map: string, matchup: Matchup = 'mirror'): boolean {
  if (matchup === 'mirror') return WIN_MODE_FAIR_MAPS[mode].includes(map);
  const cells = WIN_MODE_FAIR_FACTION_CELLS[mode];
  return Object.hasOwn(cells, map) && cells[map].includes(matchup);
}

/** Whether any lobby offers `mode` at all: on some map in the mirror, or in some faction cell. A tool that is TOLD a mode
 *  (`pnpm bot --mode`) can refuse one no room can play (flag was such a mode from GH-1139 to its relist, GH-976, 12 Nov). */
export function winModeOpen(mode: WinMode): boolean {
  return WIN_MODE_FAIR_MAPS[mode].length > 0 || Object.values(WIN_MODE_FAIR_FACTION_CELLS[mode]).some((hosts) => hosts.length > 0);
}

/** A win mode from anything a client sent: unknown reads as none (annihilation). */
export function winModeField(v: unknown): WinMode | undefined {
  return WIN_MODES.find((m) => m === v);
}

/** The modes a lobby offers for `map` in a `matchup`, in `WIN_MODES` order: those read fair on that map in that pairing
 *  (GH-976 P2, P4): the mirror's table, or the faction cell of the host's side. Annihilation, the default, is not
 *  listed: every room can play it. */
export function winModesOffered(map: string, matchup: Matchup = 'mirror'): readonly WinMode[] {
  return WIN_MODES.filter((m) => winModeAllowed(m, map, matchup));
}

/** What a create request asked for, judged: `mode` is the win mode to play (undefined: annihilation), or `refused`
 *  names why the room must not be made. The Worker's route and its room both ask this one question, so they cannot
 *  disagree. Absent, null and the string `annihilation` are annihilation; anything else must be a mode that
 *  `winModesOffered` lists for this map and matchup (GH-976 P4: a KDF-v-Sarim room asks the faction table of its host's
 *  side). A sandbox room takes no mode. */
export type WinModeRequest = { mode: WinMode | undefined; refused?: undefined } | { mode?: undefined; refused: string };
export function winModeRequest(v: unknown, room: { mode: 'sandbox' | 'versus'; map: string; matchup: Matchup }): WinModeRequest {
  if (v === undefined || v === null || v === 'annihilation') return { mode: undefined };
  const mode = winModeField(v);
  if (mode === undefined) return { refused: 'unknown win mode' };
  if (room.mode !== 'versus') return { refused: 'win mode is for versus rooms' };
  if (!winModeAllowed(mode, room.map, room.matchup)) return { refused: room.matchup === 'mirror' ? 'win mode not offered on this map' : 'win mode not offered on this map for this matchup' };
  return { mode };
}

export type Pace = { kind: 'realtime' } | { kind: 'paced'; roundTicks: number; roundWallMs: number };

export interface MatchConfig {
  matchId: string;
  code: string;
  seed: number;
  map: string;
  mode: 'sandbox' | 'versus';
  seats: [SeatConfig, SeatConfig];
  pace: Pace;
  hashEveryTicks: number;
  bufferTicks: number;
  build: string;
  /** Minted 0 by the room and kept for wire compatibility; NOT folded into
   *  any hash since ruling L4 (N2-P3). Each client folds the digest of its
   *  OWN content instead (`packages/app/src/net/content-digest.ts`): a number
   *  the room hands both seats alike cannot tell them apart. */
  dataDigest: number;
  /** Frame ticks between snapshots, a multiple of `hashEveryTicks`. Absent or
   *  0 is off. The room mints it (snapshot spec §4.2); a config persisted
   *  before the field existed reads as off. */
  snapshotEveryTicks?: number;
  /** GH-976: the win mode a versus room plays, when it plays one. Absent is annihilation and changes nothing
   *  about the room. A mode room runs a goals-only runtime, mirror included, with production off
   *  (`economyRoom` is false for it); the match ends on the goal, annihilation or the cap (`outcome.ts`). */
  winMode?: WinMode;
  /** GH-976 v2: a flag room that plays the SET-UP rules (the staged `flag_setup` block, a 3:00 set-up, a 30-minute cap). Minted by the
   *  Worker alone, from `FLAG_SETUP_MAPS` and the room's `winMode` -- never from a client value. Strictly `true` or absent
   *  (`validateConfig`); absent is today's flag raid, byte for byte. */
  flagSetup?: true;
}

/** The cadence the room mints, in frame ticks: one a minute at 20 Hz (D2). */
export const SNAPSHOT_EVERY_TICKS = 1200;
/** The largest cadence a config may carry: one an hour at 20 Hz. */
export const SNAPSHOT_EVERY_TICKS_MAX = 72_000;

/** A config's snapshot cadence in frame ticks; 0 means off. */
export function snapshotEvery(c: Pick<MatchConfig, 'snapshotEveryTicks'>): number {
  return c.snapshotEveryTicks ?? 0;
}

/** Whether frame `tick` is a snapshot tick for cadence `every`: the last tick
 *  of each interval, so tick 1199 for 1200 (the state AFTER that tick's frame
 *  is what a snapshot holds). Off (`every` <= 0) is never a snapshot tick. */
export function isSnapshotTick(tick: number, every: number): boolean {
  return every > 0 && tick >= 0 && (tick + 1) % every === 0;
}

/** What the host of a versus room picks (2026-10-14, the quick version before
 *  N3): `mirror` is KDF against KDF, as every room was before; `kdf` and
 *  `sarim` are the HOST's faction, and the guest gets the other. */
export type Matchup = 'mirror' | 'kdf' | 'sarim';
export const MATCHUPS: readonly Matchup[] = ['mirror', 'kdf', 'sarim'];

/** A matchup from anything a client sent: unknown reads as the mirror. */
export function matchupField(v: unknown): Matchup {
  return v === 'kdf' || v === 'sarim' ? v : 'mirror';
}

/** Each SEAT's faction for a matchup (index 0 is the host's seat). */
export function factionsOfMatchup(m: Matchup): [Faction, Faction] {
  if (m === 'kdf') return ['kdf', 'sarim'];
  if (m === 'sarim') return ['sarim', 'kdf'];
  return ['kdf', 'kdf'];
}

/** Each SEAT's sim side for a pair of seat factions (LD1, N3 Task 2): in a
 *  KDF-vs-Sarim pairing the KDF seat is side 0 and the Sarim seat side 1,
 *  whichever seat hosts; in a mirror (or a sandbox room's KDF pair) seat s is
 *  side s, as every room was before. Where a side STANDS is the seat's, not
 *  the side's (`endOfSeat`): a Sarim host is side 1 at the friendly end. */
export function sidesOfFactions(f: readonly [Faction, Faction]): [0 | 1, 0 | 1] {
  return f[0] !== f[1] && f[0] === 'sarim' ? [1, 0] : [0, 1];
}

/** Each SEAT's sim side for a host's matchup: `sidesOfFactions` of `factionsOfMatchup`. */
export function sidesOfMatchup(m: Matchup): [0 | 1, 0 | 1] {
  return sidesOfFactions(factionsOfMatchup(m));
}

/** Whether a room plays on the skirmish economy (N3 Task 3, Q1): a versus room
 *  whose two seats field different factions. Such a room builds a
 *  `MissionRuntime` (camps, purses, doctrine menus, income zones); a mirror
 *  room -- KDF against KDF -- keeps today's placed-force match and builds none. */
export function economyRoom(config: Pick<MatchConfig, 'mode' | 'seats' | 'winMode'>): boolean {
  // GH-976: a win-mode room plays goals, not an economy, whoever the two factions are.
  return config.mode === 'versus' && config.seats[0].faction !== config.seats[1].faction && config.winMode === undefined;
}

/** Where a seat's force spawns: the host (seat 0) on the map's `friendly`
 *  anchor, the guest on `hostile` -- by SEAT, never by side, so picking Sarim
 *  does not move the host's end (LD1, N3 Task 2). */
export type SpawnEnd = 'friendly' | 'hostile';
export function endOfSeat(seat: Seat): SpawnEnd {
  return seat === 0 ? 'friendly' : 'hostile';
}

/** The maps a versus room is offered on (the lead's ruling on #561,
 *  2026-10-14, "Limit, then fix"): the two the versus probe measured close to
 *  even in a mirror match (#589, `pnpm versus:probe`). On
 *  `beit_sahwan_outskirts` the west spawn's Lavis once survived 75% of the
 *  time against 15% for the east -- terrain, not side logic -- so a map
 *  nobody has measured is not a fair contest. The lobby offers only these
 *  (`versusMaps`) and the route and the room both refuse any other with a 400
 *  before a room exists (`versusMapAllowed`); a sandbox room, two humans on
 *  one side, has no contest to be fair about and is not limited.
 *
 *  A further map re-opens only after its per-map fair start points are
 *  authored and measured within 60/40 at 48 seeds per spawn order. The two
 *  dedicated versus maps (2026-10-14) are those: point-symmetric, with their
 *  seats named `versus_0`/`versus_1` and read by name (`sandboxAnchors`), and
 *  the probe's mirror read at 48 seeds is wadi_tarfan west 22 / east 25 /
 *  1 draw and milh_flats 24 / 24. wadi_tarfan's room seats moved to
 *  `VERSUS_SEATS` in GH-769 (mirror at 96 seeds: west 45 / east 51).
 *
 *  `beit_sahwan_outskirts`' room seats are no longer the heuristic's: after
 *  PR #721 the mirror read west 38 / east 10 there, and its measured seats
 *  live in `VERSUS_SEATS` (packages/app/src/net/versus-seats.ts). */
export const VERSUS_FAIR_MAPS: readonly string[] = ['beit_sahwan_outskirts', 'tel_marum', 'wadi_tarfan', 'milh_flats', 'rujm_sawda', 'wadi_tarfan_l', 'milh_flats_l'];

// The large 80x80 map (GH-913 L8) joins as a MIRROR-ONLY map, the lead's ruling of 1 Nov: its mirror was
// accepted at the shipped seat (12,12) on the 576-seed reading (west 52.3%), while its KDF-vs-Sarim cells
// read KDF 66-74% and the tunnels cell about 96%, so it is in `FACTION_MATCHUP_MAPS` never. Opened after
// the ground and decor chunking (PR 932) and a frame re-check on high. Formations are open on it since its own S4 run of 3 Nov (GH-913): mirror cell, 0 TRIP of 3.
//
// The large 96x96 Wadi Tarfan (GH-920 B7) joins for the mirror AND both faction cells (it is in
// `FACTION_MATCHUP_MAPS` too): B4 read every offered cell at its shipped seats (20,20)/(75,75) inside 60/40 on held-out
// seeds (set C, 4000-4287, 288 seeds a cell; the lead's ruling of 2 Nov: fair at its seats, the one-tile seat
// neighbourhood is a report, not a gate). Formations are open on it since 7 Nov (GH-859): its S4 run of 3 Nov tripped one cell of 21, the 6 Nov re-run none of 21.
//
// The large 96x96 Milh Flats (GH-920 B7) joins as a MIRROR-ONLY map, like its 48x48 original, and is in
// `FACTION_MATCHUP_MAPS` never: B4 read only the mirror cells at its seats (20,75)/(75,20), KDF v KDF 50.0% pooled over
// 480 seeds (49.7% on the held-out 4000-4287), Sarim v Sarim 55.4% (report only). Formations are open on it since its own S4 run of 3 Nov (GH-913): mirror cell, 0 TRIP of 3.

/** Whether a versus room may be hosted on `map`. */
export function versusMapAllowed(map: string): boolean {
  return VERSUS_FAIR_MAPS.includes(map);
}

/** The maps a KDF-vs-Sarim matchup is offered on (the lead's ruling,
 *  2026-10-14): Tel Marum -- the map the versus probe balanced the Sarim
 *  force on -- and Wadi Tarfan, which was opened on a 48-seed reading inside
 *  sampling noise; at 96 seeds it read outside (GH-769), and it now stands on
 *  measured seats (10,10)/(37,37) in `VERSUS_SEATS` with every tunnel route at
 *  capacity 3 (GH-945; before it, seats (11,11)/(36,36) and capacities 1 / 2 and 1 / 3, GH-421 and GH-560), reading within 60/40 at 384 seeds (placed Sarim-friendly about 56 pooled over 768, unchanged by GH-945) on placed force, economy and
 *  tunnel cell 3 in both spawn orders. Milh Flats is NOT here: Sarim on the west seat lost 33 of 48
 *  (KDF 68.8%), so it is a mirror-only map. The mirror plays on the fair maps
 *  (`VERSUS_FAIR_MAPS`); a non-mirror pairing is narrower still. The lobby
 *  offers no other pairing and the room refuses one (`matchupAllowed`). */
export const FACTION_MATCHUP_MAPS: readonly string[] = ['tel_marum', 'wadi_tarfan', 'wadi_tarfan_l'];

/** The match cap, in minutes, of a room on a map whose rules file says more than the default (GH-913 L8).
 *  A TWIN of `cap_minutes` in data/versus/<map>.json, kept here because the Worker imports @lions/net and
 *  not @lions/data (it would pull every map into the bundle for one number).
 *  `tools/src/validate_versus_rules.test.ts` holds this table to every rules file, both ways. */
export const MAP_CAP_MINUTES: Readonly<Record<string, number>> = { rujm_sawda: 35, wadi_tarfan_l: 35, milh_flats_l: 35 };

/** GH-976 v2: the maps a FLAG room plays the set-up rules on: the five with a staged `flag_setup` block, the same five
 *  `WIN_MODE_FAIR_MAPS.flag` lists (the lead's ruling of 12 Nov; change both together). Read at CALL time (`flagSetupFor`), so a
 *  test may stand a map in it. */
export const FLAG_SETUP_MAPS: readonly string[] = ['wadi_tarfan', 'milh_flats', 'rujm_sawda', 'wadi_tarfan_l', 'milh_flats_l'];

/** The flag match cap, in minutes, of a set-up room on every map, set-up included. A TWIN of `FLAG_SETUP_CAP_MINUTES` in
 *  @lions/data (the Worker imports net and not data), held to it by `tools/src/validate_versus_modes.test.ts`. */
export const FLAG_SETUP_CAP_MINUTES = 30;

/** What the Worker mints into a room's config: `true` for a FLAG room on a map in `FLAG_SETUP_MAPS`, else undefined. The one place the
 *  rule lives; the lobby asks it too, to read the hold a room will play. */
export function flagSetupFor(map: string, winMode: WinMode | null | undefined): true | undefined {
  return winMode === 'flag' && FLAG_SETUP_MAPS.includes(map) ? true : undefined;
}

/** Whether a config plays the flag set-up rules: a FLAG room carrying `flagSetup: true`. */
export function flagSetupRoom(c: Pick<MatchConfig, 'winMode' | 'flagSetup'>): boolean {
  return c.winMode === 'flag' && c.flagSetup === true;
}

/** The match cap every map has unless `MAP_CAP_MINUTES` says more: 25 minutes. */
export const MATCH_CAP_MINUTES_DEFAULT = 25;

/** The cap of a room on `map`, in minutes. */
export function matchCapMinutes(map: string | null | undefined): number {
  if (map === null || map === undefined) return MATCH_CAP_MINUTES_DEFAULT;
  return Object.hasOwn(MAP_CAP_MINUTES, map) ? MAP_CAP_MINUTES[map] : MATCH_CAP_MINUTES_DEFAULT;
}

/** The cap of a room on `map`, in 20 Hz ticks (`outcomeOf` decides a standing match here). */
export function matchCapTicks(map: string | null | undefined): number {
  return matchCapMinutes(map) * 60 * 20;
}

/** The slice of a config the cap is read from. */
export type CapConfig = Pick<MatchConfig, 'map' | 'winMode' | 'flagSetup'>;

/** The cap of a ROOM, in minutes: `FLAG_SETUP_CAP_MINUTES` in a set-up room, else the map's (GH-976 R0.8). Every site that holds a config reads this. */
export function matchCapMinutesOf(c: CapConfig): number {
  return flagSetupRoom(c) ? FLAG_SETUP_CAP_MINUTES : matchCapMinutes(c.map);
}

/** The cap of a ROOM, in 20 Hz ticks: 30 minutes in a set-up room, else `matchCapTicks(map)`. */
export function matchCapTicksOf(c: CapConfig): number {
  return matchCapMinutesOf(c) * 60 * 20;
}

/** The most command JSON characters one room stores, both seats together (GH-913 L8). The Worker's
 *  `MAX_LOG_CMD_CHARS` was written for the 25-minute cap; a longer match gets proportionally more, so a
 *  heavy pair (120 orders a minute a seat, 30 ids each: 87% of the old cap at 35 minutes) cannot void it.
 *  Whole characters: `base` x cap / 25, so 2,800,000 at 35 minutes. */
export function maxLogCmdChars(room: string | null | undefined | CapConfig, base: number): number {
  const minutes = typeof room === 'object' && room !== null ? matchCapMinutesOf(room) : matchCapMinutes(room);
  return Math.floor((base * minutes) / MATCH_CAP_MINUTES_DEFAULT);
}

/** Whether `m` may be played on `map`, among the maps a room is offered on at
 *  all: the mirror anywhere, a KDF-vs-Sarim pairing on `FACTION_MATCHUP_MAPS`.
 *  Whether the map is offered is `versusMapAllowed`'s question, asked beside it. */
export function matchupAllowed(m: Matchup, map: string): boolean {
  return m === 'mirror' || FACTION_MATCHUP_MAPS.includes(map);
}

/** Whether `v` is a faction pair, by seat. */
export function isFactionPair(v: unknown): v is [Faction, Faction] {
  return Array.isArray(v) && v.length === 2 && v.every((f) => f === 'kdf' || f === 'sarim');
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Bounds on a seat's `tiers`, so a config read back from a replay or the
 *  room's own storage is bounded as well as the client's message is. The
 *  shipped kit is 19 KDF types with at most 3 tracks of at most 3 tiers each;
 *  every bound sits at three times that or more, so it never refuses a real
 *  claim, and `packages/worker/src/match/kit-tracks.test.ts` fails if the
 *  shipped tracks ever outgrow one of them. */
export const TIERS_MAX_TYPES = 64;
export const TIERS_MAX_TRACKS = 8;
export const TIERS_MAX_TIER = 16;
/** `tiers` is `{ typeId: { track: n } }` with every leaf an integer in
 *  0..TIERS_MAX_TIER, at most TIERS_MAX_TYPES ids and TIERS_MAX_TRACKS tracks
 *  an id. Own enumerable keys only (`Object.keys`/`Object.entries`), and no
 *  key at either level may be `__proto__`, `constructor` or `prototype`:
 *  JSON.parse makes each an OWN key, which any later spread or assignment
 *  copy turns into a prototype or an inherited read. No shipped type id or
 *  track carries one of those names. */
const RESERVED_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
function isTiers(v: unknown): v is Record<string, Record<string, number>> {
  if (!isRecord(v) || Object.keys(v).length > TIERS_MAX_TYPES) return false;
  return Object.entries(v).every(([id, t]) => !RESERVED_KEYS.has(id) && isRecord(t) &&
    Object.keys(t).length <= TIERS_MAX_TRACKS &&
    Object.entries(t).every(([track, n]) => !RESERVED_KEYS.has(track) && isInt(n) && n >= 0 && n <= TIERS_MAX_TIER));
}

function isSeatConfig(v: unknown, seat: Seat): v is SeatConfig {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return s.seat === seat && (s.side === 0 || s.side === 1) && (s.faction === 'kdf' || s.faction === 'sarim') &&
    (s.kit === 'matched' || s.kit === 'brigade') && isTiers(s.tiers) &&
    Array.isArray(s.unlocks) && s.unlocks.length <= SPECIALS_MAX && s.unlocks.every(isStr) &&
    isStr(s.player) && isStr(s.callsign) && (s.kind === 'human' || s.kind === 'bot');
}

function isPace(v: unknown): v is Pace {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  if (p.kind === 'realtime') return true;
  return p.kind === 'paced' && isInt(p.roundTicks) && p.roundTicks > 0 && isInt(p.roundWallMs) && p.roundWallMs > 0;
}

export function validateConfig(v: unknown): MatchConfig | null {
  if (typeof v !== 'object' || v === null) return null;
  const c = v as Record<string, unknown>;
  if (!isStr(c.matchId) || !isStr(c.code) || !isInt(c.seed) || !isStr(c.map)) return null;
  if (c.mode !== 'sandbox' && c.mode !== 'versus') return null;
  if (!Array.isArray(c.seats) || c.seats.length !== 2 || !isSeatConfig(c.seats[0], 0) || !isSeatConfig(c.seats[1], 1)) return null;
  if (!isPace(c.pace) || !isInt(c.hashEveryTicks) || c.hashEveryTicks < 1 || !isInt(c.bufferTicks) || c.bufferTicks < 0) return null;
  if (!isStr(c.build) || !isInt(c.dataDigest)) return null;
  if (c.winMode !== undefined && (c.mode !== 'versus' || winModeField(c.winMode) === undefined)) return null;
  // GH-976 R0.25: strictly `true`, and only in a flag room. `1`, `'true'` and `false` are refused, not coerced.
  if (c.flagSetup !== undefined && (c.flagSetup !== true || c.winMode !== 'flag')) return null;
  if (c.snapshotEveryTicks !== undefined) {
    const e = c.snapshotEveryTicks;
    if (!isInt(e) || e < 0 || e > SNAPSHOT_EVERY_TICKS_MAX || (e !== 0 && e % c.hashEveryTicks !== 0)) return null;
  }
  return c as unknown as MatchConfig;
}

/** Standard 32-bit FNV-1a over UTF-8 bytes: the data digest of the JSON a
 *  build ships (spec §2.1), computed the same way in a browser and in Node. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5 | 0;
  const bytes = new TextEncoder().encode(s);
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 16777619);
  return h | 0;
}
