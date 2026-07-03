import { describe, it, expect } from 'vitest';
import {
  resolveComboKey,
  formatHardPrice,
  createHardPriceBudgetSnapshot,
  COMBO_KEY_LABELS,
  computeModificationMetrics,
  toCatalogTierCode,
} from './hard-price-utils';
import type { HardPriceDetail } from './hard-price-utils';

const baseDetail: HardPriceDetail = {
  template_id: 1,
  combo_key: 'original_narration_flash',
  hard_price: 84.5,
  text_chars: 1000,
  text_lines: 50,
  billing_duration_minutes: 10,
  pricing_rule_version: 1,
};

describe('resolveComboKey', () => {
  it('writingType=1 + flash → original_narration_flash', () => {
    expect(resolveComboKey(1, 'flash')).toBe('original_narration_flash');
  });

  it('writingType=1 + pro → original_narration_pro', () => {
    expect(resolveComboKey(1, 'pro')).toBe('original_narration_pro');
  });

  it('writingType=2 + flash → original_remix_flash', () => {
    expect(resolveComboKey(2, 'flash')).toBe('original_remix_flash');
  });

  it('writingType=2 + pro → original_remix_pro', () => {
    expect(resolveComboKey(2, 'pro')).toBe('original_remix_pro');
  });

  it('writingType=0 → secondary_creation (model ignored)', () => {
    expect(resolveComboKey(0, 'flash')).toBe('secondary_creation');
    expect(resolveComboKey(0, 'pro')).toBe('secondary_creation');
  });
});

describe('formatHardPrice', () => {
  it('formats with 2 decimal places', () => {
    expect(formatHardPrice(84.5)).toBe('84.50 点');
  });

  it('formats integer', () => {
    expect(formatHardPrice(100)).toBe('100.00 点');
  });

  it('formats small decimal', () => {
    expect(formatHardPrice(7.86)).toBe('7.86 点');
  });
});

describe('createHardPriceBudgetSnapshot', () => {
  const detail: HardPriceDetail = {
    template_id: 42,
    combo_key: 'original_narration_flash',
    hard_price: 84.5,
    text_chars: 2500,
    text_lines: 130,
    billing_duration_minutes: 6,
    pricing_rule_version: 1,
  };

  it('stores hard_price as total_points', () => {
    const snap = createHardPriceBudgetSnapshot(detail);
    expect(snap.total_points).toBe(84.5);
  });

  it('does NOT multiply by episode count (product requirement §三.6)', () => {
    const snap = createHardPriceBudgetSnapshot(detail);
    // total_points should be the hard_price, not hard_price * episodes
    expect(snap.total_points).toBe(detail.hard_price);
  });

  it('sets legacy fields to 0', () => {
    const snap = createHardPriceBudgetSnapshot(detail);
    expect(snap.learning_points).toBe(0);
    expect(snap.writing_points).toBe(0);
    expect(snap.composing_points).toBe(0);
  });

  it('preserves combo_key and metadata', () => {
    const snap = createHardPriceBudgetSnapshot(detail);
    expect(snap.combo_key).toBe('original_narration_flash');
    expect(snap.pricing_rule_version).toBe(1);
  });
});

describe('COMBO_KEY_LABELS', () => {
  it('has all 5 keys', () => {
    expect(Object.keys(COMBO_KEY_LABELS)).toHaveLength(5);
  });

  it('has Chinese labels', () => {
    expect(COMBO_KEY_LABELS.original_narration_flash).toContain('纯解说');
    expect(COMBO_KEY_LABELS.original_remix_flash).toContain('原声混剪');
    expect(COMBO_KEY_LABELS.secondary_creation).toBe('二创文案');
  });
});

describe('toCatalogTierCode', () => {
  it('maps legacy UI combo keys to v2 catalog tier codes', () => {
    expect(toCatalogTierCode('original_narration_flash')).toBe('original_narration_flash');
    expect(toCatalogTierCode('original_narration_pro')).toBe('original_narration_pro');
    expect(toCatalogTierCode('original_remix_flash')).toBe('original_mix_flash');
    expect(toCatalogTierCode('original_remix_pro')).toBe('original_mix_pro');
    expect(toCatalogTierCode('secondary_creation')).toBe('derivative');
  });

  it('passes through already-canonical tier codes', () => {
    expect(toCatalogTierCode('original_mix_flash')).toBe('original_mix_flash');
    expect(toCatalogTierCode('derivative')).toBe('derivative');
  });
});

describe('computeModificationMetrics', () => {
  it('unmodified script: ratio is 0 and delta is 0', () => {
    const m = computeModificationMetrics(baseDetail, 10);
    expect(m.original_template_minutes).toBe(10);
    expect(m.modified_script_minutes).toBe(10);
    expect(m.delta_minutes).toBe(0);
    expect(m.modification_ratio).toBe(0);
  });

  it('150% threshold: ratio is 0.5 and delta is +5', () => {
    const m = computeModificationMetrics(baseDetail, 15);
    expect(m.delta_minutes).toBe(5);
    expect(m.modification_ratio).toBe(0.5);
  });

  it('200% bucket: ratio is 1.0', () => {
    const m = computeModificationMetrics(baseDetail, 20);
    expect(m.modification_ratio).toBe(1);
  });

  it('300% bucket: ratio is 2.0', () => {
    const m = computeModificationMetrics(baseDetail, 30);
    expect(m.modification_ratio).toBe(2);
  });

  it('user shortened script: delta is negative, ratio < 0', () => {
    const m = computeModificationMetrics(baseDetail, 7);
    expect(m.delta_minutes).toBe(-3);
    expect(m.modification_ratio).toBe(-0.3);
  });

  it('degenerate template (original=0): ratio is 0, no division-by-zero', () => {
    const degenerate: HardPriceDetail = { ...baseDetail, billing_duration_minutes: 0 };
    const m = computeModificationMetrics(degenerate, 5);
    expect(m.original_template_minutes).toBe(0);
    expect(m.modified_script_minutes).toBe(5);
    expect(m.delta_minutes).toBe(5);
    expect(m.modification_ratio).toBe(0);
  });

  it('precision: ratio rounded to 4 decimal places', () => {
    // (11 - 7) / 7 = 0.5714285... -> 0.5714
    const detail: HardPriceDetail = { ...baseDetail, billing_duration_minutes: 7 };
    const m = computeModificationMetrics(detail, 11);
    expect(m.modification_ratio).toBe(0.5714);
    expect(m.delta_minutes).toBe(4);
  });

  it('precision: delta rounded to 4 decimal places', () => {
    // 10.12345 - 10 = 0.12345 → 0.1235 (rounded)
    const m = computeModificationMetrics(baseDetail, 10.12345);
    expect(m.delta_minutes).toBe(0.1235);
  });
});
