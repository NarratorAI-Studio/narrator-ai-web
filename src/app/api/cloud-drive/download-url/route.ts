import { NextRequest, NextResponse } from 'next/server';
import { CloudDriveBackendError, createCloudDriveDownloadUrl } from '@/lib/cloud-drive-backend-client';

export async function POST(request: NextRequest) {
  const appKey = request.headers.get('x-app-key') || '';
  if (!appKey) {
    return NextResponse.json({ success: false, error: '请先配置 App Key' }, { status: 401 });
  }

  try {
    const { file_id } = await request.json();
    if (!file_id) {
      return NextResponse.json({ success: false, error: '缺少 file_id 参数' }, { status: 400 });
    }

    const data = await createCloudDriveDownloadUrl(appKey, file_id);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const status = error instanceof CloudDriveBackendError ? error.status : 500;
    const code = error instanceof CloudDriveBackendError ? error.code : undefined;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '获取下载链接失败', code },
      { status }
    );
  }
}
