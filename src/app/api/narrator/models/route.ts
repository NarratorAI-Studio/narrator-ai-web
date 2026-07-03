import { NextRequest, NextResponse } from 'next/server';
import {
  NarratorMetadataError,
  fetchNarratorMetadata,
} from '@/lib/narrator-metadata-backend-client';

/**
 * GET /api/narrator/models — v1 解说模型列表
 *
 * Routed through backend `/narrator/models` per regression coverage.
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
    const upstream = (await fetchNarratorMetadata(
      appKey,
      '/narrator/models'
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
      { success: false, error: (e as Error).message || 'Failed to fetch narrator models' },
      { status: 500 }
    );
  }
}
