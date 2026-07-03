/**
 * 总任务类型定义（前后端共享）
 */

import type { WalletTransactionSnapshot } from './wallet-types';

export type MasterTaskStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type StepName =
  | 'subtitle_extract'
  | 'subtitle_removal'
  | 'subsync'
  | 'popular_learning'
  | 'generate_writing'
  | 'fast_generate_writing'
  | 'generate_fast_writing_clip_data'
  | 'clip_data'
  | 'video_composing';

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface StepRecord {
  status: StepStatus;
  task_id?: string;
  started_at?: string;
  completed_at?: string;
  error?: string;
  result?: Record<string, unknown>;
}

export interface BudgetSnapshot {
  total_points: number;
  learning_points?: number;
  writing_points?: number;
  composing_points?: number;
  /** Hard-price fields (present only for template library orders) */
  hard_price?: number;
  combo_key?: string;
  pricing_rule_version?: number;
  billing_duration_minutes?: number;
  text_chars?: number;
  text_lines?: number;
}

/**
 * One playlet episode as stored on the master task . Mirrors the
 * `{ video, srt }` pair the user picks in Step 1; we keep the human-
 * readable names alongside the ids so the UI can render episode lists
 * after a page reload without re-fetching cloud-drive metadata.
 */
export interface EpisodeData {
  video_id: string;
  video_name?: string;
  srt_id: string;
  srt_name?: string;
}

export interface NarratorMasterTask {
  narrator_task_id: string;
  created_at: string;
  updated_at: string;
  app_key: string;
  narrator_type: string;
  narrator_type_label: string;
  model_version: string;
  dubing_id: string;
  native_video_id: string;
  native_video_name: string;
  native_srt_id: string;
  native_srt_name: string;
  /**
   * Multi-episode playlet payload . When the user adds ≥1 episode
   * in playlet mode we persist the full list here so downstream steps
   * (writing / clip / compose) can address every episode — previously
   * the master task only kept `validEpisodes[0]` and steps 2+ silently
   * dropped episodes 2..N.
   *
   * For non-playlet tasks (and legacy playlet tasks created before this
   * was added) the field is absent; consumers must fall back to
   * `[{ video: native_video_id, srt: native_srt_id }]` to stay
   * backward-compatible.
   */
  episodes_data?: EpisodeData[];
  learning_srt_id?: string;
  learning_srt_name?: string;
  bgm_id?: string;
  bgm_name?: string;
  use_existing_model: boolean;
  existing_model_id?: string;
  playlet_name?: string;
  target_platform?: string;
  task_count?: number;
  enable_subsync?: boolean;
  target_character_name?: string;
  refine_gaps?: boolean;
  story_info?: string;
  vendor_requirements?: string;
  writing_type?: number;
  writing_language?: string;
  writing_model?: string;
  confirmed_movie_json?: string;
  budget_snapshot?: BudgetSnapshot;
  // Hard-price wallet lifecycle fields
  template_id?: number;
  /**
   * Canonical upstream xy-code (e.g. `"xy0178"`) — the only stable
   * cross-system identifier for movie-baokuan templates. `template_id`
   * is the narrator 主 ID (`CSV.id`) and is NOT in the same number
   * space as the backend catalog id. The v2 snapshot binding matches by code;
   * legacy tasks may have no value.
   */
  code?: string;
  combo_key?: string;
  wallet_transaction?: WalletTransactionSnapshot;
  // Hard-price v2 : backend writes a pricing snapshot when the
  // master-task body carries `quote_id`. The snapshot id flows back
  // via the create response so the confirm-page can stash it on the
  // master-task record for audit/refund.
  quote_id?: string;
  snapshot_id?: string;
  custom_template_id?: string;
  custom_srt_file_id?: string;
  run_auto: 0 | 1;
  status: MasterTaskStatus;
  current_step?: StepName | 'completed';
  error_message?: string;
  raw_video_id?: string;
  raw_video_name?: string;
  removal_mode?: 'standard' | 'advanced';
  steps: {
    subtitle_extract?: StepRecord;
    subtitle_removal?: StepRecord;
    subsync?: StepRecord;
    popular_learning?: StepRecord;
    generate_writing?: StepRecord;
    fast_generate_writing?: StepRecord;
    generate_fast_writing_clip_data?: StepRecord;
    clip_data?: StepRecord;
    video_composing?: StepRecord;
  };
}
