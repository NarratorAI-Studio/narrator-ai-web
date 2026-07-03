'use client';

/**
 * Hard-price v2 confirm-page hook .
 *
 * Replaces `useHardPriceOrder` (v1 quote → freeze → confirm/refund)
 * with the v2 collapsed flow:
 *
 *   1. `quoteOnOpen()` — POST /api/narrator/pricing/quote when the
 *      confirm-page step opens. Returns the full quote payload (incl.
 *      `quote_id`, `final_charge_price`, `expires_at`, `pro_total`).
 *      State machine reflects the documented v2 error envelopes.
 *
 *   2. Caller passes `quote.quote_id` into the master-task create
 *      body — backend  writes the snapshot atomically. There is
 *      no separate freeze / confirm step on the web side.
 *
 *   3. `reset()` clears local state. There is no refund call here;
 *      refunds are handled by the existing wallet route.
 *
 * Pro toggle: caller re-invokes `quoteOnOpen` with `pro_upgrade=true`
 * and the Pro-suffixed `combo_key` per quote-snapshot-contract §6.2.
 */

import { useCallback, useState } from 'react';
import type {
  PricingQuoteData,
  PricingQuoteEnvelope,
  PricingQuoteErrorCode,
  PricingQuoteRequest,
} from '@/lib/pricing-quote-types';

export type HardPriceQuoteV2State =
  | 'idle'
  | 'quoting'
  | 'quoted'
  | 'expired'
  | 'drifted'
  | 'insufficient'
  | 'error';

export interface HardPriceQuoteV2Error {
  code: PricingQuoteErrorCode;
  message: string;
  details: Record<string, unknown>;
  retryable: boolean;
}

export interface HardPriceQuoteV2Result {
  state: HardPriceQuoteV2State;
  quote: PricingQuoteData | null;
  error: HardPriceQuoteV2Error | null;
  /**
   * Generate (or re-generate) a quote. Returns the quote on success
   * and null on every failure path; inspect `state` + `error` to
   * decide how to surface to the user.
   */
  quoteOnOpen(
    params: { appKey: string } & PricingQuoteRequest
  ): Promise<PricingQuoteData | null>;
  reset(): void;
}

// Map error codes returned by the BFF to a coarser UX-bucketed state.
// Anything not in this map collapses to a generic `error`.
const ERROR_CODE_TO_STATE: Partial<
  Record<PricingQuoteErrorCode, HardPriceQuoteV2State>
> = {
  WALLET_INSUFFICIENT_BALANCE: 'insufficient',
  // The §6.1 drift / expiry codes only surface during commit (master-
  // task create), not during quote. Listed here so they collapse
  // cleanly if a caller surfaces them via this hook's error setter.
};

export function useHardPriceQuoteV2(): HardPriceQuoteV2Result {
  const [state, setState] = useState<HardPriceQuoteV2State>('idle');
  const [quote, setQuote] = useState<PricingQuoteData | null>(null);
  const [error, setError] = useState<HardPriceQuoteV2Error | null>(null);

  const quoteOnOpen = useCallback(
    async (
      params: { appKey: string } & PricingQuoteRequest
    ): Promise<PricingQuoteData | null> => {
      const { appKey, ...body } = params;
      setState('quoting');
      setError(null);

      let envelope: PricingQuoteEnvelope;
      try {
        const res = await fetch('/api/narrator/pricing/quote', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-app-key': appKey,
          },
          body: JSON.stringify(body),
        });
        envelope = (await res.json()) as PricingQuoteEnvelope;
      } catch (err) {
        const message = (err as Error).message ?? '报价请求失败';
        setError({
          code: 'BFF_UPSTREAM_UNREACHABLE',
          message,
          details: {},
          retryable: true,
        });
        setState('error');
        setQuote(null);
        return null;
      }

      if (envelope.success) {
        setQuote(envelope.data);
        setState('quoted');
        return envelope.data;
      }

      const errCode = envelope.error.code;
      const nextState = ERROR_CODE_TO_STATE[errCode] ?? 'error';
      setError({
        code: errCode,
        message: envelope.error.message,
        details: envelope.error.details ?? {},
        retryable: Boolean(envelope.error.retryable),
      });
      setState(nextState);
      setQuote(null);
      return null;
    },
    []
  );

  const reset = useCallback(() => {
    setState('idle');
    setQuote(null);
    setError(null);
  }, []);

  return { state, quote, error, quoteOnOpen, reset };
}
