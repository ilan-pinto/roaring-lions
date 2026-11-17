// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { ParsedWorld } from '../campaign';
import { accountsEnabled } from './enabled';
import { showMenu } from '../ui/menu';

const world = { name: 'The Sahar Basin' } as unknown as ParsedWorld;
const tutorial = { id: 'beit_sahwan_0_tutorial', name: 'Tutorial', done: true };
const PROD = { prod: true, hostname: 'roaring-lions.pint12.workers.dev' };
const q = (s: string): URLSearchParams => new URLSearchParams(s);

function chipFor(query: string, host: { prod: boolean; hostname: string }): boolean {
  const stage = document.createElement('div');
  document.body.appendChild(stage);
  showMenu(stage, { base: '/', version: '0.0.0', world, tutorial, account: { enabled: accountsEnabled(q(query), host) } });
  const has = stage.querySelector('[data-act="profile"]') !== null;
  stage.remove();
  return has;
}

describe('accountsEnabled (GH-1075 default on)', () => {
  it('a production page on a real host is on with no query, and off under ?fresh', () => {
    expect(accountsEnabled(q(''), PROD)).toBe(true);
    expect(accountsEnabled(q('accounts'), PROD)).toBe(true);
    expect(accountsEnabled(q('fresh'), PROD)).toBe(false);
    expect(accountsEnabled(q('accounts&fresh'), PROD)).toBe(false);
  });
  it('dev, CI and local hosts never reach the network without the explicit ?accounts opt-in', () => {
    for (const host of [{ prod: false, hostname: 'localhost' }, { prod: false, hostname: 'roaring-lions.pint12.workers.dev' }, { prod: true, hostname: 'localhost' }, { prod: true, hostname: '127.0.0.1' }]) {
      expect(accountsEnabled(q(''), host)).toBe(false);
    }
    expect(accountsEnabled(q('accounts'), { prod: false, hostname: 'localhost' })).toBe(true);
  });
  it('the test environment itself defaults to off (no host argument)', () => {
    expect(accountsEnabled(q(''))).toBe(false);
  });
  it('the menu chip shows with no query and is absent under ?fresh', () => {
    expect(chipFor('', PROD)).toBe(true);
    expect(chipFor('fresh', PROD)).toBe(false);
    expect(chipFor('', { prod: false, hostname: 'localhost' })).toBe(false);
  });
});
