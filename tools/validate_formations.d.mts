// Type declaration for validate_formations.mjs, so tools/src/validate_formations.test.ts (a
// TypeScript file under the strict tsconfig) can import the plain-node rules without an
// implicit-any error. Same arrangement as validate_versus_rules.d.mts.
export function formationFailures(files: readonly { file: string; doc: unknown }[], en: Readonly<Record<string, string>>): string[];
