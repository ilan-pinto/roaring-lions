// Types for validate_video.mjs, so tools/src/validate_video.test.ts typechecks.
export declare const MAX_FILE_BYTES: number;
export declare const MAX_TOTAL_BYTES: number;
export declare function videoFailures(
  manifest: unknown,
  onDisk: { path: string; bytes: number }[],
  referenced: string[],
  opts?: { commercial?: boolean }
): string[];
