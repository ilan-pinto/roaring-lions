// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import worldJson from '../../../../data/campaign/world.json';
import type { LedgerData } from '@lions/sim';
import { parseWorld } from '../campaign';
import { worldMap } from './worldmap';

const world = parseWorld(worldJson);
const SVG = '<svg viewBox="0 0 1140 790"><g id="region-marj"/><g id="region-sur"/><g id="region-naharin"/></svg>';
const ALL_BS = world.regions[0]!.towns[0]!.missions;

const render = (ledger: LedgerData): HTMLElement =>
  worldMap({ base: '/', world, ledger, svg: SVG, href: (id) => `?mission=${id}` });

const statusOf = (el: HTMLElement, region: string): string | null =>
  el.querySelector(`#region-${region}`)?.getAttribute('data-status') ?? null;

describe('worldMap', () => {
  it('marks each region with its derived status', () => {
    const el = render({});
    expect(statusOf(el, 'marj')).toBe('live');
    expect(statusOf(el, 'sur')).toBe('locked');
  });

  it('flattens a region once every one of its missions is done', () => {
    const el = render({ 'campaign.completed_missions': [...ALL_BS] });
    expect(statusOf(el, 'marj')).toBe('complete');
  });

  it('opens the next region when its gate is met', () => {
    const el = render({ 'campaign.completed_missions': ['beit_sahwan_3_clearance'] });
    expect(statusOf(el, 'sur')).toBe('live');
  });

  it('places one town marker per town, positioned from the data', () => {
    const el = render({});
    const towns = el.querySelectorAll('[data-town]');
    const total = world.regions.reduce((n, r) => n + r.towns.length, 0);
    expect(towns).toHaveLength(total);
    const bs = el.querySelector('[data-town="beit_sahwan"]') as HTMLElement;
    expect(bs.style.left).not.toBe('');
  });

  it('links a live town to its next mission', () => {
    const el = render({});
    const link = el.querySelector('[data-town="beit_sahwan"] a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(`?mission=${ALL_BS[0]}`);
  });

  it('links a town to its next unfinished mission after one is cleared', () => {
    const el = render({ 'campaign.completed_missions': [ALL_BS[0]!] });
    const link = el.querySelector('[data-town="beit_sahwan"] a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(`?mission=${ALL_BS[1]}`);
  });

  it('offers no link for a town with nothing left to play', () => {
    const el = render({ 'campaign.completed_missions': [...ALL_BS] });
    expect(el.querySelector('[data-town="beit_sahwan"] a')).toBe(null);
  });

  it('offers no link for a town with nothing authored yet', () => {
    expect(render({}).querySelector('[data-town="tel_marum"] a')).toBe(null);
  });

  it('says why a locked region is locked, naming the condition', () => {
    const panel = render({}).querySelector('[data-region-card="sur"]') as HTMLElement;
    expect(panel.textContent).toContain('beit_sahwan_3_clearance');
  });

  it('shows each region doctrine and mission count', () => {
    const card = render({}).querySelector('[data-region-card="marj"]') as HTMLElement;
    expect(card.textContent).toContain('tunnels');
    expect(card.textContent).toContain(`0 / ${ALL_BS.length}`);
  });

  it('shows the campaign ROE rating when there is one', () => {
    expect(render({ 'roe.mission_ratings': { a: 82 } }).textContent).toContain('82');
  });

  it('names the worst-rated mission, so a low rating is explainable', () => {
    const el = render({ 'roe.mission_ratings': { beit_sahwan_1_recon: 20, beit_sahwan_2_foothold: 60 } });
    expect(el.textContent).toContain('beit_sahwan_1_recon');
    expect(el.textContent).toContain('40'); // the mean of 20 and 60, computed here not in the sim
  });

  it('renders the cards even when the map failed to load', () => {
    // The caller passes '' when the fetch fails. Degrade, do not disappear.
    const el = worldMap({ base: '/', world, ledger: {}, svg: '', href: (id) => `?mission=${id}` });
    expect(el.querySelector('[data-region-card="marj"]')).not.toBe(null);
  });

  it('does not write to localStorage — the map is a view, not a save', () => {
    const before = window.localStorage.length;
    render({});
    expect(window.localStorage.length).toBe(before);
  });
});
