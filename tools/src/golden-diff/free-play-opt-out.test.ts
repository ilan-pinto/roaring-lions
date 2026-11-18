// The lead's ruling of 18 Nov 2026 (PR 1586): field works are ON by default in every KDF Free play (the production
// dock over the canvas, a demolition squad at the friendly anchor), and the visual captures opt out so their frames
// do not move. This pins that EVERY free-play boot the gate photographs carries the opt-out, read from the scenario
// table itself (so a scenario added without it fails here), and that the app's own boot pipeline -- the legacy
// `?sandbox=` redirect, then `bootFlags` -- really reads it as "no field works". The oracle is the app's code, not a
// copy of the rule: a capture URL that the app read as works-on would be the regression.
import { describe, expect, it } from 'vitest';
import { bootFlags } from '../../../packages/app/src/boot-flags';
import { unknownParams } from '../../../packages/app/src/sandbox-help';
import { legacyRedirect } from '../../../packages/app/src/shell/router';
import { GPU_ARMS } from './backend';
import { BASELINES, isGated } from './baseline';
import { SCENARIOS, threeUrl } from './capture-protocol';
import { MENU_HOST_MISSION_PATH } from './screens-check';

/** What the app boots for a URL: the router's legacy redirect, then the boot's own flag pipeline. */
function bootOf(search: string): { path: string; works: boolean; strays: string[] } {
  const redirected = legacyRedirect(search);
  const path = redirected?.path ?? '';
  const query = redirected?.query ?? new URLSearchParams(search);
  const free = path.startsWith('/free-play/');
  const missionId = path.startsWith('/mission/') ? decodeURIComponent(path.slice('/mission/'.length)) : null;
  const flags = bootFlags(query, { missionId: free ? null : missionId, inRoom: false }, () => undefined).flags;
  return { path, works: flags.works, strays: unknownParams(query) };
}

describe('every gated free-play capture opts out of the free-play defaults (the lead, 18 Nov 2026)', () => {
  const sandbox = SCENARIOS.filter((s) => s.sandboxMap !== undefined);

  it('the scenario table has the free-play scenarios this pin is about, gated ones among them (literals)', () => {
    // Not vacuous: an emptied or renamed table would otherwise pass every loop below.
    expect(sandbox.map((s) => s.id).sort()).toEqual(
      ['aftermath', 'dusk', 'fogged', 'graded', 'kitted', 'open-ground', 'quiet', 'ragdoll', 'relief', 'rubble', 'vehicle'].sort(),
    );
    expect(sandbox.filter((s) => isGated(BASELINES[s.id as keyof typeof BASELINES])).length).toBeGreaterThanOrEqual(10);
  });

  it('carries works=0 on every free-play scenario URL, on every backend arm', () => {
    for (const s of sandbox) {
      for (const arm of GPU_ARMS) {
        const url = new URL(threeUrl(5195, s, arm));
        expect(url.searchParams.get('works'), `${s.id}/${arm}`).toBe('0');
      }
    }
  });

  it('boots every one of them as a free play with NO field works and nothing the app would warn about', () => {
    for (const s of sandbox) {
      for (const arm of GPU_ARMS) {
        const got = bootOf(new URL(threeUrl(5195, s, arm)).search);
        expect(got.path, `${s.id}/${arm}`).toBe(`/free-play/${s.sandboxMap}`);
        expect(got.works, `${s.id}/${arm}`).toBe(false);
        expect(got.strays, `${s.id}/${arm}`).toEqual([]);
      }
    }
  });

  it('and the menu-scene-host register boots its sandbox the same way', () => {
    const url = new URL(MENU_HOST_MISSION_PATH, 'http://localhost:5175/');
    expect(url.pathname).toBe('/free-play/beit_sahwan_outskirts');
    expect(url.searchParams.get('works')).toBe('0');
    expect(bootFlags(url.searchParams, { missionId: null, inRoom: false }, () => undefined).flags.works).toBe(false);
  });

  it('the same URL without the opt-out WOULD boot field works: the default the pin guards against is real', () => {
    const s = sandbox[0];
    const url = new URL(threeUrl(5195, s));
    url.searchParams.delete('works');
    expect(bootOf(url.search).works).toBe(true);
  });
});
