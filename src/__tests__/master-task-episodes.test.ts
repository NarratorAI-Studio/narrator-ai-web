import { describe, expect, it } from 'vitest';

import { buildEpisodesData } from '@/lib/master-task-episodes';
import type { NarratorMasterTask } from '@/lib/master-task-types';

function task(overrides: Partial<NarratorMasterTask> = {}): NarratorMasterTask {
  return {
    narrator_task_id: 'task-1',
    created_at: '2026-06-18T00:00:00.000Z',
    updated_at: '2026-06-18T00:00:00.000Z',
    app_key: 'grid_Test',
    narrator_type: 'short_drama',
    narrator_type_label: '短剧',
    model_version: 'standard',
    dubing_id: 'voice-1',
    native_video_id: 'video-ep1',
    native_video_name: 'ep1.mp4',
    native_srt_id: 'srt-ep1',
    native_srt_name: 'ep1.srt',
    use_existing_model: true,
    existing_model_id: 'model-1',
    run_auto: 1,
    status: 'running',
    current_step: 'fast_generate_writing',
    steps: {},
    ...overrides,
  };
}

describe('buildEpisodesData ', () => {
  it('expands every playlet episode when episodes_data is present', () => {
    const t = task({
      episodes_data: [
        { video_id: 'v1', video_name: 'ep1.mp4', srt_id: 's1', srt_name: 'ep1.srt' },
        { video_id: 'v2', video_name: 'ep2.mp4', srt_id: 's2', srt_name: 'ep2.srt' },
        { video_id: 'v3', video_name: 'ep3.mp4', srt_id: 's3', srt_name: 'ep3.srt' },
      ],
    });
    const result = buildEpisodesData(t, { withNegative: true });
    expect(result).toEqual([
      { video_oss_key: 'v1', srt_oss_key: 's1', negative_oss_key: 'v1', num: 1 },
      { video_oss_key: 'v2', srt_oss_key: 's2', negative_oss_key: 'v2', num: 2 },
      { video_oss_key: 'v3', srt_oss_key: 's3', negative_oss_key: 'v3', num: 3 },
    ]);
  });

  it('falls back to single native_* pair when episodes_data is absent (legacy task)', () => {
    const t = task({ episodes_data: undefined });
    expect(buildEpisodesData(t, { withNegative: true })).toEqual([
      { video_oss_key: 'video-ep1', srt_oss_key: 'srt-ep1', negative_oss_key: 'video-ep1', num: 1 },
    ]);
  });

  it('also falls back when episodes_data is present but empty', () => {
    const t = task({ episodes_data: [] });
    expect(buildEpisodesData(t, { withNegative: true })).toEqual([
      { video_oss_key: 'video-ep1', srt_oss_key: 'srt-ep1', negative_oss_key: 'video-ep1', num: 1 },
    ]);
  });

  it('emits subsync-shape rows when withNegative is false (string num, no negative_oss_key)', () => {
    const t = task({
      episodes_data: [
        { video_id: 'v1', srt_id: 's1' },
        { video_id: 'v2', srt_id: 's2' },
      ],
    });
    const result = buildEpisodesData(t, { withNegative: false });
    expect(result).toEqual([
      { video_oss_key: 'v1', srt_oss_key: 's1', num: '1' },
      { video_oss_key: 'v2', srt_oss_key: 's2', num: '2' },
    ]);
    // subsync upstream contract: no negative_oss_key field
    expect(result.every(r => !('negative_oss_key' in r))).toBe(true);
  });

  it('falls back for subsync shape too — string num, no negative_oss_key', () => {
    const t = task({ episodes_data: undefined });
    expect(buildEpisodesData(t, { withNegative: false })).toEqual([
      { video_oss_key: 'video-ep1', srt_oss_key: 'srt-ep1', num: '1' },
    ]);
  });
});
