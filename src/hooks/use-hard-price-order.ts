'use client';

import { useState, useCallback, useRef } from 'react';
import type {
  WalletQuoteResponse,
  WalletFreezeResponse,
  HardPriceOrderState,
  WalletTransactionSnapshot,
} from '@/lib/wallet-types';

export interface HardPriceOrderParams {
  appKey: string;
  templateId: number;
  comboKey: string;
  clientPrice: number;
}

export interface HardPriceOrderResult {
  state: HardPriceOrderState;
  quote: WalletQuoteResponse | null;
  transaction: WalletFreezeResponse | null;
  error: string | null;
  /**
   * Step 1: quote+freeze. Call before task creation.
   * Returns the frozen transaction snapshot to store in the master task.
   */
  freeze(params: HardPriceOrderParams): Promise<WalletTransactionSnapshot | null>;
  /**
   * Step 2a: confirm. Call after successful task creation.
   */
  confirm(transactionId: string, taskId: string, appKey: string): Promise<boolean>;
  /**
   * Step 2b: refund. Call after task creation failure or cancellation.
   */
  refund(transactionId: string, appKey: string, reason?: string): Promise<boolean>;
  reset(): void;
}

export function useHardPriceOrder(): HardPriceOrderResult {
  const [state, setState] = useState<HardPriceOrderState>('idle');
  const [quote, setQuote] = useState<WalletQuoteResponse | null>(null);
  const [transaction, setTransaction] = useState<WalletFreezeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Idempotency key: generated fresh at the start of each new freeze attempt
  // and cleared after every terminal outcome so retries of the same in-flight
  // freeze reuse the same key, but a new order attempt always gets a new key.
  const idempotencyKeyRef = useRef<string>('');

  const freeze = useCallback(async (params: HardPriceOrderParams): Promise<WalletTransactionSnapshot | null> => {
    setError(null);

    // ── 1. Quote / pin ────────────────────────────────────────────────────
    setState('quoting');
    // Generate a fresh idempotency key for each new order attempt.
    idempotencyKeyRef.current = `${params.appKey}_${params.templateId}_${Date.now()}`;
    let quoteData: WalletQuoteResponse;
    try {
      const res = await fetch('/api/narrator/wallet/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-app-key': params.appKey },
        body: JSON.stringify({
          template_id: params.templateId,
          combo_key: params.comboKey,
          client_price: params.clientPrice,
        }),
      });
      const j = await res.json();
      if (!j.success) {
        throw new Error(j.error ?? '报价失败');
      }
      quoteData = j.data as WalletQuoteResponse;
      setQuote(quoteData);
    } catch (err) {
      const msg = (err as Error).message ?? '报价请求失败';
      setError(msg);
      setState('error');
      idempotencyKeyRef.current = '';
      return null;
    }

    // ── 2. Freeze ─────────────────────────────────────────────────────────
    setState('freezing');
    try {
      const res = await fetch('/api/narrator/wallet/freezes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-app-key': params.appKey },
        body: JSON.stringify({
          quote_id: quoteData.quote_id,
          idempotency_key: idempotencyKeyRef.current,
        }),
      });
      const j = await res.json();
      if (!j.success) {
        const msg = j.error ?? '余额冻结失败';
        setError(msg);
        setState('error');
        idempotencyKeyRef.current = '';
        return null;
      }
      const txData = j.data as WalletFreezeResponse;
      setTransaction(txData);
      setState('frozen');
      return {
        transaction_id: txData.transaction_id,
        quote_id: txData.quote_id,
        amount: txData.amount,
        status: txData.status,
        pricing_rule_version: quoteData.pricing_rule_version,
        idempotency_key: idempotencyKeyRef.current,
      };
    } catch (err) {
      const msg = (err as Error).message ?? '余额冻结请求失败';
      setError(msg);
      setState('error');
      idempotencyKeyRef.current = '';
      return null;
    }
  }, []);

  const confirm = useCallback(async (transactionId: string, taskId: string, appKey: string): Promise<boolean> => {
    setState('confirming');
    try {
      const res = await fetch('/api/narrator/wallet/confirms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-app-key': appKey },
        body: JSON.stringify({ transaction_id: transactionId, task_id: taskId }),
      });
      const j = await res.json();
      if (!j.success) {
        setError(j.error ?? '确认扣费失败');
        setState('error');
        idempotencyKeyRef.current = '';
        return false;
      }
      setState('confirmed');
      idempotencyKeyRef.current = '';
      return true;
    } catch (err) {
      setError((err as Error).message ?? '确认扣费请求失败');
      setState('error');
      idempotencyKeyRef.current = '';
      return false;
    }
  }, []);

  const refund = useCallback(async (transactionId: string, appKey: string, reason?: string): Promise<boolean> => {
    setState('refunding');
    try {
      const res = await fetch('/api/narrator/wallet/refunds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-app-key': appKey },
        body: JSON.stringify({ transaction_id: transactionId, reason }),
      });
      const j = await res.json();
      if (!j.success) {
        setError(j.error ?? '退款失败');
        setState('error');
        idempotencyKeyRef.current = '';
        return false;
      }
      setState('refunded');
      idempotencyKeyRef.current = '';
      return true;
    } catch (err) {
      setError((err as Error).message ?? '退款请求失败');
      setState('error');
      idempotencyKeyRef.current = '';
      return false;
    }
  }, []);

  const reset = useCallback(() => {
    setState('idle');
    setQuote(null);
    setTransaction(null);
    setError(null);
    idempotencyKeyRef.current = '';
  }, []);

  return { state, quote, transaction, error, freeze, confirm, refund, reset };
}
