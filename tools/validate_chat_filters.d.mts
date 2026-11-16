// Type declaration for validate_chat_filters.mjs, so tools/src/validate_chat_filters.test.ts (a TypeScript file under the strict
// tsconfig) can import the plain-node rules without an implicit-any error. Same arrangement as validate_formations.d.mts.
export function chatFilterFailures(
  files: readonly { file: string; doc: unknown }[],
  chatDir: string,
): { failures: string[]; warnings: string[] };
