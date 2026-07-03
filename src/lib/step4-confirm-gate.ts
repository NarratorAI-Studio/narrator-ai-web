/**
 * Step 4 「确认创建」 button disabled-state decider.
 *
 * Extracted from src/app/page.tsx (the wizard's Step 4 confirm button)
 * so the gate invariant can be unit-tested without rendering the 2000+
 * line page component.
 *
 * The invariant (the implementation requirement / regression coverage): if the price card cannot show a
 * valid quote, the create action must be gated. A user who sees
 * "点数计算未完成" / "无法计算点数" must not be able to click through
 * and create a master task with an unknown price (that would either
 * fail server-side under regression coverage billing parity or, worse, succeed with
 * NULL hard_price).
 */
import type { HardPriceQuoteV2State } from '@/hooks/use-hard-price-quote-v2';

export interface Step4ConfirmGateInput {
  /** Material-validation result; null before validation completes. */
  verifyOk: boolean | null;
  /** `handleCreate` is in flight. */
  creating: boolean;
  /** Material verification is in flight. */
  verifying: boolean;
  /** Budget/quote network call is in flight (covers loading state of
   * both V1 budget and V2 quote helpers). */
  loadingBudget: boolean;
  /** Current V2 hard-price quote machine state. */
  hardPriceQuoteV2State: HardPriceQuoteV2State;
  /** True when an isHardPrice template owns the price card path. */
  isHardPrice: boolean;
  /** True when the custom-SRT template branch owns the price card. */
  useCustomTemplate: boolean;
  /** True iff the user has confirmed a (preset/material-lib) template. */
  hasConfirmedTemplate: boolean;
  /** True when raw video is queued for pre-processing (price deferred
   * to processing time, button is intentionally allowed). */
  rawVideoQueued: boolean;
  /** True iff the default budget card has produced a renderable result. */
  hasBudgetResult: boolean;
}

export function isStep4ConfirmDisabled(input: Step4ConfirmGateInput): boolean {
  const {
    verifyOk,
    creating,
    verifying,
    loadingBudget,
    hardPriceQuoteV2State,
    isHardPrice,
    useCustomTemplate,
    hasConfirmedTemplate,
    rawVideoQueued,
    hasBudgetResult,
  } = input;

  if (!verifyOk) return true;
  if (creating) return true;
  if (verifying) return true;
  if (loadingBudget) return true;

  // V2 quote terminal-bad states — explicit gates so a failed network
  // call or insufficient balance cannot bypass the create check.
  if (hardPriceQuoteV2State === 'insufficient') return true;
  if (hardPriceQuoteV2State === 'error') return true;

  // Default budget card path: when neither the hard-price branch nor
  // the custom-SRT branch owns the card, the user must see a real
  // `budgetResult` before they can create. Raw-video-queued is the one
  // exception — price is intentionally deferred to processing time.
  if (
    !isHardPrice &&
    !useCustomTemplate &&
    hasConfirmedTemplate &&
    !rawVideoQueued &&
    !hasBudgetResult
  ) {
    return true;
  }

  return false;
}
