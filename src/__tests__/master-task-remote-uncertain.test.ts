import { describe, expect, it } from 'vitest';

import type { NarratorMasterTask } from '@/lib/master-task-types';
import {
  REMOTE_CALL_UNCERTAIN,
  REMOTE_CALL_UNCERTAIN_MESSAGE,
  markRemoteCallUncertain,
} from '@/lib/master-task-remote-uncertain';

function task(overrides: Partial<NarratorMasterTask> = {}): NarratorMasterTask {
  return {
    narrator_task_id: 'task-1',
    created_at: '2026-06-17T00:00:00.000Z',
    updated_at: '2026-06-17T00:00:00.000Z',
    app_key: 'grid_Test',
    narrator_type: 'short_drama',
    narrator_type_label: '短剧',
    model_version: 'standard',
    dubing_id: 'voice-1',
    native_video_id: 'video-1',
    native_video_name: 'video.mp4',
    native_srt_id: 'srt-1',
    native_srt_name: 'subtitle.srt',
    use_existing_model: true,
    existing_model_id: 'model-1',
    run_auto: 1,
    status: 'running',
    current_step: 'generate_writing',
    steps: {
      generate_writing: {
        status: 'running',
        started_at: '2026-06-17T00:00:01.000Z',
      },
    },
    ...overrides,
  };
}

describe('markRemoteCallUncertain', () => {
  it('pauses the master task and guards the step against silent retry', () => {
    const updated = markRemoteCallUncertain(
      task(),
      'generate_writing',
      '2026-06-17T00:00:02.000Z',
    );

    expect(updated.status).toBe('paused');
    expect(updated.error_message).toBe(REMOTE_CALL_UNCERTAIN_MESSAGE);
    expect(updated.updated_at).toBe('2026-06-17T00:00:02.000Z');
    expect(updated.steps.generate_writing).toEqual({
      status: 'failed',
      started_at: '2026-06-17T00:00:01.000Z',
      error: REMOTE_CALL_UNCERTAIN,
    });
  });

  it('preserves unrelated step state', () => {
    const updated = markRemoteCallUncertain(
      task({
        steps: {
          popular_learning: {
            status: 'completed',
            task_id: 'popular-1',
            result: { learning_model_id: 'model-1' },
          },
          generate_writing: { status: 'running' },
        },
      }),
      'generate_writing',
    );

    expect(updated.steps.popular_learning?.task_id).toBe('popular-1');
    expect(updated.steps.generate_writing?.error).toBe(REMOTE_CALL_UNCERTAIN);
  });
});
