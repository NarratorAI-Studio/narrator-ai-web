import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { batchDeleteCloudDriveFiles } from '@/lib/cloud-drive-backend-client';

import { POST } from './route';

vi.mock('@/lib/cloud-drive-backend-client', () => ({
  CloudDriveBackendError: class MockCloudDriveBackendError extends Error {
    status: number;
    code: string;
    constructor(message: string, status: number, code: string) {
      super(message);
      this.name = 'CloudDriveBackendError';
      this.status = status;
      this.code = code;
    }
  },
  batchDeleteCloudDriveFiles: vi.fn(),
}));

const mockedBatchDelete = vi.mocked(batchDeleteCloudDriveFiles);

function request(body: unknown, headers: Record<string, string> = { 'x-app-key': 'app-key-1' }) {
  return new NextRequest('http://localhost/api/cloud-drive/files/batch-delete', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/cloud-drive/files/batch-delete', () => {
  beforeEach(() => {
    mockedBatchDelete.mockReset();
  });

  it('forwards file_ids to backend and returns upstream data', async () => {
    mockedBatchDelete.mockResolvedValueOnce({
      requested_count: 2,
      deleted_count: 2,
      failed_count: 0,
      failed_items: [],
      storage_usage: { used_size: 0, max_size: 100, file_count: 0, usage_percentage: 0 },
    });

    const response = await POST(request({ file_ids: ['a', 'b'] }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.deleted_count).toBe(2);
    expect(mockedBatchDelete).toHaveBeenCalledWith('app-key-1', ['a', 'b']);
  });

  it('rejects missing app-key with 401', async () => {
    const response = await POST(request({ file_ids: ['a'] }, {}));
    expect(response.status).toBe(401);
    expect(mockedBatchDelete).not.toHaveBeenCalled();
  });

  it('rejects empty file_ids with 400', async () => {
    const response = await POST(request({ file_ids: [] }));
    expect(response.status).toBe(400);
    expect(mockedBatchDelete).not.toHaveBeenCalled();
  });

  it('rejects over-50 file_ids with 400 before hitting backend', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `f${i}`);
    const response = await POST(request({ file_ids: ids }));
    expect(response.status).toBe(400);
    expect(mockedBatchDelete).not.toHaveBeenCalled();
  });

  it('rejects non-string ids with 400', async () => {
    const response = await POST(request({ file_ids: ['a', 1] }));
    expect(response.status).toBe(400);
    expect(mockedBatchDelete).not.toHaveBeenCalled();
  });

  it('rejects non-JSON body with 400', async () => {
    const response = await POST(request('not-json'));
    expect(response.status).toBe(400);
    expect(mockedBatchDelete).not.toHaveBeenCalled();
  });

  it('maps backend errors to the upstream status code', async () => {
    const { CloudDriveBackendError } = await import('@/lib/cloud-drive-backend-client');
    mockedBatchDelete.mockRejectedValueOnce(
      new CloudDriveBackendError('not found', 404, 'NOT_FOUND')
    );

    const response = await POST(request({ file_ids: ['a'] }));
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.success).toBe(false);
    expect(json.code).toBe('NOT_FOUND');
  });
});
