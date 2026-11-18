// @lions/data/content-lazy (B6-6): a map or a mission, loaded by id.
//
// The app's entry chunk holds only the synchronous manifest (`content-manifest.ts`); each map and mission JSON is a dynamic
// import of its own, so the bundler gives it a chunk of its own and the entry carries none of them. The object a loader
// resolves to is the JSON module's default export: the SAME object on every call (a module is evaluated once), and the same
// value `@lions/data/content`'s eager `maps` / `missions` hold in Node.
//
// Wrap a call in the app's `importWithRetry` (`packages/app/src/shell/chunk.ts`): it is a chunk load like any other.
import { mapLoaders, mapManifest, missionLoaders, missionManifest, type MapId, type MissionId } from './content-manifest';
import type { MapJson } from './map';

/** Whether `id` names a shipped map. Own keys only: `constructor` is not a map. */
export function isMapId(id: string): id is MapId {
  return Object.hasOwn(mapManifest, id);
}

/** Whether `id` names a shipped mission. Own keys only. */
export function isMissionId(id: string): id is MissionId {
  return Object.hasOwn(missionManifest, id);
}

/** The map's JSON. Rejects for an id no map has (a caller checks `isMapId` first), and when its chunk will not load. */
export async function loadMap(id: string): Promise<MapJson> {
  if (!isMapId(id)) throw new Error(`loadMap: no map "${id}" in data/maps`);
  return (await mapLoaders[id]()).default as MapJson;
}

/** The mission's JSON, typed by the caller (the app reads it as `@lions/sim`'s `MissionJson`, as it read `missions`). Rejects
 *  for an id no mission has, and when its chunk will not load. */
export async function loadMission<T = unknown>(id: string): Promise<T> {
  if (!isMissionId(id)) throw new Error(`loadMission: no mission "${id}" in data/missions`);
  return (await missionLoaders[id]()).default as T;
}

/** Several maps at once, keyed by id; rejects if any one will not load. */
export async function loadMaps(ids: readonly string[]): Promise<Record<string, MapJson>> {
  const loaded = await Promise.all(ids.map((id) => loadMap(id)));
  const out: Record<string, MapJson> = {};
  ids.forEach((id, i) => {
    out[id] = loaded[i];
  });
  return out;
}
