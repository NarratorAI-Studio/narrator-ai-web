import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCloudDriveTransfer } from '@/lib/cloud-drive-backend-client';

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
  batchDeleteCloudDriveTransfers: vi.fn(),
  createCloudDriveTransfer: vi.fn(),
  listCloudDriveTransfers: vi.fn(),
}));

const mockedCreateCloudDriveTransfer = vi.mocked(createCloudDriveTransfer);

function request(body: unknown, headers: Record<string, string> = { 'x-app-key': 'app-key-1' }) {
  return new NextRequest('http://localhost/api/cloud-drive/transfer', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /api/cloud-drive/transfer', () => {
  beforeEach(() => {
    mockedCreateCloudDriveTransfer.mockReset();
  });

  it('does not accept client-provided file_size as quota authority', async () => {
    mockedCreateCloudDriveTransfer.mockResolvedValueOnce({ file_id: 'transfer-1' });

    const response = await POST(
      request({
        link: 'https://example.com/video.mp4',
        file_size: 1,
        file_name: ' video.mp4 ',
      })
    );

    expect(response.status).toBe(200);
    expect(mockedCreateCloudDriveTransfer).toHaveBeenCalledWith('app-key-1', {
      link: 'https://example.com/video.mp4',
    });
  });
});
