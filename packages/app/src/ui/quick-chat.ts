// packages/app/src/ui/quick-chat.ts
/**
 * The phrases of quick chat (GH-1417 S1b, the lead's D12): ids are the protocol's (`QUICK_CHAT_IDS` in `@lions/net`), the words are
 * the catalogue's, drawn in the RECEIVER's language. A literal table, not a computed key, so the i18n tooling sees every key, and read
 * through a function so nothing freezes in the locale that was active at module load.
 */
import { QUICK_CHAT_IDS, type QuickChatId } from '@lions/net';
import { t } from '../i18n/t';

const KEY: Record<QuickChatId, string> = {
  gl: 'net.quick.gl',
  gg: 'net.quick.gg',
  wp: 'net.quick.wp',
  ty: 'net.quick.ty',
  sorry: 'net.quick.sorry',
  ready: 'net.quick.ready',
  wait: 'net.quick.wait',
  attack: 'net.quick.attack',
  defend: 'net.quick.defend',
  help: 'net.quick.help',
  nice: 'net.quick.nice',
  rematch: 'net.quick.rematch',
};

export { QUICK_CHAT_IDS };
export type { QuickChatId };

/** The phrase for `id` in the current locale. */
export function quickChatText(id: QuickChatId): string {
  return t(KEY[id]);
}
