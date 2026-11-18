// Type declaration for content_manifest.mjs, so tools/src/content_manifest.test.ts (a TypeScript file under the strict
// tsconfig) can import the plain-node generator without an implicit-any error. Same arrangement as validate_formations.d.mts.
export const MANIFEST_PATH: string;
export function mapSummary(map: unknown): Record<string, unknown>;
export function missionSummary(mission: unknown): Record<string, unknown>;
export function renderContentManifest(root: string): string;
export function contentManifestFailures(root: string, onDisk?: string): string[];
