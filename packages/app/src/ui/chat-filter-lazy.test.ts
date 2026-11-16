/**
 * The chat word lists are a lazy chunk (`@lions/data/chat-filters`): main was red once for the entry chunk going over its byte guard, and
 * these lists were 16 KB of the next overage. Until they load the filter is CLOSED (hides every line, every name reads as the fallback), so
 * a slow or failed load can never show an unfiltered word. This file never preloads in its first test, so it sees the unloaded state.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CALLSIGN } from '@lions/net';
import { CLOSED_FILTER, filterLine, preloadChatFilter, screenName, shippedFilter } from './chat-filter';

const src = (rel: string): string => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('the lists load on demand and fail closed', () => {
  it('before the lists have loaded, every line is hidden and every name is the fallback', () => {
    const f = shippedFilter('en');
    expect(f).toBe(CLOSED_FILTER);
    expect(filterLine(f, 'good luck', { mask: true })).toEqual({ kind: 'hide' });
    expect(screenName(f, 'Alice')).toBe(DEFAULT_CALLSIGN);
  });

  it('after the load the real lists apply, and the closed stand-in was never cached', async () => {
    await preloadChatFilter();
    const f = shippedFilter('en');
    expect(f).not.toBe(CLOSED_FILTER);
    expect(filterLine(f, 'good luck', { mask: true })).toEqual({ kind: 'show', text: 'good luck', masked: false });
    expect(screenName(f, 'Alice')).toBe('Alice');
  });
});

describe('the lazy boundary (main.ts, chat-filter.ts, the data package)', () => {
  it('nothing the entry chunk reaches imports the lists statically', () => {
    expect(src('ui/chat-filter.ts')).not.toMatch(/^import (?!type )[^;]*from '@lions\/data\/chat-filters';/m);
    expect(src('ui/chat-filter.ts')).toMatch(/import\('@lions\/data\/chat-filters'\)/);
    expect(readFileSync(join(__dirname, '..', '..', '..', 'data', 'src', 'index.ts'), 'utf8')).not.toMatch(/data\/chat\/filter/);
  });

  it('the versus screens and a room boot wait for the lists', () => {
    const main = src('main.ts');
    expect(main.match(/chatFilterReady\(\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(main).toMatch(/if \(inRoom\) await chatFilterReady\(\);/);
  });
});
