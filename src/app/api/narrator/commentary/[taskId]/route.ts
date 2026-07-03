import { NextRequest, NextResponse } from 'next/server';
import {
  NarratorProxyError,
  callNarratorProxyGet,
} from '@/lib/narrator-proxy-backend-client';

/**
 * GET /api/narrator/commentary/[taskId] - 查询单个爆款解说任务详情
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const appKey = request.headers.get('x-app-key') || '';
  if (!appKey) {
    return NextResponse.json({ success: false, error: '请先配置 App Key' }, { status: 401 });
  }
  try {
    const { taskId } = await params;
    // Path arg is interpolated by the backend (and URL-encoded server-side
    // per security hardening fix). Use encodeURIComponent here to be defensive
    // about reserved chars in the task ID before the request hits the backend.
    const result = (await callNarratorProxyGet(
      appKey,
      `/narrator/commentary/query/${encodeURIComponent(taskId)}`
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
      { success: false, error: (e as Error).message || '获取任务详情失败' },
      { status: 500 }
    );
  }
}
