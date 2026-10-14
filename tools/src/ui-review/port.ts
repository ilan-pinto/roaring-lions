// Which port a harness serves the app on, and the refusal to share it. It
// began with the two ui-review harnesses (`ui:shots`, `ui:routes`); since
// 2026-10-14 EVERY tool under `tools/src` that boots or attaches to a dev
// server goes through here (`port-census.test.ts` holds that), because
// `blast:capture` attached to another session's server on its default port
// and an agent's run measured that tree and read zeros.
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

/** The flag that turns a self-serving harness into one that drives a server
 *  already listening on its port. Only harnesses that take it say so (they
 *  call `claimPortOrAttach`); `claimPort` never reads it. */
export const ATTACH_FLAG = '--attach';

/** What a harness may do with its port: serve on it (`attach: false`), drive
 *  the server already there (`attach: true`), or nothing (`ok: false`, with
 *  the one line to print). */
export type PortDecision =
  | { ok: true; port: number; source: PortSource; attach: boolean }
  | { ok: false; message: string };

/** How a harness may use its port. `own` is the only mode `claimPort` has
 *  ever had: serve on a free port, refuse a held one. `own-or-attach` adds
 *  `--attach`, which inverts the probe: the port must be HELD, by a server
 *  the caller started on purpose. */
export type PortMode = 'own' | 'own-or-attach';

function nothingToAttachMessage(tag: string, resolved: ResolvedPort, envKey: string): string {
  const from =
    resolved.source === 'flag' ? `from ${FLAG}` : resolved.source === 'env' ? `from ${envKey}` : "this script's default";
  return (
    `[${tag}] ${ATTACH_FLAG} was given but nothing is listening on port ${resolved.port} (${from}). ` +
    `Start the server you mean to measure there, or drop ${ATTACH_FLAG} and this run serves its own tree.`
  );
}

/**
 * The whole decision, with no logging and no exit: resolve the port, probe it,
 * and say what the harness may do. `claimPort` and `claimPortOrAttach` act on
 * it; a test reaches it directly, with a listener of its own holding the port.
 */
export async function decidePort(
  tag: string,
  envKey: string,
  fallback: number,
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  mode: PortMode
): Promise<PortDecision> {
  let resolved: ResolvedPort;
  try {
    resolved = resolvePort(argv, env, envKey, fallback);
  } catch (err) {
    return { ok: false, message: `[${tag}] ${err instanceof Error ? err.message : String(err)}` };
  }
  const busy = await portBusy(resolved.port);
  if (mode === 'own-or-attach' && argv.includes(ATTACH_FLAG)) {
    if (!busy) return { ok: false, message: nothingToAttachMessage(tag, resolved, envKey) };
    return { ok: true, port: resolved.port, source: resolved.source, attach: true };
  }
  if (busy) return { ok: false, message: busyPortMessage(tag, resolved, envKey) };
  return { ok: true, port: resolved.port, source: resolved.source, attach: false };
}

async function claim(tag: string, envKey: string, fallback: number, mode: PortMode): Promise<{ port: number; attach: boolean }> {
  const d = await decidePort(tag, envKey, fallback, process.argv.slice(2), process.env, mode);
  if (!d.ok) {
    console.error(d.message);
    process.exit(2);
  }
  if (d.attach) {
    console.warn(
      `[${tag}] ${ATTACH_FLAG}: driving the server already on :${d.port} (${d.source}). This run measures ` +
        `whatever checkout THAT server serves, which need not be this one.`
    );
  } else {
    console.log(`[${tag}] serving on :${d.port} (${d.source})`);
  }
  return { port: d.port, attach: d.attach };
}

/**
 * Resolve the port and refuse a busy one. On a bad value or a busy port it
 * prints one line and exits 2 -- before any browser or server starts, so
 * nothing needs tearing down -- rather than throwing a stack trace out of a
 * top-level await.
 */
export async function claimPort(tag: string, envKey: string, fallback: number): Promise<number> {
  return (await claim(tag, envKey, fallback, 'own')).port;
}

/**
 * `claimPort`, plus `--attach`: for a harness whose job includes photographing
 * a tree it cannot be run from (a "before" commit that predates the harness
 * itself), so the caller serves that tree and says so. Without the flag it is
 * exactly `claimPort`. With it, the port must be held -- nothing listening is
 * exit 2 -- and a warning says the run measures that server's tree. Either way
 * `ensureDevServer` is then safe to call: it starts a server on a free port and
 * reuses (never kills) the attached one.
 */
export async function claimPortOrAttach(tag: string, envKey: string, fallback: number): Promise<{ port: number; attach: boolean }> {
  return claim(tag, envKey, fallback, 'own-or-attach');
}

export type AttachDecision = { ok: true } | { ok: false; message: string };

/**
 * For a harness that ONLY attaches, to several servers the caller started --
 * a before and an after, side by side, on ports named per target. There is no
 * port of its own to claim, so the rule is the attach half alone: the caller
 * must say `--attach`, and every named port must be listening.
 */
export async function decideAttach(tag: string, argv: readonly string[], ports: readonly number[]): Promise<AttachDecision> {
  if (!argv.includes(ATTACH_FLAG)) {
    return {
      ok: false,
      message:
        `[${tag}] this harness never starts a server: it drives the ones on ${ports.map((p) => `:${p}`).join(', ')}. ` +
        `Pass ${ATTACH_FLAG} to confirm those servers are the trees you mean to measure.`,
    };
  }
  for (const port of ports) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, message: `[${tag}] "${port}" is not a port (1-65535)` };
    if (!(await portBusy(port))) return { ok: false, message: `[${tag}] nothing is listening on :${port}; start the server you mean to measure there` };
  }
  return { ok: true };
}

/** `decideAttach`, printed and exited on: exit 2 before any browser starts. */
export async function requireAttach(tag: string, ports: readonly number[]): Promise<void> {
  const d = await decideAttach(tag, process.argv.slice(2), ports);
  if (!d.ok) {
    console.error(d.message);
    process.exit(2);
  }
  console.warn(`[${tag}] ${ATTACH_FLAG}: driving ${ports.map((p) => `:${p}`).join(', ')}, whatever checkouts those servers serve.`);
}

/**
 * The retired attach-by-URL form, `harness.ts http://127.0.0.1:5178 out/dir`,
 * from the harnesses that used to drive a caller's server named by a
 * positional base URL. They serve their own tree now, so a URL there is a
 * stale command line: exit 2 naming the replacement, rather than reading the
 * URL as the next positional (an output directory, a query).
 */
export function refuseRetiredBaseUrl(tag: string, argv: readonly string[]): void {
  const url = argv.find((a) => /^https?:\/\//.test(a));
  if (url === undefined) return;
  console.error(
    `[${tag}] "${url}": a base URL is no longer taken. This harness serves its own tree on ${FLAG}=<n>; ` +
      `to drive a server you started, pass ${FLAG}=<its port> ${ATTACH_FLAG}.`
  );
  process.exit(2);
}
