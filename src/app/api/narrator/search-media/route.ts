import { NextRequest, NextResponse } from 'next/server';
import {
  NarratorProxyError,
  callNarratorProxyGet,
} from '@/lib/narrator-proxy-backend-client';

export async function GET(request: NextRequest) {
  const appKey = request.headers.get('x-app-key') || '';
  if (!appKey) return NextResponse.json({ success: false, error: '请先配置 App Key' }, { status: 401 });
  const query = request.nextUrl.searchParams.get('query') || '';
  if (!query.trim()) return NextResponse.json({ success: false, error: '请输入搜索关键词' }, { status: 400 });
  try {
    // Upstream search_media_information is slow (40-60s). Backend allows 90s;
    // give the BFF a 95s ceiling so the backend's timeout wins, not ours.
    const result = (await callNarratorProxyGet(
      appKey,
      '/narrator/commentary/search-media',
      { query: query.trim() },
      { timeoutMs: 95_000 }
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
      { success: false, error: (e as Error).message || '搜索电影信息失败' },
      { status: 500 }
    );
  }
}
