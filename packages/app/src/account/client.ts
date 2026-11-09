/**
 * The ONLY file under packages/app/src that names the account API (a source scan pins that). With the client
 * disabled no method calls `fetch` (GH-1075 A1, A1-11).
 */
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
