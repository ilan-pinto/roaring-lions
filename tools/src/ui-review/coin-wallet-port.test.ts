import { describe, expect, it } from 'vitest';
import { COIN_WALLET_DEFAULT_PORT, coinWalletPort } from './coin-wallet-port';

describe('the wallet check\'s port guard (pure)', () => {
  it('defaults to 5194', () => {
    expect(coinWalletPort([], {})).toEqual({ ok: true, port: COIN_WALLET_DEFAULT_PORT });
    expect(COIN_WALLET_DEFAULT_PORT).toBe(5194);
  });

  it('takes a flag, then the environment', () => {
    expect(coinWalletPort(['--port=5199'], {})).toEqual({ ok: true, port: 5199 });
    expect(coinWalletPort([], { COIN_WALLET_PORT: '5198' })).toEqual({ ok: true, port: 5198 });
  });

  it('refuses the lead\'s 5177 from every source', () => {
    for (const [argv, env] of [[['--port=5177'], {}], [[], { COIN_WALLET_PORT: '5177' }]] as const) {
      const r = coinWalletPort(argv, env);
      expect(r.ok).toBe(false);
      expect(r.ok ? '' : r.message).toMatch(/5177.*off-limits/);
    }
  });

  it('refuses a bad value rather than falling back to the default', () => {
    expect(coinWalletPort(['--port=abc'], {}).ok).toBe(false);
    expect(coinWalletPort(['--port'], {}).ok).toBe(false);
  });
});
