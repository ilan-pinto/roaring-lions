// Which port a ui-review harness (`ui:shots`, `ui:routes`) serves the app on,
// and the refusal to share it.
//
// Both harnesses start their OWN dev server through `ensureDevServer`
// (`../golden-diff/browser.ts`), which REUSES anything already answering on the
// port rather than starting a second one. That is the right call for its
// original callers and the wrong one here: this machine keeps long-lived dev
// servers from other sessions on fixed ports (5176, 5177, 5181, 5182, 4300,
// 4301 were all held on 2026-09-23), and `ui:routes`' own default, 5177, is
// the lead's everyday server. A harness that attaches to one of those
// photographs or walks ANOTHER checkout and reports on it as if it were this
// one, with no error. On 2026-09-23 an implementer had to edit `shoot.ts`'s
// port constant to capture at all, then restore it byte for byte before
// committing.
//
// So: a `--port=<n>` flag, then an environment override, then the script's
// default -- the flag spelled the way `ci/three-baseline-gate.ts` already takes
// it -- and a check that fails fast, naming the port and both overrides,
// before `ensureDevServer` could attach to anything.
import net from 'node:net';

export type PortSource = 'flag' | 'env' | 'default';

export interface ResolvedPort {
  port: number;
  source: PortSource;
}

const FLAG = '--port';

/** A TCP port a dev server can bind: an integer in 1..65535, written as plain
 *  decimal digits. `Number('')`, `Number('0x10')` and `Number(' 80 ')` all
 *  parse, which is why this reads the string rather than trusting `Number`. */
function parsePort(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= 65535 ? n : null;
}

/**
 * The port to serve on: `--port=<n>` wins, then `env[envKey]`, then `fallback`.
 *
 * A value that is present but unusable THROWS rather than falling through to
 * the next source. Falling through would land on the very default the caller
 * was trying to avoid, which is the failure this module exists to prevent. An
 * EMPTY environment variable counts as unset (`UI_SHOTS_PORT= pnpm ui:shots`
 * is the shell's way of clearing one); an empty flag (`--port=`) is a typo and
 * is refused. A bare `--port` with no `=` is refused too: every other flag in
 * these scripts is `--name=value`, and silently ignoring `--port 5199` would
 * serve on the default while the caller believes otherwise.
 */
export function resolvePort(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  envKey: string,
  fallback: number
): ResolvedPort {
  if (argv.includes(FLAG)) {
    throw new Error(`${FLAG} needs a value: write ${FLAG}=<n> (1-65535)`);
  }
  const hit = argv.filter((a) => a.startsWith(`${FLAG}=`)).at(-1);
  if (hit !== undefined) {
    const raw = hit.slice(FLAG.length + 1);
    const port = parsePort(raw);
    if (port === null) throw new Error(`${FLAG}="${raw}" is not a port: write ${FLAG}=<n> (1-65535)`);
    return { port, source: 'flag' };
  }
  const raw = env[envKey];
  if (raw !== undefined && raw !== '') {
    const port = parsePort(raw);
    if (port === null) throw new Error(`${envKey}="${raw}" is not a port: set ${envKey}=<n> (1-65535)`);
    return { port, source: 'env' };
  }
  return { port: fallback, source: 'default' };
}

/** True when something accepts a TCP connection on `host:port` within
 *  `timeoutMs`. Refused, unreachable (a host with no IPv6 loopback) or silent
 *  all read as "nothing there". */
function accepts(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (open: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/**
 * Is anything listening on `port` on this machine's loopback?
 *
 * TCP rather than `isServerUp`'s HTTP fetch, and both address families rather
 * than `localhost`. The app's Vite config sets `strictPort: false`, so a port
 * that is busy with ANY listener -- a slow server, one that is not HTTP, one
 * bound only to `::1` -- makes Vite quietly start on the next port up, while
 * `ensureDevServer` keeps polling the original one and attaches to whatever
 * answers there. An HTTP probe with a one-second timeout misses exactly those
 * cases; a connect on each loopback address does not.
 */
export async function portBusy(port: number, timeoutMs = 500): Promise<boolean> {
  const [v4, v6] = await Promise.all([accepts('127.0.0.1', port, timeoutMs), accepts('::1', port, timeoutMs)]);
  return v4 || v6;
}

/** The refusal, naming the port, where it came from, and both ways to pick
 *  another. */
export function busyPortMessage(tag: string, resolved: ResolvedPort, envKey: string): string {
  const from =
    resolved.source === 'flag' ? `from ${FLAG}` : resolved.source === 'env' ? `from ${envKey}` : "this script's default";
  return (
    `[${tag}] port ${resolved.port} (${from}) is already in use by a process this run did not start. ` +
    `Refusing to attach to another server: it would be serving some other checkout. ` +
    `Pick a free port with ${FLAG}=<n> or ${envKey}=<n>.`
  );
}

/**
 * Resolve the port and refuse a busy one. On a bad value or a busy port it
 * prints one line and exits 2 -- before any browser or server starts, so
 * nothing needs tearing down -- rather than throwing a stack trace out of a
 * top-level await.
 */
export async function claimPort(tag: string, envKey: string, fallback: number): Promise<number> {
  let resolved: ResolvedPort;
  try {
    resolved = resolvePort(process.argv.slice(2), process.env, envKey, fallback);
  } catch (err) {
    console.error(`[${tag}] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
  if (await portBusy(resolved.port)) {
    console.error(busyPortMessage(tag, resolved, envKey));
    process.exit(2);
  }
  console.log(`[${tag}] serving on :${resolved.port} (${resolved.source})`);
  return resolved.port;
}
