/**
 * GH-943 P3 (T14, GH-1152): the node renderer reads a skinned mesh's bones from its skeleton's BONE TEXTURE, as the legacy renderer does.
 *
 * three 0.186.1's skinning node (`nodes/accessors/Skinning.js`, `getBoneMatricesNode`) puts the bone matrices in a per-object UNIFORM
 * BUFFER whenever they fit the uniform-buffer limit (every rig here does), and a uniform buffer binding is written to the GPU on every
 * FULL refresh of every render object (`Buffer.update()` returns true; `Bindings._update` then calls `updateBinding`, one
 * `queue.writeBuffer`). A `SkinnedMesh` is FULL every pass (`NodeMaterialObserver.hasAnimation`), and every per-role mesh of a figure
 * has its own `Skeleton` (`SkeletonUtils.clone`), so a figure's bones went up once per mesh per pass: scene, shadow, and the occlusion
 * outline that reads the same bones. T13's Metal profile at n600 reads 1.73 ms a frame of `writeBuffer` under `updateBinding` (0.53 ms of
 * it in the shadow pass, where nothing but bones is written), against legacy's 0.28 ms of `texSubImage2D`: WebGL skins from
 * `skeleton.boneTexture` and uploads it once per skeleton per frame.
 *
 * The bone texture is three's own path for a skeleton past the limit (`skeleton.computeBoneTexture()`, `textureLoad` in the vertex
 * stage); `skeleton.update()` marks it `needsUpdate` once a frame, and `Textures.updateTexture` uploads one version once, however many
 * render objects bind it. This sends every skinned mesh down that path on the node renderer, through three's public builder hook
 * (`renderer.debug.onNodeBuilderCreated`, called by `NodeManager._createNodeBuilder` before every build): a builder for a
 * `SkinnedMesh` reports a uniform-buffer limit of 0. Nothing else such a builder builds consults the limit (`Instance.js` is for an
 * `InstancedMesh`, `RangeNode` for a range); the outline twin follows the skinning node's own rule (`silhouette.node.ts`), so it reads
 * the same texture.
 *
 * Presentation only. Nothing here is read by the sim. The matrices are the same float32 values in either container.
 */

/** The members of a three `NodeBuilder` this reads and overrides. */
export interface SkinBuilderLike {
  readonly object?: { readonly isSkinnedMesh?: boolean } | null;
  getUniformBufferLimit(): number;
}

/** `renderer.debug` as three 0.186.1 declares it (`Renderer.js`): the one hook this sets. */
export interface BuilderHookHostLike {
  readonly debug: { onNodeBuilderCreated: ((builder: SkinBuilderLike, target: unknown) => void) | null };
}

/** The uniform-buffer limit a skinned mesh's builder reports: 0 sends `getBoneMatricesNode` to the bone texture. */
export const SKINNED_UNIFORM_BUFFER_LIMIT = 0;

export interface BoneTextureSkinning {
  /** Puts the previous hook back. */
  dispose(): void;
}

/** Sets `renderer.debug.onNodeBuilderCreated` (chaining any hook already there) so every skinned mesh's program skins from the bone texture. */
export function installBoneTextureSkinning(renderer: BuilderHookHostLike): BoneTextureSkinning {
  const prev = renderer.debug.onNodeBuilderCreated;
  const hook = (builder: SkinBuilderLike, target: unknown): void => {
    prev?.(builder, target);
    if (builder.object?.isSkinnedMesh === true) builder.getUniformBufferLimit = (): number => SKINNED_UNIFORM_BUFFER_LIMIT;
  };
  renderer.debug.onNodeBuilderCreated = hook;
  return {
    dispose: () => {
      if (renderer.debug.onNodeBuilderCreated === hook) renderer.debug.onNodeBuilderCreated = prev;
    },
  };
}
