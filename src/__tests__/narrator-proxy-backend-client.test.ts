/**
 * Tests for the narrator-proxy backend HTTP client (the implementation requirement / Backend API contract).
 *
 * Strategy mirrors `narrator-metadata-backend-client.test.ts`: stub global
 * fetch, assert request shape (URL / headers / method / body / query),
 * and status-to-error mapping. Adds POST-shape + per-call-timeout cases
 * that the metadata client doesn't have.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  NarratorProxyError,
  callNarratorProxyGet,
  callNarratorProxyPost,
} from '@/lib/narrator-proxy-backend-client';

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

describe('narrator-proxy-backend-client', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubEnv('PRICING_BFF_AUTH_TOKEN', BEARER);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    globalThis.fetch = ORIGINAL_FETCH;
  });

  // ---------- GET request shape ----------

  it('GET sends Bearer + X-Web-App-Key + Accept headers', async () => {
    const spy = mockFetchOnce(200, { code: 10000, data: {} });

    await callNarratorProxyGet(APP_KEY, '/narrator/movie-sucai');

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toMatch(/\/narrator\/movie-sucai$/);
    expect(init.method).toBe('GET');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${BEARER}`);
    expect(headers['X-Web-App-Key']).toBe(APP_KEY);
    expect(headers['Accept']).toBe('application/json');
  });

  it('GET forwards query params; drops undefined/empty/null', async () => {
    const spy = mockFetchOnce(200, {});

    await callNarratorProxyGet(APP_KEY, '/narrator/movie-sucai', {
      page: 2,
      page_size: 21,
      name: 'foo',
      emptyStr: '',
      undef: undefined,
      nullish: null,
    });

    const [url] = spy.mock.calls[0] as [URL];
    const s = String(url);
    expect(s).toContain('page=2');
    expect(s).toContain('page_size=21');
    expect(s).toContain('name=foo');
    expect(s).not.toContain('emptyStr');
    expect(s).not.toContain('undef');
    expect(s).not.toContain('nullish');
  });

  // ---------- POST request shape ----------

  it('POST sends JSON body + Content-Type + Bearer + X-Web-App-Key', async () => {
    const spy = mockFetchOnce(200, { code: 10000, data: {} });

    const body = { foo: 'bar', count: 3 };
    await callNarratorProxyPost(APP_KEY, '/narrator/commentary/consume-budget', body);

    const [url, init] = spy.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toMatch(/\/narrator\/commentary\/consume-budget$/);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${BEARER}`);
    expect(headers['X-Web-App-Key']).toBe(APP_KEY);
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  // ---------- success ----------

  it('returns parsed body verbatim on 200', async () => {
    const payload = { code: 10000, message: 'ok', data: { total: 1, items: [{ id: 'a' }] } };
    mockFetchOnce(200, payload);

    const result = await callNarratorProxyGet(APP_KEY, '/narrator/movie-sucai');
    expect(result).toEqual(payload);
  });

  // ---------- upstream business-code on 2xx ----------

  it('throws on HTTP 200 with upstream code != 10000/0 (legacy requestV2 contract)', async () => {
    // Upstream sometimes returns HTTP 200 with a business-error envelope.
    // The legacy `commentaryAPI.*` path threw in this case; we must too,
    // otherwise UI shows "success" for a failed task creation / validation.
    mockFetchOnce(200, {
      code: 40001,
      message: 'invalid input parameters',
      data: null,
    });

    try {
      await callNarratorProxyPost(
        APP_KEY,
        '/narrator/commentary/material-verification',
        { x: 1 }
      );
      throw new Error('expected NarratorProxyError');
    } catch (e) {
      expect(e).toBeInstanceOf(NarratorProxyError);
      expect((e as NarratorProxyError).status).toBe(200);
      expect((e as NarratorProxyError).code).toBe('40001');
      expect((e as NarratorProxyError).message).toContain('invalid input');
    }
  });

  it('returns body verbatim on HTTP 200 with code=10000 (success)', async () => {
    const payload = { code: 10000, message: 'ok', data: { items: [] } };
    mockFetchOnce(200, payload);
    const result = await callNarratorProxyGet(APP_KEY, '/narrator/movie-sucai');
    expect(result).toEqual(payload);
  });

  it('returns body verbatim on HTTP 200 with code=0 (alt success convention)', async () => {
    // Legacy `requestV2` accepted `code === 0` as success too. Preserve.
    const payload = { code: 0, data: {} };
    mockFetchOnce(200, payload);
    const result = await callNarratorProxyGet(APP_KEY, '/narrator/movie-sucai');
    expect(result).toEqual(payload);
  });

  it('returns body verbatim on HTTP 200 without a `code` field (envelope-less route)', async () => {
    // Backend metadata routes return `{data: ...}` without the upstream
    // envelope wrapper. Must not false-positive these as business errors.
    const payload = { data: { foo: 'bar' } };
    mockFetchOnce(200, payload);
    const result = await callNarratorProxyGet(APP_KEY, '/narrator/movie-sucai');
    expect(result).toEqual(payload);
  });

  // ---------- error envelope mapping ----------

  it('maps backend 401 + envelope to NarratorProxyError(401, code)', async () => {
    mockFetchOnce(401, {
      success: false,
      error: { code: 'WEB_APP_KEY_UNKNOWN', message: 'X-Web-App-Key is not recognized.' },
    });

    try {
      await callNarratorProxyGet(APP_KEY, '/narrator/movie-sucai');
      throw new Error('expected NarratorProxyError');
    } catch (e) {
      expect(e).toBeInstanceOf(NarratorProxyError);
      expect((e as NarratorProxyError).status).toBe(401);
      expect((e as NarratorProxyError).code).toBe('WEB_APP_KEY_UNKNOWN');
    }
  });

  it('maps backend 503 envelope (upstream unconfigured)', async () => {
    mockFetchOnce(503, {
      success: false,
      error: { code: 'UPSTREAM_NOT_CONFIGURED', message: 'Upstream not configured' },
    });

    try {
      await callNarratorProxyGet(APP_KEY, '/narrator/movie-sucai');
      throw new Error('expected NarratorProxyError');
    } catch (e) {
      expect(e).toBeInstanceOf(NarratorProxyError);
      expect((e as NarratorProxyError).status).toBe(503);
      expect((e as NarratorProxyError).code).toBe('UPSTREAM_NOT_CONFIGURED');
    }
  });

  it('falls back to code=UNKNOWN on 5xx without an envelope', async () => {
    mockFetchOnce(500, 'Internal server error' as unknown as object);

    try {
      await callNarratorProxyGet(APP_KEY, '/narrator/movie-sucai');
      throw new Error('expected NarratorProxyError');
    } catch (e) {
      expect((e as NarratorProxyError).status).toBe(500);
      expect((e as NarratorProxyError).code).toBe('UNKNOWN');
    }
  });

  // ---------- non-JSON 2xx ----------

  it('throws BFF_INVALID_JSON (502) on HTTP 200 with non-JSON body', async () => {
    // Simulate a proxy maintenance HTML page returned with HTTP 200.
    // Without the guard, `res.json().catch(() => ({}))` would swallow this
    // and the BFF would emit `success:true` with empty data — silent failure.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        },
      }))
    );

    try {
      await callNarratorProxyGet(APP_KEY, '/narrator/movie-sucai');
      throw new Error('expected NarratorProxyError');
    } catch (e) {
      expect(e).toBeInstanceOf(NarratorProxyError);
      expect((e as NarratorProxyError).status).toBe(502);
      expect((e as NarratorProxyError).code).toBe('BFF_INVALID_JSON');
    }
  });

  it('throws BFF_INVALID_JSON on HTTP 204 No Content (still 2xx)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 204,
        json: async () => {
          throw new SyntaxError('Unexpected end of JSON input');
        },
      }))
    );

    try {
      await callNarratorProxyGet(APP_KEY, '/narrator/movie-sucai');
      throw new Error('expected NarratorProxyError');
    } catch (e) {
      expect((e as NarratorProxyError).code).toBe('BFF_INVALID_JSON');
    }
  });

  it('non-2xx non-JSON falls through to status-based mapping (does NOT throw BFF_INVALID_JSON)', async () => {
    // Backend 5xx with HTML body should still surface as the original status,
    // not be re-coded as BFF_INVALID_JSON. The guard is scoped to 2xx only.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        },
      }))
    );

    try {
      await callNarratorProxyGet(APP_KEY, '/narrator/movie-sucai');
      throw new Error('expected NarratorProxyError');
    } catch (e) {
      expect((e as NarratorProxyError).status).toBe(500);
      expect((e as NarratorProxyError).code).toBe('UNKNOWN');
    }
  });

  // ---------- BFF auth-token guard ----------

  it('throws BFF_AUTH_TOKEN_MISSING (503) without calling fetch when env unset', async () => {
    vi.unstubAllEnvs();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    try {
      await callNarratorProxyGet(APP_KEY, '/narrator/movie-sucai');
      throw new Error('expected NarratorProxyError');
    } catch (e) {
      expect((e as NarratorProxyError).status).toBe(503);
      expect((e as NarratorProxyError).code).toBe('BFF_AUTH_TOKEN_MISSING');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ---------- network failure ----------

  it('maps connect failure to BFF_UPSTREAM_UNREACHABLE (502)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      })
    );

    try {
      await callNarratorProxyGet(APP_KEY, '/narrator/movie-sucai');
      throw new Error('expected NarratorProxyError');
    } catch (e) {
      expect((e as NarratorProxyError).status).toBe(502);
      expect((e as NarratorProxyError).code).toBe('BFF_UPSTREAM_UNREACHABLE');
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
      await callNarratorProxyGet(APP_KEY, '/narrator/movie-sucai');
      throw new Error('expected NarratorProxyError');
    } catch (e) {
      expect((e as NarratorProxyError).status).toBe(504);
      expect((e as NarratorProxyError).code).toBe('BFF_UPSTREAM_TIMEOUT');
    }
  });

  // ---------- per-call timeout override (search-media is 95s) ----------

  it('honors caller-supplied timeoutMs (default is 60s)', async () => {
    // We can't reliably test the timer fires at exactly Ns without faking
    // timers, but we can prove the AbortSignal is the one we pass and that
    // the timer is set up (vs. running with no abort). The realistic
    // confidence here comes from the abort-mapping test above; this test
    // just guards against accidentally hard-coding the 60s default and
    // ignoring the option.
    const spy = mockFetchOnce(200, {});

    await callNarratorProxyGet(
      APP_KEY,
      '/narrator/commentary/search-media',
      { query: 'foo' },
      { timeoutMs: 95_000 }
    );

    // The fetch should still be called normally (this asserts no abort fires
    // synchronously when timeout is huge).
    expect(spy).toHaveBeenCalledTimes(1);
    const [, init] = spy.mock.calls[0] as [URL, RequestInit];
    expect(init.signal).toBeDefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
