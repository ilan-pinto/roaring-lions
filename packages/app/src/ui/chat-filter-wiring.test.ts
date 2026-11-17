// GH-1417 S2: the chat word filter is a LAZY chunk. `chat-filter.ts` and its word lists (`@lions/data/chat-filters`, the
// data/chat/filter.<lang>.json files) once sat on the entry's static imports and put the entry chunk 21 KB over the main-chunk guard
// (`pnpm --filter @lions/tools webgpu:bundle`, whose ceiling never rises). That census is the byte gate; this is the cheap one that names
// the cause. It walks the app's STATIC import graph from the page's entry (`main.ts`, from index.html) through the source, following
// relative paths and `@lions/*` package exports, and skipping `import type` and dynamic `import()`; the filter and the lists must not be
// reached. The fallback behind the lazy load is tested in `chat-filter-gate.test.ts` and `chat-inbox.test.ts`. Each file's imports are
// read by the TypeScript parser, not a regex (review finding 4: a comment inside an import's braces hid it from the regex).
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
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

/**
 * The specifiers of the VALUE imports and re-exports of one source file, from its top-level statements as the TypeScript parser reads
 * them, so a comment anywhere in a statement neither hides nor fakes one. `import type` and `export type` are skipped (erased);
 * `import { type A }` is followed, since `verbatimModuleSyntax` keeps that import; a dynamic `import()` is an expression, never a
 * statement, so it is not followed.
 */
function valueImports(file: string, src: string): string[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, false, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  for (const st of sf.statements) {
    const spec = ts.isImportDeclaration(st)
      ? (st.importClause?.isTypeOnly === true ? undefined : st.moduleSpecifier)
      : ts.isExportDeclaration(st) && !st.isTypeOnly ? st.moduleSpecifier : undefined;
    if (spec !== undefined && ts.isStringLiteral(spec)) out.push(spec.text);
  }
  return out;
}

function staticClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const todo = [entry];
  while (todo.length > 0) {
    const file = todo.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.(ts|tsx)$/.test(file)) continue; // JSON, CSS and assets import nothing
    for (const spec of valueImports(file, readFileSync(file, 'utf8'))) {
      const next = resolveFile(file, spec);
      if (next !== null && !seen.has(next)) todo.push(next);
    }
  }
  return seen;
}

const rel = (f: string): string => relative(ROOT, f).split('\\').join('/');

describe('the import reader (finding 4)', () => {
  it('sees every value import form, comments included, and skips type-only imports, dynamic imports and comments', () => {
    const src = [
      "import a from './a';",
      "import {\n  MASK, // the marker\n  /* and */ filterLine,\n} from './b';",
      "import * as c from './c';",
      "import './d';",
      "import { type E } from './e';",
      "export { f } from './f';",
      "export * from './g';",
      "export * as h from './h';",
      "import type { X } from './x1';",
      "import type * as Y from './x2';",
      "export type { Z } from './x3';",
      "// import { no } from './x4';",
      "/* import { no } from './x5'; */",
      "const lazy = () => import('./x6');",
      "const s = \"import { no } from './x7'\";",
    ].join('\n');
    // Literal oracle: the specifiers as written above, in order.
    expect(valueImports('fixture.ts', src)).toEqual(['./a', './b', './c', './d', './e', './f', './g', './h']);
  });
});

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
    // CR1: the wait is raced against the boot's signal, so a leave reaches `abandon` without waiting for the chunk.
    const wait = main.indexOf('if (chatFilterLoad !== null) await untilLoadedOrAborted(chatFilterLoad, req.signal);');
    const chat = main.indexOf('const chatInbox = room !== null');
    expect(ask).toBeGreaterThan(0);
    expect(wait).toBeGreaterThan(ask);
    expect(chat).toBeGreaterThan(wait);
    expect(main.slice(wait, wait + 200)).toContain("if (req.signal.aborted) abandon('left while the chat filter loaded');");
  });
});

/**
 * CR9 (review of PR 1492): the names object the battlefield hands the scoreboard and the points panel, as the TypeScript parser
 * reads `src`. For each `new <ctor>(...)` it names, which argument names the other seat, and whether `theirs` is read at paint time:
 * a getter, or a property whose value is a function, on the object literal that argument is (directly or through one `const`).
 * A plain `theirs: seatName(otherSeat)` is captured ONCE at mount, so a name that read as the fallback while the word filter loaded
 * would never be redrawn as its label.
 */
function namesReadLate(file: string, src: string, ctors: readonly string[]): Map<string, 'late' | 'captured' | 'unknown'> {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const consts = new Map<string, ts.Expression>();
  const news: ts.NewExpression[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer !== undefined) consts.set(n.name.text, n.initializer);
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && ctors.includes(n.expression.text)) news.push(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const verdict = (arg: ts.Expression | undefined): 'late' | 'captured' | 'unknown' => {
    const lit = arg !== undefined && ts.isIdentifier(arg) ? consts.get(arg.text) : arg;
    if (lit === undefined || !ts.isObjectLiteralExpression(lit)) return 'unknown';
    const theirs = lit.properties.find((p) => p.name !== undefined && ts.isIdentifier(p.name) && p.name.text === 'theirs');
    if (theirs === undefined) return 'unknown';
    if (ts.isGetAccessorDeclaration(theirs)) return 'late';
    if (ts.isPropertyAssignment(theirs) && (ts.isArrowFunction(theirs.initializer) || ts.isFunctionExpression(theirs.initializer))) return 'late';
    return 'captured';
  };
  const out = new Map<string, 'late' | 'captured' | 'unknown'>();
  for (const n of news) {
    const name = (n.expression as ts.Identifier).text;
    // NetScoreboard(host, viewer, names); NetPoints(host, names, explainer).
    const arg = n.arguments?.[name === 'NetScoreboard' ? 2 : 1];
    const v = verdict(arg);
    const prev = out.get(name);
    out.set(name, prev === undefined || prev === v ? v : 'unknown');
  }
  return out;
}

describe('the scoreboard and the points panel read the other seat\'s name at paint time (GH-1417 S2, CR9)', () => {
  it('the reader tells a getter from a value captured once (literal fixtures)', () => {
    const ctors = ['NetScoreboard', 'NetPoints'];
    const late = "const n = { get theirs(): string { return seatName(1); } };\nnew NetScoreboard(b, 0, n);\nnew NetPoints(b, n, '');";
    expect(namesReadLate('a.ts', late, ctors)).toEqual(new Map([['NetScoreboard', 'late'], ['NetPoints', 'late']]));
    const once = "const n = { theirs: seatName(1) };\nnew NetScoreboard(b, 0, n);\nnew NetPoints(b, { theirs: 'x' }, '');";
    expect(namesReadLate('b.ts', once, ctors)).toEqual(new Map([['NetScoreboard', 'captured'], ['NetPoints', 'captured']]));
    // Comments and strings do not fake one: the parser reads the code.
    const faked = "// const n = { get theirs() { return '' } };\nconst n = { theirs: seatName(1) /* get theirs() */ };\nnew NetScoreboard(b, 0, n);";
    expect(namesReadLate('c.ts', faked, ctors)).toEqual(new Map([['NetScoreboard', 'captured']]));
  });

  it('main.ts mounts both with names whose `theirs` is a getter', () => {
    const main = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');
    expect(namesReadLate('main.ts', main, ['NetScoreboard', 'NetPoints'])).toEqual(new Map([['NetScoreboard', 'late'], ['NetPoints', 'late']]));
  });
});
