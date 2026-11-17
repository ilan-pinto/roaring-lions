// @vitest-environment jsdom
/** GH-1393 slice 2: the campaign board carries the Resume row between its status line and its footer, and tears it down with the screen. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import worldJson from '../../../../data/campaign/world.json';
import countriesJson from '../../../../data/campaign/countries.json';
import { parseCountries, parseWorld } from '../campaign';
import { showCampaign } from './menu';
import { closeOpenDialog, isDialogOpen } from './confirm';
import { resumeRow, type ResumeBlock, type ResumeRowDeps, type ResumeView } from './resume-row';

const NOW = 1_790_000_000_000;
const opts = (resume?: ResumeBlock) => ({ base: '/', world: parseWorld(worldJson), countries: parseCountries(countriesJson), ledger: {}, ...(resume === undefined ? {} : { resume }) });
const resumeDeps = (view: ResumeView): ResumeBlock => () => resumeRow(deps(view));
const deps = (view: ResumeView): ResumeRowDeps => ({ read: () => view, nameOf: () => 'Tel Marum II', resume: vi.fn(), discard: vi.fn(() => true), now: () => NOW });

afterEach(() => { closeOpenDialog(); document.body.replaceChildren(); });

describe('showCampaign with a saved mission', () => {
  it('draws the Resume row inside the footer nav, above the way back and the next mission', () => {
    const stage = document.createElement('div');
    document.body.append(stage);
    showCampaign(stage, opts(resumeDeps({ state: 'ready', missionId: 'tel_marum_2_foothold', savedAt: NOW - 120_000, simTick: 400 })));
    const nav = stage.querySelector('.rl-menu__nav')!;
    const row = nav.querySelector('.rl-resume')!;
    expect(row).not.toBeNull();
    expect(row.textContent).toContain('Tel Marum II');
    expect(Array.from(nav.children).indexOf(row)).toBeLessThan(Array.from(nav.children).indexOf(nav.querySelector('.rl-foot, [class*="foot"]')!));
  });

  it('draws no row when nothing is saved, or when the build passes no resume deps (nothing is read)', () => {
    const none = document.createElement('div');
    showCampaign(none, opts(resumeDeps({ state: 'none' })));
    expect(none.querySelector('.rl-resume')).toBeNull();
    const absent = document.createElement('div');
    showCampaign(absent, opts());
    expect(absent.querySelector('.rl-resume')).toBeNull();
  });

  it('leaving the screen takes the row and an open Discard dialog with it (the disposer contract)', () => {
    const stage = document.createElement('div');
    document.body.append(stage);
    const leave = showCampaign(stage, opts(resumeDeps({ state: 'ready', missionId: 'tel_marum_2_foothold', savedAt: NOW, simTick: 0 })));
    stage.querySelector<HTMLButtonElement>('[data-act="discard"]')!.click();
    expect(isDialogOpen()).toBe(true);
    leave();
    expect(isDialogOpen()).toBe(false);
    expect(stage.querySelector('.rl-resume')).toBeNull();
    expect(stage.querySelector('.rl-menu')).toBeNull();
  });
});
