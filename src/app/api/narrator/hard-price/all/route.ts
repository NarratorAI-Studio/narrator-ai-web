import { NextRequest, NextResponse } from 'next/server';

import { queryAllHardPricesFromAPI } from '@/lib/hard-price-client';

/**
 * GET /api/narrator/hard-price/all?template_id=N
 * 查询模板库全部 5 档模板价格 — 通过 Fly.io Pricing API
 */
export async function GET(request: NextRequest) {
  const appKey = request.headers.get('x-app-key') || '';
  if (!appKey)
    return NextResponse.json(
      { success: false, error: '请先配置 App Key' },
      { status: 401 }
    );

  try {
    const templateId = Number(
      request.nextUrl.searchParams.get('template_id')
    );
    if (!templateId || isNaN(templateId)) {
      return NextResponse.json(
        { success: false, error: 'template_id is required' },
        { status: 400 }
      );
    }

    const prices = await queryAllHardPricesFromAPI(templateId);

    if (prices.length === 0) {
      return NextResponse.json(
        { success: false, error: `No hard prices found for template ${templateId}` },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: { template_id: templateId, prices },
    });
  } catch (error: unknown) {
    const e = error as Error & { status?: number; code?: string };
    const message = e instanceof Error ? e.message : '查询模板价格失败';
    return NextResponse.json(
      { success: false, error: message, code: e.code ?? 'UNKNOWN' },
      { status: e.status ?? 500 },
    );
  }
}
