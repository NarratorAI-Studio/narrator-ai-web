/**
 * Unit tests for the admin pricing-catalog payload shaping .
 *
 * Acceptance:
 *   - Pro `pro_surcharge_display` is derived from the matching Flash
 *     tier (pro.manual_price - flash.manual_price), never sourced
 *     from operator input.
 *   - raw_rate / final_rate / rounding_rule_version are stripped
 *     from the wire payload (server-side default per
 *     Backend API contract).
 *   - Pro tier without a matching Flash returns `partial`, not a
 *     malformed payload.
 *   - Pro tier whose price is below Flash is rejected by the live
 *     invariant check.
 */

import { describe, expect, it } from 'vitest';

import {
  checkInvariants,
  matchingFlashTier,
  tierCompleteness,
  toServerTier,
  type TierDraft,
} from '@/lib/pricing-catalog-tier-payload';

const TIER_LABELS: Record<string, string> = {
  original_narration_flash: '原创纯解说 · Flash',
  original_narration_pro: '原创纯解说 · Pro',
};

function makeFlash(overrides: Partial<TierDraft> = {}): TierDraft {
  return {
    tier_code: 'original_narration_flash',
    product_line: 'original',
    mode: 'narration',
    quality: 'flash',
    flash_pro_axis: 'required',
    manual_price: '70',
    pro_surcharge_display: '',
    system_reference_price: '70',
    raw_rate: '',
    final_rate: '',
    rounding_rule_version: 'v2.0-round-half-up',
    ...overrides,
  };
}

function makePro(overrides: Partial<TierDraft> = {}): TierDraft {
  return {
    tier_code: 'original_narration_pro',
    product_line: 'original',
    mode: 'narration',
    quality: 'pro',
    flash_pro_axis: 'required',
    manual_price: '75',
    pro_surcharge_display: '',
    system_reference_price: '75',
    raw_rate: '',
    final_rate: '',
    rounding_rule_version: 'v2.0-round-half-up',
    ...overrides,
  };
}

describe('toServerTier (Flash)', () => {
  it('omits raw_rate / final_rate / rounding_rule_version and pro fields', () => {
    const flash = makeFlash();
    const payload = toServerTier(flash, [flash]);
    expect(payload).toEqual({
      tier_code: 'original_narration_flash',
      product_line: 'original',
      mode: 'narration',
      quality: 'flash',
      flash_pro_axis: 'required',
      manual_price: 70,
      system_reference_price: 70,
    });
    expect(payload).not.toHaveProperty('raw_rate');
    expect(payload).not.toHaveProperty('final_rate');
    expect(payload).not.toHaveProperty('rounding_rule_version');
    expect(payload).not.toHaveProperty('pro_surcharge_display');
  });

  it('returns null when manual_price is blank', () => {
    const flash = makeFlash({ manual_price: '' });
    expect(toServerTier(flash, [flash])).toBeNull();
  });
});

describe('toServerTier (Pro derivation)', () => {
  it('derives pro_surcharge_display from matching Flash', () => {
    const flash = makeFlash({ manual_price: '70' });
    const pro = makePro({ manual_price: '75' });
    const payload = toServerTier(pro, [flash, pro]);
    expect(payload).not.toBeNull();
    expect(payload!.pro_surcharge_display).toBe(5);
    expect(payload).not.toHaveProperty('raw_rate');
  });

  it('returns null when matching Flash is missing', () => {
    const pro = makePro({ manual_price: '75' });
    expect(toServerTier(pro, [pro])).toBeNull();
  });

  it('returns null when matching Flash has blank manual_price', () => {
    const flash = makeFlash({ manual_price: '' });
    const pro = makePro({ manual_price: '75' });
    expect(toServerTier(pro, [flash, pro])).toBeNull();
  });

  it('returns null when Pro < Flash (would yield negative surcharge)', () => {
    const flash = makeFlash({ manual_price: '70' });
    const pro = makePro({ manual_price: '60' });
    expect(toServerTier(pro, [flash, pro])).toBeNull();
  });

  it('matches Flash only when product_line + mode line up', () => {
    const otherFlash = makeFlash({
      tier_code: 'original_mix_flash',
      mode: 'mix',
      manual_price: '50',
    });
    const pro = makePro({ manual_price: '75' });
    // otherFlash has mode=mix, pro has mode=narration → no match
    expect(toServerTier(pro, [otherFlash, pro])).toBeNull();
  });
});

describe('matchingFlashTier', () => {
  it('returns the Flash row with same product_line + mode and filled manual_price', () => {
    const flash = makeFlash();
    const pro = makePro();
    expect(matchingFlashTier(pro, [flash, pro])).toBe(flash);
  });

  it('returns null when no Flash has a filled manual_price', () => {
    const flash = makeFlash({ manual_price: '   ' });
    const pro = makePro();
    expect(matchingFlashTier(pro, [flash, pro])).toBeNull();
  });
});

describe('tierCompleteness', () => {
  it('returns empty when both required inputs are blank', () => {
    const flash = makeFlash({ manual_price: '', system_reference_price: '' });
    expect(tierCompleteness(flash, [flash])).toBe('empty');
  });

  it('returns partial for a Pro tier without a matching Flash', () => {
    const pro = makePro({ manual_price: '75' });
    expect(tierCompleteness(pro, [pro])).toBe('partial');
  });

  it('returns complete for a Flash tier with both required inputs', () => {
    const flash = makeFlash();
    expect(tierCompleteness(flash, [flash])).toBe('complete');
  });

  it('returns complete for a Pro tier with matching filled Flash', () => {
    const flash = makeFlash();
    const pro = makePro();
    expect(tierCompleteness(pro, [flash, pro])).toBe('complete');
  });
});

describe('checkInvariants', () => {
  it('flags Pro < Flash on the same product_line + mode', () => {
    const flash = makeFlash({ manual_price: '80' });
    const pro = makePro({ manual_price: '70' });
    const errs = checkInvariants([flash, pro], TIER_LABELS);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('Pro 价 (70) 不能低于 Flash 价 (80)');
  });

  it('passes when Pro >= Flash', () => {
    const flash = makeFlash({ manual_price: '70' });
    const pro = makePro({ manual_price: '75' });
    expect(checkInvariants([flash, pro], TIER_LABELS)).toEqual([]);
  });

  it('passes when Pro has no matching Flash (partial state surfaces elsewhere)', () => {
    const pro = makePro({ manual_price: '75' });
    expect(checkInvariants([pro], TIER_LABELS)).toEqual([]);
  });
});
