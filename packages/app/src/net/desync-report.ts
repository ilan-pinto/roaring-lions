/**
 * A desync's Report (N1b task 11, R-B13/R-B16): the status line's button
 * opens the pause menu on its Feedback tab with the form already filled in.
 * The form is reused unchanged -- the prefill goes through its own draft
 * (`feedback/draft.ts`), which it reads when it mounts -- and the note goes
 * out as an ordinary `bug` from the `pause` source. `FeedbackContext`, the
 * schema and the Worker's validator are untouched: the room code in the text
 * is the reference, and the evidence (both seats' hashes) is already in D1
 * under it (`match_desync`, Task 3), so no replay is attached.
 */
import type { Draft } from '../feedback/draft';
import { TEXT_MAX } from '../feedback/meta';

/** The draft a Report leaves for the form: a bug, the desync line first, the
 *  player's contact and whatever they had already written kept below it (a
 *  second Report does not repeat the line), inside the form's cap. */
export function desyncReportDraft(prev: Draft, line: string): Draft {
  const rest = prev.text.startsWith(line) ? prev.text.slice(line.length) : prev.text.trim() === '' ? '' : `\n\n${prev.text}`;
  return { kind: 'bug', text: [...`${line}${rest}`].slice(0, TEXT_MAX).join(''), contact: prev.contact };
}

/** The pause menu's feedback deps with no replay to offer (R-B16): the form
 *  shows its replay choice only when `replay` is there. */
export function withoutReplay<T extends { replay?: unknown }>(fb: T | undefined): T | undefined {
  return fb === undefined ? undefined : { ...fb, replay: undefined };
}
