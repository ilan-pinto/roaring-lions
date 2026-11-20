// GH-1418 (lead, 20 Nov 2026): "a real host" in two halves. (a) `playerHost` counts the desktop build, and the three
// player-facing helpers ask it; (b) the networked rule stays off on desktop, and telemetry, accounts and feedback ask it.
// Every gate is run on the same four places with literal oracles: the deployed web host, the desktop page, dev/CI, and a
// production build on this machine. A gate that read one answer for every place fails here.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DESKTOP_HOSTNAME, DESKTOP_PROTOCOL, isDesktopPage, networkedRealHost, playerHost } from './player-host';
import { noGpuNoticeAllowed } from '../ui/no-gpu';
import { qualityHintAllowed } from '../ui/quality-hint';
import { whatsNewAutoOpenAllowed } from '../ui/whats-new';
import { telemetryEnabled } from '../telemetry/enabled';
import { accountsEnabled } from '../account/enabled';
import { feedbackSends, feedbackShown, resetClosedForTest } from '../feedback/gate';

interface Place {
  prod: boolean;
  hostname: string;
  protocol: string;
}
const WEB: Place = { prod: true, hostname: 'roaring-lions.pint12.workers.dev', protocol: 'https:' };
const DESKTOP: Place = { prod: true, hostname: 'roaring-lions.local', protocol: 'app:' };
const DEV: Place = { prod: false, hostname: 'localhost', protocol: 'http:' };
const PREVIEW: Place = { prod: true, hostname: 'localhost', protocol: 'http:' };
const q = (s = ''): URLSearchParams => new URLSearchParams(s);

describe('the desktop page', () => {
  it('is the app: scheme on roaring-lions.local, in a production build', () => {
    expect(DESKTOP_PROTOCOL).toBe('app:');
    expect(DESKTOP_HOSTNAME).toBe('roaring-lions.local');
    expect(isDesktopPage(DESKTOP)).toBe(true);
  });
  it('is not the same host over http (a LAN machine called roaring-lions.local), not a dev build, and not a page with no protocol', () => {
    expect(isDesktopPage({ ...DESKTOP, protocol: 'http:' })).toBe(false);
    expect(isDesktopPage({ ...DESKTOP, protocol: 'https:' })).toBe(false);
    expect(isDesktopPage({ ...DESKTOP, prod: false })).toBe(false);
    expect(isDesktopPage({ prod: true, hostname: 'roaring-lions.local' })).toBe(false);
    expect(isDesktopPage({ ...DESKTOP, hostname: 'other.local' })).toBe(false);
    expect(isDesktopPage(WEB)).toBe(false);
  });
});

describe.each<[string, Place, boolean, boolean]>([
  // place, playerHost (a), networkedRealHost (b)
  ['the deployed web host', WEB, true, true],
  ['the desktop page', DESKTOP, true, false],
  ['pnpm dev, tests and CI', DEV, false, false],
  ['a production build on localhost (vite preview, perf:load)', PREVIEW, false, false],
])('%s', (_name, place, a, b) => {
  it(`(a) playerHost is ${a}`, () => expect(playerHost(place)).toBe(a));
  it(`(b) networkedRealHost is ${b}`, () => expect(networkedRealHost(place)).toBe(b));

  // The three helpers follow (a).
  it(`the no-graphics and software-rendering notices' gate is ${a}`, () => expect(noGpuNoticeAllowed({ ...place, query: q() })).toBe(a));
  it(`the slow-frames quality hint's gate is ${a}`, () => expect(qualityHintAllowed({ ...place, query: q() })).toBe(a));
  it(`What's new opens by itself: ${a}`, () => expect(whatsNewAutoOpenAllowed({ ...place, query: q() })).toBe(a));

  // Everything that talks to the network follows (b).
  it(`telemetry sends: ${b}`, () =>
    expect(telemetryEnabled({ ...place, query: q(), gpc: false, dnt: false, optedOut: false })).toBe(b));
  it(`accounts are on: ${b}`, () => expect(accountsEnabled(q(), place)).toBe(b));
  it(`feedback sends, and its entry points show: ${b}`, () => {
    resetClosedForTest();
    expect(feedbackSends(place)).toBe(b);
    expect(feedbackShown({ ...place, query: q(), storage: null })).toBe(b);
  });
});

describe('the dev opt-ins still open each helper off a real host', () => {
  it('?gpunotice, ?qualityhint and ?whatsnew, each its own', () => {
    expect(noGpuNoticeAllowed({ ...DEV, query: q('gpunotice') })).toBe(true);
    expect(qualityHintAllowed({ ...DEV, query: q('qualityhint') })).toBe(true);
    expect(whatsNewAutoOpenAllowed({ ...DEV, query: q('whatsnew') })).toBe(true);
    expect(noGpuNoticeAllowed({ ...DEV, query: q('qualityhint') })).toBe(false);
    expect(qualityHintAllowed({ ...DEV, query: q('whatsnew') })).toBe(false);
    expect(whatsNewAutoOpenAllowed({ ...DEV, query: q('gpunotice') })).toBe(false);
  });
});

describe('the browser wiring hands each helper the page scheme (pinned as text; jsdom cannot be an app: page)', () => {
  it("What's new's own browser deps read location.protocol", () => {
    const src = readFileSync(new URL('../ui/whats-new.ts', import.meta.url), 'utf8');
    const deps = src.slice(src.indexOf('export function browserWhatsNewDeps'), src.indexOf('export function browserWhatsNewDeps') + 600);
    expect(deps).toContain('autoOpen: whatsNewAutoOpenAllowed({');
    expect(deps).toContain('protocol: location.protocol,');
  });
});
