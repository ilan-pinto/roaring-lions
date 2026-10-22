# Coupons

A coupon is a redeemable code that grants brigade credits. The "Redeem code" field on the brigade screen (`/brigade`) takes one.

- **Hashed.** `data/coupons.json` holds `{ id, sha256, credits }` per coupon, validated by `data/schemas/coupons.schema.json` in `pnpm validate:data` (which also refuses duplicate ids or hashes). The literal code is never in the repository. The code is trimmed and matched case-sensitively against the SHA-256 of its UTF-8 bytes.
- **Once per account.** `redeemCoupon` (`packages/app/src/brigade-account.ts`) is pure. A valid code adds its credits to `balance`, appends a `source: 'granted'` grant carrying `couponId`, and records the id in the account's `coupons` list. A second redemption refuses as "used". `earned_total` does not move: it counts credits earned by play. The account version stays 2: a save with no `coupons` field migrates to an empty list.
- **Reset clears redemptions.** "Reset brigade account" removes the whole key, so the code can be used again afterwards. `?fresh` and a new campaign leave the account alone, so redemptions survive both.
- **Trust-based.** The grant is client-side. Anyone can already edit `localStorage` to give themselves credits, so a coupon adds no new exposure, and a hash of a short code can be brute-forced offline: treat a coupon as a convenience for testers, not a secret. The server ledger (GH-205) is where a real entitlement belongs.
- **Credits only.** No sim state, no pins, no telemetry event (an attempt would carry the code).
- **Save slots.** A slot snapshots the account with its redemptions, so loading a slot saved before redeeming makes the code usable again. Accepted for the same reason.
