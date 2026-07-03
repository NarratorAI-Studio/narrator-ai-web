/**
 * Unit tests for the v2 tiers → v1 HardPriceDetail[] translation that
 * lets the template-list page batch-populate templatePricesCache from
 * the new `/pricing/movie-baokuan` response. Verifies tier_code → combo_key naming (the two
 * mix/derivative aliases) and that unknown tier_codes are dropped.
 */

import { describe, expect, it } from 'vitest';

import {
  TIER_CODE_TO_COMBO_KEY,
  tiersToHardPriceDetails,
  type V2CatalogTier,
} from '@/lib/hard-price-utils';

function tier(
  overrides: Partial<V2CatalogTier> & Pick<V2CatalogTier, 'tier_code'>
): V2CatalogTier {
  return {
    manual_price: 100,
    system_reference_price: 110,
    pro_surcharge_display: null,
    flash_pro_axis: 'required',
    pricing_rule_version: 'v2.0-round-half-up',
    ...overrides,
  };
}

describe('tiersToHardPriceDetails', () => {
  it('translates the five canonical tier_codes to v1 combo_keys', () => {
    const tiers: Record<string, V2CatalogTier> = {
      original_narration_flash: tier({ tier_code: 'original_narration_flash', manual_price: 10 }),
      original_narration_pro: tier({ tier_code: 'original_narration_pro', manual_price: 20 }),
      original_mix_flash: tier({ tier_code: 'original_mix_flash', manual_price: 30 }),
      original_mix_pro: tier({ tier_code: 'original_mix_pro', manual_price: 40 }),
      derivative: tier({
        tier_code: 'derivative',
        manual_price: 50,
        flash_pro_axis: 'optional',
      }),
    };

    const out = tiersToHardPriceDetails(7, tiers);
    const byCombo = Object.fromEntries(out.map(d => [d.combo_key, d.hard_price]));

    expect(byCombo).toEqual({
      original_narration_flash: 10,
      original_narration_pro: 20,
      // v2 `mix` aliases back to v1 `remix` so the existing
      // COMBO_KEY_LABELS / fetchHardPrice path keeps working.
      original_remix_flash: 30,
      original_remix_pro: 40,
      // v2 `derivative` aliases back to v1 `secondary_creation`.
      secondary_creation: 50,
    });
    expect(out.every(d => d.template_id === 7)).toBe(true);
  });

  it('drops unknown tier_codes defensively (forward-compat with a 6th tier)', () => {
    const tiers: Record<string, V2CatalogTier> = {
      original_narration_flash: tier({ tier_code: 'original_narration_flash' }),
      // Imagine backend ships a new tier_code the web hasn't taught
      // its combo_key mapping yet — it should be dropped, not crash.
      original_narration_ultra: tier({ tier_code: 'original_narration_ultra' }),
    };

    const out = tiersToHardPriceDetails(1, tiers);
    expect(out).toHaveLength(1);
    expect(out[0].combo_key).toBe('original_narration_flash');
  });

  it('returns an empty array for an empty tiers map', () => {
    expect(tiersToHardPriceDetails(1, {})).toEqual([]);
  });

  it('TIER_CODE_TO_COMBO_KEY covers exactly the five v2 catalog tier_codes', () => {
    expect(Object.keys(TIER_CODE_TO_COMBO_KEY).sort()).toEqual([
      'derivative',
      'original_mix_flash',
      'original_mix_pro',
      'original_narration_flash',
      'original_narration_pro',
    ]);
  });
});
