/**
 * GH-943 P3 (T14, GH-1152): the node renderer uploads a vertex attribute when it CHANGED, as the legacy renderer does.
 *
 * three 0.186.1's `Attributes.update` (`renderers/common/Attributes.js`) re-uploads an attribute whose usage is `DynamicDrawUsage` on
 * EVERY call, changed or not: `data.version < bufferAttribute.version || bufferAttribute.usage === DynamicDrawUsage`. It is called from
 * the per-object FULL refresh (`Geometries.updateForRender`, once per render call per attribute), and every node-twinned batch takes a
 * FULL refresh every frame (`NodeMaterialObserver.needsRefresh`: the material holds nodes). So every overlay, ring, zone band, decal,
 * fx and flipbook batch wrote its WHOLE capacity-sized buffer to the GPU every frame, drawn or empty, moved or still: T13's Metal
 * profile at n600 reads 2.06 ms a frame of `writeBuffer` under `updateAttribute`, all of it in the scene pass, where legacy's
 * `bufferSubData` does not reach its top 25 (WebGL's `WebGLAttributes.update` uploads on a version change only; `DYNAMIC_DRAW` is a
 * buffer hint there, nothing more).
 *
 * This puts the legacy rule back on the node renderer's own `Attributes` instance: a dynamic attribute is uploaded when its version moved
 * (or at creation), never otherwise. Every writer already bumps the version (`needsUpdate = true`) after a write, because legacy draws
 * stale data otherwise, so nothing a writer does is lost. The instanced-matrix interleaved buffers three makes for a large
 * `InstancedMesh` carry the source's version over themselves (`Instance.js`, `OnBeforeFrameUpdate`), so they follow the same rule.
 *
 * Presentation only. Nothing here is read by the sim. Installed once per node renderer (`createNodeBackend`), on the instance (the
 * class is untouched); `dispose` puts the instance's own `update` back.
 */

/** The attribute as three's `Attributes.update` reads it: a `BufferAttribute`, or an interleaved one over its `data`. */
export interface UploadAttributeLike {
  readonly version?: number;
  readonly usage?: number;
  readonly isInterleavedBufferAttribute?: boolean;
  readonly data?: { readonly version: number; readonly usage?: number };
}

/** The members of three's `Attributes` (a `DataMap`) this reads and wraps. */
export interface AttributesLike {
  update(attribute: UploadAttributeLike, type: number): void;
  get(attribute: UploadAttributeLike): { version?: number };
}

export interface VersionedUploads {
  /** Re-uploads skipped since the last call (an attribute that was dynamic and had not changed). Resets the count. */
  takeSkipped(): number;
  /** Puts the instance's own `update` back. */
  dispose(): void;
}

/** Wraps `attributes.update` so a `dynamicUsage` attribute whose version has not moved since its last upload is not uploaded again. */
export function installVersionedUploads(attributes: AttributesLike, dynamicUsage: number): VersionedUploads {
  const hadOwn = Object.prototype.hasOwnProperty.call(attributes, 'update');
  const orig = attributes.update;
  let skipped = 0;
  attributes.update = function (this: AttributesLike, attribute: UploadAttributeLike, type: number): void {
    const data = this.get(attribute);
    if (data.version !== undefined) {
      const source = attribute.isInterleavedBufferAttribute === true && attribute.data !== undefined ? attribute.data : attribute;
      // The legacy rule: a dynamic attribute uploads on a version change. Anything else is three's own path, unchanged.
      if (source.usage === dynamicUsage && !(data.version < (source.version ?? 0))) {
        skipped++;
        return;
      }
    }
    orig.call(this, attribute, type);
  };
  return {
    takeSkipped: () => {
      const n = skipped;
      skipped = 0;
      return n;
    },
    dispose: () => {
      if (hadOwn) attributes.update = orig;
      else delete (attributes as { update?: unknown }).update;
    },
  };
}
