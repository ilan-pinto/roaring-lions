import { hasKey, t } from '../i18n/t';

/**
 * A weapon's player-facing name: `weapon.<id>` in the catalogue.
 *
 * The id itself (`gun_120`, `coax_mg`) is a data key and never reaches the
 * screen -- that was PA-01, the first thing a new player selected. Every
 * weapon in shipped unit JSON has a key, which `weapon-name.test.ts` pins
 * against `data/units/**` read at test time. A weapon that ships without one
 * still prints a plain word rather than its id, and `t()` is still called on
 * the missing key so the gap shows up in `missingKeys()` for a capture pass.
 */
export function weaponName(id: string): string {
  const key = `weapon.${id}`;
  if (hasKey(key)) return t(key);
  t(key); // records the gap in missingKeys() and warns once
  return t('weapon.unknown');
}
