import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isHardPriceEnabled,
  shouldUseHardPrice,
  shouldUseHardPriceV2,
  getHardPriceRolloutPercent,
  isKillSwitchActive,
  fetchFeatureFlags,
  resetFeatureFlagsCacheForTests,
} from './feature-flags';

describe('getHardPriceRolloutPercent', () => {
  beforeEach(() => { vi.unstubAllEnvs(); });

  it('returns 0 when env not set', () => {
    vi.stubEnv('NEXT_PUBLIC_HARD_PRICE_ROLLOUT_PERCENT', '');
    expect(getHardPriceRolloutPercent()).toBe(0);
  });

  it('returns parsed value', () => {
    vi.stubEnv('NEXT_PUBLIC_HARD_PRICE_ROLLOUT_PERCENT', '50');
    expect(getHardPriceRolloutPercent()).toBe(50);
  });

  it('clamps to 100', () => {
    vi.stubEnv('NEXT_PUBLIC_HARD_PRICE_ROLLOUT_PERCENT', '200');
    expect(getHardPriceRolloutPercent()).toBe(100);
  });

  it('returns 0 for negative', () => {
    vi.stubEnv('NEXT_PUBLIC_HARD_PRICE_ROLLOUT_PERCENT', '-10');
    expect(getHardPriceRolloutPercent()).toBe(0);
  });

  it('returns 0 for NaN', () => {
    vi.stubEnv('NEXT_PUBLIC_HARD_PRICE_ROLLOUT_PERCENT', 'abc');
    expect(getHardPriceRolloutPercent()).toBe(0);
  });
});

describe('isHardPriceEnabled', () => {
  beforeEach(() => { vi.unstubAllEnvs(); });

  it('returns false when rollout is 0', () => {
    vi.stubEnv('NEXT_PUBLIC_HARD_PRICE_ROLLOUT_PERCENT', '0');
    expect(isHardPriceEnabled('any-key')).toBe(false);
  });

  it('returns true when rollout is 100', () => {
    vi.stubEnv('NEXT_PUBLIC_HARD_PRICE_ROLLOUT_PERCENT', '100');
    expect(isHardPriceEnabled('any-key')).toBe(true);
  });

  it('is deterministic — same key always same result', () => {
    vi.stubEnv('NEXT_PUBLIC_HARD_PRICE_ROLLOUT_PERCENT', '50');
    const r1 = isHardPriceEnabled('test-key-123');
    const r2 = isHardPriceEnabled('test-key-123');
    expect(r1).toBe(r2);
  });

  it('different keys can produce different results', () => {
    vi.stubEnv('NEXT_PUBLIC_HARD_PRICE_ROLLOUT_PERCENT', '50');
    const results = new Set<boolean>();
    for (let i = 0; i < 100; i++) {
      results.add(isHardPriceEnabled(`key-${i}`));
    }
    // With 50% rollout and 100 keys, both true and false should appear
    expect(results.size).toBe(2);
  });
});

describe('isKillSwitchActive', () => {
  beforeEach(() => { vi.unstubAllEnvs(); });

  it('returns false when not set', () => {
    expect(isKillSwitchActive()).toBe(false);
  });

  it('returns true when set to "true"', () => {
    vi.stubEnv('NEXT_PUBLIC_HARD_PRICE_KILL_SWITCH', 'true');
    expect(isKillSwitchActive()).toBe(true);
  });

  it('returns false for other values', () => {
    vi.stubEnv('NEXT_PUBLIC_HARD_PRICE_KILL_SWITCH', 'false');
    expect(isKillSwitchActive()).toBe(false);
  });
});

describe('shouldUseHardPrice', () => {
  beforeEach(() => { vi.unstubAllEnvs(); });

  it('returns false when kill switch active even if rollout 100%', () => {
    vi.stubEnv('NEXT_PUBLIC_HARD_PRICE_ROLLOUT_PERCENT', '100');
    vi.stubEnv('NEXT_PUBLIC_HARD_PRICE_KILL_SWITCH', 'true');
    expect(shouldUseHardPrice('any-key')).toBe(false);
  });

  it('returns true when rollout 100% and no kill switch', () => {
    vi.stubEnv('NEXT_PUBLIC_HARD_PRICE_ROLLOUT_PERCENT', '100');
    expect(shouldUseHardPrice('any-key')).toBe(true);
  });
});

describe('shouldUseHardPriceV2', () => {
  beforeEach(() => { vi.unstubAllEnvs(); });

  it('returns false when v2 rollout is 0', () => {
    vi.stubEnv('NEXT_PUBLIC_HARD_PRICE_V2_ROLLOUT_PERCENT', '0');
    expect(shouldUseHardPriceV2('any-key')).toBe(false);
  });

  it('returns true when v2 rollout is 100', () => {
    vi.stubEnv('NEXT_PUBLIC_HARD_PRICE_V2_ROLLOUT_PERCENT', '100');
    expect(shouldUseHardPriceV2('any-key')).toBe(true);
  });

  it('returns false when v2 kill switch active even at 100% rollout', () => {
    vi.stubEnv('NEXT_PUBLIC_HARD_PRICE_V2_ROLLOUT_PERCENT', '100');
    vi.stubEnv('NEXT_PUBLIC_HARD_PRICE_V2_KILL_SWITCH', 'true');
    expect(shouldUseHardPriceV2('any-key')).toBe(false);
  });

  it('uses a different salt than v1 — same key may bucket differently', () => {
    // At 50% rollout, the v1 and v2 buckets for the same key are
    // independent; with enough samples we should see at least one key
    // where they differ.
    vi.stubEnv('NEXT_PUBLIC_HARD_PRICE_ROLLOUT_PERCENT', '50');
    vi.stubEnv('NEXT_PUBLIC_HARD_PRICE_V2_ROLLOUT_PERCENT', '50');
    let divergences = 0;
    for (let i = 0; i < 200; i++) {
      if (shouldUseHardPrice(`key-${i}`) !== shouldUseHardPriceV2(`key-${i}`)) {
        divergences += 1;
      }
    }
    expect(divergences).toBeGreaterThan(0);
  });

  it('is deterministic for the same key', () => {
    vi.stubEnv('NEXT_PUBLIC_HARD_PRICE_V2_ROLLOUT_PERCENT', '50');
    const r1 = shouldUseHardPriceV2('test-key-xyz');
    const r2 = shouldUseHardPriceV2('test-key-xyz');
    expect(r1).toBe(r2);
  });
});

describe('fetchFeatureFlags', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetFeatureFlagsCacheForTests();
  });

  it('fetches from server API and updates cache', async () => {
    const mockResponse = { hard_price_kill_switch: true, hard_price_rollout_percent: 50 };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const flags = await fetchFeatureFlags();
    expect(flags.hard_price_kill_switch).toBe(true);
    expect(flags.hard_price_rollout_percent).toBe(50);

    // After fetch, synchronous functions should use cached values
    expect(isKillSwitchActive()).toBe(true);
  });

  it('falls back to NEXT_PUBLIC_ env vars when API fails', async () => {
    vi.stubEnv('NEXT_PUBLIC_HARD_PRICE_KILL_SWITCH', 'false');
    vi.stubEnv('NEXT_PUBLIC_HARD_PRICE_ROLLOUT_PERCENT', '75');
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network'));

    const flags = await fetchFeatureFlags();
    expect(flags.hard_price_kill_switch).toBe(false);
    expect(flags.hard_price_rollout_percent).toBe(75);
  });
});
