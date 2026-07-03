import { describe, it, expect } from 'vitest';
import {
  ALL_SUPPORTED_ACCEPT_ATTR,
  ROLE_TO_EXTENSIONS,
  checkExtensionAllowed,
  fileMatchesRole,
  getFileExtension,
} from './cloud-drive-file-types';

describe('getFileExtension', () => {
  it('returns lowercase extension with dot', () => {
    expect(getFileExtension('movie.MP4')).toBe('.mp4');
    expect(getFileExtension('clip.srt')).toBe('.srt');
  });

  it('handles names without extension', () => {
    expect(getFileExtension('README')).toBe('');
  });

  it('ignores path separators', () => {
    expect(getFileExtension('a/b/c.mp4')).toBe('.mp4');
    expect(getFileExtension('a\\b\\c.srt')).toBe('.srt');
  });
});

describe('fileMatchesRole', () => {
  it('accepts video file for native_video role', () => {
    expect(fileMatchesRole({ file_name: 'clip.mp4' }, 'native_video')).toBe(true);
    expect(fileMatchesRole({ file_name: 'clip.MOV' }, 'episode_video')).toBe(true);
  });

  it('rejects SRT file under native_video role', () => {
    expect(fileMatchesRole({ file_name: 'subs.srt' }, 'native_video')).toBe(false);
  });

  it('accepts SRT under all srt roles, rejects video', () => {
    for (const role of ['native_srt', 'learning_srt', 'episode_srt'] as const) {
      expect(fileMatchesRole({ file_name: 'subs.srt' }, role)).toBe(true);
      expect(fileMatchesRole({ file_name: 'movie.mp4' }, role)).toBe(false);
    }
  });

  it('accepts audio under bgm role only', () => {
    expect(fileMatchesRole({ file_name: 'song.mp3' }, 'bgm')).toBe(true);
    expect(fileMatchesRole({ file_name: 'song.wav' }, 'bgm')).toBe(true);
    expect(fileMatchesRole({ file_name: 'song.m4a' }, 'bgm')).toBe(true);
    expect(fileMatchesRole({ file_name: 'song.mp3' }, 'native_video')).toBe(false);
  });

  it('prefers explicit suffix over filename', () => {
    expect(
      fileMatchesRole({ file_name: 'mystery', suffix: '.mp4' }, 'native_video'),
    ).toBe(true);
  });
});

describe('checkExtensionAllowed', () => {
  it('passes supported extensions', () => {
    const r = checkExtensionAllowed('clip.mp4');
    expect(r.ok).toBe(true);
  });

  it('rejects unsupported extensions with friendly reason', () => {
    const r = checkExtensionAllowed('script.exe');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('「script.exe」');
      expect(r.reason).toContain('.mp4');
    }
  });

  it('rejects names without extension', () => {
    const r = checkExtensionAllowed('binary');
    expect(r.ok).toBe(false);
  });

  it('accepts subtitle in custom allowlist', () => {
    const r = checkExtensionAllowed('a.srt', ['.srt']);
    expect(r.ok).toBe(true);
  });
});

describe('ROLE_TO_EXTENSIONS', () => {
  it('covers all 8 file roles', () => {
    const roles = Object.keys(ROLE_TO_EXTENSIONS);
    expect(roles.length).toBe(8);
  });

  it('every role extension is in canonical allowlist', () => {
    const all = new Set(ALL_SUPPORTED_ACCEPT_ATTR.split(','));
    for (const exts of Object.values(ROLE_TO_EXTENSIONS)) {
      for (const ext of exts) {
        expect(all.has(ext)).toBe(true);
      }
    }
  });
});
