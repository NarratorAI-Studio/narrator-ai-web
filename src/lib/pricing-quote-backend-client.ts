/**
 * Server-side HTTP client for narrator-ai-web-backend's hard-price v2
 * quote endpoint (regression coverage / Backend API contract).
 *
 * Single call:
 *   - POST /pricing/quote — generate + persist a quote
 *
 * Auth (mirrors `pricing-catalog-backend-client.ts`):
 *   1. `Authorization: Bearer <PRICING_BFF_AUTH_TOKEN>` — service identity
 *   2. `X-Web-App-Key: <users.app_key>` — end-user identity; backend
 *      enforces tenant isolation via `users.id` lookup
 *
 * Server-only. Never import in `'use client'` files.
 */

import type {
  PricingQuoteRequest,
  PricingQuoteData,
  PricingQuoteErrorCode,
} from './pricing-quote-types';

function getPricingApiUrl(): string {
  const url = process.env.NARRATOR_PRICING_API_URL;
  if (!url) {
    throw new Error(
      'NARRATOR_PRICING_API_URL environment variable is required. Set it in .env.local (local dev) or fly secrets (deploy).'
    );
  }
  return url;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export class PricingQuoteClientError extends Error {
  readonly status: number;
  readonly code: PricingQuoteErrorCode;
  readonly details: Record<string, unknown>;
  readonly retryable: boolean;
  constructor(
    message: string,
    status: number,
    code: PricingQuoteErrorCode,
    details: Record<string, unknown> = {},
    retryable = false
  ) {
    super(message);
    this.name = 'PricingQuoteClientError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryable = retryable;
  }
}

interface BackendErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    retryable?: boolean;
    details?: Record<string, unknown>;
  };
}

function isErrorEnvelope(x: unknown): x is BackendErrorEnvelope {
  return (
    typeof x === 'object' &&
    x !== null &&
    (x as { success?: unknown }).success === false &&
    typeof (x as { error?: unknown }).error === 'object'
  );
}

function requireBearer(): string {
  const bearer = process.env.PRICING_BFF_AUTH_TOKEN;
  if (!bearer) {
    throw new PricingQuoteClientError(
      'PRICING_BFF_AUTH_TOKEN env not set — web cannot authenticate to backend.',
      503,
      'BFF_AUTH_TOKEN_MISSING'
    );
  }
  return bearer;
}

/**
 * POST /pricing/quote — quote a hard-price v2 order.
 *
 * Returns the unwrapped `data` payload on 200. Throws
 * `PricingQuoteClientError` on every non-200 path (including upstream
 * timeout / non-JSON / structured error envelopes); the BFF route
 * maps these back to the documented HTTP statuses.
 */
export async function generatePricingQuote(
  appKey: string,
  body: PricingQuoteRequest
): Promise<PricingQuoteData> {
  const bearer = requireBearer();
  const url = new URL('/pricing/quote', getPricingApiUrl());

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let status: number;
  let parsed: unknown;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'X-Web-App-Key': appKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    status = res.status;
    parsed = await res.json().catch(() => null);
  } catch (err) {
    if (err instanceof PricingQuoteClientError) throw err;
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new PricingQuoteClientError(
      (err as Error).message ?? 'pricing backend call failed',
      aborted ? 504 : 502,
      aborted ? 'BFF_UPSTREAM_TIMEOUT' : 'BFF_UPSTREAM_UNREACHABLE',
      {},
      true
    );
  } finally {
    clearTimeout(tid);
  }

  if (status >= 200 && status < 300) {
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { success?: unknown }).success === true &&
      typeof (parsed as { data?: unknown }).data === 'object'
    ) {
      return (parsed as { data: PricingQuoteData }).data;
    }
    throw new PricingQuoteClientError(
      'Backend returned 2xx without the expected success envelope.',
      502,
      'BFF_INVALID_JSON'
    );
  }

  if (isErrorEnvelope(parsed)) {
    throw new PricingQuoteClientError(
      parsed.error.message || parsed.error.code || `HTTP ${status}`,
      status,
      (parsed.error.code as PricingQuoteErrorCode) || 'UNKNOWN',
      parsed.error.details ?? {},
      Boolean(parsed.error.retryable)
    );
  }
  throw new PricingQuoteClientError(
    `Backend returned HTTP ${status} without a recognized envelope.`,
    status,
    'UNKNOWN'
  );
}
