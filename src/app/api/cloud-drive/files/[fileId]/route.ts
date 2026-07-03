import { NextRequest, NextResponse } from 'next/server';
import { CloudDriveBackendError, deleteCloudDriveFile } from '@/lib/cloud-drive-backend-client';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const appKey = request.headers.get('x-app-key') || '';
  if (!appKey) {
    return NextResponse.json({ success: false, error: '请先配置 App Key' }, { status: 401 });
  }

  const { fileId } = await params;
  try {
    const data = await deleteCloudDriveFile(appKey, fileId);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const status = error instanceof CloudDriveBackendError ? error.status : 500;
    const code = error instanceof CloudDriveBackendError ? error.code : undefined;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '删除文件失败', code },
      { status }
    );
  }
}
