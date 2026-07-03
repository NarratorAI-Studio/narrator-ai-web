/**
 * Server-side CRUD for narrator master tasks. Thin HTTP shim that
 * forwards to narrator-ai-web-backend `/narrator/tasks` (the implementation requirement).
 *
 * History: this module used to talk directly to a managed MySQL
 * `narrator_master_tasks` table via `mysql2` (kept in `src/lib/db.ts`),
 * which was a temporary stopgap while the Fly Postgres backend wasn't
 * ready. The master-task storage now lives in Postgres behind
 * `require_web_user_auth`; the function shape preserved here keeps the
 * 4 callers (`master-tasks/route.ts`, `[id]/route.ts`,
 * `[id]/next-step/route.ts`, `[id]/sync/route.ts`) untouched.
 *
 * One signature tightening: `appKey` flipped from optional to required
 * on `dbGetTask` / `dbReplaceTask` / `dbCasUpdate`. All current callers
 * already pass it after their own 401 check, and the backend can't
 * authenticate without it — failing fast in TS is better than a runtime
 * `WEB_APP_KEY_MISSING` round-trip.
 *
 * Stage C (separate subsequent update) will remove `src/lib/db.ts`, the
 * `mysql2` dependency, and the `MYSQL_*` env vars from fly.toml.
 */

import type { NarratorMasterTask } from './master-task-types';
import {
  backendCreateTask,
  backendGetTask,
  backendListTasks,
  backendReplaceTask,
  backendUpsertTask,
} from './master-task-backend-client';

// Re-exported so route catch blocks can read `e.status` / `e.code` and
// forward the right HTTP code instead of defaulting to 500 on every
// throw.
export { BackendError } from './master-task-backend-client';

export async function dbCreateTask(
  data: Omit<NarratorMasterTask, 'narrator_task_id' | 'created_at' | 'updated_at'>
): Promise<NarratorMasterTask> {
  return backendCreateTask(data.app_key, data);
}

export async function dbGetTask(
  id: string,
  appKey: string
): Promise<NarratorMasterTask | null> {
  return backendGetTask(appKey, id);
}

export async function dbListTasks(opts: {
  app_key: string;
  status?: string;
  page?: number;
  limit?: number;
}): Promise<{ items: NarratorMasterTask[]; total: number }> {
  return backendListTasks({
    appKey: opts.app_key,
    status: opts.status,
    page: opts.page ?? 1,
    limit: opts.limit ?? 20,
  });
}

export async function dbReplaceTask(
  id: string,
  fullTask: NarratorMasterTask,
  appKey: string
): Promise<NarratorMasterTask | null> {
  return backendReplaceTask(appKey, id, fullTask);
}

/**
 * CAS update: saves `updatedTask` only if the row's current
 * - status is in `expectedStatuses`, AND
 * - (if provided) current_step == `expectedStep`.
 *
 * Returns the saved task on success, `null` if the condition wasn't
 * met (orchestrator should treat this as a conflict — another request
 * already moved the row past this step) or the row is gone / not ours.
 * Backend distinguishes 404 (missing / cross-tenant) from 409
 * (CAS_MISMATCH); both collapse to `null` here, matching the existing
 * `if (!claimed) …` orchestrator pattern.
 */
export async function dbCasUpdate(
  id: string,
  updatedTask: NarratorMasterTask,
  expectedStatuses: string[],
  expectedStep: string | undefined,
  appKey: string
): Promise<NarratorMasterTask | null> {
  return backendReplaceTask(
    appKey,
    id,
    updatedTask,
    expectedStatuses,
    expectedStep
  );
}

/**
 * Upsert by full task object — preserves the client-supplied
 * `narrator_task_id` and the original `created_at`. Backend rejects
 * cross-tenant overwrites with 403; we return `null` so the route can
 * map to `Forbidden` the same way it did against MySQL's
 * `SELECT ... FOR UPDATE` check.
 */
export async function dbUpsertTask(
  fullTask: NarratorMasterTask
): Promise<NarratorMasterTask | null> {
  return backendUpsertTask(fullTask.app_key, fullTask);
}
