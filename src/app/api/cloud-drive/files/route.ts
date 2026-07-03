import { NextRequest, NextResponse } from 'next/server';
import { CloudDriveBackendError, getCloudDriveFiles } from '@/lib/cloud-drive-backend-client';

export async function GET(request: NextRequest) {
  const appKey = request.headers.get('x-app-key') || '';
  if (!appKey) {
    return NextResponse.json({ success: false, error: '请先配置 App Key' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  try {
    const data = await getCloudDriveFiles(appKey, {
      page: searchParams.get('page') ?? 1,
      page_size: searchParams.get('page_size') ?? 20,
      order_by: searchParams.get('order_by') ?? 'created_at',
      order: searchParams.get('order') ?? 'desc',
      search: searchParams.get('search') ?? '',
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const status = error instanceof CloudDriveBackendError ? error.status : 500;
    const code = error instanceof CloudDriveBackendError ? error.code : undefined;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '获取文件列表失败', code },
      { status }
    );
  }
}
