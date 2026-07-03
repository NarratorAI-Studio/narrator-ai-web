/**
 * Server-side HTTP client for narrator-ai-web-backend wallet API.
 * Only used in Next.js API routes (server side). Never import in 'use client' files.
 *
 * Base URL: WALLET_BACKEND_URL env var (no NEXT_PUBLIC_ prefix).
 * Auth: x-app-key header forwarded from the web request.
 */

import type {
  WalletQuoteRequest,
  WalletQuoteResponse,
  WalletFreezeRequest,
  WalletFreezeResponse,
  WalletConfirmRequest,
  WalletConfirmResponse,
  WalletRefundRequest,
  WalletRefundResponse,
  WalletTransaction,
  WalletBffError,
} from './wallet-types';

const WALLET_BASE = process.env.WALLET_BACKEND_URL ?? '';
const TIMEOUT_MS = 60_000;

class WalletError extends Error {
  constructor(
    public readonly code: WalletBffError['code'],
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'WalletError';
  }
}

async function walletRequest<T>(
  path: string,
  appKey: string,
  init: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${WALLET_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'x-app-key': appKey,
        ...init.headers,
      },
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = (body?.code as WalletBffError['code']) ?? 'UNKNOWN';
      throw new WalletError(code, body?.message ?? `wallet request failed (${res.status})`, res.status);
    }
    return body as T;
  } catch (err) {
    if (err instanceof WalletError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new WalletError('BACKEND_UNAVAILABLE', 'wallet backend request timed out');
    }
    throw new WalletError('BACKEND_UNAVAILABLE', (err as Error).message ?? 'unknown wallet error');
  } finally {
    clearTimeout(tid);
  }
}

export const walletClient = {
  quote(appKey: string, body: WalletQuoteRequest): Promise<WalletQuoteResponse> {
    return walletRequest('/wallet/quotes', appKey, { method: 'POST', body: JSON.stringify(body) });
  },

  freeze(appKey: string, body: WalletFreezeRequest): Promise<WalletFreezeResponse> {
    return walletRequest('/wallet/freezes', appKey, { method: 'POST', body: JSON.stringify(body) });
  },

  confirm(appKey: string, body: WalletConfirmRequest): Promise<WalletConfirmResponse> {
    return walletRequest('/wallet/confirms', appKey, { method: 'POST', body: JSON.stringify(body) });
  },

  refund(appKey: string, body: WalletRefundRequest): Promise<WalletRefundResponse> {
    return walletRequest('/wallet/refunds', appKey, { method: 'POST', body: JSON.stringify(body) });
  },

  getTransaction(appKey: string, transactionId: string): Promise<WalletTransaction> {
    return walletRequest(`/wallet/transactions/${transactionId}`, appKey);
  },
};

export { WalletError };
