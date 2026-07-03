import { NextRequest, NextResponse } from 'next/server';
import {
  NarratorProxyError,
  callNarratorProxyPost,
} from '@/lib/narrator-proxy-backend-client';
import { NARRATOR_CREATE_BFF_TIMEOUT_MS } from '@/app/api/narrator/create-bff-timeout';

export async function POST(request: NextRequest) {
  const appKey = request.headers.get('x-app-key') || '';
  if (!appKey) return NextResponse.json({ success: false, error: '请先配置 App Key' }, { status: 401 });
  try {
    const body = await request.json();
    const result = (await callNarratorProxyPost(
      appKey,
      '/narrator/commentary/create-clip-data',
      body,
      { timeoutMs: NARRATOR_CREATE_BFF_TIMEOUT_MS }
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
      { success: false, error: (e as Error).message || '创建剪辑数据失败' },
      { status: 500 }
    );
  }
}
