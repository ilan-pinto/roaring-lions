/**
 * `draco3dgltf` ships no types. Only the two factory functions
 * `encode-meshes.ts` hands to `NodeIO.registerDependencies` are declared --
 * the module's own surface is much larger, and declaring the rest would be
 * inventing a contract nobody checks.
 */
declare module 'draco3dgltf' {
  export function createDecoderModule(): Promise<unknown>;
  export function createEncoderModule(): Promise<unknown>;
  const draco3dgltf: {
    createDecoderModule: typeof createDecoderModule;
    createEncoderModule: typeof createEncoderModule;
  };
  export default draco3dgltf;
}
