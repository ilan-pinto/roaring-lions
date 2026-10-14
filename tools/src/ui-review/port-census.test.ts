// Every tool under `tools/src` that boots or attaches to a dev server goes
// through `port.ts`. Written after `blast:capture` (2026-10-14) attached to
// another session's server on its default port and an agent's run measured
// that tree and read zeros: it called `ensureDevServer` directly, which REUSES
// whatever answers, and nothing said that every other harness ought not to.
//
// A file "serves or attaches" when its code (comments stripped) starts a
// server (`ensureDevServer(`, `startPreview(`), builds a loopback URL, or
// builds the gate's own scenario URL (`threeUrl(`). Such a file must call one
// of port.ts's four doors in code -- `claimPort`, `claimPortOrAttach`,
// `decidePort` (all three refuse a held port), or `requireAttach` (for a
// multi-target harness that only ever drives servers the caller started) --
// and name an environment override no other harness uses.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..');

/** Library modules that hold the server and URL machinery itself and take
 *  their port from a caller; none of them is run as a harness. */
const LIBRARY: Readonly<Record<string, string>> = {
  'golden-diff/browser.ts': 'defines ensureDevServer/isServerUp; every caller claims first',
  'golden-diff/capture-protocol.ts': 'defines threeUrl(port, ...); takes the port from its caller',
  'perf/boot.ts': 'defines startPreview(port, ...); takes the port from its caller',
  'ui-review/port.ts': 'the claim itself',
};

const SERVES = /\bensureDevServer\(|\bstartPreview\(|\bthreeUrl\(|https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])[:/$]/;
const CLAIMS = /\b(?:claimPort|claimPortOrAttach|decidePort|requireAttach)\(/;
const ENV_KEY = /'([A-Z0-9_]+_PORT)'/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== 'node_modules') walk(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** The file with comment lines dropped, so a header that merely MENTIONS
 *  `claimPort(` cannot stand in for a call. */
function code(text: string): string {
  return text
    .split('\n')
    .filter((line) => {
      const t = line.trimStart();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');
}

/** Every harness that serves or attaches, keyed by its path under tools/src. */
function serverHarnesses(root = SRC): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of walk(root)) {
    const rel = relative(root, file).split('\\').join('/');
    if (rel in LIBRARY) continue;
    const body = code(readFileSync(file, 'utf8'));
    if (SERVES.test(body)) found.set(rel, body);
  }
  return found;
}

describe('port census', () => {
  const harnesses = serverHarnesses();

  it('finds the harnesses at all (a census that matches nothing passes everything)', () => {
    // Named ones that must be in it: the harness the bug was raised against,
    // the golden gate, and one former attach-only tool.
    for (const name of ['perf/blast-captures.ts', 'ci/three-baseline-gate.ts', 'perf/wreck-captures.ts']) {
      expect([...harnesses.keys()], name).toContain(name);
    }
    expect(harnesses.size).toBeGreaterThanOrEqual(30);
  });

  it('every library exemption still exists, so the list cannot rot into a blanket pass', () => {
    for (const rel of Object.keys(LIBRARY)) expect(statSync(join(SRC, rel)).isFile(), rel).toBe(true);
  });

  it('every harness that serves or attaches goes through port.ts', () => {
    const bypass = [...harnesses].filter(([, body]) => !CLAIMS.test(body)).map(([rel]) => rel);
    expect(bypass, 'call claimPort / claimPortOrAttach / decidePort (or requireAttach) before serving').toEqual([]);
  });

  it('every self-serving harness names its own environment override', () => {
    const owners = new Map<string, string[]>();
    const missing: string[] = [];
    for (const [rel, body] of harnesses) {
      // A requireAttach-only harness has no port of its own to override.
      if (!/\b(?:claimPort|claimPortOrAttach|decidePort)\(/.test(body)) continue;
      const keys = new Set([...body.matchAll(ENV_KEY)].map((m) => m[1]));
      if (keys.size === 0) missing.push(rel);
      for (const k of keys) owners.set(k, [...(owners.get(k) ?? []), rel]);
    }
    expect(missing, 'pass an env key like FOO_CAPTURE_PORT to the claim').toEqual([]);
    const shared = [...owners].filter(([, files]) => files.length > 1);
    expect(shared, 'two harnesses read the same port override').toEqual([]);
  });
});
