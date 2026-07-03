/**
 * Tests for the pricing-quote v2 backend HTTP client (regression coverage / Backend API contract).
 * Mirrors `pricing-catalog-backend-client.test.ts`: stub fetch, assert
 * request shape + envelope unwrap + error envelope mapping.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  generatePricingQuote,
  PricingQuoteClientError,
} from '@/lib/pricing-quote-backend-client';

const APP_KEY = 'grid_AAAAAAAAAAAAAAAAAAAAAA';
const BEARER = 'test-bff-token-abcdef';
const ORIGINAL_FETCH = globalThis.fetch;

function mockFetchOnce(status: number, body: unknown) {
  const spy = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

const QUOTE_DATA = {
  quote_id: 'Q-2026-05-30-abcdef0123',
  pricing_rule_version: 'v2.0',
  price_source: 'manual_catalog_price' as const,
  template_id: 'tpl_001',
  custom_template_id: null,
  combo_key: 'original_narration_flash',
  starting_price: 100,
  final_charge_price: 100,
  flash_total: 100,
  pro_total: 140,
  pro_upgrade_delta: 40,
  pricing_minutes: 1,
  valid_line_count: null,
  breakdown: [
    {
      subflow_key: 'narration',
      display_label: '解说生成',
      pricing_minutes: 1,
      unit_price: 100,
      subtotal: 100,
    },
  ],
  expires_at: '2099-01-01T00:00:00Z',
  currency_unit: 'web_point' as const,
};

describe('generatePricingQuote', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubEnv('PRICING_BFF_AUTH_TOKEN', BEARER);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it('POSTs to /pricing/quote with Bearer + X-Web-App-Key + JSON body', async () => {
    const spy = mockFetchOnce(200, { success: true, data: QUOTE_DATA });
    await generatePricingQuote(APP_KEY, {
      template_id: 'tpl_001',
      combo_key: 'original_narration_flash',
    });
    const [url, init] = spy.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toMatch(/\/pricing\/quote$/);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${BEARER}`);
    expect(headers['X-Web-App-Key']).toBe(APP_KEY);
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      template_id: 'tpl_001',
      combo_key: 'original_narration_flash',
    });
  });

  it('unwraps the success envelope and returns data', async () => {
    mockFetchOnce(200, { success: true, data: QUOTE_DATA });
    const result = await generatePricingQuote(APP_KEY, {
      template_id: 'tpl_001',
      combo_key: 'original_narration_flash',
    });
    expect(result.quote_id).toBe(QUOTE_DATA.quote_id);
    expect(result.final_charge_price).toBe(100);
  });

  it('throws PricingQuoteClientError with WALLET_INSUFFICIENT_BALANCE on 402', async () => {
    mockFetchOnce(402, {
      success: false,
      error: {
        code: 'WALLET_INSUFFICIENT_BALANCE',
        message: 'Wallet balance is below the required final charge price.',
        retryable: false,
        details: { required: 100, available: 50, shortfall: 50 },
      },
    });
    await expect(
      generatePricingQuote(APP_KEY, {
        template_id: 'tpl_001',
        combo_key: 'original_narration_flash',
      })
    ).rejects.toMatchObject({
      name: 'PricingQuoteClientError',
      code: 'WALLET_INSUFFICIENT_BALANCE',
      status: 402,
      details: { required: 100, available: 50, shortfall: 50 },
    });
  });

  it('maps 404 CATALOG_TIER_MISSING to PricingQuoteClientError', async () => {
    mockFetchOnce(404, {
      success: false,
      error: {
        code: 'CATALOG_TIER_MISSING',
        message: 'No catalog entry for this template.',
        retryable: false,
        details: { template_id: 'tpl_unknown' },
      },
    });
    await expect(
      generatePricingQuote(APP_KEY, {
        template_id: 'tpl_unknown',
        combo_key: 'original_narration_flash',
      })
    ).rejects.toMatchObject({ code: 'CATALOG_TIER_MISSING', status: 404 });
  });

  it('marks 503 QUOTE_PERSISTENCE_ERROR as retryable', async () => {
    mockFetchOnce(503, {
      success: false,
      error: {
        code: 'QUOTE_PERSISTENCE_ERROR',
        message: 'The pricing backend is temporarily unavailable.',
        retryable: true,
        details: {},
      },
    });
    await expect(
      generatePricingQuote(APP_KEY, {
        template_id: 'tpl_001',
        combo_key: 'original_narration_flash',
      })
    ).rejects.toMatchObject({
      code: 'QUOTE_PERSISTENCE_ERROR',
      retryable: true,
    });
  });

  it('throws BFF_AUTH_TOKEN_MISSING when env unset', async () => {
    vi.stubEnv('PRICING_BFF_AUTH_TOKEN', '');
    await expect(
      generatePricingQuote(APP_KEY, {
        template_id: 'tpl_001',
        combo_key: 'original_narration_flash',
      })
    ).rejects.toMatchObject({ code: 'BFF_AUTH_TOKEN_MISSING', status: 503 });
  });

  it('throws BFF_UPSTREAM_UNREACHABLE on network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      })
    );
    await expect(
      generatePricingQuote(APP_KEY, {
        template_id: 'tpl_001',
        combo_key: 'original_narration_flash',
      })
    ).rejects.toMatchObject({
      code: 'BFF_UPSTREAM_UNREACHABLE',
      status: 502,
      retryable: true,
    });
  });

  it('throws BFF_INVALID_JSON when 2xx body shape is wrong', async () => {
    mockFetchOnce(200, { unexpected: 'shape' });
    await expect(
      generatePricingQuote(APP_KEY, {
        template_id: 'tpl_001',
        combo_key: 'original_narration_flash',
      })
    ).rejects.toMatchObject({ code: 'BFF_INVALID_JSON', status: 502 });
  });

  it('exports the error class for callers to instanceof-check', () => {
    expect(typeof PricingQuoteClientError).toBe('function');
  });
});
