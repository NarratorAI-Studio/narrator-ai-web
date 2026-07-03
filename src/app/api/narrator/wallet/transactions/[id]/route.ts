import { NextRequest, NextResponse } from 'next/server';
import { walletClient, WalletError } from '@/lib/wallet-client';
import { IS_WALLET_MOCK, walletBackendUnconfigured } from '../../_mock';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const appKey = request.headers.get('x-app-key') ?? '';
  if (!appKey) {
    return NextResponse.json({ success: false, error: '请先配置 App Key' }, { status: 401 });
  }

  if (walletBackendUnconfigured()) {
    return NextResponse.json({ success: false, error: 'Wallet backend not configured', code: 'BACKEND_UNAVAILABLE' }, { status: 503 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ success: false, error: '缺少 transaction_id' }, { status: 400 });
  }

  if (IS_WALLET_MOCK) {
    const status = id.includes('confirmed') ? 'confirmed' : id.includes('refunded') ? 'refunded' : 'frozen';
    return NextResponse.json({
      success: true,
      data: {
        transaction_id: id,
        quote_id: 'mock_quote',
        template_id: 1,
        combo_key: 'original_narration_pro',
        amount: 84.5,
        pricing_rule_version: 'mock_v1',
        status,
        created_at: new Date().toISOString(),
        billing_summary: {
          hard_price: '84.50',
          discount_amount: '0.00',
          refunded_amount: status === 'refunded' ? '84.50' : '0.00',
          net_consumption: status === 'frozen' ? null : status === 'refunded' ? '0.00' : '84.50',
        },
      },
    });
  }

  try {
    const data = await walletClient.getTransaction(appKey, id);
    return NextResponse.json({ success: true, data });
  } catch (err) {
    if (err instanceof WalletError) {
      const status = err.code === 'TRANSACTION_NOT_FOUND' ? 404 : (err.statusCode ?? 500);
      return NextResponse.json({ success: false, error: err.message, code: err.code }, { status });
    }
    return NextResponse.json({ success: false, error: '查询交易失败，请重试' }, { status: 500 });
  }
}
