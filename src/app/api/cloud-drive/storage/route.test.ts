import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CloudDriveBackendError, getCloudDriveStorage } from '@/lib/cloud-drive-backend-client';

import { GET } from './route';

vi.mock('@/lib/cloud-drive-backend-client', () => {
  class MockCloudDriveBackendError extends Error {
    status: number;
    code: string;
    constructor(message: string, status: number, code: string) {
      super(message);
      this.name = 'CloudDriveBackendError';
      this.status = status;
      this.code = code;
    }
  }
  return {
    CloudDriveBackendError: MockCloudDriveBackendError,
    getCloudDriveStorage: vi.fn(),
  };
});

const mockedGetCloudDriveStorage = vi.mocked(getCloudDriveStorage);

function request(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/cloud-drive/storage', { headers });
}

describe('GET /api/cloud-drive/storage', () => {
  beforeEach(() => {
    mockedGetCloudDriveStorage.mockReset();
  });

  it('requires x-app-key before calling backend', async () => {
    const response = await GET(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ success: false });
    expect(mockedGetCloudDriveStorage).not.toHaveBeenCalled();
  });

  it('preserves success response shape for UI', async () => {
    mockedGetCloudDriveStorage.mockResolvedValueOnce({
      used_bytes: 1024,
      quota_bytes: 3 * 1024 * 1024 * 1024,
      file_count: 2,
    });

    const response = await GET(request({ 'x-app-key': 'app-key-1' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        used_bytes: 1024,
        quota_bytes: 3 * 1024 * 1024 * 1024,
        used_size: 1024,
        max_size: 3 * 1024 * 1024 * 1024,
        file_count: 2,
        usage_percentage: (1024 / (3 * 1024 * 1024 * 1024)) * 100,
      },
    });
  });

  it('keeps existing UI storage fields stable', async () => {
    mockedGetCloudDriveStorage.mockResolvedValueOnce({
      used_size: 2048,
      max_size: 4096,
      file_count: 3,
      usage_percentage: 50,
    });

    const response = await GET(request({ 'x-app-key': 'app-key-1' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        used_size: 2048,
        max_size: 4096,
        file_count: 3,
        usage_percentage: 50,
      },
    });
  });

  it('passes quota errors through with code and status', async () => {
    mockedGetCloudDriveStorage.mockRejectedValueOnce(
      new CloudDriveBackendError(
        '空间不足，请联系部署管理员',
        409,
        'CLOUD_DRIVE_QUOTA_EXCEEDED'
      )
    );

    const response = await GET(request({ 'x-app-key': 'app-key-1' }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: '空间不足，请联系部署管理员',
      code: 'CLOUD_DRIVE_QUOTA_EXCEEDED',
    });
  });
});
