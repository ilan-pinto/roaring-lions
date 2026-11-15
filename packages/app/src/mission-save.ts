/**
 * Save and resume in the middle of a mission, the library (GH-1393 slice 1; design `docs/superpowers/specs/2026-11-15-mid-mission-save-design.md`).
 *
 * No DOM, no UI and no storage: this file turns a running mission into one JSON-safe record and a record back into a restored world, and
 * REFUSES rather than guesses. The pause menu, the Resume card, the storage key (`lions.mission.suspend`) and the extraction of the
 * mission world builder from `bootBattlefield` are the next slices; nothing imports this yet.
 *
 * It writes no serialiser of its own: the sim and the mission runtime are encoded by `encodeSim(sim, meta, runtime)` and written back by
 * `restoreSim`, the versus rejoin's pair (`net/snapshot-rejoin.ts`). Invariant 4: snapshot bytes reach the sim only through `restoreSim`,
 * onto a world the caller built for the purpose, before its first tick. Nothing here writes a column.
 *
 * A record holds: the snapshot (gzip, base64); the version stamp (record version, `SIM_EPOCH`, `SNAPSHOT_FORMAT`); the mission id, seed and
 * build; the FROZEN campaign inputs the world was built from and their digest; an opaque shell record; the data digest; and `hashAtSave`,
 * the sim hash and the runtime digest at the cut, which `restoreMission` recomputes before the first tick.
 *
 * Refusals (`ResumeRefusal`), each a code the UI will word; a refused record is never loaded and never deleted here:
 * - `unreadable`: not JSON, or not the shape of a record;
 * - `older_version`: the record version, the sim epoch, the snapshot format, or the state table (schema digests) differs. The lead's ruling
 *   (GH-1393): a save survives every update that did not change the sim, so the BUILD string alone is never grounds for refusal;
 * - `damaged`: the frozen campaign inputs or the snapshot no longer match their digests, or the restored world's hash is not the saved one;
 * - `world_mismatch`: the target world was not built like the source (capacity, map, unit or structure types, runtime presence).
 * A changed data digest (units, maps, doctrines...) is NOT a refusal here: it is reported as `contentChanged` for the caller to word.
 */
import { gunzipCapped, gzipBytes, fnv1a32, readSnapshotHeader } from '@lions/net';
import { encodeSim, restoreSim, SIM_EPOCH, SNAPSHOT_FORMAT, SnapshotRefused, type MissionRuntime, type Sim } from '@lions/sim';
import { canonicalJson, shippedContentDigest } from './net/content-digest';

/** The record format. Bump it when the record's own shape changes; a different value is refused as `older_version`. */
export const MISSION_SAVE_VERSION = 1;
/** The most gzipped snapshot bytes a save may hold (twice the versus cap): provisional, to be fixed once real mid-fight missions are measured. */
export const MISSION_SAVE_MAX_COMPRESSED_BYTES = 128 * 1024;
/** The most a snapshot may inflate to on the way back in. */
const MAX_RAW_BYTES = 8 * 1024 * 1024;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface MissionSaveInput {
  sim: Sim;
  /** The mission runtime built over `sim`. */
  runtime: MissionRuntime;
  missionId: string;
  /** The seed the mission was started with. */
  seed: number;
  build: string;
  /** Epoch milliseconds, supplied by the caller (this file reads no clock). */
  savedAt: number;
  /** What the world was built from at mission START: the ledger, the brigade account, the Roar entitlements. Plain JSON. */
  campaign: JsonValue;
  /** The app's own bookkeeping no snapshot can hold (the mission log and so on). Opaque here. */
  shell?: JsonValue;
  /** Default `shippedContentDigest()`. */
  contentDigest?: number;
  /** Default `MISSION_SAVE_MAX_COMPRESSED_BYTES`; a test lowers it. */
  maxCompressedBytes?: number;
}

export interface SuspendedMission {
  version: number;
  simEpoch: number;
  snapshotFormat: number;
  build: string;
  missionId: string;
  seed: number;
  savedAt: number;
  simTick: number;
  contentDigest: number;
  campaign: JsonValue;
  campaignDigest: number;
  shell: JsonValue | null;
  shellDigest: number;
  hashAtSave: { sim: number; runtime: number };
  /** Raw (ungzipped) snapshot size, for the size census. */
  rawBytes: number;
  /** Base64 of the gzipped snapshot. */
  snapshot: string;
}

export type SaveRefusal = 'encode_failed' | 'too_large';
export type ResumeRefusal = 'unreadable' | 'older_version' | 'damaged' | 'world_mismatch';

export type SuspendResult = { ok: true; record: SuspendedMission } | { ok: false; reason: SaveRefusal; detail: string };
export type ParseResult = { ok: true; record: SuspendedMission } | { ok: false; reason: ResumeRefusal };

/** The digest the record keeps of frozen inputs; the caller compares it with `digestOf(liveCampaign)` to see whether the campaign moved. */
export function digestOf(value: JsonValue): number {
  return fnv1a32(canonicalJson(value)) >>> 0;
}

// ---- base64 ----------------------------------------------------------------

const B64_CHUNK = 0x8000;
function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += B64_CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + B64_CHUNK));
  return btoa(s);
}
function fromBase64(text: string): Uint8Array | null {
  try {
    const s = atob(text);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

// ---- save ------------------------------------------------------------------

/**
 * Cuts the mission at a frame boundary. Never throws: a fault of the encoder is `encode_failed`, a snapshot over
 * `MISSION_SAVE_MAX_COMPRESSED_BYTES` is `too_large` (never a truncated record).
 */
export async function suspendMission(input: MissionSaveInput): Promise<SuspendResult> {
  const contentDigest = (input.contentDigest ?? shippedContentDigest()) >>> 0;
  let raw: Uint8Array;
  let campaignDigest: number;
  let shellDigest: number;
  try {
    campaignDigest = digestOf(input.campaign);
    shellDigest = digestOf(input.shell ?? null);
    raw = encodeSim(input.sim, { build: input.build, contentDigest, matchId: input.missionId, frameTick: input.sim.tickCount }, input.runtime);
  } catch (e) {
    return { ok: false, reason: 'encode_failed', detail: e instanceof Error ? e.message : String(e) };
  }
  let gz: Uint8Array;
  try {
    gz = await gzipBytes(raw);
  } catch (e) {
    return { ok: false, reason: 'encode_failed', detail: e instanceof Error ? e.message : String(e) };
  }
  if (gz.byteLength > (input.maxCompressedBytes ?? MISSION_SAVE_MAX_COMPRESSED_BYTES)) return { ok: false, reason: 'too_large', detail: `${gz.byteLength} bytes gzipped` };
  return {
    ok: true,
    record: {
      version: MISSION_SAVE_VERSION,
      simEpoch: SIM_EPOCH,
      snapshotFormat: SNAPSHOT_FORMAT,
      build: input.build,
      missionId: input.missionId,
      seed: input.seed,
      savedAt: input.savedAt,
      simTick: input.sim.tickCount,
      contentDigest,
      campaign: input.campaign,
      campaignDigest,
      shell: input.shell ?? null,
      shellDigest,
      hashAtSave: { sim: input.sim.hash() >>> 0, runtime: input.runtime.digest() >>> 0 },
      rawBytes: raw.byteLength,
      snapshot: toBase64(gz),
    },
  };
}

/** The text a store holds. */
export function serializeSuspended(record: SuspendedMission): string {
  return JSON.stringify(record);
}

// ---- read ------------------------------------------------------------------

const isU32 = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function isJson(v: unknown, depth = 0): v is JsonValue {
  if (depth > 64) return false;
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every((x) => isJson(x, depth + 1));
  if (typeof v === 'object') return Object.values(v as object).every((x) => isJson(x, depth + 1));
  return false;
}

/**
 * Parses the stored text and runs every check that needs no world: the shape, the version stamp, and the frozen inputs against their digests.
 * Pure and synchronous; nothing is built yet, so a refusal costs nothing.
 */
export function parseSuspended(text: string): ParseResult {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return { ok: false, reason: 'unreadable' };
  const r = o as Record<string, unknown>;
  const h = r.hashAtSave as Record<string, unknown> | null | undefined;
  const shapeOk =
    isInt(r.version) && isInt(r.simEpoch) && isInt(r.snapshotFormat) &&
    typeof r.build === 'string' && typeof r.missionId === 'string' &&
    isInt(r.seed) && typeof r.savedAt === 'number' && Number.isFinite(r.savedAt) && isInt(r.simTick) && r.simTick >= 0 &&
    isU32(r.contentDigest) && isU32(r.campaignDigest) && isU32(r.shellDigest) && isInt(r.rawBytes) && r.rawBytes > 0 &&
    typeof r.snapshot === 'string' && r.snapshot.length > 0 &&
    isJson(r.campaign) && (r.shell === null || isJson(r.shell)) &&
    typeof h === 'object' && h !== null && isU32(h.sim) && isU32(h.runtime);
  if (!shapeOk) return { ok: false, reason: 'unreadable' };
  const rec = r as unknown as SuspendedMission;
  // The version stamp. The build string is recorded and never compared: a save survives updates that did not change the sim (lead, GH-1393).
  if (rec.version !== MISSION_SAVE_VERSION || rec.simEpoch !== SIM_EPOCH || rec.snapshotFormat !== SNAPSHOT_FORMAT) return { ok: false, reason: 'older_version' };
  // The frozen inputs the world will be rebuilt from must be the ones that were saved.
  if (digestOf(rec.campaign) !== rec.campaignDigest || digestOf(rec.shell) !== rec.shellDigest) return { ok: false, reason: 'damaged' };
  return { ok: true, record: rec };
}

export interface PreparedResume {
  record: SuspendedMission;
  /** The inflated snapshot. */
  raw: Uint8Array;
  /** True when the shipped data (units, maps, doctrines...) is not the data the save was made under. Not a refusal: the caller words it. */
  contentChanged: boolean;
}
export type PrepareResult = ({ ok: true } & PreparedResume) | { ok: false; reason: ResumeRefusal };

/**
 * Inflates the snapshot and checks its header against the record, still without a world: a snapshot whose own header disagrees with the
 * record (another format, another tick) is `damaged` or `older_version` before a world is built for it.
 */
export async function prepareResume(record: SuspendedMission, opts: { contentDigest?: number } = {}): Promise<PrepareResult> {
  const gz = fromBase64(record.snapshot);
  if (gz === null) return { ok: false, reason: 'damaged' };
  const out = await gunzipCapped(gz, MAX_RAW_BYTES);
  if (!out.ok) return { ok: false, reason: 'damaged' };
  const header = readSnapshotHeader(out.bytes);
  if (header === null) return { ok: false, reason: 'damaged' };
  if (header.format !== SNAPSHOT_FORMAT) return { ok: false, reason: 'older_version' };
  if (out.bytes.byteLength !== record.rawBytes || header.frameTick !== record.simTick) return { ok: false, reason: 'damaged' };
  const contentChanged = ((opts.contentDigest ?? shippedContentDigest()) >>> 0) !== record.contentDigest;
  return { ok: true, record, raw: out.bytes, contentChanged };
}

export type RestoreResult = { ok: true } | { ok: false; reason: ResumeRefusal };

/**
 * Writes the snapshot onto `world`, a world freshly built from the record's frozen inputs and still at tick 0, then proves it: the restored
 * sim hash and runtime digest must be the saved ones BEFORE the first tick. Any refusal leaves `world` half-written: the caller discards it
 * and builds another (`restoreSim`'s contract), and keeps the record.
 */
export function restoreMission(prepared: PreparedResume, world: { sim: Sim; runtime: MissionRuntime }): RestoreResult {
  try {
    restoreSim(world.sim, prepared.raw, world.runtime);
  } catch (e) {
    // The state table or the runtime table changed under the same epoch and format: an older save, not a different world.
    if (e instanceof SnapshotRefused && /^(format |schema digest|runtime schema digest)/.test(e.reason)) return { ok: false, reason: 'older_version' };
    return { ok: false, reason: 'world_mismatch' };
  }
  const { hashAtSave } = prepared.record;
  let sim: number;
  let runtime: number;
  try {
    sim = world.sim.hash() >>> 0;
    runtime = world.runtime.digest() >>> 0;
  } catch {
    return { ok: false, reason: 'damaged' };
  }
  if (sim !== hashAtSave.sim || runtime !== hashAtSave.runtime) return { ok: false, reason: 'damaged' };
  return { ok: true };
}
