// Types for validate_briefing.mjs, so tools/src/validate_briefing.test.ts typechecks.
export declare const SECTION_IDS: string[];
export declare function briefingFailures(id: string, mission: unknown, exists: (assetPath: string) => boolean): string[];
