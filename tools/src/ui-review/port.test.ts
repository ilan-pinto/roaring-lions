// `resolvePort`'s precedence (flag, then environment, then default), its
// refusals, and `portBusy`'s probe against a real listener. The harnesses
// themselves (`shoot.ts`, `routes-check.ts`) run at import and start a browser,
// so everything they decide about a port is decided here, where a test can
// reach it.
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { busyPortMessage, portBusy, resolvePort } from './port';

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
