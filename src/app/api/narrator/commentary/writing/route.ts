import { NextRequest, NextResponse } from 'next/server';
import {
  NarratorProxyError,
  callNarratorProxyGet,
  callNarratorProxyPost,
} from '@/lib/narrator-proxy-backend-client';

/**
 * GET /api/narrator/commentary/writing?task_id=X&file_id=Y
 * 获取已生成解说文案内容
 */
export async function GET(request: NextRequest) {
  const appKey = request.headers.get('x-app-key') || '';
  if (!appKey)
    return NextResponse.json({ success: false, error: '请先配置 App Key' }, { status: 401 });

  const taskId = request.nextUrl.searchParams.get('task_id');
  const fileId = request.nextUrl.searchParams.get('file_id') || undefined;
  if (!taskId)
    return NextResponse.json({ success: false, error: 'task_id is required' }, { status: 400 });

  try {
    const result = (await callNarratorProxyGet(appKey, '/narrator/commentary/writing', {
      task_id: taskId,
      file_id: fileId,
    })) as { data?: unknown };
    return NextResponse.json({ success: true, data: result.data ?? result });
  } catch (e) {
    if (e instanceof NarratorProxyError) {
      return NextResponse.json(
        { success: false, error: e.message, code: e.code },
        { status: e.status }
      );
    }
    return NextResponse.json(
      { success: false, error: (e as Error).message || '获取文案失败' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/narrator/commentary/writing
 * 保存修改后的解说文案内容
 */
export async function POST(request: NextRequest) {
  const appKey = request.headers.get('x-app-key') || '';
  if (!appKey)
    return NextResponse.json({ success: false, error: '请先配置 App Key' }, { status: 401 });

  try {
    const body = await request.json();
    const { task_id, file_id, content } = body;
    if (!task_id || !file_id || !Array.isArray(content))
      return NextResponse.json(
        { success: false, error: 'task_id, file_id, content are required' },
        { status: 400 }
      );

    const result = (await callNarratorProxyPost(
      appKey,
      '/narrator/commentary/writing',
      { task_id, file_id, content }
    )) as { data?: unknown };
    return NextResponse.json({ success: true, data: result.data ?? result });
  } catch (e) {
    if (e instanceof NarratorProxyError) {
      return NextResponse.json(
        { success: false, error: e.message, code: e.code },
        { status: e.status }
      );
    }
    return NextResponse.json(
      { success: false, error: (e as Error).message || '保存文案失败' },
      { status: 500 }
    );
  }
}
