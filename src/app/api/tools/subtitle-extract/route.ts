import { NextRequest, NextResponse } from 'next/server';
import {
  NarratorProxyError,
  callNarratorProxyPost,
} from '@/lib/narrator-proxy-backend-client';

export async function POST(request: NextRequest) {
  const appKey = request.headers.get('x-app-key') || '';
  if (!appKey) return NextResponse.json({ success: false, error: '请先配置 App Key' }, { status: 401 });
  try {
    const body = await request.json();
    // Preserve legacy shape: previous code returned the full upstream payload
    // (not unwrapped to `.data`). Backend forwards verbatim, so callers see
    // the same `{code, message, data}` they did before.
    const result = await callNarratorProxyPost(
      appKey,
      '/narrator/ocr-extraction/create',
      body
    );
    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    if (e instanceof NarratorProxyError) {
      return NextResponse.json(
        { success: false, error: e.message, code: e.code },
        { status: e.status }
      );
    }
    return NextResponse.json(
      { success: false, error: (e as Error).message || '创建字幕提取任务失败' },
      { status: 500 }
    );
  }
}
