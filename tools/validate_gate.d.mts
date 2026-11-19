// Types for validate_gate.mjs, so tools/src/validate_gate.test.ts typechecks.
export declare function gateFailures(
  catalogue: unknown,
  maps: readonly { id?: string; file: string; rows?: readonly string[] }[],
  missions: readonly { file: string; mission: unknown }[],
  versusMaps: ReadonlySet<string>
): string[];
