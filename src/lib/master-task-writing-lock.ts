/**
 * Pure predicate for regression coverage: lock the "查看 / 编辑文案" entry once the
 * staged task has moved past the writing step.
 *
 * Once any post-writing step (`clip_data` / `generate_fast_writing_clip_data`
 * / `video_composing`) has been touched by the orchestrator — meaning it
 * is `running`, `completed`, `failed`, or `skipped` — editing the writing
 * file would no longer affect the downstream artifacts. Product
 * confirmed in regression coverage that in this state the writing step should only
 * expose a read-only "查看" entry.
 *
 * `pending` and `undefined` (= step has not been reached yet) keep the
 * full edit affordance.
 */

type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

interface StepLike {
  status?: StepStatus;
}

const DOWNSTREAM_KEYS = [
  'clip_data',
  'generate_fast_writing_clip_data',
  'video_composing',
] as const;

const STARTED_STATUSES: ReadonlySet<StepStatus> = new Set([
  'running',
  'completed',
  'failed',
  'skipped',
]);

export function isWritingDownstreamStarted(
  steps: Partial<Record<(typeof DOWNSTREAM_KEYS)[number], StepLike | null | undefined>> | null | undefined,
): boolean {
  if (!steps) return false;
  return DOWNSTREAM_KEYS.some(key => {
    const status = steps[key]?.status;
    return !!status && STARTED_STATUSES.has(status);
  });
}
