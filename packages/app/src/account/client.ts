/**
 * The ONLY file under packages/app/src that names the account API (a source scan pins that). With the client
 * disabled no method calls `fetch` (GH-1075 A1, A1-11).
 */
import type { CampaignView, ClaimBody, ClaimResult, CoinAskWire, ConflictAnswer, EarnAward, SaveSlot, ServerState, SlotMetaView, WalletView } from '@lions/economy';
import type { OutboxOp } from './outbox';

export interface IdentityView {
  id: string;
  provider: string;
  label: string | null;
  createdAt: number;
  lastUsedDay: number | null;
  steamId?: string;
}

export interface AccountError {
  error: string;
  status: number;
}

export type MeResult =
  | { kind: 'signedIn'; publicId: string; displayName: string; showRecord: boolean; fresh: boolean; identities: IdentityView[] }
  | { kind: 'signedOut' }
  | { kind: 'off' };

/** The A2 routes' answers (GH-1075 A2): a 200 with its body, or any other status with whatever the server said. Network failure is status 0. */
export type CallResult<T> = { ok: true; status: 200; body: T } | { ok: false; status: number; body: unknown };

export interface VictoryAnswer {
  coins: number;
  awards: EarnAward[];
  wallet: WalletView;
  campaign: CampaignView | { revision: number; digest: string } | null;
  conflict?: ConflictAnswer;
}
export interface CouponAnswer {
  result: 'ok' | 'unknown' | 'used';
  ids: string[];
  coins: number;
  credits: number;
  wallet: WalletView;
  campaign: CampaignView | { revision: number; digest: string } | null;
}
export interface ResetFreeAnswer {
  wallet: WalletView;
  campaign: CampaignView | { revision: number; digest: string } | null;
}
export type CampaignOp = Extract<OutboxOp, { kind: 'campaign' }>;
export type VictoryOp = Extract<OutboxOp, { kind: 'victory' }>;
export type SlotPutOp = Extract<OutboxOp, { kind: 'slot.put' }>;
export type SlotDeleteOp = Extract<OutboxOp, { kind: 'slot.delete' }>;

export interface AccountClient {
  enabled: boolean;
  open(): Promise<boolean>;
  me(): Promise<MeResult>;
  steamStart(purpose: 'steam-login' | 'steam-link'): Promise<{ url: string } | AccountError>;
  logout(): Promise<'ok' | AccountError>;
  logoutAll(): Promise<'ok' | AccountError>;
  patchProfile(p: { displayName?: string; showRecord?: boolean }): Promise<'ok' | AccountError>;
  deleteIdentity(id: string): Promise<'ok' | AccountError>;
  exportData(): Promise<Blob | AccountError>;
  deleteAccount(o: { telemetryPlayer?: string }): Promise<'ok' | AccountError>;
  gone(idHash: string): Promise<'deleted' | 'unknown'>;
  // The A2 routes. `base` is the campaign revision at SEND time, never at queue time.
  state(): Promise<CallResult<ServerState>>;
  slot(id: string): Promise<CallResult<{ slot: SlotMetaView; body: SaveSlot }>>;
  missionStart(missionId: string): Promise<CallResult<{ start: string; missionId: string; at: number }>>;
  victory(op: VictoryOp, base: number): Promise<CallResult<VictoryAnswer>>;
  putCampaign(op: CampaignOp, base: number): Promise<CallResult<{ campaign: CampaignView | { revision: number; digest: string } }>>;
  spend(ask: CoinAskWire): Promise<CallResult<{ wallet: WalletView }>>;
  coupon(code: string): Promise<CallResult<CouponAnswer>>;
  resetFree(): Promise<CallResult<ResetFreeAnswer>>;
  putSlot(op: SlotPutOp): Promise<CallResult<{ slot: SlotMetaView }>>;
  deleteSlot(op: SlotDeleteOp): Promise<CallResult<{ ok: true }>>;
  claim(body: ClaimBody): Promise<CallResult<ClaimResult>>;
}

/** The `r=` codes `steam/return` appends to the profile path (plan section 0, ruling 12). */
export const RETURN_CODES = ['ok', 'linked', 'cancelled', 'expired', 'nocookie', 'invalid', 'steam', 'closed', 'limit', 'taken'] as const;
export type ReturnCode = (typeof RETURN_CODES)[number];

export function readReturnCode(query: URLSearchParams): ReturnCode | null {
  const r = query.get('r');
  return RETURN_CODES.find((c) => c === r) ?? null;
}

const BASE = '/api/account/';
const OFF: AccountError = { error: 'off', status: 0 };

export function createAccountClient(o: { enabled: boolean; fetch: typeof fetch; newOpId: () => string }): AccountClient {
  async function call(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { 'x-rl-account': '1' };
    const init: RequestInit = { method, headers, credentials: 'same-origin' };
    // The worker answers 415 to a body method without this header, so an empty body is '{}', never nothing.
    if (method !== 'GET') {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body ?? {});
    }
    return o.fetch(BASE + path, init);
  }
  async function failure(res: Response): Promise<AccountError> {
    let error = 'error';
    try {
      const j = (await res.json()) as { error?: unknown };
      if (typeof j.error === 'string') error = j.error;
    } catch {
      /* a non-JSON body keeps the generic code */
    }
    return { error, status: res.status };
  }
  async function okOrError(method: string, path: string, body?: unknown): Promise<'ok' | AccountError> {
    if (!o.enabled) return OFF;
    try {
      const res = await call(method, path, body);
      return res.ok ? 'ok' : await failure(res);
    } catch {
      return { error: 'network', status: 0 };
    }
  }
  async function signOut(path: string, goneIsOk: boolean): Promise<'ok' | AccountError> {
    const r = await okOrError('POST', path);
    return goneIsOk && r !== 'ok' && r.status === 401 ? 'ok' : r;
  }
  async function result<T>(method: string, path: string, body?: unknown): Promise<CallResult<T>> {
    if (!o.enabled) return { ok: false, status: 0, body: { error: 'off' } };
    try {
      const res = await call(method, path, body);
      let parsed: unknown = null;
      try {
        parsed = await res.json();
      } catch {
        /* a non-JSON body is null */
      }
      return res.status === 200 ? { ok: true, status: 200, body: parsed as T } : { ok: false, status: res.status, body: parsed };
    } catch {
      return { ok: false, status: 0, body: { error: 'network' } };
    }
  }
  const slotPath = (id: string): string => `slots/${encodeURIComponent(id)}`;
  return {
    enabled: o.enabled,
    async open() {
      if (!o.enabled) return false;
      try {
        const res = await call('GET', 'open');
        if (!res.ok) return false;
        return ((await res.json()) as { open?: unknown }).open === true;
      } catch {
        return false;
      }
    },
    async me() {
      if (!o.enabled) return { kind: 'off' };
      try {
        const res = await call('GET', 'me');
        if (res.status === 401) return { kind: 'signedOut' };
        if (!res.ok) return { kind: 'off' };
        const j = (await res.json()) as Omit<Extract<MeResult, { kind: 'signedIn' }>, 'kind'>;
        return { kind: 'signedIn', publicId: j.publicId, displayName: j.displayName, showRecord: j.showRecord, fresh: j.fresh, identities: j.identities };
      } catch {
        return { kind: 'off' };
      }
    },
    async steamStart(purpose) {
      if (!o.enabled) return OFF;
      try {
        const res = await call('POST', 'steam/start', { purpose });
        if (!res.ok) return await failure(res);
        const j = (await res.json()) as { url?: unknown };
        return typeof j.url === 'string' ? { url: j.url } : { error: 'error', status: res.status };
      } catch {
        return { error: 'network', status: 0 };
      }
    },
    // For logout a 401 means this session is already gone, which is what the caller wanted. For logoutAll it means
    // nothing was ended (the other sessions are still live), so it stays a failure.
    logout: () => signOut('logout', true),
    logoutAll: () => signOut('logout-all', false),
    patchProfile: (p) => okOrError('PATCH', 'profile', { op_id: o.newOpId(), ...p }),
    deleteIdentity: (id) => okOrError('DELETE', `identity/${encodeURIComponent(id)}`, { op_id: o.newOpId() }),
    async exportData() {
      if (!o.enabled) return OFF;
      try {
        const res = await call('GET', 'export');
        return res.ok ? await res.blob() : await failure(res);
      } catch {
        return { error: 'network', status: 0 };
      }
    },
    deleteAccount: (a) => okOrError('POST', 'delete', a.telemetryPlayer === undefined ? {} : { telemetryPlayer: a.telemetryPlayer }),
    state: () => result('GET', 'state'),
    slot: (id) => result('GET', slotPath(id)),
    missionStart: (missionId) => result('POST', 'mission/start', { op_id: o.newOpId(), missionId }),
    victory: (op, base) => result('POST', 'victory', { op_id: op.opId, missionId: op.missionId, stars: op.stars, start: op.start, base, campaign: op.campaign }),
    putCampaign: (op, base) => result('PUT', 'campaign', { op_id: op.opId, base, ...op.campaign }),
    spend: (ask) => result('POST', 'spend', { op_id: o.newOpId(), ...ask }),
    coupon: (code) => result('POST', 'coupon', { op_id: o.newOpId(), code }),
    resetFree: () => result('POST', 'reset-free', { op_id: o.newOpId() }),
    putSlot: (op) =>
      result('PUT', slotPath(op.slotId), { op_id: op.opId, name: op.slot.name, savedAt: op.slot.savedAt, build: op.slot.build, body: op.slot, origin: op.origin }),
    deleteSlot: (op) => result('DELETE', slotPath(op.slotId), { op_id: op.opId }),
    claim: (body) => result('POST', 'claim', body),
    async gone(idHash) {
      if (!o.enabled) return 'unknown';
      try {
        return (await call('POST', 'gone', { idHash })).status === 410 ? 'deleted' : 'unknown';
      } catch {
        return 'unknown';
      }
    },
  };
}
