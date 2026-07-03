/**
 * BFF route tests for the hard-price v2 quote endpoint .
 * Strategy mirrors `pricing-catalog-bff.test.ts`: spy on the backend
 * client; exercise route with NextRequest. Validates auth gate, body
 * shape gate, and error envelope mapping.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import * as quoteClient from '@/lib/pricing-quote-backend-client';

const APP_KEY = 'grid_AbCdEfGhIjKlMnOpQrStUv';

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

function buildPost(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost:5000/api/narrator/pricing/quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/narrator/pricing/quote', () => {
  let spy: ReturnType<typeof vi.spyOn>;
  afterEach(() => spy?.mockRestore());

  it('forwards body to generatePricingQuote and returns success envelope', async () => {
    spy = vi
      .spyOn(quoteClient, 'generatePricingQuote')
      .mockResolvedValue(QUOTE_DATA);

    const { POST } = await import('@/app/api/narrator/pricing/quote/route');
    const req = buildPost(
      { template_id: 'tpl_001', combo_key: 'original_narration_flash' },
      { 'x-app-key': APP_KEY }
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.quote_id).toBe(QUOTE_DATA.quote_id);
    expect(spy).toHaveBeenCalledWith(APP_KEY, {
      template_id: 'tpl_001',
      combo_key: 'original_narration_flash',
    });
  });

  it('forwards custom_srt_file_id without injecting hash or count', async () => {
    // Web API contract / Backend API contract: client must NOT supply
    // custom_srt_file_hash or custom_srt_valid_line_count. The BFF
    // is a thin pass-through, so we assert the body it forwards to
    // the backend client is exactly what the client sent.
    spy = vi
      .spyOn(quoteClient, 'generatePricingQuote')
      .mockResolvedValue({
        ...QUOTE_DATA,
        custom_template_id: 'ct_default',
        template_id: null,
        price_source: 'system_calculated_price',
        valid_line_count: 50,
      });

    const { POST } = await import('@/app/api/narrator/pricing/quote/route');
    const req = buildPost(
      {
        custom_template_id: 'ct_default',
        combo_key: 'original_narration_flash',
        custom_srt_file_id: 'cf_user_srt_001',
      },
      { 'x-app-key': APP_KEY }
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(APP_KEY, {
      custom_template_id: 'ct_default',
      combo_key: 'original_narration_flash',
      custom_srt_file_id: 'cf_user_srt_001',
    });
    // Guard against accidental injection of the deprecated client
    // fields by either the BFF route or test fixtures.
    const forwardedBody = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(forwardedBody).not.toHaveProperty('custom_srt_file_hash');
    expect(forwardedBody).not.toHaveProperty('custom_srt_valid_line_count');
  });

  it('returns 401 when x-app-key missing', async () => {
    spy = vi
      .spyOn(quoteClient, 'generatePricingQuote')
      .mockResolvedValue(QUOTE_DATA);
    const { POST } = await import('@/app/api/narrator/pricing/quote/route');
    const req = buildPost({
      template_id: 'tpl_001',
      combo_key: 'original_narration_flash',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error.code).toBe('UNAUTHORIZED');
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns 400 when body has no combo_key', async () => {
    spy = vi
      .spyOn(quoteClient, 'generatePricingQuote')
      .mockResolvedValue(QUOTE_DATA);
    const { POST } = await import('@/app/api/narrator/pricing/quote/route');
    const req = buildPost({ template_id: 'tpl_001' }, { 'x-app-key': APP_KEY });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('BAD_REQUEST');
    expect(spy).not.toHaveBeenCalled();
  });

  it('maps PricingQuoteClientError onto the response', async () => {
    spy = vi
      .spyOn(quoteClient, 'generatePricingQuote')
      .mockRejectedValueOnce(
        new quoteClient.PricingQuoteClientError(
          '余额不足',
          402,
          'WALLET_INSUFFICIENT_BALANCE',
          { required: 100, available: 50, shortfall: 50 }
        )
      );

    const { POST } = await import('@/app/api/narrator/pricing/quote/route');
    const req = buildPost(
      { template_id: 'tpl_001', combo_key: 'original_narration_flash' },
      { 'x-app-key': APP_KEY }
    );
    const res = await POST(req);
    expect(res.status).toBe(402);
    const json = await res.json();
    expect(json.error.code).toBe('WALLET_INSUFFICIENT_BALANCE');
    expect(json.error.details).toEqual({
      required: 100,
      available: 50,
      shortfall: 50,
    });
  });

  it('maps 410 QUOTE_EXPIRED with retryable=false', async () => {
    spy = vi
      .spyOn(quoteClient, 'generatePricingQuote')
      .mockRejectedValueOnce(
        new quoteClient.PricingQuoteClientError(
          'expired',
          410,
          'QUOTE_VALIDATION_ERROR',
          { quote_id: 'Q-x' },
          false
        )
      );

    const { POST } = await import('@/app/api/narrator/pricing/quote/route');
    const req = buildPost(
      { template_id: 'tpl_001', combo_key: 'original_narration_flash' },
      { 'x-app-key': APP_KEY }
    );
    const res = await POST(req);
    expect(res.status).toBe(410);
    const json = await res.json();
    expect(json.error.retryable).toBe(false);
  });

  it('returns 500 with UNKNOWN code for non-Client errors', async () => {
    spy = vi
      .spyOn(quoteClient, 'generatePricingQuote')
      .mockRejectedValueOnce(new Error('boom'));

    const { POST } = await import('@/app/api/narrator/pricing/quote/route');
    const req = buildPost(
      { template_id: 'tpl_001', combo_key: 'original_narration_flash' },
      { 'x-app-key': APP_KEY }
    );
    const res = await POST(req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error.code).toBe('UNKNOWN');
  });

  it('returns 400 on malformed JSON', async () => {
    spy = vi
      .spyOn(quoteClient, 'generatePricingQuote')
      .mockResolvedValue(QUOTE_DATA);

    const { POST } = await import('@/app/api/narrator/pricing/quote/route');
    const req = new NextRequest(
      'http://localhost:5000/api/narrator/pricing/quote',
      {
        method: 'POST',
        headers: { 'x-app-key': APP_KEY, 'content-type': 'application/json' },
        body: 'not-json',
      }
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });
});
