/**
 * A test D1 whose `feedback` table accepts the `report` category and the `match` source (GH-1417 S3).
 *
 * Those two values widen the CHECKs of migration 0003, which is migration 0007 (PR 1481, applied by the lead). Until 0007 is in
 * `migrations/`, this helper adds a COPY of its widening (`test-fixtures/widen-feedback-checks.sql`, taken from that PR) to a temporary
 * migrations directory. The moment a real migration that names `'report'` exists, the helper stops adding anything and opens the
 * real migrations as they are, so the fixture goes dead without an edit here and a drift between the two shows as a failing test.
 */
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openTestD1 } from './test-d1';

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));
const FIXTURE = fileURLToPath(new URL('../test-fixtures/widen-feedback-checks.sql', import.meta.url));

/** Whether the real migrations already widen the CHECKs. */
export const migrationsAcceptReports = (): boolean =>
  readdirSync(MIGRATIONS).some((f) => f.endsWith('.sql') && readFileSync(MIGRATIONS + f, 'utf8').includes("'report'"));

export function openReportD1(): ReturnType<typeof openTestD1> {
  if (migrationsAcceptReports()) return openTestD1();
  const dir = mkdtempSync(`${tmpdir()}/lions-migrations-`) + '/';
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql'))) copyFileSync(MIGRATIONS + f, dir + f);
  writeFileSync(dir + '9999_test_widen_feedback.sql', readFileSync(FIXTURE, 'utf8'));
  return openTestD1({ dir });
}
