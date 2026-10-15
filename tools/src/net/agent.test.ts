// N4a task 8: `pnpm agent`'s command line, its exit codes, and the static
// stdout guard. The spawned end-to-end case (a real MCP client over stdio,
// and every stdout line a JSON-RPC frame) is in `local-relay.test.ts` (N4b
// task 11), against a room the child reaches on 127.0.0.1.
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exitCodeFor, parseArgs, readTicketFile, ticketClaims, type AgentArgs } from './agent';

const base = ['--server', 'https://game.test', '--code', 'ABC123'];
const parsed = (argv: string[]): AgentArgs => {
  const r = parseArgs(argv);
  if ('error' in r) throw new Error(r.error);
  return r;
};
const refused = (argv: string[]): string => {
  const r = parseArgs(argv);
  if (!('error' in r)) throw new Error(`accepted: ${argv.join(' ')}`);
  return r.error;
};

describe('parseArgs', () => {
  it('a ticket file, a scope and the defaults', () => {
    expect(parsed([...base, '--scope', 'assist', '--ticket-file', '/tmp/t'])).toEqual({
      server: 'https://game.test', code: 'ABC123', scope: 'assist', ticket: { file: '/tmp/t' }, callsign: 'Agent', build: null, origin: null,
    });
  });
  it('--join in command scope, with --flag=value forms, a callsign, a build and an origin; pnpm\'s bare -- is skipped', () => {
    expect(parsed(['--', ...base, '--scope=command', '--join', '--callsign=Lion Bot', '--build', '1.2.3+abc1234', '--origin', 'https://other.test'])).toEqual({
      server: 'https://game.test', code: 'ABC123', scope: 'command', ticket: { join: true }, callsign: 'Lion Bot', build: '1.2.3+abc1234', origin: 'https://other.test',
    });
  });
  it('--ticket-file - is stdin', () => {
    expect(parsed([...base, '--scope', 'advise', '--ticket-file', '-']).ticket).toEqual({ file: '-' });
  });
  it('--join and --ticket-file are exclusive, and one of them is required', () => {
    expect(refused([...base, '--scope', 'command', '--join', '--ticket-file', '/tmp/t'])).toMatch(/--join or --ticket-file, not both/);
    expect(refused([...base, '--scope', 'command'])).toMatch(/--join or --ticket-file/);
  });
  it('--join seats a bot, so it is for command scope only', () => {
    expect(refused([...base, '--scope', 'advise', '--join'])).toMatch(/--join is for --scope command/);
  });
  it('--scope is checked', () => {
    expect(refused([...base, '--scope', 'overlord', '--join'])).toMatch(/--scope is advise, assist or command/);
    expect(refused([...base, '--join'])).toMatch(/--scope is advise, assist or command/);
  });
  it('--ticket with a value is refused with "use --ticket-file", in either form', () => {
    expect(refused([...base, '--scope', 'command', '--ticket', 'abc.def'])).toMatch(/use --ticket-file/);
    expect(refused([...base, '--scope', 'command', '--ticket=abc.def'])).toMatch(/use --ticket-file/);
    // The refusal never repeats the ticket.
    expect(refused([...base, '--scope', 'command', '--ticket', 'abc.def'])).not.toContain('abc.def');
  });
  it('--server must be an http(s) URL, --code is required, an unknown flag is named', () => {
    expect(refused(['--server', 'game.test', '--code', 'ABC123', '--scope', 'command', '--join'])).toMatch(/--server/);
    expect(refused(['--server', 'https://game.test', '--scope', 'command', '--join'])).toMatch(/--code/);
    expect(refused([...base, '--scope', 'command', '--join', '--seet', '1'])).toMatch(/unknown option --seet/);
  });
});

describe('ticketClaims', () => {
  const ticket = (payload: unknown): string => `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.c2ln`;
  it('reads the seat and the role from the payload (the room verifies the signature)', () => {
    expect(ticketClaims(ticket({ matchId: 'ABC123', seat: 1, player: 'p', exp: 1 }))).toEqual({ seat: 1, role: 'seat', scope: null });
    expect(ticketClaims(ticket({ matchId: 'ABC123', seat: 0, player: 'advisor', exp: 1, role: 'advisor', scope: 'assist' }))).toEqual({ seat: 0, role: 'advisor', scope: 'assist' });
    expect(ticketClaims('not a ticket')).toBeNull();
    expect(ticketClaims(ticket({ seat: 2 }))).toBeNull();
  });
});

describe('readTicketFile', () => {
  it('expands a leading ~/ to the home directory: an MCP client execs the agent with no shell to do it', () => {
    const home = mkdtempSync(join(tmpdir(), 'agent-home-'));
    try {
      mkdirSync(join(home, '.roaring-lions'));
      writeFileSync(join(home, '.roaring-lions', 'advisor-ticket'), 'abc.def\n');
      // The path the lobby tells the player to save the ticket at (ui/versus.ts ADVISOR_TICKET_FILE).
      expect(readTicketFile('~/.roaring-lions/advisor-ticket', home)).toBe('abc.def\n');
      // An absolute path is read as written, and a ~ that is not a leading ~/ is not touched.
      expect(readTicketFile(join(home, '.roaring-lions', 'advisor-ticket'), '/nowhere')).toBe('abc.def\n');
      expect(() => readTicketFile(join(home, '~', 'x'), home)).toThrow(/ENOENT/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('exitCodeFor', () => {
  it('0 on a result or the room ending, 2 on bad_ticket or build_mismatch, 3 on a desync, 1 otherwise', () => {
    expect(exitCodeFor({ kind: 'result' })).toBe(0);
    expect(exitCodeFor({ kind: 'ended' })).toBe(0);
    expect(exitCodeFor({ kind: 'refused', code: 'bad_ticket' })).toBe(2);
    expect(exitCodeFor({ kind: 'refused', code: 'build_mismatch' })).toBe(2);
    expect(exitCodeFor({ kind: 'desync', tick: 40 })).toBe(3);
    expect(exitCodeFor({ kind: 'failed' })).toBe(1);
  });
});

/**
 * Static stdout guard (ruling R3), kept beside task 11's spawned test, which
 * reads the child's stdout itself: this one names the file and line, and
 * covers paths the spawned run never takes. stdout is the MCP protocol channel, so neither
 * agent.ts nor any module it reaches by relative path -- tools/src/net, and
 * the packages/app and packages/render files the harness imports directly --
 * may write to it. `@lions/*` packages are not walked: they are shipped code
 * with their own lint.
 */
describe('stdout purity (static)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(here, '../../..');
  /** A relative specifier from `from`, as a file on disk (`.ts`, or a directory's `index.ts`);
   *  null for data (`.json`, `.css`, ...), which runs no code. */
  const resolveSpec = (from: string, spec: string): string | null => {
    if (/\.(?!ts$|js$)[a-z]+$/.test(spec)) return null;
    const base = resolve(dirname(from), spec.replace(/\.js$/, ''));
    for (const f of [base, `${base}.ts`, resolve(base, 'index.ts')]) {
      if (f.endsWith('.ts') && existsSync(f)) return f;
    }
    throw new Error(`${from}: cannot resolve ${spec}`);
  };
  /** agent.ts and every module it imports by relative path, transitively. */
  function reached(): string[] {
    const seen = new Set<string>();
    const visit = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+'(\.\.?\/[^']+)'|^\s*import\s+'(\.\.?\/[^']+)'/gm)) {
        const next = resolveSpec(file, m[1] ?? m[2]);
        if (next !== null) visit(next);
      }
    };
    visit(resolve(here, 'agent.ts'));
    return [...seen];
  }
  /** Every console method Node writes to stdout, any computed console access, and stdout itself. */
  const STDOUT = /console\.(?:log|info|debug|dir|dirxml|table)\b|console\s*\[|process\.stdout\.write\b/;
  it('walks the modules agent.ts reaches, past tools/src/net into packages/app and packages/render', () => {
    const names = reached().map((f) => f.slice(root.length + 1)).sort();
    expect(names).toEqual(expect.arrayContaining([
      'tools/src/net/agent-client.ts', 'tools/src/net/agent.ts', 'tools/src/net/build-id.ts', 'tools/src/net/mcp-tools.ts',
      'tools/src/net/node-socket.ts', 'tools/src/net/order-desk.ts', 'tools/src/net/view.ts', 'tools/src/net/fog-tracker.ts',
      'packages/app/src/net/match-world.ts', 'packages/app/src/net/frame-step.ts', 'packages/app/src/net/outcome.ts',
      'packages/render/src/three/fog.ts',
    ]));
    expect(names.every((n) => n.startsWith('tools/src/net/') || n.startsWith('packages/app/src/') || n.startsWith('packages/render/src/'))).toBe(true);
  });
  it('the pattern catches every stdout writer it names, and spares stderr', () => {
    for (const bad of ['console.log(x)', 'console.info(x)', 'console.debug(x)', 'console.dir(x)', 'console.table(x)', 'console[k](x)', 'process.stdout.write(x)']) {
      expect(bad).toMatch(STDOUT);
    }
    for (const fine of ['console.warn(x)', 'console.error(x)', 'process.stderr.write(x)']) expect(fine).not.toMatch(STDOUT);
  });
  it('none of them writes to stdout', () => {
    for (const file of reached()) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).not.toMatch(STDOUT);
    }
  });
});
