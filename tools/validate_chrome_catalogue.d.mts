export function messageShape(msg: string): string[];
export function chromeCatalogueFailures(file: string, en: Record<string, string>, tr: unknown, opts?: { locale?: string }): string[];
export function chromeSourceFailures(file: string, en: Record<string, string>, tr: unknown, src: unknown): string[];
export function buildChromeSource(en: Record<string, string>, tr: Record<string, string>, existing?: Record<string, string>, rebless?: string[]): Record<string, string>;
export const EXTRA_PLURAL_CATEGORIES: Record<string, string[]>;
export function pluralExtrasFor(locale: string | undefined): string[];
export function withoutExtraPlurals(msg: string, extras: string[], enMsg?: string): { text: string; problems: string[] };
