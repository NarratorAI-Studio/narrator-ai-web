import { NextRequest, NextResponse } from 'next/server';
import {
  batchDeleteCloudDriveTransfers,
  createCloudDriveTransfer,
  listCloudDriveTransfers,
} from '@/lib/cloud-drive-backend-client';
import { friendlyCloudDriveError } from '@/lib/cloud-drive-error-messages';

function errorResponse(error: unknown, fallback: string) {
  const friendly = friendlyCloudDriveError(error, fallback);
  return NextResponse.json(
    { success: false, error: friendly.message, code: friendly.code },
    { status: friendly.status }
  );
}

export async function POST(request: NextRequest) {
  const appKey = request.headers.get('x-app-key') || '';
  if (!appKey) {
    return NextResponse.json({ success: false, error: '请先配置 App Key' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const link = typeof body.link === 'string' ? body.link.trim() : '';
    if (!link) {
      return NextResponse.json({ success: false, error: '请输入链接地址' }, { status: 400 });
    }

    const data = await createCloudDriveTransfer(appKey, {
      link,
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return errorResponse(error, '创建转存任务失败');
  }
}

export async function DELETE(request: NextRequest) {
  const appKey = request.headers.get('x-app-key') || '';
  if (!appKey) {
    return NextResponse.json({ success: false, error: '请先配置 App Key' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const fileIds = body.file_ids;
    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return NextResponse.json({ success: false, error: '请指定要删除的任务' }, { status: 400 });
    }

    const data = await batchDeleteCloudDriveTransfers(appKey, fileIds);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return errorResponse(error, '删除失败');
  }
}

export async function GET(request: NextRequest) {
  const appKey = request.headers.get('x-app-key') || '';
  if (!appKey) {
    return NextResponse.json({ success: false, error: '请先配置 App Key' }, { status: 401 });
  }

  try {
    const sp = request.nextUrl.searchParams;
    const data = await listCloudDriveTransfers(appKey, {
      page: sp.get('page') ?? 1,
      limit: sp.get('limit') ?? 20,
      status: sp.get('status') ?? undefined,
      order: sp.get('order') ?? 'desc',
      order_by: sp.get('order_by') ?? 'created_at',
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return errorResponse(error, '获取转存任务列表失败');
  }
}
