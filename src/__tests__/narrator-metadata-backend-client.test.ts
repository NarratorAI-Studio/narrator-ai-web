/**
 * Tests for the narrator-metadata backend HTTP client (the implementation requirement).
 *
 * Strategy: stub global fetch and assert request shape (URL / headers /
 * query params) + status-to-error mapping. Mirrors the pattern in
 * master-task-backend-client.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  NarratorMetadataError,
  fetchNarratorMetadata,
} from '@/lib/narrator-metadata-backend-client';

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

describe('narrator-metadata-backend-client', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubEnv('PRICING_BFF_AUTH_TOKEN', BEARER);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    globalThis.fetch = ORIGINAL_FETCH;
  });

  // ---------- request shape ----------

  it('GETs the backend with Bearer + X-Web-App-Key + Accept headers', async () => {
    const spy = mockFetchOnce(200, { code: 10000, data: { items: [] } });

    await fetchNarratorMetadata(APP_KEY, '/narrator/types');

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toMatch(/\/narrator\/types$/);
    expect(init.method).toBe('GET');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${BEARER}`);
    expect(headers['X-Web-App-Key']).toBe(APP_KEY);
    expect(headers['Accept']).toBe('application/json');
  });

  it('forwards documented query params; drops undefined / empty', async () => {
    const spy = mockFetchOnce(200, { code: 10000, data: { items: [] } });

    await fetchNarratorMetadata(APP_KEY, '/narrator/bgm-list', {
      page: '2',
      size: 50,
      // these three should be dropped from the URL:
      filterEmptyString: '',
      filterUndefined: undefined,
      filterNullish: undefined,
    });

    const [url] = spy.mock.calls[0] as [URL];
    const urlStr = String(url);
    expect(urlStr).toContain('page=2');
    expect(urlStr).toContain('size=50');
    expect(urlStr).not.toContain('filterEmptyString');
    expect(urlStr).not.toContain('filterUndefined');
    expect(urlStr).not.toContain('filterNullish');
  });

  it('coerces numeric params to strings before appending', async () => {
    const spy = mockFetchOnce(200, {});

    await fetchNarratorMetadata(APP_KEY, '/narrator/bgm-list', {
      page: 3,
      size: 25,
    });

    const [url] = spy.mock.calls[0] as [URL];
    expect(String(url)).toContain('page=3');
    expect(String(url)).toContain('size=25');
  });

  // ---------- success ----------

  it('returns the parsed body verbatim on 200', async () => {
    const payload = {
      code: 10000,
      message: 'success',
      data: { items: [{ id: 1, name: 'fixture' }] },
    };
    mockFetchOnce(200, payload);

    const result = await fetchNarratorMetadata(APP_KEY, '/narrator/types');
    expect(result).toEqual(payload);
  });

  // ---------- backend error envelope mapping ----------

  it('throws NarratorMetadataError with status=401 + code on backend auth rejection', async () => {
    mockFetchOnce(401, {
      success: false,
      error: {
        code: 'WEB_APP_KEY_UNKNOWN',
        message: 'X-Web-App-Key is not recognized.',
        retryable: false,
        details: {},
      },
    });

    try {
      await fetchNarratorMetadata(APP_KEY, '/narrator/types');
      throw new Error('expected NarratorMetadataError');
    } catch (e) {
      expect(e).toBeInstanceOf(NarratorMetadataError);
      expect((e as NarratorMetadataError).status).toBe(401);
      expect((e as NarratorMetadataError).code).toBe('WEB_APP_KEY_UNKNOWN');
      expect((e as NarratorMetadataError).message).toContain('X-Web-App-Key');
    }
  });

  it('throws NarratorMetadataError with status=503 on upstream DB unavailable', async () => {
    mockFetchOnce(503, {
      success: false,
      error: {
        code: 'UPSTREAM_NOT_CONFIGURED',
        message: 'Upstream narrator metadata base URL or app-key is not configured.',
        retryable: false,
        details: {},
      },
    });

    try {
      await fetchNarratorMetadata(APP_KEY, '/narrator/bgm');
      throw new Error('expected NarratorMetadataError');
    } catch (e) {
      expect(e).toBeInstanceOf(NarratorMetadataError);
      expect((e as NarratorMetadataError).status).toBe(503);
      expect((e as NarratorMetadataError).code).toBe('UPSTREAM_NOT_CONFIGURED');
    }
  });

  it('throws on 5xx without an error envelope, with code=UNKNOWN', async () => {
    mockFetchOnce(500, 'Internal server error' as unknown as object);

    try {
      await fetchNarratorMetadata(APP_KEY, '/narrator/bgm');
      throw new Error('expected NarratorMetadataError');
    } catch (e) {
      expect(e).toBeInstanceOf(NarratorMetadataError);
      expect((e as NarratorMetadataError).status).toBe(500);
      expect((e as NarratorMetadataError).code).toBe('UNKNOWN');
    }
  });

  // ---------- BFF auth-token guard (review security-sensitive) ----------

  it('throws BFF_AUTH_TOKEN_MISSING (503) without calling fetch when env unset', async () => {
    // Unstub the env that beforeEach set, then prove the guard fires
    // before any network attempt.
    vi.unstubAllEnvs();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    try {
      await fetchNarratorMetadata(APP_KEY, '/narrator/types');
      throw new Error('expected NarratorMetadataError');
    } catch (e) {
      expect(e).toBeInstanceOf(NarratorMetadataError);
      expect((e as NarratorMetadataError).status).toBe(503);
      expect((e as NarratorMetadataError).code).toBe('BFF_AUTH_TOKEN_MISSING');
      expect((e as NarratorMetadataError).message).toContain(
        'PRICING_BFF_AUTH_TOKEN'
      );
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ---------- network failure ----------

  it('throws BFF_UPSTREAM_UNREACHABLE (502) when fetch rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      })
    );

    try {
      await fetchNarratorMetadata(APP_KEY, '/narrator/types');
      throw new Error('expected NarratorMetadataError');
    } catch (e) {
      expect(e).toBeInstanceOf(NarratorMetadataError);
      expect((e as NarratorMetadataError).status).toBe(502);
      expect((e as NarratorMetadataError).code).toBe('BFF_UPSTREAM_UNREACHABLE');
    }
  });

  it('throws BFF_UPSTREAM_TIMEOUT (504) when fetch aborts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      })
    );

    try {
      await fetchNarratorMetadata(APP_KEY, '/narrator/types');
      throw new Error('expected NarratorMetadataError');
    } catch (e) {
      expect(e).toBeInstanceOf(NarratorMetadataError);
      expect((e as NarratorMetadataError).status).toBe(504);
      expect((e as NarratorMetadataError).code).toBe('BFF_UPSTREAM_TIMEOUT');
    }
  });
});
