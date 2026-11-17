/**
 * GH-1393: the "replace the other mission's save?" question, kept behind the save kit (`mission-save-kit.ts`) so its dialog code stays out
 * of the entry chunk. The slot holds ONE save; replacing another mission's is the player's decision, asked before anything is cut or written.
 */
import { t } from './i18n/t';
import { confirmDialog } from './ui/confirm';

/** True when the write may go ahead: nothing else is saved, or the player agreed to replace it. */
export async function confirmReplaceOther(other: string | null, nameOf: (id: string) => string | undefined): Promise<boolean> {
  if (other === null) return true;
  return confirmDialog(document.body, {
    title: t('pause.save.replace.title'),
    body: t('pause.save.replace.body', { name: nameOf(other) ?? other }),
    confirm: t('pause.save.replace.action'),
    danger: true,
  }).answer;
}
