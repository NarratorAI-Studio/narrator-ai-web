/**
 * Cutover regression for /api/narrator/master-tasks/[id]/sync (regression coverage /
 * Backend API contract).
 *
 * Single concern: when `NEXT_PUBLIC_BACKEND_ORCHESTRATOR_ON='1'`, the
 * sync route persists the locally-completed step state but does NOT
 * advance `current_step` and does NOT call `triggerNextStep` — the
 * backend orchestrator owns auto-advance. When the env var is unset
 * or '0', the legacy trigger path stays in effect (regression check
 * for the rollback knob).
 *
 * Other sync-route behaviors (upstream query failures, CAS dedup, the
 * run_auto=0 paused path) are unchanged from the pre-cutover code and
 * remain untested here — this file is scoped to the cutover diff.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { POST } from '@/app/api/narrator/master-tasks/[id]/sync/route';

const ORIGINAL_FETCH = globalThis.fetch;
const APP_KEY = 'grid_TestKey1234567890';
const TASK_ID = 'task-abc';
const REMOTE_TASK_ID = 'remote-popular-1';

function buildSyncRequest(taskBody: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost:5000/api/narrator/master-tasks/${TASK_ID}/sync`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-app-key': APP_KEY,
    },
    body: JSON.stringify({ task: taskBody }),
  });
}

function buildRunAutoTask(): Record<string, unknown> {
  return {
    narrator_task_id: TASK_ID,
    status: 'running',
    run_auto: 1,
    current_step: 'popular_learning',
    writing_type: 0,
    use_existing_model: false,
    steps: { popular_learning: { task_id: REMOTE_TASK_ID } },
  };
}

/**
 * Stub fetch so that:
 *   - upstream query returns status=2 (success) with an extractable
 *     learning_model_id — sync.ts will mark the step completed
 *   - dbReplaceTask (the persist call to backend) succeeds
 *   - any other backend call (CAS, trigger forwarding) increments a
 *     counter so the test can assert it was NOT invoked under cutover
 */
function stubBackend(extraHandler?: (url: string, init?: RequestInit) => Response | undefined) {
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method || 'GET').toUpperCase();
      calls.push({ url, method });
      const override = extraHandler?.(url, init);
      if (override) return override;

      // Upstream commentary query for the current step.
      if (url.includes('/api/narrator/commentary/')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              status: 2,
              results: {
                order_info: { learning_model_id: 'lm-77', order_num: 'ord-1' },
                tasks: [{ id: 99 }],
              },
              completed_at: '2026-06-11T01:00:00Z',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      // Backend store endpoints (dbCasUpdate / dbReplaceTask). The
      // route hits PUT /narrator/tasks/<id>; respond 200 to let
      // persist succeed.
      if (url.includes('/narrator/tasks/')) {
        return new Response(
          JSON.stringify({ success: true, data: { ...JSON.parse((init?.body as string) || '{}') } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      // Anything else (eg. /api/narrator/create-generate-writing) is the
      // trigger path — return success so a leak shows up as an
      // unexpected call rather than a hard test failure.
      return new Response(
        JSON.stringify({ success: true, data: { task_id: 'should-not-trigger' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }),
  );
  return calls;
}

describe('sync route cutover short-circuit (NEXT_PUBLIC_BACKEND_ORCHESTRATOR_ON)', () => {
  const originalEnv = process.env.NEXT_PUBLIC_BACKEND_ORCHESTRATOR_ON;

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = ORIGINAL_FETCH;
    if (originalEnv === undefined) {
      delete process.env.NEXT_PUBLIC_BACKEND_ORCHESTRATOR_ON;
    } else {
      process.env.NEXT_PUBLIC_BACKEND_ORCHESTRATOR_ON = originalEnv;
    }
  });

  it('short-circuits when env=1: persists step.completed but does not advance current_step or trigger', async () => {
    process.env.NEXT_PUBLIC_BACKEND_ORCHESTRATOR_ON = '1';
    const calls = stubBackend();

    const res = await POST(buildSyncRequest(buildRunAutoTask()), {
      params: Promise.resolve({ id: TASK_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.backend_orchestrator).toBe(true);
    expect(body.auto_advanced).toBe(false);
    // The route should not have called the trigger BFF endpoints —
    // those live under /api/narrator/create-*.
    const triggerCalls = calls.filter(c => c.url.includes('/api/narrator/create-'));
    expect(triggerCalls).toEqual([]);

    // The persisted body keeps current_step at the original step
    // (popular_learning); backend orchestrator walks it from there.
    expect(body.data.current_step).toBe('popular_learning');
    expect(body.data.steps.popular_learning.status).toBe('completed');
  });

  it('legacy path: env unset triggers next step (rollback regression)', async () => {
    delete process.env.NEXT_PUBLIC_BACKEND_ORCHESTRATOR_ON;
    const calls = stubBackend();

    const res = await POST(buildSyncRequest(buildRunAutoTask()), {
      params: Promise.resolve({ id: TASK_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.success).toBe(true);
    // No backend_orchestrator marker on the legacy response.
    expect(body.backend_orchestrator).toBeUndefined();
    // Next-step trigger was actually invoked.
    const triggerCalls = calls.filter(c => c.url.includes('/api/narrator/create-'));
    expect(triggerCalls.length).toBeGreaterThan(0);
  });

  it('legacy path: env=0 also triggers next step (explicit rollback value)', async () => {
    process.env.NEXT_PUBLIC_BACKEND_ORCHESTRATOR_ON = '0';
    const calls = stubBackend();

    await POST(buildSyncRequest(buildRunAutoTask()), {
      params: Promise.resolve({ id: TASK_ID }),
    });
    const triggerCalls = calls.filter(c => c.url.includes('/api/narrator/create-'));
    expect(triggerCalls.length).toBeGreaterThan(0);
  });

  it('CAS mismatch on persist refetches authoritative state instead of returning stale snapshot', async () => {
    // Critical review finding from review: returning the local
    // `task` snapshot on CAS mismatch is worse than overwriting
    // would be — sync callers persist `j.data` back into their
    // store, so the route handing over the stale pre-claim view
    // causes a client-side regression. The fix is to refetch the
    // backend's authoritative row via dbGetTask and return THAT,
    // plus synced:false so any caller that gates persistence on
    // `synced` skips the write entirely.
    process.env.NEXT_PUBLIC_BACKEND_ORCHESTRATOR_ON = '1';

    // What the backend has advanced to during the rollout overlap —
    // current_step is generate_writing (one step ahead) and the step
    // record has a real upstream task_id. The refetch must surface
    // THIS, not the local task with current_step=popular_learning.
    const backendAdvancedTask = {
      narrator_task_id: TASK_ID,
      status: 'running',
      run_auto: 1,
      current_step: 'generate_writing',
      steps: {
        popular_learning: { task_id: REMOTE_TASK_ID, status: 'completed', result: {} },
        generate_writing: { task_id: 'backend-triggered-rt', status: 'running' },
      },
    };
    let getCalled = 0;
    const calls = stubBackend((url, init) => {
      const method = (init?.method || 'GET').toUpperCase();
      // PUT /narrator/tasks/<id>: simulate backend 409 CAS_MISMATCH so
      // dbCasUpdate collapses to null.
      if (url.includes('/narrator/tasks/') && method === 'PUT') {
        return new Response(
          JSON.stringify({ success: false, error: { code: 'CAS_MISMATCH' } }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        );
      }
      // GET /narrator/tasks/<id>: the refetch — return the
      // backend's advanced state.
      if (url.includes('/narrator/tasks/') && method === 'GET') {
        getCalled++;
        return new Response(
          JSON.stringify({ success: true, data: backendAdvancedTask }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return undefined;
    });

    const res = await POST(buildSyncRequest(buildRunAutoTask()), {
      params: Promise.resolve({ id: TASK_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.synced).toBe(false); // critical: tells callers not to persist
    expect(body.backend_orchestrator).toBe(true);
    expect(body.cas_mismatch).toBe(true);
    // The route refetched the authoritative state instead of
    // returning the stale local task.
    expect(getCalled).toBe(1);
    expect(body.data.current_step).toBe('generate_writing');
    expect(body.data.steps.generate_writing.task_id).toBe('backend-triggered-rt');

    // No trigger BFF call (we're handing off to backend, not
    // double-triggering on top of the backend's advance).
    const triggerCalls = calls.filter(c => c.url.includes('/api/narrator/create-'));
    expect(triggerCalls).toEqual([]);
  });

  it('short-circuit does not affect run_auto=0 manual-step path', async () => {
    process.env.NEXT_PUBLIC_BACKEND_ORCHESTRATOR_ON = '1';
    const calls = stubBackend();

    const manualTask = { ...buildRunAutoTask(), run_auto: 0 };
    const res = await POST(buildSyncRequest(manualTask), {
      params: Promise.resolve({ id: TASK_ID }),
    });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.auto_advanced).toBe(false);
    // Manual path moves current_step to nextStep and pauses, exactly
    // as before — no backend_orchestrator marker.
    expect(body.backend_orchestrator).toBeUndefined();
    expect(body.next_step).toBe('generate_writing');
    // No trigger calls were issued (paused awaits user action).
    const triggerCalls = calls.filter(c => c.url.includes('/api/narrator/create-'));
    expect(triggerCalls).toEqual([]);
  });
});
