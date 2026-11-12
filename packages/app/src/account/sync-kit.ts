/** Test-only kit for the sync loop's specs: a manual scheduler, a shared fake lock, and a fake Worker with its client. */
import { canonicalSlot, emptyAccount, SAVE_VERSION } from '@lions/economy';
import type { CampaignBody, CampaignView, ServerState, SaveSlot, SlotMetaView, WalletView } from '@lions/economy';
import type { AccountClient, CallResult, CampaignOp, MeResult, SlotDeleteOp, SlotPutOp, VictoryOp } from './client';
import { confirmedState } from './fixtures';
import { sha256Hex } from './signed-in';

export const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

export function makeScheduler(start = 1_000_000) {
  let clock = start;
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  const delays: number[] = [];
  return {
    now: () => clock,
    setNow(n: number): void {
      clock = n;
    },
    schedule(ms: number, fn: () => void): () => void {
      delays.push(ms);
      const t = { at: clock + ms, fn, live: true };
      timers.push(t);
      return () => {
        t.live = false;
      };
    },
    delays,
    /** Pending timers other than the 10 s heartbeat. */
    pending: () => timers.filter((t) => t.live).length,
    async advance(ms: number): Promise<void> {
      clock += ms;
      for (;;) {
        const due = timers.filter((t) => t.live && t.at <= clock).sort((a, b) => a.at - b.at)[0];
        if (due === undefined) break;
        due.live = false;
        due.fn();
        await tick();
      }
    },
  };
}
export type Sched = ReturnType<typeof makeScheduler>;

/** One lock for every tab that holds it: requests run one at a time, in order. */
export function sharedLocks(): LockManager {
  let chain: Promise<unknown> = Promise.resolve();
  const request = (_name: string, cb: () => Promise<unknown>): Promise<unknown> => {
    const run = chain.then(() => cb());
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  return { request } as unknown as LockManager;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const ok = <T>(body: T): CallResult<T> => ({ ok: true, status: 200, body });
const fail = (status: number, body: unknown): CallResult<never> => ({ ok: false, status, body });

export interface Call {
  name: string;
  opId?: string;
  base?: number;
  campaign?: CampaignBody | null;
  id?: string;
}

export class FakeServer {
  campaign: CampaignView | null;
  wallet: WalletView;
  slots = new Map<string, { meta: SlotMetaView; body: SaveSlot }>();
  calls: Call[] = [];
  signedIn = true;
  inFlight = 0;
  maxInFlight = 0;
  /** One promise per upcoming write call, awaited before it is applied (a request held in the air). */
  holds: Promise<void>[] = [];
  /** Apply the op, then answer with a network failure, once per opId (a lost response). */
  loseResponse = new Set<string>();
  /** Answer this status for the opId, always. */
  failWith = new Map<string, number>();
  corruptDigest = false;
  spendHold: Promise<void> | null = null;
  private answers = new Map<string, CallResult<unknown>>();
  private clock = 5000;
  private ids = 0;

  constructor(over: Partial<ServerState> = {}) {
    const s = confirmedState(over);
    this.campaign = s.campaign;
    this.wallet = s.wallet;
  }

  snapshot(): ServerState {
    return clone({ campaign: this.campaign, wallet: this.wallet, slots: [...this.slots.values()].map((s) => s.meta) });
  }
  systemCount(except?: string): number {
    return [...this.slots.values()].filter((s) => s.meta.origin !== 'player' && s.meta.id !== except).length;
  }
  addSystemSlot(origin: 'conflict' | 'claim' = 'conflict'): string {
    const id = `srv-${++this.ids}`;
    const body = slotFrom({ ledger: {}, brigade: emptyBrigade(), tutorialDone: false }, id, 'conflict', 1);
    this.slots.set(id, { meta: { id, name: 'conflict', savedAt: 1, build: 'server', origin, bytes: JSON.stringify(body).length }, body });
    return id;
  }
  count(name: string): Call[] {
    return this.calls.filter((c) => c.name === name);
  }
  private view(): CampaignView | null {
    return this.campaign === null ? null : clone(this.campaign);
  }
  private conflictFor(body: CampaignBody): { slot: SlotMetaView } | { held: true } {
    if (this.systemCount() >= 4) return { held: true };
    const id = `srv-${++this.ids}`;
    const slot = slotFrom(body, id, 'conflict', ++this.clock);
    const meta: SlotMetaView = { id, name: 'conflict', savedAt: slot.savedAt, build: 'server', origin: 'conflict', bytes: JSON.stringify(slot).length };
    this.slots.set(id, { meta, body: slot });
    return { slot: meta };
  }
  private reduce<T>(r: CallResult<T>): CallResult<T> {
    const c = clone(r);
    const b = c.body as { campaign?: { ledger?: unknown; revision: number; digest: string } | null } | null;
    if (b !== null && typeof b === 'object' && b.campaign && 'ledger' in b.campaign) b.campaign = { revision: b.campaign.revision, digest: b.campaign.digest } as never;
    return c;
  }
  private async run<T>(call: Call, apply: () => CallResult<T> | Promise<CallResult<T>>): Promise<CallResult<T>> {
    this.calls.push(call);
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      const hold = this.holds.shift();
      if (hold !== undefined) await hold;
      await Promise.resolve();
      if (!this.signedIn) return fail(401, { error: 'signed_out' });
      const opId = call.opId;
      if (opId !== undefined) {
        const forced = this.failWith.get(opId);
        if (forced !== undefined) return fail(forced, { error: forced === 409 ? 'busy' : 'boom' });
        const stored = this.answers.get(opId);
        if (stored !== undefined) return this.reduce(stored as CallResult<T>);
      }
      const r = await apply();
      if (opId !== undefined) this.answers.set(opId, clone(r));
      if (opId !== undefined && this.loseResponse.delete(opId)) return fail(0, { error: 'network' });
      return r;
    } finally {
      this.inFlight--;
    }
  }

  async putCampaign(op: CampaignOp, base: number) {
    return this.run({ name: 'PUT campaign', opId: op.opId, base, campaign: op.campaign }, () => {
      const rev = this.campaign?.revision ?? 0;
      if (base !== rev) return fail(409, { error: 'stale', campaign: this.view(), conflict: this.conflictFor(op.campaign) });
      this.campaign = { ...clone(op.campaign), revision: rev + 1, digest: `d${rev + 1}` };
      return ok({ campaign: this.view() as CampaignView });
    });
  }
  async victory(op: VictoryOp, base: number) {
    return this.run({ name: 'POST victory', opId: op.opId, base, campaign: op.campaign }, () => {
      this.wallet = { ...this.wallet, free: this.wallet.free + 10, revision: this.wallet.revision + 1 };
      let conflict: { slot: SlotMetaView } | { held: true } | undefined;
      if (op.campaign !== null) {
        const rev = this.campaign?.revision ?? 0;
        if (base !== rev) conflict = this.conflictFor(op.campaign);
        else this.campaign = { ...clone(op.campaign), revision: rev + 1, digest: `d${rev + 1}` };
      }
      return ok({ coins: 10, awards: [], wallet: clone(this.wallet), campaign: this.view(), ...(conflict ? { conflict } : {}) });
    });
  }
  async putSlot(op: SlotPutOp) {
    return this.run({ name: 'PUT slot', opId: op.opId, id: op.slotId, campaign: null }, async () => {
      if (op.origin !== 'player' && this.systemCount(op.slotId) >= 4) return fail(409, { error: 'cap' });
      const digest = this.corruptDigest ? 'wrong' : await sha256Hex(canonicalSlot(op.slot));
      const meta: SlotMetaView = { id: op.slotId, name: op.slot.name, savedAt: ++this.clock, build: op.slot.build, origin: op.origin, bytes: JSON.stringify(op.slot).length };
      this.slots.set(op.slotId, { meta, body: clone(op.slot) });
      return ok({ slot: { ...meta, digest } });
    });
  }
  async deleteSlot(op: SlotDeleteOp) {
    return this.run({ name: 'DELETE slot', opId: op.opId, id: op.slotId }, () => {
      if (!this.slots.delete(op.slotId)) return fail(404, { error: 'not_found' });
      return ok({ ok: true as const });
    });
  }
  async state() {
    return this.run({ name: 'GET state' }, () => ok(this.snapshot()));
  }
  async slot(id: string) {
    return this.run({ name: 'GET slot', id }, () => {
      const s = this.slots.get(id);
      return s === undefined ? fail(404, { error: 'not_found' }) : ok(clone({ slot: s.meta, body: s.body }));
    });
  }
}

const emptyBrigade = (): SaveSlot['account'] => emptyAccount();

export function slotFrom(body: CampaignBody, id: string, name: string, savedAt: number): SaveSlot {
  return { version: SAVE_VERSION, id, name, savedAt, build: 'server', ledger: body.ledger, account: body.brigade, tutorialDone: body.tutorialDone };
}

export function clientFor(server: FakeServer, o: { me?: () => MeResult; gone?: 'deleted' | 'unknown'; log?: string[] } = {}): AccountClient {
  const never = (): never => {
    throw new Error('unused');
  };
  return {
    enabled: true,
    open: never,
    me: () => Promise.resolve(o.me ? o.me() : { kind: 'signedIn', publicId: 'pub1', displayName: 'D', showRecord: false, fresh: false, identities: [] }),
    steamStart: never,
    logout: () => (server.calls.push({ name: 'logout' }), o.log?.push('logout'), Promise.resolve('ok' as const)),
    logoutAll: never,
    patchProfile: never,
    deleteIdentity: never,
    exportData: never,
    deleteAccount: never,
    gone: () => Promise.resolve(o.gone ?? 'unknown'),
    state: () => server.state(),
    slot: (id) => server.slot(id),
    missionStart: never,
    victory: (op, base) => server.victory(op, base),
    putCampaign: (op, base) => server.putCampaign(op, base),
    spend: async (ask) => {
      server.calls.push({ name: 'POST spend', id: ask.item === 'unit' ? ask.unitId : `${ask.unitId}.${ask.track}` });
      if (server.spendHold !== null) await server.spendHold;
      server.wallet = { ...server.wallet, free: server.wallet.free - 5, revision: server.wallet.revision + 1 };
      return ok({ wallet: clone(server.wallet) });
    },
    coupon: never,
    resetFree: never,
    putSlot: (op) => server.putSlot(op),
    deleteSlot: (op) => server.deleteSlot(op),
    claim: never,
    matches: async () => ok({ matches: [], next: null, record: { won: 0, lost: 0, drawn: 0 } }),
  };
}
