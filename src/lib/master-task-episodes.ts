import type { NarratorMasterTask } from './master-task-types';

/**
 * Build the `episodes_data` payload for upstream narrator-create calls .
 *
 * Playlet multi-episode tasks persist every episode on the master task
 * (`task.episodes_data`); for everything else — and for legacy playlet
 * tasks created before that field existed — we fall back to the single
 * `native_video_id` / `native_srt_id` pair so old tasks keep working
 * unchanged.
 *
 * `withNegative` controls the `negative_oss_key` field and the `num`
 * type. Upstream's create-writing / clip-data routes require
 * `negative_oss_key` and emit `num` as an integer; create-subsync uses
 * neither field and emits `num` as a string. Mirroring the historical
 * call shape avoids breaking upstream's request validation.
 */
export function buildEpisodesData(
  t: NarratorMasterTask,
  { withNegative }: { withNegative: boolean },
): Array<Record<string, unknown>> {
  const eps = t.episodes_data;
  if (eps && eps.length > 0) {
    return eps.map((ep, i) => {
      const row: Record<string, unknown> = {
        video_oss_key: ep.video_id,
        srt_oss_key: ep.srt_id,
        num: withNegative ? i + 1 : String(i + 1),
      };
      if (withNegative) row.negative_oss_key = ep.video_id;
      return row;
    });
  }
  const row: Record<string, unknown> = {
    video_oss_key: t.native_video_id,
    srt_oss_key: t.native_srt_id,
    num: withNegative ? 1 : '1',
  };
  if (withNegative) row.negative_oss_key = t.native_video_id;
  return [row];
}
