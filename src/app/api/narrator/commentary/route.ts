import { NextRequest, NextResponse } from 'next/server';
import {
  NarratorProxyError,
  callNarratorProxyGet,
} from '@/lib/narrator-proxy-backend-client';

/**
 * GET /api/narrator/commentary - 查询爆款解说任务列表
 */
export async function GET(request: NextRequest) {
  const appKey = request.headers.get('x-app-key') || '';
  if (!appKey) {
    return NextResponse.json({ success: false, error: '请先配置 App Key' }, { status: 401 });
  }
  try {
    const sp = request.nextUrl.searchParams;
    const params: Record<string, string | number | undefined> = {};
    if (sp.get('page'))      params.page      = parseInt(sp.get('page')!);
    if (sp.get('limit'))     params.limit     = parseInt(sp.get('limit')!);
    if (sp.get('status'))    params.status    = sp.get('status') || undefined;
    if (sp.get('task_type')) params.task_type = sp.get('task_type') || undefined;
    if (sp.get('category'))  params.category  = sp.get('category') || undefined;

    const result = (await callNarratorProxyGet(
      appKey,
      '/narrator/commentary/list',
      params
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
      { success: false, error: (e as Error).message || '获取任务列表失败' },
      { status: 500 }
    );
  }
}
