import { NextRequest, NextResponse } from 'next/server';
import {
  NarratorProxyError,
  callNarratorProxyGet,
} from '@/lib/narrator-proxy-backend-client';

/**
 * GET /api/narrator/query-subtitle-extract/[taskId] - 查询字幕提取任务状态
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
    const result = (await callNarratorProxyGet(
      appKey,
      `/narrator/ocr-extraction/query/${encodeURIComponent(taskId)}`
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
      { success: false, error: (e as Error).message || '查询字幕提取任务失败' },
      { status: 500 }
    );
  }
}
