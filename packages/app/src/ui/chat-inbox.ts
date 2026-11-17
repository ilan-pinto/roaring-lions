// packages/app/src/ui/chat-inbox.ts
/**
 * The one door a received chat line goes through (GH-1417, `docs/superpowers/specs/2026-11-16-versus-chat-safety-design.md`
 * section 3.1, slice S1).
 *
 * A line reaches the screen in two places: the lobby log (`ui/versus.ts`, `NetChat.receive`) and the match's HUD feed (`main.ts`,
 * `chatFeedLine`). Both are fed by the transport's `onChat`, and BOTH call `inbox.deliver` and nothing else, so what a player has
 * turned off or muted can never be drawn by one sink while the other hides it. `chat-inbox-guard.test.ts` reads the source and fails
 * when a third place reads a raw line, or when either sink stops going through here.
 *
 * What the inbox decides, in order:
 *  1. **Chat off** (Settings, Chat): every line is hidden. The room is told nothing.
 *  2. **A muted seat**: that seat's lines are hidden for the rest of the room. Muting is per ROOM, not persistent: the lobby and the
 *     match are one room and share one transport, so the inbox lives with the transport (`inboxOf`) and a mute made in the lobby holds
 *     in the match. A guest cannot be recognised in a later room by design (per-match seat tokens), so nothing here is stored.
 *
 *  3. **A blocked member** (S3, D5): a member the player blocked on this device (`chat/block-list.ts`, by public id) is hidden in this room
 *     and every later one. A guest has no id to block, so a guest is only ever muted.
 *
 * The inbox also keeps the reporter's own copy of the last ten lines received (S3, D6), which is all a report carries as evidence.
 *
 * Presentation only: nothing here touches a command, a frame or the sim (invariant 4), and the room still relays and rate-limits every
 * line. The word filter is a later slice and waits for the lead's decisions.
 */
import type { Seat } from '@lions/net';
import type { BlockList } from '../chat/block-list';
import { REPORT_LINES_MAX, type ReportLine } from '../feedback/report';

export type ChatVerdict = 'show' | 'off' | 'blocked' | 'muted';

/** What `inboxOf` is told besides the settings source, as ONE options object so a second slice adds a field instead of a positional argument
 *  (S2's word filter lands beside `who`): `who` is the persistent block's identity source; `preview` is how a received line may be SHOWN to
 *  the reporter in the report dialog, `null` when the player's own filter hid it (the dialog then says so; the raw text is still what a
 *  report carries as evidence). Absent `preview`, a line is shown as it came. */
export interface InboxOptions {
  who?: InboxWho;
  preview?: (text: string) => string | null;
}

/** The lines a report dialog is opened on, taken ONCE: the dialog shows them and every send and retry sends exactly them. */
export interface ReportSnapshot {
  /** The raw lines, oldest first: the evidence. */
  lines: ReportLine[];
  /** What each may be shown as to the reporter, same length; null where the player's filter hid the line. */
  shown: (string | null)[];
}

/** Who a seat is, for the persistent block (GH-1417 S3): the lists to consult and each seat's member public id (null for a guest or bot). */
export interface InboxWho {
  blocks: BlockList;
  publicIdOf(seat: Seat): string | null;
}

export class ChatInbox {
  private readonly muted = new Set<Seat>();
  private readonly listeners = new Set<() => void>();
  /** The reporter's own copy of the room's recent lines, oldest first (D6: the evidence of a report is this, labelled unverified). */
  private readonly ring: ReportLine[] = [];
  private who: InboxWho | null = null;
  private preview: (text: string) => string | null = (t) => t;
  private unwatchBlocks: (() => void) | null = null;

  /** `enabled` is read at every line, so a setting changed over a running match applies to the next line. */
  constructor(private enabled: () => boolean) {}

  /** The settings source, replaced by whichever screen asks for the inbox last (the lobby, then the battlefield). */
  useEnabled(enabled: () => boolean): void {
    this.enabled = enabled;
  }

  /** What the next screen to ask hands over, replacing the last one's (the lobby, then the battlefield). */
  useOptions(o: InboxOptions): void {
    if (o.who !== undefined) this.useWho(o.who);
    if (o.preview !== undefined) this.preview = o.preview;
  }

  /** The block list and the seats' public ids. */
  useWho(who: InboxWho): void {
    if (this.who?.blocks !== who.blocks) {
      this.unwatchBlocks?.();
      this.unwatchBlocks = who.blocks.onChange(() => this.notify());
    }
    this.who = who;
  }

  isEnabled(): boolean {
    return this.enabled();
  }

  /** The member public id of this seat, or null (a guest, a bot, or no identity known yet). */
  publicIdOf(seat: Seat): string | null {
    return this.who?.publicIdOf(seat) ?? null;
  }

  /** True when the player has blocked the member sitting in this seat. Never true for a guest: there is nothing to recognise. */
  isBlocked(seat: Seat): boolean {
    const id = this.publicIdOf(seat);
    return id !== null && this.who !== null && this.who.blocks.has(id);
  }

  /** Whether this seat can be blocked at all: only a member has a public id (D5). */
  canBlock(seat: Seat): boolean {
    return this.publicIdOf(seat) !== null;
  }

  verdict(seat: Seat): ChatVerdict {
    if (!this.enabled()) return 'off';
    if (this.isBlocked(seat)) return 'blocked';
    return this.muted.has(seat) ? 'muted' : 'show';
  }

  /** Hands `text` to `show` if, and only if, this seat's line may be drawn. The only way a sink learns a received line. */
  deliver(seat: Seat, text: string, show: (text: string) => void): void {
    // While chat is on, the line goes in the reporter's copy even when this seat is muted or blocked: muting someone and then
    // reporting them is the ordinary order. With chat off nothing is kept, because nothing was shown.
    if (this.enabled()) this.record(seat, text);
    if (this.verdict(seat) === 'show') show(text);
  }

  private record(seat: Seat, text: string): void {
    const first = !this.ring.some((l) => l.seat === seat);
    this.ring.push({ seat, text });
    while (this.ring.length > REPORT_LINES_MAX) this.ring.shift();
    // The Report control appears once the other seat has said something; tell the chat when that first happens.
    if (first) this.notify();
  }

  /** The last lines received, oldest first, as the reporter saw the room (at most `REPORT_LINES_MAX`). */
  recent(): ReportLine[] {
    return this.ring.map((l) => ({ ...l }));
  }

  /** `recent()` plus how each line may be shown, taken at one instant. A report dialog takes this once and never asks the ring again. */
  snapshot(): ReportSnapshot {
    const lines = this.recent();
    return { lines, shown: lines.map((l) => this.preview(l.text)) };
  }

  /** Whether `seat` has said anything in this room: a report needs something to point at. */
  hasHeard(seat: Seat): boolean {
    return this.ring.some((l) => l.seat === seat);
  }

  /** Blocks (or unblocks) the member in `seat` on this device. False when the seat is not a member. */
  setBlocked(seat: Seat, on: boolean): boolean {
    const id = this.publicIdOf(seat);
    if (id === null || this.who === null) return false;
    if (on) return this.who.blocks.add(id);
    this.who.blocks.remove(id);
    return true;
  }

  toggleBlocked(seat: Seat): boolean {
    this.setBlocked(seat, !this.isBlocked(seat));
    return this.isBlocked(seat);
  }

  private notify(): void {
    for (const fn of [...this.listeners]) fn();
  }

  isMuted(seat: Seat): boolean {
    return this.muted.has(seat);
  }

  setMuted(seat: Seat, on: boolean): void {
    if (on === this.muted.has(seat)) return;
    if (on) this.muted.add(seat);
    else this.muted.delete(seat);
    this.notify();
  }

  toggleMuted(seat: Seat): boolean {
    this.setMuted(seat, !this.muted.has(seat));
    return this.muted.has(seat);
  }

  /** Calls `fn` when a mute changes; returns the unsubscribe. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

const INBOXES = new WeakMap<object, ChatInbox>();

/**
 * The inbox of one room, keyed by its transport: the lobby screen and the battlefield are different modules holding the same transport
 * (`handOver`), so both get the same inbox and a mute carries from one to the other. A transport that is gone takes its inbox with it.
 */
export function inboxOf(transport: object, enabled: () => boolean, opts: InboxOptions = {}): ChatInbox {
  let inbox = INBOXES.get(transport);
  if (inbox === undefined) {
    inbox = new ChatInbox(enabled);
    INBOXES.set(transport, inbox);
  } else inbox.useEnabled(enabled);
  inbox.useOptions(opts);
  return inbox;
}
