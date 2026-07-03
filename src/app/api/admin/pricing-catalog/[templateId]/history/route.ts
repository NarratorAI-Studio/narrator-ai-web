import { NextRequest, NextResponse } from 'next/server';
import {
  CatalogClientError,
  fetchCatalogHistory,
} from '@/lib/pricing-catalog-backend-client';

/**
 * GET /api/admin/pricing-catalog/[templateId]/history
 * Full per-tier version trail (includes disabled rows). Operator-only.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> }
) {
  const appKey = request.headers.get('x-app-key') || '';
  if (!appKey) {
    return NextResponse.json(
      { success: false, error: '请先配置 App Key' },
      { status: 401 }
    );
  }
  try {
    const { templateId } = await params;
    const result = (await fetchCatalogHistory(appKey, templateId)) as {
      data?: unknown;
    };
    return NextResponse.json({ success: true, data: result.data ?? result });
  } catch (e) {
    if (e instanceof CatalogClientError) {
      return NextResponse.json(
        { success: false, error: e.message, code: e.code, details: e.details },
        { status: e.status }
      );
    }
    return NextResponse.json(
      { success: false, error: (e as Error).message || '获取历史失败' },
      { status: 500 }
    );
  }
}
