// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import worldJson from '../../../../data/campaign/world.json';
import countriesJson from '../../../../data/campaign/countries.json';
import type { LedgerData } from '@lions/sim';
import { parseCountries, parseWorld } from '../campaign';
import { worldMap } from './worldmap';
import { showCampaign, showMenu } from './menu';

const world = parseWorld(worldJson);
const countries = parseCountries(countriesJson);
const ALL_BS = world.regions[0]!.towns[0]!.missions;

const render = (ledger: LedgerData): HTMLElement =>
  worldMap({ base: '/', world, countries, ledger, href: (id) => `?mission=${id}` });

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

  it('marks a finished town done, not the region status, so it is struck through', () => {
    const el = render({ 'campaign.completed_missions': [...ALL_BS] });
    const marker = el.querySelector('[data-town="beit_sahwan"]') as HTMLElement;
    expect(marker.dataset.status).toBe('done');
  });

  it('marks a town with nothing authored empty, not live -- it must not read as finished', () => {
    // marj is a live region (fresh ledger), but khan_rafid has missions: [] in
    // world.json. Stamping it with the region's 'live' status is the bug: CSS
    // struck through every non-link townname that wasn't 'locked', so an
    // unauthored town read as complete.
    const el = render({});
    const marker = el.querySelector('[data-town="khan_rafid"]') as HTMLElement;
    expect(marker.dataset.status).toBe('empty');
  });

  it('leaves a mid-progress town at the region status, not done', () => {
    const el = render({ 'campaign.completed_missions': [ALL_BS[0]!] });
    const marker = el.querySelector('[data-town="beit_sahwan"]') as HTMLElement;
    expect(marker.dataset.status).toBe('live');
    expect(marker.dataset.status).not.toBe('done');
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

  it('locks every country that has no region authored for it', () => {
    const el = render({});
    for (const c of countries) {
      if (c.home || world.regions.some((r) => r.id === c.id)) continue;
      expect(statusOf(el, c.id), c.id).toBe('locked');
    }
  });

  it('gives the homeland no overlay at all — Kedem carries no campaign state', () => {
    expect(render({}).querySelector('#region-kedem')).toBe(null);
  });

  it('flies the brigade flag over a completed country, anchored to it', () => {
    const el = render({ 'campaign.completed_missions': [...ALL_BS] });
    const flag = el.querySelector('#region-marj .country-flag');
    expect(flag).not.toBe(null);
    expect(flag?.getAttribute('href')).toBe('/campaign/flag_brigade.png');
    // And none on a merely live or locked country.
    expect(el.querySelector('#region-sur .country-flag')).toBe(null);
  });

  it('draws a veil polygon for every non-home country, so states have a surface', () => {
    const el = render({});
    for (const c of countries) {
      if (c.home) continue;
      expect(el.querySelector(`#region-${c.id} .country-fill`), c.id).not.toBe(null);
    }
  });

  it('does not write to localStorage — the map is a view, not a save', () => {
    const before = window.localStorage.length;
    render({});
    expect(window.localStorage.length).toBe(before);
  });
});

describe('showMenu', () => {
  const mount = (done: boolean): HTMLElement => {
    const stage = document.createElement('div');
    showMenu(stage, {
      base: '/',
      version: 'test',
      world,
      tutorial: { id: 'beit_sahwan_0_tutorial', name: 'Tutorial', done },
    });
    return stage;
  };

  it('is a landing, not the map: Campaign leads to the map page', () => {
    const stage = mount(false);
    expect(stage.querySelector('.rl-world')).toBe(null);
    const campaign = stage.querySelector('[data-kind="campaign"]') as HTMLAnchorElement;
    expect(campaign.getAttribute('href')).toBe('?campaign');
    // The tutorial teaches the mouse, not the war, so it sits beside Campaign.
    const tut = stage.querySelector('[data-kind="tutorial"]') as HTMLAnchorElement;
    expect(tut.getAttribute('href')).toBe('?mission=beit_sahwan_0_tutorial');
  });

  it('drops the tutorial entry once it has been done', () => {
    expect(mount(true).querySelector('[data-kind="tutorial"]')).toBe(null);
  });
});

describe('showCampaign', () => {
  it('mounts the world map with a way back to the menu', () => {
    const stage = document.createElement('div');
    showCampaign(stage, { base: '/', world, countries, ledger: {} });
    expect(stage.querySelector('.rl-world')).not.toBe(null);
    expect(stage.querySelector('[data-town="beit_sahwan"]')).not.toBe(null);
    const back = stage.querySelector('[data-kind="back"]') as HTMLAnchorElement;
    expect(back.getAttribute('href')).toBe('?');
  });
});
