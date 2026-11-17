/**
 * What a resumed mission is rebuilt from (GH-1393 slice 2; design section 1, "Start inputs"). Pure: the boot in `main.ts` reads these instead
 * of the live stores, so the world is built from exactly what the mission was STARTED with, and the live campaign is only compared, never trusted.
 *
 * `restoreSim` writes onto "a freshly built world", and the type table (`addUnitType` order, kit tiers through `applyUpgrades`, the loaned
 * force) must be rebuilt exactly or the restore refuses. That table is a function of the ledger the mission was sent in with, the bought
 * kit tiers, the bought units (the unlock gates) and the deploy pick: those four are the record's `campaign` field. The seed is a constant of
 * the build (`SIM_SEED`) and rides in the record's own `seed`.
 */
import type { CampaignLedger } from './ledger-store';
import { digestOf, prepareResume, type JsonValue, type PreparedResume, type SuspendedMission } from './mission-save';
import { readSuspended, type KeyStore } from './mission-save-store';
import { parseShell, type ShellRecord } from './mission-shell';

export interface StartInputs {
  /** The ledger as `bootBattlefield` read it (before the deploy pick permuted the roster pool). */
  ledger: CampaignLedger;
  /** The bought kit, unit type id -> track -> tier (`bootKit`). */
  tiers: Record<string, Record<string, number>>;
  /** The bought unit ids, sorted. */
  unlocks: string[];
  /** The deploy pick as sorted roster indices (`DeploySelection.chosen`), or null when the screen was never touched. */
  deploy: number[] | null;
}

/** The JSON a save carries (`MissionSaveInput.campaign`). Sets become sorted arrays, so the digest does not depend on insertion order. */
export function startInputsJson(i: {
  ledger: CampaignLedger;
  tiers: Record<string, Record<string, number>>;
  unlocks: Iterable<string>;
  deploy: ReadonlySet<number> | null;
}): JsonValue {
  const out: StartInputs = {
    ledger: i.ledger,
    tiers: i.tiers,
    unlocks: [...i.unlocks].sort(),
    deploy: i.deploy === null ? null : [...i.deploy].sort((a, b) => a - b),
  };
  return JSON.parse(JSON.stringify(out)) as JsonValue;
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The inputs, or null when the record's `campaign` is not exactly what `startInputsJson` writes. */
export function parseStartInputs(v: unknown): StartInputs | null {
  if (!isRec(v) || !isRec(v.ledger) || !isRec(v.tiers)) return null;
  if (!Array.isArray(v.unlocks) || !v.unlocks.every((u) => typeof u === 'string')) return null;
  for (const tracks of Object.values(v.tiers)) {
    if (!isRec(tracks) || !Object.values(tracks).every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0)) return null;
  }
  if (v.deploy !== null && !(Array.isArray(v.deploy) && v.deploy.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0))) return null;
  return {
    ledger: v.ledger as CampaignLedger,
    tiers: v.tiers as Record<string, Record<string, number>>,
    unlocks: [...(v.unlocks as string[])],
    deploy: v.deploy === null ? null : [...(v.deploy as number[])],
  };
}

/**
 * Whether the live campaign is no longer the one the mission was started from: another mission was won, a unit bought, a tier bought.
 * Resuming then would write the victory from the frozen ledger over the player's later progress, so the resume is refused and the save kept
 * (design 5.3). Compared by digest of the canonical JSON, so key order cannot matter.
 */
export function campaignMoved(frozen: StartInputs, live: { ledger: CampaignLedger; unlocks: Iterable<string>; tiers: Record<string, Record<string, number>> }): boolean {
  return whatMoved(frozen, live).length > 0;
}

/** What changed in the campaign since the mission was started: the ledger (another mission was completed), the units bought, the upgrade tiers bought. */
export type MovedWhat = 'ledger' | 'units' | 'upgrades';

/** Which of the three parts of the campaign differ, in a fixed order; empty when none does. `campaignMoved` is exactly "not empty". */
export function whatMoved(frozen: StartInputs, live: { ledger: CampaignLedger; unlocks: Iterable<string>; tiers: Record<string, Record<string, number>> }): MovedWhat[] {
  const j = (x: unknown): number => digestOf(JSON.parse(JSON.stringify(x)) as JsonValue);
  const out: MovedWhat[] = [];
  if (j(frozen.ledger) !== j(live.ledger)) out.push('ledger');
  if (j(frozen.unlocks) !== j([...live.unlocks].sort())) out.push('units');
  if (j(frozen.tiers) !== j(live.tiers)) out.push('upgrades');
  return out;
}

/**
 * A problem found while resuming that the campaign board should say, once, beside the save it concerns. Module state in one JS realm (like
 * `net/offline-slot.ts`): the board is a different screen from the battlefield that found it, and a reload forgets it, which is fine because the
 * next Resume finds it again.
 */
export type ResumeProblem = 'moved' | 'failed';
let problem: ResumeProblem | null = null;
let movedWhat: readonly MovedWhat[] = [];
/** `moved` names what changed (`whatMoved`) so the board can say it; any other problem clears it. */
export const noteResumeProblem = (p: ResumeProblem, moved: readonly MovedWhat[] = []): void => { problem = p; movedWhat = p === 'moved' ? moved : []; };
export const peekResumeProblem = (): ResumeProblem | null => problem;
export const peekResumeMoved = (): readonly MovedWhat[] => movedWhat;
export const clearResumeProblem = (): void => { problem = null; movedWhat = []; };

// ---- loading a save for the boot ----------------------------------------------------------------------------------------------------


export interface ResumeLoaded {
  record: SuspendedMission;
  prepared: PreparedResume;
  inputs: StartInputs;
  shell: ShellRecord;
}

/** Why a resume did not start. The save is KEPT in every case; the board says which (`noteResumeProblem`, or the refused card). */
export type ResumeFailure = 'none' | 'refused' | 'moved' | 'failed';

/**
 * Everything a boot needs to resume `missionId`, or why it cannot. Reads the one store, then checks, in the order that is cheapest and most
 * useful to say: the record is there and loads (`readSuspended`, which includes the mission still being shipped), it is THIS mission's, it was
 * made by this build's seed, its inputs and shell are exactly their shapes, the live campaign is still the one it was started from, and
 * the snapshot inflates. Never throws, deletes nothing, writes only the problem note.
 */
export async function loadResume(o: {
  missionId: string;
  store: KeyStore | null;
  seed: number;
  live: { ledger: CampaignLedger; unlocks: Iterable<string>; tiers: Record<string, Record<string, number>> };
  knownMission?: (id: string) => boolean;
}): Promise<{ ok: true; loaded: ResumeLoaded } | { ok: false; why: ResumeFailure }> {
  const read = readSuspended(o.store, o.knownMission === undefined ? {} : { knownMission: o.knownMission });
  if (read.state === 'none' || read.state === 'unavailable') return { ok: false, why: 'none' };
  if (read.state === 'refused') return { ok: false, why: 'refused' };
  const record = read.record;
  if (record.missionId !== o.missionId || record.seed !== o.seed) {
    noteResumeProblem('failed');
    return { ok: false, why: 'failed' };
  }
  const inputs = parseStartInputs(record.campaign);
  const shell = parseShell(record.shell);
  if (inputs === null || shell === null) {
    noteResumeProblem('failed');
    return { ok: false, why: 'failed' };
  }
  const moved = whatMoved(inputs, o.live);
  if (moved.length > 0) {
    noteResumeProblem('moved', moved);
    return { ok: false, why: 'moved' };
  }
  const prepared = await prepareResume(record);
  if (!prepared.ok) {
    noteResumeProblem('failed');
    return { ok: false, why: 'failed' };
  }
  return { ok: true, loaded: { record, prepared, inputs, shell } };
}
