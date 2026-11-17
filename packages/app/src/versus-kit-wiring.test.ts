/**
 * Lead ruling 16 Nov 2026: the entry chunk's ceiling (`MAIN_CHUNK_MAX_BYTES`, 1,850,000) stays, so the versus and chat code loads on demand
 * through ONE dynamic-import boundary, `versus-kit.ts`. `pnpm --filter @lions/tools webgpu:bundle` is the byte gate; this is the cheap one that
 * names the cause: the entry's STATIC import graph (value imports only, from `main.ts`) must not reach any module the kit re-exports, and
 * `main.ts` must reach the kit through `importWithRetry` at a room's boot and at the lobby's open/advisor calls only.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = __dirname;
const read = (p: string): string => readFileSync(p, 'utf8');
const main = read(join(SRC, 'main.ts'));
const kit = read(join(SRC, 'versus-kit.ts'));

/** Resolve `./x` against a file to an existing .ts path (or null for a non-source import such as a stylesheet). */
function resolveTs(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const c of [`${base}.ts`, join(base, 'index.ts')]) if (existsSync(c)) return c;
  return null;
}

/** The relative specifiers a file imports or re-exports for VALUE (not `import type`, not a brace list of `type` members only). Dynamic imports are not read. */
function staticValueImports(file: string): string[] {
  const src = read(file);
  const out: string[] = [];
  const re = /^(?:import|export)\s+(?!type\b)([^;]*?)\s*from\s+'(\.[^']*)'|^import\s+'(\.[^']*)'/gm;
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    const clause = m[1];
    if (clause !== undefined) {
      const braces = /^\{([^}]*)\}$/.exec(clause.trim());
      if (braces !== null) {
        const members = braces[1].split(',').map((x) => x.trim()).filter((x) => x !== '');
        if (members.length > 0 && members.every((x) => x.startsWith('type '))) continue;
      }
    }
    out.push(m[2] ?? m[3]);
  }
  return out;
}

/** Every source file reachable from `entry` by static value imports. */
function closure(entry: string): Set<string> {
  const seen = new Set<string>();
  const walk = (f: string): void => {
    if (seen.has(f)) return;
    seen.add(f);
    for (const spec of staticValueImports(f)) {
      const next = resolveTs(f, spec);
      if (next !== null && !next.endsWith('.test.ts')) walk(next);
    }
  };
  walk(entry);
  return seen;
}

/** The modules the kit re-exports. */
const KIT_MODULES = [...kit.matchAll(/from '(\.[^']+)'/g)].map((m) => resolveTs(join(SRC, 'versus-kit.ts'), m[1])).filter((p): p is string => p !== null);

describe('the versus kit boundary', () => {
  it('the kit re-exports the room modules (the list this test guards is not empty)', () => {
    expect(KIT_MODULES.length).toBeGreaterThanOrEqual(20);
    for (const name of ['net/connect', 'ui/net-chat', 'ui/chat-inbox', 'net/seat-label', 'ui/advisor', 'ui/net-end', 'net/snapshot-producer', 'net/match-world']) {
      expect(KIT_MODULES.map((p) => p.slice(SRC.length + 1).replace(/\.ts$/, '')), name).toContain(name);
    }
  });

  it("the entry's static import graph reaches none of the kit's modules, nor the kit itself", () => {
    const reached = closure(join(SRC, 'main.ts'));
    const leaked = [...KIT_MODULES, join(SRC, 'versus-kit.ts')].filter((m) => reached.has(m)).map((m) => m.slice(SRC.length + 1));
    expect(leaked).toEqual([]);
  });

  it('main.ts takes no value from @lions/net that only a room needs', () => {
    for (const name of ['WsTransport', 'PAUSES_PER_SEAT']) {
      const staticValue = new RegExp(`^import (?!type )\\{[^}]*(?<!type )\\b${name}\\b[^}]*\\} from '@lions/net';`, 'm');
      expect(main, name).not.toMatch(staticValue);
    }
  });

  it('main.ts reaches the kit through importWithRetry, once, and the only static mention is a type', () => {
    expect(main).toMatch(/importWithRetry\(\(\) => import\('\.\/versus-kit'\)\)/);
    expect(main.match(/import\('\.\/versus-kit'\)/g)?.length).toBe(1);
    expect(main).toMatch(/^import type \* as VersusKit from '\.\/versus-kit';/m);
    expect(main).not.toMatch(/^import (?!type )[^;]*from '\.\/versus-kit';/m);
  });

  it("a room's boot loads the kit before anything is built; a campaign or free-play boot loads nothing", () => {
    expect(main).toMatch(/const vk: typeof VersusKit \| null = inRoom \? await versusKit\(\) : null;\s*if \(req\.signal\.aborted\) return \(\) => undefined;/);
    // the load sits ahead of the first use of `flags`, the transport and the world
    const load = main.search(/const vk: typeof VersusKit \| null = inRoom/);
    expect(load).toBeGreaterThan(0);
    expect(load).toBeLessThan(main.search(/const flags = roomFlags\(/));
    expect(load).toBeLessThan(main.search(/match = spectate !== undefined/));
    // single-player takes a LocalTransport without the kit (connectMatch's own `net === null` answer)
    expect(main).toMatch(/vk === null \? \{ transport: new LocalTransport\(\), seat: null, config: null \} : await vk\.connectMatch\(/);
  });

  it("the lobby's open and advisor-ticket calls load the kit when called, not at startup", () => {
    expect(main).toMatch(/open: async \(req, signal\) => \{\s*const kit = await versusKit\(\);\s*return kit\.openRoom\(/);
    expect(main).toMatch(/advisorTicket: async \(code, scope\) =>\s*\(await versusKit\(\)\)\.inviteAdvisor\(/);
  });

  it('the tunnel-route conversion a campaign needs lives outside match-world, which stays in the kit', () => {
    expect(main).toMatch(/^import \{ tunnelRouteOf \} from '\.\/net\/tunnel-route';/m);
    expect(read(join(SRC, 'net', 'match-world.ts'))).toContain("export { tunnelRouteOf };");
  });

  it('no top-level statement of the boot calls the kit unguarded (a campaign boot has no kit: rk() throws)', () => {
    // A statement at the boot's own indentation runs on every boot. Each one that reaches rk() or seatName() (which calls it)
    // must carry a guard before the call: a room/seat/kit null check, an optional chain, the spectator ternary, or an arrow (lazy).
    const GUARD = /(=>|!== null|\?\.|spectating \?)/;
    const unguarded = main
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /^ {2}\S/.test(line))
      .filter(({ line }) => {
        const at = line.search(/rk\(\)|seatName\(/);
        return at >= 0 && !GUARD.test(line.slice(0, at));
      })
      .map(({ line, n }) => `${n}: ${line.trim()}`);
    expect(unguarded).toEqual([]);
  });
});
