/**
 * Tests for the narrator-tasks backend HTTP client (the implementation requirement).
 *
 * Strategy: vi.stubGlobal('fetch', ...) and exercise each exported
 * function directly. Verifies:
 *   - request shape: method / URL / X-Web-App-Key / body JSON
 *   - CAS query-param assembly on PUT
 *   - status → return-value mapping (200 → data; 403 / 404 / 409 → null;
 *     anything else throws)
 *   - upstream-unreachable / abort → throws via the 502 / 504 envelope
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NarratorMasterTask } from '@/lib/master-task-types';
import {
  BackendError,
  backendCreateTask,
  backendGetTask,
  backendListTasks,
  backendReplaceTask,
  backendUpsertTask,
} from '@/lib/master-task-backend-client';

const APP_KEY = 'grid_AAAAAAAAAAAAAAAAAAAAAA';
const ORIGINAL_FETCH = globalThis.fetch;

function fakeTask(overrides: Partial<NarratorMasterTask> = {}): NarratorMasterTask {
  // Minimal-but-valid task body. The backend treats the JSON blob
  // as opaque, so we only need to satisfy the TS interface.
  return {
    narrator_task_id: 'task_test',
    created_at: '2026-05-27T00:00:00+00:00',
    updated_at: '2026-05-27T00:00:00+00:00',
    app_key: APP_KEY,
    narrator_type: 'playlet',
    narrator_type_label: '短剧解说',
    model_version: 'v1',
    dubing_id: 'd1',
    native_video_id: 'v1',
    native_video_name: 'v1.mp4',
    native_srt_id: 's1',
    native_srt_name: 's1.srt',
    use_existing_model: false,
    run_auto: 0,
    status: 'pending',
    steps: {},
    ...overrides,
  };
}

function mockFetchOnce(status: number, body: unknown) {
  const spy = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('master-task-backend-client', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = ORIGINAL_FETCH;
  });

  // ---------- request shape ----------

  it('backendCreateTask POSTs to /narrator/tasks with X-Web-App-Key', async () => {
    const task = fakeTask();
    const spy = mockFetchOnce(200, { success: true, data: task });

    const created = await backendCreateTask(APP_KEY, {
      ...task,
      // dbCreateTask gives `Omit<…, 'narrator_task_id' | 'created_at' | 'updated_at'>`
      // — strip them so the test stays honest about the input shape.
      narrator_task_id: undefined as unknown as string,
      created_at: undefined as unknown as string,
      updated_at: undefined as unknown as string,
    });
    expect(created).toEqual(task);

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/narrator\/tasks$/);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-Web-App-Key']).toBe(APP_KEY);
    expect(init.body).toContain('"narrator_type":"playlet"');
  });

  it('backendGetTask GETs /narrator/tasks/<id> and url-encodes the id', async () => {
    const task = fakeTask({ narrator_task_id: 'task with space' });
    const spy = mockFetchOnce(200, { success: true, data: task });

    const fetched = await backendGetTask(APP_KEY, 'task with space');
    expect(fetched).toEqual(task);

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/narrator\/tasks\/task%20with%20space$/);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('backendListTasks forwards status / page / limit as query params', async () => {
    const spy = mockFetchOnce(200, {
      success: true,
      data: { items: [], total: 0 },
    });

    await backendListTasks({
      appKey: APP_KEY,
      status: 'running',
      page: 2,
      limit: 50,
    });

    const [url] = spy.mock.calls[0] as [string];
    expect(url).toMatch(/\/narrator\/tasks\?/);
    expect(url).toContain('page=2');
    expect(url).toContain('limit=50');
    expect(url).toContain('status=running');
  });

  it('backendReplaceTask emits expected_status / expected_step query params when supplied', async () => {
    const task = fakeTask({ status: 'running' });
    const spy = mockFetchOnce(200, { success: true, data: task });

    await backendReplaceTask(
      APP_KEY,
      'task_cas',
      task,
      ['pending', 'paused'],
      'clip_data'
    );

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/narrator\/tasks\/task_cas\?/);
    expect(url).toContain('expected_status=pending%2Cpaused');
    expect(url).toContain('expected_step=clip_data');
    expect(init.method).toBe('PUT');
  });

  it('backendReplaceTask omits CAS params when neither is supplied', async () => {
    const task = fakeTask();
    const spy = mockFetchOnce(200, { success: true, data: task });

    await backendReplaceTask(APP_KEY, 'task_plain', task);

    const [url] = spy.mock.calls[0] as [string];
    expect(url).toMatch(/\/narrator\/tasks\/task_plain$/);
    expect(url).not.toContain('?');
  });

  // ---------- status → return-value mapping ----------

  it('backendUpsertTask returns null on 403 (cross-tenant) instead of throwing', async () => {
    mockFetchOnce(403, {
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'narrator_task_id belongs to another tenant.',
        retryable: false,
        details: {},
      },
    });
    const result = await backendUpsertTask(APP_KEY, fakeTask());
    expect(result).toBeNull();
  });

  it('backendGetTask returns null on 404', async () => {
    mockFetchOnce(404, {
      success: false,
      error: { code: 'NOT_FOUND', message: 'Task not found.', details: {} },
    });
    const result = await backendGetTask(APP_KEY, 'missing');
    expect(result).toBeNull();
  });

  it('backendReplaceTask returns null on 404 OR 409', async () => {
    mockFetchOnce(404, {
      success: false,
      error: { code: 'NOT_FOUND', message: 'Task not found.', details: {} },
    });
    expect(await backendReplaceTask(APP_KEY, 'gone', fakeTask())).toBeNull();

    mockFetchOnce(409, {
      success: false,
      error: {
        code: 'CAS_MISMATCH',
        message: 'preconditions not met',
        details: {},
      },
    });
    expect(
      await backendReplaceTask(APP_KEY, 'conflict', fakeTask(), ['running'])
    ).toBeNull();
  });

  // ---------- errors that should throw ----------

  it('throws BackendError with status=401 + code on backend auth rejection', async () => {
    // The route catch reads `.status` to forward 401 instead of defaulting
    // to 500 — without this typed throw, an unknown App Key would surface
    // as an internal server error and look like a backend outage.
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
      await backendGetTask(APP_KEY, 'task_x');
      throw new Error('expected BackendError to be thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BackendError);
      expect((e as BackendError).status).toBe(401);
      expect((e as BackendError).code).toBe('WEB_APP_KEY_UNKNOWN');
      expect((e as BackendError).message).toContain('X-Web-App-Key');
    }
  });

  it('throws BackendError with status=503 on backend DB unavailable', async () => {
    mockFetchOnce(503, {
      success: false,
      error: {
        code: 'NARRATOR_TASKS_DB_UNAVAILABLE',
        message: 'Narrator tasks store is temporarily unavailable.',
        retryable: true,
        details: {},
      },
    });
    try {
      await backendListTasks({ appKey: APP_KEY, page: 1, limit: 20 });
      throw new Error('expected BackendError to be thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BackendError);
      expect((e as BackendError).status).toBe(503);
      expect((e as BackendError).code).toBe('NARRATOR_TASKS_DB_UNAVAILABLE');
    }
  });

  // ---------- network failure ----------

  it('throws BackendError with status=502 when fetch rejects (upstream unreachable)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      })
    );
    try {
      await backendGetTask(APP_KEY, 'x');
      throw new Error('expected BackendError to be thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BackendError);
      expect((e as BackendError).status).toBe(502);
      expect((e as BackendError).code).toBe('BFF_UPSTREAM_UNREACHABLE');
    }
  });

  it('throws BackendError with status=504 when fetch aborts (upstream timeout)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      })
    );
    try {
      await backendGetTask(APP_KEY, 'x');
      throw new Error('expected BackendError to be thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BackendError);
      expect((e as BackendError).status).toBe(504);
      expect((e as BackendError).code).toBe('BFF_UPSTREAM_TIMEOUT');
    }
  });
});
