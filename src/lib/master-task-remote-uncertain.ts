import type { NarratorMasterTask, StepName } from './master-task-types';

export const REMOTE_CALL_UNCERTAIN = 'REMOTE_CALL_UNCERTAIN';

export const REMOTE_CALL_UNCERTAIN_MESSAGE =
  '调用外部 API 异常，无法确认是否已创建任务，请联系部署管理员核对后再继续。';

export function markRemoteCallUncertain(
  task: NarratorMasterTask,
  stepName: StepName,
  now = new Date().toISOString(),
): NarratorMasterTask {
  return {
    ...task,
    status: 'paused',
    error_message: REMOTE_CALL_UNCERTAIN_MESSAGE,
    steps: {
      ...task.steps,
      [stepName]: {
        ...(task.steps[stepName] ?? {}),
        status: 'failed',
        error: REMOTE_CALL_UNCERTAIN,
      },
    },
    updated_at: now,
  };
}
