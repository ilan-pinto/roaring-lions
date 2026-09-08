/**
 * The two properties `encode-meshes.ts` has to have and cannot assert about
 * itself: the encode is REPRODUCIBLE, and the shipped tree really is a
 * complete mirror of the source tree.
 *
 * Both are checked against the files on disk rather than by re-running the
 * encoder here -- a Draco encode of all 79 meshes takes tens of seconds, and
 * `pnpm test` is the fast inner loop (CLAUDE.md's own reason for keeping
 * `playtest` out of it). The expensive half runs in CI as
 * `pnpm encode:meshes -- --check`, which is a different, stronger check: it
 * hashes every SOURCE and compares against the manifest, so a source edited
 * without re-encoding fails there. This file pins what that gate cannot --
 * that the manifest is not simply absent, and that nothing has been shipped
 * or retired behind its back.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const SRC = path.join(REPO, 'art', 'meshes');
const OUT = path.join(REPO, 'assets', 'meshes');

function glbsUnder(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...glbsUnder(path.join(dir, e.name), rel));
    else if (e.name.endsWith('.glb')) out.push(rel);
  }
  return out.sort();
}

describe('the shipped mesh mirror', () => {
  it('holds exactly the meshes art/meshes holds, in both directions', () => {
    // A source with no shipped file 404s at runtime -- and the dev server
    // answers a 404 with index.html at HTTP 200, so GLTFLoader reports a JSON
    // parse error naming a file nobody touched (GH-147's own symptom). A
    // shipped file with no source is dead weight nobody will ever delete.
    expect(glbsUnder(OUT)).toEqual(glbsUnder(SRC));
  });

  it('ships a manifest naming every mesh', () => {
    // Without it `--check` has nothing to compare against and passes by
    // knowing nothing -- the same shape as a golden gate with no baseline.
    const manifest = JSON.parse(readFileSync(path.join(OUT, 'manifest.json'), 'utf8')) as {
      sources: Record<string, string>;
    };
    expect(Object.keys(manifest.sources).sort()).toEqual(glbsUnder(SRC));
    // A sha256, not a size or an mtime: an edit that preserves length is
    // exactly the case a cheaper key would miss.
    for (const [rel, hash] of Object.entries(manifest.sources)) {
      expect(hash, `${rel} manifest hash`).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('actually compresses -- every shipped mesh is smaller than its source', () => {
    // The failure this catches is the encoder silently degrading to a copy:
    // a `document.transform(draco())` that throws and is swallowed, or an
    // extension that stops being registered. Measured 2026-09-08, the whole
    // tree goes 75.47 MiB -> 25.98 (34%) and not one file grows, so "smaller"
    // is a true universal here rather than a hopeful one.
    const bigger: string[] = [];
    for (const rel of glbsUnder(SRC)) {
      const a = readFileSync(path.join(SRC, rel)).length;
      const b = readFileSync(path.join(OUT, rel)).length;
      if (b >= a) bigger.push(`${rel} (${a} -> ${b})`);
    }
    expect(bigger).toEqual([]);
  });

  it('self-hosts the Draco decoder rather than reaching for a CDN', () => {
    // `gltf-loader.ts` points DRACOLoader at `${BASE}draco/`. If these are
    // absent every mesh in the game fails to parse, and the only clue is a
    // 404 for a file the app never mentions anywhere else.
    expect(existsSync(path.join(REPO, 'assets', 'draco', 'draco_wasm_wrapper.js'))).toBe(true);
    expect(existsSync(path.join(REPO, 'assets', 'draco', 'draco_decoder.wasm'))).toBe(true);
  });
});
