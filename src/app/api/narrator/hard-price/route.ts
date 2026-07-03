import { NextRequest, NextResponse } from 'next/server';

import { queryHardPriceFromAPI } from '@/lib/hard-price-client';

/**
 * POST /api/narrator/hard-price
 * 查询模板库模板价格（单个 combo_key）— 通过 Fly.io Pricing API
 */
export async function POST(request: NextRequest) {
  const appKey = request.headers.get('x-app-key') || '';
  if (!appKey)
    return NextResponse.json(
      { success: false, error: '请先配置 App Key' },
      { status: 401 }
    );

  try {
    const body = await request.json();
    const { template_id, combo_key } = body;

    if (!template_id || !combo_key) {
      return NextResponse.json(
        { success: false, error: 'template_id and combo_key are required' },
        { status: 400 }
      );
    }

    const result = await queryHardPriceFromAPI(template_id, combo_key);

    if (!result) {
      return NextResponse.json(
        { success: false, error: `Hard price not found for template ${template_id} / ${combo_key}` },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    const e = error as Error & { status?: number; code?: string };
    const message = e instanceof Error ? e.message : '查询模板价格失败';
    return NextResponse.json(
      { success: false, error: message, code: e.code ?? 'UNKNOWN' },
      { status: e.status ?? 500 },
    );
  }
}
