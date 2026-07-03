/**
 * 总任务客户端存储层（MySQL via Next.js API routes）
 * 所有函数均为 async，通过 /api/narrator/master-tasks 与 DB 交互。
 */

import type { NarratorMasterTask, StepName, StepRecord } from './master-task-types';

const LS_LEGACY_KEY = 'narratorai_master_tasks';

// ─── One-time localStorage → DB migration ───────────────────────────────────

/**
 * Reads any tasks still in localStorage and upserts them into the DB,
 * then clears the localStorage entry. Safe to call on every app load
 * (no-ops once localStorage is empty).
 */
export async function migrateLocalStorageToDb(appKey: string): Promise<void> {
  if (typeof window === 'undefined') return;
  const raw = localStorage.getItem(LS_LEGACY_KEY);
  if (!raw) return;
  let tasks: NarratorMasterTask[];
  try {
    tasks = JSON.parse(raw);
  } catch {
    localStorage.removeItem(LS_LEGACY_KEY);
    return;
  }
  if (!Array.isArray(tasks) || tasks.length === 0) {
    localStorage.removeItem(LS_LEGACY_KEY);
    return;
  }
  // Only migrate tasks belonging to this appKey; other appKeys' tasks stay in localStorage
  const matchingTasks = tasks.filter(t => t.app_key === appKey);
  const remainingTasks = tasks.filter(t => t.app_key !== appKey);

  if (matchingTasks.length === 0) return;

  const headers = { 'Content-Type': 'application/json', 'x-app-key': appKey };
  const results = await Promise.allSettled(
    matchingTasks.map(async (t) => {
      const r = await fetch('/api/narrator/master-tasks', { method: 'POST', headers, body: JSON.stringify(t) });
      const j = await r.json();
      if (!j.success) throw new Error(j.error ?? `HTTP ${r.status}`);
    }),
  );
  const failedTasks = matchingTasks.filter((_, i) => results[i].status === 'rejected');
  const retainTasks = [...remainingTasks, ...failedTasks];
  if (retainTasks.length > 0) {
    localStorage.setItem(LS_LEGACY_KEY, JSON.stringify(retainTasks));
    if (failedTasks.length > 0) {
      throw new Error('Migration partially failed; localStorage retained for retry');
    }
  } else {
    localStorage.removeItem(LS_LEGACY_KEY);
  }
}

// ─── ID generation (kept for callers that generate IDs client-side) ──────────

export function generateNarratorTaskId(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `${ts}_${rand}`;
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export async function createMasterTask(
  data: Omit<NarratorMasterTask, 'narrator_task_id' | 'created_at' | 'updated_at'>,
): Promise<NarratorMasterTask> {
  const r = await fetch('/api/narrator/master-tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-app-key': data.app_key },
    body: JSON.stringify(data),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.error ?? 'create failed');
  return j.data as NarratorMasterTask;
}

export async function getMasterTask(id: string, appKey?: string): Promise<NarratorMasterTask | null> {
  const headers: Record<string, string> = {};
  if (appKey) headers['x-app-key'] = appKey;
  try {
    const r = await fetch(`/api/narrator/master-tasks/${id}`, { headers });
    if (r.status === 404) return null;
    const j = await r.json();
    return j.success ? (j.data as NarratorMasterTask) : null;
  } catch {
    return null;
  }
}

export async function listMasterTasks(opts?: {
  page?: number;
  limit?: number;
  status?: string;
  app_key?: string;
}): Promise<{ items: NarratorMasterTask[]; total: number }> {
  if (!opts?.app_key) return { items: [], total: 0 };
  const sp = new URLSearchParams();
  if (opts.page)   sp.set('page',   String(opts.page));
  if (opts.limit)  sp.set('limit',  String(opts.limit));
  if (opts.status) sp.set('status', opts.status);
  try {
    const r = await fetch(`/api/narrator/master-tasks?${sp}`, {
      headers: { 'x-app-key': opts.app_key },
    });
    const j = await r.json();
    return j.success ? (j.data as { items: NarratorMasterTask[]; total: number }) : { items: [], total: 0 };
  } catch {
    return { items: [], total: 0 };
  }
}

export async function updateMasterTask(
  id: string,
  patch: Partial<Omit<NarratorMasterTask, 'narrator_task_id' | 'created_at'>>,
  appKey?: string,
): Promise<NarratorMasterTask | null> {
  const task = await getMasterTask(id, appKey);
  if (!task) return null;
  return replaceMasterTask(id, { ...task, ...patch }, appKey);
}

export async function updateMasterTaskStep(
  id: string,
  step: StepName,
  stepPatch: Partial<StepRecord>,
  masterPatch?: Partial<Pick<NarratorMasterTask, 'status' | 'current_step' | 'error_message'>>,
  appKey?: string,
): Promise<NarratorMasterTask | null> {
  const task = await getMasterTask(id, appKey);
  if (!task) return null;
  const updated: NarratorMasterTask = {
    ...task,
    ...masterPatch,
    steps: { ...task.steps, [step]: { ...(task.steps[step] ?? {}), ...stepPatch } },
    updated_at: new Date().toISOString(),
  };
  return replaceMasterTask(id, updated, appKey);
}

export async function replaceMasterTask(
  id: string,
  fullTask: NarratorMasterTask,
  appKey?: string,
): Promise<NarratorMasterTask | null> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (appKey) headers['x-app-key'] = appKey;
  try {
    const r = await fetch(`/api/narrator/master-tasks/${id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(fullTask),
    });
    const j = await r.json();
    return j.success ? (j.data as NarratorMasterTask) : null;
  } catch {
    return null;
  }
}
