import { NextRequest, NextResponse } from 'next/server';
import { resolveAdminOperatorIp } from '@/lib/admin-operator-ip';
import {
  AdminUsersClientError,
  AdminUpdateUserBody,
  getAdminUserByAppKey,
  updateAdminUser,
} from '@/lib/admin-users-backend-client';

/**
 * GET /api/admin/users/[appKey]
 * Operator-only user lookup. Forwards to backend's
 * `GET /admin/users/<app_key>`. Same Basic Auth + CSRF gate at
 * `src/middleware.ts` as the sibling `POST /api/admin/users` route.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appKey: string }> }
) {
  try {
    const { appKey } = await params;
    const user = await getAdminUserByAppKey(
      appKey,
      resolveAdminOperatorIp(request)
    );
    return NextResponse.json({ success: true, data: user });
  } catch (e) {
    if (e instanceof AdminUsersClientError) {
      return NextResponse.json(
        { success: false, error: e.message, code: e.code, details: e.details },
        { status: e.status }
      );
    }
    return NextResponse.json(
      { success: false, error: (e as Error).message || '查询用户失败' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/users/[appKey]
 * Partial update for an existing user. Forwards to backend's
 * `PATCH /admin/users/<app_key>`.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ appKey: string }> }
) {
  let body: AdminUpdateUserBody;
  try {
    body = (await request.json()) as AdminUpdateUserBody;
  } catch {
    return NextResponse.json(
      { success: false, error: 'Request body must be valid JSON.' },
      { status: 400 }
    );
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json(
      { success: false, error: 'Request body must be a JSON object.' },
      { status: 400 }
    );
  }

  try {
    const { appKey } = await params;
    const user = await updateAdminUser(
      appKey,
      body,
      resolveAdminOperatorIp(request)
    );
    return NextResponse.json({ success: true, data: user });
  } catch (e) {
    if (e instanceof AdminUsersClientError) {
      return NextResponse.json(
        { success: false, error: e.message, code: e.code, details: e.details },
        { status: e.status }
      );
    }
    return NextResponse.json(
      { success: false, error: (e as Error).message || '更新用户失败' },
      { status: 500 }
    );
  }
}
