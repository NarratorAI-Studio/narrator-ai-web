/**
 * Regression for regression coverage: the cloud-drive custom-material picker showed
 * "暂无文件" even though /cloud-drive listed matching .mp4 rows.
 *
 * Root cause was a contract mismatch on the `suffix` field: the BFF
 * `/api/cloud-drive/files` returns items like `{ suffix: "mp4" }` —
 * a bare token, no leading dot — while ROLE_TO_EXTENSIONS uses the
 * `.mp4` leading-dot form (matching ALL_SUPPORTED_EXTENSIONS). The
 * original `fileMatchesRole` ran `getFileExtension("mp4")`, whose
 * regex requires an actual `.` somewhere in the string, returned "",
 * and `[".mp4", ".mov", ".mkv"].includes("")` short-circuited every
 * file to `false`.
 *
 * The fix accepts all three input shapes (leading-dot, bare token,
 * full file name) and normalizes to leading-dot form before checking
 * the allow list.
 */

import { describe, expect, it } from 'vitest';

import { fileMatchesRole } from '@/lib/cloud-drive-file-types';


describe('fileMatchesRole ', () => {
  describe('bare suffix (BFF /api/cloud-drive/files shape)', () => {
    it('matches video role when suffix is "mp4"', () => {
      expect(fileMatchesRole({ suffix: 'mp4', file_name: '下山应劫 3.mp4' }, 'native_video')).toBe(true);
      expect(fileMatchesRole({ suffix: 'mov' }, 'native_video')).toBe(true);
      expect(fileMatchesRole({ suffix: 'mkv' }, 'episode_video')).toBe(true);
      expect(fileMatchesRole({ suffix: 'mp4' }, 'raw_video')).toBe(true);
    });

    it('matches subtitle role when suffix is "srt"', () => {
      expect(fileMatchesRole({ suffix: 'srt' }, 'native_srt')).toBe(true);
      expect(fileMatchesRole({ suffix: 'srt' }, 'learning_srt')).toBe(true);
    });

    it('matches audio role when suffix is bare "mp3" / "wav" / "m4a"', () => {
      expect(fileMatchesRole({ suffix: 'mp3' }, 'bgm')).toBe(true);
      expect(fileMatchesRole({ suffix: 'wav' }, 'bgm')).toBe(true);
      expect(fileMatchesRole({ suffix: 'm4a' }, 'bgm')).toBe(true);
    });

    it('case-insensitive on suffix', () => {
      expect(fileMatchesRole({ suffix: 'MP4' }, 'native_video')).toBe(true);
      expect(fileMatchesRole({ suffix: 'SRT' }, 'native_srt')).toBe(true);
    });

    it('rejects when suffix mismatches the role allow list', () => {
      expect(fileMatchesRole({ suffix: 'srt' }, 'native_video')).toBe(false);
      expect(fileMatchesRole({ suffix: 'mp4' }, 'native_srt')).toBe(false);
      expect(fileMatchesRole({ suffix: 'png' }, 'bgm')).toBe(false);
    });
  });

  describe('leading-dot suffix (canonical form)', () => {
    it('matches when suffix has the dot prefix', () => {
      expect(fileMatchesRole({ suffix: '.mp4' }, 'native_video')).toBe(true);
      expect(fileMatchesRole({ suffix: '.srt' }, 'native_srt')).toBe(true);
    });
  });

  describe('falls back to file_name when suffix is empty / missing', () => {
    it('matches via file_name extension', () => {
      expect(fileMatchesRole({ file_name: '下山应劫老婆 3.mp4' }, 'native_video')).toBe(true);
      expect(fileMatchesRole({ file_name: 'native.srt' }, 'native_srt')).toBe(true);
    });

    it('matches via name when both suffix and file_name absent', () => {
      expect(fileMatchesRole({ name: 'foo.mp4' }, 'native_video')).toBe(true);
    });

    it('handles whitespace + multi-dot file names', () => {
      expect(fileMatchesRole({ file_name: 'a.b.c.mp4' }, 'native_video')).toBe(true);
      expect(fileMatchesRole({ file_name: 'has spaces 3.mp4' }, 'native_video')).toBe(true);
    });
  });

  describe('rejects', () => {
    it('empty / no signals', () => {
      expect(fileMatchesRole({}, 'native_video')).toBe(false);
      expect(fileMatchesRole({ suffix: '', file_name: '' }, 'native_video')).toBe(false);
      expect(fileMatchesRole({ suffix: null }, 'native_video')).toBe(false);
    });

    it('extensionless file names', () => {
      expect(fileMatchesRole({ file_name: 'README' }, 'native_video')).toBe(false);
    });
  });
});
