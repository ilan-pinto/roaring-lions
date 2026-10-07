/**
 * What `pnpm closeups:garage` owes (GH-238 K11, parent spec §3.3): one
 * close-up per KDF type and per upgrade track that type declares, derived
 * from `data/units/kdf/*.json` and nothing else. Pure, so the count and the
 * refusal are tested without a browser (`garage_closeups.test.ts`).
 *
 * The plan said 49 ("15 types x 3 + 2 x 2"), counted on 6 Oct against
 * seventeen types. The roster read 19 on 7 Oct: `heli_peten_gunship` (three
 * tracks) and `recon_zikit` (two) had landed since, so the derived count is
 * 16 x 3 + 3 x 2 = 54. The number is DERIVED here and pinned as a literal
 * only in the test, so a unit added to the roster without its close-ups
 * fails there by name.
 */
import fs from 'node:fs';
import path from 'node:path';

/** The close-up's pixel size: 3:2, the bay's own aspect. */
export const CLOSEUP_W = 480;
export const CLOSEUP_H = 320;

export interface CloseupJob {
  readonly id: string;
  readonly track: string;
  /** `<id>_<track>`: the file stem and the manifest key. */
  readonly key: string;
}

/** Every (type, track) pair the KDF roster declares, sorted by id, tracks in
 *  the order the unit JSON declares them. */
export function closeupPlan(unitsDir: string): CloseupJob[] {
  const jobs: CloseupJob[] = [];
  const files = fs
    .readdirSync(unitsDir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  for (const f of files) {
    const unit = JSON.parse(fs.readFileSync(path.join(unitsDir, f), 'utf8')) as {
      id?: unknown;
      upgrades?: Record<string, unknown>;
    };
    if (typeof unit.id !== 'string') throw new Error(`${f}: no string id`);
    for (const track of Object.keys(unit.upgrades ?? {})) {
      jobs.push({ id: unit.id, track, key: `${unit.id}_${track}` });
    }
  }
  return jobs;
}

/** Refuses a run that wrote a different number of close-ups from the plan:
 *  a missing one would ship the hatch in its place with nothing saying so. */
export function assertCloseupCount(written: number, plan: readonly CloseupJob[]): void {
  if (written !== plan.length) {
    throw new Error(
      `garage close-ups: ${written} written, but data/units/kdf/ declares ${plan.length} (type, track) pairs -- refusing`
    );
  }
}
