export const USAGE: string;
export function parseArgs(argv: string[]): { lang: string; write: boolean; rebless: string[]; error?: undefined } | { error: string };
