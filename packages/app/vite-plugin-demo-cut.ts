// GH-1418: the desktop demo's content cut, baked into the bundle at BUILD time.
//
// `tools/desktop/build-local.mjs` (the only caller that sets it) hands `pnpm build` the demo's mission ids as
// `RL_DEMO_MISSIONS`, a JSON array, after `tools/desktop/policy.mjs`'s `readDemoConfig` has checked every id against
// data/missions. This plugin defines `__DEMO_MISSIONS__` from it (`null` when it is unset or empty, which is every build
// but the demo's: the deployed web game, `pnpm dev`, CI) and, in a build that carries a cut, emits `demo-cut.json` beside
// `index.html`, so the packager can check that the bundle it ships was built with the cut its manifest names (a
// `--skip-build` over a stale `dist` is refused there). The app reads the constant through `src/shell/demo-cut.ts` only.
//
// Not `VITE_*`: Vite would also publish that on `import.meta.env`, a second way in.

import type { Plugin } from 'vite';

export const DEMO_CUT_ENV = 'RL_DEMO_MISSIONS';
export const DEMO_CUT_FILE = 'demo-cut.json';

/** A mission id as data/missions spells one. */
const ID = /^[a-z0-9_]+$/;

/** The cut `raw` names, or null for none. Throws on anything but a non-empty JSON array of distinct mission ids. */
export function demoCutFromEnv(raw: string | undefined): string[] | null {
  if (raw === undefined || raw === '') return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new Error(`${DEMO_CUT_ENV}: not JSON`);
  }
  if (!Array.isArray(v) || v.length === 0) throw new Error(`${DEMO_CUT_ENV}: expected a non-empty array of mission ids`);
  for (const id of v) if (typeof id !== 'string' || !ID.test(id)) throw new Error(`${DEMO_CUT_ENV}: not a mission id: ${JSON.stringify(id)}`);
  if (new Set(v).size !== v.length) throw new Error(`${DEMO_CUT_ENV}: a mission is listed twice`);
  return v as string[];
}

/** The `define` value: the cut as a JS literal, or `null`. */
export function demoCutDefine(cut: readonly string[] | null): string {
  return JSON.stringify(cut);
}

/** Emits `demo-cut.json` in a build that carries a cut; nothing otherwise. */
export function demoCutPlugin(cut: readonly string[] | null): Plugin {
  return {
    name: 'rl-demo-cut',
    apply: 'build',
    generateBundle() {
      if (cut === null) return;
      this.emitFile({ type: 'asset', fileName: DEMO_CUT_FILE, source: `${JSON.stringify({ missions: cut })}\n` });
    },
  };
}
