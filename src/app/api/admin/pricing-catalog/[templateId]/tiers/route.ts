import { NextRequest, NextResponse } from 'next/server';
import {
  CatalogClientError,
  fetchCatalogTiers,
  upsertCatalogTiers,
} from '@/lib/pricing-catalog-backend-client';

/**
 * GET /api/admin/pricing-catalog/[templateId]/tiers
 * Returns the catalog's current effective tier list for the operator UX.
 * Pass-through of backend's read endpoint.
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
    const result = (await fetchCatalogTiers(appKey, templateId)) as {
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
      { success: false, error: (e as Error).message || '获取 catalog 失败' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/pricing-catalog/[templateId]/tiers
 * Atomic batch upsert. Backend validates Pro≥Flash, §4.1 surcharge
 * invariant, axis pairing, rounding-rule whitelist.
 */
export async function PUT(
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
    const body = await request.json();
    if (!body || !Array.isArray(body.tiers)) {
      return NextResponse.json(
        { success: false, error: 'Request body must be { tiers: [...] }' },
        { status: 400 }
      );
    }
    const result = (await upsertCatalogTiers(appKey, templateId, {
      tiers: body.tiers,
    })) as { data?: unknown };
    return NextResponse.json({ success: true, data: result.data ?? result });
  } catch (e) {
    if (e instanceof CatalogClientError) {
      return NextResponse.json(
        { success: false, error: e.message, code: e.code, details: e.details },
        { status: e.status }
      );
    }
    return NextResponse.json(
      { success: false, error: (e as Error).message || '保存 catalog 失败' },
      { status: 500 }
    );
  }
}
