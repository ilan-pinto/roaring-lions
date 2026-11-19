/**
 * Bundles a Worker entry into one ES module, the way a deploy ships it, for the relay split's checks (GH-1397):
 * `relay-config.test.ts` reads the relay's import closure from it (F8) and `relay-split.test.ts` runs the two
 * bundles under Miniflare (T3). Test infrastructure, not a test file, like `match/fake-do.ts`: nothing the
 * Worker ships imports it. It uses the repo's own Vite (no new bundler dependency); `wrangler deploy` uses
 * esbuild, so the bytes differ from a deploy's, but the module closure is the same graph.
 */
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

/** The repository root, with a trailing slash. */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export interface WorkerBundle {
  /** The bundled module, ready for workerd. */
  code: string;
  /** Repo-relative paths of every module the bundler LOADED for this entry, whether or not tree-shaking kept
   *  any of its code. Deliberately the whole graph, not the chunk's module list: a module whose one constant
   *  was inlined (`retention.ts`) is absent from the chunk, yet a change to it changes the deployed bytes. */
  modules: string[];
}

/** Bundle `entry` (repo-relative, e.g. `packages/worker/src/relay.ts`). */
export async function bundleWorker(entry: string): Promise<WorkerBundle> {
  const loaded = new Set<string>();
  const out = await build({
    configFile: false,
    logLevel: 'silent',
    root: REPO_ROOT,
    plugins: [{ name: 'rl-module-graph', load(id: string) { loaded.add(id); return null; } }],
    build: { write: false, ssr: entry, minify: false, target: 'es2022', rollupOptions: { output: { format: 'es' } } },
    ssr: { noExternal: true, target: 'webworker' },
  });
  const result = Array.isArray(out) ? out[0] : out;
  if (result === undefined || !('output' in result)) throw new Error(`bundleWorker: no output for ${entry}`);
  const chunk = result.output.find((o) => o.type === 'chunk');
  if (chunk === undefined || chunk.type !== 'chunk') throw new Error(`bundleWorker: no chunk for ${entry}`);
  const modules = [...loaded]
    .filter((id) => !id.startsWith('\0'))
    .map((id) => id.startsWith(REPO_ROOT) ? id.slice(REPO_ROOT.length) : id)
    .sort();
  return { code: chunk.code, modules };
}
