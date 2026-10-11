/** Six characters from an alphabet with no 0/O/1/I (spec §4). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
/** A uniform [0, 1) from the Web Crypto CSPRNG: a room code is the only thing
 *  standing between a stranger and the join route, so never `Math.random`. */
export function cryptoRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 0x1_0000_0000;
}
export function mintCode(random: () => number = cryptoRandom): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[Math.min(CODE_ALPHABET.length - 1, Math.floor(random() * CODE_ALPHABET.length))];
  return s;
}
export function isCode(s: string): boolean {
  return s.length === CODE_LENGTH && [...s].every((ch) => CODE_ALPHABET.includes(ch));
}
