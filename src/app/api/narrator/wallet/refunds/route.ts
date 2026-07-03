import { NextRequest, NextResponse } from 'next/server';
import { walletClient, WalletError } from '@/lib/wallet-client';
import { IS_WALLET_MOCK, walletBackendUnconfigured } from '../_mock';
import type { WalletRefundRequest } from '@/lib/wallet-types';

export async function POST(request: NextRequest) {
  const appKey = request.headers.get('x-app-key') ?? '';
  if (!appKey) {
    return NextResponse.json({ success: false, error: '请先配置 App Key' }, { status: 401 });
  }

  if (walletBackendUnconfigured()) {
    return NextResponse.json({ success: false, error: 'Wallet backend not configured', code: 'BACKEND_UNAVAILABLE' }, { status: 503 });
  }

  let body: WalletRefundRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: '请求体格式错误' }, { status: 400 });
  }

  if (!body.transaction_id) {
    return NextResponse.json({ success: false, error: '缺少必要字段: transaction_id' }, { status: 400 });
  }

  if (IS_WALLET_MOCK) {
    return NextResponse.json({
      success: true,
      data: {
        transaction_id: body.transaction_id,
        status: 'refunded',
        refunded_at: new Date().toISOString(),
      },
    });
  }

  try {
    const data = await walletClient.refund(appKey, body);
    return NextResponse.json({ success: true, data });
  } catch (err) {
    if (err instanceof WalletError) {
      return NextResponse.json({ success: false, error: err.message, code: err.code }, { status: err.statusCode ?? 500 });
    }
    return NextResponse.json({ success: false, error: '退款失败，请重试' }, { status: 500 });
  }
}
