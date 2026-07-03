/**
 * Route-level tests for the 7 commentary create-* BFF routes (regression coverage / Backend API contract).
 *
 * Strategy: spy on `callNarratorProxyPost` and assert each route forwards to
 * the expected backend path with the body verbatim. Adapter-level coverage
 * (Bearer / X-Web-App-Key / error mapping) lives in
 * `narrator-proxy-backend-client.test.ts`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import * as proxyClient from '@/lib/narrator-proxy-backend-client';

const APP_KEY = 'grid_AbCdEfGhIjKlMnOpQrStUv';

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

interface BffCase {
  webRoute: string;
  modulePath: string;
  backendPath: string;
}

const CASES: BffCase[] = [
  {
    webRoute: '/api/narrator/create-popular-learning',
    modulePath: '@/app/api/narrator/create-popular-learning/route',
    backendPath: '/narrator/commentary/create-popular-learning',
  },
  {
    webRoute: '/api/narrator/create-subsync',
    modulePath: '@/app/api/narrator/create-subsync/route',
    backendPath: '/narrator/commentary/create-subsync',
  },
  {
    webRoute: '/api/narrator/create-generate-writing',
    modulePath: '@/app/api/narrator/create-generate-writing/route',
    backendPath: '/narrator/commentary/create-generate-writing',
  },
  {
    webRoute: '/api/narrator/create-clip-data',
    modulePath: '@/app/api/narrator/create-clip-data/route',
    backendPath: '/narrator/commentary/create-clip-data',
  },
  {
    webRoute: '/api/narrator/create-fast-writing',
    modulePath: '@/app/api/narrator/create-fast-writing/route',
    backendPath: '/narrator/commentary/create-fast-writing',
  },
  {
    webRoute: '/api/narrator/create-fast-writing-clip-data',
    modulePath: '@/app/api/narrator/create-fast-writing-clip-data/route',
    backendPath: '/narrator/commentary/create-fast-writing-clip-data',
  },
  {
    webRoute: '/api/narrator/create-video-composing',
    modulePath: '@/app/api/narrator/create-video-composing/route',
    backendPath: '/narrator/commentary/create-video-composing',
  },
];

describe('group B create-* BFF routes', () => {
  let postSpy: ReturnType<typeof vi.spyOn>;
  afterEach(() => postSpy?.mockRestore());

  it.each(CASES)('$webRoute forwards to $backendPath with body verbatim', async ({
    webRoute,
    modulePath,
    backendPath,
  }) => {
    postSpy = vi
      .spyOn(proxyClient, 'callNarratorProxyPost')
      .mockResolvedValue({ data: { task_id: 'mock-id' } });

    const mod = (await import(/* @vite-ignore */ modulePath)) as {
      POST: (req: NextRequest) => Promise<Response>;
    };
    const body = { foo: 'bar', count: 1 };
    const res = await mod.POST(
      buildPost(webRoute, body, { 'x-app-key': APP_KEY })
    );

    expect(res.status).toBe(200);
    expect(postSpy).toHaveBeenCalledTimes(1);
    const [appKey, path, forwardedBody, options] = postSpy.mock.calls[0];
    expect(appKey).toBe(APP_KEY);
    expect(path).toBe(backendPath);
    expect(forwardedBody).toEqual(body);
    expect(options).toEqual({ timeoutMs: 65_000 });

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual({ task_id: 'mock-id' });
  });

  it.each(CASES)('$webRoute returns 401 when x-app-key is missing', async ({
    webRoute,
    modulePath,
  }) => {
    postSpy = vi.spyOn(proxyClient, 'callNarratorProxyPost').mockResolvedValue({});
    const mod = (await import(/* @vite-ignore */ modulePath)) as {
      POST: (req: NextRequest) => Promise<Response>;
    };
    const res = await mod.POST(buildPost(webRoute, { foo: 'bar' }));
    expect(res.status).toBe(401);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('forwards NarratorProxyError.status + code onto the BFF response', async () => {
    postSpy = vi
      .spyOn(proxyClient, 'callNarratorProxyPost')
      .mockRejectedValueOnce(
        new proxyClient.NarratorProxyError(
          'X-Web-App-Key is not recognized.',
          401,
          'WEB_APP_KEY_UNKNOWN'
        )
      );

    const { POST } = await import('@/app/api/narrator/create-popular-learning/route');
    const res = await POST(
      buildPost('/api/narrator/create-popular-learning', { x: 1 }, { 'x-app-key': APP_KEY })
    );

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.code).toBe('WEB_APP_KEY_UNKNOWN');
    expect(json.error).toContain('X-Web-App-Key');
  });
});
