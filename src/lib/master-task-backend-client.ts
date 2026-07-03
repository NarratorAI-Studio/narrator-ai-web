/**
 * Server-side HTTP client for narrator-ai-web-backend `/narrator/tasks`
 * routes.
 *
 * Architecture invariant: browser → Web SSR/API → narrator-ai-web-backend
 * → reseller Postgres. Replaces the legacy managed MySQL
 * `narrator_master_tasks` data plane that lived in `src/lib/db.ts` +
 * `src/lib/master-task-db.ts`. Mirrors the patterns established by
 * `src/lib/account-profile-client.ts` (timeout, 502/504 envelope,
 * `X-Web-App-Key` header).
 *
 * Auth: forwards the caller's already-resolved `x-app-key` header
 * verbatim as `X-Web-App-Key`. The route layer must have validated
 * presence before calling — backend rejects missing / unknown keys
 * with 401.
 *
 * Status code conventions (matching the existing `master-task-db.ts`
 * semantics so the 4 route files don't have to change):
 *   - 200 → return the decoded `data`.
 *   - 403 (FORBIDDEN, upsert cross-tenant) → return `null`.
 *   - 404 (NOT_FOUND, get / replace / cas) → return `null`.
 *   - 409 (CAS_MISMATCH, replace with preconditions) → return `null`.
 *   - 401 / 400 / 500-ish → throw with the backend's `error.message`
 *     so the route's existing `try/catch → 500` envelope surfaces it.
 */

import type { NarratorMasterTask } from './master-task-types';

/**
 * Typed error thrown by the shim when backend rejects a call with a
 * status we don't collapse into `null` (i.e. not 403 upsert / 404 get /
 * 404 or 409 replace). Carries `status` so the route's `catch` block can
 * forward the right HTTP code instead of defaulting to 500. Unknown App Keys
 * returning backend `401 WEB_APP_KEY_UNKNOWN` must not be surfaced as 500s.
 *
 * `code` mirrors the backend error envelope so logs / devtools can
 * correlate with the backend-side metrics.
 */
export class BackendError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'BackendError';
    this.status = status;
    this.code = code;
  }
}

function getPricingApiUrl(): string {
  const url = process.env.NARRATOR_PRICING_API_URL;
  if (!url) {
    throw new Error(
      'NARRATOR_PRICING_API_URL environment variable is required. Set it in .env.local (local dev) or fly secrets (deploy).'
    );
  }
  return url;
}

const TIMEOUT_MS = 60_000;

interface SuccessEnvelope<T> {
  success: true;
  data: T;
}

interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    retryable?: boolean;
    details?: unknown;
  };
}

type Envelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

interface FetchResult<T> {
  status: number;
  envelope: Envelope<T>;
}

async function callBackend<T>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  appKey: string,
  body?: unknown
): Promise<FetchResult<T>> {
  const url = `${getPricingApiUrl()}${path}`;
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const init: RequestInit = {
      method,
      headers: {
        'X-Web-App-Key': appKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      signal: controller.signal,
    };
    if (body !== undefined) init.body = JSON.stringify(body);

    const res = await fetch(url, init);
    const envelope = (await res.json().catch(() => ({}))) as Envelope<T>;
    return { status: res.status, envelope };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      status: aborted ? 504 : 502,
      envelope: {
        success: false,
        error: {
          code: aborted ? 'BFF_UPSTREAM_TIMEOUT' : 'BFF_UPSTREAM_UNREACHABLE',
          message: (err as Error).message ?? 'backend narrator-tasks call failed',
          retryable: true,
        },
      },
    };
  } finally {
    clearTimeout(tid);
  }
}

function throwBackendError(
  status: number,
  envelope: Envelope<unknown>,
  fallbackMessage: string
): never {
  const code = envelope.success === false ? envelope.error.code : 'UNKNOWN';
  const message =
    envelope.success === false
      ? envelope.error.message || code || fallbackMessage
      : fallbackMessage;
  throw new BackendError(message, status, code);
}

// ─── Public API: mirrors master-task-db.ts function signatures ──────────────

export async function backendCreateTask(
  appKey: string,
  body: Omit<NarratorMasterTask, 'narrator_task_id' | 'created_at' | 'updated_at'>
): Promise<NarratorMasterTask> {
  const { status, envelope } = await callBackend<NarratorMasterTask>(
    'POST',
    '/narrator/tasks',
    appKey,
    body
  );
  if (status === 200 && envelope.success) return envelope.data;
  return throwBackendError(status, envelope, '创建任务失败');
}

export async function backendUpsertTask(
  appKey: string,
  fullTask: NarratorMasterTask
): Promise<NarratorMasterTask | null> {
  const { status, envelope } = await callBackend<NarratorMasterTask>(
    'POST',
    '/narrator/tasks',
    appKey,
    fullTask
  );
  if (status === 200 && envelope.success) return envelope.data;
  // Cross-tenant overwrite — preserve existing dbUpsertTask null return so
  // the route maps to 403 the same way it always did.
  if (status === 403) return null;
  return throwBackendError(status, envelope, '保存任务失败');
}

export async function backendGetTask(
  appKey: string,
  narratorTaskId: string
): Promise<NarratorMasterTask | null> {
  const { status, envelope } = await callBackend<NarratorMasterTask>(
    'GET',
    `/narrator/tasks/${encodeURIComponent(narratorTaskId)}`,
    appKey
  );
  if (status === 200 && envelope.success) return envelope.data;
  if (status === 404) return null;
  return throwBackendError(status, envelope, '获取任务失败');
}

export async function backendListTasks(opts: {
  appKey: string;
  status?: string;
  page: number;
  limit: number;
}): Promise<{ items: NarratorMasterTask[]; total: number }> {
  const params = new URLSearchParams({
    page: String(opts.page),
    limit: String(opts.limit),
  });
  if (opts.status) params.set('status', opts.status);
  const { status: httpStatus, envelope } = await callBackend<{
    items: NarratorMasterTask[];
    total: number;
  }>('GET', `/narrator/tasks?${params}`, opts.appKey);
  if (httpStatus === 200 && envelope.success) return envelope.data;
  return throwBackendError(httpStatus, envelope, '获取任务列表失败');
}

export async function backendReplaceTask(
  appKey: string,
  narratorTaskId: string,
  fullTask: NarratorMasterTask,
  expectedStatuses?: string[],
  expectedStep?: string
): Promise<NarratorMasterTask | null> {
  const params = new URLSearchParams();
  if (expectedStatuses && expectedStatuses.length) {
    params.set('expected_status', expectedStatuses.join(','));
  }
  if (expectedStep !== undefined) {
    params.set('expected_step', expectedStep);
  }
  const qs = params.toString();
  const path = `/narrator/tasks/${encodeURIComponent(narratorTaskId)}${qs ? `?${qs}` : ''}`;
  const { status, envelope } = await callBackend<NarratorMasterTask>(
    'PUT',
    path,
    appKey,
    fullTask
  );
  if (status === 200 && envelope.success) return envelope.data;
  // Either the row is gone / not ours (404) or a CAS precondition didn't
  // hold (409 CAS_MISMATCH). Collapse both to `null` — that's the contract
  // dbReplaceTask / dbCasUpdate already exposed to the orchestrator
  // (`if (!claimed) … skip-or-restart`).
  if (status === 404 || status === 409) return null;
  return throwBackendError(status, envelope, '更新任务失败');
}
