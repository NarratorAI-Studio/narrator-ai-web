/**
 * Route-level test for /api/narrator/master-tasks BFF (the implementation requirement, review).
 *
 * Strategy mirrors account-profile-bff.test.ts: stub the upstream fetch
 * via vi.stubGlobal('fetch', ...) and invoke the route handler directly
 * with a NextRequest. The single concern here is that backend status
 * codes are forwarded through the route's catch block — without
 * BackendError carrying `.status`, an upstream 401 would surface as a
 * 500 internal error and look like a backend outage rather than an
 * authentication failure (regression coverage).
 *
 * The exhaustive backend-side mapping (status → null vs throw) is
 * covered by master-task-backend-client.test.ts; this file only checks
 * that the route layer doesn't flatten the typed status away.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { GET } from '@/app/api/narrator/master-tasks/route';

const ORIGINAL_FETCH = globalThis.fetch;

function buildListRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost:5000/api/narrator/master-tasks', {
    method: 'GET',
    headers,
  });
}

describe('GET /api/narrator/master-tasks (route layer)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it('forwards backend 401 as 401 with the backend code, not 500', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({
          success: false,
          error: {
            code: 'WEB_APP_KEY_UNKNOWN',
            message: 'X-Web-App-Key is not recognized.',
            retryable: false,
            details: {},
          },
        }),
      }))
    );

    const res = await GET(
      buildListRequest({ 'x-app-key': 'grid_xxxxxxxxxxxxxxxxxxxxxx' })
    );

    // Status preserved — without the BackendError-aware catch this would
    // be 500 because the route's catch block hardcoded {status: 500}.
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('WEB_APP_KEY_UNKNOWN');
    expect(body.error).toContain('X-Web-App-Key');
  });

  it('forwards backend 503 as 503', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({
          success: false,
          error: {
            code: 'NARRATOR_TASKS_DB_UNAVAILABLE',
            message: 'Narrator tasks store is temporarily unavailable.',
            retryable: true,
            details: {},
          },
        }),
      }))
    );

    const res = await GET(
      buildListRequest({ 'x-app-key': 'grid_xxxxxxxxxxxxxxxxxxxxxx' })
    );

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('NARRATOR_TASKS_DB_UNAVAILABLE');
  });

  it('forwards upstream-unreachable as 502 (the BackendError envelope)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      })
    );

    const res = await GET(
      buildListRequest({ 'x-app-key': 'grid_xxxxxxxxxxxxxxxxxxxxxx' })
    );

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe('BFF_UPSTREAM_UNREACHABLE');
  });

  it('still 401s on missing x-app-key at the route boundary (no backend call)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const res = await GET(buildListRequest({}));

    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
