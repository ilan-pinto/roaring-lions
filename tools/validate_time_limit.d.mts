// Types for validate_time_limit.mjs, so tools/src/validate_time_limit.test.ts typechecks.
export declare const LIMIT_PER_TARGET_MINUTE_S: number;
export declare const DEADLINE_CLEARANCE_S: number;
export declare function timeLimitFailures(mission: unknown, file: string): string[];
