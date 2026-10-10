/**
 * The replay log a Bug note can carry (GH-464, spec §4.3): every order the
 * player gave, from mission start, in memory only.
 *
 * The sim is fixed-seed and deterministic, so a mission is reproduced by its
 * start (mission, commit, the ledger the runtime was handed, the account's
 * tiers and unlocks, the deploy picks) plus the player's inputs in tick order:
 * each `dispatch`ed intent and each dock purchase. Nothing the runtime issues
 * itself is recorded -- patrols, civilian flight and triggers replay
 * themselves.
 *
 * A log over its cap is DROPPED WHOLE, never truncated: a replay needs every
 * command from tick 0, and a log missing its tail would reproduce a different
 * battle while claiming to be this one. `sim.hash()` at the send tick goes
 * with it, so a later replay runner (F4) can say "reproduced" only when its
 * own hash agrees.
 */
export const COMMANDS_MAX_BYTES = 64 * 1024;
export const START_MAX_BYTES = 32 * 1024;

export interface ReplayStart {
  mission: string;
  build: string;
  commit?: string;
  /** `Sim`'s constructor seed (a constant today; recorded so it can change). */
  seed: number;
  /** The ledger `startMission` was handed (deploy picks already applied). */
  ledger: unknown;
  /** The account's tiers, as the one `upgradePrepass` read them. */
  tiers: unknown;
  /** Units the account has bought (`kdfUnlockGate`'s `bought`). */
  unlocks: readonly string[];
  /** The roster indices the player sent in, or null for the default force. */
  deploy: readonly number[] | null;
}

export type ReplayEntry = { tick: number; cmd: unknown } | { tick: number; buy: string };

/** The shape the Worker summarises (spec §12.2): `commands`' length, and the
 *  `hash` and `tick` at the moment the note was sent. */
export interface ReplayLog {
  v: 1;
  start: ReplayStart;
  commands: ReplayEntry[];
  /** `sim.hash()` when the note was sent. */
  hash: number;
  /** The tick it was sent at. */
  tick: number;
}

const bytesOf = (v: unknown): number => new TextEncoder().encode(JSON.stringify(v)).length;

export class ReplayRecorder {
  private start: ReplayStart | null = null;
  private entries: ReplayEntry[] = [];
  private bytes = 0;
  private over = false;

  /** A new mission: forget everything before it. */
  begin(start: ReplayStart): void {
    this.start = start;
    this.entries = [];
    this.bytes = 0;
    this.over = bytesOf(start) > START_MAX_BYTES;
  }

  /** One player order, as `dispatch` received it. */
  record(tick: number, cmd: unknown): void {
    this.push({ tick, cmd });
  }

  /** One accepted dock purchase. */
  buy(tick: number, unit: string): void {
    this.push({ tick, buy: unit });
  }

  private push(e: ReplayEntry): void {
    if (this.start === null || this.over) return;
    this.bytes += bytesOf(e) + 1;
    if (this.bytes > COMMANDS_MAX_BYTES) {
      // Whole or nothing: the memory goes too.
      this.over = true;
      this.entries = [];
      return;
    }
    this.entries.push(e);
  }

  /** Can a log be attached at all right now? */
  get available(): boolean {
    return this.start !== null && !this.over;
  }

  /** Roughly how big the attachment would be, for the form's "about N KB". */
  get approxBytes(): number {
    return this.start === null || this.over ? 0 : this.bytes + bytesOf(this.start);
  }

  get count(): number {
    return this.entries.length;
  }

  /** The log as JSON, or null when there is none to give (no mission, or
   *  over the cap). */
  log(tick: number, hash: number): string | null {
    if (this.start === null || this.over) return null;
    const out: ReplayLog = { v: 1, start: this.start, commands: this.entries, hash, tick };
    return JSON.stringify(out);
  }
}
