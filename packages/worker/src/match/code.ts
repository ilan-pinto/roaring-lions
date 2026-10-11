/** Six characters from an alphabet with no 0/O/1/I (spec §4). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
export function mintCode(random: () => number): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[Math.min(CODE_ALPHABET.length - 1, Math.floor(random() * CODE_ALPHABET.length))];
  return s;
}
export function isCode(s: string): boolean {
  return s.length === CODE_LENGTH && [...s].every((ch) => CODE_ALPHABET.includes(ch));
}
