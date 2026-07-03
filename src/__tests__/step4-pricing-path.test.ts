import { describe, expect, it } from 'vitest';
import { shouldQuotePresetTemplateOnStep4 } from '@/lib/step4-pricing-path';

describe('shouldQuotePresetTemplateOnStep4', () => {
  it('quotes preset templates regardless of whether Step 1 used custom material', () => {
    expect(
      shouldQuotePresetTemplateOnStep4({
        useCustomTemplate: false,
        hasConfirmedTemplate: true,
        hardPriceFlagEnabled: true,
      }),
    ).toBe(true);
  });

  it('does not quote when the rollout flag is disabled', () => {
    expect(
      shouldQuotePresetTemplateOnStep4({
        useCustomTemplate: false,
        hasConfirmedTemplate: true,
        hardPriceFlagEnabled: false,
      }),
    ).toBe(false);
  });

  it('does not quote preset-template pricing for custom-SRT templates', () => {
    expect(
      shouldQuotePresetTemplateOnStep4({
        useCustomTemplate: true,
        hasConfirmedTemplate: true,
        hardPriceFlagEnabled: true,
      }),
    ).toBe(false);
  });

  it('does not quote without a confirmed preset template', () => {
    expect(
      shouldQuotePresetTemplateOnStep4({
        useCustomTemplate: false,
        hasConfirmedTemplate: false,
        hardPriceFlagEnabled: true,
      }),
    ).toBe(false);
  });
});
