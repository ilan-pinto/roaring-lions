/**
 * The pause/menu form's draft (GH-464, spec §2): it survives Escape, a tab
 * switch and a reload, because a crash is the moment a bug report matters
 * most. Held in memory and mirrored to browser storage under `lions.feedback.draft`
 * (debounced); only a successful send clears it.
 */
import type { StorageLike } from '../telemetry/identity';
import { FEEDBACK_KINDS, type FeedbackKind } from './meta';

export const DRAFT_KEY = 'lions.feedback.draft';
export const DRAFT_DEBOUNCE_MS = 400;

export interface Draft {
  kind: FeedbackKind | null;
  text: string;
  contact: string;
}

export const EMPTY_DRAFT: Draft = { kind: null, text: '', contact: '' };

let memory: Draft | null = null;

export function readDraft(storage: StorageLike | null): Draft {
  if (memory) return { ...memory };
  try {
    const raw = storage?.getItem(DRAFT_KEY) ?? null;
    const v: unknown = raw === null ? null : JSON.parse(raw);
    if (typeof v === 'object' && v !== null) {
      const o = v as Record<string, unknown>;
      const kind = (FEEDBACK_KINDS as readonly unknown[]).includes(o.kind) ? (o.kind as FeedbackKind) : null;
      memory = {
        kind,
        text: typeof o.text === 'string' ? o.text.slice(0, 4000) : '',
        contact: typeof o.contact === 'string' ? o.contact.slice(0, 240) : '',
      };
      return { ...memory };
    }
  } catch {
    /* unreadable: an empty form */
  }
  return { ...EMPTY_DRAFT };
}

/** Keep `d` in memory now; the caller debounces the storage write. */
export function holdDraft(d: Draft): void {
  memory = { ...d };
}

export function persistDraft(storage: StorageLike | null, d: Draft): void {
  memory = { ...d };
  storage?.setItem(DRAFT_KEY, JSON.stringify(d));
}

export function clearDraft(storage: StorageLike | null): void {
  memory = null;
  storage?.setItem(DRAFT_KEY, JSON.stringify(EMPTY_DRAFT));
}

/** Tests only. */
export function forgetDraftForTest(): void {
  memory = null;
}
