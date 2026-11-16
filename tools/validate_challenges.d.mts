// Type declaration for validate_challenges.mjs (GH-1395), so tools/src/validate_challenges.test.ts typechecks.
export function challengeFailures(a: {
  library: unknown;
  files: readonly { file: string; doc: unknown }[];
  missions: Readonly<Record<string, unknown>>;
  en: Readonly<Record<string, string>>;
}): string[];
