// @vitest-environment jsdom
// The bay's turnable model (GH-316) across the garage's own lifecycle: a new
// unit gets a new view and the old one gives its context back; a purchase
// redraws the bay around the SAME view; leaving disposes it.
import type { UpgradableUnit } from '@lions/data';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { showBrigade, type BrigadeOptions, type BrigadeUnit } from './brigade';
import type { MountGarageView, MountedGarageView } from './garage-viewer';

const UNITS: BrigadeUnit[] = [
  {
    id: 'inf_squad',
    name: 'Rifle Squad',
    role: 'infantry',
    isKamikaze: false,
    transportSlots: 0,
    isSoft: true,
    upgrades: { armour: { tiers: [{ price: 100, patch: { 'hull.hp': 10 } }] } },
  },
  { id: 'mbt_lavi', name: 'Lavi MBT', role: 'mbt', isKamikaze: false, transportSlots: 0, isSoft: false },
];
const BASE: Record<string, UpgradableUnit> = {
  inf_squad: { id: 'inf_squad', hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } }, weapons: [] },
  mbt_lavi: { id: 'mbt_lavi', hull: { hp: 3000, armor: { front: 700, side: 200, rear: 90 } }, weapons: [] },
};

interface Fake extends MountedGarageView {
  readonly typeId: string;
  disposed: number;
}

function setup() {
  const views: Fake[] = [];
  const mount = vi.fn<MountGarageView>((_host, o) => {
    const v: Fake = {
      typeId: o.typeId,
      canvas: document.createElement('canvas'),
      info: { pose: 'idle0', figures: 0 },
      disposed: 0,
      stats: () => ({ frames: 1, calls: 0, triangles: 0 }),
      draw: () => {},
      resize: () => {},
      dispose: () => {
        v.disposed += 1;
      },
    };
    views.push(v);
    return Promise.resolve(v);
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const opts: BrigadeOptions = {
    units: UNITS,
    ledger: {},
    missionName: () => undefined,
    baseOf: (id) => BASE[id] ?? { id },
    possibleStars: 78,
    credits: 999,
    owned: {},
    onBuyUpgrade: (u, tr, tier, price) => ({ units: UNITS, credits: 999 - price, owned: { [u]: { [tr]: tier } }, landed: true }),
    reducedMotion: () => true,
    model: {
      source: (id) => (id === 'mbt_lavi' ? { kind: 'vehicle', url: '/m/lavi.glb' } : { kind: 'rigged', url: '/m/inf.glb', faction: 'kdf' }),
      dracoDecoderPath: '/draco/',
      groundTextureUrl: '/t/sand.jpg',
      colors: { key: 'k', fill: 'f', sky: 's', bounce: 'b', ground: 'g' },
      webgl: () => true,
      mountDelayMs: 0,
      mount,
    },
  };
  const dispose = showBrigade(host, opts);
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
  const select = (id: string): void => host.querySelector<HTMLButtonElement>(`.rl-garage__card[data-unit="${id}"]`)?.click();
  const plate = (): HTMLElement | null => host.querySelector('.rl-garage__plate');
  return { host, views, mount, dispose, settle, select, plate };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('the garage bay and its model', () => {
  it('mounts the selected unit, and gives the old one back when the player pages on', async () => {
    const s = setup();
    await s.settle();
    expect(s.mount).toHaveBeenCalledTimes(1);
    expect(s.views[0].typeId).toBe('inf_squad');
    expect(s.plate()?.dataset.model).toBe('live');
    s.select('mbt_lavi');
    await s.settle();
    expect(s.views[0].disposed).toBe(1);
    expect(s.views[1].typeId).toBe('mbt_lavi');
    expect(s.plate()?.dataset.model).toBe('live');
    s.select('inf_squad');
    await s.settle();
    expect(s.views[1].disposed).toBe(1);
    expect(s.mount).toHaveBeenCalledTimes(3);
    s.dispose();
  });

  it('keeps the same view through a purchase that redraws the bay around the same unit', async () => {
    const s = setup();
    await s.settle();
    const before = s.plate();
    s.host.querySelector<HTMLButtonElement>('.rl-garage__buy-tier')?.click();
    await s.settle();
    expect(s.plate()).not.toBe(before);
    expect(s.mount).toHaveBeenCalledTimes(1);
    expect(s.views[0].disposed).toBe(0);
    expect(s.plate()?.querySelector('.rl-garage__model')).not.toBeNull();
    expect(s.plate()?.dataset.model).toBe('live');
    s.dispose();
  });

  it('disposes the live view when the garage is left', async () => {
    const s = setup();
    await s.settle();
    s.dispose();
    expect(s.views[0].disposed).toBe(1);
  });

  it('disposes a view still loading when the garage is left, the moment it lands', async () => {
    const s = setup();
    // Left before the mount's promise has been looked at.
    s.dispose();
    await s.settle();
    expect(s.views).toHaveLength(1);
    expect(s.views[0].disposed).toBe(1);
  });
});
