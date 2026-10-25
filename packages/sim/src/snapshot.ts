import { HASH_SEED, hashWord } from './hash';
import { SIM_EVENT_KINDS, STRIKE_SNAPSHOT_KEYS, type FieldPoolKeys, type Sim } from './sim';
import {
  RNG_SNAPSHOT_SCHEMA,
  SIM_SNAPSHOT_SCHEMA,
  rowsOf,
  type SnapshotKind,
  type SnapshotRow,
  type TypedCtor,
} from './snapshot-schema';

// encodeSim / restoreSim (net sim snapshot, stage 1, Task 3).
//
// The bytes are canonical: one state gives one byte string, on any engine. The
// format is little-endian, written through a DataView (a typed array's own
// byte order is the platform's, so its memory is never copied raw). It is
// walked off `SIM_SNAPSHOT_SCHEMA`, whose ORDER is the encoding order:
//
//   header   'RLSS' | format u16 | schema digest u32 | build (u16 len + UTF-8)
//            | contentDigest u32 | matchId (u16 len + UTF-8) | frameTick u32
//            | simTick i32 | capacity u32 | width u32 | height u32
//            | hasBoulders u8 | matchDigest u32
//   columns  every `state` typed array, schema order: u32 length, then elements
//   scalars  every `state` scalar, schema order: i32, or u8 for a boolean
//   rng      Rng.state: u32 length, then elements
//   tail     u32 length, then canonical JSON of the `aux` rows (events,
//            strikes, patrol leg ids, structure tiles)
//
// What is deliberately NOT here: `config` (rebuilt by the setup that built the
// target), `scratch` (overwritten before any read) and `boundary` (the command
// and runtime queues: a snapshot is cut between frames only, so encodeSim
// throws when either holds anything). The flow-field pool is in the tail as its
// KEYS only (`fieldPool`: watermark, per-slot goal/domain/lastIssued, per-domain
// Map order); restoreSim rebuilds every field from them against the restored
// masks, so the field bytes are never written.

/** The format version. Bump it when the byte layout changes; the schema digest covers the table. */
export const SNAPSHOT_FORMAT = 1;

/** What the caller wants written beside the sim state; all optional in S1 (S3 fills them). */
export interface SnapshotMeta {
  build?: string;
  contentDigest?: number;
  matchId?: string;
  frameTick?: number;
  matchDigest?: number;
}

/** A snapshot the decoder will not accept. `reason` says which check failed. */
export class SnapshotRefused extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`snapshot refused: ${reason}`);
    this.name = 'SnapshotRefused';
    this.reason = reason;
  }
}

const MAGIC = [0x52, 0x4c, 0x53, 0x53]; // 'RLSS'
/** The longest build or matchId, in UTF-8 bytes. */
const MAX_META_BYTES = 256;
/** The longest JSON tail the decoder will read. A fixed cap, independent of anything decoded. */
const MAX_TAIL_BYTES = 4 * 1024 * 1024;
/** Nesting the canonical JSON writer and checker will follow. */
const MAX_JSON_DEPTH = 16;

// ---- the one doorway to Sim's private fields --------------------------------
//
// `Sim`'s columns are private (invariant 4: nothing outside the sim mutates sim
// state), and this file is the codec for them, so it reads and writes them by
// name through a cast. This is the ONLY place that does (snapshot-witness.ts and
// the snapshot tests reach it through the export below); the schema table (and
// its completeness test) is what says the names are right. sim.ts takes no
// edit for it.
/** @internal The fork witness and its tests read and mutate the world by schema name through this; nothing else may. */
export function internals(sim: Sim): Record<string, unknown> {
  return sim as unknown as Record<string, unknown>;
}

// ---- schema digest ----------------------------------------------------------

function kindString(kind: SnapshotKind): string {
  switch (kind.t) {
    case 'typed': {
      const len = kind.len;
      const rule = typeof len === 'string' ? len : 'capacityTimes' in len ? `capacityTimes${len.capacityTimes}` : `fixed${len.fixed}`;
      return `typed:${kind.ctor}:${rule}`;
    }
    case 'object':
      return `object:${kind.shape}`;
    default:
      return kind.t;
  }
}

/**
 * The sim's own `hashWord`, folded over every row's name, class and kind (the
 * Sim rows, then Rng's). A build whose table differs in any row, or in their
 * order, gets a different number, and `restoreSim` refuses it.
 */
export function snapshotSchemaDigest(
  rows: readonly SnapshotRow[] = SIM_SNAPSHOT_SCHEMA,
  rngRows: readonly SnapshotRow[] = RNG_SNAPSHOT_SCHEMA
): number {
  let h = HASH_SEED;
  for (const row of [...rows, ...rngRows]) {
    const s = `${row.name}|${row.cls}|${kindString(row.kind)}\n`;
    for (let i = 0; i < s.length; i++) h = hashWord(h, s.charCodeAt(i));
  }
  return h;
}

/** Unsigned, because the header word is read back as a u32. */
const SCHEMA_DIGEST = snapshotSchemaDigest() >>> 0;

// ---- typed-array codecs -----------------------------------------------------

/** @internal The integer typed arrays the snapshot walks. Not in the package index. */
export type Typed = Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array;
/** @internal */
export const isTyped = (v: unknown): v is Typed =>
  v instanceof Int8Array || v instanceof Uint8Array || v instanceof Int16Array || v instanceof Uint16Array || v instanceof Int32Array || v instanceof Uint32Array;

interface Codec {
  readonly size: number;
  readonly is: (a: unknown) => a is Typed;
  readonly get: (v: DataView, o: number) => number;
  readonly set: (v: DataView, o: number, x: number) => void;
}

const CODECS: Record<TypedCtor, Codec> = {
  Int8Array: { size: 1, is: (a): a is Typed => a instanceof Int8Array, get: (v, o) => v.getInt8(o), set: (v, o, x) => v.setInt8(o, x) },
  Uint8Array: { size: 1, is: (a): a is Typed => a instanceof Uint8Array, get: (v, o) => v.getUint8(o), set: (v, o, x) => v.setUint8(o, x) },
  Int16Array: { size: 2, is: (a): a is Typed => a instanceof Int16Array, get: (v, o) => v.getInt16(o, true), set: (v, o, x) => v.setInt16(o, x, true) },
  Uint16Array: { size: 2, is: (a): a is Typed => a instanceof Uint16Array, get: (v, o) => v.getUint16(o, true), set: (v, o, x) => v.setUint16(o, x, true) },
  Int32Array: { size: 4, is: (a): a is Typed => a instanceof Int32Array, get: (v, o) => v.getInt32(o, true), set: (v, o, x) => v.setInt32(o, x, true) },
  Uint32Array: { size: 4, is: (a): a is Typed => a instanceof Uint32Array, get: (v, o) => v.getUint32(o, true), set: (v, o, x) => v.setUint32(o, x, true) },
};

// ---- writer / reader --------------------------------------------------------

class Writer {
  private buf = new Uint8Array(1 << 16);
  private view = new DataView(this.buf.buffer);
  pos = 0;

  private ensure(n: number): void {
    if (this.pos + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.pos + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  u8(x: number): void {
    this.ensure(1);
    this.view.setUint8(this.pos, x);
    this.pos += 1;
  }
  u16(x: number): void {
    this.ensure(2);
    this.view.setUint16(this.pos, x, true);
    this.pos += 2;
  }
  u32(x: number): void {
    this.ensure(4);
    this.view.setUint32(this.pos, x, true);
    this.pos += 4;
  }
  i32(x: number): void {
    this.ensure(4);
    this.view.setInt32(this.pos, x, true);
    this.pos += 4;
  }
  bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
  }
  /** A typed array as u32 length + elements, through its codec. */
  column(codec: Codec, a: Typed): void {
    this.u32(a.length);
    this.ensure(a.length * codec.size);
    for (let i = 0; i < a.length; i++) codec.set(this.view, this.pos + i * codec.size, a[i]);
    this.pos += a.length * codec.size;
  }
  done(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

class Reader {
  pos = 0;
  private readonly view: DataView;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  need(n: number): void {
    if (n > this.bytes.length - this.pos) throw new SnapshotRefused('truncated');
  }
  u8(): number {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }
  u16(): number {
    this.need(2);
    const x = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return x;
  }
  u32(): number {
    this.need(4);
    const x = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return x;
  }
  i32(): number {
    this.need(4);
    const x = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return x;
  }
  /** An i32 at an absolute offset, without moving the cursor. */
  i32At(offset: number): number {
    if (offset < 0 || offset + 4 > this.bytes.length) throw new SnapshotRefused('truncated');
    return this.view.getInt32(offset, true);
  }
  take(n: number): Uint8Array {
    this.need(n);
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  /**
   * Reads a column into `target` in place. The length word must equal the
   * target's own length BEFORE anything is read or written: no allocation, and
   * no loop bound, is ever taken from a decoded number.
   */
  column(codec: Codec, target: Typed, what: string, aliasOf?: string): void {
    const len = this.u32();
    if (len !== target.length) throw new SnapshotRefused(`column ${what}: length ${len}, this world has ${target.length}`);
    this.need(len * codec.size);
    for (let i = 0; i < len; i++) {
      const x = codec.get(this.view, this.pos + i * codec.size);
      if (aliasOf === undefined) target[i] = x;
      else if (target[i] !== x) throw new SnapshotRefused(`column ${what} is the same array as ${aliasOf} in this world, and the two differ`);
    }
    this.pos += len * codec.size;
  }
}

/** True when `s` has an unpaired UTF-16 surrogate (`String.prototype.isWellFormed` is past this lib target). */
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (!(d >= 0xdc00 && d <= 0xdfff)) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
}

function writeString(w: Writer, s: string, what: string): void {
  // A lone surrogate would be silently replaced by U+FFFD on the way out, so the string read back would differ.
  if (hasLoneSurrogate(s)) throw new Error(`encodeSim: ${what} holds an unpaired surrogate`);
  const b = new TextEncoder().encode(s);
  if (b.length > MAX_META_BYTES) throw new Error(`encodeSim: ${what} is ${b.length} bytes, the limit is ${MAX_META_BYTES}`);
  w.u16(b.length);
  w.bytes(b);
}

function readString(r: Reader, what: string): string {
  const len = r.u16();
  if (len > MAX_META_BYTES) throw new SnapshotRefused(`${what}: ${len} bytes, the limit is ${MAX_META_BYTES}`);
  // `fatal` refuses malformed UTF-8; `ignoreBOM` keeps a leading BOM so the text re-encodes to the same bytes.
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(r.take(len));
}

function u32Meta(x: number | undefined, what: string): number {
  const v = x ?? 0;
  if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) throw new Error(`encodeSim: meta.${what} must be a u32, got ${String(v)}`);
  return v;
}

// ---- canonical JSON ---------------------------------------------------------

/**
 * Canonical JSON for the tail: keys sorted, integers only, `-0` written as `0`,
 * and nothing that is not null, a boolean, a string, an integer, an array or a
 * plain object of those. Refuses NaN, Infinity, fractions, `undefined`,
 * functions, symbols, bigints, and objects with a prototype (Map, Set, class
 * instances). Throws a plain Error: this is the encoder's own contract.
 */
export function canonicalJson(v: unknown, depth = 0): string {
  if (depth > MAX_JSON_DEPTH) throw new Error('canonicalJson: nested too deep');
  if (v === null) return 'null';
  switch (typeof v) {
    case 'boolean':
      return v ? 'true' : 'false';
    case 'string':
      return JSON.stringify(v);
    case 'number':
      if (!Number.isInteger(v) || v > Number.MAX_SAFE_INTEGER || v < Number.MIN_SAFE_INTEGER) throw new Error(`canonicalJson: ${String(v)} is not a safe integer`);
      return Object.is(v, -0) ? '0' : String(v);
    case 'object': {
      if (Array.isArray(v)) {
        let out = '[';
        for (let i = 0; i < v.length; i++) {
          if (i > 0) out += ',';
          out += canonicalJson(v[i], depth + 1);
        }
        return out + ']';
      }
      const proto = Object.getPrototypeOf(v) as unknown;
      if (proto !== Object.prototype && proto !== null) throw new Error('canonicalJson: not a plain object');
      const o = v as Record<string, unknown>;
      let out = '{';
      let first = true;
      for (const k of Object.keys(o).sort()) {
        if (k === '__proto__') throw new Error('canonicalJson: key "__proto__"');
        if (!first) out += ',';
        first = false;
        out += JSON.stringify(k) + ':' + canonicalJson(o[k], depth + 1);
      }
      return out + '}';
    }
    default:
      throw new Error(`canonicalJson: cannot encode a ${typeof v}`);
  }
}

// ---- the aux rows (the JSON tail) -------------------------------------------

/** The strike's keys, sorted, from the type-checked tuple in sim.ts. */
const STRIKE_KEYS = [...STRIKE_SNAPSHOT_KEYS].sort().join(',');
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
const isPlain = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);

interface AuxContext {
  readonly self: Record<string, unknown>;
  readonly cells: number;
  readonly maxStructures: number;
}

/**
 * One validator-and-writer per `aux` row. A row with no entry here refuses to
 * encode AND to decode, so a new aux row is a red test, not a silent gap.
 * Each takes the decoded JSON value, checks its shape and writes it onto the
 * target (the readonly containers in place, the others by assignment).
 */
const AUX_RESTORE: Record<string, (value: unknown, c: AuxContext) => void> = {
  patrolLegIds(value, c) {
    const t = c.self.patrolLegIds as number[];
    if (!Array.isArray(value) || value.length !== t.length || !value.every(isInt)) throw new SnapshotRefused('patrolLegIds: bad shape');
    for (let i = 0; i < t.length; i++) t[i] = value[i] as number;
  },
  pendingStrikes(value, c) {
    if (!Array.isArray(value)) throw new SnapshotRefused('pendingStrikes: not an array');
    for (const s of value) {
      const keys = isPlain(s) ? Object.keys(s).sort().join(',') : '';
      if (!isPlain(s) || keys !== STRIKE_KEYS || !Object.values(s).every(isInt)) {
        throw new SnapshotRefused('pendingStrikes: bad entry');
      }
    }
    c.self.pendingStrikes = value;
  },
  pendingEvents(value, c) {
    if (!Array.isArray(value)) throw new SnapshotRefused('pendingEvents: not an array');
    const kinds: readonly string[] = SIM_EVENT_KINDS;
    for (const e of value) {
      if (!isPlain(e) || typeof e.kind !== 'string' || !kinds.includes(e.kind) || !isInt(e.tick)) {
        throw new SnapshotRefused('pendingEvents: bad entry');
      }
    }
    c.self.pendingEvents = value;
  },
  stTiles(value, c) {
    if (!Array.isArray(value) || value.length > c.maxStructures) throw new SnapshotRefused('stTiles: bad shape');
    for (const tiles of value) {
      if (!Array.isArray(tiles) || !tiles.every((t) => isInt(t) && t >= 0 && t < c.cells)) throw new SnapshotRefused('stTiles: bad tile list');
    }
    const t = c.self.stTiles as number[][];
    t.length = 0;
    for (const tiles of value as number[][]) t.push([...tiles]);
  },
};

/** The tail key the flow-field pool's keys live under (not an `aux` row: the pool rows are `pool`). */
const POOL_TAIL_KEY = 'fieldPool';

/** The JSON shape of `FieldPoolKeys`; what the numbers MEAN is `Sim.restoreFieldPool`'s to check. */
function parseFieldPoolKeys(value: unknown): FieldPoolKeys {
  if (!isPlain(value) || Object.keys(value).sort().join(',') !== 'order,slots,watermark') throw new SnapshotRefused('fieldPool: bad shape');
  const { watermark, slots, order } = value;
  if (!isInt(watermark) || !Array.isArray(slots) || !Array.isArray(order)) throw new SnapshotRefused('fieldPool: bad shape');
  const outSlots: FieldPoolKeys['slots'] = [];
  for (const s of slots) {
    if (!isPlain(s) || Object.keys(s).sort().join(',') !== 'domain,goal,lastIssued' || !Object.values(s).every(isInt)) {
      throw new SnapshotRefused('fieldPool: bad slot');
    }
    outSlots.push({ goal: s.goal as number, domain: s.domain as number, lastIssued: s.lastIssued as number });
  }
  const outOrder: number[][] = [];
  for (const list of order) {
    if (!Array.isArray(list) || !list.every(isInt)) throw new SnapshotRefused('fieldPool: bad order list');
    outOrder.push(list as number[]);
  }
  return { watermark, slots: outSlots, order: outOrder };
}

function auxRows(): SnapshotRow[] {
  return rowsOf('state').filter((r) => r.kind.t === 'aux');
}

// ---- encode -----------------------------------------------------------------

function typedRows(rows: readonly SnapshotRow[]): (SnapshotRow & { kind: Extract<SnapshotKind, { t: 'typed' }> })[] {
  return rows.filter((r): r is SnapshotRow & { kind: Extract<SnapshotKind, { t: 'typed' }> } => r.kind.t === 'typed');
}

function typedOf(owner: Record<string, unknown>, row: { name: string; kind: { ctor: TypedCtor } }): { codec: Codec; array: Typed } {
  const codec = CODECS[row.kind.ctor];
  const a = owner[row.name];
  if (!codec.is(a)) throw new Error(`snapshot: ${row.name} is not a ${row.kind.ctor}`);
  return { codec, array: a };
}

/** Encodes `sim` (cut between frames) to canonical bytes. Throws if inputs are still queued. */
export function encodeSim(sim: Sim, meta: SnapshotMeta = {}): Uint8Array {
  const self = internals(sim);
  if ((self.commandQueue as unknown[]).length > 0 || (self.runtimeQueue as unknown[]).length > 0) {
    throw new Error('encodeSim: commands are still queued; a snapshot is cut between frames only');
  }
  const w = new Writer();
  for (const b of MAGIC) w.u8(b);
  w.u16(SNAPSHOT_FORMAT);
  w.u32(SCHEMA_DIGEST);
  writeString(w, meta.build ?? '', 'meta.build');
  w.u32(u32Meta(meta.contentDigest, 'contentDigest'));
  writeString(w, meta.matchId ?? '', 'meta.matchId');
  w.u32(u32Meta(meta.frameTick, 'frameTick'));
  w.i32(sim.tickCount);
  w.u32(sim.capacity);
  w.u32(sim.width);
  w.u32(sim.height);
  w.u8(self.hasBoulders ? 1 : 0);
  w.u32(u32Meta(meta.matchDigest, 'matchDigest'));

  const state = rowsOf('state');
  for (const row of typedRows(state)) {
    const { codec, array } = typedOf(self, row);
    w.column(codec, array);
  }
  for (const row of state) {
    if (row.kind.t !== 'scalar') continue;
    const v = self[row.name];
    if (typeof v === 'boolean') w.u8(v ? 1 : 0);
    else if (isInt(v) && v >= -0x80000000 && v <= 0x7fffffff) w.i32(v);
    else throw new Error(`encodeSim: scalar ${row.name} is not an i32 or a boolean (${String(v)})`);
  }
  const rng = self.rng as Record<string, unknown>;
  for (const row of typedRows(RNG_SNAPSHOT_SCHEMA)) {
    const { codec, array } = typedOf(rng, row);
    w.column(codec, array);
  }

  // The `pool` rows (fieldByGoal, fieldGoalKey, fieldDomain, fieldLastIssued) are
  // the tail's `fieldPool` key; the `derived` `fields` row is never encoded.
  const tail: Record<string, unknown> = {};
  for (const row of auxRows()) {
    if (!Object.hasOwn(AUX_RESTORE, row.name)) throw new Error(`encodeSim: aux row ${row.name} has no codec`);
    tail[row.name] = self[row.name];
  }
  tail[POOL_TAIL_KEY] = sim.fieldPoolKeys();
  const tb = new TextEncoder().encode(canonicalJson(tail));
  w.u32(tb.length);
  w.bytes(tb);
  return w.done();
}

// ---- restore ----------------------------------------------------------------

/**
 * Writes the snapshot `bytes` onto `sim`, which must be a world freshly built
 * by the same setup (same map, same unit and structure types, same boulders)
 * and still at tick 0. Returns the caller's meta as written.
 *
 * It REFUSES rather than clamps: any problem throws `SnapshotRefused` (a
 * malformed input never throws anything else). The header is checked before
 * anything is written, but the columns are then written in place, so a refusal
 * after the header leaves `sim` HALF-WRITTEN: the caller must discard it and
 * build another (spec 5.5: restore onto a world built for the purpose).
 */
export function restoreSim(sim: Sim, bytes: Uint8Array): Required<SnapshotMeta> {
  try {
    return restoreInner(sim, bytes);
  } catch (e) {
    if (e instanceof SnapshotRefused) throw e;
    throw new SnapshotRefused(`malformed: ${e instanceof Error ? e.message : 'unknown failure'}`);
  }
}

function restoreInner(sim: Sim, bytes: Uint8Array): Required<SnapshotMeta> {
  const self = internals(sim);
  const r = new Reader(bytes);

  // ---- header: every check here, before the first write.
  for (const b of MAGIC) if (r.u8() !== b) throw new SnapshotRefused('not a snapshot (bad magic)');
  const format = r.u16();
  if (format !== SNAPSHOT_FORMAT) throw new SnapshotRefused(`format ${format}, this build reads ${SNAPSHOT_FORMAT}`);
  const digest = r.u32();
  if (digest !== SCHEMA_DIGEST) throw new SnapshotRefused('schema digest differs: written by a build with another state table');
  const build = readString(r, 'build');
  const contentDigest = r.u32();
  const matchId = readString(r, 'matchId');
  const frameTick = r.u32();
  const simTick = r.i32();
  const capacity = r.u32();
  const width = r.u32();
  const height = r.u32();
  const hasBoulders = r.u8();
  const matchDigest = r.u32();
  if (capacity !== sim.capacity) throw new SnapshotRefused(`capacity ${capacity}, this world has ${sim.capacity}`);
  if (width !== sim.width) throw new SnapshotRefused(`width ${width}, this world has ${sim.width}`);
  if (height !== sim.height) throw new SnapshotRefused(`height ${height}, this world has ${sim.height}`);
  // `blockedVehicleMask` is `blocked` itself on a map with no boulders: writing
  // one world's columns onto the other's aliasing would corrupt `blocked`.
  if (hasBoulders > 1 || (hasBoulders === 1) !== Boolean(self.hasBoulders)) {
    throw new SnapshotRefused('boulders differ: the target world was not set up like the source');
  }

  // ---- columns, in place (.set-equivalent element writes keep every view aliased).
  const state = rowsOf('state');
  // The stream's own tickCount must agree with the header, and is checked HERE, before the first
  // write: every column's length is the target's (checked again as each is read), so the scalar's
  // offset is known, and a mismatch leaves the target untouched.
  let tickAt = r.pos;
  for (const row of typedRows(state)) tickAt += 4 + typedOf(self, row).array.length * typedOf(self, row).codec.size;
  for (const row of state) {
    if (row.kind.t !== 'scalar') continue;
    if (row.name === 'tickCount') break;
    tickAt += typeof self[row.name] === 'boolean' ? 1 : 4;
  }
  if (simTick < 0 || r.i32At(tickAt) !== simTick) throw new SnapshotRefused('tickCount disagrees with the header');
  // A column that IS another column's array in this world (`blockedVehicleMask` is `blocked` on a
  // map with no boulders) is checked against what the first one wrote, not written over it: two
  // different byte strings for one array would otherwise be accepted, the second silently winning.
  const written = new Map<Typed, string>();
  for (const row of typedRows(state)) {
    const { codec, array } = typedOf(self, row);
    r.column(codec, array, row.name, written.get(array));
    if (!written.has(array)) written.set(array, row.name);
  }
  // ---- scalars. The target's current value says boolean or integer.
  for (const row of state) {
    if (row.kind.t !== 'scalar') continue;
    if (typeof self[row.name] === 'boolean') {
      const b = r.u8();
      if (b > 1) throw new SnapshotRefused(`scalar ${row.name}: ${b} is not a boolean`);
      self[row.name] = b === 1;
    } else {
      self[row.name] = r.i32();
    }
  }
  const rng = self.rng as Record<string, unknown>;
  for (const row of typedRows(RNG_SNAPSHOT_SCHEMA)) {
    const { codec, array } = typedOf(rng, row);
    r.column(codec, array, `rng.${row.name}`);
  }

  // ---- the counts, against the capacities they index, and the type tables.
  const within = (name: string, cap: number): void => {
    const v = self[name] as number;
    if (v < 0 || v > cap) throw new SnapshotRefused(`${name} ${v} is outside 0..${cap}`);
  };
  within('count', sim.capacity);
  within('structureCount_', (self.stAlive as Uint8Array).length);
  within('tunnelCount_', (self.tnAlive as Uint8Array).length);
  within('evacCount', (self.evacX as Int32Array).length);
  const alive = self.alive as Uint8Array;
  const typeIdx = self.typeIdx as Uint16Array;
  const unitTypes = (self.unitTypes as unknown[]).length;
  for (let i = 0; i < alive.length; i++) {
    if (alive[i] !== 0 && typeIdx[i] >= unitTypes) throw new SnapshotRefused(`unit ${i}: type ${typeIdx[i]} is not registered`);
  }
  const stAlive = self.stAlive as Uint8Array;
  const stTypeIdx = self.stTypeIdx as Uint16Array;
  const structureTypes = (self.structureTypes as unknown[]).length;
  for (let s = 0; s < stAlive.length; s++) {
    if (stAlive[s] !== 0 && stTypeIdx[s] >= structureTypes) throw new SnapshotRefused(`structure ${s}: type ${stTypeIdx[s]} is not registered`);
  }

  // ---- the tail: bounded by a fixed cap and by what is left of the input.
  const tailLen = r.u32();
  if (tailLen > MAX_TAIL_BYTES) throw new SnapshotRefused(`tail ${tailLen} bytes, the limit is ${MAX_TAIL_BYTES}`);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(r.take(tailLen));
  const tail: unknown = JSON.parse(text);
  if (!isPlain(tail)) throw new SnapshotRefused('tail is not an object');
  // Canonical or refused: one state, one byte string, so a re-encode is identical.
  if (canonicalJson(tail) !== text) throw new SnapshotRefused('tail is not canonical JSON');
  const names = auxRows().map((row) => row.name);
  if (Object.keys(tail).sort().join(',') !== [...names, POOL_TAIL_KEY].sort().join(',')) throw new SnapshotRefused('tail keys differ from the table');
  const ctx: AuxContext = { self, cells: sim.width * sim.height, maxStructures: stAlive.length };
  for (const name of names) {
    if (!Object.hasOwn(AUX_RESTORE, name)) throw new SnapshotRefused(`aux row ${name} has no codec`);
    AUX_RESTORE[name](tail[name], ctx);
  }
  if (r.pos !== bytes.length) throw new SnapshotRefused('trailing bytes');

  // The flow-field pool, rebuilt from its keys against the masks and elevation written above.
  // `restoreFieldPool` validates before it writes and throws a plain Error, which `restoreSim` wraps.
  sim.restoreFieldPool(parseFieldPoolKeys(tail[POOL_TAIL_KEY]));
  return { build, contentDigest, matchId, frameTick, matchDigest };
}
