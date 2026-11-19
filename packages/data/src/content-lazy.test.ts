// B6-6: a map or a mission loaded by id is the SAME object the eager registry holds.
import { describe, expect, it } from 'vitest';
import { maps, missions } from './content';
import { isMapId, isMissionId, loadMap, loadMaps, loadMission } from './content-lazy';
import { mapLoaders, missionLoaders } from './content-manifest';

describe('@lions/data/content-lazy', () => {
  it('has a loader for every map and every mission the eager registry holds, and no other', () => {
    expect(Object.keys(mapLoaders)).toEqual(Object.keys(maps));
    expect(Object.keys(missionLoaders)).toEqual(Object.keys(missions));
  });

  it('resolves every map and every mission to the eager object itself (identity, not a copy)', async () => {
    for (const id of Object.keys(maps)) expect(await loadMap(id), id).toBe((maps as Record<string, unknown>)[id]);
    for (const id of Object.keys(missions)) expect(await loadMission(id), id).toBe((missions as Record<string, unknown>)[id]);
    const two = await loadMaps(['tel_marum', 'beit_sahwan_outskirts']);
    expect(Object.keys(two)).toEqual(['tel_marum', 'beit_sahwan_outskirts']);
    expect(two.tel_marum).toBe(maps.tel_marum);
  });

  it('rejects an id it does not have, own keys only', async () => {
    expect(isMapId('constructor')).toBe(false);
    expect(isMissionId('constructor')).toBe(false);
    expect(isMapId('tel_marum')).toBe(true);
    expect(isMissionId('beit_sahwan_1_recon')).toBe(true);
    await expect(loadMap('nowhere')).rejects.toThrow(/no map "nowhere"/);
    await expect(loadMission('constructor')).rejects.toThrow(/no mission "constructor"/);
    await expect(loadMaps(['tel_marum', 'nowhere'])).rejects.toThrow(/nowhere/);
  });
});
