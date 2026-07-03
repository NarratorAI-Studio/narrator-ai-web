import { NextRequest, NextResponse } from 'next/server';
import {
  NarratorMetadataError,
  fetchNarratorMetadata,
} from '@/lib/narrator-metadata-backend-client';

/**
 * GET /api/narrator/narrator-types — 查询爆款解说类型
 *
 * Routed through backend `/narrator/narrator-types` per regression coverage. Behavior
 * change vs the prior direct-upstream path: now requires `x-app-key`
 * (previously used a server-side default key + skipped user auth).
 * Home page already forwards the user's app-key, so this only fails
 * for callers who weren't authenticating before — the intended
 * tightening per product requirement v2.3 §零.4.
 */
export async function GET(request: NextRequest) {
  const appKey = request.headers.get('x-app-key') || '';
  if (!appKey) {
    return NextResponse.json(
      { success: false, error: '请先配置 App Key' },
      { status: 401 }
    );
  }
  try {
    const terminal_type =
      request.nextUrl.searchParams.get('terminal_type') || 'default';
    const upstream = (await fetchNarratorMetadata(
      appKey,
      '/narrator/narrator-types',
      { terminal_type }
    )) as { data?: unknown };
    return NextResponse.json({ success: true, data: upstream.data ?? upstream });
  } catch (e) {
    if (e instanceof NarratorMetadataError) {
      return NextResponse.json(
        { success: false, error: e.message, code: e.code },
        { status: e.status }
      );
    }
    return NextResponse.json(
      { success: false, error: (e as Error).message || '获取解说类型失败' },
      { status: 500 }
    );
  }
}
