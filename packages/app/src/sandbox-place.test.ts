// GH-1360 S1: the placer tests the unit's OWN mask and refuses an occupied tile.
//
// Two bugs, found by the spacing design's census: `placeOnOpen` spiralled to the nearest open tile with no
// occupancy test (Tel Marum's Sarim end put five bodies on one tile), and tested the FOOT mask only, so a wheeled
// body could be born on a boulder (`beit_sahwan_4`: five of them). Both are checked over every versus cell and every
// free-play map, with the real spawners and no second copy of their loops.
import { describe, expect, it } from "vitest";
import { DOMAIN_VEHICLE, Sim } from "@lions/sim";
import {
  applyTerrain,
  maps,
  parseMap,
  units,
  versusRules,
  type MapId,
} from "@lions/data";
import type { Faction, SpawnEnd } from "@lions/net";
import { sandboxUnitTypes } from "./sandbox-force";
import { sandboxSpawns } from "./sandbox-spawn";
import { sandboxAnchors } from "./sandbox-anchors";
import { standMapStructures } from "./map-sim";
import { versusSpawns } from "./net/versus-force";
import { versusAnchors } from "./net/versus-seats";
import { buildWorld } from "./net/versus-world.test-helper";

const ALL = { tunnel: true, sur: true, civ: true, works: false };

/** Every body that is not buried or garrisoned must stand alone, on ground its own domain can stand on. */
function audit(sim: Sim, label: string): number {
  const seen = new Map<number, number>();
  for (let i = 0; i < sim.entityCount; i++) {
    if (sim.state.alive[i] !== 1) continue;
    const tile =
      (sim.state.posY[i] >> 16) * sim.width + (sim.state.posX[i] >> 16);
    const other = seen.get(tile);
    expect(
      other,
      `${label}: bodies ${other} and ${i} share tile ${tile % sim.width},${Math.floor(tile / sim.width)}`,
    ).toBeUndefined();
    seen.set(tile, i);
    const wheeled =
      sim.unitTypes[sim.state.typeIdx[i]].moveDomain === DOMAIN_VEHICLE;
    const mask = wheeled ? sim.blockedVehicle : sim.blocked;
    expect(
      mask[tile],
      `${label}: body ${i} (${wheeled ? "wheeled" : "foot"}) stands on a blocked tile ${tile % sim.width},${Math.floor(tile / sim.width)}`,
    ).toBe(0);
  }
  // A spawner that produced nothing would pass the loop above with no assertion at all.
  expect(seen.size, `${label}: no living body was audited`).toBeGreaterThan(0);
  return seen.size;
}

describe("placeOnOpen (GH-1360 S1)", () => {
  it("the audit refuses a world that spawned nobody", () => {
    const sim = new Sim({ seed: 1, width: 8, height: 8, capacity: 8 });
    expect(() => audit(sim, "empty")).toThrow(/no living body was audited/);
  });
  for (const mapId of Object.keys(maps) as MapId[]) {
    it(`free-play ${mapId}: no two bodies on one tile, no wheeled body on its blocked mask`, () => {
      const parsed = parseMap(maps[mapId]);
      const sim = new Sim({
        seed: 20260727,
        width: parsed.width,
        height: parsed.height,
        capacity: 256,
      });
      applyTerrain(parsed, sim);
      standMapStructures(sim, parsed);
      const typeOf = new Map<string, number>();
      for (const id of sandboxUnitTypes(ALL))
        typeOf.set(
          id,
          sim.addUnitType((units as Record<string, unknown>)[id] as never),
        );
      sandboxSpawns(sim, typeOf, sandboxAnchors(parsed), ALL);
      // Garrisons enter a building on the first ticks and share its centroid by design: audit the placer's own output.
      audit(sim, `free-play ${mapId}`);
    });
  }

  const ids = Object.keys(versusRules) as MapId[];
  it("there are versus maps to check", () =>
    expect(ids.length).toBeGreaterThan(0)); // a loop over nothing passes vacuously
  for (const mapId of ids) {
    it(`versus ${mapId}, every faction pair and end order: same two checks`, () => {
      const factions: [Faction, Faction][] = [
        ["kdf", "kdf"],
        ["kdf", "sarim"],
        ["sarim", "kdf"],
        ["sarim", "sarim"],
      ];
      const ends: [SpawnEnd, SpawnEnd][] = [
        ["friendly", "hostile"],
        ["hostile", "friendly"],
      ];
      for (const f of factions) {
        for (const e of ends) {
          const { sim, typeOf, map } = buildWorld(mapId);
          versusSpawns(sim, typeOf, versusAnchors(map), f, e);
          audit(sim, `versus ${mapId} ${f.join("/")} ${e.join("/")}`);
        }
      }
    });
  }
});
