export function messageShape(msg: string): string[];
export function chromeCatalogueFailures(file: string, en: Record<string, string>, tr: unknown): string[];
export function chromeSourceFailures(file: string, en: Record<string, string>, tr: unknown, src: unknown): string[];
export function buildChromeSource(en: Record<string, string>, tr: Record<string, string>, existing?: Record<string, string>, rebless?: string[]): Record<string, string>;
