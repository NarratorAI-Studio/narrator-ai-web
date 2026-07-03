import { NextRequest, NextResponse } from 'next/server';
import {
  CloudDriveBackendError,
  batchDeleteCloudDriveFiles,
} from '@/lib/cloud-drive-backend-client';

export async function POST(request: NextRequest) {
  const appKey = request.headers.get('x-app-key') || '';
  if (!appKey) {
    return NextResponse.json({ success: false, error: '请先配置 App Key' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: '请求体必须是 JSON' },
      { status: 400 }
    );
  }

  const fileIds = (body as { file_ids?: unknown })?.file_ids;
  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    return NextResponse.json(
      { success: false, error: 'file_ids 不能为空' },
      { status: 400 }
    );
  }
  if (fileIds.length > 50) {
    return NextResponse.json(
      { success: false, error: '单次最多删除 50 个文件' },
      { status: 400 }
    );
  }
  if (!fileIds.every((id) => typeof id === 'string' && id.length > 0)) {
    return NextResponse.json(
      { success: false, error: 'file_ids 必须是非空字符串数组' },
      { status: 400 }
    );
  }

  try {
    const data = await batchDeleteCloudDriveFiles(appKey, fileIds as string[]);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const status = error instanceof CloudDriveBackendError ? error.status : 500;
    const code = error instanceof CloudDriveBackendError ? error.code : undefined;
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '批量删除失败',
        code,
      },
      { status }
    );
  }
}
