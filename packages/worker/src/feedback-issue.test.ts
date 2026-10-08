import { describe, it, expect } from 'vitest';
import { buildIssueLink, redact, type IssueInput } from './feedback-issue';

// Literals, not imports: a drifted constant must go red here.
const ISSUE_NEW_URL = 'https://github.com/ilan-pinto/roaring-lions/issues/new';
const ISSUE_URL_MAX = 7000;

const ORIGIN = 'https://roaring-lions.pint12.workers.dev';
const BASE: IssueInput = {
  id: 42,
  category: 'bug',
  rating: null,
  text: 'I ordered the rifle squad into the house by the well and it walked to the far wall.',
  mission: 'beit_sahwan_2_foothold',
  tick: 467,
  build: '0.122.0',
  commit: '41bc520b',
  context: { renderer: 'three', quality: 'high', gpu: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro)', viewport: [1920, 1080], dpr: 2, locale: 'en' },
  hasReplay: true,
  tester: 'dana_k',
  contact: 'dana@example.com',
  player: '0f8fad5b-d9cb-469f-a165-70867728950e',
  session: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
};

/** Everything a reader of the opened GitHub page would see: the decoded URL. */
const decoded = (url: string): string => {
  const u = new URL(url);
  return [...u.searchParams.values()].join('\n');
};

describe('buildIssueLink', () => {
  it('opens issues/new with the title, body and labels, linking back to the private detail page', () => {
    const l = buildIssueLink(BASE, ORIGIN);
    const u = new URL(l.url);
    expect(`${u.origin}${u.pathname}`).toBe(ISSUE_NEW_URL);
    expect(u.searchParams.get('title')).toBe('Feedback FB-0042: I ordered the rifle squad into the house by the well and it…');
    expect(u.searchParams.get('labels')).toBe('feedback,bug');
    expect(l.body).toContain(`${ORIGIN}/stats/feedback/42`);
    expect(l.body).toContain('| Mission | beit_sahwan_2_foothold, 0:23 on the clock (tick 467) |');
    expect(l.body).toContain('| Build | 0.122.0 (41bc520b) |');
    expect(l.body).toContain('| Screen | 1920x1080, DPR 2, en |');
    expect(l.body).toContain('`pnpm replay:feedback -- --id=42`');
    expect(l.truncated).toBe(false);
  });

  it('never contains the tester label, contact, player id or session id', () => {
    const text = decoded(buildIssueLink(BASE, ORIGIN).url).toLowerCase();
    for (const secret of [BASE.tester, BASE.contact, BASE.player, BASE.session]) expect(text).not.toContain(String(secret).toLowerCase());
  });

  it('...even when the player typed them into the note or a context field', () => {
    const typed: IssueInput = {
      ...BASE,
      text: `I am DANA_K, write to dana@example.com or other@mail.org. My id is ${BASE.player} in ${BASE.session}`,
      context: { ...BASE.context, gpu: `dana_k ${BASE.contact}`, locale: BASE.session },
    };
    const text = decoded(buildIssueLink(typed, ORIGIN).url).toLowerCase();
    for (const secret of [BASE.tester, BASE.contact, BASE.player, BASE.session, 'other@mail.org']) expect(text).not.toContain(String(secret).toLowerCase());
    expect(text).toContain('[redacted]');
  });

  it('puts the note in a fence it cannot close, so it cannot mention, link or embed', () => {
    const hostile = 'ok\n```\n@ilan-pinto look ![x](https://evil.example/p.png)\n````\nmore';
    const l = buildIssueLink({ ...BASE, text: hostile }, ORIGIN);
    // The fence is longer than the longest backtick run inside (4), and the
    // note sits between an opening and closing fence of that same length.
    expect(l.body).toContain('`````text\n' + hostile + '\n`````');
    // Outside the fence, nothing the player wrote appears.
    const outside = l.body.replace(/`````text\n[\s\S]*?\n`````/, '');
    expect(outside).not.toContain('@');
    expect(outside).not.toContain('evil.example');
  });

  it('reduces client strings outside the fence to plain characters', () => {
    const l = buildIssueLink({ ...BASE, context: { ...BASE.context, gpu: '@ilan <img src=x> ![a](http://e.x/i.png) | `x`' } }, ORIGIN);
    const renderer = l.body.split('\n').find((s) => s.startsWith('| Renderer |')) ?? '';
    expect(renderer).not.toMatch(/[@<>![\]`]/);
    expect(renderer.split('|')).toHaveLength(4); // no injected table cells
  });

  it('keeps the whole URL under the cap for the worst note (2000 multibyte characters), cutting the note and saying so', () => {
    for (const ch of ['א', '😀', '%', 'x']) {
      const l = buildIssueLink({ ...BASE, text: ch.repeat(2000) }, ORIGIN);
      expect(l.url.length).toBeLessThanOrEqual(ISSUE_URL_MAX);
      // Either the whole note, or a cut note plus the pointer: never a silent cut.
      if (l.truncated) expect(l.body).toContain('The full note is on the private detail page above.');
      else expect(l.body).toContain(ch.repeat(2000));
      if (ch === 'א' || ch === '😀') expect(l.truncated).toBe(true); // 9-12 URL characters each
      expect(l.body).toContain(`${ORIGIN}/stats/feedback/42`);
    }
  });

  it('a short note is not cut', () => {
    const l = buildIssueLink({ ...BASE, text: 'x'.repeat(400) }, ORIGIN);
    expect(l.truncated).toBe(false);
    expect(l.body).toContain('x'.repeat(400));
  });

  it('a rating with no line, from the menu-less debrief, reads as a rating', () => {
    const l = buildIssueLink({ ...BASE, category: 'rating', rating: 2, text: '', hasReplay: false }, ORIGIN);
    expect(l.title).toBe('Feedback FB-0042: rated 2/5 on beit_sahwan_2_foothold');
    expect(l.body).toContain('_No note: a rating only._');
    expect(l.body).toContain('| Replay | none |');
  });

  it('a note sent from the main menu has no mission and says so', () => {
    const l = buildIssueLink({ ...BASE, mission: null, tick: null, category: 'idea', text: 'Let me rename squads.' }, ORIGIN);
    expect(l.body).toContain('| Mission | (menu) |');
  });
});

describe('redact', () => {
  it('replaces each private value case-insensitively and e-mail addresses, but leaves values under three characters alone', () => {
    expect(redact('Hi DANA, mail a@b.co', ['dana'])).toBe('Hi [redacted], mail [redacted]');
    expect(redact('a bat', ['a'])).toBe('a bat');
    expect(redact('regex (x.y) chars', ['(x.y)'])).toBe('regex [redacted] chars');
  });
});
