import { NextRequest, NextResponse } from 'next/server';
import { createCloudDriveUploadUrl } from '@/lib/cloud-drive-backend-client';
import { friendlyCloudDriveError } from '@/lib/cloud-drive-error-messages';

export async function POST(request: NextRequest) {
  const appKey = request.headers.get('x-app-key') || '';
  if (!appKey) {
    return NextResponse.json({ success: false, error: '请先配置 App Key' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { file_name, file_size, content_type } = body;
    if (!file_name || !file_size) {
      return NextResponse.json(
        { success: false, error: '缺少 file_name 或 file_size 参数' },
        { status: 400 }
      );
    }

    const data = await createCloudDriveUploadUrl(appKey, {
      file_name,
      file_size,
      content_type: content_type || 'application/octet-stream',
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const friendly = friendlyCloudDriveError(error, '获取上传链接失败');
    return NextResponse.json(
      { success: false, error: friendly.message, code: friendly.code },
      { status: friendly.status }
    );
  }
}
