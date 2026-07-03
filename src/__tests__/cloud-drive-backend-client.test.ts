import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CloudDriveBackendError,
  createCloudDriveUploadUrl,
  getCloudDriveStorage,
} from '@/lib/cloud-drive-backend-client';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const originalToken = process.env.PRICING_BFF_AUTH_TOKEN;
const originalUrl = process.env.NARRATOR_PRICING_API_URL;

beforeEach(() => {
  mockFetch.mockReset();
  process.env.PRICING_BFF_AUTH_TOKEN = 'test-bff-token';
  process.env.NARRATOR_PRICING_API_URL = 'http://pricing-backend.test';
});

afterEach(() => {
  if (originalToken === undefined) delete process.env.PRICING_BFF_AUTH_TOKEN;
  else process.env.PRICING_BFF_AUTH_TOKEN = originalToken;
  if (originalUrl === undefined) delete process.env.NARRATOR_PRICING_API_URL;
  else process.env.NARRATOR_PRICING_API_URL = originalUrl;
});

describe('cloud-drive backend client', () => {
  it('fails before fetch when PRICING_BFF_AUTH_TOKEN is missing', async () => {
    delete process.env.PRICING_BFF_AUTH_TOKEN;

    await expect(getCloudDriveStorage('app-key-1')).rejects.toMatchObject({
      status: 503,
      code: 'BFF_AUTH_TOKEN_MISSING',
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('forwards Bearer token and X-Web-App-Key to backend', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      json: async () => ({ success: true, data: { used_bytes: 0, quota_bytes: 3 } }),
    });

    await expect(getCloudDriveStorage('app-key-1')).resolves.toEqual({
      used_bytes: 0,
      quota_bytes: 3,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://pricing-backend.test/cloud-drive/storage-usage',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-bff-token',
          'X-Web-App-Key': 'app-key-1',
        }),
      })
    );
  });

  it('throws backend code and status for quota exceeded', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 409,
      json: async () => ({
        success: false,
        error: {
          code: 'CLOUD_DRIVE_QUOTA_EXCEEDED',
          message: '空间不足，请联系部署管理员',
        },
      }),
    });

    await expect(
      createCloudDriveUploadUrl('app-key-1', {
        file_name: 'demo.srt',
        file_size: 10,
        content_type: 'application/x-subrip',
      })
    ).rejects.toEqual(
      expect.objectContaining({
        status: 409,
        code: 'CLOUD_DRIVE_QUOTA_EXCEEDED',
        message: '空间不足，请联系部署管理员',
      })
    );
  });

  it('maps network failures to 502 CloudDriveBackendError', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    try {
      await getCloudDriveStorage('app-key-1');
      throw new Error('expected getCloudDriveStorage to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(CloudDriveBackendError);
      expect(error).toMatchObject({
        status: 502,
        code: 'BFF_UPSTREAM_UNREACHABLE',
      });
    }
  });
});
