/**
 * The tools a model drives the headless client with (N4a task 8, spec §8.3):
 * what `pnpm agent` registers on its stdio MCP server, one scope's worth.
 *
 * Every tool answers JSON text. An acting tool answers what was accepted, or
 * why not: `queue_full`, `not your unit`, `not a contact`, `unknown verb`,
 * `off the map`, `invalid`, `not in this scope`, `match over`,
 * `not available against a human seat`. The pre-check
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
import { fx, type Command } from '@lions/sim';
import type { AgentClient } from './agent-client';
import type { OrderRecord } from './order-desk';
import type { SideView } from './view';

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
}

export interface ToolDef {
  name: string;
  description: string;
  scopes: readonly Scope[];
  /** JSON Schema of the arguments object. */
  schema: Record<string, unknown>;
  run(ctx: ToolContext, args: unknown): Promise<ToolResult>;
}

/** The verbs `order` builds: every command kind but the intel two, which a versus room drops (#559 F1). */
// setStance, build, support, cancelBuild, setRally and clearRally are excluded from ORDER_VERBS; a model verb is an N3/N4 follow-up.
export const ORDER_VERBS = COMMAND_KINDS.filter(
  (k) => k !== 'reveal' && k !== 'callStrike' && k !== 'setStance' && k !== 'build' && k !== 'support' &&
    k !== 'cancelBuild' && k !== 'setRally' && k !== 'clearRally' &&
    // Field works (GH-277): the sim's construct/cancelConstruct never travel, and
    // raiseWorks/cancelWorks are runtime-priced like build (dropped in versus).
    k !== 'construct' && k !== 'cancelConstruct' && k !== 'raiseWorks' && k !== 'cancelWorks',
);
type Verb = (typeof ORDER_VERBS)[number];
export const WAIT_MAX_TICKS = 200;
/** How often `wait` looks again, and the longest it blocks in wall time. */
export const WAIT_POLL_MS = 10;
export const WAIT_MAX_MS = 60_000;
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
  return out;
}

const observe: ToolDef = {
  name: 'observe',
  description: 'What your seat may know now: your units (id, type, tile, hp %, flags), enemy contacts in sight, held buildings, the score, the clock, and your recent orders (command) or proposals (assist). Tiles, never world units.',
  scopes: SCOPES,
  schema: { type: 'object', properties: {}, additionalProperties: false },
  async run(ctx) {
    const view = started(ctx);
    if (view === null) return refuse('match not started');
    const listed = new Set([...view.units.map((u) => u.id), ...view.contacts.map((u) => u.id)]);
    let orders: unknown[] = [];
    if (ctx.scope === 'command') orders = ctx.client.desk.records(ORDER_RECORDS).map((r) => describeOrder(r, listed));
    else if (ctx.scope === 'assist') orders = [...ctx.proposals].slice(-ORDER_RECORDS).map(([proposal, status]) => ({ proposal, status }));
    return ok({ ...view, orders });
  },
};

const status: ToolDef = {
  name: 'status',
  description: 'The tick, the clock, the room link, the result if any, the pace and, in a paced room, the round.',
  scopes: SCOPES,
  schema: { type: 'object', properties: {}, additionalProperties: false },
  async run(ctx) {
    const config = ctx.client.config();
    const view = started(ctx);
    return ok({
      tick: ctx.client.tick(),
      clock: view?.clock ?? null,
      transport: ctx.client.transport.status(),
      result: view?.result ?? null,
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
  description: `Let the match run: resolves after \`ticks\` (1-${WAIT_MAX_TICKS}) more frames (20 a second), or at once on a result, the room ending, or (command, paced) when the room waits on your end_round. Never longer than ${WAIT_MAX_MS / 1000} s.`,
  scopes: SCOPES,
  schema: { type: 'object', properties: { ticks: { type: 'integer', minimum: 1, maximum: WAIT_MAX_TICKS } }, required: ['ticks'], additionalProperties: false },
  async run(ctx, raw) {
    const a = argsOf(raw);
    if (!isInt(a.ticks) || a.ticks < 1 || a.ticks > WAIT_MAX_TICKS) return refuse('invalid', { detail: `ticks is an integer 1-${WAIT_MAX_TICKS}` });
    if (ctx.client.config() === null) return refuse('match not started');
    const client = ctx.client;
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
      if (now - from >= a.ticks) { reason = 'ticks'; break; }
      // A terminal room whose frames have stopped running (drained, or
      // never to run: a void, a desync): nothing more will come.
      if (terminal(client.transport.status()) && (client.transport.behind() === 0 || still >= WAIT_STILL_POLLS)) { reason = 'ended'; break; }
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
    if (ctx.client.config() === null) return refuse('match not started');
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
    if (view === null) return refuse('match not started');
    if (over(ctx)) return refuse('match over');
    if (!isInt(a.x) || !isInt(a.y)) return refuse('invalid', { detail: 'x and y are integer tiles' });
    if (a.x < 0 || a.y < 0 || a.x >= view.size[0] || a.y >= view.size[1]) return refuse('off the map');
    const msg = cleanAdvisorMsg({ kind: 'ping', x: a.x, y: a.y });
    if (msg === null) return refuse('off the map');
    ctx.client.transport.advisor(msg);
    return ok({ pinged: [a.x, a.y] });
  },
};

/** The command an `order` call describes, or why it cannot be one. */
function buildOrder(view: SideView, a: Record<string, unknown>): Command | { error: string; detail?: string } {
  if (typeof a.verb !== 'string' || !(ORDER_VERBS as readonly string[]).includes(a.verb)) {
    return { error: 'unknown verb', detail: `one of ${ORDER_VERBS.join(', ')}` };
  }
  const verb = a.verb as Verb;
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
  const need = (key: 'structure' | 'tunnel'): number | { error: string; detail: string } =>
    isInt(a[key]) ? a[key] : { error: 'invalid', detail: `${verb} needs an integer ${key}` };
  switch (verb) {
    case 'move':
    case 'smoke': {
      const p = point();
      return 'error' in p ? p : { kind: verb, ids, x: p.x, y: p.y };
    }
    case 'attackMove': {
      const p = point();
      if ('error' in p) return p;
      return typeof a.sweep === 'boolean' ? { kind: verb, ids, x: p.x, y: p.y, sweep: a.sweep } : { kind: verb, ids, x: p.x, y: p.y };
    }
    case 'halt':
    case 'unload':
      return { kind: verb, ids };
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
      // GH-707: a medic is sent to a wounded man the seat can see: one of its own units or a
      // contact in observe. Anything else answers alike, as `attack` does.
      if (!isInt(a.target) || !(own.has(a.target) || view.contacts.some((c) => c.id === a.target))) {
        return { error: 'not a contact', detail: 'target must be one of your units or a contact in observe' };
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
  description: `Order your units. verb: ${ORDER_VERBS.join(' | ')}; ids: your unit ids; x, y: a tile (move, attackMove, smoke); sweep: true (attackMove only, command scope, and only when both seats are bots) to go on, once there, hunting the enemies your side remembers instead of holding the tile; target: a contact id (attack, rescue: a medic goes to treat and carry a wounded); structure (garrison, demolish); carrier (load); tunnel (chargeTunnel); note: a line for your human (assist). command: queued on the order desk (at most 4 sent a second, 12 queued) -> { ref, status }. assist: proposed to your human, who accepts or vetoes -> { proposal, status }.`,
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
      sweep: { type: 'boolean', description: 'attackMove only, and only bot against bot in command scope: on arrival, go on to hunt remembered enemies' },
      note: { type: 'string' },
    },
    required: ['verb', 'ids'],
    additionalProperties: false,
  },
  async run(ctx, raw) {
    if (ctx.scope === 'advise') return refuse('not in this scope');
    const view = started(ctx);
    if (view === null) return refuse('match not started');
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
    if (cmd === null || !ctx.client.precheck(cmd)) return refuse('invalid');
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
    if (ctx.client.config() === null) return refuse('match not started');
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

export const TOOLS: readonly ToolDef[] = [observe, status, wait, inbox, say, ping, order, endRound];

/** The tools a model in `scope` is given. */
export function toolsFor(scope: Scope): ToolDef[] {
  return TOOLS.filter((t) => t.scopes.includes(scope));
}
