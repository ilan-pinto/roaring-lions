/**
 * The tools a model drives the headless client with (N4a task 8, spec §8.3):
 * what `pnpm agent` registers on its stdio MCP server, one scope's worth.
 *
 * Every tool answers JSON text. An acting tool answers what was accepted, or
 * why not: `queue_full`, `not your unit`, `not a contact`, `unknown verb`,
 * `off the map`, `invalid`, `not in this scope`, `match over`,
 * `not available against a human seat`, and, for the four production verbs the
 * economy runtime would set aside (GH-954), `refused` with the runtime's reason. The pre-check
 * runs ownership's own `validateCommand` on the harness's world, and it is
 * ADVISORY: the authoritative drop is `applyFrame`'s, on both machines, and
 * the order ledger reports it (`dropped`).
 *
 * Nothing here reads past the seat's fog: `observe` is `sideView` (the
 * renderer's own predicates with this seat's fog), and every id an order
 * record would name is shown only while the view lists it. Nothing here
 * writes to stdout either: stdout is the MCP protocol channel.
 */
import { COMMAND_KINDS, cleanAdvisorMsg, cleanChat, cleanCommand, type TransportStatus } from '@lions/net';
import { formations } from '@lions/data';
import { AMBUSH_RADIUS_MAX, MAX_LINE_QUEUE, MAX_PATROL_WAYPOINTS, MAX_PRODUCTION_LINES, fx, type Command } from '@lions/sim';
import type { AgentClient } from './agent-client';
import { CRITERIA, CRITERION_IDS, MAX_REASON_CHARS, SCORE_MAX, SCORE_MIN, replyFormat, rubricText, statsGlossary, validateScores, writeScoreFile } from './match-score';
import { productionRefusal } from './economy-view';
import type { OrderRecord } from './order-desk';
import { STANCES, type SideView } from './view';

export type Scope = 'advise' | 'assist' | 'command';
export const SCOPES: readonly Scope[] = ['advise', 'assist', 'command'];

/** `text` is JSON for the model. */
export interface ToolResult { ok: boolean; text: string }

export interface ToolContext {
  client: AgentClient;
  scope: Scope;
  /** Lines received since the last `inbox` call (bounded, oldest dropped). */
  inbox: string[];
  /** An assist advisor's proposals, by id, and what the human made of each. */
  proposals: Map<number, 'pending' | 'accepted' | 'vetoed'>;
  /** The newest paced round this seat has said `done` for; -1 before any. */
  doneRound: number;
  /** The id the next proposal takes. */
  nextProposal: number;
  /** How long `wait` blocks in a lobby; default `LOBBY_WAIT_MAX_MS`. A spec shortens it. */
  lobbyWaitMs?: number;
  /** Whether a tool has yet looked at the started match (the first look has a short grace; see `firstSight`). */
  seen?: boolean;
  /** `pnpm bot` only (GH-973): where an accepted score is written (`--score-file`). Absent: `match_stats` and `submit_score` are not offered. */
  scoreFile?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  scopes: readonly Scope[];
  /** JSON Schema of the arguments object. */
  schema: Record<string, unknown>;
  run(ctx: ToolContext, args: unknown): Promise<ToolResult>;
}

/** The `detail` of an `order` refused for its `formation` alone (GH-859 P1b, M8). */
export const FORMATIONS_CLOSED_IN_VERSUS = 'formations-closed-in-versus';

/**
 * Every command kind `order` does NOT build, and why. The other kinds are `ORDER_VERBS`, so the two lists
 * partition `COMMAND_KINDS` and a kind cannot be in neither by accident (GH-954, D-W8: N2 added `setStance`, `build`
 * and the rest and the old filter, which named the kinds it left out, never noticed). `order-verbs.test.ts` measures
 * which kinds a versus room accepts and fails on one that is neither a verb nor listed here as withheld on purpose.
 * `legal` says whether a versus room accepts the kind: the test checks that the claim is true.
 */
export const ORDER_WITHHELD = {
  // The intel two are priced, cooled down and ranged by the mission runtime, which a room does not run (#559 F1).
  reveal: { legal: false, why: 'intel is a mission runtime\'s; a versus room drops it (#559 F1)' },
  callStrike: { legal: false, why: 'intel is a mission runtime\'s; a versus room drops it (#559 F1)' },
  // Fire support stays OUT of every versus room (LD5), so a verb for it would only ever be refused.
  support: { legal: false, why: 'fire support is dropped in every versus room (LD5)' },
  // Field works (GH-277): the sim's own two never travel (`cleanCommand` refuses them); the client's two are runtime-priced like `build` and dropped in versus.
  construct: { legal: false, why: 'the sim\'s own field-works order never travels (GH-277)' },
  cancelConstruct: { legal: false, why: 'the sim\'s own field-works order never travels (GH-277)' },
  raiseWorks: { legal: false, why: 'field works are priced by the mission runtime and dropped in versus (GH-277)' },
  cancelWorks: { legal: false, why: 'field works are priced by the mission runtime and dropped in versus (GH-277)' },
  // Versus tunnels (GH-681): `observe` shows a seat neither its routes nor its buried units yet, so a model verb would be blind.
  enterTunnel: { legal: true, why: 'observe shows no tunnel routes yet, so a model could not name one (GH-681)' },
  vent: { legal: true, why: 'observe shows no buried units yet, so a model could not name one (GH-681)' },
} as const satisfies Partial<Record<Command['kind'], { legal: boolean; why: string }>>;

type Verb = Exclude<(typeof COMMAND_KINDS)[number], keyof typeof ORDER_WITHHELD>;
/** The verbs `order` builds: every command kind but those in `ORDER_WITHHELD`. */
export const ORDER_VERBS: readonly Verb[] = COMMAND_KINDS.filter((k): k is Verb => !(k in ORDER_WITHHELD));
/** The four production kinds carry no unit ids: they are the seat's side's (GH-954). */
const PRODUCTION_VERBS = ['build', 'cancelBuild', 'setRally', 'clearRally'] as const;
type ProductionVerb = (typeof PRODUCTION_VERBS)[number];
const isProductionVerb = (v: string): v is ProductionVerb => (PRODUCTION_VERBS as readonly string[]).includes(v);
export const WAIT_MAX_TICKS = 200;
/** How often `wait` looks again, and the longest it blocks in wall time. */
export const WAIT_POLL_MS = 10;
export const WAIT_MAX_MS = 60_000;
/** `wait` in a lobby blocks this long for the match to start: the other player may take a while to press Ready. */
export const LOBBY_WAIT_MAX_MS = 600_000;
/** Polls with no frame run, in a room that has ended, before `wait` calls it over. */
const WAIT_STILL_POLLS = 5;
/** An assist advisor remembers this many proposals' fates (the newest). */
export const PROPOSALS_KEPT = 64;
/** The inbox keeps the newest this many lines. */
export const INBOX_MAX = 200;
const ORDER_RECORDS = 10;

const ok = (v: unknown): ToolResult => ({ ok: true, text: JSON.stringify(v) });
const refuse = (error: string, extra: Record<string, unknown> = {}): ToolResult => ({ ok: false, text: JSON.stringify({ error, ...extra }) });

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const argsOf = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
/** A tile's centre, in the sim's Q16.16 world units. */
const tileFx = (t: number): number => fx.from(t + 0.5);

/** A context for `client` in `scope`, with the room's relayed lines wired into its inbox. */
export function createContext(client: AgentClient, scope: Scope): ToolContext {
  const ctx: ToolContext = { client, scope, inbox: [], proposals: new Map(), doneRound: -1, nextProposal: 1 };
  const push = (line: string): void => {
    ctx.inbox.push(line);
    if (ctx.inbox.length > INBOX_MAX) ctx.inbox.splice(0, ctx.inbox.length - INBOX_MAX);
  };
  if (scope === 'command') {
    // The opponent's chat; this seat's own line, echoed back by the room, is not news.
    client.transport.setHooks({ onChat: (seat, text) => { if (seat !== client.seat) push(`seat ${seat}: ${text}`); } });
  } else {
    client.transport.setHooks({
      onAdvisor: (from, a) => {
        if (from !== 'human') return;
        switch (a.kind) {
          case 'text': push(`human: ${a.text}`); return;
          case 'ping': push(`human pinged tile (${a.x}, ${a.y})`); return;
          case 'accept':
          case 'veto':
            if (!ctx.proposals.has(a.id)) return;
            ctx.proposals.set(a.id, a.kind === 'accept' ? 'accepted' : 'vetoed');
            push(`human ${a.kind === 'accept' ? 'accepted' : 'vetoed'} proposal ${a.id}`);
            return;
          case 'proposal': return;
        }
      },
    });
  }
  return ctx;
}

function started(ctx: ToolContext): SideView | null {
  return ctx.client.config() === null ? null : ctx.client.view();
}

function terminal(s: TransportStatus): boolean {
  return s.kind === 'closed' || s.kind === 'desync';
}

/**
 * The refusal for a tool that needs a started match. A room that has ENDED is
 * `match over`, never "not started": a harness respawned after the end hears the
 * room's log and its `ended` before it has built a world, and the model must not
 * read that as a match still to begin (GH-973).
 */
function notStarted(ctx: ToolContext): ToolResult {
  return terminal(ctx.client.transport.status()) ? refuse('match over', { detail: 'the room has ended' }) : refuse('match not started');
}

/** More frames behind than a live match ever is: this client joined a match already under way and is replaying its log. */
export const CATCHUP_TICKS = 40;
/** How long the first look at a match joined mid-way waits for the room's follow-up (an `ended` right behind the log). */
export const FIRST_SIGHT_GRACE_MS = 250;

/**
 * Whether the world is mid-replay, not the match as it stands: an ended room still feeding its log into this client
 * (a respawned harness), or a live one this harness joined under way and is far behind. A fresh match is never this.
 */
function replaying(ctx: ToolContext): boolean {
  const behind = ctx.client.transport.behind();
  return terminal(ctx.client.transport.status()) ? behind > 0 : behind > CATCHUP_TICKS;
}

/**
 * The first look at a match this harness joined UNDER WAY (its log has frames): the room says `ended` right behind
 * the log, and a tool that answered in between would take a finished match for a live one. A fresh match has no frames
 * behind it and is not delayed.
 */
function graceDue(ctx: ToolContext): boolean {
  if (ctx.seen === true || ctx.client.config() === null) return false;
  ctx.seen = true;
  // Joined under way: the log has just arrived, and an `ended` may be right behind it.
  return ctx.client.joinedUnderway() && (ctx.client.transport.behind() > 0 || ctx.client.tick() > 0) && !terminal(ctx.client.transport.status());
}
async function firstSight(ctx: ToolContext): Promise<void> {
  if (graceDue(ctx)) await sleep(FIRST_SIGHT_GRACE_MS);
}

/** Lets a replay finish before a read, bounded, so a model never reads a half-replayed world as the match. */
async function settleReplay(ctx: ToolContext): Promise<void> {
  await firstSight(ctx);
  const deadline = Date.now() + WAIT_MAX_MS;
  let last = ctx.client.tick();
  let still = 0;
  while (replaying(ctx) && Date.now() < deadline) {
    await sleep(WAIT_POLL_MS);
    const now = ctx.client.tick();
    still = now === last ? still + 1 : 0;
    last = now;
    if (still >= WAIT_STILL_POLLS) return;
  }
}

/** Whether an acting tool should answer `match over`. */
function over(ctx: ToolContext): boolean {
  return ctx.client.result() !== null || terminal(ctx.client.transport.status());
}

/** In a paced room, the round this seat's frames have run to and whether the
 *  room is waiting on this seat's `end_round`: this seat sits exactly on a
 *  round's boundary, every frame of a round newer than its last `done` has
 *  run, and nothing more has arrived. The boundary matters: a round the room
 *  released on wall time leaves `finished` ahead of `done` for the whole of
 *  the next round, and the room waits on nobody in the middle of one. */
function roundOf(ctx: ToolContext): { index: number; ticks: number; doneRound: number; finished: number; awaitingEndRound: boolean } | null {
  const pace = ctx.client.config()?.pace;
  if (pace?.kind !== 'paced') return null;
  const tick = ctx.client.tick();
  const finished = Math.floor(tick / pace.roundTicks) - 1;
  const awaitingEndRound = ctx.scope === 'command' && tick % pace.roundTicks === 0 && finished > ctx.doneRound
    && ctx.client.transport.behind() === 0 && !over(ctx);
  return { index: Math.floor(tick / pace.roundTicks), ticks: pace.roundTicks, doneRound: ctx.doneRound, finished, awaitingEndRound };
}

/** An order record as the model sees it: tiles, and only the ids the view lists now. */
function describeOrder(r: OrderRecord, listed: Set<number>): Record<string, unknown> {
  const c = r.cmd as Record<string, unknown>;
  const out: Record<string, unknown> = { ref: r.ref, status: r.status, verb: r.cmd.kind, queuedTick: r.queuedTick, settledTick: r.settledTick };
  if (r.reason !== undefined) out.reason = r.reason;
  if (Array.isArray(c.ids)) {
    const ids = (c.ids as number[]).filter((id) => listed.has(id));
    out.ids = ids;
    if (ids.length < c.ids.length) out.gone = c.ids.length - ids.length;
  }
  if (isInt(c.x) && isInt(c.y)) out.tile = [c.x >> 16, c.y >> 16];
  if (isInt(c.target)) out.target = listed.has(c.target) ? c.target : 'out of sight';
  if (isInt(c.carrier) && listed.has(c.carrier)) out.carrier = c.carrier;
  if (isInt(c.structure)) out.structure = c.structure;
  if (isInt(c.tunnel)) out.tunnel = c.tunnel;
  // GH-954: stance and production orders.
  if (typeof c.stance === 'string') out.stance = c.stance;
  if (Array.isArray(c.waypoints)) out.points = c.waypoints.length;
  if (typeof c.unit === 'string') out.unit = c.unit;
  if (isInt(c.line)) out.line = c.line;
  if (isInt(c.index)) out.index = c.index;
  return out;
}

const observe: ToolDef = {
  name: 'observe',
  description: 'What your seat may know now: your units (id, type, tile, hp %, flags, stance), enemy contacts in sight, held buildings, the legal stances, the score, the clock, the `mode` the match is won by and, in a points race, `points` (both sides\' points, the target, each zone with what it pays a minute and who holds it: public to both seats), and your recent orders (command) or proposals (assist). In a KDF-against-Sarim room also `economy`: your purse, your camps\' production lines (what is building, the queue, the rally point), the menu you may build from (cost, population, build seconds, and `blocked` with the reason when `build` would refuse it now) and your population cap. Tiles, never world units.',
  scopes: SCOPES,
  schema: { type: 'object', properties: {}, additionalProperties: false },
  async run(ctx) {
    await settleReplay(ctx);
    const view = started(ctx);
    if (view === null) return notStarted(ctx);
    const listed = new Set([...view.units.map((u) => u.id), ...view.contacts.map((u) => u.id)]);
    let orders: unknown[] = [];
    if (ctx.scope === 'command') orders = ctx.client.desk.records(ORDER_RECORDS).map((r) => describeOrder(r, listed));
    else if (ctx.scope === 'assist') orders = [...ctx.proposals].slice(-ORDER_RECORDS).map(([proposal, status]) => ({ proposal, status }));
    return ok({ ...view, orders });
  },
};

const status: ToolDef = {
  name: 'status',
  description: 'The tick, the clock, the room link, the result if any and `by` how it was reached (annihilation, objective, stalemate, time, ...), the `mode` the room is won by, the pace and, in a paced room, the round.',
  scopes: SCOPES,
  schema: { type: 'object', properties: {}, additionalProperties: false },
  async run(ctx) {
    await settleReplay(ctx);
    const config = ctx.client.config();
    const view = started(ctx);
    return ok({
      tick: ctx.client.tick(),
      clock: view?.clock ?? null,
      transport: ctx.client.transport.status(),
      result: view?.result ?? null,
      // GH-976 P2: how the result was reached (`objective` for a win mode's goal), and the mode the room plays.
      by: view?.by ?? null,
      mode: view?.mode ?? null,
      pace: config?.pace ?? null,
      round: roundOf(ctx),
      seat: ctx.client.seat,
      side: view?.side ?? null,
      scope: ctx.scope,
    });
  },
};

const sleep = (ms: number): Promise<void> => new Promise((res) => { setTimeout(res, ms); });

const wait: ToolDef = {
  name: 'wait',
  description: `Let the match run: resolves after \`ticks\` (1-${WAIT_MAX_TICKS}) more frames (20 a second), or at once on a result, the room ending, or (command, paced) when the room waits on your end_round. Never longer than ${WAIT_MAX_MS / 1000} s. Before the match has started it blocks (up to ${LOBBY_WAIT_MAX_MS / 60_000} minutes) until it does, because the other player may take a while to press Ready; then it answers \`match not started\`, and you call it again.`,
  scopes: SCOPES,
  schema: { type: 'object', properties: { ticks: { type: 'integer', minimum: 1, maximum: WAIT_MAX_TICKS } }, required: ['ticks'], additionalProperties: false },
  async run(ctx, raw) {
    const a = argsOf(raw);
    if (!isInt(a.ticks) || a.ticks < 1 || a.ticks > WAIT_MAX_TICKS) return refuse('invalid', { detail: `ticks is an integer 1-${WAIT_MAX_TICKS}` });
    if (ctx.client.config() === null) {
      // The lobby: block until the room starts the match (the other player presses Ready), the room closes, or the bound.
      const lobbyDeadline = Date.now() + (ctx.lobbyWaitMs ?? LOBBY_WAIT_MAX_MS);
      while (ctx.client.config() === null) {
        if (terminal(ctx.client.transport.status())) return refuse('match over', { detail: 'the room closed before the match started' });
        if (Date.now() >= lobbyDeadline) return refuse('match not started', { detail: 'still waiting for the other player to press Ready' });
        await sleep(WAIT_POLL_MS);
      }
    }
    const client = ctx.client;
    // Synchronous unless the grace is due: `from` is read at the call, not after a turn that frames can run in.
    if (graceDue(ctx)) await sleep(FIRST_SIGHT_GRACE_MS);
    const from = client.tick();
    const deadline = Date.now() + WAIT_MAX_MS;
    let last = from;
    let still = 0;
    let reason: 'ticks' | 'result' | 'ended' | 'round' | 'timeout';
    for (;;) {
      const now = client.tick();
      still = now === last ? still + 1 : 0;
      last = now;
      if (client.result() !== null) { reason = 'result'; break; }
      // A terminal room whose frames have stopped running (drained, or
      // never to run: a void, a desync): nothing more will come. Asked BEFORE the tick count: a respawned harness
      // that replays an ended room's log has run its ticks by the time it is drained, and 'ended' is the truth.
      if (terminal(client.transport.status()) && (client.transport.behind() === 0 || still >= WAIT_STILL_POLLS)) { reason = 'ended'; break; }
      // ...and a replay (an ended room's log, or a match joined far behind) runs on: the model asks for the match, not for tick 1020 of it.
      if (now - from >= a.ticks && !replaying(ctx)) { reason = 'ticks'; break; }
      // Paced: the room mints nothing more until this seat's `end_round`.
      if (roundOf(ctx)?.awaitingEndRound === true) { reason = 'round'; break; }
      if (Date.now() >= deadline) { reason = 'timeout'; break; }
      await sleep(WAIT_POLL_MS);
    }
    const r = client.result();
    const view = started(ctx);
    return ok({ reason, ran: client.tick() - from, tick: client.tick(), result: r === null ? null : view?.result ?? null });
  },
};

const inbox: ToolDef = {
  name: 'inbox',
  description: 'Lines received since your last call, then cleared: what your human typed, pinged, accepted or vetoed (advise, assist), or the opponent\'s chat (command).',
  scopes: SCOPES,
  schema: { type: 'object', properties: {}, additionalProperties: false },
  async run(ctx) {
    const lines = ctx.inbox.splice(0, ctx.inbox.length);
    return ok({ lines });
  },
};

const say: ToolDef = {
  name: 'say',
  description: 'Say something: to your human in the advisor panel (advise, assist), or in the room chat both seats read (command).',
  scopes: SCOPES,
  schema: { type: 'object', properties: { text: { type: 'string', minLength: 1 } }, required: ['text'], additionalProperties: false },
  async run(ctx, raw) {
    const text = cleanChat(argsOf(raw).text);
    if (text === '') return refuse('invalid', { detail: 'text is empty' });
    if (ctx.client.config() === null) return notStarted(ctx);
    if (over(ctx)) return refuse('match over');
    if (ctx.scope === 'command') ctx.client.transport.chat(text);
    else ctx.client.transport.advisor({ kind: 'text', text });
    return ok({ said: text });
  },
};

const ping: ToolDef = {
  name: 'ping',
  description: 'Mark a tile on your human\'s map.',
  scopes: ['advise', 'assist'],
  schema: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, required: ['x', 'y'], additionalProperties: false },
  async run(ctx, raw) {
    if (ctx.scope === 'command') return refuse('not in this scope');
    const a = argsOf(raw);
    const view = started(ctx);
    if (view === null) return notStarted(ctx);
    if (over(ctx)) return refuse('match over');
    if (!isInt(a.x) || !isInt(a.y)) return refuse('invalid', { detail: 'x and y are integer tiles' });
    if (a.x < 0 || a.y < 0 || a.x >= view.size[0] || a.y >= view.size[1]) return refuse('off the map');
    const msg = cleanAdvisorMsg({ kind: 'ping', x: a.x, y: a.y });
    if (msg === null) return refuse('off the map');
    ctx.client.transport.advisor(msg);
    return ok({ pinged: [a.x, a.y] });
  },
};

type Refused = { error: string; detail?: string };

/**
 * `setStance` (GH-954): `hold` halts and stands, `ambush` halts and holds fire until a target closes to `radius`
 * tiles (default 3), `patrol` walks 2-4 tiles in order and round again. `radius` is the ambush's alone and
 * `waypoints` the patrol's, as `cleanCommand` has it. Whether the seat may send it is `validateCommand`'s.
 */
function stanceOrder(view: SideView, ids: number[], a: Record<string, unknown>): Command | Refused {
  const stance = (STANCES as readonly unknown[]).find((s) => s === a.stance);
  if (stance === undefined) return { error: 'invalid', detail: `setStance needs a stance: one of ${STANCES.join(', ')}` };
  if (stance !== 'ambush' && a.radius !== undefined) return { error: 'invalid', detail: 'radius is for the ambush stance only' };
  if (stance !== 'patrol' && a.waypoints !== undefined) return { error: 'invalid', detail: 'waypoints are for the patrol stance only' };
  if (stance === 'hold') return { kind: 'setStance', ids, stance: 'hold' };
  if (stance === 'ambush') {
    if (a.radius === undefined) return { kind: 'setStance', ids, stance: 'ambush' };
    const max = AMBUSH_RADIUS_MAX >> 16;
    if (!isInt(a.radius) || a.radius < 1 || a.radius > max) return { error: 'invalid', detail: `radius is an integer 1-${max} (tiles)` };
    return { kind: 'setStance', ids, stance: 'ambush', radius: fx.from(a.radius) };
  }
  const wps = a.waypoints;
  if (!Array.isArray(wps) || wps.length < 2 || wps.length > MAX_PATROL_WAYPOINTS) {
    return { error: 'invalid', detail: `a patrol needs waypoints: 2-${MAX_PATROL_WAYPOINTS} tiles, each [x, y]` };
  }
  const waypoints: [number, number][] = [];
  for (const w of wps as unknown[]) {
    if (!Array.isArray(w) || w.length !== 2 || !isInt(w[0]) || !isInt(w[1])) return { error: 'invalid', detail: 'each waypoint is a pair of integer tiles [x, y]' };
    if (w[0] < 0 || w[1] < 0 || w[0] >= view.size[0] || w[1] >= view.size[1]) return { error: 'off the map' };
    waypoints.push([tileFx(w[0]), tileFx(w[1])]);
  }
  return { kind: 'setStance', ids, stance: 'patrol', waypoints };
}

/**
 * The four production verbs (GH-954): `build` a menu unit, `cancelBuild` a queued item, `setRally` and `clearRally`.
 * They name a camp's line (`observe`'s `economy.lines`), never unit ids, and always the seat's OWN side: the side is
 * read from the view, so a model cannot ask for the other one. Whether the room has production at all, and whether
 * the seat may use it, is `validateCommand`'s; whether the runtime would take THIS order now is its own pre-check's.
 */
function buildProduction(view: SideView, verb: ProductionVerb, a: Record<string, unknown>): Command | Refused {
  const side = view.side;
  const lineArg = (): number | Refused =>
    isInt(a.line) && a.line >= 0 && a.line < MAX_PRODUCTION_LINES
      ? a.line
      : { error: 'invalid', detail: `${verb} needs a line: an integer 0-${MAX_PRODUCTION_LINES - 1}, from economy.lines in observe` };
  switch (verb) {
    case 'build': {
      if (typeof a.unit !== 'string' || a.unit === '') return { error: 'invalid', detail: 'build needs a unit: an id from economy.menu in observe' };
      if (a.line === undefined) return { kind: verb, side, unit: a.unit };
      const line = lineArg();
      return typeof line === 'number' ? { kind: verb, side, unit: a.unit, line } : line;
    }
    case 'cancelBuild': {
      const line = lineArg();
      if (typeof line !== 'number') return line;
      if (!isInt(a.index) || a.index < -1 || a.index >= MAX_LINE_QUEUE) {
        return { error: 'invalid', detail: `cancelBuild needs an index: -1 for the item in production, or 0-${MAX_LINE_QUEUE - 1} for one waiting` };
      }
      return { kind: verb, side, line, index: a.index };
    }
    case 'setRally': {
      const line = lineArg();
      if (typeof line !== 'number') return line;
      if (!isInt(a.x) || !isInt(a.y)) return { error: 'invalid', detail: 'setRally needs integer tiles x and y' };
      if (a.x < 0 || a.y < 0 || a.x >= view.size[0] || a.y >= view.size[1]) return { error: 'off the map' };
      return { kind: verb, side, line, x: tileFx(a.x), y: tileFx(a.y) };
    }
    case 'clearRally': {
      const line = lineArg();
      return typeof line === 'number' ? { kind: verb, side, line } : line;
    }
  }
}

/** The command an `order` call describes, or why it cannot be one. */
function buildOrder(view: SideView, a: Record<string, unknown>): Command | { error: string; detail?: string } {
  if (typeof a.verb !== 'string' || !(ORDER_VERBS as readonly string[]).includes(a.verb)) {
    return { error: 'unknown verb', detail: `one of ${ORDER_VERBS.join(', ')}` };
  }
  const verb = a.verb as Verb;
  if (isProductionVerb(verb)) return buildProduction(view, verb, a);
  if (!Array.isArray(a.ids) || a.ids.length === 0 || !a.ids.every(isInt)) return { error: 'invalid', detail: 'ids is a non-empty list of unit ids' };
  const ids = [...new Set(a.ids as number[])];
  const own = new Set(view.units.map((u) => u.id));
  if (!ids.every((id) => own.has(id))) return { error: 'not your unit', detail: 'every id must be one of your units in observe' };
  const point = (): { x: number; y: number } | { error: string; detail?: string } => {
    if (!isInt(a.x) || !isInt(a.y)) return { error: 'invalid', detail: `${verb} needs integer tiles x and y` };
    if (a.x < 0 || a.y < 0 || a.x >= view.size[0] || a.y >= view.size[1]) return { error: 'off the map' };
    return { x: tileFx(a.x), y: tileFx(a.y) };
  };
  // `sweep` is an attackMove flag: having arrived, hunt what the side remembers
  // (sim.ts). It is legal in versus -- `cleanCommand` carries it and ownership
  // checks only the ids and the map edge; the versus drop (#559 F1) is fire
  // support, `callStrike`/`reveal` -- and meaningless on every other verb, so
  // it is refused there rather than silently dropped. WHO may send it is
  // `sweepRefusal`'s question, asked before this.
  if (a.sweep !== undefined) {
    if (verb !== 'attackMove') return { error: 'invalid', detail: 'sweep is for attackMove only' };
    if (typeof a.sweep !== 'boolean') return { error: 'invalid', detail: 'sweep is true or false' };
  }
  // GH-859 P1a: `formation` is for move and attackMove, and only a shipped id of the verb the formation is
  // for (an `attackMove` naming a `move` formation would be a plain order in the sim: say so here instead).
  // WHICH SEAT may field it is `validateCommand`'s question, asked by the caller's precheck.
  let formation: string | undefined;
  if (a.formation !== undefined) {
    if (verb !== 'move' && verb !== 'attackMove') return { error: 'invalid', detail: 'formation is for move and attackMove only' };
    const shipped = formations.find((f) => f.id === a.formation);
    if (shipped === undefined) return { error: 'unknown formation', detail: `one of ${formations.map((f) => f.id).join(', ')}` };
    if (shipped.verb !== 'either' && shipped.verb !== verb) return { error: 'invalid', detail: `${shipped.id} is for ${shipped.verb}, not ${verb}` };
    formation = shipped.id;
  }
  const need = (key: 'structure' | 'tunnel'): number | { error: string; detail: string } =>
    isInt(a[key]) ? a[key] : { error: 'invalid', detail: `${verb} needs an integer ${key}` };
  switch (verb) {
    case 'move': {
      const p = point();
      return 'error' in p ? p : formation === undefined ? { kind: verb, ids, x: p.x, y: p.y } : { kind: verb, ids, x: p.x, y: p.y, formation };
    }
    case 'smoke': {
      const p = point();
      return 'error' in p ? p : { kind: verb, ids, x: p.x, y: p.y };
    }
    case 'attackMove': {
      const p = point();
      if ('error' in p) return p;
      return {
        kind: verb, ids, x: p.x, y: p.y,
        ...(typeof a.sweep === 'boolean' ? { sweep: a.sweep } : {}),
        ...(formation === undefined ? {} : { formation }),
      };
    }
    case 'halt':
    case 'unload':
      return { kind: verb, ids };
    case 'setStance':
      return stanceOrder(view, ids, a);
    case 'garrison':
    case 'demolish': {
      const s = need('structure');
      return typeof s === 'number' ? { kind: verb, ids, structure: s } : s;
    }
    case 'chargeTunnel': {
      const t = need('tunnel');
      return typeof t === 'number' ? { kind: verb, ids, tunnel: t } : t;
    }
    case 'load':
      if (!isInt(a.carrier) || !own.has(a.carrier)) return { error: 'not your unit', detail: 'carrier must be one of your units' };
      return { kind: verb, ids, carrier: a.carrier };
    case 'rescue':
      // GH-707: a medic is sent to a wounded man of the seat's OWN side, one of `casualties.mine` in observe (a
      // wounded man is a casualty and not a unit, so `own` never holds him; a versus room refuses an enemy's anyway,
      // `validateCommand`). Anything else answers alike, as `attack` does.
      if (!isInt(a.target) || !view.casualties.mine.some((c) => c.id === a.target)) {
        return { error: 'not a casualty', detail: 'target must be one of your wounded men in observe (casualties.mine)' };
      }
      return { kind: verb, ids, target: a.target };
    case 'attack':
      // Only a target the seat can see: every other id answers alike, so the
      // answer says nothing about what stands in the fog.
      if (!isInt(a.target) || !view.contacts.some((c) => c.id === a.target)) return { error: 'not a contact', detail: 'target must be a contact in observe' };
      return { kind: verb, ids, target: a.target };
  }
}

/**
 * Why this seat may not send `sweep`, or null. The ruling (15 Oct,
 * coordinator, lead-delegated): the human UI never sends `sweep` (the lead's
 * 11 Oct ruling that a clicked tile means that tile), so an agent that could
 * would have a capability a human seat lacks. In `command` scope it is offered
 * only when BOTH seats of the room's start config are `kind: 'bot'` -- the
 * arena, parity with the in-process `rush` -- and never in `assist`, where a
 * human would be accepting a sweep the strip does not describe. Any value,
 * `false` included, counts as asking.
 */
function sweepRefusal(ctx: ToolContext): ToolResult | null {
  if (ctx.scope === 'assist') return refuse('not in this scope', { detail: 'sweep is not offered in assist: your human\'s strip does not describe a sweep' });
  const seats = ctx.client.config()?.seats;
  if (seats === undefined || !seats.every((s) => s.kind === 'bot')) {
    return refuse('not available against a human seat', { detail: 'sweep is offered only when both seats are bots (the arena)' });
  }
  return null;
}

const order: ToolDef = {
  name: 'order',
  description: `Order your units, or your production. verb: ${ORDER_VERBS.join(' | ')}; ids: your unit ids (every verb but build, cancelBuild, setRally, clearRally); x, y: a tile (move, attackMove, smoke, setRally); stance: hold | ambush | patrol (setStance: hold halts and stands; ambush halts and holds fire until an enemy closes to radius tiles, an integer 1-10, default 3; patrol walks waypoints, 2-4 tiles [x, y], in order and round again, and fights what it meets); unit, line, index (production, KDF against Sarim rooms only: build a unit id from economy.menu in observe, on line, a number from economy.lines, default the shortest queue; cancelBuild line + index, -1 for the item in production and 0 upward for those waiting; setRally line + x, y, where new units walk to; clearRally line; paid when the order is carried out, so look at economy.purse in observe before you build again); formation: a combat formation id (move or attackMove; column and ambush are for move, attack for attackMove) to arrive in that shape (refused as invalid, detail ${FORMATIONS_CLOSED_IN_VERSUS}, while formations are closed in versus rooms: send the plain order); sweep: true (attackMove only, command scope, and only when both seats are bots) to go on, once there, hunting the enemies your side remembers instead of holding the tile; target: a contact id (attack), or one of your wounded men from casualties.mine (rescue: a medic goes to treat and carry him to your camp); structure (garrison, demolish); carrier (load); tunnel (chargeTunnel); note: a line for your human (assist). command: queued on the order desk (at most 4 sent a second, 12 queued) -> { ref, status }. assist: proposed to your human, who accepts or vetoes -> { proposal, status }.`,
  scopes: ['assist', 'command'],
  schema: {
    type: 'object',
    properties: {
      verb: { type: 'string', enum: [...ORDER_VERBS] },
      ids: { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 256 },
      x: { type: 'integer' },
      y: { type: 'integer' },
      target: { type: 'integer' },
      structure: { type: 'integer' },
      carrier: { type: 'integer' },
      tunnel: { type: 'integer' },
      stance: { type: 'string', enum: [...STANCES], description: 'setStance only' },
      radius: { type: 'integer', minimum: 1, maximum: AMBUSH_RADIUS_MAX >> 16, description: 'setStance ambush only: tiles' },
      waypoints: {
        type: 'array', minItems: 2, maxItems: MAX_PATROL_WAYPOINTS,
        items: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 },
        description: 'setStance patrol only: 2-4 tiles, each [x, y]',
      },
      unit: { type: 'string', description: 'build only: a unit id from economy.menu in observe' },
      line: { type: 'integer', minimum: 0, maximum: MAX_PRODUCTION_LINES - 1, description: 'a production line from economy.lines in observe (build: optional, default the shortest queue)' },
      index: { type: 'integer', minimum: -1, maximum: MAX_LINE_QUEUE - 1, description: 'cancelBuild only: -1 the item in production, 0 upward those waiting' },
      formation: { type: 'string', description: 'move or attackMove only: a shipped formation id (column, ambush: move; attack: attackMove). The units take its slots about the tile', enum: formations.map((f) => f.id) },
      sweep: { type: 'boolean', description: 'attackMove only, and only bot against bot in command scope: on arrival, go on to hunt remembered enemies' },
      note: { type: 'string' },
    },
    required: ['verb'],
    additionalProperties: false,
  },
  async run(ctx, raw) {
    if (ctx.scope === 'advise') return refuse('not in this scope');
    const view = started(ctx);
    if (view === null) return notStarted(ctx);
    if (over(ctx)) return refuse('match over');
    const a = argsOf(raw);
    if (a.sweep !== undefined) {
      const no = sweepRefusal(ctx);
      if (no !== null) return no;
    }
    const built = buildOrder(view, a);
    if ('error' in built) return refuse(built.error, built.detail === undefined ? {} : { detail: built.detail });
    // The room's own rebuild, then ownership's verdict on this machine's world.
    const cmd = cleanCommand(built);
    if (cmd === null) return refuse('invalid');
    if (!ctx.client.precheck(cmd)) {
      // GH-859 P1b (M8): the order is refused for its formation alone when the same order without one would have passed.
      // Formations are closed in versus rooms (the lead's 29 Oct ruling: `net/versus-formations.ts`), so that is the name
      // the refusal gives -- a bare `invalid` told an agent nothing it could act on. When the gate opens, this is where a
      // second cause (a faction that does not field the shape) would be told apart.
      if ('formation' in cmd && cmd.formation !== undefined && ctx.client.precheck({ ...cmd, formation: undefined } as Command)) {
        return refuse('invalid', { detail: FORMATIONS_CLOSED_IN_VERSUS });
      }
      // GH-954: ownership drops production in a room that has none. `observe` shows `economy` exactly when it has.
      if (isProductionVerb(cmd.kind) && view.economy === undefined) {
        return refuse('invalid', { detail: `${cmd.kind} is for KDF-against-Sarim rooms, which have a production economy; this room has none (observe shows no economy)` });
      }
      return refuse('invalid');
    }
    // GH-954: ownership said yes; the runtime may still set the order aside unspent (purse, population, queue, camp,
    // tile). Its own pre-checks say why, as the dock's click does, and the order is refused here with that reason.
    if (isProductionVerb(cmd.kind)) {
      const w = ctx.client.world();
      const why = w === null ? null : productionRefusal(w, view.side, cmd);
      if (why !== null) return refuse('refused', { detail: why });
    }
    if (ctx.scope === 'command') {
      const r = ctx.client.desk.submit(cmd, ctx.client.tick());
      if ('error' in r) return refuse(r.error);
      return ok({ ref: r.ref, status: r.status });
    }
    const id = ctx.nextProposal;
    const msg = cleanAdvisorMsg({ kind: 'proposal', id, cmd, note: typeof a.note === 'string' ? a.note : '' });
    if (msg === null) return refuse('invalid');
    ctx.nextProposal++;
    ctx.client.transport.advisor(msg);
    ctx.proposals.set(id, 'pending');
    // A Map iterates in insertion order: the first key is the oldest.
    for (const old of ctx.proposals.keys()) { if (ctx.proposals.size <= PROPOSALS_KEPT) break; ctx.proposals.delete(old); }
    return ok({ proposal: id, status: 'pending' });
  },
};

const endRound: ToolDef = {
  name: 'end_round',
  description: 'Paced rooms: you have finished with the round whose frames have all run, and the room may mint the next. It waits for this (up to its roundWallMs) before going on.',
  scopes: ['command'],
  schema: { type: 'object', properties: {}, additionalProperties: false },
  async run(ctx) {
    if (ctx.scope !== 'command') return refuse('not in this scope');
    if (ctx.client.config() === null) return notStarted(ctx);
    if (over(ctx)) return refuse('match over');
    const round = roundOf(ctx);
    if (round === null) return refuse('not a paced room');
    if (round.finished <= ctx.doneRound) {
      const into = ctx.client.tick() - round.index * round.ticks;
      return refuse('round not finished', { round: round.index, ran: into, of: round.ticks });
    }
    ctx.doneRound = round.finished;
    ctx.client.transport.done(round.finished);
    return ok({ round: round.finished, done: true });
  },
};

/**
 * A room that has ended hands the client its result only once the frames it still holds have run (`drained`, on the
 * harness's own 10 ms pump). The scoring tools wait that out, bounded, so the stats name how the match ended; a
 * room that ended with no result (a void, a desync) is read as it stands after the bound.
 */
export const RESULT_SETTLE_MS = 1500;
async function settleResult(ctx: ToolContext): Promise<void> {
  const deadline = Date.now() + RESULT_SETTLE_MS;
  while (ctx.client.result() === null && terminal(ctx.client.transport.status()) && Date.now() < deadline) await sleep(WAIT_POLL_MS);
}

/**
 * The match scoring tools (GH-973), offered to a `pnpm bot` seat only (the harness is started with `--score-file`):
 * the arena's players are scored by a separate judge, never by themselves. Both answer `match not over` until the
 * match has a result, because the referee's numbers cover both sides and would otherwise see through the fog.
 */
const matchStats: ToolDef = {
  name: 'match_stats',
  description: 'After the match is over: the referee\'s end-of-match stats for BOTH seats (deaths, wounded fallen/rescued/died, value lost and destroyed, idle time, orders, a 30-second timeline). Not fog-limited, so it answers `match not over` until there is a result. Read it before `submit_score`.',
  scopes: ['command'],
  schema: { type: 'object', properties: {}, additionalProperties: false },
  async run(ctx) {
    if (ctx.scoreFile === undefined) return refuse('not in this scope');
    await settleReplay(ctx);
    if (ctx.client.config() === null) return notStarted(ctx);
    if (!over(ctx)) return refuse('match not over', { detail: 'the referee\'s numbers cover both sides and are shown once there is a result' });
    await settleResult(ctx);
    const stats = ctx.client.refereeStats();
    if (stats === null) return notStarted(ctx);
    return ok({ stats, glossary: statsGlossary(), seat: ctx.client.seat });
  },
};

const criterionSchema = { type: 'object', properties: { score: { type: 'integer', minimum: SCORE_MIN, maximum: SCORE_MAX }, reason: { type: 'string', minLength: 1, maxLength: MAX_REASON_CHARS, description: 'one line' } }, required: ['score', 'reason'], additionalProperties: false };
const playerSchema = {
  type: 'object',
  properties: {
    criteria: { type: 'object', properties: Object.fromEntries(CRITERION_IDS.map((id) => [id, criterionSchema])), required: [...CRITERION_IDS], additionalProperties: false },
    overall: criterionSchema,
  },
  required: ['criteria', 'overall'],
  additionalProperties: false,
};

const submitScore: ToolDef = {
  name: 'submit_score',
  description: `After the match is over and you have read \`match_stats\`: score BOTH players (seat0 and seat1, yourself included). ${CRITERIA.length} criteria (${CRITERION_IDS.join(', ')}) and an overall, each \`{score, reason}\`: a whole number ${SCORE_MIN}-${SCORE_MAX} and a ONE-line reason (at most ${MAX_REASON_CHARS} characters) that cites a number from the stats. A score that does not validate is refused with every problem listed: fix them and submit again; a later valid submission replaces an earlier one.`,
  scopes: ['command'],
  schema: { type: 'object', properties: { seat0: playerSchema, seat1: playerSchema }, required: ['seat0', 'seat1'], additionalProperties: false },
  async run(ctx, raw) {
    if (ctx.scoreFile === undefined) return refuse('not in this scope');
    if (ctx.client.config() === null) return notStarted(ctx);
    if (!over(ctx)) return refuse('match not over', { detail: 'score once the match has a result' });
    const v = validateScores(raw);
    if (!v.ok) return refuse('invalid', { problems: v.problems, rubric: rubricText(), format: replyFormat() });
    await settleResult(ctx);
    const stats = ctx.client.refereeStats();
    if (stats === null) return notStarted(ctx);
    try {
      writeScoreFile(ctx.scoreFile, { version: 1, seat: ctx.client.seat, referee: stats, scores: v.scores, submittedTick: ctx.client.tick() });
    } catch (e) {
      return refuse('not saved', { detail: e instanceof Error ? e.message : String(e) });
    }
    return ok({ accepted: true, note: 'the scores are saved in the match report; do not repeat them in your final message' });
  },
};

export const TOOLS: readonly ToolDef[] = [observe, status, wait, inbox, say, ping, order, endRound, matchStats, submitScore];
/** The tools only a scoring seat (`ToolContext.scoreFile`) is given. */
const SCORING_TOOLS: readonly string[] = [matchStats.name, submitScore.name];

/** The tools a model in `scope` is given; the two scoring tools only with `scoring` (the harness's `--score-file`). */
export function toolsFor(scope: Scope, o: { scoring?: boolean } = {}): ToolDef[] {
  return TOOLS.filter((t) => t.scopes.includes(scope) && (o.scoring === true || !SCORING_TOOLS.includes(t.name)));
}
