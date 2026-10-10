// WP-P2 (PA-07): one name per outcome, on every surface that announces it.
//
// The audit found four for each: a victory was "Objective secured" (the held
// moment), "MISSION ACCOMPLISHED" (the feed), "Town is quiet" (the end panel,
// the tutorial's too) and "Named in brigade orders" (the debrief, which is a
// GRADE); a defeat was "Attempt failed", "MISSION FAILED", "FAILED — every
// unit lost" and "Withdraw and regroup". Each surface's own key is resolved
// here and compared, case-folded, against ONE literal per outcome -- literals,
// so a rename of every surface at once still has to be a deliberate edit here.
import { describe, expect, it } from 'vitest';
import en from './en.json';
import { t } from './t';

const plain = (s: string): string => s.replace(/<[^>]+>/g, '').trim().toLowerCase();
/** A feed line's headline: the part before its em-dash detail. */
const headline = (s: string): string => plain(s).split(' — ')[0];

describe('outcome names (PA-07)', () => {
  it('a victory is "Mission accomplished" on every surface', () => {
    const surfaces = {
      moment: t('outcome.victory'),
      banner: t('hud.banner.victory'),
      endPanel: t('menu.end.title', { result: 'victory' }),
      feed: headline(t('mission.notice.missionAccomplished', { roe: 90, n: 3 })),
    };
    for (const [where, text] of Object.entries(surfaces)) expect(plain(text), where).toBe('mission accomplished');
  });

  it('a defeat is "Mission failed" on every surface', () => {
    const surfaces = {
      moment: t('outcome.defeat'),
      banner: t('hud.banner.defeat'),
      endPanel: t('menu.end.title', { result: 'defeat' }),
      feed: headline(t('mission.notice.missionFailed')),
      clock: t('hud.clock.failed'),
    };
    for (const [where, text] of Object.entries(surfaces)) expect(plain(text), where).toBe('mission failed');
  });

  it('no surface carries a second name for either outcome', () => {
    // The retired names, and the bare tags that sat beside the titles.
    const retired = /town is quiet|withdraw and regroup|objective secured|attempt failed|^victory$|^defeat$|^failed —/i;
    const offenders = Object.entries(en as Record<string, string>)
      .flatMap(([key]) =>
        ['victory', 'defeat'].map((result) => [key, t(key, { result, n: 1, roe: 90, text: 'x', at: '0:00' })])
      )
      .filter(([, text]) => retired.test(plain(text)))
      .map(([key, text]) => `${key}: ${text}`);
    expect(offenders).toEqual([]);
  });
});
