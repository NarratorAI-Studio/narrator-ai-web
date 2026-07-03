/**
 * BFF route tests for the admin pricing-catalog endpoints (the implementation requirement).
 *
 * Strategy: spy on the backend client and exercise route handlers with
 * NextRequest directly. The 3 routes are thin pass-throughs (BFF doesn't
 * re-validate) so tests focus on auth, error envelope mapping, and body
 * forwarding.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import * as catalogClient from '@/lib/pricing-catalog-backend-client';

const APP_KEY = 'grid_AbCdEfGhIjKlMnOpQrStUv';

function buildGet(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost:5000${path}`, { method: 'GET', headers });
}

function buildPut(
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): NextRequest {
  return new NextRequest(`http://localhost:5000${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('GET /api/admin/pricing-catalog/[templateId]/tiers', () => {
  let spy: ReturnType<typeof vi.spyOn>;
  afterEach(() => spy?.mockRestore());

  it('forwards templateId to the backend client', async () => {
    spy = vi
      .spyOn(catalogClient, 'fetchCatalogTiers')
      .mockResolvedValue({ data: { template_id: 'T-1', tiers: [] } });

    const { GET } = await import(
      '@/app/api/admin/pricing-catalog/[templateId]/tiers/route'
    );
    const res = await GET(
      buildGet('/api/admin/pricing-catalog/T-1/tiers', { 'x-app-key': APP_KEY }),
      { params: Promise.resolve({ templateId: 'T-1' }) }
    );
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(APP_KEY, 'T-1');
  });

  it('returns 401 when x-app-key missing', async () => {
    spy = vi.spyOn(catalogClient, 'fetchCatalogTiers').mockResolvedValue({});
    const { GET } = await import(
      '@/app/api/admin/pricing-catalog/[templateId]/tiers/route'
    );
    const res = await GET(
      buildGet('/api/admin/pricing-catalog/T-1/tiers'),
      { params: Promise.resolve({ templateId: 'T-1' }) }
    );
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it('maps CatalogClientError status + code onto the BFF response', async () => {
    spy = vi
      .spyOn(catalogClient, 'fetchCatalogTiers')
      .mockRejectedValueOnce(
        new catalogClient.CatalogClientError(
          'missing',
          404,
          'CATALOG_TIER_MISSING',
          { template_id: 'T-1' }
        )
      );

    const { GET } = await import(
      '@/app/api/admin/pricing-catalog/[templateId]/tiers/route'
    );
    const res = await GET(
      buildGet('/api/admin/pricing-catalog/T-1/tiers', { 'x-app-key': APP_KEY }),
      { params: Promise.resolve({ templateId: 'T-1' }) }
    );
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.code).toBe('CATALOG_TIER_MISSING');
    expect(json.details).toEqual({ template_id: 'T-1' });
  });
});

describe('PUT /api/admin/pricing-catalog/[templateId]/tiers', () => {
  let spy: ReturnType<typeof vi.spyOn>;
  afterEach(() => spy?.mockRestore());

  it('forwards body { tiers: [...] } verbatim', async () => {
    spy = vi
      .spyOn(catalogClient, 'upsertCatalogTiers')
      .mockResolvedValue({ data: { tiers: [] } });

    const { PUT } = await import(
      '@/app/api/admin/pricing-catalog/[templateId]/tiers/route'
    );
    const body = {
      tiers: [{ tier_code: 'original_narration_flash', manual_price: 800 }],
    };
    const res = await PUT(
      buildPut('/api/admin/pricing-catalog/T-2/tiers', body, {
        'x-app-key': APP_KEY,
      }),
      { params: Promise.resolve({ templateId: 'T-2' }) }
    );
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(APP_KEY, 'T-2', body);
  });

  it('returns 400 when body is missing tiers array', async () => {
    spy = vi.spyOn(catalogClient, 'upsertCatalogTiers').mockResolvedValue({});
    const { PUT } = await import(
      '@/app/api/admin/pricing-catalog/[templateId]/tiers/route'
    );
    const res = await PUT(
      buildPut(
        '/api/admin/pricing-catalog/T-3/tiers',
        { wrong: 'shape' },
        { 'x-app-key': APP_KEY }
      ),
      { params: Promise.resolve({ templateId: 'T-3' }) }
    );
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('forwards 422 backend invariant violations', async () => {
    spy = vi
      .spyOn(catalogClient, 'upsertCatalogTiers')
      .mockRejectedValueOnce(
        new catalogClient.CatalogClientError(
          'Pro < Flash',
          422,
          'CATALOG_PRO_BELOW_FLASH',
          { flash_manual_price: 800, pro_manual_price: 700 }
        )
      );

    const { PUT } = await import(
      '@/app/api/admin/pricing-catalog/[templateId]/tiers/route'
    );
    const res = await PUT(
      buildPut(
        '/api/admin/pricing-catalog/T-4/tiers',
        { tiers: [] },
        { 'x-app-key': APP_KEY }
      ),
      { params: Promise.resolve({ templateId: 'T-4' }) }
    );
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.code).toBe('CATALOG_PRO_BELOW_FLASH');
  });
});

describe('GET /api/admin/pricing-catalog/[templateId]/history', () => {
  let spy: ReturnType<typeof vi.spyOn>;
  afterEach(() => spy?.mockRestore());

  it('forwards templateId to history client', async () => {
    spy = vi
      .spyOn(catalogClient, 'fetchCatalogHistory')
      .mockResolvedValue({ data: { template_id: 'T-5', tiers: {} } });

    const { GET } = await import(
      '@/app/api/admin/pricing-catalog/[templateId]/history/route'
    );
    const res = await GET(
      buildGet('/api/admin/pricing-catalog/T-5/history', {
        'x-app-key': APP_KEY,
      }),
      { params: Promise.resolve({ templateId: 'T-5' }) }
    );
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(APP_KEY, 'T-5');
  });

  it('returns 401 when x-app-key missing', async () => {
    spy = vi.spyOn(catalogClient, 'fetchCatalogHistory').mockResolvedValue({});
    const { GET } = await import(
      '@/app/api/admin/pricing-catalog/[templateId]/history/route'
    );
    const res = await GET(
      buildGet('/api/admin/pricing-catalog/T-5/history'),
      { params: Promise.resolve({ templateId: 'T-5' }) }
    );
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });
});
