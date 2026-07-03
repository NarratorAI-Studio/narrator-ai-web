/**
 * Tests for the pricing-catalog backend HTTP client (the implementation requirement / Backend API contract).
 *
 * Mirrors `narrator-proxy-backend-client.test.ts` — stub fetch and assert
 * request shape, status mapping, and the BFF_AUTH / UPSTREAM error paths.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CatalogClientError,
  fetchCatalogTiers,
  fetchCatalogHistory,
  upsertCatalogTiers,
} from '@/lib/pricing-catalog-backend-client';

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

describe('pricing-catalog-backend-client', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubEnv('PRICING_BFF_AUTH_TOKEN', BEARER);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it('fetchCatalogTiers sends GET with Bearer + X-Web-App-Key', async () => {
    const spy = mockFetchOnce(200, { data: { template_id: 'T-1' } });
    await fetchCatalogTiers(APP_KEY, 'T-1');
    const [url, init] = spy.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toMatch(/\/pricing\/catalog\/T-1\/tiers$/);
    expect(init.method).toBe('GET');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${BEARER}`);
    expect(headers['X-Web-App-Key']).toBe(APP_KEY);
  });

  it('upsertCatalogTiers sends PUT with JSON body', async () => {
    const spy = mockFetchOnce(200, { data: { tiers: [] } });
    const body = {
      tiers: [
        { tier_code: 'original_narration_flash', manual_price: 800 },
      ],
    };
    await upsertCatalogTiers(APP_KEY, 'T-1', body);
    const [, init] = spy.mock.calls[0] as [URL, RequestInit];
    expect(init.method).toBe('PUT');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it('fetchCatalogHistory sends GET to /history', async () => {
    const spy = mockFetchOnce(200, { data: { template_id: 'T-1', tiers: {} } });
    await fetchCatalogHistory(APP_KEY, 'T-1');
    const [url] = spy.mock.calls[0] as [URL];
    expect(String(url)).toMatch(/\/pricing\/catalog\/T-1\/history$/);
  });

  it('URL-encodes path arg defensively', async () => {
    const spy = mockFetchOnce(200, {});
    await fetchCatalogTiers(APP_KEY, 'T-1/edge?case');
    const [url] = spy.mock.calls[0] as [URL];
    // No raw `?` or `/` after the templateId segment.
    expect(String(url)).toContain('T-1%2Fedge%3Fcase');
  });

  it('maps backend 422 envelope to CatalogClientError with code + details', async () => {
    mockFetchOnce(422, {
      success: false,
      error: {
        code: 'CATALOG_PRO_BELOW_FLASH',
        message: 'Pro tier manual_price must be >= Flash.',
        retryable: false,
        details: {
          flash_manual_price: 800,
          pro_manual_price: 700,
        },
      },
    });

    try {
      await upsertCatalogTiers(APP_KEY, 'T-1', { tiers: [] });
      throw new Error('expected CatalogClientError');
    } catch (e) {
      expect(e).toBeInstanceOf(CatalogClientError);
      expect((e as CatalogClientError).status).toBe(422);
      expect((e as CatalogClientError).code).toBe('CATALOG_PRO_BELOW_FLASH');
      expect((e as CatalogClientError).details.flash_manual_price).toBe(800);
    }
  });

  it('throws BFF_AUTH_TOKEN_MISSING (503) without calling fetch when env unset', async () => {
    vi.unstubAllEnvs();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    try {
      await fetchCatalogTiers(APP_KEY, 'T-1');
      throw new Error('expected CatalogClientError');
    } catch (e) {
      expect((e as CatalogClientError).code).toBe('BFF_AUTH_TOKEN_MISSING');
      expect((e as CatalogClientError).status).toBe(503);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps network failure to BFF_UPSTREAM_UNREACHABLE (502)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      })
    );
    try {
      await fetchCatalogTiers(APP_KEY, 'T-1');
      throw new Error('expected error');
    } catch (e) {
      expect((e as CatalogClientError).code).toBe('BFF_UPSTREAM_UNREACHABLE');
      expect((e as CatalogClientError).status).toBe(502);
    }
  });

  it('maps abort to BFF_UPSTREAM_TIMEOUT (504)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      })
    );
    try {
      await fetchCatalogTiers(APP_KEY, 'T-1');
      throw new Error('expected error');
    } catch (e) {
      expect((e as CatalogClientError).code).toBe('BFF_UPSTREAM_TIMEOUT');
      expect((e as CatalogClientError).status).toBe(504);
    }
  });

  it('throws BFF_INVALID_JSON on non-JSON 2xx body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        },
      }))
    );
    try {
      await fetchCatalogTiers(APP_KEY, 'T-1');
      throw new Error('expected error');
    } catch (e) {
      expect((e as CatalogClientError).code).toBe('BFF_INVALID_JSON');
    }
  });
});
