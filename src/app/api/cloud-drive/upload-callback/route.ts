import { NextRequest, NextResponse } from 'next/server';
import { confirmCloudDriveUpload } from '@/lib/cloud-drive-backend-client';
import { friendlyCloudDriveError } from '@/lib/cloud-drive-error-messages';

export async function POST(request: NextRequest) {
  const appKey = request.headers.get('x-app-key') || '';
  if (!appKey) {
    return NextResponse.json({ success: false, error: '请先配置 App Key' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { file_id, object_key } = body;
    if (!file_id || !object_key) {
      return NextResponse.json(
        { success: false, error: '缺少必要参数 file_id 或 object_key' },
        { status: 400 }
      );
    }

    const data = await confirmCloudDriveUpload(appKey, body);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const friendly = friendlyCloudDriveError(error, '上传回调失败');
    return NextResponse.json(
      { success: false, error: friendly.message, code: friendly.code },
      { status: friendly.status }
    );
  }
}
