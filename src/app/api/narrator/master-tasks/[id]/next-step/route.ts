/**
 * POST /api/narrator/master-tasks/[id]/next-step
 *
 * 前端通过 body 发送完整 task 对象，服务端不再读写文件系统。
 * - paused 状态：current_step 指向"待启动"的步骤，直接触发该步骤的远程 API
 * - running 状态：current_step 指向"正在跑"的步骤，查询其远程状态
 */

import { NextRequest, NextResponse } from 'next/server';
import type { NarratorMasterTask, StepName, StepRecord } from '@/lib/master-task-types';
import { BackendError, dbCasUpdate, dbGetTask, dbReplaceTask } from '@/lib/master-task-db';
import { buildEpisodesData } from '@/lib/master-task-episodes';

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
    case 'popular_learning':        return 'generate_writing';
    case 'generate_writing':        return 'clip_data';
    case 'fast_generate_writing':   return 'generate_fast_writing_clip_data';
    case 'generate_fast_writing_clip_data': return 'video_composing';
    case 'clip_data':               return 'video_composing';
    case 'video_composing':         return null;
    default:                        return null;
  }
}

// ─── buildStepCall ───────────────────────────────────────────────────────────

function buildStepCall(
  stepName: string, t: NarratorMasterTask, baseUrl: string,
): { ep: string; body: Record<string, unknown> } | { error: string } {
  if (stepName === 'subtitle_extract') {
    if (!t.raw_video_id) return { error: '缺少原始视频 raw_video_id' };
    return { ep: `${baseUrl}/api/tools/subtitle-extract`, body: { file_id: [t.raw_video_id], mode: 2, language: 'Auto-Detect', subtitle_position: 'auto' } };
  }
  if (stepName === 'subtitle_removal') {
    if (!t.raw_video_id) return { error: '缺少原始视频 raw_video_id' };
    return { ep: `${baseUrl}/api/tools/subtitle-removal`, body: { file_ids: [t.raw_video_id], mode: t.removal_mode || 'standard' } };
  }
  if (stepName === 'subsync') {
    return { ep: `${baseUrl}/api/narrator/create-subsync`, body: { episodes_data: buildEpisodesData(t, { withNegative: false }) } };
  }
  if (stepName === 'popular_learning') {
    return { ep: `${baseUrl}/api/narrator/create-popular-learning`, body: { video_srt_path: t.learning_srt_id || t.native_srt_id, narrator_type: t.narrator_type, model_version: t.model_version } };
  }
  if (stepName === 'generate_writing') {
    const learningModelId = (t.steps.popular_learning?.result as any)?.learning_model_id || t.existing_model_id;
    if (!learningModelId) return { error: '找不到 learning_model_id，请等待爆款学习完成' };
    return {
      ep: `${baseUrl}/api/narrator/create-generate-writing`,
      body: {
        learning_model_id: learningModelId,
        episodes_data: buildEpisodesData(t, { withNegative: true }),
        playlet_name: t.playlet_name, playlet_num: '1', target_platform: t.target_platform, task_count: t.task_count,
        target_character_name: t.target_character_name ?? '', refine_srt_gaps: t.refine_gaps ? '1' : '0', story_info: t.story_info ?? '',
        vendor_requirements: t.vendor_requirements || '投放在短视频平台，吸引 18 - 35 岁的年轻用户观看',
      },
    };
  }
  if (stepName === 'fast_generate_writing') {
    const perspective = (t.narrator_type_label?.includes('第一人称') || t.narrator_type?.includes('first_person')) ? 'first_person' : 'third_person';
    const body: Record<string, unknown> = {
      target_mode: t.narrator_type_label === '短剧' ? 3 : (t.writing_type ?? 2),
      playlet_name: t.playlet_name ?? '',
      episodes_data: buildEpisodesData(t, { withNegative: true }),
      confirmed_movie_json: t.narrator_type_label === '短剧' ? '' : (t.confirmed_movie_json ?? ''),
      model: t.writing_model ?? 'flash', language: t.writing_language ?? '中文', perspective,
      target_character_name: t.target_character_name ?? '',
    };
    if (t.use_existing_model && t.existing_model_id) body.learning_model_id = t.existing_model_id;
    else if (t.learning_srt_id) body.learning_srt = t.learning_srt_id;
    body.vendor_requirements = t.vendor_requirements || '投放在短视频平台，吸引 18 - 35 岁的年轻用户观看';
    return { ep: `${baseUrl}/api/narrator/create-fast-writing`, body };
  }
  if (stepName === 'clip_data') {
    const genResult = t.steps.generate_writing?.result as any;
    const taskIntId = genResult?.task_int_id ?? genResult?.raw_results?.tasks?.[0]?.id;
    const orderNum  = genResult?.order_num ?? genResult?.writing_order_num;
    if (!taskIntId && !orderNum) return { error: '找不到文案步骤 task int id，请等待文案生成完成' };
    if (!t.dubing_id) return { error: '缺少 dubing_id' };
    return {
      ep: `${baseUrl}/api/narrator/create-clip-data`,
      body: { ...(taskIntId ? { generate_task_id: String(taskIntId) } : {}), ...(orderNum ? { order_num: orderNum } : {}), bgm: t.bgm_id || 'NO_BGM', dubbing: t.dubing_id, dubbing_type: 'default' },
    };
  }
  if (stepName === 'generate_fast_writing_clip_data') {
    const fastResult = t.steps.fast_generate_writing?.result as any;
    const taskId = String(fastResult?.writing_task_id ?? fastResult?.raw_results?.order_info?.task_id ?? '');
    let fileId = String(fastResult?.file_id ?? fastResult?.raw_results?.file_ids?.[0] ?? '');
    if (!fileId) {
      const taskResult = fastResult?.raw_results?.tasks?.[0]?.task_result;
      if (typeof taskResult === 'string' && taskResult.trim()) {
        try { const parsed = JSON.parse(taskResult); fileId = String(parsed?.file_id ?? parsed?.data?.file_id ?? ''); } catch { fileId = ''; }
      }
    }
    if (!taskId) return { error: '找不到原创文案任务 task_id，请等待原创文案完成' };
    if (!fileId) return { error: '找不到原创文案产物 file_id，请确认原创文案结果是否完整' };
    if (!t.dubing_id) return { error: '缺少 dubing_id' };
    return {
      ep: `${baseUrl}/api/narrator/create-fast-writing-clip-data`,
      body: {
        task_id: taskId, file_id: fileId, playlet_name: t.playlet_name ?? '',
        bgm: t.bgm_id || 'NO_BGM', dubbing: t.dubing_id, dubbing_type: '普通话',
        subtitle_style: {}, custom_cover: [],
        episodes_data: buildEpisodesData(t, { withNegative: true }),
      },
    };
  }
  if (stepName === 'video_composing') {
    const clipResult = (t.steps.clip_data?.result ?? t.steps.generate_fast_writing_clip_data?.result) as any;
    const orderNum = clipResult?.task_order_num;
    if (!orderNum) return { error: '找不到剪辑步骤 task_order_num，请等待剪辑数据生成完成' };
    return { ep: `${baseUrl}/api/narrator/create-video-composing`, body: { order_num: orderNum } };
  }
  return { error: `未知步骤: ${stepName}` };
}

// ─── extractResult ───────────────────────────────────────────────────────────

function extractResult(stepName: string, remoteData: any): Record<string, unknown> {
  if (stepName === 'subtitle_extract') {
    const tasks = remoteData?.results?.tasks ?? remoteData?.tasks ?? [];
    const firstTask = tasks[0] ?? {};
    return { raw_results: remoteData?.results ?? remoteData, srt_file_id: firstTask?.task_result ?? remoteData?.results?.file_id, task_result: firstTask?.task_result };
  }
  if (stepName === 'subtitle_removal') {
    const tasks = remoteData?.results?.tasks ?? remoteData?.tasks ?? [];
    const firstTask = tasks[0] ?? {};
    return { raw_results: remoteData?.results ?? remoteData, video_file_id: firstTask?.task_result ?? remoteData?.results?.file_id, task_result: firstTask?.task_result };
  }
  const results = remoteData?.results ?? {};
  const orderInfo = results?.order_info ?? {};
  const tasks = results?.tasks ?? [];
  const firstTask = tasks[0] ?? {};
  const base = { raw_results: results, order_num: orderInfo?.order_num, step_name: orderInfo?.step, status_code: orderInfo?.status, finished_at: remoteData?.completed_at };
  if (stepName === 'popular_learning') {
    return { ...base, learning_model_id: orderInfo?.learning_model_id ?? orderInfo?.result ?? (() => { try { return JSON.parse(firstTask?.task_result ?? '')?.agent_unique_code; } catch { return undefined; } })() };
  }
  if (stepName === 'generate_writing' || stepName === 'fast_generate_writing') {
    return { ...base, writing_task_id: orderInfo?.task_id ?? remoteData?.task_id, task_int_id: firstTask?.id, file_id: results?.file_ids?.[0] };
  }
  if (stepName === 'generate_fast_writing_clip_data') return { ...base, fast_clip_task_id: orderInfo?.task_id ?? remoteData?.task_id, task_order_num: remoteData?.task_order_num };
  if (stepName === 'clip_data') return { ...base, clip_data_task_id: orderInfo?.task_id ?? remoteData?.task_id, task_order_num: remoteData?.task_order_num };
  if (stepName === 'video_composing') return { ...base, video_url: firstTask?.video_url ?? orderInfo?.video_url, project_zip: firstTask?.project_zip };
  return base;
}

function getQueryEndpoint(stepName: string, remoteTaskId: string, baseUrl: string): string {
  if (stepName === 'subtitle_extract')  return `${baseUrl}/api/narrator/query-subtitle-extract/${remoteTaskId}`;
  if (stepName === 'subtitle_removal')  return `${baseUrl}/api/narrator/query-subtitle-removal/${remoteTaskId}`;
  return `${baseUrl}/api/narrator/commentary/${remoteTaskId}`;
}

// Retry wrapper for task_id writes: throws after exhausting attempts so callers
// can return a 5xx instead of silently reporting success with lost state.
async function replaceWithRetry(
  id: string, task: NarratorMasterTask, appKey: string, attempts = 3,
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    const ok = await dbReplaceTask(id, task, appKey);
    if (ok) return;
  }
  throw new Error('TASK_ID_PERSIST_FAILED');
}

// ─── 主处理函数 ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const appKey = req.headers.get('x-app-key');
    if (!appKey) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
    const proto = req.headers.get('x-forwarded-proto') || 'http';
    const host = req.headers.get('host') || 'localhost:3000';
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `${proto}://${host}`;

    const body = await req.json();
    const clientTask = body.task as NarratorMasterTask;
    if (!clientTask || clientTask.narrator_task_id !== id) {
      return NextResponse.json({ success: false, error: 'Invalid task data' }, { status: 400 });
    }

    // Load authoritative task from DB — never trust client body for writes
    let task = await dbGetTask(id, appKey);
    if (!task) return NextResponse.json({ success: false, error: 'NOT_FOUND' }, { status: 404 });

    if (task.status === 'completed') return NextResponse.json({ success: false, error: '总任务已全部完成' }, { status: 400 });
    if (task.status === 'failed')    return NextResponse.json({ success: false, error: '总任务已失败，无法继续' }, { status: 400 });

    const currentStep = task.current_step as string;
    if (!currentStep || currentStep === 'completed') {
      return NextResponse.json({ success: false, error: '没有待继续的步骤' }, { status: 400 });
    }

    const stepRecord   = task.steps[currentStep as keyof typeof task.steps];
    const remoteTaskId = stepRecord?.task_id;
    const now = new Date().toISOString();

    // 补全旧任务缺失的 task_order_num
    if (currentStep === 'video_composing') {
      const clipStepName = (task.steps.clip_data ? 'clip_data' : 'generate_fast_writing_clip_data') as StepName;
      const clipStep = task.steps[clipStepName];
      const clipResult = clipStep?.result as any;
      if (clipStep?.status === 'completed' && !clipResult?.task_order_num && clipStep?.task_id) {
        try {
          const qr = await fetch(`${baseUrl}/api/narrator/commentary/${clipStep.task_id}`, { headers: { 'x-app-key': appKey ?? '' } });
          const qj = await qr.json();
          if (qj.success && qj.data?.task_order_num) {
            const patched = { ...clipResult, task_order_num: qj.data.task_order_num };
            task = applyStepUpdate(task, clipStepName, { result: patched });
          }
        } catch { /* fall through */ }
      }
    }

    // 情形 A：current_step 尚未启动
    if (!remoteTaskId) {
      // Guard: a prior attempt left REMOTE_CALL_UNCERTAIN on this step, meaning
      // a remote task may already exist that we cannot see. Refuse to silently
      // create another one — the user must contact support to reconcile (and
      // the step.error field must be cleared out-of-band before this step can
      // be re-tried).
      if (stepRecord?.error === 'REMOTE_CALL_UNCERTAIN') {
        return NextResponse.json(
          { success: false, error: `步骤 ${currentStep} 上次调用结果不确定，远端可能已存在任务，请联系部署管理员核对后再继续` },
          { status: 409 },
        );
      }

      const call = buildStepCall(currentStep, task, baseUrl);
      if ('error' in call) return NextResponse.json({ success: false, error: call.error }, { status: 400 });

      const stepName = currentStep as StepName;
      const runningTask = applyStepUpdate(task, stepName, { status: 'running', started_at: now }, { status: 'running', current_step: stepName });

      // CAS: atomically claim the slot in DB before calling external API.
      // Prevents duplicate external calls when the user clicks "继续" multiple times rapidly.
      const claimed = await dbCasUpdate(id, runningTask, ['paused', 'pending'], currentStep, appKey);
      if (!claimed) {
        return NextResponse.json({ success: false, still_running: true, error: '步骤已在处理中，请勿重复提交' });
      }
      task = claimed;

      // Any failure between sending the request and parsing the response could
      // mean the remote committed the task while we lost the answer: network
      // drop after the server commit, RST mid-response, or JSON parse error on
      // a partial body. fetch() throwing does NOT prove the request never
      // reached the remote — connection errors can surface after the POST
      // landed. We cannot distinguish "remote did nothing" from "remote did
      // something we cannot see", so do NOT revert to pending: a retry would
      // re-enter Case A and create a duplicate remote job. Mark the task
      // failed and surface to support for reconciliation.
      let nr: Response, nj: any;
      try {
        nr = await fetch(call.ep, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-app-key': appKey }, body: JSON.stringify(call.body) });
        nj = await nr.json();
      } catch {
        // Keep master.status = paused so the user is not permanently locked
        // out of next-step (route line ~216 rejects 'failed' master tasks).
        // The step record carries REMOTE_CALL_UNCERTAIN; the guard at Case A
        // entry prevents a silent retry from creating a duplicate remote job.
        const failedTask: NarratorMasterTask = {
          ...task, status: 'paused',
          steps: { ...task.steps, [stepName]: { status: 'failed', error: 'REMOTE_CALL_UNCERTAIN' } },
          error_message: '调用外部 API 异常，无法确认是否已创建任务',
          updated_at: new Date().toISOString(),
        };
        try {
          await replaceWithRetry(id, failedTask, appKey);
        } catch {
          return NextResponse.json(
            { success: false, error: `调用外部 API 异常且本地保护状态写入失败，远端可能已创建任务，请联系部署管理员处理（步骤: ${stepName}）` },
            { status: 503 },
          );
        }
        return NextResponse.json(
          { success: false, error: `调用外部 API 异常，无法确认任务是否已创建，请联系部署管理员核对（步骤: ${stepName}）` },
          { status: 502 },
        );
      }

      if (nj.success) {
        task = applyStepUpdate(task, stepName, { task_id: nj.data?.task_id });
        try {
          await replaceWithRetry(id, task, appKey);
        } catch {
          // task_id could not be persisted after 3 attempts. Keep task_id in the step and
          // only set master status to paused so the next retry enters Case B (query the
          // existing remote task) instead of Case A (create a duplicate remote job).
          const recoveryTask: NarratorMasterTask = { ...task, status: 'paused', updated_at: new Date().toISOString() };
          try {
            await replaceWithRetry(id, recoveryTask, appKey);
            return NextResponse.json(
              { success: false, error: `步骤已启动但状态保存失败，任务已暂停，可点击「继续」查询远端进度。远端任务 ID: ${nj.data?.task_id ?? '未知'}` },
              { status: 503 },
            );
          } catch {
            return NextResponse.json(
              { success: false, error: `步骤已启动但状态保存多次失败，请联系部署管理员手工修复。远端任务 ID: ${nj.data?.task_id ?? '未知'}` },
              { status: 503 },
            );
          }
        }
        return NextResponse.json({ success: true, started_step: currentStep, next_step: currentStep, data: task });
      } else {
        task = applyStepUpdate(task, stepName, { status: 'failed', error: nj.error }, { status: 'failed', error_message: nj.error });
        await dbReplaceTask(id, task, appKey);
        return NextResponse.json({ success: false, error: nj.error || '启动步骤失败', data: task }, { status: 502 });
      }
    }

    // 情形 B：current_step 已有远程任务，查询状态
    const queryUrl = getQueryEndpoint(currentStep, remoteTaskId, baseUrl);
    const qr = await fetch(queryUrl, { headers: { 'x-app-key': appKey ?? '' } });
    const qj = await qr.json();
    if (!qj.success) return NextResponse.json({ success: false, error: '查询远程任务状态失败' }, { status: 502 });

    const remoteStatus: number = qj.data?.status ?? -1;
    if (remoteStatus === 0 || remoteStatus === 1) {
      return NextResponse.json({ success: false, still_running: true, error: '当前步骤仍在进行中，请稍后再试' });
    }
    if (remoteStatus === 3 || remoteStatus === 4) {
      task = applyStepUpdate(task, currentStep as StepName, { status: 'failed', error: `远程状态: ${remoteStatus}` }, { status: 'failed', error_message: '远程任务失败' });
      await dbReplaceTask(id, task, appKey);
      return NextResponse.json({ success: false, error: '远程任务失败或已取消', data: task }, { status: 400 });
    }

    // 远程已完成：存储结果，推进到下一步
    const stepResult = extractResult(currentStep, qj.data);
    task = applyStepUpdate(task, currentStep as StepName, { status: 'completed', completed_at: now, result: stepResult });

    const nextStep = resolveNextStep(currentStep, task);
    if (!nextStep) {
      task = applyStepUpdate(task, currentStep as StepName, {}, { status: 'completed', current_step: 'completed' });
      await dbReplaceTask(id, task, appKey);
      return NextResponse.json({ success: true, all_done: true, message: '所有步骤已完成', data: task });
    }

    const nextCall = buildStepCall(nextStep, task, baseUrl);
    if ('error' in nextCall) {
      await dbReplaceTask(id, task, appKey);
      return NextResponse.json({ success: false, error: nextCall.error, data: task }, { status: 400 });
    }

    const nextStepName = nextStep as StepName;
    const advancingTask = applyStepUpdate(task, nextStepName, { status: 'running', started_at: now }, { status: 'running', current_step: nextStepName });

    // CAS: advance current_step only if DB still shows the same currentStep.
    // Prevents two concurrent "继续" calls on a just-completed step both triggering the next API.
    const advanceClaimed = await dbCasUpdate(id, advancingTask, ['running', 'paused'], currentStep, appKey);
    if (!advanceClaimed) {
      return NextResponse.json({ success: false, still_running: true, error: '步骤已在处理中，请勿重复提交' });
    }
    task = advanceClaimed;

    // See Case A above for the rationale: any failure from request send to
    // response parse is treated as remote-possibly-committed; do not revert.
    let nr: Response, nj: any;
    try {
      nr = await fetch(nextCall.ep, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-app-key': appKey }, body: JSON.stringify(nextCall.body) });
      nj = await nr.json();
    } catch {
      // Same rationale as Case A — keep master paused, step failed; the
      // Case A entry guard catches the next attempt and routes to support.
      const failedTask: NarratorMasterTask = {
        ...task, status: 'paused',
        steps: { ...task.steps, [nextStepName]: { status: 'failed', error: 'REMOTE_CALL_UNCERTAIN' } },
        error_message: '调用外部 API 异常，无法确认是否已创建任务',
        updated_at: new Date().toISOString(),
      };
      try {
        await replaceWithRetry(id, failedTask, appKey);
      } catch {
        return NextResponse.json(
          { success: false, error: `调用外部 API 异常且本地保护状态写入失败，远端可能已创建任务，请联系部署管理员处理（步骤: ${nextStepName}）` },
          { status: 503 },
        );
      }
      return NextResponse.json(
        { success: false, error: `调用外部 API 异常，无法确认任务是否已创建，请联系部署管理员核对（步骤: ${nextStepName}）` },
        { status: 502 },
      );
    }

    if (nj.success) {
      task = applyStepUpdate(task, nextStepName, { task_id: nj.data?.task_id });
      try {
        await replaceWithRetry(id, task, appKey);
      } catch {
        // Keep task_id and only set master status to paused so the next retry enters
        // Case B (query the existing remote task) instead of Case A (duplicate job).
        const recoveryTask: NarratorMasterTask = { ...task, status: 'paused', updated_at: new Date().toISOString() };
        try {
          await replaceWithRetry(id, recoveryTask, appKey);
          return NextResponse.json(
            { success: false, error: `步骤已启动但状态保存失败，任务已暂停，可点击「继续」查询远端进度。远端任务 ID: ${nj.data?.task_id ?? '未知'}` },
            { status: 503 },
          );
        } catch {
          return NextResponse.json(
            { success: false, error: `步骤已启动但状态保存多次失败，请联系部署管理员手工修复。远端任务 ID: ${nj.data?.task_id ?? '未知'}` },
            { status: 503 },
          );
        }
      }
      return NextResponse.json({ success: true, next_step: nextStep, data: task });
    } else {
      task = applyStepUpdate(task, nextStepName, { status: 'failed', error: nj.error }, { status: 'failed', error_message: nj.error });
      await dbReplaceTask(id, task, appKey);
      return NextResponse.json({ success: false, error: nj.error || '调用下一步失败', data: task }, { status: 502 });
    }
  } catch (err: any) {
    return backendErrorResponse(err) ?? NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
