import { CloudDriveBackendError } from '@/lib/cloud-drive-backend-client';

const INTERNAL_ENGLISH_PREFIXES = [
  'Internal cloud-drive returned',
  'backend cloud-drive call failed',
  'PRICING_BFF_AUTH_TOKEN',
];

function looksLikeInternalEnglish(message: string): boolean {
  return INTERNAL_ENGLISH_PREFIXES.some((prefix) => message.startsWith(prefix));
}

function friendlyMessageByCode(code: string, raw: string): string {
  switch (code) {
    case 'UPSTREAM_BUSINESS_ERROR':
      // Once backend surfaces the upstream `payload.message`, the raw text
      // is the actual user-facing reason (e.g. "链接已过期"). Pass it
      // through unless backend still emits the English fallback.
      return looksLikeInternalEnglish(raw)
        ? '云盘服务暂时无法处理该请求，请稍后重试或联系部署管理员'
        : raw;
    case 'UPSTREAM_HTTP_ERROR':
      return '云盘服务异常，请稍后重试';
    case 'UPSTREAM_DECODE_ERROR':
      return '云盘服务返回数据异常，请稍后重试';
    case 'BFF_UPSTREAM_TIMEOUT':
      return '云盘服务连接超时，请稍后重试';
    case 'BFF_UPSTREAM_UNREACHABLE':
      return '云盘服务暂不可达，请稍后重试';
    case 'BFF_AUTH_TOKEN_MISSING':
      return '云盘服务配置异常，请联系管理员';
    default:
      return looksLikeInternalEnglish(raw) ? '云盘操作失败，请稍后重试' : raw;
  }
}

export interface FriendlyError {
  message: string;
  code?: string;
  status: number;
}

export function friendlyCloudDriveError(error: unknown, fallback: string): FriendlyError {
  if (error instanceof CloudDriveBackendError) {
    return {
      message: friendlyMessageByCode(error.code, error.message),
      code: error.code,
      status: error.status,
    };
  }
  const raw = error instanceof Error ? error.message : fallback;
  return {
    message: looksLikeInternalEnglish(raw) ? fallback : raw,
    status: 500,
  };
}
