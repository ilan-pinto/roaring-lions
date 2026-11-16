// GH-1417 S2: the chat word filter is a LAZY chunk. `chat-filter.ts` and its word lists (`@lions/data/chat-filters`, the
// data/chat/filter.<lang>.json files) once sat on the entry's static imports and put the entry chunk 21 KB over the main-chunk guard
// (`pnpm --filter @lions/tools webgpu:bundle`, whose ceiling never rises). That census is the byte gate; this is the cheap one that names
// the cause. It walks the app's STATIC import graph from the page's entry (`main.ts`, from index.html) through the source, following
// relative paths and `@lions/*` package exports, and skipping `import type` and dynamic `import()`; the filter and the lists must not be
// reached. The fallback behind the lazy load is tested in `chat-filter-gate.test.ts` and `chat-inbox.test.ts`.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../../..');
const PACKAGES = join(ROOT, 'packages');
const ENTRY = join(ROOT, 'packages/app/src/main.ts');

/** `@lions/<pkg>` and `@lions/<pkg>/<sub>`, through that package's `exports`. */
function resolvePackage(spec: string): string | null {
  const m = /^@lions\/([^/]+)(?:\/(.+))?$/.exec(spec);
  if (m === null) return null;
  const pkgDir = join(PACKAGES, m[1]);
  const pj = join(pkgDir, 'package.json');
  if (!existsSync(pj)) return null;
  const exportsMap = (JSON.parse(readFileSync(pj, 'utf8')) as { exports?: Record<string, string> }).exports ?? {};
  const target = exportsMap[m[2] === undefined ? '.' : `./${m[2]}`];
  return target === undefined ? null : join(pkgDir, target);
}

function resolveFile(from: string, spec: string): string | null {
  const bare = spec.replace(/\?.*$/, '');
  if (bare.startsWith('@lions/')) return resolvePackage(bare);
  if (!bare.startsWith('.')) return null; // a node_modules package: not the app's source
  const base = resolve(dirname(from), bare);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

/** The VALUE imports and re-exports of one source file, each at the start of a line (so a doc comment never counts). */
const STATIC_IMPORT = /^[ \t]*import[ \t]+(?!type[ \t{])(?:[\w$*\s{},]+?\s+from\s*)?['"]([^'"]+)['"]/gm;
const STATIC_REEXPORT = /^[ \t]*export[ \t]+(?!type[ \t{])(?:\*(?:\s+as\s+[\w$]+)?|\{[\w$\s,]*\})\s*from\s*['"]([^'"]+)['"]/gm;

function staticClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const todo = [entry];
  while (todo.length > 0) {
    const file = todo.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.(ts|tsx)$/.test(file)) continue; // JSON, CSS and assets import nothing
    const src = readFileSync(file, 'utf8');
    for (const re of [STATIC_IMPORT, STATIC_REEXPORT]) {
      for (const m of src.matchAll(re)) {
        const next = resolveFile(file, m[1]);
        if (next !== null && !seen.has(next)) todo.push(next);
      }
    }
  }
  return seen;
}

const rel = (f: string): string => relative(ROOT, f).split('\\').join('/');

describe('the chat word filter stays off the entry chunk (GH-1417 S2)', () => {
  const closure = [...staticClosure(ENTRY)].map(rel);

  it('the walk is not vacuous: it reaches the gate, the inbox, the seat labels, the data index and its JSON', () => {
    for (const f of [
      'packages/app/src/ui/chat-filter-gate.ts',
      'packages/app/src/ui/chat-inbox.ts',
      'packages/app/src/net/seat-label.ts',
      'packages/data/src/index.ts',
      'data/palette.json',
      'packages/net/src/index.ts',
    ]) expect(closure, f).toContain(f);
    expect(closure.length).toBeGreaterThan(200);
  });

  it('reaches neither chat-filter.ts, nor the lists module, nor any data/chat list', () => {
    expect(closure).not.toContain('packages/app/src/ui/chat-filter.ts');
    expect(closure).not.toContain('packages/data/src/chat-filters.ts');
    expect(closure.filter((f) => f.startsWith('data/chat/'))).toEqual([]);
  });

  it('the gate reaches the filter through one dynamic import, retried, and the data index exports the lists TYPE only', () => {
    const gate = readFileSync(join(__dirname, 'chat-filter-gate.ts'), 'utf8');
    expect(gate).toContain("importWithRetry(() => import('./chat-filter'))");
    expect(gate).not.toMatch(/^import (?!type )[^;]*from '\.\/chat-filter';/m);
    const data = readFileSync(join(PACKAGES, 'data/src/index.ts'), 'utf8');
    expect(data).toContain("export type { ChatFilterJson } from './chat-filters';");
    expect(data).not.toMatch(/data\/chat\//);
    expect(readFileSync(join(PACKAGES, 'app/src/ui/chat-filter.ts'), 'utf8')).toContain("from '@lions/data/chat-filters';");
  });

  it('the battlefield asks for the filter for a room and waits for it before the room\'s names and chat are mounted', () => {
    const main = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');
    const ask = main.indexOf('const chatFilterLoad: Promise<boolean> | null = netConfig !== null ? loadChatFilter() : null;');
    const wait = main.indexOf('if (chatFilterLoad !== null) await chatFilterLoad;');
    const chat = main.indexOf('const chatInbox = room !== null');
    expect(ask).toBeGreaterThan(0);
    expect(wait).toBeGreaterThan(ask);
    expect(chat).toBeGreaterThan(wait);
    expect(main.slice(wait, wait + 200)).toContain("if (req.signal.aborted) abandon('left while the chat filter loaded');");
  });
});
