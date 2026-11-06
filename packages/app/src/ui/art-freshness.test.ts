// A garage plate, kit plate, close-up or portrait is a photograph of a GLB.
// When the GLB moves and the picture does not, the garage and every HUD slot
// keep showing a model that no longer exists, and nothing noticed (GH-1079: 10
// plates, 8 kit plates, 10 portraits and 8 close-ups had gone stale this way
// by the M1 audit). Each tool records the sha256 of the GLB it photographed;
// this compares that with the bytes on disk. Hashes, not git dates, because
// dates do not survive a fresh clone.
//
//   plates, kit plates   assets/ui/plates/units[/kit]/manifest.json  `glb_sha256`
//   close-ups            assets/ui/garage/closeups/manifest.json     `glb_sha256`
//   portraits            art/portraits/masters/[lead/]<id>.json      `source_sha256`
//
// A picture that was audited as unchanged but not re-rendered is listed, with
// the hash it was audited against, in assets/ui/art-freshness-adopted.json.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../../..');

interface Recorded {
  /** Label shown on failure. */
  key: string;
  /** Ledger key: `plate:<id>`, `kit-plate:<id>`, `closeup:<key>`, `portrait:<id>`. */
  ledger: string;
  unit: string;
  recorded: string | undefined;
}

export function glbBytesHash(unit: string, root: string = ROOT): string {
  const vehicle = path.join(root, 'assets/meshes/vehicles', `${unit}.glb`);
  const team = path.join(root, 'assets/meshes', `${unit}.glb`);
  const file = fs.existsSync(vehicle) ? vehicle : team;
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readJson<T>(rel: string, root: string): T {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')) as T;
}

export function collectRecorded(root: string = ROOT): Recorded[] {
  const out: Recorded[] = [];
  for (const [rel, prefix] of [
    ['assets/ui/plates/units/manifest.json', 'plate'],
    ['assets/ui/plates/units/kit/manifest.json', 'kit-plate'],
  ] as const) {
    const m = readJson<{ plates: Record<string, { glb_sha256?: string }> }>(rel, root);
    for (const [id, e] of Object.entries(m.plates)) {
      out.push({ key: `${rel}#${id}`, ledger: `${prefix}:${id}`, unit: id, recorded: e.glb_sha256 });
    }
  }
  const cu = readJson<{ closeups: Record<string, { unit: string; glb_sha256?: string }> }>(
    'assets/ui/garage/closeups/manifest.json',
    root
  );
  for (const [k, e] of Object.entries(cu.closeups)) {
    out.push({ key: `closeups#${k}`, ledger: `closeup:${k}`, unit: e.unit, recorded: e.glb_sha256 });
  }
  for (const sub of ['', 'lead/']) {
    const dir = path.join(root, 'art/portraits/masters', sub);
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
      const e = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { unit: string; source_sha256?: string };
      out.push({ key: `portrait ${sub}${f}`, ledger: `portrait:${e.unit}`, unit: e.unit, recorded: e.source_sha256 });
    }
  }
  return out;
}

/** What is stale: recorded hash differs from the GLB, and no ledger entry
 *  pins the current GLB hash. */
export function staleOnes(root: string = ROOT, adopted: Record<string, string> = readAdopted(root)): string[] {
  const hashes = new Map<string, string>();
  const now = (u: string): string => {
    let h = hashes.get(u);
    if (h === undefined) hashes.set(u, (h = glbBytesHash(u, root)));
    return h;
  };
  return collectRecorded(root)
    .filter((r) => r.recorded !== now(r.unit) && adopted[r.ledger] !== now(r.unit))
    .map((r) => `${r.key} (${r.unit}): ${r.recorded ? 'photographed from older bytes' : 'no GLB hash recorded'}`);
}

function readAdopted(root: string): Record<string, string> {
  return readJson<{ entries: Record<string, string> }>('assets/ui/art-freshness-adopted.json', root).entries;
}

describe('art freshness (GH-1079): no picture is older than its GLB', () => {
  it('every plate, kit plate, close-up and portrait was made from the GLB on disk', () => {
    expect(staleOnes()).toEqual([]);
  });

  it('reads a non-trivial number of pictures (the check is not vacuous)', () => {
    expect(collectRecorded().length).toBeGreaterThan(100);
  });

  it('keeps no adoption the picture has since outgrown', () => {
    const adopted = readAdopted(ROOT);
    const byLedger = new Map(collectRecorded().map((r) => [r.ledger, [] as Recorded[]]));
    for (const r of collectRecorded()) byLedger.get(r.ledger)?.push(r);
    const redundant = Object.keys(adopted).filter((k) => {
      const rs = byLedger.get(k);
      if (!rs) return true; // names no picture at all
      return rs.every((r) => r.recorded === glbBytesHash(r.unit));
    });
    expect(redundant, 'delete these from assets/ui/art-freshness-adopted.json').toEqual([]);
  });
});
