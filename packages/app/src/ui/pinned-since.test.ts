import { describe, expect, it } from 'vitest';
import type { SimEvent } from '@lions/sim';
import { PinnedSince } from './pinned-since';

const ev = (kind: string, entity: number, tick: number): SimEvent => ({ kind, entity, tick }) as unknown as SimEvent;

describe('PinnedSince', () => {
  it('counts from the pinned event and forgets on unpin, rout or death', () => {
    const p = new PinnedSince();
    p.onEvents([ev('pinned', 3, 100)]);
    expect(p.ticksPinned(3, 180)).toBe(80);
    p.onEvents([ev('unpinned', 3, 190)]);
    expect(p.ticksPinned(3, 200)).toBeNull();
    p.onEvents([ev('pinned', 4, 10), ev('routed', 4, 210)]);
    expect(p.ticksPinned(4, 220)).toBeNull();
    p.onEvents([ev('pinned', 5, 10), ev('destroyed', 5, 20)]);
    expect(p.ticksPinned(5, 30)).toBeNull();
  });
  it('is null for a unit it never saw go to ground', () => {
    expect(new PinnedSince().ticksPinned(1, 50)).toBeNull();
  });
});
