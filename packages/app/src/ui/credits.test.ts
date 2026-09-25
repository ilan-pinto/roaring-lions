// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { showCredits, type CreditsDeps } from './credits';
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
  it('renders every library name and the Namer credit', () => {
    const stage = document.createElement('div');
    showCredits(stage, deps());
    const text = stage.textContent ?? '';
    for (const lib of CREDITS.libraries) {
      expect(text).toContain(lib.name);
      expect(text).toContain(lib.version);
    }
    expect(text).toContain('Mutte');
    expect(text).toContain('BlendSwap #75225');
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
