import { describe, it, expect } from 'vitest';
import { CloudDriveBackendError } from './cloud-drive-backend-client';
import { friendlyCloudDriveError } from './cloud-drive-error-messages';

describe('friendlyCloudDriveError', () => {
  it('maps UPSTREAM_BUSINESS_ERROR with English fallback raw to Chinese fallback', () => {
    const err = new CloudDriveBackendError(
      'Internal cloud-drive returned a business error.',
      502,
      'UPSTREAM_BUSINESS_ERROR',
    );
    const friendly = friendlyCloudDriveError(err, 'fallback');
    expect(friendly.message).not.toContain('Internal');
    expect(friendly.message).toContain('云盘');
    expect(friendly.code).toBe('UPSTREAM_BUSINESS_ERROR');
    expect(friendly.status).toBe(502);
  });

  it('passes through upstream Chinese message for UPSTREAM_BUSINESS_ERROR', () => {
    // After backend review surfaces payload.message, raw is the real
    // user-facing reason and should be shown directly.
    const err = new CloudDriveBackendError(
      '链接已过期，请重新生成',
      502,
      'UPSTREAM_BUSINESS_ERROR',
    );
    const friendly = friendlyCloudDriveError(err, 'fallback');
    expect(friendly.message).toBe('链接已过期，请重新生成');
    expect(friendly.code).toBe('UPSTREAM_BUSINESS_ERROR');
  });

  it('maps UPSTREAM_HTTP_ERROR', () => {
    const err = new CloudDriveBackendError(
      'Internal cloud-drive returned HTTP 502.',
      502,
      'UPSTREAM_HTTP_ERROR',
    );
    const friendly = friendlyCloudDriveError(err, 'fallback');
    expect(friendly.message).toContain('云盘服务异常');
  });

  it('maps BFF_UPSTREAM_TIMEOUT', () => {
    const err = new CloudDriveBackendError('backend cloud-drive call failed', 504, 'BFF_UPSTREAM_TIMEOUT');
    const friendly = friendlyCloudDriveError(err, 'fallback');
    expect(friendly.message).toContain('超时');
  });

  it('maps BFF_AUTH_TOKEN_MISSING to admin-facing message', () => {
    const err = new CloudDriveBackendError(
      'PRICING_BFF_AUTH_TOKEN env not set - web cannot authenticate to backend.',
      503,
      'BFF_AUTH_TOKEN_MISSING',
    );
    const friendly = friendlyCloudDriveError(err, 'fallback');
    expect(friendly.message).toContain('管理员');
    expect(friendly.message).not.toContain('PRICING_BFF_AUTH_TOKEN');
  });

  it('preserves non-English raw messages for unknown codes', () => {
    const err = new CloudDriveBackendError('文件类型不支持', 400, 'UPSTREAM_CUSTOM_BUSINESS');
    const friendly = friendlyCloudDriveError(err, 'fallback');
    expect(friendly.message).toBe('文件类型不支持');
  });

  it('hides English internal prefix for unknown codes', () => {
    const err = new CloudDriveBackendError(
      'Internal cloud-drive returned a non-JSON body.',
      502,
      'SOMETHING_ELSE',
    );
    const friendly = friendlyCloudDriveError(err, 'fallback');
    expect(friendly.message).not.toContain('Internal');
  });

  it('falls back to fallback string for non-CloudDriveBackendError English errors', () => {
    const err = new Error('Internal cloud-drive returned HTTP 500.');
    const friendly = friendlyCloudDriveError(err, '获取上传链接失败');
    expect(friendly.message).toBe('获取上传链接失败');
    expect(friendly.status).toBe(500);
  });

  it('passes through user-friendly errors from Error instances', () => {
    const err = new Error('请先配置 App Key');
    const friendly = friendlyCloudDriveError(err, 'fallback');
    expect(friendly.message).toBe('请先配置 App Key');
  });
});
