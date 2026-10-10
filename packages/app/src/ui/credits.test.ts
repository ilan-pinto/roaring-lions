// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { licenceBlocks, showCredits, type CreditsDeps } from './credits';
import { CREDITS } from '../credits-data';

function deps(overrides: Partial<CreditsDeps> = {}): CreditsDeps {
  return {
    base: '/',
    build: '0.68.0-test',
    back: '/',
    fetchText: vi.fn().mockResolvedValue('licence body text'),
    ...overrides,
  };
}

describe('showCredits', () => {
  it('draws its back link with the GH-261 arrow, words beside it', () => {
    const stage = document.createElement('div');
    showCredits(stage, deps());
    const back = stage.querySelector('.rl-credits__back');
    expect(back?.querySelector('svg')?.getAttribute('data-symbol')).toBe('back');
    expect(back?.textContent?.trim()).toBe('Main menu');
  });

  // GH-498: as Saves. Falsified by hand: appending the foot to `p.body`.
  it('keeps the way back in a sticky footer row outside the body', () => {
    const stage = document.createElement('div');
    showCredits(stage, deps());
    const foot = stage.querySelector('.rl-panel > .rl-foot.rl-foot--sticky');
    expect(foot).not.toBeNull();
    expect(foot?.closest('.rl-panel__body')).toBeNull();
    expect(foot?.querySelector('.rl-foot__start > [data-kind="back"]')).toBe(stage.querySelector('.rl-credits__back'));
  });

  it('renders every library name, and no Namer credit (PA-29)', () => {
    const stage = document.createElement('div');
    showCredits(stage, deps());
    const text = stage.textContent ?? '';
    for (const lib of CREDITS.libraries) {
      expect(text).toContain(lib.name);
      expect(text).toContain(lib.version);
    }
    expect(text).not.toContain('Mutte');
    expect(text).not.toContain('BlendSwap');
    expect(text).not.toMatch(/sprite sheet|NAMER_/i);
    expect(text).toContain(`Build ${'0.68.0-test'}`);
  });

  it('gives each CC BY work its title, author, source URI, licence URI and use', () => {
    const stage = document.createElement('div');
    showCredits(stage, deps());
    const items = [...stage.querySelectorAll('.rl-credits__asset')];
    expect(items.length).toBe(CREDITS.assets.length);
    CREDITS.assets.forEach((a, i) => {
      const li = items[i]!;
      const text = li.textContent ?? '';
      expect(text).toContain(`“${a.title}”`);
      expect(text).toContain(a.author);
      expect(text).toContain(a.licence);
      expect(text).not.toContain(a.useKey);
      // The URIs are printed as link TEXT, not hidden behind a label.
      const hrefs = [...li.querySelectorAll('a')].map((el) => [el.getAttribute('href'), el.textContent]);
      expect(hrefs).toContainEqual([a.sourceUrl, a.sourceUrl]);
      expect(hrefs).toContainEqual([a.licenceUrl, a.licenceUrl]);
    });
  });

  it('names every font and the licence, unresolved until its details is opened', () => {
    const stage = document.createElement('div');
    const fetchText = vi.fn().mockResolvedValue('licence body text');
    showCredits(stage, deps({ fetchText }));
    for (const font of CREDITS.fonts) expect(stage.textContent).toContain(font.family);
    expect(fetchText).not.toHaveBeenCalled();
  });

  it('opening a <details> calls fetchText with the right URL and shows its text', async () => {
    const stage = document.createElement('div');
    const fetchText = vi.fn().mockResolvedValue('== OFL text for Barlow ==');
    showCredits(stage, deps({ base: '/game/', fetchText }));
    const details = [...stage.querySelectorAll('details')].find((d) => d.textContent?.includes('Barlow'))!;
    expect(details).toBeDefined();
    const summary = details.querySelector('summary')!;
    summary.click();
    expect(fetchText).toHaveBeenCalledWith('/game/fonts/OFL-Barlow.txt');
    await Promise.resolve();
    await Promise.resolve();
    expect(details.textContent).toContain('== OFL text for Barlow ==');
  });

  it('a rejected fetch shows the fallback', async () => {
    const stage = document.createElement('div');
    const fetchText = vi.fn().mockRejectedValue(new Error('offline'));
    showCredits(stage, deps({ fetchText }));
    const details = [...stage.querySelectorAll('details')].find((d) => d.textContent?.includes('Barlow'))!;
    const summary = details.querySelector('summary')!;
    summary.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(details.textContent).toContain('licence text unavailable offline');
  });

  it('a second open does not fetch again', async () => {
    const stage = document.createElement('div');
    const fetchText = vi.fn().mockResolvedValue('text');
    showCredits(stage, deps({ fetchText }));
    const details = [...stage.querySelectorAll('details')].find((d) => d.textContent?.includes('Barlow'))!;
    const summary = details.querySelector('summary')!;
    summary.click();
    await Promise.resolve();
    await Promise.resolve();
    summary.click();
    summary.click();
    await Promise.resolve();
    expect(fetchText).toHaveBeenCalledTimes(1);
  });

  it('shows the licence line and the back link, and disposes cleanly', () => {
    const stage = document.createElement('div');
    const dispose = showCredits(stage, deps({ back: '/menu-home' }));
    expect(stage.textContent).toContain(`Code: ${CREDITS.codeLicence}`);
    expect(stage.textContent).toContain(`Art and data: ${CREDITS.artLicence}`);
    const back = stage.querySelector<HTMLAnchorElement>('a[data-kind="back"]')!;
    expect(back.getAttribute('href')).toBe('/menu-home');
    dispose();
    expect(stage.children.length).toBe(0);
  });
});

// PA-29: the OFL text is set as paragraphs and headings in a collapsible block,
// and the licence must still ship WHOLE. The oracle takes the shipped files
// from disk, not from the code under test.
describe('the OFL text, set readably', () => {
  const FONTS = `${process.cwd()}/assets/fonts/`; // vitest runs from the repo root
  const files = readdirSync(FONTS).filter((f) => /^OFL-.*\.txt$/.test(f));
  const words = (s: string): string[] => s.split(/\s+/).filter((w) => w !== '' && !/^-{5,}$/.test(w));

  it('finds the three shipped licence files', () => {
    expect(files.length).toBe(3);
  });

  it.each(files)('%s: every word of the file is on screen, in order, nothing added', async (file) => {
    const text = readFileSync(`${FONTS}${file}`, 'utf8');
    const stage = document.createElement('div');
    showCredits(stage, deps({ fetchText: vi.fn().mockResolvedValue(text) }));
    const family = file.replace(/^OFL-|\.txt$/g, '');
    const details = [...stage.querySelectorAll('details')].find((d) => d.querySelector('summary')?.textContent?.replace(/\s/g, '').includes(family.slice(0, 5)))!;
    details.querySelector('summary')!.click();
    await new Promise((r) => setTimeout(r, 0));
    const body = details.querySelector('.rl-credits__licence-text')!;
    // Element by element: `textContent` alone would glue a heading to the
    // paragraph after it and hide a lost word behind a merged one.
    const shown = [...body.children].map((c) => c.textContent ?? '').join(' ');
    expect(words(shown)).toEqual(words(text));
  });

  it('is not a <pre>, reflows the hard wraps and sets the section titles as headings', async () => {
    const text = readFileSync(`${FONTS}OFL-Barlow.txt`, 'utf8');
    const stage = document.createElement('div');
    showCredits(stage, deps({ fetchText: vi.fn().mockResolvedValue(text) }));
    const details = [...stage.querySelectorAll('details')].find((d) => d.textContent?.includes('Barlow'))!;
    details.querySelector('summary')!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(details.querySelector('pre')).toBeNull();
    const heads = [...details.querySelectorAll('h4')].map((h) => h.textContent);
    expect(heads).toEqual(['PREAMBLE', 'DEFINITIONS', 'PERMISSION & CONDITIONS', 'TERMINATION', 'DISCLAIMER']);
    // No paragraph carries the file's hard line breaks.
    expect(details.querySelector('.rl-credits__licence-text')!.textContent).not.toContain('\n');
    // The 1)..5) conditions are five paragraphs, not one.
    const conditions = [...details.querySelectorAll('p')].filter((p) => /^\d\) /.test(p.textContent ?? ''));
    expect(conditions.length).toBe(5);
  });

  it('licenceBlocks keeps the disclaimer whole: its all-caps body is not mistaken for headings', () => {
    const blocks = licenceBlocks('DISCLAIMER\nTHE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,\nEXPRESS OR IMPLIED.');
    expect(blocks.map((b) => b.kind)).toEqual(['head', 'para']);
  });
});
