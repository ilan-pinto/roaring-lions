import type { RatchetBase } from './webgpu_fences.mjs';
export const PORTED_FILES: string[];
export const BANNED_NAMES: string[];
export const TWINS: Readonly<Record<string, string>>;
export const NODE_NATIVE_FILES: readonly string[];
export function portedFilesBlocks(files: readonly string[], base: RatchetBase | undefined): unknown[];
