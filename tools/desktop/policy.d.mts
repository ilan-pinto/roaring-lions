// Types for policy.mjs, so tools/src/desktop_policy.test.ts typechecks.
export declare const SCHEME: 'app';
export declare const HOST: string;
export declare const ORIGIN: string;
export declare const WEB_PREFERENCES: Readonly<Record<string, boolean>>;
export declare const EXTERNAL_HOSTS: readonly string[];
export declare function externalUrlAllowed(url: string): boolean;
export declare function isAppUrl(url: string): boolean;
export declare const ALLOWED_PERMISSIONS: readonly string[];
export declare function permissionAllowed(permission: string, requestingUrl: unknown): boolean;
export declare function parseStaticHeaders(text: string): Record<string, string>;
export declare function requireCsp(headers: Record<string, string>): string;
export declare function smokeAllowed(build: unknown, env: Record<string, string | undefined>): boolean;
export declare const FUSES: Readonly<Record<string, boolean>>;
export interface DemoConfig {
  missions: string[] | null;
}
export declare function readDemoConfig(json: unknown, missionIds: Iterable<string>): DemoConfig;
export declare const DEMO_CUT_ENV: 'RL_DEMO_MISSIONS';
export declare const DEMO_CUT_FILE: 'demo-cut.json';
export declare function checkBundleCut(demo: DemoConfig, text: string | null): void;
export declare const ELECTRON_VERSION: string;
export declare const ELECTRON_SHA256: Readonly<Record<string, string>>;
