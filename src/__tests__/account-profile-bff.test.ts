/**
 * Tests for the /api/account/profile BFF route (issue Backend API contract).
 *
 * Strategy: mock the upstream fetch via vi.stubGlobal('fetch', ...) and
 * exercise the route handler directly with a NextRequest. Verifies:
 *   - x-app-key auth boundary (BFF rejects missing header at the edge)
 *   - upstream contract translation (user_id → id rename)
 *   - error normalization (backend's structured `error` → plain string for UI)
 *   - upstream failure → 504/502 envelope from the client lib
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

import { GET } from '@/app/api/account/profile/route';

const ORIGINAL_FETCH = globalThis.fetch;

function buildRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost:5000/api/account/profile', {
    method: 'GET',
    headers,
  });
}

describe('GET /api/account/profile', () => {
  beforeEach(() => {
    // Each test stubs fetch explicitly; default leaves it unset so the BFF
    // doesn't accidentally hit a real network from CI.
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = ORIGINAL_FETCH;
  });

  // ---------- auth boundary ----------

  it('returns 401 when x-app-key header is missing', async () => {
    const res = await GET(buildRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      error: '请先配置 App Key',
      code: 'APP_KEY_MISSING',
    });
  });

  // ---------- happy path ----------

  it('forwards x-app-key as X-Web-App-Key and renames user_id → id', async () => {
    const upstreamBody = {
      success: true,
      data: {
        user_id: 1,
        nickname: 'Demo User',
        mobile: '139*****222',
        email: 'demo@example.com',
        balance: '2340.02',
        company_name: '格子科技',
      },
    };
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => upstreamBody,
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const res = await GET(
      buildRequest({ 'x-app-key': 'grid_uMkHtQoakRfSG2J9DSIZi7' })
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const fetchCall = fetchSpy.mock.calls[0];
    expect(fetchCall[0]).toMatch(/\/account\/me$/);
    expect(fetchCall[1].headers['X-Web-App-Key']).toBe(
      'grid_uMkHtQoakRfSG2J9DSIZi7'
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      data: {
        id: 1, // renamed from user_id
        nickname: 'Demo User',
        mobile: '139*****222',
        email: 'demo@example.com',
        balance: '2340.02',
        company_name: '格子科技',
      },
    });
    expect(body.data).not.toHaveProperty('user_id');
  });

  it('passes null fields through unchanged for unpopulated profile', async () => {
    const upstreamBody = {
      success: true,
      data: {
        user_id: 2,
        nickname: null,
        mobile: null,
        email: null,
        balance: '1000.00',
        company_name: null,
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => upstreamBody,
      }))
    );

    const res = await GET(
      buildRequest({ 'x-app-key': 'grid_NLHSQwxhNgYrrSHGpFB5qZ' })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(2);
    expect(body.data.nickname).toBeNull();
    expect(body.data.balance).toBe('1000.00');
  });

  // ---------- error path: backend rejects ----------

  it('translates WEB_APP_KEY_UNKNOWN into a user-facing Chinese message', async () => {
    const upstreamBody = {
      success: false,
      error: {
        code: 'WEB_APP_KEY_UNKNOWN',
        message: 'X-Web-App-Key is not recognized.',
        retryable: false,
        details: {},
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => upstreamBody,
      }))
    );

    const res = await GET(buildRequest({ 'x-app-key': 'grid_xxxxxxxxxxxxxxxxxxxxxx' }));

    expect(res.status).toBe(401);
    const body = await res.json();
    // English backend code → Chinese UI string. Raw `code` is preserved
    // for devtools / log correlation (page doesn't render it but devs do
    // look at it).
    expect(body).toEqual({
      success: false,
      error: '用户不存在，请检查 App Key 是否正确',
      code: 'WEB_APP_KEY_UNKNOWN',
    });
  });

  it('translates USER_LOOKUP_FAILED and mirrors 503 status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({
          success: false,
          error: {
            code: 'USER_LOOKUP_FAILED',
            message: 'Failed to load user profile.',
            retryable: true,
            details: {},
          },
        }),
      }))
    );

    const res = await GET(buildRequest({ 'x-app-key': 'grid_aaaaaaaaaaaaaaaaaaaaaa' }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('服务暂时不可用，请稍后重试');
    expect(body.code).toBe('USER_LOOKUP_FAILED');
  });

  // ---------- error path: upstream unreachable ----------

  it('returns 502 with a Chinese message when fetch throws (upstream unreachable)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      })
    );

    const res = await GET(buildRequest({ 'x-app-key': 'grid_aaaaaaaaaaaaaaaaaaaaaa' }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('无法连接到后端服务，请稍后重试');
    expect(body.code).toBe('BFF_UPSTREAM_UNREACHABLE');
  });

  it('returns 504 with a Chinese message when fetch aborts (upstream timeout)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        throw e;
      })
    );

    const res = await GET(buildRequest({ 'x-app-key': 'grid_aaaaaaaaaaaaaaaaaaaaaa' }));
    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.error).toBe('后端响应超时，请稍后重试');
    expect(body.code).toBe('BFF_UPSTREAM_TIMEOUT');
  });

  it('falls back to backend message verbatim when code is unknown to the translator', async () => {
    // Defense for forward-compat: backend may add new error codes the
    // BFF hasn't been taught yet — show whatever string backend gave us
    // rather than swallowing it. `code` still flows through.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({
          success: false,
          error: {
            code: 'BRAND_NEW_FUTURE_CODE',
            message: 'something specific went wrong upstream',
            retryable: false,
            details: {},
          },
        }),
      }))
    );

    const res = await GET(buildRequest({ 'x-app-key': 'grid_aaaaaaaaaaaaaaaaaaaaaa' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('something specific went wrong upstream');
    expect(body.code).toBe('BRAND_NEW_FUTURE_CODE');
  });
});
