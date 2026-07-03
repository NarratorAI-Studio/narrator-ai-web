export const ALL_SUPPORTED_EXTENSIONS = [
  '.jpeg',
  '.jpg',
  '.m4a',
  '.mkv',
  '.mov',
  '.mp3',
  '.mp4',
  '.png',
  '.srt',
  '.wav',
] as const;

export type SupportedExtension = (typeof ALL_SUPPORTED_EXTENSIONS)[number];

const VIDEO_EXTS: SupportedExtension[] = ['.mp4', '.mov', '.mkv'];
const AUDIO_EXTS: SupportedExtension[] = ['.mp3', '.wav', '.m4a'];
const SUBTITLE_EXTS: SupportedExtension[] = ['.srt'];

export type PickerFileRole =
  | 'native_video'
  | 'native_srt'
  | 'learning_srt'
  | 'bgm'
  | 'raw_video'
  | 'raw_video_add'
  | 'episode_video'
  | 'episode_srt';

export const ROLE_TO_EXTENSIONS: Record<PickerFileRole, readonly SupportedExtension[]> = {
  native_video: VIDEO_EXTS,
  episode_video: VIDEO_EXTS,
  raw_video: VIDEO_EXTS,
  raw_video_add: VIDEO_EXTS,
  native_srt: SUBTITLE_EXTS,
  learning_srt: SUBTITLE_EXTS,
  episode_srt: SUBTITLE_EXTS,
  bgm: AUDIO_EXTS,
};

export const ROLE_TYPE_HINT: Record<PickerFileRole, string> = {
  native_video: '仅显示视频文件 (.mp4 / .mov / .mkv)',
  episode_video: '仅显示视频文件 (.mp4 / .mov / .mkv)',
  raw_video: '仅显示视频文件 (.mp4 / .mov / .mkv)',
  raw_video_add: '仅显示视频文件 (.mp4 / .mov / .mkv)',
  native_srt: '仅显示字幕文件 (.srt)',
  learning_srt: '仅显示字幕文件 (.srt)',
  episode_srt: '仅显示字幕文件 (.srt)',
  bgm: '仅显示音频文件 (.mp3 / .wav / .m4a)',
};

export function getFileExtension(name: string): string {
  const match = name.match(/\.[^./\\]+$/);
  return match ? match[0].toLowerCase() : '';
}

export function fileMatchesRole(
  file: { file_name?: string; name?: string; suffix?: string | null },
  role: PickerFileRole,
): boolean {
  const allowed = ROLE_TO_EXTENSIONS[role];
  const raw = file.suffix || file.file_name || file.name || '';
  // Three input shapes possible:
  //   - ".mp4"            (already canonical leading-dot form)
  //   - "mp4"             (bare token — what /api/cloud-drive/files returns
  //                        in `suffix`; regression coverage root cause: original logic
  //                        ran getFileExtension on this, regex found no
  //                        `.`, returned "", every file mismatched)
  //   - "anything.mp4"    (full file name path; extract trailing ext)
  // ROLE_TO_EXTENSIONS / ALL_SUPPORTED_EXTENSIONS use leading-dot form,
  // so we normalize to that here before the includes() check.
  const ext = raw.startsWith('.')
    ? raw.toLowerCase()
    : raw.includes('.')
      ? getFileExtension(raw)
      : `.${raw.toLowerCase()}`;
  return (allowed as readonly string[]).includes(ext);
}

export interface ExtensionCheckOk {
  ok: true;
}

export interface ExtensionCheckFail {
  ok: false;
  reason: string;
}

export type ExtensionCheckResult = ExtensionCheckOk | ExtensionCheckFail;

export function checkExtensionAllowed(
  fileName: string,
  allowed: readonly string[] = ALL_SUPPORTED_EXTENSIONS,
): ExtensionCheckResult {
  const ext = getFileExtension(fileName);
  if (!ext || !allowed.includes(ext)) {
    return {
      ok: false,
      reason: `「${fileName}」不支持的文件格式，仅支持：${allowed.join(', ')}`,
    };
  }
  return { ok: true };
}

export const ALL_SUPPORTED_ACCEPT_ATTR = ALL_SUPPORTED_EXTENSIONS.join(',');
