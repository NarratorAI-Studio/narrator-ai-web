/**
 * Route-level tests for the narrator-metadata BFF routes (review).
 *
 * Strategy: spy on `fetchNarratorMetadata` (the backend client) and
 * invoke each route's GET handler directly. The point is to lock in
 * the legacy page=1&size=50 defaults on the paginated routes
 * (bgm-list / dubbing-list) — without these, the home page request
 * with no query string would send `page=undefined&size=undefined` to
 * backend and silently truncate the UI dropdowns (review
 * review).
 *
 * Adapter-level coverage (Bearer / X-Web-App-Key / error mapping)
 * lives in `narrator-metadata-backend-client.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import * as backendClient from '@/lib/narrator-metadata-backend-client';

const APP_KEY = 'grid_AbCdEfGhIjKlMnOpQrStUv';

function buildRequest(
  path: string,
  headers: Record<string, string> = {}
): NextRequest {
  return new NextRequest(`http://localhost:5000${path}`, {
    method: 'GET',
    headers,
  });
}

describe('GET /api/narrator/bgm-list (BFF)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(backendClient, 'fetchNarratorMetadata')
      .mockResolvedValue({ data: { items: [] } });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('forwards page=1&size=50 to backend when no query supplied', async () => {
    const { GET } = await import('@/app/api/narrator/bgm-list/route');
    const res = await GET(
      buildRequest('/api/narrator/bgm-list', { 'x-app-key': APP_KEY })
    );

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [appKey, path, params] = fetchSpy.mock.calls[0];
    expect(appKey).toBe(APP_KEY);
    expect(path).toBe('/narrator/bgm-list');
    expect(params).toEqual({ page: '1', size: '50' });
  });

  it('honors caller-supplied page/size over the default', async () => {
    const { GET } = await import('@/app/api/narrator/bgm-list/route');
    await GET(
      buildRequest('/api/narrator/bgm-list?page=3&size=20', {
        'x-app-key': APP_KEY,
      })
    );

    const [, , params] = fetchSpy.mock.calls[0];
    expect(params).toEqual({ page: '3', size: '20' });
  });

  it('concatenates default pages and filters placeholder BGM rows', async () => {
    const firstPage = Array.from({ length: 50 }, (_, idx) => ({
      id: idx + 1,
      bgm_file_id: `bgm-${idx + 1}`,
      name: `BGM ${idx + 1}`,
    }));
    const secondPage = Array.from({ length: 50 }, (_, idx) => ({
      id: idx + 51,
      bgm_file_id: `bgm-${idx + 51}`,
      name: `BGM ${idx + 51}`,
    }));
    const thirdPage = [
      ...Array.from({ length: 46 }, (_, idx) => ({
        id: idx + 101,
        bgm_file_id: `bgm-${idx + 101}`,
        name: `BGM ${idx + 101}`,
      })),
      { id: 147, bgm_file_id: 'else', name: '自定义' },
    ];
    fetchSpy
      .mockResolvedValueOnce({ data: { items: firstPage, total: 147 } })
      .mockResolvedValueOnce({ data: { items: secondPage, total: 147 } })
      .mockResolvedValueOnce({ data: { items: thirdPage, total: 147 } })
      .mockResolvedValueOnce({ data: { items: [], total: 147 } });

    const { GET } = await import('@/app/api/narrator/bgm-list/route');
    const res = await GET(
      buildRequest('/api/narrator/bgm-list', { 'x-app-key': APP_KEY })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.total).toBe(146);
    expect(body.data.items).toHaveLength(146);
    expect(body.data.items.map((item: { bgm_file_id: string }) => item.bgm_file_id))
      .not.toContain('else');
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(fetchSpy.mock.calls[0][2]).toEqual({ page: '1', size: '50' });
    expect(fetchSpy.mock.calls[1][2]).toEqual({ page: '2', size: '50' });
    expect(fetchSpy.mock.calls[2][2]).toEqual({ page: '3', size: '50' });
    expect(fetchSpy.mock.calls[3][2]).toEqual({ page: '4', size: '50' });
  });

  it('filters placeholder BGM rows from explicit pages', async () => {
    fetchSpy.mockResolvedValueOnce({
      data: {
        items: [
          { id: 1, bgm_file_id: 'bgm-1', name: 'BGM 1' },
          { id: 2, bgm_file_id: 'else', name: '自定义' },
        ],
        total: 2,
      },
    });

    const { GET } = await import('@/app/api/narrator/bgm-list/route');
    const res = await GET(
      buildRequest('/api/narrator/bgm-list?page=3&size=50', {
        'x-app-key': APP_KEY,
      })
    );
    const body = await res.json();

    expect(body.data.items).toEqual([
      { id: 1, bgm_file_id: 'bgm-1', name: 'BGM 1' },
    ]);
    expect(body.data.total).toBe(2);
  });

  it('returns 401 when x-app-key is missing', async () => {
    const { GET } = await import('@/app/api/narrator/bgm-list/route');
    const res = await GET(buildRequest('/api/narrator/bgm-list'));
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('GET /api/narrator/dubbing-list (BFF)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(backendClient, 'fetchNarratorMetadata')
      .mockResolvedValue({ data: { items: [] } });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('forwards page=1&size=50 to backend when no query supplied', async () => {
    const { GET } = await import('@/app/api/narrator/dubbing-list/route');
    const res = await GET(
      buildRequest('/api/narrator/dubbing-list', { 'x-app-key': APP_KEY })
    );

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [appKey, path, params] = fetchSpy.mock.calls[0];
    expect(appKey).toBe(APP_KEY);
    expect(path).toBe('/narrator/dubbing-list');
    expect(params).toEqual({ page: '1', size: '50' });
  });

  it('honors caller-supplied page/size over the default', async () => {
    const { GET } = await import('@/app/api/narrator/dubbing-list/route');
    await GET(
      buildRequest('/api/narrator/dubbing-list?page=2&size=25', {
        'x-app-key': APP_KEY,
      })
    );

    const [, , params] = fetchSpy.mock.calls[0];
    expect(params).toEqual({ page: '2', size: '25' });
  });

  it('concatenates default pages until items reach total', async () => {
    const firstPage = Array.from({ length: 50 }, (_, idx) => ({
      id: idx + 1,
      dubbing_id: `voice-${idx + 1}`,
    }));
    const secondPage = Array.from({ length: 14 }, (_, idx) => ({
      id: idx + 51,
      dubbing_id: `voice-${idx + 51}`,
    }));
    fetchSpy
      .mockResolvedValueOnce({ data: { items: firstPage, total: 64 } })
      .mockResolvedValueOnce({ data: { items: secondPage, total: 64 } });

    const { GET } = await import('@/app/api/narrator/dubbing-list/route');
    const res = await GET(
      buildRequest('/api/narrator/dubbing-list', { 'x-app-key': APP_KEY })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.total).toBe(64);
    expect(body.data.items).toHaveLength(64);
    expect(body.data.items[0].dubbing_id).toBe('voice-1');
    expect(body.data.items[63].dubbing_id).toBe('voice-64');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][2]).toEqual({ page: '1', size: '50' });
    expect(fetchSpy.mock.calls[1][2]).toEqual({ page: '2', size: '50' });
  });

  it('filters placeholder dubbing rows and syncs default total', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        data: {
          items: [
            { id: 1, dubbing_id: 'voice-1', name: 'Voice 1' },
            { id: 2, dubbing_id: 'else', name: '自定义' },
          ],
          total: 2,
        },
      })
      .mockResolvedValueOnce({ data: { items: [], total: 2 } });

    const { GET } = await import('@/app/api/narrator/dubbing-list/route');
    const res = await GET(
      buildRequest('/api/narrator/dubbing-list', { 'x-app-key': APP_KEY })
    );
    const body = await res.json();

    expect(body.data.items).toEqual([
      { id: 1, dubbing_id: 'voice-1', name: 'Voice 1' },
    ]);
    expect(body.data.total).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('filters placeholder dubbing rows from explicit pages', async () => {
    fetchSpy.mockResolvedValueOnce({
      data: {
        items: [
          { id: 1, dubbing_id: 'voice-1', name: 'Voice 1' },
          { id: 2, dubbing_id: 'else', name: '自定义' },
        ],
        total: 2,
      },
    });

    const { GET } = await import('@/app/api/narrator/dubbing-list/route');
    const res = await GET(
      buildRequest('/api/narrator/dubbing-list?page=2&size=50', {
        'x-app-key': APP_KEY,
      })
    );
    const body = await res.json();

    expect(body.data.items).toEqual([
      { id: 1, dubbing_id: 'voice-1', name: 'Voice 1' },
    ]);
    expect(body.data.total).toBe(2);
  });

  it('returns 401 when x-app-key is missing', async () => {
    const { GET } = await import('@/app/api/narrator/dubbing-list/route');
    const res = await GET(buildRequest('/api/narrator/dubbing-list'));
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('GET /api/narrator/template-list (BFF)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it('uses size=21 by default and caches repeated requests', async () => {
    fetchSpy = vi
      .spyOn(backendClient, 'fetchNarratorMetadata')
      .mockResolvedValue({ data: { items: [], total: 0 } });

    const { GET } = await import('@/app/api/narrator/template-list/route');
    const req = buildRequest('/api/narrator/template-list?page=1', {
      'x-app-key': APP_KEY,
    });
    const first = await GET(req);
    const second = await GET(req);

    expect(first.status).toBe(200);
    expect(first.headers.get('X-BFF-Cache')).toBe('MISS');
    expect(second.headers.get('X-BFF-Cache')).toBe('HIT');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [appKey, path, params] = fetchSpy.mock.calls[0];
    expect(appKey).toBe(APP_KEY);
    expect(path).toBe('/pricing/movie-baokuan');
    expect(params).toEqual({
      platform_id: undefined,
      category_id: undefined,
      name: undefined,
      page: '1',
      size: '21',
    });
  });
});
