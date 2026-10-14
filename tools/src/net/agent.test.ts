// N4a task 8: `pnpm agent`'s command line, its exit codes, and the interim
// stdout guard. The spawned end-to-end case (a real MCP client over stdio,
// and every stdout line a JSON-RPC frame) needs a room a child process can
// reach, and lands with the local relay in N4b (task 11).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exitCodeFor, parseArgs, ticketClaims, type AgentArgs } from './agent';

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
 * Interim stdout guard (ruling R3), until task 11's spawned test reads the
 * child's stdout itself: stdout is the MCP protocol channel, so neither
 * agent.ts nor any tools/src/net module it reaches may write to it.
 */
describe('stdout purity (static, interim)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  /** agent.ts and every tools/src/net module it imports, transitively. */
  function netModules(): string[] {
    const seen = new Set<string>();
    const visit = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+'(\.\/[^']+)'/gm)) {
        const spec = m[1];
        visit(resolve(here, spec.endsWith('.ts') ? spec : `${spec}.ts`));
      }
    };
    visit(resolve(here, 'agent.ts'));
    return [...seen];
  }
  it('walks the modules agent.ts reaches', () => {
    const names = netModules().map((f) => f.slice(here.length + 1)).sort();
    expect(names).toEqual(expect.arrayContaining(['agent-client.ts', 'agent.ts', 'build-id.ts', 'mcp-tools.ts', 'node-socket.ts', 'order-desk.ts', 'view.ts']));
  });
  it('none of them writes to stdout: no console.log, console.info or process.stdout.write', () => {
    for (const file of netModules()) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).not.toMatch(/console\.log\(|console\.info\(|process\.stdout\.write\(/);
    }
  });
});
