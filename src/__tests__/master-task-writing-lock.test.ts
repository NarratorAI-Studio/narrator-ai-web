/**
 * Unit tests for the regression coverage writing-lock predicate.
 *
 * Acceptance:
 *   - Editing is locked once any post-writing step has been touched
 *     (running / completed / failed / skipped).
 *   - Still unlocked while every downstream step is pending or missing.
 */

import { describe, expect, it } from 'vitest';

import { isWritingDownstreamStarted } from '@/lib/master-task-writing-lock';

describe('isWritingDownstreamStarted', () => {
  it('returns false when steps is null/undefined', () => {
    expect(isWritingDownstreamStarted(null)).toBe(false);
    expect(isWritingDownstreamStarted(undefined)).toBe(false);
    expect(isWritingDownstreamStarted({})).toBe(false);
  });

  it('returns false when downstream steps are pending or missing', () => {
    expect(
      isWritingDownstreamStarted({
        clip_data: { status: 'pending' },
        video_composing: { status: 'pending' },
      }),
    ).toBe(false);
    expect(
      isWritingDownstreamStarted({
        clip_data: undefined,
        generate_fast_writing_clip_data: null,
      }),
    ).toBe(false);
  });

  it('returns true when 二创 clip_data has started', () => {
    expect(
      isWritingDownstreamStarted({ clip_data: { status: 'running' } }),
    ).toBe(true);
    expect(
      isWritingDownstreamStarted({ clip_data: { status: 'completed' } }),
    ).toBe(true);
  });

  it('returns true when 原创 generate_fast_writing_clip_data has started', () => {
    expect(
      isWritingDownstreamStarted({
        generate_fast_writing_clip_data: { status: 'running' },
      }),
    ).toBe(true);
    expect(
      isWritingDownstreamStarted({
        generate_fast_writing_clip_data: { status: 'completed' },
      }),
    ).toBe(true);
  });

  it('returns true when video_composing has started, even if clip skipped', () => {
    expect(
      isWritingDownstreamStarted({
        clip_data: { status: 'skipped' },
        video_composing: { status: 'running' },
      }),
    ).toBe(true);
  });

  it('treats failed downstream steps as already started (no edit recovery)', () => {
    expect(
      isWritingDownstreamStarted({ clip_data: { status: 'failed' } }),
    ).toBe(true);
  });

  it('treats skipped downstream steps as already started', () => {
    expect(
      isWritingDownstreamStarted({ clip_data: { status: 'skipped' } }),
    ).toBe(true);
  });
});
