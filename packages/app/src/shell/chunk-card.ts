// The shell's answer to a route chunk that failed twice (`shell/chunk.ts`): the error card (`ui/boot-failure.ts`) with a
// reload control and the way back to the menu, mounted in the route's place. Its disposer removes only the card, which is the
// router's own contract for a screen (the stage's children are all it removes; the card owns nothing outside it).
import { t } from '../i18n/t';
import { mountErrorCard } from '../ui/boot-failure';
import type { ChunkLoadError } from './chunk';
import type { Disposer } from './router';

export function chunkFailedCard(home: string, reload?: () => void): (host: HTMLElement, err: ChunkLoadError) => Disposer {
  return (host, err) => {
    console.error('route chunk failed to load:', err.reason);
    const card = mountErrorCard(
      host,
      { title: t('boot.chunk.title'), body: t('boot.chunk.body'), next: t('boot.chunk.next'), reload: true },
      home,
      reload
    );
    return () => card.remove();
  };
}
