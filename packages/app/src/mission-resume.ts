/**
 * What a resumed mission is rebuilt from (GH-1393 slice 2; design section 1, "Start inputs"). Pure: the boot in `main.ts` reads these instead
 * of the live stores, so the world is built from exactly what the mission was STARTED with, and the live campaign is only compared, never trusted.
 *
 * `restoreSim` writes onto "a freshly built world", and the type table (`addUnitType` order, kit tiers through `applyUpgrades`, the loaned
 * force) must be rebuilt exactly or the restore refuses. That table is a function of the ledger the mission was sent in with, the bought
 * kit tiers, the bought units (the unlock gates) and the deploy pick: those four are the record's `campaign` field. The seed is a constant of
 * the build (`SIM_SEED`) and rides in the record's own `seed`.
 */
import { BRANCHES_OPEN, DIFFICULTY_LEDGER_KEY, postureOf, type PostureId } from '@lions/data';
import type { CampaignLedger } from './ledger-store';
import { digestOf, loadContentDigest, prepareResume, type JsonValue, type PreparedResume, type SuspendedMission } from './mission-save';
import { readSuspended, type KeyStore } from './mission-save-store';
import { parseShell, type ShellRecord } from './mission-shell';

export interface StartInputs {
  /** The ledger as `bootBattlefield` read it (before the deploy pick permuted the roster pool). */
  ledger: CampaignLedger;
  /** The bought kit, unit type id -> track -> tier (`bootKit`). */
  tiers: Record<string, Record<string, number>>;
  /** GH-1384 §4.5: the branch owned per branched (unit, track), frozen with the tiers (`branchPicks`).
   *  Once branching is open it is REQUIRED: a record from before branching has none, and is refused
   *  rather than resumed with `{}`, which would rebuild a branched tier 3 at tier 2. While
   *  `BRANCHES_OPEN` is false a branched tier plays as its envelope whatever the picks, so a record
   *  is read and written exactly as dev reads and writes it: no `picks` key, read back as `{}`. */
  picks: Record<string, Record<string, 1 | 2>>;
  /** The bought unit ids, sorted. */
  unlocks: string[];
  /** The deploy pick as sorted roster indices (`DeploySelection.chosen`), or null when the screen was never touched. */
  deploy: number[] | null;
}

/** The JSON a save carries (`MissionSaveInput.campaign`). Sets become sorted arrays, so the digest does not depend on insertion order. */
export function startInputsJson(i: {
  ledger: CampaignLedger;
  tiers: Readonly<Record<string, Readonly<Record<string, number>>>>;
  picks: Readonly<Record<string, Readonly<Record<string, 1 | 2>>>>;
  unlocks: Iterable<string>;
  deploy: ReadonlySet<number> | null;
}): JsonValue {
  const out: Omit<StartInputs, 'picks'> & { picks?: StartInputs['picks'] } = {
    ledger: i.ledger,
    tiers: i.tiers as Record<string, Record<string, number>>,
    ...(BRANCHES_OPEN ? { picks: i.picks as Record<string, Record<string, 1 | 2>> } : {}),
    unlocks: [...i.unlocks].sort(),
    deploy: i.deploy === null ? null : [...i.deploy].sort((a, b) => a - b),
  };
  return JSON.parse(JSON.stringify(out)) as JsonValue;
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The inputs, or null when the record's `campaign` is not exactly what `startInputsJson` writes. */
export function parseStartInputs(raw: unknown, open: boolean = BRANCHES_OPEN): StartInputs | null {
  if (!isRec(raw)) return null;
  // Open, a record with no picks is refused. Closed, the record is read exactly as dev reads it: any `picks` key is
  // ignored, and the picks read as none (a branched tier plays as its envelope whatever they say).
  const v: Record<string, unknown> = open ? raw : { ...raw, picks: {} };
  if (!isRec(v.ledger) || !isRec(v.tiers) || !isRec(v.picks)) return null;
  if (!Array.isArray(v.unlocks) || !v.unlocks.every((u) => typeof u === 'string')) return null;
  for (const tracks of Object.values(v.tiers)) {
    if (!isRec(tracks) || !Object.values(tracks).every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0)) return null;
  }
  for (const tracks of Object.values(v.picks)) {
    if (!isRec(tracks) || !Object.values(tracks).every((n) => n === 1 || n === 2)) return null;
  }
  if (v.deploy !== null && !(Array.isArray(v.deploy) && v.deploy.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0))) return null;
  return {
    ledger: v.ledger as CampaignLedger,
    tiers: v.tiers as Record<string, Record<string, number>>,
    picks: v.picks as Record<string, Record<string, 1 | 2>>,
    unlocks: [...(v.unlocks as string[])],
    deploy: v.deploy === null ? null : [...(v.deploy as number[])],
  };
}

/**
 * Whether the live campaign is no longer the one the mission was started from: another mission was won, a unit bought, a tier bought.
 * Resuming then would write the victory from the frozen ledger over the player's later progress, so the resume is refused and the save kept
 * (design 5.3). Compared by digest of the canonical JSON, so key order cannot matter.
 */
/** The live campaign `whatMoved` compares against. */
export interface LiveCampaign {
  ledger: CampaignLedger;
  unlocks: Iterable<string>;
  tiers: Record<string, Record<string, number>>;
  /** GH-1384: the live branch picks; a change (a legacy Switch since the suspend) reads as `upgrades`. */
  picks: Record<string, Record<string, 1 | 2>>;
}

export function campaignMoved(frozen: StartInputs, live: LiveCampaign): boolean {
  return whatMoved(frozen, live).length > 0;
}

/**
 * What changed in the campaign since the mission was started: the ledger (ANY of its keys but the posture: a completed mission is the usual cause, but the
 * digest proves only that something in it differs, so the words say "your campaign progress has changed" and no more), the units bought, the upgrade tiers
 * bought, the campaign posture (GH-1394: a ledger key, but its own reason, because the mission was overlaid for the posture it was started under).
 */
export type MovedWhat = 'ledger' | 'units' | 'upgrades' | 'posture';

/** The ledger without its posture key, so a posture change reads as `posture` and never as "your campaign progress has changed". */
const withoutPosture = (l: CampaignLedger): CampaignLedger => {
  if (!Object.hasOwn(l, DIFFICULTY_LEDGER_KEY)) return l;
  const out: CampaignLedger = { ...l };
  delete out[DIFFICULTY_LEDGER_KEY];
  return out;
};

/** Which of the four parts of the campaign differ, in a fixed order; empty when none does. `campaignMoved` is exactly "not empty". The posture is
 *  compared as a POSTURE (`postureOf`), so an absent key and an explicit `standard` are the same campaign. */
export function whatMoved(frozen: StartInputs, live: LiveCampaign): MovedWhat[] {
  const j = (x: unknown): number => digestOf(JSON.parse(JSON.stringify(x)) as JsonValue);
  const out: MovedWhat[] = [];
  if (j(withoutPosture(frozen.ledger)) !== j(withoutPosture(live.ledger))) out.push('ledger');
  if (j(frozen.unlocks) !== j([...live.unlocks].sort())) out.push('units');
  if (j(frozen.tiers) !== j(live.tiers) || j(frozen.picks) !== j(live.picks)) out.push('upgrades');
  if (postureOf(frozen.ledger) !== postureOf(live.ledger)) out.push('posture');
  return out;
}

/** The posture a save was started under and the one the campaign is on now, when they differ (GH-1394 slice 2, ruling 6). */
export interface PostureShift {
  was: PostureId;
  now: PostureId;
}

/**
 * A problem found while resuming that the campaign board should say, once, beside the save it concerns. Module state in one JS realm (like
 * `net/offline-slot.ts`): the board is a different screen from the battlefield that found it, and a reload forgets it, which is fine because the
 * next Resume finds it again.
 */
export type ResumeProblem = 'moved' | 'failed';
let problem: ResumeProblem | null = null;
let movedWhat: readonly MovedWhat[] = [];
let movedPosture: PostureShift | null = null;
/** `moved` names what changed (`whatMoved`) so the board can say it, and `posture` which two postures when one of them is the posture; any other
 *  problem clears both. */
export const noteResumeProblem = (p: ResumeProblem, moved: readonly MovedWhat[] = [], posture: PostureShift | null = null): void => {
  problem = p;
  movedWhat = p === 'moved' ? moved : [];
  movedPosture = p === 'moved' && moved.includes('posture') ? posture : null;
};
export const peekResumeProblem = (): ResumeProblem | null => problem;
export const peekResumeMoved = (): readonly MovedWhat[] => movedWhat;
export const peekResumePosture = (): PostureShift | null => movedPosture;
export const clearResumeProblem = (): void => { problem = null; movedWhat = []; movedPosture = null; };

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
  live: LiveCampaign;
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
    noteResumeProblem('moved', moved, { was: postureOf(inputs.ledger), now: postureOf(o.live.ledger) });
    return { ok: false, why: 'moved' };
  }
  // The content digest loads here, at a resume, never with the kit (`loadContentDigest`); a chunk that will not load is a failed resume.
  const contentDigest = await loadContentDigest().catch(() => null);
  const prepared = contentDigest === null ? null : await prepareResume(record, { contentDigest });
  if (prepared === null || !prepared.ok) {
    noteResumeProblem('failed');
    return { ok: false, why: 'failed' };
  }
  return { ok: true, loaded: { record, prepared, inputs, shell } };
}
