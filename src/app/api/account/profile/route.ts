import { NextRequest, NextResponse } from 'next/server';

import { fetchAccountProfile } from '@/lib/account-profile-client';

/**
 * GET /api/account/profile
 *
 * Reseller-mediated end-user profile + balance, backed by
 * narrator-ai-web-backend `GET /account/me`. Forwards the caller's
 * `x-app-key` header verbatim as `X-Web-App-Key`. No fallback to the
 * legacy direct-to-upstream `/api/account/balance` — if the key isn't
 * in the reseller users table, the page should surface the real reason
 * ("用户不存在" etc.) instead of being silently routed around the new
 * backend.
 *
 * Response shape on success: `{ success: true, data: { id, nickname,
 * mobile, email, balance, company_name } }`. The backend returns
 * `user_id`; renamed to `id` here to match the existing `UserBalance`
 * interface used by the 个人中心 page — no UI refactor needed.
 *
 * Errors are normalized to `{ success: false, error: <Chinese string>,
 * code: <backend code> }`. Backend returns a structured English `error`
 * object; we map the code to a user-facing Chinese message so the
 * existing toast renders cleanly. `code` is preserved verbatim for
 * devtools / log correlation.
 */

const ERROR_MESSAGES_ZH: Record<string, string> = {
  WEB_APP_KEY_MISSING: '未配置 App Key',
  WEB_APP_KEY_INVALID: 'App Key 格式不正确（应为 grid_ 开头 + 22 位）',
  WEB_APP_KEY_UNKNOWN: '用户不存在，请检查 App Key 是否正确',
  USER_LOOKUP_FAILED: '服务暂时不可用，请稍后重试',
  BFF_UPSTREAM_TIMEOUT: '后端响应超时，请稍后重试',
  BFF_UPSTREAM_UNREACHABLE: '无法连接到后端服务，请稍后重试',
};

function translateError(code: string, fallbackMessage: string): string {
  return ERROR_MESSAGES_ZH[code] ?? fallbackMessage ?? '获取用户信息失败';
}

export async function GET(request: NextRequest) {
  const appKey = request.headers.get('x-app-key') || '';
  if (!appKey) {
    return NextResponse.json(
      { success: false, error: '请先配置 App Key', code: 'APP_KEY_MISSING' },
      { status: 401 }
    );
  }

  const { status, body } = await fetchAccountProfile(appKey);

  if (status === 200 && body.success === true) {
    const { user_id, ...rest } = body.data;
    return NextResponse.json({
      success: true,
      data: { id: user_id, ...rest },
    });
  }

  // body.success === false here; translate the backend code into a
  // user-facing Chinese string and pass the raw code through for
  // debugging.
  const code = body.success === false ? body.error.code : 'UNKNOWN';
  const fallback = body.success === false ? body.error.message : '获取用户信息失败';
  return NextResponse.json(
    { success: false, error: translateError(code, fallback), code },
    { status }
  );
}
