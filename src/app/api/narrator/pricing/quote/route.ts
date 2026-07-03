/**
 * BFF route: POST /api/narrator/pricing/quote.
 *
 * Proxies to backend `POST /pricing/quote` (hard-price v2 — backend
 * regression coverage). Mirrors the error envelope shape used by all `pricing-*`
 * routes so the hook + confirm-page UI can switch on `error.code`.
 *
 * Auth: forwards `x-app-key` header from the client. The backend
 * bearer token is server-only env (`PRICING_BFF_AUTH_TOKEN`).
 *
 * regression coverage — confirm page consumes this on open to lock `final_charge_price`
 * for the §6.1 TTL window.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  generatePricingQuote,
  PricingQuoteClientError,
} from '@/lib/pricing-quote-backend-client';
import type {
  PricingQuoteRequest,
  PricingQuoteErrorCode,
} from '@/lib/pricing-quote-types';

function errorResponse(
  status: number,
  code: PricingQuoteErrorCode,
  message: string,
  details: Record<string, unknown> = {},
  retryable = false
) {
  return NextResponse.json(
    { success: false, error: { code, message, retryable, details } },
    { status }
  );
}

export async function POST(request: NextRequest) {
  const appKey = request.headers.get('x-app-key') ?? '';
  if (!appKey) {
    return errorResponse(401, 'UNAUTHORIZED', '请先配置 App Key');
  }

  let body: PricingQuoteRequest;
  try {
    body = (await request.json()) as PricingQuoteRequest;
  } catch {
    return errorResponse(400, 'BAD_REQUEST', '请求体格式错误');
  }

  // Surface-level shape validation; backend enforces the strict
  // contract (combo_key required, exactly one of template_id /
  // custom_template_id, pro/flash suffix matches pro_upgrade, etc.).
  if (typeof body !== 'object' || body === null || !('combo_key' in body)) {
    return errorResponse(400, 'BAD_REQUEST', '缺少必要字段: combo_key');
  }

  try {
    const data = await generatePricingQuote(appKey, body);
    return NextResponse.json({ success: true, data });
  } catch (err) {
    if (err instanceof PricingQuoteClientError) {
      return errorResponse(
        err.status,
        err.code,
        err.message,
        err.details,
        err.retryable
      );
    }
    return errorResponse(
      500,
      'UNKNOWN',
      (err as Error).message ?? '报价失败，请重试'
    );
  }
}
