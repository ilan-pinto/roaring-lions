/** Web Crypto helpers for the accounts routes (GH-1075 A1). */
const toHex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

export function randomB64url(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Lowercase hex SHA-256 of the text's UTF-8. */
export async function sha256Hex(text: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}

/** Unpadded base64url SHA-256 of the text's UTF-8: PKCE's S256 challenge, and the nonce's second hash. */
export async function sha256B64url(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** `chars` Crockford base32 characters from random bytes (32 symbols, so 5 bits each, no modulo bias). */
export function crockford(chars: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(chars));
  let out = '';
  for (const b of buf) out += CROCKFORD.charAt(b & 31);
  return out;
}
