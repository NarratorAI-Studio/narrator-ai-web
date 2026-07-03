/**
 * POST /api/narrator/master-tasks/[id]/sync
 *
 * 查询总任务当前步骤的远程任务真实状态，返回更新后的任务对象。
 * 前端通过 body 发送完整 task 对象，服务端不再读写文件系统。
 */

import { NextRequest, NextResponse } from 'next/server';
import type { NarratorMasterTask, StepName, StepRecord } from '@/lib/master-task-types';
import { BackendError, dbCasUpdate, dbGetTask, dbReplaceTask } from '@/lib/master-task-db';

function backendErrorResponse(e: unknown): NextResponse | null {
  if (e instanceof BackendError) {
    return NextResponse.json(
      { success: false, error: e.message, code: e.code },
      { status: e.status }
    );
  }
  return null;
}

// ─── 纯函数：内存中更新任务 ──────────────────────────────────────────────────

function applyStepUpdate(
  task: NarratorMasterTask, step: StepName,
  stepPatch: Partial<StepRecord>,
  masterPatch?: Partial<Pick<NarratorMasterTask, 'status' | 'current_step' | 'error_message'>>,
): NarratorMasterTask {
  return {
    ...task,
    ...masterPatch,
    steps: { ...task.steps, [step]: { ...(task.steps[step] ?? {}), ...stepPatch } },
    updated_at: new Date().toISOString(),
  };
}

function applyTaskUpdate(
  task: NarratorMasterTask,
  patch: Partial<Pick<NarratorMasterTask, 'status' | 'current_step' | 'error_message'>>,
): NarratorMasterTask {
  return { ...task, ...patch, updated_at: new Date().toISOString() };
}

// ─── 步骤流转 ────────────────────────────────────────────────────────────────

function resolvePostSubtitleStep(task: NarratorMasterTask): string {
  const isOriginal = task.writing_type === 1 || task.writing_type === 2;
  if (task.enable_subsync) return 'subsync';
  if (isOriginal) return 'fast_generate_writing';
  return task.use_existing_model ? 'generate_writing' : 'popular_learning';
}

function resolveNextStep(currentStep: string, task: NarratorMasterTask): string | null {
  const isOriginal = task.writing_type === 1 || task.writing_type === 2;
  switch (currentStep) {
    case 'subtitle_extract':        return 'subtitle_removal';
    case 'subtitle_removal':        return resolvePostSubtitleStep(task);
    case 'subsync':
      if (isOriginal) return 'fast_generate_writing';
      return task.use_existing_model ? 'generate_writing' : 'popular_learning';
    case 'popular_learning': return 'generate_writing';
    case 'generate_writing': return 'clip_data';
    case 'fast_generate_writing': return 'generate_fast_writing_clip_data';
    case 'generate_fast_writing_clip_data': return 'video_composing';
    case 'clip_data':        return 'video_composing';
    case 'video_composing':  return null;
    default:                 return null;
  }
}

// ─── 从远程结果提取关键字段 ──────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- upstream response shape varies per step; typed in orchestrator/state_machine.py  port, not retroactively here.
function extractStepResult(step: string, remoteData: any): Record<string, unknown> {
  if (step === 'subtitle_extract') {
    const tasks = remoteData?.results?.tasks ?? remoteData?.tasks ?? [];
    const firstTask = tasks[0] ?? {};
    return {
      raw_results: remoteData?.results ?? remoteData,
      srt_file_id: firstTask?.task_result ?? remoteData?.results?.file_id,
      task_result: firstTask?.task_result,
    };
  }
  if (step === 'subtitle_removal') {
    const tasks = remoteData?.results?.tasks ?? remoteData?.tasks ?? [];
    const firstTask = tasks[0] ?? {};
    return {
      raw_results: remoteData?.results ?? remoteData,
      video_file_id: firstTask?.task_result ?? remoteData?.results?.file_id,
      task_result: firstTask?.task_result,
    };
  }
  const results    = remoteData?.results ?? {};
  const orderInfo  = results?.order_info ?? {};
  const tasks      = results?.tasks ?? [];
  const firstTask  = tasks[0] ?? {};
  const base: Record<string, unknown> = {
    raw_results: results,
    order_num:   orderInfo?.order_num,
    step_name:   orderInfo?.step,
    status_code: orderInfo?.status,
    finished_at: remoteData?.completed_at,
  };
  if (step === 'popular_learning') {
    const learningModelId =
      orderInfo?.learning_model_id ?? orderInfo?.result ??
      (() => { try { return JSON.parse(firstTask?.task_result ?? '')?.agent_unique_code; } catch { return undefined; } })();
    return { ...base, learning_model_id: learningModelId };
  }
  if (step === 'generate_writing' || step === 'fast_generate_writing') {
    return {
      ...base,
      writing_task_id: orderInfo?.task_id ?? remoteData?.task_id,
      writing_order_num: orderInfo?.order_num,
      task_int_id: firstTask?.id,
      file_id: results?.file_ids?.[0] ?? undefined,
    };
  }
  if (step === 'generate_fast_writing_clip_data') {
    return { ...base, fast_clip_task_id: orderInfo?.task_id ?? remoteData?.task_id, task_order_num: remoteData?.task_order_num };
  }
  if (step === 'clip_data') {
    return { ...base, clip_data_task_id: orderInfo?.task_id ?? remoteData?.task_id, task_order_num: remoteData?.task_order_num };
  }
  if (step === 'video_composing') {
    return { ...base, video_url: firstTask?.video_url ?? orderInfo?.video_url, project_zip: firstTask?.project_zip ?? orderInfo?.project_zip };
  }
  return base;
}

// ─── triggerNextStep（内存版） ────────────────────────────────────────────────

async function triggerNextStep(
  nextStep: string,
  task: NarratorMasterTask,
  appKey: string | undefined,
  baseUrl: string,
): Promise<{ success: boolean; task_id?: string; error?: string }> {
  let ep = '';
  let body: Record<string, unknown> = {};
  const t = task;

  if (nextStep === 'subtitle_extract') {
    if (!t.raw_video_id) return { success: false, error: '缺少 raw_video_id' };
    ep = `${baseUrl}/api/tools/subtitle-extract`;
    body = { file_id: [t.raw_video_id], mode: 2, language: 'Auto-Detect', subtitle_position: 'auto' };
  } else if (nextStep === 'subtitle_removal') {
    if (!t.raw_video_id) return { success: false, error: '缺少 raw_video_id' };
    ep = `${baseUrl}/api/tools/subtitle-removal`;
    body = { file_ids: [t.raw_video_id], mode: t.removal_mode || 'standard' };
  } else if (nextStep === 'popular_learning') {
    ep = `${baseUrl}/api/narrator/create-popular-learning`;
    body = { video_srt_path: t.learning_srt_id || t.native_srt_id, narrator_type: t.narrator_type, model_version: t.model_version };
  } else if (nextStep === 'generate_writing') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- step result is per-step typed JSON; see orchestrator state_machine port.
    const learningModelId = (t.steps.popular_learning?.result as any)?.learning_model_id || t.existing_model_id;
    if (!learningModelId) return { success: false, error: '缺少 learning_model_id' };
    ep = `${baseUrl}/api/narrator/create-generate-writing`;
    body = {
      learning_model_id: learningModelId,
      episodes_data: [{ video_oss_key: t.native_video_id, srt_oss_key: t.native_srt_id, negative_oss_key: t.native_video_id, num: 1 }],
      playlet_name: t.playlet_name, playlet_num: '1',
      target_platform: t.target_platform, task_count: t.task_count,
      target_character_name: t.target_character_name ?? '',
      refine_srt_gaps: t.refine_gaps ? '1' : '0', story_info: t.story_info ?? '',
      vendor_requirements: t.vendor_requirements || '投放在短视频平台，吸引 18 - 35 岁的年轻用户观看',
    };
  } else if (nextStep === 'fast_generate_writing') {
    const isFirstPerson = t.narrator_type_label?.includes('第一人称') || t.narrator_type?.includes('first_person');
    ep = `${baseUrl}/api/narrator/create-fast-writing`;
    body = {
      target_mode: t.narrator_type_label === '短剧' ? 3 : (t.writing_type ?? 2),
      playlet_name: t.playlet_name ?? '',
      episodes_data: [{ video_oss_key: t.native_video_id, srt_oss_key: t.native_srt_id, negative_oss_key: t.native_video_id, num: 1 }],
      confirmed_movie_json: t.narrator_type_label === '短剧' ? '' : (t.confirmed_movie_json ?? ''),
      model: t.writing_model ?? 'flash', language: t.writing_language ?? '中文',
      perspective: isFirstPerson ? 'first_person' : 'third_person',
      target_character_name: t.target_character_name ?? '',
      ...(t.use_existing_model && t.existing_model_id ? { learning_model_id: t.existing_model_id } : {}),
      ...(!t.use_existing_model && t.learning_srt_id ? { learning_srt: t.learning_srt_id } : {}),
      vendor_requirements: t.vendor_requirements || '投放在短视频平台，吸引 18 - 35 岁的年轻用户观看',
    };
  } else if (nextStep === 'clip_data') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- step result is per-step typed JSON; see orchestrator state_machine port.
    const genResult = t.steps.generate_writing?.result as any;
    const taskIntId = genResult?.task_int_id ?? genResult?.raw_results?.tasks?.[0]?.id;
    const orderNum  = genResult?.order_num ?? genResult?.writing_order_num;
    if (!taskIntId && !orderNum) return { success: false, error: '缺少 generate_writing task int id' };
    if (!t.dubing_id) return { success: false, error: '缺少 dubing_id' };
    ep = `${baseUrl}/api/narrator/create-clip-data`;
    body = {
      ...(taskIntId ? { generate_task_id: String(taskIntId) } : {}),
      ...(orderNum  ? { order_num: orderNum } : {}),
      bgm: t.bgm_id || 'NO_BGM', dubbing: t.dubing_id, dubbing_type: 'default',
    };
  } else if (nextStep === 'generate_fast_writing_clip_data') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- step result is per-step typed JSON; see orchestrator state_machine port.
    const fastResult = t.steps.fast_generate_writing?.result as any;
    const taskId = String(fastResult?.writing_task_id ?? fastResult?.raw_results?.order_info?.task_id ?? '');
    let fileId = String(fastResult?.file_id ?? fastResult?.raw_results?.file_ids?.[0] ?? '');
    if (!fileId) {
      const taskResult = fastResult?.raw_results?.tasks?.[0]?.task_result;
      if (typeof taskResult === 'string' && taskResult.trim()) {
        try { const parsed = JSON.parse(taskResult); fileId = String(parsed?.file_id ?? parsed?.data?.file_id ?? ''); } catch { fileId = ''; }
      }
    }
    if (!taskId) return { success: false, error: '缺少 fast_generate_writing task_id' };
    if (!fileId) return { success: false, error: '缺少 fast_generate_writing file_id' };
    if (!t.dubing_id) return { success: false, error: '缺少 dubing_id' };
    ep = `${baseUrl}/api/narrator/create-fast-writing-clip-data`;
    body = {
      task_id: taskId, file_id: fileId, playlet_name: t.playlet_name ?? '',
      bgm: t.bgm_id || 'NO_BGM', dubbing: t.dubing_id, dubbing_type: '普通话',
      subtitle_style: {}, custom_cover: [],
      episodes_data: [{ video_oss_key: t.native_video_id, negative_oss_key: t.native_video_id, srt_oss_key: t.native_srt_id, num: 1 }],
    };
  } else if (nextStep === 'video_composing') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- step result is per-step typed JSON; see orchestrator state_machine port.
    const clipResult = (t.steps.clip_data?.result ?? t.steps.generate_fast_writing_clip_data?.result) as any;
    const orderNum = clipResult?.task_order_num;
    if (!orderNum) return { success: false, error: '找不到剪辑步骤 task_order_num' };
    ep = `${baseUrl}/api/narrator/create-video-composing`;
    body = { order_num: orderNum };
  } else {
    return { success: false, error: `未知步骤: ${nextStep}` };
  }

  const r = await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-app-key': appKey ?? '' }, body: JSON.stringify(body) });
  const j = await r.json();
  return j.success ? { success: true, task_id: j.data?.task_id } : { success: false, error: j.error };
}

// ─── 主处理函数 ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const appKey = req.headers.get('x-app-key');
    // Latent gap surfaced by regression coverage: sync/ was the only master-task route that
    // didn't 401 on missing app-key. With the MySQL store an absent appKey
    // dropped the `WHERE app_key = ?` filter and let an unauthenticated
    // caller CAS-update any tenant's row. Backend rejects with
    // WEB_APP_KEY_MISSING anyway; reject up front so the response code
    // stays 401 (not 500-via-catch).
    if (!appKey) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
    const body = await req.json();
    let task = body.task as NarratorMasterTask;
    if (!task || task.narrator_task_id !== id) {
      return NextResponse.json({ success: false, error: 'Invalid task data' }, { status: 400 });
    }

    if (task.status === 'completed' || task.status === 'failed') {
      return NextResponse.json({ success: true, synced: false, message: `总任务已${task.status === 'completed' ? '完成' : '失败'}，无需同步` });
    }

    const currentStep = task.current_step as string;
    if (!currentStep || currentStep === 'completed') {
      return NextResponse.json({ success: true, synced: false, message: '无待同步步骤' });
    }

    const stepRecord = task.steps[currentStep as keyof typeof task.steps];
    const remoteTaskId = stepRecord?.task_id;
    if (!remoteTaskId) {
      return NextResponse.json({ success: true, synced: false, message: '当前步骤尚未提交远程任务' });
    }

    // 短路：本地步骤已经标记为 completed
    if (stepRecord?.status === 'completed') {
      const nextStep = resolveNextStep(currentStep, task);
      if (!nextStep) {
        task = applyTaskUpdate(task, { status: 'completed', current_step: 'completed' });
        return NextResponse.json({ success: true, synced: true, step_done: true, all_done: true, data: task });
      }
      if (task.run_auto === 0) {
        task = applyTaskUpdate(task, { status: 'paused', current_step: nextStep as StepName });
        return NextResponse.json({ success: true, synced: true, step_done: true, auto_advanced: false, next_step: nextStep, data: task });
      }
      // run_auto === 1: 如果下一步已有 task_id 或已处于 running/completed，说明已触发过，直接返回
      const nextStepRecord = task.steps[nextStep as StepName];
      if (nextStepRecord?.task_id || nextStepRecord?.status === 'running' || nextStepRecord?.status === 'completed') {
        task = applyTaskUpdate(task, { current_step: nextStep as StepName });
        return NextResponse.json({ success: true, synced: true, step_done: true, auto_advanced: true, next_step: nextStep, data: task });
      }
    }

    // 1. 查询远程任务状态
    const host = req.headers.get('host') || 'localhost:3001';
    const proto = process.env.NEXT_PUBLIC_BASE_URL?.startsWith('https') ? 'https' : 'http';
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `${proto}://${host}`;

    let queryUrl = `${baseUrl}/api/narrator/commentary/${remoteTaskId}`;
    if (currentStep === 'subtitle_extract')  queryUrl = `${baseUrl}/api/narrator/query-subtitle-extract/${remoteTaskId}`;
    if (currentStep === 'subtitle_removal')  queryUrl = `${baseUrl}/api/narrator/query-subtitle-removal/${remoteTaskId}`;
    const qr = await fetch(queryUrl, { headers: { 'x-app-key': appKey ?? '' } });
    if (!qr.ok) return NextResponse.json({ success: false, error: '查询远程任务失败' }, { status: 502 });
    const qj = await qr.json();
    if (!qj.success) return NextResponse.json({ success: false, error: qj.error || '远程接口异常' }, { status: 502 });

    const remoteStatus: number = qj.data?.status ?? qj.data?.task_status ?? -1;

    // 2. 仍在进行中
    if (remoteStatus === 0 || remoteStatus === 1) {
      return NextResponse.json({ success: true, synced: false, step_done: false, message: '远程任务仍在进行中', remote_status: remoteStatus });
    }

    // 3. 远程失败
    if (remoteStatus === 3 || remoteStatus === 4) {
      const errMsg = `远程任务 ${remoteTaskId} 状态: ${remoteStatus === 3 ? '失败' : '已取消'}`;
      task = applyStepUpdate(task, currentStep as StepName,
        { status: 'failed', error: errMsg, completed_at: new Date().toISOString() },
        { status: 'failed', error_message: errMsg });
      return NextResponse.json({ success: true, synced: true, step_done: false, failed: true, data: task });
    }

    // 4. 远程已完成 (status=2)
    const now = new Date().toISOString();
    const stepResult = extractStepResult(currentStep, qj.data);
    task = applyStepUpdate(task, currentStep as StepName, { status: 'completed', completed_at: now, result: stepResult });

    const nextStep = resolveNextStep(currentStep, task);
    if (!nextStep) {
      task = applyTaskUpdate(task, { status: 'completed', current_step: 'completed' });
      return NextResponse.json({ success: true, synced: true, step_done: true, all_done: true, data: task });
    }

    // 5. 根据 run_auto 决定是否自动推进
    if (task.run_auto === 1) {
      // Cutover (Backend API contract / regression coverage): when the
      // backend orchestrator is on, this route hands triggering off
      // entirely. We still persist the "current step is locally
      // completed" intermediate state so the UI reflects it
      // immediately, but we do NOT advance current_step and do NOT
      // call triggerNextStep. The backend scan picks the row up
      // (status=running, run_auto=1) and lands on advance.py's
      // short-circuit branch — it sees step.status='completed', walks
      // to nextStep, claims via CAS, and triggers upstream itself.
      //
      // Persist via dbCasUpdate (NOT dbReplaceTask) gated on
      // expected_step=currentStep. Critical review finding from review: an
      // unconditional full replace would overwrite a newer
      // current_step pointer if the backend orchestrator already
      // advanced the row during the rollout overlap window.
      //
      // dbCasUpdate collapses both 404 (row gone / cross-tenant) and
      // 409 (CAS mismatch) into null — we treat either as "another
      // writer owns this now," return success without overwriting,
      // and let the client refetch on its next poll to pick up the
      // backend's view. Mirrors the existing pattern at the legacy
      // path below (line ~370 `if (!claimed) …`).
      if (process.env.NEXT_PUBLIC_BACKEND_ORCHESTRATOR_ON === '1') {
        const claimed = await dbCasUpdate(
          id, task, ['running', 'paused', 'pending'], currentStep, appKey,
        );
        if (!claimed) {
          // Critical review subsequent update: returning `data: task` here
          // makes things worse, not better — the client treats the
          // sync response as authoritative and writes it back to its
          // own store, so the stale local snapshot we hand over here
          // would clobber whatever the backend orchestrator just
          // advanced to. Refetch the backend's current row and return
          // THAT as `data`. Also flip synced:false so any caller that
          // gates persistence on `synced` skips the write entirely.
          // Falls back to the local task only if the refetch itself
          // fails — in that case the client at least has its
          // pre-mismatch view rather than nothing, and the next
          // poll will reconcile.
          let authoritative: NarratorMasterTask | null = null;
          try {
            authoritative = await dbGetTask(id, appKey);
          } catch {
            authoritative = null;
          }
          return NextResponse.json({
            success: true, synced: false, step_done: true,
            auto_advanced: false, backend_orchestrator: true,
            cas_mismatch: true,
            message: '后端调度器已推进，已重新拉取最新状态',
            next_step: nextStep, data: authoritative ?? task,
          });
        }
        return NextResponse.json({
          success: true, synced: true, step_done: true,
          auto_advanced: false, backend_orchestrator: true,
          next_step: nextStep, data: claimed,
        });
      }

      // 若下一步骤已有 task_id（客户端已保存过触发结果），直接推进 current_step 即可
      const existingNext = task.steps[nextStep as StepName];
      if (existingNext?.task_id || existingNext?.status === 'running' || existingNext?.status === 'completed') {
        task = applyTaskUpdate(task, { current_step: nextStep as StepName });
        return NextResponse.json({ success: true, synced: true, step_done: true, auto_advanced: true, next_step: nextStep, data: task });
      }

      // Cluster-wide dedup via DB CAS: atomically advance current_step from
      // <currentStep> to <nextStep> in a single UPDATE. If another machine /
      // tab / refresh already advanced, affectedRows is 0 and we skip the
      // remote trigger. The in-memory Map this replaces was per-process and
      // failed across Fly machines and restarts.
      const nextStepName = nextStep as StepName;
      const advancingTask = applyStepUpdate(task, nextStepName, { status: 'running', started_at: now }, { current_step: nextStepName });
      const claimed = await dbCasUpdate(id, advancingTask, ['running', 'paused', 'pending'], currentStep, appKey);
      if (!claimed) {
        task = applyTaskUpdate(task, { current_step: nextStep as StepName });
        return NextResponse.json({ success: true, synced: false, message: '步骤已在推进中，请勿重复触发', data: task });
      }
      task = claimed;

      const nextResult = await triggerNextStep(nextStep, task, appKey, baseUrl);
      if (nextResult.success) {
        task = applyStepUpdate(task, nextStepName, { status: 'running', task_id: nextResult.task_id });
      } else {
        // Do not roll current_step back: fetch already left the server and the
        // remote may have committed. Mark nextStep failed so an operator
        // reconciles, same reasoning as next-step/route.ts after regression coverage.
        task = applyStepUpdate(task, nextStepName, { status: 'failed', error: nextResult.error }, { status: 'failed', error_message: nextResult.error });
      }

      // Persist the final task state server-side. Without this the DB stays at
      // the intermediate CAS-claim state (current_step=nextStep, running, no
      // task_id), and the client may fail to backfill (tab closed, network
      // drop). A subsequent sync would then see no task_id and report "尚未提
      // 交远程任务", while next-step would treat it as fresh and POST the
      // remote again. Persist here so the DB is the source of truth after
      // every advance.
      let persisted = false;
      for (let i = 0; i < 3 && !persisted; i++) {
        if (await dbReplaceTask(id, task, appKey)) persisted = true;
      }
      if (!persisted) {
        return NextResponse.json(
          {
            success: false,
            error: `远端步骤已${nextResult.success ? '触发' : '失败'}，但本地状态保存失败，请联系部署管理员处理（步骤: ${nextStepName}，远端 ID: ${nextResult.task_id ?? '未知'}）`,
          },
          { status: 503 },
        );
      }

      return NextResponse.json({
        success: true, synced: true, step_done: true,
        auto_advanced: nextResult.success, next_step: nextStep,
        auto_error: nextResult.success ? undefined : nextResult.error,
        data: task,
      });
    } else {
      task = applyTaskUpdate(task, { status: 'paused', current_step: nextStep as StepName });
      return NextResponse.json({
        success: true, synced: true, step_done: true,
        auto_advanced: false, next_step: nextStep, data: task,
      });
    }
  } catch (err: unknown) {
    return (
      backendErrorResponse(err) ??
      NextResponse.json(
        { success: false, error: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      )
    );
  }
}
