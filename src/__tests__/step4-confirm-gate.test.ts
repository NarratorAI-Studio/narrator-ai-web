import { describe, it, expect } from 'vitest';
import {
  isStep4ConfirmDisabled,
  type Step4ConfirmGateInput,
} from '@/lib/step4-confirm-gate';

/**
 * Defaults that represent a "valid, fully-priced default budget card"
 * state — `isStep4ConfirmDisabled` returns `false`. Tests override one
 * or two fields at a time so each case names exactly what it asserts.
 */
const baseValid: Step4ConfirmGateInput = {
  verifyOk: true,
  creating: false,
  verifying: false,
  loadingBudget: false,
  hardPriceQuoteV2State: 'quoted',
  isHardPrice: false,
  useCustomTemplate: false,
  hasConfirmedTemplate: true,
  rawVideoQueued: false,
  hasBudgetResult: true,
};

describe('isStep4ConfirmDisabled', () => {
  it('enables confirm when everything is ready (baseline)', () => {
    expect(isStep4ConfirmDisabled(baseValid)).toBe(false);
  });

  describe('lifecycle gates', () => {
    it('disables when material verification has not passed', () => {
      expect(isStep4ConfirmDisabled({ ...baseValid, verifyOk: false })).toBe(true);
      expect(isStep4ConfirmDisabled({ ...baseValid, verifyOk: null })).toBe(true);
    });
    it('disables while a create is already in flight', () => {
      expect(isStep4ConfirmDisabled({ ...baseValid, creating: true })).toBe(true);
    });
    it('disables while material verification is still running', () => {
      expect(isStep4ConfirmDisabled({ ...baseValid, verifying: true })).toBe(true);
    });
    it('disables while budget/quote is in flight', () => {
      expect(isStep4ConfirmDisabled({ ...baseValid, loadingBudget: true })).toBe(true);
    });
  });

  describe('hard-price V2 quote states', () => {
    it('disables on insufficient balance', () => {
      expect(
        isStep4ConfirmDisabled({ ...baseValid, hardPriceQuoteV2State: 'insufficient' })
      ).toBe(true);
    });

    // Regression coverage: V2 quote never produced a result, the price card shows
    // "点数计算未完成", but the previous gate left the button enabled because
    // it only checked `useMaterialLib`. Custom-material flows reach this state
    // with useMaterialLib=false, so the old condition missed them.
    it('disables on V2 quote "error" state for network/API failure', () => {
      expect(
        isStep4ConfirmDisabled({
          ...baseValid,
          hardPriceQuoteV2State: 'error',
          hasBudgetResult: false,
        })
      ).toBe(true);
    });

    it('disables on V2 quote "idle" state when default card has no budget', () => {
      // The "点数计算未完成" scenario.
      expect(
        isStep4ConfirmDisabled({
          ...baseValid,
          hardPriceQuoteV2State: 'idle',
          hasBudgetResult: false,
        })
      ).toBe(true);
    });
  });

  describe('default budget card path', () => {
    it('disables when default card has no budgetResult, regardless of material source', () => {
      // The bug: the old condition was `useMaterialLib && ...`, so
      // custom-material (useMaterialLib=false) escaped the check.
      // The fix gates on `!isHardPrice && !useCustomTemplate` instead,
      // which catches both material-library AND custom-material paths.
      expect(
        isStep4ConfirmDisabled({
          ...baseValid,
          hasBudgetResult: false,
          // useMaterialLib not modeled — only `isHardPrice` and
          // `useCustomTemplate` are needed to identify the default card
          // branch.
        })
      ).toBe(true);
    });

    it('allows when budgetResult is present (default card is renderable)', () => {
      expect(
        isStep4ConfirmDisabled({ ...baseValid, hasBudgetResult: true })
      ).toBe(false);
    });

    it('allows when raw video is queued (price intentionally deferred)', () => {
      expect(
        isStep4ConfirmDisabled({
          ...baseValid,
          hasBudgetResult: false,
          rawVideoQueued: true,
        })
      ).toBe(false);
    });

    it('does not apply default-card gate when isHardPrice owns the card', () => {
      // The isHardPrice branch has its own pricing card and its own
      // disabled handling; this gate must not interfere.
      expect(
        isStep4ConfirmDisabled({
          ...baseValid,
          isHardPrice: true,
          hasBudgetResult: false,
        })
      ).toBe(false);
    });

    it('does not apply default-card gate when useCustomTemplate owns the card', () => {
      // Same reasoning for the custom-SRT branch.
      expect(
        isStep4ConfirmDisabled({
          ...baseValid,
          useCustomTemplate: true,
          hasBudgetResult: false,
        })
      ).toBe(false);
    });

    it('does not apply default-card gate when no template confirmed yet', () => {
      // Earlier wizard steps without a chosen template should not be
      // blocked by this gate (other validators handle Step 1-3).
      expect(
        isStep4ConfirmDisabled({
          ...baseValid,
          hasConfirmedTemplate: false,
          hasBudgetResult: false,
        })
      ).toBe(false);
    });
  });

  describe('double-click cannot bypass', () => {
    // The button uses `disabled` from the same pure function on every
    // render, so a double-click on a disabled button cannot fire
    // `handleCreate`. This is structural — the test just makes the
    // intent explicit: the function is referentially transparent and
    // returns the same answer for the same inputs.
    it('is deterministic for identical inputs', () => {
      const input: Step4ConfirmGateInput = {
        ...baseValid,
        hardPriceQuoteV2State: 'idle',
        hasBudgetResult: false,
      };
      const first = isStep4ConfirmDisabled(input);
      const second = isStep4ConfirmDisabled({ ...input });
      expect(first).toBe(second);
      expect(first).toBe(true);
    });
  });
});
