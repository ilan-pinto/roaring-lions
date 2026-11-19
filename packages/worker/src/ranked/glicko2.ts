/** GH-1399 slice K1: the ranked rating maths, pure (spec `2026-11-17-ranked-queue-design.md` §1.2 to §1.5, lead rulings Q2,
 *  Q3 of 19 Nov 2026). Glicko-2 as Glickman's note "Example of the Glicko-2 system" states it, with the design's settings and
 *  its two additions: a weight per game (§1.4) and an advantage term per cell (§1.4, 0 for every mirror cell). Plus the idle
 *  RD term (§1.2) and the visible rank (§1.5): `r - 2*RD`, a band id only, after 10 placement games.
 *
 *  This is the Worker, not `@lions/sim`: ordinary JavaScript doubles are allowed (§1.4). It is deterministic all the same:
 *  no clock, no randomness, no I/O, no table, no binding. Time arrives as a parameter (epoch ms).
 *
 *  NOT REACHABLE (Q19): ranked opens only after the relay cut, so nothing outside `ranked/` may import this file
 *  (`ranked-fence.test.ts`). Band ids, never copy: the labels are K6's, through `t('ranked.band.<id>')`. */

/** Glickman's scale factor between the Glicko and Glicko-2 scales (his literal, not 400/ln 10). */
export const GLICKO2_SCALE = 173.7178;
/** §1.2: a new member's rating, deviation and volatility. */
export const R0 = 1500;
export const RD0 = 350;
export const SIGMA0 = 0.06;
/** §1.2: the system constant (Glickman's middle value). */
export const TAU = 0.5;
/** §1.2: RD is capped at 350 and floored at 45, after every update and after the idle term. */
export const RD_MIN = 45;
export const RD_MAX = 350;
/** §1.2: idle RD growth, rating points per square-root day. */
export const IDLE_C = 14.4;
export const DAY_MS = 86_400_000;
/** §1.5: rated games before a visible rank. */
export const PLACEMENT_GAMES = 10;
/** Glickman's convergence tolerance for the volatility root find (step 5). */
const EPSILON = 0.000001;
/** A backstop on the root find; Glickman's example converges in under ten. */
const MAX_ITER = 100;

export interface Rating {
  /** The rating, Glicko scale (1500-centred). */
  r: number;
  /** The rating deviation, Glicko scale. */
  rd: number;
  /** The volatility. */
  sigma: number;
}

/** One game of a rating period, from the rated player's side. */
export interface Game {
  /** The opponent's rating and RD as used (after their own idle term). */
  opp: { r: number; rd: number };
  /** 1 a win, 0.5 a draw, 0 a loss. */
  score: 0 | 0.5 | 1;
  /** §1.4: in [0, 1]. Both sums of the update are multiplied by it; 0 changes nothing. */
  weight: number;
  /** §1.4: the cell's advantage term for THIS player, in rating points: +a for the side the cell favours, -a for the other,
   *  0 in a mirror cell. See `advantageFor`. */
  adv: number;
}

export const clampRd = (rd: number): number => Math.min(RD_MAX, Math.max(RD_MIN, rd));

const g = (phi: number): number => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));

function check(cond: boolean, what: string): void {
  if (!cond) throw new RangeError(`glicko2: ${what}`);
}
function checkRating(x: { r: number; rd: number }, who: string): void {
  check(Number.isFinite(x.r), `${who} r is not finite`);
  check(Number.isFinite(x.rd) && x.rd > 0, `${who} rd must be finite and > 0`);
}

/** Glicko-2 over one rating period of any number of games: Glickman's steps 1 to 8, with each game's two sums multiplied by
 *  its weight and its expected score shifted by its advantage term. Production rates ONE game a period (§1.2, `rateGame`);
 *  the multi-game form is here because it is Glickman's own example, the independent oracle of K1-a.
 *  A period whose games all weigh 0 returns the player unchanged (the limit would still grow RD by the volatility, and §1.4
 *  says weight 0 "changes nothing"). The RD out is clamped to [45, 350]. */
export function ratePeriod(self: Rating, games: readonly Game[], tau: number = TAU): Rating {
  checkRating(self, 'self');
  check(Number.isFinite(self.sigma) && self.sigma > 0, 'self sigma must be finite and > 0');
  check(Number.isFinite(tau) && tau > 0, 'tau must be finite and > 0');
  for (const gm of games) {
    checkRating(gm.opp, 'opp');
    check(gm.score === 0 || gm.score === 0.5 || gm.score === 1, 'score must be 0, 0.5 or 1');
    check(Number.isFinite(gm.weight) && gm.weight >= 0 && gm.weight <= 1, 'weight must be in [0, 1]');
    check(Number.isFinite(gm.adv), 'adv is not finite');
  }
  const live = games.filter((gm) => gm.weight > 0);
  if (live.length === 0) return { r: self.r, rd: self.rd, sigma: self.sigma };

  // Step 2: to the Glicko-2 scale.
  const mu = (self.r - R0) / GLICKO2_SCALE;
  const phi = self.rd / GLICKO2_SCALE;

  // Steps 3 and 4: the estimated variance v and the improvement delta, each sum weighted (§1.4).
  let vInv = 0;
  let sum = 0;
  for (const gm of live) {
    const muJ = (gm.opp.r - R0) / GLICKO2_SCALE;
    const gJ = g(gm.opp.rd / GLICKO2_SCALE);
    const a = gm.adv / GLICKO2_SCALE;
    const e = 1 / (1 + Math.exp(-gJ * (mu + a - muJ)));
    vInv += gm.weight * gJ * gJ * e * (1 - e);
    sum += gm.weight * gJ * (gm.score - e);
  }
  const v = 1 / vInv;
  const delta = v * sum;

  // Step 5: the new volatility, by the Illinois algorithm.
  const aLn = Math.log(self.sigma * self.sigma);
  const phi2 = phi * phi;
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const d = phi2 + v + ex;
    return (ex * (delta * delta - phi2 - v - ex)) / (2 * d * d) - (x - aLn) / (tau * tau);
  };
  let A = aLn;
  let B: number;
  if (delta * delta > phi2 + v) {
    B = Math.log(delta * delta - phi2 - v);
  } else {
    let k = 1;
    while (f(aLn - k * tau) < 0 && k < MAX_ITER) k += 1;
    B = aLn - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  for (let i = 0; Math.abs(B - A) > EPSILON && i < MAX_ITER; i += 1) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  const sigma = Math.exp(A / 2);

  // Steps 6 and 7: the pre-period RD, then the new RD and rating.
  const phiStar = Math.sqrt(phi2 + sigma * sigma);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * sum;

  // Step 8: back to the Glicko scale; the RD clamp of §1.2.
  return { r: GLICKO2_SCALE * muNew + R0, rd: clampRd(GLICKO2_SCALE * phiNew), sigma };
}

/** §1.2, the production shape: one game, one rating period. */
export function rateGame(self: Rating, game: Game): Rating {
  return ratePeriod(self, [game]);
}

/** §1.2: whole and fractional days since the last rated game; 0 before the first game or for a clock that runs backwards. */
export function idleDays(lastGameAt: number | null, now: number): number {
  if (lastGameAt === null) return 0;
  check(Number.isFinite(lastGameAt) && Number.isFinite(now), 'times must be finite');
  return Math.max(0, (now - lastGameAt) / DAY_MS);
}

/** §1.2: `RD* = min(350, sqrt(RD^2 + c^2 * days))`, c = 14.4. It replaces Glicko-2's per-period volatility growth for idle
 *  time, because with one game per period an idle player has no empty periods. Applied before each update, and at read time
 *  for the visible rank (§1.5). Clamped to [45, 350]. */
export function idleRd(rd: number, lastGameAt: number | null, now: number): number {
  const days = idleDays(lastGameAt, now);
  return clampRd(Math.sqrt(rd * rd + IDLE_C * IDLE_C * days));
}

/** A member's ranked state, as `ranked_member` holds it (§4.1). */
export interface RankedState extends Rating {
  /** Every rated game ever: placement and the visible rank read it. */
  gamesTotal: number;
  /** Epoch ms of the last rated game, or null before the first. */
  lastGameAt: number | null;
}

/** One rated game at time `now`, both players' RD inflated by their idle time first (§1.2: the journal's `rd_before` and
 *  `opp_rd` are these inflated values, "the RD the update used"). `before` is what the update used; `after` is the result.
 *  At weight 0, `after` equals `before`. */
export function rateAt(
  self: RankedState,
  opp: { r: number; rd: number; lastGameAt: number | null },
  game: { score: 0 | 0.5 | 1; weight: number; adv: number },
  now: number,
): { before: Rating; opp: { r: number; rd: number }; after: Rating } {
  const before: Rating = { r: self.r, rd: idleRd(self.rd, self.lastGameAt, now), sigma: self.sigma };
  const oppUsed = { r: opp.r, rd: idleRd(opp.rd, opp.lastGameAt, now) };
  return { before, opp: oppUsed, after: rateGame(before, { opp: oppUsed, ...game }) };
}

/** §1.4 and §5.1: the n-th rated game between the same two members within 7 days has weight 0.5^(n-1): 1, 0.5, 0.25, ... */
export function repeatWeight(n: number): number {
  check(Number.isInteger(n) && n >= 1, 'n must be an integer >= 1');
  return 0.5 ** (n - 1);
}

/** §1.4 and §3.4: a cell is a map, a room kind and which faction holds which seat. A mirror cell has no advantage term; a
 *  faction cell carries `adv` rating points for the seat it favours. Season 1 is mirror only (Q5). */
export type Cell = { kind: 'mirror' } | { kind: 'faction'; adv: number; favours: 0 | 1 };

/** The advantage term for `seat` in `cell`, in rating points: 0 in a mirror cell; +adv for the favoured seat and -adv for the
 *  other, so the two seats' terms always sum to 0. */
export function advantageFor(cell: Cell, seat: 0 | 1): number {
  if (cell.kind === 'mirror') return 0;
  check(Number.isFinite(cell.adv), 'adv is not finite');
  return seat === cell.favours ? cell.adv : -cell.adv;
}

/** §1.5: the conservative estimate `r - 2*RD`, in rating points. SERVER-SIDE ONLY (`ranked_member.best_shown` stores it in
 *  whole points): Q3 rules the number is never shown, to the player or anyone else. */
export function conservativeRating(r: number, rd: number): number {
  return r - 2 * rd;
}

/** The band ids, lowest first. Copy is K6's (`t('ranked.band.<id>')`). */
export const BAND_IDS = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'] as const;
export type BandId = (typeof BAND_IDS)[number];
/** The lower edge of b2 .. b6 in whole points of `r - 2*RD`: a value AT an edge belongs to the band above it. The doc names
 *  bands but sets no edges, so these are starting values (HOLD FOR LEAD), chosen against §1.3's numbers: a 1500 player leaves
 *  placement near 1500 - 2*108 = 1284 (b3), and an established 1500 at the steady RD of about 60 shows 1380 (b3, near b4). */
export const BAND_EDGES = [1100, 1250, 1400, 1550, 1700] as const;

/** The band of a whole-point conservative rating. */
export function bandOf(shown: number): BandId {
  check(Number.isFinite(shown), 'shown is not finite');
  let i = 0;
  while (i < BAND_EDGES.length && shown >= BAND_EDGES[i]) i += 1;
  return BAND_IDS[i];
}

/** What a member may be shown (§1.5, Q3): "Placement n of 10" before 10 rated games, then a band only. Never the number.
 *  The RD is the idle-inflated one at `now`, so idling lowers the band and play restores it, with no write and no cron. */
export type RankView = { kind: 'placement'; played: number; of: typeof PLACEMENT_GAMES } | { kind: 'band'; band: BandId };

/** Whole points of `r - 2*RD*` at `now`, or null during placement: the value `best_shown` would store. Server-side only. */
export function shownRating(s: RankedState, now: number): number | null {
  check(Number.isInteger(s.gamesTotal) && s.gamesTotal >= 0, 'gamesTotal must be an integer >= 0');
  if (s.gamesTotal < PLACEMENT_GAMES) return null;
  return Math.floor(conservativeRating(s.r, idleRd(s.rd, s.lastGameAt, now)));
}

export function rankView(s: RankedState, now: number): RankView {
  const shown = shownRating(s, now);
  if (shown === null) return { kind: 'placement', played: s.gamesTotal, of: PLACEMENT_GAMES };
  return { kind: 'band', band: bandOf(shown) };
}
