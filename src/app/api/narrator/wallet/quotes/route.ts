import { NextRequest, NextResponse } from 'next/server';
import { walletClient, WalletError } from '@/lib/wallet-client';
import { IS_WALLET_MOCK, walletBackendUnconfigured } from '../_mock';
import type { WalletQuoteRequest } from '@/lib/wallet-types';

export async function POST(request: NextRequest) {
  const appKey = request.headers.get('x-app-key') ?? '';
  if (!appKey) {
    return NextResponse.json({ success: false, error: '请先配置 App Key' }, { status: 401 });
  }

  if (walletBackendUnconfigured()) {
    return NextResponse.json({ success: false, error: 'Wallet backend not configured', code: 'BACKEND_UNAVAILABLE' }, { status: 503 });
  }

  let body: WalletQuoteRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: '请求体格式错误' }, { status: 400 });
  }

  if (!body.template_id || !body.combo_key || body.client_price == null) {
    return NextResponse.json({ success: false, error: '缺少必要字段: template_id, combo_key, client_price' }, { status: 400 });
  }

  if (IS_WALLET_MOCK) {
    return NextResponse.json({
      success: true,
      data: {
        quote_id: `mock_quote_${Date.now()}`,
        template_id: body.template_id,
        combo_key: body.combo_key,
        hard_price: body.client_price,
        pricing_rule_version: 'mock_v1',
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      },
    });
  }

  try {
    const data = await walletClient.quote(appKey, body);
    return NextResponse.json({ success: true, data });
  } catch (err) {
    if (err instanceof WalletError) {
      return NextResponse.json({ success: false, error: err.message, code: err.code }, { status: err.statusCode ?? 500 });
    }
    return NextResponse.json({ success: false, error: '报价失败，请重试' }, { status: 500 });
  }
}
