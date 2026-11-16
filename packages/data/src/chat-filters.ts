/**
 * The chat word lists (GH-1417 S2), on their own subpath: `@lions/data/chat-filters`. They are ~15 KB of words that only the chat
 * filter reads, so they are NOT re-exported from the index: anything reachable from the entry chunk that imported the index would carry
 * them (`webgpu:bundle`'s MAIN CHUNK GUARD, 1850000 bytes, went over by 14 KB when they were). Reach them from a lazy chunk only.
 */
// GH-1417 S2: the chat word filter, one file per language, registered in sorted file order. Chinese is held out (proposal W4).
import chatFilterDe from '../../../data/chat/filter.de.json';
import chatFilterEn from '../../../data/chat/filter.en.json';
import chatFilterEsES from '../../../data/chat/filter.es-ES.json';
import chatFilterFr from '../../../data/chat/filter.fr.json';
import chatFilterRu from '../../../data/chat/filter.ru.json';

/** One language's chat word list (GH-1417 S2): data/chat/filter.<lang>.json against chat_filter.schema.json. Plain words and
 *  phrases only, never a pattern. `hide` hides a whole line whatever the settings; `mask` replaces the word with ***; `allow` names
 *  innocent words that contain a long `hide` entry. `dropped` and `in_house` are the provenance record (`validate:data`). */
export interface ChatFilterJson {
  version: 1;
  lang: string;
  review: 'none' | 'in_house' | 'native';
  comment?: string;
  source: { name: string; url: string; commit: string; file: string; sha256: string; licence: string };
  hide: readonly string[];
  mask: readonly string[];
  allow: readonly string[];
  dropped: readonly string[];
  in_house: readonly string[];
}

/** The chat word lists, in sorted file order. Hand-kept, so `index.test.ts` pins it to the directory: an unregistered file would be
 *  silently inert, a language whose players are never filtered. Read only by the app's chat filter (`ui/chat-filter.ts`). */
export const chatFilters: readonly ChatFilterJson[] = [
  chatFilterDe as ChatFilterJson,
  chatFilterEn as ChatFilterJson,
  chatFilterEsES as ChatFilterJson,
  chatFilterFr as ChatFilterJson,
  chatFilterRu as ChatFilterJson,
];

