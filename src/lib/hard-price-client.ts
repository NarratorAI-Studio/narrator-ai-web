/**
 * Hard-price API client — calls the pricing service over HTTP.
 *
 * Architecture (layered, SOC):
 *   narrator-ai-web (BFF, Next.js)
 *     ↓ HTTP only (no direct DB connection)
 *   narrator-ai-web-backend (Fly.io, FastAPI)
 *     ↓
 *   Fly Postgres (narrator-pricing-db)
 *
 * Invariant: this module MUST NOT import any DB driver
 * (`pg`, `mysql2`, `drizzle-orm`, etc.). The web layer talks to
 * services over HTTP only — see docs/architecture.md.
 */
import type { HardPriceDetail, SrtRealtimeQuoteResponse } from './hard-price-utils';

function getPricingApiUrl(): string {
  const url = process.env.NARRATOR_PRICING_API_URL;
  if (!url) {
    throw new Error(
      'NARRATOR_PRICING_API_URL environment variable is required. Set it in .env.local (local dev) or fly secrets (deploy).'
    );
  }
  return url;
}

const MOCK_ENABLED =
  process.env.NODE_ENV !== 'production' &&
  process.env.HARD_PRICE_MOCK === 'true';

const MOCK_TIERS: Array<{ combo_key: string; hard_price: number; text_chars: number; text_lines: number; billing_duration_minutes: number }> = [
  { combo_key: 'original_narration_flash', hard_price: 50.00, text_chars: 800, text_lines: 40, billing_duration_minutes: 5.0 },
  { combo_key: 'original_narration_pro',   hard_price: 84.50, text_chars: 800, text_lines: 40, billing_duration_minutes: 5.0 },
  { combo_key: 'original_remix_flash',     hard_price: 60.00, text_chars: 800, text_lines: 40, billing_duration_minutes: 5.0 },
  { combo_key: 'original_remix_pro',       hard_price: 100.00, text_chars: 800, text_lines: 40, billing_duration_minutes: 5.0 },
  { combo_key: 'secondary_creation',       hard_price: 45.00, text_chars: 800, text_lines: 40, billing_duration_minutes: 5.0 },
];

const DEFAULT_TIMEOUT_MS = 60_000;

export class HardPriceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'HardPriceApiError';
  }
}

async function withPricingApiTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new HardPriceApiError(
        'Pricing API request timed out.',
        504,
        'BFF_UPSTREAM_TIMEOUT',
        true,
      );
    }
    throw error;
  } finally {
    clearTimeout(tid);
  }
}

/**
 * Query a single hard price by template_id + combo_key.
 */
export async function queryHardPriceFromAPI(
  templateId: number,
  comboKey: string
): Promise<HardPriceDetail | null> {
  if (MOCK_ENABLED) {
    const tier = MOCK_TIERS.find(t => t.combo_key === comboKey);
    if (!tier) return null;
    return { template_id: templateId, pricing_rule_version: 1, ...tier };
  }
  return withPricingApiTimeout(async signal => {
    const res = await fetch(`${getPricingApiUrl()}/pricing/hard-price`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_id: templateId, combo_key: comboKey }),
      signal,
    });

    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Pricing API error: ${res.status}`);

    const json = await res.json();
    const d = json.data;
    return { ...d, hard_price: parseFloat(d.hard_price) } as HardPriceDetail;
  });
}

/**
 * Query all 5 hard price tiers for a template.
 */
export async function queryAllHardPricesFromAPI(
  templateId: number
): Promise<HardPriceDetail[]> {
  if (MOCK_ENABLED) {
    return MOCK_TIERS.map(t => ({ template_id: templateId, pricing_rule_version: 1, ...t }));
  }
  return withPricingApiTimeout(async signal => {
    const res = await fetch(
      `${getPricingApiUrl()}/pricing/hard-price/all?template_id=${templateId}`,
      { signal },
    );

    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`Pricing API error: ${res.status}`);

    const json = await res.json();
    return (json.data?.prices ?? []).map((d: any) => ({ ...d, hard_price: parseFloat(d.hard_price) })) as HardPriceDetail[];
  });
}

/**
 * Get a realtime SRT-based price quote for a custom-template order.
 * Accepts either raw SRT text or pre-parsed metrics.
 */
export async function querySrtRealtimeQuoteFromAPI(
  comboKey: string,
  srtPayload: string,
): Promise<SrtRealtimeQuoteResponse> {
  return withPricingApiTimeout(async signal => {
    const res = await fetch(`${getPricingApiUrl()}/pricing/srt-realtime-quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ combo_key: comboKey, srt_payload: srtPayload }),
      signal,
    });

    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      const code = json?.error?.code ?? `HTTP_${res.status}`;
      const msg  = json?.error?.message ?? `Pricing API error: ${res.status}`;
      throw new HardPriceApiError(msg, res.status, code, res.status === 503);
    }

    const json = await res.json();
    return json.data as SrtRealtimeQuoteResponse;
  });
}
