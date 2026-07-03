/**
 * Route-level tests for the narrator-proxy BFF routes .
 *
 * Strategy: spy on `callNarratorProxyGet` / `callNarratorProxyPost` and
 * invoke each route's handler directly. Adapter-level coverage (Bearer /
 * X-Web-App-Key / error mapping) lives in
 * `narrator-proxy-backend-client.test.ts`.
 *
 * Focus areas:
 *   - `movie-sucai` current-page fetch, invalid-item filtering, and caching
 *   - `search-media` passes the 95s timeout to the client
 *   - `material-verification` aggregates per-episode line-count errors
 *   - dynamic-path routes URL-encode the task_id before calling backend
 *   - 401 when x-app-key is missing
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import * as proxyClient from '@/lib/narrator-proxy-backend-client';

const APP_KEY = 'grid_AbCdEfGhIjKlMnOpQrStUv';

function buildGet(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost:5000${path}`, { method: 'GET', headers });
}

function buildPost(
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): NextRequest {
  return new NextRequest(`http://localhost:5000${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('GET /api/narrator/movie-sucai (BFF)', () => {
  let getSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    getSpy?.mockRestore();
  });

  it('filters `自定义` / `else` placeholder rows and keeps total in sync', async () => {
    // Backend returns 4 rows; 1 is the `自定义` placeholder, 1 has `else`
    // ids — both must be filtered. UI should see 2 items + total adjusted.
    getSpy = vi
      .spyOn(proxyClient, 'callNarratorProxyGet')
      .mockResolvedValueOnce({
        data: {
          total: 4,
          items: [
            { video_file_id: 'v1', srt_file_id: 's1', name: 'real-1' },
            { video_file_id: 'else', srt_file_id: 's2', name: 'invalid-else' },
            { video_file_id: 'v3', srt_file_id: 's3', name: '自定义' },
            { video_file_id: 'v4', srt_file_id: 's4', name: 'real-2' },
          ],
        },
      });

    const { GET } = await import('@/app/api/narrator/movie-sucai/route');
    const res = await GET(
      buildGet('/api/narrator/movie-sucai?page=1&page_size=21', { 'x-app-key': APP_KEY })
    );

    expect(res.status).toBe(200);
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy.mock.calls[0][2]).toEqual({ page: 1, page_size: 21, name: undefined });
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.items.map((i: { name: string }) => i.name)).toEqual([
      'real-1',
      'real-2',
    ]);
    expect(json.data.total).toBe(2); // 4 raw - 2 filtered out
  });

  it('returns cached data for repeated page requests', async () => {
    getSpy = vi.spyOn(proxyClient, 'callNarratorProxyGet').mockResolvedValueOnce({
      data: {
        total: 1,
        items: [{ video_file_id: 'v1', srt_file_id: 's1', name: 'cached' }],
      },
    });

    const { GET } = await import('@/app/api/narrator/movie-sucai/route');
    const req = buildGet('/api/narrator/movie-sucai?page=9&page_size=21', {
      'x-app-key': APP_KEY,
    });
    const first = await GET(req);
    const second = await GET(req);

    expect(first.headers.get('X-BFF-Cache')).toBe('MISS');
    expect(second.headers.get('X-BFF-Cache')).toBe('HIT');
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it('returns 401 when x-app-key is missing', async () => {
    getSpy = vi.spyOn(proxyClient, 'callNarratorProxyGet').mockResolvedValue({});
    const { GET } = await import('@/app/api/narrator/movie-sucai/route');
    const res = await GET(buildGet('/api/narrator/movie-sucai?page=1&page_size=21'));
    expect(res.status).toBe(401);
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('maps NarratorProxyError.status onto the BFF response', async () => {
    getSpy = vi
      .spyOn(proxyClient, 'callNarratorProxyGet')
      .mockRejectedValueOnce(
        new proxyClient.NarratorProxyError('X-Web-App-Key invalid', 401, 'WEB_APP_KEY_UNKNOWN')
      );

    const { GET } = await import('@/app/api/narrator/movie-sucai/route');
    const res = await GET(
      buildGet('/api/narrator/movie-sucai?page=4&page_size=21', { 'x-app-key': APP_KEY })
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.code).toBe('WEB_APP_KEY_UNKNOWN');
  });
});

describe('GET /api/narrator/search-media (BFF)', () => {
  let getSpy: ReturnType<typeof vi.spyOn>;
  afterEach(() => getSpy?.mockRestore());

  it('forwards the search query AND a 95s timeout to the client', async () => {
    getSpy = vi
      .spyOn(proxyClient, 'callNarratorProxyGet')
      .mockResolvedValue({ data: { results: [] } });

    const { GET } = await import('@/app/api/narrator/search-media/route');
    await GET(
      buildGet('/api/narrator/search-media?query=The+Movie', { 'x-app-key': APP_KEY })
    );

    expect(getSpy).toHaveBeenCalledTimes(1);
    const [appKey, path, params, options] = getSpy.mock.calls[0];
    expect(appKey).toBe(APP_KEY);
    expect(path).toBe('/narrator/commentary/search-media');
    expect(params).toEqual({ query: 'The Movie' });
    expect(options).toEqual({ timeoutMs: 95_000 });
  });

  it('rejects empty query with 400', async () => {
    getSpy = vi.spyOn(proxyClient, 'callNarratorProxyGet').mockResolvedValue({});
    const { GET } = await import('@/app/api/narrator/search-media/route');
    const res = await GET(
      buildGet('/api/narrator/search-media?query=', { 'x-app-key': APP_KEY })
    );
    expect(res.status).toBe(400);
    expect(getSpy).not.toHaveBeenCalled();
  });
});

describe('POST /api/narrator/material-verification (BFF)', () => {
  let postSpy: ReturnType<typeof vi.spyOn>;
  afterEach(() => postSpy?.mockRestore());

  it('single-episode mode forwards body and unwraps result', async () => {
    postSpy = vi
      .spyOn(proxyClient, 'callNarratorProxyPost')
      .mockResolvedValue({ message: '验证通过' });

    const { POST } = await import('@/app/api/narrator/material-verification/route');
    const res = await POST(
      buildPost(
        '/api/narrator/material-verification',
        { learning_srt: 'srt1', native_video: 'v', native_srt: 's' },
        { 'x-app-key': APP_KEY }
      )
    );

    expect(res.status).toBe(200);
    expect(postSpy).toHaveBeenCalledTimes(1);
    const [, path, body] = postSpy.mock.calls[0];
    expect(path).toBe('/narrator/commentary/material-verification');
    expect(body).toMatchObject({ native_video: 'v', native_srt: 's' });
  });

  it('multi-episode mode surfaces auth (401) failure with original status + code, not a 422 material error', async () => {
    // Previously the multi-episode loop pressed
    // every rejected reason into a message string and any non-line-count
    // error was returned as 422 "素材验证失败" — meaning the homepage and
    // monitoring couldn't tell a config/auth/infra error from a real
    // material validation failure. Auth + infra rejections must preserve
    // their original status + code.
    postSpy = vi
      .spyOn(proxyClient, 'callNarratorProxyPost')
      .mockRejectedValueOnce(
        new proxyClient.NarratorProxyError(
          'X-Web-App-Key is not recognized.',
          401,
          'WEB_APP_KEY_UNKNOWN'
        )
      )
      .mockRejectedValueOnce(
        new proxyClient.NarratorProxyError(
          '字幕行数(67)必须小于等于字幕行数(40)',
          422,
          'LINE_COUNT'
        )
      );

    const { POST } = await import('@/app/api/narrator/material-verification/route');
    const res = await POST(
      buildPost(
        '/api/narrator/material-verification',
        {
          episodes_data: [
            { native_video: 'v1', native_srt: 's1' },
            { native_video: 'v2', native_srt: 's2' },
          ],
        },
        { 'x-app-key': APP_KEY }
      )
    );

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.code).toBe('WEB_APP_KEY_UNKNOWN');
    expect(json.error).toContain('X-Web-App-Key');
  });

  it('multi-episode mode aggregates per-episode line-count errors into a single pass when total srt lines meet template', async () => {
    // Two episodes both fail with "字幕行数(67) ... 字幕行数(40)" / "字幕行数(67) ... 字幕行数(30)".
    // Sum (40+30=70) >= template (67), so BFF should return success with the
    // aggregate message.
    postSpy = vi
      .spyOn(proxyClient, 'callNarratorProxyPost')
      .mockRejectedValueOnce(
        new proxyClient.NarratorProxyError('字幕行数(67)必须小于等于字幕行数(40)', 422, 'LINE_COUNT')
      )
      .mockRejectedValueOnce(
        new proxyClient.NarratorProxyError('字幕行数(67)必须小于等于字幕行数(30)', 422, 'LINE_COUNT')
      );

    const { POST } = await import('@/app/api/narrator/material-verification/route');
    const res = await POST(
      buildPost(
        '/api/narrator/material-verification',
        {
          episodes_data: [
            { native_video: 'v1', native_srt: 's1' },
            { native_video: 'v2', native_srt: 's2' },
          ],
        },
        { 'x-app-key': APP_KEY }
      )
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.message).toMatch(/2 集字幕共 70 行/);
  });
});

describe('GET /api/narrator/commentary/[taskId] (BFF)', () => {
  let getSpy: ReturnType<typeof vi.spyOn>;
  afterEach(() => getSpy?.mockRestore());

  it('URL-encodes the task_id when building backend path', async () => {
    getSpy = vi
      .spyOn(proxyClient, 'callNarratorProxyGet')
      .mockResolvedValue({ data: {} });

    const { GET } = await import('@/app/api/narrator/commentary/[taskId]/route');
    await GET(
      buildGet('/api/narrator/commentary/abc%3Fhack', { 'x-app-key': APP_KEY }),
      { params: Promise.resolve({ taskId: 'abc?hack' }) }
    );

    expect(getSpy).toHaveBeenCalledTimes(1);
    const [, path] = getSpy.mock.calls[0];
    // `?` must be re-encoded; the path must end with `query/abc%3Fhack`,
    // not contain a raw `?` that would otherwise start a query string in
    // the URL constructor.
    expect(path).toBe('/narrator/commentary/query/abc%3Fhack');
  });
});
