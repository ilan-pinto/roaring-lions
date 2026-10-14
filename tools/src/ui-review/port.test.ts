// `resolvePort`'s precedence (flag, then environment, then default), its
// refusals, and `portBusy`'s probe against a real listener. The harnesses
// themselves (`shoot.ts`, `routes-check.ts`) run at import and start a browser,
// so everything they decide about a port is decided here, where a test can
// reach it.
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ATTACH_FLAG, busyPortMessage, decideAttach, decidePort, portBusy, resolvePort } from './port';

const KEY = 'UI_SHOTS_PORT';
const DEFAULT = 5176;

describe('resolvePort precedence', () => {
  it('uses the default when neither the flag nor the environment names a port', () => {
    expect(resolvePort(['--pseudo', '--out=x'], {}, KEY, DEFAULT)).toEqual({ port: 5176, source: 'default' });
  });

  it('prefers the environment to the default', () => {
    expect(resolvePort([], { [KEY]: '5199' }, KEY, DEFAULT)).toEqual({ port: 5199, source: 'env' });
  });

  it('prefers the flag to the environment', () => {
    expect(resolvePort(['--port=5201'], { [KEY]: '5199' }, KEY, DEFAULT)).toEqual({ port: 5201, source: 'flag' });
  });

  it('prefers the flag to the default', () => {
    expect(resolvePort(['--res=1400x900', '--port=5202'], {}, KEY, DEFAULT)).toEqual({ port: 5202, source: 'flag' });
  });

  it('takes the last --port= when one is given twice, as a later flag overrides an earlier one', () => {
    expect(resolvePort(['--port=5201', '--port=5203'], {}, KEY, DEFAULT).port).toBe(5203);
  });

  it("reads only its own environment key, so ui:routes' override does not move ui:shots", () => {
    expect(resolvePort([], { UI_ROUTES_PORT: '5199' }, KEY, DEFAULT)).toEqual({ port: 5176, source: 'default' });
    expect(resolvePort([], { UI_ROUTES_PORT: '5199' }, 'UI_ROUTES_PORT', 5177)).toEqual({ port: 5199, source: 'env' });
  });

  it('treats an empty environment variable as unset', () => {
    expect(resolvePort([], { [KEY]: '' }, KEY, DEFAULT)).toEqual({ port: 5176, source: 'default' });
  });

  it('does not read a longer flag that merely starts with "--port"', () => {
    expect(resolvePort(['--portable=1', '--ports=5199'], {}, KEY, DEFAULT)).toEqual({ port: 5176, source: 'default' });
  });
});

describe('resolvePort refusals', () => {
  it.each(['abc', '0', '65536', '51.5', '-1', '0x1450', ' 5199', ''])('refuses --port=%j instead of falling through', (raw) => {
    expect(() => resolvePort([`--port=${raw}`], { [KEY]: '5199' }, KEY, DEFAULT)).toThrow(/--port=".*" is not a port/);
  });

  it.each(['abc', '0', '65536', '51.5'])('refuses %s=%j instead of falling back to the default', (raw) => {
    expect(() => resolvePort([], { [KEY]: raw }, KEY, DEFAULT)).toThrow(new RegExp(`${KEY}=".*" is not a port`));
  });

  it('refuses a bare --port, which would otherwise serve on the default while the caller believes otherwise', () => {
    expect(() => resolvePort(['--port', '5199'], {}, KEY, DEFAULT)).toThrow('--port needs a value');
  });

  it('accepts both ends of the port range', () => {
    expect(resolvePort(['--port=1'], {}, KEY, DEFAULT).port).toBe(1);
    expect(resolvePort(['--port=65535'], {}, KEY, DEFAULT).port).toBe(65535);
  });
});

describe('portBusy', () => {
  let server: net.Server | null = null;
  afterEach(async () => {
    const s = server;
    server = null;
    if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
  });

  /** A listener on an ephemeral loopback port that this test owns. */
  async function listen(host: string): Promise<number> {
    const s = net.createServer();
    server = s;
    await new Promise<void>((resolve, reject) => {
      s.once('error', reject);
      s.listen(0, host, () => resolve());
    });
    const address = s.address();
    if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
    return address.port;
  }

  it('reports a port that something is listening on as busy', async () => {
    const port = await listen('127.0.0.1');
    expect(await portBusy(port)).toBe(true);
  });

  it('reports a listener bound only to the IPv6 loopback as busy', async (ctx) => {
    let port: number;
    try {
      port = await listen('::1');
    } catch {
      server = null;
      ctx.skip(); // a host with no IPv6 loopback cannot hold such a listener at all
      return;
    }
    expect(await portBusy(port)).toBe(true);
  });

  it('reports the same port free once the listener has gone', async () => {
    const port = await listen('127.0.0.1');
    const s = server;
    server = null;
    if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
    expect(await portBusy(port)).toBe(false);
  });
});

describe('busyPortMessage', () => {
  it('names the port, where it came from, and both overrides', () => {
    const msg = busyPortMessage('ui-shots', { port: 5176, source: 'default' }, KEY);
    expect(msg).toContain('port 5176');
    expect(msg).toContain("this script's default");
    expect(msg).toContain('--port=<n>');
    expect(msg).toContain('UI_SHOTS_PORT=<n>');
  });

  it('says which override chose a busy port', () => {
    expect(busyPortMessage('ui-routes', { port: 5199, source: 'env' }, 'UI_ROUTES_PORT')).toContain('from UI_ROUTES_PORT');
    expect(busyPortMessage('ui-routes', { port: 5199, source: 'flag' }, 'UI_ROUTES_PORT')).toContain('from --port');
  });
});

/** A loopback listener this test owns, and a way to let go of it. */
async function hold(): Promise<{ port: number; release: () => Promise<void> }> {
  const s = net.createServer();
  await new Promise<void>((resolve, reject) => {
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => resolve());
  });
  const address = s.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  return { port: address.port, release: () => new Promise<void>((resolve) => s.close(() => resolve())) };
}

// The bug this exists for: `blast:capture` attached to a server another
// session held on its port, and measured that tree. Each case holds a REAL
// port and runs the real resolver against it.
describe('decidePort refuses a held port', () => {
  let release: (() => Promise<void>) | null = null;
  afterEach(async () => {
    const r = release;
    release = null;
    if (r) await r();
  });

  it.each(['own', 'own-or-attach'] as const)('refuses a port named by --port that something holds (%s)', async (mode) => {
    const held = await hold();
    release = held.release;
    const d = await decidePort('blast-captures', 'BLAST_CAPTURE_PORT', 5181, [`--port=${held.port}`], {}, mode);
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.message).toContain(`port ${held.port} (from --port) is already in use`);
      expect(d.message).toContain('BLAST_CAPTURE_PORT=<n>');
    }
  });

  it('refuses a held port named by the environment, and a held default', async () => {
    const held = await hold();
    release = held.release;
    const env = await decidePort('t', 'T_PORT', 5181, [], { T_PORT: String(held.port) }, 'own');
    expect(env.ok).toBe(false);
    if (!env.ok) expect(env.message).toContain('from T_PORT');
    const dflt = await decidePort('t', 'T_PORT', held.port, [], {}, 'own');
    expect(dflt.ok).toBe(false);
    if (!dflt.ok) expect(dflt.message).toContain("this script's default");
  });

  it('serves on the same port once nothing holds it -- the control', async () => {
    const held = await hold();
    await held.release();
    expect(await decidePort('t', 'T_PORT', 5181, [`--port=${held.port}`], {}, 'own')).toEqual({
      ok: true,
      port: held.port,
      source: 'flag',
      attach: false,
    });
  });

  it('claimPort mode ignores --attach: a held port is still refused', async () => {
    const held = await hold();
    release = held.release;
    expect((await decidePort('t', 'T_PORT', 5181, [`--port=${held.port}`, ATTACH_FLAG], {}, 'own')).ok).toBe(false);
  });

  it('--attach drives a held port, and refuses an empty one', async () => {
    const held = await hold();
    release = held.release;
    const d = await decidePort('t', 'T_PORT', 5181, [`--port=${held.port}`, ATTACH_FLAG], {}, 'own-or-attach');
    expect(d).toEqual({ ok: true, port: held.port, source: 'flag', attach: true });
    await held.release();
    release = null;
    const empty = await decidePort('t', 'T_PORT', 5181, [`--port=${held.port}`, ATTACH_FLAG], {}, 'own-or-attach');
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.message).toContain('nothing is listening');
  });

  it('a malformed port is refused, never fallen through', async () => {
    const d = await decidePort('t', 'T_PORT', 5181, ['--port=abc'], {}, 'own');
    expect(d.ok).toBe(false);
  });
});

describe('decideAttach', () => {
  it('refuses without --attach even when every port is held', async () => {
    const held = await hold();
    try {
      const d = await decideAttach('t', [], [held.port]);
      expect(d.ok).toBe(false);
      expect(await decideAttach('t', [ATTACH_FLAG], [held.port])).toEqual({ ok: true });
    } finally {
      await held.release();
    }
  });

  it('refuses --attach to a port nothing is listening on', async () => {
    const held = await hold();
    await held.release();
    const d = await decideAttach('t', [ATTACH_FLAG], [held.port]);
    expect(d.ok).toBe(false);
  });
});
