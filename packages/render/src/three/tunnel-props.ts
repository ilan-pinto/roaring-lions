/**
 * Tunnel props (GH-227, with the A3.2 ramp set): a route's mouth, its vent
 * and the digger's spoil heap as small mesh props standing on the route's
 * own points, plus the collapsed twins of the first two once a charge has
 * brought the route down.
 *
 * ## What the player may see, and when
 *
 * Tunnel visibility is a SIM rule (`Sim.tunnelContactLevel`): a route is
 * identified only while a `mark_tunnel` carrier holds a sight line, and the
 * art must not reveal a route the player's side has not identified. So this
 * module draws under exactly the rule `trail-mesh.ts` draws the identified
 * LINE under -- `collapsedRouteLevel` over side 0's contact level -- and
 * adds nothing the trail does not already imply:
 *
 *   - mouth and vent: only at level 2 (identified). The vent only once it is
 *     open -- a route still being dug has no exit yet.
 *   - collapsed mouth / vent: a route that is dead AND was identified when it
 *     died (`contactLevel` stays latched at 2; `collapsedRouteLevel` demotes
 *     it to 1 for the trail, which then keeps only the residual spoil). A
 *     collapsed route nobody had identified shows nothing here, as its line
 *     never showed.
 *   - spoil heap: at the dig head of a live, unfinished route whose head tile
 *     any living side-0 unit can see -- the trail's own SPOIL rung rule
 *     ("anyone can see disturbed earth"), not the carrier rule, because the
 *     heap is the dirt the trail stamps, made three-dimensional.
 *
 * ## Why not the prop batch
 *
 * `terrain/prop-mesh.ts` batches every scattered prop once at load from
 * `prop-place.ts`'s placements, which are a function of the MAP. These
 * pieces are a function of the SIM's tunnel state and change during play,
 * so they are ordinary meshes in their own group, rebuilt wholesale on the
 * trail's own `trailMeshDirty` cadence (`fogTick`) -- at most a handful of
 * meshes per route, sharing the prop set's geometry clones (colour already
 * baked per vertex by `loadPropMeshes`) and ONE vertex-colour material, the
 * same recipe as the batch. Positions are tile units (world x = tile x,
 * world z = tile y, exactly as `mesh-building.ts` places a footprint), the
 * height read through the caller's `groundY`.
 *
 * `tunnelPiecesFor` is pure so the rule above can be tested without a scene.
 */
import * as THREE from 'three';
import { WORLD_ROUGHNESS } from './world-materials';
import type { PropGeometrySet } from './terrain/prop-mesh';
import type { PropKind } from './terrain/prop-role';
import { collapsedRouteLevel } from './trail-mesh';

export interface TunnelRouteView {
  readonly alive: boolean;
  /** Side 0's own contact state on the route (`Sim.tunnelContactLevel`). */
  readonly contactLevel: 0 | 1 | 2;
  readonly ventOpen: boolean;
  /** Tiles dug so far, and the route's length, both in tiles. */
  readonly progressTiles: number;
  readonly lengthTiles: number;
  /** Tile-centre coordinates (x, y) of the mouth, the vent and the dig head. */
  readonly mouth: readonly [number, number];
  readonly vent: readonly [number, number];
  readonly digHead: readonly [number, number];
  /** Can any living side-0 unit currently see the dig head's tile? */
  readonly digHeadSeen: boolean;
}

export interface TunnelPropsInput {
  readonly routes: readonly TunnelRouteView[];
  /** World Y of the drawn ground at tile coordinates (x, y). */
  groundY(x: number, y: number): number;
}

export interface TunnelPiece {
  readonly kind: PropKind;
  readonly at: readonly [number, number];
}

/** The pieces one route shows right now -- the whole rule, pure. */
export function tunnelPiecesFor(r: TunnelRouteView): readonly TunnelPiece[] {
  const out: TunnelPiece[] = [];
  const level = collapsedRouteLevel(r.alive, r.contactLevel);
  if (r.alive && level === 2) {
    out.push({ kind: 'tunnel_mouth', at: r.mouth });
    if (r.ventOpen) out.push({ kind: 'tunnel_vent', at: r.vent });
  } else if (!r.alive && r.contactLevel === 2) {
    out.push({ kind: 'tunnel_mouth_collapsed', at: r.mouth });
    if (r.ventOpen) out.push({ kind: 'tunnel_vent_collapsed', at: r.vent });
  }
  if (r.alive && !r.ventOpen && r.progressTiles > 0 && r.digHeadSeen) {
    out.push({ kind: 'spoil_heap', at: r.digHead });
  }
  return out;
}

export class TunnelProps {
  readonly group = new THREE.Group();
  private readonly material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: WORLD_ROUGHNESS,
  });
  private placed: THREE.Object3D[] = [];

  constructor() {
    this.group.name = 'tunnel-props';
  }

  /** Rebuilds every piece from `input`. The prop set's geometries are shared,
   *  never disposed here -- `loadPropMeshes` owns them. */
  update(input: TunnelPropsInput, set: PropGeometrySet): number {
    for (const o of this.placed) this.group.remove(o);
    this.placed = [];
    for (const route of input.routes) {
      for (const piece of tunnelPiecesFor(route)) {
        const parts = set.parts.get(piece.kind);
        if (parts === undefined) continue;
        const holder = new THREE.Group();
        holder.name = piece.kind;
        for (const part of parts) {
          const mesh = new THREE.Mesh(part.geometry, this.material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          holder.add(mesh);
        }
        holder.position.set(piece.at[0], input.groundY(piece.at[0], piece.at[1]), piece.at[1]);
        this.group.add(holder);
        this.placed.push(holder);
      }
    }
    return this.placed.length;
  }

  dispose(): void {
    for (const o of this.placed) this.group.remove(o);
    this.placed = [];
    this.material.dispose();
  }
}
