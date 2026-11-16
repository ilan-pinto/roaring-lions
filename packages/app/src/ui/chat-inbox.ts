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
 *  3. **The word filter** (GH-1417 S2, `chat-filter.ts`): a line with a `hide` word is hidden whole, always; a `mask` word is replaced
 *     with *** unless the player turned masking off (Settings, Chat: `mask`, read at every line). There is no switch for `hide`.
 *     The same filter answers `refuses` (the input's nudge: a line the other seat would hide is not sent). Callsigns go through the
 *     same lists where every seat name is made, `net/seat-label.ts`, so the score, the status line and a spectator's strip are covered
 *     too, not only the chat.
 *
 * Presentation only: nothing here touches a command, a frame or the sim (invariant 4), and the room still relays and rate-limits every
 * line. The persistent block and reporting are later slices.
 */
import type { Seat } from '@lions/net';
import { filterLine, shippedFilter, type CompiledFilter } from './chat-filter';

export type ChatVerdict = 'show' | 'off' | 'muted';

export class ChatInbox {
  private readonly muted = new Set<Seat>();
  private readonly listeners = new Set<() => void>();

  /** `enabled` and `mask` are read at every line, so a setting changed over a running match applies to the next line. `filter` is the
   *  shipped lists for the active UI language unless a test hands in its own. */
  constructor(
    private enabled: () => boolean,
    private mask: () => boolean = () => true,
    private readonly filter: () => CompiledFilter = () => shippedFilter(),
  ) {}

  /** The settings source, replaced by whichever screen asks for the inbox last (the lobby, then the battlefield). */
  useEnabled(enabled: () => boolean, mask: () => boolean = () => true): void {
    this.enabled = enabled;
    this.mask = mask;
  }

  isEnabled(): boolean {
    return this.enabled();
  }

  verdict(seat: Seat): ChatVerdict {
    if (!this.enabled()) return 'off';
    return this.muted.has(seat) ? 'muted' : 'show';
  }

  /** Hands `text` to `show` if, and only if, this seat's line may be drawn, with its masked words replaced. The only way a sink learns
   *  a received line. */
  deliver(seat: Seat, text: string, show: (text: string) => void): void {
    if (this.verdict(seat) !== 'show') return;
    const v = filterLine(this.filter(), text, { mask: this.mask() });
    if (v.kind === 'show') show(v.text);
  }

  /** Whether the filter would hide `text` whole: the input's nudge (design 3.3), so a well-meaning player learns before sending. The
   *  receiver's inbox is still the control: a hand-built client skips this and its line is hidden on arrival all the same. */
  refuses(text: string): boolean {
    return filterLine(this.filter(), text, { mask: true }).kind === 'hide';
  }

  isMuted(seat: Seat): boolean {
    return this.muted.has(seat);
  }

  setMuted(seat: Seat, on: boolean): void {
    if (on === this.muted.has(seat)) return;
    if (on) this.muted.add(seat);
    else this.muted.delete(seat);
    for (const fn of [...this.listeners]) fn();
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
export function inboxOf(transport: object, enabled: () => boolean, mask: () => boolean = () => true): ChatInbox {
  let inbox = INBOXES.get(transport);
  if (inbox === undefined) {
    inbox = new ChatInbox(enabled, mask);
    INBOXES.set(transport, inbox);
  } else inbox.useEnabled(enabled, mask);
  return inbox;
}
