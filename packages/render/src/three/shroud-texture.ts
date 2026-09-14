/**
 * Fog of war as a texture (spec §6). `computeFog` (`./fog.ts`) still owns
 * the RULE -- level 0 never seen, 1 explored, 2 in sight -- and the unit
 * visibility gate still reads it. This file only turns that byte grid into
 * something a shader can sample smoothly: each tile becomes a 2x2 texel
 * block, then a 3x3 box blur feathers every boundary over ~1.5 tiles.
 *
 * The retired `FogMesh` drew one opaque black quad per tile at band 10 with
 * `depthTest: false`, so a building standing in an explored tile wore a
 * black slab on its roof and every fog edge was a tile staircase. A texture
 * read by world position in a depth-aware pass cannot do either.
 *
 * Why 2x2 texels per tile rather than one, given the blur is what does the
 * feathering: with one texel per tile the blur's own kernel is the only
 * gradient available and it runs over a 3-TILE span, so a lone observed tile
 * would never reach full brightness at all (its centre would blur to 1/9 of
 * its neighbours away from it). Upsampling first means a tile's interior
 * texels keep their own level exactly -- the first test in
 * `shroud-texture.test.ts` is precisely that assertion -- and only the two
 * texel columns either side of a boundary carry intermediate values, which
 * is the ~1.5 tiles of transition the spec asks for.
 */
import * as THREE from 'three';

export const SHROUD_UPSAMPLE = 2;
export const SHROUD_NEVER_SEEN = 0;
export const SHROUD_EXPLORED = 128;
export const SHROUD_VISIBLE = 255;
/** Indexed by `computeFog`'s own level byte. The `??` below is unreachable
 *  through the type (`noUncheckedIndexedAccess` is off repo-wide) but not at
 *  runtime: it is what keeps a fog byte outside 0-2 -- which nothing writes
 *  today -- rendering as unseen ground rather than as `undefined` poured
 *  into a `Uint8Array`. */
const LEVEL_VALUE = [SHROUD_NEVER_SEEN, SHROUD_EXPLORED, SHROUD_VISIBLE] as const;

/**
 * The feathered R8 image for one fog array: `SHROUD_UPSAMPLE`-squared texels
 * per tile, 3x3 box blurred with clamped edges. Pure -- no `THREE.*` -- so
 * `shroud-texture.test.ts` exercises it directly on a plain `Uint8Array`,
 * the same headless split the retired `fog-mesh.ts` kept.
 *
 * `out` is reused when its length already matches, which is the only shape
 * `ShroudTexture` ever calls this in: a `DataTexture`'s backing array has to
 * stay the SAME object across updates, since that is what `needsUpdate`
 * re-uploads.
 */
export function buildShroudData(fog: Uint8Array, width: number, height: number, out?: Uint8Array): Uint8Array {
  const tw = width * SHROUD_UPSAMPLE;
  const th = height * SHROUD_UPSAMPLE;
  const size = tw * th;
  const upsampled = new Uint8Array(size);
  for (let y = 0; y < th; y++) {
    const ty = Math.floor(y / SHROUD_UPSAMPLE);
    for (let x = 0; x < tw; x++) {
      const tx = Math.floor(x / SHROUD_UPSAMPLE);
      upsampled[y * tw + x] = LEVEL_VALUE[fog[ty * width + tx]] ?? SHROUD_NEVER_SEEN;
    }
  }
  const result = out && out.length === size ? out : new Uint8Array(size);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const sy = Math.min(th - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const sx = Math.min(tw - 1, Math.max(0, x + dx));
          sum += upsampled[sy * tw + sx];
        }
      }
      result[y * tw + x] = Math.round(sum / 9);
    }
  }
  return result;
}

/**
 * The GPU side: one single-channel `DataTexture` the fog pass samples by
 * world position. `LinearFilter` is the second half of the feather -- the
 * blur above gives the gradient its texels, hardware interpolation gives it
 * the sub-texel smoothness -- and `ClampToEdgeWrapping` is what makes ground
 * just off the map read as its nearest edge tile rather than wrapping round
 * to the opposite corner of the world.
 *
 * `flipY` MUST stay false: `buildShroudData` writes row 0 as tile row 0, and
 * a flip would mirror the shroud against the terrain it covers -- a defect
 * that looks like fog lagging the units rather than like an upside-down
 * image. `unpackAlignment: 1` is required for an R8 image whose row length
 * (`width * 2`) is not a multiple of 4; the default 4 would shear every
 * odd-width map.
 *
 * Constructing one needs no live GL context -- a `DataTexture` is a JS
 * object until something uploads it -- which is what lets `ThreeRenderer`
 * build this in its CONSTRUCTOR, where nine test files drive it against a
 * four-member renderer stub. The `FogOfWarPass` that samples it is built in
 * `init()` instead.
 */
export class ShroudTexture {
  readonly texture: THREE.DataTexture;
  /** `<ArrayBuffer>` explicitly, not the bare alias: `Uint8Array` defaults to
   *  `Uint8Array<ArrayBufferLike>`, which `DataTexture` will not accept
   *  (`BufferSource` rules out a `SharedArrayBuffer` backing). */
  private readonly data: Uint8Array<ArrayBuffer>;
  private readonly width: number;
  private readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * SHROUD_UPSAMPLE * SHROUD_UPSAMPLE);
    this.texture = new THREE.DataTexture(
      this.data,
      width * SHROUD_UPSAMPLE,
      height * SHROUD_UPSAMPLE,
      THREE.RedFormat,
      THREE.UnsignedByteType
    );
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.flipY = false;
    this.texture.generateMipmaps = false;
    this.texture.unpackAlignment = 1;
    this.texture.needsUpdate = true;
  }

  /** Rewrites the backing array in place and flags it for re-upload. Called
   *  only when fog data actually changed -- `ThreeRenderer`'s own 5 Hz
   *  `shroudDirty` gate, the same cadence the retired `FogMesh` rebuilt on. */
  update(fog: Uint8Array): void {
    buildShroudData(fog, this.width, this.height, this.data);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
